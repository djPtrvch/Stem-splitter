#!/usr/bin/env bash
# Однократная установка зависимостей при создании Codespace.
set -euo pipefail
sudo apt-get update -qq
sudo apt-get install -y -qq --no-install-recommends ffmpeg
pip install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/cpu
pip install --no-cache-dir -r requirements.txt
# скачиваем веса основной модели заранее, чтобы первое разделение не ждало
python -c "from demucs.pretrained import get_model; get_model('htdemucs')"
