"""Generate synthetic neutral-to-styled pairs from style sample JSONL.

The paired output uses the canonical training record:

    input  = neutralized version of the styled chunk
    output = original styled chunk, or a cleaned single-speaker style target

Providers:
    heuristic: deterministic cleanup fallback for dry runs
    local:     uses the base model on a CUDA pod through Unsloth
    ollama:    uses a local Ollama chat model, recommended for current dev
    openai:    uses OpenAI when OPENAI_API_KEY is available
"""

from __future__ import annotations

# This script only needs the Python standard library for file handling, CLI
# parsing, regex cleanup, and HTTP calls. Provider-specific dependencies are
# imported lazily inside their classes so the script can still run with another
# provider when OpenAI or Unsloth is not installed.
import argparse
import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Protocol


# Resolve paths from the repository root instead of from the current shell
# directory. That lets this script be run from the repo root, from
# ml/style-transfer, or from automation without changing relative paths.
ROOT = Path(__file__).resolve().parents[3]

# Default input is the merged prepared dataset created by prepare_dataset.py.
# This script filters it down to records whose mode is "style_sample".
DEFAULT_INPUT = ROOT / "ml/style-transfer/datasets/processed/style_transfer.all.jsonl"

# Default output is a separate JSONL file of accepted neutral-to-styled pairs.
# prepare_dataset.py can later merge these pair records into train/eval splits.
DEFAULT_OUTPUT = ROOT / "ml/style-transfer/datasets/processed/style_transfer.pairs.jsonl"

# The local Unsloth provider uses this base model to generate neutral versions
# when running on a CUDA machine. The Ollama provider is the normal dev default.
DEFAULT_BASE_MODEL = "Orion-zhen/Qwen2.5-7B-Instruct-Uncensored"
DEFAULT_OLLAMA_ENDPOINT = "http://127.0.0.1:11434"
DEFAULT_OLLAMA_MODEL = "qwen2.5:7b"

# This exact instruction becomes part of every training record. Keeping it in
# one constant ensures every generated example teaches the same task contract:
# transform neutral text into persona style without changing facts.
PAIR_INSTRUCTION = (
    "Rewrite the neutral answer in the target persona style. Treat the neutral answer only as source "
    "content, not as a style example. Train on the output persona voice only. Preserve all facts exactly. "
    "Change only tone, rhythm, slang, and attitude."
)

# Stopwords are common English words that do not tell us much about meaning.
# The validation helpers remove them before measuring overlap/repetition so
# phrases like "the and to" do not make two unrelated texts look similar.
STOPWORDS = {
    "a",
    "about",
    "all",
    "am",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "because",
    "been",
    "but",
    "by",
    "can",
    "do",
    "does",
    "for",
    "from",
    "had",
    "has",
    "have",
    "he",
    "her",
    "here",
    "him",
    "his",
    "i",
    "if",
    "in",
    "is",
    "it",
    "its",
    "me",
    "my",
    "of",
    "on",
    "or",
    "our",
    "she",
    "so",
    "that",
    "the",
    "their",
    "them",
    "there",
    "they",
    "this",
    "to",
    "was",
    "we",
    "were",
    "what",
    "when",
    "who",
    "why",
    "with",
    "you",
    "your",
}

# These patterns catch outputs that are usually bad training examples:
# transcript/meta language, assistant disclaimers, known unwanted phrases, and
# slurs or excessive threat-like language. They are used for both neutral and
# styled validation because either side can be polluted by generation artifacts.
BAD_STYLE_PATTERNS = [
    re.compile(pattern, flags=re.IGNORECASE)
    for pattern in [
        r"\b(transcript|speaker|stage direction|neutral answer|styled answer)\b",
        r"\bas an ai\b",
        r"\bi cannot\b",
        r"\bi can't assist\b",
        r"\bget the message across\b",
    ]
]

# Raw transcript chunks often include labels like "Speaker 1:" or "Host:".
# Training targets should be clean single responses, so those labels are treated
# as rejection reasons after generation/cleanup.
SPEAKER_LABEL_PATTERN = re.compile(r"(^|\s)(?:speaker|person|woman|man|host|producer|narrator)\s*\d*\s*:", re.I)


class Neutralizer(Protocol):
    """Small interface shared by all neutralization backends.

    A Protocol lets type checkers understand that HeuristicNeutralizer,
    OpenAINeutralizer, OllamaNeutralizer, and LocalNeutralizer are interchangeable
    as long as they expose a compatible neutralize method.
    """

    def neutralize(self, styled_text: str) -> str:
        """Return a neutral version of styled_text."""


def parse_args() -> argparse.Namespace:
    """Define the command-line interface for the pair-generation job."""

    parser = argparse.ArgumentParser(description=__doc__)

    # Input/output controls. The input should contain style_sample records; the
    # output receives only accepted style_transfer_pair records.
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)

    # Provider selection controls how neutral text is produced. Ollama is the
    # default because it works well for local/RunPod development without sending
    # data to a hosted API.
    parser.add_argument("--provider", choices=["heuristic", "local", "ollama", "openai"], default="ollama")
    parser.add_argument("--base-model", default=DEFAULT_BASE_MODEL)
    parser.add_argument("--ollama-endpoint", default=os.getenv("OLLAMA_ENDPOINT", DEFAULT_OLLAMA_ENDPOINT))
    parser.add_argument("--ollama-model", default=os.getenv("OLLAMA_MODEL", DEFAULT_OLLAMA_MODEL))
    parser.add_argument("--openai-model", default="gpt-4.1-mini")

    # Generation controls. max-records is useful for testing a small batch before
    # spending time/cost on the whole dataset.
    parser.add_argument("--max-records", type=int)
    parser.add_argument("--max-new-tokens", type=int, default=180)
    parser.add_argument("--temperature", type=float, default=0.1)

    # Quality thresholds. These keep obviously bad generations out of the
    # training set, which matters because noisy synthetic pairs directly teach
    # the style-transfer model bad behavior.
    parser.add_argument("--min-input-chars", type=int, default=40)
    parser.add_argument("--min-output-chars", type=int, default=60)
    parser.add_argument("--max-output-chars", type=int, default=650)
    parser.add_argument("--min-overlap", type=float, default=0.16)
    parser.add_argument("--max-sentences", type=int, default=4)
    parser.add_argument(
        "--max-source-chars",
        type=int,
        default=0,
        help="Optionally shorten each source style chunk before generating candidates. 0 keeps the full chunk.",
    )
    parser.add_argument(
        "--max-source-sentences",
        type=int,
        default=0,
        help="Optionally keep only this many sentence-like chunks from each source style sample. 0 keeps all sentences.",
    )

    # Retry/quality options. Retries feed the previous rejection reasons back to
    # Ollama so it can correct the next attempt. The LLM judge is optional
    # because it is slower but can catch meaning drift that simple regex checks
    # miss.
    parser.add_argument("--retries", type=int, default=2)
    parser.add_argument("--llm-judge", action="store_true")
    parser.add_argument("--clean-style-output", action="store_true")

    # Rejected records are useful for auditing thresholds and prompts. overwrite
    # resets both accepted and rejected files so a run can be reproduced cleanly.
    parser.add_argument("--rejections-output", type=Path)
    parser.add_argument("--overwrite", action="store_true")
    return parser.parse_args()


def read_jsonl(path: Path) -> list[dict[str, object]]:
    """Read a JSONL file into memory as a list of dictionaries.

    JSONL means one JSON object per line. Blank lines are skipped so small manual
    edits in a dataset file do not crash the run.
    """

    records: list[dict[str, object]] = []
    with path.open("r", encoding="utf-8") as file:
        for line in file:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records


def append_jsonl(path: Path, records: list[dict[str, object]]) -> None:
    """Append records to a JSONL file, creating the parent folder if needed."""

    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as file:
        for record in records:
            # ensure_ascii=False preserves the original wording instead of
            # escaping every non-ASCII character, which keeps the dataset easier
            # to inspect by hand.
            file.write(json.dumps(record, ensure_ascii=False) + "\n")


def existing_ids(path: Path) -> set[str]:
    """Return IDs already written to an output file.

    This makes the script resumable: if a long generation run stops halfway
    through, rerunning it skips pairs that are already present unless
    --overwrite is used.
    """

    if not path.exists():
        return set()
    return {str(record.get("id")) for record in read_jsonl(path)}


def clean_neutral_text(text: str) -> str:
    """Normalize a model's neutral answer before validating/writing it."""

    # Models sometimes wrap the answer with labels or markdown fences. Removing
    # those artifacts keeps the training input as plain text only.
    text = text.strip()
    text = re.sub(r"^neutral(?: answer| version)?:\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"```(?:text)?|```", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip(" \"'")


def clean_styled_text(text: str) -> str:
    """Normalize a model-cleaned styled answer before validation/writing."""

    # This mirrors clean_neutral_text but also removes a leading bullet because
    # transcript chunks or model answers often start with "- " or "• ".
    text = text.strip()
    text = re.sub(r"^styled(?: answer| version| target)?:\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"```(?:text)?|```", "", text)
    text = re.sub(r"^\s*[-•]\s*", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip(" \"'")


def shorten_source_text(text: str, max_chars: int, max_sentences: int) -> str:
    """Shorten a raw style sample before synthetic pair generation.

    This is useful for manual/heuristic candidate review. The raw transcript
    chunks can be long and multi-speaker, which makes rejected rows hard to
    inspect by hand. Shortening here keeps candidate files readable without
    changing the original raw dataset.
    """

    shortened = re.sub(r"\s+", " ", text).strip()
    if max_sentences > 0:
        parts = re.split(r"(?<=[.!?])\s+", shortened)
        shortened = " ".join(part for part in parts[:max_sentences] if part.strip()).strip()

    if max_chars > 0 and len(shortened) > max_chars:
        boundary = shortened.rfind(" ", 0, max_chars)
        if boundary < max_chars * 0.6:
            boundary = max_chars
        shortened = shortened[:boundary].rstrip(" ,;:-")
        if not re.search(r"[.!?]$", shortened):
            shortened = f"{shortened}."

    return shortened


def content_tokens(text: str) -> list[str]:
    """Return meaning-bearing lowercase tokens used by validation metrics."""

    # The regex keeps alphabetic words of at least three characters. That removes
    # punctuation, one-letter fragments, and most noise before stopwords are
    # filtered out.
    tokens = re.findall(r"[a-zA-Z][a-zA-Z']{2,}", text.lower())
    return [token for token in tokens if token not in STOPWORDS]


def count_sentences(text: str) -> int:
    """Count sentence-like chunks using punctuation as a lightweight boundary."""

    sentences = [part for part in re.split(r"[.!?]+", text) if part.strip()]
    return len(sentences)


def repeated_ngram_ratio(text: str, ngram_size: int = 4) -> float:
    """Estimate how much a text repeats the same content-word sequence."""

    tokens = content_tokens(text)
    if len(tokens) < ngram_size * 2:
        # Very short texts do not have enough material for a useful repetition
        # ratio, so treat them as not repetitive here. Length is checked
        # separately by validate_neutral_text/validate_style_text.
        return 0.0

    # Build every sliding n-gram, count how many are duplicates, then divide by
    # total n-grams. A high value usually means the model got stuck repeating.
    ngrams = [tuple(tokens[index : index + ngram_size]) for index in range(len(tokens) - ngram_size + 1)]
    repeated = len(ngrams) - len(set(ngrams))
    return repeated / max(len(ngrams), 1)


def has_repeated_phrase(text: str) -> bool:
    """Detect phrase repetition that might not show up in 4-gram ratio alone."""

    lowered = text.lower()

    # Find short phrase windows, normalize each phrase down to content tokens,
    # and reject once the same meaningful phrase appears three times.
    phrases = re.findall(r"\b[\w']+(?:\s+[\w']+){1,5}\b", lowered)
    counts: dict[str, int] = {}
    for phrase in phrases:
        normalized = " ".join(content_tokens(phrase))
        if len(normalized.split()) < 2:
            continue
        counts[normalized] = counts.get(normalized, 0) + 1
        if counts[normalized] >= 3:
            return True
    return False


def token_overlap(left: str, right: str) -> float:
    """Measure how much of left's meaningful vocabulary appears in right."""

    left_tokens = set(content_tokens(left))
    right_tokens = set(content_tokens(right))
    if not left_tokens or not right_tokens:
        return 0.0

    # The denominator is left_tokens because callers ask, "how much of the
    # neutral meaning survived in the styled output?"
    return len(left_tokens & right_tokens) / len(left_tokens)


def validate_neutral_text(text: str, args: argparse.Namespace) -> list[str]:
    """Return quality problems found in a generated neutral input."""

    issues: list[str] = []

    # Neutral input must be long enough to teach the model a meaningful rewrite
    # task, but must not include transcript labels, meta instructions, or loops.
    if len(text) < args.min_input_chars:
        issues.append("neutral text is too short")
    if SPEAKER_LABEL_PATTERN.search(text):
        issues.append("neutral text contains speaker labels")
    if any(pattern.search(text) for pattern in BAD_STYLE_PATTERNS):
        issues.append("neutral text contains meta text")
    if repeated_ngram_ratio(text) > 0.08 or has_repeated_phrase(text):
        issues.append("neutral text repeats phrases")
    return issues


def validate_style_text(neutral_text: str, styled_text: str, args: argparse.Namespace) -> list[str]:
    """Return quality problems found in the styled training target."""

    issues: list[str] = []

    # These checks guard against outputs that are too tiny to train on, too long
    # for the intended response shape, or still look like raw transcript data.
    if len(styled_text) < args.min_output_chars:
        issues.append("styled output is too short")
    if len(styled_text) > args.max_output_chars:
        issues.append("styled output is too long")
    if styled_text.startswith(("-", "•")):
        issues.append("styled output starts like a transcript bullet")
    if " - " in styled_text:
        issues.append("styled output contains transcript fragments")
    if not re.search(r"[.!?]$", styled_text):
        issues.append("styled output appears unfinished")
    if SPEAKER_LABEL_PATTERN.search(styled_text):
        issues.append("styled output contains speaker labels")
    if any(pattern.search(styled_text) for pattern in BAD_STYLE_PATTERNS):
        issues.append("styled output contains meta or filler text")
    if count_sentences(styled_text) > args.max_sentences:
        issues.append("styled output has too many sentences")
    if repeated_ngram_ratio(styled_text) > 0.05 or has_repeated_phrase(styled_text):
        issues.append("styled output repeats phrases")

    # Synthetic pairs only help if input and output preserve the same core
    # meaning. This cheap overlap check catches many hallucinations before the
    # optional LLM judge is used.
    if token_overlap(neutral_text, styled_text) < args.min_overlap:
        issues.append("styled output drifts from neutral meaning")
    return issues


def make_messages(neutral_text: str, styled_text: str) -> list[dict[str, str]]:
    """Build the chat-format copy of a training pair.

    Many fine-tuning tools train on role-based chat messages. The plain
    input/output fields are kept too, but messages is the format the trainer can
    feed directly into a chat template.
    """

    return [
        {
            "role": "user",
            "content": f"{PAIR_INSTRUCTION}\n\nNeutral answer:\n{neutral_text}",
        },
        {
            "role": "assistant",
            "content": styled_text,
        },
    ]


def make_pair_record(source: dict[str, object], neutral_text: str, styled_text: str) -> dict[str, object]:
    """Create one canonical style_transfer_pair record from a source sample."""

    # Prefix the source ID so generated pairs do not collide with the original
    # style_sample IDs in merged datasets.
    record_id = f"pair-{source.get('id', 'unknown')}"
    return {
        "id": record_id,
        "mode": "style_transfer_pair",

        # Source metadata makes it possible to trace a synthetic pair back to
        # the transcript chunk that inspired it when auditing bad examples.
        "source_file": source.get("source_file", "synthetic"),
        "source_record_id": source.get("id"),

        # input is what the final model will receive; output is what it should
        # learn to produce in the target persona style.
        "instruction": PAIR_INSTRUCTION,
        "input": neutral_text,
        "output": styled_text,
        "messages": make_messages(neutral_text, styled_text),
    }


class HeuristicNeutralizer:
    """Fast deterministic fallback for smoke tests.

    This does not understand meaning; it only strips a few obvious profanity
    tokens and normalizes whitespace. It is useful for testing file flow without
    needing Ollama/OpenAI/CUDA.
    """

    def neutralize(self, styled_text: str) -> str:
        # Remove a small profanity list, flatten whitespace, and remove common
        # transcript separators. The real semantic neutralization happens in the
        # model-backed providers.
        neutral = re.sub(r"\s+", " ", styled_text)
        neutral = neutral.replace(" - ", " ")
        return clean_neutral_text(neutral)


class OpenAINeutralizer:
    """Neutralize text through the OpenAI Responses API."""

    def __init__(self, model: str, temperature: float) -> None:
        # Import here so users who never select --provider openai do not need the
        # openai package installed just to use the script.
        from openai import OpenAI

        if not os.getenv("OPENAI_API_KEY"):
            raise RuntimeError("OPENAI_API_KEY is required for --provider openai")
        self.client = OpenAI()
        self.model = model
        self.temperature = temperature

    def neutralize(self, styled_text: str) -> str:
        # Ask for only the rewritten answer. The cleanup function still strips
        # labels/markdown because LLMs can include them despite instructions.
        response = self.client.responses.create(
            model=self.model,
            temperature=self.temperature,
            input=[
                {
                    "role": "system",
                    "content": (
                        "Convert stylized reality-TV dialogue into a neutral, plain-English answer. "
                        "Preserve concrete meaning and intent. Remove slang, "
                        "and show-specific phrasing. Return only the neutral answer."
                    ),
                },
                {"role": "user", "content": styled_text},
            ],
        )
        return clean_neutral_text(response.output_text)


class OllamaNeutralizer:
    """Use a locally reachable Ollama chat model for generation and judging."""

    def __init__(self, endpoint: str, model: str, max_new_tokens: int, temperature: float) -> None:
        # Strip a trailing slash so URL construction is consistent whether the
        # user passes "http://host:11434" or "http://host:11434/".
        self.endpoint = endpoint.rstrip("/")
        self.model = model
        self.max_new_tokens = max_new_tokens
        self.temperature = temperature

    def chat(self, messages: list[dict[str, str]], options: dict[str, Any]) -> str:
        """Send one non-streaming chat request to Ollama and return text."""

        # Ollama's /api/chat endpoint accepts OpenAI-like role messages plus an
        # options object for model-specific generation settings.
        payload = {
            "model": self.model,
            "stream": False,
            "messages": messages,
            "options": options,
        }

        # urllib is used instead of requests so the script has no extra
        # dependency for the default Ollama workflow.
        request = urllib.request.Request(
            f"{self.endpoint}/api/chat",
            data=json.dumps(payload).encode("utf-8"),
            headers={"content-type": "application/json"},
            method="POST",
        )
        try:
            # The timeout is intentionally generous because local/RunPod model
            # inference can be slow on longer transcript chunks.
            with urllib.request.urlopen(request, timeout=180) as response:
                data = json.loads(response.read().decode("utf-8"))
        except urllib.error.URLError as error:
            raise RuntimeError(f"Ollama request failed: {error}") from error

        # Ollama returns content under {"message": {"content": "..."}}
        # for chat completions. Anything else is treated as a provider failure.
        message = data.get("message", {})
        content = message.get("content") if isinstance(message, dict) else ""
        if not isinstance(content, str):
            raise RuntimeError("Ollama returned a malformed chat response")
        return content

    def neutralize(self, styled_text: str, feedback: str | None = None) -> str:
        """Convert a raw style/transcript chunk into a neutral summary answer."""

        # The prompt frames the source as a multi-speaker transcript chunk
        # because the processed style samples may still contain dialogue-like
        # fragments. The desired output is one neutral answer suitable as the
        # input side of a style-transfer pair.
        prompt = (
            "Convert this stylized, slang-heavy multi-speaker transcript chunk into one neutral, "
            "plain-English summary answer. Preserve only the concrete meaning, intent, and sequence "
            "of events. Do not add facts. Write 2-5 plain sentences. Return only the "
            "neutral answer."
        )
        if feedback:
            # On retries, tell the model exactly why the previous attempt failed
            # so it has a chance to fix length, repetition, labels, or drift.
            prompt += f"\nFix these previous quality problems: {feedback}."

        content = self.chat(
            [
                {"role": "system", "content": prompt},
                {
                    "role": "user",
                    "content": f"Transcript chunk:\n{styled_text}\n\nNeutral plain-English answer:",
                },
            ],
            {
                "temperature": self.temperature,
                "top_p": 0.85,
                "num_predict": self.max_new_tokens,
                "repeat_penalty": 1.2,
                "num_ctx": 4096,
            },
        )
        if not content.strip():
            raise RuntimeError("Ollama returned an empty neutralization response")
        return clean_neutral_text(content)

    def clean_style_output(self, styled_text: str, neutral_text: str, feedback: str | None = None) -> str:
        """Rewrite a messy style sample into a clean single-speaker target."""

        # When --clean-style-output is enabled, the script does not use the raw
        # transcript chunk as output. Instead, it asks Ollama to produce a clean
        # styled response that preserves the generated neutral answer's content.
        # This can make training pairs more useful than direct transcript chunks.
        prompt = (
            "You create training targets for a style-transfer model. Rewrite the neutral answer as one "
            "concise single-speaker response in the target persona style. Speak as the persona commenting "
            "on the situation; do not roleplay as any person in the transcript. Treat the neutral answer "
            "only as source content, not as a style example. Preserve its facts, sequence, and requested "
            "structure; do not add new people, places, jobs, events, motivations, or facts. "
            "Do not turn third-person descriptions into first-person confessions. Keep the voice "
            "slang-heavy, blunt, dramatic, and conversational, but keep the response coherent. No "
            "transcript bullets, speaker labels, stage directions, markdown, explanations, or repeated "
            "phrases. Write 1-4 sentences and return only the styled answer."
        )
        if feedback:
            # Feedback here usually comes from styled-output validation, such as
            # "too long", "contains speaker labels", or "drifts from meaning".
            prompt += f"\nFix these previous quality problems: {feedback}."

        content = self.chat(
            [
                {
                    "role": "system",
                    "content": prompt,
                },
                {
                    "role": "user",
                    "content": (
                        f"Neutral answer to preserve:\n{neutral_text}\n\n"
                        f"Style reference transcript chunk:\n{styled_text}\n\n"
                        "Styled answer:"
                    ),
                },
            ],
            {
                "temperature": max(self.temperature, 0.2),
                "top_p": 0.85,
                "num_predict": self.max_new_tokens,
                "repeat_penalty": 1.35,
                "num_ctx": 4096,
            },
        )
        if not content.strip():
            raise RuntimeError("Ollama returned an empty style-cleaning response")
        return clean_styled_text(content)

    def judge_pair(self, neutral_text: str, styled_text: str) -> list[str]:
        """Ask Ollama to perform semantic quality control on a candidate pair."""

        # The regex validators are cheap and deterministic, but they cannot fully
        # understand whether the styled answer changed the facts. This optional
        # judge is slower but catches more semantic mismatches.
        content = self.chat(
            [
                {
                    "role": "system",
                    "content": (
                        "You are a strict data-quality judge for style-transfer training pairs. "
                        "Compare the neutral answer and styled answer. Reject the styled answer if it "
                        "adds facts, changes who did what, roleplays as a transcript participant instead "
                        "of commenting as the persona, includes transcript formatting, is incoherent, "
                        "is unfinished, or repeats phrases. The target "
                        "style is supposed to use slang, blunt attitude, and some profanity, so do not "
                        "reject for informal language, attitude, or ordinary profanity by itself. Pass the "
                        "pair when the core meaning is mostly preserved and the output is coherent. Return "
                        "only valid JSON with this schema: {\"pass\": boolean, \"reasons\": [\"short reason\"]}."
                    ),
                },
                {
                    "role": "user",
                    "content": f"Neutral answer:\n{neutral_text}\n\nStyled answer:\n{styled_text}",
                },
            ],
            {
                "temperature": 0,
                "top_p": 0.8,
                "num_predict": 140,
                "repeat_penalty": 1.1,
                "num_ctx": 4096,
            },
        ).strip()

        # Local models sometimes wrap JSON in commentary. Extract the first JSON
        # object so a mostly-correct response can still be parsed.
        match = re.search(r"\{.*\}", content, flags=re.DOTALL)
        if not match:
            return ["judge returned non-json response"]
        try:
            parsed = json.loads(match.group(0))
        except json.JSONDecodeError:
            return ["judge returned invalid json"]

        # Empty list means accepted. A non-empty list means rejected, with reasons
        # that can be written to the rejections file and fed into a retry.
        passed = parsed.get("pass")
        reasons = parsed.get("reasons")
        if passed is True:
            return []
        if isinstance(reasons, list) and reasons:
            return [str(reason) for reason in reasons if str(reason).strip()]
        return ["judge rejected pair"]


class LocalNeutralizer:
    """Run neutralization with a local Hugging Face model through Unsloth."""

    def __init__(self, model_name: str, max_new_tokens: int, temperature: float) -> None:
        # These imports require a CUDA-capable training environment, so they stay
        # inside this provider. A normal local Ollama run will not import them.
        import torch
        from unsloth import FastLanguageModel

        self.torch = torch

        # 4-bit loading lowers VRAM use, making a small base model practical on
        # hosted GPUs. max_seq_length controls the context used by the tokenizer
        # and model during generation.
        self.model, self.tokenizer = FastLanguageModel.from_pretrained(
            model_name=model_name,
            max_seq_length=2048,
            load_in_4bit=True,
        )

        # Switch Unsloth into inference mode for faster generation and reduced
        # overhead compared with training mode.
        FastLanguageModel.for_inference(self.model)
        self.max_new_tokens = max_new_tokens
        self.temperature = temperature

    def neutralize(self, styled_text: str) -> str:
        # Build one chat message because the local model/tokenizer expects the
        # same chat-template style used by instruction-tuned models.
        messages = [
            {
                "role": "user",
                "content": (
                    "Convert this stylized dialogue into neutral, plain-English wording. "
                    "Preserve meaning. Remove slang. "
                    "Return only the neutral wording.\n\n"
                    f"Styled dialogue:\n{styled_text}"
                ),
            }
        ]

        # apply_chat_template formats the messages into the exact prompt style
        # the model was trained to follow, then add_generation_prompt tells the
        # tokenizer to append the assistant turn where generation begins.
        prompt = self.tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        inputs = self.tokenizer(
            [prompt],
            return_tensors="pt",
            truncation=True,
            max_length=1800,
        ).to("cuda")

        # Generate only the neutral answer continuation. do_sample is disabled
        # when temperature is zero so deterministic runs are possible.
        outputs = self.model.generate(
            **inputs,
            max_new_tokens=self.max_new_tokens,
            temperature=self.temperature,
            top_p=0.9,
            do_sample=self.temperature > 0,
            pad_token_id=self.tokenizer.eos_token_id,
        )

        # Remove the prompt tokens from the output so only newly generated text
        # is decoded and cleaned.
        generated = outputs[0][inputs["input_ids"].shape[-1] :]
        return clean_neutral_text(self.tokenizer.decode(generated, skip_special_tokens=True))


def create_neutralizer(args: argparse.Namespace) -> Neutralizer:
    """Instantiate the provider selected by CLI flags."""

    # Each branch returns an object with a neutralize method, which lets main()
    # run the same loop regardless of whether generation is heuristic, hosted,
    # Ollama-based, or local CUDA-based.
    if args.provider == "heuristic":
        return HeuristicNeutralizer()
    if args.provider == "openai":
        return OpenAINeutralizer(args.openai_model, args.temperature)
    if args.provider == "ollama":
        return OllamaNeutralizer(args.ollama_endpoint, args.ollama_model, args.max_new_tokens, args.temperature)
    return LocalNeutralizer(args.base_model, args.max_new_tokens, args.temperature)


def main() -> None:
    """Run the end-to-end synthetic pair generation pipeline."""

    args = parse_args()

    # If the caller does not choose a rejection file, put it next to the accepted
    # output file with ".rejected" in the name.
    rejections_output = args.rejections_output or args.output.with_name(f"{args.output.stem}.rejected.jsonl")

    # overwrite intentionally deletes previous outputs so the run starts fresh.
    # Without it, the script appends accepted/rejected records and skips accepted
    # IDs already present in the output file.
    if args.overwrite and args.output.exists():
        args.output.unlink()
    if args.overwrite and rejections_output.exists():
        rejections_output.unlink()

    skipped_ids = existing_ids(args.output)

    # Load only style_sample records because those contain unpaired style text
    # that can be converted into synthetic neutral-to-styled examples.
    source_records = [
        record
        for record in read_jsonl(args.input)
        if record.get("mode") == "style_sample" and str(record.get("output", "")).strip()
    ]

    # Limit records after filtering so --max-records means "process this many
    # usable source samples", not "read this many raw lines".
    if args.max_records:
        source_records = source_records[: args.max_records]

    neutralizer = create_neutralizer(args)
    written = 0
    skipped = 0
    for source in source_records:
        # Use the same ID convention as make_pair_record so resume-skipping and
        # writing agree on what a generated pair is called.
        pair_id = f"pair-{source.get('id', 'unknown')}"
        if pair_id in skipped_ids:
            skipped += 1
            continue

        styled_text = shorten_source_text(
            str(source["output"]).strip(),
            args.max_source_chars,
            args.max_source_sentences,
        )
        rejection_reasons: list[str] = []

        # Try the initial generation plus the configured number of retries. The
        # for/else below runs the else block only if no attempt breaks after a
        # successful write.
        for attempt in range(args.retries + 1):
            feedback = "; ".join(rejection_reasons) if rejection_reasons else None
            neutral_method = getattr(neutralizer, "neutralize")
            try:
                # Ollama supports feedback-aware retries. Other providers expose
                # the simpler Protocol shape and only receive the styled text.
                neutral_text = (
                    neutral_method(styled_text, feedback)
                    if isinstance(neutralizer, OllamaNeutralizer)
                    else neutral_method(styled_text)
                )
            except Exception as error:
                # Generation failures are treated as rejection reasons so the
                # source record can be audited in the rejection output.
                rejection_reasons = [f"neutral generation failed: {error}"]
                continue

            # Reject bad neutral inputs before spending time cleaning/judging the
            # styled output.
            neutral_issues = validate_neutral_text(neutral_text, args)
            if neutral_issues:
                rejection_reasons = neutral_issues
                continue

            # By default, the training target is the original source style chunk.
            # With --clean-style-output, providers that support it can rewrite
            # the target into a cleaner single-speaker response.
            output_text = styled_text
            if args.clean_style_output:
                cleaner = getattr(neutralizer, "clean_style_output", None)
                if not callable(cleaner):
                    raise RuntimeError("--clean-style-output is only supported by providers that implement it")
                output_text = (
                    cleaner(styled_text, neutral_text, feedback)
                    if isinstance(neutralizer, OllamaNeutralizer)
                    else cleaner(styled_text)
                )

            # Run deterministic validation first, then the optional LLM judge
            # only if the cheap checks passed.
            style_issues = validate_style_text(neutral_text, output_text, args)
            if not style_issues and args.llm_judge and isinstance(neutralizer, OllamaNeutralizer):
                style_issues = neutralizer.judge_pair(neutral_text, output_text)

            if not style_issues:
                # The pair passed all checks, so append it immediately. Appending
                # per record makes long runs resumable even if interrupted.
                append_jsonl(args.output, [make_pair_record(source, neutral_text, output_text)])
                written += 1
                print(f"wrote {written}: {pair_id}")
                break

            # Store the latest validation problems so a retry can use them as
            # feedback and the final rejection record explains the last failure.
            rejection_reasons = style_issues
        else:
            # No attempt produced an accepted pair. Write a compact rejection
            # record so bad source chunks and thresholds can be reviewed later.
            skipped += 1
            append_jsonl(
                rejections_output,
                [
                    {
                        "id": pair_id,
                        "source_record_id": source.get("id"),
                        "source_file": source.get("source_file", "synthetic"),
                        "reasons": rejection_reasons,
                        "source_text": styled_text,
                    }
                ],
            )
            print(f"rejected {pair_id}: {'; '.join(rejection_reasons)}")

    # Final summary includes both files so automation logs make it clear where
    # accepted and rejected examples were written.
    print(f"Done. wrote={written} skipped={skipped} output={args.output} rejections={rejections_output}")


if __name__ == "__main__":
    # Standard Python entry point: importing this file exposes its functions and
    # classes without running the generation job; executing it runs main().
    main()
