// web/js/osc-web.js
// OSC (Open Sound Control) dentro de la página, sin Node: el mismo formato que
// server/osc.js pero sobre Uint8Array. Lo usa la app de Android, que recibe OSC
// por UDP con el puente nativo (dmx-android.js) en el mismo puerto que Windows.
// · Mensajes con argumentos i, f, s, T, F (y también d, h, N, I, b por si una
//   mesa los envía). · Bundles (#bundle), también anidados: se entregan en el
//   acto, sin esperar a su marca de tiempo (server/osc.js aún no los lee).
import { androidAdapter } from "./dmx-android.js";

export const OSC_PORT = 9129;   // el mismo puerto por defecto que la app de Windows
const dec = new TextDecoder();

function str(u8, off) {
  let end = off;
  while (end < u8.length && u8[end] !== 0) end++;
  if (end >= u8.length) throw new Error("OSC: texto sin terminar");
  return [dec.decode(u8.subarray(off, end)), (end + 4) & ~3];
}

function message(u8, dv, out) {
  let [address, off] = str(u8, 0);
  if (address[0] !== "/") throw new Error("OSC: dirección no válida");
  if (off >= u8.length) { out.push({ address, args: [] }); return; }   // sin etiquetas (OSC 1.0 antiguo)
  let tags; [tags, off] = str(u8, off);
  if (tags[0] !== ",") throw new Error("OSC: falta la etiqueta de tipos");
  const args = [];
  const need = (n) => { if (off + n > u8.length) throw new Error("OSC: mensaje cortado"); };
  for (const t of tags.slice(1)) {
    if (t === "i") { need(4); args.push(dv.getInt32(off)); off += 4; }
    else if (t === "f") { need(4); args.push(dv.getFloat32(off)); off += 4; }
    else if (t === "d") { need(8); args.push(dv.getFloat64(off)); off += 8; }
    else if (t === "h") { need(8); args.push(Number(dv.getBigInt64(off))); off += 8; }
    else if (t === "s" || t === "S") { let s; [s, off] = str(u8, off); args.push(s); }
    else if (t === "T") args.push(true);
    else if (t === "F") args.push(false);
    else if (t === "N") args.push(null);
    else if (t === "I") args.push(Infinity);
    else if (t === "b") { need(4); const n = dv.getInt32(off); off += 4; need(n); args.push(u8.slice(off, off + n)); off += (n + 3) & ~3; }
    else throw new Error("OSC: tipo no soportado " + t);
  }
  out.push({ address, args });
}

/** Datagrama OSC → lista de mensajes { address, args } (los bundles se aplanan). */
export function decodeOSC(data, out = [], depth = 0) {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (u8.length >= 16 && dec.decode(u8.subarray(0, 8)) === "#bundle\0") {
    if (depth > 8) throw new Error("OSC: demasiados bundles anidados");
    for (let off = 16; off + 4 <= u8.length;) {
      const n = dv.getInt32(off); off += 4;
      if (n <= 0 || off + n > u8.length) throw new Error("OSC: bundle cortado");
      decodeOSC(u8.subarray(off, off + n), out, depth + 1);
      off += n;
    }
    return out;
  }
  message(u8, dv, out);
  return out;
}

/**
 * Android: escucha OSC por UDP con el puente nativo (UdpHub.kt). Llama a
 * onMessage(address, args) por cada mensaje. Devuelve { port, close } o lanza
 * si el puerto está ocupado.
 */
export async function startAndroidOsc(N, onMessage, port = OSC_PORT) {
  const sock = await androidAdapter(N).socket({ port, onMessage: (buf) => {
    let list;
    try { list = decodeOSC(buf); } catch { return; }   // datagrama no OSC: se ignora
    for (const m of list) { try { onMessage(m.address, m.args); } catch (e) { console.warn(e); } }
  } });
  return { port, close: () => sock.close() };
}

/** IPv4 de la red local de este teléfono (para decir a la mesa OSC adónde enviar). */
export function localAddresses(N) {
  try { return JSON.parse(N.netInterfaces() || "[]").filter(i => !i.internal && i.address); } catch { return []; }
}
