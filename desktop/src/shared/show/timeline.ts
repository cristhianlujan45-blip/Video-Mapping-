import type { AutomationLane, Keyframe } from '../project/model';

/** Value of an automation lane at time t (seconds). */
export function evalLane(keys: Keyframe[], t: number): number | null {
  if (keys.length === 0) return null;
  if (t <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.v;
  // binary search
  let lo = 0;
  let hi = keys.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keys[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = keys[lo];
  const b = keys[hi];
  if (a.ease === 'hold') return a.v;
  let x = (t - a.t) / (b.t - a.t);
  if (a.ease === 'smooth') x = x * x * (3 - 2 * x);
  return a.v + (b.v - a.v) * x;
}

/** Inserts/replaces a keyframe keeping order. Keys closer than `epsilon` are replaced. */
export function setKey(lane: AutomationLane, t: number, v: number, ease: Keyframe['ease'] = 'linear', epsilon = 1 / 120): AutomationLane {
  const keys = lane.keys.filter((k) => Math.abs(k.t - t) > epsilon);
  keys.push({ t, v, ease });
  keys.sort((a, b) => a.t - b.t);
  return { ...lane, keys };
}

/**
 * Converts a recorded stream of (t, v) samples into keyframes, dropping points that a
 * straight line through their neighbours reproduces within `tolerance`
 * (Ramer–Douglas–Peucker), so a recorded MIDI fader move becomes an editable lane.
 */
export function simplifyRecording(samples: { t: number; v: number }[], tolerance: number): Keyframe[] {
  if (samples.length <= 2) return samples.map((s) => ({ ...s, ease: 'linear' as const }));
  const keep = new Array(samples.length).fill(false);
  keep[0] = keep[samples.length - 1] = true;
  const stack: [number, number][] = [[0, samples.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    const A = samples[a];
    const B = samples[b];
    for (let i = a + 1; i < b; i++) {
      const P = samples[i];
      const x = (P.t - A.t) / (B.t - A.t || 1);
      const d = Math.abs(P.v - (A.v + (B.v - A.v) * x));
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > tolerance) {
      keep[idx] = true;
      stack.push([a, idx], [idx, b]);
    }
  }
  return samples.filter((_, i) => keep[i]).map((s) => ({ t: s.t, v: s.v, ease: 'linear' as const }));
}

/** Records param writes while armed and produces automation lanes. */
export class AutomationRecorder {
  private data = new Map<string, { t: number; v: number }[]>();
  armed = false;
  private t0 = 0;

  constructor(private sources: Set<string> = new Set(['midi', 'osc', 'dmx', 'tracking', 'audio', 'ui', 'remote'])) {}

  start(timelineSec: number, now: number) {
    this.armed = true;
    this.t0 = now - timelineSec;
    this.data.clear();
  }

  record(param: string, value: number, source: string, now: number) {
    if (!this.armed) return;
    const kind = source.split(':')[0];
    if (!this.sources.has(kind)) return;
    let arr = this.data.get(param);
    if (!arr) this.data.set(param, (arr = []));
    arr.push({ t: now - this.t0, v: value });
  }

  stop(tolerance = 0.002): Map<string, Keyframe[]> {
    this.armed = false;
    const out = new Map<string, Keyframe[]>();
    for (const [p, s] of this.data) out.set(p, simplifyRecording(s, tolerance));
    this.data.clear();
    return out;
  }
}
