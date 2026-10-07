// web/js/output.js
// Ventana / pantalla de salida: solo la composición final, sin interfaz.
// Recibe el proyecto y el estado del editor por el Link y carga los medios
// desde IndexedDB. En Android se muestra en el proyector vía Presentation.
import { Renderer, webgl2Supported } from "./renderer.js";
import { Compositor, sceneLayers } from "./compose.js";
import { MediaPool } from "./sources.js";
import { Link } from "./link.js";
import { drawPattern, drawGuides } from "./overlay.js";
import { normalizeProject, usedMediaIds } from "./model.js";

const glCanvas = document.getElementById("out");
const ov = document.getElementById("ov");
const octx = ov.getContext("2d");
const hud = document.getElementById("hud");

let project = null;
let st = { playing: true, master: 1, blackout: false, pattern: null, guides: false, sel: null, point: -1, levels: null, muted: true };
let timeOffset = 0;      // tiempo del editor - tiempo local (s)
let frozenTime = 0;      // tiempo del editor cuando está en pausa
let tr = null;           // transición {fromId, start, dur}

if (!webgl2Supported()) {
  hud.innerHTML = "WebGL2 no disponible en esta pantalla.";
  throw new Error("WebGL2");
}
const renderer = new Renderer(glCanvas);
const pool = new MediaPool();
const comp = new Compositor(renderer, pool);

const link = new Link("output", async (m) => {
  if (m.t === "project") {
    const prevScene = project?.sceneId;
    project = normalizeProject(m.project);
    if (prevScene && prevScene !== project.sceneId && m.tr) tr = { fromId: m.tr.fromId, start: performance.now() - (m.tr.elapsed || 0), dur: m.tr.dur };
    for (const id of usedMediaIds(project)) pool.ensure(id);
    for (const id of [...pool.items.keys()]) if (!project.media.some(md => md.id === id)) pool.remove(id);
    hud.querySelector("small").textContent = `${project.name} · ${project.width}×${project.height}`;
    resize();
  } else if (m.t === "state") {
    const wasPlaying = st.playing;
    st = { ...st, ...m.state };
    if (typeof m.time === "number") { timeOffset = m.time - performance.now() / 1000; frozenTime = m.time; }
    if (m.tr) tr = { fromId: m.tr.fromId, start: performance.now() - m.tr.elapsed, dur: m.tr.dur };
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
  }
});
link.send({ t: "hello" });
pool.setPlaying(true);

function resize() {
  const W = project?.width || 1920, H = project?.height || 1080;
  renderer.resize(W, H);
  if (ov.width !== W || ov.height !== H) { ov.width = W; ov.height = H; }
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
  if (!project) return;
  const now = performance.now();
  const time = st.playing ? now / 1000 + timeOffset : frozenTime;
  const W = project.width, H = project.height;
  const view = { sx: 1, sy: 1, tx: 0, ty: 0 };
  if (tr && now - tr.start > tr.dur) tr = null;
  comp.frame(project, {
    layers: sceneLayers(project, tr, now), time, levels: st.levels, view,
    master: st.master, blackout: st.blackout || !!st.pattern, clear: [0, 0, 0, 1], live: st.live || null,
  });
  octx.clearRect(0, 0, W, H);
  if (st.pattern) drawPattern(octx, st.pattern, W, H);
  if (st.guides) drawGuides(octx, project, view, { selectedId: st.sel, pointIdx: st.point, scale: W / 1280 });
  pool.applyLookAudio(sceneLayers(project, null, now).flatMap(l => Object.values(l.scene.looks)), st.muted);
}
tick();
