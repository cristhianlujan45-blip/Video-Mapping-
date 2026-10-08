// web/js/compose.js
// Compositor: resuelve el contenido de cada superficie (medios, cámara, texto,
// dibujo) y lo dibuja con el Renderer. Lo comparten el editor y la salida, así
// que lo que ves al editar es exactamente lo que sale por el proyector.
import { DrawingCache } from "./drawing.js";
import { TextCache, cameraIfReady, getCamera, camKey } from "./sources.js";
import { BodyCache } from "./body.js";
import { surfaceAspect } from "./math.js";

export class Compositor {
  constructor(renderer, pool) {
    this.r = renderer;
    this.pool = pool;
    this.drawings = new DrawingCache();
    this.texts = new TextCache();
    this.bodies = new BodyCache();
    this.drawVersion = new Map();
    this.cameraWanted = new Set();
  }

  textureFor(scene, s, look, o, k = "") {
    const src = look.source;
    switch (src.type) {
      case "media": {
        const rt = this.pool.get(src.mediaId);
        if (!rt) { this.pool.ensure(src.mediaId); return null; }
        return this.r.texture("m:" + rt.id, rt.source(o.time), rt.frameKey(o.time));
      }
      case "camera":
      case "body": {
        const ck = camKey(src);
        const cam = cameraIfReady(ck);
        if (!cam) {
          if (!this.cameraWanted.has(ck)) { this.cameraWanted.add(ck); getCamera(ck).catch(e => console.warn(e)).finally(() => setTimeout(() => this.cameraWanted.delete(ck), 3000)); }
          return null;
        }
        if (src.type === "body") {
          if (cam.el.readyState < 2) return null;
          const key = scene.id + ":" + s.id + k;
          const fx = this.bodies.get(key, cam.el, src, ck);
          return this.r.texture("b:" + key, fx.out, fx.version);
        }
        return this.r.texture("cam:" + ck, cam.el, cam.frameKey());
      }
      case "text": {
        const { aspect } = surfaceAspect(s);
        const e = this.texts.get(scene.id + ":" + s.id + k, src, aspect, o.time, o.levels?.beat || 0);
        return this.r.texture("t:" + scene.id + ":" + s.id + k, e.canvas, e.version);
      }
      case "drawing": {
        const sa = surfaceAspect(s);
        const h = Math.round(Math.max(256, Math.min(1440, sa.h)));
        const w = Math.round(Math.max(64, Math.min(2560, h * sa.aspect)));
        const key = scene.id + ":" + s.id + k;
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
   * o = { layers:[{scene, alpha}], time, levels, view, live, master, clear, solo, screen }
   */
  frame(project, o) {
    this.r.begin(o.clear || [0, 0, 0, 1]);
    if (o.blackout) return;
    for (const s of project.surfaces) {
      if (s.hidden) continue;
      if (o.solo && o.solo !== s.id) continue;
      if (o.screen && s.screen && s.screen !== o.screen) continue;   // sale por otra pantalla
      for (const { scene, alpha } of o.layers) {
        const look = scene.looks[s.id];
        if (!look || look.hidden || alpha <= 0) continue;
        // Mezcla en vivo: «siguiente» (B) se funde encima de lo actual (A).
        const m = look.next ? mixOf(look, o.time) : 0;
        const opts = { view: o.view, time: o.time, levels: o.levels, master: o.master, react: project.settings.react };
        if (m < 0.999) this.r.drawSurface(s, look, { ...opts, alpha, tex: this.textureFor(scene, s, look, o) });
        if (m > 0.001) {
          const b = deckB(look);
          this.r.drawSurface(s, b, { ...opts, alpha: alpha * m, tex: this.textureFor(scene, s, b, o, ":B") });
        }
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

/** Cuánto de «siguiente» se ve (0..1): fader manual o fundido automático en curso. */
export function mixOf(look, time) {
  const f = look.fade;
  if (f && f.dur > 0) return Math.max(0, Math.min(1, (time - f.t0) / f.dur));
  return Math.max(0, Math.min(1, look.mix || 0));
}

/** El «look» que se ve en la cubierta B (lo preparado para entrar). */
export function deckB(look) {
  const n = look.next;
  return { ...look, source: { ...look.source, ...n.source }, fx: n.fx || look.fx, fit: n.fit || look.fit, next: null };
}
