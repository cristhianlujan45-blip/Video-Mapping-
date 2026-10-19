// web/js/graycode.js
// Luz estructurada (código Gray) para calibrar con la cámara.
// El proyector muestra franjas blancas y negras (verticales para la X, horizontales para la Y; cada
// una con su inversa) y la cámara las fotografía. Comparando cada franja con su inversa, cada
// píxel de la cámara sabe qué píxel del proyector lo ilumina: así, al tocar una esquina del objeto
// en la foto de la cámara, LumaMap sabe dónde cae en el proyector sin mover cruces a ojo.
// El código Gray cambia un solo bit entre franjas vecinas: un error en un borde se queda en ±1.
// Aquí no hay nada de la página: dibujar los patrones, decodificar y buscar. La cámara la pone
// quien llama (scanGray recibe grabFrame).

export const GRAY_BITS = 10;          // 1024 franjas por eje: ~2 px en un proyector Full HD

/** Lista de patrones en el orden en que se proyectan. */
export function grayPatterns(bits = GRAY_BITS) {
  const out = ["white", "black"];
  for (const axis of ["x", "y"]) for (let k = 0; k < bits; k++) out.push(`gray:${axis}:${k}:${bits}:0`, `gray:${axis}:${k}:${bits}:1`);
  return out;
}
export const isGray = (name) => typeof name === "string" && name.startsWith("gray:");
const gray = (i) => i ^ (i >> 1);
/** ¿Está encendida la franja i (de 2^bits) en el bit k (0 = el más grueso)? */
export const grayBit = (i, k, bits) => (gray(i) >> (bits - 1 - k)) & 1;

/** Dibuja «gray:eje:bit:bits:inversa» a pantalla completa (lo usan las salidas al proyector). */
export function drawGray(ctx, name, W, H) {
  const [, axis, ks, bs, inv] = name.split(":");
  const k = +ks, bits = +bs || GRAY_BITS, N = 1 << bits, flip = inv === "1";
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#fff";
  const L = axis === "x" ? W : H;
  // Tramos seguidos encendidos en un solo rectángulo.
  let start = -1;
  for (let i = 0; i <= N; i++) {
    const on = i < N && (grayBit(i, k, bits) ^ (flip ? 1 : 0)) === 1;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      const a = Math.round(start * L / N), b = Math.round(i * L / N);
      if (axis === "x") ctx.fillRect(a, 0, b - a, H); else ctx.fillRect(0, a, W, b - a);
      start = -1;
    }
  }
}

/** Luminancia (0..255) de una ImageData. */
export function luminance(img) {
  const n = img.width * img.height, out = new Float32Array(n), d = img.data;
  for (let i = 0, j = 0; i < n; i++, j += 4) out[i] = d[j] * 0.299 + d[j + 1] * 0.587 + d[j + 2] * 0.114;
  return out;
}

/**
 * Decodifica: frames = { nombre → luminancia } (todas del mismo tamaño w×h).
 * Devuelve { w, h, u, v (0..1, NaN donde no se sabe), valid, coverage, contrast }.
 */
export function decodeGray(frames, w, h, { bits = GRAY_BITS, minContrast = 18, minBit = 0.18 } = {}) {
  const n = w * h, white = frames.white, black = frames.black;
  const u = new Float32Array(n).fill(NaN), v = new Float32Array(n).fill(NaN);
  let ok = 0, best = 0;
  const planes = {};
  for (const axis of ["x", "y"]) planes[axis] = Array.from({ length: bits }, (_, k) => [frames[`gray:${axis}:${k}:${bits}:0`], frames[`gray:${axis}:${k}:${bits}:1`]]);
  for (let p = 0; p < n; p++) {
    const c = white[p] - black[p];
    if (c > best) best = c;
    if (c < minContrast) continue;
    let good = true;
    const val = { x: 0, y: 0 };
    for (const axis of ["x", "y"]) {
      let g = 0, prev = 0, idx = 0;
      for (let k = 0; k < bits; k++) {
        const [a, b] = planes[axis][k], d = a[p] - b[p];
        // Los bits gruesos tienen que verse claros; en los finos (franjas de 1-2 px de la
        // cámara) se acepta la mejor suposición: el error queda en una franja.
        if (Math.abs(d) < c * minBit && k < bits - 3) { good = false; break; }
        g = d > 0 ? 1 : 0;
        prev ^= g; idx = (idx << 1) | prev;   // Gray → binario
      }
      if (!good) break;
      val[axis] = idx;
    }
    if (!good) continue;
    const N = 1 << bits;
    u[p] = (val.x + 0.5) / N; v[p] = (val.y + 0.5) / N; ok++;
  }
  return { w, h, u, v, coverage: ok / n, contrast: best };
}

/**
 * Píxel del proyector (u, v en 0..1) que ilumina el punto (x, y) de la cámara: la mediana de los
 * píxeles bien decodificados alrededor (quita los saltos de un borde). null si no se sabe.
 */
export function lookupUV(map, x, y, r = 3) {
  const us = [], vs = [];
  const cx = Math.round(x), cy = Math.round(y);
  for (let yy = Math.max(0, cy - r); yy <= Math.min(map.h - 1, cy + r); yy++)
    for (let xx = Math.max(0, cx - r); xx <= Math.min(map.w - 1, cx + r); xx++) {
      const p = yy * map.w + xx;
      if (!Number.isNaN(map.u[p])) { us.push(map.u[p]); vs.push(map.v[p]); }
    }
  if (us.length < Math.max(3, (2 * r + 1) ** 2 * 0.25)) return null;
  const med = (a) => { a.sort((p, q) => p - q); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
  return [med(us), med(vs)];
}

/**
 * Escaneo completo. showPattern(nombre|null) lo pone el editor en las salidas; grabFrame() da una
 * ImageData de la cámara. Devuelve { map, photo (ImageData con todo en blanco), seconds }.
 */
export async function scanGray({ showPattern, grabFrame, settle = 450, firstSettle = 900, bits = GRAY_BITS, onStep = () => {}, signal = null }) {
  const names = grayPatterns(bits), frames = {};
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const t0 = Date.now();
  let photo = null, w = 0, h = 0;
  try {
    for (let i = 0; i < names.length; i++) {
      if (signal?.aborted) throw new DOMException("Cancelado", "AbortError");
      showPattern(names[i]);
      await wait(i < 2 ? firstSettle : settle);
      const img = await grabFrame();
      if (!img) throw new Error("La cámara no da imagen");
      if (!w) { w = img.width; h = img.height; }
      if (names[i] === "white") photo = img;
      frames[names[i]] = luminance(img);
      onStep(i + 1, names.length);
    }
  } finally { showPattern(null); }
  const map = decodeGray(frames, w, h, { bits });
  return { map, photo, seconds: (Date.now() - t0) / 1000 };
}
