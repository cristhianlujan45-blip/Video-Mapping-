// web/js/sources.js
// Fuentes de contenido en tiempo de ejecución: videos, imágenes, GIF/WebP
// animados (ImageDecoder), cámara en vivo y textos. Lo usan el editor y la
// salida; cada ventana carga sus propios elementos desde IndexedDB.
import { getMedia } from "./store.js";

export const ACCEPT = "image/*,video/*,.gif,.webp,.mp4,.webm,.mov,.mkv,.m4v";

export function kindOf(mime, name = "") {
  if (/^video\//.test(mime) || /\.(mp4|webm|mov|mkv|m4v)$/i.test(name)) return "video";
  if (/^image\//.test(mime) || /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(name)) return "image";
  return null;
}

/** Decodifica GIF/WebP animado a fotogramas (si el navegador tiene ImageDecoder). */
async function decodeAnimated(blob) {
  if (typeof ImageDecoder === "undefined") return null;
  try {
    const type = blob.type || "image/gif";
    if (!(await ImageDecoder.isTypeSupported(type))) return null;
    const dec = new ImageDecoder({ data: await blob.arrayBuffer(), type });
    await dec.tracks.ready;
    const track = dec.tracks.selectedTrack;
    if (!track || !track.animated || track.frameCount < 2) { dec.close(); return null; }
    const frames = [];
    let total = 0;
    const n = Math.min(track.frameCount, 400);
    for (let i = 0; i < n; i++) {
      const { image } = await dec.decode({ frameIndex: i });
      const dur = Math.max(20, (image.duration || 100000) / 1000);
      frames.push({ bmp: await createImageBitmap(image), start: total, dur });
      total += dur;
      image.close();
    }
    dec.close();
    return { frames, total };
  } catch { return null; }
}

/** Runtime de un medio: {id, kind, el, width, height, source(t), frameKey(t)} */
export async function createRuntime(rec) {
  const url = URL.createObjectURL(rec.blob);
  const kind = rec.kind || kindOf(rec.mime || rec.blob.type, rec.name);
  const rt = { id: rec.id, name: rec.name, kind, url, el: null, width: rec.width || 0, height: rec.height || 0 };
  if (kind === "video") {
    const v = document.createElement("video");
    v.muted = true; v.loop = true; v.playsInline = true; v.preload = "auto";
    v.setAttribute("playsinline", ""); v.crossOrigin = "anonymous";
    v.src = url;
    await new Promise((res) => {
      const done = () => res();
      v.addEventListener("loadeddata", done, { once: true });
      v.addEventListener("error", done, { once: true });
      setTimeout(done, 8000);
    });
    if (v.error) throw new Error(`No se puede reproducir "${rec.name}" en este dispositivo (códec no soportado). Convierte a MP4 H.264.`);
    rt.el = v;
    rt.width = v.videoWidth; rt.height = v.videoHeight; rt.duration = v.duration;
    rt.source = () => v;
    rt.frameKey = () => v.readyState >= 2 ? v.currentTime : -1;
    return rt;
  }
  const anim = /gif|webp|png|avif/i.test(rec.mime || rec.blob.type) ? await decodeAnimated(rec.blob) : null;
  if (anim) {
    rt.kind = "anim";
    rt.width = anim.frames[0].bmp.width; rt.height = anim.frames[0].bmp.height;
    const at = (t) => {
      const ms = ((t * 1000) % anim.total + anim.total) % anim.total;
      let lo = 0, hi = anim.frames.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (anim.frames[mid].start <= ms) lo = mid; else hi = mid - 1; }
      return lo;
    };
    rt.source = (t) => anim.frames[at(t)].bmp;
    rt.frameKey = (t) => at(t);
    rt.dispose = () => anim.frames.forEach(f => f.bmp.close && f.bmp.close());
    return rt;
  }
  const img = new Image();
  img.decoding = "async";
  await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error(`No se puede abrir la imagen "${rec.name}"`)); img.src = url; });
  rt.el = img;
  rt.width = img.naturalWidth || 1024; rt.height = img.naturalHeight || 1024;
  rt.source = () => img;
  rt.frameKey = () => 0;
  return rt;
}

/** Conjunto de medios cargados en esta ventana. */
export class MediaPool {
  constructor() {
    this.items = new Map();     // id -> runtime
    this.pending = new Map();   // id -> Promise
    this.playing = false;
    this.onChange = () => {};
  }
  get(id) { return this.items.get(id) || null; }
  /** Carga (una sola vez) el medio desde IndexedDB. */
  ensure(id) {
    if (!id || this.items.has(id)) return Promise.resolve(this.items.get(id) || null);
    if (this.pending.has(id)) return this.pending.get(id);
    const p = (async () => {
      const rec = await getMedia(id);
      if (!rec) return null;
      const rt = await createRuntime(rec);
      this.items.set(id, rt);
      if (rt.kind === "video" && this.playing) rt.el.play().catch(() => {});
      this.onChange();
      return rt;
    })().catch((e) => { console.warn(e); return null; }).finally(() => this.pending.delete(id));
    this.pending.set(id, p);
    return p;
  }
  add(rt) { this.items.set(rt.id, rt); if (rt.kind === "video" && this.playing) rt.el.play().catch(() => {}); }
  remove(id) {
    const rt = this.items.get(id);
    if (!rt) return;
    if (rt.el && rt.el.pause) { rt.el.pause(); rt.el.removeAttribute("src"); rt.el.load?.(); }
    rt.dispose?.();
    URL.revokeObjectURL(rt.url);
    this.items.delete(id);
  }
  videos() { return [...this.items.values()].filter(r => r.kind === "video"); }
  setPlaying(on) {
    this.playing = on;
    for (const r of this.videos()) { if (on) r.el.play().catch(() => {}); else r.el.pause(); }
  }
  restart() { for (const r of this.videos()) { try { r.el.currentTime = 0; } catch {} } }
  /** Volumen y velocidad: los decide el look que usa cada video. */
  applyLookAudio(looks, muted) {
    const vol = new Map(), rate = new Map();
    for (const l of looks) {
      if (l.source.type !== "media") continue;
      vol.set(l.source.mediaId, Math.max(vol.get(l.source.mediaId) || 0, l.volume || 0));
      rate.set(l.source.mediaId, l.rate || 1);
    }
    for (const r of this.videos()) {
      const v = muted ? 0 : (vol.get(r.id) || 0);
      r.el.muted = v <= 0;
      if (v > 0) r.el.volume = Math.min(1, v);
      const rr = rate.get(r.id) || 1;
      if (r.el.playbackRate !== rr) r.el.playbackRate = rr;
    }
  }
  clear() { for (const id of [...this.items.keys()]) this.remove(id); }
}

/* ---------------- Cámara ---------------- */

let camera = null;
/** Video de la cámara trasera (una sola instancia por ventana). */
export async function getCamera() {
  if (camera) return camera;
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Este navegador no permite usar la cámara");
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
  });
  const v = document.createElement("video");
  v.muted = true; v.playsInline = true; v.setAttribute("playsinline", "");
  v.srcObject = stream;
  await v.play().catch(() => {});
  camera = { el: v, stream, source: () => v, frameKey: () => v.currentTime, kind: "camera" };
  return camera;
}
export function cameraIfReady() { return camera; }
export function stopCamera() {
  if (!camera) return;
  camera.stream.getTracks().forEach(t => t.stop());
  camera = null;
}

/* ---------------- Texto ---------------- */

/** Pinta un texto centrado y ajustado al tamaño en un canvas. */
export function renderText(canvas, src) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (src.textBg && !/^#?[0-9a-f]{6}00$/i.test(src.textBg)) { ctx.fillStyle = src.textBg; ctx.fillRect(0, 0, W, H); }
  const lines = String(src.text || "").split("\n");
  const font = src.font || "sans-serif";
  let size = H / Math.max(1, lines.length) * 0.8;
  ctx.font = `900 ${size}px ${font}`;
  const widest = Math.max(1, ...lines.map(l => ctx.measureText(l).width));
  size = Math.min(size, size * (W * 0.92) / widest);
  ctx.font = `900 ${size}px ${font}`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = src.textColor || "#fff";
  const lh = size * 1.1, y0 = H / 2 - (lines.length - 1) * lh / 2;
  lines.forEach((l, i) => ctx.fillText(l, W / 2, y0 + i * lh));
}

export class TextCache {
  constructor() { this.map = new Map(); }
  get(key, src, aspect) {
    const w = 1024, h = Math.max(64, Math.min(2048, Math.round(w / Math.max(0.1, aspect))));
    const sig = [src.text, src.font, src.textColor, src.textBg, w, h].join("|");
    let e = this.map.get(key);
    if (!e) {
      const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
      e = { canvas, sig: null };
      this.map.set(key, e);
    }
    if (e.sig !== sig) {
      e.canvas.width = w; e.canvas.height = h;
      renderText(e.canvas, src);
      e.sig = sig;
      e.version = (e.version || 0) + 1;
    }
    return e;
  }
}
