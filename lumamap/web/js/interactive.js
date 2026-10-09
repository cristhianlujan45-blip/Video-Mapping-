// web/js/interactive.js
// Proyecciones interactivas con cualquier cámara (web, USB, de captura…) o sensor:
// la gente se mueve delante de la proyección y la proyección reacciona.
//
//  · ALINEACIÓN cámara ↔ proyección: la cámara no ve exactamente lo mismo que
//    proyecta el proyector. Se marcan (o se detectan solas) las 4 esquinas de la
//    imagen proyectada dentro de la imagen de la cámara y todo lo que la cámara
//    detecta se lleva, con una homografía, al lugar exacto de la proyección: la
//    sombra, las partículas o las ondas salen justo donde está la persona.
//  · Calibración automática: el proyector muestra blanco y luego negro; la
//    diferencia entre ambas fotos de la cámara es la zona proyectada, y se busca
//    su contorno de 4 lados (la misma detección que el auto-mapping).
//  · Efectos interactivos nuevos (ondas, pintar, burbujas, partículas que se
//    apartan, huellas, chispas) que se suman a los de body.js. Todos dibujan con
//    el mismo código de canales: R = relleno con la animación, G = trazo neón,
//    B = estela; la GPU los colorea con la animación elegida.
import { homography, applyH, UNIT_SQUARE } from "./math.js";
import { detectQuads } from "./automap.js";
import { getCamera } from "./sources.js";
import { defaultInteractive, normalizeInteractive } from "./model.js";
export { defaultInteractive, normalizeInteractive };

/** Ajustes de interacción del proyecto (siempre válidos). */
export function calibOf(project) {
  const s = project.settings;
  if (!s.interactive) s.interactive = defaultInteractive();
  return s.interactive;
}

/**
 * Transformación cámara → proyección. Devuelve f(x, y) en coordenadas 0..1 de
 * la cámara (sin espejo) → 0..1 de la proyección, o null si no hay alineación.
 */
export function camToProj(cal) {
  if (!cal?.enabled) return null;
  try {
    const H = homography(cal.quad, UNIT_SQUARE);
    return H.every(Number.isFinite) ? (x, y) => applyH(H, x, y) : null;
  } catch { return null; }
}

/**
 * Dibuja una imagen de la cámara (img, en coordenadas de la cámara) en un
 * lienzo de la proyección (W×H) con la alineación: una malla de triángulos con
 * transformaciones afines (Canvas 2D no tiene perspectiva; con 8×8 celdas el
 * error es invisible). Si no hay alineación, la estira entera (como antes).
 */
export function drawAligned(ctx, img, cal, W, H, mirror = false) {
  const iw = img.width || img.videoWidth, ih = img.height || img.videoHeight;
  if (!iw || !ih) return;
  if (!cal?.enabled) {
    ctx.save();
    if (mirror) { ctx.translate(W, 0); ctx.scale(-1, 1); }
    ctx.drawImage(img, 0, 0, W, H);
    ctx.restore();
    return;
  }
  let Hm;
  try { Hm = homography(UNIT_SQUARE, cal.quad); } catch { return; }   // proyección → cámara
  const N = 8;
  const cam = (u, v) => { const [x, y] = applyH(Hm, u, v); return [x * iw, y * ih]; };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const u0 = i / N, u1 = (i + 1) / N, v0 = j / N, v1 = (j + 1) / N;
    const s00 = cam(u0, v0), s10 = cam(u1, v0), s01 = cam(u0, v1), s11 = cam(u1, v1);
    const d00 = [u0 * W, v0 * H], d10 = [u1 * W, v0 * H], d01 = [u0 * W, v1 * H], d11 = [u1 * W, v1 * H];
    tri(ctx, img, s00, s10, s01, d00, d10, d01);
    tri(ctx, img, s10, s11, s01, d10, d11, d01);
  }
}
/** Un triángulo de la imagen (s0,s1,s2) en el destino (d0,d1,d2) con transformación afín. */
function tri(ctx, img, s0, s1, s2, d0, d1, d2) {
  // Se agranda un poco el triángulo de destino para que no se vean costuras.
  const cx = (d0[0] + d1[0] + d2[0]) / 3, cy = (d0[1] + d1[1] + d2[1]) / 3;
  const g = (p) => [p[0] + Math.sign(p[0] - cx) * 0.6, p[1] + Math.sign(p[1] - cy) * 0.6];
  const D0 = g(d0), D1 = g(d1), D2 = g(d2);
  const sx1 = s1[0] - s0[0], sy1 = s1[1] - s0[1], sx2 = s2[0] - s0[0], sy2 = s2[1] - s0[1];
  const det = sx1 * sy2 - sx2 * sy1;
  if (Math.abs(det) < 1e-9) return;
  const dx1 = d1[0] - d0[0], dy1 = d1[1] - d0[1], dx2 = d2[0] - d0[0], dy2 = d2[1] - d0[1];
  const a = (dx1 * sy2 - dx2 * sy1) / det, b = (dy1 * sy2 - dy2 * sy1) / det;
  const c = (dx2 * sx1 - dx1 * sx2) / det, d = (dy2 * sx1 - dy1 * sx2) / det;
  const e = d0[0] - a * s0[0] - c * s0[1], f = d0[1] - b * s0[0] - d * s0[1];
  ctx.save();
  ctx.beginPath(); ctx.moveTo(D0[0], D0[1]); ctx.lineTo(D1[0], D1[1]); ctx.lineTo(D2[0], D2[1]); ctx.closePath(); ctx.clip();
  ctx.setTransform(ctx.getTransform().multiply(new DOMMatrix([a, b, c, d, e, f])));
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

/* ======================================================================
   Calibración automática (blanco / negro)
   ====================================================================== */
const wait = (ms) => new Promise(r => setTimeout(r, ms));
function grab(video, w) {
  const h = Math.round(w * video.videoHeight / video.videoWidth);
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}
/** Diferencia blanco − negro en escala de grises (lo que ilumina el proyector). */
export function projectedArea(white, black) {
  const w = white.width, h = white.height, out = new ImageData(w, h);
  let max = 0;
  const diff = new Float32Array(w * h);
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    const lw = white.data[j] * 0.3 + white.data[j + 1] * 0.59 + white.data[j + 2] * 0.11;
    const lb = black.data[j] * 0.3 + black.data[j + 1] * 0.59 + black.data[j + 2] * 0.11;
    diff[i] = Math.max(0, lw - lb); if (diff[i] > max) max = diff[i];
  }
  // Imagen binaria (blanco = iluminado por el proyector) para la búsqueda de contornos.
  const thr = Math.max(12, max * 0.35);
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    const v = diff[i] > thr ? 255 : 0;
    out.data[j] = out.data[j + 1] = out.data[j + 2] = v; out.data[j + 3] = 255;
  }
  return { img: out, contrast: max };
}
/** Ordena 4 puntos como TL, TR, BR, BL. */
export function orderQuad(pts) {
  const c = pts.reduce((a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4], [0, 0]);
  const ang = (p) => Math.atan2(p[1] - c[1], p[0] - c[0]);
  const s = [...pts].sort((a, b) => ang(a) - ang(b));             // -π..π: empieza arriba a la izquierda
  const tl = s.reduce((best, p, i) => (p[0] + p[1] < s[best][0] + s[best][1] ? i : best), 0);
  return [0, 1, 2, 3].map(k => s[(tl + k) % 4]);
}

/**
 * Calibra sola: muestra blanco y negro en las salidas y mira con la cámara.
 * showPattern(name|null) lo da el editor. Devuelve { ok, quad?, message }.
 */
export async function autoCalibrate(camKey, showPattern) {
  let cam;
  try { cam = await getCamera(camKey || "default"); }
  catch (e) { return { ok: false, message: "No se pudo abrir la cámara: " + (e.message || e) }; }
  const v = cam.el;
  for (let i = 0; i < 40 && (v.readyState < 2 || !v.videoWidth); i++) await wait(100);
  if (!v.videoWidth) return { ok: false, message: "La cámara no da imagen." };
  try {
    showPattern("black"); await wait(900);
    const black = grab(v, 320);
    showPattern("white"); await wait(900);
    const white = grab(v, 320);
    showPattern(null);
    const { img, contrast } = projectedArea(white, black);
    if (contrast < 25) return { ok: false, message: "La cámara no ve cambiar la proyección. Apúntala a la zona proyectada (y que el proyector esté encendido y saliendo por la pantalla correcta)." };
    const quads = detectQuads(img, { maxQuads: 3, minAreaRatio: 0.03 });
    if (!quads.length) return { ok: false, message: "No se encontró el contorno de la proyección. Ajusta las esquinas a mano." };
    const q = quads[0].points.map(p => [p.x / img.width, p.y / img.height]);   // px de la cámara → 0..1
    return { ok: true, quad: orderQuad(q), message: "Alineación lista." };
  } finally { showPattern(null); }
}

/* ======================================================================
   Efectos interactivos nuevos
   ====================================================================== */
export const NEW_MODES = [
  ["ondas", "Ondas al pisar o tocar"], ["pintar", "Pintar con el cuerpo"], ["burbujas", "Burbujas que explotan"],
  ["apartar", "Partículas que se apartan"], ["huellas", "Huellas de luz"], ["chispas", "Chispas al tocar"],
  ["baldosas", "Baldosas que se encienden"], ["pixeles", "Silueta de píxeles"], ["luciernagas", "Luciérnagas que te siguen"],
  ["lluvia", "Lluvia que te esquiva"], ["fuegos", "Fuegos artificiales"], ["estrellas", "Estela de estrellas"],
  ["laser", "Rayos láser a las personas"], ["revelar", "Revelar la imagen"],
];
export const NEW_MODE_IDS = new Set(NEW_MODES.map(m => m[0]));

/** Galería del modo fácil: efecto → modo de cuerpo + animación que lo colorea. */
export const INTERACTIVE_FX = [
  { mode: "silueta", name: "Silueta de colores", desc: "La persona se llena de animación", gen: "rainbow" },
  { mode: "contorno", name: "Contorno de neón", desc: "Un borde de luz alrededor del cuerpo", gen: "plasma" },
  { mode: "estela", name: "Estela mágica", desc: "Al moverse deja un rastro de color", gen: "aurora" },
  { mode: "sombra", name: "Sombra", desc: "La animación alrededor; la persona en negro", gen: "plasma" },
  { mode: "ondas", name: "Ondas al pisar", desc: "Círculos de agua donde alguien pisa o toca", gen: "ocean" },
  { mode: "pintar", name: "Pintar con el cuerpo", desc: "El cuerpo pinta la pared y se borra solo", gen: "rainbow" },
  { mode: "burbujas", name: "Burbujas que explotan", desc: "Juego: toca las burbujas para reventarlas", gen: "rainbow" },
  { mode: "apartar", name: "Partículas que se apartan", desc: "Una nube de partículas que te esquiva", gen: "galaxy" },
  { mode: "huellas", name: "Huellas de luz", desc: "Para el suelo: cada paso deja luz", gen: "fire" },
  { mode: "chispas", name: "Chispas al tocar", desc: "Donde tocas saltan chispas", gen: "fire" },
  { mode: "baldosas", name: "Baldosas que se encienden", desc: "Suelo de discoteca: se ilumina donde pisas", gen: "rainbow" },
  { mode: "pixeles", name: "Silueta de píxeles", desc: "La persona hecha de cuadrados de colores", gen: "rainbow" },
  { mode: "luciernagas", name: "Luciérnagas que te siguen", desc: "Lucecitas que vuelan hacia la gente", gen: "fire" },
  { mode: "lluvia", name: "Lluvia que te esquiva", desc: "Cae lluvia y la persona hace de paraguas", gen: "ocean" },
  { mode: "fuegos", name: "Fuegos artificiales", desc: "Al moverte salen fuegos hacia arriba", gen: "rainbow" },
  { mode: "estrellas", name: "Estela de estrellas", desc: "Al moverte dejas estrellas brillantes", gen: "galaxy" },
  { mode: "laser", name: "Rayos láser a las personas", desc: "Rayos desde arriba que siguen a la gente", gen: "plasma" },
  { mode: "revelar", name: "Revelar la imagen", desc: "Por donde pasas aparece la animación oculta", gen: "galaxy" },
  { mode: "particulas", name: "Partículas de manos y pies", desc: "Salen de manos y pies al moverse", gen: "rainbow" },
  { mode: "fuego", name: "Manos de fuego", desc: "Fuego que sale de manos y pies", gen: "fire" },
  { mode: "humo", name: "Humo", desc: "Humo que sigue al cuerpo", gen: "smoke" },
  { mode: "esqueleto", name: "Esqueleto de luz", desc: "Huesos de neón que bailan contigo", gen: "plasma" },
  { mode: "lineas", name: "Líneas entre personas", desc: "Une manos y cabezas de todos", gen: "rainbow" },
  { mode: "geometria", name: "Geometría", desc: "El cuerpo hecho de triángulos", gen: "plasma" },
];

const GW = 48;   // rejilla de detección (columnas)
/** Simulación de los efectos nuevos en un lienzo W×H (coordenadas de la proyección). */
export class InteractiveFX {
  constructor() {
    this.grid = null; this.prev = null; this.cool = null; this.items = []; this.parts = [];
    this.small = null; this.paint = null; this.last = 0;
  }
  /** Lee la máscara alineada a una rejilla pequeña: presencia (0..1) y lo que cambió. */
  sense(mask, W, H) {
    const gh = Math.max(8, Math.round(GW * H / W));
    if (!this.small) { this.small = document.createElement("canvas"); }
    if (this.small.width !== GW || this.small.height !== gh) { this.small.width = GW; this.small.height = gh; this.prev = null; }
    const sc = this.small.getContext("2d", { willReadFrequently: true });
    sc.clearRect(0, 0, GW, gh);
    sc.drawImage(mask, 0, 0, GW, gh);
    const d = sc.getImageData(0, 0, GW, gh).data, n = GW * gh;
    if (!this.prev || this.prev.length !== n) { this.prev = new Float32Array(n); this.cool = new Float32Array(n); this.grid = new Float32Array(n); }
    const motion = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const v = d[i * 4 + 3] / 255;
      motion[i] = Math.max(0, v - this.prev[i] * 0.85);
      this.prev[i] = v; this.grid[i] = v;
    }
    return { gw: GW, gh, pres: this.grid, motion };
  }
  render(out, mask, mode, W, H, dt, sens = 0.5) {
    const g = this.sense(mask, W, H), cw = W / g.gw, ch = H / g.gh;
    const at = (x, y) => { const i = Math.min(g.gw - 1, Math.max(0, Math.floor(x / cw))), j = Math.min(g.gh - 1, Math.max(0, Math.floor(y / ch))); return j * g.gw + i; };
    const thr = 0.55 - sens * 0.4;
    const ctx = out.getContext("2d");
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "lighter";
    const now = performance.now() / 1000;
    for (let k = 0; k < this.cool.length; k++) this.cool[k] = Math.max(0, this.cool[k] - dt);
    const triggers = [];
    for (let k = 0; k < g.motion.length; k++) if (g.motion[k] > thr && this.cool[k] <= 0) { triggers.push(k); this.cool[k] = 0.35; }

    if (mode === "ondas" || mode === "huellas" || mode === "chispas") {
      for (const k of triggers.slice(0, 12)) {
        const x = (k % g.gw + 0.5) * cw, y = (Math.floor(k / g.gw) + 0.5) * ch;
        if (mode === "ondas") this.items.push({ x, y, r: 4, life: 1 });
        else if (mode === "huellas") this.items.push({ x, y, r: Math.max(cw, ch) * 1.2, life: 1 });
        else for (let i = 0; i < 10; i++) this.parts.push({ x, y, vx: (Math.random() - 0.5) * 360, vy: -Math.random() * 300, life: 1 });
      }
      if (this.items.length > 300) this.items.splice(0, this.items.length - 300);
      for (let i = this.items.length - 1; i >= 0; i--) {
        const it = this.items[i];
        it.life -= dt * (mode === "huellas" ? 0.35 : 0.7);
        if (it.life <= 0) { this.items.splice(i, 1); continue; }
        if (mode === "ondas") {
          it.r += dt * Math.max(W, H) * 0.22;
          ctx.lineWidth = 2 + 6 * it.life;
          ctx.strokeStyle = `rgba(0,255,0,${it.life})`;          // G: anillo de neón
          ctx.beginPath(); ctx.arc(it.x, it.y, it.r, 0, Math.PI * 2); ctx.stroke();
          ctx.fillStyle = `rgba(255,0,0,${it.life * 0.25})`;       // R: interior con la animación
          ctx.fill();
        } else {
          const rg = ctx.createRadialGradient(it.x, it.y, 0, it.x, it.y, it.r);
          rg.addColorStop(0, `rgba(255,0,0,${it.life})`); rg.addColorStop(1, "rgba(255,0,0,0)");
          ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(it.x, it.y, it.r, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
    if (mode === "chispas") {
      if (this.parts.length > 2500) this.parts.splice(0, this.parts.length - 2500);
      for (let i = this.parts.length - 1; i >= 0; i--) {
        const q = this.parts[i];
        q.life -= dt * 1.1; if (q.life <= 0) { this.parts.splice(i, 1); continue; }
        q.vy += 500 * dt; q.x += q.vx * dt; q.y += q.vy * dt;
        ctx.strokeStyle = `rgba(255,255,0,${q.life})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x - q.vx * 0.03, q.y - q.vy * 0.03); ctx.stroke();
      }
    }
    if (mode === "pintar") {
      if (!this.paint) this.paint = document.createElement("canvas");
      if (this.paint.width !== W || this.paint.height !== H) { this.paint.width = W; this.paint.height = H; }
      const p = this.paint.getContext("2d");
      p.globalCompositeOperation = "destination-out";
      p.fillStyle = `rgba(0,0,0,${0.004 + (1 - sens) * 0.02})`; p.fillRect(0, 0, W, H);   // se borra solo, despacio
      p.globalCompositeOperation = "lighter";
      p.globalAlpha = 0.25;
      p.filter = "blur(3px)";
      p.drawImage(mask, 0, 0, W, H);
      p.filter = "none"; p.globalAlpha = 1;
      // La pintura (alfa) se pasa al canal R; el contorno actual va en G.
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
      ctx.drawImage(this.paint, 0, 0);
      ctx.globalCompositeOperation = "source-in"; ctx.fillStyle = "#ff0000"; ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = "destination-over"; ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";
    }
    if (mode === "burbujas") {
      if (now - this.last > 0.35 && this.items.length < 40) { this.last = now; this.items.push({ x: Math.random() * W, y: H + 30, r: 18 + Math.random() * 40, vy: 30 + Math.random() * 50, ph: Math.random() * 6, life: 1 }); }
      for (let i = this.items.length - 1; i >= 0; i--) {
        const b = this.items[i];
        b.y -= b.vy * dt; b.ph += dt * 2;
        const x = b.x + Math.sin(b.ph) * 12;
        if (b.y < -60) { this.items.splice(i, 1); continue; }
        if (g.pres[at(x, b.y)] > 0.5 || g.motion[at(x, b.y)] > thr) {
          for (let k = 0; k < 18; k++) { const a = Math.random() * Math.PI * 2, s = 80 + Math.random() * 220; this.parts.push({ x, y: b.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1 }); }
          this.items.splice(i, 1); continue;
        }
        ctx.strokeStyle = "rgba(0,255,0,0.9)"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(x, b.y, b.r, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = "rgba(255,0,0,0.25)"; ctx.fill();
      }
      for (let i = this.parts.length - 1; i >= 0; i--) {
        const q = this.parts[i];
        q.life -= dt * 1.6; if (q.life <= 0) { this.parts.splice(i, 1); continue; }
        q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 0.96; q.vy *= 0.96;
        ctx.fillStyle = `rgba(255,0,0,${q.life})`; ctx.beginPath(); ctx.arc(q.x, q.y, 3, 0, Math.PI * 2); ctx.fill();
      }
    }
    if (mode === "baldosas" || mode === "pixeles") {
      // Rejilla de casillas: se encienden donde hay alguien y se apagan despacio.
      const cols = mode === "baldosas" ? 10 : 32, rows = Math.max(4, Math.round(cols * H / W)), tw = W / cols, th = H / rows;
      if (!this.tiles || this.tiles.length !== cols * rows) this.tiles = new Float32Array(cols * rows);
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        let sum = 0, n = 0;
        for (let y = Math.floor(j * th / ch); y < Math.ceil((j + 1) * th / ch) && y < g.gh; y++) for (let x = Math.floor(i * tw / cw); x < Math.ceil((i + 1) * tw / cw) && x < g.gw; x++) { sum += g.pres[y * g.gw + x]; n++; }
        const on = n ? sum / n : 0, k = j * cols + i;
        this.tiles[k] = Math.max(on > 0.25 ? 1 : 0, this.tiles[k] - dt * (mode === "baldosas" ? 0.8 : 4));
        const v = this.tiles[k];
        if (v <= 0.01) continue;
        ctx.fillStyle = `rgba(255,0,0,${v})`; ctx.fillRect(i * tw + 2, j * th + 2, tw - 4, th - 4);
        if (mode === "baldosas") { ctx.strokeStyle = `rgba(0,255,0,${v})`; ctx.lineWidth = 2; ctx.strokeRect(i * tw + 3, j * th + 3, tw - 6, th - 6); }
      }
    }
    if (mode === "luciernagas") {
      const ps = this.parts;
      while (ps.length < 260) ps.push({ x: Math.random() * W, y: Math.random() * H, vx: 0, vy: 0, life: 1, ph: Math.random() * 6 });
      // Hacia el cuerpo: el punto con presencia más cercano de una muestra.
      const hot = [];
      for (let k = 0; k < g.pres.length; k += 3) if (g.pres[k] > 0.5) hot.push(k);
      for (const q of ps) {
        if (hot.length) {
          const k = hot[(Math.abs(Math.floor(q.ph * 1000)) + Math.floor(now)) % hot.length];
          const tx = (k % g.gw + 0.5) * cw, ty = (Math.floor(k / g.gw) + 0.5) * ch;
          q.vx += (tx - q.x) * 0.6 * dt; q.vy += (ty - q.y) * 0.6 * dt;
        }
        q.vx += Math.sin(now * 2 + q.ph) * 30 * dt; q.vy += Math.cos(now * 1.7 + q.ph) * 30 * dt;
        q.vx *= 0.96; q.vy *= 0.96; q.x += q.vx * dt; q.y += q.vy * dt;
        const glow = 0.5 + 0.5 * Math.sin(now * 4 + q.ph * 3);
        const rg = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, 7);
        rg.addColorStop(0, `rgba(255,255,0,${glow})`); rg.addColorStop(1, "rgba(255,0,0,0)");
        ctx.fillStyle = rg; ctx.fillRect(q.x - 7, q.y - 7, 14, 14);
      }
    }
    if (mode === "lluvia") {
      const ps = this.parts;
      for (let k = 0; k < 6; k++) ps.push({ x: Math.random() * W, y: -10, vx: 0, vy: 500 + Math.random() * 300, life: 1, drop: true });
      if (ps.length > 1500) ps.splice(0, ps.length - 1500);
      for (let i = ps.length - 1; i >= 0; i--) {
        const q = ps[i];
        q.x += q.vx * dt; q.y += q.vy * dt;
        if (q.drop) {
          if (q.y > H || g.pres[at(q.x, q.y)] > 0.5) {   // choca con el suelo o con una persona: salpica
            for (let k = 0; k < 3; k++) ps.push({ x: q.x, y: q.y, vx: (Math.random() - 0.5) * 160, vy: -60 - Math.random() * 120, life: 1, drop: false });
            ps.splice(i, 1); continue;
          }
          ctx.strokeStyle = "rgba(255,0,0,0.8)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x, q.y - 12); ctx.stroke();
        } else {
          q.vy += 600 * dt; q.life -= dt * 2.5;
          if (q.life <= 0) { ps.splice(i, 1); continue; }
          ctx.fillStyle = `rgba(0,255,0,${q.life})`; ctx.fillRect(q.x - 1, q.y - 1, 2.5, 2.5);
        }
      }
    }
    if (mode === "fuegos") {
      for (const k of triggers.slice(0, 2)) if (this.items.length < 12) this.items.push({ x: (k % g.gw + 0.5) * cw, y: H, ty: (Math.floor(k / g.gw) + 0.5) * ch * 0.6, vy: -H * 1.1, life: 1, hue: Math.random() });
      for (let i = this.items.length - 1; i >= 0; i--) {
        const r = this.items[i];
        r.y += r.vy * dt;
        ctx.fillStyle = "rgba(0,255,0,0.9)"; ctx.fillRect(r.x - 1.5, r.y - 6, 3, 10);
        if (r.y <= r.ty) {
          for (let k = 0; k < 50; k++) { const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 220; this.parts.push({ x: r.x, y: r.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1 }); }
          this.items.splice(i, 1);
        }
      }
      if (this.parts.length > 2500) this.parts.splice(0, this.parts.length - 2500);
      for (let i = this.parts.length - 1; i >= 0; i--) {
        const q = this.parts[i];
        q.life -= dt * 0.7; if (q.life <= 0) { this.parts.splice(i, 1); continue; }
        q.vy += 90 * dt; q.vx *= 0.985; q.vy *= 0.985; q.x += q.vx * dt; q.y += q.vy * dt;
        ctx.fillStyle = `rgba(255,0,0,${q.life})`; ctx.fillRect(q.x - 1.5, q.y - 1.5, 3, 3);
      }
    }
    if (mode === "estrellas") {
      for (const k of triggers) for (let n = 0; n < 3; n++) this.parts.push({ x: (k % g.gw + Math.random()) * cw, y: (Math.floor(k / g.gw) + Math.random()) * ch, vx: (Math.random() - 0.5) * 20, vy: -10 - Math.random() * 20, life: 1, s: 1.5 + Math.random() * 3 });
      if (this.parts.length > 2000) this.parts.splice(0, this.parts.length - 2000);
      for (let i = this.parts.length - 1; i >= 0; i--) {
        const q = this.parts[i];
        q.life -= dt * 0.5; if (q.life <= 0) { this.parts.splice(i, 1); continue; }
        q.x += q.vx * dt; q.y += q.vy * dt;
        const tw = q.life * (0.6 + 0.4 * Math.sin(now * 9 + q.x));
        ctx.strokeStyle = `rgba(0,255,0,${tw})`; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(q.x - q.s * 2, q.y); ctx.lineTo(q.x + q.s * 2, q.y); ctx.moveTo(q.x, q.y - q.s * 2); ctx.lineTo(q.x, q.y + q.s * 2); ctx.stroke();
      }
    }
    if (mode === "laser") {
      // Hasta 4 «personas»: columnas con más presencia; los rayos salen de arriba y las apuntan.
      const colSum = new Float32Array(g.gw);
      for (let k = 0; k < g.pres.length; k++) colSum[k % g.gw] += g.pres[k];
      const targets = [];
      for (let x = 1; x < g.gw - 1; x++) if (colSum[x] > g.gh * 0.15 && colSum[x] >= colSum[x - 1] && colSum[x] >= colSum[x + 1]) targets.push(x);
      targets.sort((a, b) => colSum[b] - colSum[a]);
      const srcs = [[0, 0], [W / 2, 0], [W, 0]];
      ctx.lineWidth = 3;
      for (const x of targets.slice(0, 4)) {
        let top = 0; for (let y = 0; y < g.gh; y++) if (g.pres[y * g.gw + x] > 0.5) { top = y; break; }
        const tx = (x + 0.5) * cw, ty = (top + 1.5) * ch;
        for (const [sx, sy] of srcs) { ctx.strokeStyle = "rgba(0,255,0,0.85)"; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(tx, ty); ctx.stroke(); }
        const rg = ctx.createRadialGradient(tx, ty, 0, tx, ty, 26); rg.addColorStop(0, "rgba(255,0,0,1)"); rg.addColorStop(1, "rgba(255,0,0,0)");
        ctx.fillStyle = rg; ctx.fillRect(tx - 26, ty - 26, 52, 52);
      }
    }
    if (mode === "revelar") {
      if (!this.paint) this.paint = document.createElement("canvas");
      if (this.paint.width !== W || this.paint.height !== H) { this.paint.width = W; this.paint.height = H; }
      const p = this.paint.getContext("2d");
      p.globalCompositeOperation = "destination-out"; p.fillStyle = `rgba(0,0,0,${0.002 + (1 - sens) * 0.006})`; p.fillRect(0, 0, W, H);
      p.globalCompositeOperation = "source-over"; p.drawImage(mask, 0, 0, W, H);
      ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(this.paint, 0, 0);
      ctx.globalCompositeOperation = "source-in"; ctx.fillStyle = "#ff0000"; ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = "destination-over"; ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";
    }
    if (mode === "apartar") {
      const ps = this.parts;
      while (ps.length < 900) ps.push({ x: Math.random() * W, y: Math.random() * H, vx: 0, vy: 0, life: 1, hx: 0, hy: 0 });
      for (const q of ps) {
        // Lo que hay alrededor: se empuja hacia donde hay menos cuerpo.
        const i = at(q.x, q.y), here = g.pres[i];
        if (here > 0.3) {
          const gx = g.pres[at(q.x + cw, q.y)] - g.pres[at(q.x - cw, q.y)], gy = g.pres[at(q.x, q.y + ch)] - g.pres[at(q.x, q.y - ch)];
          const len = Math.hypot(gx, gy) || 1;
          q.vx += (-gx / len) * 900 * dt * here; q.vy += (-gy / len) * 900 * dt * here;
          if (Math.abs(gx) + Math.abs(gy) < 0.01) { q.vx += (Math.random() - 0.5) * 600 * dt; q.vy += (Math.random() - 0.5) * 600 * dt; }
        }
        // Deriva suave para que la nube esté viva.
        q.vx += Math.sin(q.y * 0.01 + now * 0.7) * 12 * dt; q.vy += Math.cos(q.x * 0.01 + now * 0.5) * 12 * dt;
        q.vx *= 0.94; q.vy *= 0.94;
        q.x = (q.x + q.vx * dt + W) % W; q.y = (q.y + q.vy * dt + H) % H;
        const sp = Math.min(1, Math.hypot(q.vx, q.vy) / 200);
        ctx.fillStyle = `rgba(255,${Math.round(sp * 255)},0,0.9)`;
        ctx.fillRect(q.x - 1.5, q.y - 1.5, 3, 3);
      }
    }
    ctx.globalCompositeOperation = "source-over";
  }
}
