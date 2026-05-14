"""Serve a LoRA style-transfer adapter over HTTP.

Example:

    python3 ml/style-transfer/scripts/serve_style_transfer.py \
      --adapter toddran1/larae-style-transfer-gemma3-1b-lora \
      --host 0.0.0.0 \
      --port 8000
"""

from __future__ import annotations

import argparse
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
    parser.add_argument("--temperature", type=float, default=0.8)
    parser.add_argument("--top-p", type=float, default=0.9)
    return parser.parse_args()


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
        messages = [
            {
                "role": "user",
                "content": (
                    "Rewrite the neutral answer in the target persona style without changing facts.\n\n"
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
            do_sample=True,
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
            },
        )

    return app


def main() -> None:
    args = parse_args()
    uvicorn.run(create_app(args), host=args.host, port=args.port)


if __name__ == "__main__":
    main()
