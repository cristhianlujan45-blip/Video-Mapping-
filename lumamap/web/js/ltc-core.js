// web/js/ltc-core.js
// Decodificador de LTC (Linear Timecode, SMPTE 12M) sin dependencias. Lo usa
// el AudioWorklet (hilo de audio) y las pruebas. Codificación bifase (biphase
// mark): cada bit empieza con un cambio de nivel; un «1» tiene otro cambio a
// mitad del bit. 80 bits por cuadro, palabra de sincronía 0011 1111 1111 1101.
const SYNC = [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1];

export class LtcDecoder {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.level = 0;          // nivel actual (-1 / 1) con histéresis
    this.since = 0;          // muestras desde el último cambio
    this.period = sampleRate / (80 * 25);   // estimación inicial del bit (25 fps)
    this.half = false;       // esperando la segunda mitad de un «1»
    this.bits = [];
    this.peak = 0.02;
    this.onFrame = null;
  }

  /** Procesa un bloque de muestras (Float32Array). */
  process(buf) {
    for (let i = 0; i < buf.length; i++) {
      const x = buf[i];
      const a = Math.abs(x);
      this.peak = Math.max(a, this.peak * 0.9999);
      const th = this.peak * 0.25;
      this.since++;
      let nl = this.level;
      if (x > th) nl = 1; else if (x < -th) nl = -1;
      if (nl !== this.level && nl !== 0) {
        if (this.level !== 0) this.edge(this.since);
        this.level = nl;
        this.since = 0;
      }
    }
  }

  edge(len) {
    const T = this.period;
    if (len > T * 0.75 && len < T * 1.5) {            // intervalo largo: «0»
      if (this.half) this.half = false;                // un medio bit perdido: se resincroniza
      this.bit(0);
      this.period = T * 0.95 + len * 0.05;
    } else if (len > T * 0.3 && len <= T * 0.75) {     // intervalo corto: medio «1»
      if (this.half) { this.half = false; this.bit(1); this.period = T * 0.95 + len * 2 * 0.05; }
      else this.half = true;
    } else if (len >= T * 1.5 && len < T * 4) {        // la velocidad cambió mucho: se adapta
      this.period = len; this.half = false;
    } else {
      this.half = false;
      if (len <= T * 0.3) this.period = Math.max(4, len * 2);
    }
  }

  bit(b) {
    const bits = this.bits;
    bits.push(b);
    if (bits.length > 80) bits.shift();
    if (bits.length < 80) return;
    for (let i = 0; i < 16; i++) if (bits[64 + i] !== SYNC[i]) return;
    const v = (o, n) => { let r = 0; for (let i = 0; i < n; i++) r |= bits[o + i] << i; return r; };
    const frame = v(0, 4) + 10 * v(8, 2), drop = !!bits[10];
    const sec = v(16, 4) + 10 * v(24, 3), min = v(32, 4) + 10 * v(40, 3), hour = v(48, 4) + 10 * v(56, 2);
    const fpsRaw = this.sr / (80 * this.period);
    const fps = [24, 25, 30].reduce((a, b) => Math.abs(b - fpsRaw) < Math.abs(a - fpsRaw) ? b : a);
    if (frame >= 30 || sec >= 60 || min >= 60 || hour >= 24) return;
    this.bits = [];
    this.onFrame?.({ h: hour, m: min, s: sec, f: frame, fps: drop ? 29.97 : fps, drop, seconds: hour * 3600 + min * 60 + sec + frame / (drop ? 29.97 : fps) });
  }
}

/** Codificador LTC (para pruebas y para generar una señal de referencia). */
export function encodeLtc({ h = 0, m = 0, s = 0, f = 0, fps = 25, frames = 1, sampleRate = 48000, amp = 0.5 } = {}) {
  const out = [];
  const spb = sampleRate / (80 * fps);
  let level = amp, acc = 0;
  let tc = { h, m, s, f };
  for (let n = 0; n < frames; n++) {
    const bits = new Array(80).fill(0);
    const put = (o, nbits, val) => { for (let i = 0; i < nbits; i++) bits[o + i] = (val >> i) & 1; };
    put(0, 4, tc.f % 10); put(8, 2, Math.floor(tc.f / 10));
    put(16, 4, tc.s % 10); put(24, 3, Math.floor(tc.s / 10));
    put(32, 4, tc.m % 10); put(40, 3, Math.floor(tc.m / 10));
    put(48, 4, tc.h % 10); put(56, 2, Math.floor(tc.h / 10));
    SYNC.forEach((b, i) => { bits[64 + i] = b; });
    // bit de corrección de polaridad (27 a 25 fps): número par de ceros
    const zeros = bits.filter(b => b === 0).length;
    if (zeros % 2) bits[fps === 25 ? 59 : 27] = 1;
    for (const b of bits) {
      level = -level;                                          // cambio al empezar cada bit
      const len = Math.round(acc + spb) - Math.round(acc); acc += spb;
      for (let i = 0; i < len; i++) {
        if (b && i === Math.floor(len / 2)) level = -level;    // un «1» cambia también a la mitad
        out.push(level);
      }
    }
    tc.f++;
    if (tc.f >= fps) { tc.f = 0; tc.s++; if (tc.s >= 60) { tc.s = 0; tc.m++; if (tc.m >= 60) { tc.m = 0; tc.h = (tc.h + 1) % 24; } } }
  }
  return Float32Array.from(out);
}
