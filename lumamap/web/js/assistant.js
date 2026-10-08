// web/js/assistant.js
// Asistente de LumaMap: el usuario escribe órdenes en español («cuando levante la
// mano cambia el color a rojo», «ve a la escena 2», «añade un cubo 3D») y se
// hacen DE VERDAD con las mismas acciones del editor (con guardado y deshacer).
//
// · Con IA (app de escritorio + clave de la API de Claude): Claude elige las
//   herramientas de abajo; la llamada a la API la hace el proceso principal, que
//   guarda la clave cifrada (desktop/ai.js). La conversación se lleva aquí.
// · Sin IA (navegador, sin clave o sin internet): un intérprete local entiende
//   órdenes simples. Se indica siempre cuál de los dos respondió.
import { describe, catalog } from "./params.js";
import { runAction, describeAction } from "./rules.js";
import { SIGNALS, PROVIDERS } from "./tracking.js";
import { uid, SHAPES, ANIM_LIBRARY, GENERATORS } from "./model.js";

const MAX_STEPS = 15;
const ACTION_KINDS = ["param", "color", "scene", "anim", "macro", "go", "blackout"];

/* ---------------- Herramientas (lo que el asistente puede hacer) ---------------- */

const ACTION_SCHEMA = {
  type: "object",
  description: "Una acción de LumaMap. Campos según el tipo: param → target, value · color → color, surface · scene → index · anim → name, surface · macro → id · blackout → value · go → nada.",
  properties: {
    type: { type: "string", enum: ACTION_KINDS },
    target: { type: "string", description: "id del parámetro (ver list_params)" },
    value: { description: "número para parámetros; true/false para blackout y parámetros sí/no" },
    color: { type: "string", description: "color #rrggbb" },
    surface: { type: "string", description: "\"sel\" (la seleccionada), \"all\" (todas) o el id de una superficie" },
    index: { description: "escena: número desde 0, o \"next\" / \"prev\"" },
    name: { type: "string", description: "nombre de una animación de la biblioteca" },
    id: { type: "string", description: "id o nombre de la macro" },
  },
  required: ["type"],
};

export const TOOLS = [
  { name: "get_project", description: "Estado actual del proyecto: superficies (id y nombre), cuál está seleccionada, escenas, macros, zonas y reglas de tracking, estado del tracking y animaciones disponibles. Consúltalo antes de actuar si no sabes a qué superficie, escena o macro se refiere el usuario.",
    input_schema: { type: "object", properties: {} } },
  { name: "list_params", description: "Busca parámetros que se pueden mover (brillo, opacidad, velocidad, efectos, volumen de pantallas…). Devuelve id, nombre, tipo, rango y valor actual.",
    input_schema: { type: "object", properties: { search: { type: "string", description: "texto a buscar en el nombre o el id (vacío = los generales)" } } } },
  { name: "run_action", description: "Hace una acción ahora mismo: mover un parámetro, cambiar el color, ir a una escena, poner una animación, ejecutar una macro, GO o apagón.",
    input_schema: { type: "object", properties: { action: ACTION_SCHEMA }, required: ["action"] } },
  { name: "create_tracking_rule", description: "Crea una regla de tracking «cuando <señal> supera/baja de <valor> → acción». Las señales sí/no (mano levantada, hay alguien) valen 0 o 1: usa op \"above\" y value 0.5. «people» vale 0.25 por persona. La regla solo se dispara con el tracking en marcha (ver start_tracking).",
    input_schema: { type: "object", properties: {
      name: { type: "string" },
      signal: { type: "string", description: "Señales: " + SIGNALS.map(s => `${s[0]} (${s[1]})`).join(", ") + ". También zone:<id> y zonehand:<id> para las zonas." },
      op: { type: "string", enum: ["above", "below"] },
      value: { type: "number", minimum: 0, maximum: 1 },
      cooldown: { type: "number", description: "segundos mínimos entre disparos (por defecto 1)" },
      then: ACTION_SCHEMA,
      otherwise: { ...ACTION_SCHEMA, description: "acción opcional cuando la condición deja de cumplirse" },
    }, required: ["signal", "op", "value", "then"] } },
  { name: "start_tracking", description: "Pone en marcha el tracking de cuerpo y manos con la cámara configurada.",
    input_schema: { type: "object", properties: {} } },
  { name: "create_macro", description: "Crea una macro: una lista de pasos (parámetro y valor, con espera opcional en milisegundos). Se puede disparar desde MIDI, teclado, OSC o reglas.",
    input_schema: { type: "object", properties: {
      name: { type: "string" },
      steps: { type: "array", items: { type: "object", properties: { target: { type: "string" }, value: {}, delay: { type: "number" } }, required: ["target"] } },
    }, required: ["name", "steps"] } },
  { name: "add_surface", description: "Añade una superficie de proyección 2D en el centro de la vista.",
    input_schema: { type: "object", properties: { shape: { type: "string", enum: [...Object.keys(SHAPES), "mesh"] } }, required: ["shape"] } },
  { name: "add_3d_object", description: "Añade un objeto al espacio 3D (activa el 3D si hace falta).",
    input_schema: { type: "object", properties: { kind: { type: "string", enum: ["cube", "plane", "sphere", "cylinder", "cone", "pyramid", "prism"] } }, required: ["kind"] } },
  { name: "add_scene", description: "Crea una escena nueva (copia de la actual) y va a ella.",
    input_schema: { type: "object", properties: {} } },
];

export const SYSTEM = `Eres el asistente de LumaMap, una aplicación de video mapping, VJ e iluminación. El usuario (normalmente en pleno montaje o en directo) te escribe órdenes en español.
Haz los cambios con las herramientas; nunca digas que hiciste algo que no hiciste con una herramienta. Si no sabes a qué superficie, escena o macro se refiere, mira get_project. Si algo no se puede hacer con las herramientas, dilo con claridad.
Responde en español, muy breve (una o dos frases), diciendo qué hiciste. Todo se puede deshacer con Ctrl+Z.`;

/* ---------------- Ejecución de las herramientas ---------------- */

function resolveSurface(app, s) {
  if (!s || s === "all" || s === "sel") return s || "sel";
  const P = app.S.project;
  const hit = P.surfaces.find(x => x.id === s) || P.surfaces.find(x => x.name.toLowerCase() === String(s).toLowerCase());
  if (!hit) throw new Error(`No existe la superficie «${s}». Superficies: ${P.surfaces.map(x => `${x.name} (${x.id})`).join(", ") || "ninguna"}`);
  return hit.id;
}

/** Comprueba una acción antes de guardarla en una regla (mismos errores que al ejecutarla). */
export function checkAction(app, a) {
  if (!a || !ACTION_KINDS.includes(a.type)) throw new Error("Tipo de acción no válido: " + a?.type);
  const out = { ...a };
  if (a.type === "param" && !describe(app, a.target)) throw new Error("El parámetro no existe: " + a.target + " (usa list_params)");
  if (a.type === "color") {
    if (!/^#[0-9a-f]{6}$/i.test(a.color || "")) throw new Error("Color no válido (usa #rrggbb): " + a.color);
    out.surface = resolveSurface(app, a.surface);
  }
  if (a.type === "anim") {
    out.surface = resolveSurface(app, a.surface);
    const n = String(a.name || "").toLowerCase();
    if (!ANIM_LIBRARY.some(x => x.name.toLowerCase() === n) && !GENERATORS.some(g => g.id === a.name || g.name.toLowerCase() === n)) throw new Error("No existe la animación: " + a.name);
  }
  if (a.type === "scene" && a.index !== "next" && a.index !== "prev" && !app.S.project.scenes[Number(a.index)]) throw new Error(`No hay escena ${Number(a.index) + 1} (hay ${app.S.project.scenes.length})`);
  if (a.type === "macro") {
    const m = app.S.project.settings.control.macros.find(x => x.id === a.id || x.name.toLowerCase() === String(a.id || "").toLowerCase());
    if (!m) throw new Error("No existe la macro: " + a.id);
    out.id = m.id;
  }
  if (a.type === "blackout") out.value = a.value !== false && a.value !== 0 && a.value !== "false";
  return out;
}

function trackingStatus(app) {
  const cfg = app.S.project.settings.tracking, t = app.tracking?.main();
  const prov = PROVIDERS.find(p => p.id === cfg.provider);
  if (!prov?.available) return `proveedor «${prov?.name || cfg.provider}» no disponible`;
  if (!t) return "detenido";
  if (t.offline) return "cámara desconectada";
  return t.status === "error" ? "error: " + t.error : t.status === "running" ? "en marcha" : "arrancando";
}

function projectSummary(app) {
  const S = app.S, P = S.project, cfg = P.settings.tracking;
  const cur = P.scenes.findIndex(s => s.id === P.sceneId);
  return {
    surfaces: P.surfaces.map(s => ({ id: s.id, name: s.name })),
    selected: S.sel || null,
    scenes: P.scenes.map((s, i) => ({ index: i, name: s.name, current: i === cur })),
    macros: P.settings.control.macros.map(m => ({ id: m.id, name: m.name, steps: m.steps.length })),
    tracking: { status: trackingStatus(app), zones: cfg.zones.map(z => ({ id: z.id, name: z.name })), rules: cfg.rules.map(r => ({ name: r.name, signal: r.signal, op: r.op, value: r.value, then: describeAction(app, r.then) })) },
    space3d: app.stage3d ? { objects: (P.stage3d?.objects || []).map(o => o.name) } : "inactivo",
    blackout: !!S.blackout,
    animations: ANIM_LIBRARY.map(a => a.name),
  };
}

/** Ejecuta una herramienta. Devuelve texto (o lanza un error con un mensaje claro). */
export async function executeTool(app, name, input = {}) {
  const P = app.S.project, A = app.actions;
  switch (name) {
    case "get_project": return JSON.stringify(projectSummary(app));
    case "list_params": {
      const q = String(input.search || "").toLowerCase();
      const all = catalog(app).flatMap(g => g.items.map(x => ({ ...x, group: g.group })));
      const hits = (q ? all.filter(x => (x.name + " " + x.id + " " + x.group).toLowerCase().includes(q)) : all.filter(x => x.group === "General")).slice(0, 60);
      return JSON.stringify(hits.map(x => { const d = describe(app, x.id); return { id: x.id, name: x.name, kind: d?.kind, min: d?.min, max: d?.max, value: d && d.kind !== "trigger" ? d.get() : undefined }; }));
    }
    case "run_action": return runAction(app, checkAction(app, input.action));
    case "create_tracking_rule": {
      const cfg = P.settings.tracking;
      const zoneSig = cfg.zones.flatMap(z => ["zone:" + z.id, "zonehand:" + z.id]);
      if (!SIGNALS.some(s => s[0] === input.signal) && !zoneSig.includes(input.signal)) throw new Error("Señal desconocida: " + input.signal);
      const rule = { id: uid("rule"), name: input.name || "", signal: input.signal, op: input.op === "below" ? "below" : "above",
        value: Math.max(0, Math.min(1, +input.value || 0)), cooldown: input.cooldown ?? 1,
        then: checkAction(app, input.then), otherwise: input.otherwise ? checkAction(app, input.otherwise) : null, enabled: true };
      cfg.rules.push(rule);
      app.changed({ panel: true }); app.commit();
      return `Regla creada: si ${SIGNALS.find(s => s[0] === rule.signal)?.[1] || rule.signal} ${rule.op === "below" ? "<" : ">"} ${rule.value} → ${describeAction(app, rule.then)}. Tracking: ${trackingStatus(app)}.`;
    }
    case "start_tracking": {
      const cfg = P.settings.tracking;
      const t = app.tracking?.ensure(cfg.camId || "default");
      if (!t) return "No se pudo arrancar: " + trackingStatus(app);
      return "Tracking: " + trackingStatus(app) + " (la primera vez tarda unos segundos en cargar la IA y pide permiso de cámara).";
    }
    case "create_macro": {
      const steps = (input.steps || []).map(s => {
        if (!String(s.target).startsWith("macro/") && !describe(app, s.target)) throw new Error("El parámetro no existe: " + s.target);
        return { target: s.target, value: s.value ?? 1, delay: Math.max(0, +s.delay || 0) };
      });
      if (!steps.length) throw new Error("La macro necesita al menos un paso");
      const m = { id: uid("macro"), name: input.name || "Macro", steps };
      P.settings.control.macros.push(m);
      app.paramMappingsChanged?.(); app.changed({ panel: true }); app.commit();
      return `Macro «${m.name}» creada con ${steps.length} paso(s) (id ${m.id}).`;
    }
    case "add_surface": {
      if (input.shape === "mesh") A.addMesh();
      else if (SHAPES[input.shape]) A.addShape(input.shape);
      else throw new Error("Forma desconocida: " + input.shape);
      const s = P.surfaces[P.surfaces.length - 1];
      return `Superficie «${s.name}» añadida (id ${s.id}) y seleccionada.`;
    }
    case "add_3d_object": {
      const { ensure3d } = await import("./panels-3d.js");
      const st = await ensure3d(app);
      const o = st.addObject(input.kind);
      app.changed({ panel: true }); app.commit();
      return `Objeto 3D añadido: ${o?.name || input.kind}. Ábrelo en la pestaña 3D para colocarlo.`;
    }
    case "add_scene": {
      A.addScene();
      return `Escena «${P.scenes.find(s => s.id === P.sceneId)?.name}» creada.`;
    }
  }
  throw new Error("Herramienta desconocida: " + name);
}

/* ---------------- Intérprete local (sin IA) ---------------- */

const COLORS = { rojo: "#ff0000", verde: "#00ff00", azul: "#0000ff", amarillo: "#ffff00", blanco: "#ffffff", negro: "#000000",
  morado: "#8000ff", violeta: "#8000ff", naranja: "#ff8000", rosa: "#ff00aa", cian: "#00e5ff", celeste: "#00e5ff", dorado: "#ffcc00" };
const NUMS = { una: 1, uno: 1, un: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };
const SHAPE_WORDS = { "rectángulo": "rect", rectangulo: "rect", "círculo": "circle", circulo: "circle", "triángulo": "triangle", triangulo: "triangle",
  "hexágono": "hexagon", hexagono: "hexagon", estrella: "star", rombo: "diamond", malla: "mesh" };
const SHAPE3D_WORDS = { cubo: "cube", plano: "plane", esfera: "sphere", cilindro: "cylinder", cono: "cone", "pirámide": "pyramid", piramide: "pyramid", prisma: "prism" };

const num = (w) => NUMS[w] ?? (Number(w) || 0);

/** Condición de una regla a partir del texto («cuando levante la mano…»). */
function parseCondition(t) {
  if (/mano izquierda/.test(t) && /(levant|sub|alz)/.test(t)) return { signal: "left_hand_up", op: "above", value: 0.5 };
  if (/mano derecha/.test(t) && /(levant|sub|alz)/.test(t)) return { signal: "right_hand_up", op: "above", value: 0.5 };
  if (/(levant|sub|alz)\w* (la |una |las )?mano/.test(t)) return { signal: "hands_up", op: "above", value: 0.5 };
  if (/abr\w* (los )?brazos/.test(t)) return { signal: "spread", op: "above", value: 0.6 };
  const p = t.match(/(?:haya|hay|entren|est[eé]n)\s+(\w+)\s+personas/);
  if (p && num(p[1])) return { signal: "people", op: "above", value: Math.max(0, num(p[1]) * 0.25 - 0.125) };
  if (/(se acerque|est[eé] cerca)/.test(t)) return { signal: "distance", op: "above", value: 0.6 };
  if (/(salte|corra|se mueva r[aá]pido|bail)/.test(t)) return { signal: "speed", op: "above", value: 0.5 };
  if (/(no haya nadie|se vaya|salga)/.test(t)) return { signal: "presence", op: "below", value: 0.5 };
  if (/(alguien|una persona|entre|aparezca)/.test(t)) return { signal: "presence", op: "above", value: 0.5 };
  return null;
}

/** Acción a partir del texto. */
function parseAction(app, t) {
  if (/(quita|fin del|sin) apag[oó]n|enciende todo/.test(t)) return { type: "blackout", value: false };
  if (/apag[oó]n|apaga todo|todo a negro/.test(t)) return { type: "blackout", value: true };
  if (/(siguiente|pr[oó]xima) escena|^go$/.test(t)) return { type: "scene", index: "next" };
  if (/escena anterior/.test(t)) return { type: "scene", index: "prev" };
  const sc = t.match(/escena\s+(\w+)/);
  if (sc && num(sc[1])) return { type: "scene", index: num(sc[1]) - 1 };
  const mac = t.match(/macro\s+(.+)$/);
  if (mac) return { type: "macro", id: mac[1].trim() };
  const anim = [...ANIM_LIBRARY].sort((a, b) => b.name.length - a.name.length).find(a => t.includes(a.name.toLowerCase()));
  if (anim) return { type: "anim", name: anim.name, surface: /todas/.test(t) ? "all" : "sel" };
  const hex = t.match(/#[0-9a-f]{6}/);
  const cw = Object.keys(COLORS).find(c => new RegExp(`\\b${c}\\b`).test(t));
  if (hex || cw) return { type: "color", color: hex ? hex[0] : COLORS[cw], surface: /todas/.test(t) ? "all" : "sel" };
  return null;
}

/** Interpreta y ejecuta una orden simple. Devuelve { ok, text }. */
export async function runLocal(app, text) {
  const t = text.toLowerCase().normalize("NFC").replace(/[¡!¿?.]/g, " ").replace(/\s+/g, " ").trim();
  try {
    const add = t.match(/(?:añade|agrega|crea|pon)\s+(?:un|una)\s+(\S+)(\s+3d)?/);
    if (add) {
      const w = add[1];
      if (SHAPE3D_WORDS[w] && (add[2] || !SHAPE_WORDS[w])) return { ok: true, text: await executeTool(app, "add_3d_object", { kind: SHAPE3D_WORDS[w] }) };
      if (SHAPE_WORDS[w]) return { ok: true, text: await executeTool(app, "add_surface", { shape: SHAPE_WORDS[w] }) };
      if (w === "escena") return { ok: true, text: await executeTool(app, "add_scene") };
    }
    if (/^(cuando|si)\b/.test(t)) {
      const [condPart, ...rest] = t.split(/,|\s+(?=cambia|pon|ve |pasa|haz|apaga|quita|ejecuta|lanza|siguiente)/);
      const cond = parseCondition(condPart);
      const act = parseAction(app, rest.join(" ") || t);
      if (!cond) return { ok: false, text: "No reconozco la condición. Ejemplos: «cuando levante la mano…», «cuando haya dos personas…», «cuando alguien entre…»." };
      if (!act) return { ok: false, text: "No reconozco qué hacer. Ejemplos: «…cambia el color a rojo», «…ve a la escena 2», «…pon Disco», «…apagón»." };
      return { ok: true, text: await executeTool(app, "create_tracking_rule", { name: text.slice(0, 60), ...cond, then: act }) };
    }
    const act = parseAction(app, t);
    if (act) return { ok: true, text: await executeTool(app, "run_action", { action: act }) };
  } catch (err) { return { ok: false, text: err.message }; }
  return { ok: false, text: "No entendí la orden. Ejemplos: «cuando levante la mano cambia el color a rojo», «ve a la escena 2», «pon Disco en todas», «añade un círculo», «añade un cubo 3D», «apagón»." };
}

/* ---------------- Conversación con Claude (app de escritorio) ---------------- */

export class Assistant {
  constructor(app) {
    this.app = app;
    this.messages = [];   // historial que se envía a la API (solo se añade al final)
    this.log = [];        // lo que se muestra: { who: "user"|"ai"|"local"|"act"|"err", text }
    this.busy = false;
    this.onChange = () => {};
  }
  get bridge() { return globalThis.LumaDesktop?.ai || null; }
  async status() {
    if (!this.bridge) return { ai: false, why: "browser" };
    try { const s = await this.bridge.status(); return { ai: s.hasKey, why: s.hasKey ? "" : "nokey", ...s }; }
    catch { return { ai: false, why: "browser" }; }
  }
  push(who, text) { this.log.push({ who, text }); if (this.log.length > 200) this.log.shift(); this.onChange(); }
  reset() { this.messages = []; this.log = []; this.onChange(); }
  cancel() { this.cancelled = true; this.bridge?.cancel(); }

  /** Envía una orden. Con clave usa Claude; si no, el intérprete local. */
  async send(text) {
    text = String(text || "").trim();
    if (!text || this.busy) return;
    this.busy = true; this.cancelled = false;
    this.push("user", text);
    try {
      const st = await this.status();
      if (!st.ai) {
        const r = await runLocal(this.app, text);
        this.push(r.ok ? "local" : "err", r.text);
        return;
      }
      await this.converse(text);
    } finally { this.busy = false; this.onChange(); }
  }

  async converse(text) {
    const msgs = this.messages;
    msgs.push({ role: "user", content: text });
    for (let step = 0; step < MAX_STEPS; step++) {
      const r = await this.bridge.step({ system: SYSTEM, tools: TOOLS, messages: msgs, effort: "low" });
      if (this.cancelled) { this.push("err", "Cancelado."); return; }
      if (r.error) { this.push("err", r.error + " · Puedes seguir con órdenes simples sin IA."); return; }
      if (r.stop_reason === "refusal") { this.push("err", "Claude no puede ayudar con esta petición."); return; }
      if (r.stop_reason === "max_tokens") { this.push("err", "La respuesta quedó incompleta. Prueba con una orden más corta."); return; }
      msgs.push({ role: "assistant", content: r.content });
      for (const b of r.content) if (b.type === "text" && b.text.trim()) this.push("ai", b.text.trim());
      if (r.fellBack) this.push("act", `Respondió el modelo alternativo (${r.model}).`);
      if (r.stop_reason === "pause_turn") continue;
      const uses = r.content.filter(b => b.type === "tool_use");
      if (r.stop_reason !== "tool_use" || !uses.length) return;
      const results = [];
      for (const u of uses) {
        try {
          const out = await executeTool(this.app, u.name, u.input);
          if (u.name !== "get_project" && u.name !== "list_params") this.push("act", out);
          results.push({ type: "tool_result", tool_use_id: u.id, content: out });
        } catch (err) {
          results.push({ type: "tool_result", tool_use_id: u.id, content: "Error: " + err.message, is_error: true });
        }
      }
      msgs.push({ role: "user", content: results });
    }
    this.push("err", "Demasiados pasos seguidos: se detuvo.");
  }
}
