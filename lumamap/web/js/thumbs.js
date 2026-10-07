// web/js/thumbs.js — miniaturas reales de los generadores (render en GPU una vez).
import { Renderer } from "./renderer.js";
import { GENERATORS, createQuad, createLook, rectCorners } from "./model.js";

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
