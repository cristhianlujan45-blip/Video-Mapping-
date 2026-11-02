// tests/mcp.test.js — Servidor MCP (Claude Code, Cursor…): protocolo y seguridad del puente.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, report } from "./harness.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lumamap-agent-"));
process.env.LUMAMAP_AGENT_FILE = path.join(tmp, "agent.json");
const { handle, toContent } = await import("../server/mcp.js");
const { TOOLS } = await import("../web/js/agent-tools.js");
const { createServer } = await import("../server/index.js");

console.log("== MCP ==");
await test("protocolo: initialize, tools/list, ping, notificaciones sin respuesta y métodos desconocidos", async () => {
  const init = await handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
  assert.equal(init.result.protocolVersion, "2025-06-18"); assert.ok(init.result.capabilities.tools); assert.equal(init.result.serverInfo.name, "lumamap");
  assert.equal((await handle({ jsonrpc: "2.0", id: 9, method: "initialize", params: { protocolVersion: "1999-01-01" } })).result.protocolVersion, "2025-06-18", "una versión que conoce");
  assert.equal(await handle({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
  assert.deepEqual((await handle({ jsonrpc: "2.0", id: 2, method: "ping" })).result, {});
  const list = (await handle({ jsonrpc: "2.0", id: 3, method: "tools/list" })).result.tools;
  assert.equal(list.length, TOOLS.length);
  for (const t of list) { assert.match(t.name, /^[a-z_]+$/); assert.ok(t.description.length > 20); assert.equal(t.inputSchema.type, "object"); }
  assert.equal((await handle({ jsonrpc: "2.0", id: 4, method: "resources/list" })).error.code, -32601);
  assert.equal((await handle({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "borrar_disco" } })).error.code, -32602);
});
await test("tools/call: el resultado como texto, las imágenes como imágenes y los errores como error", async () => {
  const seen = [];
  const r = await handle({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "get_image", arguments: { height: 200 } } },
    async (tool, args) => { seen.push([tool, args]); return { result: { image: "data:image/png;base64,iVBORw0KGgo=", what: "la proyección" } }; });
  assert.deepEqual(seen, [["get_image", { height: 200 }]]);
  assert.deepEqual(r.result.content[0], { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" });
  assert.match(r.result.content[1].text, /proyección/);
  assert.deepEqual(toContent({ error: "LumaMap no está abierto" }), { content: [{ type: "text", text: "LumaMap no está abierto" }], isError: true });
});
await test("el puente del servidor: escribe el acceso solo para el usuario; sin token o con uno falso no deja; sin la app abierta lo dice", async () => {
  const srv = createServer({ port: 0, osc: false, agent: true });
  await new Promise(r => srv.listen(0, "127.0.0.1", r));
  try {
    const j = JSON.parse(fs.readFileSync(process.env.LUMAMAP_AGENT_FILE, "utf8"));
    assert.equal(j.port, srv.address().port); assert.match(j.token, /^[0-9a-f]{48}$/);
    if (process.platform !== "win32") assert.equal(fs.statSync(process.env.LUMAMAP_AGENT_FILE).mode & 0o077, 0, "solo el usuario puede leerlo");
    const post = (headers, body = { tool: "lumamap_status" }) => fetch(j.url + "/api/agent", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    assert.equal((await post({})).status, 401);
    assert.equal((await post({ "x-lumamap-token": "0".repeat(48) })).status, 401);
    assert.equal((await fetch(j.url + "/api/agent", { headers: { "x-lumamap-token": j.token } })).status, 405);
    const r = await (await post({ "x-lumamap-token": j.token })).json();
    assert.match(r.error, /no está abierto/);
    // El servidor MCP de verdad (proceso aparte) lee ese acceso y dice lo mismo.
    const { spawn } = await import("node:child_process");
    const p = spawn(process.execPath, ["server/mcp.js"], { env: { ...process.env } });
    let out = "";
    p.stdout.on("data", d => { out += d; });
    p.stdin.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "lumamap_status", arguments: {} } }) + "\n");
    await new Promise(r => p.on("exit", r));
    const msg = JSON.parse(out.trim().split("\n").at(-1));
    assert.equal(msg.result.isError, true); assert.match(msg.result.content[0].text, /no está abierto/);
  } finally { srv.close(); }
});
await test("un servidor sin agente (o el https del móvil) no tiene /api/agent", async () => {
  const srv = createServer({ port: 0, osc: false });
  await new Promise(r => srv.listen(0, "127.0.0.1", r));
  try { assert.equal((await fetch(`http://127.0.0.1:${srv.address().port}/api/agent`, { method: "POST" })).status, 404); }
  finally { srv.close(); }
});
report();
