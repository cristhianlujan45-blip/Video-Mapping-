/**
 * SMPTE LTC (linear timecode) over audio: biphase-mark decoding of 80-bit frames.
 * Runs on raw PCM samples (an AudioWorklet feeds it from the selected audio input).
 */

const SYNC = [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1];

export interface LtcFrame {
  hours: number;
  minutes: number;
  seconds: number;
  frames: number;
  dropFrame: boolean;
  /** Sample index (in the decoder's stream) where the frame ended. */
  endSample: number;
  reverse: boolean;
}

export class LtcDecoder {
  private lastSign = 0;
  private sinceCross = 0;
  private samplePos = 0;
  /** Running estimate of a full bit period in samples. */
  private bitPeriod: number;
  private pendingHalf = false;
  private bits: number[] = [];
  onFrame: ((f: LtcFrame) => void) | null = null;

  constructor(private sampleRate: number, fps = 30) {
    this.bitPeriod = sampleRate / (fps * 80);
  }

  process(samples: Float32Array) {
    const hysteresis = 0.02;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      this.sinceCross++;
      const sign = s > hysteresis ? 1 : s < -hysteresis ? -1 : this.lastSign;
      if (sign !== this.lastSign && this.lastSign !== 0) this.transition(this.sinceCross);
      if (sign !== this.lastSign) this.sinceCross = 0;
      this.lastSign = sign;
      this.samplePos++;
    }
  }

  private transition(interval: number) {
    const ratio = interval / this.bitPeriod;
    if (ratio > 0.75 && ratio < 1.5) {
      // long: a zero (unless we were waiting for a second half)
      if (this.pendingHalf) {
        // lost alignment
        this.pendingHalf = false;
      }
      this.bitPeriod = this.bitPeriod * 0.95 + interval * 0.05;
      this.pushBit(0);
    } else if (ratio > 0.3 && ratio <= 0.75) {
      this.bitPeriod = this.bitPeriod * 0.95 + interval * 2 * 0.05;
      if (this.pendingHalf) {
        this.pendingHalf = false;
        this.pushBit(1);
      } else this.pendingHalf = true;
    } else {
      // Out of range: resync (different frame rate or noise). Adapt slowly toward it.
      if (ratio >= 1.5 && ratio < 3) this.bitPeriod = interval;
      else if (ratio <= 0.3 && ratio > 0.1) this.bitPeriod = interval * 2;
      this.pendingHalf = false;
      this.bits = [];
    }
  }

  private pushBit(b: number) {
    this.bits.push(b);
    if (this.bits.length > 160) this.bits.splice(0, this.bits.length - 160);
    const n = this.bits.length;
    if (n < 80) return;
    // forward sync word at the end
    let fwd = true;
    for (let i = 0; i < 16; i++) if (this.bits[n - 16 + i] !== SYNC[i]) fwd = false;
    let rev = false;
    if (!fwd) {
      rev = true;
      for (let i = 0; i < 16; i++) if (this.bits[n - 16 + i] !== SYNC[15 - i]) rev = false;
    }
    if (!fwd && !rev) return;
    let frame = this.bits.slice(n - 80);
    if (rev) frame = frame.reverse();
    const v = (start: number, len: number) => {
      let x = 0;
      for (let i = 0; i < len; i++) x |= frame[start + i] << i;
      return x;
    };
    const f: LtcFrame = {
      frames: v(0, 4) + v(8, 2) * 10,
      dropFrame: frame[10] === 1,
      seconds: v(16, 4) + v(24, 3) * 10,
      minutes: v(32, 4) + v(40, 3) * 10,
      hours: v(48, 4) + v(56, 2) * 10,
      endSample: this.samplePos,
      reverse: rev,
    };
    this.bits = [];
    if (f.seconds < 60 && f.minutes < 60 && f.hours < 24 && f.frames < 30) this.onFrame?.(f);
  }
}

/** LTC encoder (for tests and LTC output). Returns samples for one frame. */
export function encodeLtcFrame(h: number, m: number, s: number, f: number, sampleRate: number, fps: number, startLevel = 1, amplitude = 0.5): { samples: Float32Array; endLevel: number } {
  const bits = new Array(80).fill(0);
  const put = (start: number, len: number, val: number) => {
    for (let i = 0; i < len; i++) bits[start + i] = (val >> i) & 1;
  };
  put(0, 4, f % 10);
  put(8, 2, Math.floor(f / 10));
  put(16, 4, s % 10);
  put(24, 3, Math.floor(s / 10));
  put(32, 4, m % 10);
  put(40, 3, Math.floor(m / 10));
  put(48, 4, h % 10);
  put(56, 2, Math.floor(h / 10));
  SYNC.forEach((b, i) => (bits[64 + i] = b));
  // Biphase parity bit (bit 27 for 30fps) so every frame starts at the same polarity.
  const ones = bits.reduce((a, b) => a + b, 0);
  if (ones % 2 === 1) bits[27] = 1;
  const perBit = sampleRate / (fps * 80);
  const out = new Float32Array(Math.round(perBit * 80));
  let level = startLevel;
  let pos = 0;
  for (let i = 0; i < 80; i++) {
    level = -level; // transition at every bit boundary
    const end = Math.round((i + 1) * perBit);
    const mid = Math.round((i + 0.5) * perBit);
    for (; pos < end; pos++) {
      if (bits[i] === 1 && pos === mid) level = -level;
      out[pos] = level * amplitude;
    }
  }
  return { samples: out, endLevel: level };
}
