"""Веб-API стем-сплиттера."""
import io
import os
import re
import shutil
import subprocess
import threading
import time
import uuid
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .separator import FORMATS, MODELS, convert, separate

ROOT = Path(__file__).resolve().parent.parent
DATA = Path(os.environ.get("STEM_SPLITTER_DATA", ROOT / "data"))
MAX_MB = int(os.environ.get("STEM_SPLITTER_MAX_MB", "200"))
TTL = int(os.environ.get("STEM_SPLITTER_TTL_HOURS", "24")) * 3600
DATA.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Stem Splitter")
executor = ThreadPoolExecutor(max_workers=int(os.environ.get("STEM_SPLITTER_WORKERS", "1")))
jobs: dict[str, dict] = {}
lock = threading.Lock()


def _safe_name(name: str) -> str:
    base = Path(name or "track").stem
    return re.sub(r"[^\w\-. ]+", "_", base).strip() or "track"


def _job(job_id: str) -> dict:
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Задача не найдена")
    return job


def _run(job_id: str):
    job = jobs[job_id]
    jdir = DATA / job_id
    try:
        job["status"] = "processing"
        src = jdir / "input.wav"
        # приводим любой входной формат к WAV 44.1 кГц стерео
        r = subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(jdir / job["upload"]),
                            "-ar", "44100", "-ac", "2", str(src)], capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError("Не удалось прочитать аудиофайл: " + r.stderr.strip()[-300:])

        def progress(p):
            job["progress"] = round(p, 1)

        stems = separate(src, jdir / "stems", job["model"], progress)
        order = MODELS[job["model"]]["stems"]
        job["stems"] = sorted(stems, key=lambda s: order.index(s) if s in order else 99)
        job["progress"] = 100
        job["status"] = "done"
    except Exception as e:  # noqa: BLE001
        job["status"] = "error"
        job["error"] = str(e)


def _cleanup_loop():
    while True:
        now = time.time()
        for job_id, job in list(jobs.items()):
            if now - job["created"] > TTL and job["status"] in ("done", "error"):
                shutil.rmtree(DATA / job_id, ignore_errors=True)
                jobs.pop(job_id, None)
        time.sleep(600)


threading.Thread(target=_cleanup_loop, daemon=True).start()


@app.get("/api/options")
def options():
    return {"models": {k: v["label"] for k, v in MODELS.items()}, "formats": list(FORMATS), "max_mb": MAX_MB}


@app.post("/api/jobs")
async def create_job(file: UploadFile = File(...), model: str = Form("htdemucs")):
    if model not in MODELS:
        raise HTTPException(400, "Неизвестная модель")
    job_id = uuid.uuid4().hex
    jdir = DATA / job_id
    jdir.mkdir(parents=True)
    upload = "upload" + Path(file.filename or "").suffix.lower()[:10]
    size = 0
    with open(jdir / upload, "wb") as f:
        while chunk := await file.read(1 << 20):
            size += len(chunk)
            if size > MAX_MB << 20:
                f.close()
                shutil.rmtree(jdir, ignore_errors=True)
                raise HTTPException(413, f"Файл больше {MAX_MB} МБ")
            f.write(chunk)
    jobs[job_id] = {"id": job_id, "name": _safe_name(file.filename), "model": model, "upload": upload,
                    "status": "queued", "progress": 0, "stems": [], "error": None, "created": time.time()}
    executor.submit(_run, job_id)
    return _public(jobs[job_id])


def _public(job: dict) -> dict:
    return {k: job[k] for k in ("id", "name", "model", "status", "progress", "stems", "error")}


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    return _public(_job(job_id))


def _stem_path(job: dict, stem: str) -> Path:
    if job["status"] != "done" or stem not in job["stems"]:
        raise HTTPException(404, "Стем не найден")
    return DATA / job["id"] / "stems" / f"{stem}.wav"


@app.get("/api/jobs/{job_id}/stems/{stem}")
def get_stem(job_id: str, stem: str, format: str = "wav", download: bool = False):
    job = _job(job_id)
    if format not in FORMATS:
        raise HTTPException(400, "Неизвестный формат")
    path = convert(_stem_path(job, stem), format)
    filename = f"{job['name']} - {stem}.{FORMATS[format]['ext']}"
    return FileResponse(path, media_type=FORMATS[format]["mime"], filename=filename if download else None,
                        content_disposition_type="attachment" if download else "inline")


@app.get("/api/jobs/{job_id}/zip")
def get_zip(job_id: str, format: str = "wav", stems: str | None = None):
    job = _job(job_id)
    if format not in FORMATS:
        raise HTTPException(400, "Неизвестный формат")
    selected = stems.split(",") if stems else job["stems"]
    files = [(s, convert(_stem_path(job, s), format)) for s in selected]
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as z:
        for s, p in files:
            z.write(p, f"{job['name']} - {s}.{FORMATS[format]['ext']}")
    buf.seek(0)
    from urllib.parse import quote
    fname = quote(f"{job['name']} - stems ({format}).zip")
    return StreamingResponse(buf, media_type="application/zip",
                             headers={"Content-Disposition": f"attachment; filename*=UTF-8''{fname}"})


@app.delete("/api/jobs/{job_id}")
def delete_job(job_id: str):
    _job(job_id)
    shutil.rmtree(DATA / job_id, ignore_errors=True)
    jobs.pop(job_id, None)
    return {"ok": True}


app.mount("/", StaticFiles(directory=ROOT / "frontend", html=True), name="frontend")
