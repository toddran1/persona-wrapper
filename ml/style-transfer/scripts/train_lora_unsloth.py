"""Train a Gemma 3 style-transfer LoRA adapter with Unsloth.

Run from the repo root after preparing JSONL data:

    python3 ml/style-transfer/scripts/prepare_dataset.py
    python3 ml/style-transfer/scripts/train_lora_unsloth.py

This script is intended for a CUDA GPU environment such as RunPod. It keeps the
adapter separate from the app repo and can optionally push the adapter to the
Hugging Face Hub.
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path
from typing import Any

from unsloth import FastLanguageModel
from datasets import load_dataset
from trl import SFTConfig, SFTTrainer


ROOT = Path(__file__).resolve().parents[3]
DEFAULT_BASE_MODEL = "DavidAU/gemma-3-1b-it-heretic-extreme-uncensored-abliterated"
DEFAULT_TRAIN_PATH = ROOT / "ml/style-transfer/datasets/processed/style_transfer.train.jsonl"
DEFAULT_EVAL_PATH = ROOT / "ml/style-transfer/datasets/processed/style_transfer.eval.jsonl"
DEFAULT_OUTPUT_DIR = ROOT / "ml/style-transfer/output/larae-style-transfer-gemma3-1b-lora-v2-pairs"
DEFAULT_TARGET_MODULES = [
    "q_proj",
    "k_proj",
    "v_proj",
    "o_proj",
    "gate_proj",
    "up_proj",
    "down_proj",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-model", default=DEFAULT_BASE_MODEL)
    parser.add_argument("--train-path", type=Path, default=DEFAULT_TRAIN_PATH)
    parser.add_argument("--eval-path", type=Path, default=DEFAULT_EVAL_PATH)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--hub-model-id", default=os.getenv("HF_HUB_MODEL_ID"))
    parser.add_argument("--push-to-hub", action="store_true")
    parser.add_argument("--max-seq-length", type=int, default=2048)
    parser.add_argument("--load-in-4bit", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--epochs", type=float, default=3)
    parser.add_argument("--batch-size", type=int, default=2)
    parser.add_argument("--gradient-accumulation-steps", type=int, default=4)
    parser.add_argument("--learning-rate", type=float, default=2e-4)
    parser.add_argument("--warmup-ratio", type=float, default=0.03)
    parser.add_argument("--logging-steps", type=int, default=10)
    parser.add_argument("--eval-steps", type=int, default=50)
    parser.add_argument("--save-steps", type=int, default=100)
    parser.add_argument("--lora-r", type=int, default=16)
    parser.add_argument("--lora-alpha", type=int, default=32)
    parser.add_argument("--lora-dropout", type=float, default=0.05)
    parser.add_argument("--seed", type=int, default=3407)
    return parser.parse_args()


def format_example(example: dict[str, Any], tokenizer: Any) -> dict[str, str]:
    messages = example.get("messages")
    if isinstance(messages, list) and messages:
        text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=False)
    else:
        instruction = str(example.get("instruction", "")).strip()
        input_text = str(example.get("input", "")).strip()
        output_text = str(example.get("output", "")).strip()
        user_content = instruction
        if input_text:
            user_content = f"{instruction}\n\nNeutral answer:\n{input_text}"
        text = tokenizer.apply_chat_template(
            [
                {"role": "user", "content": user_content},
                {"role": "assistant", "content": output_text},
            ],
            tokenize=False,
            add_generation_prompt=False,
        )

    return {"text": text}


def main() -> None:
    args = parse_args()
    if not args.train_path.exists():
        raise FileNotFoundError(f"Missing train dataset: {args.train_path}")
    if not args.eval_path.exists():
        raise FileNotFoundError(f"Missing eval dataset: {args.eval_path}")

    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=args.base_model,
        max_seq_length=args.max_seq_length,
        load_in_4bit=args.load_in_4bit,
    )
    model = FastLanguageModel.get_peft_model(
        model,
        r=args.lora_r,
        target_modules=DEFAULT_TARGET_MODULES,
        lora_alpha=args.lora_alpha,
        lora_dropout=args.lora_dropout,
        bias="none",
        use_gradient_checkpointing="unsloth",
        random_state=args.seed,
    )

    dataset = load_dataset(
        "json",
        data_files={
            "train": str(args.train_path),
            "eval": str(args.eval_path),
        },
    )
    train_dataset = dataset["train"].map(lambda example: format_example(example, tokenizer))
    eval_dataset = dataset["eval"].map(lambda example: format_example(example, tokenizer))

    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=train_dataset,
        eval_dataset=eval_dataset,
        dataset_text_field="text",
        args=SFTConfig(
            output_dir=str(args.output_dir),
            max_length=args.max_seq_length,
            num_train_epochs=args.epochs,
            per_device_train_batch_size=args.batch_size,
            gradient_accumulation_steps=args.gradient_accumulation_steps,
            learning_rate=args.learning_rate,
            warmup_ratio=args.warmup_ratio,
            logging_steps=args.logging_steps,
            eval_strategy="steps",
            eval_steps=args.eval_steps,
            save_steps=args.save_steps,
            save_total_limit=3,
            report_to="none",
            seed=args.seed,
        ),
    )

    trainer.train()
    model.save_pretrained(args.output_dir)
    tokenizer.save_pretrained(args.output_dir)

    if args.push_to_hub:
        if not args.hub_model_id:
            raise ValueError("--hub-model-id or HF_HUB_MODEL_ID is required with --push-to-hub")
        model.push_to_hub(args.hub_model_id)
        tokenizer.push_to_hub(args.hub_model_id)

if __name__ == "__main__":
    main()
