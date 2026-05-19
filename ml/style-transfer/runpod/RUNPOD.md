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
- `hf.co/mradermacher/Qwen3-14B-Uncensored-GGUF:Q4_K_M` for LLM-curated training pair generation

To use different Ollama models:

```bash
OLLAMA_MODELS_TO_PULL="llama3.2:3b hf.co/mradermacher/Qwen3-14B-Uncensored-GGUF:Q4_K_M" \
  bash ml/style-transfer/runpod/bootstrap_pod.sh
```

The 3B model is the faster default for app testing. Qwen3 14B is the preferred
local curator for generating coherent training pairs from raw transcript files.

## Generate LLM-Curated Pairs With Ollama

```bash
python ml/style-transfer/scripts/curate_training_pairs.py \
  --ollama-model hf.co/mradermacher/Qwen3-14B-Uncensored-GGUF:Q4_K_M \
  --overwrite
python ml/style-transfer/scripts/prepare_dataset.py --pairs-only
```

`curate_training_pairs.py` reads raw transcript windows directly. It asks the
curator model to skip cut-off or incoherent fragments, extract complete moments,
write a neutral answer, write a single-speaker styled target, and preserve
meaning/facts. Rejected records are written to
`ml/style-transfer/datasets/processed/style_transfer.pairs.rejected.jsonl`
for audit.

For a quick smoke test:

```bash
python ml/style-transfer/scripts/curate_training_pairs.py \
  --ollama-model hf.co/mradermacher/Qwen3-14B-Uncensored-GGUF:Q4_K_M \
  --max-windows 2 \
  --output /tmp/qwen3_curated_pairs.jsonl \
  --rejections-output /tmp/qwen3_curated_pairs.rejected.jsonl \
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
STYLE_TRANSFER_MODEL_ID=toddran1/larae-style-transfer-qwen2p5-7b-uncensored-lora-v1-pairs
```

## Train Current Style Adapter

The current trainable style-transfer base is:

```text
Orion-zhen/Qwen2.5-7B-Instruct-Uncensored
```

Generate or refresh paired data first, then train:

```bash
python ml/style-transfer/scripts/curate_training_pairs.py \
  --ollama-model hf.co/mradermacher/Qwen3-14B-Uncensored-GGUF:Q4_K_M \
  --overwrite
python ml/style-transfer/scripts/prepare_dataset.py --pairs-only
HF_HUB_MODEL_ID=toddran1/larae-style-transfer-qwen2p5-7b-uncensored-lora-v1-pairs \
  python ml/style-transfer/scripts/train_lora_unsloth.py --push-to-hub
```

## After Stopping Work

Before terminating a pod, make sure the important pieces are backed up:

- source code pushed to GitHub
- LoRA adapters uploaded to Hugging Face
- any generated pair JSONL you care about copied locally or uploaded

The current important adapter repos are:

```text
toddran1/larae-style-transfer-qwen2p5-7b-uncensored-lora-v1-pairs
toddran1/larae-style-transfer-gemma3-1b-lora
toddran1/larae-style-transfer-gemma3-1b-lora-v2-pairs
```
