#!/usr/bin/env bash
set -euo pipefail

cd "${REPO_DIR:-/workspace/persona-wrapper}"

export LOCAL_LLM_ENDPOINT="${LOCAL_LLM_ENDPOINT:-http://127.0.0.1:11434}"
export LOCAL_LLM_MODEL="${LOCAL_LLM_MODEL:-llama3.2:3b}"
export STYLE_TRANSFER_PROVIDER="${STYLE_TRANSFER_PROVIDER:-runpod}"
export STYLE_TRANSFER_ENDPOINT="${STYLE_TRANSFER_ENDPOINT:-http://127.0.0.1:8000/style-transfer}"
export STYLE_TRANSFER_MODEL_ID="${STYLE_TRANSFER_MODEL_ID:-toddran1/larae-style-transfer-qwen2p5-14b-uncensored-lora-v1-pairs-newdata}"

bash ml/style-transfer/runpod/start_ollama.sh
bash ml/style-transfer/runpod/start_style_server.sh

npm run build -w @persona/shared

mkdir -p apps/api/logs
nohup npm run dev:api > apps/api/logs/runpod-api.log 2>&1 &
echo "api pid=$!"
sleep 5
curl -s http://127.0.0.1:4000/api/personas >/dev/null
echo "API is running on http://127.0.0.1:4000"
