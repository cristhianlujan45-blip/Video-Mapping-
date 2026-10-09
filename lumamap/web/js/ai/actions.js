// web/js/ai/actions.js
// AI ACTION SYSTEM: lista blanca de acciones que el asistente puede PROPONER.
// La IA nunca ejecuta código ni comandos del sistema: devuelve
//   { action: "create_surface", parameters: { ... } }
// y aquí cada acción se VALIDA (nombre conocido, parámetros con tipo y rango).
// Solo cuando el usuario pulsa «Aplicar» se ejecuta, con las mismas funciones
// del editor (guardado y deshacer incluidos). Las acciones «críticas»
// (borrar, cambiar la resolución…) se marcan y piden confirmación aparte.
import * as M from "../model.js";
import { runAction } from "../rules.js";
import { describe } from "../params.js";
import { LIGHT_FX, findFx, defaultLightFx } from "../lightfx.js";
import { SIGNALS } from "../tracking.js";
import { TIMER_TEMPLATES, templateSteps, targetName } from "../timers.js";

const SHAPES = [...Object.keys(M.SHAPES), "mesh"];
const LIGHT_KINDS = ["strip", "matrix", "ring", "bar", "par", "moving"];
const TRANSITIONS = ["cut", "fade", "dissolve", "wipe", "wipeV", "iris", "flash", "glitch"];
const TABS = ["add", "anim", "live", "draw", "content", "fx", "shape", "layers", "scenes", "audio", "interactive", "lights", "show", "3d", "tracking", "assistant", "control", "perf", "output"];
const BANDS = ["bass", "mid", "high", "level"];
const TARGETS = M.AUDIO_TARGETS.map(t => t[0]);

class ActionError extends Error {}
const fail = (m) => { throw new ActionError(m); };
const str = (v, name, { max = 80, req = true } = {}) => {
  if (v === undefined || v === null || v === "") { if (req) fail(`Falta «${name}»`); return undefined; }
  const s = String(v).trim(); if (!s) fail(`«${name}» vacío`); return s.slice(0, max);
};
const num = (v, name, lo, hi, def) => {
  if (v === undefined || v === null || v === "") { if (def !== undefined) return def; fail(`Falta «${name}»`); }
  const n = Number(v); if (!Number.isFinite(n)) fail(`«${name}» no es un número`);
  if (n < lo || n > hi) fail(`«${name}» debe estar entre ${lo} y ${hi}`);
  return n;
};
const oneOf = (v, name, list, def) => {
  if ((v === undefined || v === null || v === "") && def !== undefined) return def;
  if (!list.includes(v)) fail(`«${name}» debe ser uno de: ${list.join(", ")}`);
  return v;
};
const color = (v, name, def) => {
  if (!v && def) return def;
  if (!/^#[0-9a-f]{6}$/i.test(String(v || ""))) fail(`«${name}» debe ser un color #rrggbb`);
  return String(v).toLowerCase();
};
/** Superficie por id o nombre ("sel" = la seleccionada). */
function surfaceRef(app, v, { req = true } = {}) {
  const P = app.S.project;
  if (v === undefined || v === null || v === "" || v === "sel") {
    if (app.S.sel) return app.S.sel;
    if (!req) return null;
    fail("No hay ninguna superficie seleccionada");
  }
  const s = P.surfaces.find(x => x.id === v) || P.surfaces.find(x => x.name.toLowerCase() === String(v).toLowerCase());
  if (!s) fail(`No existe la superficie «${v}»`);
  return s.id;
}
const sceneIndex = (app, v) => {
  if (v === "next" || v === "prev") return v;
  const i = num(v, "escena", 0, app.S.project.scenes.length - 1);
  return Math.round(i);
};
const surfName = (app, id) => app.S.project.surfaces.find(s => s.id === id)?.name || id;

/**
 * Registro: name → { label, critical, params (descripción para el modelo), check(app, p) → p normalizado,
 * text(app, p) → frase para el usuario, run(app, p) → resultado }.
 */
export const ACTIONS = {
  create_surface: {
    label: "Crear superficie", params: { shape: SHAPES.join("|"), name: "texto opcional" },
    check: (app, p) => ({ shape: oneOf(p.shape, "shape", SHAPES, "rect"), name: str(p.name, "name", { req: false }) }),
    text: (app, p) => `Crear una superficie (${M.SHAPES[p.shape]?.name || "malla"})${p.name ? " «" + p.name + "»" : ""}`,
    run: (app, p) => {
      if (p.shape === "mesh") app.actions.addMesh(); else app.actions.addShape(p.shape);
      const s = app.S.project.surfaces.at(-1);
      if (p.name) { s.name = p.name; app.changed({ panel: true }); app.commit(); }
      return `Superficie «${s.name}» creada`;
    },
  },
  delete_surface: {
    label: "Eliminar superficie", critical: true, params: { surface: "id o nombre" },
    check: (app, p) => ({ surface: surfaceRef(app, p.surface) }),
    text: (app, p) => `Eliminar la superficie «${surfName(app, p.surface)}» (se puede deshacer)`,
    run: (app, p) => { const n = surfName(app, p.surface); app.actions.remove(p.surface); return `«${n}» eliminada`; },
  },
  rename_surface: {
    label: "Renombrar superficie", params: { surface: "id o nombre", name: "nuevo nombre" },
    check: (app, p) => ({ surface: surfaceRef(app, p.surface), name: str(p.name, "name") }),
    text: (app, p) => `Renombrar «${surfName(app, p.surface)}» a «${p.name}»`,
    run: (app, p) => { const s = app.S.project.surfaces.find(x => x.id === p.surface); s.name = p.name; app.changed({ panel: true }); app.commit(); return "Renombrada"; },
  },
  create_mask: {
    label: "Crear máscara", params: { surface: "id o nombre" },
    check: (app, p) => ({ surface: surfaceRef(app, p.surface) }),
    text: (app, p) => `Empezar a dibujar una máscara en «${surfName(app, p.surface)}» (tú marcas los puntos)`,
    run: (app, p) => { app.select(p.surface); app.actions.editMask(); app.openTab("shape"); return "Dibuja la máscara tocando los puntos sobre la superficie"; },
  },
  load_media: {
    label: "Cargar video o imagen", params: { surface: "opcional: id o nombre" },
    check: (app, p) => ({ surface: surfaceRef(app, p.surface, { req: false }) }),
    text: (app, p) => p.surface ? `Elegir un video o imagen para «${surfName(app, p.surface)}»` : "Elegir un video o imagen (se crea una superficie)",
    run: async (app, p) => { if (p.surface) app.select(p.surface); await app.actions.importMedia(p.surface ? "auto" : "new"); return "Archivo elegido"; },
  },
  set_animation: {
    label: "Poner una animación", params: { surface: "id, nombre o all", name: "animación de la biblioteca" },
    check: (app, p) => {
      const name = str(p.name, "name");
      if (!M.ANIM_LIBRARY.some(a => a.name.toLowerCase() === name.toLowerCase())) fail(`No existe la animación «${name}»`);
      return { surface: p.surface === "all" ? "all" : surfaceRef(app, p.surface), name };
    },
    text: (app, p) => `Poner «${p.name}» en ${p.surface === "all" ? "todas las superficies" : "«" + surfName(app, p.surface) + "»"}`,
    run: (app, p) => runAction(app, { type: "anim", name: p.name, surface: p.surface }),
  },
  set_color: {
    label: "Cambiar el color", params: { surface: "id, nombre o all", color: "#rrggbb" },
    check: (app, p) => ({ surface: p.surface === "all" ? "all" : surfaceRef(app, p.surface), color: color(p.color, "color") }),
    text: (app, p) => `Color ${p.color} en ${p.surface === "all" ? "todas" : "«" + surfName(app, p.surface) + "»"}`,
    run: (app, p) => runAction(app, { type: "color", color: p.color, surface: p.surface }),
  },
  create_scene: {
    label: "Crear escena", params: { name: "texto opcional" },
    check: (app, p) => ({ name: str(p.name, "name", { req: false }) }),
    text: (app, p) => `Crear una escena nueva${p.name ? " «" + p.name + "»" : ""} (copia de la actual)`,
    run: (app, p) => { app.actions.addScene(); const sc = M.currentScene(app.S.project); if (p.name) { sc.name = p.name; app.changed({ panel: true }); app.commit(); } return `Escena «${sc.name}» creada`; },
  },
  go_scene: {
    label: "Ir a una escena", params: { index: "número desde 0, next o prev" },
    check: (app, p) => ({ index: sceneIndex(app, p.index) }),
    text: (app, p) => p.index === "next" ? "Pasar a la escena siguiente" : p.index === "prev" ? "Volver a la escena anterior" : `Ir a la escena ${p.index + 1}`,
    run: (app, p) => runAction(app, { type: "scene", index: p.index }),
  },
  set_transition: {
    label: "Transición de una escena", params: { index: "número desde 0", mode: TRANSITIONS.join("|"), ms: "duración en ms" },
    check: (app, p) => ({ index: sceneIndex(app, p.index ?? app.S.project.scenes.findIndex(s => s.id === app.S.project.sceneId)), mode: oneOf(p.mode, "mode", TRANSITIONS), ms: num(p.ms, "ms", 0, 20000, 800) }),
    text: (app, p) => `Transición «${p.mode}» de ${p.ms} ms en la escena ${typeof p.index === "number" ? p.index + 1 : p.index}`,
    run: (app, p) => { const sc = app.S.project.scenes[p.index]; if (!sc) return "Escena no encontrada"; sc.transition = p.mode; sc.trMs = p.ms; app.changed({ panel: true }); app.commit(); return "Transición cambiada"; },
  },
  set_resolution: {
    label: "Cambiar la resolución", critical: true, params: { width: "px", height: "px" },
    check: (app, p) => ({ width: Math.round(num(p.width, "width", 64, 16384)), height: Math.round(num(p.height, "height", 64, 16384)) }),
    text: (app, p) => `Cambiar la resolución de ${app.S.project.width}×${app.S.project.height} a ${p.width}×${p.height} (las superficies se reescalan)`,
    run: (app, p) => app.actions.applyResolution(p.width, p.height),
  },
  set_fps: {
    label: "FPS de la salida", params: { fps: "24|25|30|50|60" },
    check: (app, p) => ({ fps: oneOf(Number(p.fps), "fps", [24, 25, 30, 50, 60]) }),
    text: (app, p) => `Salida a ${p.fps} fps`,
    run: (app, p) => { app.S.project.settings.output.fps = p.fps; app.changed({ panel: true }); app.commit(); return `Salida a ${p.fps} fps`; },
  },
  set_output: {
    label: "Encender / apagar una pantalla", params: { screen: "1-4", on: "true|false" },
    check: (app, p) => ({ screen: Math.round(num(p.screen, "screen", 1, 4)), on: p.on !== false && p.on !== "false" }),
    text: (app, p) => `${p.on ? "Encender" : "Apagar"} la pantalla P${p.screen}`,
    run: (app, p) => { app.actions.setScreenCfg(p.screen, { on: p.on }); return `P${p.screen} ${p.on ? "encendida" : "apagada"}`; },
  },
  open_output: {
    label: "Abrir la salida al proyector", params: { screen: "1-4" },
    check: (app, p) => ({ screen: Math.round(num(p.screen, "screen", 1, 4, 1)) }),
    text: (app, p) => `Abrir la salida P${p.screen} (arrástrala al proyector)`,
    run: (app, p) => { app.actions.openWindow(p.screen); return "Salida abierta"; },
  },
  set_preview: {
    label: "Calidad de la vista previa", params: { scale: "1|0.75|0.5" },
    check: (app, p) => ({ scale: oneOf(Number(p.scale), "scale", [1, 0.75, 0.5]) }),
    text: (app, p) => `Vista previa del editor al ${Math.round(p.scale * 100)} % (la salida no cambia)`,
    run: (app, p) => { app.actions.setPreview({ scale: p.scale }); return "Vista previa ajustada"; },
  },
  enable_audio_reactive: {
    label: "Reaccionar a la música", params: { surface: "id, nombre o all", band: BANDS.join("|"), target: TARGETS.join("|") },
    check: (app, p) => ({ surface: p.surface === "all" || p.surface === undefined ? "all" : surfaceRef(app, p.surface), band: oneOf(p.band, "band", BANDS, "bass"), target: oneOf(p.target, "target", TARGETS, "brightness") }),
    text: (app, p) => `Que ${p.surface === "all" ? "todas las superficies" : "«" + surfName(app, p.surface) + "»"} reaccionen a ${({ bass: "los graves", mid: "los medios", high: "los agudos", level: "el volumen" })[p.band]} (${M.AUDIO_TARGETS.find(t => t[0] === p.target)?.[1] || p.target}) y activar el micrófono`,
    run: async (app, p) => {
      const P = app.S.project, sc = M.currentScene(P);
      for (const s of P.surfaces) if (p.surface === "all" || s.id === p.surface) Object.assign(M.lookOf(sc, s.id).audio, { enabled: true, band: p.band, target: p.target });
      app.changed({ panel: true }); app.commit();
      if (!app.audio?.()?.active) await app.actions.toggleMic();
      return "Audio reactivo activado";
    },
  },
  set_bpm: {
    label: "Tempo (BPM)", params: { bpm: "40-240" },
    check: (app, p) => ({ bpm: Math.round(num(p.bpm, "bpm", 40, 240)) }),
    text: (app, p) => `Tempo a ${p.bpm} BPM`,
    run: (app, p) => { app.actions.setBpm(p.bpm); return `${p.bpm} BPM`; },
  },
  add_light: {
    label: "Añadir una luz", params: { kind: LIGHT_KINDS.join("|"), count: "LED (tiras, aros, barras)" },
    check: (app, p) => ({ kind: oneOf(p.kind, "kind", LIGHT_KINDS), count: p.count === undefined ? undefined : Math.round(num(p.count, "count", 1, 20000)) }),
    text: (app, p) => `Añadir ${({ strip: "una tira LED", matrix: "una matriz LED", ring: "un aro LED", bar: "una barra LED", par: "un foco PAR", moving: "una cabeza móvil" })[p.kind]}${p.count ? " de " + p.count + " LED" : ""}`,
    run: (app, p) => { const L = app.dmx.addLight(p.kind, p.count ? { count: p.count } : {}); app.changed({ panel: true }); app.commit(); return `${L.name} añadida`; },
  },
  light_effect: {
    label: "Efecto de luces", params: { effect: "nombre de la biblioteca de luces" },
    check: (app, p) => { const f = findFx(p.effect); if (!f) fail(`No existe el efecto de luces «${p.effect}»`); return { effect: f.id }; },
    text: (app, p) => `Luces: «${findFx(p.effect).name}» en todas las luces`,
    run: (app, p) => runAction(app, { type: "lightfx", fx: p.effect }),
  },
  create_dmx_scene: {
    label: "Guardar estado de luces", params: { name: "texto" },
    check: (app, p) => ({ name: str(p.name, "name", { req: false }) || "Escena de luces" }),
    text: (app, p) => `Capturar el estado actual de las luces como «${p.name}»`,
    run: (app, p) => { const sn = app.dmx.capture(p.name); app.changed({ panel: true }); app.commit(); return `Snapshot «${sn.name}» guardada`; },
  },
  lights_play: {
    label: "Encender / detener las luces", params: { on: "true|false" },
    check: (app, p) => ({ on: p.on !== false && p.on !== "false" }),
    text: (app, p) => p.on ? "Encender la salida de luces (PLAY)" : "Detener la salida de luces",
    run: (app, p) => { app.dmx.cfg.enabled = p.on; if (p.on) app.dmx.connect(); app.changed({ panel: true }); app.commit(); return p.on ? "Luces en marcha" : "Luces detenidas"; },
  },
  set_param: {
    label: "Mover un parámetro", params: { id: "id del parámetro", value: "número o true/false" },
    check: (app, p) => { const d = describe(app, p.id); if (!d) fail(`No existe el parámetro «${p.id}»`); return { id: d.id, value: d.kind === "bool" ? !!p.value : d.kind === "trigger" ? true : num(p.value, "value", d.min, d.max) }; },
    text: (app, p) => `${describe(app, p.id)?.name || p.id} → ${p.value}`,
    run: (app, p) => runAction(app, { type: "param", target: p.id, value: p.value }),
  },
  blackout: {
    label: "Apagón", params: { on: "true|false" },
    check: (app, p) => ({ on: p.on !== false && p.on !== "false" }),
    text: (app, p) => p.on ? "Apagón (todo a negro)" : "Quitar el apagón",
    run: (app, p) => runAction(app, { type: "blackout", value: p.on }),
  },
  start_tracking: {
    label: "Activar la detección de personas", params: {},
    check: () => ({}),
    text: () => "Poner en marcha la detección de personas con la cámara",
    run: (app) => { const t = app.tracking?.ensure(app.S.project.settings.tracking.camId || "default"); return t ? "Detección en marcha" : "La detección no está disponible con el proveedor elegido"; },
  },
  create_tracking_rule: {
    label: "Regla interactiva", params: { signal: SIGNALS.map(s => s[0]).join("|"), op: "above|below", value: "0-1", then: "acción: {type: scene|color|anim|lightfx|blackout|screen|video, …}" },
    check: (app, p) => {
      const signal = oneOf(p.signal, "signal", SIGNALS.map(s => s[0]));
      const then = p.then || {};
      if (!["scene", "color", "anim", "lightfx", "blackout", "screen", "video"].includes(then.type)) fail("La acción de la regla debe ser scene, color, anim, lightfx, blackout, screen o video");
      if (then.type === "screen" && !/^(screens|screen:[1-4]|surface:.+)$/.test(then.target || "")) fail("Pantalla no válida (screens, screen:1-4 o surface:<id>)");
      if (then.type === "video" && !app.S.project.media.some(m => m.id === then.mediaId || m.name === then.mediaId)) fail("Ese video no está en el proyecto");
      if (then.type === "color") color(then.color, "color");
      if (then.type === "lightfx" && !findFx(then.fx)) fail(`No existe el efecto de luces «${then.fx}»`);
      if (then.type === "lightfx") then.fx = findFx(then.fx).id;
      if (then.type === "anim" && !M.ANIM_LIBRARY.some(a => a.name === then.name)) fail(`No existe la animación «${then.name}»`);
      return { signal, op: oneOf(p.op, "op", ["above", "below"], "above"), value: num(p.value, "value", 0, 1, 0.5), then: { ...then, surface: then.surface || "all" } };
    },
    text: (app, p) => `Cuando «${SIGNALS.find(s => s[0] === p.signal)[1]}» ${p.op === "below" ? "baje de" : "supere"} ${p.value} → ${p.then.type === "lightfx" ? "luces " + findFx(p.then.fx).name : p.then.type}`,
    run: (app, p) => {
      app.S.project.settings.tracking.rules.push({ id: M.uid("rule"), name: "", signal: p.signal, op: p.op, value: p.value, cooldown: 1, then: p.then, otherwise: null, enabled: true });
      app.tracking?.ensure(app.S.project.settings.tracking.camId || "default");
      app.changed({ panel: true }); app.commit();
      return "Regla creada";
    },
  },
  add_3d_object: {
    label: "Objeto 3D", params: { kind: "cube|plane|sphere|cylinder|cone|pyramid|prism" },
    check: (app, p) => ({ kind: oneOf(p.kind, "kind", ["cube", "plane", "sphere", "cylinder", "cone", "pyramid", "prism"]) }),
    text: (app, p) => `Añadir un objeto 3D (${p.kind})`,
    run: async (app, p) => { const { ensure3d } = await import("../panels-3d.js"); const st = await ensure3d(app); const o = st.addObject(p.kind); app.changed({ panel: true }); app.commit(); return `${o.name} añadido`; },
  },
  screen_power: {
    label: "Encender / apagar pantalla", params: { screen: "1-4 | all | nombre de superficie", on: "true|false" },
    check: (app, p) => {
      const on = p.on !== false && p.on !== "false";
      if (["all", "todas", "screens"].includes(String(p.screen).toLowerCase())) return { target: "screens", on };
      const n = Number(p.screen);
      if (Number.isInteger(n) && n >= 1 && n <= 4) return { target: `screen:${n}`, on };
      return { target: "surface:" + surfaceRef(app, p.screen), on };
    },
    text: (app, p) => `${targetName(app.S.project, p.target)}: ${p.on ? "encender" : "apagar"}`,
    run: (app, p) => runAction(app, { type: "screen", target: p.target, on: p.on }),
  },
  screen_timer: {
    label: "Pantallas por tiempos", params: { template: TIMER_TEMPLATES.map(t => t[0]).join("|"), every: "segundos entre pasos (1-3600)", who: "screens|surfaces" },
    check: (app, p) => {
      const who = oneOf(p.who, "who", ["screens", "surfaces"], "screens");
      if (who === "surfaces" && !app.S.project.surfaces.length) fail("No hay superficies");
      return { template: oneOf(p.template, "template", TIMER_TEMPLATES.map(t => t[0])), every: Math.round(num(p.every, "every", 1, 3600, 5)), who };
    },
    text: (app, p) => `${TIMER_TEMPLATES.find(t => t[0] === p.template)[1]}: ${p.who === "surfaces" ? "superficies" : "pantallas"} cada ${p.every} s (se puede cambiar en En vivo → tiempos)`,
    run: (app, p) => {
      const P = app.S.project, c = P.settings.timers;
      const used = [1, 2, 3, 4].filter(n => n === 1 || P.surfaces.some(s => (s.screen || 0) === n)).map(n => `screen:${n}`);
      const targets = p.who === "surfaces" ? P.surfaces.map(s => `surface:${s.id}`) : used.length > 1 ? used : ["screen:1", "screen:2"];
      const r = templateSteps(p.template, targets, p.every);
      c.steps = r.steps; c.length = r.length;
      app.timers?.start();
      app.changed({ panel: true }); app.commit();
      if (app.S.tab !== "live") app.openTab("live");
      return `Tiempos en marcha (${r.steps.length} pasos)`;
    },
  },
  open_panel: {
    label: "Abrir un panel", params: { tab: TABS.join("|") },
    check: (app, p) => ({ tab: oneOf(p.tab, "tab", TABS) }),
    text: (app, p) => `Abrir el panel «${p.tab}»`,
    run: (app, p) => { const pro = ["show", "3d", "tracking", "control", "perf"]; if (pro.includes(p.tab)) app.setPro(true); if (app.S.tab !== p.tab) app.openTab(p.tab); return "Panel abierto"; },
  },
  start_lesson: {
    label: "Lección de la academia", params: { level: "1-10" },
    check: (app, p) => ({ level: Math.round(num(p.level, "level", 1, 10)) }),
    text: (app, p) => `Empezar la lección ${p.level} de la Academia`,
    run: (app, p) => { app.academy?.start(p.level); return "Lección en marcha"; },
  },
};

export const ACTION_NAMES = Object.keys(ACTIONS);
export const isCritical = (name) => !!ACTIONS[name]?.critical;

/**
 * Valida una propuesta { action, parameters }. Devuelve
 * { ok: true, action, params, text, critical } o { ok: false, action, error }.
 */
export function validateAction(app, prop) {
  const name = prop?.action;
  const def = ACTIONS[name];
  if (!def) return { ok: false, action: String(name), error: `Acción no permitida: «${name}»` };
  try {
    const params = def.check(app, { ...(prop.parameters || {}) });
    return { ok: true, action: name, params, text: def.text(app, params), critical: !!def.critical };
  } catch (e) {
    if (e instanceof ActionError) return { ok: false, action: name, error: e.message };
    return { ok: false, action: name, error: "Parámetros no válidos" };
  }
}

/** Ejecuta una acción YA validada (tras «Aplicar»). Devuelve un texto del resultado. */
export async function applyAction(app, v) {
  if (!v?.ok) throw new Error(v?.error || "Acción no válida");
  const again = validateAction(app, { action: v.action, parameters: v.params });   // el proyecto pudo cambiar
  if (!again.ok) throw new Error(again.error);
  return String(await ACTIONS[v.action].run(app, again.params) ?? "Hecho");
}

/** Catálogo para el modelo: nombre, para qué sirve y parámetros. */
export function actionCatalogText() {
  return ACTION_NAMES.map(n => `- ${n}: ${ACTIONS[n].label}${ACTIONS[n].critical ? " (crítica)" : ""}. Parámetros: ${JSON.stringify(ACTIONS[n].params)}`).join("\n");
}
export { LIGHT_FX, defaultLightFx };
