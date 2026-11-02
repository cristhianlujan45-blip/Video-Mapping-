#!/usr/bin/env node
// server/mcp.js
// Servidor MCP (Model Context Protocol) de LumaMap: deja que un agente de IA —Claude Code,
// Cursor, Claude Desktop…— maneje LumaMap como lo haría una persona: ver el proyecto, construir
// redes de nodos con una frase o con su propio plan, cambiar parámetros, poner efectos y
// animaciones, proyectar y MIRAR el resultado (get_image).
// Habla MCP por stdio (JSON-RPC 2.0, un mensaje por línea) y pasa cada herramienta a la app
// abierta por el servidor local (POST /api/agent, solo este equipo, con el token de
// ~/.lumamap/agent.json). Sin dependencias.
//
//   Claude Code:   claude mcp add lumamap -- node /ruta/a/lumamap/server/mcp.js
//   App de escritorio (sin Node): ☰ → Ayuda y sistema → «Conectar un agente de IA (MCP)» da el comando.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TOOLS } from "../web/js/agent-tools.js";

const VERSION = "1.0.0";
const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const INSTRUCTIONS = "LumaMap es un programa de video mapping con un editor de redes de nodos como TouchDesigner. " +
  "Empieza con lumamap_status. Para crear visuales: build_from_text (una frase) o apply_plan (tu plan JSON; mira list_operators). " +
  "Comprueba siempre con get_image y proyecta con project_network. Efectos de superficie: list_effects / set_effects. Todo se puede deshacer en la app (Ctrl+Z).";

function connection() {
  if (process.env.LUMAMAP_URL && process.env.LUMAMAP_TOKEN) return { url: process.env.LUMAMAP_URL, token: process.env.LUMAMAP_TOKEN };
  const file = process.env.LUMAMAP_AGENT_FILE || path.join(os.homedir(), ".lumamap", "agent.json");
  try { const j = JSON.parse(fs.readFileSync(file, "utf8")); if (j.url && j.token) return j; } catch {}
  return null;
}

async function callApp(tool, args) {
  const c = connection();
  if (!c) return { error: "No encuentro LumaMap en este equipo. Abre la app de LumaMap (o «node server/index.js» y la página en el navegador) y vuelve a intentarlo." };
  try {
    const r = await fetch(new URL("/api/agent", c.url), { method: "POST", headers: { "content-type": "application/json", "x-lumamap-token": c.token }, body: JSON.stringify({ tool, args }), signal: AbortSignal.timeout(150000) });
    const j = await r.json().catch(() => ({ error: `respuesta no válida (${r.status})` }));
    if (!r.ok && !j.error) j.error = `error ${r.status}`;
    return j;
  } catch (e) {
    return { error: `LumaMap no responde (${e.cause?.code || e.message}). ¿Está abierta la app?` };
  }
}

/** El resultado de una herramienta en contenido MCP (las imágenes, como imágenes). */
export function toContent(res) {
  if (res.error) return { content: [{ type: "text", text: String(res.error) }], isError: true };
  const r = res.result ?? {};
  const content = [];
  if (r && typeof r.image === "string") {
    const m = r.image.match(/^data:(image\/\w+);base64,(.+)$/);
    if (m) content.push({ type: "image", data: m[2], mimeType: m[1] });
    const { image, ...rest } = r;
    void image;
    content.push({ type: "text", text: JSON.stringify(rest, null, 1) });
  } else content.push({ type: "text", text: JSON.stringify(r, null, 1) });
  return { content };
}

/** Responde un mensaje JSON-RPC (o null si es una notificación). Exportado para las pruebas. */
export async function handle(msg, call = callApp) {
  const { id, method, params = {} } = msg || {};
  const reply = (result) => (id === undefined ? null : { jsonrpc: "2.0", id, result });
  const error = (code, message) => (id === undefined ? null : { jsonrpc: "2.0", id, error: { code, message } });
  switch (method) {
    case "initialize": {
      const v = PROTOCOLS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOLS[0];
      return reply({ protocolVersion: v, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "lumamap", title: "LumaMap", version: VERSION }, instructions: INSTRUCTIONS });
    }
    case "notifications/initialized": case "notifications/cancelled": return null;
    case "ping": return reply({});
    case "tools/list": return reply({ tools: TOOLS });
    case "tools/call": {
      const t = TOOLS.find(x => x.name === params.name);
      if (!t) return error(-32602, `Herramienta desconocida: ${params.name}`);
      return reply(toContent(await call(t.name, params.arguments || {})));
    }
    default: return method?.startsWith("notifications/") ? null : error(-32601, `Método no soportado: ${method}`);
  }
}

const isMain = (() => { try { return !!process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]); } catch { return false; } })();
if (isMain) {
  let buf = "";
  const pending = new Set();
  const out = (o) => { if (o) process.stdout.write(JSON.stringify(o) + "\n"); };
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { out({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON no válido" } }); continue; }
      const batch = Array.isArray(msg) ? msg : [msg];
      for (const m of batch) {
        const p = handle(m).then(out, (e) => out({ jsonrpc: "2.0", id: m?.id ?? null, error: { code: -32603, message: String(e?.message || e) } }));
        pending.add(p); p.finally(() => pending.delete(p));
      }
    }
  });
  // Al cerrar la entrada: se contestan las que faltan y se termina.
  process.stdin.on("end", async () => { await Promise.allSettled([...pending]); process.exit(0); });
}
