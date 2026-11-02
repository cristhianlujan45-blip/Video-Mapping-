// web/js/hap.js
// Codificador HAP (el códec de video de los programas de VJ: Resolume, TouchDesigner, MadMapper…):
// cada fotograma es una textura DXT1 que la tarjeta gráfica descomprime sola, así se reproducen
// muchos videos a la vez sin esfuerzo. Aquí: «Hap1» (DXT1, sin segunda compresión), el más
// compatible. Lo usa «Exportar el show a video» (fotograma a fotograma; en directo no da tiempo).
// Sin navegador: se prueba en Node.

/** RGB888 → RGB565. */
const to565 = (r, g, b) => ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
const from565 = (c) => [((c >> 11) & 31) * 255 / 31, ((c >> 5) & 63) * 255 / 63, (c & 31) * 255 / 31];

/**
 * Comprime un bloque 4×4 (16 píxeles RGBA en `px`, 64 bytes) a 8 bytes DXT1 en out[o..o+7].
 * Los extremos van sobre el eje principal del color del bloque (como stb_dxt / squish «range
 * fit»): sirve también cuando los canales se cruzan (rojo que sube y verde que baja).
 */
export function dxt1Block(px, out, o) {
  let mr = 0, mg = 0, mb = 0;
  for (let i = 0; i < 64; i += 4) { mr += px[i]; mg += px[i + 1]; mb += px[i + 2]; }
  mr /= 16; mg /= 16; mb /= 16;
  let crr = 0, crg = 0, crb = 0, cgg = 0, cgb = 0, cbb = 0;
  for (let i = 0; i < 64; i += 4) {
    const r = px[i] - mr, g = px[i + 1] - mg, b = px[i + 2] - mb;
    crr += r * r; crg += r * g; crb += r * b; cgg += g * g; cgb += g * b; cbb += b * b;
  }
  // Eje principal (iteración de potencia sobre la covarianza).
  // Se empieza por la columna del canal que más varía (nunca perpendicular al eje bueno).
  let ar, ag, ab;
  if (crr >= cgg && crr >= cbb) { ar = crr; ag = crg; ab = crb; } else if (cgg >= cbb) { ar = crg; ag = cgg; ab = cgb; } else { ar = crb; ag = cgb; ab = cbb; }
  { const l = Math.hypot(ar, ag, ab); if (l < 1e-6) { ar = ag = ab = 0.577; } else { ar /= l; ag /= l; ab /= l; } }
  for (let k = 0; k < 4; k++) {
    const nr = crr * ar + crg * ag + crb * ab, ng = crg * ar + cgg * ag + cgb * ab, nb = crb * ar + cgb * ag + cbb * ab;
    const l = Math.hypot(nr, ng, nb);
    if (l < 1e-9) break;
    ar = nr / l; ag = ng / l; ab = nb / l;
  }
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 64; i += 4) { const t = (px[i] - mr) * ar + (px[i + 1] - mg) * ag + (px[i + 2] - mb) * ab; if (t < lo) lo = t; if (t > hi) hi = t; }
  const inset = (hi - lo) / 16; lo += inset; hi -= inset;
  const cl = (v) => Math.max(0, Math.min(255, Math.round(v)));
  let c0 = to565(cl(mr + ar * hi), cl(mg + ag * hi), cl(mb + ab * hi)), c1 = to565(cl(mr + ar * lo), cl(mg + ag * lo), cl(mb + ab * lo));
  if (c0 < c1) { const t = c0; c0 = c1; c1 = t; }
  out[o] = c0 & 255; out[o + 1] = c0 >> 8; out[o + 2] = c1 & 255; out[o + 3] = c1 >> 8;
  if (c0 === c1) { out[o + 4] = out[o + 5] = out[o + 6] = out[o + 7] = 0; return; }
  // Paleta de 4 colores (modo c0 > c1) e índice del más cercano de cada píxel.
  const a = from565(c0), b = from565(c1);
  const pal = [a, b, [(2 * a[0] + b[0]) / 3, (2 * a[1] + b[1]) / 3, (2 * a[2] + b[2]) / 3], [(a[0] + 2 * b[0]) / 3, (a[1] + 2 * b[1]) / 3, (a[2] + 2 * b[2]) / 3]];
  let bits = 0;
  for (let i = 15; i >= 0; i--) {
    const r = px[i * 4], g = px[i * 4 + 1], bl = px[i * 4 + 2];
    let best = 0, bd = Infinity;
    for (let k = 0; k < 4; k++) { const p = pal[k], dr = r - p[0], dg = g - p[1], db = bl - p[2], d = dr * dr + dg * dg + db * db; if (d < bd) { bd = d; best = k; } }
    bits = (bits << 2) | best;
  }
  out[o + 4] = bits & 255; out[o + 5] = (bits >>> 8) & 255; out[o + 6] = (bits >>> 16) & 255; out[o + 7] = (bits >>> 24) & 255;
}

/** Tamaño de la textura (múltiplo de 4, como exige DXT). */
export const hapSize = (w, h) => [Math.ceil(w / 4) * 4, Math.ceil(h / 4) * 4];

/**
 * Un fotograma HAP (Hap1): cabecera de sección (tamaño y tipo 0xAB = DXT1 sin compresión) +
 * los bloques DXT1, de arriba abajo. rgba: Uint8ClampedArray w×h×4 (como getImageData).
 */
export function encodeHapFrame(rgba, w, h) {
  const [W, H] = hapSize(w, h), bw = W / 4, bh = H / 4, size = bw * bh * 8;
  const long = size > 0xffffff, head = long ? 8 : 4;
  const out = new Uint8Array(head + size);
  if (long) { out[3] = 0xab; out[4] = size & 255; out[5] = (size >>> 8) & 255; out[6] = (size >>> 16) & 255; out[7] = (size >>> 24) & 255; }
  else { out[0] = size & 255; out[1] = (size >>> 8) & 255; out[2] = (size >>> 16) & 255; out[3] = 0xab; }
  const px = new Uint8Array(64);
  let o = head;
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    for (let y = 0; y < 4; y++) {
      const sy = Math.min(h - 1, by * 4 + y);
      for (let x = 0; x < 4; x++) {
        const sx = Math.min(w - 1, bx * 4 + x), s = (sy * w + sx) * 4, d = (y * 4 + x) * 4;
        px[d] = rgba[s]; px[d + 1] = rgba[s + 1]; px[d + 2] = rgba[s + 2]; px[d + 3] = 255;
      }
    }
    dxt1Block(px, out, o); o += 8;
  }
  return out;
}

/** Descomprime un bloque DXT1 (para las pruebas). Devuelve 16 colores [r, g, b]. */
export function dxt1Decode(b, o = 0) {
  const c0 = b[o] | (b[o + 1] << 8), c1 = b[o + 2] | (b[o + 3] << 8), a = from565(c0), bb = from565(c1);
  const pal = c0 > c1 ? [a, bb, a.map((v, k) => (2 * v + bb[k]) / 3), a.map((v, k) => (v + 2 * bb[k]) / 3)] : [a, bb, a.map((v, k) => (v + bb[k]) / 2), [0, 0, 0]];
  const bits = (b[o + 4] | (b[o + 5] << 8) | (b[o + 6] << 16) | (b[o + 7] << 24)) >>> 0;
  return Array.from({ length: 16 }, (_, i) => pal[(bits >>> (i * 2)) & 3]);
}

/** Un .wav (PCM 16 bits) de canales en Float32 (para el audio aparte). */
export function encodeWav(channels, sampleRate) {
  const n = channels[0]?.length || 0, ch = channels.length || 1, data = n * ch * 2;
  const buf = new ArrayBuffer(44 + data), dv = new DataView(buf);
  const w4 = (o, s) => { for (let k = 0; k < 4; k++) dv.setUint8(o + k, s.charCodeAt(k)); };
  w4(0, "RIFF"); dv.setUint32(4, 36 + data, true); w4(8, "WAVE"); w4(12, "fmt ");
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true); dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * ch * 2, true); dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true); w4(36, "data"); dv.setUint32(40, data, true);
  let p = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const v = Math.max(-1, Math.min(1, channels[c][i] || 0)); dv.setInt16(p, v < 0 ? v * 0x8000 : v * 0x7fff, true); p += 2; }
  return new Uint8Array(buf);
}
