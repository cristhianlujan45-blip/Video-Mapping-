// tests/mcp.browser.test.js — Un agente de IA (como Claude Code) maneja LumaMap por MCP de punta a
// punta: servidor local con el puente, la app abierta en el navegador y server/mcp.js en su
// propio proceso hablando JSON-RPC por stdio.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { test, report } from "./harness.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lumamap-mcp-"));
process.env.LUMAMAP_AGENT_FILE = path.join(tmp, "agent.json");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { createServer } = await import("../server/index.js");

const srv = createServer({ port: 0, osc: false, agent: true });
await new Promise(r => srv.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message));
await page.goto(`http://127.0.0.1:${srv.address().port}/`);
await page.waitForTimeout(800);
await page.getByText("Cubo 3D").click();
await page.evaluate(() => { const a = window.__lumamap.actions; a.applyQuality("low"); a.setPreview({ scale: 0.25 }); });
// La app se conecta sola al servidor local como «display».
await page.waitForFunction(() => window.__lumamap.remote?.ws?.readyState === 1, null, { timeout: 20000 });

// Un cliente MCP mínimo (como Claude Code).
const mcp = spawn(process.execPath, ["server/mcp.js"], { env: { ...process.env } });
let buf = "", seq = 0;
const waiting = new Map();
mcp.stdout.on("data", d => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); waiting.get(m.id)?.(m); waiting.delete(m.id); } });
const rpc = (method, params) => new Promise((resolve, reject) => { const id = ++seq; const t = setTimeout(() => reject(new Error("sin respuesta: " + method)), 120000); waiting.set(id, (m) => { clearTimeout(t); resolve(m); }); mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
const call = async (name, args = {}) => {
  const m = await rpc("tools/call", { name, arguments: args });
  if (m.error) throw new Error(m.error.message);
  const text = m.result.content.find(c => c.type === "text")?.text || "";
  if (m.result.isError) throw new Error(text);
  return { data: JSON.parse(text), images: m.result.content.filter(c => c.type === "image") };
};

console.log("== Agente de IA por MCP (de punta a punta) ==");
await test("se presenta y ve el proyecto", async () => {
  const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "prueba", version: "1" } });
  assert.equal(init.result.serverInfo.name, "lumamap");
  mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  const { data } = await call("lumamap_status");
  assert.ok(data.surfaces.length >= 3, "el cubo tiene superficies"); assert.ok(data.scenes.length >= 1);
});
await test("«escribe y se construye» desde el agente: una frase → una red que da imagen, y la proyecta", async () => {
  const { data } = await call("build_from_text", { text: "colores que bailan con la música en caleidoscopio", new_network: true });
  assert.ok(data.created.length >= 4, data.created); assert.match(data.say, /caleidoscopio/i);
  const net = (await call("get_network", { network: data.network })).data;
  assert.ok(net.nodes.some(n => n.op === "TOP/kaleido")); assert.equal(net.display, net.nodes.find(n => n.op === "TOP/out").name);
  const img = await call("get_image", { network: data.network, node: net.display, height: 120 });
  assert.equal(img.images.length, 1); assert.equal(img.images[0].mimeType, "image/png"); assert.ok(img.images[0].data.length > 500);
  const pr = (await call("project_network", { network: data.network })).data;
  assert.match(pr.shows, /out/);
});
await test("su propio plan, nodos, cables, parámetros (con expresiones) y movimiento; lo que no vale se rechaza con un mensaje claro", async () => {
  const { data } = await call("apply_plan", { new_network: true, plan: { title: "Aro", nodes: [{ id: "a", op: "TOP/circle", p: { radius: 0.3, color: "#00e5ff" } }, { id: "b", op: "TOP/glow", p: { amount: 9 } }], wires: [{ from: "a", to: "b" }] } });
  assert.deepEqual(data.created.length, 3, "con su Salida");
  const glow = data.nodes.find(n => n.op === "TOP/glow");
  const net = data.network;
  const blur = (await call("create_node", { network: net, op: "TOP/blur", after: glow.name, params: { size: 0.2 } })).data.created;
  assert.deepEqual(blur.inputs, [glow.name]);
  const lfo = (await call("create_node", { network: net, op: "CHOP/lfo", params: { rate: 0.5 } })).data.created;
  const sp = (await call("set_params", { network: net, node: blur.name, params: { size: { e: `${lfo.name}.chan1 * 0.5` }, inventado: 1 } })).data;
  assert.equal(sp.node.params.size.e, `${lfo.name}.chan1 * 0.5`); assert.match(sp.warnings[0], /inventado/);
  const mv = (await call("move_with", { network: net, node: data.nodes.find(n => n.op === "TOP/circle").name, param: "radius", with: "beat", range: [0.2, 0.4] })).data;
  assert.match(mv.expression, /^fit\(beat\d*\.beat, 0, 1, 0\.2, 0\.4\)$/);
  await assert.rejects(call("connect", { network: net, from: lfo.name, to: blur.name }), /CHOP no se puede conectar/);
  await assert.rejects(call("create_node", { network: net, op: "TOP/explosion" }), /No existe el operador/);
  await assert.rejects(call("set_params", { network: net, node: "noexiste", params: {} }), /No hay ningún nodo/);
  const del = (await call("delete_nodes", { network: net, nodes: [blur.name] })).data;
  assert.ok(!del.left.includes(blur.name));
});
await test("efectos y animaciones de una superficie, escenas, y la proyección como imagen", async () => {
  const fx = (await call("list_effects", { category: "analógico" })).data;
  assert.ok(fx.presets.length >= 25 && fx.params.film);
  const se = (await call("set_effects", { preset: "Cinta VHS gastada", effects: { grain: 0.6, kaleido: 99, nada: 1 } })).data;
  assert.equal(se.effects.vhs, 0.9); assert.equal(se.effects.grain, 0.6); assert.equal(se.effects.kaleido, 16, "dentro de su rango"); assert.match(se.warnings[0], /nada/);
  const an = (await call("list_animations", { query: "aurora" })).data.animations;
  assert.ok(an.length >= 1);
  assert.equal((await call("set_animation", { name: an[0].name })).data.shows, an[0].name);
  assert.ok((await call("go_scene", { scene: "1" })).data.scene);
  const img = await call("get_image", { height: 180 });
  assert.equal(img.images[0].mimeType, "image/png"); assert.ok(img.images[0].data.length > 1000);
});
await test("todo queda en el deshacer de la app y sin errores de JavaScript", async () => {
  const st = await page.evaluate(() => ({ nets: window.__lumamap.S.project.networks.length }));
  assert.ok(st.nets >= 2);
  assert.deepEqual(errors, []);
});

mcp.stdin.end();
await browser.close();
srv.close();
report();
