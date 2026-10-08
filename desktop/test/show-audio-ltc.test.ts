import { describe, expect, it } from 'vitest';
import { evalLane, simplifyRecording } from '../src/shared/show/timeline';
import { FeatureBus, RuleEngine } from '../src/shared/show/rules';
import type { Action, Rule } from '../src/shared/project/model';
import { AudioAnalyzer, estimateBpm } from '../src/shared/audio/analysis';
import { encodeLtcFrame, LtcDecoder, type LtcFrame } from '../src/shared/timecode/ltc';

describe('timeline', () => {
  it('evaluates linear, hold and smooth keys', () => {
    const keys = [
      { t: 0, v: 0, ease: 'linear' as const },
      { t: 1, v: 1, ease: 'hold' as const },
      { t: 2, v: 0, ease: 'smooth' as const },
      { t: 3, v: 1, ease: 'linear' as const },
    ];
    expect(evalLane(keys, 0.5)).toBeCloseTo(0.5);
    expect(evalLane(keys, 1.9)).toBe(1);
    expect(evalLane(keys, 2.5)).toBeCloseTo(0.5);
    expect(evalLane(keys, 2.25)).toBeCloseTo(0.15625);
    expect(evalLane(keys, 10)).toBe(1);
  });

  it('simplifies a recorded linear fader move to its endpoints', () => {
    const s = Array.from({ length: 100 }, (_, i) => ({ t: i / 100, v: i / 100 }));
    expect(simplifyRecording(s, 0.001)).toHaveLength(2);
  });
});

describe('rules', () => {
  it('"cuando levante la mano cambia el color a rojo" fires on the edge and restores', () => {
    const bus = new FeatureBus();
    const done: Action[] = [];
    let t = 0;
    const eng = new RuleEngine(bus, (a) => done.push(a), () => t);
    const rule: Rule = {
      id: 'r1',
      name: 'Mano arriba → rojo',
      enabled: true,
      when: [{ feature: 'tracking.hand.any.raised', op: '>=', value: 1 }],
      then: [{ type: 'set', param: 'fx.color.hue', value: 0 }],
      otherwise: [{ type: 'set', param: 'fx.color.hue', value: 200 }],
      cooldownMs: 500,
      origin: 'ai',
    };
    eng.setRules([rule]);
    bus.set('tracking.hand.any.raised', 1);
    eng.evaluate();
    eng.evaluate(); // still raised → no refire
    expect(done).toHaveLength(1);
    bus.set('tracking.hand.any.raised', 0);
    t = 100;
    eng.evaluate();
    expect(done).toHaveLength(2);
    expect(done[1]).toEqual({ type: 'set', param: 'fx.color.hue', value: 200 });
    bus.set('tracking.hand.any.raised', 1);
    t = 200; // within cooldown
    eng.evaluate();
    expect(done).toHaveLength(2);
  });

  it('person count >= 2 → scene 3', () => {
    const bus = new FeatureBus();
    const done: Action[] = [];
    const eng = new RuleEngine(bus, (a) => done.push(a), () => 0);
    eng.setRules([
      { id: 'r', name: 'x', enabled: true, when: [{ feature: 'tracking.person.count', op: '>=', value: 2 }], then: [{ type: 'scene', compId: 'c3' }], otherwise: [], cooldownMs: 0, origin: 'ai' },
    ]);
    bus.set('tracking.person.count', 1);
    eng.evaluate();
    expect(done).toHaveLength(0);
    bus.set('tracking.person.count', 2);
    eng.evaluate();
    expect(done).toEqual([{ type: 'scene', compId: 'c3' }]);
  });
});

describe('audio analysis', () => {
  it('detects beats and tempo from a synthetic 120 BPM kick', () => {
    const sr = 48000;
    const fft = 2048;
    const a = new AudioAnalyzer({ sampleRate: sr, fftSize: fft, bassHz: 200, trebleHz: 4000, smoothing: 0.5, beatSensitivity: 1.3, gain: 1 });
    const block = 1024 / sr;
    let beats = 0;
    for (let i = 0; i < 400; i++) {
      const t = i * block;
      const sinceKick = t % 0.5;
      const kick = sinceKick < 0.06 ? 1 : 0.02;
      const mag = new Float32Array(fft / 2);
      for (let k = 1; k < 8; k++) mag[k] = kick;
      for (let k = 100; k < 200; k++) mag[k] = 0.05;
      const time = new Float32Array(1024).fill(kick * 0.5);
      const f = a.process(mag, time, t);
      beats += f.beat;
    }
    expect(beats).toBeGreaterThan(14);
    expect(a.features.bpm).toBeGreaterThan(115);
    expect(a.features.bpm).toBeLessThan(125);
    expect(estimateBpm([0.5, 0.5, 0.5, 0.5])).toBe(120);
  });
});

describe('LTC', () => {
  it('decodes encoded frames', () => {
    const sr = 48000;
    const dec = new LtcDecoder(sr, 25);
    const got: LtcFrame[] = [];
    dec.onFrame = (f) => got.push(f);
    let level = 1;
    for (let f = 0; f < 10; f++) {
      const r = encodeLtcFrame(10, 20, 30, f, sr, 25, level);
      level = r.endLevel;
      dec.process(r.samples);
    }
    expect(got.length).toBeGreaterThanOrEqual(8);
    const last = got[got.length - 1];
    // The last frame's final bit completes with the next frame's first transition,
    // so frame 9 is still pending at the end of the stream.
    expect([last.hours, last.minutes, last.seconds, last.frames]).toEqual([10, 20, 30, 8]);
    expect(got.map((f) => f.frames)).toEqual(got.map((_, i) => 9 - got.length + i));
  });
});
