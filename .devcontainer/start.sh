#!/usr/bin/env bash
# Запуск сервера в фоне (вызывается при каждом старте/пробуждении Codespace).
cd "$(dirname "$0")/.."
PIDFILE=/tmp/stem-splitter.pid
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  if curl -sf http://localhost:8000/api/options > /dev/null; then echo "Stem Splitter уже запущен"; exit 0; fi
  kill "$(cat "$PIDFILE")"; sleep 2
fi
export STEM_SPLITTER_DATA=/tmp/stem-data
nohup setsid python -m uvicorn backend.app:app --host 0.0.0.0 --port 8000 > /tmp/stem-splitter.log 2>&1 < /dev/null &
echo $! > "$PIDFILE"
for _ in $(seq 1 30); do
  curl -sf http://localhost:8000/api/options > /dev/null && { echo "Stem Splitter запущен на порту 8000"; exit 0; }
  sleep 1
done
echo "Сервер не ответил, лог: /tmp/stem-splitter.log"; tail -20 /tmp/stem-splitter.log
