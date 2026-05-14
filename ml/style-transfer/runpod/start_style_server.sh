#!/usr/bin/env bash
set -euo pipefail

cd "${REPO_DIR:-/workspace/persona-wrapper}"

ADAPTER="${STYLE_TRANSFER_ADAPTER:-toddran1/larae-style-transfer-gemma3-1b-lora-v2-pairs}"
PORT="${STYLE_TRANSFER_PORT:-8000}"
MAX_NEW_TOKENS="${STYLE_TRANSFER_MAX_NEW_TOKENS:-80}"
TEMPERATURE="${STYLE_TRANSFER_TEMPERATURE:-0.6}"

mkdir -p ml/style-transfer/logs

pkill -f "serve_style_transfer.py" >/dev/null 2>&1 || true
nohup python ml/style-transfer/scripts/serve_style_transfer.py \
  --adapter "$ADAPTER" \
  --host 0.0.0.0 \
  --port "$PORT" \
  --max-new-tokens "$MAX_NEW_TOKENS" \
  --temperature "$TEMPERATURE" \
  > ml/style-transfer/logs/style_server.log 2>&1 &

echo "style server pid=$!"
sleep 10
curl -s "http://127.0.0.1:${PORT}/health"
echo
