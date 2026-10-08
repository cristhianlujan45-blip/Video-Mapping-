/**
 * MIDI 1.0 byte-stream decoding into normalized control events, with:
 *  - automatic 14-bit CC detection (MSB 0-31 + LSB 32-63) → same address, higher resolution
 *  - NRPN (CC 99/98 + 6/38) → "nrpn:<ch>:<param>" 14-bit
 *  - pitch bend 14-bit, aftertouch, program change
 *  - relative encoder decoding helpers
 *  - feedback encoding (LEDs, motor faders)
 * Channels are 1-based in addresses (1..16).
 */
import type { Mapping, RelativeEncoding } from '../params/types';

export interface MidiControlEvent {
  control: string;
  /** 0..1 */
  value: number;
  /** Raw 7-bit value when the event came from a 7-bit message (relative encoders). */
  raw?: number;
  /** Bit depth of `value`. */
  bits: 7 | 14;
  type: 'note' | 'cc' | 'nrpn' | 'pitchbend' | 'aftertouch' | 'polyAftertouch' | 'program';
  channel: number;
  number: number;
  velocity?: number;
}

export type MidiRealtime = { type: 'clock' } | { type: 'start' } | { type: 'continue' } | { type: 'stop' } | { type: 'songPosition'; beats: number };

export interface MidiDecodeResult {
  controls: MidiControlEvent[];
  realtime: MidiRealtime[];
  mtcQuarter: { piece: number; value: number }[];
  mtcFull: { h: number; m: number; s: number; f: number; rate: number } | null;
  sysex: Uint8Array | null;
}

/** Per-input-port decoder state (14-bit pairing, NRPN selection). */
export class MidiDecoder {
  private msb = new Map<string, { value: number; t: number }>();
  /** Controllers detected as 14-bit on this port: "<ch>:<num>". */
  readonly highRes = new Set<string>();
  private nrpnSel = new Map<number, { msb: number; lsb: number; dataMsb: number }>();

  constructor(private now: () => number = () => performance.now()) {}

  decode(bytes: Uint8Array | number[]): MidiDecodeResult {
    const res: MidiDecodeResult = { controls: [], realtime: [], mtcQuarter: [], mtcFull: null, sysex: null };
    const b = bytes;
    if (b.length === 0) return res;
    const status = b[0];
    if (status >= 0xf8) {
      if (status === 0xf8) res.realtime.push({ type: 'clock' });
      else if (status === 0xfa) res.realtime.push({ type: 'start' });
      else if (status === 0xfb) res.realtime.push({ type: 'continue' });
      else if (status === 0xfc) res.realtime.push({ type: 'stop' });
      return res;
    }
    if (status === 0xf2 && b.length >= 3) {
      res.realtime.push({ type: 'songPosition', beats: b[1] | (b[2] << 7) });
      return res;
    }
    if (status === 0xf1 && b.length >= 2) {
      res.mtcQuarter.push({ piece: (b[1] >> 4) & 0x07, value: b[1] & 0x0f });
      return res;
    }
    if (status === 0xf0) {
      const arr = Uint8Array.from(b);
      res.sysex = arr;
      // MTC full frame: F0 7F <dev> 01 01 hh mm ss ff F7
      if (arr.length >= 10 && arr[1] === 0x7f && arr[3] === 0x01 && arr[4] === 0x01) {
        const hh = arr[5];
        res.mtcFull = { rate: (hh >> 5) & 0x03, h: hh & 0x1f, m: arr[6], s: arr[7], f: arr[8] };
      }
      return res;
    }
    const kind = status & 0xf0;
    const ch = (status & 0x0f) + 1;
    switch (kind) {
      case 0x90:
      case 0x80: {
        const note = b[1];
        const vel = kind === 0x80 ? 0 : b[2];
        res.controls.push({ control: `note:${ch}:${note}`, value: vel / 127, raw: vel, bits: 7, type: 'note', channel: ch, number: note, velocity: vel });
        break;
      }
      case 0xb0:
        this.decodeCC(ch, b[1], b[2], res);
        break;
      case 0xe0: {
        const v = b[1] | (b[2] << 7);
        res.controls.push({ control: `pb:${ch}`, value: v / 16383, bits: 14, type: 'pitchbend', channel: ch, number: 0 });
        break;
      }
      case 0xd0:
        res.controls.push({ control: `at:${ch}`, value: b[1] / 127, raw: b[1], bits: 7, type: 'aftertouch', channel: ch, number: 0 });
        break;
      case 0xa0:
        res.controls.push({ control: `pat:${ch}:${b[1]}`, value: b[2] / 127, raw: b[2], bits: 7, type: 'polyAftertouch', channel: ch, number: b[1] });
        break;
      case 0xc0:
        res.controls.push({ control: `pc:${ch}:${b[1]}`, value: 1, raw: b[1], bits: 7, type: 'program', channel: ch, number: b[1] });
        break;
    }
    return res;
  }

  private decodeCC(ch: number, num: number, val: number, res: MidiDecodeResult) {
    // NRPN parameter select / data entry
    if (num === 99 || num === 98 || num === 6 || num === 38) {
      let sel = this.nrpnSel.get(ch);
      if (num === 99) {
        sel = { msb: val, lsb: sel?.lsb ?? -1, dataMsb: 0 };
        this.nrpnSel.set(ch, sel);
        return;
      }
      if (num === 98) {
        sel = { msb: sel?.msb ?? 0, lsb: val, dataMsb: 0 };
        this.nrpnSel.set(ch, sel);
        return;
      }
      if (sel && sel.lsb >= 0 && !(sel.msb === 127 && sel.lsb === 127)) {
        const param = (sel.msb << 7) | sel.lsb;
        if (num === 6) {
          sel.dataMsb = val;
          res.controls.push({ control: `nrpn:${ch}:${param}`, value: (val << 7) / 16383, bits: 14, type: 'nrpn', channel: ch, number: param });
        } else {
          const v = (sel.dataMsb << 7) | val;
          res.controls.push({ control: `nrpn:${ch}:${param}`, value: v / 16383, bits: 14, type: 'nrpn', channel: ch, number: param });
        }
        return;
      }
      // No NRPN selected: CC 6/38 are plain controllers.
    }
    const t = this.now();
    if (num >= 32 && num < 64) {
      const msbNum = num - 32;
      const key = `${ch}:${msbNum}`;
      const m = this.msb.get(key);
      if (m && t - m.t < 50) {
        this.highRes.add(key);
        const v = (m.value << 7) | val;
        res.controls.push({ control: `cc:${ch}:${msbNum}`, value: v / 16383, bits: 14, type: 'cc', channel: ch, number: msbNum });
        return;
      }
    }
    if (num < 32) {
      const key = `${ch}:${num}`;
      this.msb.set(key, { value: val, t });
      // For a known 14-bit controller wait for the LSB, unless it never comes (coarse moves
      // may send only the MSB): emit MSB-only value right away; the LSB refines it.
      if (this.highRes.has(key)) {
        res.controls.push({ control: `cc:${ch}:${num}`, value: (val << 7) / 16383, bits: 14, type: 'cc', channel: ch, number: num });
        return;
      }
    }
    res.controls.push({ control: `cc:${ch}:${num}`, value: val / 127, raw: val, bits: 7, type: 'cc', channel: ch, number: num });
  }
}

/** Signed ticks from a relative-encoder CC value. */
export function decodeRelative(raw: number, enc: RelativeEncoding = 'twos-complement'): number {
  switch (enc) {
    case 'binary-offset':
      return raw - 64;
    case 'signed-bit':
      return raw & 0x40 ? -(raw & 0x3f) : raw & 0x3f;
    case 'twos-complement':
    default:
      return raw < 64 ? raw : raw - 128;
  }
}

/**
 * Bytes to send back to a controller for a mapping (LED state, motor fader position…).
 * Returns null for controls that cannot receive feedback.
 */
export function encodeFeedback(m: Mapping, normalized: number): number[][] | null {
  const parts = m.source.control.split(':');
  const type = parts[0];
  const ch = Math.max(1, Math.min(16, Number(parts[1]) || 1)) - 1;
  const n = Math.max(0, Math.min(1, normalized));
  switch (type) {
    case 'note': {
      const vel = Math.round(n * 127);
      return [[0x90 | ch, Number(parts[2]) & 0x7f, vel]];
    }
    case 'cc': {
      const num = Number(parts[2]) & 0x7f;
      return [[0xb0 | ch, num, Math.round(n * 127)]];
    }
    case 'cc14': {
      const num = Number(parts[2]) & 0x1f;
      const v = Math.round(n * 16383);
      return [
        [0xb0 | ch, num, v >> 7],
        [0xb0 | ch, num + 32, v & 0x7f],
      ];
    }
    case 'pb': {
      const v = Math.round(n * 16383);
      return [[0xe0 | ch, v & 0x7f, v >> 7]];
    }
    case 'nrpn': {
      const param = Number(parts[2]);
      const v = Math.round(n * 16383);
      return [
        [0xb0 | ch, 99, param >> 7],
        [0xb0 | ch, 98, param & 0x7f],
        [0xb0 | ch, 6, v >> 7],
        [0xb0 | ch, 38, v & 0x7f],
      ];
    }
    default:
      return null;
  }
}

export function describeControl(control: string): string {
  const [type, ch, num] = control.split(':');
  switch (type) {
    case 'note':
      return `Nota ${noteName(Number(num))} (${num}) · Canal ${ch}`;
    case 'cc':
      return `CC ${num} · Canal ${ch}`;
    case 'cc14':
      return `CC14 ${num} · Canal ${ch}`;
    case 'nrpn':
      return `NRPN ${num} · Canal ${ch}`;
    case 'pb':
      return `Pitch bend · Canal ${ch}`;
    case 'at':
      return `Aftertouch · Canal ${ch}`;
    case 'pat':
      return `Poly AT ${num} · Canal ${ch}`;
    case 'pc':
      return `Program ${num} · Canal ${ch}`;
    default:
      return control;
  }
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteName = (n: number) => `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;

/** MIDI clock → BPM (24 PPQN), smoothed over the last beat. */
export class MidiClockTracker {
  private ticks: number[] = [];
  running = false;
  tickCount = 0;
  bpm = 0;

  tick(t: number) {
    this.ticks.push(t);
    if (this.ticks.length > 49) this.ticks.shift();
    this.tickCount++;
    if (this.ticks.length >= 7) {
      const span = this.ticks[this.ticks.length - 1] - this.ticks[0];
      const per = span / (this.ticks.length - 1);
      if (per > 0) this.bpm = 60000 / (per * 24);
    }
  }

  start() {
    this.running = true;
    this.tickCount = 0;
  }

  stop() {
    this.running = false;
  }

  /** Beats elapsed since START (song position aware). */
  get beats() {
    return this.tickCount / 24;
  }

  songPosition(sixteenths: number) {
    this.tickCount = sixteenths * 6;
  }
}

export const MTC_RATES = [24, 25, 29.97, 30];

/** Assembles MTC quarter-frame messages into a running timecode. */
export class MtcDecoder {
  private pieces = new Array(8).fill(0);
  private received = 0;
  lastSeconds: number | null = null;
  rate = 30;

  quarter(piece: number, value: number): number | null {
    this.pieces[piece] = value;
    this.received |= 1 << piece;
    if (piece === 7 && this.received === 0xff) {
      this.received = 0;
      const f = this.pieces[0] | (this.pieces[1] << 4);
      const s = this.pieces[2] | (this.pieces[3] << 4);
      const m = this.pieces[4] | (this.pieces[5] << 4);
      const h = this.pieces[6] | ((this.pieces[7] & 0x01) << 4);
      this.rate = MTC_RATES[(this.pieces[7] >> 1) & 0x03];
      // A full quarter-frame sequence spans 2 frames: the time refers to its start.
      this.lastSeconds = h * 3600 + m * 60 + s + (f + 2) / this.rate;
      return this.lastSeconds;
    }
    return null;
  }

  full(h: number, m: number, s: number, f: number, rate: number): number {
    this.rate = MTC_RATES[rate] ?? 30;
    this.received = 0;
    this.lastSeconds = h * 3600 + m * 60 + s + f / this.rate;
    return this.lastSeconds;
  }
}

/** Encodes the 8 quarter-frame messages for a time (MTC out). */
export function encodeMtcQuarterFrames(seconds: number, fps: 24 | 25 | 29.97 | 30): number[][] {
  const rateCode = MTC_RATES.indexOf(fps);
  const totalFrames = Math.floor(seconds * fps);
  const f = totalFrames % Math.round(fps);
  const totalSec = Math.floor(totalFrames / Math.round(fps));
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600) % 24;
  const vals = [f & 0xf, f >> 4, s & 0xf, s >> 4, m & 0xf, m >> 4, h & 0xf, (h >> 4) | (rateCode << 1)];
  return vals.map((v, piece) => [0xf1, (piece << 4) | v]);
}

export function formatTimecode(seconds: number, fps = 30): string {
  const fr = Math.round(fps);
  const total = Math.max(0, Math.floor(seconds * fps));
  const f = total % fr;
  const s = Math.floor(total / fr) % 60;
  const m = Math.floor(total / fr / 60) % 60;
  const h = Math.floor(total / fr / 3600);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(h)}:${p(m)}:${p(s)}:${p(f)}`;
}
