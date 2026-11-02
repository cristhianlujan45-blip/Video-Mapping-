// web/js/ai/songanalysis.js
// Analiza una canción (las muestras de audio ya decodificadas) para que la IA
// monte el show sola: tempo (BPM) y fase, curva de energía y partes de la
// canción (INTRO, BUILD, DROP, BREAK, CLIMAX, OUTRO) alineadas a compases.
// Todo en el equipo, sin internet, y rápido (una canción de 4 min en ~1 s).
import { estimateTempo } from "../audio.js";

/**
 * samples: Float32Array (mono), sr: frecuencia de muestreo.
 * Devuelve { duration, bpm, beatRef, barSec, energy: [0..1 por compás], sections: [{ name, start, seconds, energy }] }.
 */
export function analyzeSong(samples, sr) {
  const duration = samples.length / sr;
  // 1) Envolventes a ~100 Hz: energía total y de graves (filtro paso bajo de 1 polo, ~150 Hz).
  const hop = Math.max(1, Math.round(sr / 100)), n = Math.floor(samples.length / hop);
  const env = new Float32Array(n), low = new Float32Array(n);
  const a = Math.exp(-2 * Math.PI * 150 / sr);
  let lp = 0;
  for (let i = 0, k = 0; k < n; k++) {
    let e = 0, l = 0;
    for (let j = 0; j < hop; j++, i++) { const x = samples[i] || 0; lp = a * lp + (1 - a) * x; e += x * x; l += lp * lp; }
    env[k] = Math.sqrt(e / hop); low[k] = Math.sqrt(l / hop);
  }
  // 2) Golpes: subidas bruscas de graves frente a su media reciente.
  const onsets = [], weights = [];
  let avg = 0, prev = 0, last = -1e9;
  for (let k = 0; k < n; k++) {
    const flux = Math.max(0, low[k] - prev); prev = low[k];
    avg = avg * 0.97 + flux * 0.03;
    const t = k * 10;   // ms
    if (flux > Math.max(1e-5, avg * 2.4) && t - last > 230) { onsets.push(t); weights.push(Math.min(4, flux / Math.max(1e-6, avg))); last = t; }
  }
  // Tempo con ventanas de 12 s (la estimación es más estable por tramos) → mediana.
  const ests = [];
  for (let w0 = 0; w0 < duration * 1000; w0 += 6000) {
    const idx = onsets.map((t, i) => [t, i]).filter(([t]) => t >= w0 && t < w0 + 12000).map(([, i]) => i);
    const e = estimateTempo(idx.map(i => onsets[i]), idx.map(i => weights[i]));
    if (e) ests.push(e);
  }
  ests.sort((x, y) => x.bpm - y.bpm);
  const tempo = ests.length ? ests[ests.length >> 1] : { bpm: 120, ref: 0 };
  const bpm = Math.round(tempo.bpm * 10) / 10, barSec = 4 * 60 / bpm;
  // 3) Energía por compás (normalizada 0..1, sin el 5 % más alto para que un pico no lo aplaste todo).
  const bars = Math.max(1, Math.round(duration / barSec));
  const energy = [];
  for (let b = 0; b < bars; b++) {
    const k0 = Math.floor(b * barSec * 100), k1 = Math.min(n, Math.floor((b + 1) * barSec * 100));
    let s = 0; for (let k = k0; k < k1; k++) s += env[k];
    energy.push(k1 > k0 ? s / (k1 - k0) : 0);
  }
  const sorted = [...energy].sort((x, y) => x - y), lo = sorted[Math.floor(sorted.length * 0.05)] || 0, hi = sorted[Math.floor(sorted.length * 0.95)] || 1e-6;
  const norm = energy.map(v => Math.max(0, Math.min(1, (v - lo) / Math.max(1e-6, hi - lo))));
  // Suavizado (media de 4 compases) y nivel: 0 bajo, 1 medio, 2 alto.
  const smooth = norm.map((_, i) => { let s = 0, c = 0; for (let j = Math.max(0, i - 1); j <= Math.min(norm.length - 1, i + 1); j++) { s += norm[j]; c++; } return s / c; });
  const level = smooth.map(v => v < 0.25 ? 0 : v < 0.62 ? 1 : 2);
  // 4) Tramos del mismo nivel; los de menos de 8 compases se unen al vecino más parecido.
  let runs = [];
  for (let i = 0; i < level.length; i++) {
    const r = runs[runs.length - 1];
    if (r && r.level === level[i]) r.end = i + 1; else runs.push({ level: level[i], start: i, end: i + 1 });
  }
  const minBars = Math.min(8, Math.max(2, Math.floor(bars / 20)));
  let changed = true;
  while (changed && runs.length > 1) {
    changed = false;
    const i = runs.findIndex(r => r.end - r.start < minBars);
    if (i < 0) break;
    const r = runs[i], L = runs[i - 1], R = runs[i + 1];
    const into = !L ? R : !R ? L : (Math.abs(L.level - r.level) <= Math.abs(R.level - r.level) ? L : R);
    into.start = Math.min(into.start, r.start); into.end = Math.max(into.end, r.end);
    runs.splice(i, 1);
    // Une vecinos iguales.
    runs = runs.reduce((acc, x) => { const p = acc[acc.length - 1]; if (p && p.level === x.level) p.end = x.end; else acc.push({ ...x }); return acc; }, []);
    changed = true;
  }
  // 5) Nombres: la energía decide (y el orden en la canción).
  const highs = runs.filter(r => r.level === 2);
  const loudest = highs.reduce((m, r) => (!m || mean(smooth, r) > mean(smooth, m) ? r : m), null);
  const sections = runs.map((r, i) => {
    let name;
    if (i === 0 && r.level < 2) name = "INTRO";
    else if (i === runs.length - 1 && r.level < 2 && runs.length > 1) name = "OUTRO";
    else if (r.level === 2) name = r === loudest && highs.length > 1 ? "CLIMAX" : "DROP";
    else if (r.level === 1) name = runs[i + 1]?.level === 2 ? "BUILD" : "BREAK";
    else name = "BREAK";
    const start = r.start * barSec, end = Math.min(duration, r.end * barSec);
    return { name, start: round1(start), seconds: Math.max(1, Math.round(end - start)), energy: round2(mean(smooth, r)), bars: r.end - r.start };
  });
  return { duration: round1(duration), bpm, beatRef: (tempo.ref || 0) / 1000, barSec: round2(barSec), energy: smooth.map(round2), sections };
}
const mean = (arr, r) => { let s = 0; for (let i = r.start; i < r.end; i++) s += arr[i]; return s / Math.max(1, r.end - r.start); };
const round1 = (v) => Math.round(v * 10) / 10, round2 = (v) => Math.round(v * 100) / 100;

/** Decodifica un archivo de audio (mp3, wav, ogg, m4a…) y lo analiza. */
export async function analyzeFile(file) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  try {
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    // Mono: media de los canales.
    const ch = buf.numberOfChannels, len = buf.length, mono = new Float32Array(len);
    for (let c = 0; c < ch; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) mono[i] += d[i] / ch; }
    return analyzeSong(mono, buf.sampleRate);
  } finally { ctx.close().catch(() => {}); }
}
