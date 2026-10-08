// web/js/tracking.js
// Tracking de personas con proveedores intercambiables (Kinect no es obligatorio):
//   · «webcam»: cualquier cámara + IA (MediaPipe Pose y Hands) en un hilo aparte.
//   · «motion»: solo movimiento (sin IA), funciona en cualquier equipo.
//   · Kinect, Azure Kinect, cámaras de profundidad e IP: se muestran como
//     «EN DESARROLLO» (no se simulan).
// Cada persona tiene un id estable, 33 puntos del cuerpo, manos, cabeza, pies,
// posición, velocidad y confianza. Las señales (personas, mano levantada,
// velocidad, distancia, zonas…) entran al motor de parámetros como fuente
// «tracking» y las reglas convierten gestos en acciones reales.
import { cameraIfReady, getCamera } from "./sources.js";
import { runAction } from "./rules.js";

const BASE = new URL("../vendor/mediapipe/", import.meta.url).href;
export const PROVIDERS = [
  { id: "webcam", name: "Cámara + IA (cuerpo y manos)", available: true },
  { id: "motion", name: "Cámara: solo movimiento (sin IA)", available: true },
  { id: "ipcam", name: "Cámara IP / RTSP / NDI", available: false, note: "EN DESARROLLO: llegará con el video por red" },
  { id: "kinect", name: "Kinect v2", available: false, note: "EN DESARROLLO: necesita el SDK de Kinect para Windows" },
  { id: "azure", name: "Azure Kinect", available: false, note: "EN DESARROLLO: necesita el SDK de Azure Kinect" },
  { id: "depth", name: "Cámara de profundidad (RealSense, Orbbec…)", available: false, note: "EN DESARROLLO: hoy funciona como cámara de color con «Cámara + IA»" },
];
export const QUALITIES = { low: 256, medium: 384, high: 512, ultra: 640 };
export const J = { nose: 0, lShoulder: 11, rShoulder: 12, lElbow: 13, rElbow: 14, lWrist: 15, rWrist: 16, lHip: 23, rHip: 24, lKnee: 25, rKnee: 26, lAnkle: 27, rAnkle: 28, lFoot: 31, rFoot: 32 };
export const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [27, 31], [28, 32], [0, 11], [0, 12]];

/** Señales para el motor de parámetros y las reglas: [clave, nombre]. */
export const SIGNALS = [
  ["people", "Número de personas (0-4)"], ["presence", "Hay alguien"], ["x", "Posición horizontal"], ["y", "Posición vertical"],
  ["distance", "Cercanía a la cámara"], ["speed", "Velocidad del cuerpo"], ["arm_speed", "Velocidad de los brazos"], ["feet_speed", "Velocidad de los pies"],
  ["hands_up", "Alguna mano levantada"], ["left_hand_up", "Mano izquierda levantada"], ["right_hand_up", "Mano derecha levantada"],
  ["left_hand_y", "Altura de la mano izquierda"], ["right_hand_y", "Altura de la mano derecha"], ["head_x", "Cabeza: horizontal"], ["head_y", "Cabeza: vertical"],
  ["spread", "Brazos abiertos"], ["motion", "Cantidad de movimiento"],
];

const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;

class CameraTracker {
  constructor(mgr, cam, cfg) {
    this.mgr = mgr; this.cam = cam; this.cfg = cfg;
    this.people = []; this.nextId = 1; this.hands = [];
    this.status = "starting"; this.error = ""; this.delegate = "";
    this.version = 0; this.fps = 0; this.ms = 0; this.lastResult = 0;
    this.signals = {}; this.inflight = false; this.timer = 0;
    this.motion = { c: null, prev: null, amount: 0, cx: 0.5, cy: 0.5 };
    if (cfg.provider === "webcam") this.startWorker();
    else this.status = "running";
    this.timer = setInterval(() => this.grab(), 1000 / Math.max(5, cfg.fps || 24));
  }
  startWorker() {
    try {
      this.worker = new Worker(new URL("./tracking-worker.js", import.meta.url));
      this.worker.onmessage = (e) => this.onWorker(e.data);
      this.worker.onerror = (e) => { this.status = "error"; this.error = e.message || "El hilo de tracking falló"; };
      this.worker.postMessage({ t: "init", base: BASE, hands: this.cfg.hands !== false, numPoses: this.cfg.maxPeople || 4, numHands: (this.cfg.maxPeople || 4) * 2 });
      this.status = "loading";
    } catch (e) { this.status = "error"; this.error = e.message; }
  }
  onWorker(m) {
    if (m.t === "ready") { this.status = "running"; this.delegate = m.delegate; }
    else if (m.t === "error") { this.status = "error"; this.error = m.msg; this.inflight = false; }
    else if (m.t === "skip") this.inflight = false;
    else if (m.t === "result") { this.inflight = false; this.ms = m.ms; this.ingest(m); }
  }
  async grab() {
    const camObj = cameraIfReady(this.cam);
    if (!camObj) { getCamera(this.cam).catch(() => {}); this.offline = true; return; }
    this.offline = false;
    const v = camObj.el;
    if (v.readyState < 2 || !v.videoWidth) return;
    if (this.cfg.provider === "motion") return this.motionStep(v);
    if (this.status !== "running" || this.inflight || !this.worker) return;
    const w = QUALITIES[this.cfg.quality] || 384, h = Math.round(w * v.videoHeight / v.videoWidth);
    try {
      this.inflight = true;
      const bmp = await createImageBitmap(v, { resizeWidth: w, resizeHeight: h, resizeQuality: "low" });
      this.worker.postMessage({ t: "frame", bitmap: bmp, ts: performance.now() }, [bmp]);
    } catch { this.inflight = false; }
  }
  /** Sin IA: centro y cantidad de lo que se mueve. */
  motionStep(v) {
    const M = this.motion, w = 80, h = Math.max(24, Math.round(80 * v.videoHeight / v.videoWidth));
    if (!M.c) { M.c = document.createElement("canvas"); }
    if (M.c.width !== w || M.c.height !== h) { M.c.width = w; M.c.height = h; M.prev = null; }
    const ctx = M.c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(v, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data, n = w * h;
    if (!M.prev) M.prev = new Float32Array(n);
    let sum = 0, sx = 0, sy = 0;
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const l = d[j] * 0.3 + d[j + 1] * 0.59 + d[j + 2] * 0.11, diff = Math.abs(l - M.prev[i]) > 22 ? 1 : 0;
      M.prev[i] = l;
      if (diff) { sum++; sx += i % w; sy += Math.floor(i / w); }
    }
    M.amount = M.amount * 0.7 + (sum / n) * 0.3 * 8;
    if (sum > 4) { M.cx = M.cx * 0.6 + (sx / sum / w) * 0.4; M.cy = M.cy * 0.6 + (sy / sum / h) * 0.4; }
    const present = M.amount > 0.02;
    this.people = present ? [{ id: 1, center: [this.mx(M.cx), M.cy], bbox: [0, 0, 1, 1], lm: null, speed: clamp01(M.amount), conf: clamp01(M.amount * 3) }] : [];
    this.signals = { people: present ? 0.25 : 0, presence: present ? 1 : 0, x: this.mx(M.cx), y: 1 - M.cy, motion: clamp01(M.amount), speed: clamp01(M.amount) };
    this.version++; this.lastResult = performance.now();
    this.mgr.publish(this);
  }
  mx(x) { return this.cfg.mirror ? 1 - x : x; }

  /** Personas con id estable (se asocian por cercanía con las del fotograma anterior). */
  ingest(m) {
    const now = performance.now(), dt = Math.max(0.016, (now - (this.lastResult || now - 33)) / 1000);
    this.fps = this.fps * 0.8 + (1 / dt) * 0.2;
    this.lastResult = now;
    const dets = m.poses.map(p => {
      const lm = p.lm.map(([x, y, z, vis]) => [this.mx(x), y, z, vis]);
      const pick = (i) => lm[i];
      const hip = [(pick(23)[0] + pick(24)[0]) / 2, (pick(23)[1] + pick(24)[1]) / 2];
      const vis = lm.filter(q => q[3] > 0.5);
      const xs = vis.map(q => q[0]), ys = vis.map(q => q[1]);
      const bbox = xs.length ? [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)] : [hip[0], hip[1], 0, 0];
      return { lm, center: hip, bbox, conf: lm.reduce((a, q) => a + (q[3] ?? 1), 0) / lm.length };
    });
    const prev = this.people, used = new Set(), next = [];
    for (const d of dets) {
      let best = null, bd = 0.25;
      for (const p of prev) { if (used.has(p.id)) continue; const dd = Math.hypot(p.center[0] - d.center[0], p.center[1] - d.center[1]); if (dd < bd) { bd = dd; best = p; } }
      const id = best ? best.id : this.nextId++;
      if (best) used.add(best.id);
      const vel = best ? [(d.center[0] - best.center[0]) / dt, (d.center[1] - best.center[1]) / dt] : [0, 0];
      const wr = (i) => best?.lm ? Math.hypot(d.lm[i][0] - best.lm[i][0], d.lm[i][1] - best.lm[i][1]) / dt : 0;
      const nose = d.lm[0];
      next.push({ ...d, id, seen: now, vel, speed: Math.hypot(vel[0], vel[1]),
        armSpeed: Math.max(wr(15), wr(16)), feetSpeed: Math.max(wr(27), wr(28)),
        leftUp: d.lm[15][3] > 0.5 && d.lm[15][1] < nose[1] - 0.02, rightUp: d.lm[16][3] > 0.5 && d.lm[16][1] < nose[1] - 0.02 });
    }
    // Las que no aparecen se mantienen un momento (oclusiones breves).
    for (const p of prev) if (!used.has(p.id) && now - p.seen < 700) next.push({ ...p, ghost: true });
    next.sort((a, b) => a.id - b.id);
    this.people = next;
    this.hands = m.hands.map(hd => ({ ...hd, lm: hd.lm.map(([x, y, z]) => [this.mx(x), y, z]) }));
    const real = next.filter(p => !p.ghost), first = real[0];
    const shoulderW = first ? Math.max(0.05, Math.hypot(first.lm[11][0] - first.lm[12][0], first.lm[11][1] - first.lm[12][1])) : 1;
    this.signals = {
      people: clamp01(real.length / 4), presence: real.length ? 1 : 0,
      x: first ? first.center[0] : 0.5, y: first ? 1 - first.center[1] : 0.5, distance: first ? clamp01(first.bbox[3]) : 0,
      speed: clamp01(Math.max(0, ...real.map(p => p.speed)) / 1.5), arm_speed: clamp01(Math.max(0, ...real.map(p => p.armSpeed)) / 3),
      feet_speed: clamp01(Math.max(0, ...real.map(p => p.feetSpeed)) / 2.5),
      hands_up: real.some(p => p.leftUp || p.rightUp) ? 1 : 0, left_hand_up: real.some(p => p.leftUp) ? 1 : 0, right_hand_up: real.some(p => p.rightUp) ? 1 : 0,
      left_hand_y: first ? clamp01(1 - first.lm[15][1]) : 0, right_hand_y: first ? clamp01(1 - first.lm[16][1]) : 0,
      head_x: first ? first.lm[0][0] : 0.5, head_y: first ? 1 - first.lm[0][1] : 0.5,
      spread: first ? clamp01(Math.hypot(first.lm[15][0] - first.lm[16][0], first.lm[15][1] - first.lm[16][1]) / shoulderW / 5) : 0,
      motion: clamp01(Math.max(0, ...real.map(p => p.speed + p.armSpeed)) / 3),
    };
    this.version++;
    this.mgr.publish(this);
  }
  stop() { clearInterval(this.timer); try { this.worker?.terminate(); } catch {} }
}

export class TrackingManager {
  constructor(app) {
    this.app = app;
    this.trackers = new Map();   // cámara -> CameraTracker
    this.ruleState = new Map();  // regla -> { on, last }
    globalThis.__lumaTracking = { people: (cam) => this.trackers.get(cam)?.people || [], hands: (cam) => this.trackers.get(cam)?.hands || [], version: (cam) => this.trackers.get(cam)?.version || 0, ensure: (cam) => this.ensure(cam) };
  }
  get cfg() { return this.app.S.project.settings.tracking; }
  /** Arranca el tracking de una cámara (si el proveedor está disponible). */
  ensure(cam = this.cfg.camId || "default") {
    if (this.trackers.has(cam)) return this.trackers.get(cam);
    const prov = PROVIDERS.find(p => p.id === this.cfg.provider);
    if (!prov?.available) return null;
    const t = new CameraTracker(this, cam, this.cfg);
    this.trackers.set(cam, t);
    return t;
  }
  stop(cam) { for (const [k, t] of this.trackers) if (!cam || k === cam) { t.stop(); this.trackers.delete(k); } }
  restart() { const cams = [...this.trackers.keys()]; this.stop(); for (const c of cams) this.ensure(c); }
  main() { return this.trackers.get(this.cfg.camId || "default") || this.trackers.values().next().value || null; }

  /** Nuevos datos de una cámara: señales al motor de parámetros, zonas y reglas. */
  publish(t) {
    if (t !== this.main()) return;
    const P = this.app.params, sig = { ...t.signals };
    // Zonas interactivas: ocupación de cada zona (personas o manos dentro).
    for (const z of this.cfg.zones) {
      const inside = (x, y) => x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h;
      const n = t.people.filter(p => !p.ghost && inside(p.center[0], p.center[1])).length;
      const hand = t.people.some(p => !p.ghost && p.lm && [15, 16].some(i => p.lm[i][3] > 0.5 && inside(p.lm[i][0], p.lm[i][1])));
      sig["zone:" + z.id] = clamp01(n / 2);
      sig["zonehand:" + z.id] = hand ? 1 : 0;
    }
    t.lastSignals = sig;
    for (const [k, v] of Object.entries(sig)) P.input({ src: "tracking", device: "tracking", key: k, v });
    this.evalRules(sig);
  }
  evalRules(sig) {
    const now = performance.now();
    for (const r of this.cfg.rules) {
      if (r.enabled === false) continue;
      const v = sig[r.signal] ?? 0;
      const cond = r.op === "below" ? v < r.value : v > r.value;
      const st = this.ruleState.get(r.id) || { on: false, last: 0 };
      if (cond && !st.on && now - st.last > (r.cooldown ?? 1) * 1000) {
        st.on = true; st.last = now;
        runAction(this.app, r.then);
        r.fired = (r.fired || 0) + 1;
      } else if (!cond && st.on) {
        st.on = false;
        if (r.otherwise) runAction(this.app, r.otherwise);
      }
      this.ruleState.set(r.id, st);
    }
  }
}
