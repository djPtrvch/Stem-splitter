const $ = (id) => document.getElementById(id);
const STEM_LABELS = { original: "Весь звук", vocals: "Вокал", drums: "Барабаны", bass: "Бас", other: "Прочее",
  guitar: "Гитара", piano: "Пианино", no_vocals: "Минус" };

const ICONS = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="6.5" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="13.5" y="5" width="4" height="14" rx="1" fill="currentColor"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14"/></svg>',
  speaker: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
  muted: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>',
  solo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3.5" y="14" width="4" height="6" rx="1.5" fill="currentColor"/><rect x="16.5" y="14" width="4" height="6" rx="1.5" fill="currentColor"/></svg>',
};

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
  $("audio-dl").onclick = () => { location.href = `api/jobs/${job.id}/audio?format=${$("format").value}`; };
  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && tracks.length && e.target.tagName !== "SELECT") { e.preventDefault(); $("play").click(); }
  });
}

// iOS/iPadOS: без этого Safari глушит Web Audio при беззвучном режиме
let silentEl = null;
function unlockAudio() {
  try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch {}
  ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state !== "running") ctx.resume();
  if (!silentEl) {
    // тихий HTML-звук переключает старые iOS в режим «воспроизведение»
    const sr = 8000, n = sr / 2, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const w = (o, str) => [...str].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVEfmt "); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true);
    silentEl = new Audio(URL.createObjectURL(new Blob([buf], { type: "audio/wav" })));
    silentEl.loop = true;
    silentEl.setAttribute("playsinline", "");
  }
  silentEl.play().catch(() => {});
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
  unlockAudio();
  try {
    const uploadId = await uploadChunked(file);
    const fd = new FormData();
    fd.append("upload_id", uploadId);
    fd.append("filename", file.name);
    fd.append("model", $("model").value);
    job = await api("api/jobs", { method: "POST", body: fd });
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

async function api(url, opts = {}) {
  const r = await fetch(url, opts);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body.detail || `Ошибка сервера ${r.status}`), { status: r.status });
  return body;
}

// Загрузка частями по 4 МБ с повторами: большие файлы одним запросом рвутся на прокси
async function uploadChunked(f) {
  const { upload_id, chunk_mb } = await api("api/uploads", { method: "POST" });
  const size = chunk_mb * 1024 * 1024;
  const mb = (b) => (b / 1048576).toFixed(1);
  for (let off = 0; off < f.size; off += size) {
    const part = f.slice(off, off + size);
    for (let attempt = 1; ; attempt++) {
      try {
        await api(`api/uploads/${upload_id}?offset=${off}`, { method: "PUT", body: part });
        break;
      } catch (e) {
        if (e.status && e.status < 500 && e.status !== 408 && e.status !== 429) throw e;
        if (attempt >= 5) throw new Error("Не удалось загрузить файл: соединение обрывается. Попробуйте ещё раз.");
        setProgress(`Обрыв связи, повтор ${attempt}/4…`, (off / f.size) * 100);
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
    const done = Math.min(f.size, off + size);
    setProgress(`Загрузка файла… ${mb(done)} из ${mb(f.size)} МБ`, (done / f.size) * 100);
  }
  return upload_id;
}

function setProgress(text, pct) { $("status").textContent = text; $("bar-fill").style.width = `${pct}%`; }

async function loadStems() {
  ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
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
  const extractOnly = job.model === "extract";
  $("zip").classList.toggle("hidden", extractOnly);
  if (extractOnly) $("video-dl").classList.add("hidden");
  $("audio-dl").textContent = extractOnly ? "Скачать звук" : "Скачать исходный звук";
  $("audio-dl").className = extractOnly ? "" : "ghost";
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
    <button class="icon solo-play" title="Слушать только этот стем">${ICONS.play}</button>
    <div class="name">${STEM_LABELS[t.name] || t.name}</div>
    <div class="btns">
      <button class="icon toggle mute" title="Выключить звук стема">${ICONS.speaker}</button>
      <button class="icon toggle solo" title="Соло (можно несколько)">${ICONS.solo}</button>
    </div>
    <canvas title="Нажмите, чтобы перемотать"></canvas>
    <div class="side">
      <input type="range" min="0" max="1.5" step="0.01" value="1" title="Громкость">
      <select title="Формат файла">${[...$("format").options].map((o) => `<option value="${o.value}">${o.text}</option>`).join("")}</select>
      <button class="icon dl" title="Скачать стем">${ICONS.download}</button>
    </div>`;
  t.row = row;
  t.muteBtn = row.querySelector(".mute");
  t.soloBtn = row.querySelector(".solo");
  t.playBtn = row.querySelector(".solo-play");
  t.muteBtn.onclick = () => { t.mute = !t.mute; applyGains(); };
  t.soloBtn.onclick = () => { t.solo = !t.solo; applyGains(); };
  t.playBtn.onclick = () => playOnly(t);
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

// ▶ у стема: играет только его; повторное нажатие — пауза и снова все стемы
function playOnly(t) {
  const only = t.solo && tracks.every((x) => x === t || !x.solo);
  if (only && playing) {
    pause();
    tracks.forEach((x) => (x.solo = false));
    applyGains();
    return;
  }
  tracks.forEach((x) => (x.solo = x === t));
  if (t.mute) t.mute = false;
  applyGains();
  if (!playing) play();
}

function updateStemUI() {
  const anySolo = tracks.some((t) => t.solo);
  const only = tracks.filter((t) => t.solo).length === 1;
  for (const t of tracks) {
    const audible = !t.mute && (!anySolo || t.solo);
    t.muteBtn.classList.toggle("on", t.mute);
    t.muteBtn.innerHTML = t.mute ? ICONS.muted : ICONS.speaker;
    t.soloBtn.classList.toggle("on", t.solo);
    t.row.classList.toggle("silent", !audible);
    const active = only && t.solo && playing;
    t.playBtn.classList.toggle("on", active);
    t.playBtn.innerHTML = active ? ICONS.pause : ICONS.play;
  }
}

function applyGains() {
  const anySolo = tracks.some((t) => t.solo);
  for (const t of tracks) {
    const audible = !t.mute && (!anySolo || t.solo);
    t.gain.gain.setTargetAtTime(audible ? t.volume : 0, ctx.currentTime, 0.01);
  }
  updateStemUI();
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
  unlockAudio();
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
  $("play").innerHTML = ICONS.pause;
  updateStemUI();
  tick();
}

function stopSources() { for (const t of tracks) { try { t.src?.stop(); } catch {} t.src = null; } }

function pause() {
  offset = currentTime();
  stopSources();
  playing = false;
  if (job?.has_video) $("video").pause();
  $("play").innerHTML = ICONS.play;
  silentEl?.pause();
  updateStemUI();
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
