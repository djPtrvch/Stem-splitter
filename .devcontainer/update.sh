#!/usr/bin/env bash
# Обновить код из GitHub и перезапустить сервер: bash .devcontainer/update.sh
cd "$(dirname "$0")/.."
git pull --ff-only || { echo "git pull не удался"; exit 1; }
pip install -q -r requirements.txt
[ -f /tmp/stem-splitter.pid ] && kill "$(cat /tmp/stem-splitter.pid)" 2>/dev/null && sleep 2
bash .devcontainer/start.sh
