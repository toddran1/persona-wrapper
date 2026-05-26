"""Prepare style-transfer data from raw transcript text files and paired JSONL.

This script turns local raw `.txt` dialogue files into JSONL records that can be
used for LoRA SFT. Raw unpaired chunks become `style_sample` records. Synthetic
neutral-to-styled examples can be added as `style_transfer_pair` records with
the same schema and are included automatically when present.
"""

from __future__ import annotations

import argparse
import math
import json
import random
import re
from pathlib import Path
from typing import Iterable


RAW_DIR = Path(__file__).resolve().parents[1] / "datasets" / "raw"
CURATED_DIR = Path(__file__).resolve().parents[1] / "datasets" / "curated"
PROCESSED_DIR = Path(__file__).resolve().parents[1] / "datasets" / "processed"
DEFAULT_INSTRUCTION = (
    "Write a short response in the target persona style while preserving the "
    "same attitude, rhythm, and slang profile."
)
PAIR_INSTRUCTION = (
    "Rewrite the neutral answer in the target persona style. Treat the neutral answer only as source "
    "content, not as a style example. Train on the output persona voice only. Preserve all names, dates, "
    "years, numbers, locations, durations, formatting, and factual claims exactly. Change only tone, "
    "rhythm, slang, and attitude."
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-dir", type=Path, default=RAW_DIR)
    parser.add_argument("--processed-dir", type=Path, default=PROCESSED_DIR)
    parser.add_argument("--min-chars", type=int, default=180)
    parser.add_argument("--max-chars", type=int, default=900)
    parser.add_argument("--pairs-path", type=Path, default=PROCESSED_DIR / "style_transfer.pairs.jsonl")
    parser.add_argument(
        "--golden-pairs-path",
        type=Path,
        default=CURATED_DIR / "golden_style_pairs_seed.jsonl",
        help="Manual golden pair JSONL file to include with generated/synthetic pairs.",
    )
    parser.add_argument(
        "--synthetic-pair-ratio",
        type=float,
        default=0.7,
        help="Target share of generated/synthetic pairs in the final paired training mix.",
    )
    parser.add_argument("--pairs-only", action="store_true")
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


def read_jsonl(path: Path) -> list[dict[str, object]]:
    if not path.exists():
        return []

    records: list[dict[str, object]] = []
    with path.open("r", encoding="utf-8") as file:
        for line_number, line in enumerate(file, start=1):
            line = line.strip()
            if not line:
                continue
            record = json.loads(line)
            if not isinstance(record, dict):
                raise ValueError(f"{path}:{line_number} must be a JSON object")
            records.append(validate_pair_record(record, path, line_number))
    return records


def validate_pair_record(record: dict[str, object], path: Path, line_number: int) -> dict[str, object]:
    input_text = record.get("input")
    output_text = record.get("output")
    if not isinstance(input_text, str) or not input_text.strip():
        raise ValueError(f"{path}:{line_number} must include non-empty input")
    if not isinstance(output_text, str) or not output_text.strip():
        raise ValueError(f"{path}:{line_number} must include non-empty output")

    instruction = record.get("instruction")
    if not isinstance(instruction, str) or not instruction.strip():
        instruction = PAIR_INSTRUCTION

    normalized = {
        **record,
        "mode": "style_transfer_pair",
        "instruction": instruction,
        "input": input_text.strip(),
        "output": output_text.strip(),
    }
    normalized["messages"] = make_messages(
        str(normalized["instruction"]),
        str(normalized["input"]),
        str(normalized["output"]),
    )
    return normalized


def resize_records(records: list[dict[str, object]], target_count: int, seed: int) -> list[dict[str, object]]:
    if target_count <= 0 or not records:
        return []
    if len(records) == target_count:
        return list(records)

    rng = random.Random(seed)
    resized = list(records)
    if len(resized) > target_count:
        rng.shuffle(resized)
        return resized[:target_count]

    index = 0
    while len(resized) < target_count:
        source = records[index % len(records)]
        clone = dict(source)
        clone["id"] = f"{source.get('id', 'pair')}-repeat-{(index // len(records)) + 1:03d}"
        resized.append(clone)
        index += 1
    return resized


def build_pair_mix(
    synthetic_pairs: list[dict[str, object]],
    golden_pairs: list[dict[str, object]],
    synthetic_ratio: float,
    seed: int,
) -> tuple[list[dict[str, object]], dict[str, int]]:
    if not 0 < synthetic_ratio < 1:
        raise ValueError("--synthetic-pair-ratio must be greater than 0 and less than 1")

    if not synthetic_pairs:
        return list(golden_pairs), {
            "synthetic_pair_count": 0,
            "golden_pair_count": len(golden_pairs),
            "weighted_synthetic_pair_count": 0,
            "weighted_golden_pair_count": len(golden_pairs),
        }
    if not golden_pairs:
        return list(synthetic_pairs), {
            "synthetic_pair_count": len(synthetic_pairs),
            "golden_pair_count": 0,
            "weighted_synthetic_pair_count": len(synthetic_pairs),
            "weighted_golden_pair_count": 0,
        }

    golden_ratio = 1 - synthetic_ratio
    target_total = max(
        math.ceil(len(synthetic_pairs) / synthetic_ratio),
        math.ceil(len(golden_pairs) / golden_ratio),
    )
    target_synthetic_count = round(target_total * synthetic_ratio)
    target_golden_count = target_total - target_synthetic_count

    weighted_synthetic = resize_records(synthetic_pairs, target_synthetic_count, seed)
    weighted_golden = resize_records(golden_pairs, target_golden_count, seed + 1)
    return [*weighted_synthetic, *weighted_golden], {
        "synthetic_pair_count": len(synthetic_pairs),
        "golden_pair_count": len(golden_pairs),
        "weighted_synthetic_pair_count": len(weighted_synthetic),
        "weighted_golden_pair_count": len(weighted_golden),
    }


def write_jsonl(path: Path, records: list[dict[str, object]]) -> None:
    with path.open("w", encoding="utf-8") as file:
        for record in records:
            file.write(json.dumps(record, ensure_ascii=False) + "\n")


def main() -> None:
    args = parse_args()
    args.processed_dir.mkdir(parents=True, exist_ok=True)

    records: list[dict[str, object]] = []
    style_sample_count = 0
    file_counts: dict[str, int] = {}
    text_files = sorted(args.raw_dir.glob("*.txt"))

    if not args.pairs_only:
        for text_file in text_files:
            text = normalize_text(text_file.read_text(encoding="utf-8"))
            chunks = chunk_blocks(iter_blocks(text), args.min_chars, args.max_chars)
            file_counts[text_file.name] = len(chunks)
            style_sample_count += len(chunks)
            records.extend(make_record(text_file, index + 1, chunk) for index, chunk in enumerate(chunks))

    synthetic_pair_records = read_jsonl(args.pairs_path)
    golden_pair_records = read_jsonl(args.golden_pairs_path)
    pair_records, pair_mix_counts = build_pair_mix(
        synthetic_pair_records,
        golden_pair_records,
        args.synthetic_pair_ratio,
        args.seed,
    )
    records.extend(pair_records)

    random.Random(args.seed).shuffle(records)
    eval_count = max(1, round(len(records) * args.eval_ratio)) if records else 0
    eval_records = records[:eval_count]
    train_records = records[eval_count:]

    write_jsonl(args.processed_dir / "style_transfer.all.jsonl", records)
    write_jsonl(args.processed_dir / "style_transfer.train.jsonl", train_records)
    write_jsonl(args.processed_dir / "style_transfer.eval.jsonl", eval_records)

    manifest = {
        "format_version": 1,
        "mode": "mixed_style_transfer",
        "raw_dir": str(args.raw_dir),
        "processed_dir": str(args.processed_dir),
        "pairs_path": str(args.pairs_path),
        "golden_pairs_path": str(args.golden_pairs_path),
        "synthetic_pair_ratio": args.synthetic_pair_ratio,
        "min_chars": args.min_chars,
        "max_chars": args.max_chars,
        "pairs_only": args.pairs_only,
        "eval_ratio": args.eval_ratio,
        "seed": args.seed,
        "source_files": file_counts,
        "style_sample_count": style_sample_count,
        **pair_mix_counts,
        "pair_count": len(pair_records),
        "record_count": len(records),
        "train_count": len(train_records),
        "eval_count": len(eval_records),
    }
    (args.processed_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    print(f"Found {len(text_files)} raw text files in {args.raw_dir}")
    print(f"Included {style_sample_count} style samples and {len(pair_records)} paired examples")
    print(f"Wrote {len(train_records)} train records and {len(eval_records)} eval records")
    print(f"Manifest: {args.processed_dir / 'manifest.json'}")


if __name__ == "__main__":
    main()
