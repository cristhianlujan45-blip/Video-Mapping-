// web/js/timers.js
// Encender y apagar pantallas y superficies por tiempos: una lista de pasos
// «a los 00:05 → Pantalla 2 ON». Sirve para sincronizarlas (todas a la vez),
// hacer que se enciendan una tras otra, alternarlas o poner cada tiempo a mano.
// Se repite en bucle si se quiere y puede empezar sola al abrir el proyecto o a
// una hora del día (instalaciones). Igual en Windows, Android y el navegador.
import { uid, lookOf, currentScene, defaultTimers, normalizeTimers } from "./model.js";
export { defaultTimers, normalizeTimers };

/** «75» → «01:15». */
export const fmtTime = (s) => { s = Math.max(0, Math.round(s)); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
/** «1:15», «75», «1m15», «90s» → segundos (o null). */
export function parseTime(v) {
  const t = String(v ?? "").trim().toLowerCase();
  let m;
  if ((m = t.match(/^(\d+):(\d{1,2})$/))) return +m[1] * 60 + +m[2];
  if ((m = t.match(/^(\d+(?:[.,]\d+)?)\s*s?$/))) return Math.round(parseFloat(m[1].replace(",", ".")));
  if ((m = t.match(/^(\d+)\s*m(?:in)?\s*(?:(\d+)\s*s?)?$/))) return +m[1] * 60 + (+m[2] || 0);
  return null;
}

/** Destinos posibles: pantallas, todas, y cada superficie. */
export function timerTargets(project) {
  return [
    ["screens", "Todas las pantallas"],
    ...[1, 2, 3, 4].map(n => [`screen:${n}`, `Pantalla ${n}`]),
    ...project.surfaces.map(s => [`surface:${s.id}`, `Superficie «${s.name}»`]),
  ];
}
export function targetName(project, target) {
  return timerTargets(project).find(t => t[0] === target)?.[1] || "(ya no existe)";
}

/** Aplica un paso: enciende o apaga su destino. Devuelve un texto. */
export function applyStep(app, step) {
  const P = app.S.project, A = app.actions;
  const [kind, id] = step.target.split(":");
  if (kind === "screens") { for (const n of [1, 2, 3, 4]) P.settings.screens[n].on = step.on; app.changed({ panel: app.S.tab === "live" }); app.commitSoon?.(); }
  else if (kind === "screen") A.setScreenCfg(+id, { on: step.on }, true);
  else if (kind === "surface") {
    const s = P.surfaces.find(x => x.id === id);
    if (!s) return "";
    lookOf(currentScene(P), id).hidden = !step.on;
    app.changed({ panel: app.S.tab === "live" }); app.commitSoon?.();
  }
  return `${targetName(P, step.target)} ${step.on ? "ON" : "OFF"}`;
}

/** Duración de una vuelta: la indicada o el último paso + 1 s. */
export const cycleLength = (t) => Math.max(t.length || 0, ...t.steps.map(s => s.at + 1), 1);

/**
 * Plantillas de un toque. targets = destinos en orden; gap = segundos entre pasos.
 *  · together: todas se encienden a la vez (sincronizadas) y se apagan a la vez.
 *  · cascade:  una tras otra, y al final todas se apagan.
 *  · alternate: una encendida y la otra apagada, y se van turnando.
 *  · chase:    solo una encendida cada vez, recorriéndolas (persecución).
 */
export const TIMER_TEMPLATES = [
  ["together", "Todas a la vez", "Se encienden y se apagan sincronizadas"],
  ["cascade", "Una tras otra", "Se van encendiendo en orden y al final se apagan"],
  ["alternate", "Alternar", "Una encendida y la otra apagada, turnándose"],
  ["chase", "Persecución", "Solo una encendida cada vez, recorriéndolas"],
];
export function templateSteps(kind, targets, gap = 5) {
  const T = targets.length ? targets : ["screen:1"], st = [];
  const add = (at, target, on) => st.push({ id: uid("tm"), at, target, on });
  if (kind === "together") { for (const t of T) add(0, t, true); for (const t of T) add(gap * 2, t, false); return { steps: st, length: gap * 3 }; }
  if (kind === "cascade") { T.forEach((t, i) => add(i === 0 ? 0 : i * gap, t, true)); for (const t of T) add(T.length * gap + gap, t, false); for (const t of T.slice(1)) add(0, t, false); return { steps: sortSteps(st), length: T.length * gap + gap * 2 }; }
  if (kind === "alternate") {
    const [a, b] = T.length >= 2 ? T : [T[0], T[0]];
    add(0, a, true); add(0, b, false); add(gap, a, false); add(gap, b, true);
    return { steps: st, length: gap * 2 };
  }
  // chase
  T.forEach((t, i) => { add(i * gap, t, true); for (const o of T) if (o !== t) add(i * gap, o, false); });
  return { steps: st, length: T.length * gap };
}
export const sortSteps = (steps) => steps.sort((a, b) => a.at - b.at || (a.on === b.on ? 0 : a.on ? 1 : -1));

/** Motor: se llama en cada fotograma; no pesa nada (solo compara tiempos). */
export class TimerEngine {
  constructor(app) { this.app = app; this.running = false; this.t0 = 0; this.fired = new Set(); this.lastClock = ""; this.onChange = () => {}; this.log = []; }
  get cfg() { return this.app.S.project.settings.timers; }
  elapsed(now = performance.now()) { return this.running ? (now - this.t0) / 1000 : 0; }
  start(now = performance.now()) { this.running = true; this.t0 = now; this.fired.clear(); this.tick(now); this.onChange(); }
  stop() { this.running = false; this.fired.clear(); this.onChange(); }
  /** Próximo paso que va a ocurrir (para mostrarlo). */
  next(now = performance.now()) {
    const t = this.elapsed(now);
    return sortSteps([...this.cfg.steps]).find(s => s.at > t || (s.at <= t && !this.fired.has(s.id))) || null;
  }
  tick(now = performance.now(), wall = new Date()) {
    const c = this.cfg;
    if (!c) return;
    // Empezar a una hora del día (una vez por minuto coincidente).
    if (!this.running && c.startAt && c.steps.length) {
      const hm = `${wall.getHours()}:${String(wall.getMinutes()).padStart(2, "0")}`;
      const want = c.startAt.replace(/^0(\d):/, "$1:");
      if (hm === want && this.lastClock !== hm) { this.lastClock = hm; this.start(now); return; }
      if (hm !== want) this.lastClock = "";
    }
    if (!this.running || !c.steps.length) return;
    let t = this.elapsed(now);
    const len = cycleLength(c);
    if (t >= len) {
      if (!c.loop) { this.stop(); return; }
      this.t0 += Math.floor(t / len) * len * 1000; this.fired.clear(); t = this.elapsed(now);
    }
    let did = false;
    for (const s of sortSteps([...c.steps])) {
      if (s.at > t || this.fired.has(s.id)) continue;
      this.fired.add(s.id);
      try { const txt = applyStep(this.app, s); if (txt) { this.log.unshift(`${fmtTime(s.at)} · ${txt}`); this.log.length = Math.min(this.log.length, 20); } } catch (e) { console.warn(e); }
      did = true;
    }
    if (did) this.onChange();
  }
}
