"""Serve a LoRA style-transfer adapter over HTTP.

Example:

    python3 ml/style-transfer/scripts/serve_style_transfer.py \
      --adapter toddran1/larae-style-transfer-qwen2p5-7b-uncensored-lora-v1-pairs \
      --host 0.0.0.0 \
      --port 8000
"""

from __future__ import annotations

import argparse
import re
from difflib import SequenceMatcher
from typing import Any

import torch
import uvicorn
from fastapi import FastAPI
from pydantic import BaseModel, Field
from unsloth import FastLanguageModel


DEFAULT_ADAPTER = "toddran1/larae-style-transfer-qwen2p5-7b-uncensored-lora-v1-pairs"
PROTECTED_NAME_PATTERN = re.compile(
    r"\b(?:[A-Z][A-Za-z0-9&'-]*|[A-Z]{2,})"
    r"(?:\s+(?:at|of|the|and|&|[A-Z][A-Za-z0-9&'-]*|[A-Z]{2,}))*"
)
PROTECTED_NAME_HINTS = {
    "museum",
    "plaza",
    "stadium",
    "park",
    "team",
    "cowboys",
    "dallas",
    "texas",
}
PROFANITY_PATTERN = re.compile(
    r"\b(?:motherfucker|motherfucking|fucking|fuck|bitch|shit|ass|hoe)\b",
    re.IGNORECASE,
)
VENUE_WORDS = {"museum", "plaza", "stadium", "park", "arena", "hall", "center", "theater", "theatre"}


class StyleTransferRequest(BaseModel):
    neutralText: str = Field(min_length=1)
    personaId: str | None = None
    userMessage: str | None = None
    conversationHistory: list[dict[str, Any]] = Field(default_factory=list)
    sourceProvider: str | None = None
    modelId: str | None = None


class StyleTransferResponse(BaseModel):
    styledText: str
    metadata: dict[str, Any]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--adapter", default=DEFAULT_ADAPTER)
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--max-seq-length", type=int, default=4096)
    parser.add_argument("--max-new-tokens", type=int, default=800)
    parser.add_argument("--temperature", type=float, default=0.2)
    parser.add_argument("--top-p", type=float, default=0.9)
    parser.add_argument("--repetition-penalty", type=float, default=1.18)
    parser.add_argument("--no-repeat-ngram-size", type=int, default=4)
    return parser.parse_args()


def should_protect_name(candidate: str) -> bool:
    words = candidate.split()
    lowered_words = {word.lower().strip(".,:;!?") for word in words}
    title_words = [word for word in words if word[:1].isupper() and word.lower() not in {"at", "of", "the", "and"}]
    if len(words) >= 2 and (lowered_words & (PROTECTED_NAME_HINTS | VENUE_WORDS)):
        return True
    if len(title_words) >= 2 and len(words) <= 4:
        return True
    lowered = candidate.lower()
    return candidate.isupper() or "&" in candidate or lowered in PROTECTED_NAME_HINTS


def extract_protected_names(text: str) -> list[str]:
    names: list[str] = []
    seen: set[str] = set()
    for match in PROTECTED_NAME_PATTERN.finditer(text):
        candidate = match.group(0).strip()
        if not candidate or not should_protect_name(candidate):
            continue
        key = candidate.lower()
        if key in seen:
            continue
        names.append(candidate)
        seen.add(key)
    return names


def protected_names_prompt(names: list[str]) -> str:
    if not names:
        return ""
    protected = "\n".join(f"- {name}" for name in names)
    return (
        "Protected names that must be copied exactly if mentioned. Do not rename, replace, "
        "paraphrase, split, or insert profanity into these names:\n"
        f"{protected}\n\n"
    )


def normalize_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def strip_profanity(value: str) -> str:
    cleaned = PROFANITY_PATTERN.sub("", value)
    return re.sub(r"\s{2,}", " ", cleaned).strip(" ,.-")


def restore_compacted_names(text: str, names: list[str]) -> str:
    restored = text
    word_span_pattern = re.compile(r"\b[A-Za-z][A-Za-z0-9&'.-]*(?:\s+[A-Za-z][A-Za-z0-9&'.-]*){0,5}\b")
    for name in sorted(names, key=len, reverse=True):
        normalized_name = normalize_name(name)
        if len(normalized_name) < 8 or re.search(re.escape(name), restored, re.IGNORECASE):
            continue

        compact_pattern = re.compile(r"\b" + r"\s*".join(re.escape(word) for word in name.split()) + r"\b", re.IGNORECASE)
        restored = compact_pattern.sub(name, restored, count=1)
        if re.search(re.escape(name), restored):
            continue

        for match in word_span_pattern.finditer(restored):
            candidate = strip_profanity(match.group(0))
            if SequenceMatcher(None, normalize_name(candidate), normalized_name).ratio() >= 0.86:
                restored = restored[: match.start()] + name + restored[match.end() :]
                break
    return restored


def restore_venue_names(text: str, names: list[str]) -> str:
    restored = text
    for name in sorted(names, key=len, reverse=True):
        words = name.split()
        if len(words) < 2:
            continue

        exact_pattern = re.compile(re.escape(name), re.IGNORECASE)
        restored = exact_pattern.sub(name, restored)
        if re.search(re.escape(name), restored):
            continue

        venue_words = [word for word in reversed(words) if word.lower() in VENUE_WORDS]
        if not venue_words:
            continue

        for venue_word in venue_words:
            pattern = re.compile(
                rf"\b{re.escape(words[0])}\b(?:\s+\S+){{0,8}}\s+\b{re.escape(venue_word)}\b",
                re.IGNORECASE,
            )
            match = pattern.search(restored)
            if not match:
                continue

            candidate = strip_profanity(match.group(0))
            if SequenceMatcher(None, normalize_name(candidate), normalize_name(name)).ratio() >= 0.45:
                restored = restored[: match.start()] + name + restored[match.end() :]
                break
    return restored


def restore_shortened_names(text: str, names: list[str]) -> str:
    restored = text
    for name in sorted(names, key=len, reverse=True):
        words = [word for word in name.split() if word.lower() not in {"at", "of", "the", "and"}]
        if len(words) < 3 or re.search(re.escape(name), restored, re.IGNORECASE):
            continue

        alias = " ".join(words[:2])
        alias_pattern = re.compile(re.escape(alias), re.IGNORECASE)
        if alias_pattern.search(restored):
            restored = alias_pattern.sub(name, restored, count=1)
    return restored


def remove_duplicate_name_suffixes(text: str, names: list[str]) -> str:
    restored = text
    for name in sorted(names, key=len, reverse=True):
        words = name.split()
        if not words:
            continue

        suffixes = [words[-1]]
        if len(words) >= 2:
            suffixes.append(" ".join(words[-2:]))

        for suffix in sorted(suffixes, key=len, reverse=True):
            pattern = re.compile(rf"({re.escape(name)})\s+{re.escape(suffix)}\b", re.IGNORECASE)
            restored = pattern.sub(name, restored)
    return restored


def restore_protected_names(text: str, names: list[str]) -> str:
    restored = restore_compacted_names(text, names)
    restored = restore_venue_names(restored, names)
    restored = restore_shortened_names(restored, names)
    return remove_duplicate_name_suffixes(restored, names)


def create_app(args: argparse.Namespace) -> FastAPI:
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=args.adapter,
        max_seq_length=args.max_seq_length,
        load_in_4bit=True,
    )
    FastLanguageModel.for_inference(model)

    app = FastAPI(title="Persona Style Transfer")

    @app.get("/health")
    def health() -> dict[str, Any]:
        return {
            "ok": True,
            "adapter": args.adapter,
            "cuda": torch.cuda.is_available(),
            "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
        }

    @app.post("/style-transfer", response_model=StyleTransferResponse)
    def style_transfer(request: StyleTransferRequest) -> StyleTransferResponse:
        protected_names = extract_protected_names(request.neutralText)
        messages = [
            {
                "role": "user",
                "content": (
                    "Rewrite the neutral answer in the target persona style.\n"
                    "Preserve every factual claim exactly. Keep all names, dates, years, numbers, "
                    "locations, durations, and order of events unchanged. Do not add new facts. "
                    "Do not make jokes that contradict the neutral answer. Do not imply uncertainty "
                    "when the neutral answer is certain. If the neutral answer is factual, keep the "
                    "facts intact and only change tone, rhythm, and attitude. Preserve the neutral "
                    "answer's structure when it is useful, including numbered lists, bullets, and "
                    "separate items. Do not rename people, venues, businesses, museums, parks, teams, "
                    "or landmarks. Do not insert profanity inside proper nouns or official names. "
                    "Do not replace listed places with other places. "
                    "The styled answer must still answer the user question directly.\n\n"
                    "Example of the required behavior:\n"
                    "Neutral: 1. Klyde Warren Park is downtown and has food trucks.\n"
                    "Styled: 1. Klyde Warren Park\n"
                    "That place is downtown with food trucks and it gets lit.\n"
                    "Bad styled answer: Klyde Motherfucker Warren Park is downtown.\n\n"
                    f"{protected_names_prompt(protected_names)}"
                    f"User question:\n{request.userMessage or ''}\n\n"
                    f"Neutral answer:\n{request.neutralText}"
                ),
            }
        ]
        prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        inputs = tokenizer(
            [prompt],
            return_tensors="pt",
            truncation=True,
            max_length=args.max_seq_length,
        ).to("cuda")
        outputs = model.generate(
            **inputs,
            max_new_tokens=args.max_new_tokens,
            temperature=args.temperature,
            top_p=args.top_p,
            repetition_penalty=args.repetition_penalty,
            no_repeat_ngram_size=args.no_repeat_ngram_size,
            do_sample=True,
            pad_token_id=tokenizer.eos_token_id,
        )
        generated = outputs[0][inputs["input_ids"].shape[-1] :]
        styled_text = tokenizer.decode(generated, skip_special_tokens=True).strip()
        styled_text = restore_protected_names(styled_text, protected_names)
        return StyleTransferResponse(
            styledText=styled_text,
            metadata={
                "adapter": args.adapter,
                "personaId": request.personaId,
                "sourceProvider": request.sourceProvider,
                "temperature": args.temperature,
                "topP": args.top_p,
                "repetitionPenalty": args.repetition_penalty,
                "noRepeatNgramSize": args.no_repeat_ngram_size,
                "protectedNameCount": len(protected_names),
            },
        )

    return app


def main() -> None:
    args = parse_args()
    uvicorn.run(create_app(args), host=args.host, port=args.port)


if __name__ == "__main__":
    main()
