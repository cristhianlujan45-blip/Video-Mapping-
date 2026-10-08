import dgram from 'node:dgram';
import { ARTNET_PORT, decodeArtDmx, decodeArtPollReply, encodeArtDmx, encodeArtPoll, encodeArtSync, isArtNet, opcode, OP_DMX, OP_POLL_REPLY } from '../shared/dmx/artnet';
import { decodeSacnData, encodeSacnData, multicastAddress, randomCid, SACN_PORT } from '../shared/dmx/sacn';
import type { DiscoveredNode, DmxDiagnosticStep, DmxServiceConfig, DmxStats, FromDmx, ToDmx, UniverseConfig } from '../shared/dmx/messages';

export interface DmxEngineOptions {
  artnetPort?: number;
  sacnPort?: number;
  /** Listen on the Art-Net port for replies/input (false in tests: replies come to the send socket). */
  receive?: boolean;
  now?: () => number;
}

interface Frame {
  t: number;
  data: Uint8Array;
}

const ipToInt = (ip: string) => ip.split('.').reduce((a, o) => ((a << 8) | (Number(o) & 0xff)) >>> 0, 0);
const sameSubnet = (a: string, b: string, mask: string) => ((ipToInt(a) & ipToInt(mask)) >>> 0) === ((ipToInt(b) & ipToInt(mask)) >>> 0);
const directedBroadcast = (ip: string, mask: string) => {
  const i = ip.split('.').map(Number);
  const m = mask.split('.').map(Number);
  return i.map((o, k) => (o | (~m[k] & 0xff)) & 0xff).join('.');
};

/**
 * Art-Net / sACN output and input engine. Runs in its own process so a dead node, a
 * blocked socket or a network storm can never stall rendering or the UI.
 *
 * Output = HTP merge of every producer layer, unless blackout/test overrides it.
 * In "sync" mode frames are delayed (global + per-universe delay) to line up with
 * projector latency; in "immediate" mode they go out on the next tick.
 */
export class DmxEngine {
  private cfg: DmxServiceConfig | null = null;
  private sendSock: dgram.Socket | null = null;
  private artRecv: dgram.Socket | null = null;
  private sacnRecv: dgram.Socket | null = null;
  private bound = false;
  private layers = new Map<string, Map<string, Uint8Array>>();
  private merged = new Map<string, Uint8Array>();
  private history = new Map<string, Frame[]>();
  private seq = new Map<string, number>();
  private sacnSeq = new Map<string, number>();
  private cid = randomCid();
  private timer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private statsTimer: NodeJS.Timeout | null = null;
  private nodes = new Map<string, DiscoveredNode>();
  private blackout = false;
  private test: { mode: string; universeId?: string } = { mode: 'off' };
  private testPhase = 0;
  private counters = { frames: 0, packets: 0, bytes: 0, errors: 0, input: 0, latency: 0, latencyN: 0 };
  private lastError: string | null = null;
  private lastFrameIn = 0;
  private stats: DmxStats = { fps: 0, packetsPerSec: 0, bytesPerSec: 0, sendErrors: 0, lastError: null, universesActive: 0, inputPacketsPerSec: 0, latencyMs: 0, bound: false, blackout: false };
  private inputThrottle = new Map<string, number>();
  private readonly artPort: number;
  private readonly sacnPort: number;
  private readonly now: () => number;
  private readonly receive: boolean;

  constructor(
    private emit: (m: FromDmx) => void,
    opts: DmxEngineOptions = {},
  ) {
    this.artPort = opts.artnetPort ?? ARTNET_PORT;
    this.sacnPort = opts.sacnPort ?? SACN_PORT;
    this.now = opts.now ?? (() => performance.now());
    this.receive = opts.receive ?? true;
  }

  handle(msg: ToDmx) {
    switch (msg.type) {
      case 'config':
        void this.configure(msg.config);
        break;
      case 'frame': {
        let layer = this.layers.get(msg.layer);
        if (!layer) this.layers.set(msg.layer, (layer = new Map()));
        for (const [id, data] of Object.entries(msg.universes)) layer.set(id, data instanceof Uint8Array ? data : new Uint8Array(data as ArrayLike<number>));
        this.lastFrameIn = this.now();
        this.remerge();
        break;
      }
      case 'clearLayer':
        this.layers.delete(msg.layer);
        this.remerge();
        break;
      case 'blackout':
        this.blackout = msg.on;
        // Blackout has absolute priority: send right now, not on the next tick.
        this.tick(true);
        break;
      case 'test':
        this.test = { mode: msg.mode, universeId: msg.universeId };
        this.tick(true);
        break;
      case 'discover':
        this.poll();
        break;
      case 'diagnose':
        void this.diagnose(msg.universeId).then((steps) => this.emit({ type: 'diagnostics', steps }));
        break;
      case 'snapshotRequest': {
        const universes: Record<string, Uint8Array> = {};
        for (const [id, d] of this.merged) universes[id] = d.slice();
        this.emit({ type: 'snapshot', requestId: msg.requestId, universes });
        break;
      }
    }
  }

  private remerge() {
    const ids = new Set<string>();
    for (const l of this.layers.values()) for (const id of l.keys()) ids.add(id);
    const t = this.now();
    for (const id of ids) {
      let out = this.merged.get(id);
      if (!out) this.merged.set(id, (out = new Uint8Array(512)));
      out.fill(0);
      for (const l of this.layers.values()) {
        const d = l.get(id);
        if (!d) continue;
        const n = Math.min(512, d.length);
        for (let i = 0; i < n; i++) if (d[i] > out[i]) out[i] = d[i];
      }
      let h = this.history.get(id);
      if (!h) this.history.set(id, (h = []));
      h.push({ t, data: out.slice() });
      // keep at most ~2 s of history for delay compensation
      while (h.length > 2 && t - h[0].t > 2000) h.shift();
    }
    for (const id of [...this.merged.keys()]) if (!ids.has(id)) this.merged.delete(id);
  }

  async configure(cfg: DmxServiceConfig) {
    const prev = this.cfg;
    this.cfg = cfg;
    const needRebind = !prev || prev.interfaceAddress !== cfg.interfaceAddress || prev.input.enabled !== cfg.input.enabled || prev.input.protocol !== cfg.input.protocol || JSON.stringify(prev.input.universes) !== JSON.stringify(cfg.input.universes);
    if (needRebind) await this.bind();
    if (this.timer) clearInterval(this.timer);
    const fps = Math.max(1, Math.min(60, cfg.fps));
    this.timer = setInterval(() => this.tick(false), 1000 / fps);
    if (!this.pollTimer) this.pollTimer = setInterval(() => this.poll(), 3000);
    if (!this.statsTimer) this.statsTimer = setInterval(() => this.publishStats(), 1000);
    for (const ip of cfg.manualNodes) {
      if (!this.nodes.has(ip)) this.nodes.set(ip, emptyNode(ip, true));
      else this.nodes.get(ip)!.manual = true;
    }
    this.poll();
  }

  private async closeSockets() {
    for (const s of [this.sendSock, this.artRecv, this.sacnRecv]) {
      if (!s) continue;
      try {
        s.close();
      } catch {
        /* already closed */
      }
    }
    this.sendSock = this.artRecv = this.sacnRecv = null;
    this.bound = false;
  }

  private async bind() {
    await this.closeSockets();
    const cfg = this.cfg;
    if (!cfg?.interfaceAddress) {
      this.emit({ type: 'log', message: 'Sin interfaz de red seleccionada: la salida Art-Net/sACN está detenida.' });
      return;
    }
    const iface = cfg.interfaceAddress;
    try {
      // Send socket bound to the chosen interface: packets can only leave through it.
      this.sendSock = await openSocket({ address: iface, port: 0 });
      this.sendSock.setBroadcast(true);
      try {
        this.sendSock.setMulticastInterface(iface);
        this.sendSock.setMulticastTTL(8);
      } catch {
        /* multicast optional */
      }
      this.sendSock.on('message', (b, rinfo) => this.onArtPacket(b, rinfo.address));
      this.sendSock.on('error', (e) => this.fail(`Socket de envío: ${e.message}`));
      this.bound = true;
    } catch (e) {
      this.fail(`No se puede usar la interfaz ${iface}: ${(e as Error).message}`);
      return;
    }
    if (this.receive) try {
      // Art-Net replies and input arrive on 6454; shared so other Art-Net apps keep working.
      this.artRecv = await openSocket({ address: '0.0.0.0', port: this.artPort, reuse: true });
      this.artRecv.setBroadcast(true);
      this.artRecv.on('message', (b, rinfo) => this.onArtPacket(b, rinfo.address));
      this.artRecv.on('error', (e) => this.fail(`Art-Net (entrada): ${e.message}`));
    } catch (e) {
      this.emit({ type: 'log', message: `Puerto Art-Net ${this.artPort} ocupado: el descubrimiento de nodos y la entrada Art-Net no estarán disponibles (${(e as Error).message}).` });
    }
    if (cfg.input.enabled && cfg.input.protocol === 'sacn') {
      try {
        this.sacnRecv = await openSocket({ address: '0.0.0.0', port: this.sacnPort, reuse: true });
        for (const u of cfg.input.universes) {
          try {
            this.sacnRecv.addMembership(multicastAddress(u), iface);
          } catch (e) {
            this.emit({ type: 'log', message: `sACN: no se pudo unir al universo ${u}: ${(e as Error).message}` });
          }
        }
        this.sacnRecv.on('message', (b, rinfo) => this.onSacnPacket(b, rinfo.address));
      } catch (e) {
        this.emit({ type: 'log', message: `Entrada sACN no disponible: ${(e as Error).message}` });
      }
    }
  }

  private fail(message: string) {
    this.lastError = message;
    this.counters.errors++;
    this.emit({ type: 'error', message });
  }

  private onArtPacket(b: Buffer, from: string) {
    const buf = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    if (!isArtNet(buf)) return;
    const op = opcode(buf);
    if (op === OP_POLL_REPLY) {
      const r = decodeArtPollReply(buf);
      if (!r) return;
      const key = `${r.ip}#${r.bindIndex}`;
      const prev = this.nodes.get(key) ?? this.nodes.get(r.ip);
      const node: DiscoveredNode = {
        ip: r.ip,
        shortName: r.shortName,
        longName: r.longName,
        manufacturer: r.manufacturer,
        estaCode: r.estaCode,
        mac: r.mac,
        outputUniverses: r.outputUniverses,
        inputUniverses: r.inputUniverses,
        numPorts: r.numPorts,
        firmware: r.firmware,
        nodeReport: r.nodeReport,
        bindIndex: r.bindIndex,
        lastSeen: this.now(),
        manual: prev?.manual ?? false,
        online: true,
      };
      if (this.nodes.has(r.ip) && key !== r.ip) this.nodes.delete(r.ip);
      this.nodes.set(r.bindIndex > 1 ? key : r.ip, node);
      this.emitNodes();
      return;
    }
    if (op === OP_DMX && this.cfg?.input.enabled && this.cfg.input.protocol === 'artnet') {
      // Ignore our own packets looping back.
      if (from === this.cfg.interfaceAddress) return;
      const d = decodeArtDmx(buf);
      if (!d || !this.cfg.input.universes.includes(d.portAddress)) return;
      this.counters.input++;
      this.forwardInput('artnet', d.portAddress, d.data, from);
    }
  }

  private onSacnPacket(b: Buffer, from: string) {
    const d = decodeSacnData(new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
    if (!d || d.preview || !this.cfg?.input.universes.includes(d.universe)) return;
    if (from === this.cfg.interfaceAddress) return;
    this.counters.input++;
    this.forwardInput('sacn', d.universe, d.data, `${d.sourceName} (${from})`);
  }

  private forwardInput(protocol: 'artnet' | 'sacn', universe: number, data: Uint8Array, source: string) {
    const key = `${protocol}:${universe}`;
    const t = this.now();
    // ≤ 44 updates/s per universe to the UI: plenty for parameter control.
    if (t - (this.inputThrottle.get(key) ?? 0) < 22) return;
    this.inputThrottle.set(key, t);
    this.emit({ type: 'input', protocol, universe, data, source });
  }

  private poll() {
    const cfg = this.cfg;
    if (!this.sendSock || !cfg?.interfaceAddress || !cfg.interfaceNetmask) return;
    const pkt = encodeArtPoll();
    const bcast = directedBroadcast(cfg.interfaceAddress, cfg.interfaceNetmask);
    this.send(pkt, this.artPort, bcast, false);
    for (const ip of cfg.manualNodes) this.send(pkt, this.artPort, ip, false);
    const t = this.now();
    let changed = false;
    for (const n of this.nodes.values()) {
      const online = t - n.lastSeen < 10000 && n.lastSeen > 0;
      if (online !== n.online) {
        n.online = online;
        changed = true;
      }
    }
    if (changed) this.emitNodes();
  }

  private emitNodes() {
    this.emit({ type: 'nodes', nodes: [...this.nodes.values()].sort((a, b) => a.ip.localeCompare(b.ip)) });
  }

  private send(pkt: Uint8Array, port: number, ip: string, count = true) {
    const s = this.sendSock;
    if (!s) return;
    s.send(pkt, port, ip, (err) => {
      if (err) {
        this.counters.errors++;
        this.lastError = `${ip}: ${err.message}`;
      }
    });
    if (count) {
      this.counters.packets++;
      this.counters.bytes += pkt.length;
    }
  }

  /** Data for one universe at this tick, honoring blackout, test and delay. */
  private universeData(u: UniverseConfig): Uint8Array {
    if (this.blackout) return new Uint8Array(512);
    if (this.test.mode !== 'off' && (!this.test.universeId || this.test.universeId === u.id)) return this.testPattern();
    const h = this.history.get(u.id);
    if (!h || h.length === 0) return this.merged.get(u.id) ?? new Uint8Array(512);
    const delay = this.cfg!.syncMode === 'sync' ? this.cfg!.globalDelayMs + u.delayMs : 0;
    if (delay <= 0) return h[h.length - 1].data;
    const target = this.now() - delay;
    let pick = h[0];
    for (const f of h) if (f.t <= target) pick = f;
    return pick.data;
  }

  private testPattern(): Uint8Array {
    const d = new Uint8Array(512);
    const m = this.test.mode;
    if (m === 'full') d.fill(255);
    else if (m === 'chase') {
      const ch = this.testPhase % 512;
      d[ch] = 255;
    } else {
      const pattern = m === 'red' ? [255, 0, 0] : m === 'green' ? [0, 255, 0] : m === 'blue' ? [0, 0, 255] : [255, 255, 255];
      // Fills RGB triplets; for RGBW fixtures "white" also lights the W channel via full white.
      for (let i = 0; i + 2 < 512; i += 3) d.set(pattern, i);
      if (m === 'white') d.fill(255);
    }
    return d;
  }

  tick(immediate: boolean) {
    const cfg = this.cfg;
    if (!cfg || !this.sendSock) return;
    this.testPhase++;
    let sent = 0;
    for (const u of cfg.universes) {
      if (!u.enabled || u.protocol === 'virtual') continue;
      const data = this.universeData(u);
      if (u.protocol === 'artnet') {
        const seq = ((this.seq.get(u.id) ?? 0) % 255) + 1;
        this.seq.set(u.id, seq);
        const pkt = encodeArtDmx(u.number, data, seq);
        const ip = u.destination.mode === 'unicast' && u.destination.ip ? u.destination.ip : directedBroadcast(cfg.interfaceAddress!, cfg.interfaceNetmask ?? '255.255.255.0');
        this.send(pkt, this.artPort, ip);
      } else if (u.protocol === 'sacn') {
        const seq = ((this.sacnSeq.get(u.id) ?? 0) + 1) & 0xff;
        this.sacnSeq.set(u.id, seq);
        const pkt = encodeSacnData({ universe: u.number, data, sequence: seq, cid: this.cid, sourceName: cfg.sourceName, priority: u.priority });
        const ip = u.destination.mode === 'unicast' && u.destination.ip ? u.destination.ip : multicastAddress(u.number);
        this.send(pkt, this.sacnPort, ip);
      }
      sent++;
    }
    if (sent > 0 && cfg.useArtSync && cfg.universes.some((u) => u.protocol === 'artnet' && u.enabled)) {
      this.send(encodeArtSync(), this.artPort, directedBroadcast(cfg.interfaceAddress!, cfg.interfaceNetmask ?? '255.255.255.0'));
    }
    if (sent > 0) {
      this.counters.frames++;
      if (this.lastFrameIn > 0) {
        this.counters.latency += this.now() - this.lastFrameIn;
        this.counters.latencyN++;
      }
    }
    this.stats.universesActive = sent;
    if (immediate) this.lastFrameIn = this.now();
  }

  private publishStats() {
    const c = this.counters;
    this.stats = {
      fps: c.frames,
      packetsPerSec: c.packets,
      bytesPerSec: c.bytes,
      sendErrors: this.stats.sendErrors + c.errors,
      lastError: this.lastError,
      universesActive: this.stats.universesActive,
      inputPacketsPerSec: c.input,
      latencyMs: c.latencyN ? Math.round((c.latency / c.latencyN) * 10) / 10 : 0,
      bound: this.bound,
      blackout: this.blackout,
    };
    this.counters = { frames: 0, packets: 0, bytes: 0, errors: 0, input: 0, latency: 0, latencyN: 0 };
    this.emit({ type: 'stats', stats: this.stats });
  }

  /** Step-by-step check, reporting exactly which link fails. */
  async diagnose(universeId: string | null): Promise<DmxDiagnosticStep[]> {
    const steps: DmxDiagnosticStep[] = [];
    const cfg = this.cfg;
    if (!cfg?.interfaceAddress) {
      steps.push({ id: 'interface', ok: false, detail: 'No hay interfaz de red seleccionada.' });
      return steps;
    }
    steps.push({ id: 'interface', ok: true, detail: `Interfaz ${cfg.interfaceAddress} / ${cfg.interfaceNetmask}` });
    steps.push({ id: 'socket', ok: this.bound, detail: this.bound ? 'Socket UDP abierto en la interfaz.' : `No se pudo abrir el socket: ${this.lastError ?? 'desconocido'}` });
    if (!this.bound) return steps;
    const u = cfg.universes.find((x) => x.id === universeId) ?? cfg.universes.find((x) => x.enabled && x.protocol !== 'virtual');
    if (!u) {
      steps.push({ id: 'universe', ok: false, detail: 'No hay universos Art-Net/sACN activos.' });
      return steps;
    }
    if (u.protocol === 'artnet') {
      // fresh poll and wait for replies
      const before = this.now();
      this.poll();
      await new Promise((r) => setTimeout(r, 1500));
      const replies = [...this.nodes.values()].filter((n) => n.lastSeen >= before);
      steps.push({ id: 'artnet', ok: replies.length > 0, detail: replies.length ? `${replies.length} nodo(s) Art-Net respondieron al ArtPoll.` : 'Ningún nodo respondió al ArtPoll (revisa cable, IP y máscara: Art-Net suele usar 2.x.x.x o 10.x.x.x).' });
      if (u.destination.mode === 'unicast' && u.destination.ip) {
        const n = replies.find((x) => x.ip === u.destination.ip);
        const inSubnet = sameSubnet(u.destination.ip, cfg.interfaceAddress, cfg.interfaceNetmask ?? '255.255.255.0');
        steps.push({
          id: 'node',
          ok: !!n,
          detail: n ? `Nodo ${n.shortName || n.ip} (${n.ip}) en línea.` : `El nodo ${u.destination.ip} no responde${inSubnet ? '' : ' y está fuera de la subred de la interfaz elegida'}.`,
        });
        if (n) {
          const has = n.outputUniverses.includes(u.number);
          steps.push({ id: 'universe', ok: has, detail: has ? `El nodo tiene un puerto de salida en el universo ${u.number}.` : `El nodo no tiene ningún puerto configurado en el universo ${u.number} (tiene ${n.outputUniverses.join(', ') || 'ninguno'}).` });
        }
      } else {
        const has = replies.some((n) => n.outputUniverses.includes(u.number));
        steps.push({ id: 'universe', ok: has, detail: has ? `Hay un nodo escuchando el universo ${u.number}.` : `Ningún nodo descubierto tiene salida en el universo ${u.number}.` });
      }
    }
    const errorsBefore = this.stats.sendErrors;
    await new Promise((r) => setTimeout(r, 1100));
    const okSend = this.stats.packetsPerSec > 0 && this.stats.sendErrors === errorsBefore;
    steps.push({ id: 'output', ok: okSend, detail: okSend ? `Enviando ${this.stats.packetsPerSec} paquetes/s sin errores.` : `Errores de envío: ${this.lastError ?? 'no se están enviando paquetes'}` });
    return steps;
  }

  async dispose() {
    for (const t of [this.timer, this.pollTimer, this.statsTimer]) if (t) clearInterval(t);
    this.timer = this.pollTimer = this.statsTimer = null;
    // Leave fixtures dark when the service stops cleanly.
    if (this.cfg && this.sendSock) {
      this.blackout = true;
      this.tick(true);
      await new Promise((r) => setTimeout(r, 50));
    }
    await this.closeSockets();
  }
}

function emptyNode(ip: string, manual: boolean): DiscoveredNode {
  return { ip, shortName: '', longName: '', manufacturer: '', estaCode: 0, mac: '', outputUniverses: [], inputUniverses: [], numPorts: 0, firmware: 0, nodeReport: '', bindIndex: 0, lastSeen: 0, manual, online: false };
}

function openSocket(o: { address: string; port: number; reuse?: boolean }): Promise<dgram.Socket> {
  return new Promise((resolve, reject) => {
    const s = dgram.createSocket({ type: 'udp4', reuseAddr: !!o.reuse });
    const onErr = (e: Error) => {
      s.close();
      reject(e);
    };
    s.once('error', onErr);
    s.bind({ address: o.address, port: o.port, exclusive: !o.reuse }, () => {
      s.off('error', onErr);
      resolve(s);
    });
  });
}
