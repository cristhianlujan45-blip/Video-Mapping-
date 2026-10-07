// tests/run2.js — Pruebas fases 7/13/14: timeline, OSC (codec + integración UDP real),
// auto-mapping con imagen sintética.
import assert from "node:assert/strict";
import { encodeOSC, decodeOSC } from "../server/osc.js";
import { createClip, mediaTimeAt, activeClipAt, splitClip, sceneTlEnd, createTimeline } from "../web/js/timeline.js";
import { createProject, createSurface } from "../web/js/project.js";
import { detectQuads } from "../web/js/automap.js";
import { createServer, encodeFrame, decodeFrames } from "../server/index.js";
import dgram from "node:dgram";
import net from "node:net";
import crypto from "node:crypto";

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log("  ✓ " + name); }
  catch (e) { fail++; console.error("  ✗ " + name + "\n    " + e.message); }
}

console.log("== OSC 1.0 codec ==");
await test("encode/decode roundtrip i, f, s, T, F", () => {
  const buf = encodeOSC("/lumap/scene", [
    { type: "i", value: 3 }, { type: "f", value: 0.5 },
    { type: "s", value: "hola" }, { type: "T" }, { type: "F" },
  ]);
  const m = decodeOSC(buf);
  assert.equal(m.address, "/lumap/scene");
  assert.deepEqual(m.args.map(a => a.value), [3, 0.5, "hola", true, false]);
});
await test("strings con padding a múltiplo de 4", () => {
  const buf = encodeOSC("/a", [{ type: "s", value: "abc" }]); // 4 bytes -> 4+4
  assert.equal(buf.length % 4, 0);
  assert.equal(decodeOSC(buf).args[0].value, "abc");
});
await test("float con precisión razonable", () => {
  const m = decodeOSC(encodeOSC("/f", [{ type: "f", value: 0.123456 }]));
  assert.ok(Math.abs(m.args[0].value - 0.123456) < 1e-6);
});

console.log("== Timeline (scheduling) ==");
await test("mediaTimeAt básico y con speed", () => {
  const c = createClip({ start: 2, duration: 10, inPoint: 5, speed: 2 });
  assert.equal(mediaTimeAt(c, 2), 5);     // inicio
  assert.equal(mediaTimeAt(c, 3), 7);     // 1s * speed 2
  assert.equal(mediaTimeAt(c, 4.5), 10);  // clamp por duración del clip
});
await test("mediaTimeAt con loop envuelve el contenido", () => {
  const c = createClip({ start: 0, duration: 100, inPoint: 0, outPoint: 4, loop: true });
  assert.equal(mediaTimeAt(c, 3), 3);
  assert.equal(mediaTimeAt(c, 5), 1);   // (5*1) % 4
  assert.equal(mediaTimeAt(c, 9.5), 1.5);
});
await test("activeClipAt: gana el clip que empieza más tarde", () => {
  const sc = createProject("T");
  sc.timeline = createTimeline(); sc.timeline.enabled = true;
  const a = createClip({ surfaceId: "s1", start: 0, duration: 5 });
  const b = createClip({ surfaceId: "s1", start: 3, duration: 5 });
  sc.timeline.clips.push(a, b);
  assert.equal(activeClipAt(sc, "s1", 4).id, b.id);
  assert.equal(activeClipAt(sc, "s1", 0).id, a.id);
  assert.equal(activeClipAt(sc, "s1", 8.5), null);
  assert.equal(activeClipAt(sc, "s2", 4), null);
});
await test("splitClip divide in/out correctamente", () => {
  const c = createClip({ start: 2, duration: 8, inPoint: 10, outPoint: 0, loop: false, speed: 1 });
  const parts = splitClip(c, 5);
  assert.equal(parts[0].duration, 3);
  assert.equal(parts[1].start, 5);
  assert.equal(parts[1].duration, 5);
  assert.equal(parts[1].inPoint, 13); // 10 + (5-2)
  assert.equal(parts[0].loop, false);
  assert.equal(splitClip(c, 1), null);  // fuera de rango
  assert.equal(splitClip(c, 11), null);
});
await test("sceneTlEnd = máximo fin de clip", () => {
  const sc = createProject("E");
  sc.timeline = createTimeline();
  sc.timeline.clips.push(createClip({ start: 0, duration: 5 }), createClip({ start: 4, duration: 9 }));
  assert.equal(sceneTlEnd(sc), 13);
  sc.timeline.clips = [];
  assert.equal(sceneTlEnd(sc), 0);
});

console.log("== Auto-mapping experimental ==");
function synthImage(w, h, draw) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i*4+3] = 255; }
  draw((x, y, v) => { const i = (y * w + x) * 4; data[i] = data[i+1] = data[i+2] = v; });
  return { width: w, height: h, data };
}
await test("detecta rectángulo blanco sobre negro", () => {
  const img = synthImage(80, 60, (px) => {
    for (let y = 15; y < 40; y++) for (let x = 20; x < 50; x++) px(x, y, 255);
  });
  const quads = detectQuads(img);
  assert.ok(quads.length >= 1, "se esperaba >= 1 cuadrilátero");
  const q = quads[0].points;
  // esquinas detectadas cerca de las reales (tolerancia 3 px por el grosor de borde de Sobel)
  const near = (p, x, y) => Math.abs(p.x - x) <= 3 && Math.abs(p.y - y) <= 3;
  const xs = q.map(p => p.x), ys = q.map(p => p.y);
  assert.ok(Math.min(...xs) >= 17 && Math.max(...xs) <= 53, `x en rango: ${xs}`);
  assert.ok(Math.min(...ys) >= 12 && Math.max(...ys) <= 43, `y en rango: ${ys}`);
});
await test("imagen vacía: sin cuadriláteros (no inventa nada)", () => {
  const img = synthImage(60, 40, () => {});
  assert.equal(detectQuads(img).length, 0);
});

console.log("== OSC sobre el backend (integración UDP real) ==");
await new Promise((resolve) => {
  const srv = createServer({ port: 0, oscPort: 0 });
  srv.listen(0, async () => {
    const httpPort = srv.address().port;
    await test("backend expone socket OSC y decodifica /lumap/play hacia el display", async () => {
      assert.ok(srv.osc, "srv.osc debe existir");
      const oscPort = await new Promise(res => srv.osc.on("listening", () => res(srv.osc.address().port)));
      // cliente WS display (handshake real)
      const key = crypto.randomBytes(16).toString("base64");
      const sock = net.connect(httpPort, "127.0.0.1");
      let buf = Buffer.alloc(0), hs = false;
      sock.on("connect", () => sock.write(
        `GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\n\r\n`));
      const got = new Promise((res, rej) => {
        const to = setTimeout(() => rej(new Error("timeout")), 3000);
        sock.on("data", (d) => {
          buf = Buffer.concat([buf, d]);
          if (!hs && buf.includes("\r\n\r\n")) {
            hs = true; buf = buf.subarray(buf.indexOf("\r\n\r\n") + 4);
            sock.write(encodeFrame(JSON.stringify({ type: "hello", role: "display" }), { mask: true }));
            return;
          }
          if (hs) {
            const { frames, rest } = decodeFrames(buf); buf = Buffer.from(rest);
            for (const f of frames) if (f.opcode === 1) {
              const m = JSON.parse(f.payload.toString());
              if (m.type === "control") { clearTimeout(to); res(m); }
            }
          }
        });
      });
      await new Promise(r => setTimeout(r, 150));
      // datagrama OSC real desde UDP
      const udp = dgram.createSocket("udp4");
      udp.send(encodeOSC("/lumap/play", []), oscPort, "127.0.0.1");
      const m = await got;
      assert.equal(m.action, "play");
      assert.equal(m.from, "osc");
      udp.close(); sock.end();
    });
    srv.osc.close();
    srv.close(); resolve();
  });
});

console.log(`\nResultado: ${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
