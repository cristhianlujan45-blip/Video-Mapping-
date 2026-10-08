import type { Vec2 } from '../geometry/homography';
import type { PixelFormat, PixelMap } from '../project/model';

export const FORMAT_CHANNELS: Record<PixelFormat, string> = {
  RGB: 'rgb',
  GRB: 'grb',
  BRG: 'brg',
  RBG: 'rbg',
  GBR: 'gbr',
  BGR: 'bgr',
  RGBW: 'rgbw',
  RGBWA: 'rgbwa',
  W: 'w',
};

export const channelsPerPixel = (f: PixelFormat) => FORMAT_CHANNELS[f].length;

/**
 * Pixel positions in source space (normalized 0..1), already in WIRING order:
 * index 0 is the first pixel on the data line.
 */
export function pixelPositions(m: PixelMap): Vec2[] {
  let pts: Vec2[] = [];
  const cols = Math.max(1, Math.floor(m.cols));
  const rows = Math.max(1, Math.floor(m.rows));
  switch (m.layout) {
    case 'grid':
    case 'matrix': {
      const grid: Vec2[][] = [];
      for (let r = 0; r < rows; r++) {
        const row: Vec2[] = [];
        for (let c = 0; c < cols; c++) row.push({ x: m.x + ((c + 0.5) / cols) * m.w, y: m.y + ((r + 0.5) / rows) * m.h });
        grid.push(row);
      }
      pts = wireGrid(grid, m.order, m.startCorner);
      break;
    }
    case 'line': {
      const n = cols;
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0.5 : i / (n - 1);
        pts.push({ x: m.x + t * m.w, y: m.y + t * m.h });
      }
      if (m.order === 'rtl' || m.order === 'btt') pts.reverse();
      break;
    }
    case 'circle':
    case 'arc': {
      const n = cols;
      const a0 = (m.startAngle * Math.PI) / 180;
      const a1 = ((m.layout === 'circle' ? m.startAngle + 360 : m.endAngle) * Math.PI) / 180;
      const closed = m.layout === 'circle';
      for (let i = 0; i < n; i++) {
        const t = closed ? i / n : n === 1 ? 0.5 : i / (n - 1);
        const a = a0 + (a1 - a0) * t;
        pts.push({ x: m.x + m.w / 2 + (Math.cos(a) * m.w) / 2, y: m.y + m.h / 2 + (Math.sin(a) * m.h) / 2 });
      }
      break;
    }
    case 'custom':
      pts = m.custom.map((p) => ({ ...p }));
      break;
  }
  if (m.reverse) pts.reverse();
  return pts;
}

function wireGrid(grid: Vec2[][], order: PixelMap['order'], corner: PixelMap['startCorner']): Vec2[] {
  const rows = grid.length;
  const cols = grid[0].length;
  // Normalize so wiring always starts at top-left, then mirror for the chosen corner.
  let g = grid.map((r) => [...r]);
  if (corner === 'tr' || corner === 'br') g = g.map((r) => r.reverse());
  if (corner === 'bl' || corner === 'br') g = g.reverse();
  const out: Vec2[] = [];
  const columnMajor = order === 'ttb' || order === 'btt';
  if (!columnMajor) {
    for (let r = 0; r < rows; r++) {
      // serpentine: every other row runs back; zigzag: every row starts on the same side
      // (the data line returns diagonally), like a raster scan.
      const flip = order === 'rtl' || (order === 'serpentine' && r % 2 === 1);
      out.push(...(flip ? [...g[r]].reverse() : g[r]));
    }
  } else {
    for (let c = 0; c < cols; c++) {
      const col: Vec2[] = [];
      for (let r = 0; r < rows; r++) col.push(g[r][c]);
      if (order === 'btt') col.reverse();
      out.push(...col);
    }
  }
  return out;
}

export interface PixelPatch {
  /** Universe offset from the pixel map's first universe (0, 1, 2…). */
  universeOffset: number;
  /** 1-based DMX channel of the first channel of this pixel (or byte for split pixels). */
  channel: number;
  /** When a pixel is split across universes (alignment disabled), the bytes for the next universe. */
  split?: { universeOffset: number; channel: number; firstBytes: number };
}

/**
 * Channel patch for each pixel.
 *  - autoSpan: continues in the next universe when 512 channels are used.
 *  - alignPixels: a pixel never straddles two universes (e.g. RGB → 170 px/universe,
 *    channels 511-512 unused); disabled = bytes flow continuously.
 *  - pixelsPerUniverse: hard limit set by the LED controller (0 = as many as fit).
 * Returns null patches for pixels that do not fit when autoSpan is off.
 */
export function patchPixels(count: number, format: PixelFormat, startChannel: number, opts: { autoSpan: boolean; alignPixels: boolean; pixelsPerUniverse: number }): (PixelPatch | null)[] {
  const cpp = channelsPerPixel(format);
  const out: (PixelPatch | null)[] = [];
  let uni = 0;
  let ch = Math.max(1, Math.min(512, Math.floor(startChannel)));
  let inUni = 0;
  for (let i = 0; i < count; i++) {
    const limitReached = opts.pixelsPerUniverse > 0 && inUni >= opts.pixelsPerUniverse;
    const doesNotFit = ch + cpp - 1 > 512;
    if (limitReached || (doesNotFit && opts.alignPixels) || ch > 512) {
      if (!opts.autoSpan) {
        out.push(null);
        continue;
      }
      uni++;
      ch = 1;
      inUni = 0;
    }
    if (ch + cpp - 1 > 512) {
      // Only reached when alignment is off: split the pixel.
      if (!opts.autoSpan) {
        out.push(null);
        continue;
      }
      const firstBytes = 512 - ch + 1;
      out.push({ universeOffset: uni, channel: ch, split: { universeOffset: uni + 1, channel: 1, firstBytes } });
      uni++;
      ch = cpp - firstBytes + 1;
      inUni = 1;
      continue;
    }
    out.push({ universeOffset: uni, channel: ch });
    ch += cpp;
    inUni++;
  }
  return out;
}

export function universesUsed(patch: (PixelPatch | null)[]): number {
  let max = -1;
  for (const p of patch) {
    if (!p) continue;
    max = Math.max(max, p.universeOffset, p.split?.universeOffset ?? -1);
  }
  return max + 1;
}

export interface ColorShaping {
  brightness: number;
  gamma: number;
  saturation: number;
  contrast: number;
  whiteExtraction: boolean;
}

/**
 * Converts linear-ish 0..1 RGB into the fixture's channel bytes.
 * Writes `channelsPerPixel(format)` bytes at `out[offset]`.
 */
export function encodePixel(r: number, g: number, b: number, format: PixelFormat, s: ColorShaping, out: Uint8Array, offset: number) {
  // contrast around mid grey, saturation around luma
  if (s.contrast !== 1) {
    r = (r - 0.5) * s.contrast + 0.5;
    g = (g - 0.5) * s.contrast + 0.5;
    b = (b - 0.5) * s.contrast + 0.5;
  }
  if (s.saturation !== 1) {
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    r = l + (r - l) * s.saturation;
    g = l + (g - l) * s.saturation;
    b = l + (b - l) * s.saturation;
  }
  r = clamp01(r) * s.brightness;
  g = clamp01(g) * s.brightness;
  b = clamp01(b) * s.brightness;
  if (s.gamma !== 1) {
    r = Math.pow(clamp01(r), s.gamma);
    g = Math.pow(clamp01(g), s.gamma);
    b = Math.pow(clamp01(b), s.gamma);
  }
  let w = 0;
  const order = FORMAT_CHANNELS[format];
  if (order.includes('w')) {
    if (s.whiteExtraction) {
      w = Math.min(r, g, b);
      r -= w;
      g -= w;
      b -= w;
    }
    if (format === 'W') w = 0.2126 * r + 0.7152 * g + 0.0722 * b + w;
  }
  const amber = order.includes('a') ? Math.min(r, g * 2) * 0.5 : 0;
  for (let i = 0; i < order.length; i++) {
    const c = order[i];
    const v = c === 'r' ? r : c === 'g' ? g : c === 'b' ? b : c === 'w' ? w : amber;
    out[offset + i] = Math.round(clamp01(v) * 255);
  }
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Writes all pixels of a map into universe buffers.
 * `colors` holds RGBA bytes per pixel (as read back from the GPU sampler), in wiring order.
 * `universes[k]` is the 512-byte buffer for universe offset k.
 */
export function writePixelMap(m: PixelMap, patch: (PixelPatch | null)[], colors: Uint8Array, universes: Uint8Array[]) {
  const cpp = channelsPerPixel(m.format);
  const tmp = new Uint8Array(cpp);
  const shaping: ColorShaping = m;
  for (let i = 0; i < patch.length; i++) {
    const p = patch[i];
    if (!p) continue;
    encodePixel(colors[i * 4] / 255, colors[i * 4 + 1] / 255, colors[i * 4 + 2] / 255, m.format, shaping, tmp, 0);
    const u = universes[p.universeOffset];
    if (!u) continue;
    if (p.split) {
      u.set(tmp.subarray(0, p.split.firstBytes), p.channel - 1);
      universes[p.split.universeOffset]?.set(tmp.subarray(p.split.firstBytes), p.split.channel - 1);
    } else {
      u.set(tmp, p.channel - 1);
    }
  }
}
