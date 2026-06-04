#!/usr/bin/env bash
set -euo pipefail

cd "${REPO_DIR:-/workspace/persona-wrapper}"

ADAPTER="${STYLE_TRANSFER_ADAPTER:-toddran1/larae-style-transfer-qwen2p5-14b-uncensored-lora-v1-pairs-newdata}"
PORT="${STYLE_TRANSFER_PORT:-8000}"
MAX_SEQ_LENGTH="${STYLE_TRANSFER_MAX_SEQ_LENGTH:-4096}"
MAX_NEW_TOKENS="${STYLE_TRANSFER_MAX_NEW_TOKENS:-800}"
TEMPERATURE="${STYLE_TRANSFER_TEMPERATURE:-0.2}"

mkdir -p ml/style-transfer/logs

pkill -f "serve_style_transfer.py" >/dev/null 2>&1 || true
nohup python ml/style-transfer/scripts/serve_style_transfer.py \
  --adapter "$ADAPTER" \
  --host 0.0.0.0 \
  --port "$PORT" \
  --max-seq-length "$MAX_SEQ_LENGTH" \
  --max-new-tokens "$MAX_NEW_TOKENS" \
  --temperature "$TEMPERATURE" \
  > ml/style-transfer/logs/style_server.log 2>&1 &

echo "style server pid=$!"
sleep 10
curl -s "http://127.0.0.1:${PORT}/health"
echo
