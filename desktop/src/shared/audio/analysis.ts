/**
 * Audio feature extraction from an FFT magnitude spectrum + time-domain block:
 * RMS, bass/mid/treble energy, spectral-flux onsets, beat detection with an adaptive
 * threshold and BPM estimation from inter-beat intervals.
 */

export interface AudioFeatures {
  rms: number;
  /** 0..1 smoothed, auto-gained band energies. */
  bass: number;
  mid: number;
  treble: number;
  /** 1 for one analysis block when a beat is detected, else 0. */
  beat: number;
  /** Spectral flux onset strength 0..1. */
  onset: number;
  bpm: number;
  /** 16 log-spaced bands, 0..1. */
  spectrum: Float32Array;
  /** Beat phase 0..1 based on the estimated tempo. */
  phase: number;
}

export interface AnalyzerOptions {
  sampleRate: number;
  fftSize: number;
  bassHz: number;
  trebleHz: number;
  smoothing: number;
  beatSensitivity: number;
  gain: number;
}

export class AudioAnalyzer {
  private prevMag: Float32Array | null = null;
  private bassHistory: number[] = [];
  private fluxHistory: number[] = [];
  private lastBeatT = -1;
  private beatIntervals: number[] = [];
  private peak = { bass: 1e-6, mid: 1e-6, treble: 1e-6, rms: 1e-6 };
  private smooth = { bass: 0, mid: 0, treble: 0 };
  private bandEdges: number[] = [];
  readonly features: AudioFeatures = { rms: 0, bass: 0, mid: 0, treble: 0, beat: 0, onset: 0, bpm: 0, spectrum: new Float32Array(16), phase: 0 };

  constructor(public opts: AnalyzerOptions) {
    this.computeBands();
  }

  setOptions(o: Partial<AnalyzerOptions>) {
    Object.assign(this.opts, o);
    this.computeBands();
  }

  private computeBands() {
    const nyquist = this.opts.sampleRate / 2;
    const bins = this.opts.fftSize / 2;
    this.bandEdges = [];
    const fMin = 30;
    for (let i = 0; i <= 16; i++) {
      const f = fMin * Math.pow(nyquist / fMin, i / 16);
      this.bandEdges.push(Math.min(bins, Math.max(1, Math.round((f / nyquist) * bins))));
    }
  }

  /**
   * @param mag linear magnitudes (0..1-ish) for fftSize/2 bins
   * @param time time-domain samples of the same block
   * @param t seconds (monotonic)
   */
  process(mag: Float32Array, time: Float32Array, t: number): AudioFeatures {
    const { sampleRate, fftSize, bassHz, trebleHz, smoothing, beatSensitivity, gain } = this.opts;
    const binHz = sampleRate / fftSize;
    let sq = 0;
    for (let i = 0; i < time.length; i++) sq += time[i] * time[i];
    const rms = Math.sqrt(sq / Math.max(1, time.length)) * gain;

    let bass = 0;
    let mid = 0;
    let treble = 0;
    let flux = 0;
    const bassBin = Math.max(1, Math.floor(bassHz / binHz));
    const trebleBin = Math.max(bassBin + 1, Math.floor(trebleHz / binHz));
    for (let i = 1; i < mag.length; i++) {
      const v = mag[i] * gain;
      const e = v * v;
      if (i <= bassBin) bass += e;
      else if (i <= trebleBin) mid += e;
      else treble += e;
      if (this.prevMag) {
        const d = v - this.prevMag[i];
        if (d > 0) flux += d;
      }
    }
    if (!this.prevMag || this.prevMag.length !== mag.length) this.prevMag = new Float32Array(mag.length);
    for (let i = 0; i < mag.length; i++) this.prevMag[i] = mag[i] * gain;
    bass = Math.sqrt(bass / bassBin);
    mid = Math.sqrt(mid / Math.max(1, trebleBin - bassBin));
    treble = Math.sqrt(treble / Math.max(1, mag.length - trebleBin));

    // auto gain: slowly decaying peaks
    const norm = (k: 'bass' | 'mid' | 'treble' | 'rms', v: number) => {
      this.peak[k] = Math.max(v, this.peak[k] * 0.9995, 1e-4);
      return Math.min(1, v / this.peak[k]);
    };
    const nb = norm('bass', bass);
    const nm = norm('mid', mid);
    const nt = norm('treble', treble);
    const nr = norm('rms', rms);
    const a = Math.min(0.99, Math.max(0, smoothing));
    this.smooth.bass = this.smooth.bass * a + nb * (1 - a);
    this.smooth.mid = this.smooth.mid * a + nm * (1 - a);
    this.smooth.treble = this.smooth.treble * a + nt * (1 - a);

    // beat: bass energy above the recent average × sensitivity, min 250 ms apart
    this.bassHistory.push(bass);
    if (this.bassHistory.length > 43) this.bassHistory.shift();
    const avg = this.bassHistory.reduce((x, y) => x + y, 0) / this.bassHistory.length;
    let beat = 0;
    if (bass > avg * beatSensitivity && bass > 1e-3 && (this.lastBeatT < 0 || t - this.lastBeatT > 0.25)) {
      beat = 1;
      if (this.lastBeatT >= 0) {
        const iv = t - this.lastBeatT;
        if (iv > 0.25 && iv < 2) {
          this.beatIntervals.push(iv);
          if (this.beatIntervals.length > 16) this.beatIntervals.shift();
        }
      }
      this.lastBeatT = t;
    }

    this.fluxHistory.push(flux);
    if (this.fluxHistory.length > 43) this.fluxHistory.shift();
    const fAvg = this.fluxHistory.reduce((x, y) => x + y, 0) / this.fluxHistory.length;
    const onset = fAvg > 0 ? Math.min(1, Math.max(0, (flux - fAvg) / (fAvg * 2))) : 0;

    // spectrum bands
    const sp = this.features.spectrum;
    for (let b = 0; b < 16; b++) {
      let s = 0;
      const lo = this.bandEdges[b];
      const hi = Math.max(lo + 1, this.bandEdges[b + 1]);
      for (let i = lo; i < hi && i < mag.length; i++) s = Math.max(s, mag[i] * gain);
      sp[b] = sp[b] * a + Math.min(1, s) * (1 - a);
    }

    const f = this.features;
    f.rms = nr;
    f.bass = this.smooth.bass;
    f.mid = this.smooth.mid;
    f.treble = this.smooth.treble;
    f.beat = beat;
    f.onset = onset;
    f.bpm = estimateBpm(this.beatIntervals);
    f.phase = f.bpm > 0 && this.lastBeatT >= 0 ? ((t - this.lastBeatT) * f.bpm) / 60 % 1 : 0;
    return f;
  }
}

/** Median inter-beat interval folded into 70..180 BPM. */
export function estimateBpm(intervals: number[]): number {
  if (intervals.length < 3) return 0;
  const sorted = [...intervals].sort((a, b) => a - b);
  let bpm = 60 / sorted[Math.floor(sorted.length / 2)];
  while (bpm < 70) bpm *= 2;
  while (bpm > 180) bpm /= 2;
  return Math.round(bpm * 10) / 10;
}
