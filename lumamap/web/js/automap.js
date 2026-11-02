// web/js/automap.js
// Auto-mapping EXPERIMENTAL: detección de superficies planas (cuadriláteros)
// en una fotografía de referencia. Cadena real, sin ML ni dependencias:
//   escala de grises → Sobel → umbral Otsu → trazado de contornos Moore →
//   simplificación Douglas-Peucker → filtrado convexo de 4 vértices.
// NO promete detección perfecta: los resultados siempre son corregibles
// manualmente en el editor (regla del proyecto).
// Sin dependencias del DOM en el núcleo (testable en Node).

function toGray(data, w, h) {
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    g[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }
  return g;
}

function sobel(g, w, h) {
  const mag = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = -g[i - w - 1] - 2 * g[i - 1] - g[i + w - 1] + g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1];
      const gy = -g[i - w - 1] - 2 * g[i - w] - g[i - w + 1] + g[i + w - 1] + 2 * g[i + w] + g[i + w + 1];
      mag[i] = Math.hypot(gx, gy);
    }
  }
  return mag;
}

function otsu(mag, w, h) {
  const hist = new Float64Array(256);
  let count = 0;
  for (let i = 0; i < w * h; i++) { hist[Math.min(255, mag[i] | 0)]++; count++; }
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, thr = 0;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    sumB += i * hist[i];
    if (i < 1 || !wB) continue;
    const wF = count - wB;
    if (!wF) break;
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; thr = i; }
  }
  return thr;
}

const MOVES = [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]];

/** Trazado de frontera de Moore-Jacob. Devuelve {path, closed}. Ante ciclos
 * (bloques 2×2 en esquinas) cierra el contorno en la primera reaparición. */
function traceBoundary(bin, w, h, start) {
  const path = [start];
  const seen = new Map([[start.y * w + start.x, 0]]);
  let cur = start;
  let backDir = 4; // W: el píxel previo del barrido (izquierda) es fondo
  const maxIter = 8 * (w + h);
  for (let it = 0; it < maxIter; it++) {
    let found = null, foundDir = -1;
    for (let k = 1; k <= 8; k++) {
      const d = (backDir + k) % 8;
      const nx = cur.x + MOVES[d][0], ny = cur.y + MOVES[d][1];
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && bin[ny * w + nx]) {
        found = { x: nx, y: ny }; foundDir = d; break;
      }
    }
    if (!found) return { path, closed: false };
    backDir = (foundDir + 4) % 8;
    cur = found;
    const key = cur.y * w + cur.x;
    if (cur.x === start.x && cur.y === start.y && path.length > 4)
      return { path, closed: true };
    if (seen.has(key)) {
      const cut = seen.get(key);
      return { path: path.slice(0, cut + 1), closed: true };
    }
    seen.set(key, path.length);
    path.push(cur);
  }
  return { path, closed: false };
}

/** Douglas-Peucker. Devuelve índices de puntos significativos. */
function rdp(points, epsilon) {
  if (points.length < 3) return points.map((_, i) => i);
  const keep = new Array(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const A = points[a], B = points[b];
    let maxD = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = distToSeg(points[i], A, B);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > epsilon && idx > 0) {
      keep[idx] = true;
      stack.push([a, idx], [idx, b]);
    }
  }
  return keep.map((k, i) => k ? i : -1).filter(i => i >= 0);
}

function distToSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (!l2) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function isConvex(pts) {
  let sign = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], c = pts[(i + 2) % pts.length];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-9) continue;
    const s = Math.sign(cross);
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
}

function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function orderCorners(pts) {
  // centrado angular y orientación CCW
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  let ordered = pts.slice().sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  if (signedArea(ordered) < 0) ordered.reverse();
  // rotar para que el primero sea la esquina superior-izquierda
  let bi = 0;
  ordered.forEach((p, i) => { if (p.x + p.y < ordered[bi].x + ordered[bi].y) bi = i; });
  return ordered.slice(bi).concat(ordered.slice(0, bi));
}

/**
 * Detecta cuadriláteros en un ImageData-like {width, height, data}.
 * Devuelve [{points:[{x,y}×4] (px de imagen), area}] ordenados por área.
 */
export function detectQuads(imageData, { maxQuads = 8, minAreaRatio = 0.01 } = {}) {
  const { width: w, height: h, data } = imageData;
  if (!w || !h || !data || data.length < w * h * 4) throw new Error("detectQuads: ImageData inválido");
  const gray = toGray(data, w, h);
  const mag = sobel(gray, w, h);
  const thr = otsu(mag, w, h);
  const bin = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) bin[i] = mag[i] > thr ? 1 : 0;
  const visited = new Uint8Array(w * h);
  const quads = [];
  const minArea = w * h * minAreaRatio;
  for (let y = 1; y < h - 1 && quads.length < maxQuads; y++) {
    for (let x = 1; x < w - 1 && quads.length < maxQuads; x++) {
      const idx = y * w + x;
      if (!bin[idx] || visited[idx]) continue;
      // píxel de borde: al menos un vecino 4-conexo sin borde
      const isBoundary =
        !bin[idx - 1] || !bin[idx + 1] || !bin[idx - w] || !bin[idx + w];
      if (!isBoundary) continue;
      const res = traceBoundary(bin, w, h, { x, y });
      const path = res.path;
      if (path.length < 20) continue;
      for (const p of path) visited[p.y * w + p.x] = 1;
      if (!res.closed) continue;
      const epsilon = Math.max(3, path.length * 0.04); // limpia el grosor de banda de Sobel (2 px)
      const idxs = rdp(path, epsilon);
      if (idxs.length < 4) continue;
      let pts = idxs.map(i => path[i]);
      if (pts.length > 4) {
        // reducir al cuadrilátero de máxima área (n<=8 tras RDP)
        let best = null, bestArea = -1;
        for (let a = 0; a < pts.length; a++)
          for (let b = a + 1; b < pts.length; b++)
            for (let c = b + 1; c < pts.length; c++)
              for (let d = c + 1; d < pts.length; d++) {
                const quad = [pts[a], pts[b], pts[c], pts[d]];
                if (!isConvex(quad)) continue;
                const area = Math.abs(signedArea(quad));
                if (area > bestArea) { bestArea = area; best = quad; }
              }
        if (!best) continue;
        pts = best;
      }
      if (!isConvex(pts)) continue;
      const area = Math.abs(signedArea(pts));
      if (area < minArea) continue;
      quads.push({ points: orderCorners(pts), area });
    }
  }
  quads.sort((a, b) => b.area - a.area);
  return quads;
}

/** Conveniente desde un archivo de imagen en el navegador (downscale a 480px). */
export async function detectFromImageFile(file, maxSize = 480) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error("imagen no legible")); img.src = url; });
    const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    const id = c.getContext("2d").getImageData(0, 0, c.width, c.height);
    // normalizar a coordenadas 0..1 relativas a la imagen original
    return detectQuads(id).map(q => ({
      area: q.area / (c.width * c.height),
      points: q.points.map(p => ({ x: p.x / c.width, y: p.y / c.height })),
    }));
  } finally {
    URL.revokeObjectURL(url);
  }
}
