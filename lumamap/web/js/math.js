// web/js/math.js
// Geometría de mapping: homografías (corner pin), malla de deformación
// Catmull-Rom, triangulación de polígonos, pruebas de contacto y formas.
// Sin dependencias del DOM: se usa igual en el navegador y en las pruebas de Node.

/** Resuelve A·x = b (n×n) por eliminación gaussiana con pivoteo parcial. */
export function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => row.concat(b[i]));
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++)
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) throw new Error("solveLinear: matriz singular");
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / M[i][i]);
}

/** Homografía 3×3 (fila mayor, 9 números) que lleva src[i] → dst[i]. Puntos [x, y]. */
export function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  return [...solveLinear(A, b), 1];
}

export function applyH(h, x, y) {
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

export const H_IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export const UNIT_SQUARE = [[0, 0], [1, 0], [1, 1], [0, 1]];

/** Homografía segura: si las esquinas son degeneradas devuelve null en lugar de lanzar. */
export function tryHomography(src, dst) {
  try {
    const h = homography(src, dst);
    return h.every(Number.isFinite) ? h : null;
  } catch { return null; }
}

/* ---------------- Superficies ---------------- */

/** Índices de las 4 esquinas de una rejilla cols×rows en orden TL, TR, BR, BL. */
export function gridCornerIdx(cols, rows) {
  return [0, cols - 1, rows * cols - 1, (rows - 1) * cols];
}

/** Esquinas [[x,y]×4] (TL, TR, BR, BL) de una superficie. */
export function surfaceCorners(s) {
  if (s.type === "quad") return gridCornerIdx(s.cols, s.rows).map(i => [s.points[i].x, s.points[i].y]);
  const b = bbox(s.points);
  return [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]];
}

export function bbox(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: Math.max(maxX - minX, 1e-6), h: Math.max(maxY - minY, 1e-6) };
}

export function centroid(points) {
  let x = 0, y = 0;
  for (const p of points) { x += p.x; y += p.y; }
  return { x: x / points.length, y: y / points.length };
}

/** Catmull-Rom 1D. */
function cr(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/**
 * Evalúa una malla cols×rows (puntos fila mayor) en (u, v) ∈ [0,1]² con
 * interpolación bicúbica Catmull-Rom: la superficie pasa exactamente por
 * cada punto de control y se curva suavemente entre ellos.
 */
export function evalMesh(points, cols, rows, u, v) {
  const fx = u * (cols - 1), fy = v * (rows - 1);
  const ix = Math.min(Math.floor(fx), cols - 2), iy = Math.min(Math.floor(fy), rows - 2);
  const tx = fx - ix, ty = fy - iy;
  const P = (c, r) => points[Math.max(0, Math.min(rows - 1, r)) * cols + Math.max(0, Math.min(cols - 1, c))];
  // Extrapolación lineal en los bordes para no aplanar la curva.
  const at = (c, r) => {
    const cc = Math.max(0, Math.min(cols - 1, c)), rr = Math.max(0, Math.min(rows - 1, r));
    if (cc === c && rr === r) return P(c, r);
    const a = P(cc, rr);
    const b = P(cc - Math.sign(c - cc), rr - Math.sign(r - rr));
    return { x: 2 * a.x - b.x, y: 2 * a.y - b.y };
  };
  let x = 0, y = 0;
  const colX = [], colY = [];
  for (let k = -1; k <= 2; k++) {
    const r = iy + k;
    const p0 = at(ix - 1, r), p1 = at(ix, r), p2 = at(ix + 1, r), p3 = at(ix + 2, r);
    colX.push(cr(p0.x, p1.x, p2.x, p3.x, tx));
    colY.push(cr(p0.y, p1.y, p2.y, p3.y, tx));
  }
  x = cr(colX[0], colX[1], colX[2], colX[3], ty);
  y = cr(colY[0], colY[1], colY[2], colY[3], ty);
  return { x, y };
}

/** Rejilla cols×rows que reproduce la perspectiva de 4 esquinas (TL,TR,BR,BL). */
export function gridFromCorners(corners, cols, rows) {
  const H = tryHomography(UNIT_SQUARE, corners);
  const pts = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const u = c / (cols - 1), v = r / (rows - 1);
    if (H) { const [x, y] = applyH(H, u, v); pts.push({ x, y }); }
    else {
      const top = lerp2(corners[0], corners[1], u), bot = lerp2(corners[3], corners[2], u);
      const p = lerp2(top, bot, v); pts.push({ x: p[0], y: p[1] });
    }
  }
  return pts;
}

/** Cambia la resolución de una malla conservando su forma actual. */
export function resampleGrid(points, cols, rows, nc, nr) {
  if (cols === 2 && rows === 2)
    return gridFromCorners(gridCornerIdx(2, 2).map(i => [points[i].x, points[i].y]), nc, nr);
  const out = [];
  for (let r = 0; r < nr; r++) for (let c = 0; c < nc; c++)
    out.push(evalMesh(points, cols, rows, c / (nc - 1), r / (nr - 1)));
  return out;
}

function lerp2(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }

/**
 * Proyecta un punto del lienzo a coordenadas UV (0..1) de la superficie.
 * Para quads usa la homografía inversa exacta; para mallas, la de sus 4
 * esquinas (aproximación suficiente para dibujar); para polígonos, la caja.
 */
export function screenToUV(s, x, y) {
  if (s.type === "quad") {
    const corners = surfaceCorners(s);
    const Hinv = tryHomography(corners, UNIT_SQUARE);
    if (Hinv) { const [u, v] = applyH(Hinv, x, y); return { u, v }; }
  }
  const b = bbox(s.points);
  return { u: (x - b.x) / b.w, v: (y - b.y) / b.h };
}

/** UV → lienzo (inversa de screenToUV). */
export function uvToScreen(s, u, v) {
  if (s.type === "quad") {
    if (s.cols === 2 && s.rows === 2) {
      const H = tryHomography(UNIT_SQUARE, surfaceCorners(s));
      if (H) { const [x, y] = applyH(H, u, v); return { x, y }; }
    }
    return evalMesh(s.points, s.cols, s.rows, u, v);
  }
  const b = bbox(s.points);
  return { x: b.x + u * b.w, y: b.y + v * b.h };
}

/** Contorno de la superficie en coordenadas de lienzo (para dibujar y tocar). */
export function surfaceOutline(s, seg = 12) {
  if (s.type !== "quad") return s.points.map(p => ({ x: p.x, y: p.y }));
  if (s.cols === 2 && s.rows === 2) return gridCornerIdx(2, 2).map(i => s.points[i]);
  const out = [];
  const N = (s.cols - 1) * seg, M = (s.rows - 1) * seg;
  for (let i = 0; i < N; i++) out.push(evalMesh(s.points, s.cols, s.rows, i / N, 0));
  for (let i = 0; i < M; i++) out.push(evalMesh(s.points, s.cols, s.rows, 1, i / M));
  for (let i = N; i > 0; i--) out.push(evalMesh(s.points, s.cols, s.rows, i / N, 1));
  for (let i = M; i > 0; i--) out.push(evalMesh(s.points, s.cols, s.rows, 0, i / M));
  return out;
}

/** Contorno de la superficie en espacio UV (para bordes y máscaras en el shader). */
export function surfaceUVOutline(s) {
  if (s.type === "quad") return [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  const b = bbox(s.points);
  return s.points.map(p => ({ x: (p.x - b.x) / b.w, y: (p.y - b.y) / b.h }));
}

/** Área aproximada de la superficie en px² y su relación de aspecto (ancho/alto). */
export function surfaceAspect(s) {
  const c = surfaceCorners(s);
  const w = (dist(c[0], c[1]) + dist(c[3], c[2])) / 2;
  const h = (dist(c[0], c[3]) + dist(c[1], c[2])) / 2;
  return { w: Math.max(w, 1), h: Math.max(h, 1), aspect: Math.max(w, 1) / Math.max(h, 1) };
}

function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

export function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function distToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Simplificación Douglas-Peucker de un trazo [{x,y}]. */
export function simplify(points, epsilon) {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = distToSegment(points[i], points[a], points[b]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > epsilon) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

/** Ear clipping. Devuelve índices de triángulos; abanico si el polígono no es simple. */
export function triangulatePolygon(points) {
  const n = points.length;
  if (n < 3) return [];
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i], b = points[(i + 1) % n];
    area += a.x * b.y - b.x * a.y;
  }
  const V = area >= 0 ? [...Array(n).keys()] : [...Array(n).keys()].reverse();
  const tris = [];
  let guard = 0;
  while (V.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let i = 0; i < V.length; i++) {
      const i0 = V[(i - 1 + V.length) % V.length], i1 = V[i], i2 = V[(i + 1) % V.length];
      const a = points[i0], b = points[i1], c = points[i2];
      const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if (cross <= 1e-12) continue;
      let contains = false;
      for (const j of V) {
        if (j === i0 || j === i1 || j === i2) continue;
        if (pointInTriangle(points[j], a, b, c)) { contains = true; break; }
      }
      if (contains) continue;
      tris.push(i0, i1, i2);
      V.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (V.length > 3) {
    const fan = [];
    for (let i = 1; i < n - 1; i++) fan.push(0, i, i + 1);
    return fan;
  }
  tris.push(V[0], V[1], V[2]);
  return tris;
}

export function pointInTriangle(p, a, b, c) {
  const s = (p1, p2, p3) => (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
  const d1 = s(p, a, b), d2 = s(p, b, c), d3 = s(p, c, a);
  return !(((d1 < 0) || (d2 < 0) || (d3 < 0)) && ((d1 > 0) || (d2 > 0) || (d3 > 0)));
}

/* ---------------- Formas predefinidas ---------------- */

export function regularPolygon(cx, cy, r, n, rot = -Math.PI / 2, ry = r) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * ry });
  }
  return pts;
}

export function starPolygon(cx, cy, r, n = 5, inner = 0.45) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + (i / (n * 2)) * Math.PI * 2;
    const rr = i % 2 ? r * inner : r;
    pts.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr });
  }
  return pts;
}

/** Transforma puntos: escala s y rotación rot (rad) alrededor de c. */
export function transformPoints(points, c, s, rot) {
  const cos = Math.cos(rot), sin = Math.sin(rot);
  return points.map(p => {
    const dx = (p.x - c.x) * s, dy = (p.y - c.y) * s;
    return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
  });
}

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

/* ---------------- Asas de los lados (cambiar tamaño sin girar) ---------------- */

/**
 * Asas en el centro de cada lado de una superficie. Arrastrar un asa estira la
 * superficie solo en perpendicular a ese lado: el lado opuesto queda fijo y los
 * puntos intermedios (mallas, polígonos) se reparten en proporción, así no
 * cambian el ángulo ni la perspectiva.
 * Devuelve [{side, x, y, nx, ny, w:[peso por punto]}].
 */
export function edgeHandles(s) {
  const c = centroid(s.points);
  const out = [];
  const add = (side, mid, a, b, w) => {
    let nx = b.y - a.y, ny = -(b.x - a.x);
    const L = Math.hypot(nx, ny) || 1;
    nx /= L; ny /= L;
    if ((mid.x - c.x) * nx + (mid.y - c.y) * ny < 0) { nx = -nx; ny = -ny; }
    out.push({ side, x: mid.x, y: mid.y, nx, ny, w });
  };
  if (s.type === "quad") {
    const { cols, rows } = s;
    const P = (r, col) => s.points[r * cols + col];
    const weights = (fn) => s.points.map((_, i) => fn(Math.floor(i / cols), i % cols));
    add("top", uvToScreen(s, 0.5, 0), P(0, 0), P(0, cols - 1), weights((r) => 1 - r / (rows - 1)));
    add("right", uvToScreen(s, 1, 0.5), P(0, cols - 1), P(rows - 1, cols - 1), weights((r, col) => col / (cols - 1)));
    add("bottom", uvToScreen(s, 0.5, 1), P(rows - 1, cols - 1), P(rows - 1, 0), weights((r) => r / (rows - 1)));
    add("left", uvToScreen(s, 0, 0.5), P(rows - 1, 0), P(0, 0), weights((r, col) => 1 - col / (cols - 1)));
  } else {
    const b = bbox(s.points);
    const x0 = b.x, x1 = b.x + b.w, y0 = b.y, y1 = b.y + b.h;
    add("top", { x: (x0 + x1) / 2, y: y0 }, { x: x0, y: y0 }, { x: x1, y: y0 }, s.points.map(p => (y1 - p.y) / b.h));
    add("right", { x: x1, y: (y0 + y1) / 2 }, { x: x1, y: y0 }, { x: x1, y: y1 }, s.points.map(p => (p.x - x0) / b.w));
    add("bottom", { x: (x0 + x1) / 2, y: y1 }, { x: x1, y: y1 }, { x: x0, y: y1 }, s.points.map(p => (p.y - y0) / b.h));
    add("left", { x: x0, y: (y0 + y1) / 2 }, { x: x0, y: y1 }, { x: x0, y: y0 }, s.points.map(p => (x1 - p.x) / b.w));
  }
  return out;
}

/** Asa de giro: por fuera del lado superior, a `off` unidades del borde. */
export function rotateHandle(s, off) {
  const t = edgeHandles(s).find(e => e.side === "top");
  if (!t) return null;
  return { x: t.x + t.nx * off, y: t.y + t.ny * off, bx: t.x, by: t.y };
}

/** Aplica el arrastre de un asa: start = puntos al empezar, (dx,dy) = desplazamiento total. */
export function dragEdge(start, handle, dx, dy) {
  const d = dx * handle.nx + dy * handle.ny;
  return start.map((p, i) => ({ x: p.x + handle.nx * d * handle.w[i], y: p.y + handle.ny * d * handle.w[i] }));
}
