# Style Transfer Training

This folder contains the style-transfer training workspace for the persona pipeline.

## Layout

```text
datasets/
  raw/          Local unpaired conversation text files. These are gitignored.
  processed/    Generated JSONL datasets for LoRA training.
scripts/
  prepare_dataset.py
  train_lora_unsloth.py
  infer_style.py
configs/
  gemma3_1b_lora.yaml
```

## Training Data Format

The canonical dataset format is JSONL. Each line is one object with both portable
fields and a `messages` array that can be consumed by chat fine-tuning tools.

Unpaired raw dialogue is converted into `style_sample` records:

```json
{
  "id": "BW-s1-3-0001",
  "mode": "style_sample",
  "source_file": "BW-s1-3.txt",
  "instruction": "Write a short response in the target persona style while preserving the same attitude, rhythm, and slang profile.",
  "input": "",
  "output": "Styled dialogue chunk here.",
  "messages": [
    {
      "role": "user",
      "content": "Write a short response in the target persona style while preserving the same attitude, rhythm, and slang profile."
    },
    {
      "role": "assistant",
      "content": "Styled dialogue chunk here."
    }
  ]
}
```

Later synthetic paired examples should use `style_transfer_pair` records:

```json
{
  "id": "synthetic-0001",
  "mode": "style_transfer_pair",
  "source_file": "synthetic",
  "instruction": "Rewrite the neutral answer in the target persona style without changing facts.",
  "input": "Neutral answer here.",
  "output": "Styled answer here.",
  "messages": [
    {
      "role": "user",
      "content": "Rewrite the neutral answer in the target persona style without changing facts.\n\nNeutral answer:\nNeutral answer here."
    },
    {
      "role": "assistant",
      "content": "Styled answer here."
    }
  ]
}
```

Run the prep script:

```bash
python3 ml/style-transfer/scripts/prepare_dataset.py
```

It writes:

```text
datasets/processed/style_transfer.train.jsonl
datasets/processed/style_transfer.eval.jsonl
datasets/processed/style_transfer.all.jsonl
datasets/processed/manifest.json
```

Raw and processed datasets are gitignored because they may contain private or
licensed source text.

## Train LoRA

Install the training dependencies in a CUDA environment:

```bash
pip install -r ml/style-transfer/requirements.txt
```

Then run:

```bash
python3 ml/style-transfer/scripts/train_lora_unsloth.py
```

To push the adapter to Hugging Face:

```bash
HF_HUB_MODEL_ID=yourname/larae-style-transfer-gemma3-1b-lora \
python3 ml/style-transfer/scripts/train_lora_unsloth.py --push-to-hub
```

The adapter output directory is gitignored:

```text
ml/style-transfer/output/larae-style-transfer-gemma3-1b-lora
```

## Current App Contract

The API sends neutral text to a style-transfer provider after the base LLM responds and before TTS runs.

Expected HTTP request body:

```json
{
  "neutralText": "Neutral answer here.",
  "personaId": "larae",
  "userMessage": "Original user prompt.",
  "conversationHistory": [],
  "sourceProvider": "openai",
  "modelId": "optional-model-id"
}
```

Expected HTTP response body:

```json
{
  "styledText": "Styled answer here.",
  "metadata": {}
}
```

## Environment Switch

Use these API env vars when a real endpoint is ready:

```text
STYLE_TRANSFER_PROVIDER=stub
STYLE_TRANSFER_ENDPOINT=
STYLE_TRANSFER_MODEL_ID=
```

Supported provider modes are `stub`, `local`, `runpod`, and `huggingface`.
