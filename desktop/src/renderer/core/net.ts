import type { FromNet, NetConfig, RemoteCommand, RemoteState, ToNet } from '../../shared/net/messages';
import type { Project } from '../../shared/project/model';
import type { ParameterEngine } from '../../shared/params/ParameterEngine';
import { lujan } from '../api';
import { onPort } from './ports';

export interface NetStatus {
  osc: { listening: boolean; port: number; error: string | null; messagesPerSec: number };
  remote: { listening: boolean; urls: string[]; clients: number; error: string | null };
}

/**
 * OSC in/out and the remote-control server. Incoming OSC:
 *  - any address can be MIDI-learn-style mapped (InputAddress kind "osc")
 *  - /lujan/param/<paramId> <value>   → sets a parameter in its own units
 *  - /lujan/trigger/<paramId>         → fires a trigger parameter
 *  - /lujan/scene/<n>                 → scene n (1-based) to program
 *  - /lujan/blackout <0|1>, /lujan/play, /lujan/pause, /lujan/stop, /lujan/next, /lujan/previous
 *  - /lujan/time <seconds>            → external OSC time for the timeline
 */
export class NetClient {
  private port: MessagePort | null = null;
  status: NetStatus | null = null;
  log: { t: number; address: string; args: string; from: string }[] = [];
  private listeners = new Set<() => void>();
  private lastConfig = '';
  onRemote: ((c: RemoteCommand) => void) | null = null;
  onOscTime: ((seconds: number) => void) | null = null;
  onOscCommand: ((address: string, value: number | null) => boolean) | null = null;

  constructor(private engine: ParameterEngine) {
    onPort('net:ui', (p) => {
      this.port?.close();
      this.port = p;
      p.onmessage = (e: MessageEvent<FromNet>) => this.onMessage(e.data);
      p.start();
      this.lastConfig = '';
    });
  }

  onChange(l: () => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private changed() {
    for (const l of this.listeners) l();
  }

  private send(m: ToNet) {
    this.port?.postMessage(m);
  }

  private onMessage(m: FromNet) {
    switch (m.type) {
      case 'status':
        this.status = { osc: m.osc, remote: m.remote };
        this.changed();
        break;
      case 'osc':
        this.onOsc(m.address, m.args, m.from);
        break;
      case 'remote':
        this.onRemote?.(m.command);
        break;
      case 'log':
        break;
    }
  }

  private onOsc(address: string, args: (number | string | boolean | null)[], from: string) {
    this.log.push({ t: performance.now(), address, args: args.map(String).join(' '), from });
    if (this.log.length > 500) this.log.splice(0, this.log.length - 500);
    const first = args.find((a) => typeof a === 'number' || typeof a === 'boolean');
    const num = typeof first === 'boolean' ? (first ? 1 : 0) : typeof first === 'number' ? first : null;
    if (address.startsWith('/lujan/param/')) {
      const id = address.slice('/lujan/param/'.length);
      if (num !== null) this.engine.set(id, num, 'osc');
      return;
    }
    if (address.startsWith('/lujan/trigger/')) {
      this.engine.fireTrigger(address.slice('/lujan/trigger/'.length), 'osc');
      return;
    }
    if (address === '/lujan/time' && num !== null) {
      this.onOscTime?.(num);
      return;
    }
    if (address.startsWith('/lujan/') && this.onOscCommand?.(address, num)) return;
    // Generic: normalized 0..1 input for learned mappings.
    this.engine.input({ kind: 'osc', device: 'osc', control: address }, num === null ? 1 : Math.max(0, Math.min(1, num)));
  }

  async sync(p: Project) {
    const cfg: NetConfig = {
      osc: { enabled: p.osc.enabled, inPort: p.osc.inPort, outHost: p.osc.outHost, outPort: p.osc.outPort },
      remote: p.remote,
      remoteRoot: (await lujan?.invoke<string>('net:remoteRoot')) ?? '',
    };
    const s = JSON.stringify(cfg);
    if (s === this.lastConfig) return;
    this.lastConfig = s;
    this.send({ type: 'config', config: cfg });
    void lujan?.invoke('net:config', { type: 'config', config: cfg });
  }

  oscSend(address: string, args: (number | string | boolean)[]) {
    this.send({ type: 'oscSend', address, args });
  }

  publishRemote(state: RemoteState) {
    this.send({ type: 'remoteState', state });
  }
}
