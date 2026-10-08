/**
 * Structured-light projector ↔ camera calibration with Gray codes.
 *
 * For every bit of the projector X and Y coordinates the projector shows the Gray-code
 * pattern and its inverse; the camera captures both. A camera pixel decodes a bit as
 * 1 when it is brighter in the normal image than in the inverted one (robust to surface
 * color and ambient light). The result is a per-camera-pixel projector coordinate.
 */
import { homographyFromPoints, mapPoint, type Mat3, type Vec2 } from '../geometry/homography';

export interface GrayCapture {
  /** Grayscale images (0..255), width*height each. */
  normal: Uint8Array;
  inverted: Uint8Array;
}

export interface DecodeResult {
  width: number;
  height: number;
  /** Projector X/Y per camera pixel, NaN where undecoded. */
  px: Float32Array;
  py: Float32Array;
  valid: Uint8Array;
  validCount: number;
}

export const bitsFor = (size: number) => Math.ceil(Math.log2(Math.max(2, size)));

export function grayToBinary(g: number): number {
  let b = g;
  for (let s = g >> 1; s; s >>= 1) b ^= s;
  return b;
}

/** Projector pattern value (0/1) for a pixel coordinate and bit (MSB first = bit bits-1). */
export function grayBit(coord: number, bit: number): number {
  const g = coord ^ (coord >> 1);
  return (g >> bit) & 1;
}

export function decodeGray(width: number, height: number, white: Uint8Array, black: Uint8Array, xCaps: GrayCapture[], yCaps: GrayCapture[], minContrast = 20): DecodeResult {
  const n = width * height;
  const px = new Float32Array(n).fill(NaN);
  const py = new Float32Array(n).fill(NaN);
  const valid = new Uint8Array(n);
  let validCount = 0;
  for (let i = 0; i < n; i++) {
    if (white[i] - black[i] < minContrast) continue;
    let gx = 0;
    let ok = true;
    for (let b = xCaps.length - 1; b >= 0; b--) {
      const d = xCaps[b].normal[i] - xCaps[b].inverted[i];
      if (Math.abs(d) < 3) ok = false;
      gx = (gx << 1) | (d > 0 ? 1 : 0);
    }
    let gy = 0;
    for (let b = yCaps.length - 1; b >= 0; b--) {
      const d = yCaps[b].normal[i] - yCaps[b].inverted[i];
      if (Math.abs(d) < 3) ok = false;
      gy = (gy << 1) | (d > 0 ? 1 : 0);
    }
    if (!ok) continue;
    px[i] = grayToBinary(gx);
    py[i] = grayToBinary(gy);
    valid[i] = 1;
    validCount++;
  }
  return { width, height, px, py, valid, validCount };
}

/** Correspondences sampled on a grid (camera → projector pixels). */
export function correspondences(d: DecodeResult, step = 8): { cam: Vec2[]; proj: Vec2[] } {
  const cam: Vec2[] = [];
  const proj: Vec2[] = [];
  for (let y = 0; y < d.height; y += step) {
    for (let x = 0; x < d.width; x += step) {
      const i = y * d.width + x;
      if (!d.valid[i]) continue;
      cam.push({ x, y });
      proj.push({ x: d.px[i], y: d.py[i] });
    }
  }
  return { cam, proj };
}

/** RANSAC homography (planar surface): robust to badly decoded pixels. */
export function ransacHomography(src: Vec2[], dst: Vec2[], iterations = 400, threshold = 3, rnd: () => number = Math.random): { h: Mat3; inliers: number } | null {
  const n = src.length;
  if (n < 4) return null;
  let best: Mat3 | null = null;
  let bestIn = 0;
  for (let it = 0; it < iterations; it++) {
    const idx = new Set<number>();
    while (idx.size < 4) idx.add(Math.floor(rnd() * n));
    const ids = [...idx];
    const h = homographyFromPoints(
      ids.map((i) => src[i]),
      ids.map((i) => dst[i]),
    );
    if (!h) continue;
    let inl = 0;
    for (let i = 0; i < n; i++) {
      const p = mapPoint(h, src[i].x, src[i].y);
      if (p && Math.hypot(p.x - dst[i].x, p.y - dst[i].y) < threshold) inl++;
    }
    if (inl > bestIn) {
      bestIn = inl;
      best = h;
    }
  }
  if (!best) return null;
  // refine on all inliers
  const s2: Vec2[] = [];
  const d2: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const p = mapPoint(best, src[i].x, src[i].y);
    if (p && Math.hypot(p.x - dst[i].x, p.y - dst[i].y) < threshold) {
      s2.push(src[i]);
      d2.push(dst[i]);
    }
  }
  const refined = s2.length >= 4 ? homographyFromPoints(s2, d2) : null;
  return { h: refined ?? best, inliers: bestIn };
}

/** Looks up the projector coordinate of a camera point (nearest decoded pixel within a radius). */
export function camToProj(d: DecodeResult, p: Vec2, radius = 12): Vec2 | null {
  const cx = Math.round(p.x);
  const cy = Math.round(p.y);
  for (let r = 0; r <= radius; r++) {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (x < 0 || y < 0 || x >= d.width || y >= d.height) continue;
        const i = y * d.width + x;
        if (!d.valid[i]) continue;
        sx += d.px[i];
        sy += d.py[i];
        n++;
      }
    }
    if (n >= Math.max(1, r)) return { x: sx / n, y: sy / n };
  }
  return null;
}

/** Binary mask (1 = inside) → outer contour (Moore neighbour tracing) of the largest blob. */
export function largestContour(mask: Uint8Array, w: number, h: number): Vec2[] {
  // label blobs with a flood fill, keep the largest
  const labels = new Int32Array(w * h);
  let best = 0;
  let bestSize = 0;
  let label = 0;
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || labels[i]) continue;
    label++;
    let size = 0;
    stack.push(i);
    labels[i] = label;
    while (stack.length) {
      const k = stack.pop()!;
      size++;
      const x = k % w;
      const y = (k / w) | 0;
      const nb = [x > 0 ? k - 1 : -1, x < w - 1 ? k + 1 : -1, y > 0 ? k - w : -1, y < h - 1 ? k + w : -1];
      for (const q of nb) {
        if (q >= 0 && mask[q] && !labels[q]) {
          labels[q] = label;
          stack.push(q);
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      best = label;
    }
  }
  if (!best) return [];
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && labels[y * w + x] === best;
  // start: first pixel in raster order
  let start = -1;
  for (let i = 0; i < w * h; i++)
    if (labels[i] === best) {
      start = i;
      break;
    }
  const dirs = [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
  ];
  const sx = start % w;
  const sy = (start / w) | 0;
  const out: Vec2[] = [{ x: sx, y: sy }];
  let x = sx;
  let y = sy;
  let dir = 7;
  for (let steps = 0; steps < w * h * 4; steps++) {
    let found = false;
    for (let k = 0; k < 8; k++) {
      const d = (dir + 6 + k) % 8; // start looking left of the previous direction
      const nx = x + dirs[d][0];
      const ny = y + dirs[d][1];
      if (inside(nx, ny)) {
        x = nx;
        y = ny;
        dir = d;
        found = true;
        break;
      }
    }
    if (!found || (x === sx && y === sy)) break;
    out.push({ x, y });
  }
  return out;
}

/** Ramer–Douglas–Peucker simplification of a closed polygon. */
export function simplifyPolygon(pts: Vec2[], epsilon: number): Vec2[] {
  if (pts.length < 4) return pts;
  const rdp = (a: number, b: number, keep: boolean[]) => {
    let maxD = 0;
    let idx = -1;
    const A = pts[a];
    const B = pts[b];
    const len = Math.hypot(B.x - A.x, B.y - A.y) || 1;
    for (let i = a + 1; i < b; i++) {
      const P = pts[i];
      const d = Math.abs((B.y - A.y) * P.x - (B.x - A.x) * P.y + B.x * A.y - B.y * A.x) / len;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > epsilon) {
      keep[idx] = true;
      rdp(a, idx, keep);
      rdp(idx, b, keep);
    }
  };
  // split at the farthest point from the first one so the closed curve is handled
  let far = 0;
  let farD = 0;
  pts.forEach((p, i) => {
    const d = Math.hypot(p.x - pts[0].x, p.y - pts[0].y);
    if (d > farD) {
      farD = d;
      far = i;
    }
  });
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[far] = true;
  rdp(0, far, keep);
  const tail = [...pts.slice(far), pts[0]];
  const keep2 = new Array(tail.length).fill(false);
  const saved = pts;
  pts = tail;
  rdp(0, tail.length - 1, keep2);
  pts = saved;
  const out = pts.filter((_, i) => keep[i] && i <= far);
  for (let i = 1; i < tail.length - 1; i++) if (keep2[i]) out.push(tail[i]);
  return out;
}

/** Four corners (tl, tr, br, bl) of a roughly quadrilateral contour. */
export function quadCorners(pts: Vec2[]): [Vec2, Vec2, Vec2, Vec2] | null {
  if (pts.length < 4) return null;
  let tl = pts[0];
  let tr = pts[0];
  let br = pts[0];
  let bl = pts[0];
  for (const p of pts) {
    if (p.x + p.y < tl.x + tl.y) tl = p;
    if (p.x - p.y > tr.x - tr.y) tr = p;
    if (p.x + p.y > br.x + br.y) br = p;
    if (p.y - p.x > bl.y - bl.x) bl = p;
  }
  return [tl, tr, br, bl];
}
