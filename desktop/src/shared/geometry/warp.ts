import { mapPoint, squareToQuad, type Quad, type Vec2 } from './homography';

/**
 * Mesh warp: a grid of (cols+1)×(rows+1) control points in output space. The renderer
 * tessellates every cell into `subdiv`×`subdiv` sub-quads whose positions are evaluated
 * with the chosen interpolation, so a coarse control grid gives a smooth surface.
 *
 *  - 'perspective': each cell is a homography of its 4 corners (exact keystone per cell).
 *  - 'bilinear':    straight bilinear interpolation inside each cell.
 *  - 'bezier':      bicubic Catmull-Rom through the control points (smooth curved
 *                   surfaces: columns, domes, curved screens).
 */
export type WarpInterpolation = 'perspective' | 'bilinear' | 'bezier';

export interface MeshWarp {
  cols: number;
  rows: number;
  /** Row-major, (rows+1) * (cols+1) points, normalized output space. */
  points: Vec2[];
  interpolation: WarpInterpolation;
}

export function meshFromQuad(q: Quad, cols: number, rows: number, interpolation: WarpInterpolation = 'perspective'): MeshWarp {
  const h = squareToQuad(q);
  const points: Vec2[] = [];
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const u = c / cols;
      const v = r / rows;
      const p = h ? mapPoint(h, u, v) : null;
      points.push(p ?? bilinear(q, u, v));
    }
  }
  return { cols, rows, points, interpolation };
}

/** Changes the grid density keeping the current shape. */
export function resampleMesh(m: MeshWarp, cols: number, rows: number): MeshWarp {
  const points: Vec2[] = [];
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) points.push(evalMesh(m, c / cols, r / rows));
  return { cols, rows, points, interpolation: m.interpolation };
}

export function bilinear(q: Quad, u: number, v: number): Vec2 {
  const [tl, tr, br, bl] = q;
  const top = { x: tl.x + (tr.x - tl.x) * u, y: tl.y + (tr.y - tl.y) * u };
  const bot = { x: bl.x + (br.x - bl.x) * u, y: bl.y + (br.y - bl.y) * u };
  return { x: top.x + (bot.x - top.x) * v, y: top.y + (bot.y - top.y) * v };
}

const at = (m: MeshWarp, c: number, r: number): Vec2 => {
  const cc = Math.max(0, Math.min(m.cols, c));
  const rr = Math.max(0, Math.min(m.rows, r));
  return m.points[rr * (m.cols + 1) + cc];
};

function catmull(p0: number, p1: number, p2: number, p3: number, t: number) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/** Point on the warped surface for content coordinates (u,v) in 0..1. */
export function evalMesh(m: MeshWarp, u: number, v: number): Vec2 {
  const fx = Math.min(u * m.cols, m.cols - 1e-9);
  const fy = Math.min(v * m.rows, m.rows - 1e-9);
  const c = Math.max(0, Math.floor(fx));
  const r = Math.max(0, Math.floor(fy));
  const tx = fx - c;
  const ty = fy - r;
  if (m.interpolation === 'bezier') {
    // Extrapolate virtual border points linearly so edges stay straight-ish.
    const P = (cc: number, rr: number): Vec2 => {
      if (cc >= 0 && cc <= m.cols && rr >= 0 && rr <= m.rows) return at(m, cc, rr);
      const ic = Math.max(0, Math.min(m.cols, cc));
      const ir = Math.max(0, Math.min(m.rows, rr));
      const inner = at(m, ic, ir);
      const dc = cc - ic;
      const dr = rr - ir;
      const nc = Math.max(0, Math.min(m.cols, ic - dc));
      const nr = Math.max(0, Math.min(m.rows, ir - dr));
      const nb = at(m, nc, nr);
      return { x: 2 * inner.x - nb.x, y: 2 * inner.y - nb.y };
    };
    const rowsX: number[] = [];
    const rowsY: number[] = [];
    for (let k = -1; k <= 2; k++) {
      const p0 = P(c - 1, r + k);
      const p1 = P(c, r + k);
      const p2 = P(c + 1, r + k);
      const p3 = P(c + 2, r + k);
      rowsX.push(catmull(p0.x, p1.x, p2.x, p3.x, tx));
      rowsY.push(catmull(p0.y, p1.y, p2.y, p3.y, tx));
    }
    return { x: catmull(rowsX[0], rowsX[1], rowsX[2], rowsX[3], ty), y: catmull(rowsY[0], rowsY[1], rowsY[2], rowsY[3], ty) };
  }
  const q: Quad = [at(m, c, r), at(m, c + 1, r), at(m, c + 1, r + 1), at(m, c, r + 1)];
  if (m.interpolation === 'perspective') {
    const h = squareToQuad(q);
    const p = h ? mapPoint(h, tx, ty) : null;
    if (p) return p;
  }
  return bilinear(q, tx, ty);
}

/**
 * Tessellates the mesh into a triangle list: positions (output space) and uvs
 * (content space). Used by the GPU renderer.
 */
export function tessellate(m: MeshWarp, subdiv = 8): { positions: Float32Array; uvs: Float32Array; indices: Uint32Array } {
  const nx = m.cols * subdiv;
  const ny = m.rows * subdiv;
  const positions = new Float32Array((nx + 1) * (ny + 1) * 2);
  const uvs = new Float32Array((nx + 1) * (ny + 1) * 2);
  let k = 0;
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const u = i / nx;
      const v = j / ny;
      const p = evalMesh(m, u, v);
      positions[k] = p.x;
      positions[k + 1] = p.y;
      uvs[k] = u;
      uvs[k + 1] = v;
      k += 2;
    }
  }
  const indices = new Uint32Array(nx * ny * 6);
  k = 0;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      const b = a + 1;
      const c = a + nx + 1;
      const d = c + 1;
      indices[k++] = a;
      indices[k++] = c;
      indices[k++] = b;
      indices[k++] = b;
      indices[k++] = c;
      indices[k++] = d;
    }
  }
  return { positions, uvs, indices };
}

/** Index of the nearest control point within `radius` (normalized units), or -1. */
export function hitControlPoint(points: Vec2[], p: Vec2, radius: number, aspect = 1): number {
  let best = -1;
  let bestD = radius * radius;
  for (let i = 0; i < points.length; i++) {
    const dx = (points[i].x - p.x) * aspect;
    const dy = points[i].y - p.y;
    const d = dx * dx + dy * dy;
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
