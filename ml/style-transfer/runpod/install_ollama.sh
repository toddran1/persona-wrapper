#!/usr/bin/env bash
set -euo pipefail

MODEL="${OLLAMA_MODEL:-llama3.2:3b}"

if ! command -v ollama >/dev/null 2>&1; then
  curl -fsSL https://ollama.com/install.sh | sh
fi

mkdir -p /workspace/ollama
export OLLAMA_MODELS="${OLLAMA_MODELS:-/workspace/ollama/models}"
export OLLAMA_HOST="${OLLAMA_HOST:-0.0.0.0:11434}"

if ! pgrep -x ollama >/dev/null 2>&1; then
  nohup ollama serve >/workspace/ollama/ollama.log 2>&1 &
  sleep 5
fi

ollama pull "$MODEL"
ollama list
