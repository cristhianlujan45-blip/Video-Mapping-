// web/js/drawing.js
// Dibujo sobre la pared: trazos vectoriales en coordenadas UV de la
// superficie, pintados en un canvas 2D que el renderer usa como textura.
// Pinceles neón con brillo, formas y animaciones en vivo.
//
// Trazo = { id, tool, color, width, glow, anim, fill, pts: [[u,v], ...] }
//   width: grosor relativo a la altura de la superficie (0.01 = 1 %).
import { distToSegment } from "./math.js";

let sid = 1;
export const newStrokeId = () => "st" + Date.now().toString(36) + (sid++).toString(36);

const round = (v) => Math.round(v * 10000) / 10000;
export const roundPt = (u, v) => [round(u), round(v)];

export function isAnimated(strokes) {
  for (const s of strokes) if (s.anim && s.anim !== "none") return true;
  return false;
}

/** Firma barata para saber si hay que repintar un dibujo estático. */
export function strokesSignature(strokes, live) {
  let sig = strokes.length + ":";
  for (const s of strokes) sig += s.id + ",";
  if (live) sig += "|" + live.pts.length;
  return sig;
}

function hsl(h, l = 60) { return `hsl(${((h % 360) + 360) % 360},100%,${l}%)`; }

/** Puntos visibles del trazo según la animación "trazar" (se dibuja solo). */
function revealCount(n, t, idx) {
  const cycle = 3.2, p = ((t + idx * 0.37) % cycle) / cycle;
  return Math.max(2, Math.ceil(Math.min(1, p / 0.7) * n));
}

function pathFor(ctx, s, W, H, n) {
  const pts = s.pts;
  ctx.beginPath();
  if (s.tool === "line" && pts.length >= 2) {
    ctx.moveTo(pts[0][0] * W, pts[0][1] * H);
    ctx.lineTo(pts[1][0] * W, pts[1][1] * H);
    return;
  }
  if (s.tool === "rect" && pts.length >= 2) {
    const x = Math.min(pts[0][0], pts[1][0]) * W, y = Math.min(pts[0][1], pts[1][1]) * H;
    ctx.rect(x, y, Math.abs(pts[1][0] - pts[0][0]) * W, Math.abs(pts[1][1] - pts[0][1]) * H);
    return;
  }
  if (s.tool === "ellipse" && pts.length >= 2) {
    const cx = (pts[0][0] + pts[1][0]) / 2 * W, cy = (pts[0][1] + pts[1][1]) / 2 * H;
    const rx = Math.abs(pts[1][0] - pts[0][0]) / 2 * W, ry = Math.abs(pts[1][1] - pts[0][1]) / 2 * H;
    ctx.ellipse(cx, cy, Math.max(rx, 0.5), Math.max(ry, 0.5), 0, 0, Math.PI * 2);
    return;
  }
  const count = Math.min(n ?? pts.length, pts.length);
  if (!count) return;
  ctx.moveTo(pts[0][0] * W, pts[0][1] * H);
  if (count === 1) { ctx.lineTo(pts[0][0] * W + 0.01, pts[0][1] * H); return; }
  // Curva suave por puntos medios (quadratic) para que el trazo no se vea quebrado.
  for (let i = 1; i < count - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    ctx.quadraticCurveTo(pts[i][0] * W, pts[i][1] * H, mx * W, my * H);
  }
  ctx.lineTo(pts[count - 1][0] * W, pts[count - 1][1] * H);
}

/** Pinta todos los trazos en ctx (W×H) en el instante t (segundos). */
export function renderStrokes(ctx, strokes, W, H, t = 0, live = null, beat = 0) {
  ctx.clearRect(0, 0, W, H);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const list = live ? strokes.concat([live]) : strokes;
  list.forEach((s, idx) => {
    if (s.tool === "eraser") return;
    const anim = s.anim || "none";
    let color = s.color || "#ffffff";
    let alpha = 1, wMul = 1, n;
    if (anim === "rainbow") color = hsl(t * 90 + idx * 47);
    if (anim === "pulse") { const k = 0.5 + 0.5 * Math.sin(t * 5 + idx); alpha = 0.45 + 0.55 * k; wMul = 0.8 + 0.5 * k + beat * 0.6; }
    if (anim === "blink") alpha = (Math.floor(t * 3 + idx * 0.5) % 2) ? 0.08 : 1;
    if (anim === "draw" && s.pts.length > 2 && !["line", "rect", "ellipse"].includes(s.tool)) n = revealCount(s.pts.length, t, idx);
    const lw = Math.max(1, (s.width || 0.01) * H * wMul);
    ctx.save();
    if (anim === "flow") { ctx.setLineDash([lw * 1.6, lw * 2.4]); ctx.lineDashOffset = -t * lw * 8; }
    pathFor(ctx, s, W, H, n);
    if (s.fill && ["rect", "ellipse", "pen"].includes(s.tool)) {
      ctx.globalAlpha = alpha * 0.85;
      ctx.fillStyle = color;
      ctx.fill();
    }
    if (s.tool === "neon") {
      const g = s.glow ?? 0.6;
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = color;
      ctx.globalAlpha = alpha * 0.10; ctx.lineWidth = lw * (1 + g * 5); ctx.stroke();
      ctx.globalAlpha = alpha * 0.22; ctx.lineWidth = lw * (1 + g * 2.4); ctx.stroke();
      ctx.globalAlpha = alpha * 0.95; ctx.lineWidth = lw; ctx.stroke();
      ctx.strokeStyle = "#ffffff";
      ctx.globalAlpha = alpha * 0.75; ctx.lineWidth = lw * 0.35; ctx.stroke();
    } else {
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.stroke();
    }
    ctx.restore();
  });
}

/** Índice del trazo más cercano a (u,v) dentro de la tolerancia, o -1. */
export function hitStroke(strokes, u, v, tol, aspect = 1) {
  const P = { x: u * aspect, y: v };
  let best = -1, bestD = tol;
  strokes.forEach((s, i) => {
    const pts = s.pts.map(p => ({ x: p[0] * aspect, y: p[1] }));
    let d = Infinity;
    if (s.tool === "rect" && pts.length >= 2) {
      const a = pts[0], b = pts[1];
      const c = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
      for (let k = 0; k < 4; k++) d = Math.min(d, distToSegment(P, c[k], c[(k + 1) % 4]));
      if (s.fill && P.x >= Math.min(a.x, b.x) && P.x <= Math.max(a.x, b.x) && P.y >= Math.min(a.y, b.y) && P.y <= Math.max(a.y, b.y)) d = 0;
    } else if (s.tool === "ellipse" && pts.length >= 2) {
      const cx = (pts[0].x + pts[1].x) / 2, cy = (pts[0].y + pts[1].y) / 2;
      const rx = Math.max(Math.abs(pts[1].x - pts[0].x) / 2, 1e-4), ry = Math.max(Math.abs(pts[1].y - pts[0].y) / 2, 1e-4);
      const k = Math.hypot((P.x - cx) / rx, (P.y - cy) / ry);
      d = s.fill && k <= 1 ? 0 : Math.abs(k - 1) * Math.min(rx, ry);
    } else if (pts.length === 1) {
      d = Math.hypot(P.x - pts[0].x, P.y - pts[0].y);
    } else {
      for (let k = 0; k < pts.length - 1; k++) d = Math.min(d, distToSegment(P, pts[k], pts[k + 1]));
    }
    d -= (s.width || 0.01) / 2;
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

/**
 * Caché de lienzos de dibujo: un canvas por look. Repinta solo si cambian los
 * trazos o si alguno está animado. Devuelve {canvas, changed}.
 */
export class DrawingCache {
  constructor() { this.map = new Map(); }
  get(key, strokes, w, h, t, live, beat) {
    let e = this.map.get(key);
    if (!e) {
      const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
      e = { canvas, ctx: canvas.getContext("2d"), sig: null };
      this.map.set(key, e);
    }
    if (e.canvas.width !== w || e.canvas.height !== h) { e.canvas.width = w; e.canvas.height = h; e.sig = null; }
    const animated = isAnimated(strokes) || (live && live.anim && live.anim !== "none");
    const sig = strokesSignature(strokes, live);
    if (!animated && sig === e.sig) return { canvas: e.canvas, changed: false };
    renderStrokes(e.ctx, strokes, w, h, t, live, beat);
    e.sig = sig;
    return { canvas: e.canvas, changed: true };
  }
  clear() { this.map.clear(); }
}
