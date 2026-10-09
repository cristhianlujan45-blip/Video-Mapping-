// web/js/ai/providers.js
// AI ENGINE con proveedores intercambiables:
//   NoAIProvider     → siempre disponible: reglas, analizador, guía e intérprete.
//   LocalAIProvider  → Ollama (gratis, sin internet tras instalar el modelo).
//   RemoteAIProvider → Claude a través de la app de escritorio (clave cifrada).
// Para añadir otro proveedor (OpenAI, Gemini…) basta con una clase que
// implemente ask(); el resto de la app no cambia.
//
// Reglas: la IA nunca es obligatoria; todo es asíncrono (jamás dentro del bucle
// de render); si algo falla se vuelve al modo sin IA con un mensaje claro; la IA
// solo PROPONE acciones de la lista blanca (actions.js) y el usuario las aplica.
import { buildProjectContext, contextForPrompt } from "./context.js";
import { analyzeProject, nextStep } from "./analyzer.js";
import { validateAction, actionCatalogText } from "./actions.js";
import { searchKnowledge } from "./knowledge.js";
import { parseCommand, HELP } from "./commands.js";
import { planFromRules, normalizePlan, PLAN_SCHEMA } from "./showplan.js";
import { detectHardware, recommendTier, pickModel, isVisionModel } from "./hardware.js";
import { detectQuads } from "../automap.js";

/* ---------------- Ajustes (de la app, no del proyecto) ---------------- */
const KEY = "lumamap:ai";
export const DEFAULT_SETTINGS = {
  enabled: true, provider: "auto",          // auto | local | remote | none
  allowLocal: true, allowRemote: false,      // la IA remota viene DESACTIVADA
  allowImages: false, allowProjectData: false, saveConversations: false,
  autoSuggestions: true, vision: false,
  endpoint: "http://localhost:11434", model: "", temperature: 0.3, contextSize: 8192,
  setupDismissed: false,
};
export function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return { ...DEFAULT_SETTINGS }; }
}
export function saveSettings(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} }

/* ---------------- Errores comprensibles ---------------- */
export class AIUnavailable extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
export const MSG = {
  offline: "No se pudo conectar con la IA local. LumaMap continúa funcionando normalmente.",
  notInstalled: "Puedes utilizar LumaMap normalmente. Si deseas activar IA local: instala Ollama.",
  noModel: (m) => `El modelo «${m}» no está instalado en Ollama. Instálalo con: ollama pull ${m}`,
  noModels: "Ollama está en marcha pero no tiene ningún modelo. Instala uno con: ollama pull qwen3:8b",
  timeout: "La IA tardó demasiado en responder. LumaMap continúa funcionando normalmente.",
  memory: "El modelo no cabe en la memoria de este equipo. Elige uno más pequeño en Diagnóstico del equipo.",
  remoteOff: "La IA remota está desactivada (Privacidad).",
  noKey: "Falta la clave de la IA remota.",
  generic: "IA no disponible. LumaMap continúa funcionando en modo normal.",
};

/* ---------------- Transporte HTTP a la IA local ---------------- */
// Android: la página es https y no puede pedir http://IP:11434; lo hace la app
// (LocalAi.kt, mismas reglas que en Windows) y responde a __lumaAiHttp(id, r).
const aiWait = new Map();
let aiSeq = 0;
export function androidAiHttp(N = globalThis.LumaNative) {
  if (!N?.aiHttp) return null;
  globalThis.__lumaAiHttp = (id, r) => { const f = aiWait.get(id); aiWait.delete(id); f?.(r || { ok: false, error: "network" }); };
  return (req) => new Promise((resolve) => {
    const id = ++aiSeq;
    aiWait.set(id, resolve);
    try { N.aiHttp(id, req.url, req.method === "POST" ? "POST" : "GET", req.body ? JSON.stringify(req.body) : "", Math.round(req.timeout || 60000)); }
    catch { aiWait.delete(id); resolve({ ok: false, error: "network" }); }
  });
}

/** Petición a la API de Ollama: por el proceso principal en escritorio o la app de Android (sin CORS), fetch en el navegador. */
export async function localHttp(endpoint, path, { method = "GET", body, timeout = 60000, fetchImpl } = {}) {
  const url = endpoint.replace(/\/+$/, "") + path;
  const bridge = globalThis.LumaDesktop?.ai?.http || androidAiHttp();
  if (bridge && !fetchImpl) {
    const r = await bridge({ url, method, body, timeout });
    if (!r.ok && !r.status) throw new AIUnavailable(r.error === "timeout" ? "timeout" : r.error === "not-local" ? "notLocal" : "offline", r.error === "timeout" ? MSG.timeout : r.error === "not-local" ? "Por seguridad, la IA local solo puede estar en este equipo o en tu red local." : MSG.offline);
    return { status: r.status, ok: r.ok, text: r.text };
  }
  const f = fetchImpl || globalThis.fetch;
  try {
    const r = await f(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeout) });
    return { status: r.status, ok: r.ok, text: await r.text() };
  } catch (e) {
    throw new AIUnavailable(e?.name === "TimeoutError" ? "timeout" : "offline", e?.name === "TimeoutError" ? MSG.timeout : MSG.offline);
  }
}
/** JSON de la respuesta de un modelo (quita <think>…</think> y ```json). */
export function parseModelJson(s) {
  let t = String(s || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1];
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("La IA no devolvió JSON");
  return JSON.parse(t.slice(a, b + 1));
}

const SYSTEM = `Eres el asistente de LumaMap, una aplicación de video mapping, VJ, luces DMX, proyección interactiva y show control.
Ayudas a usar la app, configurar proyectos, detectar problemas, aprender mapping y preparar shows.
Respondes en español, breve (1-3 frases), claro y profesional. Explica, recomienda y, si hace falta, propone acciones.
Usa SOLO los datos del contexto del proyecto: no inventes superficies, salidas, archivos ni dispositivos.
Las acciones son propuestas: el usuario decide si las aplica. Usa solo acciones del catálogo, con sus parámetros.
Si algo no se puede hacer con el catálogo, dilo y explica cómo hacerlo a mano.`;
const REPLY_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    actions: { type: "array", items: { type: "object", properties: { action: { type: "string" }, parameters: { type: "object" } }, required: ["action"] } },
    intent: { type: "string", enum: ["none", "show", "diagnose", "optimize", "automap", "explain"] },
  },
  required: ["reply", "actions"],
};

/* ======================================================================
   Proveedores
   ====================================================================== */
export class AIProvider {
  constructor(engine) { this.engine = engine; }
  get id() { return "base"; }
  get label() { return "IA"; }
  get app() { return this.engine.app; }
  async status() { return { available: false, reason: MSG.generic }; }
  /** Pregunta al modelo y devuelve un objeto JSON (lo implementan los proveedores con IA). */
  async ask() { throw new AIUnavailable("generic", MSG.generic); }

  /** Conversación: devuelve { reply, proposals, intent, source }. */
  async chat({ text, ctx, history = [] }) {
    const docs = searchKnowledge(text, 3).map(a => `### ${a.title}\n${a.text}`).join("\n\n");
    const user = [
      `CONTEXTO DEL PROYECTO (JSON): ${this.contextAllowed() ? contextForPrompt(ctx) : "(no compartido: privacidad)"}`,
      docs ? `GUÍA DE LA APP:\n${docs}` : "",
      `CATÁLOGO DE ACCIONES:\n${actionCatalogText()}`,
      `PETICIÓN DEL USUARIO: ${text}`,
      `Responde con JSON: {"reply": "...", "actions": [{"action": "...", "parameters": {...}}], "intent": "none|show|diagnose|optimize|automap|explain"}`,
    ].filter(Boolean).join("\n\n");
    const out = await this.ask({ system: SYSTEM, user, history, schema: REPLY_SCHEMA });
    const proposals = (Array.isArray(out.actions) ? out.actions : []).slice(0, 8).map(a => validateAction(this.app, a));
    return { reply: String(out.reply || "").slice(0, 1200), proposals, intent: out.intent && out.intent !== "none" ? out.intent : null, source: this.label };
  }
  contextAllowed() { return true; }
  async analyzeProject(ctx) { return analyzeProject(ctx); }
  async explainFunction(topic) {
    const arts = searchKnowledge(topic, 3);
    if (!arts.length) return { text: "No tengo una guía sobre eso. Prueba con otras palabras (por ejemplo «máscaras», «luces», «proyector»).", articles: [] };
    try {
      const out = await this.ask({ system: SYSTEM, user: `Explica de forma breve y práctica, paso a paso si hace falta, esta duda: «${topic}». Usa solo esta guía:\n${arts.map(a => a.title + ": " + a.text).join("\n")}\nResponde JSON {"reply": "..."}`, schema: { type: "object", properties: { reply: { type: "string" } }, required: ["reply"] } });
      return { text: out.reply, articles: arts };
    } catch { return { text: arts[0].text, articles: arts }; }
  }
  async diagnoseProblem(ctx, question = "") {
    const an = analyzeProject(ctx);
    const issues = /lento|velocidad|fps|tirones|rendim/i.test(question) ? an.issues.filter(i => i.area === "performance" || i.area === "media") : an.issues;
    return { issues: issues.length ? issues : an.issues, scores: an.scores };
  }
  async optimizeProject(ctx) {
    const an = analyzeProject(ctx);
    return { issues: an.issues.filter(i => ["performance", "media", "output"].includes(i.area)), scores: an.scores };
  }
  async generateMappingSuggestion(ctx) { return nextStep(ctx); }
  async generateShowPlan(text, ctx) {
    const base = planFromRules(text, ctx);
    const anims = (await import("../model.js")).ANIM_LIBRARY.map(a => a.name);
    const lights = (await import("../lightfx.js")).LIGHT_FX.map(f => f.name);
    const out = await this.ask({ system: SYSTEM, schema: PLAN_SCHEMA,
      user: `Crea un plan de show para: «${text}». Secciones típicas INTRO, BUILD, DROP, BREAK, CLIMAX, OUTRO (adáptalas). Duración total y BPM según la petición (por defecto ${base.seconds} s y ${base.bpm} BPM).
Usa SOLO estas animaciones: ${anims.join(", ")}.
Usa SOLO estos efectos de luces (o vacío si no hay luces): ${lights.join(", ")}.
Transiciones: cut, fade, dissolve, wipe, wipeV, iris, flash, glitch. Responde JSON con title, bpm y sections [{name, seconds, animation, transition, lights, audio, effect, energy}].` });
    return normalizePlan({ ...out, brief: text, source: this.label }, ctx);
  }
  async analyzeImage(img) { return classicVision(img); }
}

/** Visión clásica (sin IA): contornos de 4 lados en la imagen (automap.js). */
export function classicVision(img) {
  const quads = detectQuads(img, { maxQuads: 8, minAreaRatio: 0.01 });
  return { source: "Detección de contornos", surfaces: quads.map(q => ({ points: q.points.map(p => [p.x / img.width, p.y / img.height]), confidence: Math.min(1, q.area / (img.width * img.height) * 4), label: "Superficie" })) };
}

export class NoAIProvider extends AIProvider {
  get id() { return "none"; }
  get label() { return "Sin IA"; }
  async status() { return { available: true, reason: "" }; }
  async chat({ text, ctx }) {
    const c = parseCommand(this.app, text);
    let reply = c.reply;
    if (c.intent === "explain" && !c.actions.length) {
      const arts = searchKnowledge(text, 2);
      reply = arts.length ? `${arts[0].title}: ${arts[0].text}` : "No lo entendí del todo. " + HELP;
    }
    return { reply, proposals: c.actions.map(a => validateAction(this.app, a)), intent: c.intent && c.intent !== "explain" ? c.intent : null, source: this.label };
  }
  async explainFunction(topic) {
    const arts = searchKnowledge(topic, 3);
    return { text: arts.length ? arts[0].text : "No tengo una guía sobre eso todavía.", articles: arts };
  }
  async generateShowPlan(text, ctx) { return planFromRules(text, ctx); }
}

export class LocalAIProvider extends AIProvider {
  get id() { return "local"; }
  get label() { return "IA local"; }
  get s() { return this.engine.settings; }
  /** ¿Ollama instalado y en marcha? ¿qué modelos tiene? */
  async status() {
    const s = this.s;
    try {
      const v = await localHttp(s.endpoint, "/api/version", { timeout: 2500, fetchImpl: this.engine.fetchImpl });
      if (!v.ok) return { available: false, code: "offline", reason: MSG.offline };
      const t = await localHttp(s.endpoint, "/api/tags", { timeout: 4000, fetchImpl: this.engine.fetchImpl });
      const models = (JSON.parse(t.text || "{}").models || []).map(m => ({ name: m.name, size: m.size || 0, params: m.details?.parameter_size || "", family: m.details?.family || "" }));
      if (!models.length) return { available: false, code: "noModels", reason: MSG.noModels, version: JSON.parse(v.text || "{}").version, models };
      const model = pickModel(models, this.engine.hw, s.model);
      if (s.model && s.model !== model) return { available: false, code: "noModel", reason: MSG.noModel(s.model), models, model: s.model };
      return { available: true, version: JSON.parse(v.text || "{}").version, models, model, vision: models.some(m => isVisionModel(m.name)) };
    } catch (e) {
      return { available: false, code: e.code === "offline" ? "notInstalled" : e.code || "offline", reason: e.code === "offline" ? MSG.notInstalled : e.message };
    }
  }
  async ask({ system, user, history = [], schema, images, model }) {
    const s = this.s, st = this.engine.state.local;
    const m = model || st?.model || s.model;
    if (!m) throw new AIUnavailable("noModels", MSG.noModels);
    const body = {
      model: m, stream: false, keep_alive: "10m", think: false,
      messages: [{ role: "system", content: system }, ...history.slice(-6), { role: "user", content: user, ...(images ? { images } : {}) }],
      format: schema || "json", options: { temperature: s.temperature, num_ctx: s.contextSize },
    };
    let r = await localHttp(s.endpoint, "/api/chat", { method: "POST", body, timeout: 180000, fetchImpl: this.engine.fetchImpl });
    // Versiones o modelos sin «think»: se repite sin ese campo.
    if (!r.ok && /think/i.test(r.text || "")) { delete body.think; r = await localHttp(s.endpoint, "/api/chat", { method: "POST", body, timeout: 180000, fetchImpl: this.engine.fetchImpl }); }
    if (!r.ok) {
      const err = (() => { try { return JSON.parse(r.text).error || ""; } catch { return r.text || ""; } })();
      if (r.status === 404 || /not found/i.test(err)) throw new AIUnavailable("noModel", MSG.noModel(m));
      if (/memory|out of memory|requires more/i.test(err)) throw new AIUnavailable("memory", MSG.memory);
      throw new AIUnavailable("generic", MSG.generic);
    }
    const msg = JSON.parse(r.text || "{}").message?.content || "";
    try { return parseModelJson(msg); }
    catch { return { reply: msg.replace(/<think>[\s\S]*?<\/think>/g, "").trim().slice(0, 1200), actions: [] }; }
  }
  /** Imágenes: con un modelo de visión instalado y permiso de imágenes; si no, visión clásica. */
  async analyzeImage(img) {
    const s = this.s, st = this.engine.state.local;
    const vm = st?.models?.find(m => isVisionModel(m.name))?.name;
    if (!s.allowImages || !s.vision || !vm || typeof document === "undefined") return classicVision(img);
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    c.getContext("2d").putImageData(img, 0, 0);
    const b64 = c.toDataURL("image/jpeg", 0.85).split(",")[1];
    try {
      const out = await this.ask({ model: vm, images: [b64], system: "Detectas superficies planas proyectables (paredes, paneles, cajas, ventanas) en fotos.",
        user: 'Devuelve JSON {"surfaces":[{"label":"...","points":[[x,y],[x,y],[x,y],[x,y]]}]} con las 4 esquinas de cada superficie en coordenadas 0..1 (arriba-izquierda, arriba-derecha, abajo-derecha, abajo-izquierda). Máximo 8.',
        schema: { type: "object", properties: { surfaces: { type: "array", items: { type: "object", properties: { label: { type: "string" }, points: { type: "array", items: { type: "array", items: { type: "number" } } } }, required: ["points"] } } }, required: ["surfaces"] } });
      const surfaces = (out.surfaces || []).filter(x => Array.isArray(x.points) && x.points.length === 4 && x.points.every(p => Array.isArray(p) && p.length === 2 && p.every(v => Number.isFinite(v) && v >= -0.05 && v <= 1.05)))
        .slice(0, 8).map(x => ({ label: String(x.label || "Superficie").slice(0, 30), points: x.points.map(([a, b]) => [Math.max(0, Math.min(1, a)), Math.max(0, Math.min(1, b))]), confidence: 0.6 }));
      return surfaces.length ? { source: `IA de visión (${vm})`, surfaces } : classicVision(img);
    } catch { return classicVision(img); }
  }
}

export class RemoteAIProvider extends AIProvider {
  get id() { return "remote"; }
  get label() { return "IA remota (Claude)"; }
  get bridge() { return globalThis.LumaDesktop?.ai || null; }
  contextAllowed() { return !!this.engine.settings.allowProjectData; }
  async status() {
    if (!this.engine.settings.allowRemote) return { available: false, code: "remoteOff", reason: MSG.remoteOff };
    if (!this.bridge) return { available: false, code: "noDesktop", reason: globalThis.LumaNative ? "La IA remota (Claude) solo está en la app de Windows. En Android: IA local (Ollama) o el asistente sin IA." : "La IA remota está en la app de escritorio." };
    try { const s = await this.bridge.status(); return s.hasKey ? { available: true, model: s.model } : { available: false, code: "noKey", reason: MSG.noKey }; }
    catch { return { available: false, code: "noDesktop", reason: MSG.generic }; }
  }
  async ask({ system, user, history = [], schema }) {
    if (!this.engine.settings.allowRemote) throw new AIUnavailable("remoteOff", MSG.remoteOff);
    const tool = { name: "respond", description: "Devuelve la respuesta estructurada para LumaMap.", input_schema: schema || { type: "object", properties: { reply: { type: "string" } }, required: ["reply"] } };
    const messages = [...history.slice(-6).map(m => ({ role: m.role, content: m.content })), { role: "user", content: user + "\n\nResponde llamando a la herramienta «respond»." }];
    const r = await this.bridge.step({ system, tools: [tool], messages, effort: "low" });
    if (r.error) throw new AIUnavailable("remote", r.error);
    if (r.stop_reason === "refusal") throw new AIUnavailable("refusal", "La IA remota no puede ayudar con esta petición.");
    const use = (r.content || []).find(b => b.type === "tool_use" && b.name === "respond");
    if (use) return use.input;
    const text = (r.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
    try { return parseModelJson(text); } catch { return { reply: text.slice(0, 1200), actions: [] }; }
  }
}

/* ======================================================================
   Motor
   ====================================================================== */
export class AIEngine {
  constructor(app, { fetchImpl } = {}) {
    this.app = app; this.fetchImpl = fetchImpl;
    this.settings = loadSettings();
    this.none = new NoAIProvider(this); this.local = new LocalAIProvider(this); this.remote = new RemoteAIProvider(this);
    this.state = { local: null, remote: null, checkedAt: 0 };
    this.hw = null; this.notice = ""; this.listeners = new Set();
  }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const fn of this.listeners) { try { fn(); } catch {} } }
  setSettings(patch) { Object.assign(this.settings, patch); saveSettings(this.settings); this.state.checkedAt = 0; this.emit(); }

  /** Detecta qué hay disponible (no bloquea nada; se puede llamar cuando se quiera). */
  async refresh({ force = false } = {}) {
    if (!force && Date.now() - this.state.checkedAt < 15000 && this.state.local) return this.state;
    if (!this.hw) { try { this.hw = await detectHardware(this.app); } catch { this.hw = null; } }
    const s = this.settings;
    const [local, remote] = await Promise.all([
      s.enabled && s.allowLocal ? this.local.status() : Promise.resolve({ available: false, code: "off", reason: "IA local desactivada." }),
      s.enabled && s.allowRemote ? this.remote.status() : Promise.resolve({ available: false, code: "remoteOff", reason: MSG.remoteOff }),
    ]);
    this.state = { local, remote, checkedAt: Date.now() };
    this.emit();
    return this.state;
  }
  /** Proveedor que se usará ahora (según ajustes y lo detectado). */
  get active() {
    const s = this.settings, st = this.state;
    if (!s.enabled || s.provider === "none") return this.none;
    if ((s.provider === "local" || s.provider === "auto") && s.allowLocal && st.local?.available) return this.local;
    if ((s.provider === "remote" || s.provider === "auto") && s.allowRemote && st.remote?.available) return this.remote;
    return this.none;
  }
  /** Línea de estado para la interfaz. */
  statusLine() {
    const a = this.active, st = this.state;
    if (a === this.local) return { ok: true, mode: "Local", model: st.local.model, text: `IA disponible · ${st.local.model} · Local` };
    if (a === this.remote) return { ok: true, mode: "Remota", model: st.remote.model, text: `IA disponible · Claude · Remota` };
    if (!this.settings.enabled) return { ok: false, mode: "Sin IA", text: "IA desactivada · el asistente usa reglas y la guía" };
    const why = st.local?.reason || "";
    return { ok: false, mode: "Sin IA", text: "IA no disponible. LumaMap continúa funcionando en modo normal.", why, code: st.local?.code };
  }
  recommended() { return recommendTier(this.hw); }
  context() { return buildProjectContext(this.app, { hw: this.hw }); }

  /**
   * Ejecuta una función del proveedor activo; si falla, la misma función del
   * modo sin IA, y deja un aviso comprensible (nunca un error técnico).
   */
  async run(method, ...args) {
    if (!this.state.checkedAt) await this.refresh();
    const p = this.active;
    this.notice = "";
    if (p !== this.none) {
      try { return await p[method](...args); }
      catch (e) {
        this.notice = e instanceof AIUnavailable ? e.message : MSG.generic;
        if (e instanceof AIUnavailable && ["offline", "notInstalled", "noModel", "noModels", "memory"].includes(e.code)) this.state.checkedAt = 0;
        console.warn("IA:", e);
      }
    }
    return this.none[method](...args);
  }
  /**
   * Conversación. Las órdenes claras («sube el brillo», «busca un gif de fuego», «pausa»)
   * se resuelven al instante con las reglas, sin esperar al modelo; el modelo se usa para
   * lo demás. Si el modelo no aporta nada útil (o propone acciones no válidas), las reglas
   * y la guía responden igualmente: el asistente nunca se queda en blanco.
   */
  async chat(text, history) {
    if (!this.state.checkedAt) await this.refresh();
    const quick = parseCommand(this.app, text);
    const qp = quick.actions.map(a => validateAction(this.app, a));
    const clear = (qp.length && qp.every(v => v.ok)) || (quick.intent && quick.intent !== "explain");
    if (this.active !== this.none && clear) {
      this.notice = "";
      return { reply: quick.reply, proposals: qp, intent: quick.intent && quick.intent !== "explain" ? quick.intent : null, source: "Al instante" };
    }
    const r = await this.run("chat", { text, ctx: this.context(), history });
    const useful = (r.proposals || []).some(v => v.ok) || r.intent;
    if (!useful && clear) return { ...r, reply: [r.reply, quick.reply].filter(Boolean).join(" "), proposals: qp, intent: quick.intent && quick.intent !== "explain" ? quick.intent : null };
    if (!r.reply && !useful) return { ...r, reply: HELP };
    return r;
  }
  analyze() { return this.run("analyzeProject", this.context()); }
  next() { return nextStep(this.context()); }
  showPlan(text) { return this.run("generateShowPlan", text, this.context()); }
  explain(topic) { return this.run("explainFunction", topic); }
  diagnose(q) { return this.run("diagnoseProblem", this.context(), q); }
  optimize() { return this.run("optimizeProject", this.context()); }
  vision(img) { return this.run("analyzeImage", img); }
}
