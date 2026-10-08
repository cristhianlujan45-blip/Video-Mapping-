import { describe, expect, it } from 'vitest';
import { decodeRelative, encodeFeedback, encodeMtcQuarterFrames, MidiClockTracker, MidiDecoder, MtcDecoder, formatTimecode } from '../src/shared/midi/midi';
import { decodeMessage, decodePacket, encodeBundle, encodeMessage, firstNumber, matchAddress, type OscBundle } from '../src/shared/osc/osc';

describe('MIDI decoder', () => {
  it('decodes notes and 7-bit CCs with 1-based channels', () => {
    const d = new MidiDecoder(() => 0);
    const n = d.decode([0x92, 60, 100]).controls[0];
    expect(n.control).toBe('note:3:60');
    expect(n.value).toBeCloseTo(100 / 127);
    expect(d.decode([0x82, 60, 0]).controls[0].value).toBe(0);
    expect(d.decode([0x92, 60, 0]).controls[0].value).toBe(0);
    const cc = d.decode([0xb0, 7, 127]).controls[0];
    expect(cc.control).toBe('cc:1:7');
    expect(cc.value).toBe(1);
  });

  it('pairs MSB/LSB into high-resolution values on the same address', () => {
    let t = 0;
    const d = new MidiDecoder(() => t);
    d.decode([0xb0, 1, 64]);
    t = 1;
    const r = d.decode([0xb0, 33, 64]).controls[0];
    expect(r.control).toBe('cc:1:1');
    expect(r.bits).toBe(14);
    expect(r.value).toBeCloseTo(((64 << 7) | 64) / 16383, 6);
    expect(d.highRes.has('1:1')).toBe(true);
  });

  it('decodes NRPN and pitch bend', () => {
    const d = new MidiDecoder(() => 0);
    d.decode([0xb0, 99, 1]);
    d.decode([0xb0, 98, 2]);
    d.decode([0xb0, 6, 100]);
    const r = d.decode([0xb0, 38, 5]).controls[0];
    expect(r.control).toBe('nrpn:1:130');
    expect(r.value).toBeCloseTo(((100 << 7) | 5) / 16383, 6);
    const pb = d.decode([0xe0, 0, 64]).controls[0];
    expect(pb.control).toBe('pb:1');
    expect(pb.value).toBeCloseTo(8192 / 16383, 4);
  });

  it('relative encodings', () => {
    expect(decodeRelative(1)).toBe(1);
    expect(decodeRelative(127)).toBe(-1);
    expect(decodeRelative(65, 'binary-offset')).toBe(1);
    expect(decodeRelative(63, 'binary-offset')).toBe(-1);
    expect(decodeRelative(0x41, 'signed-bit')).toBe(-1);
  });

  it('feedback bytes for notes, CC and motor faders', () => {
    const base = { id: 'm', enabled: true, target: 'x', min: 0, max: 1, invert: false, mode: 'absolute' as const, curve: 1, softTakeover: false, amount: 1, feedback: true };
    expect(encodeFeedback({ ...base, source: { kind: 'midi', device: 'd', control: 'note:2:36' } }, 1)).toEqual([[0x91, 36, 127]]);
    expect(encodeFeedback({ ...base, source: { kind: 'midi', device: 'd', control: 'pb:1' } }, 1)).toEqual([[0xe0, 127, 127]]);
  });

  it('MTC quarter frames round-trip and clock BPM', () => {
    const msgs = encodeMtcQuarterFrames(3723.5, 25);
    const dec = new MtcDecoder();
    let t: number | null = null;
    for (const m of msgs) t = dec.quarter((m[1] >> 4) & 7, m[1] & 0xf) ?? t;
    expect(dec.rate).toBe(25);
    // quantized to frame 12 (3723.48 s) + 2 frames of quarter-frame latency
    expect(t!).toBeCloseTo(3723.48 + 2 / 25, 3);
    expect(formatTimecode(3723.5, 25)).toBe('01:02:03:12');
    const clk = new MidiClockTracker();
    for (let i = 0; i < 48; i++) clk.tick(i * (500 / 24));
    expect(clk.bpm).toBeCloseTo(120, 3);
  });
});

describe('OSC', () => {
  it('round-trips messages with mixed types', () => {
    const buf = encodeMessage({
      address: '/layer/1/opacity',
      args: [
        { type: 'f', value: 0.5 },
        { type: 'i', value: -3 },
        { type: 's', value: 'hola' },
        { type: 'T', value: true },
      ],
    });
    expect(buf.length % 4).toBe(0);
    const m = decodeMessage(buf);
    expect(m.address).toBe('/layer/1/opacity');
    expect(firstNumber(m)).toBeCloseTo(0.5);
    expect(m.args[2]).toEqual({ type: 's', value: 'hola' });
    expect(m.args[3].type).toBe('T');
  });

  it('bundles', () => {
    const b: OscBundle = { timetag: 1n, elements: [{ address: '/a', args: [{ type: 'i', value: 1 }] }, { address: '/b', args: [] }] };
    const d = decodePacket(encodeBundle(b)) as OscBundle;
    expect(d.elements).toHaveLength(2);
  });

  it('address patterns', () => {
    expect(matchAddress('/layer/*/opacity', '/layer/3/opacity')).toBe(true);
    expect(matchAddress('/layer/[1-3]/opacity', '/layer/4/opacity')).toBe(false);
    expect(matchAddress('/fx/{glow,blur}', '/fx/blur')).toBe(true);
  });
});
