// web/js/output.js
// Ventana / pantalla de salida: solo la composición final, sin interfaz.
// Recibe el proyecto y el estado del editor por el Link y carga los medios
// desde IndexedDB. En Android se muestra en el proyector vía Presentation.
import { Renderer, webgl2Supported } from "./renderer.js";
import { Compositor, sceneLayers } from "./compose.js";
import { MediaPool } from "./sources.js";
import { Link } from "./link.js";
import { drawPattern, drawGuides, applyOutputCSS, drawSoftEdge } from "./overlay.js";
import { normalizeProject, usedMediaIds, screenFilter, defaultScreen } from "./model.js";
import { applyModList } from "./params.js";

const glCanvas = document.getElementById("out");
/** Número de pantalla de esta salida (?screen=N); la de Android/Presentation es la 1. */
const SCREEN = Math.max(1, +new URLSearchParams(location.search).get("screen") || 1);
if (SCREEN > 1) document.title = `LumaMap · Pantalla ${SCREEN}`;
const ov = document.getElementById("ov");
const octx = ov.getContext("2d");
const hud = document.getElementById("hud");

let project = null;
let st = { playing: true, master: 1, blackout: false, pattern: null, guides: false, sel: null, point: -1, levels: null, muted: true };
let timeOffset = 0;      // tiempo del editor - tiempo local (s)
let frozenTime = 0;      // tiempo del editor cuando está en pausa
let levelsAt = 0;        // cuándo llegaron los últimos niveles de audio
let lastDraw = 0, ovk = 1; // último fotograma dibujado · escala de la capa de guías

/** Extrapola el ritmo entre mensajes (llegan ~30 veces/s) para que el compás no salte. */
function liveLevels(now) {
  const L = st.levels;
  if (!L) return null;
  const age = now - levelsAt, P = 60000 / (L.bpm || 120);
  const phase = Math.min(1, (L.phase || 0) + age / P);
  return { ...L, beat: (L.beat || 0) * Math.exp(-age / 140), phase, pos: (L.count || 0) - 1 + (1 - (1 - phase) ** 3) };
}
let tr = null;           // transición {fromId, start, dur}

if (!webgl2Supported()) {
  hud.innerHTML = "WebGL2 no disponible en esta pantalla.";
  throw new Error("WebGL2");
}
const renderer = new Renderer(glCanvas);
const QS = new URLSearchParams(location.search);
/**
 * Motor compartido: si esta ventana la abrió el editor (mismo proceso), se
 * dibuja con las fuentes del editor (videos, cámaras, dibujos y textos ya
 * decodificados) y con su reloj. Así cada video se decodifica una sola vez
 * aunque haya varias salidas y todas las pantallas van exactamente a la par.
 * Sin editor accesible (Android, otra pestaña) se usa el canal Link.
 */
const host = (() => { if (QS.has("solo")) return null; try { return window.opener && window.opener.__lumaHost || null; } catch { return null; } })();
const pool = host ? null : new MediaPool();
const comp = new Compositor(renderer, pool, host ? host.comp : null);
if (host) {
  host.attach(SCREEN, window);
  addEventListener("pagehide", () => { try { host.detach(SCREEN, window); } catch {} });
}
window.__lumaOut = { comp, renderer, shared: !!host };   // depuración y pruebas

/** El editor se cerró o recargó: esta salida pasa a funcionar por su cuenta. */
function hostLost() {
  QS.set("solo", "1");
  location.replace(location.pathname + "?" + QS.toString());
}

const link = new Link("output", async (m) => {
  if (host) return;   // con motor compartido el estado se lee directamente del editor
  if (m.t === "project") {
    const prevScene = project?.sceneId;
    project = normalizeProject(m.project);
    if (prevScene && prevScene !== project.sceneId && m.tr) tr = { fromId: m.tr.fromId, start: performance.now() - (m.tr.elapsed || 0), dur: m.tr.dur, mode: m.tr.mode };
    for (const id of usedMediaIds(project)) pool.ensure(id);
    for (const id of [...pool.items.keys()]) if (!project.media.some(md => md.id === id)) pool.remove(id);
    hud.querySelector("small").textContent = `${SCREEN > 1 ? "Pantalla " + SCREEN + " · " : ""}${project.name} · ${project.width}×${project.height}`;
    resize();
  } else if (m.t === "state") {
    const wasPlaying = st.playing;
    st = { ...st, ...m.state };
    levelsAt = performance.now();
    if (typeof m.time === "number") { timeOffset = m.time - performance.now() / 1000; frozenTime = m.time; }
    if (m.tr) tr = { fromId: m.tr.fromId, start: performance.now() - m.tr.elapsed, dur: m.tr.dur, mode: m.tr.mode };
    if (st.playing !== wasPlaying) pool.setPlaying(st.playing);
  } else if (m.t === "media") {
    pool.remove(m.id);
    pool.ensure(m.id);
  } else if (m.t === "vsync") {
    for (const it of m.items) {
      const rt = pool.get(it.id);
      if (!rt || rt.kind !== "video") continue;
      const d = Math.abs(rt.el.currentTime - it.time);
      if (d > 0.25 && d < (rt.el.duration || 1e9) - 0.25) { try { rt.el.currentTime = it.time; } catch {} }
    }
  } else if (m.t === "restart") {
    pool.restart();
  } else if (m.t === "restartMedia") {
    const rt = pool.items.get(m.id);
    if (rt?.el && rt.kind === "video") { try { rt.el.currentTime = 0; } catch {} }
  }
});
if (!host) { link.send({ t: "hello" }); pool.setPlaying(true); }

function outCfg() { return project?.settings?.output || {}; }
function resize() {
  const W = project?.width || 1920, H = project?.height || 1080;
  const k = renderer.fitScale(W, H, outCfg().renderScale || 1); // escala de render (calidad / rendimiento)
  renderer.resize(W * k, H * k);
  ovk = Math.min(1, 2048 / Math.max(W, H));            // guías y patrones no necesitan 8K
  const ow = Math.round(W * ovk), oh = Math.round(H * ovk);
  if (ov.width !== ow || ov.height !== oh) { ov.width = ow; ov.height = oh; }
}
resize();

/* ---------------- HUD y pantalla completa ---------------- */
let hudTimer = 0;
function showHud() {
  hud.classList.remove("hide");
  document.body.style.cursor = "default";
  clearTimeout(hudTimer);
  hudTimer = setTimeout(() => { hud.classList.add("hide"); document.body.style.cursor = "none"; }, 3500);
}
const isNative = new URLSearchParams(location.search).has("native");
if (isNative) hud.classList.add("hide"); else showHud();
addEventListener("pointermove", () => { if (!isNative) showHud(); });
function toggleFs() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}
document.getElementById("fs").onclick = toggleFs;
addEventListener("dblclick", toggleFs);
addEventListener("keydown", (e) => { if (e.key === "f" || e.key === "F") toggleFs(); });

/* ---------------- Bucle de render ---------------- */
function tick() {
  requestAnimationFrame(tick);
  let hostFrame = null;
  if (host) {
    try { hostFrame = host.frame(SCREEN); } catch { hostLost(); return; }
    if (!hostFrame) { hostLost(); return; }
    if (project !== hostFrame.project) {
      project = hostFrame.project;
      hud.querySelector("small").textContent = `${SCREEN > 1 ? "Pantalla " + SCREEN + " · " : ""}${project.name} · ${project.width}×${project.height}`;
    }
    st = hostFrame.state;
  }
  if (!project) return;
  const now = performance.now();
  // Con el canal Link llegan las modulaciones del motor de parámetros (audio, tracking…).
  const RP = hostFrame ? { project, master: st.master } : applyModList(project, st.master, st.mods);
  const oc = outCfg();
  // Límite de fotogramas por segundo (como el «frame rate» de la composición).
  if (oc.fps && oc.fps < 120 && now - lastDraw < 1000 / oc.fps - 2) return;
  lastDraw = now;
  resize();
  const time = hostFrame ? hostFrame.time : st.playing ? now / 1000 + timeOffset : frozenTime;
  // Control de esta pantalla: encendida, brillo, estrobo y efecto propio.
  const sc = RP.project.settings.screens?.[SCREEN] || defaultScreen();
  const strobeOff = sc.strobe > 0 && Math.floor(now / 1000 * sc.strobe * 2) % 2 === 1;
  applyOutputCSS([glCanvas], oc, screenFilter(sc.fx, now / 1000));
  applyOutputCSS([ov], oc);
  const W = project.width, H = project.height;
  const k = renderer.fitScale(W, H, oc.renderScale || 1);
  const view = { sx: k, sy: k, tx: 0, ty: 0 };
  if (tr && now - tr.start > tr.dur) tr = null;
  comp.frame(RP.project, {
    layers: hostFrame ? hostFrame.layers : sceneLayers(RP.project, tr, now), time, levels: hostFrame ? hostFrame.levels : liveLevels(now), view,
    master: RP.master * (sc.master ?? 1), blackout: st.blackout || !!st.pattern || !sc.on || strobeOff, clear: [0, 0, 0, 1], live: st.live || null, screen: SCREEN,
  });
  octx.setTransform(ovk, 0, 0, ovk, 0, 0);
  octx.clearRect(0, 0, W, H);
  if (st.pattern) drawPattern(octx, st.pattern, W, H);
  if (st.guides) drawGuides(octx, project, { sx: 1, sy: 1, tx: 0, ty: 0 }, { selectedId: st.sel, pointIdx: st.point, scale: W / 1280 });
  drawSoftEdge(octx, oc.softEdge, 0, 0, W, H);
  if (pool) pool.applyLookAudio(sceneLayers(project, null, now).flatMap(l => Object.values(l.scene.looks)), st.muted);
}
tick();
