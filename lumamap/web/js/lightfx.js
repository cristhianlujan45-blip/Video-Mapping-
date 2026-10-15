// web/js/lightfx.js
// Biblioteca de efectos de luz. Cada efecto calcula el color de cada LED (o de
// cada foco) en tiempo real a partir de su posición en la tira / matriz, el
// tiempo, el tempo (BPM) y, si se pide, la música (graves, medios, agudos,
// golpe). Es CPU pura y barata (unos pocos miles de LED por fotograma) y no
// depende del DOM: se prueba en Node.
//
// Uso:  const run = prepareFx(fx, timeSec, levels, bpm);
//       run(i, n, x, y, out)   → out = [r, g, b] (0-255)
//
// También hay movimientos para cabezas móviles (pan / tilt): prepareMove().

const TAU = Math.PI * 2;
const frac = (v) => v - Math.floor(v);
const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
/** Hash determinista 0..1 (mismo LED + mismo instante = mismo valor). */
function hash(a, b = 0) {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
/** Ruido suave 1D (valor interpolado). */
function noise(x, seed = 0) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return hash(i, seed) * (1 - u) + hash(i + 1, seed) * u;
}
export function hexRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  const n = m ? parseInt(m[1], 16) : 0xffffff;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function hsv(h, s, v, o) {
  h = frac(h) * 6; const i = Math.floor(h), f = h - i, p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
  const r = [v, q, p, p, t, v][i], g = [t, v, v, q, p, p][i], b = [p, p, t, v, v, q][i];
  o[0] = r * 255; o[1] = g * 255; o[2] = b * 255;
}
const put = (o, c, k = 1) => { o[0] = c[0] * k; o[1] = c[1] * k; o[2] = c[2] * k; };
const mix = (o, a, b, k) => { o[0] = a[0] + (b[0] - a[0]) * k; o[1] = a[1] + (b[1] - a[1]) * k; o[2] = a[2] + (b[2] - a[2]) * k; };
/** Paleta de calor (negro → rojo → naranja → amarillo → blanco). */
function heat(v, o) {
  v = clamp01(v);
  o[0] = clamp01(v * 3) * 255; o[1] = clamp01(v * 3 - 1) * 255; o[2] = clamp01(v * 3 - 2) * 255;
}
/** Distancia circular en una tira (0..0.5). */
const cdist = (a, b) => { const d = Math.abs(a - b) % 1; return d > 0.5 ? 1 - d : d; };

/**
 * Algoritmos base. p = { i, n, u (posición 0..1 a lo largo), x, y }, c = contexto.
 * c.t = tiempo × velocidad (s), c.ph = golpes del tempo, c.sz = tamaño,
 * c.c1 / c.c2 = colores, c.L = niveles de audio { bass, mid, high, level, beat }.
 */
const ALGOS = {
  solid: (p, c, o) => put(o, c.c1),
  fade: (p, c, o) => mix(o, c.c1, c.c2, 0.5 - 0.5 * Math.cos(c.t * 0.8)),
  breathe: (p, c, o) => { const k = 0.5 - 0.5 * Math.cos(c.t * 2); put(o, c.c1, 0.04 + 0.96 * k * k); },
  pulse: (p, c, o) => put(o, c.c1, Math.exp(-frac(c.ph) * 5)),
  heartbeat: (p, c, o) => { const f = frac(c.ph / 2); put(o, c.c1, Math.max(Math.exp(-f * 18), f > 0.18 ? Math.exp(-(f - 0.18) * 16) * 0.8 : 0)); },
  strobe: (p, c, o) => put(o, c.c1, frac(c.t * 6) < 0.18 ? 1 : 0),
  strobeAlt: (p, c, o) => { const s = Math.floor(c.t * 6); put(o, s % 2 ? c.c2 : c.c1, frac(c.t * 6) < 0.25 ? 1 : 0); },
  strobeRandom: (p, c, o) => { const s = Math.floor(c.t * 10); put(o, c.c1, hash(p.i, s) > 1 - 0.12 * c.sz ? 1 : 0); },
  beatStrobe: (p, c, o) => put(o, c.c1, frac(c.ph) < 0.12 ? 1 : 0),
  chase: (p, c, o) => { const d = cdist(p.u, frac(c.t * 0.25)), w = 0.04 * c.sz; put(o, c.c1, d < w ? (1 - d / w) : 0); if (d >= w) put(o, c.c2, 0.06); },
  theater: (p, c, o) => put(o, ((p.i + Math.floor(c.t * 8)) % 3) === 0 ? c.c1 : c.c2, ((p.i + Math.floor(c.t * 8)) % 3) === 0 ? 1 : 0.12),
  comet: (p, c, o) => { const d = frac(frac(c.t * 0.3) - p.u), len = 0.18 * c.sz; const k = d < len ? Math.pow(1 - d / len, 2) : 0; mix(o, c.c2, c.c1, k); if (k <= 0) put(o, c.c2, 0.03); },
  scanner: (p, c, o) => { const pos = 0.5 - 0.5 * Math.cos(c.t * 1.6), w = 0.08 * c.sz; const k = Math.pow(clamp01(1 - Math.abs(p.u - pos) / w), 2); put(o, c.c1, k); },
  converge: (p, c, o) => { const pos = 0.5 * frac(c.t * 0.3), w = 0.05 * c.sz; const k = clamp01(1 - Math.min(Math.abs(p.u - pos), Math.abs(p.u - (1 - pos))) / w); mix(o, c.c2, c.c1, k); if (k <= 0) put(o, c.c2, 0.05); },
  wipe: (p, c, o) => { const f = frac(c.t * 0.2) * 2; const on = f < 1 ? p.u < f : p.u >= f - 1; put(o, on ? c.c1 : c.c2, on ? 1 : 0.08); },
  center: (p, c, o) => { const f = frac(c.t * 0.25), d = Math.abs(p.u - 0.5) * 2; put(o, c.c1, d < f ? 1 - (f - d) * 0.6 : 0.03); },
  rainbow: (p, c, o) => hsv(p.u * c.sz + c.t * 0.12, 1, 1, o),
  rainbowAll: (p, c, o) => hsv(c.t * 0.08, 1, 1, o),
  rainbowChase: (p, c, o) => { hsv(p.u * c.sz * 2 - c.t * 0.3, 1, 1, o); const k = ((p.i + Math.floor(c.t * 10)) % 4) ? 0.15 : 1; o[0] *= k; o[1] *= k; o[2] *= k; },
  gradient: (p, c, o) => mix(o, c.c1, c.c2, 0.5 + 0.5 * Math.sin((p.u * c.sz + c.t * 0.15) * TAU)),
  wave: (p, c, o) => { const k = 0.5 + 0.5 * Math.sin((p.u * c.sz * 2 - c.t * 0.5) * TAU); mix(o, c.c2, c.c1, k * k); },
  sine: (p, c, o) => put(o, c.c1, Math.pow(0.5 + 0.5 * Math.sin((p.u * c.sz * 3 - c.t * 0.8) * TAU), 3)),
  alternate: (p, c, o) => put(o, ((p.i + Math.floor(c.t * 2)) % 2) ? c.c1 : c.c2),
  twinkle: (p, c, o) => { const h = hash(p.i, 7), f = frac(c.t * (0.3 + h * 0.6) + h * 13); const k = f < 0.2 ? Math.sin(f / 0.2 * Math.PI) : 0; mix(o, c.c2, c.c1, k); o[0] *= 0.15 + 0.85 * Math.max(k, 0.1); o[1] *= 0.15 + 0.85 * Math.max(k, 0.1); o[2] *= 0.15 + 0.85 * Math.max(k, 0.1); },
  sparkle: (p, c, o) => { const s = Math.floor(c.t * 18); if (hash(p.i, s) > 1 - 0.05 * c.sz) put(o, c.c1); else put(o, c.c2, 0.35); },
  confetti: (p, c, o) => { const s = Math.floor(c.t * 3 + hash(p.i, 3) * 3), f = frac(c.t * 3 + hash(p.i, 3) * 3); hsv(hash(p.i, s), 0.9, 1, o); const k = hash(p.i, s + 99) > 0.6 ? (1 - f) : 0; o[0] *= k; o[1] *= k; o[2] *= k; },
  fire: (p, c, o) => { const v = noise(p.u * 9 * c.sz - c.t * 2.2, 1) * 0.65 + noise(p.u * 23 * c.sz + c.t * 3.1, 2) * 0.45; heat(v * (0.75 + 0.25 * noise(c.t * 4, 3)), o); },
  candle: (p, c, o) => { const h = hash(p.i, 5); put(o, c.c1, 0.55 + 0.45 * noise(c.t * 5 + h * 40, 9)); },
  lava: (p, c, o) => { const v = noise(p.u * 4 * c.sz + c.t * 0.25, 4) * 0.7 + noise(p.u * 9 - c.t * 0.4, 6) * 0.3; mix(o, c.c2, c.c1, clamp01(v * 1.4 - 0.2)); },
  ocean: (p, c, o) => { const k = 0.5 + 0.5 * Math.sin((p.u * 5 * c.sz + c.t * 0.6) * 2) * Math.sin((p.u * 3.3 - c.t * 0.4) * 2); mix(o, c.c2, c.c1, k); },
  aurora: (p, c, o) => { const a = noise(p.u * 3 * c.sz + c.t * 0.2, 11), b = noise(p.u * 5 - c.t * 0.15, 12); mix(o, c.c2, c.c1, a); o[0] = o[0] * (0.3 + b) * 0.8; o[1] *= 0.4 + b * 0.8; o[2] *= 0.4 + b * 0.8; },
  forest: (p, c, o) => { const k = noise(p.u * 6 * c.sz + c.t * 0.3, 21); mix(o, c.c2, c.c1, k); },
  storm: (p, c, o) => { const s = Math.floor(c.t * 7), flash = hash(s, 77) > 0.9 ? Math.max(0, 1 - frac(c.t * 7) * 2) : 0; mix(o, c.c2, [255, 255, 255], flash * (0.6 + 0.4 * hash(Math.floor(p.u * 6), s))); },
  lightning: (p, c, o) => { const s = Math.floor(c.t * 6), on = hash(s, 41) > 0.85; const seg = Math.floor(p.u * 5); put(o, c.c1, on && hash(seg, s) > 0.3 ? 1 - frac(c.t * 6) : 0); },
  sunrise: (p, c, o) => { const f = 0.5 - 0.5 * Math.cos(c.t * 0.15); const g = clamp01(f * 1.3 - p.u * 0.3); heat(0.25 + g * 0.75, o); },
  meteor: (p, c, o) => { const head = frac(c.t * 0.35), d = frac(head - p.u), len = 0.25 * c.sz; const k = d < len ? Math.pow(1 - d / len, 3) * (d < 0.01 ? 1 : 0.4 + 0.6 * hash(p.i, Math.floor(c.t * 30))) : 0; put(o, c.c1, k); },
  police: (p, c, o) => { const s = Math.floor(c.t * 2) % 2, flash = frac(c.t * 8) < 0.5; const left = p.u < 0.5; put(o, left ? [255, 0, 0] : [0, 40, 255], (left ? s === 0 : s === 1) && flash ? 1 : 0); },
  ambulance: (p, c, o) => put(o, frac(c.t * 3) < 0.5 ? [255, 0, 0] : [255, 255, 255], frac(c.t * 6) < 0.6 ? 1 : 0.1),
  warning: (p, c, o) => put(o, [255, 140, 0], Math.max(0, Math.sin(c.t * 4)) ** 4),
  christmas: (p, c, o) => { const cols = [[255, 0, 0], [0, 200, 0], [255, 180, 40], [0, 60, 255]]; const k = 0.5 + 0.5 * Math.sin(c.t * 2 + hash(p.i) * 9); put(o, cols[(p.i + Math.floor(c.t * 0.5)) % 4], 0.3 + 0.7 * k); },
  halloween: (p, c, o) => { const k = noise(c.t * 3 + p.i * 0.7, 31); mix(o, [120, 0, 200], [255, 90, 0], k > 0.5 ? 1 : 0); o[0] *= 0.3 + k; o[1] *= 0.3 + k; o[2] *= 0.3 + k; },
  disco: (p, c, o) => { const s = Math.floor(c.ph * 2); hsv(hash(Math.floor(p.u * 8 * c.sz), s), 1, 1, o); },
  partyMix: (p, c, o) => { const s = Math.floor(c.ph); const m = s % 4; if (m === 0) ALGOS.rainbow(p, c, o); else if (m === 1) ALGOS.theater(p, c, o); else if (m === 2) ALGOS.sparkle(p, c, o); else ALGOS.comet(p, c, o); },
  noiseColor: (p, c, o) => hsv(noise(p.u * 2 * c.sz + c.t * 0.1, 51), 0.9, 1, o),
  // ---- Matriz 2D (usan x, y; en una tira se ven como una línea de la imagen) ----
  plasma: (p, c, o) => { const v = Math.sin(p.x * 10 * c.sz + c.t) + Math.sin(p.y * 10 * c.sz + c.t * 1.3) + Math.sin((p.x + p.y) * 7 * c.sz + c.t * 0.7); hsv(v / 6 + c.t * 0.05, 1, 1, o); },
  ripple: (p, c, o) => { const d = Math.hypot(p.x - 0.5, p.y - 0.5); mix(o, c.c2, c.c1, Math.pow(0.5 + 0.5 * Math.sin((d * 18 * c.sz - c.t * 3)), 2)); },
  checker: (p, c, o) => put(o, ((Math.floor(p.x * 6 * c.sz) + Math.floor(p.y * 6 * c.sz) + Math.floor(c.t * 2)) % 2) ? c.c1 : c.c2),
  spiral: (p, c, o) => { const a = Math.atan2(p.y - 0.5, p.x - 0.5) / TAU, d = Math.hypot(p.x - 0.5, p.y - 0.5); hsv(a + d * 2 * c.sz - c.t * 0.3, 1, 1, o); },
  rain: (p, c, o) => { const col = Math.floor(p.x * 16 * c.sz + 0.5), head = frac(c.t * (0.4 + hash(col, 2) * 0.5) + hash(col, 1)); const d = frac(head - p.y); put(o, c.c1, d < 0.3 ? Math.pow(1 - d / 0.3, 2) : 0); },
  bars: (p, c, o) => put(o, c.c1, (Math.floor(p.x * 8 * c.sz - c.t * 3) % 2 === 0) ? 1 : 0.05),
  radar: (p, c, o) => { const a = frac(Math.atan2(p.y - 0.5, p.x - 0.5) / TAU - c.t * 0.3); put(o, c.c1, Math.pow(1 - a, 6)); },
  // ---- Música ♪ (necesitan micrófono o audio activo) ----
  vu: (p, c, o) => { const lv = clamp01(c.L.level * 1.4); if (p.u > lv) return put(o, c.c2, 0.03); mix(o, [0, 255, 40], [255, 0, 0], p.u); },
  vuCenter: (p, c, o) => { const lv = clamp01(c.L.level * 1.4), d = Math.abs(p.u - 0.5) * 2; if (d > lv) return put(o, c.c2, 0.03); hsv(0.33 - d * 0.33, 1, 1, o); },
  beatFlash: (p, c, o) => mix(o, c.c2, c.c1, clamp01(c.L.beat)),
  bassPulse: (p, c, o) => put(o, c.c1, 0.05 + 0.95 * Math.pow(clamp01(c.L.bass * 1.2), 1.5)),
  spectrum: (p, c, o) => { const band = p.u < 1 / 3 ? c.L.bass : p.u < 2 / 3 ? c.L.mid : c.L.high; hsv(p.u * 0.8, 1, clamp01(band * 1.3), o); },
  audioRainbow: (p, c, o) => hsv(p.u * c.sz + c.t * 0.1, 1, 0.08 + 0.92 * clamp01(c.L.level * 1.5), o),
  beatChase: (p, c, o) => { const pos = frac(Math.floor(c.ph) / 8), w = 0.06 * c.sz; put(o, c.c1, cdist(p.u, pos) < w ? 1 : 0.04); },
  beatColor: (p, c, o) => hsv(Math.floor(c.ph) * 0.17, 1, 0.3 + 0.7 * Math.exp(-frac(c.ph) * 4), o),
};

/**
 * Catálogo: [categoría, nombre, algoritmo, color1, color2, velocidad, tamaño, extra].
 * Muchos efectos son el mismo algoritmo con otra combinación de colores y ritmo.
 */
const C = [
  // Básicos
  ["Básicos", "Color fijo", "solid", "#ffffff", "#000000", 1, 1],
  ["Básicos", "Blanco cálido", "solid", "#ffb36b", "#000000", 1, 1],
  ["Básicos", "Respirar", "breathe", "#00e5ff", "#000000", 1, 1],
  ["Básicos", "Respirar rojo", "breathe", "#ff1a1a", "#000000", 0.7, 1],
  ["Básicos", "Fundido entre dos colores", "fade", "#ff00aa", "#00e5ff", 1, 1],
  ["Básicos", "Degradado", "gradient", "#ff00aa", "#00e5ff", 1, 1],
  ["Básicos", "Alternar pares / impares", "alternate", "#ff0000", "#0000ff", 1, 1],
  ["Básicos", "Pulso al tempo", "pulse", "#ffffff", "#000000", 1, 1],
  ["Básicos", "Latido", "heartbeat", "#ff1744", "#000000", 1, 1],
  // Persecuciones
  ["Persecuciones", "Punto que corre", "chase", "#00e5ff", "#000000", 1, 1],
  ["Persecuciones", "Cometa", "comet", "#ffffff", "#000000", 1, 1],
  ["Persecuciones", "Cometa de fuego", "comet", "#ff6a00", "#200000", 1.3, 1.5],
  ["Persecuciones", "Cometa neón", "comet", "#ff00ff", "#00121a", 1.6, 1],
  ["Persecuciones", "Escáner (coche fantástico)", "scanner", "#ff0000", "#000000", 1, 1],
  ["Persecuciones", "Escáner azul", "scanner", "#0066ff", "#000000", 1.4, 1.5],
  ["Persecuciones", "Teatro (marquesina)", "theater", "#ffcc00", "#000000", 1, 1],
  ["Persecuciones", "Marquesina de colores", "theater", "#ff00aa", "#00e5ff", 1.5, 1],
  ["Persecuciones", "Encuentro al centro", "converge", "#00ff88", "#000000", 1, 1],
  ["Persecuciones", "Barrido", "wipe", "#00e5ff", "#ff00aa", 1, 1],
  ["Persecuciones", "Desde el centro", "center", "#ffffff", "#000000", 1, 1],
  ["Persecuciones", "Lluvia de meteoros", "meteor", "#c0e0ff", "#000000", 1, 1],
  ["Persecuciones", "Ola", "wave", "#00e5ff", "#001020", 1, 1],
  ["Persecuciones", "Ondas suaves", "sine", "#8a2be2", "#000000", 1, 1],
  // Arcoíris y color
  ["Arcoíris", "Arcoíris", "rainbow", "#ffffff", "#000000", 1, 1],
  ["Arcoíris", "Arcoíris lento", "rainbow", "#ffffff", "#000000", 0.3, 0.5],
  ["Arcoíris", "Arcoíris rápido", "rainbow", "#ffffff", "#000000", 3, 2],
  ["Arcoíris", "Todo el arcoíris a la vez", "rainbowAll", "#ffffff", "#000000", 1, 1],
  ["Arcoíris", "Arcoíris en marquesina", "rainbowChase", "#ffffff", "#000000", 1, 1],
  ["Arcoíris", "Colores que flotan", "noiseColor", "#ffffff", "#000000", 1, 1],
  ["Arcoíris", "Atardecer", "gradient", "#ff4500", "#8a2be2", 0.5, 0.7],
  ["Arcoíris", "Hielo", "gradient", "#ffffff", "#00aaff", 0.6, 1],
  ["Arcoíris", "Neón rosa y azul", "gradient", "#ff00aa", "#0040ff", 1.5, 2],
  // Estrobo y flash
  ["Estrobo", "Estrobo blanco", "strobe", "#ffffff", "#000000", 1, 1],
  ["Estrobo", "Estrobo lento", "strobe", "#ffffff", "#000000", 0.4, 1],
  ["Estrobo", "Estrobo de dos colores", "strobeAlt", "#ff0000", "#0000ff", 1, 1],
  ["Estrobo", "Destellos al azar", "strobeRandom", "#ffffff", "#000000", 1, 1],
  ["Estrobo", "Estrobo al tempo", "beatStrobe", "#ffffff", "#000000", 1, 1],
  ["Estrobo", "Chispas", "sparkle", "#ffffff", "#0010ff", 1, 1],
  ["Estrobo", "Chispas doradas", "sparkle", "#ffd700", "#200800", 1, 1.5],
  // Fiesta
  ["Fiesta", "Disco", "disco", "#ffffff", "#000000", 1, 1],
  ["Fiesta", "Confeti", "confetti", "#ffffff", "#000000", 1, 1],
  ["Fiesta", "Mezcla de fiesta (cambia con el tempo)", "partyMix", "#ff00aa", "#00e5ff", 1, 1],
  ["Fiesta", "Centelleo", "twinkle", "#ffffff", "#001030", 1, 1],
  ["Fiesta", "Centelleo de colores", "twinkle", "#ff00ff", "#00ffcc", 1.4, 1],
  ["Fiesta", "Estrellas", "twinkle", "#ffffff", "#000000", 0.5, 1],
  // Naturaleza
  ["Naturaleza", "Fuego", "fire", "#ff5a00", "#000000", 1, 1],
  ["Naturaleza", "Fuego intenso", "fire", "#ff5a00", "#000000", 1.8, 1.5],
  ["Naturaleza", "Vela", "candle", "#ff8a2a", "#000000", 1, 1],
  ["Naturaleza", "Lava", "lava", "#ff3000", "#200000", 1, 1],
  ["Naturaleza", "Océano", "ocean", "#00e5ff", "#001a66", 1, 1],
  ["Naturaleza", "Aurora boreal", "aurora", "#00ff88", "#8a2be2", 1, 1],
  ["Naturaleza", "Bosque", "forest", "#3cff00", "#003300", 1, 1],
  ["Naturaleza", "Tormenta", "storm", "#ffffff", "#0a0a30", 1, 1],
  ["Naturaleza", "Rayos", "lightning", "#e0e8ff", "#000000", 1, 1],
  ["Naturaleza", "Amanecer", "sunrise", "#ffffff", "#000000", 1, 1],
  // Alertas y fechas especiales
  ["Especiales", "Policía", "police", "#ff0000", "#0000ff", 1, 1],
  ["Especiales", "Ambulancia", "ambulance", "#ff0000", "#ffffff", 1, 1],
  ["Especiales", "Aviso naranja", "warning", "#ff8c00", "#000000", 1, 1],
  ["Especiales", "Navidad", "christmas", "#ff0000", "#00c800", 1, 1],
  ["Especiales", "Halloween", "halloween", "#ff6a00", "#7800c8", 1, 1],
  // Matriz 2D
  ["Matriz LED", "Plasma", "plasma", "#ffffff", "#000000", 1, 1],
  ["Matriz LED", "Ondas en el agua", "ripple", "#00e5ff", "#000020", 1, 1],
  ["Matriz LED", "Damero", "checker", "#ffffff", "#000000", 1, 1],
  ["Matriz LED", "Espiral", "spiral", "#ffffff", "#000000", 1, 1],
  ["Matriz LED", "Lluvia digital", "rain", "#00ff40", "#000000", 1, 1],
  ["Matriz LED", "Barras", "bars", "#ff00aa", "#000000", 1, 1],
  ["Matriz LED", "Radar", "radar", "#00ff60", "#000000", 1, 1],
  // Música
  ["Música ♪", "Vúmetro", "vu", "#00ff40", "#000000", 1, 1, { music: true }],
  ["Música ♪", "Vúmetro desde el centro", "vuCenter", "#00ff40", "#000000", 1, 1, { music: true }],
  ["Música ♪", "Destello en cada golpe", "beatFlash", "#ffffff", "#000010", 1, 1, { music: true }],
  ["Música ♪", "Pulso de graves", "bassPulse", "#ff0040", "#000000", 1, 1, { music: true }],
  ["Música ♪", "Espectro (graves · medios · agudos)", "spectrum", "#ffffff", "#000000", 1, 1, { music: true }],
  ["Música ♪", "Arcoíris que baila", "audioRainbow", "#ffffff", "#000000", 1, 1, { music: true }],
  ["Música ♪", "Salto de color al golpe", "beatColor", "#ffffff", "#000000", 1, 1],
  ["Música ♪", "Persecución al tempo", "beatChase", "#00e5ff", "#000000", 1, 1],
];

export const LIGHT_FX = C.map(([cat, name, algo, c1, c2, speed, size, extra], i) => ({
  id: "lfx" + i + "_" + algo, cat, name, algo, color: c1, color2: c2, speed, size, music: !!extra?.music,
}));
export const LIGHT_FX_CATEGORIES = [...new Set(LIGHT_FX.map(f => f.cat))];
export function findFx(idOrName) {
  const s = String(idOrName || "").toLowerCase();
  return LIGHT_FX.find(f => f.id === idOrName) || LIGHT_FX.find(f => f.name.toLowerCase() === s) || null;
}

/** Ajustes de efecto por defecto de una luz (pixel map o foco). */
export function defaultLightFx(id = LIGHT_FX.find(f => f.algo === "rainbow").id) {
  const f = findFx(id) || LIGHT_FX[0];
  return { id: f.id, color: f.color, color2: f.color2, speed: f.speed, size: f.size, music: f.music };
}

/**
 * Prepara un efecto para un fotograma. Devuelve run(i, n, x, y, out).
 * fx: { id, color, color2, speed, size, music } · levels: { bass, mid, high, level, beat }.
 */
export function prepareFx(fx, timeSec, levels = {}, bpm = 120) {
  const def = findFx(fx?.id) || LIGHT_FX[0];
  const algo = ALGOS[def.algo] || ALGOS.solid;
  const speed = fx?.speed ?? def.speed;
  const L = { bass: levels.bass || 0, mid: levels.mid || 0, high: levels.high || 0, level: levels.level || 0, beat: levels.beat || 0 };
  const c = {
    t: timeSec * speed, ph: timeSec * (bpm || 120) / 60 * speed, sz: Math.max(0.1, fx?.size ?? def.size),
    c1: hexRgb(fx?.color ?? def.color), c2: hexRgb(fx?.color2 ?? def.color2), L,
  };
  // «Al ritmo de la música» en cualquier efecto: el brillo sigue a los graves y al golpe.
  const react = fx?.music && !def.music ? 0.2 + 0.8 * clamp01(Math.max(L.bass * 1.2, L.beat)) : 1;
  const p = { i: 0, n: 1, u: 0, x: 0, y: 0 };
  return (i, n, x, y, out) => {
    p.i = i; p.n = n; p.u = n > 1 ? i / (n - 1) : 0; p.x = x; p.y = y;
    algo(p, c, out);
    out[0] = Math.max(0, Math.min(255, out[0] * react)); out[1] = Math.max(0, Math.min(255, out[1] * react)); out[2] = Math.max(0, Math.min(255, out[2] * react));
    return out;
  };
}

/* ---------------- Movimiento de cabezas móviles (pan / tilt) ---------------- */
export const MOVES = [
  ["none", "Quieta (manual)"], ["circle", "Círculo"], ["eight", "Ocho"], ["sweep", "Barrido izquierda ↔ derecha"],
  ["nod", "Arriba ↔ abajo"], ["fan", "Abanico (cada foco a un lado)"], ["random", "Al azar"], ["beat", "Salto al tempo"],
];
/** Devuelve run(index, count) → [pan 0..1, tilt 0..1]. */
export function prepareMove(mv, timeSec, bpm = 120) {
  const kind = mv?.kind || "none", sz = clamp01(mv?.size ?? 0.5), t = timeSec * (mv?.speed ?? 1);
  return (k, n) => {
    const off = n > 1 ? k / n : 0;
    switch (kind) {
      case "circle": return [0.5 + 0.5 * sz * Math.cos((t * 0.3 + off) * TAU), 0.5 + 0.5 * sz * Math.sin((t * 0.3 + off) * TAU)];
      case "eight": return [0.5 + 0.5 * sz * Math.sin((t * 0.25 + off) * TAU), 0.5 + 0.5 * sz * Math.sin((t * 0.5 + off * 2) * TAU)];
      case "sweep": return [0.5 + 0.5 * sz * Math.sin((t * 0.25 + off * 0.5) * TAU), 0.5];
      case "nod": return [0.5, 0.5 + 0.5 * sz * Math.sin((t * 0.3 + off * 0.5) * TAU)];
      case "fan": { const side = n > 1 ? k / (n - 1) * 2 - 1 : 0; return [0.5 + 0.5 * sz * side * (0.5 + 0.5 * Math.sin(t * 0.5 * TAU)), 0.5]; }
      case "random": return [0.5 + 0.5 * sz * (noise(t * 0.4, 61 + k) * 2 - 1), 0.5 + 0.5 * sz * (noise(t * 0.4, 91 + k) * 2 - 1)];
      case "beat": { const s = Math.floor(timeSec * bpm / 60); return [0.5 + 0.5 * sz * (hash(s, k) * 2 - 1), 0.5 + 0.5 * sz * (hash(s, k + 50) * 2 - 1)]; }
    }
    return null;
  };
}
