import type { DiscoveredNode, DmxDiagnosticStep, DmxServiceConfig, DmxStats, FromDmx, ToDmx } from '../../shared/dmx/messages';
import type { DmxSettings, FixtureType, Project } from '../../shared/project/model';
import { BUILTIN_FIXTURES } from '../../shared/project/defaults';
import type { ParameterEngine } from '../../shared/params/ParameterEngine';
import { lujan } from '../api';
import { onPort } from './ports';

/**
 * UI side of the DMX service: pushes configuration, fixture channel values (from the
 * parameter engine), blackout/test commands; receives discovered nodes, live stats and
 * DMX input (lighting console → parameters, DMX Learn).
 */
export class DmxClient {
  private port: MessagePort | null = null;
  nodes: DiscoveredNode[] = [];
  stats: DmxStats | null = null;
  diagnostics: DmxDiagnosticStep[] | null = null;
  lastError: string | null = null;
  logs: string[] = [];
  /** Last input frame per "protocol:universe" (for the DMX monitor). */
  readonly inputFrames = new Map<string, { data: Uint8Array; source: string; t: number }>();
  private lastInput = new Map<string, Uint8Array>();
  private listeners = new Set<() => void>();
  private lastConfig = '';
  private lastFixtureFrame = '';
  private snapshotWaiters = new Map<string, (u: Record<string, Uint8Array>) => void>();
  connected = false;

  constructor(private engine: ParameterEngine) {
    onPort('dmx:ui', (p) => this.attach(p));
  }

  onChange(l: () => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private changed() {
    for (const l of this.listeners) l();
  }

  private attach(p: MessagePort) {
    this.port?.close();
    this.port = p;
    this.connected = true;
    p.onmessage = (e: MessageEvent<FromDmx>) => this.onMessage(e.data);
    p.start();
    this.lastConfig = '';
    this.lastFixtureFrame = '';
    this.changed();
  }

  private send(m: ToDmx) {
    this.port?.postMessage(m);
  }

  private onMessage(m: FromDmx) {
    switch (m.type) {
      case 'nodes':
        this.nodes = m.nodes;
        break;
      case 'stats':
        this.stats = m.stats;
        break;
      case 'error':
        this.lastError = m.message;
        this.logs.push(`${new Date().toLocaleTimeString()} ${m.message}`);
        break;
      case 'log':
        this.logs.push(`${new Date().toLocaleTimeString()} ${m.message}`);
        break;
      case 'diagnostics':
        this.diagnostics = m.steps;
        break;
      case 'snapshot':
        this.snapshotWaiters.get(m.requestId)?.(m.universes);
        this.snapshotWaiters.delete(m.requestId);
        break;
      case 'input':
        this.onInput(m.protocol, m.universe, m.data, m.source);
        return; // high rate: do not re-render the UI on every packet
    }
    if (this.logs.length > 200) this.logs.splice(0, this.logs.length - 200);
    this.changed();
  }

  private onInput(protocol: 'artnet' | 'sacn', universe: number, data: Uint8Array, source: string) {
    const key = `${protocol}:${universe}`;
    this.inputFrames.set(key, { data, source, t: performance.now() });
    const prev = this.lastInput.get(key);
    // Only changed channels become parameter inputs (DMX Learn picks the moved fader).
    for (let i = 0; i < data.length; i++) {
      if (prev && prev[i] === data[i]) continue;
      this.engine.input({ kind: 'dmx', device: protocol, control: `${universe}:${i + 1}` }, data[i] / 255);
    }
    this.lastInput.set(key, data);
  }

  /** Pushes configuration when the relevant part of the project changed. */
  sync(p: Project, iface: { address: string; netmask: string } | null) {
    const d = p.dmx;
    const cfg: DmxServiceConfig = {
      interfaceAddress: iface?.address ?? null,
      interfaceNetmask: iface?.netmask ?? null,
      fps: d.outputFps,
      syncMode: d.syncMode,
      globalDelayMs: d.globalDelayMs,
      useArtSync: d.useArtSync,
      universes: d.universes.map((u) => ({ id: u.id, name: u.name, protocol: u.protocol === 'usb-pro' ? 'virtual' : u.protocol, number: u.number, destination: u.destination, enabled: u.enabled, delayMs: u.delayMs, priority: u.priority })),
      input: d.input,
      manualNodes: d.manualNodes,
      sourceName: `LUJAN MAPPING Studio · ${p.name}`.slice(0, 63),
    };
    const s = JSON.stringify(cfg);
    if (s === this.lastConfig) return;
    this.lastConfig = s;
    this.send({ type: 'config', config: cfg });
    void lujan?.invoke('dmx:config', { type: 'config', config: cfg });
  }

  /** Fixture channels from the parameter engine (MIDI/OSC/audio/tracking/timeline/UI) → DMX 'fixtures' layer. */
  pushFixtures(d: DmxSettings, master: number) {
    const types: FixtureType[] = [...BUILTIN_FIXTURES, ...d.fixtureTypes];
    const out: Record<string, Uint8Array> = {};
    for (const f of d.fixtures) {
      const type = types.find((t) => t.id === f.typeId);
      if (!type) continue;
      let buf = out[f.universeId];
      if (!buf) out[f.universeId] = buf = new Uint8Array(512);
      type.channels.forEach((ch, i) => {
        const addr = f.address - 1 + i;
        if (addr < 0 || addr >= 512) return;
        let v = this.engine.value(`fixture.${f.id}.${i}`, ch.default);
        // master scales intensity-like channels only (never pan/tilt/gobo)
        if (['red', 'green', 'blue', 'white', 'amber', 'uv', 'dimmer'].includes(ch.role)) v *= master;
        buf[addr] = Math.max(0, Math.min(255, Math.round(v)));
      });
    }
    const key = JSON.stringify(Object.entries(out).map(([k, v]) => [k, Array.from(v)]));
    if (key === this.lastFixtureFrame) return;
    this.lastFixtureFrame = key;
    if (Object.keys(out).length) this.send({ type: 'frame', layer: 'fixtures', universes: out });
    else this.send({ type: 'clearLayer', layer: 'fixtures' });
  }

  sendSnapshotLayer(universes: Record<string, Uint8Array> | null) {
    if (universes) this.send({ type: 'frame', layer: 'snapshot', universes });
    else this.send({ type: 'clearLayer', layer: 'snapshot' });
  }

  blackout(on: boolean) {
    this.send({ type: 'blackout', on });
  }

  test(mode: 'off' | 'red' | 'green' | 'blue' | 'white' | 'full' | 'chase', universeId?: string) {
    this.send({ type: 'test', mode, universeId });
  }

  discover() {
    this.send({ type: 'discover' });
  }

  diagnose(universeId: string | null) {
    this.diagnostics = null;
    this.changed();
    this.send({ type: 'diagnose', universeId });
  }

  capture(): Promise<Record<string, Uint8Array>> {
    const id = Math.random().toString(36).slice(2);
    return new Promise((resolve) => {
      this.snapshotWaiters.set(id, resolve);
      this.send({ type: 'snapshotRequest', requestId: id });
      setTimeout(() => {
        if (this.snapshotWaiters.delete(id)) resolve({});
      }, 2000);
    });
  }
}
