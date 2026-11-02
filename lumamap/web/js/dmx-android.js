// web/js/dmx-android.js
// Luces en Android: el mismo núcleo de red que en Windows (dmxnet.js) con los
// sockets UDP nativos de la app (UdpHub.kt, a través de window.LumaNative).
// Se usa con un MessageChannel, igual que el servicio de escritorio, así el
// motor de luces (dmx.js) no distingue entre plataformas.
import { DmxNet } from "./dmxnet.js";

const toB64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = (b64) => { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };

// Compartidos por todos los usuarios del puente (luces y OSC): los id de socket son únicos en la app.
const socks = new Map();
let nextId = 1;

export function androidAdapter(N) {
  // La app llama aquí con cada paquete recibido.
  window.__lumaUdp = (id, from, port, b64) => { const s = socks.get(id); if (s?.onMessage) { try { s.onMessage(fromB64(b64), { address: from, port }); } catch (e) { console.warn(e); } } };
  return {
    interfaces() { try { return JSON.parse(N.netInterfaces() || "[]"); } catch { return []; } },
    socket({ port, address, multicast, onMessage, onError }) {
      const id = nextId++;
      if (!N.udpOpen(id, port || 0, address || "0.0.0.0", !!multicast)) return Promise.reject(new Error(N.udpError(id) || "No se pudo abrir el puerto " + port));
      socks.set(id, { onMessage, onError });
      return Promise.resolve({
        send(bytes, p, host, cb) { const err = N.udpSend(id, host, p, toB64(bytes)); cb?.(err ? new Error(err) : null); },
        close() { socks.delete(id); N.udpClose(id); },
        setBroadcast() {}, setMulticastInterface() {}, setMulticastTTL() {},
        addMembership(g) { N.udpJoin(id, g); }, dropMembership(g) { N.udpLeave(id, g); },
      });
    },
    randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
  };
}

/** Arranca el núcleo dentro de la página. Devuelve el puerto para el motor de luces. */
export function startAndroidDmx(N) {
  const ch = new MessageChannel();
  const net = new DmxNet(androidAdapter(N), (m) => ch.port2.postMessage(m));
  ch.port2.onmessage = (e) => net.onMessage(e.data);
  ch.port2.start?.();
  net.start();
  setTimeout(() => ch.port2.postMessage({ t: "ready", interfaces: net.listInterfaces() }), 0);
  return { port: ch.port1, net };
}
