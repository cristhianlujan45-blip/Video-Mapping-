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
