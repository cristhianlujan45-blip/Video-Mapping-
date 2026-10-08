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

/**
 * Estima el BPM a partir de los instantes de los golpes (ms) y su fuerza.
 * Prueba todos los tempos de 70 a 180 BPM y elige el que mejor alinea los
 * golpes en una rejilla (coherencia de fase): los golpes a contratiempo (caja,
 * platos) no lo desvían porque pesan menos que el bombo. Después afina el
 * periodo con una regresión lineal. Devuelve null si no hay datos suficientes.
 */
export function estimateTempo(beatTimes, weights) {
  const n = beatTimes.length;
  if (n < 4) return null;
  const w = weights || beatTimes.map(() => 1);
  const t0 = beatTimes[0];
  let best = null, bestR = 0;
  for (let bpm = 70; bpm <= 180; bpm += 0.25) {
    const P = 60000 / bpm;
    let c = 0, s = 0, W = 0;
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * (beatTimes[i] - t0)) / P;
      c += w[i] * Math.cos(a); s += w[i] * Math.sin(a); W += w[i];
    }
    // Pequeña preferencia por tempos centrales (90-140) ante empates de doble/mitad.
    const R = Math.hypot(c, s) / W * (1 - Math.abs(bpm - 115) / 1500);
    if (R > bestR) { bestR = R; best = bpm; }
  }
  if (!best || bestR < 0.35) return null;
  // Refinado: numera cada golpe respecto al anterior (sin acumular error) y
  // ajusta instante ~ número de pulso por mínimos cuadrados ponderados.
  const P0 = 60000 / best;
  const ks = [0];
  for (let i = 1; i < n; i++) ks.push(ks[i - 1] + Math.max(1, Math.round((beatTimes[i] - beatTimes[i - 1]) / P0)));
  // Solo los golpes que caen en la rejilla (fuera: contratiempos).
  const on = [];
  for (let i = 0; i < n; i++) {
    const ph = (((beatTimes[i] - t0) / P0) % 1 + 1) % 1;
    if (Math.min(ph, 1 - ph) < 0.2) on.push(i);
  }
  const result = (bpm) => {
    // Fase: media circular ponderada de los golpes con el periodo final.
    const P = 60000 / bpm;
    let c = 0, sn = 0;
    for (let i = 0; i < n; i++) { const a = (2 * Math.PI * (beatTimes[i] - t0)) / P; c += w[i] * Math.cos(a); sn += w[i] * Math.sin(a); }
    const ref = t0 + ((Math.atan2(sn, c) / (2 * Math.PI) + 1) % 1) * P;
    return { bpm, ref, coherence: bestR };
  };
  if (on.length < 3) return result(best);
  let sw = 0, mk = 0, mt = 0;
  for (const i of on) { sw += w[i]; mk += w[i] * ks[i]; mt += w[i] * beatTimes[i]; }
  mk /= sw; mt /= sw;
  let num = 0, den = 0;
  for (const i of on) { num += w[i] * (ks[i] - mk) * (beatTimes[i] - mt); den += w[i] * (ks[i] - mk) ** 2; }
  if (!den) return result(best);
  const bpm = 60000 / (num / den);
  return result(Math.abs(bpm - best) < 3 ? bpm : best);
}

export function estimateBpm(beatTimes, weights) {
  return estimateTempo(beatTimes, weights)?.bpm ?? null;
}

export class AudioEngine {
  constructor() {
    this.ctx = null; this.analyser = null; this.stream = null;
    this.bins = null;
    this.levels = { bass: 0, mid: 0, high: 0, level: 0, beat: 0, count: 0, bpm: 120, phase: 0, pos: 0, live: false, locked: false };
    this.peak = { bass: 0.05, mid: 0.05, high: 0.05, level: 0.05 };
    this.prevBass = 0; this.fluxAvg = 0.01; this.bassAvg = 0;
    this.lastOnset = 0; this.onsets = []; this.onsetW = [];
    this.bpm = 120; this.detected = null;
    this.mult = 1;           // ½× / 2× sobre el tempo detectado (música a doble o media velocidad)
    this.taps = [];
    this.gain = 1;           // sensibilidad (sube para micrófonos lejanos o música baja)
    this.nextBeat = 0;       // instante previsto del próximo golpe (rejilla de tempo)
    this.lastFire = -1e9;    // instante del último golpe disparado
    this.lock = 0;           // 0..1: cuánto coinciden los golpes reales con la rejilla
    this.wasLive = false;
    // Compensación de retardo (ms): adelanta el golpe visual para que caiga justo
    // con el sonido (el micrófono y el análisis llegan unos milisegundos tarde).
    this.offset = 60;
    try { const o = localStorage.getItem("lumamap:audioOffset"); if (o !== null) this.offset = +o; } catch {}
  }

  setOffset(ms) { this.offset = ms; try { localStorage.setItem("lumamap:audioOffset", String(ms)); } catch {} }

  /** Fija el tempo a mano (lo usa el modo sin micrófono y como punto de partida). */
  setBpm(bpm, now = performance.now()) {
    this.bpm = Math.max(40, Math.min(240, bpm));
    if (!this.nextBeat) this.nextBeat = now + 60000 / this.bpm;
    return this.bpm;
  }
  /** ½× o 2×: con micrófono cambia el multiplicador del tempo detectado; sin él, el BPM. */
  scaleTempo(k) {
    if (this.analyser && this.detected) {
      this.mult = Math.max(0.25, Math.min(4, this.mult * k));
      this.bpm = this.detected * this.mult;
    } else this.setBpm(this.bpm * k);
    return this.bpm;
  }

  /** Reinicia la fase: el próximo golpe es «ahora» (botón 1 / resincronizar). */
  downbeat(now = performance.now()) { this.nextBeat = now; this.levels.count = Math.ceil(this.levels.count / 4) * 4; }

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
    this.onsets = []; this.onsetW = []; this.detected = null; this.wasLive = false; this.lock = 0; this.gridRef = 0; this.mult = 1;
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
    this.fire(now);
    this.nextBeat = now + 60000 / this.bpm + this.offset;
    return this.bpm;
  }

  fire(now = performance.now()) { this.lastFire = now; this.levels.count++; }

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
        this.onsetW.push(Math.min(4, flux / Math.max(1e-4, this.fluxAvg)));
        while (this.onsets.length && now - this.onsets[0] > 12000) { this.onsets.shift(); this.onsetW.shift(); }
        const est = estimateTempo(this.onsets, this.onsetW);
        if (est) {
          // Cambio claro de tempo (otra canción o primera estimación errónea): salta;
          // si es pequeño, suaviza para no temblar.
          this.detected = !this.detected || Math.abs(est.bpm - this.detected) > 4 ? est.bpm : this.detected * 0.7 + est.bpm * 0.3;
          this.lock = est.coherence;
          this.gridRef = est.ref;
        }
        if (this.detected) this.bpm = Math.max(40, Math.min(240, this.detected * this.mult));
      }
      // Sin golpes durante 4 s (silencio): el tempo detectado deja de valer.
      if (now - this.lastOnset > 4000) this.detected = null;
    }
    // Reloj de tempo con seguimiento de fase (PLL): con el BPM detectado, los
    // golpes visuales caen sobre una rejilla exacta y cada golpe real solo la
    // corrige un poco. Así no hay golpes de más ni temblor: todo va al compás.
    const P = 60000 / this.bpm;
    const live = !!(this.analyser && this.detected);
    if (live && !this.wasLive) {
      // Primer tempo fiable: la rejilla arranca en el último golpe real.
      const ref = this.gridRef || this.lastOnset;
      this.nextBeat = ref + Math.ceil((now - ref) / P) * P;
    }
    this.wasLive = live;
    if (onset) {
      if (live && this.gridRef) {
        // Lleva la rejilla hacia la fase estimada con todos los golpes recientes
        // (el bombo pesa más que la caja: no se engancha a contratiempo).
        const k = Math.round((this.nextBeat - this.gridRef) / P);
        let e = this.gridRef + k * P - this.nextBeat;
        if (e > P / 2) e -= P; if (e < -P / 2) e += P;
        this.nextBeat += e * 0.5;
        if (this.nextBeat - this.offset <= this.lastFire + P * 0.5) this.nextBeat += P;
      } else if (!live) {
        // Aún sin tempo: cada golpe del micrófono se ve al instante.
        this.fire(now);
        this.nextBeat = now + P;
      }
    }
    if (!this.analyser || live) {
      if (!this.nextBeat) this.nextBeat = now + P;
      if (now >= this.nextBeat - this.offset) {
        this.fire(now);
        this.nextBeat += P;
        while (this.nextBeat - this.offset <= now) this.nextBeat += P;
      }
    }
    // Fase dentro del compás actual (0 = golpe, 1 = justo antes del siguiente).
    L.phase = Math.max(0, Math.min(1, (now - (this.nextBeat - this.offset - P)) / P));
    // Posición musical continua: avanza rápido tras cada golpe y se frena antes del siguiente.
    L.pos = L.count - 1 + (1 - (1 - L.phase) ** 3);
    // Envolvente del golpe basada en tiempo (igual a 30, 60 o 120 fps).
    L.beat = Math.exp(-(now - this.lastFire) / 140);
    L.locked = live && this.lock > 0.5;
    if (!this.analyser) {
      const pulse = Math.exp(-L.phase * 5);
      L.bass = pulse; L.mid = pulse * 0.7; L.high = Math.exp(-L.phase * 9) * 0.6; L.level = pulse * 0.8;
    }
    L.bpm = this.bpm;
    L.live = !!this.analyser;
    return L;
  }
}
