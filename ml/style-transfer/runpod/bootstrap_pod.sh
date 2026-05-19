#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/toddran1/persona-wrapper.git}"
BRANCH="${BRANCH:-develop}"
REPO_DIR="${REPO_DIR:-/workspace/persona-wrapper}"
INSTALL_OLLAMA="${INSTALL_OLLAMA:-1}"
OLLAMA_MODELS_TO_PULL="${OLLAMA_MODELS_TO_PULL:-llama3.2:3b hf.co/mradermacher/Qwen3-14B-Uncensored-GGUF:Q4_K_M}"

if [ ! -d "$REPO_DIR/.git" ]; then
  git clone --branch "$BRANCH" "$REPO_URL" "$REPO_DIR"
else
  git -C "$REPO_DIR" fetch origin "$BRANCH"
  git -C "$REPO_DIR" checkout "$BRANCH"
  git -C "$REPO_DIR" pull --ff-only origin "$BRANCH"
fi

cd "$REPO_DIR"

if ! command -v node >/dev/null 2>&1 || ! node --version | grep -Eq '^v2[0-9]\.'; then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl gnupg
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
fi

python -m pip install --upgrade pip
pip install -r ml/style-transfer/requirements.txt
npm install
npm run build -w @persona/shared

python ml/style-transfer/scripts/prepare_dataset.py

if [ "$INSTALL_OLLAMA" = "1" ]; then
  OLLAMA_MODELS_TO_PULL="$OLLAMA_MODELS_TO_PULL" bash ml/style-transfer/runpod/install_ollama.sh
fi

echo "Bootstrap complete."
echo "Repo: $REPO_DIR"
echo "Branch: $(git branch --show-current)"
echo "Commit: $(git log -1 --oneline)"
