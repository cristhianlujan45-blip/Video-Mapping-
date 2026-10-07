// shared/homography.js
// Matemática de transformación proyectiva (corner pin / perspective warp).
// Compartida entre navegador (ESM) y Node (tests). Sin dependencias.

/** Resuelve A·x = b para matriz 8x8 por eliminación gaussiana con pivoteo parcial. */
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

/**
 * Homografía 3x3 que mapea los 4 puntos src[i] -> dst[i].
 * Puntos: [x, y]. Devuelve h como array de 9 números (fila mayor).
 */
export function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const h8 = solveLinear(A, b);
  return [...h8, 1];
}

/** Aplica homografía (fila mayor, 9 elems) a punto [x,y] -> [x', y']. */
export function applyH(h, x, y) {
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

export const H_IDENTITY = [1,0,0, 0,1,0, 0,0,1];

/** Multiplica dos homografías (fila mayor): A·B */
export function mulH(a, b) {
  const r = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
    for (let k = 0; k < 3; k++) r[i*3+j] += a[i*3+k] * b[k*3+j];
  return r;
}

/** Puntos del cuadrado unidad [0,0],[1,0],[1,1],[0,1] escalados a (w,h). */
export function unitSquare(w = 1, h = 1) {
  return [[0,0],[w,0],[w,h],[0,h]];
}

/**
 * Recorte de orejas (ear clipping) para triangulación de polígono simple.
 * points: [{x,y}...] en orden. Devuelve array de índices [i0,j0,k0, i1,j1,k1,...]
 * con fallback a abanico si el polígono es problemático.
 */
export function triangulatePolygon(points) {
  const n = points.length;
  if (n < 3) return [];
  let idx = [];
  // Área con signo -> orden CCW
  let area = 0;
  for (let i = 0; i < n; i++) {
    const [x1,y1] = [points[i].x, points[i].y];
    const [x2,y2] = [points[(i+1)%n].x, points[(i+1)%n].y];
    area += x1*y2 - x2*y1;
  }
  const order = area >= 0
    ? [...Array(n).keys()]
    : [...Array(n).keys()].reverse();
  const V = order.slice();
  const tris = [];
  let guard = 0;
  while (V.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let i = 0; i < V.length; i++) {
      const i0 = V[(i - 1 + V.length) % V.length], i1 = V[i], i2 = V[(i + 1) % V.length];
      const a = points[i0], b = points[i1], c = points[i2];
      const cross = (b.x-a.x)*(c.y-a.y) - (b.y-a.y)*(c.x-a.x);
      if (cross <= 1e-12) continue; // oreja debe ser convexa (CCW)
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
    if (!clipped) break; // polígono no simple -> fallback abanico
  }
  if (tris.length === 0 || V.length > 3) {
    const fan = [];
    for (let i = 1; i < n - 1; i++) fan.push(0, i, i + 1);
    return fan;
  }
  if (V.length === 3) tris.push(V[0], V[1], V[2]);
  return tris;
}

export function pointInTriangle(p, a, b, c) {
  const d1 = sign(p, a, b), d2 = sign(p, b, c), d3 = sign(p, c, a);
  const neg = (d1 < 0) || (d2 < 0) || (d3 < 0);
  const pos = (d1 > 0) || (d2 > 0) || (d3 > 0);
  return !(neg && pos);
}

function sign(p1, p2, p3) {
  return (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
}
