import type { SyncSource, Timeline } from '../../shared/project/model';
import { evalLane } from '../../shared/show/timeline';
import type { ParameterEngine } from '../../shared/params/ParameterEngine';

/**
 * Timeline playhead driven by the selected clock: internal, MIDI clock (beats→seconds at
 * the incoming tempo), MTC, LTC or OSC time. External sources are chased: the playhead
 * follows the last timecode and free-runs between updates so motion stays smooth.
 * Every output, light and parameter reads the same playhead → one common clock.
 */
export class TimelinePlayer {
  playing = false;
  time = 0;
  private lastTick = performance.now();
  private extTime: number | null = null;
  private extAt = 0;
  source: SyncSource = 'internal';
  private crossed = new Set<string>();
  onMarker: ((cueId: string) => void) | null = null;
  /** Timecode lock state for the UI. */
  locked = false;

  constructor(private engine: ParameterEngine) {}

  play() {
    this.playing = true;
    this.lastTick = performance.now();
  }

  pause() {
    this.playing = false;
  }

  stop() {
    this.playing = false;
    this.time = 0;
    this.crossed.clear();
    this.engine.releaseSource('timeline');
  }

  seek(t: number) {
    this.time = Math.max(0, t);
    this.crossed.clear();
  }

  /** External timecode (MTC / LTC / OSC) in seconds. */
  external(seconds: number) {
    this.extTime = seconds;
    this.extAt = performance.now();
  }

  tick(tl: Timeline, offsetSec: number, clockBpm: number | null, clockRunning: boolean, clockBeats: number) {
    const now = performance.now();
    const dt = (now - this.lastTick) / 1000;
    this.lastTick = now;
    if (this.source === 'internal') {
      this.locked = true;
      if (this.playing) this.time += dt;
    } else if (this.source === 'midi-clock') {
      this.locked = clockRunning && (clockBpm ?? 0) > 0;
      if (this.locked) {
        this.playing = true;
        // song position in beats → seconds at 120 BPM reference timeline grid
        this.time = (clockBeats * 60) / Math.max(1, clockBpm ?? 120) + offsetSec;
      } else this.playing = false;
    } else {
      const fresh = this.extTime !== null && now - this.extAt < 500;
      this.locked = fresh;
      if (fresh) {
        this.playing = true;
        this.time = this.extTime! + (now - this.extAt) / 1000 + offsetSec;
      } else this.playing = false;
    }
    if (tl.loop && tl.durationSec > 0 && this.time > tl.durationSec) {
      this.time %= tl.durationSec;
      this.crossed.clear();
    } else if (!tl.loop && this.time > tl.durationSec) {
      this.time = tl.durationSec;
      if (this.source === 'internal') this.playing = false;
    }
    if (this.playing || this.source !== 'internal') {
      for (const lane of tl.lanes) {
        if (!lane.enabled) continue;
        const v = evalLane(lane.keys, this.time);
        if (v !== null) this.engine.set(lane.param, v, 'timeline');
      }
      for (const m of tl.markers) {
        if (!m.cueId) continue;
        if (this.time >= m.t && !this.crossed.has(m.id)) {
          this.crossed.add(m.id);
          if (this.time - m.t < 0.5) this.onMarker?.(m.cueId);
        } else if (this.time < m.t) this.crossed.delete(m.id);
      }
    }
  }
}
