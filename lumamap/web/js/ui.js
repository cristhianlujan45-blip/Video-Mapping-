// web/js/ui.js
// Construcción de la interfaz: media library, capas, escenas, propiedades,
// timeline y barra de estado. Render declarativo + delegación de eventos.
import { FX_PRESETS } from "/web/js/project.js";
import { sceneTlEnd } from "/web/js/timeline.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function fmtBytes(b) {
  if (!b && b !== 0) return "-";
  if (b < 1024) return b + " B";
  if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
  return (b / 1048576).toFixed(1) + " MB";
}
function fmtDur(s) {
  if (!s) return "-";
  const m = Math.floor(s / 60), ss = Math.floor(s % 60);
  return `${m}:${String(ss).padStart(2, "0")}`;
}

/* ---------------- Biblioteca de medios ---------------- */

export function renderMediaLibrary(state, actions) {
  const el = document.getElementById("mediaList");
  const items = [...state.media.values()];
  el.innerHTML = items.length ? items.map(m => `
    <div class="media-item ${state.selectedMediaId === m.id ? "selected" : ""}"
         data-action="select-media" data-id="${m.id}" draggable="true" data-drag="media" data-drag-id="${m.id}">
      <img class="thumb" src="${m.thumb || ""}" alt="">
      <div class="mi-body">
        <div class="mi-name" title="${esc(m.name)}">${esc(m.name)}</div>
        <div class="mi-meta">${m.kind.toUpperCase()} · ${m.width || "?"}×${m.height || "?"} · ${fmtDur(m.duration)} · ${fmtBytes(m.size)}</div>
      </div>
      <button class="mi-del" data-action="remove-media" data-id="${m.id}" title="Eliminar">×</button>
    </div>`).join("")
    : `<div class="panel-empty">Sin medios. Importa imágenes o videos (PNG, JPG, WEBP, SVG, MP4, WebM, GIF).</div>`;
  el.querySelectorAll(".media-item").forEach(item => {
    item.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/lumap-media", item.dataset.id);
    });
  });
}

/* ---------------- Capas de la escena actual ---------------- */

export function renderLayers(state, actions) {
  const el = document.getElementById("layersList");
  const scene = state.project.scenes.find(s => s.id === state.project.currentSceneId);
  if (!scene) { el.innerHTML = ""; return; }
  const surf = (id) => state.project.surfaces.find(s => s.id === id);
  el.innerHTML = scene.layers.map((layer, i) => {
    const s = surf(layer.surfaceId);
    if (!s) return "";
    const sel = state.selectedSurfaceId === s.id;
    return `
    <div class="layer-row ${sel ? "selected" : ""} ${s.hidden ? "is-hidden" : ""}" data-action="select-surface" data-id="${s.id}">
      <button class="lr-vis" data-action="toggle-hidden" data-id="${s.id}" title="Mostrar/ocultar">${s.hidden ? "🚫" : "👁"}</button>
      <button class="lr-lock" data-action="toggle-locked" data-id="${s.id}" title="Bloquear">${s.locked ? "🔒" : "🔓"}</button>
      <span class="lr-name">${esc(s.name)}</span>
      <button class="lr-up" data-action="layer-up" data-id="${s.id}" title="Subir capa">▲</button>
      <button class="lr-dn" data-action="layer-down" data-id="${s.id}" title="Bajar capa">▼</button>
      <button class="lr-del" data-action="remove-layer" data-id="${s.id}" title="Quitar de la escena">×</button>
    </div>`;
  }).join("") + `<button class="btn wide" data-action="add-surface-quad">+ Superficie quad</button>
     <button class="btn wide" data-action="add-surface-poly">+ Superficie polígono</button>`;
}

/* ---------------- Escenas + timeline ---------------- */

export function renderScenes(state) {
  const el = document.getElementById("scenesList");
  el.innerHTML = state.project.scenes.map((sc, i) => `
    <div class="scene-row ${sc.id === state.project.currentSceneId ? "selected" : ""}"
         data-action="goto-scene" data-id="${sc.id}" draggable="true" data-drag="scene" data-drag-id="${sc.id}">
      <span class="sc-num">${i + 1}</span>
      <span class="sc-name" data-action="rename-scene" data-id="${sc.id}" title="Doble clic para renombrar">${esc(sc.name)}</span>
      <label class="sc-auto" title="Avanzar a la siguiente al terminar los videos"><input type="checkbox" data-action="scene-autonext" data-id="${sc.id}" ${sc.autoplayNext ? "checked" : ""}>⏭</label>
      <button class="sc-dup" data-action="dup-scene" data-id="${sc.id}">⧉</button>
      <button class="sc-del" data-action="del-scene" data-id="${sc.id}">×</button>
    </div>`).join("") + `<button class="btn wide" data-action="add-scene">+ Escena</button>`;
}

export function renderTimeline(state) {
  const el = document.getElementById("timelineScenes");
  const sc = state.project.scenes.find(s => s.id === state.project.currentSceneId);
  if (!sc) { el.innerHTML = ""; return; }
  const tl = sc.timeline;
  const enabled = tl && tl.enabled;
  const end = Math.max(sceneTlEnd(sc), 10);
  const pxPerSec = 100 / end; // ticks cada 100px ≈ cada segundo visible
  let ticks = "";
  for (let t = 0; t <= end + 0.5; t += 1) {
    ticks += `<span class="tl-tick" style="left:${t * pxPerSec}px">${t % 5 === 0 ? t + "s" : ""}</span>`;
  }
  const playheadPos = Math.min(state.playing
    ? (performance.now() / 1000 - state.playStart)
    : state.pausedAt, end) * pxPerSec;
  const rows = new Map();
  (tl?.clips || []).forEach(c => {
    if (!rows.has(c.surfaceId)) rows.set(c.surfaceId, []);
    rows.get(c.surfaceId).push(c);
  });
  const surfName = (id) => state.project.surfaces.find(s => s.id === id)?.name || "?";
  el.innerHTML = `
    <div class="tl-scenes">${state.project.scenes.map((x, i) =>
      `<button class="tl-scene-btn ${x.id === sc.id ? "selected" : ""}" data-action="goto-scene" data-id="${x.id}">${i + 1}</button>`).join("")}
    </div>
    <div class="tl-editor ${enabled ? "" : "disabled"}">
      <div class="tl-toolbar">
        <button class="btn sm" data-action="tl-toggle">${enabled ? "Timeline: ON" : "Timeline: OFF"}</button>
        ${enabled ? `<button class="btn sm" data-action="tl-add-clip">+ Clip</button>
        <button class="btn sm" data-action="tl-split">✂ Dividir en playhead</button>` : ""}
        <span class="tl-hint">${enabled ? "Clic en regla = seek · clic en clip = seleccionar" : "Activa el timeline para montar clips con cortes, in/out, velocidad y loops"}</span>
      </div>
      ${enabled ? `
      <div class="tl-ruler" data-action="tl-seek">${ticks}
        <span class="tl-playhead" style="left:${playheadPos}px"></span>
      </div>
      <div class="tl-tracks">${[...rows.entries()].map(([sid, clips]) => `
        <div class="tl-track">
          <span class="tl-track-name">${esc(surfName(sid))}</span>
          <div class="tl-track-lane" style="width:${end * pxPerSec}px">
            ${clips.map(c => `
              <div class="tl-clip ${state.selectedClipId === c.id ? "selected" : ""}"
                   data-action="tl-select-clip" data-id="${c.id}"
                   style="left:${c.start * pxPerSec}px; width:${Math.max(c.duration * pxPerSec, 8)}px">
                <span>${esc(state.media.get(c.mediaId)?.name || "medio perdido")}</span>
                <button class="tl-clip-del" data-action="tl-del-clip" data-id="${c.id}">×</button>
              </div>`).join("")}
          </div>
        </div>`).join("")}
        ${!rows.size ? `<div class="panel-empty">Sin clips. Selecciona superficie + medio y pulsa + Clip.</div>` : ""}
      </div>` : ""}
    </div>`;
  el.querySelectorAll(".tl-ruler").forEach(r => r.addEventListener("click", (e) => {
    if (e.target.closest(".tl-clip")) return;
    const rect = r.getBoundingClientRect();
    const t = Math.max(0, (e.clientX - rect.left) / pxPerSec);
    r.dispatchEvent(new CustomEvent("tl-seek-go", { bubbles: true, detail: t }));
    // delegación directa: llamamos a la acción vía dataset temporal
    const btn = document.createElement("button");
    btn.dataset.action = "tl-seek"; btn.dataset.t = String(t);
    document.body.appendChild(btn); btn.click(); btn.remove();
  }));
}

function sceneDuration(scene, state) {
  let d = 0;
  for (const l of scene.layers) {
    const s = state.project.surfaces.find(x => x.id === l.surfaceId);
    if (!s || !s.mediaId) continue;
    const m = state.media.get(s.mediaId);
    if (m && m.kind === "video") d = Math.max(d, m.duration || 0);
  }
  return d;
}

/* ---------------- Propiedades de superficie ---------------- */

export function renderProperties(state) {
  const el = document.getElementById("propsBody");
  const s = state.project.surfaces.find(x => x.id === state.selectedSurfaceId);
  if (!s) { el.innerHTML = `<div class="panel-empty">Selecciona una superficie en el canvas o en Capas.</div>`; return; }
  const f = s.fx;
  const bbox = surfaceBBox(s);
  const mediaName = s.mediaId && state.media.get(s.mediaId) ? state.media.get(s.mediaId).name : "—";
  const maskMode = state.maskEditing ? `<div class="mask-banner">Dibujando máscara: haz clic en el canvas para añadir puntos. <button class="btn" data-action="mask-finish">Cerrar máscara</button> <button class="btn" data-action="mask-cancel">Cancelar</button></div>` : "";
  el.innerHTML = `${maskMode}
  <div class="prop-group">
    <div class="prop-title">Superficie</div>
    <label>Nombre <input data-prop="name" value="${esc(s.name)}"></label>
    <label>Tipo <select data-prop="type" ${s.points.length !== 4 ? "disabled" : ""}>
      <option value="quad" ${s.type === "quad" ? "selected" : ""}>Quad (corner pin)</option>
      <option value="poly" ${s.type === "poly" ? "selected" : ""}>Polígono libre</option></select></label>
    <label>Medio <select data-prop="mediaId">
      <option value="">— sin medio —</option>
      ${[...state.media.values()].map(m => `<option value="${m.id}" ${s.mediaId === m.id ? "selected" : ""}>${esc(m.name)}</option>`).join("")}
    </select></label>
    <div class="prop-row2">
      <label>X <input type="number" data-move="x" value="${Math.round(bbox.x)}"></label>
      <label>Y <input type="number" data-move="y" value="${Math.round(bbox.y)}"></label>
      <label>Escala % <input type="number" data-move="scale" value="100"></label>
      <label>Rotación° <input type="number" data-move="rot" value="0"></label>
    </div>
    <div class="prop-hint">En el canvas: arrastra vértices · doble clic en arista añade punto · clic derecho en punto lo borra.</div>
  </div>
  <div class="prop-group">
    <div class="prop-title">Apariencia</div>
    <label>Opacidad <input type="range" min="0" max="1" step="0.01" data-fx="opacity" value="${s.opacity}"></label>
    <label>Volumen <input type="range" min="0" max="1" step="0.01" data-fx="volume" value="${s.volume}"></label>
    <label>Blend <select data-fx="blend">
      ${["normal", "add", "multiply"].map(b => `<option ${s.blend === b ? "selected" : ""}>${b}</option>`).join("")}
    </select></label>
    <label>Tint RGB <input type="color" data-fx="tint" value="${rgbToHex(s.tint)}"></label>
  </div>
  <div class="prop-group">
    <div class="prop-title">Efectos (GPU, tiempo real)</div>
    <label>Preset <select data-preset>
      <option value="">— elegir —</option>
      ${Object.keys(FX_PRESETS).map(p => `<option>${p}</option>`).join("")}
    </select></label>
    ${slider("Brillo", "brightness", f.brightness, 0, 2)}
    ${slider("Contraste", "contrast", f.contrast, 0, 2)}
    ${slider("Saturación", "saturation", f.saturation, 0, 3)}
    ${slider("Tono (hue)", "hue", f.hue, 0, 1)}
    ${slider("RGB shift", "rgbShift", f.rgbShift, 0, 0.05, 0.0005)}
    ${slider("Ruido", "noise", f.noise, 0, 1)}
    ${slider("Pixelate", "pixelate", f.pixelate, 1, 64, 1)}
    ${slider("Desenfoque", "blur", f.blur, 0, 20, 0.5)}
    ${slider("Colorize amt", "colorizeAmt", f.colorizeAmt, 0, 1)}
    <label>Colorize <input type="color" data-fxcolor="colorize" value="${rgbToHex(f.colorize)}"></label>
    <label class="chk"><input type="checkbox" data-fxflag="invert" ${f.invert ? "checked" : ""}> Invertir</label>
  </div>
  <div class="prop-group">
    <div class="prop-title">Máscara</div>
    <label class="chk"><input type="checkbox" data-maskflag="enabled" ${s.mask.enabled ? "checked" : ""}> Activar máscara</label>
    <label class="chk"><input type="checkbox" data-maskflag="invert" ${s.mask.invert ? "checked" : ""}> Invertir máscara</label>
    ${slider("Feather", "feather", s.mask.feather, 0, 0.1, 0.001)}
    <div class="prop-row2">
      <button class="btn" data-action="mask-draw">${s.mask.points.length ? "Redibujar máscara" : "Dibujar máscara"}</button>
      <button class="btn" data-action="mask-clear">Borrar máscara</button>
    </div>
  </div>
  ${renderClipEditor(state)}
  <div class="prop-group">
    <div class="prop-title">Archivo</div>
    <div class="prop-row2">
      <button class="btn" data-action="dup-surface">Duplicar</button>
      <button class="btn" data-action="del-surface">Eliminar</button>
    </div>
  </div>`;
}

function renderClipEditor(state) {
  const sc = state.project.scenes.find(x => x.id === state.project.currentSceneId);
  if (!sc?.timeline?.enabled) return "";
  const clip = sc.timeline.clips.find(c => c.id === state.selectedClipId);
  if (!clip) return `<div class="prop-group"><div class="prop-title">Timeline</div>
    <div class="panel-empty">Selecciona un clip en el timeline para editarlo.</div></div>`;
  const num = (k, label, step = 0.1) =>
    `<label>${label} <input type="number" step="${step}" min="0" data-clip="${k}" value="${clip[k]}"></label>`;
  return `<div class="prop-group">
    <div class="prop-title">Clip</div>
    ${num("start", "Inicio (s)")}
    ${num("duration", "Duración (s)")}
    ${num("inPoint", "In-point (s)")}
    ${num("outPoint", "Out-point (s, 0=fin)")}
    ${num("speed", "Velocidad", 0.05)}
    <label class="chk"><input type="checkbox" data-clip="loop" ${clip.loop ? "checked" : ""}> Loop</label>
  </div>`;
}

function slider(label, key, val, min, max, step = 0.01) {
  return `<label>${label} <input type="range" min="${min}" max="${max}" step="${step}" data-fxkey="${key}" value="${val}"></label>`;
}
function rgbToHex(rgb) {
  return "#" + rgb.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0")).join("");
}
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
export { rgbToHex, hexToRgb, fmtDur };

function surfaceBBox(s) {
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (const p of s.points) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

/* ---------------- Barra de estado ---------------- */

export function renderStatus(state) {
  const el = document.getElementById("statusBar");
  const scene = state.project.scenes.find(s => s.id === state.project.currentSceneId);
  el.innerHTML = `
    <span class="st-item">${esc(state.project.name)}</span>
    <span class="st-item">${state.project.width}×${state.project.height}</span>
    <span class="st-item" id="stFps">${state.fps.toFixed(0)} FPS</span>
    <span class="st-item ${state.playing ? "ok" : ""}">${state.playing ? "▶ reproduciendo" : "⏸ detenido"}</span>
    <span class="st-item">Escena: ${esc(scene ? scene.name : "-")}</span>
    <span class="st-item">Red: <span id="stNet">${esc(state.netStatus)}</span></span>
    <span class="st-item ${state.dirty ? "warn" : ""}">${state.dirty ? "● sin guardar" : "guardado"}</span>`;
}

/** Renderiza toda la UI según estado. */
export function renderAll(state, actions) {
  renderMediaLibrary(state, actions);
  renderLayers(state, actions);
  renderScenes(state);
  renderTimeline(state);
  renderProperties(state);
  renderStatus(state);
  document.body.classList.toggle("mode-simple", state.project.settings.mode === "simple");
}
