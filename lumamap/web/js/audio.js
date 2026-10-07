// web/js/audio.js
// Audio reactivo: analiza el micrófono (FFT) y entrega graves, medios,
// agudos, volumen y golpes (beat) normalizados 0..1 con ganancia automática.
// Detecta el tempo (BPM) a partir de los golpes y genera un pulso estable en
// fase con la música. Sin micrófono, el pulso sale del BPM manual / TAP.

/** Lleva un intervalo entre golpes (ms) al rango musical 70..180 BPM. */
export function foldBpm(intervalMs) {
  let bpm = 60000 / intervalMs;
  while (bpm < 70) bpm *= 2;
  while (bpm > 180) bpm /= 2;
  return bpm;
}

/** Estima el BPM a partir de los instantes de los golpes (ms). null si no hay datos suficientes. */
export function estimateBpm(beatTimes) {
  if (beatTimes.length < 4) return null;
  const iv = [];
  for (let i = 1; i < beatTimes.length; i++) {
    const d = beatTimes[i] - beatTimes[i - 1];
    if (d > 250 && d < 2000) iv.push(foldBpm(d));
  }
  if (iv.length < 3) return null;
  // Histograma de 1 BPM: gana la zona con más votos (robusto ante golpes extra).
  const votes = new Map();
  for (const b of iv) for (const k of [Math.round(b) - 1, Math.round(b), Math.round(b) + 1]) votes.set(k, (votes.get(k) || 0) + (k === Math.round(b) ? 2 : 1));
  let best = null, bestV = 0;
  for (const [k, v] of votes) if (v > bestV) { best = k; bestV = v; }
  // Refinado: cada golpe se asigna a su número de pulso con el tempo aproximado y
  // una regresión lineal (instante ~ número de pulso) da el periodo exacto,
  // inmune al temblor de los fotogramas y a los golpes perdidos.
  const P0 = 60000 / best, t0 = beatTimes[0];
  const ks = beatTimes.map(t => Math.round((t - t0) / P0));
  const n = ks.length, mk = ks.reduce((a, b) => a + b, 0) / n, mt = beatTimes.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (ks[i] - mk) * (beatTimes[i] - mt); den += (ks[i] - mk) ** 2; }
  if (!den) return best;
  const bpm = 60000 / (num / den);
  return Math.abs(bpm - best) < 6 ? bpm : best;
}

export class AudioEngine {
  constructor() {
    this.ctx = null; this.analyser = null; this.stream = null;
    this.bins = null;
    this.levels = { bass: 0, mid: 0, high: 0, level: 0, beat: 0, count: 0, bpm: 120, phase: 0, live: false };
    this.peak = { bass: 0.05, mid: 0.05, high: 0.05, level: 0.05 };
    this.prevBass = 0; this.fluxAvg = 0.01; this.bassAvg = 0;
    this.lastOnset = 0; this.onsets = [];
    this.bpm = 120; this.detected = null;
    this.taps = [];
    this.gain = 1;           // sensibilidad (sube para micrófonos lejanos o música baja)
    this.clockBeat = 0;      // instante del último golpe del reloj de tempo
  }

  get active() { return !!this.analyser; }

  async start() {
    if (this.analyser) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Este navegador no permite usar el micrófono");
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    if (this.ctx.state === "suspended") await this.ctx.resume().catch(() => {});
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.35;
    src.connect(this.analyser);
    this.bins = new Uint8Array(this.analyser.frequencyBinCount);
    this.onsets = []; this.detected = null;
  }

  stop() {
    this.stream?.getTracks().forEach(t => t.stop());
    this.ctx?.close().catch(() => {});
    this.ctx = this.analyser = this.stream = null;
    this.detected = null;
  }

  /** Toque de tempo: con 2+ toques recientes fija el BPM y la fase. */
  tap(now = performance.now()) {
    this.taps = this.taps.filter(t => now - t < 3000);
    this.taps.push(now);
    if (this.taps.length >= 2) {
      const d = (this.taps[this.taps.length - 1] - this.taps[0]) / (this.taps.length - 1);
      this.bpm = Math.round(Math.max(40, Math.min(240, 60000 / d)));
    }
    this.clockBeat = now;
    this.fire(now);
    return this.bpm;
  }

  fire() { this.levels.beat = 1; this.levels.count++; }

  /** Actualiza niveles; llamar una vez por fotograma. */
  update(now = performance.now()) {
    const L = this.levels;
    let onset = false;
    if (this.analyser) {
      if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
      this.analyser.getByteFrequencyData(this.bins);
      const hz = this.ctx.sampleRate / 2 / this.bins.length;
      const band = (a, b) => {
        const i0 = Math.max(1, Math.floor(a / hz)), i1 = Math.max(i0 + 1, Math.floor(b / hz));
        let s = 0;
        for (let i = i0; i < i1 && i < this.bins.length; i++) s += this.bins[i];
        return s / ((i1 - i0) * 255);
      };
      const raw = { bass: band(35, 180), mid: band(180, 2000), high: band(2000, 9000) };
      raw.level = (raw.bass + raw.mid + raw.high) / 3;
      for (const k of ["bass", "mid", "high", "level"]) {
        // Ganancia automática: el pico decae despacio y se adapta al volumen de la sala.
        this.peak[k] = Math.max(raw[k], this.peak[k] * 0.997, 0.015);
        const v = Math.min(1, (raw[k] / this.peak[k]) * this.gain);
        L[k] = v > L[k] ? v : L[k] * 0.8 + v * 0.2;
      }
      // Golpe = subida brusca de graves (flujo espectral) frente a su media reciente.
      // Umbral relativo: funciona igual con música baja o alta.
      const flux = Math.max(0, raw.bass - this.prevBass);
      this.prevBass = raw.bass;
      this.fluxAvg = this.fluxAvg * 0.96 + flux * 0.04;
      this.bassAvg = this.bassAvg * 0.98 + raw.bass * 0.02;
      const minGap = this.detected ? Math.max(220, 60000 / this.detected * 0.55) : 230;
      const strong = flux > Math.max(0.004, this.fluxAvg * (2.2 / this.gain)) && raw.bass > this.bassAvg * 0.9;
      if (strong && raw.bass > 0.01 && now - this.lastOnset > minGap) {
        onset = true;
        this.lastOnset = now;
        this.onsets.push(now);
        while (this.onsets.length && now - this.onsets[0] > 12000) this.onsets.shift();
        const est = estimateBpm(this.onsets);
        if (est) this.detected = this.detected ? this.detected * 0.8 + est * 0.2 : est;
        if (this.detected) this.bpm = Math.round(this.detected);
      }
      // Sin golpes durante 4 s (silencio): el tempo detectado deja de valer.
      if (now - this.lastOnset > 4000) this.detected = null;
    }
    // Reloj de tempo: pulso estable que se resincroniza con cada golpe real.
    const period = 60000 / this.bpm;
    if (onset) {
      // Si el golpe real cae cerca del pulso esperado, lo sigue; si no, lo dispara igual.
      this.clockBeat = now;
      this.fire(now);
    } else if (now - this.clockBeat >= period && (!this.analyser || this.detected)) {
      this.clockBeat += period * Math.floor((now - this.clockBeat) / period);
      this.fire(now);
    }
    L.phase = Math.min(1, (now - this.clockBeat) / period);
    if (!this.analyser) {
      const pulse = Math.exp(-L.phase * 5);
      L.bass = pulse; L.mid = pulse * 0.7; L.high = Math.exp(-L.phase * 9) * 0.6; L.level = pulse * 0.8;
    }
    L.bpm = this.bpm;
    L.live = !!this.analyser;
    L.beat *= 0.84;
    return L;
  }
}
