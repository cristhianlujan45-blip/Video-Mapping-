// web/js/plugins.js
// Plugins de LumaMap: paquetes que añaden efectos, animaciones y shaders ISF a la app.
// Un plugin es un archivo .json SOLO DE DATOS (nunca código que se ejecute en la app) o un
// shader ISF (.fs) suelto. Todo se valida al instalarlo: lo que no se entiende se descarta.
// Los plugins incluidos (plugins-bundled.js) vienen activados y se pueden apagar.
//
// Formato (.json):
// { "lumamap-plugin": 1, "id": "mi-pack", "name": "Mi pack", "version": "1.0", "author": "…",
//   "description": "…",
//   "effects":    [ { "name": "Neón rosa", "fx": { "saturation": 1.8, "duotone": 1, … } } ],
//   "animations": [ { "name": "Fuego azul", "gen": "fire", "color": "#00e5ff", "color2": "#002244", "speed": 1, "scale": 1, "fx": { … } } ],
//   "shaders":    [ { "name": "Rejilla retro", "isf": "/* { \"INPUTS\": [] } */ void main(){ … }" } ] }
import { DEFAULT_FX, GENERATORS, FX_LIBRARY, FX_CATEGORIES, FX_PRESETS, ANIM_LIBRARY, ANIM_CATEGORIES } from "./model.js";
import { parseISF } from "./isf.js";
import { BUNDLED } from "./plugins-bundled.js";

const KEY = "lumamap:plugins";        // plugins instalados por el usuario
const OFF = "lumamap:pluginsOff";     // ids apagados (también de los incluidos)
const store = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };

const plugins = new Map();            // id -> { plugin, bundled, enabled }
const shaders = new Map();            // id del shader -> { id, plugin, name, isf }
const listeners = new Set();
export const onPluginsChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const changed = () => { for (const f of listeners) { try { f(); } catch {} } };

/* ---------------- Validación (todo lo de fuera es dato, no código) ---------------- */
const GEN_IDS = new Set(GENERATORS.map(g => g.id));
const FX_DEF = DEFAULT_FX();
const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
const str = (v, n = 60) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, n);
const num = (v, lo, hi, d) => Number.isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : d;

/** Solo parámetros de efecto que existen, con su tipo. */
export function cleanFx(fx) {
  const out = {};
  if (!fx || typeof fx !== "object") return out;
  for (const [k, v] of Object.entries(fx)) {
    if (!(k in FX_DEF) || k === "__proto__") continue;
    const d = FX_DEF[k];
    if (typeof d === "number" && Number.isFinite(+v)) out[k] = num(v, -100, 100, d);
    else if (typeof d === "boolean") out[k] = !!v;
    else if (typeof d === "string") { const s = str(v, 32); if (!/color|duo|keyCol/i.test(k) || HEX.test(s)) out[k] = s; }
  }
  return out;
}

/** Comprueba y limpia un plugin. Lanza un error claro si no sirve. */
export function validatePlugin(p) {
  if (!p || typeof p !== "object" || p["lumamap-plugin"] !== 1) throw new Error("No es un plugin de LumaMap (falta \"lumamap-plugin\": 1).");
  const id = str(p.id, 40).toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  if (!id) throw new Error("El plugin no tiene «id».");
  const out = { "lumamap-plugin": 1, id, name: str(p.name) || id, version: str(p.version, 16), author: str(p.author, 60), description: str(p.description, 300), effects: [], animations: [], shaders: [] };
  for (const e of (Array.isArray(p.effects) ? p.effects : []).slice(0, 200)) {
    const fx = cleanFx(e?.fx), name = str(e?.name);
    if (name && Object.keys(fx).length) out.effects.push({ name, fx });
  }
  for (const a of (Array.isArray(p.animations) ? p.animations : []).slice(0, 200)) {
    const name = str(a?.name);
    if (!name || !GEN_IDS.has(a?.gen)) continue;
    out.animations.push({ name, gen: a.gen, color: HEX.test(a.color) ? a.color : "#00e5ff", color2: HEX.test(a.color2) ? a.color2 : "#ff00aa",
      speed: num(a.speed, 0, 8, 1), scale: num(a.scale, 0.1, 8, 1), fx: a.fx ? cleanFx(a.fx) : null });
  }
  for (const s of (Array.isArray(p.shaders) ? p.shaders : []).slice(0, 50)) {
    if (typeof s?.isf !== "string" || s.isf.length > 60000) continue;
    const isf = parseISF(s.isf, str(s.name) || "Shader");   // lanza si no es compatible
    out.shaders.push({ name: str(s.name) || isf.name, isf: s.isf });
  }
  if (!out.effects.length && !out.animations.length && !out.shaders.length) throw new Error("El plugin no añade nada que LumaMap entienda (efectos, animaciones o shaders).");
  return out;
}

/** Un archivo (.json de plugin o shader ISF .fs) → plugin validado. */
export function pluginFromFile(text, fileName = "") {
  const t = String(text || "");
  if (/\.(fs|frag|isf|glsl)$/i.test(fileName) || /^\s*\/\*\s*\{/.test(t)) {
    const isf = parseISF(t, fileName.replace(/\.[^.]+$/, "") || "Shader");
    return validatePlugin({ "lumamap-plugin": 1, id: "isf-" + (isf.name || fileName).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30), name: isf.name, author: isf.credit,
      description: isf.description || "Shader ISF", shaders: [{ name: isf.name, isf: t }] });
  }
  let j;
  try { j = JSON.parse(t); } catch { throw new Error("El archivo no es un plugin (.json) ni un shader ISF (.fs)."); }
  return validatePlugin(j);
}

/* ---------------- Registrar en la app ---------------- */
function register(entry) {
  const p = entry.plugin, cat = "🧩 " + p.name;
  p.effects.forEach((e) => {
    let name = e.name;
    if (FX_PRESETS[name] && !FX_LIBRARY.some(x => x.name === name && x.plugin === p.id)) name = `${e.name} (${p.name})`;
    FX_LIBRARY.push({ cat, name, fx: e.fx, plugin: p.id });
    FX_PRESETS[name] = () => ({ ...e.fx });
  });
  p.animations.forEach((a, i) => ANIM_LIBRARY.push({ id: `p:${p.id}:a${i}`, cat, name: a.name, gen: a.gen, color: a.color, color2: a.color2, speed: a.speed, scale: a.scale, fx: a.fx, plugin: p.id }));
  p.shaders.forEach((s, i) => {
    const sid = `${p.id}/${i}`;
    shaders.set(sid, { id: sid, plugin: p.id, name: s.name, isf: parseISF(s.isf, s.name) });
    ANIM_LIBRARY.push({ id: `p:${p.id}:s${i}`, cat, name: s.name, shader: sid, plugin: p.id });
  });
  if ((p.effects.length) && !FX_CATEGORIES.includes(cat)) FX_CATEGORIES.push(cat);
  if ((p.animations.length || p.shaders.length) && !ANIM_CATEGORIES.includes(cat)) ANIM_CATEGORIES.push(cat);
}
function unregister(id) {
  const cut = (arr, keep) => { for (let i = arr.length - 1; i >= 0; i--) if (!keep(arr[i])) arr.splice(i, 1); };
  for (const e of FX_LIBRARY) if (e.plugin === id) delete FX_PRESETS[e.name];
  cut(FX_LIBRARY, e => e.plugin !== id);
  cut(ANIM_LIBRARY, a => a.plugin !== id);
  for (const [k, s] of shaders) if (s.plugin === id) shaders.delete(k);
  cut(FX_CATEGORIES, c => FX_LIBRARY.some(e => e.cat === c));
  cut(ANIM_CATEGORIES, c => ANIM_LIBRARY.some(a => a.cat === c));
}

/** Carga los plugins incluidos y los instalados (una vez, al abrir la app). */
let loaded = false;
export function loadPlugins() {
  if (loaded) return;
  loaded = true;
  const off = new Set(store.get(OFF, []));
  for (const b of BUNDLED) { try { const p = validatePlugin(b); plugins.set(p.id, { plugin: p, bundled: true, enabled: !off.has(p.id) }); } catch (e) { console.warn("plugin incluido", b?.id, e); } }
  for (const raw of store.get(KEY, [])) { try { const p = validatePlugin(raw); if (!plugins.has(p.id)) plugins.set(p.id, { plugin: p, bundled: false, enabled: !off.has(p.id) }); } catch (e) { console.warn("plugin", raw?.id, e); } }
  for (const e of plugins.values()) if (e.enabled) register(e);
}

const saveUser = () => store.set(KEY, [...plugins.values()].filter(e => !e.bundled).map(e => e.plugin));
const saveOff = () => store.set(OFF, [...plugins.values()].filter(e => !e.enabled).map(e => e.plugin.id));

/** Instala (o actualiza) un plugin desde el texto de un archivo. Devuelve el plugin. */
export function installPlugin(text, fileName = "") {
  loadPlugins();
  const p = pluginFromFile(text, fileName);
  const prev = plugins.get(p.id);
  if (prev?.bundled) throw new Error(`«${p.name}» ya viene incluido en LumaMap.`);
  if (prev) unregister(p.id);
  const e = { plugin: p, bundled: false, enabled: true };
  plugins.set(p.id, e);
  register(e);
  saveUser(); saveOff(); changed();
  return p;
}
export function setPluginEnabled(id, on) {
  const e = plugins.get(id);
  if (!e || e.enabled === !!on) return;
  e.enabled = !!on;
  if (on) register(e); else unregister(id);
  saveOff(); changed();
}
export function removePlugin(id) {
  const e = plugins.get(id);
  if (!e || e.bundled) return false;
  if (e.enabled) unregister(id);
  plugins.delete(id);
  saveUser(); saveOff(); changed();
  return true;
}
/** [{ id, name, version, author, description, bundled, enabled, counts:{effects,animations,shaders} }] */
export function listPlugins() {
  loadPlugins();
  return [...plugins.values()].map(({ plugin: p, bundled, enabled }) => ({ id: p.id, name: p.name, version: p.version, author: p.author, description: p.description,
    bundled, enabled, counts: { effects: p.effects.length, animations: p.animations.length, shaders: p.shaders.length } }));
}
/** Shader de un plugin activo (o null). */
export const getShader = (id) => { loadPlugins(); return shaders.get(id) || null; };
