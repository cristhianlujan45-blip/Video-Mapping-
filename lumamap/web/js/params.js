// web/js/params.js
// Motor de parámetros: el único punto por el que cualquier entrada (MIDI, OSC,
// DMX, teclado, audio, tracking, mando remoto, macros) cambia algo de la app.
//
//   ENTRADA ──► mapeo (mappings del proyecto) ──► parámetro (descriptor) ──► estado
//
// · Cada parámetro tiene id, nombre, tipo, mínimo, máximo, valor por defecto y
//   valor actual (describe()).
// · Varias fuentes pueden mover el mismo parámetro. «Sustituir» desde MIDI/OSC/
//   DMX/teclado escribe el valor en el proyecto (como mover el deslizador, con
//   deshacer). Las demás mezclas (sumar, multiplicar, máximo, mínimo) y las fuentes
//   continuas (audio, tracking) se aplican como modulación en cada fotograma sin
//   tocar el valor guardado (modList() / applyModList()).
import { lookOf, currentScene, createLook, normalizeMapping, DEFAULT_BANKS, defaultControl, normalizeControl } from "./model.js";
export { normalizeMapping, DEFAULT_BANKS, defaultControl, normalizeControl };

/** Rangos de los efectos (los usan el panel Efectos y el motor). [nombre, min, max, paso, defecto] */
export const FX_RANGE = {
  border: ["Borde neón: grosor", 0, 0.08, 0.001, 0],
  borderGlow: ["Borde neón: resplandor", 0, 1, 0.01, 0.5],
  brightness: ["Brillo", 0, 2, 0.01, 1],
  contrast: ["Contraste", 0, 2, 0.01, 1],
  saturation: ["Saturación", 0, 3, 0.01, 1],
  hue: ["Tono", 0, 1, 0.005, 0],
  hueCycle: ["Tono que gira solo", 0, 4, 0.05, 0],
  gamma: ["Gamma", 0.3, 3, 0.01, 1],
  sepia: ["Sepia", 0, 1, 0.01, 0],
  duotone: ["Duotono", 0, 1, 0.01, 0],
  posterize: ["Posterizar (niveles)", 0, 12, 1, 0],
  threshold: ["Umbral blanco/negro", 0, 1, 0.01, 0],
  vignette: ["Viñeta", 0, 1.5, 0.01, 0],
  scanlines: ["Líneas de TV", 0, 1, 0.01, 0],
  crt: ["Curvatura de TV antigua", 0, 1.5, 0.01, 0],
  halftone: ["Semitono (periódico)", 0, 1, 0.01, 0],
  noise: ["Ruido / grano", 0, 0.6, 0.01, 0],
  blur: ["Desenfoque", 0, 2, 0.01, 0],
  zoom: ["Zoom", 0.2, 4, 0.01, 1],
  rotate: ["Rotación", -180, 180, 1, 0],
  spin: ["Giro continuo", -3, 3, 0.05, 0],
  scrollX: ["Desplazar ↔", -1, 1, 0.01, 0],
  scrollY: ["Desplazar ↕", -1, 1, 0.01, 0],
  shake: ["Temblor (más fuerte en cada golpe)", 0, 4, 0.05, 0],
  kaleido: ["Caleidoscopio", 0, 16, 1, 0],
  tile: ["Mosaico (repetir N×N)", 1, 10, 1, 1],
  wave: ["Ondas", 0, 2, 0.01, 0],
  twirl: ["Remolino", -3, 3, 0.01, 0],
  bulge: ["Ojo de pez (− pellizco)", -1, 1, 0.01, 0],
  ripple: ["Gota de agua", 0, 3, 0.01, 0],
  pixelate: ["Pixelado", 0, 1, 0.01, 0],
  glitch: ["Glitch", 0, 1, 0.01, 0],
  rgbShift: ["Separación RGB", 0, 0.03, 0.0005, 0],
  chroma: ["Aberración cromática", 0, 0.05, 0.0005, 0],
  edges: ["Contornos neón", 0, 1, 0.01, 0],
  sharpen: ["Nitidez", 0, 2, 0.01, 0],
  emboss: ["Relieve", 0, 1, 0.01, 0],
  chromaKey: ["Quitar color de fondo (croma)", 0, 0.8, 0.01, 0],
  keySoft: ["Suavidad del recorte", 0, 0.5, 0.01, 0.1],
  lumaKey: ["Quitar lo oscuro (luma)", 0, 0.9, 0.01, 0],
  lumaSoft: ["Suavidad de luma", 0, 0.5, 0.01, 0.05],
  strobe: ["Destellos por segundo", 0, 15, 0.5, 0],};

export const SOURCE_NAMES = { midi: "MIDI", osc: "OSC", dmx: "DMX", key: "Teclado", audio: "Audio", tracking: "Tracking", remote: "Mando" };
export const MODES = [["absolute", "Absoluto"], ["relative", "Relativo (encoder)"], ["toggle", "Alternar"], ["momentary", "Momentáneo"], ["trigger", "Disparo"]];
export const MERGES = [["override", "Sustituir"], ["add", "Sumar"], ["multiply", "Multiplicar"], ["max", "Máximo"], ["min", "Mínimo"]];
export const REL_KINDS = [["twos", "Complemento a 2 (1…63 / 127…65)"], ["offset", "Desplazado (65+ / 63-)"], ["sign", "Signo y magnitud (bit 64)"]];
export const MODIFIERS = [["", "Ninguno"], ["shift", "SHIFT"], ["alt", "ALT"], ["ctrl", "CTRL"]];
/** Fuentes continuas: su efecto es una modulación que caduca si dejan de llegar datos. */
const CONTINUOUS = new Set(["audio", "tracking", "timeline"]);
const MOD_TTL = 500;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pctName = (k) => FX_RANGE[k]?.[0] || k;

/* ======================================================================
   Descriptores
   ====================================================================== */

/** Parámetros globales: [nombre, tipo, min, max, defecto, get(app), set(app, v)] */
const GLOBAL = {
  master: ["Brillo general", "float", 0, 1, 1, (a) => a.S.master, (a, v) => { a.S.master = v; }],
  blackout: ["Apagón", "bool", 0, 1, 0, (a) => a.S.blackout, (a, v) => { if (!!v !== a.S.blackout) a.actions.blackout(); }],
  play: ["Reproducir / pausa", "bool", 0, 1, 1, (a) => a.S.playing, (a, v) => { if (!!v !== a.S.playing) a.actions.togglePlay(); }],
  emergency: ["EMERGENCIA (salida segura)", "bool", 0, 1, 0, (a) => !!a.S.emergency, (a, v) => { if (!!v !== !!a.S.emergency) a.actions.emergency(); }],
  perfMode: ["Modo actuación", "bool", 0, 1, 0, (a) => !!a.S.perfMode, (a, v) => { if (!!v !== !!a.S.perfMode) a.actions.togglePerfMode(); }],
  go: ["GO (siguiente cue)", "trigger", 0, 1, 0, null, (a) => a.actions.stepScene(1)],
  next: ["Escena siguiente", "trigger", 0, 1, 0, null, (a) => a.actions.stepScene(1)],
  prev: ["Escena anterior", "trigger", 0, 1, 0, null, (a) => a.actions.stepScene(-1)],
  restart: ["Reiniciar videos", "trigger", 0, 1, 0, null, (a) => a.actions.restart()],
  goAll: ["GO: fundir todas a lo siguiente", "trigger", 0, 1, 0, null, (a) => a.actions.goAll()],
  randomAll: ["Todas al azar", "trigger", 0, 1, 0, null, (a) => a.actions.randomAll()],
  tap: ["TAP tempo", "trigger", 0, 1, 0, null, (a) => a.actions.tap()],
  bpm: ["Tempo (BPM)", "float", 40, 240, 120, (a) => a.S.project.settings.bpm || 120, (a, v) => a.actions.setBpm(Math.round(v * 10) / 10)],
  liveFade: ["Duración del fundido (s)", "float", 0, 8, 2, (a) => a.S.liveFade, (a, v) => { a.S.liveFade = v; }],
  react: ["Modo ritmo", "bool", 0, 1, 0, (a) => a.S.project.settings.react.enabled, (a, v) => { if (!!v !== a.S.project.settings.react.enabled) a.actions.toggleReact(); }],
  reactAmount: ["Intensidad del ritmo", "float", 0, 2, 1, (a) => a.S.project.settings.react.amount, (a, v) => { a.S.project.settings.react.amount = v; }],
  guides: ["Guías en el proyector", "bool", 0, 1, 0, (a) => a.S.guides, (a, v) => { if (!!v !== a.S.guides) a.actions.toggleGuides(); }],
};

/** Campos de una superficie (en la escena actual). */
const SURF = {
  opacity: ["Opacidad", "float", 0, 1, 1],
  mix: ["Crossfader A/B", "float", 0, 1, 0],
  volume: ["Volumen", "float", 0, 1, 0],
  rate: ["Velocidad del video", "float", 0, 4, 1],
  hidden: ["Ocultar", "bool", 0, 1, 0],
  go: ["GO (fundir a lo siguiente)", "trigger"],
  random: ["Siguiente al azar", "trigger"],
};

/** Convierte "surf/sel/…" en la superficie seleccionada ahora. */
export function resolveId(app, id) {
  if (id.startsWith("surf/sel/")) return app.S.sel ? "surf/" + app.S.sel + id.slice(8) : null;
  return id;
}

/**
 * Descriptor de un parámetro: { id, name, group, kind: float|bool|trigger, min, max, def, get(), set(v) }.
 * Devuelve null si el parámetro ya no existe (superficie borrada, escena que falta…).
 */
export function describe(app, rawId) {
  const id = resolveId(app, rawId);
  if (!id) return null;
  const p = id.split("/");
  const S = app.S, A = app.actions;
  const mk = (o) => ({ id, def: o.min ?? 0, ...o });
  switch (p[0]) {
    case "global": {
      const g = GLOBAL[p[1]];
      if (!g) return null;
      const [name, kind, min, max, def, get, set] = g;
      return mk({ name, group: "General", kind, min, max, def, get: () => (get ? get(app) : 0), set: (v) => set(app, v) });
    }
    case "screen": {
      const n = +p[1], sc = S.project.settings.screens?.[n];
      if (!sc) return null;
      if (p[2] === "master") return mk({ name: `Pantalla ${n} · brillo`, group: "Pantallas", kind: "float", min: 0, max: 1, def: 1, get: () => sc.master ?? 1, set: (v) => A.setScreenCfg(n, { master: v }, true) });
      if (p[2] === "on") return mk({ name: `Pantalla ${n} · encendida`, group: "Pantallas", kind: "bool", min: 0, max: 1, def: 1, get: () => sc.on !== false, set: (v) => A.setScreenCfg(n, { on: !!v }, true) });
      return null;
    }
    case "scene": {
      const i = +p[1];
      return mk({ name: `Escena ${i + 1}${S.project.scenes[i] ? " · " + S.project.scenes[i].name : ""}`, group: "Escenas", kind: "trigger",
        set: () => { const sc = S.project.scenes[i]; if (sc) A.goScene(sc.id); } });
    }
    case "surf": {
      const s = S.project.surfaces.find(x => x.id === p[1]);
      if (!s) return null;
      const look = () => lookOf(currentScene(S.project), s.id);
      const group = s.name;
      if (p[2] === "fx") {
        const k = p[3], r = FX_RANGE[k];
        if (!r) return null;
        return mk({ name: `${s.name} · ${pctName(k)}`, group, kind: "float", min: r[1], max: r[2], def: r[4], step: r[3],
          get: () => look().fx[k] ?? r[4], set: (v) => { look().fx[k] = r[3] >= 1 ? Math.round(v) : v; } });
      }
      const f = SURF[p[2]];
      if (!f) return null;
      const [label, kind, min = 0, max = 1, def = 0] = f;
      const name = `${s.name} · ${label}`;
      if (p[2] === "go") return mk({ name, group, kind, set: () => A.go(s.id) });
      if (p[2] === "random") return mk({ name, group, kind, set: () => A.randomNext(s.id, true) });
      if (p[2] === "mix") return mk({ name, group, kind, min, max, def, get: () => look().mix || 0, set: (v) => A.setMix(s.id, v) });
      if (p[2] === "hidden") return mk({ name, group, kind, min, max, def, get: () => !!look().hidden, set: (v) => { look().hidden = !!v; } });
      return mk({ name, group, kind, min, max, def, get: () => look()[p[2]] ?? def, set: (v) => { look()[p[2]] = v; } });
    }
    case "macro": {
      const m = S.project.settings.control.macros.find(x => x.id === p[1]);
      if (!m) return null;
      return mk({ name: `Macro · ${m.name}`, group: "Macros", kind: "trigger", set: () => app.params.runMacro(m.id) });
    }
    case "bank": {
      const b = p.slice(1).join("/");
      return mk({ name: b ? `Banco · ${b}` : "Banco · todos", group: "Bancos", kind: "trigger", set: () => app.params.setBank(b) });
    }
    case "mod": {
      const m = p[1];
      return mk({ name: `Modificador ${m.toUpperCase()}`, group: "Modificadores", kind: "bool", min: 0, max: 1, def: 0,
        get: () => app.params.modifier === m, set: (v) => app.params.setModifier(v ? m : (app.params.modifier === m ? "" : app.params.modifier)) });
    }
    default: {
      // Módulos que registran sus propios parámetros (DMX, 3D, timeline…).
      const ext = EXTENSIONS.get(p[0]);
      return ext ? ext(app, id, p) : null;
    }
  }
}

const EXTENSIONS = new Map();   // prefijo -> (app, id, partes) => descriptor
const CATALOGS = [];            // (app) => [{group, items:[{id,name}]}]
/** Otros módulos (DMX, 3D, show…) añaden parámetros con un prefijo propio. */
export function registerParams(prefix, describeFn, catalogFn) {
  EXTENSIONS.set(prefix, describeFn);
  if (catalogFn) CATALOGS.push(catalogFn);
}

/** Lista de parámetros para elegir destino: [{ group, items: [{ id, name, kind }] }]. */
export function catalog(app) {
  const S = app.S, out = [];
  const items = (ids) => ids.map(id => describe(app, id)).filter(Boolean).map(d => ({ id: d.id, name: d.name, kind: d.kind }));
  out.push({ group: "General", items: items(Object.keys(GLOBAL).map(k => "global/" + k)) });
  out.push({ group: "Pantallas", items: items([1, 2, 3, 4].flatMap(n => [`screen/${n}/master`, `screen/${n}/on`])) });
  out.push({ group: "Escenas", items: items(S.project.scenes.map((_, i) => "scene/" + i)) });
  const surfIds = (sid) => [...Object.keys(SURF).map(k => `surf/${sid}/${k}`), ...Object.keys(FX_RANGE).map(k => `surf/${sid}/fx/${k}`)];
  if (S.sel) {
    const sel = items(surfIds("sel")).map(x => ({ ...x, id: x.id.replace("surf/" + S.sel + "/", "surf/sel/"), name: x.name.replace(/^[^·]+·/, "Seleccionada ·") }));
    out.push({ group: "Superficie seleccionada (la que esté elegida en cada momento)", items: sel });
  }
  for (const s of S.project.surfaces) out.push({ group: "Superficie · " + s.name, items: items(surfIds(s.id)) });
  out.push({ group: "Macros", items: items(S.project.settings.control.macros.map(m => "macro/" + m.id)) });
  out.push({ group: "Bancos", items: items(["bank/", ...S.project.settings.control.banks.map(b => "bank/" + b)]) });
  out.push({ group: "Modificadores", items: items(["mod/shift", "mod/alt", "mod/ctrl"]) });
  for (const c of CATALOGS) out.push(...c(app));
  return out.filter(g => g.items.length);
}

/** Valor actual normalizado 0..1 de un descriptor. */
export function norm(d) {
  if (d.kind === "bool") return d.get() ? 1 : 0;
  if (d.kind === "trigger") return 0;
  return d.max === d.min ? 0 : clamp((d.get() - d.min) / (d.max - d.min), 0, 1);
}

/* ======================================================================
   Modulación en el render (también la usan las ventanas de salida)
   ====================================================================== */

/**
 * Aplica una lista de modulaciones [{ id, value }] (ids ya resueltos) a una
 * copia superficial del proyecto. Devuelve { project, master }.
 */
export function applyModList(project, master, mods) {
  if (!mods || !mods.length) return { project, master };
  let P = project, scenes = null, looks = null, screens = null;
  const scene = project.scenes.find(s => s.id === project.sceneId) || project.scenes[0];
  const lookCopy = (sid) => {
    if (!scenes) { P = { ...P }; scenes = P.scenes = P.scenes.slice(); }
    const i = scenes.findIndex(s => s.id === scene.id);
    if (!looks) { looks = { ...scene.looks }; scenes[i] = { ...scene, looks }; }
    const l = looks[sid] || scene.looks[sid] || createLook();
    if (!l.__mod) looks[sid] = { ...l, fx: { ...l.fx }, __mod: true };
    return looks[sid];
  };
  for (const { id, value } of mods) {
    const p = id.split("/");
    if (p[0] === "global" && p[1] === "master") master = value;
    else if (p[0] === "screen" && p[2] === "master") {
      if (!screens) { P = { ...P, settings: { ...P.settings, screens: { ...P.settings.screens } } }; screens = P.settings.screens; }
      screens[p[1]] = { ...screens[p[1]], master: value };
    } else if (p[0] === "surf") {
      if (!project.surfaces.some(s => s.id === p[1])) continue;
      const l = lookCopy(p[1]);
      if (p[2] === "fx") l.fx[p[3]] = value;
      else if (p[2] === "opacity" || p[2] === "mix") l[p[2]] = value;
    }
  }
  return { project: P, master };
}

/* ======================================================================
   Motor
   ====================================================================== */

export class ParamEngine {
  constructor(app) {
    this.app = app;
    this.learning = null;       // { target, resolve, at }
    this.monitor = [];          // últimos mensajes recibidos
    this.monitorPaused = false;
    this.onMonitor = null;      // callback de la vista del monitor
    this.mods = new Map();      // destino -> Map(mappingId -> { merge, value, at, src })
    this.modifier = "";         // modificador activo (shift, alt, ctrl)
    this.feedback = null;       // (mapping, valor01) => void  (lo pone el driver MIDI)
    this.lastFeedback = 0;
    this.activity = new Map();  // mappingId -> instante del último uso (para la vista de control)
    this.runtime = new Map();   // mappingId -> estado de ejecución (no se guarda en el proyecto)
  }
  rt(m) { let r = this.runtime.get(m.id); if (!r) this.runtime.set(m.id, r = {}); return r; }

  get ctl() { return this.app.S.project.settings.control; }

  /* ---------------- Entradas ---------------- */

  /**
   * Una entrada de cualquier fuente.
   * ev = { src, device, channel, key, v (0..1), on (pulsado/soltado), raw (0..127), label }
   * Devuelve cuántos mapeos la usaron.
   */
  input(ev) {
    if (!CONTINUOUS.has(ev.src)) this.log(ev);
    if (this.learning && !CONTINUOUS.has(ev.src)) return this.learnFrom(ev) ? 1 : 0;
    let n = 0;
    for (const m of this.ctl.mappings) {
      if (m.enabled === false || m.src !== ev.src || m.key !== ev.key) continue;
      if (m.device !== "*" && ev.device && m.device !== ev.device) continue;
      if (m.channel && ev.channel && m.channel !== ev.channel) continue;
      if (m.bank && m.bank !== this.ctl.bank) continue;
      if ((m.mod || "") !== this.modifier && !m.target.startsWith("mod/")) continue;
      if (this.apply(m, ev)) n++;
    }
    return n;
  }

  /** Aplica un mapeo a un parámetro. */
  apply(m, ev) {
    const d = describe(this.app, m.target);
    if (!d) return false;
    const r = this.rt(m);
    this.activity.set(m.id, performance.now());
    const span = d.max - d.min;
    const lo = Math.min(m.min, m.max), hi = Math.max(m.min, m.max);
    let v = ev.v ?? (ev.on ? 1 : 0);
    if (m.invert) v = 1 - v;
    const pressed = ev.on !== undefined ? ev.on : v >= 0.5;
    const wasPressed = r._pressed || false;
    r._pressed = pressed;
    const edge = pressed && !wasPressed;

    switch (d.kind === "trigger" ? "trigger" : m.mode) {
      case "trigger":
        if (edge) { d.set(true); this.touched(d); }
        return true;
      case "toggle":
        if (!edge) return true;
        if (d.kind === "bool") d.set(!d.get());
        else d.set(norm(d) > 0.5 ? d.min + lo * span : d.min + hi * span);
        this.touched(d);
        return true;
      case "momentary":
        if (pressed === wasPressed && ev.on === undefined) return true;
        if (d.kind === "bool") d.set(pressed);
        else d.set(d.min + (pressed ? hi : lo) * span);
        this.touched(d);
        return true;
      case "relative": {
        const steps = relSteps(ev.raw ?? Math.round(v * 127), m.rel);
        if (!steps) return true;
        const cur = norm(d);
        const next = clamp(cur + steps * (m.sens || 1) / 128 * (hi - lo), lo, hi);
        if (d.kind === "bool") d.set(next >= 0.5); else d.set(d.min + next * span);
        this.touched(d);
        return true;
      }
      default: { // absoluto
        const t = lo + v * (hi - lo);
        if (d.kind === "bool") {
          if (CONTINUOUS.has(m.src) || m.merge !== "override") return this.modulate(m, d, t >= 0.5 ? 1 : 0);
          if ((t >= 0.5) !== !!d.get()) { d.set(t >= 0.5); this.touched(d); }
          return true;
        }
        const value = d.min + t * span;
        if (CONTINUOUS.has(m.src) || m.merge !== "override") return this.modulate(m, d, value);
        // Soft takeover: no salta si el control físico no coincide con el valor actual.
        if (m.takeover && m.src === "midi" && ev.src === "midi") {
          const cur = norm(d), curT = hi > lo ? (cur - lo) / (hi - lo) : cur;
          if (r._applied === undefined || Math.abs(d.get() - r._applied) > 1e-6) r._picked = false;
          if (!r._picked) {
            const near = Math.abs(v - curT) < 0.035;
            const crossed = r._lastV !== undefined && (r._lastV - curT) * (v - curT) <= 0;
            r._lastV = v;
            if (!near && !crossed) { r._waiting = true; return true; }
            r._picked = true; r._waiting = false;
          }
          r._lastV = v;
        }
        d.set(value);
        r._applied = d.get();
        this.touched(d);
        return true;
      }
    }
  }

  /** Modulación sin escribir en el proyecto (fuentes continuas y mezclas). */
  modulate(m, d, value) {
    this.onRecord?.(d.id, value);
    let c = this.mods.get(d.id);
    if (!c) this.mods.set(d.id, c = new Map());
    c.set(m.id, { merge: m.merge === "override" && !CONTINUOUS.has(m.src) ? "override" : m.merge, value, at: performance.now(), src: m.src });
    return true;
  }

  /** Lista de modulaciones del fotograma: [{ id, value }] con los ids ya resueltos. */
  modList(now = performance.now()) {
    if (!this.mods.size) return null;
    const out = [];
    for (const [id, contribs] of this.mods) {
      for (const [mid, c] of contribs) if (CONTINUOUS.has(c.src) && now - c.at > MOD_TTL) contribs.delete(mid);
      if (!contribs.size) { this.mods.delete(id); continue; }
      const d = describe(this.app, id);
      if (!d || d.kind === "trigger") { this.mods.delete(id); continue; }
      let v = d.kind === "bool" ? (d.get() ? 1 : 0) : d.get();
      const span = d.max - d.min;
      for (const c of contribs.values()) {
        switch (c.merge) {
          case "add": v += c.value - d.min; break;
          case "multiply": v *= span ? (c.value - d.min) / span : 1; break;
          case "max": v = Math.max(v, c.value); break;
          case "min": v = Math.min(v, c.value); break;
          default: v = c.value;
        }
      }
      out.push({ id: d.id, value: clamp(v, d.min, d.max) });
    }
    return out.length ? out : null;
  }

  /** Quita las modulaciones de un mapeo (al borrarlo o desactivarlo). */
  dropMods(mappingId) {
    for (const [id, c] of this.mods) { c.delete(mappingId); if (!c.size) this.mods.delete(id); }
  }

  touched(d) { this.app.paramTouched?.(d.id); if (d.kind !== "trigger") this.onRecord?.(d.id, d.kind === "bool" ? (d.get() ? 1 : 0) : d.get()); }

  /** Modulación desde fuera de un mapeo (líneas de automatización, reglas de tracking…). */
  modulateExt(key, id, value, src = "timeline", merge = "override") {
    const d = describe(this.app, id);
    if (!d || d.kind === "trigger") return false;
    let c = this.mods.get(d.id);
    if (!c) this.mods.set(d.id, c = new Map());
    c.set(key, { merge, value: Math.max(d.min, Math.min(d.max, value)), at: performance.now(), src });
    return true;
  }

  /* ---------------- MIDI LEARN y demás «learn» ---------------- */

  /** Espera el siguiente control que se mueva (MIDI, OSC, DMX o tecla) y crea el mapeo. */
  learn(target) {
    this.cancelLearn();
    return new Promise((resolve) => { this.learning = { target, resolve, at: performance.now() }; });
  }
  cancelLearn() {
    if (this.learning) { const r = this.learning.resolve; this.learning = null; r(null); }
  }
  learnFrom(ev) {
    if (ev.on === false) return false;                       // soltar una tecla o nota no cuenta
    const L = this.learning, d = describe(this.app, L.target);
    this.learning = null;
    if (!d) { L.resolve(null); return false; }
    const isButton = ev.key.startsWith("note:") || ev.key.startsWith("pc:") || ev.src === "key" || ev.button;
    const mode = d.kind === "trigger" ? "trigger" : d.kind === "bool" ? (isButton ? "toggle" : "absolute") : (isButton ? "toggle" : "absolute");
    const ctl = this.ctl;
    // Si ese control ya estaba asignado (en el mismo banco y modificador), se reasigna.
    const old = ctl.mappings.find(m => m.src === ev.src && m.key === ev.key && (m.device === ev.device || m.device === "*") &&
      (m.channel || 0) === (ev.channel || 0) && (m.bank || "") === (ctl.bank || "") && (m.mod || "") === this.modifier);
    const m = normalizeMapping({
      ...(old || {}), id: old?.id, src: ev.src, device: ev.device || "*", channel: ev.channel || 0, key: ev.key, target: L.target,
      mode, bank: ctl.bank || "", mod: this.modifier, name: "",
    });
    if (old) ctl.mappings[ctl.mappings.indexOf(old)] = m; else ctl.mappings.push(m);
    this.app.paramMappingsChanged?.();
    L.resolve(m);
    return true;
  }

  /* ---------------- Monitor ---------------- */
  log(ev) {
    if (this.monitorPaused) return;
    this.monitor.push({ t: Date.now(), ...ev });
    if (this.monitor.length > 400) this.monitor.splice(0, this.monitor.length - 400);
    this.onMonitor?.();
  }

  /* ---------------- Bancos, modificadores y macros ---------------- */
  setBank(b) { this.ctl.bank = b || ""; this.app.paramMappingsChanged?.(); }
  setModifier(m) { this.modifier = m || ""; this.app.paramMappingsChanged?.(); }

  runMacro(id, depth = 0) {
    const mac = this.ctl.macros.find(m => m.id === id);
    if (!mac || depth > 4) return;
    let delay = 0;
    for (const st of mac.steps) {
      delay += Math.max(0, +st.delay || 0);
      const run = () => {
        if (st.target.startsWith("macro/")) return this.runMacro(st.target.slice(6), depth + 1);
        const d = describe(this.app, st.target);
        if (!d) return;
        if (d.kind === "trigger") d.set(true);
        else if (d.kind === "bool") d.set(!!st.value);
        else d.set(clamp(+st.value, d.min, d.max));
        this.touched(d);
      };
      if (delay) setTimeout(run, delay); else run();
    }
  }

  /* ---------------- Feedback hacia los controladores ---------------- */
  /** Llamado en cada fotograma: envía a los controladores los valores que cambiaron (LED, motor, pantallas). */
  tickFeedback(now = performance.now()) {
    if (!this.feedback || now - this.lastFeedback < 33) return;
    this.lastFeedback = now;
    for (const m of this.ctl.mappings) {
      if (!m.feedback || m.enabled === false || m.src !== "midi") continue;
      if (m.bank && m.bank !== this.ctl.bank) continue;
      const d = describe(this.app, m.target);
      if (!d || d.kind === "trigger") continue;
      const lo = Math.min(m.min, m.max), hi = Math.max(m.min, m.max);
      let v = d.kind === "bool" ? (d.get() ? 1 : 0) : hi > lo ? clamp((norm(d) - lo) / (hi - lo), 0, 1) : 0;
      if (m.invert) v = 1 - v;
      if (this.rt(m)._fb !== undefined && Math.abs(this.rt(m)._fb - v) < 1 / 16384) continue;
      this.rt(m)._fb = v;
      this.feedback(m, v);
    }
  }
}

/** Pasos de un encoder relativo a partir del valor de 7 bits. */
export function relSteps(raw, kind = "twos") {
  raw = raw & 127;
  if (kind === "offset") return raw - 64;
  if (kind === "sign") return raw & 64 ? -(raw & 63) : raw & 63;
  return raw === 0 ? 0 : raw < 64 ? raw : raw - 128;
}
