#!/usr/bin/env bash
# Установка зависимостей (идемпотентно). Журнал: ~/stem-setup.log
LOG="$HOME/stem-setup.log"
exec > >(tee -a "$LOG") 2>&1
cd "$(dirname "$0")/.."
echo "=== setup $(date) ==="
ok=0
if ! command -v ffmpeg > /dev/null; then
  sudo apt-get update -qq || echo "apt-get update с ошибками, продолжаю"
  sudo apt-get install -y -qq --no-install-recommends ffmpeg || ok=1
fi
if ! python -c "import torch, torchaudio" 2>/dev/null; then
  pip install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/cpu \
    || pip install --no-cache-dir torch torchaudio || ok=1
fi
pip install --no-cache-dir -r requirements.txt || ok=1
# веса основной модели заранее (если не выйдет — скачаются при первом разделении)
python -c "from demucs.pretrained import get_model; get_model('htdemucs')" || echo "веса не скачались, будут загружены позже"
[ $ok = 0 ] && touch "$HOME/.stem-setup-done" && echo "=== setup OK ===" || echo "=== setup FAILED, см. $LOG ==="
exit $ok
