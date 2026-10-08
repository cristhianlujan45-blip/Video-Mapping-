// desktop/ai.js — asistente de LumaMap (proceso principal de Electron).
// La clave de la API de Claude se guarda cifrada con el sistema (safeStorage:
// DPAPI en Windows, Llavero en macOS) y nunca llega a la página. La página
// (web/js/assistant.js) lleva la conversación y ejecuta las herramientas;
// aquí solo se hace cada llamada a la API con la clave.
const { ipcMain, safeStorage, app } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const MODEL = "claude-opus-5-5";
const keyFile = () => path.join(app.getPath("userData"), "assistant-key.bin");
const running = new Map();   // id de la ventana -> AbortController

function readKey() {
  if (process.env.ANTHROPIC_API_KEY) return { key: process.env.ANTHROPIC_API_KEY, source: "env" };
  try {
    const buf = fs.readFileSync(keyFile());
    if (!safeStorage.isEncryptionAvailable()) return { key: "", source: "" };
    return { key: safeStorage.decryptString(buf), source: "saved" };
  } catch { return { key: "", source: "" }; }
}

let SDK = null;
function client(key) {
  SDK = SDK || require("@anthropic-ai/sdk");
  const Anthropic = SDK.default || SDK;
  return new Anthropic({ apiKey: key, maxRetries: 2, timeout: 120000 });
}

/** Error de la API en palabras claras. */
function explain(err) {
  const s = err?.status;
  if (s === 401) return "La clave de la API no es válida.";
  if (s === 403) return "La clave no tiene permiso para usar este modelo.";
  if (s === 429) return "Demasiadas peticiones o sin saldo en la cuenta de la API. Prueba en un momento.";
  if (s === 529 || s === 503) return "El servicio de Claude está saturado. Prueba en un momento.";
  if (err?.name === "APIUserAbortError" || err?.name === "AbortError") return "Cancelado.";
  if (err?.name === "APIConnectionError" || err?.name === "APIConnectionTimeoutError") return "Sin conexión a internet (o tardó demasiado).";
  return String(err?.message || err);
}

function setup(log = () => {}) {
  ipcMain.handle("ai:status", () => {
    const k = readKey();
    return { hasKey: !!k.key, source: k.source, model: MODEL, canEncrypt: safeStorage.isEncryptionAvailable() };
  });

  ipcMain.handle("ai:setKey", async (_e, key) => {
    key = String(key || "").trim();
    if (!key) { fs.rmSync(keyFile(), { force: true }); return { ok: true, removed: true }; }
    if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: "Este sistema no permite guardar la clave cifrada." };
    // Comprobar la clave antes de guardarla (no gasta tokens).
    try { await client(key).models.retrieve(MODEL); }
    catch (err) { return { ok: false, error: explain(err) }; }
    fs.writeFileSync(keyFile(), safeStorage.encryptString(key));
    log("info", "Asistente: clave guardada (cifrada)");
    return { ok: true };
  });

  /** Una vuelta de la conversación: la página manda el historial y recibe la respuesta completa. */
  ipcMain.handle("ai:step", async (e, req) => {
    const { key } = readKey();
    if (!key) return { error: "Falta la clave de la API de Claude (Asistente → Configurar)." };
    const ctl = new AbortController();
    running.set(e.sender.id, ctl);
    try {
      const r = await client(key).beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        system: req.system,
        tools: req.tools,
        tool_choice: { type: "auto" },
        messages: req.messages,
        output_config: { effort: req.effort === "medium" ? "medium" : "low" },
        // Si el modelo declina una petición, la API la repite con el modelo alternativo recomendado.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      }, { signal: ctl.signal });
      const fellBack = (r.usage?.iterations || []).some(x => x.type === "fallback_message");
      return { content: r.content, stop_reason: r.stop_reason, model: r.model, fellBack, usage: { in: r.usage?.input_tokens || 0, out: r.usage?.output_tokens || 0 } };
    } catch (err) {
      log("error", "Asistente: " + (err?.message || err));
      return { error: explain(err) };
    } finally { running.delete(e.sender.id); }
  });

  ipcMain.handle("ai:cancel", (e) => { running.get(e.sender.id)?.abort(); return true; });
}

module.exports = { setup, MODEL };
