#!/usr/bin/env bash
set -euo pipefail

MODELS="${OLLAMA_MODELS_TO_PULL:-${OLLAMA_MODEL:-llama3.2:3b qwen2.5:7b}}"

if ! command -v zstd >/dev/null 2>&1; then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y zstd
fi

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

for MODEL in $MODELS; do
  ollama pull "$MODEL"
done
ollama list
