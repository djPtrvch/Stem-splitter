FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# CPU-сборка PyTorch (для GPU уберите --index-url)
RUN pip install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/cpu
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# веса моделей скачиваем при сборке, в общую папку (на Hugging Face контейнер работает не от root)
ENV TORCH_HOME=/app/models HF_HOME=/app/models
RUN python -c "from demucs.pretrained import get_model; get_model('htdemucs')" && chmod -R a+rwX /app/models
COPY backend backend
COPY frontend frontend
ENV STEM_SPLITTER_DATA=/tmp/stem-data PORT=7860
EXPOSE 7860
CMD uvicorn backend.app:app --host 0.0.0.0 --port ${PORT}
