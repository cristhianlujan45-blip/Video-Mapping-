// web/js/output.js — Ventana OUTPUT: solo la composición final, nunca la UI del editor.
import { Renderer } from "/web/js/renderer.js";
import * as P from "/web/js/project.js";

const glCanvas = document.getElementById("out");
const patCanvas = document.getElementById("pat");
const patCtx = patCanvas.getContext("2d");
const hud = document.getElementById("hud");

let renderer = null, project = null, media = new Map();
let current = { currentSceneId: null, playing: false, masterBrightness: 1, pattern: null };

function dataUrlToBlob(du) {
  const [head, b64] = du.split(",");
  const mime = (head.match(/data:(.*?);/) || [])[1] || "application/octet-stream";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

async function loadDoc(doc) {
  for (const m of media.values()) { if (m.element && m.element.pause) try { m.element.pause(); } catch {} }
  media.clear();
  project = P.validateProject(JSON.parse(JSON.stringify(doc)));
  for (const md of doc.media || []) {
    if (!md.dataUrl) continue;
    const url = URL.createObjectURL(dataUrlToBlob(md.dataUrl));
    const m = { ...md, objectUrl: url, element: null };
    if (md.kind === "video") {
      const v = document.createElement("video");
      v.muted = true; v.loop = true; v.playsInline = true; v.src = url;
      await new Promise(res => { v.onloadeddata = res; v.onerror = res; });
      m.element = v;
      if (current.playing) v.play().catch(() => {});
    } else {
      const img = new Image();
      await new Promise(res => { img.onload = res; img.onerror = res; img.src = url; });
      m.element = img;
    }
    media.set(m.id, m);
  }
  if (!renderer) renderer = new Renderer(glCanvas);
  hud.textContent = `LumaMap OUTPUT · ${project.width}×${project.height} — F = pantalla completa`;
}

function drawPattern(name) {
  patCanvas.width = innerWidth; patCanvas.height = innerHeight;
  const W = patCanvas.width, H = patCanvas.height, c = patCtx;
  if (!name) { c.clearRect(0, 0, W, H); return; }
  const colors = { white: "#fff", red: "#f00", green: "#0f0", blue: "#00f" };
  if (name === "grid" || name === "lines") {
    c.fillStyle = "#000"; c.fillRect(0, 0, W, H);
    c.strokeStyle = "#0f0"; c.lineWidth = 1;
    const step = 80;
    for (let x = 0; x <= W; x += step) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
    for (let y = 0; y <= H; y += step) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
  } else if (name === "bw") {
    for (let x = 0; x < W; x += 40) { c.fillStyle = (x / 40) % 2 ? "#fff" : "#000"; c.fillRect(x, 0, 40, H); }
  } else {
    c.fillStyle = colors[name] || "#fff"; c.fillRect(0, 0, W, H);
  }
}

const bc = new BroadcastChannel("lumap-output");
bc.onmessage = async (ev) => {
  const msg = ev.data;
  if (msg.kind === "project") await loadDoc(msg.doc);
  if (msg.kind === "state") {
    current = msg;
    drawPattern(msg.pattern);
    for (const m of media.values())
      if (m.kind === "video" && m.element) {
        if (msg.playing) m.element.play().catch(() => {}); else m.element.pause();
      }
  }
};

addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === "f") {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {
      hud.textContent = "Pantalla completa bloqueada por el navegador — usa F11.";
    });
  }
});
addEventListener("resize", () => drawPattern(current.pattern));

function tick() {
  requestAnimationFrame(tick);
  if (!renderer || !project || current.pattern) return;
  const scenes = new Map(project.scenes.map(s => [s.id, s]));
  const surfaces = new Map(project.surfaces.map(s => [s.id, s]));
  const sc = scenes.get(current.currentSceneId);
  if (sc) renderer.drawScene(sc, surfaces, media,
    { time: performance.now() / 1000, globalAlpha: current.masterBrightness ?? 1, W: project.width, H: project.height });
}
tick();
