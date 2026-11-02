// web/js/dmxnet.js
// Núcleo de red DMX de LumaMap (Art-Net 4, sACN/E1.31, RDM y detección de
// dispositivos). Es el mismo código en Windows (servicio aparte, sockets de
// Node) y en Android (dentro de la app, sockets nativos): solo cambia el
// «adaptador» de red. Nunca bloquea: un nodo apagado, un cable suelto o una red
// lenta solo se reflejan en las estadísticas y en mensajes claros.
//
// adapter = {
//   interfaces() → [{ name, address, netmask, internal }]
//   socket({ port, address, multicast, onMessage(bytes, { address, port }), onError(err) }) → Promise<{
//     send(bytes, port, host, cb?), close(), setBroadcast?(on), setMulticastInterface?(ip), setMulticastTTL?(n),
//     addMembership?(group, ip), dropMembership?(group, ip) }>
//   randomBytes(n) → Uint8Array
// }
// post(msg) envía al editor: ready, stats, nodes, input, interfaces, rdm, lasers.
import * as P from "./dmxproto.js";
import * as R from "./rdm.js";

const ETHER_DREAM_PORT = 7654;

export function broadcastOf(ip, mask) {
  const a = ip.split(".").map(Number), m = mask.split(".").map(Number);
  return a.map((x, i) => (x & m[i]) | (~m[i] & 255)).join(".");
}
/** Anuncio de un DAC láser Ether Dream (UDP 7654, 36 bytes). */
export function parseEtherDream(b, from) {
  if (!b || b.length < 36) return null;
  const mac = [...b.slice(0, 6)].map(x => x.toString(16).padStart(2, "0")).join(":");
  const u16 = (i) => b[i] | (b[i + 1] << 8), u32 = (i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
  return { kind: "Láser (Ether Dream)", ip: from, mac, hw: u16(6), sw: u16(8), buffer: u16(10), maxRate: u32(12), playback: b[16 + 3] };
}

export class DmxNet {
  constructor(adapter, post) {
    this.A = adapter; this.post = (m) => { try { post(m); } catch {} };
    this.cfg = { iface: "", universes: [], rate: 40, mode: "sync", inputs: [], discovery: true };
    this.frames = new Map(); this.seq = new Map(); this.lastSent = new Map();
    this.blackout = false;
    this.cid = adapter.randomBytes(16);
    this.uid = R.controllerUid();
    this.stats = { packets: 0, bytes: 0, errors: 0, dropped: 0, lastError: "", latency: 0, perUniverse: new Map(), since: Date.now() };
    this.nodes = new Map(); this.lastPoll = 0;
    this.inputs = new Map(); this.inputDirty = new Set();
    this.sendSock = null; this.sendBoundTo = null; this.sendBusy = 0;
    this.artRecv = null; this.sacnRecv = null; this.sacnGroups = new Set(); this.laserRecv = null;
    this.ifaceInfo = null;
    this.issues = { artnetPort: "", sacnPort: "", iface: "" };
    this.rdm = { pending: new Map(), tn: 0, devices: new Map(), tod: new Map(), running: false };
    this.lasers = new Map();
    this.timers = [];
  }
  now() { return Date.now(); }

  /* ---------------- Interfaces ---------------- */
  listInterfaces() {
    return this.A.interfaces().filter(a => a.address && a.netmask).map(a => ({ ...a, broadcast: a.broadcast || broadcastOf(a.address, a.netmask) }));
  }
  /* ---------------- Sockets ---------------- */
  closeSock(s) { try { s?.close(); } catch {} }
  async ensureSockets() {
    const list = this.listInterfaces(), cfg = this.cfg, iss = this.issues;
    this.ifaceInfo = cfg.iface ? list.find(i => i.address === cfg.iface) || null : null;
    iss.iface = !cfg.iface ? "Elige la interfaz de red (Ethernet / Wi-Fi) por la que salen las luces."
      : !this.ifaceInfo ? `La interfaz ${cfg.iface} ya no existe o no tiene IP (¿cable desconectado o Wi-Fi apagado?).` : "";
    const ifc = this.ifaceInfo;
    // Socket de envío: atado a la IP de la interfaz elegida, así nunca sale por otra.
    if (ifc && this.sendBoundTo !== ifc.address) {
      this.closeSock(this.sendSock); this.sendSock = null; this.sendBoundTo = null;
      const s = await this.A.socket({ port: 0, address: ifc.address, onError: (e) => { this.stats.errors++; this.stats.lastError = "Envío: " + e.message; } });
      try { s.setBroadcast?.(true); s.setMulticastInterface?.(ifc.address); s.setMulticastTTL?.(8); } catch (e) { this.stats.lastError = e.message; }
      this.sendSock = s; this.sendBoundTo = ifc.address;
    }
    if (!ifc && this.sendSock) { this.closeSock(this.sendSock); this.sendSock = null; this.sendBoundTo = null; }
    // Recepción Art-Net (nodos, RDM y entrada de consolas): puerto 6454.
    if (!this.artRecv) {
      this.artRecv = "opening";
      try {
        this.artRecv = await this.A.socket({ port: P.ARTNET_PORT, address: "0.0.0.0", onMessage: (b, r) => this.onArtNet(b, r),
          onError: (e) => { iss.artnetPort = "No se puede escuchar el puerto Art-Net 6454: " + e.message + " (¿otra aplicación de luces abierta?)"; this.closeSock(this.artRecv); this.artRecv = null; } });
        iss.artnetPort = ""; try { this.artRecv.setBroadcast?.(true); } catch {}
      } catch (e) { this.artRecv = null; iss.artnetPort = "No se puede escuchar el puerto Art-Net 6454: " + e.message; }
    }
    // Recepción sACN solo si hay universos de entrada sACN.
    const want = new Set(cfg.inputs.filter(i => i.protocol === "sacn").map(i => i.universe));
    if (want.size && !this.sacnRecv) {
      try {
        this.sacnRecv = await this.A.socket({ port: P.SACN_PORT, address: "0.0.0.0", multicast: true, onMessage: (b, r) => this.onSacn(b, r),
          onError: (e) => { iss.sacnPort = "No se puede escuchar sACN (5568): " + e.message; this.closeSock(this.sacnRecv); this.sacnRecv = null; this.sacnGroups.clear(); } });
        iss.sacnPort = "";
      } catch (e) { iss.sacnPort = "No se puede escuchar sACN (5568): " + e.message; }
    }
    if (this.sacnRecv) {
      for (const u of want) if (!this.sacnGroups.has(u)) { try { this.sacnRecv.addMembership?.(P.sacnMulticast(u), ifc?.address); this.sacnGroups.add(u); } catch (e) { iss.sacnPort = "Multicast sACN: " + e.message; } }
      for (const u of [...this.sacnGroups]) if (!want.has(u)) { try { this.sacnRecv.dropMembership?.(P.sacnMulticast(u), ifc?.address); } catch {} this.sacnGroups.delete(u); }
    }
    // Láseres Ether Dream: se anuncian solos por la red (solo se escucha).
    if (!this.laserRecv) {
      this.laserRecv = "opening";
      try { this.laserRecv = await this.A.socket({ port: ETHER_DREAM_PORT, address: "0.0.0.0", onMessage: (b, r) => this.onLaser(b, r), onError: () => { this.closeSock(this.laserRecv); this.laserRecv = null; } }); }
      catch { this.laserRecv = null; }
    }
  }

  /* ---------------- Recepción ---------------- */
  onArtNet(b, rinfo) {
    const m = P.parseArtNet(b);
    if (!m) return;
    if (m.op === "pollReply") {
      const k = m.ip + "#" + m.bindIndex, prev = this.nodes.get(k);
      this.nodes.set(k, { ...m, from: rinfo.address, lastSeen: this.now(), rtt: this.lastPoll ? this.now() - this.lastPoll : null, firstSeen: prev?.firstSeen || this.now() });
      this.sendNodes();
    } else if (m.op === "dmx") {
      const want = this.cfg.inputs.find(i => i.protocol === "artnet" && i.universe === m.portAddress);
      if (!want) return;
      if (this.ifaceInfo && rinfo.address === this.ifaceInfo.address && this.cfg.universes.some(u => u.protocol === "artnet" && u.portAddress === m.portAddress)) return;
      const d = new Uint8Array(512); d.set(m.data);
      this.inputs.set("artnet:" + m.portAddress, { data: d, at: this.now(), from: rinfo.address });
      this.inputDirty.add("artnet:" + m.portAddress);
    } else if (m.op === "other") this.onRdm(b, rinfo);
  }
  onSacn(b, rinfo) {
    const m = P.parseSacn(b);
    if (!m || !this.cfg.inputs.some(i => i.protocol === "sacn" && i.universe === m.universe)) return;
    const key = "sacn:" + m.universe, cur = this.inputs.get(key);
    if (cur && cur.from !== rinfo.address && cur.priority > m.priority && this.now() - cur.at < 2500) return;
    if (m.terminated) { this.inputs.delete(key); return; }
    const d = new Uint8Array(512); d.set(m.data);
    this.inputs.set(key, { data: d, at: this.now(), from: rinfo.address, priority: m.priority, source: m.sourceName });
    this.inputDirty.add(key);
  }
  onLaser(b, rinfo) {
    const l = parseEtherDream(b, rinfo.address);
    if (!l) return;
    const isNew = !this.lasers.has(l.mac);
    this.lasers.set(l.mac, { ...l, lastSeen: this.now() });
    if (isNew) this.post({ t: "lasers", list: [...this.lasers.values()] });
  }

  /* ---------------- RDM: luces que dicen qué son ---------------- */
  onRdm(b, rinfo) {
    const m = R.parseArtRdm(b);
    if (!m) return;
    if (m.op === "todData") {
      for (const uid of m.uids) {
        const k = R.uidStr(uid);
        if (!this.rdm.tod.has(k)) this.rdm.tod.set(k, { uid, portAddress: m.portAddress, ip: rinfo.address });
      }
    } else if (m.op === "rdm" && m.rdm && (m.rdm.cc === R.CC.getResponse || m.rdm.cc === R.CC.setResponse)) {
      const key = `${R.uidStr(m.rdm.src)}#${m.rdm.tn}`, p = this.rdm.pending.get(key);
      if (p) { this.rdm.pending.delete(key); clearTimeout(p.timer); p.resolve(m.rdm); }
    }
  }
  rdmGet(dev, pid, data = []) {
    return new Promise((resolve) => {
      if (!this.sendSock) return resolve(null);
      const tn = this.rdm.tn = (this.rdm.tn + 1) & 0xff;
      const pkt = R.artRdm(dev.portAddress, R.rdmPacket({ dest: dev.uid, src: this.uid, tn, cc: R.CC.get, pid, data }));
      const key = `${R.uidStr(dev.uid)}#${tn}`;
      const timer = setTimeout(() => { this.rdm.pending.delete(key); resolve(null); }, 600);
      this.rdm.pending.set(key, { resolve, timer });
      this.sendSock.send(pkt, P.ARTNET_PORT, dev.ip, (err) => { if (err) { this.stats.errors++; this.stats.lastError = "RDM: " + err.message; } });
    });
  }
  async rdmAsk(dev, pid) {
    for (let i = 0; i < 2; i++) {        // un reintento: el RDM va por el mismo cable que el DMX
      const r = await this.rdmGet(dev, pid);
      if (r) return r.responseType === R.RESPONSE.ack ? r.data : null;
    }
    return null;
  }
  /** Busca luces RDM en las salidas de los nodos (o en las direcciones dadas) y pregunta qué son. */
  async rdmDiscover(ports) {
    if (this.rdm.running) return;
    if (!this.sendSock || !this.ifaceInfo) { this.post({ t: "rdm", done: true, devices: [], error: "Elige primero la red de las luces." }); return; }
    this.rdm.running = true; this.rdm.tod.clear();
    const all = new Set(ports?.length ? ports : []);
    for (const n of this.nodes.values()) for (const pa of n.outputs || []) all.add(pa);
    for (const u of this.cfg.universes) if (u.protocol === "artnet") all.add(u.portAddress ?? u.num - 1);
    if (!all.size) all.add(0);
    // Una petición por cada Net (ArtTodRequest lleva un solo Net).
    const byNet = new Map();
    for (const pa of all) { const net = (pa >> 8) & 0x7f; if (!byNet.has(net)) byNet.set(net, []); byNet.get(net).push(pa); }
    for (const list of byNet.values()) this.sendSock.send(R.artTodRequest(list), P.ARTNET_PORT, this.ifaceInfo.broadcast);
    this.post({ t: "rdm", progress: "Buscando luces RDM…", devices: [] });
    await new Promise(r => setTimeout(r, 2500));
    const out = [];
    for (const d of this.rdm.tod.values()) {
      const infoRaw = await this.rdmAsk(d, R.PID.deviceInfo);
      const info = R.parseDeviceInfo(infoRaw);
      if (!info) { out.push({ uid: R.uidStr(d.uid), portAddress: d.portAddress, ip: d.ip, model: "", manufacturer: "", label: "", category: 0x7fff, footprint: 0, startAddress: 0, slots: [], partial: true }); continue; }
      const dev = { uid: R.uidStr(d.uid), portAddress: d.portAddress, ip: d.ip, ...info,
        manufacturer: R.asciiOf(await this.rdmAsk(d, R.PID.manufacturerLabel)),
        model: R.asciiOf(await this.rdmAsk(d, R.PID.modelDescription)),
        label: R.asciiOf(await this.rdmAsk(d, R.PID.deviceLabel)),
        slots: R.parseSlotInfo(await this.rdmAsk(d, R.PID.slotInfo)) };
      dev.kind = R.kindOf(dev);
      out.push(dev);
      this.post({ t: "rdm", progress: `Encontradas ${out.length} luz(es)…`, devices: out });
    }
    this.rdm.running = false;
    this.post({ t: "rdm", done: true, devices: out });
  }

  /* ---------------- Envío ---------------- */
  sendUniverse(u, data) {
    if (u.protocol === "virtual" || u.protocol === "usb" || u.enabled === false || !this.sendSock || !this.ifaceInfo) return;
    let pkt, dest, dport;
    if (u.protocol === "sacn") {
      const s = ((this.seq.get(u.num) || 0) + 1) & 0xff; this.seq.set(u.num, s);
      pkt = P.sacnPacket(u.sacnUniverse || u.num, data, { sequence: s, priority: u.priority ?? 100, sourceName: "LumaMap", cid: this.cid });
      dest = u.dest === "unicast" && u.ip ? u.ip : P.sacnMulticast(u.sacnUniverse || u.num); dport = P.SACN_PORT;
    } else {
      const s = ((this.seq.get(u.num) || 0) % 255) + 1; this.seq.set(u.num, s);
      pkt = P.artDmx(u.portAddress ?? (u.num - 1), data, s);
      dest = u.dest === "unicast" && u.ip ? u.ip : this.ifaceInfo.broadcast; dport = P.ARTNET_PORT;
    }
    if (this.sendBusy > 64) { this.stats.dropped++; return; }    // la red no da abasto: se descarta (nunca se acumula retraso)
    this.sendBusy++;
    this.sendSock.send(pkt, dport, dest, (err) => {
      this.sendBusy--;
      if (err) { this.stats.errors++; this.stats.lastError = `Universo ${u.num} → ${dest}: ${err.message}`; return; }
      this.stats.packets++; this.stats.bytes += pkt.length;
      const pu = this.stats.perUniverse.get(u.num) || { packets: 0, last: 0 };
      pu.packets++; pu.last = this.now(); this.stats.perUniverse.set(u.num, pu);
    });
  }
  /** Fotograma vigente de un universo teniendo en cuenta su retardo (sincronía con proyectores y LED). */
  currentFrame(u, t) {
    const q = this.frames.get(u.num), T = t - Math.max(0, u.delayMs || 0);
    if (q && q.length) {
      let i = -1;
      for (let k = 0; k < q.length; k++) { if (q[k].at <= T) i = k; else break; }
      if (i >= 0) { this.lastSent.set(u.num, q[i].data); q.splice(0, i); }
    }
    return this.lastSent.get(u.num) || null;
  }
  loop() {
    const t = this.now(), ZERO = this.ZERO || (this.ZERO = new Uint8Array(512));
    for (const u of this.cfg.universes) {
      if (u.protocol === "virtual" || u.protocol === "usb" || u.enabled === false) continue;
      const d = this.blackout ? ZERO : this.currentFrame(u, t);
      if (d) this.sendUniverse(u, d);
    }
    if (this.cfg.discovery && this.ifaceInfo && t - this.lastPoll > 4000) this.poll();
    const period = 1000 / Math.max(1, Math.min(60, this.cfg.rate || 40));
    this.nextTick = (this.nextTick || t) + period;
    if (this.nextTick < t - period) this.nextTick = t + period;
    this.loopTimer = setTimeout(() => this.loop(), Math.max(0, this.nextTick - Date.now()));
  }
  poll() {
    if (!this.sendSock || !this.ifaceInfo) return;
    this.lastPoll = this.now();
    this.sendSock.send(P.artPoll(), P.ARTNET_PORT, this.ifaceInfo.broadcast, (err) => { if (err) { this.stats.errors++; this.stats.lastError = "ArtPoll: " + err.message; } });
  }
  sendNodes() {
    const t = this.now();
    for (const [k, n] of this.nodes) if (t - n.lastSeen > 30000) this.nodes.delete(k);
    this.post({ t: "nodes", list: [...this.nodes.values()].map(n => ({ ...n, online: t - n.lastSeen < 10000 })) });
  }

  /* ---------------- Mensajes del editor ---------------- */
  onMessage(m) {
    try {
      switch (m.t) {
        case "config":
          this.cfg = { ...this.cfg, ...m.cfg, universes: m.cfg.universes || [], inputs: m.cfg.inputs || [] };
          this.ensureSockets().catch(e => { this.stats.lastError = e.message; });
          break;
        case "frame": {
          const t = this.now();
          if (m.at) this.stats.latency = this.stats.latency * 0.9 + Math.max(0, t - m.at) * 0.1;
          for (const [num, data] of m.list) {
            let q = this.frames.get(num);
            if (!q) this.frames.set(num, q = []);
            q.push({ at: t, data });
            if (q.length > 240) q.splice(0, q.length - 240);
            const u = this.cfg.universes.find(x => x.num === num);
            if (u && this.cfg.mode === "immediate" && !(u.delayMs > 0) && !this.blackout) { this.sendUniverse(u, data); this.lastSent.set(num, data); q.length = 0; }
          }
          break;
        }
        case "blackout":
          this.blackout = !!m.on;
          if (this.blackout) for (const u of this.cfg.universes) this.sendUniverse(u, this.ZERO || (this.ZERO = new Uint8Array(512)));
          break;
        case "discover": this.nodes.clear(); this.poll(); break;
        case "interfaces": this.post({ t: "interfaces", list: this.listInterfaces() }); break;
        case "rdm-discover": this.rdmDiscover(m.ports); break;
      }
    } catch (e) { this.stats.errors++; this.stats.lastError = e.message; }
  }

  start() {
    this.timers.push(setInterval(() => {
      if (!this.inputDirty.size) return;
      const list = [...this.inputDirty].map(k => [k, this.inputs.get(k)?.data]).filter(x => x[1]);
      this.inputDirty.clear();
      this.post({ t: "input", list });
    }, 25));
    this.timers.push(setInterval(() => {
      const t = this.now(), st = this.stats, dt = (t - st.since) / 1000;
      this.post({ t: "stats", stats: {
        pps: st.packets / dt, bps: st.bytes / dt, errors: st.errors, dropped: st.dropped, lastError: st.lastError,
        latency: st.latency, perUniverse: [...st.perUniverse.entries()].map(([num, v]) => ({ num, packets: v.packets, last: v.last, age: t - v.last })),
        iface: this.ifaceInfo, issues: { ...this.issues }, blackout: this.blackout, artnetListening: !!this.artRecv && this.artRecv !== "opening" && !this.issues.artnetPort,
        inputs: [...this.inputs.entries()].map(([k, v]) => ({ key: k, age: t - v.at, from: v.from, source: v.source || "" })),
      } });
      st.packets = 0; st.bytes = 0; st.since = t;
      this.sendNodes();
    }, 1000));
    this.loop();
  }
  stop() {
    for (const t of this.timers) clearInterval(t);
    clearTimeout(this.loopTimer);
    for (const s of [this.sendSock, this.artRecv, this.sacnRecv, this.laserRecv]) if (s && s !== "opening") this.closeSock(s);
  }
}
