# Stem Splitter

Веб-приложение для разделения трека на стемы (вокал, барабаны, бас, гитара, пианино, прочее) на базе [Demucs](https://github.com/adefossez/demucs).

- Загрузка любого аудио (mp3, wav, flac, ogg, m4a…) — drag & drop
- Модели: 4 стема, 4 стема HQ, 6 стемов, вокал/минус
- Встроенный мультитрек-плеер: синхронное воспроизведение, Mute/Solo, громкость, волновые формы, перемотка (пробел — play/pause)
- Скачивание каждого стема или всех сразу (ZIP) в **WAV, FLAC, MP3 320, OGG, M4A**

## Запуск через Docker

```bash
docker build -t stem-splitter .
docker run -p 8000:8000 -v stems-data:/data stem-splitter
```

Открыть http://localhost:8000

## Локальный запуск

Нужны Python 3.10+ и ffmpeg.

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn backend.app:app --port 8000
```

При первом разделении Demucs скачает веса модели (~80 МБ на модель). На CPU трек 4 минуты обрабатывается ~1–3 мин; с NVIDIA GPU — в разы быстрее (ставьте torch с CUDA).

## Настройки (переменные окружения)

| Переменная | По умолчанию | Описание |
|---|---|---|
| `STEM_SPLITTER_DATA` | `./data` | Папка для загрузок и стемов |
| `STEM_SPLITTER_MAX_MB` | `200` | Макс. размер файла |
| `STEM_SPLITTER_TTL_HOURS` | `24` | Через сколько часов удалять результаты |
| `STEM_SPLITTER_WORKERS` | `1` | Сколько треков обрабатывать параллельно |
| `STEM_SPLITTER_FAKE` | — | `1` — фейковое разделение фильтрами ffmpeg (для разработки без Demucs) |

## Структура

```
backend/app.py        FastAPI: загрузка, очередь задач, отдача стемов и ZIP
backend/separator.py  вызов Demucs и конвертация форматов через ffmpeg
frontend/             HTML/CSS/JS: загрузка, плеер, экспорт
```

## API

- `GET /api/options` — модели и форматы
- `POST /api/jobs` (multipart: `file`, `model`) — создать задачу
- `GET /api/jobs/{id}` — статус и прогресс
- `GET /api/jobs/{id}/stems/{stem}?format=mp3&download=true` — стем
- `GET /api/jobs/{id}/zip?format=flac` — все стемы архивом
- `DELETE /api/jobs/{id}` — удалить
