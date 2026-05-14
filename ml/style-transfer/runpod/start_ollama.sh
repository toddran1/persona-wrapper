#!/usr/bin/env bash
set -euo pipefail

MODEL="${OLLAMA_MODEL:-llama3.2:3b}"
export OLLAMA_MODELS="${OLLAMA_MODELS:-/workspace/ollama/models}"
export OLLAMA_HOST="${OLLAMA_HOST:-0.0.0.0:11434}"

if ! command -v ollama >/dev/null 2>&1; then
  echo "ollama is not installed. Run ml/style-transfer/runpod/install_ollama.sh first." >&2
  exit 1
fi

mkdir -p /workspace/ollama
if ! pgrep -x ollama >/dev/null 2>&1; then
  nohup ollama serve >/workspace/ollama/ollama.log 2>&1 &
  sleep 5
fi

ollama pull "$MODEL"
curl -s http://127.0.0.1:11434/api/tags
