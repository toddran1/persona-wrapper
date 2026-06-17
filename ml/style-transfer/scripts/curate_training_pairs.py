"""Create style-transfer training pairs directly from raw transcript files with an LLM.

This is the preferred replacement for the older mechanical chunk -> pair flow.
It reads raw transcript text, asks a stronger local model to extract coherent
complete moments, and writes canonical style_transfer_pair JSONL records:

    input  = neutral answer
    output = single-speaker styled answer

The script is designed for a RunPod/Ollama setup using a Qwen3 14B GGUF model:

    ollama run hf.co/mradermacher/Qwen3-14B-Uncensored-GGUF:Q4_K_M

Then:

    python ml/style-transfer/scripts/curate_training_pairs.py --overwrite
    python ml/style-transfer/scripts/prepare_dataset.py --pairs-only
"""

from __future__ import annotations

import argparse
import difflib
import json
import os
import re
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[3]
RAW_DIR = ROOT / "ml/style-transfer/datasets/raw"
PROCESSED_DIR = ROOT / "ml/style-transfer/datasets/processed"
DEFAULT_OUTPUT = PROCESSED_DIR / "style_transfer.pairs.jsonl"
DEFAULT_REJECTIONS_OUTPUT = PROCESSED_DIR / "style_transfer.pairs.rejected.jsonl"
DEFAULT_OLLAMA_ENDPOINT = "http://127.0.0.1:11434"
DEFAULT_OLLAMA_MODEL = "hf.co/mradermacher/Qwen3-14B-Uncensored-GGUF:Q4_K_M"

PAIR_INSTRUCTION = (
    "Rewrite the neutral answer in the target persona style. Treat the neutral answer only as source "
    "content, not as a style example. Train on the output persona voice only. Preserve all names, dates, "
    "years, numbers, locations, durations, formatting, and factual claims exactly. Preserve markdown "
    "links, URLs, citation text, quoted text, code, and source metadata exactly when present. Do not "
    "invent markdown links, URLs, citations, sources, or source-like metadata when the input does not "
    "contain them. Dates, years, numbers, URLs, citations, official names, and quoted text are not style "
    "targets. Preserve proper nouns and named entities exactly, including people, places, characters, "
    "brands, teams, organizations, titles, books, songs, albums, products, and user-selected options. "
    "Do not substitute a different entity or option. Change only tone, rhythm, slang, and attitude. "
    "Preserve the gender, title, role, and type of every person, group, place, brand, team, and object. "
    "Do not call men women, women men, teams people, places people, or objects people unless the input does."
)

BAD_PATTERNS = [
    re.compile(pattern, flags=re.IGNORECASE)
    for pattern in [
        r"\b(transcript|speaker|stage direction|neutral answer|styled answer)\b",
        r"\bas an ai\b",
        r"\bi cannot\b",
        r"\bi can't assist\b",
        r"\bget the message across\b",
    ]
]
SPEAKER_LABEL_PATTERN = re.compile(r"(^|\s)(?:speaker|person|woman|man|host|producer|narrator)\s*\d*\s*:", re.I)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-dir", type=Path, default=RAW_DIR)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--rejections-output", type=Path, default=DEFAULT_REJECTIONS_OUTPUT)
    parser.add_argument("--ollama-endpoint", default=os.getenv("OLLAMA_ENDPOINT", DEFAULT_OLLAMA_ENDPOINT))
    parser.add_argument("--ollama-model", default=os.getenv("OLLAMA_MODEL", DEFAULT_OLLAMA_MODEL))
    parser.add_argument("--max-window-chars", type=int, default=7000)
    parser.add_argument("--overlap-chars", type=int, default=800)
    parser.add_argument("--max-records-per-window", type=int, default=4)
    parser.add_argument("--max-files", type=int)
    parser.add_argument("--max-windows", type=int)
    parser.add_argument("--min-neutral-chars", type=int, default=35)
    parser.add_argument("--min-styled-chars", type=int, default=45)
    parser.add_argument("--max-styled-chars", type=int, default=700)
    parser.add_argument("--temperature", type=float, default=0.15)
    parser.add_argument("--max-new-tokens", type=int, default=1800)
    parser.add_argument("--num-ctx", type=int, default=16384)
    parser.add_argument("--judge", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--overwrite", action="store_true")
    return parser.parse_args()


def normalize_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def split_oversized_block(block: str, max_chars: int) -> list[str]:
    if len(block) <= max_chars:
        return [block]

    sentences = [part.strip() for part in re.split(r"(?<=[.!?])\s+", block) if part.strip()]
    if len(sentences) <= 1:
        return [block[index : index + max_chars].strip() for index in range(0, len(block), max_chars) if block[index : index + max_chars].strip()]

    chunks: list[str] = []
    current: list[str] = []
    current_len = 0
    for sentence in sentences:
        next_len = current_len + len(sentence) + (1 if current else 0)
        if current and next_len > max_chars:
            chunks.append(" ".join(current).strip())
            current = [sentence]
            current_len = len(sentence)
        else:
            current.append(sentence)
            current_len = next_len

    if current:
        chunks.append(" ".join(current).strip())
    return chunks


def split_windows(text: str, max_chars: int, overlap_chars: int) -> list[str]:
    """Split text into large paragraph-aware windows for LLM curation."""

    blocks = [
        chunk
        for block in re.split(r"\n\s*\n", text)
        if block.strip()
        for chunk in split_oversized_block(block.strip(), max_chars)
    ]
    windows: list[str] = []
    current: list[str] = []
    current_len = 0

    for block in blocks:
        next_len = current_len + len(block) + (2 if current else 0)
        if current and next_len > max_chars:
            window = "\n\n".join(current).strip()
            windows.append(window)

            overlap: list[str] = []
            overlap_len = 0
            for previous in reversed(current):
                if overlap_len + len(previous) > overlap_chars:
                    break
                overlap.insert(0, previous)
                overlap_len += len(previous) + 2
            current = [*overlap, block]
            current_len = sum(len(item) + 2 for item in current)
        else:
            current.append(block)
            current_len = next_len

    if current:
        windows.append("\n\n".join(current).strip())
    return windows


def append_jsonl(path: Path, records: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as file:
        for record in records:
            file.write(json.dumps(record, ensure_ascii=False) + "\n")


def read_existing_ids(path: Path) -> set[str]:
    if not path.exists():
        return set()

    ids: set[str] = set()
    with path.open("r", encoding="utf-8") as file:
        for line in file:
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            record_id = record.get("id") if isinstance(record, dict) else None
            if isinstance(record_id, str):
                ids.add(record_id)
    return ids


def make_messages(neutral_text: str, styled_text: str) -> list[dict[str, str]]:
    return [
        {"role": "user", "content": f"{PAIR_INSTRUCTION}\n\nNeutral answer:\n{neutral_text}"},
        {"role": "assistant", "content": styled_text},
    ]


class OllamaClient:
    def __init__(self, endpoint: str, model: str, temperature: float, max_new_tokens: int, num_ctx: int) -> None:
        self.endpoint = endpoint.rstrip("/")
        self.model = model
        self.temperature = temperature
        self.max_new_tokens = max_new_tokens
        self.num_ctx = num_ctx

    def chat(self, messages: list[dict[str, str]], *, temperature: float | None = None, max_new_tokens: int | None = None) -> str:
        payload = {
            "model": self.model,
            "stream": False,
            "think": False,
            "messages": messages,
            "options": {
                "temperature": self.temperature if temperature is None else temperature,
                "top_p": 0.85,
                "num_predict": self.max_new_tokens if max_new_tokens is None else max_new_tokens,
                "num_ctx": self.num_ctx,
                "repeat_penalty": 1.12,
            },
        }
        request = urllib.request.Request(
            f"{self.endpoint}/api/chat",
            data=json.dumps(payload).encode("utf-8"),
            headers={"content-type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=240) as response:
                data = json.loads(response.read().decode("utf-8"))
        except urllib.error.URLError as error:
            raise RuntimeError(f"Ollama request failed: {error}") from error

        message = data.get("message", {})
        content = message.get("content") if isinstance(message, dict) else ""
        if (not isinstance(content, str) or not content.strip()) and isinstance(data.get("response"), str):
            content = data["response"]
        if not isinstance(content, str) or not content.strip():
            raise RuntimeError("Ollama returned an empty chat response")
        return content.strip()


def extract_json_object(text: str) -> dict[str, Any]:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?", "", text).strip()
        text = re.sub(r"```$", "", text).strip()
    match = re.search(r"\{.*\}", text, flags=re.DOTALL)
    if not match:
        raise ValueError("response did not contain a JSON object")
    return json.loads(match.group(0))


def clean_text(text: object) -> str:
    if not isinstance(text, str):
        return ""
    text = re.sub(r"```(?:text|json)?|```", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip(" \"'")


def normalized_similarity(left: str, right: str) -> float:
    left_norm = re.sub(r"[^a-z0-9]+", " ", left.lower()).strip()
    right_norm = re.sub(r"[^a-z0-9]+", " ", right.lower()).strip()
    if not left_norm or not right_norm:
        return 0.0
    return difflib.SequenceMatcher(None, left_norm, right_norm).ratio()


def style_pair_prompt(source_file: str, window_index: int, window_text: str, max_records: int) -> list[dict[str, str]]:
    system = (
        "You curate high-quality training data for a text style-transfer model. "
        "/no_think "
        "You must reason about the transcript silently and output only valid JSON. "
        "Prefer fewer excellent examples over many weak examples."
    )
    user = (
        "From the transcript window below, create coherent complete training pairs.\n\n"
        "The transcript is the style source. For each record, first extract one complete styled thought, "
        "clean it into a single-speaker persona response, then write a neutral plain-English version of "
        "that same thought.\n\n"
        "Rules:\n"
        "- Only use moments that are understandable without missing prior/next context.\n"
        "- Skip cut-off fragments, partial thoughts, duplicate loops, production notes, speaker labels, and unclear arguments.\n"
        "- Each neutral answer must be plain English, semantically clear, and less slang-heavy than the source.\n"
        "- Each styled answer must sound like the transcript style: blunt, conversational, slang-aware, and human.\n"
        "- The styled answer must not be formal, generic, or identical/nearly identical to the neutral answer.\n"
        "- Treat the neutral answer only as source content, not as a style example.\n"
        "- The styled answer must preserve the neutral answer's facts, requested task, and useful structure.\n"
        "- Do not add new people, dates, numbers, places, motives, threats, or events.\n"
        "- Keep all names, dates, years, numbers, locations, durations, and factual claims exactly when present.\n"
        "- Preserve proper nouns and named entities exactly, including people, places, characters, brands, teams, organizations, titles, books, songs, albums, products, and user-selected options.\n"
        "- Do not substitute a different entity or option.\n"
        "- Preserve the gender, title, role, and type of every person, group, place, brand, team, and object.\n"
        "- Do not call men women, women men, teams people, places people, or objects people unless the source does.\n"
        "- Do not roleplay as a transcript participant. Speak as the persona commenting/responding.\n"
        "- Output at most "
        f"{max_records} records.\n\n"
        "Return only JSON with this schema:\n"
        "{\n"
        "  \"records\": [\n"
        "    {\n"
        "      \"source_excerpt\": \"short complete excerpt used as evidence\",\n"
        "      \"neutral\": \"plain source-content answer\",\n"
        "      \"styled\": \"single-speaker target persona answer using the same source content\",\n"
        "      \"quality_notes\": \"brief reason this is coherent\"\n"
        "    }\n"
        "  ]\n"
        "}\n\n"
        f"Source file: {source_file}\n"
        f"Window: {window_index}\n\n"
        f"Transcript window:\n{window_text}"
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def validate_pair(record: dict[str, Any], args: argparse.Namespace) -> list[str]:
    neutral = clean_text(record.get("neutral"))
    styled = clean_text(record.get("styled"))
    excerpt = clean_text(record.get("source_excerpt"))
    issues: list[str] = []

    if len(neutral) < args.min_neutral_chars:
        issues.append("neutral text is too short")
    if len(styled) < args.min_styled_chars:
        issues.append("styled text is too short")
    if len(styled) > args.max_styled_chars:
        issues.append("styled text is too long")
    if not excerpt:
        issues.append("missing source excerpt")
    if SPEAKER_LABEL_PATTERN.search(neutral) or SPEAKER_LABEL_PATTERN.search(styled):
        issues.append("contains speaker labels")
    if any(pattern.search(neutral) or pattern.search(styled) for pattern in BAD_PATTERNS):
        issues.append("contains meta text")
    if not re.search(r"[.!?]$", styled):
        issues.append("styled text appears unfinished")
    if neutral and styled and normalized_similarity(neutral, styled) > 0.88:
        issues.append("styled text is too similar to neutral text")
    return issues


def judge_pair(client: OllamaClient, neutral: str, styled: str) -> list[str]:
    content = client.chat(
        [
            {
                "role": "system",
                "content": (
                    "You are a strict judge for style-transfer training data. Output only JSON. "
                    "/no_think "
                    "Reject if the styled answer changes the source facts, requested task, names/dates/numbers, adds facts, "
                    "changes gender/title/entity type, is incoherent, is cut off, is formal/generic, is nearly identical to the neutral answer, "
                    "or roleplays as a transcript participant. Do not reject merely because the style is "
                    "slang-heavy or blunt."
                ),
            },
            {
                "role": "user",
                "content": (
                    "Return JSON as {\"pass\": boolean, \"reasons\": [\"short reason\"]}.\n\n"
                    f"Neutral answer:\n{neutral}\n\nStyled answer:\n{styled}"
                ),
            },
        ],
        temperature=0,
        max_new_tokens=180,
    )
    try:
        parsed = extract_json_object(content)
    except Exception:
        return ["judge returned invalid json"]
    if parsed.get("pass") is True:
        return []
    reasons = parsed.get("reasons")
    if isinstance(reasons, list) and reasons:
        return [str(reason) for reason in reasons if str(reason).strip()]
    return ["judge rejected pair"]


def make_pair_record(
    *,
    source_file: str,
    window_index: int,
    record_index: int,
    source_excerpt: str,
    neutral: str,
    styled: str,
    quality_notes: str,
    judge_enabled: bool,
) -> dict[str, Any]:
    record_id = f"llm-pair-{Path(source_file).stem}-{window_index:04d}-{record_index:02d}"
    return {
        "id": record_id,
        "mode": "style_transfer_pair",
        "source_file": source_file,
        "source_record_id": f"{Path(source_file).stem}-window-{window_index:04d}",
        "source_excerpt": source_excerpt,
        "quality_notes": quality_notes,
        "judge_enabled": judge_enabled,
        "instruction": PAIR_INSTRUCTION,
        "input": neutral,
        "output": styled,
        "messages": make_messages(neutral, styled),
    }


def main() -> None:
    args = parse_args()
    if args.overwrite:
        for path in [args.output, args.rejections_output]:
            if path.exists():
                path.unlink()

    client = OllamaClient(
        endpoint=args.ollama_endpoint,
        model=args.ollama_model,
        temperature=args.temperature,
        max_new_tokens=args.max_new_tokens,
        num_ctx=args.num_ctx,
    )

    text_files = sorted(args.raw_dir.glob("*.txt"))
    if args.max_files:
        text_files = text_files[: args.max_files]

    accepted = 0
    rejected = 0
    processed_windows = 0
    existing_ids = read_existing_ids(args.output)

    for text_file in text_files:
        text = normalize_text(text_file.read_text(encoding="utf-8"))
        windows = split_windows(text, args.max_window_chars, args.overlap_chars)
        for window_index, window_text in enumerate(windows, start=1):
            if args.max_windows and processed_windows >= args.max_windows:
                print(f"Done. accepted={accepted} rejected={rejected}")
                return
            processed_windows += 1

            try:
                response = client.chat(style_pair_prompt(text_file.name, window_index, window_text, args.max_records_per_window))
                parsed = extract_json_object(response)
            except Exception as error:
                rejected += 1
                append_jsonl(
                    args.rejections_output,
                    [
                        {
                            "id": f"window-{text_file.stem}-{window_index:04d}",
                            "source_file": text_file.name,
                            "window_index": window_index,
                            "reasons": [f"curation failed: {error}"],
                        }
                    ],
                )
                print(f"rejected window {text_file.name}:{window_index}: {error}")
                continue

            raw_records = parsed.get("records")
            if not isinstance(raw_records, list):
                raw_records = []

            for record_index, raw_record in enumerate(raw_records, start=1):
                if not isinstance(raw_record, dict):
                    continue
                record_id = f"llm-pair-{text_file.stem}-{window_index:04d}-{record_index:02d}"
                if record_id in existing_ids:
                    continue

                neutral = clean_text(raw_record.get("neutral"))
                styled = clean_text(raw_record.get("styled"))
                source_excerpt = clean_text(raw_record.get("source_excerpt"))
                quality_notes = clean_text(raw_record.get("quality_notes"))

                issues = validate_pair(raw_record, args)
                if not issues and args.judge:
                    issues = judge_pair(client, neutral, styled)

                if issues:
                    rejected += 1
                    append_jsonl(
                        args.rejections_output,
                        [
                            {
                                "id": record_id,
                                "source_file": text_file.name,
                                "window_index": window_index,
                                "reasons": issues,
                                "neutral": neutral,
                                "styled": styled,
                                "source_excerpt": source_excerpt,
                            }
                        ],
                    )
                    continue

                append_jsonl(
                    args.output,
                    [
                        make_pair_record(
                            source_file=text_file.name,
                            window_index=window_index,
                            record_index=record_index,
                            source_excerpt=source_excerpt,
                            neutral=neutral,
                            styled=styled,
                            quality_notes=quality_notes,
                            judge_enabled=args.judge,
                        )
                    ],
                )
                accepted += 1
                existing_ids.add(record_id)
                print(f"accepted {accepted}: {text_file.name} window={window_index} record={record_index}")

            # Small pause keeps local HTTP servers responsive during long runs.
            time.sleep(0.1)

    print(f"Done. accepted={accepted} rejected={rejected} output={args.output}")


if __name__ == "__main__":
    main()
