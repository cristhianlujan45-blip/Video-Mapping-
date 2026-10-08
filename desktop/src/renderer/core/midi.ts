import { describeControl, encodeFeedback, encodeMtcQuarterFrames, MidiClockTracker, MidiDecoder, MtcDecoder } from '../../shared/midi/midi';
import type { ParameterEngine } from '../../shared/params/ParameterEngine';
import type { Mapping } from '../../shared/params/types';
import { logToMain } from '../api';

export interface MidiPortInfo {
  id: string;
  name: string;
  manufacturer: string;
  type: 'input' | 'output';
  state: 'connected' | 'disconnected';
  connection: string;
  version: string;
  enabled: boolean;
  messages: number;
}

export interface MidiLogEntry {
  t: number;
  device: string;
  port: string;
  dir: 'in' | 'out';
  channel: number | null;
  type: string;
  data: string;
  control: string | null;
  value: number | null;
}

export interface MidiRoute {
  id: string;
  from: string;
  to: string;
  /** Only these channels (empty = all). */
  channels: number[];
  enabled: boolean;
}

/**
 * Web MIDI (Windows MIDI Services / WinMM through Chromium): USB, Bluetooth (when paired
 * in Windows) and network MIDI drivers all appear as ports. Hot-plug safe: a
 * disconnected controller never blocks; on reconnect its feedback state is resent so
 * LEDs/motor faders match the software again.
 */
export class MidiManager {
  private access: MIDIAccess | null = null;
  private decoders = new Map<string, MidiDecoder>();
  readonly ports = new Map<string, MidiPortInfo>();
  readonly log: MidiLogEntry[] = [];
  logPaused = false;
  logFilter: { device?: string; type?: string } = {};
  readonly clock = new MidiClockTracker();
  readonly mtc = new MtcDecoder();
  routes: MidiRoute[] = [];
  disabledInputs = new Set<string>();
  disabledOutputs = new Set<string>();
  error: string | null = null;
  private listeners = new Set<() => void>();
  onClock: ((e: 'tick' | 'start' | 'stop' | 'continue', t: number) => void) | null = null;
  onTimecode: ((seconds: number) => void) | null = null;
  private feedbackQueue = new Map<string, { device: string; msgs: number[][] }>();
  private flushScheduled = false;

  constructor(private engine: ParameterEngine) {
    engine.onFeedback((m, n) => this.feedback(m, n));
  }

  onChange(l: () => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private changed() {
    for (const l of this.listeners) l();
  }

  async init() {
    if (!navigator.requestMIDIAccess) {
      this.error = 'Este entorno no expone Web MIDI.';
      return;
    }
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: true });
    } catch {
      try {
        this.access = await navigator.requestMIDIAccess({ sysex: false });
      } catch (e) {
        this.error = `Acceso MIDI denegado: ${(e as Error).message}`;
        this.changed();
        return;
      }
    }
    this.access.onstatechange = (e) => this.onState((e as MIDIConnectionEvent).port!);
    for (const p of this.access.inputs.values()) this.attachInput(p);
    for (const p of this.access.outputs.values()) this.registerPort(p);
    this.changed();
  }

  private registerPort(p: MIDIPort) {
    const prev = this.ports.get(p.id);
    this.ports.set(p.id, {
      id: p.id,
      name: p.name ?? 'MIDI',
      manufacturer: p.manufacturer ?? '',
      type: p.type,
      state: p.state,
      connection: p.connection,
      version: p.version ?? '',
      enabled: p.type === 'input' ? !this.disabledInputs.has(p.name ?? '') : !this.disabledOutputs.has(p.name ?? ''),
      messages: prev?.messages ?? 0,
    });
  }

  private attachInput(p: MIDIInput) {
    this.registerPort(p);
    if (!this.decoders.has(p.id)) this.decoders.set(p.id, new MidiDecoder());
    p.onmidimessage = (ev) => this.onMessage(p, ev as MIDIMessageEvent);
  }

  private onState(p: MIDIPort) {
    const wasConnected = this.ports.get(p.id)?.state === 'connected';
    if (p.type === 'input') this.attachInput(p as MIDIInput);
    else this.registerPort(p);
    if (p.state === 'connected' && !wasConnected) {
      logToMain('INFO', 'midi', `Conectado: ${p.name} (${p.type})`);
      // Restore mappings: mappings are keyed by device name, so they work again as is;
      // push current values back to LEDs / motor faders.
      if (p.type === 'output') setTimeout(() => this.engine.resendFeedback(p.name ?? undefined), 300);
    } else if (p.state === 'disconnected' && wasConnected) logToMain('WARN', 'midi', `Desconectado: ${p.name}`);
    this.changed();
  }

  private onMessage(port: MIDIInput, ev: MIDIMessageEvent) {
    const data = ev.data;
    if (!data || data.length === 0) return;
    const name = port.name ?? 'MIDI';
    if (this.disabledInputs.has(name)) return;
    const info = this.ports.get(port.id);
    if (info) info.messages++;
    // routing / MIDI thru
    for (const r of this.routes) {
      if (!r.enabled || r.from !== name) continue;
      const ch = data[0] < 0xf0 ? (data[0] & 0x0f) + 1 : null;
      if (r.channels.length && ch !== null && !r.channels.includes(ch)) continue;
      this.sendRaw(r.to, [...data]);
    }
    const dec = this.decoders.get(port.id) ?? new MidiDecoder();
    const res = dec.decode(data);
    const t = ev.timeStamp;
    for (const rt of res.realtime) {
      if (rt.type === 'clock') {
        this.clock.tick(t);
        this.onClock?.('tick', t);
      } else if (rt.type === 'start') {
        this.clock.start();
        this.onClock?.('start', t);
      } else if (rt.type === 'stop') {
        this.clock.stop();
        this.onClock?.('stop', t);
      } else if (rt.type === 'continue') {
        this.clock.running = true;
        this.onClock?.('continue', t);
      } else if (rt.type === 'songPosition') this.clock.songPosition(rt.beats);
    }
    for (const q of res.mtcQuarter) {
      const s = this.mtc.quarter(q.piece, q.value);
      if (s !== null) this.onTimecode?.(s);
    }
    if (res.mtcFull) this.onTimecode?.(this.mtc.full(res.mtcFull.h, res.mtcFull.m, res.mtcFull.s, res.mtcFull.f, res.mtcFull.rate));
    for (const c of res.controls) {
      this.engine.input({ kind: 'midi', device: name, control: c.control }, c.value, c.raw !== undefined ? { raw: c.raw } : undefined);
      this.addLog({ t: performance.now(), device: name, port: port.id, dir: 'in', channel: c.channel, type: c.type, data: hex(data), control: describeControl(c.control), value: c.bits === 14 ? Math.round(c.value * 16383) : c.raw ?? Math.round(c.value * 127) });
    }
    if (res.controls.length === 0 && res.realtime.length === 0) {
      this.addLog({ t: performance.now(), device: name, port: port.id, dir: 'in', channel: null, type: res.sysex ? 'SysEx' : res.mtcQuarter.length ? 'MTC' : 'Otro', data: hex(data), control: null, value: null });
    }
  }

  private addLog(e: MidiLogEntry) {
    if (this.logPaused) return;
    this.log.push(e);
    if (this.log.length > 1000) this.log.splice(0, this.log.length - 1000);
  }

  // ---------------------------------------------------------------- output

  outputByName(name: string): MIDIOutput | null {
    if (!this.access) return null;
    for (const o of this.access.outputs.values()) if (o.name === name && o.state === 'connected') return o;
    // Many controllers expose "<Name>" for input and "<Name>" or "MIDIOUT2 (<Name>)" for output
    for (const o of this.access.outputs.values()) if (o.state === 'connected' && (o.name ?? '').includes(name)) return o;
    return null;
  }

  sendRaw(deviceName: string, bytes: number[]) {
    if (this.disabledOutputs.has(deviceName)) return;
    const out = this.outputByName(deviceName);
    if (!out) return;
    try {
      out.send(bytes);
      this.addLog({ t: performance.now(), device: deviceName, port: out.id, dir: 'out', channel: bytes[0] < 0xf0 ? (bytes[0] & 15) + 1 : null, type: 'out', data: hex(bytes), control: null, value: null });
    } catch (e) {
      logToMain('WARN', 'midi', `Envío a ${deviceName}: ${(e as Error).message}`);
    }
  }

  private feedback(m: Mapping, n: number) {
    if (m.source.kind !== 'midi') return;
    const msgs = encodeFeedback(m, n);
    if (!msgs) return;
    // coalesce feedback within a frame (a fader sweep must not flood the controller)
    this.feedbackQueue.set(`${m.source.device}|${m.source.control}`, { device: m.source.device, msgs });
    if (!this.flushScheduled) {
      this.flushScheduled = true;
      requestAnimationFrame(() => {
        this.flushScheduled = false;
        for (const { device, msgs: list } of this.feedbackQueue.values()) for (const bytes of list) this.sendRaw(device, bytes);
        this.feedbackQueue.clear();
      });
    }
  }

  /** MIDI clock out (24 ppqn) and MTC out from the show clock. */
  sendClockTick(device: string) {
    this.sendRaw(device, [0xf8]);
  }

  sendMtc(device: string, seconds: number, fps: 24 | 25 | 29.97 | 30) {
    for (const m of encodeMtcQuarterFrames(seconds, fps)) this.sendRaw(device, m);
  }

  setEnabled(name: string, type: 'input' | 'output', enabled: boolean) {
    const set = type === 'input' ? this.disabledInputs : this.disabledOutputs;
    if (enabled) set.delete(name);
    else set.add(name);
    for (const p of this.ports.values()) if (p.name === name && p.type === type) p.enabled = enabled;
    this.changed();
  }

  inputs(): MidiPortInfo[] {
    return [...this.ports.values()].filter((p) => p.type === 'input');
  }

  outputs(): MidiPortInfo[] {
    return [...this.ports.values()].filter((p) => p.type === 'output');
  }

  get available() {
    return !!this.access;
  }

  release() {
    if (!this.access) return;
    for (const p of this.access.inputs.values()) {
      p.onmidimessage = null;
      void p.close();
    }
    for (const p of this.access.outputs.values()) void p.close();
    this.access.onstatechange = null;
  }
}

const hex = (d: ArrayLike<number>) => Array.from(d, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
