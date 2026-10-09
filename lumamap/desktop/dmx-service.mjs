// desktop/dmx-service.mjs
// Servicio de red DMX de LumaMap (Art-Net 4, sACN/E1.31, RDM, láseres). Corre en
// un proceso aparte (utilityProcess de Electron): un nodo desconectado, un cable
// suelto o una red lenta nunca bloquean la interfaz ni el render.
// Toda la lógica está en web/js/dmxnet.js (la misma que usa Android); aquí solo
// está el adaptador con los sockets UDP de Node.
//
// Recibe del editor (por un MessagePort directo, sin pasar por el proceso
// principal): configuración, fotogramas DMX y órdenes. Envía: estadísticas,
// nodos, luces RDM detectadas, láseres, entrada DMX y errores con su causa.
import dgram from "node:dgram";
import os from "node:os";
import crypto from "node:crypto";
import { DmxNet } from "./web/js/dmxnet.js";

let port = null;    // MessagePort hacia el editor

const nodeAdapter = {
  interfaces() {
    const out = [];
    for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
      for (const a of addrs || []) if (a.family === "IPv4" || a.family === 4) out.push({ name, address: a.address, netmask: a.netmask, internal: a.internal, mac: a.mac });
    }
    return out;
  },
  socket({ port: p, address, onMessage, onError }) {
    return new Promise((resolve, reject) => {
      const s = dgram.createSocket({ type: "udp4", reuseAddr: true });
      let bound = false;
      s.on("error", (e) => { if (!bound) reject(e); else onError?.(e); });
      if (onMessage) s.on("message", (buf, r) => onMessage(new Uint8Array(buf.buffer, buf.byteOffset, buf.length), r));
      s.bind(p, address, () => {
        bound = true;
        resolve({
          send: (bytes, dport, host, cb) => s.send(bytes, dport, host, cb || (() => {})),
          close: () => s.close(),
          setBroadcast: (on) => s.setBroadcast(on),
          setMulticastInterface: (ip) => s.setMulticastInterface(ip),
          setMulticastTTL: (n) => s.setMulticastTTL(n),
          addMembership: (g, ip) => s.addMembership(g, ip),
          dropMembership: (g, ip) => s.dropMembership(g, ip),
        });
      });
    });
  },
  randomBytes: (n) => new Uint8Array(crypto.randomBytes(n)),
};

const net = new DmxNet(nodeAdapter, (m) => port?.postMessage(m));
net.start();

process.parentPort.on("message", (e) => {
  if (e.data?.t === "port" && e.ports?.[0]) {
    port?.close?.();
    port = e.ports[0];
    port.on("message", (ev) => net.onMessage(ev.data));
    port.start();
    port.postMessage({ t: "ready", interfaces: net.listInterfaces() });
  }
});
