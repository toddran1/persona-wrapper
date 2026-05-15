# RunPod Rebuild Notes

Use these scripts to make future pods disposable. The durable state should live
in GitHub and Hugging Face, not inside a single pod.

## Recommended Pod

```text
GPU: RTX A5000 24GB, RTX 4090 24GB, or better
Container disk: 50GB+
Volume disk: 50GB+
Template: PyTorch CUDA
SSH: enabled
```

## Fresh Pod Bootstrap

SSH into the pod, then run:

```bash
cd /workspace
git clone --branch develop https://github.com/toddran1/persona-wrapper.git
cd persona-wrapper
bash ml/style-transfer/runpod/bootstrap_pod.sh
```

This installs:

- Python training/serving dependencies
- Node workspaces
- Ollama
- `llama3.2:3b` for the app's neutral LLM
- `qwen2.5:7b` for synthetic pair generation

To use different Ollama models:

```bash
OLLAMA_MODELS_TO_PULL="llama3.2:3b qwen2.5:7b" bash ml/style-transfer/runpod/bootstrap_pod.sh
```

The 3B model is the faster default for app testing. `qwen2.5:7b` is preferred
for generating cleaner synthetic training pairs.

## Generate Pairs With Ollama

```bash
python ml/style-transfer/scripts/prepare_dataset.py
python ml/style-transfer/scripts/generate_synthetic_pairs.py \
  --provider ollama \
  --ollama-model qwen2.5:7b \
  --clean-style-output \
  --llm-judge \
  --retries 2 \
  --overwrite
python ml/style-transfer/scripts/prepare_dataset.py --pairs-only
```

`--clean-style-output` asks Ollama to turn messy multi-speaker transcript chunks
into concise single-speaker style targets. This is slower, but it avoids
training the adapter to imitate raw transcript loops.
The generator also writes rejected records to
`ml/style-transfer/datasets/processed/style_transfer.pairs.rejected.jsonl`
when outputs fail quality filters for length, repetition, transcript markers,
sentence count, rough neutral/style content overlap, or the optional LLM judge.

For a quick smoke test:

```bash
python ml/style-transfer/scripts/generate_synthetic_pairs.py \
  --provider ollama \
  --ollama-model qwen2.5:7b \
  --clean-style-output \
  --llm-judge \
  --retries 2 \
  --max-records 10 \
  --output /tmp/ollama_pairs_sample.jsonl \
  --overwrite
```

## Start Services

```bash
bash ml/style-transfer/runpod/start_app_stack.sh
```

This starts:

```text
Ollama: http://127.0.0.1:11434
Style transfer: http://127.0.0.1:8000/style-transfer
API: http://127.0.0.1:4000
```

The API uses:

```text
LOCAL_LLM_ENDPOINT=http://127.0.0.1:11434
LOCAL_LLM_MODEL=llama3.2:3b
STYLE_TRANSFER_PROVIDER=runpod
STYLE_TRANSFER_ENDPOINT=http://127.0.0.1:8000/style-transfer
STYLE_TRANSFER_MODEL_ID=toddran1/larae-style-transfer-gemma3-1b-lora-v2-pairs
```

## After Stopping Work

Before terminating a pod, make sure the important pieces are backed up:

- source code pushed to GitHub
- LoRA adapters uploaded to Hugging Face
- any generated pair JSONL you care about copied locally or uploaded

The current important adapter repos are:

```text
toddran1/larae-style-transfer-gemma3-1b-lora
toddran1/larae-style-transfer-gemma3-1b-lora-v2-pairs
```
