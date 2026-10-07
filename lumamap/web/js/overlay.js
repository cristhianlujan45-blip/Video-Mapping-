// web/js/overlay.js
// Dibujo 2D sobre el render: patrones de prueba del proyector y guías de
// alineación (contornos, puntos). Se usa en el editor y en la salida.
import { surfaceOutline, gridCornerIdx, edgeHandles } from "./math.js";

/** Distancia (px de pantalla) del asa de giro al borde superior. */
export const ROT_OFF = 44;

export const PATTERNS = [
  ["grid", "Cuadrícula"], ["white", "Blanco"], ["bars", "Barras"], ["red", "Rojo"],
  ["green", "Verde"], ["blue", "Azul"],
];

export function drawPattern(ctx, name, W, H) {
  const c = ctx;
  if (name === "white" || name === "red" || name === "green" || name === "blue") {
    c.fillStyle = { white: "#fff", red: "#f00", green: "#0f0", blue: "#00f" }[name];
    c.fillRect(0, 0, W, H);
    return;
  }
  if (name === "bars") {
    const cols = ["#fff", "#ff0", "#0ff", "#0f0", "#f0f", "#f00", "#00f", "#000"];
    cols.forEach((col, i) => { c.fillStyle = col; c.fillRect(Math.floor(i * W / 8), 0, Math.ceil(W / 8), H); });
    return;
  }
  // Cuadrícula de alineación con centro, círculo y bordes.
  c.fillStyle = "#000"; c.fillRect(0, 0, W, H);
  const step = Math.max(W, H) / 16;
  c.strokeStyle = "rgba(0,229,255,.75)"; c.lineWidth = Math.max(1, W / 1920);
  c.beginPath();
  for (let x = W / 2 % step; x <= W; x += step) { c.moveTo(x, 0); c.lineTo(x, H); }
  for (let y = H / 2 % step; y <= H; y += step) { c.moveTo(0, y); c.lineTo(W, y); }
  c.stroke();
  c.strokeStyle = "#fff"; c.lineWidth = Math.max(2, W / 640);
  c.strokeRect(c.lineWidth / 2, c.lineWidth / 2, W - c.lineWidth, H - c.lineWidth);
  c.beginPath(); c.moveTo(W / 2, 0); c.lineTo(W / 2, H); c.moveTo(0, H / 2); c.lineTo(W, H / 2);
  c.moveTo(0, 0); c.lineTo(W, H); c.moveTo(W, 0); c.lineTo(0, H); c.stroke();
  c.beginPath(); c.arc(W / 2, H / 2, H * 0.4, 0, Math.PI * 2); c.stroke();
}

/**
 * Guías de alineación: contorno de cada superficie y puntos de la seleccionada.
 * view = {sx, sy, tx, ty}; scale = tamaño de punto en px del canvas.
 */
export function drawGuides(ctx, project, view, { selectedId = null, pointIdx = -1, scale = 1, showAll = true, edges = true, edgeActive = null, rot = null, rotActive = null } = {}) {
  const X = (p) => p.x * view.sx + view.tx, Y = (p) => p.y * view.sy + view.ty;
  for (const s of project.surfaces) {
    if (s.hidden) continue;
    const sel = s.id === selectedId;
    if (!sel && !showAll) continue;
    const out = surfaceOutline(s);
    ctx.beginPath();
    out.forEach((p, i) => (i ? ctx.lineTo(X(p), Y(p)) : ctx.moveTo(X(p), Y(p))));
    ctx.closePath();
    ctx.lineWidth = (sel ? 3 : 1.5) * scale;
    ctx.strokeStyle = sel ? "#ffd60a" : "rgba(0,229,255,.8)";
    ctx.stroke();
    if (!sel) continue;
    if (s.type === "quad" && (s.cols > 2 || s.rows > 2)) {
      ctx.lineWidth = 1 * scale;
      ctx.strokeStyle = "rgba(255,214,10,.45)";
      for (let r = 0; r < s.rows; r++) {
        ctx.beginPath();
        for (let c = 0; c < s.cols; c++) { const p = s.points[r * s.cols + c]; c ? ctx.lineTo(X(p), Y(p)) : ctx.moveTo(X(p), Y(p)); }
        ctx.stroke();
      }
      for (let c = 0; c < s.cols; c++) {
        ctx.beginPath();
        for (let r = 0; r < s.rows; r++) { const p = s.points[r * s.cols + c]; r ? ctx.lineTo(X(p), Y(p)) : ctx.moveTo(X(p), Y(p)); }
        ctx.stroke();
      }
    }
    // Asas de los lados: cambian el tamaño sin girar ni deformar la perspectiva.
    if (edges && !s.locked) {
      for (const e of edgeHandles(s)) {
        const x = X(e), y = Y(e), ang = Math.atan2(e.ny * view.sy, e.nx * view.sx);
        ctx.save();
        ctx.translate(x, y); ctx.rotate(ang);
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(-5 * scale, -11 * scale, 10 * scale, 22 * scale, 4 * scale) : ctx.rect(-5 * scale, -11 * scale, 10 * scale, 22 * scale);
        ctx.fillStyle = e.side === edgeActive ? "#ff2d55" : "#ffffff";
        ctx.fill();
        ctx.lineWidth = 2 * scale; ctx.strokeStyle = "#000"; ctx.stroke();
        ctx.restore();
      }
    }
    // Asa de giro (círculo con flecha encima del lado superior): gira a cualquier ángulo.
    if (rot && !s.locked) {
      const rh = rot;
      {
        const x = X(rh), y = Y(rh);
        ctx.beginPath(); ctx.moveTo(X({ x: rh.bx }), Y({ y: rh.by })); ctx.lineTo(x, y);
        ctx.lineWidth = 2 * scale; ctx.strokeStyle = "rgba(255,255,255,.7)"; ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, 12 * scale, 0, Math.PI * 2);
        ctx.fillStyle = rotActive != null ? "#ff2d55" : "#00e5ff"; ctx.fill();
        ctx.lineWidth = 2 * scale; ctx.strokeStyle = "#000"; ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, 6 * scale, -Math.PI * 0.9, Math.PI * 0.5);
        ctx.strokeStyle = "#000"; ctx.lineWidth = 2 * scale; ctx.stroke();
        if (rotActive != null) {
          ctx.font = `bold ${14 * scale}px system-ui, sans-serif`; ctx.textAlign = "center";
          const txt = Math.round(rotActive) + "°";
          ctx.lineWidth = 4 * scale; ctx.strokeStyle = "#000"; ctx.strokeText(txt, x, y - 20 * scale);
          ctx.fillStyle = "#fff"; ctx.fillText(txt, x, y - 20 * scale);
        }
      }
    }
    const corners = s.type === "quad" ? new Set(gridCornerIdx(s.cols, s.rows)) : null;
    s.points.forEach((p, i) => {
      const big = !corners || corners.has(i);
      ctx.beginPath();
      ctx.arc(X(p), Y(p), (big ? 9 : 6) * scale, 0, Math.PI * 2);
      ctx.fillStyle = i === pointIdx ? "#ff2d55" : "#ffd60a";
      ctx.fill();
      ctx.lineWidth = 2 * scale; ctx.strokeStyle = "#000"; ctx.stroke();
    });
  }
}

/* ---------------- Ajustes de salida (proyector) ---------------- */

/** Corrección de color y orientación del proyector (techo / retroproyección) vía CSS. */
export function applyOutputCSS(els, o) {
  const f = `brightness(${o.brightness ?? 1}) contrast(${o.contrast ?? 1}) saturate(${o.saturation ?? 1})`;
  const t = `scale(${o.flipH ? -1 : 1}, ${o.flipV ? -1 : 1}) rotate(${o.rotate === 180 ? 180 : 0}deg)`;
  for (const el of els) {
    if (!el) continue;
    const ff = f === "brightness(1) contrast(1) saturate(1)" ? "" : f;
    if (el.style.filter !== ff) el.style.filter = ff;
    const tt = t === "scale(1, 1) rotate(0deg)" ? "" : t;
    if (el.style.transform !== tt) el.style.transform = tt;
  }
}

/**
 * Bordes suaves (edge blending): degradado a negro en los lados donde dos
 * proyectores se solapan, con curva gamma para que la suma de luz quede pareja.
 * Los anchos son fracción de la salida (0.15 = 15 %). x,y,W,H = zona de salida.
 */
export function drawSoftEdge(ctx, se, x, y, W, H) {
  if (!se) return;
  const curve = se.curve || 2.2;
  const ramp = (x0, y0, x1, y1, rx, ry, rw, rh) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;                                   // 0 = borde, 1 = interior
      g.addColorStop(t, `rgba(0,0,0,${(1 - Math.pow(t, 1 / curve)).toFixed(3)})`);
    }
    ctx.fillStyle = g;
    ctx.fillRect(rx, ry, rw, rh);
  };
  if (se.left > 0) { const w = W * se.left; ramp(x, 0, x + w, 0, x, y, w, H); }
  if (se.right > 0) { const w = W * se.right; ramp(x + W, 0, x + W - w, 0, x + W - w, y, w, H); }
  if (se.top > 0) { const h = H * se.top; ramp(0, y, 0, y + h, x, y, W, h); }
  if (se.bottom > 0) { const h = H * se.bottom; ramp(0, y + H, 0, y + H - h, x, y + H - h, W, h); }
}
