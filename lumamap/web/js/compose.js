// web/js/compose.js
// Compositor: resuelve el contenido de cada superficie (medios, cámara, texto,
// dibujo) y lo dibuja con el Renderer. Lo comparten el editor y la salida, así
// que lo que ves al editar es exactamente lo que sale por el proyector.
import { DrawingCache } from "./drawing.js";
import { TextCache, cameraIfReady, getCamera, camKey, cameraLost, offlineImage } from "./sources.js";
import { BodyCache } from "./body.js";
import { Model3DCache } from "./render3d.js";
import { surfaceAspect } from "./math.js";
import { ShaderCache } from "./isf.js";
import { getShader } from "./plugins.js";

export class Compositor {
  /** shared: Compositor de otra ventana (el editor) del que tomar las fuentes. */
  constructor(renderer, pool, shared = null) {
    this.r = renderer;
    this.pool = pool;
    this.shared = shared;
    this.drawings = new DrawingCache();
    this.texts = new TextCache();
    this.bodies = new BodyCache();
    this.models3d = new Model3DCache();
    this.shaders = new ShaderCache();
    this.drawVersion = new Map();
    this.cameraWanted = new Set();
  }

  /**
   * Fuente de imagen de una superficie: { id, el, key } (elemento de video,
   * cámara o lienzo + clave de fotograma). Las ventanas de salida abiertas por
   * el editor usan las fuentes del editor (ver `shared`): cada video y cada
   * cámara se decodifica una sola vez aunque haya varias salidas.
   */
  sourceFor(scene, s, look, o, k = "") {
    const src = look.source;
    switch (src.type) {
      case "media": {
        const rt = this.pool.get(src.mediaId);
        if (!rt) { this.pool.ensure(src.mediaId); return null; }
        // «Quitar el fondo» de un video de una persona (holograma tipo Tupac): la IA de cuerpo
        // recorta a la persona fotograma a fotograma y el resto queda en negro puro.
        if (src.cutout && rt.kind === "video") {
          const el = rt.source(o.time);
          if (!el || el.readyState < 2) return null;
          const key = scene.id + ":" + s.id + k;
          const fx = this.bodies.get(key, el, { bodyMode: "persona", bodySens: src.cutoutSens ?? 0.5, bodyGlow: src.cutoutGlow || 0, media: true }, "media:" + rt.id);
          return { id: "b:" + key, el: fx.out, key: fx.version };
        }
        return { id: "m:" + rt.id, el: rt.source(o.time), key: rt.frameKey(o.time) };
      }
      case "projector3d": {
        // Lo que ve un proyector del espacio 3D (lo pinta three3d.js cada fotograma).
        const pv = globalThis.__lumaProjectorView?.(src.projectorId);
        return pv ? { id: "p3:" + src.projectorId, el: pv.el, key: pv.key } : null;
      }
      case "camera":
      case "body": {
        const ck = camKey(src);
        const cam = cameraIfReady(ck);
        if (!cam) {
          if (!this.cameraWanted.has(ck)) { this.cameraWanted.add(ck); getCamera(ck).catch(e => console.warn(e)).finally(() => setTimeout(() => this.cameraWanted.delete(ck), 3000)); }
          // Nunca se congela: si la cámara se perdió se ve el aviso hasta que vuelva.
          return cameraLost(ck) ? { id: "offline", el: offlineImage(), key: 1 } : null;
        }
        if (src.type === "body") {
          if (cam.el.readyState < 2) return null;
          const key = scene.id + ":" + s.id + k;
          const fx = this.bodies.get(key, cam.el, src, ck);
          return { id: "b:" + key, el: fx.out, key: fx.version };
        }
        return { id: "cam:" + ck, el: cam.el, key: cam.frameKey() };
      }
      case "model3d": {
        // Objeto 3D creado con «Crear objeto 3D» (three.js; se carga la primera vez).
        const { aspect } = surfaceAspect(s);
        const key = scene.id + ":" + s.id + k;
        const e = this.models3d.get(key, src, aspect, o.time);
        return e ? { id: "o3:" + key, el: e.canvas, key: e.version } : null;
      }
      case "shader": {
        // Shader ISF de un plugin: se dibuja a la medida de la superficie (como mucho 1280×720).
        const sh = getShader(src.shaderId);
        if (!sh) return null;
        const sa = surfaceAspect(s);
        const hgt = Math.round(Math.max(144, Math.min(720, sa.h || 540)));
        const wid = Math.round(Math.max(64, Math.min(1280, hgt * sa.aspect)));
        const key = scene.id + ":" + s.id + k;
        const e = this.shaders.draw(key, sh.id, sh.isf, src.shaderParams || {}, { width: wid, height: hgt, time: o.time * (src.speed ?? 1) });
        return e ? { id: "sh:" + key, el: e.canvas, key: e.version } : null;
      }
      case "text": {
        const { aspect } = surfaceAspect(s);
        const key = scene.id + ":" + s.id + k;
        const e = this.texts.get(key, src, aspect, o.time, o.levels?.beat || 0);
        return { id: "t:" + key, el: e.canvas, key: e.version };
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
        return { id: "d:" + key, el: canvas, key: ver };
      }
      default: return null;
    }
  }

  /** Igual que sourceFor, pero memoriza el resultado durante un fotograma (varias salidas, un solo repintado). */
  sharedSource(scene, s, look, o, k = "") {
    if (this._memoF !== this.frameNo) { this._memoF = this.frameNo; this._memo = new Map(); }
    const mk = scene.id + ":" + s.id + k + ":" + look.source.type;
    if (this._memo.has(mk)) return this._memo.get(mk);
    const r = this.sourceFor(scene, s, look, o, k);
    this._memo.set(mk, r);
    return r;
  }

  textureFor(scene, s, look, o, k = "") {
    const f = this.shared ? this.shared.sharedSource(scene, s, look, o, k) : this.sharedSource(scene, s, look, o, k);
    return f ? this.r.texture(f.id, f.el, f.key) : null;
  }

  /**
   * Dibuja un fotograma.
   * o = { layers:[{scene, alpha}], time, levels, view, live, master, clear, solo, screen }
   */
  frame(project, o) {
    if (!this.shared) this.frameNo = (this.frameNo || 0) + 1;   // las salidas compartidas siguen el fotograma del editor
    this.r.begin(o.clear || [0, 0, 0, 1]);
    if (o.blackout) return;
    for (const s of project.surfaces) {
      if (s.hidden) continue;
      if (o.solo && o.solo !== s.id) continue;
      if (o.screen && s.screen && s.screen !== o.screen) continue;   // sale por otra pantalla
      // Rectángulo de la salida en el lienzo (para cortinillas e iris), y desde abajo como gl_FragCoord.
      const ch = this.r.canvas?.height || 0, v = o.view || { sx: 1, sy: 1, tx: 0, ty: 0 };
      const fw = project.width * v.sx, fh = project.height * v.sy;
      const frameRect = [v.tx, ch - v.ty - fh, fw, fh];
      for (const { scene, alpha, tr } of o.layers) {
        const look = scene.looks[s.id];
        if (!look || look.hidden || alpha <= 0) continue;
        // Mezcla en vivo: «siguiente» (B) se funde encima de lo actual (A).
        const m = look.next ? mixOf(look, o.time) : 0;
        const opts = { view: o.view, time: o.time, levels: o.levels, master: o.master, react: project.settings.react, tr, frameRect };
        if (m < 0.999) this.r.drawSurface(s, look, { ...opts, alpha, tex: this.textureFor(scene, s, look, o) });
        if (m > 0.001) {
          const b = deckB(look);
          this.r.drawSurface(s, b, { ...opts, alpha: alpha * m, tex: this.textureFor(scene, s, b, o, ":B") });
        }
      }
    }
  }
}

/**
 * Contenido de las caras 3D en un atlas: cada cara (superficie virtual) se dibuja
 * con su look de la escena actual dentro de su casilla. tiles: [{ face, x, y, w, h }]
 * (píxeles del lienzo, y desde arriba).
 */
Compositor.prototype.drawFaces = function (project, o, tiles) {
  if (!this.shared) this.frameNo = (this.frameNo || 0) + 1;
  const gl = this.r.gl, H = this.r.canvas.height;
  this.r.begin([0, 0, 0, 1]);
  gl.enable(gl.SCISSOR_TEST);
  for (const t of tiles) {
    const f = t.face;
    const fw = f.points[f.points.length - 1].x, fh = f.points[f.points.length - 1].y;
    const view = { sx: t.w / fw, sy: t.h / fh, tx: t.x, ty: t.y };
    gl.scissor(t.x, H - t.y - t.h, t.w, t.h);
    for (const { scene, alpha, tr } of o.layers) {
      const look = scene.looks[f.id];
      if (!look || look.hidden || alpha <= 0) continue;
      const m = look.next ? mixOf(look, o.time) : 0;
      const opts = { view, time: o.time, levels: o.levels, master: o.master, react: project.settings.react, tr, frameRect: [t.x, H - t.y - t.h, t.w, t.h] };
      if (m < 0.999) this.r.drawSurface(f, look, { ...opts, alpha, tex: this.textureFor(scene, f, look, o) });
      if (m > 0.001) { const b = deckB(look); this.r.drawSurface(f, b, { ...opts, alpha: alpha * m, tex: this.textureFor(scene, f, b, o, ":B") }); }
    }
  }
  gl.disable(gl.SCISSOR_TEST);
};

/** Capas a dibujar según la transición en curso (fundido o corte). */
/** Transiciones de escena disponibles. */
export const TRANSITIONS = [["fade", "Fundido"], ["cut", "Corte"], ["dissolve", "Disolver"], ["wipe", "Cortinilla →"], ["wipeV", "Cortinilla ↓"], ["iris", "Iris"], ["flash", "Destello"], ["glitch", "Glitch"]];

export function sceneLayers(project, tr, now) {
  const cur = project.scenes.find(s => s.id === project.sceneId) || project.scenes[0];
  if (!tr) return [{ scene: cur, alpha: 1 }];
  const from = project.scenes.find(s => s.id === tr.fromId);
  const p = Math.min(1, (now - tr.start) / Math.max(1, tr.dur));
  if (!from || p >= 1) return [{ scene: cur, alpha: 1 }];
  const e = p * p * (3 - 2 * p);
  const mode = tr.mode || "fade";
  // Fundido, destello y glitch mezclan por opacidad; disolver, cortinillas e iris por zonas (en el shader).
  if (mode === "fade" || mode === "flash" || mode === "glitch")
    return [{ scene: from, alpha: 1 - e, tr: { mode, p, role: 0 } }, { scene: cur, alpha: e, tr: { mode, p, role: 1 } }];
  return [{ scene: from, alpha: 1, tr: { mode, p: e, role: 0 } }, { scene: cur, alpha: 1, tr: { mode, p: e, role: 1 } }];
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
