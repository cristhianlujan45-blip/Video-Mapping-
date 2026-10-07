// web/js/audio.js
// Audio reactivo: analiza el micrófono (FFT) y entrega graves, medios,
// agudos, volumen y golpes (beat) normalizados 0..1 con ganancia automática.
// Sin micrófono, el tempo manual (BPM / tap tempo) genera el pulso.

export class AudioEngine {
  constructor() {
    this.ctx = null; this.analyser = null; this.stream = null;
    this.bins = null;
    this.levels = { bass: 0, mid: 0, high: 0, level: 0, beat: 0 };
    this.peak = { bass: 0.05, mid: 0.05, high: 0.05, level: 0.05 };
    this.bassAvg = 0; this.lastBeat = 0;
    this.bpm = 120; this.taps = [];
    this.gain = 1;
    this.enabled = false;
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
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.6;
    src.connect(this.analyser);
    this.bins = new Uint8Array(this.analyser.frequencyBinCount);
    this.enabled = true;
  }

  stop() {
    this.stream?.getTracks().forEach(t => t.stop());
    this.ctx?.close().catch(() => {});
    this.ctx = this.analyser = this.stream = null;
    this.enabled = false;
  }

  /** Registra un toque de tempo; con 2+ toques recientes calcula el BPM. */
  tap(now = performance.now()) {
    this.taps = this.taps.filter(t => now - t < 3000);
    this.taps.push(now);
    if (this.taps.length >= 2) {
      const d = (this.taps[this.taps.length - 1] - this.taps[0]) / (this.taps.length - 1);
      this.bpm = Math.round(Math.max(40, Math.min(240, 60000 / d)));
    }
    this.lastBeat = now;
    this.levels.beat = 1;
    return this.bpm;
  }

  /** Actualiza niveles; llamar una vez por fotograma. */
  update(now = performance.now()) {
    const L = this.levels;
    if (this.analyser) {
      this.analyser.getByteFrequencyData(this.bins);
      const hz = this.ctx.sampleRate / 2 / this.bins.length;
      const band = (a, b) => {
        const i0 = Math.max(1, Math.floor(a / hz)), i1 = Math.max(i0 + 1, Math.floor(b / hz));
        let s = 0;
        for (let i = i0; i < i1 && i < this.bins.length; i++) s += this.bins[i];
        return s / ((i1 - i0) * 255);
      };
      const raw = { bass: band(30, 160), mid: band(160, 2000), high: band(2000, 9000) };
      raw.level = (raw.bass + raw.mid + raw.high) / 3;
      for (const k of ["bass", "mid", "high", "level"]) {
        // Ganancia automática: el pico decae lentamente para adaptarse al volumen de la sala.
        this.peak[k] = Math.max(raw[k], this.peak[k] * 0.996, 0.04);
        const v = Math.min(1, (raw[k] / this.peak[k]) * this.gain);
        L[k] = v > L[k] ? v : L[k] * 0.82 + v * 0.18;
      }
      this.bassAvg = this.bassAvg * 0.95 + raw.bass * 0.05;
      if (raw.bass > this.bassAvg * 1.3 && raw.bass > 0.12 && now - this.lastBeat > 240) {
        this.lastBeat = now; L.beat = 1;
      }
    } else {
      // Sin micrófono: pulso sintético a partir del BPM.
      const period = 60000 / this.bpm;
      if (now - this.lastBeat >= period) { this.lastBeat = now - ((now - this.lastBeat) % period); L.beat = 1; }
      const ph = ((now - this.lastBeat) % period) / period;
      const pulse = Math.exp(-ph * 5);
      L.bass = pulse; L.mid = pulse * 0.7; L.high = Math.exp(-ph * 9) * 0.6; L.level = pulse * 0.8;
    }
    L.beat *= 0.86;
    return L;
  }
}
