// web/js/body.js
// Cuerpo en animación / proyección interactiva (con cualquier cámara o sensor):
// detecta la silueta de las personas con IA (MediaPipe «Selfie Segmenter»,
// incluido en la app: funciona sin internet) y la convierte en una máscara
// animada: silueta rellena con una animación, contorno de neón, estela de
// movimiento, sombra (la animación alrededor de la persona) o la persona sin
// fondo. Si la IA no puede cargar, se usa la detección de movimiento
// (diferencia entre fotogramas), que funciona en cualquier equipo.

import { NEW_MODES, NEW_MODE_IDS, InteractiveFX, drawAligned, camToProj, calibOf } from "./interactive.js";
import { PRO_MODES, PRO_MODE_IDS, ProFX } from "./fx-pro.js";

export const BODY_MODES = [
  ["silueta", "Silueta animada"], ["contorno", "Contorno neón"], ["estela", "Estela de movimiento"],
  ["sombra", "Sombra (animación alrededor)"], ["persona", "Persona sin fondo"], ["movimiento", "Solo movimiento"],
  ["esqueleto", "Esqueleto"], ["particulas", "Partículas (brazos y pies)"], ["fuego", "Fuego"], ["humo", "Humo"],
  ["lineas", "Líneas entre personas"], ["geometria", "Geometría"], ...NEW_MODES, ...PRO_MODES,
];
/** Alineación cámara ↔ proyección del proyecto abierto (o null). */
const calib = () => { const P = globalThis.__lumaApp?.S.project; return P ? calibOf(P) : null; };
/** Modos que usan el tracking de pose (cuerpo y articulaciones) en lugar de la silueta. */
export const POSE_MODES = new Set(["esqueleto", "particulas", "fuego", "humo", "lineas", "geometria"]);
const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [27, 31], [28, 32], [0, 11], [0, 12]];
const TRIS = [[0, 11, 12], [11, 12, 23], [12, 23, 24], [11, 13, 23], [12, 14, 24], [13, 15, 11], [14, 16, 12], [23, 25, 24], [24, 26, 23], [25, 27, 23], [26, 28, 24]];

const BASE = new URL("../vendor/mediapipe/", import.meta.url).href;
const canvas = (w = 2, h = 2) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;

// Si la tarjeta gráfica no deja leer la silueta, se recuerda para todos los detectores
// (cámara y cada video): los siguientes empiezan directamente en la CPU.
let gpuMaskBroken = false;

/** Detector compartido (uno por ventana): mantiene la máscara de la persona al día. */
class BodyTracker {
  constructor() {
    this.seg = null; this.pose = null; this.people = 0; this.missed = 0; this.emptyMasks = 0; this.forceCPU = gpuMaskBroken;
    this.loading = null;
    this.status = "off";          // off | loading | ai | motion | depth | error
    this.mask = canvas();         // máscara IA: blanco con alfa = persona
    this.motion = canvas(160, 90);// máscara de movimiento
    this.prev = null; this.acc = null;
    this.lastVideoTime = -1; this.lastTs = 0; this.version = 0;
    this.sens = 0.5;
    this.keepFrame = false;        // videos (holograma): guardar el fotograma que analiza la IA
    this.frame = null;
    this.depthOn = false;          // modo sensor (profundidad / infrarrojos): fondo aprendido
    this.dmask = canvas(160, 90); this.bg = null; this.bgLearn = 0; this.dacc = null;
    this.onStatus = () => {};
  }

  /**
   * Modo sensor para cámaras de profundidad e infrarrojas: aprende la zona vacía
   * y marca lo que está más cerca o más lejos que ese fondo. Así ve a la gente
   * aunque esté quieta o a oscuras, y la luz del proyector no le afecta.
   * Sirve con cualquier codificación de profundidad (cerca claro u oscuro).
   */
  setDepth(on) {
    on = !!on;
    if (on === this.depthOn) return;
    this.depthOn = on; this.bg = null;
    this.setStatus(on ? "depth" : this.seg || this.pose ? "ai" : this.loading ? "motion" : "off");
  }
  /** Vuelve a aprender el fondo (con la zona vacía). */
  learnBackground() { this.bg = null; }

  setStatus(s) { if (this.status !== s) { this.status = s; this.onStatus(s); } }

  /**
   * Carga la IA (una vez). Primero el modelo de CUERPO ENTERO (pose con silueta de
   * hasta 4 personas: ve a la gente de pies a cabeza a varios metros, como en una
   * proyección); si no puede, el de selfie (persona cerca); si tampoco, movimiento.
   */
  load() {
    if (this.loading) return this.loading;
    this.setStatus("loading");
    this.loading = (async () => {
      const { PoseLandmarker, ImageSegmenter } = await import(BASE + "vision_bundle.js");
      const fileset = { wasmLoaderPath: BASE + "wasm/vision_wasm_internal.js", wasmBinaryPath: BASE + "wasm/vision_wasm_internal.wasm" };
      const tryBoth = async (make) => { if (this.forceCPU) return make("CPU"); try { return await make("GPU"); } catch (e) { console.warn("IA en GPU no disponible, se usa CPU", e); return make("CPU"); } };
      try {
        this.pose = await tryBoth((delegate) => PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: BASE + "pose_landmarker_lite.task", delegate }, runningMode: "VIDEO",
          numPoses: 4, outputSegmentationMasks: true, minPoseDetectionConfidence: 0.3, minPosePresenceConfidence: 0.3, minTrackingConfidence: 0.3,
        }));
      } catch (e) {
        console.warn("Silueta de cuerpo entero no disponible: se usa la de selfie", e);
        this.seg = await tryBoth((delegate) => ImageSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: BASE + "selfie_segmenter.tflite", delegate }, runningMode: "VIDEO", outputConfidenceMasks: true, outputCategoryMask: false,
        }));
      }
      this.setStatus(this.depthOn ? "depth" : "ai");
    })().catch((e) => { console.warn("Detección de cuerpo con IA no disponible: se usa el movimiento", e); this.setStatus("motion"); });
    return this.loading;
  }

  /** Fuera del callback de la IA (cerrarla dentro la rompería): se cierra y se carga en CPU. */
  switchToCPU() {
    console.warn("La silueta llega vacía desde la GPU: la IA de cuerpo pasa a la CPU");
    this.forceCPU = true;
    const old = [this.pose, this.seg];
    this.pose = null; this.seg = null; this.loading = null;
    for (const t of old) { try { t?.close(); } catch {} }
    this.load();
  }

  /**
   * Imagen para la IA: pequeña (rápida) y con la luz corregida. En una sala oscura
   * la webcam ve casi negro: se aclara y se sube el contraste según el brillo medio.
   */
  prepare(video, sw) {
    const sh = Math.max(64, Math.round(sw * video.videoHeight / video.videoWidth));
    if (!this.small) this.small = canvas(sw, sh);
    if (this.small.width !== sw || this.small.height !== sh) { this.small.width = sw; this.small.height = sh; }
    const ctx = this.small.getContext("2d", { willReadFrequently: true });
    ctx.filter = this.light || "none";
    ctx.drawImage(video, 0, 0, sw, sh);
    ctx.filter = "none";
    // Brillo medio cada ~½ s (sobre una muestra de 16×9 píxeles): ajusta la corrección.
    if (!this.lightAt || performance.now() - this.lightAt > 500) {
      this.lightAt = performance.now();
      if (!this.probe) this.probe = canvas(16, 9);
      const pc = this.probe.getContext("2d", { willReadFrequently: true });
      pc.drawImage(video, 0, 0, 16, 9);
      const d = pc.getImageData(0, 0, 16, 9).data;
      let sum = 0; for (let i = 0; i < d.length; i += 4) sum += d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
      const mean = sum / (d.length / 4) / 255;
      const gain = Math.min(2.6, Math.max(1, 0.42 / Math.max(0.05, mean)));
      this.light = gain > 1.08 ? `brightness(${gain.toFixed(2)}) contrast(${(1 + (gain - 1) * 0.25).toFixed(2)})` : "none";
    }
    return this.small;
  }

  /** Procesa el fotograma de la cámara si es nuevo (máx. ~30 por segundo). */
  update(video, useAI) {
    if (!video || video.readyState < 2 || !video.videoWidth) return false;
    const now = performance.now();
    // La IA nunca se come la app: si tarda mucho (equipo lento, sin GPU) analiza menos
    // fotogramas por segundo, de modo que no use más de ~40 % del tiempo.
    const gap = Math.max(30, (this.aiMs || 0) * 2.5);
    if (video.currentTime === this.lastVideoTime || now - this.lastTs < gap) return false;
    this.lastVideoTime = video.currentTime;
    // Copia del fotograma que se analiza: así la persona y su silueta coinciden siempre.
    if (this.keepFrame) {
      const fw = Math.min(960, video.videoWidth), fh = Math.max(1, Math.round(fw * video.videoHeight / video.videoWidth));
      if (!this.frame) this.frame = canvas(fw, fh);
      if (this.frame.width !== fw || this.frame.height !== fh) { this.frame.width = fw; this.frame.height = fh; }
      this.frame.getContext("2d").drawImage(video, 0, 0, fw, fh);
    }
    const ts = Math.max(this.lastTs + 1, now);
    this.lastTs = ts;
    if (this.depthOn) { this.updateDepth(video); this.version++; return true; }
    if (useAI && this.status === "off") this.load();
    if (useAI && this.pose) {
      const t0 = performance.now();
      try {
        // Cuerpo entero a 320 px de ancho: ve personas lejos sin cargar el equipo.
        const img = this.prepare(video, this.forceCPU ? 256 : 320);   // en CPU, algo más pequeña: igual de útil y más ligera
        this.pose.detectForVideo(img, ts, (r) => {
          const ms = r.segmentationMasks || [];
          this.people = ms.length;
          if (ms.length) {
            const w = ms[0].width, h = ms[0].height, n = w * h;
            if (!this.merged || this.merged.length !== n) this.merged = new Float32Array(n);
            const out = this.merged; out.fill(0);
            let mx = 0;
            for (const m of ms) { const a = m.getAsFloat32Array(); for (let i = 0; i < n; i++) if (a[i] > out[i]) { out[i] = a[i]; if (a[i] > mx) mx = a[i]; } }
            // Algunas tarjetas no dejan leer la silueta desde la GPU (llega vacía aunque haya
            // gente): tras unos fotogramas así, la IA pasa sola a la CPU, que siempre funciona.
            if (mx === 0 && !this.forceCPU && ++this.emptyMasks > 8) { this.forceCPU = gpuMaskBroken = true; setTimeout(() => this.switchToCPU(), 0); return; }
            if (mx > 0) this.emptyMasks = 0;
            this.missed = 0;
            this.writeMask(out, w, h);
          } else if (++this.missed > 4) this.writeMask(null, this.mask.width, this.mask.height);   // se mantiene ~0,15 s si la IA pierde un fotograma
        });
        this.aiMs = (this.aiMs || 0) * 0.8 + (performance.now() - t0) * 0.2;
        this.version++;
        return true;
      } catch (e) { console.warn(e); this.pose = null; this.setStatus("motion"); }
    }
    if (useAI && this.seg) {
      const t0 = performance.now();
      try {
        const img = this.prepare(video, 256);
        this.seg.segmentForVideo(img, ts, (r) => {
          const m = r.confidenceMasks && r.confidenceMasks[0];
          if (m) this.writeMask(m.getAsFloat32Array(), m.width, m.height);
        });
        this.aiMs = (this.aiMs || 0) * 0.8 + (performance.now() - t0) * 0.2;
        this.version++;
        return true;
      } catch (e) { console.warn(e); this.seg = null; this.setStatus("motion"); }
    }
    this.updateMotion(video);
    this.version++;
    return true;
  }

  /** Máscara IA → canvas (blanco con alfa). Suavizada en el tiempo: no parpadea. arr null = vaciar poco a poco. */
  writeMask(arr, w, h) {
    if (w < 2 || h < 2) return;
    if (this.mask.width !== w || this.mask.height !== h) { this.mask.width = w; this.mask.height = h; this.img = null; this.prevMask = null; }
    const ctx = this.mask.getContext("2d");
    if (!this.img) this.img = ctx.createImageData(w, h);
    const d = this.img.data, n = w * h;
    if (!this.prevMask || this.prevMask.length !== n) this.prevMask = new Float32Array(n);
    const pm = this.prevMask;
    // Sensibilidad: umbral de confianza (más alto = solo lo muy seguro).
    const lo = 0.1 + (1 - this.sens) * 0.45, span = 0.25;
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const v = arr ? clamp01((arr[i] - lo) / span) : 0;
      // Sube rápido (aparece al momento) y baja algo más despacio (sin parpadeos).
      const a = pm[i] = v > pm[i] ? pm[i] + (v - pm[i]) * 0.75 : pm[i] + (v - pm[i]) * 0.4;
      d[j] = d[j + 1] = d[j + 2] = 255;
      d[j + 3] = a * 255;
    }
    ctx.putImageData(this.img, 0, 0);
  }

  /** Respaldo sin IA: lo que se mueve (diferencia entre fotogramas, con memoria). */
  updateMotion(video) {
    const w = 160, h = Math.max(48, Math.round(160 * video.videoHeight / video.videoWidth));
    const c = this.motion;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; this.prev = null; }
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.globalCompositeOperation = "copy";
    ctx.drawImage(video, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h);
    const d = px.data, n = w * h;
    if (!this.prev || this.prev.length !== n) { this.prev = new Float32Array(n); this.acc = new Float32Array(n); }
    const thr = 10 + (1 - this.sens) * 40;
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const l = d[j] * 0.3 + d[j + 1] * 0.59 + d[j + 2] * 0.11;
      const diff = Math.abs(l - this.prev[i]);
      this.prev[i] = l;
      this.acc[i] = Math.max(this.acc[i] * 0.86, diff > thr ? 1 : 0);
      d[j] = d[j + 1] = d[j + 2] = 255;
      d[j + 3] = this.acc[i] * 255;
    }
    ctx.putImageData(px, 0, 0);
  }

  updateDepth(video) {
    const w = 160, h = Math.max(48, Math.round(160 * video.videoHeight / video.videoWidth));
    const c = this.dmask;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; this.bg = null; }
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.globalCompositeOperation = "copy";
    ctx.drawImage(video, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h), d = px.data, n = w * h;
    if (!this.bg || this.bg.length !== n) { this.bg = new Float32Array(n).fill(-1); this.dacc = new Float32Array(n); this.bgLearn = 30; }
    const bg = this.bg, acc = this.dacc, learning = this.bgLearn > 0;
    const thr = 4 + (1 - this.sens) * 30;
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const l = d[j] * 0.3 + d[j + 1] * 0.59 + d[j + 2] * 0.11;
      let on = 0;
      if (learning) bg[i] = bg[i] < 0 ? l : bg[i] * 0.8 + l * 0.2;
      else {
        // 0 = el sensor no midió ese punto: no cuenta.
        on = l > 2 && bg[i] > 2 && Math.abs(l - bg[i]) > thr ? 1 : 0;
        // El fondo se adapta muy despacio donde no hay nadie (algo que se movió para siempre).
        if (!on) bg[i] = bg[i] * 0.995 + l * 0.005;
      }
      acc[i] = Math.max(acc[i] * 0.7, on);
      d[j] = d[j + 1] = d[j + 2] = 255;
      d[j + 3] = acc[i] * 255;
    }
    if (learning) this.bgLearn--;
    ctx.putImageData(px, 0, 0);
  }

  /** Máscara a usar: sensor, IA si está lista (y no se pidió movimiento), si no, movimiento. */
  source(motionOnly) { return this.depthOn ? this.dmask : !motionOnly && this.status === "ai" && this.mask.width > 2 ? this.mask : this.motion; }
}

const trackers = new Map();
/** Detector de una cámara (uno por cámara y ventana). */
export function bodyTracker(cam = "default") {
  let t = trackers.get(cam);
  if (!t) trackers.set(cam, t = new BodyTracker());
  return t;
}

/**
 * Efecto por superficie: pinta en un canvas la máscara animable.
 * Canales: R = relleno (animación), G = contorno, B = estela. En «persona» es
 * directamente la imagen de la cámara sin fondo.
 */
export class BodyFX {
  constructor() {
    this.out = canvas(); this.trail = canvas(); this.tmp = canvas(); this.m = canvas();
    this.version = 0; this.lastSrc = -1;
  }

  render(video, src, cam = "default") {
    const mode = src.bodyMode || "silueta";
    if (POSE_MODES.has(mode)) return this.renderPose(video, src, cam, mode);
    if (NEW_MODE_IDS.has(mode) || PRO_MODE_IDS.has(mode)) return this.renderInteractive(video, src, cam, mode);
    const T = bodyTracker(cam);
    T.sens = src.bodySens ?? 0.5;
    T.keepFrame = !!src.media;
    // Un video (src.media): sin la alineación cámara↔proyección ni el modo sensor.
    T.setDepth(src.media ? false : calib()?.depth);
    T.update(video, mode !== "movimiento");
    if (T.version === this.lastSrc && !src.media) return this;
    this.lastSrc = T.version;

    // Persona de un video (holograma): más resolución, se ve de cerca y en grande.
    const W = src.media ? 960 : 480, H = Math.max(120, Math.round(W * (video.videoHeight || 9) / (video.videoWidth || 16)));
    for (const c of [this.out, this.trail, this.tmp, this.m]) if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const mirror = !!src.bodyMirror, cal = src.media ? null : calib();
    // Con la alineación activa la cámara se lleva al lugar exacto de la proyección.
    const place = (ctx, img) => drawAligned(ctx, img, cal, W, H, mirror);
    // Máscara suavizada a la medida de salida.
    const mk = this.m.getContext("2d");
    mk.clearRect(0, 0, W, H);
    mk.filter = "blur(2px)";
    place(mk, T.source(mode === "movimiento"));
    mk.filter = "none";

    const out = this.out.getContext("2d");
    out.globalCompositeOperation = "source-over";
    out.fillStyle = "#000"; out.fillRect(0, 0, W, H);
    const tmp = this.tmp.getContext("2d");
    const colorize = (color, invert = false) => {
      tmp.globalCompositeOperation = "source-over";
      tmp.clearRect(0, 0, W, H);
      if (invert) {
        tmp.fillStyle = color; tmp.fillRect(0, 0, W, H);
        tmp.globalCompositeOperation = "destination-out";
        tmp.drawImage(this.m, 0, 0);
      } else {
        tmp.drawImage(this.m, 0, 0);
        tmp.globalCompositeOperation = "source-in";
        tmp.fillStyle = color; tmp.fillRect(0, 0, W, H);
      }
      tmp.globalCompositeOperation = "source-over";
      return this.tmp;
    };

    const outline = mode === "contorno" ? Math.max(0.6, src.bodyGlow || 0) : (src.bodyGlow || 0);
    const trailAmt = mode === "estela" || mode === "movimiento" ? Math.max(0.6, src.bodyTrail || 0) : (src.bodyTrail || 0);

    if (mode === "persona") {
      tmp.globalCompositeOperation = "source-over";
      tmp.clearRect(0, 0, W, H);
      // Video con IA rápida: el mismo fotograma que analizó la IA (silueta exacta). Con una IA
      // lenta se usa el video en vivo para que la persona se mueva fluida.
      place(tmp, src.media && T.frame && T.status === "ai" && (T.aiMs || 0) < 60 ? T.frame : video);
      tmp.globalCompositeOperation = "destination-in";
      tmp.drawImage(this.m, 0, 0);
      tmp.globalCompositeOperation = "source-over";
      out.drawImage(this.tmp, 0, 0);
    } else {
      out.globalCompositeOperation = "lighter";
      if (mode === "sombra") out.drawImage(colorize("#ff0000", true), 0, 0);
      else if (mode !== "contorno") out.drawImage(colorize("#ff0000"), 0, 0);
      // Estela: lo que se mueve deja rastro que se desvanece.
      const tr = this.trail.getContext("2d");
      if (trailAmt > 0) {
        tr.globalCompositeOperation = "destination-out";
        tr.fillStyle = `rgba(0,0,0,${0.03 + (1 - trailAmt) * 0.25})`;
        tr.fillRect(0, 0, W, H);
        tr.globalCompositeOperation = "lighter";
        tr.globalAlpha = 0.35;
        tr.drawImage(colorize("#0000ff"), 0, 0);
        tr.globalAlpha = 1;
        out.drawImage(this.trail, 0, 0);
      } else tr.clearRect(0, 0, W, H);
      out.globalCompositeOperation = "source-over";
    }
    // Contorno: halo alrededor de la silueta.
    if (outline > 0) {
      tmp.globalCompositeOperation = "source-over";
      tmp.clearRect(0, 0, W, H);
      tmp.filter = `blur(${Math.round(3 + outline * 14)}px)`;
      tmp.drawImage(this.m, 0, 0);
      tmp.drawImage(this.m, 0, 0);
      tmp.filter = "none";
      tmp.globalCompositeOperation = "destination-out";
      tmp.drawImage(this.m, 0, 0);
      tmp.globalCompositeOperation = "source-in";
      tmp.fillStyle = mode === "persona" ? "#ffffff" : "#00ff00";
      tmp.fillRect(0, 0, W, H);
      tmp.globalCompositeOperation = "source-over";
      out.globalCompositeOperation = "lighter";
      out.drawImage(this.tmp, 0, 0);
      out.globalCompositeOperation = "source-over";
    }
    this.version++;
    return this;
  }
}

/**
 * Efectos con el tracking de pose (tracking.js): esqueleto, partículas que salen
 * de manos y pies según su velocidad, fuego, humo, líneas entre personas y
 * geometría. Canales: R = relleno con la animación, G = líneas de neón.
 */
BodyFX.prototype.renderPose = function (video, src, cam, mode) {
  const TR = globalThis.__lumaTracking;
  if (!TR) return this;
  TR.ensure(cam);
  const W = 480, H = Math.max(120, Math.round(W * (video.videoHeight || 9) / (video.videoWidth || 16)));
  for (const c of [this.out, this.trail]) if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const now = performance.now(), dt = Math.min(0.1, (now - (this.lastPose || now)) / 1000);
  this.lastPose = now;
  const people = TR.people(cam).filter(p => p.lm && !p.ghost);
  const trackMirror = !!globalThis.__lumaApp?.S.project.settings.tracking.mirror;
  const toProj = camToProj(calib());
  const flip = (x) => { const raw = trackMirror ? 1 - x : x; return (src.bodyMirror ? 1 - raw : raw) * W; };
  // Con alineación: coordenadas de la cámara (sin espejo) → lugar exacto de la proyección.
  const P = toProj
    ? (p, i) => { const [x, y] = toProj(trackMirror ? 1 - p.lm[i][0] : p.lm[i][0], p.lm[i][1]); return [x * W, y * H, p.lm[i][3] ?? 1]; }
    : (p, i) => [flip(p.lm[i][0]), p.lm[i][1] * H, p.lm[i][3] ?? 1];
  const out = this.out.getContext("2d");
  out.globalCompositeOperation = "source-over";
  out.fillStyle = "#000"; out.fillRect(0, 0, W, H);
  const glow = 1 + (src.bodyGlow || 0) * 6;
  // Partículas (partículas, fuego, humo): nacen en manos, pies y cabeza.
  if (mode === "particulas" || mode === "fuego" || mode === "humo") {
    const ps = this.parts || (this.parts = []);
    const k = mode === "humo" ? 0.4 : 1;
    for (const p of people) {
      const emit = [[15, p.armSpeed], [16, p.armSpeed], [27, p.feetSpeed], [28, p.feetSpeed], [0, 0.2]];
      for (const [j, sp] of emit) {
        const [x, y, v] = P(p, j);
        if (v < 0.4) continue;
        const n = Math.min(14, Math.round((mode === "particulas" ? 1 + sp * 10 : 3) * k * (1 + (src.bodySens ?? 0.5))));
        for (let i = 0; i < n; i++) ps.push({ x, y, vx: (Math.random() - 0.5) * (mode === "particulas" ? 220 : 60), vy: mode === "particulas" ? (Math.random() - 0.6) * 220 : -60 - Math.random() * 120, life: 1, size: mode === "humo" ? 8 + Math.random() * 14 : 2 + Math.random() * 4 });
      }
    }
    if (ps.length > 3000) ps.splice(0, ps.length - 3000);
    out.globalCompositeOperation = "lighter";
    for (let i = ps.length - 1; i >= 0; i--) {
      const q = ps[i];
      q.life -= dt * (mode === "humo" ? 0.45 : mode === "fuego" ? 1.4 : 0.9);
      if (q.life <= 0) { ps.splice(i, 1); continue; }
      q.x += q.vx * dt; q.y += q.vy * dt;
      if (mode === "particulas") q.vy += 180 * dt; else q.vx += (Math.random() - 0.5) * 40 * dt;
      const r = q.size * (mode === "humo" ? 2 - q.life : mode === "fuego" ? q.life : 1);
      out.fillStyle = `rgba(255,0,0,${(mode === "humo" ? 0.18 : 0.8) * q.life})`;
      out.beginPath(); out.arc(q.x, q.y, Math.max(0.5, r), 0, Math.PI * 2); out.fill();
    }
    if (mode === "humo") { out.globalCompositeOperation = "source-over"; out.filter = "blur(6px)"; out.drawImage(this.out, 0, 0); out.filter = "none"; }
  }
  // Geometría: triángulos entre articulaciones rellenos con la animación.
  if (mode === "geometria") {
    out.globalCompositeOperation = "lighter";
    for (const p of people) for (const [a, b, c] of TRIS) {
      const A = P(p, a), B = P(p, b), C = P(p, c);
      if (A[2] < 0.4 || B[2] < 0.4 || C[2] < 0.4) continue;
      out.fillStyle = "rgba(255,0,0,0.55)";
      out.beginPath(); out.moveTo(A[0], A[1]); out.lineTo(B[0], B[1]); out.lineTo(C[0], C[1]); out.closePath(); out.fill();
      out.strokeStyle = "rgba(0,255,0,0.9)"; out.lineWidth = 1.5; out.stroke();
    }
  }
  // Esqueleto (y como guía en los demás modos con poco brillo).
  if (mode === "esqueleto" || mode === "particulas" || mode === "geometria") {
    out.globalCompositeOperation = "lighter";
    out.strokeStyle = mode === "esqueleto" ? "rgba(0,255,0,1)" : "rgba(0,255,0,0.35)";
    out.lineWidth = 3 * glow; out.lineCap = "round";
    for (const p of people) {
      for (const [a, b] of BONES) {
        const A = P(p, a), B = P(p, b);
        if (A[2] < 0.4 || B[2] < 0.4) continue;
        out.beginPath(); out.moveTo(A[0], A[1]); out.lineTo(B[0], B[1]); out.stroke();
      }
      if (mode === "esqueleto") {
        out.fillStyle = "rgba(255,0,0,1)";
        for (const j of [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) { const A = P(p, j); if (A[2] > 0.4) { out.beginPath(); out.arc(A[0], A[1], 5 * glow, 0, Math.PI * 2); out.fill(); } }
      }
    }
  }
  // Líneas: cada mano unida a las manos y cabezas de todas las personas.
  if (mode === "lineas") {
    out.globalCompositeOperation = "lighter";
    out.lineWidth = 2 * glow;
    const pts = [];
    for (const p of people) for (const j of [0, 15, 16, 27, 28]) { const A = P(p, j); if (A[2] > 0.4) pts.push(A); }
    for (let i = 0; i < pts.length; i++) for (let k = i + 1; k < pts.length; k++) {
      const d = Math.hypot(pts[i][0] - pts[k][0], pts[i][1] - pts[k][1]);
      out.strokeStyle = `rgba(0,255,0,${Math.max(0.15, 1 - d / (W * 0.8))})`;
      out.beginPath(); out.moveTo(pts[i][0], pts[i][1]); out.lineTo(pts[k][0], pts[k][1]); out.stroke();
    }
  }
  // Estela opcional (canal B) para cualquier modo de pose.
  const trailAmt = src.bodyTrail || 0;
  const tr = this.trail.getContext("2d");
  if (trailAmt > 0) {
    tr.globalCompositeOperation = "destination-out";
    tr.fillStyle = `rgba(0,0,0,${0.03 + (1 - trailAmt) * 0.25})`; tr.fillRect(0, 0, W, H);
    tr.globalCompositeOperation = "lighter";
    tr.filter = "brightness(0)"; tr.globalAlpha = 0.5;
    // la estela es la parte roja/verde convertida en azul
    tr.fillStyle = "#0000ff";
    for (const p of people) for (const j of [15, 16, 27, 28, 0]) { const A = P(p, j); if (A[2] > 0.4) { tr.beginPath(); tr.arc(A[0], A[1], 10, 0, Math.PI * 2); tr.fill(); } }
    tr.filter = "none"; tr.globalAlpha = 1;
    out.globalCompositeOperation = "lighter"; out.drawImage(this.trail, 0, 0);
  }
  out.globalCompositeOperation = "source-over";
  this.version++;
  return this;
};

/** Efectos interactivos nuevos (ondas, pintar, burbujas…): máscara alineada → simulación. */
BodyFX.prototype.renderInteractive = function (video, src, cam, mode) {
  const T = bodyTracker(cam);
  T.sens = src.bodySens ?? 0.5;
  T.setDepth(calib()?.depth);
  T.update(video, true);
  // Los efectos profesionales (GPU) trabajan a más resolución: se ven nítidos proyectados.
  const pro = PRO_MODE_IDS.has(mode);
  const W = pro ? 640 : 480, H = Math.max(120, Math.round(W * (video.videoHeight || 9) / (video.videoWidth || 16)));
  for (const c of [this.out, this.m]) if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const mk = this.m.getContext("2d");
  mk.clearRect(0, 0, W, H);
  drawAligned(mk, T.source(false), calib(), W, H, !!src.bodyMirror);
  const now = performance.now(), dt = Math.min(0.1, (now - (this.lastI || now)) / 1000);
  this.lastI = now;
  if (pro) {
    if (!this.pro) this.pro = new ProFX();
    this.pro.render(this.out, this.m, mode, W, H, dt, { color: src.color, color2: src.color2, sound: src.bodySound !== false, score: src.bodyScore !== false });
  } else {
    if (!this.ifx) this.ifx = new InteractiveFX();
    this.ifx.render(this.out, this.m, mode, W, H, dt, src.bodySens ?? 0.5);
  }
  this.version++;
  return this;
};

/** Caché de efectos por superficie (clave = escena:superficie). */
export class BodyCache {
  constructor() { this.map = new Map(); }
  get(key, video, src, cam) {
    let fx = this.map.get(key);
    if (!fx) this.map.set(key, fx = new BodyFX());
    return fx.render(video, src, cam);
  }
}

/* ---------------- Sensores de movimiento ---------------- */

/** Zonas de la imagen de la cámara que puede vigilar un sensor. */
export const SENSOR_ZONES = [["all", "Toda"], ["left", "Izquierda"], ["center", "Centro"], ["right", "Derecha"], ["top", "Arriba"], ["bottom", "Abajo"]];

/** Mide cuánto movimiento hay en cada zona de una cámara (0..1, suavizado). */
class MotionSensor {
  constructor() { this.c = canvas(64, 36); this.prev = null; this.lastT = -1; this.levels = {}; }
  update(video) {
    if (!video || video.readyState < 2 || video.currentTime === this.lastT) return this.levels;
    this.lastT = video.currentTime;
    const w = 64, h = 36;
    const ctx = this.c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    if (!this.prev) this.prev = new Float32Array(w * h);
    const cnt = { all: 0, left: 0, center: 0, right: 0, top: 0, bottom: 0 };
    for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
      const j = i * 4, l = d[j] * 0.3 + d[j + 1] * 0.59 + d[j + 2] * 0.11;
      const moved = Math.abs(l - this.prev[i]) > 18;
      this.prev[i] = l;
      if (!moved) continue;
      cnt.all++;
      if (x < w / 3) cnt.left++; else if (x < 2 * w / 3) cnt.center++; else cnt.right++;
      if (y < h / 2) cnt.top++; else cnt.bottom++;
    }
    const area = { all: w * h, left: w * h / 3, center: w * h / 3, right: w * h / 3, top: w * h / 2, bottom: w * h / 2 };
    for (const k in cnt) {
      const v = Math.min(1, (cnt[k] / area[k]) * 5);
      const old = this.levels[k] || 0;
      this.levels[k] = v > old ? v : old * 0.8 + v * 0.2;   // sube rápido, baja suave
    }
    return this.levels;
  }
}
const sensors = new Map();
export function motionSensor(cam = "default") {
  let s = sensors.get(cam);
  if (!s) sensors.set(cam, s = new MotionSensor());
  return s;
}
