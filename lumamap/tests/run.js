// tests/run.js — Pruebas LumaMap: matemática de warping, modelo de proyecto,
// framing WebSocket RFC 6455 y backend real (HTTP + API + relé WS).
import assert from "node:assert/strict";
import { homography, applyH, triangulatePolygon, unitSquare } from "../shared/homography.js";
import { createProject, createSurface, createScene, serializeProject, validateProject,
         FX_PRESETS, applyPreset, cloneScene } from "../web/js/project.js";
import { computeAcceptKey, encodeFrame, decodeFrames, createServer } from "../server/index.js";
import net from "node:net";
import crypto from "node:crypto";

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log("  ✓ " + name); }
  catch (e) { fail++; console.error("  ✗ " + name + "\n    " + e.message); }
}

console.log("== Matemática de warping ==");
await test("homografía identidad sobre cuadrado unidad", () => {
  const sq = unitSquare();
  const H = homography(sq, sq);
  for (let i = 0; i < 4; i++) {
    const [x, y] = applyH(H, ...sq[i]);
    assert.ok(Math.abs(x - sq[i][0]) < 1e-9 && Math.abs(y - sq[i][1]) < 1e-9);
  }
});
await test("homografía proyectiva mapea esquinas (corner pin)", () => {
  const sq = unitSquare();
  const dst = [[100, 50], [500, 80], [480, 400], [120, 380]];
  const H = homography(sq, dst);
  for (let i = 0; i < 4; i++) {
    const [x, y] = applyH(H, ...sq[i]);
    assert.ok(Math.abs(x - dst[i][0]) < 1e-6 && Math.abs(y - dst[i][1]) < 1e-6);
  }
});
await test("punto interior se mapea de forma coherente (perspectiva)", () => {
  const sq = unitSquare();
  const dst = [[0, 0], [100, 0], [100, 100], [0, 100]];
  const H = homography(sq, dst);
  const [cx, cy] = applyH(H, 0.5, 0.5);
  assert.ok(Math.abs(cx - 50) < 1e-6 && Math.abs(cy - 50) < 1e-6);
});
await test("triangulación: cuad = 2 triángulos, pentágono = 3", () => {
  const quad = [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];
  assert.equal(triangulatePolygon(quad).length, 6);
  const pent = [{x:0,y:0},{x:2,y:0},{x:3,y:1.5},{x:1,y:2.5},{x:-1,y:1.5}];
  assert.equal(triangulatePolygon(pent).length, 9);
});
await test("polígono cóncavo se triangula sin fallback roto", () => {
  const L = [{x:0,y:0},{x:4,y:0},{x:4,y:4},{x:2,y:2},{x:0,y:4}]; // forma de flecha cóncava
  const t = triangulatePolygon(L);
  assert.ok(t.length >= 9 && t.length % 3 === 0);
});

console.log("== Modelo de proyecto ==");
await test("crear / serializar / validar roundtrip", async () => {
  const p = createProject("Test", 1920, 1080);
  p.surfaces[0].fx = { ...p.surfaces[0].fx, rgbShift: 0.01 };
  const doc = await serializeProject(p, [{ id:"m1", name:"v.mp4", kind:"video", size:10,
    duration: 5, width: 640, height: 360, mime:"video/mp4", dataUrl: null }]);
  const back = validateProject(JSON.parse(JSON.stringify(doc)));
  assert.equal(back.width, 1920);
  assert.equal(back.surfaces[0].fx.rgbShift, 0.01);
  assert.equal(back.media[0].name, "v.mp4");
});
await test("validateProject rechaza basura", () => {
  assert.throws(() => validateProject(null));
  assert.throws(() => validateProject({ version: 99 }));
  const p = createProject("X");
  delete p.scenes; p.scenes = [];
  const fixed = validateProject(p);
  assert.equal(fixed.scenes.length, 1);
});
await test("presets de efectos aplican valores reales", () => {
  const s = createSurface({});
  for (const name of Object.keys(FX_PRESETS)) assert.ok(applyPreset(s, name), name);
  applyPreset(s, "Glitch");
  assert.ok(s.fx.rgbShift > 0 && s.fx.noise > 0);
  applyPreset(s, "B&W");
  assert.equal(s.fx.saturation, 0);
});
await test("superficie quad tiene 4 puntos; polígono mínimo 3", () => {
  assert.equal(createSurface({ type: "quad" }).points.length, 4);
  assert.ok(createSurface({ type: "poly" }).points.length >= 3);
});
await test("duplicar escena duplica también sus superficies", () => {
  const p = createProject("Dup");
  const sc = p.scenes[0];
  sc.layers.push({ id: "l1", surfaceId: p.surfaces[0].id });
  const before = p.surfaces.length;
  const c = cloneScene(sc, p.surfaces);
  assert.equal(p.surfaces.length, before + 1);
  assert.notEqual(c.layers[0].surfaceId, sc.layers[0].surfaceId);
});

console.log("== WebSocket RFC 6455 ==");
await test("Sec-WebSocket-Accept (vector oficial del RFC 6455)", () => {
  assert.equal(computeAcceptKey("dGhlIHNhbXBsZSBub25jZQ=="), "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
});
await test("encode/decode frame con máscara de cliente (roundtrip)", () => {
  const payload = Buffer.from(JSON.stringify({ type: "control", action: "play" }));
  const framed = encodeFrame(payload, { mask: true, opcode: 0x1 });
  const { frames, rest } = decodeFrames(framed);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].opcode, 0x1);
  assert.deepEqual(Buffer.from(frames[0].payload), payload);
  assert.equal(rest.length, 0);
});
await test("frame de tamaño medio (126..65535) roundtrip", () => {
  const big = Buffer.alloc(1000, 7);
  const { frames } = decodeFrames(encodeFrame(big, { mask: true }));
  assert.deepEqual(Buffer.from(frames[0].payload), big);
});
await test("frames fragmentados en el buffer se acumulan", () => {
  const payload = Buffer.from("hola lumap");
  const framed = encodeFrame(payload, { mask: true });
  const part1 = framed.subarray(0, 3);
  const part2 = framed.subarray(3);
  const r1 = decodeFrames(part1);
  assert.equal(r1.frames.length, 0);
  const r2 = decodeFrames(Buffer.concat([Buffer.from(r1.rest), part2]));
  assert.equal(r2.frames.length, 1);
  assert.equal(r2.frames[0].payload.toString(), "hola lumap");
});

console.log("== Backend real (integración) ==");
await new Promise((resolve) => {
  const srv = createServer({ port: 0 });
  srv.listen(0, async () => {
    const port = srv.address().port;
    await test("GET / sirve el editor", async () => {
      const r = await fetch(`http://127.0.0.1:${port}/`);
      assert.equal(r.status, 200);
      assert.match(await r.text(), /LumaMap/);
    });
    await test("GET /shared sirve el módulo compartido", async () => {
      const r = await fetch(`http://127.0.0.1:${port}/shared/homography.js`);
      assert.equal(r.status, 200);
      assert.match(await r.text(), /homography/);
    });
    await test("POST + GET /api/projects roundtrip", async () => {
      const proj = createProject("BackendTest");
      let r = await fetch(`http://127.0.0.1:${port}/api/projects`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(proj) });
      assert.equal((await r.json()).ok, true);
      r = await fetch(`http://127.0.0.1:${port}/api/projects/BackendTest`);
      assert.equal((await r.json()).name, "BackendTest");
    });
    await test("POST inválido devuelve 400", async () => {
      const r = await fetch(`http://127.0.0.1:${port}/api/projects`, {
        method: "POST", headers: { "content-type": "application/json" }, body: '{"x":1}' });
      assert.equal(r.status, 400);
    });
    await test("handshake WS + relé control(display)<-controller", async () => {
      const mkClient = (role) => {
        const key = crypto.randomBytes(16).toString("base64");
        const s = net.connect(port, "127.0.0.1");
        const api = { sock: s, msgs: [], onmsg: null, ready: false };
        let buf = Buffer.alloc(0), hs = false;
        s.on("connect", () => {
          s.write(`GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\n\r\n`);
        });
        s.on("data", (d) => {
          buf = Buffer.concat([buf, d]);
          if (!hs && buf.includes("\r\n\r\n")) {
            hs = true; buf = buf.subarray(buf.indexOf("\r\n\r\n") + 4);
            api.ready = true;
            s.write(encodeFrame(JSON.stringify({ type: "hello", role }), { mask: true }));
            if (api.onmsg) api.onmsg();
          }
          if (hs) {
            const { frames, rest } = decodeFrames(buf);
            buf = Buffer.from(rest);
            for (const f of frames) if (f.opcode === 1) {
              const m = JSON.parse(f.payload.toString());
              api.msgs.push(m);
              if (api.onmsg) api.onmsg(m);
            }
          }
        });
        return api;
      };
      const display = mkClient("display");
      await new Promise(r => { display.onmsg = () => r(); });
      const controller = mkClient("controller");
      const gotPlay = await new Promise((res, rej) => {
        const to = setTimeout(() => rej(new Error("timeout relé (3 s)")), 3000);
        display.onmsg = (m) => {
          if (m && m.type === "control" && m.action === "play") { clearTimeout(to); res(m); }
        };
        controller.onmsg = (m) => {
          if (m && m.type === "displays" && m.displays.length)
            controller.sock.write(encodeFrame(JSON.stringify({ type: "control", action: "play" }), { mask: true }));
        };
      });
      assert.equal(gotPlay.action, "play");
      display.sock.end(); controller.sock.end();
    });
    srv.close(); resolve();
  });
});

console.log(`\nResultado: ${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
