"""Generate synthetic neutral-to-styled pairs from style sample JSONL.

The paired output uses the canonical training record:

    input  = neutralized version of the styled chunk
    output = original styled chunk

Providers:
    heuristic: deterministic cleanup fallback for dry runs
    local:     uses the base model on a CUDA pod through Unsloth
    openai:    uses OpenAI when OPENAI_API_KEY is available
"""

from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path
from typing import Protocol


ROOT = Path(__file__).resolve().parents[3]
DEFAULT_INPUT = ROOT / "ml/style-transfer/datasets/processed/style_transfer.all.jsonl"
DEFAULT_OUTPUT = ROOT / "ml/style-transfer/datasets/processed/style_transfer.pairs.jsonl"
DEFAULT_BASE_MODEL = "DavidAU/gemma-3-1b-it-heretic-extreme-uncensored-abliterated"
PAIR_INSTRUCTION = "Rewrite the neutral answer in the target persona style without changing facts."


class Neutralizer(Protocol):
    def neutralize(self, styled_text: str) -> str:
        """Return a neutral version of styled_text."""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--provider", choices=["heuristic", "local", "openai"], default="local")
    parser.add_argument("--base-model", default=DEFAULT_BASE_MODEL)
    parser.add_argument("--openai-model", default="gpt-4.1-mini")
    parser.add_argument("--max-records", type=int)
    parser.add_argument("--max-new-tokens", type=int, default=220)
    parser.add_argument("--temperature", type=float, default=0.2)
    parser.add_argument("--min-input-chars", type=int, default=40)
    parser.add_argument("--overwrite", action="store_true")
    return parser.parse_args()


def read_jsonl(path: Path) -> list[dict[str, object]]:
    records: list[dict[str, object]] = []
    with path.open("r", encoding="utf-8") as file:
        for line in file:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records


def append_jsonl(path: Path, records: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as file:
        for record in records:
            file.write(json.dumps(record, ensure_ascii=False) + "\n")


def existing_ids(path: Path) -> set[str]:
    if not path.exists():
        return set()
    return {str(record.get("id")) for record in read_jsonl(path)}


def clean_neutral_text(text: str) -> str:
    text = text.strip()
    text = re.sub(r"^neutral(?: answer| version)?:\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s+", " ", text)
    return text.strip(" \"'")


def make_messages(neutral_text: str, styled_text: str) -> list[dict[str, str]]:
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


def make_pair_record(source: dict[str, object], neutral_text: str) -> dict[str, object]:
    styled_text = str(source["output"]).strip()
    record_id = f"pair-{source.get('id', 'unknown')}"
    return {
        "id": record_id,
        "mode": "style_transfer_pair",
        "source_file": source.get("source_file", "synthetic"),
        "source_record_id": source.get("id"),
        "instruction": PAIR_INSTRUCTION,
        "input": neutral_text,
        "output": styled_text,
        "messages": make_messages(neutral_text, styled_text),
    }


class HeuristicNeutralizer:
    def neutralize(self, styled_text: str) -> str:
        neutral = re.sub(r"\b(bitch|fuck|shit|ass|mother fucker|motherfucker)\b", "", styled_text, flags=re.I)
        neutral = re.sub(r"\s+", " ", neutral)
        neutral = neutral.replace(" - ", " ")
        return clean_neutral_text(neutral)


class OpenAINeutralizer:
    def __init__(self, model: str, temperature: float) -> None:
        from openai import OpenAI

        if not os.getenv("OPENAI_API_KEY"):
            raise RuntimeError("OPENAI_API_KEY is required for --provider openai")
        self.client = OpenAI()
        self.model = model
        self.temperature = temperature

    def neutralize(self, styled_text: str) -> str:
        response = self.client.responses.create(
            model=self.model,
            temperature=self.temperature,
            input=[
                {
                    "role": "system",
                    "content": (
                        "Convert stylized reality-TV dialogue into a neutral, plain-English answer. "
                        "Preserve concrete meaning and intent. Remove slang, profanity, threats, names, "
                        "and show-specific phrasing. Return only the neutral answer."
                    ),
                },
                {"role": "user", "content": styled_text},
            ],
        )
        return clean_neutral_text(response.output_text)


class LocalNeutralizer:
    def __init__(self, model_name: str, max_new_tokens: int, temperature: float) -> None:
        import torch
        from unsloth import FastLanguageModel

        self.torch = torch
        self.model, self.tokenizer = FastLanguageModel.from_pretrained(
            model_name=model_name,
            max_seq_length=2048,
            load_in_4bit=True,
        )
        FastLanguageModel.for_inference(self.model)
        self.max_new_tokens = max_new_tokens
        self.temperature = temperature

    def neutralize(self, styled_text: str) -> str:
        messages = [
            {
                "role": "user",
                "content": (
                    "Convert this stylized dialogue into neutral, plain-English wording. "
                    "Preserve meaning. Remove slang, profanity, threats, names, and show-specific references. "
                    "Return only the neutral wording.\n\n"
                    f"Styled dialogue:\n{styled_text}"
                ),
            }
        ]
        prompt = self.tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        inputs = self.tokenizer(
            [prompt],
            return_tensors="pt",
            truncation=True,
            max_length=1800,
        ).to("cuda")
        outputs = self.model.generate(
            **inputs,
            max_new_tokens=self.max_new_tokens,
            temperature=self.temperature,
            top_p=0.9,
            do_sample=self.temperature > 0,
            pad_token_id=self.tokenizer.eos_token_id,
        )
        generated = outputs[0][inputs["input_ids"].shape[-1] :]
        return clean_neutral_text(self.tokenizer.decode(generated, skip_special_tokens=True))


def create_neutralizer(args: argparse.Namespace) -> Neutralizer:
    if args.provider == "heuristic":
        return HeuristicNeutralizer()
    if args.provider == "openai":
        return OpenAINeutralizer(args.openai_model, args.temperature)
    return LocalNeutralizer(args.base_model, args.max_new_tokens, args.temperature)


def main() -> None:
    args = parse_args()
    if args.overwrite and args.output.exists():
        args.output.unlink()

    skipped_ids = existing_ids(args.output)
    source_records = [
        record
        for record in read_jsonl(args.input)
        if record.get("mode") == "style_sample" and str(record.get("output", "")).strip()
    ]
    if args.max_records:
        source_records = source_records[: args.max_records]

    neutralizer = create_neutralizer(args)
    written = 0
    skipped = 0
    for source in source_records:
        pair_id = f"pair-{source.get('id', 'unknown')}"
        if pair_id in skipped_ids:
            skipped += 1
            continue

        styled_text = str(source["output"]).strip()
        neutral_text = neutralizer.neutralize(styled_text)
        if len(neutral_text) < args.min_input_chars:
            skipped += 1
            continue

        append_jsonl(args.output, [make_pair_record(source, neutral_text)])
        written += 1
        print(f"wrote {written}: {pair_id}")

    print(f"Done. wrote={written} skipped={skipped} output={args.output}")


if __name__ == "__main__":
    main()
