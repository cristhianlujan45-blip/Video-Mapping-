// web/js/td/anim.js
// Fotogramas clave (como el Animation COMP de TouchDesigner o las claves de After Effects):
//   anim  = { length: segundos, chans: [canal…] }
//   canal = { name, keys: [{ t, v, e }…] }   (e = cómo va de esta clave a la siguiente)
// Funciones puras: calcular el valor de un canal en un instante, poner/quitar claves y el tiempo
// con vueltas. El Animation CHOP (ops.js) y el editor de curvas las usan.

export const EASES = [["smooth", "Suave (frena en cada clave)"], ["spline", "Curva continua"], ["linear", "Recta"], ["step", "Escalón"], ["in", "Acelerar"], ["out", "Frenar"]];
const EASE_SET = new Set(EASES.map(e => e[0]));

export const newAnim = (length = 4) => ({ length, chans: [] });
/** Arregla una animación guardada (o de otra versión). */
export function normalizeAnim(a) {
  const A = a && typeof a === "object" ? a : {};
  const out = { length: Math.max(0.05, Math.min(3600, +A.length || 4)), chans: [] };
  for (const c of Array.isArray(A.chans) ? A.chans : []) {
    if (!c || typeof c !== "object") continue;
    const name = String(c.name || "").replace(/[^A-Za-z0-9_]/g, "_") || "chan" + (out.chans.length + 1);
    const keys = (Array.isArray(c.keys) ? c.keys : []).filter(k => k && Number.isFinite(+k.t) && Number.isFinite(+k.v)).map(k => ({ t: +k.t, v: +k.v, e: EASE_SET.has(k.e) ? k.e : "smooth" }));
    keys.sort((x, y) => x.t - y.t);
    out.chans.push({ name, keys });
  }
  return out;
}
/** Tiempo dentro de la animación: con vueltas (loop) o parado en los extremos. */
export function animTime(anim, T, loop = true) {
  const L = Math.max(0.01, +anim?.length || 4);
  if (!Number.isFinite(T)) return 0;
  return loop ? ((T % L) + L) % L : Math.max(0, Math.min(L, T));
}
/** Valor de un canal en el instante t. */
export function evalChan(ch, t) {
  const K = ch?.keys;
  if (!K || !K.length) return 0;
  if (t <= K[0].t) return K[0].v;
  const n = K.length;
  if (t >= K[n - 1].t) return K[n - 1].v;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (K[m].t <= t) lo = m; else hi = m; }
  const a = K[lo], b = K[lo + 1], span = b.t - a.t;
  const u = span > 0 ? (t - a.t) / span : 1;
  switch (a.e) {
    case "step": return a.v;
    case "linear": return a.v + (b.v - a.v) * u;
    case "in": return a.v + (b.v - a.v) * u * u;
    case "out": return a.v + (b.v - a.v) * (1 - (1 - u) * (1 - u));
    case "spline": {
      // Catmull-Rom con los vecinos (pasa por todas las claves sin frenar).
      const p0 = (K[lo - 1] || a).v, p3 = (K[lo + 2] || b).v, p1 = a.v, p2 = b.v, u2 = u * u, u3 = u2 * u;
      return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
    }
    default: { const s = u * u * (3 - 2 * u); return a.v + (b.v - a.v) * s; }
  }
}
/** Pone una clave (si ya hay una en ese instante, cambia su valor). Devuelve la clave. */
export function setKey(ch, t, v, e = null) {
  t = Math.round(Math.max(0, t) * 1000) / 1000;
  ch.keys ||= [];
  let k = ch.keys.find(x => Math.abs(x.t - t) < 1e-3);
  if (k) { k.v = v; if (e) k.e = e; return k; }
  // La forma de la nueva: la de la clave anterior (o suave).
  const prev = [...ch.keys].reverse().find(x => x.t < t);
  k = { t, v, e: e || prev?.e || "smooth" };
  ch.keys.push(k);
  ch.keys.sort((x, y) => x.t - y.t);
  return k;
}
export function removeKey(ch, key) { ch.keys = (ch.keys || []).filter(k => k !== key); }
/** Mínimo y máximo de los valores de unos canales (para encuadrar las curvas). */
export function valueRange(chans) {
  let lo = Infinity, hi = -Infinity;
  for (const c of chans) for (const k of c.keys || []) { lo = Math.min(lo, k.v); hi = Math.max(hi, k.v); }
  if (!Number.isFinite(lo)) return [0, 1];
  if (hi - lo < 1e-6) { lo -= 0.5; hi += 0.5; }
  const pad = (hi - lo) * 0.12;
  return [lo - pad, hi + pad];
}
/** Un canal con nombre libre (chan1, chan2…). */
export function uniqueChan(anim, base = "chan") {
  base = String(base || "chan").replace(/[^A-Za-z0-9_]/g, "_");
  if (!anim.chans.some(c => c.name === base)) return base;
  let n = 2;
  while (anim.chans.some(c => c.name === base + n)) n++;
  return base + n;
}
