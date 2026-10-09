// tests/desktop.e2e.mjs — la app de escritorio real (Electron) con red de verdad.
// Un «nodo Art-Net» y un «receptor sACN» falsos escuchan en la red local
// (loopback): se comprueba lo que LumaMap envía byte a byte, la búsqueda de
// nodos, la entrada DMX desde una «consola» y el apagón.
// Requiere: cd desktop && npm ci  (y Xvfb en Linux: xvfb-run -a node tests/desktop.e2e.mjs)
import { test, report } from "./harness.js";
import assert from "node:assert/strict";
import dgram from "node:dgram";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as P from "../web/js/dmxproto.js";
import * as R from "../web/js/rdm.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.join(here, "..", "desktop");
let _electron;
try { ({ _electron } = await import(process.env.PLAYWRIGHT_MODULE || "playwright")); }
catch { console.log("Playwright no está instalado: se omite la prueba de escritorio."); process.exit(0); }
execFileSync(process.execPath, [path.join(desktop, "build.mjs"), "--stage"], { cwd: desktop, stdio: "inherit" });
const electronBin = (await import(path.join(desktop, "node_modules", "electron", "index.js"))).default;

// ---- Nodo Art-Net falso (recibe ArtDmx y responde a ArtPoll) ----
const artPkts = [];
const node = dgram.createSocket({ type: "udp4", reuseAddr: true });
node.on("message", (b, r) => {
  const m = P.parseArtNet(new Uint8Array(b));
  if (!m) return;
  if (m.op === "dmx") artPkts.push(m);
  if (m.op === "poll") node.send(P.artPollReply({ ip: "127.0.0.1", shortName: "NodoFalso", longName: "Nodo de prueba LumaMap", outputs: [0, 1] }), P.ARTNET_PORT, "127.255.255.255");
});
await new Promise(r => node.bind(P.ARTNET_PORT, "0.0.0.0", r));
node.setBroadcast(true);
// ---- Receptor sACN falso (unicast) ----
const sacnPkts = [];
const sacn = dgram.createSocket({ type: "udp4", reuseAddr: true });
sacn.on("message", (b) => { const m = P.parseSacn(new Uint8Array(b)); if (m) sacnPkts.push(m); });
await new Promise(r => sacn.bind(P.SACN_PORT, "127.0.0.1", r));

const app = await _electron.launch({
  executablePath: electronBin, cwd: desktop,
  args: [path.join(desktop, ".stage"), "--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  env: { ...process.env, ANTHROPIC_API_KEY: "", LUMAMAP_USER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), "lumamap-e2e-")) },
});
const win = await app.firstWindow();
const errors = [];
win.on("pageerror", (e) => errors.push(e.message));
await win.waitForFunction(() => window.__lumamap && window.__lumamap.S, null, { timeout: 30000 });
await win.waitForTimeout(800);
await win.evaluate(() => { const b = [...document.querySelectorAll(".tile")].find(x => /Pantalla/.test(x.textContent)); b?.click(); });
// Sin tarjeta gráfica: vista previa en calidad baja (la que la app elige sola en estos equipos).
await win.evaluate(() => window.__lumamap.actions.applyQuality("low"));

await test("el servicio DMX arranca en un proceso aparte y lista las interfaces de red", async () => {
  await win.evaluate(() => { const a = window.__lumamap; a.setPro(true); a.dmx.cfg.enabled = true; a.dmx.connect(); });
  await win.waitForFunction(() => window.__lumamap.dmx.service.ready, null, { timeout: 15000 });
  const ifs = await win.evaluate(() => window.__lumamap.dmx.service.interfaces);
  assert.ok(ifs.some(i => i.address === "127.0.0.1"), JSON.stringify(ifs));
  const procs = await app.evaluate(({ app }) => app.getAppMetrics().map(p => p.type));
  assert.ok(procs.includes("Utility"), "proceso Utility: " + procs.join(","));
});

await test("pixel map de color fijo → ArtDmx real en la red, universo y canales correctos", async () => {
  await win.evaluate(() => {
    const a = window.__lumamap, D = a.dmx, c = D.cfg;
    c.iface = "127.0.0.1";
    c.universes.push({ num: 1, protocol: "artnet", portAddress: 1, dest: "broadcast", ip: "", enabled: true, delayMs: 0, priority: 100, sacnUniverse: 1 });
    D.addPixelMap({ shape: "line", count: 3, colorOrder: "GRB", universe: 1, channel: 10, source: "color", color: "#ff8000" });
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 8000 && !artPkts.some(p => p.portAddress === 1 && p.data[9] > 0)) await new Promise(r => setTimeout(r, 100));
  const p = artPkts.filter(p => p.portAddress === 1).at(-1);
  assert.ok(p, "no llegó ningún ArtDmx al universo 1");
  assert.deepEqual([...p.data.slice(9, 18)], [128, 255, 0, 128, 255, 0, 128, 255, 0]);   // GRB de #ff8000 desde el canal 10
  // Frecuencia de envío: se refresca continuamente (40 fps por defecto).
  artPkts.length = 0;
  await new Promise(r => setTimeout(r, 2000));
  const rate = artPkts.filter(x => x.portAddress === 1).length / 2;
  assert.ok(rate > 25, "frecuencia " + rate.toFixed(1));
});

await test("búsqueda de nodos: ArtPoll → ArtPollReply aparece con nombre y salidas", async () => {
  await win.evaluate(() => window.__lumamap.dmx.discover());
  await win.waitForFunction(() => window.__lumamap.dmx.service.nodes.some(n => n.shortName === "NodoFalso"), null, { timeout: 8000 });
  const n = await win.evaluate(() => window.__lumamap.dmx.service.nodes.find(n => n.shortName === "NodoFalso"));
  assert.deepEqual(n.outputs, [0, 1]); assert.equal(n.online, true);
});

await test("video → luces: el color de la superficie llega a los LED por sACN unicast", async () => {
  await win.evaluate(() => {
    const a = window.__lumamap, c = a.dmx.cfg;
    // Una superficie a pantalla completa de color azul puro.
    a.actions.addShape("rect"); a.actions.fillFrame(); a.actions.setSource({ type: "color", color: "#0000ff" });
    c.universes.push({ num: 2, protocol: "sacn", sacnUniverse: 7, dest: "unicast", ip: "127.0.0.1", enabled: true, delayMs: 0, priority: 100, portAddress: 1 });
    a.dmx.addPixelMap({ shape: "grid", cols: 4, rows: 2, count: 8, colorOrder: "RGB", universe: 2, channel: 1, source: "video", x: 0.2, y: 0.2, w: 0.6, h: 0.6 });
  });
  const t0 = Date.now();
  // Se espera a que el azul llegue a TODOS los LED (en un equipo lento el primer fotograma tarda).
  const blue = (p) => p.universe === 7 && [...p.data.slice(0, 24)].every((v, i) => i % 3 === 2 ? v === 255 : v === 0);
  while (Date.now() - t0 < 25000 && !sacnPkts.some(blue)) await new Promise(r => setTimeout(r, 100));
  const p = sacnPkts.filter(blue).at(-1) || sacnPkts.filter(p => p.universe === 7).at(-1);
  assert.ok(p, "no llegó sACN al universo 7");
  assert.deepEqual([...p.data.slice(0, 6)], [0, 0, 255, 0, 0, 255]);
  assert.equal(p.sourceName, "LumaMap");
});

await test("entrada DMX: una consola mueve un canal y el motor de parámetros lo usa (DMX LEARN)", async () => {
  await win.evaluate(() => { const c = window.__lumamap.dmx.cfg; c.inputs.push({ protocol: "artnet", universe: 9 }); });
  await win.waitForTimeout(800);
  const learning = win.evaluate(() => window.__lumamap.params.learn("global/master").then(m => m && m.key));
  await win.waitForTimeout(200);
  // Como una consola Art-Net real: por broadcast. (En unicast, con dos programas escuchando en el
  // puerto 6454 —LumaMap y el nodo falso—, Linux entrega cada paquete a uno solo y la prueba fallaba al azar.)
  const console1 = dgram.createSocket({ type: "udp4", reuseAddr: true });
  await new Promise(r => console1.bind(0, "127.0.0.1", r));
  console1.setBroadcast(true);
  const send = (v) => new Promise(r => { const d = new Uint8Array(512); d[4] = v; console1.send(P.artDmx(9, d), P.ARTNET_PORT, "127.255.255.255", r); });
  await send(200);
  assert.equal(await learning, "artnet:9:c5");
  // Una consola real repite el universo sin parar (~40 por segundo): si un paquete UDP se pierde, llega el siguiente.
  const stream = setInterval(() => send(51), 100);
  try { await win.waitForFunction(() => Math.abs(window.__lumamap.S.master - 0.2) < 0.01, null, { timeout: 15000 }); }
  finally { clearInterval(stream); console1.close(); }
  // Limpieza: la consola deja de mandar el master (si no, pelearía con las pruebas siguientes).
  await win.evaluate(() => { const a = window.__lumamap; a.S.project.settings.control.mappings = a.S.project.settings.control.mappings.filter(m => m.target !== "global/master"); a.paramMappingsChanged?.(); a.dmx.cfg.inputs = []; });
});

await test("apagón: todos los universos a 0 al instante", async () => {
  artPkts.length = 0;
  await win.evaluate(() => window.__lumamap.actions.blackout());
  const t0 = Date.now();
  while (Date.now() - t0 < 3000 && !artPkts.some(p => p.portAddress === 1)) await new Promise(r => setTimeout(r, 50));
  await new Promise(r => setTimeout(r, 300));
  const p = artPkts.filter(p => p.portAddress === 1).at(-1);
  assert.ok(p, "sin paquetes tras el apagón");
  assert.deepEqual([...p.data.slice(0, 20)].filter(v => v), [], "datos: " + [...p.data.slice(0, 20)]);
  await win.evaluate(() => window.__lumamap.actions.blackout());
});

await test("si el servicio DMX muere, se reinicia solo y sigue enviando", async () => {
  await app.evaluate(({ app }) => { const p = app.getAppMetrics().find(m => m.type === "Utility" && /DMX/.test(m.serviceName || m.name || "")); if (p) process.kill(p.pid); });
  await win.waitForTimeout(2500);
  artPkts.length = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 8000 && !artPkts.some(p => p.portAddress === 1)) await new Promise(r => setTimeout(r, 100));
  assert.ok(artPkts.length > 0, "volvió a enviar");
});

await test("métricas reales de rendimiento (CPU, RAM, GPU)", async () => {
  const m = await win.evaluate(() => window.LumaDesktop.metrics());
  assert.ok(m.cores > 0 && m.ram > 0 && m.procs.length >= 3);
});

await test("OSC por UDP: /lumamap/param/... fija un parámetro y OSC LEARN asigna una dirección", async () => {
  const info = await win.evaluate(() => window.LumaDesktop.remoteInfo());
  assert.ok(info.port > 0 && info.oscPort > 0, JSON.stringify(info));
  await win.waitForFunction(() => window.__lumamap.remote?.authOk === true, null, { timeout: 10000 });
  const { encodeOSC } = await import("../server/osc.js");
  const u = dgram.createSocket("udp4");
  const osc = (addr, args) => new Promise(r => u.send(encodeOSC(addr, args), info.oscPort, "127.0.0.1", r));
  await osc("/lumamap/param/global/master", [{ type: "f", value: 0.3 }]);
  await win.waitForFunction(() => Math.abs(window.__lumamap.S.master - 0.3) < 1e-6, null, { timeout: 5000 });
  const learning = win.evaluate(() => window.__lumamap.params.learn("dmx/master").then(m => m && m.key));
  await win.waitForTimeout(200);
  await osc("/touchosc/fader1", [{ type: "f", value: 0.9 }]);
  assert.equal(await learning, "/touchosc/fader1");
  await osc("/touchosc/fader1", [{ type: "f", value: 0.25 }]);
  await win.waitForFunction(() => Math.abs(window.__lumamap.dmx.cfg.master - 0.25) < 1e-6, null, { timeout: 5000 });
  u.close();
});

await test("mando remoto: sin PIN no entra; con PIN controla cualquier parámetro", async () => {
  const info = await win.evaluate(() => window.LumaDesktop.remoteInfo());
  const connect = (pin) => new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${info.port}/ws`);
    ws.onopen = () => ws.send(JSON.stringify({ type: "hello", role: "controller", name: "test", pin }));
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.type === "auth") resolve({ ws, ok: m.ok }); };
  });
  const bad = await connect("0000" === info.pin ? "1111" : "0000");
  assert.equal(bad.ok, false); bad.ws.close();
  const good = await connect(info.pin);
  assert.equal(good.ok, true);
  good.ws.send(JSON.stringify({ type: "control", action: "param", id: "global/master", value: 0.66 }));
  await win.waitForFunction(() => Math.abs(window.__lumamap.S.master - 0.66) < 1e-6, null, { timeout: 10000 });
  // El mando recibe el estado (escenas, macros, luces).
  const st = await new Promise((resolve) => { good.ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.type === "state") resolve(m.state); }; });
  assert.ok(Array.isArray(st.scenes) && st.lights && "snapshots" in st.lights);
  good.ws.close();
});

await test("asistente: sin clave lo dice claro; una clave falsa no se guarda; la clave nunca llega a la página", async () => {
  const r = await win.evaluate(async () => {
    const ai = window.LumaDesktop.ai;
    const st0 = await ai.status();
    const step = await ai.step({ system: "x", tools: [], messages: [{ role: "user", content: "hola" }] });
    const bad = await ai.setKey("sk-ant-falsa-123");
    const st1 = await ai.status();
    return { st0, step, bad, st1, keys: Object.keys(ai) };
  });
  assert.equal(r.st0.hasKey, false);
  assert.match(r.step.error, /Falta la clave/);
  assert.equal(r.bad.ok, false, "clave falsa rechazada: " + r.bad.error);
  assert.equal(r.st1.hasKey, false, "no se guardó");
  assert.deepEqual(r.keys.sort(), ["cancel", "http", "setKey", "status", "step"], "no hay forma de leer la clave desde la página");
});
await test("IA local por el proceso principal: habla con Ollama de este equipo; rechaza internet y rutas que no son de Ollama", async () => {
  const http = await import("node:http");
  const fake = http.createServer((req, res) => { res.setHeader("content-type", "application/json"); res.end(req.url === "/api/tags" ? JSON.stringify({ models: [{ name: "qwen3:8b" }] }) : JSON.stringify({ version: "0.9.0" })); });
  await new Promise(r => fake.listen(0, "127.0.0.1", r));
  const port = fake.address().port;
  const r = await win.evaluate(async (port) => {
    const h = window.LumaDesktop.ai.http;
    return {
      tags: await h({ url: `http://127.0.0.1:${port}/api/tags` }),
      internet: await h({ url: "http://8.8.8.8/api/tags" }),
      path: await h({ url: `http://127.0.0.1:${port}/etc/passwd` }),
      off: await h({ url: "http://127.0.0.1:9/api/version", timeout: 2000 }),
    };
  }, port);
  fake.close();
  assert.equal(r.tags.ok, true); assert.equal(JSON.parse(r.tags.text).models[0].name, "qwen3:8b");
  assert.equal(r.internet.error, "not-local");
  assert.equal(r.path.error, "bad-path");
  assert.equal(r.off.ok, false, "Ollama apagado: error controlado, sin colgarse");
  const hw = await win.evaluate(() => window.LumaDesktop.hardwareProfile());
  assert.ok(hw.ram > 0 && hw.cores > 0, "perfil de hardware para recomendar el modelo");
});
await test("detección automática (RDM): el nodo dice qué luces tiene y la app las añade con su tipo, canales y dirección", async () => {
  // Nodo RDM falso en 127.0.0.2 con una cabeza móvil y un PAR RGB.
  const lights = [
    { uid: [0x4c, 0x55, 0, 0, 0, 1], info: { category: 0x0102, footprint: 7, startAddress: 101 }, maker: "Marca Test", model: "Beam 7R", label: "Cabeza izquierda",
      slots: [{ offset: 0, label: 0x0101 }, { offset: 1, type: 1, label: 0x0101 }, { offset: 2, label: 0x0102 }, { offset: 3, type: 1, label: 0x0102 }, { offset: 4, label: 0x0001 }, { offset: 5, label: 0x0205 }, { offset: 6, label: 0x0404 }] },
    { uid: [0x4c, 0x55, 0, 0, 0, 2], info: { category: 0x0101, footprint: 4, startAddress: 1 }, maker: "Marca Test", model: "PAR RGBW", label: "", slots: null },
  ];
  const rdmSock = dgram.createSocket({ type: "udp4", reuseAddr: true });
  await new Promise(r => rdmSock.bind(P.ARTNET_PORT, "127.0.0.2", r));
  rdmSock.setBroadcast(true);
  const reply = (pkt) => rdmSock.send(pkt, P.ARTNET_PORT, "127.255.255.255");
  const onReq = (b) => {
    const m = R.parseArtRdm(new Uint8Array(b));
    if (m?.op === "todRequest") reply(R.artTodData(m.addresses[0], lights.map(l => l.uid)));
    if (m?.op === "rdm" && m.rdm?.cc === R.CC.get) {
      const L = lights.find(l => R.uidStr(l.uid) === R.uidStr(m.rdm.dest));
      if (!L) return;
      const data = m.rdm.pid === R.PID.deviceInfo ? R.deviceInfoData(L.info) : m.rdm.pid === R.PID.manufacturerLabel ? new TextEncoder().encode(L.maker)
        : m.rdm.pid === R.PID.modelDescription ? new TextEncoder().encode(L.model) : m.rdm.pid === R.PID.deviceLabel ? new TextEncoder().encode(L.label)
        : m.rdm.pid === R.PID.slotInfo && L.slots ? R.slotInfoData(L.slots) : null;
      const resp = R.rdmPacket({ dest: m.rdm.src, src: L.uid, tn: m.rdm.tn, port: data ? R.RESPONSE.ack : R.RESPONSE.nack, cc: R.CC.getResponse, pid: m.rdm.pid, data: data || [0, 0] });
      reply(R.artRdm(m.portAddress, resp));
    }
  };
  node.on("message", onReq); rdmSock.on("message", onReq);
  await win.evaluate(() => window.__lumamap.dmx.detectLights());
  await win.waitForFunction(() => window.__lumamap.dmx.detected?.done, null, { timeout: 20000 });
  const r = await win.evaluate(() => {
    const D = window.__lumamap.dmx, devs = D.detected.devices;
    for (const d of devs) D.addDetected(d, { pan: "Pan", tilt: "Tilt" });
    return { devs, fx: D.cfg.fixtures.filter(f => f.rdmUid).map(f => ({ name: f.name, kind: f.kind, address: f.address, ch: f.channels.map(c => c.type), src: f.source })) };
  });
  node.off("message", onReq); rdmSock.close();
  assert.equal(r.devs.length, 2, JSON.stringify(r.devs));
  const head = r.fx.find(f => f.name === "Cabeza izquierda"), par = r.fx.find(f => /PAR/.test(f.name));
  assert.equal(head.kind, "Cabeza móvil (beam/spot)"); assert.equal(head.address, 101);
  assert.deepEqual(head.ch, ["pan", "panFine", "tilt", "tiltFine", "intensity", "red", "strobe"]);
  assert.deepEqual(par.ch, ["red", "green", "blue", "white"], "sin SLOT_INFO se deduce por tipo y canales");
  assert.equal(par.address, 1); assert.equal(par.src, "effect");
});
await test("sin errores de JavaScript", () => assert.deepEqual(errors, []));

await app.close();
node.close(); sacn.close();
report();
process.exit(process.exitCode || 0);
