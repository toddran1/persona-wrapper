# Style Transfer Training

This folder contains the style-transfer training workspace for the persona pipeline.

## Layout

```text
datasets/
  raw/          Local unpaired conversation text files. These are gitignored.
  processed/    Generated JSONL datasets for LoRA training.
scripts/
  prepare_dataset.py
  curate_training_pairs.py
  train_lora_unsloth.py
  infer_style.py
configs/
  gemma3_1b_lora.yaml
  qwen2p5_7b_uncensored_lora_v1_pairs.yaml
```

## Training Data Format

The canonical dataset format is JSONL. Each line is one object with both portable
fields and a `messages` array that can be consumed by chat fine-tuning tools.

The older mechanical prep path can convert raw dialogue into `style_sample`
records:

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

The preferred training examples are `style_transfer_pair` records:

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

## Generate LLM-Curated Pairs

The preferred pipeline uses a stronger local LLM to read raw transcript windows,
skip broken/cut-off fragments, and create coherent neutral-to-styled pairs
directly. Current default curator model:

```text
hf.co/mradermacher/Qwen3-14B-Uncensored-GGUF:Q4_K_M
```

On a RunPod, bootstrap pulls this model automatically. To install it manually:

```bash
ollama pull hf.co/mradermacher/Qwen3-14B-Uncensored-GGUF:Q4_K_M
```

Generate curated pairs:

```bash
python3 ml/style-transfer/scripts/curate_training_pairs.py \
  --ollama-model hf.co/mradermacher/Qwen3-14B-Uncensored-GGUF:Q4_K_M \
  --overwrite
```

For a quick smoke test:

```bash
python3 ml/style-transfer/scripts/curate_training_pairs.py \
  --ollama-model hf.co/mradermacher/Qwen3-14B-Uncensored-GGUF:Q4_K_M \
  --max-windows 2 \
  --output /tmp/qwen3_curated_pairs.jsonl \
  --rejections-output /tmp/qwen3_curated_pairs.rejected.jsonl \
  --overwrite
```

The curator is instructed to:

- skip partial, duplicated, or incoherent transcript windows
- extract complete understandable moments
- write clear neutral answers
- write single-speaker styled targets
- preserve meaning, names, dates, numbers, locations, and facts
- reject bad pairs with an optional LLM judge

Accepted pairs are written to:

```text
datasets/processed/style_transfer.pairs.jsonl
```

Rejected audit records are written to:

```text
datasets/processed/style_transfer.pairs.rejected.jsonl
```

Prepare final train/eval splits from paired examples:

```bash
python3 ml/style-transfer/scripts/prepare_dataset.py --pairs-only
```

This writes:

```text
datasets/processed/style_transfer.train.jsonl
datasets/processed/style_transfer.eval.jsonl
datasets/processed/style_transfer.all.jsonl
datasets/processed/manifest.json
```

Raw and processed datasets are gitignored because they may contain private or
licensed source text.

## Legacy Synthetic Pair Flow

The previous chunk-based flow is still available for quick experiments, but it
is not the preferred path because mechanical chunks can cut through incomplete
dialogue:

```bash
python3 ml/style-transfer/scripts/prepare_dataset.py
python3 ml/style-transfer/scripts/generate_synthetic_pairs.py \
  --provider ollama \
  --ollama-model qwen2.5:7b \
  --clean-style-output \
  --llm-judge \
  --overwrite
python3 ml/style-transfer/scripts/prepare_dataset.py --pairs-only
```

## Train LoRA

Install the training dependencies in a CUDA environment:

```bash
pip install -r ml/style-transfer/requirements.txt
```

Then run:

```bash
python3 ml/style-transfer/scripts/train_lora_unsloth.py
```

The current default trainable base model is:

```text
Orion-zhen/Qwen2.5-7B-Instruct-Uncensored
```

It is a Safetensors/BF16 Qwen2.5 instruct fine-tune, so it can be used as a
Transformers/Unsloth LoRA base. The model card lists its license as GPL-3.0.

To push the adapter to Hugging Face:

```bash
HF_HUB_MODEL_ID=yourname/larae-style-transfer-qwen2p5-7b-uncensored-lora-v1-pairs \
python3 ml/style-transfer/scripts/train_lora_unsloth.py --push-to-hub
```

The adapter output directory is gitignored:

```text
ml/style-transfer/output/larae-style-transfer-qwen2p5-7b-uncensored-lora-v1-pairs
```

Older Gemma adapter output folders may still exist from previous experiments:

```text
ml/style-transfer/output/larae-style-transfer-gemma3-1b-lora
ml/style-transfer/output/larae-style-transfer-gemma3-1b-lora-v2-pairs
```

## Serve Style Transfer

After training or uploading an adapter, serve it over HTTP:

```bash
python3 ml/style-transfer/scripts/serve_style_transfer.py \
  --adapter toddran1/larae-style-transfer-qwen2p5-7b-uncensored-lora-v1-pairs \
  --host 0.0.0.0 \
  --port 8000
```

The app expects:

```text
POST /style-transfer
```

with the same request/response body described below.

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
