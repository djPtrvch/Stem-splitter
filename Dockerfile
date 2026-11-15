FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# CPU-сборка PyTorch (для GPU уберите --index-url)
RUN pip install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/cpu
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# заранее скачиваем веса основной модели
RUN python -c "from demucs.pretrained import get_model; get_model('htdemucs')"
COPY backend backend
COPY frontend frontend
ENV STEM_SPLITTER_DATA=/data
VOLUME /data
EXPOSE 8000
CMD ["uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8000"]
