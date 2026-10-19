// server/stream.js
// «Salida por red»: la imagen de la proyección como video MJPEG por HTTP, para meterla en OBS
// (Fuente multimedia), vMix, TouchDesigner (Web Render TOP), un navegador u otro equipo de la red.
//   · El editor (rol «display», solo desde este mismo equipo) manda cada fotograma en JPEG por
//     su WebSocket; aquí se guarda el último y se reparte a quien esté mirando.
//   · GET /stream.mjpg → multipart/x-mixed-replace (un JPEG detrás de otro).
//   · GET /frame.jpg   → el último fotograma (una foto).
// Si alguien va lento se le salta el fotograma (mejor saltar que acumular retraso).
const BOUNDARY = "lumaframe";
const MAX_FRAME = 8_000_000;

export class FrameHub {
  constructor() { this.frame = null; this.seq = 0; this.at = 0; this.viewers = new Set(); }
  /** Un fotograma nuevo (JPEG). */
  push(jpeg) {
    if (!jpeg || jpeg.length < 4 || jpeg.length > MAX_FRAME || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return false;   // solo JPEG
    this.frame = Buffer.from(jpeg); this.seq++; this.at = Date.now();
    for (const res of this.viewers) this.send(res);
    return true;
  }
  send(res) {
    if (!this.frame || res.writableLength > 3_000_000) return;   // va con retraso: se salta este
    try {
      res.write(`--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${this.frame.length}\r\n\r\n`);
      res.write(this.frame); res.write("\r\n");
    } catch { this.viewers.delete(res); }
  }
  /** Atiende /stream.mjpg y /frame.jpg. Devuelve true si era una de esas rutas. */
  handle(pathname, req, res) {
    const head = { "cache-control": "no-cache, no-store", "access-control-allow-origin": "*" };
    if (pathname === "/frame.jpg") {
      if (!this.frame) { res.writeHead(503, { ...head, "content-type": "text/plain; charset=utf-8" }); res.end("La salida por red está apagada (actívala en LumaMap → Proyectar → Salida por red)."); return true; }
      res.writeHead(200, { ...head, "content-type": "image/jpeg", "content-length": this.frame.length });
      res.end(this.frame);
      return true;
    }
    if (pathname === "/stream.mjpg") {
      res.writeHead(200, { ...head, "content-type": `multipart/x-mixed-replace; boundary=${BOUNDARY}`, connection: "close" });
      req.socket.setNoDelay?.(true);
      this.viewers.add(res);
      this.send(res);
      const bye = () => this.viewers.delete(res);
      req.on("close", bye); res.on("error", bye);
      return true;
    }
    return false;
  }
  get live() { return !!this.frame && Date.now() - this.at < 3000; }
}

/* ---------------- Canales con nombre (Salida por red de las redes de nodos) ---------------- */
// Cada «Salida por red (TOP)» de una red manda su imagen a un canal: «LMCH» + 1 byte (largo del
// nombre) + nombre + JPEG. Se ve en /stream.mjpg?ch=nombre y /frame.jpg?ch=nombre; la lista en
// /stream/channels. Como mucho 8 canales (el más viejo sin imagen se suelta).
export const MAX_CHANNELS = 8;
const CH_MAGIC = [0x4c, 0x4d, 0x43, 0x48];   // «LMCH»
export const validChannel = (name) => /^[a-z0-9_-]{1,32}$/.test(String(name || ""));
/** Un fotograma de canal: { ch, jpeg } (o null si no lo es). */
export function parseChannelFrame(buf) {
  if (!buf || buf.length < 7 || CH_MAGIC.some((b, k) => buf[k] !== b)) return null;
  const n = buf[4];
  const ch = Buffer.from(buf.subarray(5, 5 + n)).toString("latin1");
  if (!validChannel(ch)) return null;
  return { ch, jpeg: buf.subarray(5 + n) };
}
/** Arma un fotograma de canal (lo usan el navegador y las pruebas). */
export function channelFrame(ch, jpeg) {
  const name = Buffer.from(String(ch), "latin1");
  return Buffer.concat([Buffer.from(CH_MAGIC), Buffer.from([name.length]), name, Buffer.from(jpeg)]);
}
export class ChannelHubs {
  constructor() { this.hubs = new Map(); }
  push(ch, jpeg) {
    let h = this.hubs.get(ch);
    if (!h) {
      if (this.hubs.size >= MAX_CHANNELS) {
        const stale = [...this.hubs].filter(([, x]) => !x.live && !x.viewers.size).sort((a, b) => a[1].at - b[1].at)[0];
        if (!stale) return false;
        this.hubs.delete(stale[0]);
      }
      this.hubs.set(ch, h = new FrameHub());
    }
    return h.push(jpeg);
  }
  /** /stream.mjpg?ch= y /frame.jpg?ch= de un canal. */
  handle(ch, pathname, req, res) {
    const h = this.hubs.get(ch);
    if (!h) { res.writeHead(404, { "content-type": "text/plain; charset=utf-8", "access-control-allow-origin": "*" }); res.end(`No hay ningún canal «${ch}»: pon una «Salida por red» en una red de nodos con ese nombre.`); return true; }
    return h.handle(pathname, req, res);
  }
  list() { return [...this.hubs].map(([name, h]) => ({ name, live: h.live, viewers: h.viewers.size })); }
}
