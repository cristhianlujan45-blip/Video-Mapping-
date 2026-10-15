// desktop/ai.js — asistente de LumaMap (proceso principal de Electron).
// La clave de la API de Claude se guarda cifrada con el sistema (safeStorage:
// DPAPI en Windows, Llavero en macOS) y nunca llega a la página. La página
// (web/js/assistant.js) lleva la conversación y ejecuta las herramientas;
// aquí solo se hace cada llamada a la API con la clave.
const { ipcMain, safeStorage, app } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const { pullModel } = require("./ollama-pull.js");

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

  // IA local (Ollama u otro servidor compatible) desde el proceso principal: sin
  // problemas de CORS. Solo se permite hablar con este equipo o con la red local
  // (nunca con internet) y solo con las rutas de la API de Ollama.
  ipcMain.handle("ai:ollamaStart", (_e, endpoint) => startOllama(endpoint, log));
  ipcMain.handle("ai:ollamaFound", () => ({ found: !!findOllama(), canInstall: process.platform === "win32" }));
  let installing = null;
  ipcMain.handle("ai:ollamaInstall", async (e) => {
    if (installing) return { ok: false, error: "busy" };
    installing = new AbortController();
    try { return await installOllama({ signal: installing.signal, log, onProgress: (p) => { if (!e.sender.isDestroyed()) e.sender.send("ai:installProgress", p); } }); }
    finally { installing = null; }
  });

  // Descarga de un modelo con su progreso (lo que haría «ollama pull», sin terminal).
  const pulls = new Map();   // id de la ventana -> AbortController
  ipcMain.handle("ai:pull", async (e, req) => {
    let u;
    try { u = new URL(String(req?.endpoint || "http://localhost:11434").replace(/\/+$/, "") + "/api/pull"); } catch { return { ok: false, error: "bad-url" }; }
    if (!isLocalHost(u.hostname)) return { ok: false, error: "not-local" };
    const model = String(req?.model || "");
    if (!/^[\w.\-/]{1,80}(:[\w.\-]{1,40})?$/.test(model)) return { ok: false, error: "bad-model" };
    const ctl = new AbortController();
    pulls.get(e.sender.id)?.abort();
    pulls.set(e.sender.id, ctl);
    log("info", "IA local: descargando " + model);
    try {
      // Descarga vigilada: si se para, se reanuda sola donde iba (desktop/ollama-pull.js).
      const r = await pullModel({ endpoint: u.origin, model, signal: ctl.signal,
        stallMs: Number(process.env.LUMAMAP_PULL_STALL_MS) || 45000,
        retryDelay: Number(process.env.LUMAMAP_PULL_RETRY_MS) || 2000,
        onStuck: () => restartOllama(u.origin, log),
        onProgress: (p) => { if (!e.sender.isDestroyed()) e.sender.send("ai:pullProgress", { model, ...p }); } });
      log(r.ok ? "info" : "warn", `IA local: descarga de ${model} ${r.ok ? "terminada" : "sin terminar: " + r.error}${r.retries ? ` (${r.retries} reanudaciones)` : ""}`);
      return r;
    } finally { if (pulls.get(e.sender.id) === ctl) pulls.delete(e.sender.id); }
  });
  ipcMain.handle("ai:pullCancel", (e) => { pulls.get(e.sender.id)?.abort(); return true; });

  ipcMain.handle("ai:http", async (_e, req) => {
    let u;
    try { u = new URL(String(req?.url || "")); } catch { return { ok: false, error: "bad-url" }; }
    if (!/^https?:$/.test(u.protocol) || !isLocalHost(u.hostname)) return { ok: false, error: "not-local" };
    if (!/^\/api\/(tags|version|chat|show|ps|generate)$/.test(u.pathname)) return { ok: false, error: "bad-path" };
    try {
      const r = await fetch(u, {
        method: req.method === "POST" ? "POST" : "GET",
        headers: { "content-type": "application/json" },
        body: req.method === "POST" ? JSON.stringify(req.body ?? {}) : undefined,
        signal: AbortSignal.timeout(Math.max(1000, Math.min(600000, +req.timeout || 60000))),
      });
      const text = await r.text();
      return { ok: r.ok, status: r.status, text: text.slice(0, 4_000_000) };
    } catch (err) {
      return { ok: false, error: err?.name === "TimeoutError" ? "timeout" : (err?.cause?.code || err?.code || "network") };
    }
  });
}

/* ---------------- Ollama automático ---------------- */
// Si Ollama está instalado en este equipo pero cerrado, LumaMap lo arranca solo
// (oculto, como hace su icono de la bandeja) y descarga el modelo con un toque.

/** Dónde se instala Ollama en cada sistema (y lo que haya en el PATH). */
function ollamaCandidates(env = process.env, platform = process.platform) {
  const out = [];
  const exe = platform === "win32" ? "ollama.exe" : "ollama";
  if (platform === "win32") {
    if (env.LOCALAPPDATA) out.push(path.win32.join(env.LOCALAPPDATA, "Programs", "Ollama", exe));
    if (env.ProgramFiles) out.push(path.win32.join(env.ProgramFiles, "Ollama", exe));
    if (env.USERPROFILE) out.push(path.win32.join(env.USERPROFILE, "AppData", "Local", "Programs", "Ollama", exe));
  } else if (platform === "darwin") {
    out.push("/Applications/Ollama.app/Contents/Resources/ollama", "/opt/homebrew/bin/ollama", "/usr/local/bin/ollama");
  } else out.push("/usr/local/bin/ollama", "/usr/bin/ollama", "/snap/bin/ollama");
  const sep = platform === "win32" ? ";" : ":", join = platform === "win32" ? path.win32.join : path.posix.join;
  for (const d of String(env.PATH || env.Path || "").split(sep)) if (d) out.push(join(d, exe));
  return [...new Set(out)];
}
function findOllama() { return ollamaCandidates().find(f => { try { return fs.statSync(f).isFile(); } catch { return false; } }) || ""; }

async function ollamaUp(base, ms = 2000) {
  try { const r = await fetch(base + "/api/version", { signal: AbortSignal.timeout(ms) }); return r.ok; } catch { return false; }
}
const ollamaChildren = new Map();   // dirección -> proceso «ollama serve» que abrió LumaMap
/** Arranca «ollama serve» si está instalado y no responde (solo en este equipo). */
async function startOllama(endpoint = "http://localhost:11434", log = () => {}) {
  let u; try { u = new URL(endpoint); } catch { return { ok: false, error: "bad-url" }; }
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(u.hostname)) return { ok: false, error: "not-this-pc" };
  const base = u.origin;
  if (await ollamaUp(base)) return { ok: true, running: true, started: false };
  const exe = findOllama();
  if (!exe) return { ok: false, found: false, error: "not-installed" };
  const prev = ollamaChildren.get(base);
  if (!prev || prev.exitCode !== null) {
    try {
      const host = u.hostname === "localhost" ? "127.0.0.1" : u.hostname.replace(/^\[|\]$/g, "");
      // Si el usuario ya configuró OLLAMA_HOST (p. ej. para la red local), se respeta.
      const env = process.env.OLLAMA_HOST ? process.env : { ...process.env, OLLAMA_HOST: `${host}:${u.port || 11434}` };
      const child = spawn(exe, ["serve"], { detached: true, stdio: "ignore", windowsHide: true, env });
      child.on("error", () => {});
      child.unref();
      ollamaChildren.set(base, child);
      log("info", "IA local: arrancando Ollama (" + exe + ")");
    } catch (e) { return { ok: false, found: true, error: String(e.message || e) }; }
  }
  for (let i = 0; i < 40; i++) { if (await ollamaUp(base, 1000)) return { ok: true, running: true, started: true, path: exe }; await new Promise(r => setTimeout(r, 500)); }
  return { ok: false, found: true, error: "no-response" };
}

/**
 * Reinicia Ollama (solo el de este equipo): se usa cuando una descarga se queda colgada
 * por dentro y volver a pedirla no avanza. Después se abre de nuevo (startOllama).
 */
async function restartOllama(endpoint = "http://localhost:11434", log = () => {}) {
  let u; try { u = new URL(endpoint); } catch { return { ok: false }; }
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(u.hostname)) return { ok: false, error: "not-this-pc" };
  log("warn", "IA local: la descarga no avanza; reiniciando Ollama");
  const child = ollamaChildren.get(u.origin);
  if (child && child.exitCode === null) { try { process.kill(child.pid); } catch {} }
  if (process.platform === "win32") await execFileP("taskkill", ["/F", "/IM", "ollama.exe"], { timeout: 15000 });
  for (let i = 0; i < 20 && await ollamaUp(u.origin, 500); i++) await new Promise(r => setTimeout(r, 250));
  ollamaChildren.delete(u.origin);
  return startOllama(endpoint, log);
}

/* ---------------- Instalar Ollama (Windows) ---------------- */
// Un toque: descarga el instalador OFICIAL, comprueba su firma digital (Authenticode de
// Ollama) y lo instala en silencio para este usuario (sin pedir permisos de administrador).
// Si la firma no es válida, NO se ejecuta: se abre la página oficial de descarga.
const OLLAMA_SETUP = "https://ollama.com/download/OllamaSetup.exe";
const execFileP = (cmd, args, opts = {}) => new Promise((resolve) => require("node:child_process").execFile(cmd, args, { windowsHide: true, ...opts }, (err, out, errOut) => resolve({ err, out: String(out || ""), errOut: String(errOut || "") })));

/** Firma digital de un .exe: { valid, subject }. */
async function signatureOf(file) {
  const ps = `$s = Get-AuthenticodeSignature -LiteralPath '${file.replace(/'/g, "''")}'; @{ status = [string]$s.Status; subject = [string]$s.SignerCertificate.Subject } | ConvertTo-Json -Compress`;
  const r = await execFileP("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { timeout: 60000 });
  try { const j = JSON.parse(r.out.trim()); return { valid: j.status === "Valid", subject: j.subject || "" }; } catch { return { valid: false, subject: "" }; }
}

async function installOllama({ onProgress = () => {}, signal, log = () => {} } = {}) {
  if (process.platform !== "win32") return { ok: false, error: "only-windows" };
  if (findOllama()) return { ok: true, already: true };
  const os = require("node:os");
  const file = path.join(os.tmpdir(), "LumaMap-OllamaSetup.exe");
  try {
    onProgress({ phase: "download", completed: 0, total: 0 });
    const r = await fetch(OLLAMA_SETUP, { signal, redirect: "follow" });
    if (!r.ok || !r.body) return { ok: false, error: "HTTP " + r.status };
    const total = Number(r.headers.get("content-length")) || 0;
    const out = fs.createWriteStream(file);
    let done = 0, last = 0;
    for await (const chunk of r.body) {
      done += chunk.length;
      if (!out.write(chunk)) await new Promise(res => out.once("drain", res));
      if (Date.now() - last > 250) { last = Date.now(); onProgress({ phase: "download", completed: done, total }); }
    }
    await new Promise((res, rej) => out.end((e) => e ? rej(e) : res()));
    onProgress({ phase: "verify", completed: done, total });
    const sig = await signatureOf(file);
    log("info", `IA local: instalador de Ollama ${done} bytes, firma ${sig.valid ? "válida" : "NO válida"} (${sig.subject})`);
    if (!sig.valid || !/ollama/i.test(sig.subject)) { fs.rmSync(file, { force: true }); return { ok: false, error: "bad-signature" }; }
    onProgress({ phase: "install", completed: done, total });
    const res = await execFileP(file, ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/SP-"], { timeout: 15 * 60000 });
    fs.rmSync(file, { force: true });
    if (!findOllama()) return { ok: false, error: "install-failed" + (res.err ? ": " + res.err.message : "") };
    onProgress({ phase: "start", completed: done, total });
    const st = await startOllama("http://localhost:11434", log);
    return { ok: st.ok, error: st.ok ? undefined : "no-start" };
  } catch (e) {
    try { fs.rmSync(file, { force: true }); } catch {}
    return { ok: false, error: e?.name === "AbortError" ? "cancelled" : String(e?.message || e) };
  }
}

/** ¿Es este equipo o una IP privada de la red local? */
function isLocalHost(h) {
  h = h.replace(/^\[|\]$/g, "");
  if (h === "localhost" || h === "::1" || h.endsWith(".local")) return true;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (!m) return false;
  const [a, b] = [+m[1], +m[2]];
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

module.exports = { setup, MODEL, isLocalHost, ollamaCandidates, startOllama, signatureOf };
