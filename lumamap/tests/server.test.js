// tests/server.test.js — backend opcional: estáticos, API, WebSocket RFC 6455 y OSC por UDP.
import assert from "node:assert/strict";
import net from "node:net";
import dgram from "node:dgram";
import crypto from "node:crypto";
import fs from "node:fs";
import { computeAcceptKey, encodeFrame, decodeFrames, createServer, startHttps } from "../server/index.js";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { encodeOSC, decodeOSC } from "../server/osc.js";
import { createProject } from "../web/js/model.js";
import { test, report } from "./harness.js";

console.log("== WebSocket RFC 6455 ==");
await test("clave de aceptación del RFC", () => {
  assert.equal(computeAcceptKey("dGhlIHNhbXBsZSBub25jZQ=="), "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
});
await test("frames con máscara (corto, medio y largo) ida y vuelta", () => {
  for (const n of [5, 1000, 70000]) {
    const payload = crypto.randomBytes(n);
    const { frames, rest } = decodeFrames(encodeFrame(payload, { mask: true }));
    assert.deepEqual(Buffer.from(frames[0].payload), payload);
    assert.equal(rest.length, 0);
  }
});
await test("frames partidos se acumulan", () => {
  const f = encodeFrame(Buffer.from("hola lumamap"), { mask: true });
  const r1 = decodeFrames(f.subarray(0, 3));
  assert.equal(r1.frames.length, 0);
  const r2 = decodeFrames(Buffer.concat([Buffer.from(r1.rest), f.subarray(3)]));
  assert.equal(r2.frames[0].payload.toString(), "hola lumamap");
});

console.log("== OSC 1.0 ==");
await test("codificar / decodificar i, f, s, T, F", () => {
  const m = decodeOSC(encodeOSC("/lumap/scene", [{ type: "i", value: 3 }, { type: "f", value: 0.5 }, { type: "s", value: "hola" }, { type: "T" }, { type: "F" }]));
  assert.equal(m.address, "/lumap/scene");
  assert.deepEqual(m.args.map(a => a.value), [3, 0.5, "hola", true, false]);
});

function wsClient(port, role, extra = {}) {
  const key = crypto.randomBytes(16).toString("base64");
  const sock = net.connect(port, "127.0.0.1");
  const api = { sock, onmsg: null, send: (o) => { if (sock.writable) sock.write(encodeFrame(JSON.stringify(o), { mask: true })); } };
  let buf = Buffer.alloc(0), hs = false;
  sock.on("connect", () => sock.write(`GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\n\r\n`));
  sock.on("data", (d) => {
    buf = Buffer.concat([buf, d]);
    if (!hs && buf.includes("\r\n\r\n")) {
      hs = true; buf = buf.subarray(buf.indexOf("\r\n\r\n") + 4);
      api.send({ type: "hello", role, ...extra });
      api.onmsg?.({ type: "__open" });
    }
    if (hs) {
      const { frames, rest } = decodeFrames(buf); buf = Buffer.from(rest);
      for (const f of frames) if (f.opcode === 1) { if (process.env.DBG) console.log(role, "<-", f.payload.toString().slice(0, 120)); api.onmsg?.(JSON.parse(f.payload.toString())); }
    }
  });
  return api;
}

console.log("== Backend (integración real) ==");
const srv = createServer({ port: 0, oscPort: 0 });
await new Promise(r => srv.listen(0, "127.0.0.1", r));
const port = srv.address().port;
const base = `http://127.0.0.1:${port}`;
await test("sirve el editor, la salida y el mando", async () => {
  for (const [p, re] of [["/", /LumaMap/], ["/output.html", /Salida/], ["/controller.html", /Mando/], ["/js/editor.js", /import/]]) {
    const r = await fetch(base + p);
    assert.equal(r.status, 200, p);
    assert.match(await r.text(), re);
  }
});
await test("bloquea rutas fuera de web/ (path traversal)", async () => {
  for (const p of ["/..%2fpackage.json", "/%2e%2e/server/index.js", "/..%5c..%5cpackage.json"]) {
    const r = await fetch(base + p);
    assert.equal(r.status, 404, p);
  }
});
await test("api/ping responde (la app detecta el mando remoto)", async () => {
  const j = await (await fetch(base + "/api/ping")).json();
  assert.equal(j.ok, true);
});
await test("API de proyectos: guardar y leer", async () => {
  const proj = createProject("PruebaBackend");
  let r = await fetch(base + "/api/projects", { method: "POST", body: JSON.stringify(proj) });
  assert.equal((await r.json()).ok, true);
  r = await fetch(base + "/api/projects/PruebaBackend");
  assert.equal((await r.json()).name, "PruebaBackend");
  r = await fetch(base + "/api/projects", { method: "POST", body: '{"x":1}' });
  assert.equal(r.status, 400);
  fs.rmSync(new URL("../data/PruebaBackend.json", import.meta.url), { force: true });
});
await test("mando → display: el control llega a la app", async () => {
  const display = wsClient(port, "display");
  await new Promise(r => { display.onmsg = (m) => m.type === "__open" && r(); });
  const controller = wsClient(port, "controller");
  const got = await new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error("timeout")), 3000);
    display.onmsg = (m) => { if (m.type === "control") { clearTimeout(to); res(m); } };
    controller.onmsg = (m) => { if (m.type === "displays" && m.displays.length) controller.send({ type: "control", action: "goto", value: 2 }); };
  });
  assert.deepEqual([got.action, got.value], ["goto", 2]);
  display.onmsg = controller.onmsg = null;
  display.sock.end(); controller.sock.end();
});
await test("OSC por UDP: /lumap/blackout llega al display", async () => {
  const oscPort = srv.osc.address?.().port ?? await new Promise(r => srv.osc.on("listening", () => r(srv.osc.address().port)));
  const display = wsClient(port, "display");
  const got = new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error("timeout")), 3000);
    display.onmsg = (m) => {
      if (m.type === "__open") setTimeout(() => { const u = dgram.createSocket("udp4"); u.send(encodeOSC("/lumap/blackout", []), oscPort, "127.0.0.1", () => u.close()); }, 100);
      if (m.type === "control") { clearTimeout(to); res(m); }
    };
  });
  const m = await got;
  assert.deepEqual([m.action, m.from], ["blackout", "osc"]);
  display.sock.end();
});
const nextMsg = (c, type, pred = () => true, ms = 3000) => new Promise((res, rej) => {
  const to = setTimeout(() => rej(new Error("timeout esperando " + type)), ms);
  const prev = c.onmsg;
  c.onmsg = (m) => { prev?.(m); if (m.type === type && pred(m)) { clearTimeout(to); c.onmsg = prev; res(m); } };
});
await test("móvil como cámara: el motor ve el móvil conectado y la señalización WebRTC va y vuelve", async () => {
  const display = wsClient(port, "display");
  await nextMsg(display, "__open");
  const listed = nextMsg(display, "cameras", (m) => m.cameras.length > 0);
  const cam = wsClient(port, "camera", { camId: "abc-123", name: "Galaxy S23" });
  const l = await listed;
  assert.deepEqual(l.cameras.map(c => [c.cam, c.name]), [["abc-123", "Galaxy S23"]]);
  const camId = l.cameras[0].id;
  // Oferta del móvil → motor (con quién la manda).
  const offer = nextMsg(display, "rtc");
  cam.send({ type: "rtc", data: { sdp: { type: "offer", sdp: "v=0 oferta" } } });
  const o = await offer;
  assert.deepEqual([o.from, o.cam, o.name, o.data.sdp.type], [camId, "abc-123", "Galaxy S23", "offer"]);
  // Respuesta del motor → solo a ese móvil.
  const answer = nextMsg(cam, "rtc");
  display.send({ type: "rtc", to: camId, data: { sdp: { type: "answer", sdp: "v=0 respuesta" } } });
  assert.equal((await answer).data.sdp.type, "answer");
  // Un mando no puede hacerse pasar por el motor ni recibe la señalización.
  const ctl = wsClient(port, "controller");
  await nextMsg(ctl, "__open");
  let leaked = false; ctl.onmsg = (m) => { if (m.type === "rtc") leaked = true; };
  cam.send({ type: "rtc", data: { sdp: { type: "offer", sdp: "v=0" } } });
  await new Promise(r => setTimeout(r, 200));
  assert.equal(leaked, false);
  // Se desconecta: el motor ve la lista vacía.
  const gone = nextMsg(display, "cameras");
  cam.sock.end();
  assert.deepEqual((await gone).cameras, []);
  display.sock.end(); ctl.sock.end();
});
await test("https propio para la cámara del móvil: certificado guardado, misma app y /api/ping dice el puerto", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lumamap-tls-"));
  const free = await new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
  const hp = await startHttps({ want: free, dataDir: dir, host: "127.0.0.1" });
  assert.equal(hp, free);
  const ca = fs.readFileSync(path.join(dir, "lumamap-https.crt"), "utf8");
  const x = new crypto.X509Certificate(ca);
  assert.match(x.subjectAltName, /IP Address:127\.0\.0\.1/);
  const page = await new Promise((res, rej) => https.get({ host: "127.0.0.1", port: hp, path: "/", ca, servername: "localhost" }, (r) => { let b = ""; r.on("data", d => b += d); r.on("end", () => res(b)); }).on("error", rej));
  assert.match(page, /LumaMap/);
  assert.equal((await (await fetch(base + "/api/ping")).json()).httpsPort, hp);
  // Al volver a arrancar se reutiliza el mismo certificado (el móvil no avisa otra vez).
  const again = fs.readFileSync(path.join(dir, "lumamap-https.crt"), "utf8");
  const { loadCertificate } = await import("../server/tls.js");
  assert.equal(loadCertificate(dir).cert, again);
});
await test("con código (PIN): una cámara sin el código no entra y el motor no la ve", async () => {
  const s2 = createServer({ port: 0, osc: false, pin: "4321" });
  await new Promise(r => s2.listen(0, "127.0.0.1", r));
  const p2 = s2.address().port;
  const display = wsClient(p2, "display");
  await nextMsg(display, "__open");
  const bad = wsClient(p2, "camera", { camId: "x", pin: "0000" });
  assert.equal((await nextMsg(bad, "auth")).ok, false);
  const listed = nextMsg(display, "cameras", (m) => m.cameras.length > 0);
  const good = wsClient(p2, "camera", { camId: "ok1", name: "iPhone", pin: "4321" });
  assert.equal((await nextMsg(good, "auth")).ok, true);
  assert.deepEqual((await listed).cameras.map(c => c.cam), ["ok1"]);
  display.sock.end(); good.sock.end();
  s2.closeAllConnections?.(); s2.close();
});
srv.osc.close();
srv.closeAllConnections?.();
srv.close();
report();
// Los sockets WebSocket ya actualizados no los cierra srv.close(): se termina explícitamente.
process.exit(process.exitCode || 0);
