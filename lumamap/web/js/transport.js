// web/js/transport.js
// Transporte de un video (como en Resolume): bucle, una vez, reversa y ping-pong, puntos de
// entrada y salida, y «al tempo» (el tramo dura N golpes y la velocidad sigue al BPM).
// Hacia delante reproduce el navegador; hacia atrás se avanza a mano buscando fotogramas
// (los navegadores no reproducen al revés).

export const PLAY_MODES = [["loop", "🔁 Bucle"], ["once", "1️⃣ Una vez"], ["reverse", "⏪ Reversa"], ["pingpong", "🔀 Ida y vuelta"]];
export const SYNC_BEATS = [[0, "Libre"], [1, "1"], [2, "2"], [4, "4"], [8, "8"], [16, "16"], [32, "32"], [64, "64"]];
const MODES = new Set(PLAY_MODES.map(m => m[0]));

export const DEFAULT_PLAY = () => ({ mode: "loop", in: 0, out: 1, beats: 0 });
export function normalizePlay(p) {
  const d = DEFAULT_PLAY(), n = (v, def) => Number.isFinite(+v) ? Math.max(0, Math.min(1, +v)) : def;
  if (!p || typeof p !== "object") return d;
  const a = n(p.in, 0), b = n(p.out, 1);
  return { mode: MODES.has(p.mode) ? p.mode : "loop", in: Math.min(a, b), out: Math.max(a, b), beats: [0, 1, 2, 4, 8, 16, 32, 64].includes(+p.beats) ? +p.beats : 0 };
}
/** ¿Hace falta el transporte (o basta el bucle normal del video)? */
export const isPlain = (p) => !p || (p.mode === "loop" && p.in <= 0 && p.out >= 1 && !p.beats);

/**
 * Un paso. st = { dir } (estado del video, se modifica), t = posición actual (s), dur = duración (s).
 * Devuelve { native: reproducir con el navegador, rate, seek: segundos o null, pause: true si para }.
 */
export function stepTransport(st, play, t, dur, dt, rate = 1, bpm = 120) {
  const p = play || DEFAULT_PLAY();
  if (!(dur > 0)) return { native: true, rate, seek: null };
  const a = p.in * dur, b = Math.max(a + Math.min(0.05, dur), p.out * dur);
  const len = b - a;
  // Al tempo: el tramo dura «beats» golpes (la velocidad se adapta; con límites razonables).
  const speed = Math.max(0.0625, Math.min(16, p.beats ? len / (p.beats * 60 / Math.max(20, bpm)) : rate));
  if (st.dir === undefined) st.dir = p.mode === "reverse" ? -1 : 1;
  if (p.mode === "reverse") st.dir = -1;
  else if (p.mode !== "pingpong") st.dir = 1;
  if (t < a - 0.05 || t > b + 0.05) return { native: st.dir > 0, rate: speed, seek: st.dir > 0 ? a : b };
  if (st.dir > 0) {
    if (t >= b - 0.01) {
      if (p.mode === "once") return { native: false, rate: speed, seek: null, pause: true };
      if (p.mode === "pingpong") { st.dir = -1; return { native: false, rate: speed, seek: b }; }
      return { native: true, rate: speed, seek: a };
    }
    return { native: true, rate: speed, seek: null };
  }
  // Hacia atrás, a mano.
  let nt = t - speed * dt;
  if (nt <= a) {
    if (p.mode === "pingpong") { st.dir = 1; return { native: true, rate: speed, seek: a }; }
    nt = b;
  }
  return { native: false, rate: speed, seek: nt };
}
