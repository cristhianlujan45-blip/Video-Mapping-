// web/js/compose.js
// Compositor: resuelve el contenido de cada superficie (medios, cámara, texto,
// dibujo) y lo dibuja con el Renderer. Lo comparten el editor y la salida, así
// que lo que ves al editar es exactamente lo que sale por el proyector.
import { DrawingCache } from "./drawing.js";
import { TextCache, cameraIfReady, getCamera } from "./sources.js";
import { surfaceAspect } from "./math.js";

export class Compositor {
  constructor(renderer, pool) {
    this.r = renderer;
    this.pool = pool;
    this.drawings = new DrawingCache();
    this.texts = new TextCache();
    this.drawVersion = new Map();
    this.cameraWanted = false;
  }

  textureFor(scene, s, look, o) {
    const src = look.source;
    switch (src.type) {
      case "media": {
        const rt = this.pool.get(src.mediaId);
        if (!rt) { this.pool.ensure(src.mediaId); return null; }
        return this.r.texture("m:" + rt.id, rt.source(o.time), rt.frameKey(o.time));
      }
      case "camera": {
        const cam = cameraIfReady();
        if (!cam) {
          if (!this.cameraWanted) { this.cameraWanted = true; getCamera().catch(e => console.warn(e)).finally(() => { this.cameraWanted = false; }); }
          return null;
        }
        return this.r.texture("cam", cam.el, cam.frameKey());
      }
      case "text": {
        const { aspect } = surfaceAspect(s);
        const e = this.texts.get(scene.id + ":" + s.id, src, aspect);
        return this.r.texture("t:" + scene.id + ":" + s.id, e.canvas, e.version);
      }
      case "drawing": {
        const sa = surfaceAspect(s);
        const h = Math.round(Math.max(256, Math.min(1440, sa.h)));
        const w = Math.round(Math.max(64, Math.min(2560, h * sa.aspect)));
        const key = scene.id + ":" + s.id;
        const live = o.live && o.live.surfaceId === s.id && o.live.sceneId === scene.id ? o.live.stroke : null;
        const { canvas, changed } = this.drawings.get(key, src.strokes || [], w, h, o.time, live, o.levels?.beat || 0);
        let ver = this.drawVersion.get(key) || 0;
        if (changed) this.drawVersion.set(key, ++ver);
        return this.r.texture("d:" + key, canvas, ver);
      }
      default: return null;
    }
  }

  /**
   * Dibuja un fotograma.
   * o = { layers:[{scene, alpha}], time, levels, view, live, master, clear, solo }
   */
  frame(project, o) {
    this.r.begin(o.clear || [0, 0, 0, 1]);
    if (o.blackout) return;
    for (const s of project.surfaces) {
      if (s.hidden) continue;
      if (o.solo && o.solo !== s.id) continue;
      for (const { scene, alpha } of o.layers) {
        const look = scene.looks[s.id];
        if (!look || look.hidden || alpha <= 0) continue;
        const tex = this.textureFor(scene, s, look, o);
        this.r.drawSurface(s, look, { view: o.view, time: o.time, alpha, tex, levels: o.levels, master: o.master, react: project.settings.react });
      }
    }
  }
}

/** Capas a dibujar según la transición en curso (fundido o corte). */
export function sceneLayers(project, tr, now) {
  const cur = project.scenes.find(s => s.id === project.sceneId) || project.scenes[0];
  if (!tr) return [{ scene: cur, alpha: 1 }];
  const from = project.scenes.find(s => s.id === tr.fromId);
  const p = Math.min(1, (now - tr.start) / Math.max(1, tr.dur));
  if (!from || p >= 1) return [{ scene: cur, alpha: 1 }];
  const e = p * p * (3 - 2 * p);
  return [{ scene: from, alpha: 1 - e }, { scene: cur, alpha: e }];
}
