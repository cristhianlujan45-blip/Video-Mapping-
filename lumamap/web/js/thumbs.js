// web/js/thumbs.js — miniaturas reales de los generadores (render en GPU una vez).
import { Renderer } from "./renderer.js";
import { GENERATORS, createQuad, createLook, rectCorners, DEFAULT_FX } from "./model.js";

/** Miniaturas del catálogo de animaciones (con su paleta y efecto), bajo demanda. */
const animCache = new Map();
let animR = null, animCanvas = null, animSurf = null;
/** Respuesta de una miniatura que aún no se puede dibujar (la pide de nuevo ui.lazyThumb). */
export const RETRY = "__retry__";
/**
 * Un solo renderizador (un contexto WebGL) para todas las miniaturas. Su sombreador es
 * muy grande: se compila en segundo plano (sin congelar la app) y mientras tanto las
 * miniaturas esperan. Devuelve true cuando ya se puede dibujar.
 */
function ensure() {
  if (!animR) {
    animCanvas = document.createElement("canvas");
    animCanvas.width = 160; animCanvas.height = 100;
    animR = new Renderer(animCanvas, { preserve: true, background: true });
    animSurf = createQuad({ corners: rectCorners(0, 0, 160, 100) });
  }
  return animR.poll ? animR.poll() : true;
}
/** Empieza a compilar las miniaturas en un momento de calma (antes de abrir el catálogo). */
export function warmThumbs() { try { ensure(); } catch {} }

/** Miniatura de un generador (se crea la primera vez que se pide; luego, de la caché). */
const genCache = new Map();
const GEN_COLORS = { calib: ["#00e5ff", "#000000"], fire: ["#ffcc00", "#ff2d55"], stars: ["#ffffff", "#0a84ff"], bricks: ["#ff9500", "#1a0a00"] };
export function genThumb(id) {
  if (genCache.has(id)) return genCache.get(id);
  try {
    if (!ensure()) return RETRY;
    const [c1, c2] = GEN_COLORS[id] || ["#00e5ff", "#ff00aa"];
    const look = createLook({ type: "gen", gen: id, color: c1, color2: c2 });
    animR.begin([0, 0, 0, 1]);
    animR.drawSurface(animSurf, look, { view: { sx: 1, sy: 1, tx: 0, ty: 0 }, time: 2.3, alpha: 1, tex: null, levels: null, master: 1 });
    genCache.set(id, animCanvas.toDataURL("image/jpeg", 0.8));
  } catch (e) { console.warn("miniaturas", e); genCache.set(id, ""); }
  return genCache.get(id);
}
/** Todas las miniaturas de generadores (compatibilidad). */
export function genThumbs() { return Object.fromEntries(GENERATORS.map(g => [g.id, genThumb(g.id)])); }

export function animThumb(a) {
  if (animCache.has(a.id)) return animCache.get(a.id);
  try {
    if (!ensure()) return RETRY;
    const look = createLook({ type: "gen", gen: a.gen, color: a.color, color2: a.color2, speed: a.speed, scale: a.scale });
    if (a.fx) look.fx = { ...DEFAULT_FX(), ...a.fx, strobe: 0 };
    animR.begin([0, 0, 0, 1]);
    animR.drawSurface(animSurf, look, { view: { sx: 1, sy: 1, tx: 0, ty: 0 }, time: 2.3 * (a.speed || 1) + 0.5, alpha: 1, tex: null, levels: { beat: 0.6, bass: 0.7, mid: 0.5, high: 0.4, count: 3 }, master: 1 });
    animCache.set(a.id, animCanvas.toDataURL("image/jpeg", 0.75));
  } catch (e) { animCache.set(a.id, ""); }
  return animCache.get(a.id);
}
