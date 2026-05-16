"""Serve a LoRA style-transfer adapter over HTTP.

Example:

    python3 ml/style-transfer/scripts/serve_style_transfer.py \
      --adapter toddran1/larae-style-transfer-gemma3-1b-lora \
      --host 0.0.0.0 \
      --port 8000
"""

from __future__ import annotations

import argparse
import re
from typing import Any

import torch
import uvicorn
from fastapi import FastAPI
from pydantic import BaseModel, Field
from unsloth import FastLanguageModel


DEFAULT_ADAPTER = "toddran1/larae-style-transfer-gemma3-1b-lora"


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
    parser.add_argument("--max-seq-length", type=int, default=2048)
    parser.add_argument("--max-new-tokens", type=int, default=220)
    parser.add_argument("--temperature", type=float, default=0.3)
    parser.add_argument("--top-p", type=float, default=0.9)
    parser.add_argument("--repetition-penalty", type=float, default=1.18)
    parser.add_argument("--no-repeat-ngram-size", type=int, default=4)
    parser.add_argument("--do-sample", action="store_true")
    return parser.parse_args()


def extract_factual_anchors(text: str) -> list[str]:
    patterns = [
        r"\b\d{1,2}:\d{2}\s?(?:AM|PM|am|pm)?\b",
        r"\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b",
        r"\b\d{4}\b",
        r"\$[\d,]+(?:\.\d+)?",
        r"\b\d+(?:\.\d+)?\b",
        r"\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,4}\b",
    ]
    anchors: list[str] = []
    for pattern in patterns:
        for match in re.findall(pattern, text):
            value = match.strip()
            if value and value not in anchors:
                anchors.append(value)
    return anchors[:20]


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
        factual_anchors = extract_factual_anchors(request.neutralText)
        user_question = f"\nUser question:\n{request.userMessage}\n" if request.userMessage else ""
        anchors = "\n".join(f"- {anchor}" for anchor in factual_anchors)
        anchor_section = f"\nRequired factual anchors to preserve exactly:\n{anchors}\n" if anchors else ""
        messages = [
            {
                "role": "user",
                "content": (
                    "Rewrite the neutral answer in the target persona style.\n"
                    "Preserve every factual claim exactly. Keep all names, dates, years, numbers, "
                    "locations, durations, and order of events unchanged. Do not add new facts. "
                    "Do not make jokes that contradict the neutral answer. Do not imply uncertainty "
                    "when the neutral answer is certain. If the neutral answer is factual, keep the "
                    "facts intact and only change tone, rhythm, and attitude. The styled answer must "
                    "still answer the user question directly. Copy factual anchors exactly when they "
                    "appear in the neutral answer.\n"
                    f"{user_question}"
                    f"{anchor_section}\n"
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
            do_sample=args.do_sample,
            pad_token_id=tokenizer.eos_token_id,
        )
        generated = outputs[0][inputs["input_ids"].shape[-1] :]
        styled_text = tokenizer.decode(generated, skip_special_tokens=True).strip()
        return StyleTransferResponse(
            styledText=styled_text,
            metadata={
                "adapter": args.adapter,
                "personaId": request.personaId,
                "sourceProvider": request.sourceProvider,
                "temperature": args.temperature,
                "topP": args.top_p,
                "doSample": args.do_sample,
                "repetitionPenalty": args.repetition_penalty,
                "noRepeatNgramSize": args.no_repeat_ngram_size,
            },
        )

    return app


def main() -> None:
    args = parse_args()
    uvicorn.run(create_app(args), host=args.host, port=args.port)


if __name__ == "__main__":
    main()
