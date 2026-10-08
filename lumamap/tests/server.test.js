// tests/server.test.js — backend opcional: estáticos, API, WebSocket RFC 6455 y OSC por UDP.
import assert from "node:assert/strict";
import net from "node:net";
import dgram from "node:dgram";
import crypto from "node:crypto";
import fs from "node:fs";
import { computeAcceptKey, encodeFrame, decodeFrames, createServer } from "../server/index.js";
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

function wsClient(port, role) {
  const key = crypto.randomBytes(16).toString("base64");
  const sock = net.connect(port, "127.0.0.1");
  const api = { sock, onmsg: null, send: (o) => { if (sock.writable) sock.write(encodeFrame(JSON.stringify(o), { mask: true })); } };
  let buf = Buffer.alloc(0), hs = false;
  sock.on("connect", () => sock.write(`GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\n\r\n`));
  sock.on("data", (d) => {
    buf = Buffer.concat([buf, d]);
    if (!hs && buf.includes("\r\n\r\n")) {
      hs = true; buf = buf.subarray(buf.indexOf("\r\n\r\n") + 4);
      api.send({ type: "hello", role });
      api.onmsg?.({ type: "__open" });
    }
    if (hs) {
      const { frames, rest } = decodeFrames(buf); buf = Buffer.from(rest);
      for (const f of frames) if (f.opcode === 1) api.onmsg?.(JSON.parse(f.payload.toString()));
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
srv.osc.close();
srv.closeAllConnections?.();
srv.close();
report();
// Los sockets WebSocket ya actualizados no los cierra srv.close(): se termina explícitamente.
process.exit(process.exitCode || 0);
