#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/toddran1/persona-wrapper.git}"
BRANCH="${BRANCH:-develop}"
REPO_DIR="${REPO_DIR:-/workspace/persona-wrapper}"
INSTALL_OLLAMA="${INSTALL_OLLAMA:-1}"
OLLAMA_MODEL="${OLLAMA_MODEL:-llama3.2:3b}"

if [ ! -d "$REPO_DIR/.git" ]; then
  git clone --branch "$BRANCH" "$REPO_URL" "$REPO_DIR"
else
  git -C "$REPO_DIR" fetch origin "$BRANCH"
  git -C "$REPO_DIR" checkout "$BRANCH"
  git -C "$REPO_DIR" pull --ff-only origin "$BRANCH"
fi

cd "$REPO_DIR"

python -m pip install --upgrade pip
pip install -r ml/style-transfer/requirements.txt
npm install

python ml/style-transfer/scripts/prepare_dataset.py

if [ "$INSTALL_OLLAMA" = "1" ]; then
  OLLAMA_MODEL="$OLLAMA_MODEL" bash ml/style-transfer/runpod/install_ollama.sh
fi

echo "Bootstrap complete."
echo "Repo: $REPO_DIR"
echo "Branch: $(git branch --show-current)"
echo "Commit: $(git log -1 --oneline)"
