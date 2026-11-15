"""Разделение трека на стемы через Demucs и конвертация форматов через ffmpeg."""
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Callable

MODELS = {
    "htdemucs": {"label": "4 стема: вокал, барабаны, бас, прочее", "stems": ["vocals", "drums", "bass", "other"]},
    "htdemucs_ft": {"label": "4 стема, выше качество (медленнее)", "stems": ["vocals", "drums", "bass", "other"]},
    "htdemucs_6s": {"label": "6 стемов: + гитара, пианино", "stems": ["vocals", "drums", "bass", "guitar", "piano", "other"]},
    "vocals": {"label": "2 стема: вокал / минус", "stems": ["vocals", "no_vocals"]},
}

FORMATS = {
    "wav": {"ext": "wav", "mime": "audio/wav", "args": ["-c:a", "pcm_s16le"]},
    "flac": {"ext": "flac", "mime": "audio/flac", "args": ["-c:a", "flac"]},
    "mp3": {"ext": "mp3", "mime": "audio/mpeg", "args": ["-c:a", "libmp3lame", "-b:a", "320k"]},
    "ogg": {"ext": "ogg", "mime": "audio/ogg", "args": ["-c:a", "libvorbis", "-q:a", "8"]},
    "m4a": {"ext": "m4a", "mime": "audio/mp4", "args": ["-c:a", "aac", "-b:a", "256k"]},
}

FAKE = os.environ.get("STEM_SPLITTER_FAKE") == "1"  # режим для тестов без Demucs


def separate(src: Path, out_dir: Path, model: str, on_progress: Callable[[float], None]) -> dict[str, Path]:
    """Делит src на стемы, кладёт WAV в out_dir. Возвращает {имя_стема: путь}."""
    out_dir.mkdir(parents=True, exist_ok=True)
    if FAKE:
        return _fake_separate(src, out_dir, model, on_progress)

    cmd = [sys.executable, "-m", "demucs", "-o", str(out_dir / "_raw"), "--filename", "{stem}.{ext}"]
    if model == "vocals":
        cmd += ["-n", "htdemucs", "--two-stems", "vocals"]
    else:
        cmd += ["-n", model]
    cmd.append(str(src))

    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, bufsize=0)
    buf, log = b"", []
    # Demucs (tqdm) пишет прогресс через \r; при нескольких проходах модели проценты повторяются
    passes, last = 0, 0.0
    n_passes = 4 if model == "htdemucs_ft" else 1
    while True:
        ch = proc.stdout.read(1)
        if not ch:
            break
        if ch in (b"\r", b"\n"):
            line = buf.decode(errors="ignore")
            buf = b""
            log.append(line)
            m = re.search(r"(\d+(?:\.\d+)?)%\|", line)
            if m:
                pct = float(m.group(1))
                if pct < last:
                    passes += 1
                last = pct
                on_progress(min(99.0, (passes * 100 + pct) / n_passes))
        else:
            buf += ch
    if proc.wait() != 0:
        raise RuntimeError("Demucs завершился с ошибкой:\n" + "\n".join(log[-20:]))

    raw = next((out_dir / "_raw").iterdir())  # папка модели
    stems = {}
    for f in raw.glob("*.wav"):
        dst = out_dir / f.name
        shutil.move(str(f), dst)
        stems[f.stem] = dst
    shutil.rmtree(out_dir / "_raw", ignore_errors=True)
    return stems


def _fake_separate(src: Path, out_dir: Path, model: str, on_progress) -> dict[str, Path]:
    filters = {"vocals": "highpass=f=300,lowpass=f=3000", "drums": "highpass=f=3000",
               "bass": "lowpass=f=200", "no_vocals": "lowpass=f=300"}
    stems = {}
    names = MODELS[model]["stems"]
    for i, name in enumerate(names):
        dst = out_dir / f"{name}.wav"
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(src), "-af", filters.get(name, "anull"),
                        "-ar", "44100", "-ac", "2", str(dst)], check=True)
        stems[name] = dst
        on_progress((i + 1) / len(names) * 99)
    return stems


def convert(src: Path, fmt: str) -> Path:
    """Конвертирует WAV-стем в нужный формат (с кешированием)."""
    spec = FORMATS[fmt]
    dst = src.with_name(f"{src.stem}.{spec['ext']}") if fmt != "wav" else src
    if fmt == "wav" or (dst.exists() and dst.stat().st_mtime >= src.stat().st_mtime):
        return dst
    tmp = dst.with_name(dst.name + ".tmp." + spec["ext"])
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(src), *spec["args"], str(tmp)], check=True)
    tmp.replace(dst)
    return dst
