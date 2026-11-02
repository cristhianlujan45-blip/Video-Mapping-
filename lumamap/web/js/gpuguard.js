// web/js/gpuguard.js
// Protección de la tarjeta gráfica. En Windows, si un dibujo tarda demasiado (unos 2 s), el
// sistema reinicia el controlador («el controlador de pantalla dejó de responder») y la página
// pierde su contexto WebGL. Antes la app recargaba y volvía a dibujar lo mismo: si era un shader
// pesado a 4K (loops 3D, plugins), la tarjeta volvía a caerse en bucle.
// Ahora:
//   · Cada caída sube un nivel de protección que baja la resolución de los shaders
//     (4K → 1440p → 1080p → 720p): lo pesado deja de tumbar la tarjeta.
//   · Un vigilante mira los fotogramas: si la tarjeta empieza a ir a tirones serios con shaders
//     en pantalla, baja un nivel ANTES de que Windows la reinicie.
//   · Si aun así se cae muchas veces seguidas, no recarga en bucle: enseña qué pasa y qué hacer.
// Se guarda en este equipo (lo leen también las ventanas de salida, del mismo origen).
const KEY = "lumamap:gpuguard";
export const GUARD_CAPS = [0, 1440, 1080, 720];    // nivel → resolución máxima de los shaders (0 = sin límite)
const WINDOW_MS = 5 * 60 * 1000;                    // caídas que cuentan para «en bucle»
export const LOOP_LOSSES = 4;

const store = globalThis.localStorage;
export function readGuard(st = store) {
  try { const g = JSON.parse(st?.getItem(KEY) || "null"); if (g && Number.isInteger(g.level)) return { level: Math.max(0, Math.min(3, g.level)), losses: Array.isArray(g.losses) ? g.losses.filter(Number.isFinite) : [], why: g.why || "" }; } catch {}
  return { level: 0, losses: [], why: "" };
}
export function writeGuard(g, st = store) { try { st?.setItem(KEY, JSON.stringify(g)); } catch {} }

let cache = null, cacheAt = 0;
/** Resolución máxima de los shaders que permite la protección (0 = sin límite). Se lee a menudo: con caché de 1 s. */
export function guardCap(now = Date.now()) {
  if (!cache || now - cacheAt > 1000) { cache = readGuard(); cacheAt = now; }
  return GUARD_CAPS[cache.level] || 0;
}
const fresh = () => { cache = null; };

/** Un reinicio del controlador tumba a la vez el editor y todas las salidas: lo que llega en este margen es la misma caída. */
export const SAME_LOSS_MS = 8000;
/** La tarjeta se cayó (contexto perdido / proceso de GPU caído). Devuelve { level, loop }. */
export function recordLoss(why = "", now = Date.now(), st = store) {
  const g = readGuard(st);
  const last = g.losses.at(-1);
  if (last != null && now - last >= 0 && now - last < SAME_LOSS_MS) return { level: g.level, loop: g.losses.length >= LOOP_LOSSES };
  g.losses = [...g.losses.filter(t => now - t < WINDOW_MS), now];
  g.level = Math.min(3, g.level + 1);
  g.why = String(why).slice(0, 160);
  writeGuard(g, st); fresh();
  return { level: g.level, loop: g.losses.length >= LOOP_LOSSES };
}
/** Bajar un nivel por tirones serios (sin caída). Devuelve el nivel nuevo o null si ya estaba al máximo. */
export function stepDown(why = "", st = store) {
  const g = readGuard(st);
  if (g.level >= 3) return null;
  g.level++; g.why = String(why).slice(0, 160);
  writeGuard(g, st); fresh();
  return g.level;
}
/** Quitar la protección (lo decide el usuario). */
export function resetGuard(st = store) { writeGuard({ level: 0, losses: [], why: "" }, st); fresh(); }

/**
 * Vigilante de tirones: cuenta los fotogramas muy lentos (más de `slowMs`) mientras hay shaders
 * en pantalla; con `need` de ellos en `spanMs` (no basta un tirón suelto, como al compilar un shader), baja un nivel (una vez cada `coolMs`).
 */
export class Watchdog {
  constructor({ slowMs = 400, need = 5, spanMs = 10000, coolMs = 20000, onStep = () => {} } = {}) {
    Object.assign(this, { slowMs, need, spanMs, coolMs, onStep, slow: [], last: 0, cooled: -Infinity, hidden: false, soft: false });
  }
  /** Cada fotograma: dt en ms y si hay shaders (lo pesado) en pantalla. */
  frame(now, heavy) {
    const dt = this.last ? now - this.last : 0;
    this.last = now;
    // Las pestañas ocultas o la ventana minimizada también dan saltos: no cuentan. Con dibujo por
    // software (soft) no hay controlador que reiniciar: tampoco.
    if (!heavy || this.hidden || this.soft || dt > 5000) return null;
    if (dt > this.slowMs) this.slow.push(now);
    this.slow = this.slow.filter(t => now - t < this.spanMs);
    if (this.slow.length >= this.need && now - this.cooled > this.coolMs) {
      this.slow = []; this.cooled = now;
      const level = stepDown(`tirones de la tarjeta gráfica (fotogramas de más de ${this.slowMs} ms con shaders)`);
      if (level != null) this.onStep(level);
      return level;
    }
    return null;
  }
}
