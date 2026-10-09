// web/js/qr.js
// Código QR (ISO/IEC 18004) sin dependencias: modo byte, corrección M, versiones 1-10
// (hasta 213 bytes: de sobra para una dirección como https://192.168.1.20:8443/…).
// qrMatrix(texto) → matriz de booleanos (true = módulo negro); qrSvg() la dibuja.

// [codewords de corrección por bloque, [bloques, datos por bloque], [bloques, datos]] — nivel M.
const EC_M = [null,
  [10, [1, 16]], [16, [1, 28]], [26, [1, 44]], [18, [2, 32]], [24, [2, 43]],
  [16, [4, 27]], [18, [4, 31]], [22, [2, 38], [2, 39]], [22, [3, 36], [2, 37]], [26, [4, 43], [1, 44]]];
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

/* ---------------- Reed-Solomon en GF(256) ---------------- */
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a, b) => a && b ? EXP[LOG[a] + LOG[b]] : 0;
function rsGenerator(n) {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) { next[j] ^= g[j]; next[j + 1] ^= mul(g[j], EXP[i]); }
    g = next;
  }
  return g;
}
export function rsRemainder(data, n) {
  const g = rsGenerator(n), r = new Array(n).fill(0);
  for (const d of data) {
    const f = d ^ r.shift(); r.push(0);
    for (let i = 0; i < n; i++) r[i] ^= mul(g[i + 1], f);
  }
  return r;
}

/* ---------------- Datos ---------------- */
const capacity = (v) => { const e = EC_M[v]; return e.slice(1).reduce((s, [b, d]) => s + b * d, 0); };
function encodeData(bytes, v) {
  const bits = [];
  const put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(0b0100, 4); put(bytes.length, v < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const cap = capacity(v) * 8;
  put(0, Math.min(4, cap - bits.length));
  while (bits.length % 8) bits.push(0);
  const out = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let p = 0; out.length < capacity(v); p++) out.push(p % 2 ? 0x11 : 0xec);
  return out;
}
function interleave(data, v) {
  const [ec, ...groups] = EC_M[v], blocks = [];
  let k = 0;
  for (const [n, d] of groups) for (let i = 0; i < n; i++) { const b = data.slice(k, k + d); k += d; blocks.push({ d: b, e: rsRemainder(b, ec) }); }
  const out = [], maxD = Math.max(...blocks.map(b => b.d.length));
  for (let i = 0; i < maxD; i++) for (const b of blocks) if (i < b.d.length) out.push(b.d[i]);
  for (let i = 0; i < ec; i++) for (const b of blocks) out.push(b.e[i]);
  return out;
}

/* ---------------- Matriz ---------------- */
function bch(value, poly, bitsPoly) {
  let v = value << (bitsPoly - 1);
  const deg = (x) => 31 - Math.clz32(x);
  while (v && deg(v) >= bitsPoly - 1) v ^= poly << (deg(v) - (bitsPoly - 1));
  return (value << (bitsPoly - 1)) | v;
}
const MASKS = [
  (r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => (r * c) % 2 + (r * c) % 3 === 0,
  (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0, (r, c) => ((r + c) % 2 + (r * c) % 3) % 2 === 0,
];

/** test: como los generadores de referencia, para puntuar la máscara el formato y la versión van en blanco. */
function build(v, codewords, mask, test = false) {
  const n = v * 4 + 17;
  const m = Array.from({ length: n }, () => new Array(n).fill(false));
  const fixed = Array.from({ length: n }, () => new Array(n).fill(false));
  const set = (r, c, on) => { m[r][c] = on; fixed[r][c] = true; };
  // Patrones de búsqueda (las 3 esquinas) con su separador blanco.
  for (const [r0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]])
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
      const rr = r0 + r, cc = c0 + c;
      if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
      const on = r >= 0 && r <= 6 && c >= 0 && c <= 6 && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
      set(rr, cc, on);
    }
  // Líneas de sincronización.
  for (let i = 8; i < n - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  // Patrones de alineación.
  const al = ALIGN[v], last = al.length - 1;
  for (let i = 0; i <= last; i++) for (let j = 0; j <= last; j++) {
    // Todas menos las 3 que caerían sobre los patrones de las esquinas.
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
    const r = al[i], c = al[j];
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
  }
  // Zonas reservadas para el formato (y el módulo oscuro fijo).
  for (let i = 0; i < 9; i++) { if (!fixed[8][i]) set(8, i, false); if (!fixed[i][8]) set(i, 8, false); }
  for (let i = 0; i < 8; i++) { set(8, n - 1 - i, false); set(n - 1 - i, 8, false); }
  set(n - 8, 8, true);
  // Información de versión (7 o más).
  if (v >= 7) {
    const vi = bch(v, 0x1f25, 13);
    for (let i = 0; i < 18; i++) { const on = !test && ((vi >>> i) & 1) === 1; set(Math.floor(i / 3), n - 11 + (i % 3), on); set(n - 11 + (i % 3), Math.floor(i / 3), on); }
  }
  // Datos en zigzag desde abajo a la derecha (saltando la columna 6).
  const bits = [];
  for (const cw of codewords) for (let i = 7; i >= 0; i--) bits.push((cw >>> i) & 1);
  let k = 0, up = true;
  for (let col = n - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let i = 0; i < n; i++) {
      const r = up ? n - 1 - i : i;
      for (const c of [col, col - 1]) {
        if (fixed[r][c]) continue;
        const bit = k < bits.length ? bits[k++] === 1 : false;
        m[r][c] = bit !== MASKS[mask](r, c);
      }
    }
    up = !up;
  }
  // Formato: nivel M (00) + máscara, BCH y XOR 0x5412.
  placeFormat(m, n, bch((0b00 << 3) | mask, 0x537, 11) ^ 0x5412, test);
  return m;
}
/** Coloca los 15 bits de formato en sus dos copias (estándar, tabla 25). */
function placeFormat(m, n, fmt, test = false) {
  const bit = (i) => !test && ((fmt >>> i) & 1) === 1;
  // Copia 1: alrededor del patrón de arriba a la izquierda.
  for (let i = 0; i <= 5; i++) m[i][8] = bit(i);
  m[7][8] = bit(6); m[8][8] = bit(7); m[8][7] = bit(8);
  for (let i = 9; i < 15; i++) m[8][14 - i] = bit(i);
  // Copia 2: arriba a la derecha (bits 0-7) y abajo a la izquierda (bits 8-14).
  for (let i = 0; i < 8; i++) m[8][n - 1 - i] = bit(i);
  for (let i = 8; i < 15; i++) m[n - 15 + i][8] = bit(i);
  m[n - 8][8] = !test;
}

/** Puntuación de penalización (cuanto menos, mejor se lee). */
function penalty(m) {
  const n = m.length;
  let p = 0;
  for (let pass = 0; pass < 2; pass++) for (let a = 0; a < n; a++) {
    let run = 1;
    for (let b = 1; b < n; b++) {
      const cur = pass ? m[b][a] : m[a][b], prev = pass ? m[b - 1][a] : m[a][b - 1];
      if (cur === prev) { run++; if (b === n - 1 && run >= 5) p += run - 2; }
      else { if (run >= 5) p += run - 2; run = 1; }
    }
  }
  for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) { const x = m[r][c]; if (x === m[r][c + 1] && x === m[r + 1][c] && x === m[r + 1][c + 1]) p += 3; }
  // Patrón tipo «buscador» 1:1:3:1:1 con 4 claros a un lado (ventanas de 11 dentro del código).
  const finderLike = (get) => {
    let pts = 0;
    for (let i = 0; i + 10 < n; i++) {
      const x = (k) => get(i + k);
      if (!x(1) && x(4) && !x(5) && x(6) && !x(9) &&
        ((x(0) && x(2) && x(3) && !x(7) && !x(8) && !x(10)) || (!x(0) && !x(2) && !x(3) && x(7) && x(8) && x(10)))) pts += 40;
      if (x(10)) i++;   // la siguiente ventana no puede coincidir
    }
    return pts;
  };
  for (let a = 0; a < n; a++) { p += finderLike((k) => m[a][k]); p += finderLike((k) => m[k][a]); }
  let dark = 0; for (const row of m) for (const x of row) if (x) dark++;
  p += Math.floor(Math.abs(dark * 20 - n * n * 10) / (n * n)) * 10;
  return p;
}

/** Matriz del código QR de un texto (UTF-8). Lanza un error si no cabe. */
export function qrMatrix(text, { mask: forceMask } = {}) {
  const bytes = [...new TextEncoder().encode(String(text))];
  let v = 1;
  while (v <= 10 && capacity(v) < bytes.length + (v < 10 ? 2 : 3)) v++;
  if (v > 10) throw new Error("Texto demasiado largo para el código QR");
  const cw = interleave(encodeData(bytes, v), v);
  let best = 0, bestP = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    if (forceMask !== undefined && mask !== forceMask) continue;
    const p = penalty(build(v, cw, mask, true));
    if (p < bestP) { best = mask; bestP = p; }
  }
  return build(v, cw, best);
}

/** SVG del código QR (con margen blanco de 4 módulos, como pide la norma). */
export function qrSvg(text, { size = 220, dark = "#000", light = "#fff" } = {}) {
  const m = qrMatrix(text), n = m.length, q = 4, t = n + q * 2;
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m[r][c]) d += `M${c + q} ${r + q}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${t} ${t}" width="${size}" height="${size}" shape-rendering="crispEdges"><rect width="${t}" height="${t}" fill="${light}"/><path d="${d}" fill="${dark}"/></svg>`;
}
