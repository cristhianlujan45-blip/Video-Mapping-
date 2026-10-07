// web/js/editor.js
// Editor táctil de LumaMap: estado, gestos sobre el escenario, proyección,
// archivos, audio, MIDI y bucle de render. Los paneles están en panels.js.
import * as M from "./model.js";
import * as Store from "./store.js";
import { History } from "./history.js";
import { Renderer, webgl2Supported } from "./renderer.js";
import { Compositor, sceneLayers } from "./compose.js";
import { MediaPool, createRuntime, kindOf, getCamera, stopCamera } from "./sources.js";
import { AudioEngine } from "./audio.js";
import { Link, nativeBridge } from "./link.js";
import { drawGuides, drawPattern, applyOutputCSS, drawSoftEdge } from "./overlay.js";
import { roundPt, newStrokeId, hitStroke } from "./drawing.js";
import { icon } from "./icons.js";
import { h, btn, toast, dialog, closeDialog, prompt, confirmDlg, tiles } from "./ui.js";
import { PANELS, TABS, showHelp } from "./panels.js";
import { buildCommands, keymap, keyOf, openPalette, openContextMenu, closeContextMenu } from "./commands.js";
import {
  pointInPolygon, surfaceOutline, centroid, transformPoints, screenToUV, uvToScreen,
  simplify, bbox, gridCornerIdx, surfaceCorners, gridFromCorners, resampleGrid, surfaceAspect, edgeHandles, dragEdge,
} from "./math.js";
import { detectFromImageFile } from "./automap.js";
import { initMIDI } from "./midi.js";
import { Remote } from "./remote.js";
import * as Updater from "./updater.js";

const $ = (s) => document.querySelector(s);
const native = nativeBridge();
const DPR = () => Math.min(window.devicePixelRatio || 1, 2);

/* ======================================================================
   Estado
   ====================================================================== */
const S = {
  project: M.createProject(),
  sel: null,            // id de superficie seleccionada
  point: -1,            // índice del punto seleccionado (empujar con flechas)
  mode: "edit",         // edit | draw | shape | mask | preview
  shapeKind: "trace",   // trace | points
  draft: [],            // puntos del polígono en creación (px de proyecto)
  tab: null,            // panel abierto
  view: { zoom: 1, panX: 0, panY: 0 },
  playing: true,
  clock: 0,             // segundos de animación (avanza solo en reproducción)
  master: 1, blackout: false, pattern: null, guides: false, muted: false,
  tr: null,             // transición de escena {fromId, start, dur}
  sceneStart: 0,        // reloj en que empezó la escena actual (auto-avance)
  draw: { tool: "neon", color: "#00e5ff", width: 0.012, glow: 0.7, anim: "none", fill: false },
  live: null,           // trazo en curso
  linkCorners: true,    // arrastrar juntas las esquinas que coinciden
  fine: false,          // empuje fino
  projecting: false,    // salida a pantalla completa en este mismo dispositivo
  output: null,         // null | "window" | "native"
  outWin: null,
  extDisplays: 0,
  levels: { bass: 0, mid: 0, high: 0, level: 0, beat: 0 },
  ref: { url: null, opacity: 0.5, camera: false },
  dirty: true, saveDue: 0, lastState: 0, lastSync: 0, lastCount: 0, beatsInScene: 0,
};

const history = new History();
let renderer, pool, comp, link, audio;
const app = { S, M, history }; // API para los paneles
let KEYS = new Map();

/* ======================================================================
   Utilidades del proyecto
   ====================================================================== */
const scene = () => M.currentScene(S.project);
const surf = (id = S.sel) => S.project.surfaces.find(s => s.id === id) || null;
const lookSel = () => (S.sel ? M.lookOf(scene(), S.sel) : null);
app.scene = scene; app.surf = surf; app.lookSel = lookSel;

function changed({ panel = false } = {}) {
  S.dirty = true;
  S.saveDue = performance.now() + 1200;
  if (panel) renderPanel();
  updateChrome();
}
let commitTimer = 0;
function commit() {
  clearTimeout(commitTimer);
  history.commit(S.project);
  updateChrome();
}
function commitSoon() { clearTimeout(commitTimer); commitTimer = setTimeout(commit, 350); }
app.changed = changed; app.commit = commit; app.commitSoon = commitSoon;
/** Cambio en vivo desde un control: actualiza y registra en el historial al soltar. */
app.edit = (fn) => { fn(); changed(); commitSoon(); };

function setProject(p, { keepHistory = false } = {}) {
  S.project = M.normalizeProject(p);
  S.sel = S.project.surfaces.at(-1)?.id || null;
  S.point = -1; S.tr = null; S.sceneStart = S.clock;
  setMode("edit");
  if (!keepHistory) history.reset(S.project);
  for (const id of M.usedMediaIds(S.project)) pool.ensure(id);
  for (const id of [...pool.items.keys()]) if (!S.project.media.some(m => m.id === id)) pool.remove(id);
  renderer.meshCache.clear();
  fitView();
  changed({ panel: true });
}
app.setProject = setProject;

function select(id, { point = -1 } = {}) {
  if (S.sel !== id) { S.sel = id; S.point = point; renderPanel(); }
  else S.point = point;
  updateChrome();
}
app.select = select;

/* ======================================================================
   Acciones
   ====================================================================== */
const A = {};
app.actions = A;

A.undo = () => {
  const p = history.undo();
  if (p) { S.project = M.normalizeProject(p); fixSelection(); changed({ panel: true }); toast("Deshecho"); }
};
A.redo = () => {
  const p = history.redo();
  if (p) { S.project = M.normalizeProject(p); fixSelection(); changed({ panel: true }); toast("Rehecho"); }
};
function fixSelection() {
  if (S.sel && !surf()) S.sel = null;
  const s = surf();
  if (!s || S.point >= s.points.length) S.point = -1;
}

A.togglePlay = () => {
  S.playing = !S.playing;
  pool.setPlaying(S.playing);
  sendState(true);
  updateChrome();
};
A.restart = () => { pool.restart(); S.clock = 0; S.sceneStart = 0; link.send({ t: "restart" }); };

/** Centro del encuadre visible en coordenadas de proyecto. */
function viewCenter() {
  const v = currentView(), st = $("#stage").getBoundingClientRect(), d = DPR();
  const x = (st.width * d / 2 - v.tx) / v.sx, y = (st.height * d / 2 - v.ty) / v.sy;
  const P = S.project;
  return { x: Math.max(0, Math.min(P.width, x)), y: Math.max(0, Math.min(P.height, y)) };
}

A.addShape = (kind) => {
  const c = viewCenter(), r = S.project.height * 0.22;
  const s = M.SHAPES[kind].make(c.x, c.y, r);
  s.name = uniqueName(s.name);
  M.addSurface(S.project, s, { type: "gen", gen: "calib" });
  select(s.id);
  changed({ panel: true }); commit();
  toast(`${s.name} añadido · arrastra sus puntos`);
};

A.addMesh = () => {
  const c = viewCenter(), W = S.project.height * 0.6;
  const s = M.createQuad({ name: uniqueName("Malla"), corners: M.rectCorners(c.x - W * 0.66, c.y - W / 2, W * 1.33, W), cols: 4, rows: 3 });
  M.addSurface(S.project, s, { type: "gen", gen: "calib" });
  select(s.id); changed({ panel: true }); commit();
  toast("Malla añadida · mueve cualquier punto para curvar la imagen");
};

A.startShape = (kind) => {
  S.shapeKind = kind; S.draft = [];
  setMode("shape");
};

A.addTemplate = (key) => {
  const t = M.TEMPLATES[key].build();
  for (const s of t.surfaces) {
    s.name = uniqueName(s.name);
    S.project.surfaces.push(s);
    for (const other of S.project.scenes) other.looks[s.id] = JSON.parse(JSON.stringify(t.scenes[0].looks[s.id]));
  }
  if (t.surfaces.length) select(t.surfaces.at(-1).id);
  changed({ panel: true }); commit();
  toast(`${M.TEMPLATES[key].name} añadido`);
};

function uniqueName(base) {
  const names = new Set(S.project.surfaces.map(s => s.name));
  if (!names.has(base)) return base;
  let i = 2; while (names.has(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}

A.duplicate = () => {
  const c = M.duplicateSurface(S.project, S.sel, S.project.height * 0.04);
  if (c) { select(c.id); changed({ panel: true }); commit(); toast("Duplicado"); }
};
A.remove = async (id = S.sel) => {
  const s = surf(id);
  if (!s) return;
  M.removeSurface(S.project, id);
  renderer.forgetSurface(id);
  if (S.sel === id) { S.sel = S.project.surfaces.at(-1)?.id || null; S.point = -1; }
  changed({ panel: true }); commit();
  toast(`«${s.name}» eliminado · Deshacer para recuperarlo`);
};
A.toggleLock = (id = S.sel) => { const s = surf(id); if (s) { s.locked = !s.locked; changed({ panel: true }); commit(); } };
A.toggleHide = (id = S.sel) => { const s = surf(id); if (s) { s.hidden = !s.hidden; changed({ panel: true }); commit(); } };
A.moveLayer = (id, dir) => {
  const arr = S.project.surfaces, i = arr.findIndex(s => s.id === id);
  if (M.moveItem(arr, i, i + dir)) { changed({ panel: true }); commit(); }
};
A.rename = async (id = S.sel) => {
  const s = surf(id);
  if (!s) return;
  const n = await prompt("Nombre de la superficie", s.name);
  if (n && n.trim()) { s.name = n.trim(); changed({ panel: true }); commit(); }
};

/* ---- geometría ---- */
A.setMesh = (cols, rows) => {
  const s = surf();
  if (!s || s.type !== "quad") return;
  s.points = resampleGrid(s.points, s.cols, s.rows, cols, rows);
  s.cols = cols; s.rows = rows; S.point = -1;
  changed(); commitSoon();
};
A.straighten = () => {
  const s = surf();
  if (!s) return;
  const b = bbox(s.points);
  if (s.type === "quad") s.points = gridFromCorners(M.rectCorners(b.x, b.y, b.w, b.h), s.cols, s.rows);
  changed(); commit(); toast("Rectángulo restaurado");
};
A.flip = (axis) => {
  const s = surf();
  if (!s) return;
  const c = centroid(s.points);
  s.points = s.points.map(p => axis === "h" ? { x: 2 * c.x - p.x, y: p.y } : { x: p.x, y: 2 * c.y - p.y });
  if (s.type === "quad") {
    // Reordena la rejilla para que la imagen se refleje (no solo la forma).
    const out = [];
    for (let r = 0; r < s.rows; r++) for (let col = 0; col < s.cols; col++) {
      const rr = axis === "v" ? s.rows - 1 - r : r, cc = axis === "h" ? s.cols - 1 - col : col;
      out.push(s.points[rr * s.cols + cc]);
    }
    s.points = out;
  }
  changed(); commit();
};
A.rotate90 = () => {
  const s = surf();
  if (!s) return;
  s.points = transformPoints(s.points, centroid(s.points), 1, Math.PI / 2);
  changed(); commit();
};
A.fillFrame = () => {
  const s = surf();
  if (!s || s.type !== "quad") return;
  s.points = gridFromCorners(M.rectCorners(0, 0, S.project.width, S.project.height), s.cols, s.rows);
  changed(); commit(); toast("Ocupa toda la salida");
};

/* ---- máscara ---- */
A.editMask = () => {
  const s = surf();
  if (!s) return;
  s.mask.enabled = true;
  setMode("mask");
  changed();
};
A.clearMask = () => {
  const s = surf();
  if (!s) return;
  s.mask.points = []; s.mask.enabled = false;
  changed({ panel: true }); commit();
};

/* ---- contenido ---- */
A.setSource = (patch) => {
  const l = lookSel();
  if (!l) return;
  Object.assign(l.source, patch);
  if (patch.mediaId) pool.ensure(patch.mediaId);
  changed({ panel: true }); commit();
};
A.applyToAllScenes = () => {
  const l = lookSel();
  if (!l) return;
  for (const sc of S.project.scenes) sc.looks[S.sel] = JSON.parse(JSON.stringify(l));
  changed(); commit(); toast("Aplicado en todas las escenas");
};

/* ---- escenas ---- */
A.goScene = (id, { instant = false } = {}) => {
  if (id === S.project.sceneId) return;
  const target = S.project.scenes.find(s => s.id === id);
  if (!target) return;
  const dur = instant || target.transition === "cut" ? 0 : S.project.settings.transitionMs;
  S.tr = dur ? { fromId: S.project.sceneId, start: performance.now(), dur } : null;
  S.project.sceneId = id;
  S.sceneStart = S.clock;
  changed({ panel: true });
  link.send({ t: "project", project: outProject(), tr: S.tr ? { fromId: S.tr.fromId, elapsed: 0, dur } : null });
  S.dirty = false;
  commitSoon();
};
A.stepScene = (d) => {
  const arr = S.project.scenes, i = arr.findIndex(s => s.id === S.project.sceneId);
  let j = i + d;
  if (j >= arr.length) j = S.project.settings.loopScenes ? 0 : arr.length - 1;
  if (j < 0) j = S.project.settings.loopScenes ? arr.length - 1 : 0;
  A.goScene(arr[j].id);
};
A.addScene = () => {
  const c = M.duplicateScene(S.project, S.project.sceneId);
  A.goScene(c.id, { instant: true });
  commit();
  toast(`${c.name} creada (copia de la anterior)`);
};
A.removeScene = async (id) => {
  if (S.project.scenes.length < 2) return toast("Debe quedar al menos una escena");
  const sc = S.project.scenes.find(s => s.id === id);
  if (!(await confirmDlg("Eliminar escena", `¿Eliminar «${sc.name}»?`, "Eliminar"))) return;
  const i = S.project.scenes.indexOf(sc);
  S.project.scenes.splice(i, 1);
  if (S.project.sceneId === id) S.project.sceneId = S.project.scenes[Math.max(0, i - 1)].id;
  changed({ panel: true }); commit();
};
A.renameScene = async (id) => {
  const sc = S.project.scenes.find(s => s.id === id);
  const n = await prompt("Nombre de la escena", sc.name);
  if (n && n.trim()) { sc.name = n.trim(); changed({ panel: true }); commit(); }
};

/* ---- salida ---- */
A.blackout = () => { S.blackout = !S.blackout; sendState(true); updateChrome(); renderPanel(); };
A.setPattern = (p) => { S.pattern = S.pattern === p ? null : p; sendState(true); renderPanel(); };

/* ======================================================================
   Medios
   ====================================================================== */
async function makeThumb(rt) {
  const c = document.createElement("canvas");
  c.width = 192; c.height = 120;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, 192, 120);
  try {
    if (rt.kind === "video") {
      const v = rt.el;
      await new Promise(res => {
        const t = Math.min(1, (v.duration || 2) / 3);
        v.addEventListener("seeked", res, { once: true });
        setTimeout(res, 1500);
        try { v.currentTime = t; } catch { res(); }
      });
    }
    const src = rt.source(0);
    const w = rt.width || 192, hh = rt.height || 120, k = Math.max(192 / w, 120 / hh);
    ctx.drawImage(src, (192 - w * k) / 2, (120 - hh * k) / 2, w * k, hh * k);
    if (rt.kind === "video") rt.el.currentTime = 0;
  } catch {}
  return c.toDataURL("image/jpeg", 0.7);
}

/* Optimización automática de video al importar (versión de escritorio, con ffmpeg).
   En Android la hace la parte nativa antes de entregar el archivo. */
const OPT_KEY = "lumamap:autoOptimize";
app.autoOptimize = () => { try { return localStorage.getItem(OPT_KEY) !== "0"; } catch { return true; } };
app.setAutoOptimize = (on) => { try { localStorage.setItem(OPT_KEY, on ? "1" : "0"); } catch {} native?.setAutoOptimize?.(on); };
let progressHooked = false;
async function optimizeIfNeeded(file) {
  const D = window.LumaDesktop;
  if (!D?.optimizeVideo || !app.autoOptimize()) return file;
  if (!progressHooked) {
    progressHooked = true;
    D.onVideoProgress(({ pct }) => toast(`Optimizando video… ${Math.round(pct * 100)} %`));
  }
  toast(`Analizando ${file.name}…`);
  try {
    const r = await D.optimizeVideo(file, { width: S.project.width, height: S.project.height });
    if (!r.url) return file;
    const blob = await (await fetch(r.url)).blob();
    D.releaseVideo(r.url);
    const name = file.name.replace(/\.[^.]+$/, "") + ".mp4";
    const out = new File([blob], name, { type: "video/mp4" });
    const saved = file.size ? Math.round((1 - out.size / file.size) * 100) : 0;
    toast(`Video optimizado en ${(r.ms / 1000).toFixed(1)} s · ${r.reason}${saved > 0 ? ` · ${saved} % más liviano` : ""}`);
    return out;
  } catch (e) {
    toast("No se pudo optimizar, se usa el original: " + e.message, "err");
    return file;
  }
}

async function importMediaFiles(files) {
  const added = [];
  for (let file of files) {
    if (kindOf(file.type, file.name) === "video") file = await optimizeIfNeeded(file);
    const kind = kindOf(file.type, file.name);
    if (!kind) { toast(`Formato no soportado: ${file.name}`, "err"); continue; }
    toast(`Importando ${file.name}…`);
    const rec = { id: M.uid("med"), name: file.name, kind, mime: file.type, blob: file, size: file.size };
    try {
      const rt = await createRuntime(rec);
      rec.kind = rt.kind === "anim" ? "image" : rt.kind;
      rec.width = rt.width; rec.height = rt.height; rec.duration = rt.duration || 0;
      rec.thumb = await makeThumb(rt);
      await Store.putMedia(rec);
      pool.add(rt);
      S.project.media.push({ id: rec.id, name: rec.name, kind: rt.kind, mime: rec.mime, width: rec.width, height: rec.height, duration: rec.duration, size: rec.size, thumb: rec.thumb });
      link.send({ t: "media", id: rec.id });
      added.push(rec);
    } catch (e) {
      toast(e.message || String(e), "err");
    }
  }
  return added;
}

/** Importa y coloca: sobre la superficie seleccionada o en una nueva con la proporción del archivo. */
A.importMedia = async (target = "auto") => {
  const files = await pickFiles("#fileMedia");
  if (!files.length) return;
  const added = await importMediaFiles(files);
  if (!added.length) return;
  const first = added[0];
  if (target === "library") { changed({ panel: true }); commit(); toast(`${added.length} archivo(s) en la biblioteca`); return; }
  const l = lookSel();
  if (l && target !== "new") {
    l.source.type = "media"; l.source.mediaId = first.id;
  } else {
    const c = viewCenter(), hgt = S.project.height * 0.5, ar = (first.width || 16) / (first.height || 9);
    const s = M.createQuad({ name: uniqueName(first.name.replace(/\.[^.]+$/, "").slice(0, 24) || "Video"), corners: M.rectCorners(c.x - hgt * ar / 2, c.y - hgt / 2, hgt * ar, hgt) });
    M.addSurface(S.project, s, { type: "media", mediaId: first.id });
    select(s.id);
  }
  changed({ panel: true }); commit();
  toast(added.length > 1 ? `${added.length} archivos importados` : "Listo · ajusta las esquinas a la pared");
};

A.removeMedia = async (id) => {
  const m = S.project.media.find(x => x.id === id);
  if (!m) return;
  const used = M.usedMediaIds(S.project).has(id);
  if (!(await confirmDlg("Quitar de la biblioteca", used ? `«${m.name}» se usa en alguna superficie. ¿Quitarlo igualmente?` : `¿Quitar «${m.name}»?`, "Quitar"))) return;
  S.project.media = S.project.media.filter(x => x.id !== id);
  for (const sc of S.project.scenes) for (const l of Object.values(sc.looks))
    if (l.source.mediaId === id) { l.source.mediaId = null; l.source.type = "none"; }
  pool.remove(id); renderer.releaseTexture("m:" + id);
  changed({ panel: true }); commit();
};

function pickFiles(sel) {
  // Android optimiza los videos al elegirlos: necesita saber el tamaño de la salida.
  if (sel === "#fileMedia") { native?.setVideoTarget?.(S.project.width, S.project.height); native?.setAutoOptimize?.(app.autoOptimize()); }
  return new Promise((resolve) => {
    const input = $(sel);
    input.value = "";
    const onChange = () => { input.removeEventListener("change", onChange); resolve([...input.files]); };
    input.addEventListener("change", onChange);
    input.click();
  });
}
app.pickFiles = pickFiles;

/* ======================================================================
   Proyectos: guardar, abrir, exportar, importar
   ====================================================================== */
A.save = async (asNew = false) => {
  let name = S.project.name;
  if (asNew) {
    const n = await prompt("Guardar como", name + " copia");
    if (!n) return;
    name = S.project.name = n.trim();
  }
  try {
    await Store.saveProject(name, S.project);
    changed();
    toast(`Guardado «${name}»`);
  } catch (e) { toast("No se pudo guardar: " + e.message, "err"); }
};

A.open = async () => {
  const list = await Store.listProjects().catch(() => []);
  const body = h("div", { class: "list" });
  if (!list.length) body.append(h("p", { class: "hint" }, "Aún no hay proyectos guardados. Usa Menú → Guardar."));
  for (const p of list) {
    body.append(h("div", { class: "item" },
      h("div", { class: "badge", html: icon("folder") }),
      h("div", { class: "name" }, p.name, h("small", {}, `${p.surfaces} superficies · ${p.scenes} escenas · ${new Date(p.savedAt).toLocaleString()}`)),
      btn({ label: "Abrir", kind: "primary", onClick: async () => {
        const doc = await Store.loadProject(p.name);
        closeDialog();
        if (doc) { await keepCurrent(); setProject(doc); toast(`Abierto «${p.name}»`); }
      } }),
      btn({ ic: "trash", kind: "icon", title: "Eliminar", onClick: async (e) => {
        await Store.deleteProject(p.name);
        e.target.closest(".item").remove();
      } })));
  }
  await dialog({ title: "Abrir proyecto", content: body, wide: true });
};

/** Guarda en silencio el proyecto actual antes de reemplazarlo (nada se pierde). */
async function keepCurrent() {
  if (!S.project.surfaces.length) return;
  try { await Store.saveProject(S.project.name, S.project); } catch {}
}

A.newProject = async () => {
  const pick = await chooseTemplate("Nuevo proyecto", "El proyecto actual se guarda automáticamente en «Abrir».");
  if (!pick) return;
  await keepCurrent();
  setProject(M.TEMPLATES[pick].build());
  if (pick === "draw") openTab("draw");
};

function chooseTemplate(title, sub) {
  const items = [
    { id: "draw", label: "Dibujar en la pared", ic: "pen" },
    { id: "screen", label: "Pantalla", ic: "screen" },
    { id: "cube", label: "Cubo 3D", ic: "cube" },
    { id: "facade", label: "Fachada", ic: "building" },
    { id: "stage", label: "Escenario", ic: "stage" },
    { id: "blank", label: "Vacío", ic: "plus" },
  ];
  const content = h("div", {}, sub ? h("p", { class: "hint" }, sub) : null, tiles(items, { onPick: (id) => closeDialog(id), cols: 3 }));
  return dialog({ title, content, buttons: [] });
}

async function exportProject() {
  toast("Preparando archivo…");
  const media = [];
  for (const m of S.project.media) {
    const rec = await Store.getMedia(m.id);
    if (rec?.blob) media.push({ ...m, dataUrl: await Store.blobToDataURL(rec.blob) });
  }
  const doc = { format: "lumamap", version: M.VERSION, exportedAt: new Date().toISOString(), project: { ...S.project, media: S.project.media.map(({ thumb, ...m }) => m) }, media };
  const text = JSON.stringify(doc);
  const name = (S.project.name || "proyecto").replace(/[^\w\- áéíóúñÁÉÍÓÚÑ]/g, "_") + ".lumamap";
  if (native?.saveBegin) {
    native.saveBegin(name, "application/json");
    const CH = 512 * 1024;
    for (let i = 0; i < text.length; i += CH) native.saveChunk(text.slice(i, i + CH));
    native.saveEnd();
    return;
  }
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = h("a", { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast("Proyecto exportado con sus medios");
}
A.exportProject = () => exportProject().catch(e => toast("Error al exportar: " + e.message, "err"));

A.importProject = async () => {
  const [file] = await pickFiles("#fileProject");
  if (!file) return;
  try {
    const json = JSON.parse(await file.text());
    const doc = json.format === "lumamap" ? json.project : json;
    const media = json.format === "lumamap" ? json.media : (json.media || []);
    const metas = [];
    for (const m of media || []) {
      if (!m.dataUrl) continue;
      const blob = Store.dataURLToBlob(m.dataUrl);
      const rec = { id: m.id, name: m.name, kind: m.kind, mime: m.mime || blob.type, blob, width: m.width, height: m.height, duration: m.duration, size: blob.size };
      try {
        const rt = await createRuntime(rec);
        rec.thumb = await makeThumb(rt);
        pool.remove(rec.id); pool.add(rt);
      } catch {}
      await Store.putMedia(rec);
      metas.push({ id: rec.id, name: rec.name, kind: rec.kind, mime: rec.mime, width: rec.width, height: rec.height, duration: rec.duration, size: rec.size, thumb: rec.thumb });
    }
    doc.media = metas;
    await keepCurrent();
    setProject(doc);
    for (const m of metas) link.send({ t: "media", id: m.id });
    toast(`Importado «${S.project.name}»`);
  } catch (e) {
    toast("No se pudo importar: " + e.message, "err");
  }
};

A.setResolution = async () => {
  const P = S.project;
  const groups = M.RESOLUTIONS.map(g => ({ ...g, list: [...g.list] }));
  const extra = [];
  const ext = native?.externalSize ? native.externalSize() : "";
  if (ext && /^\d+x\d+$/.test(ext)) { const [w, hh] = ext.split("x").map(Number); extra.push([w, hh, "Proyector conectado"]); }
  const scr = [Math.round(screen.width * DPR()), Math.round(screen.height * DPR())].sort((a, b) => b - a);
  extra.push([scr[0], scr[1], "Esta pantalla"]);
  groups.unshift({ group: "Tus pantallas", list: extra });
  const wIn = h("input", { type: "number", class: "text-in", min: 64, max: 16384, value: P.width });
  const hIn = h("input", { type: "number", class: "text-in", min: 64, max: 16384, value: P.height });
  const content = h("div", {},
    h("p", { class: "hint" }, `Actual: ${P.width}×${P.height}. Usa la resolución nativa del proyector para la máxima nitidez; con varios proyectores, la suma de todos. Las superficies se reescalan solas.`),
    ...groups.map(g => h("div", {}, h("h4", { class: "res-group" }, g.group),
      tiles(g.list.map(([w, hh, label]) => ({ id: `${w}x${hh}`, label: `${label} · ${w}×${hh}`, ic: "screen" })), { value: `${P.width}x${P.height}`, onPick: (id) => closeDialog(id), cols: 2 }))),
    h("h4", { class: "res-group" }, "Personalizada"),
    h("div", { class: "row" }, wIn, h("span", {}, "×"), hIn,
      btn({ label: "Usar", kind: "primary", onClick: () => closeDialog(`${Math.round(+wIn.value)}x${Math.round(+hIn.value)}`) })));
  const pick = await dialog({ title: "Resolución de la composición", content, buttons: [{ label: "Cancelar", value: null }], wide: true });
  if (!pick) return;
  const [w, hh] = pick.split("x").map(Number);
  if (!(w >= 64 && hh >= 64 && w <= 16384 && hh <= 16384)) return toast("Resolución no válida (64 a 16384 px)", "err");
  const kx = w / P.width, ky = hh / P.height;
  for (const s of P.surfaces) s.points = s.points.map(p => ({ x: p.x * kx, y: p.y * ky }));
  P.width = w; P.height = hh;
  renderer.meshCache.clear();
  fitView(); changed({ panel: true }); commit();
  const fit = renderer.fitScale(w, hh, 1);
  toast(fit < 1 ? `Resolución ${w}×${hh} · tu GPU dibuja a ${Math.round(w * fit)}×${Math.round(hh * fit)} como máximo` : `Resolución ${w}×${hh}`);
};

A.detectFromPhoto = async () => {
  const [file] = await pickFiles("#filePhoto");
  if (!file) return;
  try {
    const quads = await detectFromImageFile(file);
    if (!quads.length) return toast("No se encontraron superficies claras. Prueba otra foto con buen contraste.", "err");
    const P = S.project;
    quads.slice(0, 6).forEach((q, i) => {
      const s = M.createQuad({ name: uniqueName("Detectada " + (i + 1)), corners: q.points.map(p => [p.x * P.width, p.y * P.height]) });
      M.addSurface(P, s, { type: "gen", gen: "calib" });
      S.sel = s.id;
    });
    changed({ panel: true }); commit();
    toast(`${Math.min(6, quads.length)} superficie(s) detectada(s) · ajústalas a mano`);
  } catch (e) { toast(e.message, "err"); }
};

/* ---- foto / cámara de referencia (solo en el editor) ---- */
A.refPhoto = async () => {
  const [file] = await pickFiles("#filePhoto");
  if (!file) return;
  if (S.ref.url) URL.revokeObjectURL(S.ref.url);
  S.ref.url = URL.createObjectURL(file);
  $("#refImg").src = S.ref.url;
  renderPanel(); toast("Foto de referencia: dibuja encima las formas de la pared");
};
A.refClear = () => {
  if (S.ref.url) URL.revokeObjectURL(S.ref.url);
  S.ref.url = null; $("#refImg").removeAttribute("src");
  if (S.ref.camera) A.refCamera(false);
  renderPanel();
};
A.refCamera = async (on) => {
  try {
    if (on) { const cam = await getCamera(); $("#refCam").srcObject = cam.stream; $("#refCam").play().catch(() => {}); }
    else { $("#refCam").srcObject = null; if (!S.project.scenes.some(sc => Object.values(sc.looks).some(l => l.source.type === "camera"))) stopCamera(); }
    S.ref.camera = on;
  } catch (e) { toast("Cámara no disponible: " + e.message, "err"); S.ref.camera = false; }
  renderPanel();
};

/* ======================================================================
   Audio y MIDI
   ====================================================================== */
A.toggleMic = async () => {
  try {
    if (audio.active) audio.stop();
    else {
      await audio.start();
      const R = S.project.settings.react;
      if (!R.enabled) { R.enabled = true; changed(); commit(); }
    }
    toast(audio.active ? "Micrófono activo · todo el mapping sigue el ritmo" : "Micrófono apagado (pulso por BPM)");
  } catch (e) { toast("Micrófono no disponible: " + e.message, "err"); }
  renderPanel();
};
A.tap = () => { const bpm = audio.tap(); S.project.settings.bpm = bpm; changed(); return bpm; };
A.scaleTempo = (k) => { const b = audio.scaleTempo(k); S.project.settings.bpm = Math.round(b); changed(); toast(`${Math.round(b)} BPM`); };
A.setBpm = (v) => { S.project.settings.bpm = Math.round(audio.setBpm(Math.round(v))); changed(); toast(`${S.project.settings.bpm} BPM`); };
A.midi = () => initMIDI({
  onStatus: (s) => toast(s),
  onAction: (a, v) => {
    if (a === "goto" && S.project.scenes[v]) A.goScene(S.project.scenes[v].id);
    else if (a === "play" && !S.playing) A.togglePlay();
    else if (a === "pause" && S.playing) A.togglePlay();
    else if (a === "stop") { if (S.playing) A.togglePlay(); A.restart(); }
    else if (a === "next") A.stepScene(1);
    else if (a === "prev") A.stepScene(-1);
    else if (a === "brightness") { S.master = v; sendState(true); }
    else if (a === "opacity") { const l = lookSel(); if (l) { l.opacity = v; changed(); } }
  },
});
app.audio = () => audio;

/* ======================================================================
   Proyección
   ====================================================================== */
function outProject() {
  const P = S.project;
  return { ...P, media: P.media.map(m => ({ id: m.id, name: m.name, kind: m.kind })) };
}

function sendState(force = false) {
  const now = performance.now();
  if (!force && now - S.lastState < 33) return;
  S.lastState = now;
  link.send({
    t: "state", time: S.clock,
    state: {
      playing: S.playing, master: S.master, blackout: S.blackout, pattern: S.pattern, guides: S.guides,
      sel: S.sel, point: S.point, levels: { ...S.levels }, muted: S.muted,
      live: S.live ? { surfaceId: S.live.surfaceId, sceneId: S.live.sceneId, stroke: S.live.stroke } : null,
    },
  });
}

function onLinkMsg(m) {
  if (m.t === "hello") {
    link.send({ t: "project", project: outProject() });
    sendState(true);
    if (!S.output && !native) S.output = "window";
    updateChrome();
  }
}

A.projectionSheet = () => openTab("output");

A.projectExternal = () => {
  if (!native) return;
  if (S.output === "native") { native.stopExternal(); S.output = null; updateChrome(); renderPanel(); return; }
  if (native.startExternal()) {
    S.output = "native";
    native.keepScreenOn?.(true);
    toast("Proyectando en la pantalla externa");
  } else toast("No hay pantalla externa. Conecta el proyector por HDMI / USB-C.", "err");
  updateChrome(); renderPanel();
};

A.openWindow = () => {
  if (S.outWin && !S.outWin.closed) { S.outWin.focus(); return; }
  S.outWin = window.open("output.html", "lumamap-output", "popup,width=1280,height=720");
  if (!S.outWin) return toast("El navegador bloqueó la ventana emergente. Permite ventanas emergentes.", "err");
  S.output = "window";
  toast("Arrastra la ventana al proyector y pulsa «Pantalla completa»");
  updateChrome();
};

A.projectHere = async (on = true) => {
  S.projecting = on;
  document.body.classList.toggle("projecting", on);
  if (on) {
    S.preMode = S.mode; setMode("preview");
    try { await document.documentElement.requestFullscreen?.(); } catch {}
    native?.setImmersive?.(true); native?.keepScreenOn?.(true);
    showProjbar();
    toast("Pantalla completa · toca para ver controles");
  } else {
    S.guides = false;
    setMode("edit");
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    native?.setImmersive?.(false);
    if (!S.output) native?.keepScreenOn?.(false);
  }
  fitView();
  updateChrome();
};

let projbarTimer = 0;
function showProjbar() {
  const bar = $("#projbar");
  bar.innerHTML = "";
  bar.append(
    btn({ ic: S.playing ? "pause" : "play", kind: "", onClick: () => { A.togglePlay(); showProjbar(); } }),
    btn({ ic: "left", onClick: () => { A.stepScene(-1); showProjbar(); } }),
    btn({ ic: "right", onClick: () => { A.stepScene(1); showProjbar(); } }),
    Object.assign(btn({ ic: "shape", title: "Ajustar en vivo", onClick: () => { S.guides = !S.guides; setMode(S.guides ? "edit" : "preview"); showProjbar(); } }), { className: S.guides ? "on" : "" }),
    btn({ ic: "close", title: "Salir", onClick: () => A.projectHere(false) }));
  bar.classList.add("show");
  clearTimeout(projbarTimer);
  projbarTimer = setTimeout(() => bar.classList.remove("show"), 3500);
}

/* ======================================================================
   Más acciones: copiar/pegar, alinear, orden, grabar, capturar
   ====================================================================== */
let clipSurface = null, clipLook = null;
A.copy = () => {
  const s = surf();
  if (!s) return;
  clipSurface = { surface: JSON.parse(JSON.stringify(s)), look: JSON.parse(JSON.stringify(lookSel())) };
  toast(`Copiado «${s.name}»`);
};
A.paste = () => {
  if (!clipSurface) return toast("Nada copiado (Ctrl+C sobre una superficie)");
  const c = JSON.parse(JSON.stringify(clipSurface.surface));
  c.id = M.uid("surf");
  c.name = uniqueName(c.name);
  const off = S.project.height * 0.04;
  c.points = c.points.map(p => ({ x: p.x + off, y: p.y + off }));
  M.addSurface(S.project, c, clipSurface.look.source);
  for (const sc of S.project.scenes) sc.looks[c.id] = JSON.parse(JSON.stringify(clipSurface.look));
  select(c.id); changed({ panel: true }); commit();
  toast("Pegado");
};
A.copyStyle = () => {
  const l = lookSel();
  if (!l) return;
  clipLook = JSON.parse(JSON.stringify({ fx: l.fx, audio: l.audio, opacity: l.opacity, blend: l.blend }));
  toast("Estilo copiado (efectos, mezcla y audio)");
};
A.pasteStyle = () => {
  const l = lookSel();
  if (!l || !clipLook) return toast(clipLook ? "Selecciona una superficie" : "Copia primero un estilo");
  Object.assign(l, JSON.parse(JSON.stringify(clipLook)));
  changed({ panel: true }); commit(); toast("Estilo pegado");
};
A.center = (axis = "both") => {
  const s = surf();
  if (!s || s.locked) return;
  const b = bbox(s.points), P = S.project;
  const dx = axis === "v" ? 0 : P.width / 2 - (b.x + b.w / 2), dy = axis === "h" ? 0 : P.height / 2 - (b.y + b.h / 2);
  for (const q of s.points) { q.x += dx; q.y += dy; }
  changed(); commit();
};
A.toFront = () => { const arr = S.project.surfaces, i = arr.findIndex(x => x.id === S.sel); if (i >= 0 && M.moveItem(arr, i, arr.length - 1)) { changed({ panel: true }); commit(); } };
A.toBack = () => { const arr = S.project.surfaces, i = arr.findIndex(x => x.id === S.sel); if (i >= 0 && M.moveItem(arr, i, 0)) { changed({ panel: true }); commit(); } };
A.selectNext = (d = 1) => {
  const arr = S.project.surfaces;
  if (!arr.length) return;
  const i = arr.findIndex(x => x.id === S.sel);
  select(arr[(i + d + arr.length) % arr.length].id);
};
A.zoom = (k) => { S.view.zoom = Math.max(0.3, Math.min(12, S.view.zoom * k)); };
/* ---- actualizaciones ---- */
A.checkUpdates = async (silent = false) => {
  const cur = Updater.currentVersion();
  if (cur.platform === "web") { if (!silent) { toast("Recargando la última versión…"); setTimeout(() => location.reload(), 600); } return; }
  if (!silent) toast("Buscando actualizaciones…");
  let remote;
  try { remote = await Updater.fetchLatest(); }
  catch (e) { if (!silent) toast("No se pudo buscar: " + e.message, "err"); return; }
  if (!Updater.isNewer(remote, cur)) { if (!silent) toast(`Ya tienes la última versión (${cur.version})`); return; }
  const go = await dialog({
    title: "Nueva versión disponible",
    content: h("div", {}, h("p", {}, `Tienes la ${cur.version} y está disponible la ${remote.version}.`),
      remote.notes ? h("p", { class: "hint" }, remote.notes) : null,
      h("p", { class: "hint" }, cur.platform === "android"
        ? "Se descargará y Android te pedirá confirmar con «Actualizar». Tus proyectos se conservan."
        : "Se descargará e instalará sola; LumaMap se reiniciará. Tus proyectos se conservan.")),
    buttons: [{ label: "Más tarde", value: false }, { label: "Actualizar", kind: "primary", value: true }],
  });
  if (!go) return;
  await Store.saveProject(Store.AUTOSAVE, S.project).catch(() => {});
  toast("Descargando actualización…");
  try { await Updater.install(remote, (p) => toast(`Descargando actualización… ${Math.round(p * 100)} %`)); }
  catch (e) { toast("No se pudo actualizar: " + e.message, "err"); }
};
app.version = () => Updater.currentVersion();
A.help = () => showHelp(app);
A.palette = () => openPalette(app);
A.toggleGuides = () => { S.guides = !S.guides; sendState(true); renderPanel(); toast(S.guides ? "Guías en el proyector" : "Guías ocultas"); };
A.toggleMute = () => { S.muted = !S.muted; renderPanel(); toast(S.muted ? "Sonido apagado" : "Sonido activado"); };
A.toggleReact = () => { const R = S.project.settings.react; R.enabled = !R.enabled; changed({ panel: true }); commit(); toast(R.enabled ? "Modo ritmo activado" : "Modo ritmo apagado"); };

/** Guarda un archivo: selector del sistema en Android, descarga en navegador/PC. */
async function saveBlob(name, blob) {
  if (native?.saveBegin && native.saveChunkBase64) {
    native.saveBegin(name, blob.type || "application/octet-stream");
    const CH = 3 * 256 * 1024; // múltiplo de 3: cada trozo es base64 válido por sí solo
    for (let i = 0; i < blob.size; i += CH) {
      const du = await Store.blobToDataURL(blob.slice(i, i + CH));
      native.saveChunkBase64(du.slice(du.indexOf(",") + 1));
    }
    native.saveEnd();
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
app.saveBlob = saveBlob;
const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

/** Renderizador aparte a la resolución de salida (para grabar o capturar sin la interfaz). */
function offscreenRenderer(preserve, height = 0) {
  const P = S.project;
  // Grabación: altura elegida (720p…4K) · captura: resolución completa (lo que admita la GPU).
  const k = Math.min(height ? height / P.height : 1, 4096 / P.width, 4096 / P.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(P.width * k / 2) * 2; canvas.height = Math.round(P.height * k / 2) * 2;
  const r = new Renderer(canvas, { preserve });
  return { canvas, r, comp: new Compositor(r, pool), view: { sx: canvas.width / P.width, sy: canvas.height / P.height, tx: 0, ty: 0 } };
}
function renderOff(o, now) {
  o.comp.frame(S.project, { layers: sceneLayers(S.project, S.tr, now), time: S.clock, levels: S.levels, view: o.view, master: S.master, blackout: S.blackout, clear: [0, 0, 0, 1], live: S.live });
}

A.snapshot = () => {
  const o = offscreenRenderer(true);
  renderOff(o, performance.now());
  o.canvas.toBlob((b) => { saveBlob(`lumamap-${stamp()}.png`, b); toast("Imagen guardada"); o.r.gl.getExtension("WEBGL_lose_context")?.loseContext(); }, "image/png");
};

A.record = () => {
  if (S.rec) {
    S.rec.mr.stop();
    return;
  }
  if (typeof MediaRecorder === "undefined") return toast("Este dispositivo no puede grabar video", "err");
  const rec = S.project.settings.record;
  const o = offscreenRenderer(false, rec.height);
  const stream = o.canvas.captureStream(rec.fps || 30);
  // Con el micrófono activo, el video incluye la música que se oye.
  if (audio.stream) for (const t of audio.stream.getAudioTracks()) stream.addTrack(t);
  const types = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
  const mime = types.find(t => MediaRecorder.isTypeSupported?.(t)) || "";
  let mr;
  try { mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: (rec.mbps || 12) * 1e6 }); }
  catch (e) { return toast("No se pudo grabar: " + e.message, "err"); }
  const chunks = [];
  mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  mr.onstop = () => {
    const blob = new Blob(chunks, { type: mime.split(";")[0] || "video/webm" });
    S.rec = null;
    o.r.gl.getExtension("WEBGL_lose_context")?.loseContext();
    updateChrome();
    saveBlob(`lumamap-${stamp()}.${blob.type.includes("mp4") ? "mp4" : "webm"}`, blob);
    toast(`Video guardado (${(blob.size / 1048576).toFixed(1)} MB)`);
  };
  mr.start(1000);
  S.rec = { mr, o, start: performance.now() };
  updateChrome();
  toast(`Grabando ${o.canvas.width}×${o.canvas.height} a ${rec.fps} fps… vuelve a pulsar Grabar para terminar`);
};

/* ======================================================================
   Modos y vista
   ====================================================================== */
function setMode(mode) {
  if (S.mode === "shape" && mode !== "shape") S.draft = [];
  if (S.mode === "mask" && mode !== "mask") { const s = surf(); if (s && s.mask.points.length < 3) s.mask.enabled = false; commit(); }
  S.mode = mode;
  S.live = null;
  updateModebar();
  updateChrome();
}
app.setMode = setMode;

/** Superficie de dibujo activa: la seleccionada si es de dibujo, otra existente o una nueva. */
function ensureDrawingSurface() {
  const sc = scene();
  const isDraw = (s) => sc.looks[s.id]?.source.type === "drawing" && !s.hidden;
  let s = surf();
  if (!s || !isDraw(s)) s = [...S.project.surfaces].reverse().find(isDraw) || null;
  if (!s) {
    s = M.createQuad({ name: uniqueName("Dibujo"), corners: M.rectCorners(0, 0, S.project.width, S.project.height) });
    M.addSurface(S.project, s, { type: "drawing" });
    changed(); commit();
    toast("Lienzo de dibujo creado sobre toda la salida");
  }
  select(s.id);
  return s;
}
app.ensureDrawingSurface = ensureDrawingSurface;

A.newCanvas = () => {
  const s = M.createQuad({ name: uniqueName("Dibujo"), corners: M.rectCorners(0, 0, S.project.width, S.project.height) });
  M.addSurface(S.project, s, { type: "drawing" });
  select(s.id); changed({ panel: true }); commit();
};
A.drawOn = () => { // convierte la superficie seleccionada en lienzo
  const l = lookSel();
  if (!l) return;
  l.source.type = "drawing";
  changed(); commit(); openTab("draw");
};
A.undoStroke = () => {
  const l = lookSel();
  if (l?.source.strokes?.length) { l.source.strokes.pop(); changed(); commit(); }
};
A.clearDrawing = async () => {
  const l = lookSel();
  if (!l?.source.strokes?.length) return;
  if (!(await confirmDlg("Borrar dibujo", "¿Borrar todos los trazos de este lienzo?", "Borrar"))) return;
  l.source.strokes = []; changed(); commit();
};

function currentView() {
  const st = $("#stage"), d = DPR();
  const cw = st.clientWidth * d, ch = st.clientHeight * d;
  const P = S.project;
  if (S.projecting) return { sx: cw / P.width, sy: ch / P.height, tx: 0, ty: 0, cw, ch };
  const base = Math.min(cw / P.width, ch / P.height) * 0.92;
  const s = base * S.view.zoom;
  return { sx: s, sy: s, tx: (cw - P.width * s) / 2 + S.view.panX * d, ty: (ch - P.height * s) / 2 + S.view.panY * d, cw, ch };
}
function fitView() { S.view = { zoom: 1, panX: 0, panY: 0 }; }
A.fitView = fitView;

/* ======================================================================
   Gestos sobre el escenario
   ====================================================================== */
const pointers = new Map();
let G = null; // gesto en curso

function toProject(clientX, clientY) {
  const r = $("#ov").getBoundingClientRect(), d = DPR(), v = currentView();
  let cx = clientX - r.left, cy = clientY - r.top;
  if (S.projecting) {
    // La imagen está espejada/girada para el proyector: el toque también.
    const O = S.project.settings.output, rot = O.rotate === 180;
    if (O.flipH !== rot) cx = r.width - cx;
    if (O.flipV !== rot) cy = r.height - cy;
  }
  return { x: (cx * d - v.tx) / v.sx, y: (cy * d - v.ty) / v.sy };
}
const hitRadius = (css = 26) => (css * DPR()) / currentView().sx;

function hitPoint(s, p, r) {
  let best = -1, bd = r;
  s.points.forEach((q, i) => { const d = Math.hypot(q.x - p.x, q.y - p.y); if (d < bd) { bd = d; best = i; } });
  return best;
}
function hitSurface(p) {
  for (let i = S.project.surfaces.length - 1; i >= 0; i--) {
    const s = S.project.surfaces[i];
    if (s.hidden) continue;
    if (pointInPolygon(p, surfaceOutline(s))) return s;
  }
  return null;
}

function haptic() { try { native?.haptic ? native.haptic() : navigator.vibrate?.(8); } catch {} }

function bindStage() {
  const ov = $("#ov");
  ov.addEventListener("pointerdown", onDown);
  ov.addEventListener("pointermove", onMove);
  ov.addEventListener("pointerup", onUp);
  ov.addEventListener("pointercancel", onUp);
  ov.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") onUp(e); });
  ov.addEventListener("wheel", (e) => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });
  ov.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (lastPointerType === "mouse" && !S.projecting) contextAt(e.clientX, e.clientY);
  });
  let lastTap = 0;
  ov.addEventListener("pointerup", (e) => {
    const now = Date.now();
    if (now - lastTap < 300 && S.mode === "edit" && !G?.moved) {
      const p = toProject(e.clientX, e.clientY);
      if (!hitSurface(p) && !S.projecting) { fitView(); }
    }
    lastTap = now;
  });
}

function zoomAt(cx, cy, k) {
  const r = $("#ov").getBoundingClientRect();
  const before = toProject(cx, cy);
  S.view.zoom = Math.max(0.3, Math.min(12, S.view.zoom * k));
  const v = currentView(), d = DPR();
  // Mantiene fijo el punto bajo el cursor.
  S.view.panX += ((cx - r.left) * d - (before.x * v.sx + v.tx)) / d;
  S.view.panY += ((cy - r.top) * d - (before.y * v.sy + v.ty)) / d;
}

function twoFinger() {
  const [a, b] = [...pointers.values()];
  return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x) };
}

let lastPointerType = "mouse", pressTimer = 0, pressAt = null;
/** Menú contextual sobre la superficie bajo el puntero (o general si no hay ninguna). */
function contextAt(cx, cy) {
  const hit = hitSurface(toProject(cx, cy));
  if (hit && hit.id !== S.sel) select(hit.id);
  openContextMenu(app, cx, cy);
}

function onDown(e) {
  $("#ov").setPointerCapture(e.pointerId);
  lastPointerType = e.pointerType;
  closeContextMenu();
  clearTimeout(pressTimer);
  // Pulsación larga (táctil): menú contextual.
  if (e.pointerType !== "mouse" && S.mode === "edit" && !S.projecting) {
    pressAt = { x: e.clientX, y: e.clientY };
    pressTimer = setTimeout(() => {
      if (pointers.size !== 1 || !pressAt) return;
      if (G?.type === "move" || G?.type === "point") { G.moved = false; G = { type: "idle" }; }
      haptic();
      contextAt(pressAt.x, pressAt.y);
    }, 600);
  }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (S.projecting && !S.guides) { showProjbar(); return; }
  if (pointers.size === 2) return startTwoFinger();
  if (pointers.size > 2) return;
  const p = toProject(e.clientX, e.clientY);
  const s = surf();

  if (S.mode === "draw") {
    const ds = surf();
    if (!ds) return;
    const uv = screenToUV(ds, p.x, p.y);
    if (S.draw.tool === "eraser") { G = { type: "erase" }; eraseAt(ds, uv); return; }
    const d = S.draw;
    S.live = { surfaceId: ds.id, sceneId: scene().id, stroke: { id: newStrokeId(), tool: d.tool, color: d.color, width: d.width, glow: d.glow, anim: d.anim, fill: d.fill, pts: [roundPt(uv.u, uv.v)] } };
    if (["line", "rect", "ellipse"].includes(d.tool)) S.live.stroke.pts.push(roundPt(uv.u, uv.v));
    G = { type: "draw" };
    return;
  }
  if (S.mode === "shape") {
    if (S.shapeKind === "trace") { S.draft = [p]; G = { type: "trace" }; }
    else {
      if (S.draft.length >= 3 && Math.hypot(S.draft[0].x - p.x, S.draft[0].y - p.y) < hitRadius()) { finishShape(); return; }
      S.draft.push(p); updateModebar();
      G = { type: "draftPoint", idx: S.draft.length - 1 };
    }
    return;
  }
  if (S.mode === "mask" && s) {
    const pts = s.mask.points.map(q => uvToScreen(s, q.x, q.y));
    const idx = hitPoint({ points: pts }, p, hitRadius());
    if (idx >= 0) { G = { type: "mask", idx }; haptic(); return; }
    const uv = screenToUV(s, p.x, p.y);
    s.mask.points.push({ x: uv.u, y: uv.v });
    G = { type: "mask", idx: s.mask.points.length - 1 };
    changed(); updateModebar();
    return;
  }
  if (S.mode !== "edit") { G = { type: "pan", last: { x: e.clientX, y: e.clientY } }; return; }

  // Modo edición: punto de la seleccionada → superficie → vacío.
  if (s && !s.locked && !s.hidden) {
    const idx = hitPoint(s, p, hitRadius());
    if (idx >= 0) {
      S.point = idx;
      const grabbed = s.points[idx];
      const linked = [];
      if (S.linkCorners) {
        const tol = hitRadius(7);
        for (const o of S.project.surfaces) {
          if (o.id === s.id || o.locked || o.hidden) continue;
          o.points.forEach((q, i) => { if (Math.hypot(q.x - grabbed.x, q.y - grabbed.y) < tol) linked.push(o.points[i]); });
        }
      }
      G = { type: "point", s, idx, linked, off: { x: grabbed.x - p.x, y: grabbed.y - p.y } };
      haptic();
      updateChrome();
      return;
    }
  }
  // Asas de los lados: cambiar el tamaño sin girar.
  if (s && !s.locked && !s.hidden) {
    const r = hitRadius(22);
    const eh = edgeHandles(s).find(e => Math.hypot(e.x - p.x, e.y - p.y) < r);
    if (eh) {
      // Esquinas de otras superficies que coinciden con los puntos que se mueven: van juntas.
      const links = [];
      if (S.linkCorners) {
        const tol = hitRadius(7);
        s.points.forEach((q, i) => {
          if (!eh.w[i]) return;
          for (const o of S.project.surfaces) {
            if (o.id === s.id || o.locked || o.hidden) continue;
            for (const op of o.points) if (Math.hypot(op.x - q.x, op.y - q.y) < tol) links.push({ i, op, x0: op.x, y0: op.y });
          }
        });
      }
      G = { type: "edge", s, h: eh, start: s.points.map(q => ({ ...q })), p0: p, links };
      S.point = -1;
      haptic();
      updateChrome();
      return;
    }
  }
  const hit = hitSurface(p);
  if (hit) {
    if (hit.id !== S.sel) select(hit.id);
    S.point = -1;
    updateChrome();
    if (!hit.locked) G = { type: "move", s: hit, last: p, moved: false };
    return;
  }
  if (S.sel) { select(null); }
  if (S.projecting) showProjbar();
  G = { type: "pan", last: { x: e.clientX, y: e.clientY } };
}

function startTwoFinger() {
  // Cancela el gesto de un dedo y empieza uno de dos dedos.
  if (G?.type === "draw") S.live = null;
  if (G?.type === "trace") S.draft = [];
  const tf = twoFinger();
  const s = surf();
  const mid = toProject(tf.cx, tf.cy);
  if (S.mode === "edit" && s && !s.locked && (G?.type === "move" || G?.type === "point" || pointInPolygon(mid, surfaceOutline(s)))) {
    G = { type: "pinch", s, start: s.points.map(p => ({ ...p })), c: centroid(s.points), tf0: tf, mid0: mid };
  } else {
    G = { type: "view", tf0: tf, zoom0: S.view.zoom, pan0: { ...S.view } };
  }
}

function onMove(e) {
  if (!pointers.has(e.pointerId)) return;
  if (pressAt && Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y) > 10) { clearTimeout(pressTimer); pressAt = null; }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (!G) return;
  const p = toProject(e.clientX, e.clientY);
  switch (G.type) {
    case "point": {
      const np = { x: p.x + G.off.x, y: p.y + G.off.y };
      const old = G.s.points[G.idx];
      const dx = np.x - old.x, dy = np.y - old.y;
      old.x = np.x; old.y = np.y;
      for (const q of G.linked) { q.x += dx; q.y += dy; }
      G.moved = true; G.at = np;
      changed();
      break;
    }
    case "edge": {
      const pts = dragEdge(G.start, G.h, p.x - G.p0.x, p.y - G.p0.y);
      pts.forEach((q, i) => { G.s.points[i].x = q.x; G.s.points[i].y = q.y; });
      for (const l of G.links) { l.op.x = l.x0 + pts[l.i].x - G.start[l.i].x; l.op.y = l.y0 + pts[l.i].y - G.start[l.i].y; }
      G.moved = true; G.at = { x: G.h.x + (p.x - G.p0.x), y: G.h.y + (p.y - G.p0.y) };
      changed();
      break;
    }
    case "move": {
      const dx = p.x - G.last.x, dy = p.y - G.last.y;
      for (const q of G.s.points) { q.x += dx; q.y += dy; }
      G.last = p; G.moved = true;
      changed();
      break;
    }
    case "pinch": {
      if (pointers.size < 2) break;
      const tf = twoFinger();
      const k = tf.d / Math.max(10, G.tf0.d), rot = tf.ang - G.tf0.ang;
      const mid = toProject(tf.cx, tf.cy);
      const pts = transformPoints(G.start, G.c, k, rot);
      for (let i = 0; i < pts.length; i++) { G.s.points[i].x = pts[i].x + mid.x - G.mid0.x; G.s.points[i].y = pts[i].y + mid.y - G.mid0.y; }
      G.moved = true;
      changed();
      break;
    }
    case "view": {
      if (pointers.size < 2) break;
      const tf = twoFinger();
      S.view.zoom = Math.max(0.3, Math.min(12, G.zoom0 * tf.d / Math.max(10, G.tf0.d)));
      S.view.panX = G.pan0.panX + (tf.cx - G.tf0.cx);
      S.view.panY = G.pan0.panY + (tf.cy - G.tf0.cy);
      break;
    }
    case "pan": {
      if (S.view.zoom === 1 && !S.projecting) break;
      S.view.panX += e.clientX - G.last.x; S.view.panY += e.clientY - G.last.y;
      G.last = { x: e.clientX, y: e.clientY }; G.moved = true;
      break;
    }
    case "draw": {
      const ds = surf(S.live?.surfaceId);
      if (!ds || !S.live) break;
      const uv = screenToUV(ds, p.x, p.y), pts = S.live.stroke.pts;
      if (["line", "rect", "ellipse"].includes(S.live.stroke.tool)) pts[1] = roundPt(uv.u, uv.v);
      else {
        const last = pts[pts.length - 1];
        if (Math.hypot(uv.u - last[0], uv.v - last[1]) > 0.0025) pts.push(roundPt(uv.u, uv.v));
      }
      G.at = p;
      break;
    }
    case "erase": { const ds = surf(); if (ds) eraseAt(ds, screenToUV(ds, p.x, p.y)); break; }
    case "trace": {
      const last = S.draft[S.draft.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) > hitRadius(4)) S.draft.push(p);
      G.at = p;
      break;
    }
    case "draftPoint": S.draft[G.idx] = p; G.at = p; break;
    case "mask": {
      const s = surf();
      const uv = screenToUV(s, p.x, p.y);
      s.mask.points[G.idx] = { x: uv.u, y: uv.v };
      G.at = p;
      changed();
      break;
    }
  }
}

function onUp(e) {
  pointers.delete(e.pointerId);
  clearTimeout(pressTimer); pressAt = null;
  if (!G) return;
  if (pointers.size === 1 && (G.type === "pinch" || G.type === "view")) {
    // Al levantar un dedo de dos, el gesto termina (no salta a mover).
    if (G.type === "pinch") commit();
    G = { type: "idle" };
    return;
  }
  if (pointers.size > 0) return;
  switch (G.type) {
    case "point": case "move": case "pinch": case "edge": if (G.moved) commit(); break;
    case "mask": commit(); break;
    case "draw": {
      if (S.live) {
        const ds = surf(S.live.surfaceId);
        const look = ds && M.lookOf(scene(), ds.id);
        const st = S.live.stroke;
        const tiny = ["line", "rect", "ellipse"].includes(st.tool) && Math.hypot(st.pts[1][0] - st.pts[0][0], st.pts[1][1] - st.pts[0][1]) < 0.004;
        if (look && !tiny) { look.source.strokes = look.source.strokes || []; look.source.strokes.push(st); changed(); commit(); }
      }
      S.live = null;
      if (S.tab === "draw") renderPanel();
      break;
    }
    case "erase": commit(); if (S.tab === "draw") renderPanel(); break;
    case "trace": {
      if (S.draft.length > 4) {
        S.draft = simplify(S.draft, hitRadius(3));
        if (S.draft.length >= 3) finishShape();
      } else S.draft = [];
      break;
    }
  }
  G = null;
  sendState(true);
}

function eraseAt(s, uv) {
  const look = M.lookOf(scene(), s.id);
  const strokes = look.source.strokes || [];
  const { aspect } = surfaceAspect(s);
  const i = hitStroke(strokes, uv.u, uv.v, 0.02, aspect);
  if (i >= 0) { strokes.splice(i, 1); changed(); haptic(); }
}

function finishShape() {
  if (S.draft.length < 3) { S.draft = []; return; }
  let pts = S.draft;
  if (pts.length > 64) pts = simplify(pts, hitRadius(6));
  if (pts.length > 64) pts = pts.filter((_, i) => i % Math.ceil(pts.length / 64) === 0);
  const s = M.createPoly({ name: uniqueName(S.shapeKind === "trace" ? "Forma libre" : "Polígono"), points: pts });
  M.addSurface(S.project, s, { type: "gen", gen: "plasma", color: "#00e5ff", color2: "#ff00aa" });
  S.draft = [];
  select(s.id);
  setMode("edit");
  changed({ panel: true }); commit();
  toast("Forma creada · elige su contenido");
  openTab("content");
}
A.finishShape = finishShape;
A.undoDraftPoint = () => { S.draft.pop(); updateModebar(); };

/* ---- empuje fino con flechas ---- */
function nudge(dx, dy) {
  const s = surf();
  if (!s || s.locked) return;
  const step = (S.fine ? 0.25 : 2) * (S.project.width / 1920);
  const pts = S.point >= 0 ? [s.points[S.point]] : s.points;
  for (const q of pts) { q.x += dx * step; q.y += dy * step; }
  changed(); commitSoon();
}
function cyclePoint(d = 1) {
  const s = surf();
  if (!s) return;
  const order = s.type === "quad" ? gridCornerIdx(s.cols, s.rows).concat(s.points.map((_, i) => i).filter(i => !gridCornerIdx(s.cols, s.rows).includes(i))) : s.points.map((_, i) => i);
  const at = order.indexOf(S.point);
  S.point = order[(at + d + order.length) % order.length];
  updateChrome();
}
A.nudge = nudge; A.cyclePoint = cyclePoint;

/* ======================================================================
   Interfaz: barra superior, dock, barras flotantes, panel
   ====================================================================== */
function buildChrome() {
  const set = (act, ic) => { const b = document.querySelector(`[data-act="${act}"]`); if (b) b.innerHTML = icon(ic); };
  set("menu", "menu"); set("undo", "undo"); set("redo", "redo"); set("play", "pause"); set("palette", "wand");
  document.querySelectorAll("#top [data-act]").forEach(b => b.addEventListener("click", () => {
    const a = b.dataset.act;
    if (a === "menu") openTab("menu");
    else if (a === "rename") renameProject();
    else if (a === "undo") A.undo();
    else if (a === "redo") A.redo();
    else if (a === "play") A.togglePlay();
    else if (a === "project") openTab("output");
    else if (a === "palette") openPalette(app);
    else if (a === "record") A.record();
  }));
  const dock = $("#dock");
  for (const t of TABS) {
    const b = h("button", { dataset: { tab: t.id }, onclick: () => openTab(t.id) });
    b.innerHTML = icon(t.ic) + `<span>${t.label}</span>`;
    dock.append(b);
  }
  const vb = $("#viewbar");
  vb.append(
    Object.assign(btn({ ic: "fit", title: "Ajustar vista", onClick: () => fitView() }), { id: "vbFit" }),
    Object.assign(btn({ ic: "eye", title: "Vista previa sin guías", onClick: () => setMode(S.mode === "preview" ? "edit" : "preview") }), { id: "vbPreview" }));
  buildNudge();
}

async function renameProject() {
  const n = await prompt("Nombre del proyecto", S.project.name);
  if (n && n.trim()) { S.project.name = n.trim(); changed(); commit(); }
}

function buildNudge() {
  const nd = $("#nudge");
  const mk = (ic, fn, cls = "") => {
    const b = h("button", { class: cls });
    b.innerHTML = ic.startsWith("<") ? ic : icon(ic);
    let timer = 0, rep = 0;
    const stop = () => { clearTimeout(timer); clearInterval(rep); };
    b.addEventListener("pointerdown", (e) => { e.preventDefault(); fn(); timer = setTimeout(() => { rep = setInterval(fn, 50); }, 350); });
    b.addEventListener("pointerup", stop); b.addEventListener("pointerleave", stop); b.addEventListener("pointercancel", stop);
    return b;
  };
  nd.append(
    mk("target", () => cyclePoint(1), "mid"), mk("up", () => nudge(0, -1)), mk(`<span id="fineLbl">×1</span>`, () => { S.fine = !S.fine; updateChrome(); }, "mid"),
    mk("left", () => nudge(-1, 0)), h("span"), mk("right", () => nudge(1, 0)),
    mk("close", () => { S.point = -1; updateChrome(); }), mk("down", () => nudge(0, 1)), h("span"));
}

function updateChrome() {
  const s = surf();
  $("#projName").textContent = S.project.name;
  document.querySelector('[data-act="undo"]').disabled = !history.canUndo;
  document.querySelector('[data-act="redo"]').disabled = !history.canRedo;
  document.querySelector('[data-act="play"]').innerHTML = icon(S.playing ? "pause" : "play");
  const live = S.output || S.projecting;
  const cta = $("#btnProject");
  cta.classList.toggle("live", !!live);
  cta.innerHTML = icon("project") + `<span>${live ? "EN VIVO" : "Proyectar"}</span>`;
  document.querySelectorAll("#dock button").forEach(b => b.classList.toggle("on", b.dataset.tab === S.tab));
  // barra de selección
  const sb = $("#selbar");
  const showSel = s && S.mode === "edit" && !S.projecting;
  sb.classList.toggle("show", !!showSel);
  if (showSel) {
    sb.innerHTML = "";
    sb.append(
      btn({ ic: "copy", kind: "icon", title: "Duplicar", onClick: A.duplicate }),
      btn({ ic: s.locked ? "lock" : "unlock", kind: "icon", title: s.locked ? "Desbloquear" : "Bloquear", onClick: () => A.toggleLock() }),
      btn({ ic: "trash", kind: "icon", title: "Eliminar", onClick: () => A.remove() }));
  }
  $("#nudge").classList.toggle("show", !!(s && S.point >= 0 && S.mode === "edit" && !s.locked && !S.projecting));
  const fl = document.getElementById("fineLbl");
  if (fl) fl.textContent = S.fine ? "fino" : "×1";
  $("#vbPreview")?.classList.toggle("on", S.mode === "preview");
  const empty = $("#empty");
  const isEmpty = !S.project.surfaces.length && !S.projecting && S.mode === "edit";
  empty.classList.toggle("show", isEmpty);
  if (isEmpty && !empty.firstChild) {
    empty.append(h("div", { class: "card" },
      h("h2", {}, "Empieza tu mapping"),
      h("p", {}, "Añade una superficie y ajusta sus esquinas sobre la pared, o dibuja directamente."),
      h("div", { class: "row" },
        btn({ label: "Añadir", ic: "plus", kind: "primary wide", onClick: () => openTab("add") }),
        btn({ label: "Dibujar", ic: "pen", kind: "wide", onClick: () => openTab("draw") }))));
  }
}
app.updateChrome = updateChrome;

function updateModebar() {
  const mb = $("#modebar");
  mb.innerHTML = "";
  let show = true;
  if (S.mode === "draw") {
    const s = surf();
    mb.append(h("span", {}, `✎ Dibujando en «${s?.name || "—"}»`),
      btn({ ic: "undo", kind: "icon", title: "Deshacer trazo", onClick: A.undoStroke }),
      btn({ label: "Listo", kind: "primary", onClick: () => openTab(null) }));
  } else if (S.mode === "shape") {
    mb.append(h("span", {}, S.shapeKind === "trace" ? "Traza el contorno con el dedo" : `Toca para añadir puntos (${S.draft.length})`));
    if (S.shapeKind === "points") {
      mb.append(btn({ ic: "undo", kind: "icon", onClick: A.undoDraftPoint }),
        btn({ label: "Listo", kind: "primary", onClick: finishShape, disabled: S.draft.length < 3 }));
    }
    mb.append(btn({ ic: "close", kind: "icon", title: "Cancelar", onClick: () => setMode("edit") }));
  } else if (S.mode === "mask") {
    const s = surf();
    mb.append(h("span", {}, `Máscara: toca para añadir puntos (${s?.mask.points.length || 0})`),
      btn({ ic: "undo", kind: "icon", onClick: () => { s?.mask.points.pop(); changed(); updateModebar(); } }),
      btn({ label: "Listo", kind: "primary", onClick: () => { setMode("edit"); renderPanel(); } }));
  } else show = false;
  mb.classList.toggle("show", show && !S.projecting);
}
app.updateModebar = updateModebar;

function openTab(id) {
  if (id && S.tab === id) id = null; // tocar la pestaña activa la cierra
  const prev = S.tab;
  S.tab = id;
  if (prev === "draw" && id !== "draw" && S.mode === "draw") setMode("edit");
  if (prev === "shape" && id !== "shape" && S.mode === "mask") setMode("edit");
  if (id === "draw") { ensureDrawingSurface(); setMode("draw"); }
  $("#panel").classList.toggle("open", !!id);
  renderPanel();
  updateChrome();
  requestAnimationFrame(() => {}); // el escenario se reajusta en el siguiente fotograma
}
app.openTab = openTab;

function renderPanel() {
  if (!S.tab) return;
  const def = PANELS[S.tab];
  if (!def) return;
  const head = $("#panelHead"), body = $("#panelBody");
  const scroll = body.scrollTop;
  head.innerHTML = "";
  head.append(h("h2", {}, def.title(app)), btn({ ic: "close", kind: "icon", title: "Cerrar", onClick: () => openTab(null) }));
  body.innerHTML = "";
  body.append(def.render(app));
  body.scrollTop = scroll;
}
app.renderPanel = renderPanel;

/* ======================================================================
   Teclado (Bluetooth / USB / escritorio)
   ====================================================================== */
function bindKeys() {
  addEventListener("keydown", (e) => {
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) && document.activeElement.type !== "range") return;
    if (document.getElementById("modal").classList.contains("show") && e.key !== "Escape") return;
    const k = e.key, ctrl = e.ctrlKey || e.metaKey;
    // Movimiento fino y teclas de edición directa.
    const m = e.shiftKey ? 10 : 1;
    switch (k) {
      case "ArrowLeft": e.preventDefault(); for (let i = 0; i < m; i++) nudge(-1, 0); return;
      case "ArrowRight": e.preventDefault(); for (let i = 0; i < m; i++) nudge(1, 0); return;
      case "ArrowUp": e.preventDefault(); for (let i = 0; i < m; i++) nudge(0, -1); return;
      case "ArrowDown": e.preventDefault(); for (let i = 0; i < m; i++) nudge(0, 1); return;
      case "Tab": e.preventDefault(); cyclePoint(e.shiftKey ? -1 : 1); return;
      case "Escape": closeContextMenu(); back(); return;
      case "Backspace": if (S.sel) A.remove(); return;
    }
    if (ctrl && k.toLowerCase() === "z" && e.shiftKey) { e.preventDefault(); A.redo(); return; }
    // Atajos del registro de comandos.
    const cmd = KEYS.get(keyOf(e));
    if (cmd) {
      if (cmd.needsSel && !S.sel) return;
      e.preventDefault();
      cmd.run();
      return;
    }
    if (!ctrl && /^[1-9]$/.test(k) && S.project.scenes[+k - 1]) A.goScene(S.project.scenes[+k - 1].id);
  });
}

/** Botón atrás (Android) / Escape: cierra lo más reciente. Devuelve true si lo consumió. */
function back() {
  if (closeDialog()) return true;
  if (S.projecting) { A.projectHere(false); return true; }
  if (S.mode === "shape" || S.mode === "mask") { setMode("edit"); return true; }
  if (S.tab) { openTab(null); return true; }
  if (S.point >= 0) { S.point = -1; updateChrome(); return true; }
  if (S.sel) { select(null); return true; }
  return false;
}
window.__lumaBack = back;

/* ======================================================================
   Bucle de render
   ====================================================================== */
let lastNow = performance.now();
let fpsAvg = 60;
const ovCtx = () => $("#ov").getContext("2d");

function layoutStage(v) {
  const d = DPR(), P = S.project;
  renderer.resize(v.cw, v.ch);
  const ov = $("#ov");
  if (ov.width !== Math.round(v.cw) || ov.height !== Math.round(v.ch)) { ov.width = Math.round(v.cw); ov.height = Math.round(v.ch); }
  const fr = $("#frame").style;
  const L = v.tx / d, T = v.ty / d, W = P.width * v.sx / d, H = P.height * v.sy / d;
  fr.left = L + "px"; fr.top = T + "px"; fr.width = W + "px"; fr.height = H + "px";
  for (const id of ["#refImg", "#refCam"]) {
    const el = $(id), on = id === "#refImg" ? !!S.ref.url : S.ref.camera;
    el.style.display = on && !S.projecting ? "block" : "none";
    if (on) Object.assign(el.style, { left: L + "px", top: T + "px", width: W + "px", height: H + "px", opacity: S.ref.opacity });
  }
}

function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min(0.1, (now - lastNow) / 1000);
  lastNow = now;
  fpsAvg = fpsAvg * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;
  if (S.playing) S.clock += dt;
  S.levels = audio.update(now);
  // Cambio de escena al ritmo: cada N golpes.
  const R = S.project.settings.react;
  if (S.levels.count !== S.lastCount) {
    S.lastCount = S.levels.count;
    if (S.playing && R.enabled && R.sceneBeats > 0 && S.project.scenes.length > 1 && ++S.beatsInScene >= R.sceneBeats) { S.beatsInScene = 0; A.stepScene(1); }
  }

  // Auto-avance de escenas
  const sc = scene();
  if (S.playing && S.project.settings.autoAdvance && sc.duration > 0 && S.clock - S.sceneStart >= sc.duration) A.stepScene(1);
  if (S.tr && now - S.tr.start > S.tr.dur) S.tr = null;

  const v = currentView();
  layoutStage(v);
  const view = { sx: v.sx, sy: v.sy, tx: v.tx, ty: v.ty };
  const layers = sceneLayers(S.project, S.tr, now);
  comp.frame(S.project, {
    layers, time: S.clock, levels: S.levels, view, master: S.master,
    blackout: S.blackout, clear: S.projecting ? [0, 0, 0, 1] : [0, 0, 0, 0],
    live: S.live,
  });
  pool.applyLookAudio(layers.flatMap(l => Object.values(l.scene.looks)), S.muted || !!S.output);
  drawOverlay(v, view);
  drawLoupe(v, view);
  const rb = $("#recBadge");
  if (S.rec) {
    renderOff(S.rec.o, now);
    const sec = Math.floor((now - S.rec.start) / 1000);
    rb.textContent = `● REC ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
    rb.classList.add("show");
  } else rb.classList.remove("show");

  if (S.dirty) {
    S.dirty = false;
    link.send({ t: "project", project: outProject() });
  }
  sendState();
  if (now - S.lastSync > 2000) {
    S.lastSync = now;
    const items = pool.videos().map(r => ({ id: r.id, time: r.el.currentTime }));
    if (items.length) link.send({ t: "vsync", items });
    if (S.outWin && S.outWin.closed) { S.outWin = null; if (S.output === "window") S.output = null; updateChrome(); }
  }
  if (S.saveDue && now > S.saveDue) {
    S.saveDue = 0;
    Store.saveProject(Store.AUTOSAVE, S.project).catch(() => {});
  }
}

function drawOverlay(v, view) {
  const ctx = ovCtx(), W = $("#ov").width, H = $("#ov").height, d = DPR(), P = S.project;
  ctx.clearRect(0, 0, W, H);
  // En pantalla completa se aplican los ajustes del proyector (color, espejo, bordes suaves).
  applyOutputCSS([$("#gl"), $("#ov")], S.projecting ? P.settings.output : {});
  if (S.pattern && S.projecting) {
    ctx.save(); ctx.setTransform(v.sx, 0, 0, v.sy, v.tx, v.ty); drawPattern(ctx, S.pattern, P.width, P.height); ctx.restore();
  }
  if (S.projecting) drawSoftEdge(ctx, P.settings.output.softEdge, v.tx, v.ty, P.width * v.sx, P.height * v.sy);
  // Atenúa lo que queda fuera de la salida.
  if (!S.projecting) {
    ctx.fillStyle = "rgba(5,6,10,.55)";
    const x0 = v.tx, y0 = v.ty, x1 = v.tx + P.width * v.sx, y1 = v.ty + P.height * v.sy;
    ctx.fillRect(0, 0, W, Math.max(0, y0)); ctx.fillRect(0, y1, W, H - y1);
    ctx.fillRect(0, y0, Math.max(0, x0), y1 - y0); ctx.fillRect(x1, y0, W - x1, y1 - y0);
  }
  const showGuides = S.mode === "edit" || S.mode === "mask" || S.mode === "shape" || (S.mode === "draw");
  if (showGuides && (!S.projecting || S.guides)) {
    drawGuides(ctx, P, view, {
      selectedId: S.mode === "edit" || S.mode === "mask" ? S.sel : null,
      pointIdx: S.point, scale: d, showAll: S.mode !== "draw",
      edges: S.mode === "edit", edgeActive: G?.type === "edge" ? G.h.side : null,
    });
  }
  const X = (p) => p.x * v.sx + v.tx, Y = (p) => p.y * v.sy + v.ty;
  if (S.mode === "draw") {
    const s = surf();
    if (s) {
      ctx.setLineDash([8 * d, 6 * d]); ctx.lineWidth = 1.5 * d; ctx.strokeStyle = "rgba(0,229,255,.6)";
      const o = surfaceOutline(s);
      ctx.beginPath(); o.forEach((p, i) => i ? ctx.lineTo(X(p), Y(p)) : ctx.moveTo(X(p), Y(p))); ctx.closePath(); ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  if (S.mode === "mask") {
    const s = surf();
    if (s) {
      const pts = s.mask.points.map(q => uvToScreen(s, q.x, q.y));
      ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(X(p), Y(p)) : ctx.moveTo(X(p), Y(p)));
      if (pts.length > 2) ctx.closePath();
      ctx.lineWidth = 2 * d; ctx.strokeStyle = "#ff2d8a"; ctx.stroke();
      pts.forEach(p => { ctx.beginPath(); ctx.arc(X(p), Y(p), 8 * d, 0, Math.PI * 2); ctx.fillStyle = "#ff2d8a"; ctx.fill(); ctx.strokeStyle = "#000"; ctx.lineWidth = 2 * d; ctx.stroke(); });
    }
  }
  if (S.mode === "shape" && S.draft.length) {
    ctx.beginPath(); S.draft.forEach((p, i) => i ? ctx.lineTo(X(p), Y(p)) : ctx.moveTo(X(p), Y(p)));
    ctx.lineWidth = 3 * d; ctx.strokeStyle = "#ffd60a"; ctx.stroke();
    if (S.shapeKind === "points") S.draft.forEach((p, i) => { ctx.beginPath(); ctx.arc(X(p), Y(p), (i ? 7 : 11) * d, 0, Math.PI * 2); ctx.fillStyle = i ? "#ffd60a" : "#34c759"; ctx.fill(); });
  }
}

/** Lupa de precisión: amplía la zona bajo el dedo al mover un punto o dibujar. */
function drawLoupe(v) {
  const lp = $("#loupe");
  const active = G && G.at && ["point", "edge", "draw", "draftPoint", "mask", "trace"].includes(G.type) && pointers.size === 1;
  lp.style.display = active ? "block" : "none";
  if (!active) return;
  const ctx = lp.getContext("2d"), Z = 3, R = lp.width;
  const cx = G.at.x * v.sx + v.tx, cy = G.at.y * v.sy + v.ty;
  const srcW = R / Z * DPR() / 1.2;
  lp.classList.toggle("right", cx < v.cw * 0.35 && cy < v.ch * 0.4);
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, R, R);
  try {
    ctx.drawImage($("#gl"), cx - srcW / 2, cy - srcW / 2, srcW, srcW, 0, 0, R, R);
    ctx.drawImage($("#ov"), cx - srcW / 2, cy - srcW / 2, srcW, srcW, 0, 0, R, R);
  } catch {}
  ctx.strokeStyle = "#ff2d55"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(R / 2, R / 2 - 14); ctx.lineTo(R / 2, R / 2 + 14); ctx.moveTo(R / 2 - 14, R / 2); ctx.lineTo(R / 2 + 14, R / 2); ctx.stroke();
}

/* ======================================================================
   Integración nativa (Android) y control remoto
   ====================================================================== */
window.__lumaNativeEvent = (ev) => {
  if (typeof ev === "string") ev = JSON.parse(ev);
  if (ev.type === "displays") {
    const had = S.extDisplays;
    S.extDisplays = ev.count;
    if (ev.count > had) toast("Proyector detectado · toca «Proyectar»");
    if (!ev.count && S.output === "native") { S.output = null; toast("Proyector desconectado", "err"); }
    if (ev.count && ev.resumed) S.output = "native";
    updateChrome(); renderPanel();
  } else if (ev.type === "saved") toast(ev.ok ? "Archivo guardado" : "No se guardó el archivo", ev.ok ? "" : "err");
  else if (ev.type === "updateProgress") window.__lumaUpdateProgress?.(ev.pct);
  else if (ev.type === "updateError") toast("No se pudo actualizar: " + ev.msg, "err");
  else if (ev.type === "updateReady") toast("Confirma «Actualizar» en la pantalla de Android");
  else if (ev.type === "optimize") {
    if (ev.stage === "probe") toast("Analizando video…");
    else if (ev.stage === "progress") toast(`Optimizando video… ${Math.round(ev.pct * 100)} %`);
    else if (ev.stage === "done") toast(ev.msg);
  }
};

async function connectRemote() {
  if (native || location.protocol === "file:") return;
  try {
    const r = await fetch("api/ping", { cache: "no-store" });
    if (!r.ok) return;
  } catch { return; }
  const remote = new Remote({
    role: "display", name: "LumaMap",
    onControl: (m) => {
      const a = m.action;
      if (a === "play" && !S.playing) A.togglePlay();
      if (a === "pause" && S.playing) A.togglePlay();
      if (a === "stop") { if (S.playing) A.togglePlay(); A.restart(); }
      if (a === "next") A.stepScene(1);
      if (a === "prev") A.stepScene(-1);
      if (a === "goto" && S.project.scenes[m.value]) A.goScene(S.project.scenes[m.value].id);
      if (a === "brightness") { S.master = Number(m.value); sendState(true); }
      if (a === "blackout") A.blackout();
    },
  });
  remote.connect();
  setInterval(() => {
    const i = S.project.scenes.findIndex(s => s.id === S.project.sceneId);
    remote.sendState({ project: S.project.name, scene: scene().name, sceneIndex: i, sceneCount: S.project.scenes.length,
      scenes: S.project.scenes.map(s => s.name), playing: S.playing, fps: Math.round(fpsAvg), resolution: `${S.project.width}×${S.project.height}`, blackout: S.blackout });
  }, 1000);
}

/* ======================================================================
   Arranque
   ====================================================================== */
async function welcome() {
  const content = h("div", {},
    h("div", { class: "welcome-hero" }, h("div", { class: "logo" }, "LumaMap"), h("p", {}, "Video mapping fácil desde tu teléfono o tablet")),
    h("div", { class: "steps" },
      h("div", {}, h("b", {}, "1"), "Elige una forma"), h("div", {}, h("b", {}, "2"), "Ajusta las esquinas"),
      h("div", {}, h("b", {}, "3"), "Pon contenido"), h("div", {}, h("b", {}, "4"), "Proyecta")),
    h("p", { class: "hint" }, "¿Con qué quieres empezar?"));
  const items = [
    { id: "draw", label: "Dibujar en la pared", ic: "pen" }, { id: "screen", label: "Pantalla", ic: "screen" },
    { id: "cube", label: "Cubo 3D", ic: "cube" }, { id: "facade", label: "Fachada", ic: "building" },
    { id: "stage", label: "Escenario", ic: "stage" }, { id: "blank", label: "Vacío", ic: "plus" },
  ];
  content.append(tiles(items, { onPick: (id) => closeDialog(id), cols: 3 }));
  const pick = (await dialog({ title: "Bienvenido", content, buttons: [] })) || "screen";
  setProject(M.TEMPLATES[pick].build());
  if (pick === "draw") openTab("draw");
  else openTab("add");
}

async function init() {
  if (!webgl2Supported()) {
    document.body.innerHTML = `<div class="fatal"><div><h1>WebGL2 no disponible</h1><p>Actualiza Chrome / Android System WebView o activa la aceleración por hardware.</p></div></div>`;
    return;
  }
  try {
    renderer = new Renderer($("#gl"));
  } catch (e) {
    document.body.innerHTML = `<div class="fatal"><div><h1>Error de GPU</h1><p>${e.message}</p></div></div>`;
    return;
  }
  pool = new MediaPool();
  pool.setPlaying(true);
  comp = new Compositor(renderer, pool);
  link = new Link("editor", onLinkMsg);
  audio = new AudioEngine();
  app.commands = buildCommands(app);
  KEYS = keymap(app.commands);
  // Versión de escritorio: el menú de la ventana ejecuta los mismos comandos.
  if (window.LumaDesktop) {
    const byId = Object.fromEntries(app.commands.map(c => [c.id, c]));
    window.LumaDesktop.onCommand((id) => {
      const c = byId[id];
      if (!c) return;
      if (c.needsSel && !S.sel) return toast("Selecciona primero una superficie");
      closeDialog();
      c.run();
    });
    window.LumaDesktop.onDisplaysChanged(() => { if (S.tab === "output") renderPanel(); });
  }
  buildChrome();
  bindStage();
  bindKeys();
  addEventListener("resize", () => updateChrome());
  document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement && S.projecting && !native) A.projectHere(false); });

  if (native?.externalCount) S.extDisplays = native.externalCount();
  let restored = null;
  try { restored = await Store.loadProject(Store.AUTOSAVE); } catch {}
  if (restored && (restored.surfaces?.length || restored.scenes?.length > 1)) {
    setProject(restored);
    toast(`Proyecto restaurado: «${S.project.name}»`);
  } else {
    setProject(M.createProject());
    welcome();
  }
  audio.bpm = S.project.settings.bpm || 120;
  requestAnimationFrame(tick);
  connectRemote();
  // Busca actualizaciones al abrir (en silencio: solo avisa si hay una nueva).
  setTimeout(() => A.checkUpdates(true), 5000);
  if ("serviceWorker" in navigator && !native && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => {});
  window.__lumamap = app; // depuración y pruebas
}

init();
