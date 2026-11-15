---
title: Stem Splitter
emoji: 🎚️
colorFrom: indigo
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
---

# Stem Splitter

Веб-приложение для разделения трека на стемы (вокал, барабаны, бас, гитара, пианино, прочее) на базе [Demucs](https://github.com/adefossez/demucs).

- Загрузка любого аудио (mp3, wav, flac, ogg, m4a…) **или видео** (mp4, mov, mkv, webm, avi…) — drag & drop
- Модели: 4 стема, 4 стема HQ, 6 стемов, вокал/минус, а также режим **«только извлечь звук»** (без разделения, мгновенно)
- Кнопка «Скачать исходный звук» — вся звуковая дорожка в выбранном формате
- Встроенный мультитрек-плеер: синхронное воспроизведение, Mute/Solo, громкость, волновые формы, перемотка (пробел — play/pause)
- Для видео: превью синхронно с плеером и экспорт **MP4 со звуком из выбранных стемов** (учитывает Mute/Solo и громкость; например, видео без вокала)
- Скачивание каждого стема или всех сразу (ZIP) в **WAV, FLAC, MP3 320, OGG, M4A**

## Запуск через Docker

```bash
docker build -t stem-splitter .
docker run -p 8000:8000 -e PORT=8000 stem-splitter
```

Открыть http://localhost:8000

## Публикация на Hugging Face Spaces (бесплатно, можно с iPad)

1. Создать Space на huggingface.co → New Space → SDK: **Docker**, Blank.
2. Создать токен: Settings → Access Tokens → New token (тип **Write**).
3. В GitHub-репозитории: Settings → Secrets and variables → Actions:
   - Secrets → `HF_TOKEN` = токен;
   - Variables → `HF_SPACE` = `ваш_логин/имя_space`.
4. Actions → Deploy to Hugging Face → Re-run (или любой push). Сборка ~10 мин, ссылка: `https://huggingface.co/spaces/ваш_логин/имя_space`.

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
| `STEM_SPLITTER_MAX_MB` | `1024` | Макс. размер файла, МБ |
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
- `GET /api/jobs/{id}/video?stems=drums,bass&volumes=1,0.8` — MP4 с миксом стемов (только для видео)
- `GET /api/jobs/{id}/audio?format=mp3` — исходная звуковая дорожка целиком
- `GET /api/jobs/{id}/source` — исходный файл
- `DELETE /api/jobs/{id}` — удалить
