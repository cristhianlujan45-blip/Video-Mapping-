// web/js/ai/academy.js
// ACADEMIA DE VIDEO MAPPING: 10 niveles, un paso cada vez («PASO 2/5»).
// Cada paso dice UNA cosa y espera a que el usuario la haga de verdad en la
// app (se comprueba el estado real del proyecto), luego pasa al siguiente.
// Funciona sin IA. El progreso se guarda en este equipo.
import { currentScene } from "../model.js";

const sel = (app) => app.S.project.surfaces.find(s => s.id === app.S.sel) || null;
const look = (app) => { const s = sel(app); return s ? currentScene(app.S.project).looks[s.id] : null; };
const sig = (s) => s ? JSON.stringify(s.points) : "";
const outputsOpen = (app) => { try { return (app.perf?.().outputs || []).length > 0 || !!app.S.projecting || !!app.S.output; } catch { return false; } };

export const LEVELS = [
  { level: 1, title: "Primer mapping", steps: [
    { text: "Abre la pestaña «Añadir» (en la barra de abajo).", check: (app) => app.S.tab === "add" },
    { text: "Toca «Rectángulo» para crear tu primera superficie.", start: (app) => ({ n: app.S.project.surfaces.length }), check: (app, b) => app.S.project.surfaces.length > b.n },
    { text: "Arrastra una esquina (los puntos de colores) hasta la esquina real de la pared u objeto.", start: (app) => ({ s: sig(sel(app)) }), check: (app, b) => !!sel(app) && sig(sel(app)) !== b.s },
    { text: "Abre «Animaciones» y toca una para ponerla dentro de la superficie.", tab: "anim", start: (app) => ({ g: JSON.stringify(look(app)?.source || {}) }), check: (app, b) => !!look(app) && JSON.stringify(look(app).source) !== b.g && look(app).source.gen !== "calib" },
    { text: "Pulsa «Proyectar» (arriba a la derecha) y lleva la salida al proyector.", check: outputsOpen },
  ] },
  { level: 2, title: "Máscaras", steps: [
    { text: "Selecciona la superficie donde hay algo que tapar (puerta, ventana, mueble).", check: (app) => !!sel(app) },
    { text: "Abre la pestaña «Forma».", check: (app) => app.S.tab === "shape" },
    { text: "Toca «Máscara» para empezar a dibujarla.", check: (app) => app.S.mode === "mask" },
    { text: "Toca al menos 3 puntos alrededor de lo que quieres ocultar.", check: (app) => (sel(app)?.mask.points.length || 0) >= 3 },
    { text: "Termina la máscara (botón «Listo» o Esc). Prueba «Invertir» si quieres lo contrario.", check: (app) => app.S.mode !== "mask" && !!sel(app)?.mask.enabled },
  ] },
  { level: 3, title: "Warping (malla)", steps: [
    { text: "Selecciona una superficie y abre «Forma».", check: (app) => !!sel(app) && app.S.tab === "shape" },
    { text: "Elige una malla de 3×3 o más.", check: (app) => { const s = sel(app); return !!s && s.type === "quad" && (s.cols > 2 || s.rows > 2); } },
    { text: "Mueve un punto del centro para curvar la imagen (ideal para columnas).", start: (app) => ({ s: sig(sel(app)) }), check: (app, b) => sig(sel(app)) !== b.s },
  ] },
  { level: 4, title: "Varias superficies", steps: [
    { text: "Crea una segunda superficie (Añadir → una forma).", check: (app) => app.S.project.surfaces.length >= 2 },
    { text: "Pon un contenido distinto en cada una (Animaciones o Contenido).", check: (app) => { const sc = currentScene(app.S.project); const k = new Set(app.S.project.surfaces.map(s => JSON.stringify([sc.looks[s.id]?.source.type, sc.looks[s.id]?.source.gen, sc.looks[s.id]?.source.mediaId]))); return k.size >= 2; } },
    { text: "Abre «Capas» y cambia el orden (la de arriba tapa a la de abajo).", tab: "layers", start: (app) => ({ o: app.S.project.surfaces.map(s => s.id).join() }), check: (app, b) => app.S.project.surfaces.map(s => s.id).join() !== b.o },
  ] },
  { level: 5, title: "Varios proyectores", steps: [
    { text: "Abre «En vivo»: cada superficie elige por qué pantalla sale (P1-P4).", check: (app) => app.S.tab === "live" },
    { text: "Manda una superficie a la pantalla P2.", check: (app) => app.S.project.surfaces.some(s => s.screen === 2) },
    { text: "Abre la salida P2 y llévala al segundo proyector.", check: (app) => { try { return (app.perf?.().outputs || []).includes(2); } catch { return false; } } },
    { text: "Si los proyectores se solapan, en «Salida» usa Bordes suaves para fundir la unión.", tab: "output", check: (app) => Object.values(app.S.project.settings.output.softEdge || {}).some(v => typeof v === "number" && v > 0 && v < 2) },
  ] },
  { level: 6, title: "VJ en vivo", steps: [
    { text: "Abre la pestaña «En vivo».", check: (app) => app.S.tab === "live" },
    { text: "Elige qué será lo SIGUIENTE en una superficie (sin que se vea todavía).", check: (app) => app.S.project.surfaces.some(s => currentScene(app.S.project).looks[s.id]?.next) },
    { text: "Pulsa GO (o mueve el fader A⟷B) para mezclarlo.", start: (app) => ({ k: JSON.stringify(app.S.project.surfaces.map(s => currentScene(app.S.project).looks[s.id]?.source)) }), check: (app, b) => JSON.stringify(app.S.project.surfaces.map(s => currentScene(app.S.project).looks[s.id]?.source)) !== b.k },
  ] },
  { level: 7, title: "Audio reactivo", steps: [
    { text: "Abre la pestaña «Audio».", check: (app) => app.S.tab === "audio" },
    { text: "Activa el micrófono (o la entrada de audio).", check: (app) => !!app.audio?.()?.active },
    { text: "Selecciona una superficie y activa «Reaccionar al audio» en su contenido.", check: (app) => !!look(app)?.audio?.enabled },
  ] },
  { level: 8, title: "Luces DMX", steps: [
    { text: "Abre la pestaña «Luces».", check: (app) => app.S.tab === "lights" },
    { text: "En «Mis luces» añade una tira LED o un foco.", check: (app) => (app.dmx?.lights() || []).length > 0 },
    { text: "Elige un efecto de la biblioteca (por ejemplo «Arcoíris» o «Fuego»).", check: (app) => (app.dmx?.lights() || []).some(L => L.source === "effect") },
    { text: "Pulsa ▶ PLAY LUCES. Sin nodo conectado lo verás en el escenario (modo práctica).", check: (app) => !!app.dmx?.cfg.enabled },
  ] },
  { level: 9, title: "Proyección interactiva", steps: [
    { text: "Abre la pestaña «Interactivo» y elige la cámara.", check: (app) => app.S.tab === "interactive" },
    { text: "Elige un efecto interactivo (por ejemplo «Ondas al pisar»).", check: (app) => app.S.project.surfaces.some(s => currentScene(app.S.project).looks[s.id]?.source.type === "body") },
    { text: "Pulsa «Alinear automáticamente» (o ajusta las 4 esquinas a mano).", check: (app) => !!app.S.project.settings.interactive?.enabled },
    { text: "Añade una reacción: por ejemplo «Al entrar alguien → luces Fuego».", check: (app) => app.S.project.settings.tracking.rules.length > 0 },
  ] },
  { level: 10, title: "Show control", steps: [
    { text: "Abre «Escenas» y crea una segunda escena.", check: (app) => app.S.project.scenes.length >= 2 },
    { text: "Cambia la transición de una escena (corte, disolver, destello…).", check: (app) => app.S.project.scenes.some(s => s.transition && s.transition !== "fade") },
    { text: "Pasa a la escena siguiente (Enter o GO).", start: (app) => ({ id: app.S.project.sceneId }), check: (app, b) => app.S.project.sceneId !== b.id },
    { text: "Prueba el modo actuación (Show → Modo actuación). Sal con Mayús+Esc.", check: (app) => !!app.S.perfMode },
  ] },
];

const KEY = "lumamap:academy";
export class Academy {
  constructor(app) {
    this.app = app; this.cur = null; this.timer = 0; this.onChange = () => {};
    try { this.done = new Set(JSON.parse(localStorage.getItem(KEY) || "[]")); } catch { this.done = new Set(); }
  }
  get level() { return this.cur ? LEVELS.find(l => l.level === this.cur.level) : null; }
  get step() { return this.level?.steps[this.cur.i] || null; }
  start(level) {
    const L = LEVELS.find(l => l.level === level);
    if (!L) return;
    this.cur = { level, i: 0, base: null };
    this.enter();
    clearInterval(this.timer);
    // Comprobación ligera dos veces por segundo (solo mientras hay una lección abierta).
    this.timer = setInterval(() => this.check(), 500);
    this.onChange();
  }
  enter() {
    const st = this.step;
    this.cur.base = st?.start ? st.start(this.app) : null;
    if (st?.tab && this.app.S.tab !== st.tab) this.app.openTab(st.tab);
  }
  check() {
    const st = this.step;
    if (!st) return this.stop();
    let ok = false;
    try { ok = !!st.check(this.app, this.cur.base); } catch {}
    if (ok) this.next();
  }
  next() {
    if (!this.cur) return;
    this.cur.i++;
    if (this.cur.i >= this.level.steps.length) {
      this.done.add(this.cur.level);
      try { localStorage.setItem(KEY, JSON.stringify([...this.done])); } catch {}
      const lv = this.cur.level;
      this.stop();
      this.finished = lv;
    } else this.enter();
    this.onChange();
  }
  stop() { clearInterval(this.timer); this.timer = 0; this.cur = null; this.onChange(); }
}
