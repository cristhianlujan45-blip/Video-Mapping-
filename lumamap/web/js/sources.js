// web/js/sources.js
// Fuentes de contenido en tiempo de ejecución: videos, imágenes, GIF/WebP
// animados (ImageDecoder), cámara en vivo y textos. Lo usan el editor y la
// salida; cada ventana carga sus propios elementos desde IndexedDB.
import { getMedia } from "./store.js";

export const ACCEPT = "image/*,video/*,.gif,.webp,.mp4,.webm,.mov,.mkv,.m4v,.avi,.wmv,.flv,.mpg,.mpeg,.ts,.mts,.m2ts,.3gp,.mxf";

export function kindOf(mime, name = "") {
  if (/^video\//.test(mime) || /\.(mp4|webm|mov|mkv|m4v|avi|wmv|flv|mpe?g|ts|mts|m2ts|3gp|mxf|ogv)$/i.test(name)) return "video";
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
  if (/gif|webp/i.test(rec.mime || rec.blob.type)) {
    // Sin ImageDecoder: el navegador anima la imagen si está en el documento;
    // se sube a la GPU unas 15 veces por segundo.
    rt.kind = "anim";
    img.setAttribute("aria-hidden", "true");
    img.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0.01;pointer-events:none";
    document.body?.append(img);
    rt.frameKey = () => Math.floor(performance.now() / 66);
    rt.dispose = () => img.remove();
  }
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

// Varias cámaras a la vez: «default» sigue la preferencia trasera/frontal y
// cualquier otra clave es el deviceId de una cámara concreta (USB, capturadora,
// cámara del móvil…). Cada una se abre una sola vez por ventana.
const cams = new Map();      // clave -> { el, stream, source, frameKey, kind, key }
const opening = new Map();   // clave -> Promise
let facing = (() => { try { return localStorage.getItem("lumamap:camFacing") || "environment"; } catch { return "environment"; } })();
export const cameraFacing = () => facing;
/** Clave de la cámara que usa una fuente. */
export const camKey = (src) => (src && src.camId) || "default";
/** Cambia entre cámara trasera («environment») y frontal («user»). */
export function setCameraFacing(f) {
  facing = f === "user" ? "user" : "environment";
  try { localStorage.setItem("lumamap:camFacing", facing); } catch {}
  stopCamera("default");
}
/** Video de una cámara (se abre una vez y se comparte). */
export function getCamera(key = "default") {
  if (cams.has(key)) return Promise.resolve(cams.get(key));
  if (opening.has(key)) return opening.get(key);
  const p = (async () => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Este navegador no permite usar la cámara");
    const size = { width: { ideal: 1280 }, height: { ideal: 720 } };
    const video = key === "default" ? { facingMode: { ideal: facing }, ...size } : { deviceId: { exact: key }, ...size };
    const stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.setAttribute("playsinline", "");
    v.srcObject = stream;
    await v.play().catch(() => {});
    const cam = { el: v, stream, key, source: () => v, frameKey: () => v.currentTime, kind: "camera" };
    cams.set(key, cam);
    return cam;
  })().finally(() => opening.delete(key));
  opening.set(key, p);
  return p;
}
export function cameraIfReady(key = "default") { return cams.get(key) || null; }
/** Cierra una cámara (o todas si no se indica). */
export function stopCamera(key) {
  for (const [k, c] of [...cams]) {
    if (key && k !== key) continue;
    c.stream.getTracks().forEach(t => t.stop());
    cams.delete(k);
  }
}
/** Cámaras conectadas: [{ id, label }]. Los nombres aparecen tras dar permiso. */
export async function listCameras() {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter(d => d.kind === "videoinput" && d.deviceId).map((d, i) => ({ id: d.deviceId, label: d.label || `Cámara ${i + 1}` }));
  } catch { return []; }
}

/* ---------------- Texto ---------------- */

/** Animaciones de texto disponibles. */
export const TEXT_ANIMS = [
  ["none", "Fijo"], ["marquee", "Marquesina ←"], ["marqueeR", "Marquesina →"], ["credits", "Créditos ↑"],
  ["typewriter", "Máquina de escribir"], ["letters", "Letra a letra"], ["wave", "Ola"], ["bounce", "Rebote"],
  ["rainbow", "Arcoíris"], ["karaoke", "Karaoke"], ["pulse", "Pulso ♪"], ["blink", "Parpadeo"],
  ["neon", "Neón que tiembla"], ["glitch", "Glitch"], ["shake", "Temblor"], ["zoom", "Zoom"], ["fade", "Aparecer"],
];

const fract = (x) => x - Math.floor(x);
const hashf = (n) => fract(Math.sin(n * 127.1) * 43758.5453);

/**
 * Pinta un texto (centrado y ajustado al tamaño) en un canvas, animado en el
 * instante t (segundos). beat = golpe de la música (0..1) para «Pulso».
 */
export function renderText(canvas, src, t = 0, beat = 0) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  ctx.clearRect(0, 0, W, H);
  if (src.textBg && !/^#?[0-9a-f]{6}00$/i.test(src.textBg)) { ctx.fillStyle = src.textBg; ctx.fillRect(0, 0, W, H); }
  const anim = src.textAnim || "none";
  const sp = (src.textSpeed ?? 1);
  const tt = t * sp;
  const scroll = anim === "marquee" || anim === "marqueeR";
  const text = String(src.text || "");
  const lines = scroll ? [text.replace(/\n/g, "   ")] : text.split("\n");
  const font = src.font || "sans-serif";
  let size = H / Math.max(1, lines.length) * (scroll ? 0.7 : 0.8);
  ctx.font = `900 ${size}px ${font}`;
  if (!scroll) {
    const widest = Math.max(1, ...lines.map(l => ctx.measureText(l).width));
    size = Math.min(size, size * (W * 0.92) / widest);
    ctx.font = `900 ${size}px ${font}`;
  }
  ctx.textBaseline = "middle";
  const color = src.textColor || "#fff";
  const glow = src.textGlow || 0, outline = src.textOutline || 0;
  const total = text.replace(/\n/g, "").length || 1;
  const lh = size * 1.1;
  let y0 = H / 2 - (lines.length - 1) * lh / 2;

  // Transformaciones de todo el texto
  let alpha = 1, scale = 1, dx = 0, dy = 0;
  if (anim === "blink") alpha = fract(tt * 1.5) < 0.6 ? 1 : 0.05;
  if (anim === "pulse") scale = 1 + beat * 0.22 + Math.sin(tt * 4) * 0.03;
  if (anim === "zoom") { const k = fract(tt * 0.35); scale = 0.2 + k * 1.1; alpha = Math.min(1, k * 4) * Math.min(1, (1 - k) * 5); }
  if (anim === "fade") alpha = 0.5 + 0.5 * Math.sin(tt * 1.6);
  if (anim === "neon") alpha = hashf(Math.floor(tt * 14)) > 0.12 ? 1 : 0.25;
  if (anim === "shake") { dx = (hashf(Math.floor(tt * 30)) - 0.5) * size * 0.08; dy = (hashf(Math.floor(tt * 30) + 7) - 0.5) * size * 0.08; }
  if (anim === "credits") { const blockH = lines.length * lh; y0 = H + blockH / 2 - fract(tt * 0.12) * (H + blockH) - (lines.length - 1) * lh / 2; }
  ctx.globalAlpha = alpha;
  ctx.translate(W / 2 + dx, H / 2 + dy); ctx.scale(scale, scale); ctx.translate(-W / 2, -H / 2);

  const glowAmt = anim === "neon" ? Math.max(glow, 0.8) : glow;
  const draw = (str, x, y, fill) => {
    if (glowAmt > 0) { ctx.shadowColor = fill; ctx.shadowBlur = size * glowAmt * 0.6; }
    if (outline > 0) { ctx.lineWidth = size * outline * 0.12; ctx.strokeStyle = src.textOutlineColor || "#000"; ctx.lineJoin = "round"; ctx.strokeText(str, x, y); }
    ctx.fillStyle = fill;
    ctx.fillText(str, x, y);
    ctx.shadowBlur = 0;
  };

  if (scroll) {
    ctx.textAlign = "left";
    const tw = ctx.measureText(lines[0]).width + W * 0.3;
    let x = -fract(tt * 0.15 * W / tw) * tw;
    if (anim === "marqueeR") x = -tw - x;    // misma velocidad, sentido contrario
    for (let k = -1; k <= Math.ceil(W / tw) + 1; k++) draw(lines[0], x + k * tw, H / 2, color);
    return;
  }
  const perLetter = ["typewriter", "letters", "wave", "bounce", "rainbow", "karaoke", "glitch"].includes(anim);
  if (!perLetter) {
    ctx.textAlign = "center";
    lines.forEach((l, i) => draw(l, W / 2, y0 + i * lh, color));
    return;
  }
  // Letra a letra
  ctx.textAlign = "left";
  const cycle = Math.max(2, total * 0.12 + 2);           // segundos por ciclo (escribir + pausa)
  const shown = anim === "typewriter" || anim === "letters" ? fract(tt / cycle) * (total + total * 0.3) : total;
  let n = 0;
  lines.forEach((l, li) => {
    const lw = ctx.measureText(l).width;
    let x = W / 2 - lw / 2;
    const y = y0 + li * lh;
    for (const ch of l) {
      const cw = ctx.measureText(ch).width;
      let fill = color, yy = y, xx = x, a = 1;
      if (anim === "typewriter" && n >= shown) a = 0;
      if (anim === "letters") a = Math.max(0, Math.min(1, shown - n));
      if (anim === "wave") yy += Math.sin(tt * 4 - n * 0.5) * size * 0.15;
      if (anim === "bounce") yy -= Math.abs(Math.sin(tt * 3 - n * 0.35)) * size * 0.25;
      if (anim === "rainbow") fill = `hsl(${(n * 25 + tt * 120) % 360},100%,60%)`;
      if (anim === "karaoke") fill = n < fract(tt / cycle) * (total + 2) ? (src.textColor2 || "#ffcc00") : color;
      if (anim === "glitch" && hashf(n + Math.floor(tt * 12)) > 0.8) { xx += (hashf(n * 3 + Math.floor(tt * 12)) - 0.5) * size * 0.3; fill = hashf(n + 5) > 0.5 ? "#ff2d55" : "#00e5ff"; }
      if (a > 0) { ctx.globalAlpha = alpha * a; draw(ch, xx, yy, fill); }
      x += cw; n++;
    }
    // cursor de la máquina de escribir
    if (anim === "typewriter" && li === lines.length - 1 && fract(tt * 2) < 0.5) { ctx.globalAlpha = alpha; ctx.fillStyle = color; }
  });
}

export class TextCache {
  constructor() { this.map = new Map(); }
  get(key, src, aspect, t = 0, beat = 0) {
    const w = 1024, h = Math.max(64, Math.min(2048, Math.round(w / Math.max(0.1, aspect))));
    const animated = src.textAnim && src.textAnim !== "none";
    const sig = [src.text, src.font, src.textColor, src.textColor2, src.textBg, src.textGlow, src.textOutline, src.textOutlineColor, src.textAnim, w, h].join("|");
    let e = this.map.get(key);
    if (!e) {
      const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
      e = { canvas, sig: null };
      this.map.set(key, e);
    }
    if (e.sig !== sig || animated) {
      if (e.canvas.width !== w || e.canvas.height !== h) { e.canvas.width = w; e.canvas.height = h; }
      renderText(e.canvas, src, t, beat);
      e.sig = sig;
      e.version = (e.version || 0) + 1;
    }
    return e;
  }
}
