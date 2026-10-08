// server/index.js
// Backend LumaMap (opcional): sirve la app web en la red local, API de proyectos,
// mando remoto por WebSocket (RFC 6455) y OSC por UDP. Sin dependencias.
// Funciona offline en red local. Sincronización opcional cuando hay conexión.
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dgram from "node:dgram";
import { decodeOSC } from "./osc.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const WEB = path.join(ROOT, "web");
const DATA = path.join(ROOT, "data");
fs.mkdirSync(DATA, { recursive: true });

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".webp": "image/webp", ".gif": "image/gif",
  ".webmanifest": "application/manifest+json", ".ico": "image/x-icon",
  ".mp4": "video/mp4", ".wasm": "application/wasm", ".tflite": "application/octet-stream", ".mjs": "text/javascript; charset=utf-8", ".webm": "video/webm", ".mp3": "audio/mpeg", ".wav": "audio/wav",
};

/* ---------------- WebSocket (RFC 6455, mínimo y correcto) ---------------- */

export function computeAcceptKey(key) {
  return crypto.createHash("sha1")
    .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");
}

export function encodeFrame(payload, { mask = false, opcode = 0x1 } = {}) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
  const len = data.length;
  let header;
  if (len < 126) header = Buffer.from([0x80 | opcode, (mask ? 0x80 : 0) | len]);
  else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = (mask?0x80:0)|126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = (mask?0x80:0)|127; header.writeBigUInt64BE(BigInt(len), 2); }
  if (!mask) return Buffer.concat([header, data]);
  const key = crypto.randomBytes(4);
  const masked = Buffer.from(data);
  for (let i = 0; i < masked.length; i++) masked[i] ^= key[i % 4];
  return Buffer.concat([header, key, masked]);
}

/** Decodifica todos los frames completos de buf. Devuelve {frames, rest}. */
export function decodeFrames(buf) {
  const frames = [];
  let off = 0;
  while (off + 2 <= buf.length) {
    const fin = (buf[off] & 0x80) !== 0;
    const opcode = buf[off] & 0x0f;
    const masked = (buf[off + 1] & 0x80) !== 0;
    let len = buf[off + 1] & 0x7f;
    let p = off + 2;
    if (len === 126) { if (p + 2 > buf.length) break; len = buf.readUInt16BE(p); p += 2; }
    else if (len === 127) { if (p + 8 > buf.length) break; len = Number(buf.readBigUInt64BE(p)); p += 8; }
    const maskLen = masked ? 4 : 0;
    if (p + maskLen + len > buf.length) break;
    const mask = masked ? buf.subarray(p, p + 4) : null;
    p += maskLen;
    let payload = buf.subarray(p, p + len);
    if (mask) {
      const un = Buffer.alloc(len);
      for (let i = 0; i < len; i++) un[i] = payload[i] ^ mask[i % 4];
      payload = un;
    }
    frames.push({ fin, opcode, payload });
    off = p + len;
  }
  return { frames, rest: buf.subarray(off) };
}

/** Envía objeto JSON por el socket con framing de servidor (sin máscara). */
export function sendJSON(sock, obj) {
  try { sock.write(encodeFrame(JSON.stringify(obj), { opcode: 0x1 })); }
  catch { /* socket cerrado */ }
}

/* ---------------- Estado de dispositivos conectados ---------------- */

const clients = new Set(); // {sock, role, id, name}
let nextClientId = 1;

function broadcastState() {
  const displays = [...clients].filter(c => c.role === "display")
    .map(c => ({ id: c.id, name: c.name }));
  for (const c of clients) {
    if (c.role === "controller")
      sendJSON(c.sock, { type: "displays", displays });
  }
}

function handleWsMessage(client, raw) {
  let msg;
  try { msg = JSON.parse(raw.toString()); } catch { return; }
  if (msg.type === "hello") {
    client.role = msg.role === "controller" ? "controller" : "display";
    client.name = String(msg.name || client.role).slice(0, 60);
    broadcastState();
    return;
  }
  // Relé: control -> displays; state -> controllers
  if (msg.type === "control") {
    for (const c of clients)
      if (c.role === "display") sendJSON(c.sock, { type: "control", action: msg.action, value: msg.value, from: client.name });
  } else if (msg.type === "state") {
    for (const c of clients)
      if (c.role === "controller") sendJSON(c.sock, { type: "state", state: msg.state });
  }
}

function onUpgrade(req, sock) {
  const key = req.headers["sec-websocket-key"];
  if (!key) { sock.destroy(); return; }
  sock.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
    `Sec-WebSocket-Accept: ${computeAcceptKey(key)}\r\n\r\n`
  );
  sock.setNoDelay(true);
  const client = { sock, role: "display", id: nextClientId++, name: "cliente" };
  clients.add(client);
  let buf = Buffer.alloc(0);
  sock.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    const { frames, rest } = decodeFrames(buf);
    buf = Buffer.from(rest);
    for (const f of frames) {
      if (f.opcode === 0x8) { sock.end(); }                       // close
      else if (f.opcode === 0x9) { sock.write(encodeFrame(f.payload, { opcode: 0xA })); } // ping->pong
      else if (f.opcode === 0x1 && f.fin) handleWsMessage(client, f.payload);
      // Nota: frames binarios y fragmentación no usados por el protocolo LumaMap.
    }
  });
  const drop = () => { clients.delete(client); broadcastState(); };
  sock.on("close", drop);
  sock.on("error", drop);
}

/* ---------------- HTTP: estáticos + API proyectos ---------------- */

function safeJoin(baseDir, urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath); } catch { return null; }
  const p = path.normalize(path.join(baseDir, decoded));
  return p === baseDir || p.startsWith(baseDir + path.sep) ? p : null;
}

export function createServer({ port = 8080, host = "0.0.0.0", osc = true, oscPort = 9129 } = {}) {
  const srv = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname === "/api/ping") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, app: "lumamap", displays: [...clients].filter(c => c.role === "display").length }));
      return;
    }
    // API: proyectos en el backend (sincronización opcional)
    if (url.pathname === "/api/projects" && req.method === "GET") {
      const list = fs.readdirSync(DATA).filter(f => f.endsWith(".json"))
        .map(f => { try { const j = JSON.parse(fs.readFileSync(path.join(DATA, f))); return { name: j.name || f, file: f, updated: j.updatedAt || null }; } catch { return { name: f, file: f }; } });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(list));
      return;
    }
    if (url.pathname === "/api/projects" && req.method === "POST") {
      let body = "";
      req.on("data", c => { body += c; if (body.length > 512 * 1024 * 1024) req.destroy(); });
      req.on("end", () => {
        try {
          const proj = JSON.parse(body);
          if (!proj || typeof proj !== "object" || !proj.name) throw new Error("proyecto inválido");
          const fname = proj.name.replace(/[^\w\- ]/g, "_").slice(0, 80) + ".json";
          proj.updatedAt = new Date().toISOString();
          fs.writeFileSync(path.join(DATA, fname), JSON.stringify(proj));
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true, file: fname }));
        } catch (e) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(e.message) }));
        }
      });
      return;
    }
    const m = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
    if (m && req.method === "GET") {
      const fname = m[1].endsWith(".json") ? m[1] : m[1] + ".json";
      const f = safeJoin(DATA, "/" + fname);
      if (f && fs.existsSync(f)) {
        res.writeHead(200, { "content-type": "application/json" });
        fs.createReadStream(f).pipe(res);
      } else { res.writeHead(404); res.end(JSON.stringify({ ok: false })); }
      return;
    }
    // Estáticos
    const filePath = safeJoin(WEB, url.pathname === "/" ? "/index.html" : url.pathname);
    if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      res.writeHead(200, { "content-type": MIME[path.extname(filePath)] || "application/octet-stream" });
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("404 - recurso no encontrado");
    }
  });
  srv.on("upgrade", (req, sock) => {
    if (new URL(req.url, "http://x").pathname === "/ws") onUpgrade(req, sock);
    else sock.destroy();
  });
  if (osc) {
    const sock = dgram.createSocket("udp4");
    const ctl = (action, value) => {
      for (const c of clients)
        if (c.role === "display") sendJSON(c.sock, { type: "control", action, value, from: "osc" });
    };
    sock.on("message", (msg) => {
      let m;
      try { m = decodeOSC(msg); } catch { return; } // datagrama no OSC: se ignora
      const v = m.args.map(a => a.value);
      switch (m.address) {
        case "/lumap/play": ctl("play"); break;
        case "/lumap/pause": ctl("pause"); break;
        case "/lumap/stop": ctl("stop"); break;
        case "/lumap/next": ctl("next"); break;
        case "/lumap/prev": ctl("prev"); break;
        case "/lumap/scene": ctl("goto", v[0]); break;        // índice 0-based
        case "/lumap/brightness": ctl("brightness", v[0]); break; // 0..1
        case "/lumap/opacity": ctl("opacity", v[0]); break;   // 0..1
        case "/lumap/blackout": ctl("blackout"); break;
      }
    });
    sock.on("error", () => {}); // si el puerto está ocupado, se opera sin OSC
    srv.on("listening", () => { try { sock.bind(oscPort, host); } catch {} });
    srv.osc = sock;
  }
  return srv;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number(process.env.PORT || 8080);
  const srv = createServer({ port });
  srv.listen(port, () => {
    console.log(`[LumaMap] backend en http://0.0.0.0:${port}`);
  });
  // Mostrar IPs locales para facilitar conexión de Android
  import("node:os").then(os => {
    for (const [name, addrs] of Object.entries(os.networkInterfaces()))
      for (const a of addrs || [])
        if (a.family === "IPv4" && !a.internal)
          console.log(`[LumaMap] red local -> http://${a.address}:${port}  (${name})`);
  });
}
