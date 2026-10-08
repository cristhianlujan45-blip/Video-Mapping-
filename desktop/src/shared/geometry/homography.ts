/**
 * Projective geometry for corner pinning and mesh warping. Ported from the Android
 * :core module (Heckbert, "Fundamentals of Texture Mapping", 1989): a homography maps
 * straight lines to straight lines, like a real projector keystone, unlike two affine
 * triangles that bend along the diagonal.
 */

export interface Vec2 {
  x: number;
  y: number;
}

/** tl, tr, br, bl in normalized output space (0..1, y down). */
export type Quad = [Vec2, Vec2, Vec2, Vec2];

/** Row-major 3x3. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export function mapPoint(m: Mat3, x: number, y: number): Vec2 | null {
  const w = m[6] * x + m[7] * y + m[8];
  if (Math.abs(w) < 1e-12) return null;
  return { x: (m[0] * x + m[1] * y + m[2]) / w, y: (m[3] * x + m[4] * y + m[5]) / w };
}

export function invert3(m: Mat3): Mat3 | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-15) return null;
  const inv: Mat3 = [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d];
  for (let k = 0; k < 9; k++) inv[k] /= det;
  return inv;
}

export function multiply3(a: Mat3, b: Mat3): Mat3 {
  const r = new Array(9).fill(0) as Mat3;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
}

/** Homography mapping the unit square to the quad. Null for degenerate/non-convex quads. */
export function squareToQuad(q: Quad): Mat3 | null {
  const [p0, p1, p2, p3] = q;
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const dy3 = p0.y - p1.y + p2.y - p3.y;
  const den = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(den) < 1e-15) return null;
  const g = (dx3 * dy2 - dx2 * dy3) / den;
  const h = (dx1 * dy3 - dx3 * dy1) / den;
  const m: Mat3 = [p1.x - p0.x + g * p1.x, p3.x - p0.x + h * p3.x, p0.x, p1.y - p0.y + g * p1.y, p3.y - p0.y + h * p3.y, p0.y, g, h, 1];
  const ws = [m[8], m[6] + m[8], m[6] + m[7] + m[8], m[7] + m[8]];
  if (ws.some((w) => w <= 1e-9)) return null;
  return m;
}

export function quadToSquare(q: Quad): Mat3 | null {
  const m = squareToQuad(q);
  return m ? invert3(m) : null;
}

/** General 4-point homography src→dst (Direct Linear Transform, 8x8 solve). */
export function homographyFromPoints(src: Vec2[], dst: Vec2[]): Mat3 | null {
  if (src.length !== 4 || dst.length !== 4) return leastSquaresHomography(src, dst);
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solve(A, b);
  if (!h) return null;
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/** Least-squares homography for N ≥ 4 correspondences (normal equations). */
export function leastSquaresHomography(src: Vec2[], dst: Vec2[]): Mat3 | null {
  const n = Math.min(src.length, dst.length);
  if (n < 4) return null;
  const AtA = Array.from({ length: 8 }, () => new Array(8).fill(0));
  const Atb = new Array(8).fill(0);
  const add = (row: number[], val: number) => {
    for (let i = 0; i < 8; i++) {
      Atb[i] += row[i] * val;
      for (let j = 0; j < 8; j++) AtA[i][j] += row[i] * row[j];
    }
  };
  for (let i = 0; i < n; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    add([x, y, 1, 0, 0, 0, -u * x, -u * y], u);
    add([0, 0, 0, x, y, 1, -v * x, -v * y], v);
  }
  const h = solve(AtA, Atb);
  if (!h) return null;
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/** Gaussian elimination with partial pivoting. */
export function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      if (f === 0) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** Column-major Float32Array for a GLSL mat3 uniform. */
export function toGlMat3(m: Mat3, out = new Float32Array(9)): Float32Array {
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out[c * 3 + r] = m[r * 3 + c];
  return out;
}

export function rectQuad(cx: number, cy: number, hw: number, hh: number): Quad {
  return [
    { x: cx - hw, y: cy - hh },
    { x: cx + hw, y: cy - hh },
    { x: cx + hw, y: cy + hh },
    { x: cx - hw, y: cy + hh },
  ];
}

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Polygon area (signed, shoelace). */
export function polygonArea(poly: Vec2[]): number {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) s += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  return s / 2;
}
