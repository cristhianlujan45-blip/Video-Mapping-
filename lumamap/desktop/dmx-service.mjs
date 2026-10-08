// desktop/dmx-service.mjs
// Servicio de red DMX de LumaMap (Art-Net 4 y sACN/E1.31). Corre en un proceso
// aparte (utilityProcess de Electron): un nodo desconectado, un cable suelto o
// una red lenta nunca bloquean la interfaz ni el render.
//
// Recibe del editor (por un MessagePort directo, sin pasar por el proceso
// principal): configuración, fotogramas DMX y órdenes (apagón, buscar nodos).
// Envía: estadísticas, nodos encontrados, entrada DMX y errores con su causa.
import dgram from "node:dgram";
import os from "node:os";
import crypto from "node:crypto";
import * as P from "./web/js/dmxproto.js";

let port = null;                  // MessagePort hacia el editor
let cfg = { iface: "", universes: [], rate: 40, mode: "sync", inputs: [], discovery: true };
const frames = new Map();         // universo -> [{ at, data }] (cola para el retardo)
const seq = new Map();            // universo -> secuencia
let blackout = false;
const cid = crypto.randomBytes(16);
const stats = { packets: 0, bytes: 0, errors: 0, dropped: 0, lastError: "", latency: 0, perUniverse: new Map(), since: Date.now() };
const nodes = new Map();          // ip -> nodo (ArtPollReply)
let lastPoll = 0;
const inputs = new Map();         // universo -> { data, at, from, priority }
const inputDirty = new Set();
let sendSock = null, sendBoundTo = null, sendBusy = 0;
let artRecv = null, sacnRecv = null, sacnGroups = new Set();
let ifaceInfo = null;
const issues = { artnetPort: "", sacnPort: "", iface: "" };

const post = (m) => { try { port?.postMessage(m); } catch {} };
const now = () => Date.now();

/* ---------------- Interfaces de red ---------------- */
function listInterfaces() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== "IPv4" && a.family !== 4) continue;
      out.push({ name, address: a.address, netmask: a.netmask, internal: a.internal, mac: a.mac, broadcast: broadcastOf(a.address, a.netmask) });
    }
  }
  return out;
}
function broadcastOf(ip, mask) {
  const a = ip.split(".").map(Number), m = mask.split(".").map(Number);
  return a.map((x, i) => (x & m[i]) | (~m[i] & 255)).join(".");
}
function sameSubnet(ip, iface) {
  if (!iface) return false;
  const a = ip.split(".").map(Number), b = iface.address.split(".").map(Number), m = iface.netmask.split(".").map(Number);
  return a.every((x, i) => (x & m[i]) === (b[i] & m[i]));
}

/* ---------------- Sockets ---------------- */
function closeSock(s) { try { s?.close(); } catch {} }

async function ensureSockets() {
  const list = listInterfaces();
  ifaceInfo = cfg.iface ? list.find(i => i.address === cfg.iface) || null : null;
  issues.iface = !cfg.iface ? "Elige la interfaz de red (Ethernet / Wi-Fi) por la que salen las luces."
    : !ifaceInfo ? `La interfaz ${cfg.iface} ya no existe o no tiene IP (¿cable desconectado o Wi-Fi apagado?).` : "";
  // Socket de envío: atado a la IP de la interfaz elegida, así nunca sale por otra.
  if (ifaceInfo && sendBoundTo !== ifaceInfo.address) {
    closeSock(sendSock); sendSock = null; sendBoundTo = null;
    const s = dgram.createSocket({ type: "udp4", reuseAddr: true });
    s.on("error", (e) => { stats.errors++; stats.lastError = "Envío: " + e.message; });
    await new Promise((res) => s.bind(0, ifaceInfo.address, () => res()));
    try { s.setBroadcast(true); s.setMulticastInterface(ifaceInfo.address); s.setMulticastTTL(8); } catch (e) { stats.lastError = e.message; }
    sendSock = s; sendBoundTo = ifaceInfo.address;
  }
  if (!ifaceInfo && sendSock) { closeSock(sendSock); sendSock = null; sendBoundTo = null; }
  // Recepción Art-Net (respuestas de nodos y entrada de consolas): puerto 6454.
  if (!artRecv) {
    const s = dgram.createSocket({ type: "udp4", reuseAddr: true });
    s.on("message", onArtNet);
    s.on("error", (e) => { issues.artnetPort = "No se puede escuchar el puerto Art-Net 6454: " + e.message + " (¿otra aplicación de luces abierta?)"; closeSock(s); artRecv = null; });
    s.bind(P.ARTNET_PORT, "0.0.0.0", () => { issues.artnetPort = ""; try { s.setBroadcast(true); } catch {} });
    artRecv = s;
  }
  // Recepción sACN solo si hay universos de entrada sACN.
  const want = new Set(cfg.inputs.filter(i => i.protocol === "sacn").map(i => i.universe));
  if (want.size && !sacnRecv) {
    const s = dgram.createSocket({ type: "udp4", reuseAddr: true });
    s.on("message", onSacn);
    s.on("error", (e) => { issues.sacnPort = "No se puede escuchar sACN (5568): " + e.message; closeSock(s); sacnRecv = null; sacnGroups.clear(); });
    await new Promise((res) => s.bind(P.SACN_PORT, "0.0.0.0", () => res()));
    sacnRecv = s; issues.sacnPort = "";
  }
  if (sacnRecv) {
    for (const u of want) if (!sacnGroups.has(u)) { try { sacnRecv.addMembership(P.sacnMulticast(u), ifaceInfo?.address); sacnGroups.add(u); } catch (e) { issues.sacnPort = "Multicast sACN: " + e.message; } }
    for (const u of [...sacnGroups]) if (!want.has(u)) { try { sacnRecv.dropMembership(P.sacnMulticast(u), ifaceInfo?.address); } catch {} sacnGroups.delete(u); }
  }
}

/* ---------------- Recepción ---------------- */
function onArtNet(buf, rinfo) {
  const m = P.parseArtNet(new Uint8Array(buf.buffer, buf.byteOffset, buf.length));
  if (!m) return;
  if (m.op === "pollReply") {
    const prev = nodes.get(m.ip + "#" + m.bindIndex);
    nodes.set(m.ip + "#" + m.bindIndex, { ...m, from: rinfo.address, lastSeen: now(), rtt: lastPoll ? now() - lastPoll : null, firstSeen: prev?.firstSeen || now() });
    sendNodes();
  } else if (m.op === "dmx") {
    const want = cfg.inputs.find(i => i.protocol === "artnet" && i.universe === m.portAddress);
    if (!want) return;
    // No reinyectar nuestra propia salida.
    if (ifaceInfo && rinfo.address === ifaceInfo.address && cfg.universes.some(u => u.protocol === "artnet" && u.portAddress === m.portAddress)) return;
    const d = new Uint8Array(512); d.set(m.data);
    inputs.set("artnet:" + m.portAddress, { data: d, at: now(), from: rinfo.address });
    inputDirty.add("artnet:" + m.portAddress);
  }
}
function onSacn(buf, rinfo) {
  const m = P.parseSacn(new Uint8Array(buf.buffer, buf.byteOffset, buf.length));
  if (!m || !cfg.inputs.some(i => i.protocol === "sacn" && i.universe === m.universe)) return;
  const key = "sacn:" + m.universe, cur = inputs.get(key);
  // Varias fuentes: gana la de mayor prioridad (las caducadas, 2.5 s, se olvidan).
  if (cur && cur.from !== rinfo.address && cur.priority > m.priority && now() - cur.at < 2500) return;
  if (m.terminated) { inputs.delete(key); return; }
  const d = new Uint8Array(512); d.set(m.data);
  inputs.set(key, { data: d, at: now(), from: rinfo.address, priority: m.priority, source: m.sourceName });
  inputDirty.add(key);
}
setInterval(() => {
  if (!inputDirty.size) return;
  const list = [...inputDirty].map(k => [k, inputs.get(k)?.data]).filter(x => x[1]);
  inputDirty.clear();
  post({ t: "input", list });
}, 25);

/* ---------------- Envío ---------------- */
function sendUniverse(u, data) {
  if (u.protocol === "virtual" || u.enabled === false) return;
  if (!sendSock || !ifaceInfo) return;
  let pkt, dest, dport;
  if (u.protocol === "sacn") {
    const s = ((seq.get(u.num) || 0) + 1) & 0xff; seq.set(u.num, s);
    pkt = P.sacnPacket(u.sacnUniverse || u.num, data, { sequence: s, priority: u.priority ?? 100, sourceName: "LumaMap", cid });
    dest = u.dest === "unicast" && u.ip ? u.ip : P.sacnMulticast(u.sacnUniverse || u.num); dport = P.SACN_PORT;
  } else {
    const s = ((seq.get(u.num) || 0) % 255) + 1; seq.set(u.num, s);
    pkt = P.artDmx(u.portAddress ?? (u.num - 1), data, s);
    dest = u.dest === "unicast" && u.ip ? u.ip : ifaceInfo.broadcast; dport = P.ARTNET_PORT;
  }
  if (sendBusy > 64) { stats.dropped++; return; }     // la red no da abasto: se descarta (nunca se acumula retraso)
  sendBusy++;
  sendSock.send(pkt, dport, dest, (err) => {
    sendBusy--;
    if (err) { stats.errors++; stats.lastError = `Universo ${u.num} → ${dest}: ${err.message}`; return; }
    stats.packets++; stats.bytes += pkt.length;
    const pu = stats.perUniverse.get(u.num) || { packets: 0, last: 0 };
    pu.packets++; pu.last = now(); stats.perUniverse.set(u.num, pu);
  });
}

const ZERO = new Uint8Array(512);
/** Fotograma vigente de un universo teniendo en cuenta su retardo (sincronía con proyectores y LED). */
const lastSent = new Map();
function currentFrame(u, t) {
  const q = frames.get(u.num), T = t - Math.max(0, u.delayMs || 0);
  if (q && q.length) {
    let i = -1;
    for (let k = 0; k < q.length; k++) { if (q[k].at <= T) i = k; else break; }
    if (i >= 0) { lastSent.set(u.num, q[i].data); q.splice(0, i); }
  }
  return lastSent.get(u.num) || null;
}

let timer = 0, nextTick = 0;
function loop() {
  const t = now();
  for (const u of cfg.universes) {
    if (u.protocol === "virtual" || u.enabled === false) continue;
    const d = blackout ? ZERO : currentFrame(u, t);
    if (!d) continue;
    sendUniverse(u, d);
  }
  if (cfg.discovery && ifaceInfo && t - lastPoll > 4000) poll();
  const period = 1000 / Math.max(1, Math.min(60, cfg.rate || 40));
  nextTick = (nextTick || t) + period;
  if (nextTick < t - period) nextTick = t + period;
  timer = setTimeout(loop, Math.max(0, nextTick - Date.now()));
}

function poll() {
  if (!sendSock || !ifaceInfo) return;
  lastPoll = now();
  const pkt = P.artPoll();
  sendSock.send(pkt, P.ARTNET_PORT, ifaceInfo.broadcast, (err) => { if (err) { stats.errors++; stats.lastError = "ArtPoll: " + err.message; } });
}
function sendNodes() {
  const t = now();
  for (const [k, n] of nodes) if (t - n.lastSeen > 30000) nodes.delete(k);
  post({ t: "nodes", list: [...nodes.values()].map(n => ({ ...n, online: t - n.lastSeen < 10000 })) });
}

/* ---------------- Mensajes del editor ---------------- */
function onMessage(m) {
  try {
    switch (m.t) {
      case "config":
        cfg = { ...cfg, ...m.cfg, universes: m.cfg.universes || [], inputs: m.cfg.inputs || [] };
        ensureSockets().catch(e => { stats.lastError = e.message; });
        break;
      case "frame": {
        const t = now();
        if (m.at) stats.latency = stats.latency * 0.9 + Math.max(0, t - m.at) * 0.1;
        for (const [num, data] of m.list) {
          let q = frames.get(num);
          if (!q) frames.set(num, q = []);
          q.push({ at: t, data });
          if (q.length > 240) q.splice(0, q.length - 240);
          // Modo inmediato: sale ya, sin esperar al reloj de envío.
          const u = cfg.universes.find(x => x.num === num);
          if (u && cfg.mode === "immediate" && !(u.delayMs > 0) && !blackout) { sendUniverse(u, data); lastSent.set(num, data); q.length = 0; }
        }
        break;
      }
      case "blackout":
        blackout = !!m.on;
        if (blackout) for (const u of cfg.universes) sendUniverse(u, ZERO);   // inmediato, sin esperar al siguiente ciclo
        break;
      case "discover": nodes.clear(); poll(); break;
      case "interfaces": post({ t: "interfaces", list: listInterfaces() }); break;
    }
  } catch (e) { stats.errors++; stats.lastError = e.message; }
}

setInterval(() => {
  const t = now(), dt = (t - stats.since) / 1000;
  post({ t: "stats", stats: {
    pps: stats.packets / dt, bps: stats.bytes / dt, errors: stats.errors, dropped: stats.dropped, lastError: stats.lastError,
    latency: stats.latency, perUniverse: [...stats.perUniverse.entries()].map(([num, v]) => ({ num, packets: v.packets, last: v.last, age: t - v.last })),
    iface: ifaceInfo, issues: { ...issues }, blackout, artnetListening: !!artRecv && !issues.artnetPort,
    inputs: [...inputs.entries()].map(([k, v]) => ({ key: k, age: t - v.at, from: v.from, source: v.source || "" })),
  } });
  stats.packets = 0; stats.bytes = 0; stats.since = t;
  sendNodes();
}, 1000);

process.parentPort.on("message", (e) => {
  if (e.data?.t === "port" && e.ports?.[0]) {
    port?.close?.();
    port = e.ports[0];
    port.on("message", (ev) => onMessage(ev.data));
    port.start();
    post({ t: "ready", interfaces: listInterfaces() });
  }
});
loop();
