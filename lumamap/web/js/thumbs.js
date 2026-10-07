// web/js/thumbs.js — miniaturas reales de los generadores (render en GPU una vez).
import { Renderer } from "./renderer.js";
import { GENERATORS, createQuad, createLook, rectCorners, DEFAULT_FX } from "./model.js";

let cache = null;
export function genThumbs() {
  if (cache) return cache;
  cache = {};
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 160; canvas.height = 100;
    const r = new Renderer(canvas, { preserve: true });
    const s = createQuad({ corners: rectCorners(0, 0, 160, 100) });
    const view = { sx: 1, sy: 1, tx: 0, ty: 0 };
    const colors = { calib: ["#00e5ff", "#000000"], fire: ["#ffcc00", "#ff2d55"], stars: ["#ffffff", "#0a84ff"], bricks: ["#ff9500", "#1a0a00"] };
    for (const g of GENERATORS) {
      const [c1, c2] = colors[g.id] || ["#00e5ff", "#ff00aa"];
      const look = createLook({ type: "gen", gen: g.id, color: c1, color2: c2 });
      r.begin([0, 0, 0, 1]);
      r.drawSurface(s, look, { view, time: 2.3, alpha: 1, tex: null, levels: null, master: 1 });
      cache[g.id] = canvas.toDataURL("image/jpeg", 0.8);
    }
    r.gl.getExtension("WEBGL_lose_context")?.loseContext();
  } catch (e) { console.warn("miniaturas", e); }
  return cache;
}

/** Miniaturas del catálogo de animaciones (con su paleta y efecto), bajo demanda. */
const animCache = new Map();
let animR = null, animCanvas = null, animSurf = null;
export function animThumb(a) {
  if (animCache.has(a.id)) return animCache.get(a.id);
  try {
    if (!animR) {
      animCanvas = document.createElement("canvas");
      animCanvas.width = 160; animCanvas.height = 100;
      animR = new Renderer(animCanvas, { preserve: true });
      animSurf = createQuad({ corners: rectCorners(0, 0, 160, 100) });
    }
    const look = createLook({ type: "gen", gen: a.gen, color: a.color, color2: a.color2, speed: a.speed, scale: a.scale });
    if (a.fx) look.fx = { ...DEFAULT_FX(), ...a.fx, strobe: 0 };
    animR.begin([0, 0, 0, 1]);
    animR.drawSurface(animSurf, look, { view: { sx: 1, sy: 1, tx: 0, ty: 0 }, time: 2.3 * (a.speed || 1) + 0.5, alpha: 1, tex: null, levels: { beat: 0.6, bass: 0.7, mid: 0.5, high: 0.4, count: 3 }, master: 1 });
    animCache.set(a.id, animCanvas.toDataURL("image/jpeg", 0.75));
  } catch (e) { animCache.set(a.id, ""); }
  return animCache.get(a.id);
}
