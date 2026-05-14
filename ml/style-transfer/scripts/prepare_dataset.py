"""Prepare unpaired style-transfer data from raw transcript text files.

This script turns local raw `.txt` dialogue files into JSONL records that can be
used for LoRA SFT. The current data is unpaired, so each chunk becomes a
`style_sample` record. Later synthetic neutral-to-styled examples can be added
as `style_transfer_pair` records with the same schema.
"""

from __future__ import annotations

import argparse
import json
import random
import re
from pathlib import Path
from typing import Iterable


RAW_DIR = Path(__file__).resolve().parents[1] / "datasets" / "raw"
PROCESSED_DIR = Path(__file__).resolve().parents[1] / "datasets" / "processed"
DEFAULT_INSTRUCTION = (
    "Write a short response in the target persona style while preserving the "
    "same attitude, rhythm, and slang profile."
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-dir", type=Path, default=RAW_DIR)
    parser.add_argument("--processed-dir", type=Path, default=PROCESSED_DIR)
    parser.add_argument("--min-chars", type=int, default=180)
    parser.add_argument("--max-chars", type=int, default=900)
    parser.add_argument("--eval-ratio", type=float, default=0.1)
    parser.add_argument("--seed", type=int, default=3407)
    return parser.parse_args()


def normalize_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def iter_blocks(text: str) -> Iterable[str]:
    for block in re.split(r"\n\s*\n", text):
        normalized = " ".join(line.strip() for line in block.splitlines() if line.strip())
        normalized = re.sub(r"\s+", " ", normalized).strip()
        if normalized:
            yield normalized


def chunk_blocks(blocks: Iterable[str], min_chars: int, max_chars: int) -> list[str]:
    chunks: list[str] = []
    current: list[str] = []
    current_len = 0

    for block in blocks:
        separator_len = 1 if current else 0
        next_len = current_len + separator_len + len(block)
        if current and next_len > max_chars:
            chunk = " ".join(current).strip()
            if len(chunk) >= min_chars:
                chunks.append(chunk)
            current = [block]
            current_len = len(block)
            continue

        current.append(block)
        current_len = next_len

    if current:
        chunk = " ".join(current).strip()
        if len(chunk) >= min_chars:
            chunks.append(chunk)

    return chunks


def make_messages(instruction: str, input_text: str, output_text: str) -> list[dict[str, str]]:
    user_content = instruction
    if input_text:
        user_content = f"{instruction}\n\nNeutral answer:\n{input_text}"

    return [
        {"role": "user", "content": user_content},
        {"role": "assistant", "content": output_text},
    ]


def make_record(source_file: Path, index: int, output_text: str) -> dict[str, object]:
    record_id = f"{source_file.stem}-{index:04d}"
    return {
        "id": record_id,
        "mode": "style_sample",
        "source_file": source_file.name,
        "instruction": DEFAULT_INSTRUCTION,
        "input": "",
        "output": output_text,
        "messages": make_messages(DEFAULT_INSTRUCTION, "", output_text),
    }


def write_jsonl(path: Path, records: list[dict[str, object]]) -> None:
    with path.open("w", encoding="utf-8") as file:
        for record in records:
            file.write(json.dumps(record, ensure_ascii=False) + "\n")


def main() -> None:
    args = parse_args()
    args.processed_dir.mkdir(parents=True, exist_ok=True)

    records: list[dict[str, object]] = []
    file_counts: dict[str, int] = {}
    text_files = sorted(args.raw_dir.glob("*.txt"))

    for text_file in text_files:
        text = normalize_text(text_file.read_text(encoding="utf-8"))
        chunks = chunk_blocks(iter_blocks(text), args.min_chars, args.max_chars)
        file_counts[text_file.name] = len(chunks)
        records.extend(make_record(text_file, index + 1, chunk) for index, chunk in enumerate(chunks))

    random.Random(args.seed).shuffle(records)
    eval_count = max(1, round(len(records) * args.eval_ratio)) if records else 0
    eval_records = records[:eval_count]
    train_records = records[eval_count:]

    write_jsonl(args.processed_dir / "style_transfer.all.jsonl", records)
    write_jsonl(args.processed_dir / "style_transfer.train.jsonl", train_records)
    write_jsonl(args.processed_dir / "style_transfer.eval.jsonl", eval_records)

    manifest = {
        "format_version": 1,
        "mode": "unpaired_style_samples",
        "raw_dir": str(args.raw_dir),
        "processed_dir": str(args.processed_dir),
        "min_chars": args.min_chars,
        "max_chars": args.max_chars,
        "eval_ratio": args.eval_ratio,
        "seed": args.seed,
        "source_files": file_counts,
        "record_count": len(records),
        "train_count": len(train_records),
        "eval_count": len(eval_records),
    }
    (args.processed_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    print(f"Found {len(text_files)} raw text files in {args.raw_dir}")
    print(f"Wrote {len(train_records)} train records and {len(eval_records)} eval records")
    print(f"Manifest: {args.processed_dir / 'manifest.json'}")


if __name__ == "__main__":
    main()
