// web/js/app.js
// Núcleo de la aplicación web: estado, medios, edición, reproducción,
// transiciones, persistencia, output y control remoto.
import { Renderer, webgl2Supported } from "/web/js/renderer.js";
import * as P from "/web/js/project.js";
import * as S from "/web/js/store.js";
import { Remote } from "/web/js/remote.js";
import { renderAll, hexToRgb, rgbToHex } from "/web/js/ui.js";
import { mediaTimeAt, activeClipAt, splitClip, sceneTlEnd, coveredSurfaceIds, createClip, createTimeline } from "/web/js/timeline.js";
import { initMIDI } from "/web/js/midi.js";
import { listScreens, openOutputOnScreen } from "/web/js/wm.js";
import { detectFromImageFile } from "/web/js/automap.js";

const $ = (sel) => document.querySelector(sel);

/* ---------------- Estado global ---------------- */

const state = {
  project: P.createProject(),
  media: new Map(),          // id -> runtime {element, objectUrl, thumb, blob, ...}
  selectedSurfaceId: null,
  selectedMediaId: null,
  selectedClipId: null,
  playing: false,
  playStart: 0,              // timestamp del inicio de reproducción (para sync)
  pausedAt: 0,
  transition: null,          // {fromId, toId, start, dur}
  maskEditing: false,
  maskTemp: [],
  fps: 0,
  netStatus: "sin conexión",
  dirty: false,
  drag: null,                // {surfaceId, pointIdx | 'move', lastX, lastY}
  outputWin: null,
  pattern: null,
  masterBrightness: 1,
};
window.__lumap = state; // depuración

const actions = {}; // se rellena abajo (delegación)

/* ---------------- Inicio ---------------- */

let renderer = null, overlayCtx = null;

async function init() {
  if (!webgl2Supported()) {
    document.body.innerHTML = `<div class="fatal">
      <h1>WebGL2 no disponible</h1>
      <p>Esta aplicación requiere GPU acelerada por WebGL2. Usa Chrome, Edge, Firefox o Safari recientes y verifica que la aceleración de hardware esté activada.</p></div>`;
    return;
  }
  renderer = new Renderer($("#gl"));
  overlayCtx = $("#overlay").getContext("2d");
  $("#mapInput").addEventListener("change", (e) => {
    if (e.target.files[0]) runAutoMap(e.target.files[0]);
    e.target.value = "";
  });
  bindToolbar();
  bindCanvas();
  bindProperties();
  bindGlobalDrop();
  await autosaveRecover();
  renderAll(state, actions);
  requestAnimationFrame(tick);
  setInterval(autosave, 10000);
  setInterval(broadcastState, 1000);
  connectRemote();
  window.addEventListener("beforeunload", () => { autosave(); });
  $("#fatal")?.remove();
}

/* ---------------- Medios: importación real ---------------- */

const ACCEPT = {
  image: ["png", "jpg", "jpeg", "webp", "svg", "gif"],
  video: ["mp4", "webm", "mov", "m4v"],
  audio: ["mp3", "wav", "ogg"],
};

function kindOf(file) {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (ACCEPT.image.includes(ext) || file.type.startsWith("image/")) return "image";
  if (ACCEPT.video.includes(ext) || file.type.startsWith("video/")) return "video";
  if (ACCEPT.audio.includes(ext) || file.type.startsWith("audio/")) return "audio";
  return null;
}

async function importFiles(fileList) {
  const files = [...fileList];
  for (const file of files) {
    const kind = kindOf(file);
    if (!kind) {
      alert(`Formato no compatible: ${file.name}\n\nSoportados: imágenes PNG/JPG/WEBP/SVG/GIF, video MP4/WebM/MOV, audio MP3/WAV/OGG.`);
      continue;
    }
    if (kind === "audio") { alert(`"${file.name}" es audio: la pista de audio se usará como clip del timeline en una fase futura (v0.2).`); continue; }
    const url = URL.createObjectURL(file);
    const m = {
      id: P.uid("media"), name: file.name, kind, mime: file.type,
      size: file.size, objectUrl: url, blob: file,
      element: null, duration: 0, width: 0, height: 0, thumb: "", dataUrl: null,
    };
    try {
      if (kind === "image") {
        const img = new Image();
        await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error("imagen corrupta")); img.src = url; });
        m.element = img; m.width = img.naturalWidth; m.height = img.naturalHeight;
        m.thumb = url;
        if (file.name.toLowerCase().endsWith(".gif")) m.kind = "image"; // GIF animado: se reproduce como imagen animada
      } else {
        const v = document.createElement("video");
        v.muted = true; v.loop = true; v.playsInline = true; v.preload = "auto"; v.src = url;
        await new Promise((res, rej) => {
          const to = setTimeout(() => rej(new Error("timeout leyendo metadatos")), 15000);
          v.onloadeddata = () => { clearTimeout(to); res(); };
          v.onerror = () => { clearTimeout(to); rej(new Error("video no decodable por este navegador")); };
        });
        m.element = v; m.width = v.videoWidth; m.height = v.videoHeight; m.duration = v.duration;
        // miniatura real del primer frame
        const c = document.createElement("canvas");
        c.width = 96; c.height = Math.max(1, Math.round(96 * v.videoHeight / Math.max(v.videoWidth, 1)));
        try { c.getContext("2d").drawImage(v, 0, 0, c.width, c.height); m.thumb = c.toDataURL("image/jpeg", 0.6); } catch { m.thumb = ""; }
      }
      state.media.set(m.id, m);
      state.selectedMediaId = m.id;
    } catch (e) {
      URL.revokeObjectURL(url);
      alert(`No se pudo importar "${file.name}": ${e.message}.\n\nPista: los navegadores no decodifican todos los códecs (p. ej. MOV con códecs propietarios). Convierte a MP4 (H.264) u WebM (VP9).`);
    }
  }
  markDirty(); renderAll(state, actions);
}

function mediaRuntimeList() { return [...state.media.values()]; }

/* ---------------- Serialización / persistencia ---------------- */

async function buildDoc() {
  // Calcula dataUrls solo al guardar/exportar (coste diferido)
  for (const m of state.media.values()) {
    if (!m.dataUrl) m.dataUrl = await blobToDataUrl(m.blob);
  }
  return await P.serializeProject(state.project, mediaRuntimeList());
}
function blobToDataUrl(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob);
  });
}

function markDirty() { state.dirty = true; renderStatusLight(); }
function renderStatusLight() { renderAll(state, actions); }

async function saveProject(toBackend = false) {
  try {
    const doc = await buildDoc();
    doc.currentSceneId = state.project.currentSceneId;
    await S.saveLocal(doc);
    state.project.updatedAt = doc.updatedAt;
    state.dirty = false;
    if (toBackend) {
      try {
        const r = await fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(doc) });
        if (!r.ok) throw new Error("HTTP " + r.status);
        state.netStatus = "sincronizado con backend";
      } catch (e) {
        state.netStatus = "backend no disponible (guardado local OK)";
      }
    }
    syncOutput();
    renderAll(state, actions);
    return true;
  } catch (e) {
    alert("Error al guardar: " + e.message);
    return false;
  }
}

async function autosave() {
  if (!state.dirty) return;
  const doc = await buildDoc();
  doc.currentSceneId = state.project.currentSceneId;
  try { await S.saveLocal(doc); state.dirty = false; } catch { /* se reintenta en 10s */ }
}

async function autosaveRecover() {
  try {
    const names = await S.listLocal();
    if (names.length) {
      const last = names[names.length - 1];
      const doc = await S.loadLocal(last);
      if (doc && confirm(`Se encontró un proyecto guardado automáticamente: "${doc.name}". ¿Recuperarlo?`)) {
        await loadDoc(doc);
      }
    }
  } catch { /* sin recuperación */ }
}

async function loadDoc(doc) {
  P.validateProject(doc);
  disposeMedia();
  state.project = doc;
  state.project.surfaces = doc.surfaces || [];
  state.project.scenes = doc.scenes || [];
  state.selectedSurfaceId = null;
  state.transition = null; state.playing = false;
  state.media.clear();
  for (const md of doc.media || []) {
    if (!md.dataUrl) continue;
    const blob = dataUrlToBlob(md.dataUrl);
    const url = URL.createObjectURL(blob);
    const m = { ...md, blob, objectUrl: url, element: null, thumb: md.thumb || "" };
    try {
      if (md.kind === "video") {
        const v = document.createElement("video");
        v.muted = true; v.loop = true; v.playsInline = true; v.preload = "auto"; v.src = url;
        await new Promise(res => { v.onloadeddata = res; v.onerror = res; });
        m.element = v; m.thumb = m.thumb || "";
      } else {
        const img = new Image();
        await new Promise(res => { img.onload = res; img.onerror = res; img.src = url; });
        m.element = img; if (!m.thumb) m.thumb = url;
      }
    } catch { m.element = null; }
    state.media.set(m.id, m);
  }
  if (doc.currentSceneId) state.project.currentSceneId = doc.currentSceneId;
  state.dirty = false;
  syncOutput();
  renderAll(state, actions);
}

function dataUrlToBlob(du) {
  const [head, b64] = du.split(",");
  const mime = (head.match(/data:(.*?);/) || [])[1] || "application/octet-stream";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

function disposeMedia() {
  for (const m of state.media.values()) {
    if (m.element && m.element.pause) try { m.element.pause(); } catch {}
    if (m.objectUrl) URL.revokeObjectURL(m.objectUrl);
    renderer.releaseMedia(m.id);
  }
}

async function openProjectList() {
  const names = await S.listLocal();
  if (!names.length) { alert("No hay proyectos guardados localmente."); return; }
  const pick = prompt("Proyectos guardados:\n\n" + names.map((n, i) => `${i + 1}. ${n}`).join("\n") + "\n\nEscribe el número o nombre:", "1");
  if (pick == null) return;
  const name = /^\d+$/.test(pick.trim()) ? names[Number(pick.trim()) - 1] : pick.trim();
  const doc = await S.loadLocal(name);
  if (doc) await loadDoc(doc); else alert("No se encontró: " + name);
}

async function exportProject() {
  const doc = await buildDoc();
  doc.currentSceneId = state.project.currentSceneId;
  const blob = new Blob([JSON.stringify(doc)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = (state.project.name || "proyecto").replace(/[^\w\- ]/g, "_") + ".lumap.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function importProject(file) {
  const r = new FileReader();
  r.onload = async () => {
    try { await loadDoc(JSON.parse(r.result)); }
    catch (e) { alert("Archivo de proyecto inválido: " + e.message); }
  };
  r.readAsText(file);
}

/* ---------------- Reproducción, escenas y transiciones ---------------- */

function setPlaying(on) {
  state.playing = on;
  const t = now();
  if (on) {
    state.playStart = t - state.pausedAt;
    for (const m of state.media.values())
      if (m.kind === "video" && m.element) {
        try { m.element.currentTime = state.pausedAt % (m.duration || 1); m.element.play().catch(() => {}); } catch {}
      }
  } else {
    state.pausedAt = t - state.playStart;
    for (const m of state.media.values())
      if (m.kind === "video" && m.element) try { m.element.pause(); } catch {}
  }
  syncOutput();
  renderAll(state, actions);
}

function now() { return performance.now() / 1000; }

function gotoScene(id, { viaTransition = true } = {}) {
  const proj = state.project;
  if (!proj.scenes.some(s => s.id === id)) return;
  const prev = proj.currentSceneId;
  if (prev === id) { renderAll(state, actions); return; }
  const kind = proj.settings.transition || "fade";
  if (viaTransition && kind === "fade") {
    state.transition = { fromId: prev, toId: id, start: now(), dur: (proj.settings.transitionMs || 500) / 1000 };
  }
  proj.currentSceneId = id;
  state.pausedAt = 0; state.playStart = now();
  syncOutput();
  renderAll(state, actions);
}

function nextScene() {
  const i = state.project.scenes.findIndex(s => s.id === state.project.currentSceneId);
  gotoScene(state.project.scenes[(i + 1) % state.project.scenes.length].id);
}
function prevScene() {
  const i = state.project.scenes.findIndex(s => s.id === state.project.currentSceneId);
  gotoScene(state.project.scenes[(i - 1 + state.project.scenes.length) % state.project.scenes.length].id);
}

function tick() {
  const t0 = performance.now();
  requestAnimationFrame(tick);
  const W = state.project.width, H = state.project.height;
  const scenes = new Map(state.project.scenes.map(s => [s.id, s]));
  const surfaces = new Map(state.project.surfaces.map(s => [s.id, s]));

  if (state.transition) {
    const tr = state.transition;
    const k = Math.min((now() - tr.start) / tr.dur, 1);
    const ease = k * (2 - k); // easeOutQuad
    renderer.drawScene(scenes.get(tr.fromId), surfaces, state.media,
      { time: now(), globalAlpha: (1 - ease) * state.masterBrightness, W, H });
    renderer.drawScene(scenes.get(tr.toId), surfaces, state.media,
      { time: now(), globalAlpha: ease * state.masterBrightness, W, H });
    if (k >= 1) state.transition = null;
  } else {
    drawCurrent(scenes, surfaces, W, H);
  }
  drawOverlay();

  // autoplay siguiente escena
  if (state.playing && !state.transition) {
    const sc = scenes.get(state.project.currentSceneId);
    if (sc && sc.autoplayNext) {
      if (sc.timeline && sc.timeline.enabled) {
        const end = sceneTlEnd(sc);
        if (end > 0 && playhead() > end) nextScene();
      } else {
        let allEnded = true, anyVideo = false;
      for (const l of sc.layers) {
        const s = surfaces.get(l.surfaceId);
        if (!s || !s.mediaId || s.hidden) continue;
        const m = state.media.get(s.mediaId);
        if (m && m.kind === "video") { anyVideo = true; if (!m.element.ended) allEnded = false; }
      }
        if (anyVideo && allEnded) nextScene();
      }
    }
  }

  const dt = performance.now() - t0;
  state.fps = state.fps * 0.9 + (1000 / Math.max(performance.now() - (tick._last || performance.now() - 16), 0.01)) * 0.1;
  tick._last = performance.now();
  const fpsEl = $("#stFps");
  if (fpsEl) fpsEl.textContent = state.fps.toFixed(0) + " FPS";
}

/* ---------------- Motor de timeline ---------------- */

function playhead() {
  return state.playing ? now() - state.playStart : state.pausedAt;
}

/**
 * Dibuja la escena actual. Si la escena tiene timeline habilitado, los clips
 * mandan: cada superficie muestra el medio del clip activo con su in/out,
 * velocidad y loop; las superficies sin clip activo quedan ocultas.
 */
function drawCurrent(scenes, surfaces, W, H) {
  const sc = scenes.get(state.project.currentSceneId);
  if (!sc) return;
  if (!sc.timeline) sc.timeline = createTimeline();
  if (!sc.timeline.enabled) {
    renderer.drawScene(sc, surfaces, state.media,
      { time: now(), globalAlpha: state.masterBrightness, W, H });
    return;
  }
  const t = playhead();
  const tl = sc.timeline;
  let renderSurfaces = surfaces;
  if (tl.clips.length) {
    renderSurfaces = new Map();
    const covered = coveredSurfaceIds(sc);
    for (const [id, s] of surfaces) {
      if (!covered.has(id)) { renderSurfaces.set(id, s); continue; } // fuera del timeline: normal
      const clip = activeClipAt(sc, id, t);
      if (!clip) { renderSurfaces.set(id, { ...s, hidden: true }); continue; }
      const m = state.media.get(clip.mediaId);
      if (m && m.kind === "video" && m.element) {
        const mt = mediaTimeAt(clip, t);
        if (Math.abs(m.element.currentTime - mt) > 0.08) { try { m.element.currentTime = mt; } catch {} }
        if (state.playing && m.element.paused) m.element.play().catch(() => {});
        if (!state.playing && !m.element.paused) m.element.pause();
      }
      renderSurfaces.set(id, { ...s, mediaId: clip.mediaId, hidden: false });
    }
    // pausar videos que no tienen clip activo
    for (const m of state.media.values()) {
      if (m.kind !== "video" || !m.element) continue;
      const inUse = tl.clips.some(c => c.mediaId === m.id &&
        t >= c.start && t < c.start + c.duration);
      if (!inUse && !m.element.paused) m.element.pause();
    }
  }
  renderer.drawScene(sc, renderSurfaces, state.media,
    { time: now(), globalAlpha: state.masterBrightness, W, H });
}

/* ---------------- Overlay del editor ---------------- */

function drawOverlay() {
  const cv = $("#overlay");
  const W = state.project.width, H = state.project.height;
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const ctx = overlayCtx;
  ctx.clearRect(0, 0, W, H);
  if (state.project.settings.mode === "simple") {
    // En modo simple solo se ven las asas de la superficie seleccionada
  }
  const surfaces = state.project.surfaces;
  ctx.lineWidth = Math.max(1.5, W / 800);
  for (const s of surfaces) {
    const sel = s.id === state.selectedSurfaceId;
    if (!sel && state.project.settings.mode === "simple") continue;
    ctx.strokeStyle = sel ? "#4fc3f7" : "rgba(255,255,255,0.35)";
    ctx.beginPath();
    s.points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.closePath(); ctx.stroke();
    if (sel) {
      s.points.forEach((p, i) => {
        ctx.fillStyle = i === 0 ? "#ffd54f" : "#4fc3f7";
        ctx.fillRect(p.x - 6, p.y - 6, 12, 12);
      });
    }
  }
  // máscara en edición
  if (state.maskEditing && state.maskTemp.length) {
    ctx.strokeStyle = "#ff8a65";
    ctx.beginPath();
    state.maskTemp.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.stroke();
    state.maskTemp.forEach(p => { ctx.fillStyle = "#ff8a65"; ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, 7); ctx.fill(); });
  }
}

function canvasPos(e) {
  const r = $("#overlay").getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * (state.project.width / r.width),
    y: (e.clientY - r.top) * (state.project.height / r.height),
  };
}

function hitVertex(s, pos) {
  const tol = 14 * (state.project.width / $("#overlay").getBoundingClientRect().width);
  for (let i = 0; i < s.points.length; i++)
    if (Math.abs(s.points[i].x - pos.x) < tol && Math.abs(s.points[i].y - pos.y) < tol) return i;
  return -1;
}

function hitSurface(pos) {
  const surfaces = state.project.surfaces;
  for (let i = surfaces.length - 1; i >= 0; i--) {
    const s = surfaces[i];
    if (s.hidden) continue;
    let inside = false;
    const pts = s.points;
    for (let j = 0, k = pts.length - 1; j < pts.length; k = j++) {
      if (((pts[j].y > pos.y) !== (pts[k].y > pos.y)) &&
          (pos.x < (pts[k].x - pts[j].x) * (pos.y - pts[j].y) / (pts[k].y - pts[j].y) + pts[j].x))
        inside = !inside;
    }
    if (inside) return s;
  }
  return null;
}

function bindCanvas() {
  const cv = $("#overlay");
  cv.addEventListener("pointerdown", (e) => {
    const pos = canvasPos(e);
    if (state.maskEditing) {
      state.maskTemp.push(pos);
      return;
    }
    const sel = state.project.surfaces.find(s => s.id === state.selectedSurfaceId);
    if (sel && !sel.locked) {
      const vi = hitVertex(sel, pos);
      if (vi >= 0) { state.drag = { surfaceId: sel.id, pointIdx: vi, lastX: pos.x, lastY: pos.y }; cv.setPointerCapture(e.pointerId); return; }
    }
    const hit = hitSurface(pos);
    if (hit) {
      state.selectedSurfaceId = hit.id;
      if (!hit.locked) { state.drag = { surfaceId: hit.id, pointIdx: "move", lastX: pos.x, lastY: pos.y }; cv.setPointerCapture(e.pointerId); }
      renderAll(state, actions);
    } else {
      state.selectedSurfaceId = null;
      renderAll(state, actions);
    }
  });
  cv.addEventListener("pointermove", (e) => {
    if (!state.drag) return;
    const pos = canvasPos(e);
    const s = state.project.surfaces.find(x => x.id === state.drag.surfaceId);
    if (!s) return;
    const dx = pos.x - state.drag.lastX, dy = pos.y - state.drag.lastY;
    if (state.drag.pointIdx === "move") {
      for (const p of s.points) { p.x += dx; p.y += dy; }
    } else {
      s.points[state.drag.pointIdx].x = pos.x;
      s.points[state.drag.pointIdx].y = pos.y;
      if (s.type === "quad") s.points = enforceQuadOrder(s.points);
    }
    state.drag.lastX = pos.x; state.drag.lastY = pos.y;
    markDirty();
    renderAll(state, actions);
  });
  cv.addEventListener("pointerup", () => { state.drag = null; });
  cv.addEventListener("dblclick", (e) => {
    const pos = canvasPos(e);
    const s = state.project.surfaces.find(x => x.id === state.selectedSurfaceId);
    if (!s || s.locked) return;
    if (s.type === "poly") {
      // insertar punto en la arista más cercana
      let best = -1, bestD = 1e9;
      for (let i = 0; i < s.points.length; i++) {
        const a = s.points[i], b = s.points[(i + 1) % s.points.length];
        const d = distToSeg(pos, a, b);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best >= 0 && bestD < 30) {
        s.points.splice(best + 1, 0, { x: pos.x, y: pos.y });
        markDirty(); renderAll(state, actions);
      }
    }
  });
  cv.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const pos = canvasPos(e);
    const s = state.project.surfaces.find(x => x.id === state.selectedSurfaceId);
    if (!s || s.locked || s.type !== "poly" || s.points.length <= 3) return;
    const vi = hitVertex(s, pos);
    if (vi >= 0) { s.points.splice(vi, 1); markDirty(); renderAll(state, actions); }
  });
  // arrastrar medio de la biblioteca sobre una superficie
  cv.addEventListener("dragover", (e) => e.preventDefault());
  cv.addEventListener("drop", (e) => {
    e.preventDefault();
    const mediaId = e.dataTransfer.getData("text/lumap-media");
    if (!mediaId) return;
    const hit = hitSurface(canvasPos(e));
    if (hit) { hit.mediaId = mediaId; state.selectedSurfaceId = hit.id; markDirty(); renderAll(state, actions); }
  });
}

function enforceQuadOrder(pts) {
  // Al arrastrar vértices de un quad, mantener el orden 0,1,2,3 tal cual
  return pts;
}

function distToSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (!l2) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/* ---------------- Propiedades (delegación de inputs) ---------------- */

function bindProperties() {
  const el = $("#propsBody");
  el.addEventListener("input", (e) => {
    const t = e.target;
    const s = state.project.surfaces.find(x => x.id === state.selectedSurfaceId);
    if (!s) return;
    if (t.dataset.fxkey === "feather") { s.mask.feather = Number(t.value); markDirty(); return; }
    if (t.dataset.prop === "name") { s.name = t.value; markDirty(); renderAll(state, actions); }
    if (t.dataset.prop === "mediaId") { s.mediaId = t.value || null; markDirty(); syncOutput(); renderAll(state, actions); }
    if (t.dataset.fx === "opacity") { s.opacity = Number(t.value); markDirty(); }
    if (t.dataset.fx === "volume") { s.volume = Number(t.value); applyVolumes(); markDirty(); }
    if (t.dataset.fx === "blend") { s.blend = t.value; markDirty(); }
    if (t.dataset.fx === "tint") { s.tint = hexToRgb(t.value); markDirty(); }
    if (t.dataset.fxkey) { s.fx[t.dataset.fxkey] = Number(t.value); markDirty(); }
    if (t.dataset.fxcolor) { s.fx.colorize = hexToRgb(t.value); markDirty(); }
    if (t.dataset.clip) {
      const sc = state.project.scenes.find(x => x.id === state.project.currentSceneId);
      const clip = sc?.timeline?.clips.find(c => c.id === state.selectedClipId);
      if (clip) {
        const k = t.dataset.clip;
        clip[k] = t.type === "checkbox" ? t.checked : Number(t.value);
        markDirty();
      }
      return;
    }
    if (t.dataset.maskflag) { s.mask[t.dataset.maskflag] = t.type === "checkbox" ? t.checked : Number(t.value); markDirty(); renderAll(state, actions); }
    if (t.dataset.move) {
      const bbox = surfaceBBox(s);
      if (t.dataset.move === "x") translateSurface(s, Number(t.value) - bbox.x, 0);
      if (t.dataset.move === "y") translateSurface(s, 0, Number(t.value) - bbox.y);
      if (t.dataset.move === "scale") scaleSurface(s, Number(t.value) / 100, bbox);
      if (t.dataset.move === "rot") rotateSurface(s, Number(t.value), bbox);
      markDirty(); renderAll(state, actions);
    }
  });
  el.addEventListener("change", (e) => {
    const t = e.target;
    const s = state.project.surfaces.find(x => x.id === state.selectedSurfaceId);
    if (t.dataset.fxflag && s) { s.fx[t.dataset.fxflag] = t.checked; markDirty(); }
    if (t.dataset.preset && s && t.value) { P.applyPreset(s, t.value); markDirty(); renderAll(state, actions); }
    if (t.dataset.prop === "type" && s && s.points.length === 4) { s.type = t.value; markDirty(); }
  });
}

function translateSurface(s, dx, dy) { for (const p of s.points) { p.x += dx; p.y += dy; } }
function scaleSurface(s, k, bbox) {
  for (const p of s.points) { p.x = bbox.cx + (p.x - bbox.cx) * k; p.y = bbox.cy + (p.y - bbox.cy) * k; }
}
function rotateSurface(s, deg, bbox) {
  const a = deg * Math.PI / 180;
  for (const p of s.points) {
    const dx = p.x - bbox.cx, dy = p.y - bbox.cy;
    p.x = bbox.cx + dx * Math.cos(a) - dy * Math.sin(a);
    p.y = bbox.cy + dx * Math.sin(a) + dy * Math.cos(a);
  }
}
function surfaceBBox(s) {
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (const p of s.points) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

function applyVolumes() {
  const surfaces = state.project.surfaces;
  for (const s of surfaces) {
    if (!s.mediaId) continue;
    const m = state.media.get(s.mediaId);
    if (m && m.element && "volume" in m.element) m.element.volume = Math.max(0, Math.min(1, s.volume));
  }
}

/* ---------------- Toolbar y acciones ---------------- */

function bindToolbar() {
  $("#fileInput").addEventListener("change", (e) => { importFiles(e.target.files); e.target.value = ""; });
  $("#projectInput").addEventListener("change", (e) => { if (e.target.files[0]) importProject(e.target.files[0]); e.target.value = ""; });
  document.body.addEventListener("click", async (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const id = btn.dataset.id;
    switch (btn.dataset.action) {
      case "import-media": $("#fileInput").click(); break;
      case "new-project": {
        if (!confirm("¿Nuevo proyecto? Se perderán los cambios no guardados.")) break;
        disposeMedia(); state.media.clear();
        state.project = P.createProject();
        state.selectedSurfaceId = state.selectedMediaId = null;
        state.playing = false; state.transition = null;
        markDirty(); syncOutput(); renderAll(state, actions);
        break;
      }
      case "save": await saveProject(false); break;
      case "save-backend": await saveProject(true); break;
      case "open": await openProjectList(); break;
      case "export": await exportProject(); break;
      case "import-project": $("#projectInput").click(); break;
      case "play": setPlaying(true); break;
      case "pause": setPlaying(false); break;
      case "stop": setPlaying(false); state.pausedAt = 0; for (const m of state.media.values()) if (m.kind === "video") try { m.element.currentTime = 0; } catch {}; break;
      case "next": nextScene(); break;
      case "prev": prevScene(); break;
      case "goto-scene": gotoScene(id); break;
      case "add-scene": {
        const sc = P.createScene("Escena " + (state.project.scenes.length + 1));
        state.project.scenes.push(sc); gotoScene(sc.id); markDirty();
        break;
      }
      case "dup-scene": {
        const sc = state.project.scenes.find(s => s.id === id);
        if (sc) { const c = P.cloneScene(sc, state.project.surfaces); state.project.scenes.push(c); gotoScene(c.id); markDirty(); }
        break;
      }
      case "del-scene": {
        if (state.project.scenes.length <= 1) { alert("Debe existir al menos una escena."); break; }
        state.project.scenes = state.project.scenes.filter(s => s.id !== id);
        if (state.project.currentSceneId === id) state.project.currentSceneId = state.project.scenes[0].id;
        markDirty(); renderAll(state, actions);
        break;
      }
      case "rename-scene": break; // se maneja con dblclick
      case "scene-autonext": break; // checkbox change
      case "add-surface-quad": addSurface("quad"); break;
      case "add-surface-poly": addSurface("poly"); break;
      case "select-surface": state.selectedSurfaceId = id; renderAll(state, actions); break;
      case "select-media": state.selectedMediaId = id; renderAll(state, actions); break;
      case "remove-media": {
        const m = state.media.get(id);
        if (m && !confirm(`¿Eliminar "${m.name}"?`)) break;
        if (m) { try { m.element && m.element.pause && m.element.pause(); } catch {}; URL.revokeObjectURL(m.objectUrl); state.media.delete(id); }
        for (const s of state.project.surfaces) if (s.mediaId === id) s.mediaId = null;
        renderer.releaseMedia(id);
        markDirty(); renderAll(state, actions);
        break;
      }
      case "toggle-hidden": {
        const s = state.project.surfaces.find(x => x.id === id); if (s) { s.hidden = !s.hidden; markDirty(); renderAll(state, actions); }
        break;
      }
      case "toggle-locked": {
        const s = state.project.surfaces.find(x => x.id === id); if (s) { s.locked = !s.locked; markDirty(); renderAll(state, actions); }
        break;
      }
      case "layer-up": case "layer-down": {
        const sc = state.project.scenes.find(s => s.id === state.project.currentSceneId);
        const i = sc.layers.findIndex(l => l.surfaceId === id);
        const j = btn.dataset.action === "layer-up" ? i - 1 : i + 1;
        if (i >= 0 && j >= 0 && j < sc.layers.length) { [sc.layers[i], sc.layers[j]] = [sc.layers[j], sc.layers[i]]; markDirty(); renderAll(state, actions); }
        break;
      }
      case "remove-layer": {
        const sc = state.project.scenes.find(s => s.id === state.project.currentSceneId);
        sc.layers = sc.layers.filter(l => l.surfaceId !== id);
        markDirty(); renderAll(state, actions);
        break;
      }
      case "dup-surface": {
        const s = state.project.surfaces.find(x => x.id === state.selectedSurfaceId);
        if (s) { const c = P.cloneSurface(s); c.name = s.name + " copia"; state.project.surfaces.push(c); state.selectedSurfaceId = c.id; markDirty(); renderAll(state, actions); }
        break;
      }
      case "del-surface": {
        const s = state.project.surfaces.find(x => x.id === state.selectedSurfaceId);
        if (s && confirm(`¿Eliminar "${s.name}"?`)) {
          state.project.surfaces = state.project.surfaces.filter(x => x.id !== s.id);
          for (const sc of state.project.scenes) sc.layers = sc.layers.filter(l => l.surfaceId !== s.id);
          state.selectedSurfaceId = null; markDirty(); renderAll(state, actions);
        }
        break;
      }
      case "mask-draw": startMaskDraw(); break;
      case "mask-clear": {
        const s = state.project.surfaces.find(x => x.id === state.selectedSurfaceId);
        if (s) { s.mask.points = []; s.mask.enabled = false; markDirty(); renderAll(state, actions); }
        break;
      }
      case "mask-finish": finishMask(); break;
      case "mask-cancel": state.maskEditing = false; state.maskTemp = []; renderAll(state, actions); break;
      case "output": openOutput(); break;
      case "pattern": setPattern(btn.dataset.pattern); break;
      case "mode-toggle": {
        const st = state.project.settings;
        st.mode = st.mode === "pro" ? "simple" : "pro";
        markDirty(); renderAll(state, actions);
        break;
      }
      case "transition": {
        state.project.settings.transition = btn.dataset.kind;
        markDirty(); renderAll(state, actions);
        break;
      }
      case "tl-toggle": {
        const sc = state.project.scenes.find(s => s.id === state.project.currentSceneId);
        if (sc) {
          if (!sc.timeline) sc.timeline = createTimeline();
          sc.timeline.enabled = !sc.timeline.enabled;
          markDirty(); renderAll(state, actions);
        }
        break;
      }
      case "tl-add-clip": {
        const sc = state.project.scenes.find(s => s.id === state.project.currentSceneId);
        const surf = state.project.surfaces.find(x => x.id === state.selectedSurfaceId);
        const med = state.media.get(state.selectedMediaId);
        if (!sc || !surf || !med) { alert("Selecciona una superficie (Capas/canvas) y un medio (Biblioteca) antes de añadir un clip."); break; }
        if (!sc.timeline) sc.timeline = createTimeline();
        sc.timeline.enabled = true;
        const start = sc.timeline.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
        const clip = createClip({ surfaceId: surf.id, mediaId: med.id, start, duration: med.duration || 5 });
        sc.timeline.clips.push(clip);
        state.selectedClipId = clip.id;
        markDirty(); renderAll(state, actions);
        break;
      }
      case "tl-select-clip": state.selectedClipId = id; renderAll(state, actions); break;
      case "tl-split": {
        const sc = state.project.scenes.find(s => s.id === state.project.currentSceneId);
        const clip = sc?.timeline?.clips.find(c => c.id === state.selectedClipId);
        if (!clip) break;
        const parts = splitClip(clip, playhead());
        if (!parts) { alert("El playhead debe estar dentro del clip para dividirlo."); break; }
        const i = sc.timeline.clips.indexOf(clip);
        sc.timeline.clips.splice(i, 1, ...parts);
        state.selectedClipId = parts[1].id;
        markDirty(); renderAll(state, actions);
        break;
      }
      case "tl-del-clip": {
        const sc = state.project.scenes.find(s => s.id === state.project.currentSceneId);
        if (sc?.timeline) sc.timeline.clips = sc.timeline.clips.filter(c => c.id !== id);
        state.selectedClipId = null;
        markDirty(); renderAll(state, actions);
        break;
      }
      case "tl-seek": {
        const t = Number(btn.dataset.t) || 0;
        state.pausedAt = t;
        if (state.playing) state.playStart = now() - t;
        break;
      }
      case "midi": {
        initMIDI({
          onAction: (a, v) => {
            if (a === "play") setPlaying(true);
            else if (a === "pause") setPlaying(false);
            else if (a === "stop") actionsStop();
            else if (a === "next") nextScene();
            else if (a === "prev") prevScene();
            else if (a === "goto") { const sc = state.project.scenes[v]; if (sc) gotoScene(sc.id); }
            else if (a === "brightness") state.masterBrightness = v;
            else if (a === "opacity") {
              const s = state.project.surfaces.find(x => x.id === state.selectedSurfaceId);
              if (s) s.opacity = v;
            }
          },
          onStatus: st => { state.netStatus = st; renderAll(state, actions); },
        });
        break;
      }
      case "screens": {
        (async () => {
          const r = await listScreens();
          if (!r.ok) { alert(r.reason); return; }
          if (r.screens.length <= 1) { alert("Solo se detecta una pantalla. Conecta el proyector y vuelve a intentarlo."); return; }
          const list = r.screens.map((s, i) => `${i + 1}. ${s.label} (${s.width}×${s.height}${s.primary ? ", principal" : ""})`).join("\n");
          const pick = prompt("Pantallas detectadas:\n\n" + list + "\n\nNúmero de la pantalla de salida:", String(r.screens.length));
          if (pick == null) return;
          const sc = r.screens[Number(pick) - 1];
          if (sc && !openOutputOnScreen(sc)) alert("El navegador bloqueó la ventana. Permite ventanas emergentes para este sitio.");
        })();
        break;
      }
      case "automap": {
        $("#mapInput").click();
        break;
      }
      case "resolution": {
        const w = Number(prompt("Anchura del lienzo (px):", state.project.width));
        const h = Number(prompt("Altura del lienzo (px):", state.project.height));
        if (w >= 320 && h >= 240 && w <= 7680 && h <= 4320) {
          state.project.width = w; state.project.height = h; markDirty(); syncOutput(); renderAll(state, actions);
        } else if (w || h) alert("Resolución fuera de rango (320×240 .. 7680×4320).");
        break;
      }
    }
  });
  // cambios en checkbox de escena (delegación por change)
  document.body.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.action === "scene-autonext") {
      const sc = state.project.scenes.find(s => s.id === t.dataset.id);
      if (sc) { sc.autoplayNext = t.checked; markDirty(); }
    }
  });
  // renombrar escena con doble clic
  document.body.addEventListener("dblclick", (e) => {
    const t = e.target.closest('[data-action="rename-scene"]');
    if (!t) return;
    const sc = state.project.scenes.find(s => s.id === t.dataset.id);
    if (sc) { const n = prompt("Nombre de la escena:", sc.name); if (n) { sc.name = n; markDirty(); renderAll(state, actions); } }
  });
}

function addSurface(type) {
  const W = state.project.width, H = state.project.height;
  const s = P.createSurface({ type, name: (type === "quad" ? "Quad" : "Polígono") + " " + (state.project.surfaces.length + 1), x: W * 0.35, y: H * 0.3, w: W * 0.3, h: H * 0.4 });
  state.project.surfaces.push(s);
  const sc = state.project.scenes.find(x => x.id === state.project.currentSceneId);
  sc.layers.push({ id: P.uid("layer"), surfaceId: s.id });
  state.selectedSurfaceId = s.id;
  markDirty(); renderAll(state, actions);
}

function startMaskDraw() {
  const s = state.project.surfaces.find(x => x.id === state.selectedSurfaceId);
  if (!s) return;
  state.maskEditing = true;
  state.maskTemp = [];
  renderAll(state, actions);
}

function finishMask() {
  const s = state.project.surfaces.find(x => x.id === state.selectedSurfaceId);
  if (!s || state.maskTemp.length < 3) { state.maskEditing = false; state.maskTemp = []; renderAll(state, actions); return; }
  // convertir a UV local del bounding box de la superficie
  const bb = surfaceBBox(s);
  s.mask.points = state.maskTemp.map(p => ({
    x: Math.max(0, Math.min(1, (p.x - bb.x) / Math.max(bb.w, 1))),
    y: Math.max(0, Math.min(1, (p.y - bb.y) / Math.max(bb.h, 1))),
  }));
  s.mask.enabled = true;
  state.maskEditing = false; state.maskTemp = [];
  markDirty(); renderAll(state, actions);
}

/* ---------------- Drag & drop global de archivos ---------------- */

async function runAutoMap(file) {
  try {
    state.netStatus = "auto-mapping: analizando…";
    renderAll(state, actions);
    const quads = await detectFromImageFile(file);
    if (!quads.length) {
      alert("Auto-mapping: no se detectaron superficies claras.\n\nConsejos: foto con contraste (superficie iluminada sobre fondo oscuro), sin reflejos, encuadre frontal. Puedes crear la superficie manualmente en cualquier caso.");
      state.netStatus = "auto-mapping: sin resultados";
      renderAll(state, actions);
      return;
    }
    const W = state.project.width, H = state.project.height;
    quads.slice(0, 6).forEach((q, i) => {
      const s = P.createSurface({
        type: "poly", name: "Auto " + (i + 1),
        x: 0, y: 0, w: 100, h: 100,
      });
      s.points = q.points.map(p => ({ x: p.x * W, y: p.y * H }));
      state.project.surfaces.push(s);
      const sc = state.project.scenes.find(x => x.id === state.project.currentSceneId);
      sc.layers.push({ id: P.uid("layer"), surfaceId: s.id });
      if (i === 0) state.selectedSurfaceId = s.id;
    });
    state.netStatus = `auto-mapping: ${quads.length} superficie(s) detectada(s) — corrige manualmente`;
    markDirty(); syncOutput(); renderAll(state, actions);
  } catch (e) {
    alert("Auto-mapping falló: " + e.message);
    state.netStatus = "auto-mapping: error";
    renderAll(state, actions);
  }
}

function bindGlobalDrop() {
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    if (e.dataTransfer.files.length) importFiles(e.dataTransfer.files);
  });
}

/* ---------------- OUTPUT / MODO PRESENTACIÓN ---------------- */

const bc = "BroadcastChannel" in window ? new BroadcastChannel("lumap-output") : null;

function openOutput() {
  if (state.outputWin && !state.outputWin.closed) { state.outputWin.focus(); return; }
  state.outputWin = window.open("/output.html", "lumapOutput", "width=960,height=540");
  setTimeout(syncOutput, 800); // da tiempo a cargar
  setTimeout(syncOutput, 2500);
}

async function syncOutput() {
  if (!bc) return;
  if (state.outputWin && state.outputWin.closed) state.outputWin = null;
  try {
    const doc = await buildDoc();
    bc.postMessage({ kind: "project", doc });
    bc.postMessage({ kind: "state", currentSceneId: state.project.currentSceneId, playing: state.playing, masterBrightness: state.masterBrightness, pattern: state.pattern, playStart: state.playStart });
  } catch { /* output sin sincronizar en este ciclo */ }
}

function setPattern(pattern) {
  state.pattern = state.pattern === pattern ? null : pattern;
  syncOutput();
}

/* ---------------- Control remoto (WebSocket vía backend) ---------------- */

let remote = null;
function connectRemote() {
  if (location.protocol === "file:") { state.netStatus = "servidor no iniciado"; return; }
  remote = new Remote({
    role: "display", name: "LumaMap Web (" + (navigator.platform || "web") + ")",
    onControl: (msg) => {
      const v = msg.value;
      switch (msg.action) {
        case "play": setPlaying(true); break;
        case "pause": setPlaying(false); break;
        case "stop": actionsStop(); break;
        case "next": nextScene(); break;
        case "prev": prevScene(); break;
        case "goto": {
          const sc = state.project.scenes[Number(v)];
          if (sc) gotoScene(sc.id);
          break;
        }
        case "brightness": state.masterBrightness = Math.max(0, Math.min(1, Number(v))); break;
        case "opacity": {
          const s = state.project.surfaces.find(x => x.id === state.selectedSurfaceId);
          if (s) { s.opacity = Math.max(0, Math.min(1, Number(v))); markDirty(); }
          break;
        }
      }
    },
    onStatus: (st) => { state.netStatus = st; const el = $("#stNet"); if (el) el.textContent = st; },
  });
  remote.connect();
}
function actionsStop() {
  setPlaying(false); state.pausedAt = 0; state.playStart = now();
  for (const m of state.media.values()) if (m.kind === "video") try { m.element.currentTime = 0; } catch {}
}

function broadcastState() {
  if (remote && remote.ws && remote.ws.readyState === 1) {
    const scene = state.project.scenes.find(s => s.id === state.project.currentSceneId);
    remote.sendState({
      scene: scene ? scene.name : "-",
      sceneIndex: state.project.scenes.findIndex(s => s.id === state.project.currentSceneId),
      sceneCount: state.project.scenes.length,
      playing: state.playing,
      fps: Math.round(state.fps),
      resolution: `${state.project.width}x${state.project.height}`,
      project: state.project.name,
    });
  }
}

init().catch(e => {
  document.body.insertAdjacentHTML("beforeend", `<div class="fatal"><h1>Error al iniciar</h1><p>${e.message}</p></div>`);
  console.error(e);
});
