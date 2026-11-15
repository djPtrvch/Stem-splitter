const $ = (id) => document.getElementById(id);
const STEM_LABELS = { vocals: "Вокал", drums: "Барабаны", bass: "Бас", other: "Прочее",
  guitar: "Гитара", piano: "Пианино", no_vocals: "Минус" };

let file = null, job = null;
let ctx = null, tracks = [], duration = 0, playing = false, startAt = 0, offset = 0, raf = 0;

init();

async function init() {
  const opts = await (await fetch("api/options")).json();
  for (const [k, label] of Object.entries(opts.models)) $("model").add(new Option(label, k));
  for (const f of opts.formats) $("format").add(new Option(f.toUpperCase(), f));

  const drop = $("drop");
  $("file").onchange = (e) => pick(e.target.files[0]);
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); pick(e.dataTransfer.files[0]); };

  $("start").onclick = start;
  $("new").onclick = reset;
  $("play").onclick = () => (playing ? pause() : play());
  $("seek").oninput = (e) => seek((e.target.value / 1000) * duration);
  $("format").onchange = (e) => document.querySelectorAll(".stem select").forEach((s) => (s.value = e.target.value));
  $("zip").onclick = () => { location.href = `api/jobs/${job.id}/zip?format=${$("format").value}`; };
  $("video-dl").onclick = downloadVideo;
  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && tracks.length && e.target.tagName !== "SELECT") { e.preventDefault(); $("play").click(); }
  });
}

function pick(f) {
  if (!f) return;
  file = f;
  $("drop-text").textContent = f.name;
  $("start").disabled = false;
}

function showError(msg) { $("error").textContent = msg; $("error").classList.toggle("hidden", !msg); }

async function start() {
  showError("");
  $("upload").classList.add("hidden");
  $("progress").classList.remove("hidden");
  setProgress("Загрузка файла…", 0);
  const fd = new FormData();
  fd.append("file", file);
  fd.append("model", $("model").value);
  try {
    job = await upload(fd);
    while (job.status === "queued" || job.status === "processing") {
      setProgress(job.status === "queued" ? "В очереди…" : `Разделение… ${Math.floor(job.progress)}%`, job.progress);
      await new Promise((r) => setTimeout(r, 1000));
      job = await (await fetch(`api/jobs/${job.id}`)).json();
    }
    if (job.status === "error") throw new Error(job.error);
    setProgress("Загрузка стемов в плеер…", 100);
    await loadStems();
    $("progress").classList.add("hidden");
    $("result").classList.remove("hidden");
  } catch (e) {
    showError(e.message || String(e));
    $("progress").classList.add("hidden");
    $("upload").classList.remove("hidden");
  }
}

function upload(fd) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "api/jobs");
    xhr.upload.onprogress = (e) => e.lengthComputable && setProgress(`Загрузка файла… ${Math.round(e.loaded / e.total * 100)}%`, e.loaded / e.total * 100);
    xhr.onload = () => {
      let body; try { body = JSON.parse(xhr.responseText); } catch { body = {}; }
      xhr.status < 300 ? resolve(body) : reject(new Error(body.detail || `Ошибка ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("Сеть недоступна"));
    xhr.send(fd);
  });
}

function setProgress(text, pct) { $("status").textContent = text; $("bar-fill").style.width = `${pct}%`; }

async function loadStems() {
  ctx = ctx || new AudioContext();
  $("track-name").textContent = job.name;
  $("stems").innerHTML = "";
  tracks = await Promise.all(job.stems.map(async (name) => {
    const data = await (await fetch(`api/jobs/${job.id}/stems/${name}?format=wav`)).arrayBuffer();
    const buffer = await ctx.decodeAudioData(data);
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    return { name, buffer, gain, volume: 1, mute: false, solo: false, src: null };
  }));
  duration = Math.max(...tracks.map((t) => t.buffer.duration));
  const video = $("video");
  video.classList.toggle("hidden", !job.has_video);
  $("video-dl").classList.toggle("hidden", !job.has_video);
  if (job.has_video) {
    video.src = `api/jobs/${job.id}/source`;
    video.onclick = () => $("play").click();
  } else video.removeAttribute("src");
  tracks.forEach(renderStem);
  $("play").disabled = $("seek").disabled = false;
  updateTime();
}

function renderStem(t) {
  const row = document.createElement("div");
  row.className = "stem";
  row.innerHTML = `
    <div class="name">${STEM_LABELS[t.name] || t.name}</div>
    <div class="btns">
      <button class="toggle mute" title="Mute">M</button>
      <button class="toggle solo" title="Solo">S</button>
    </div>
    <canvas></canvas>
    <div class="side">
      <input type="range" min="0" max="1.5" step="0.01" value="1" title="Громкость">
      <select>${[...$("format").options].map((o) => `<option value="${o.value}">${o.text}</option>`).join("")}</select>
      <button class="dl" title="Скачать">⬇</button>
    </div>`;
  const [muteBtn, soloBtn] = row.querySelectorAll(".toggle");
  muteBtn.onclick = () => { t.mute = !t.mute; muteBtn.classList.toggle("on", t.mute); applyGains(); };
  soloBtn.onclick = () => { t.solo = !t.solo; soloBtn.classList.toggle("on", t.solo); applyGains(); };
  row.querySelector("input").oninput = (e) => { t.volume = +e.target.value; applyGains(); };
  const sel = row.querySelector("select");
  sel.value = $("format").value;
  row.querySelector(".dl").onclick = () => {
    location.href = `api/jobs/${job.id}/stems/${t.name}?format=${sel.value}&download=true`;
  };
  const canvas = row.querySelector("canvas");
  canvas.onclick = (e) => seek((e.offsetX / canvas.clientWidth) * duration);
  t.canvas = canvas;
  $("stems").appendChild(row);
  requestAnimationFrame(() => drawWave(t));
}

function applyGains() {
  const anySolo = tracks.some((t) => t.solo);
  for (const t of tracks) {
    const audible = !t.mute && (!anySolo || t.solo);
    t.gain.gain.setTargetAtTime(audible ? t.volume : 0, ctx.currentTime, 0.01);
  }
}

function drawWave(t) {
  const c = t.canvas, dpr = devicePixelRatio || 1;
  c.width = c.clientWidth * dpr; c.height = c.clientHeight * dpr;
  const g = c.getContext("2d"), w = c.width, h = c.height;
  if (!t.peaks || t.peaks.length !== w) {
    const ch = t.buffer.getChannelData(0), step = Math.max(1, Math.floor(ch.length / w));
    t.peaks = new Float32Array(w);
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let i = x * step, e = Math.min(ch.length, i + step); i < e; i += 4) m = Math.max(m, Math.abs(ch[i]));
      t.peaks[x] = m;
    }
  }
  const pos = Math.floor((currentTime() / duration) * w);
  g.clearRect(0, 0, w, h);
  for (let x = 0; x < w; x++) {
    const ph = Math.max(1, t.peaks[x] * h);
    g.fillStyle = x < pos ? "#6c8cff" : "#3a4152";
    g.fillRect(x, (h - ph) / 2, 1, ph);
  }
}

function currentTime() { return playing ? Math.min(duration, ctx.currentTime - startAt) : offset; }

function play() {
  if (ctx.state === "suspended") ctx.resume();
  if (offset >= duration) offset = 0;
  startAt = ctx.currentTime - offset;
  for (const t of tracks) {
    t.src = ctx.createBufferSource();
    t.src.buffer = t.buffer;
    t.src.connect(t.gain);
    t.src.start(0, offset);
  }
  applyGains();
  playing = true;
  if (job.has_video) { $("video").currentTime = offset; $("video").play().catch(() => {}); }
  $("play").textContent = "⏸";
  tick();
}

function stopSources() { for (const t of tracks) { try { t.src?.stop(); } catch {} t.src = null; } }

function pause() {
  offset = currentTime();
  stopSources();
  playing = false;
  if (job?.has_video) $("video").pause();
  $("play").textContent = "▶";
  cancelAnimationFrame(raf);
  redraw();
}

function seek(sec) {
  const was = playing;
  if (playing) { stopSources(); playing = false; }
  offset = Math.max(0, Math.min(duration, sec));
  if (!was && job.has_video) $("video").currentTime = offset;
  was ? play() : redraw();
}

function tick() {
  if (currentTime() >= duration) { pause(); offset = duration; redraw(); return; }
  redraw();
  syncVideo();
  raf = requestAnimationFrame(tick);
}

// видео без звука, ведущий — Web Audio; подтягиваем видео при рассинхроне
function syncVideo() {
  const v = $("video");
  if (!job?.has_video || v.readyState < 2) return;
  if (Math.abs(v.currentTime - currentTime()) > 0.15) v.currentTime = currentTime();
}

function downloadVideo() {
  const anySolo = tracks.some((t) => t.solo);
  const on = tracks.filter((t) => !t.mute && (!anySolo || t.solo) && t.volume > 0);
  if (!on.length) return showError("Включите хотя бы один стем");
  showError("");
  const btn = $("video-dl");
  btn.disabled = true;
  btn.textContent = "Собираю видео…";
  const url = `api/jobs/${job.id}/video?stems=${on.map((t) => t.name).join(",")}&volumes=${on.map((t) => t.volume).join(",")}`;
  fetch(url).then(async (r) => {
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `Ошибка ${r.status}`);
    const blob = await r.blob();
    const name = decodeURIComponent((r.headers.get("content-disposition") || "").match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i)?.[1] || "video.mp4");
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }).catch((e) => showError(e.message)).finally(() => {
    btn.disabled = false;
    btn.textContent = "Скачать видео с текущим миксом";
  });
}

function redraw() { updateTime(); tracks.forEach(drawWave); }

function fmt(s) { s = Math.floor(s); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }

function updateTime() {
  const t = currentTime();
  $("time").textContent = `${fmt(t)} / ${fmt(duration)}`;
  if (document.activeElement !== $("seek")) $("seek").value = duration ? (t / duration) * 1000 : 0;
}

function reset() {
  if (playing) pause();
  if (job) fetch(`api/jobs/${job.id}`, { method: "DELETE" });
  tracks.forEach((t) => t.gain.disconnect());
  $("video").pause(); $("video").removeAttribute("src"); $("video").load();
  tracks = []; job = null; offset = 0; duration = 0;
  $("result").classList.add("hidden");
  $("upload").classList.remove("hidden");
  $("play").disabled = $("seek").disabled = true;
}

window.addEventListener("resize", () => tracks.length && redraw());
