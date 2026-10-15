// web/js/exportshow.js
// «Exportar el show a video»: piezas sin interfaz del render fotograma a fotograma.
//   · layoutShow / planShow: qué escena se ve en cada segundo (por duraciones, o por la canción).
//   · frameAt: escena, transición y tiempo dentro de la escena para un instante exacto.
//   · videoTimeAt: posición de un video en ese instante (bucle, una vez, reversa, ida y vuelta, al tempo).
//   · OfflineAnalyser: lo mismo que el analizador de Web Audio, pero sobre la canción ya decodificada,
//     para que lo que reacciona al sonido reaccione igual en el video exportado.
//   · pickVideoCodec / pickAudioCodec: H.264 + AAC si el equipo los codifica; si no, VP9 + Opus.
// El render no va en tiempo real: cada fotograma tarda lo que necesite (4K sin saltos).
import { DEFAULT_PLAY, isPlain } from "./transport.js";

export const MANUAL = 8;          // lo que ocupa una escena «manual» (sin duración) en el show

/** Inicio y largo de cada escena en la línea de tiempo (segundos). */
export function layoutShow(scenes) {
  let t = 0;
  const out = scenes.map((sc) => {
    const len = sc.duration > 0 ? sc.duration : MANUAL;
    const b = { id: sc.id, start: t, len, manual: !(sc.duration > 0) };
    t += len;
    return b;
  });
  return { blocks: out, total: t };
}

/**
 * Plan del show a exportar. Con un show de canción (cada escena entra en un segundo de la
 * canción) manda la canción; si no, las duraciones de la línea de tiempo.
 */
export function planShow(project, { songShow = null, songDuration = 0 } = {}) {
  if (songShow && songShow.ids?.length && songDuration > 0) {
    const blocks = songShow.ids.map((id, i) => {
      const start = Math.max(0, songShow.starts[i] || 0), end = i + 1 < songShow.ids.length ? songShow.starts[i + 1] : songDuration;
      return { id, start, len: Math.max(0.04, end - start), manual: false };
    }).filter(b => project.scenes.some(s => s.id === b.id) && b.start < songDuration);
    return { blocks, total: songDuration, bySong: true };
  }
  return { ...layoutShow(project.scenes), bySong: false };
}

/**
 * Estado en el instante t (s): escena, inicio de su bloque y transición (en ms, con «now» = t·1000,
 * como lo espera sceneLayers). La transición de una escena ocupa sus primeros trMs.
 */
export function frameAt(plan, project, t) {
  const { blocks } = plan;
  let i = 0;
  while (i + 1 < blocks.length && blocks[i + 1].start <= t + 1e-9) i++;
  const b = blocks[i], sc = project.scenes.find(s => s.id === b.id);
  let tr = null;
  if (i > 0 && sc) {
    const mode = sc.transition || "fade";
    const dur = mode === "cut" ? 0 : (sc.trMs ?? project.settings.transitionMs);
    if (dur > 0 && (t - b.start) * 1000 < dur) tr = { fromId: blocks[i - 1].id, start: b.start * 1000, dur, mode };
  }
  return { index: i, sceneId: b.id, sceneStart: b.start, elapsed: Math.max(0, t - b.start), tr, prevStart: i > 0 ? blocks[i - 1].start : 0 };
}

/** Posición de un video (s) tras «elapsed» segundos desde que empezó su escena. */
export function videoTimeAt(play, dur, elapsed, rate = 1, bpm = 120) {
  if (!(dur > 0)) return 0;
  const e = Math.max(0, elapsed);
  if (isPlain(play)) return ((e * (rate || 1)) % dur + dur) % dur;
  const p = play || DEFAULT_PLAY();
  const a = p.in * dur, b = Math.max(a + Math.min(0.05, dur), p.out * dur), len = b - a;
  const speed = Math.max(0.0625, Math.min(16, p.beats ? len / (p.beats * 60 / Math.max(20, bpm)) : (rate || 1)));
  const x = e * speed;
  const end = Math.max(a, b - 1 / 120);
  if (p.mode === "once") return Math.min(end, a + x);
  if (p.mode === "reverse") return Math.min(end, b - (x % len));
  if (p.mode === "pingpong") { const m = x % (2 * len); return Math.min(end, m < len ? a + m : b - (m - len)); }
  return a + (x % len);
}

/* ---------------- Sonido sin tiempo real ---------------- */
// FFT radix-2 (in situ).
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k], ai = im[i + k], br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ar + br; im[i + k] = ai + bi; re[i + k + len / 2] = ar - br; im[i + k + len / 2] = ai - bi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

/**
 * Hace de AnalyserNode (mismas cuentas que la especificación de Web Audio: ventana de Blackman,
 * suavizado, escala en dB) sobre muestras ya decodificadas. setTime(seg) antes de leer.
 */
export class OfflineAnalyser {
  constructor(channels, sampleRate, { fftSize = 1024, smoothingTimeConstant = 0.35, minDecibels = -100, maxDecibels = -30 } = {}) {
    Object.assign(this, { channels, sampleRate, fftSize, smoothingTimeConstant, minDecibels, maxDecibels });
    this.frequencyBinCount = fftSize / 2;
    this.smooth = new Float32Array(fftSize / 2);
    this.buf = new Float32Array(fftSize);
    this.re = new Float64Array(fftSize); this.im = new Float64Array(fftSize);
    this.win = Float64Array.from({ length: fftSize }, (_, i) => 0.42 - 0.5 * Math.cos(2 * Math.PI * i / fftSize) + 0.08 * Math.cos(4 * Math.PI * i / fftSize));
    this.end = 0;
  }
  /** Las últimas fftSize muestras antes del instante t (mezcla de los canales). */
  setTime(t) {
    const n = this.fftSize, end = Math.round(t * this.sampleRate), ch = this.channels, len = ch[0]?.length || 0;
    this.end = end;
    for (let i = 0; i < n; i++) {
      const k = end - n + i;
      let s = 0;
      if (k >= 0 && k < len) { for (const c of ch) s += c[k]; s /= ch.length; }
      this.buf[i] = s;
    }
  }
  getByteFrequencyData(out) {
    const n = this.fftSize, re = this.re, im = this.im, tau = this.smoothingTimeConstant;
    for (let i = 0; i < n; i++) { re[i] = this.buf[i] * this.win[i]; im[i] = 0; }
    fft(re, im);
    const k = 255 / (this.maxDecibels - this.minDecibels);
    for (let i = 0; i < out.length && i < n / 2; i++) {
      const mag = Math.hypot(re[i], im[i]) / n;
      this.smooth[i] = tau * this.smooth[i] + (1 - tau) * mag;
      const db = this.smooth[i] > 0 ? 20 * Math.log10(this.smooth[i]) : -Infinity;
      out[i] = Math.max(0, Math.min(255, Math.floor(k * (db - this.minDecibels))));
    }
  }
  getByteTimeDomainData(out) {
    for (let i = 0; i < out.length && i < this.fftSize; i++) out[i] = Math.max(0, Math.min(255, Math.floor(128 * (1 + this.buf[i]))));
  }
}

/* ---------------- Códecs ---------------- */
/** Bits por segundo según tamaño y fps (calidad «Alta»; «Máxima» ×1.6). */
export function bitrateFor(width, height, fps, quality = "high") {
  const px = width * height, base = px >= 3840 * 2160 * 0.9 ? 45e6 : px >= 2560 * 1440 * 0.9 ? 24e6 : px >= 1920 * 1080 * 0.9 ? 14e6 : px >= 1280 * 720 * 0.9 ? 8e6 : 5e6;
  return Math.round(base * (fps > 30 ? 1.6 : 1) * (quality === "max" ? 1.6 : 1));
}
/** Primer códec de video que el equipo sabe codificar a ese tamaño: H.264 (MP4 universal) o VP9. */
export async function pickVideoCodec(width, height, fps, bitrate) {
  if (typeof VideoEncoder === "undefined") return null;
  const big = width * height > 1920 * 1088;
  const tries = [
    { kind: "avc", codec: big ? "avc1.640033" : "avc1.64002A", avc: { format: "avc" } },
    { kind: "avc", codec: big ? "avc1.4D0033" : "avc1.4D002A", avc: { format: "avc" } },
    { kind: "vp9", codec: big ? "vp09.00.51.08" : "vp09.00.41.08" },
  ];
  for (const t of tries) for (const hw of ["prefer-hardware", "no-preference"]) {
    const config = { codec: t.codec, width, height, bitrate, framerate: fps, hardwareAcceleration: hw, latencyMode: "quality", ...(t.avc ? { avc: t.avc } : {}) };
    try { const s = await VideoEncoder.isConfigSupported(config); if (s.supported) return { kind: t.kind, config: { ...config, ...(s.config || {}), avc: t.avc } }; } catch {}
  }
  return null;
}
export async function pickAudioCodec(sampleRate = 48000, channels = 2) {
  if (typeof AudioEncoder === "undefined") return null;
  for (const [kind, codec] of [["aac", "mp4a.40.2"], ["opus", "opus"]]) {
    const config = { codec, sampleRate, numberOfChannels: channels, bitrate: 192000 };
    try { if ((await AudioEncoder.isConfigSupported(config)).supported) return { kind, config }; } catch {}
  }
  return null;
}
export const fmtDur = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return `${h ? h + ":" + String(m).padStart(2, "0") : m}:${String(s % 60).padStart(2, "0")}`; };
