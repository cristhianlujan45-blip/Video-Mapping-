import { describe, expect, it } from 'vitest';
import { ParameterEngine } from '../src/shared/params/ParameterEngine';
import type { InputAddress } from '../src/shared/params/types';

const knob: InputAddress = { kind: 'midi', device: 'APC40', control: 'cc:1:48' };
const pad: InputAddress = { kind: 'midi', device: 'APC40', control: 'note:1:53' };

function engine() {
  const e = new ParameterEngine();
  e.register({ id: 'fx.glow', name: 'Glow', type: 'float', min: 0, max: 1, default: 0.2 });
  e.register({ id: 'layer.1.visible', name: 'Visible', type: 'bool', min: 0, max: 1, default: 1 });
  e.register({ id: 'show.next', name: 'Next', type: 'trigger', min: 0, max: 1, default: 0 });
  return e;
}

describe('ParameterEngine', () => {
  it('clamps and types values', () => {
    const e = engine();
    e.set('fx.glow', 4);
    expect(e.value('fx.glow')).toBe(1);
    e.set('layer.1.visible', 0.3);
    expect(e.value('layer.1.visible')).toBe(0);
  });

  it('MIDI learn creates a mapping from the next input', () => {
    const e = engine();
    let learned: string | null = null;
    e.startLearn('fx.glow', (r) => (learned = r.mapping.id));
    e.input(knob, 0.5);
    expect(learned).not.toBeNull();
    expect(e.value('fx.glow')).toBe(0.2); // learning does not move the param
    e.input(knob, 0.75);
    expect(e.value('fx.glow')).toBeCloseTo(0.75);
  });

  it('override mode: last write wins across sources', () => {
    const e = engine();
    e.addMapping({ source: knob, target: 'fx.glow' });
    e.input(knob, 0.9);
    expect(e.value('fx.glow')).toBeCloseTo(0.9);
    e.set('fx.glow', 0.1, 'osc');
    expect(e.value('fx.glow')).toBeCloseTo(0.1);
  });

  it('add / multiply / max / min / merge modes', () => {
    const e = engine();
    e.set('fx.glow', 0.2);
    e.setMergeMode('fx.glow', 'add');
    e.set('fx.glow', 0.3, 'audio');
    expect(e.value('fx.glow')).toBeCloseTo(0.5);
    e.setMergeMode('fx.glow', 'multiply');
    e.set('fx.glow', 0.5, 'audio');
    expect(e.value('fx.glow')).toBeCloseTo(0.1);
    e.setMergeMode('fx.glow', 'max');
    expect(e.value('fx.glow')).toBeCloseTo(0.5);
    e.setMergeMode('fx.glow', 'min');
    expect(e.value('fx.glow')).toBeCloseTo(0.2);
    e.setMergeMode('fx.glow', 'merge');
    expect(e.value('fx.glow')).toBeCloseTo(0.35);
    e.release('fx.glow', 'audio');
    expect(e.value('fx.glow')).toBeCloseTo(0.2);
  });

  it('soft takeover waits until the control reaches the current value', () => {
    const e = engine();
    const m = e.addMapping({ source: knob, target: 'fx.glow', softTakeover: true });
    e.set('fx.glow', 0.6);
    e.input(knob, 0.1);
    expect(e.value('fx.glow')).toBeCloseTo(0.6);
    e.input(knob, 0.3);
    expect(e.value('fx.glow')).toBeCloseTo(0.6);
    e.input(knob, 0.65); // crossed 0.6 → picked up
    expect(e.isPickedUp(m.id)).toBe(true);
    expect(e.value('fx.glow')).toBeCloseTo(0.65);
    e.input(knob, 0.7);
    expect(e.value('fx.glow')).toBeCloseTo(0.7);
    e.set('fx.glow', 0.1, 'ui'); // UI moved it → pickup lost
    e.input(knob, 0.72);
    expect(e.value('fx.glow')).toBeCloseTo(0.1);
  });

  it('toggle and momentary buttons, triggers on rising edge', () => {
    const e = engine();
    e.addMapping({ source: pad, target: 'layer.1.visible', mode: 'toggle' });
    e.input(pad, 1);
    expect(e.value('layer.1.visible')).toBe(0);
    e.input(pad, 0);
    e.input(pad, 1);
    expect(e.value('layer.1.visible')).toBe(1);
    let fired = 0;
    e.onTrigger(() => fired++);
    const pad2 = { ...pad, control: 'note:1:54' };
    e.addMapping({ source: pad2, target: 'show.next' });
    e.input(pad2, 1);
    e.input(pad2, 1);
    e.input(pad2, 0);
    e.input(pad2, 1);
    expect(fired).toBe(2);
  });

  it('relative encoders change by ticks', () => {
    const e = engine();
    e.addMapping({ source: knob, target: 'fx.glow', mode: 'relative', step: 0.1 });
    e.input(knob, 0, { ticks: 2 });
    expect(e.value('fx.glow')).toBeCloseTo(0.4);
    e.input(knob, 0, { raw: 127 }); // two's complement −1
    expect(e.value('fx.glow')).toBeCloseTo(0.3);
  });

  it('modifiers shadow the plain mapping, banks gate mappings', () => {
    const e = engine();
    e.register({ id: 'fx.blur', name: 'Blur', type: 'float', min: 0, max: 1, default: 0 });
    e.addMapping({ source: knob, target: 'fx.glow' });
    e.addMapping({ source: knob, target: 'fx.blur', modifier: 'SHIFT' });
    e.input(knob, 0.9);
    expect(e.value('fx.glow')).toBeCloseTo(0.9);
    e.setModifier('SHIFT', true);
    e.input(knob, 0.4);
    expect(e.value('fx.glow')).toBeCloseTo(0.9);
    expect(e.value('fx.blur')).toBeCloseTo(0.4);
    e.setModifier('SHIFT', false);
    const k2 = { ...knob, control: 'cc:1:49' };
    e.addMapping({ source: k2, target: 'fx.blur', bank: 'Effects' });
    e.input(k2, 1);
    expect(e.value('fx.blur')).toBeCloseTo(0.4);
    e.activeBank = 'Effects';
    e.input(k2, 1);
    expect(e.value('fx.blur')).toBeCloseTo(1);
  });

  it('feedback goes back to the controller when another source changes the param', () => {
    const e = engine();
    const sent: number[] = [];
    e.onFeedback((_m, n) => sent.push(n));
    e.addMapping({ source: knob, target: 'fx.glow' });
    e.input(knob, 0.5); // own change: no echo
    expect(sent).toEqual([]);
    e.set('fx.glow', 0.25, 'osc');
    expect(sent).toEqual([0.25]);
  });

  it('flush batches changes once per tick', () => {
    const e = engine();
    e.set('fx.glow', 0.3);
    e.set('fx.glow', 0.4);
    const c = e.flush();
    expect(c).toHaveLength(1);
    expect(c[0].value).toBeCloseTo(0.4);
    expect(e.flush()).toHaveLength(0);
  });
});
