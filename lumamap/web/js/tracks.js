// web/js/tracks.js
// PISTAS DE AUDIO (multipista): cada parte de la música mueve cosas distintas, como un visualizador
// de estudio con un «sender» en cada canal. Una pista puede venir de:
//   · un archivo (stem: bombo, bajo, voz… exportados de tu DAW): suenan todos juntos y en sincronía;
//   · la mezcla que ya escucha LumaMap (micrófono o tu canción), separada por partes del sonido
//     (bombo, bajo, caja, voz, platillos) con filtros de frecuencia;
//   · una entrada de audio (una tarjeta de sonido: cada canal, una pista; o un cable virtual
//     desde el DAW).
// Cada pista tiene su ENVOLVENTE ADSR (ataque, caída, sostén, liberación) y un umbral: convierte
// su sonido en una señal de 0 a 1 que mueve cualquier control (Señales, «〰 Animar al ritmo»), los
// nodos («Pistas de audio» CHOP) o los efectos. Se guarda en project.settings.tracks.
// Lo de arriba (Adsr, bandEnergy, normalizeTracks) no usa el navegador: se prueba en Node.

/** Partes del sonido (Hz). Aproximadas: con stems de verdad, cada pista es exacta. */
export const BANDS = {
  all: { label: "Todo el sonido", lo: 20, hi: 16000 },
  kick: { label: "🥁 Bombo", lo: 40, hi: 110, punch: true },
  bass: { label: "🎸 Bajo", lo: 60, hi: 250 },
  snare: { label: "🪘 Caja / palmas", lo: 1500, hi: 4500, punch: true },
  voice: { label: "🎤 Voz / melodía", lo: 300, hi: 3000 },
  hats: { label: "✨ Platillos", lo: 7000, hi: 16000, punch: true },
};
export const TRACK_COLORS = ["#ff4d6d", "#ffd166", "#4dd2ff", "#a78bfa", "#34d399", "#fb923c", "#f472b6", "#60a5fa"];
export const MAX_TRACKS = 8;

let seq = 0;
const tid = () => "trk" + Date.now().toString(36) + (seq++).toString(36);
const num = (v, d, a, b) => Number.isFinite(+v) ? Math.max(a, Math.min(b, +v)) : d;
const clean = (s, d) => String(s ?? d).replace(/[<>]/g, "").slice(0, 40) || d;

/** Una pista nueva. kind: "master" (de la mezcla), "file" (stem) o "input" (entrada de audio). */
export function newTrack(kind = "master", o = {}) {
  const band = o.band || (kind === "master" ? "kick" : "all");
  return normalizeTrack({ id: tid(), name: o.name || (kind === "master" ? BANDS[band]?.label.replace(/^\S+\s/, "") : "Pista"), kind, band, ...o });
}
export function normalizeTrack(t, k = 0) {
  if (!t || typeof t !== "object") return null;
  const kind = ["master", "file", "input"].includes(t.kind) ? t.kind : "master";
  return {
    id: /^[\w-]{1,40}$/.test(String(t.id || "")) ? String(t.id) : tid(),
    name: clean(t.name, "Pista " + (k + 1)), color: /^#[0-9a-f]{6}$/i.test(t.color || "") ? t.color : TRACK_COLORS[k % TRACK_COLORS.length],
    kind, band: BANDS[t.band] ? t.band : (kind === "master" ? "kick" : "all"),
    media: typeof t.media === "string" ? t.media.slice(0, 80) : "", device: typeof t.device === "string" ? t.device.slice(0, 200) : "",
    channel: Math.round(num(t.channel, -1, -1, 31)),   // -1 = todos los canales juntos
    mode: t.mode === "follow" ? "follow" : "gate",       // gate = ADSR en cada golpe · follow = sigue el volumen
    threshold: num(t.threshold, 0.35, 0.01, 1), gain: num(t.gain, 1, 0.1, 8),
    attack: num(t.attack, 0.01, 0, 4), decay: num(t.decay, 0.25, 0, 4), sustain: num(t.sustain, 0.3, 0, 1), release: num(t.release, 0.35, 0, 8),
    vol: num(t.vol, 1, 0, 1.5), mute: !!t.mute, solo: !!t.solo, on: t.on !== false,
  };
}
export function normalizeTracks(s) {
  const list = Array.isArray(s?.list) ? s.list.map(normalizeTrack).filter(Boolean).slice(0, MAX_TRACKS) : [];
  const seen = new Set();
  return { list: list.filter(t => !seen.has(t.id) && seen.add(t.id)), loop: s?.loop !== false };
}
/** Nombre de canal para los nodos y las expresiones: «Bombo 1» → bombo_1. */
export const chanName = (name) => String(name || "pista").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "p$1") || "pista";

/**
 * Envolvente ADSR (como un sintetizador): con el modo «gate», cuando el sonido pasa el umbral
 * sube en «ataque» segundos a 1, baja en «caída» al nivel de «sostén» mientras siga sonando y,
 * cuando deja de sonar, se apaga en «liberación». Con «follow», sigue el volumen (ataque y
 * liberación suavizan la subida y la bajada). Siempre de 0 a 1.
 */
export class Adsr {
  constructor() { this.v = 0; this.stage = "idle"; this.t = 0; this.in = 0; this.on = false; this.from = 0; }
  step(input, dt, p) {
    input = Math.max(0, Math.min(1, +input || 0)); dt = Math.max(0, Math.min(0.25, +dt || 0));
    this.in = input;
    if (p.mode === "follow") {
      const tau = input > this.v ? p.attack : p.release;
      this.v = tau <= 0.001 ? input : this.v + (input - this.v) * (1 - Math.exp(-dt / (tau / 3)));
      return this.v;
    }
    const th = p.threshold, open = input >= th, held = input >= th * 0.75;   // histéresis: no parpadea en el umbral
    if (open && !this.on) { this.on = true; this.stage = "attack"; this.t = 0; this.from = this.v; }
    else if (this.on && !held) { this.on = false; this.stage = "release"; this.t = 0; this.from = this.v; }
    this.t += dt;
    switch (this.stage) {
      case "attack": {
        const k = p.attack <= 0.001 ? 1 : Math.min(1, this.t / p.attack);
        this.v = this.from + (1 - this.from) * k;
        if (k >= 1) { this.stage = "decay"; this.t = 0; }
        break;
      }
      case "decay": {
        const k = p.decay <= 0.001 ? 1 : Math.min(1, this.t / p.decay);
        this.v = 1 + (p.sustain - 1) * k;
        if (k >= 1) this.stage = "sustain";
        break;
      }
      case "sustain": this.v = p.sustain; break;
      case "release": {
        const k = p.release <= 0.001 ? 1 : Math.min(1, this.t / p.release);
        this.v = this.from * (1 - k);
        if (k >= 1) { this.stage = "idle"; this.v = 0; }
        break;
      }
      default: this.v = 0;
    }
    return this.v;
  }
}
/** La forma del ADSR para dibujarla: puntos [t, v] (t en segundos). */
export function adsrShape(p, hold = 0.4) {
  return [[0, 0], [p.attack, 1], [p.attack + p.decay, p.sustain], [p.attack + p.decay + hold, p.sustain], [p.attack + p.decay + hold + p.release, 0]];
}

/** Energía 0..1 de una banda (lo..hi Hz) en un espectro de bytes (AnalyserNode.getByteFrequencyData). */
export function bandEnergy(bins, sampleRate, lo, hi) {
  if (!bins?.length) return 0;
  const n = bins.length, hz = (sampleRate || 44100) / 2 / n;
  const a = Math.max(0, Math.floor(lo / hz)), b = Math.min(n - 1, Math.max(a, Math.ceil(hi / hz)));
  let s = 0, peak = 0;
  for (let k = a; k <= b; k++) { s += bins[k]; if (bins[k] > peak) peak = bins[k]; }
  // Media y pico juntos: una banda ancha con un solo golpe fuerte también cuenta.
  return Math.min(1, ((s / (b - a + 1)) * 0.6 + peak * 0.4) / 255);
}
/**
 * Detector de una parte del sonido: la energía de su banda, normalizada a su propio máximo
 * reciente (así el bombo llega a 1 aunque los platillos suenen bajito), y con «punch» solo los
 * golpes (lo que sube de repente sobre su media).
 */
export class BandFollower {
  constructor() { this.peak = 0.05; this.avg = 0; }
  step(e, dt, punch = false) {
    let x = e;
    if (punch) { this.avg += (e - this.avg) * Math.min(1, dt / 0.25); x = Math.max(0, e - this.avg); }   // solo lo que sube de repente
    this.peak = Math.max(x, this.peak * Math.exp(-dt / 4), punch ? 0.03 : 0.04);
    return Math.max(0, Math.min(1, x / this.peak));
  }
}

/* ======================================================================
   El motor (navegador): escucha cada pista y da su señal en cada fotograma
   ====================================================================== */
export class TrackEngine {
  /** app: getProject(), media(id) → Promise<Blob> (biblioteca), masterBins() → { bins, sampleRate } */
  constructor(env) {
    this.env = env;
    this.ctx = null; this.nodes = new Map();   // id → { sig, el, src, an, gain, stream, url, bins, adsr, band }
    this.values = {}; this.raw = {}; this.byName = {};
    this.playing = false; this.last = 0; this.err = {};
  }
  get list() { return this.env.project()?.settings?.tracks?.list || []; }
  ensureCtx() {
    if (!this.ctx) { const AC = globalThis.AudioContext || globalThis.webkitAudioContext; if (!AC) return null; this.ctx = new AC(); }
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
    return this.ctx;
  }
  /** Crea, cambia o suelta lo que escucha cada pista según la lista guardada. */
  sync() {
    const live = new Set();
    for (const t of this.list) {
      live.add(t.id);
      const sig = `${t.kind}|${t.media}|${t.device}|${t.channel}`;
      let x = this.nodes.get(t.id);
      if (x && x.sig !== sig) { this.release(t.id); x = null; }
      if (!x) {
        x = { sig, adsr: new Adsr(), band: new BandFollower(), bins: null };
        this.nodes.set(t.id, x);
        if (t.kind === "file" && t.media) this.openFile(t, x).catch(e => { this.err[t.id] = String(e.message || e); });
        else if (t.kind === "input") this.openInput(t, x).catch(e => { this.err[t.id] = String(e.message || e); });
      }
      if (x.gain) x.gain.gain.value = this.audible(t) ? t.vol : 0;
    }
    for (const id of [...this.nodes.keys()]) if (!live.has(id)) this.release(id);
  }
  audible(t) { const solo = this.list.some(x => x.solo); return !t.mute && (!solo || t.solo); }
  async openFile(t, x) {
    const blob = await this.env.media(t.media);
    if (!blob) throw new Error("falta el archivo en la biblioteca");
    const ctx = this.ensureCtx();
    if (!ctx || x !== this.nodes.get(t.id)) return;
    x.url = URL.createObjectURL(blob);
    const el = new Audio(); el.src = x.url; el.loop = this.env.project()?.settings?.tracks?.loop !== false; el.preload = "auto"; el.crossOrigin = "anonymous";
    x.el = el;
    x.src = ctx.createMediaElementSource(el);
    x.an = ctx.createAnalyser(); x.an.fftSize = 1024; x.an.smoothingTimeConstant = 0.3;
    x.gain = ctx.createGain(); x.gain.gain.value = this.audible(t) ? t.vol : 0;
    x.src.connect(x.an); x.src.connect(x.gain); x.gain.connect(ctx.destination);   // la señal es antes del volumen (como un «sender»)
    x.bins = new Uint8Array(x.an.frequencyBinCount);
    delete this.err[t.id];
    if (this.playing) { const m = this.masterEl(); try { el.currentTime = m && m !== el ? m.currentTime : 0; } catch {} el.play().catch(() => {}); }
  }
  async openInput(t, x) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("este equipo no deja usar entradas de audio");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: t.device ? { exact: t.device } : undefined, channelCount: { ideal: 8 }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const ctx = this.ensureCtx();
    if (!ctx || x !== this.nodes.get(t.id)) { stream.getTracks().forEach(s => s.stop()); return; }
    x.stream = stream;
    x.src = ctx.createMediaStreamSource(stream);
    x.an = ctx.createAnalyser(); x.an.fftSize = 1024; x.an.smoothingTimeConstant = 0.3;
    const chans = x.src.channelCount || 2;
    x.channels = stream.getAudioTracks()[0]?.getSettings?.().channelCount || chans;
    if (t.channel >= 0) {
      const split = ctx.createChannelSplitter(Math.max(2, x.channels));
      x.src.connect(split); split.connect(x.an, Math.min(t.channel, Math.max(2, x.channels) - 1));
    } else x.src.connect(x.an);
    x.bins = new Uint8Array(x.an.frequencyBinCount);
    delete this.err[t.id];
  }
  release(id) {
    const x = this.nodes.get(id);
    if (!x) return;
    try { x.el?.pause(); x.el?.removeAttribute("src"); } catch {}
    try { x.src?.disconnect(); x.gain?.disconnect(); } catch {}
    x.stream?.getTracks().forEach(s => s.stop());
    if (x.url) URL.revokeObjectURL(x.url);
    this.nodes.delete(id); delete this.values[id]; delete this.raw[id]; delete this.err[id];
  }
  /** El stem que marca el tiempo (el primero que haya). */
  masterEl() { for (const t of this.list) { const x = this.nodes.get(t.id); if (x?.el) return x.el; } return null; }
  hasFiles() { return this.list.some(t => t.kind === "file" && t.media); }
  /** Reproducir / parar todos los stems juntos y en sincronía. */
  play(from = null) {
    this.sync(); this.ensureCtx(); this.playing = true;
    const m = this.masterEl(), t0 = from ?? (m ? m.currentTime : 0);
    for (const x of this.nodes.values()) if (x.el) { try { x.el.currentTime = t0; } catch {} x.el.play().catch(() => {}); }
  }
  pause() { this.playing = false; for (const x of this.nodes.values()) x.el?.pause(); }
  stop() { this.pause(); for (const x of this.nodes.values()) if (x.el) { try { x.el.currentTime = 0; } catch {} } }
  seek(sec) { for (const x of this.nodes.values()) if (x.el) { try { x.el.currentTime = sec; } catch {} } }
  get position() { return this.masterEl()?.currentTime || 0; }
  get duration() { const d = this.masterEl()?.duration; return Number.isFinite(d) ? d : 0; }
  /** En cada fotograma: la señal (0..1, ya con su ADSR) de cada pista. */
  update(now) {
    const list = this.list;
    if (!list.length) { this.values = {}; this.byName = {}; return this.values; }
    const key = list.map(t => [t.id, t.kind, t.media, t.device, t.channel, t.mute, t.solo, t.vol].join(",")).join("|");
    if (key !== this.key) { this.key = key; this.sync(); }
    const dt = this.last ? Math.min(0.25, (now - this.last) / 1000) : 1 / 60;
    this.last = now;
    // Los stems no se separan entre sí (se corrige si uno se adelanta más de 60 ms).
    const m = this.masterEl();
    if (this.playing && m && !m.paused) for (const x of this.nodes.values()) if (x.el && x.el !== m && Math.abs(x.el.currentTime - m.currentTime) > 0.06) { try { x.el.currentTime = m.currentTime; } catch {} }
    const master = this.env.masterBins?.() || null;
    const values = {}, raw = {}, byName = {};
    for (const t of list) {
      const x = this.nodes.get(t.id);
      if (!x) continue;
      let bins = null, sr = 44100;
      if (t.kind === "master") { bins = master?.bins; sr = master?.sampleRate || sr; }
      else if (x.an && x.bins) { x.an.getByteFrequencyData(x.bins); bins = x.bins; sr = this.ctx?.sampleRate || sr; }
      const B = BANDS[t.band] || BANDS.all;
      const e = bins ? bandEnergy(bins, sr, B.lo, B.hi) : 0;
      const level = t.on && bins ? Math.min(1, x.band.step(e, dt, !!B.punch) * t.gain) : 0;
      raw[t.id] = level;
      const v = x.adsr.step(level, dt, t);
      values[t.id] = v;
      byName[chanName(t.name)] = v;
    }
    this.values = values; this.raw = raw; this.byName = byName;
    return values;
  }
  dispose() { for (const id of [...this.nodes.keys()]) this.release(id); this.ctx?.close().catch(() => {}); this.ctx = null; }
}
