// web/js/show.js
// Control de show: timecode (interno, MIDI Time Code, LTC por audio, OSC),
// cues por timecode (las escenas se disparan solas al pasar por su tiempo),
// automatización (grabar movimientos de MIDI, OSC, DMX, audio o tracking y
// reproducirlos como líneas de tiempo) y salida de emergencia.
import { uid } from "./model.js";

export const TC_SOURCES = [["internal", "Interno"], ["mtc", "MIDI Time Code"], ["ltc", "LTC (audio)"], ["osc", "OSC"]];

export function parseTc(str, fps = 30) {
  if (typeof str === "number") return str;
  const m = String(str || "").trim().match(/^(\d{1,2}):(\d{1,2}):(\d{1,2})(?:[:;.](\d{1,2}))?$/);
  if (!m) return null;
  return +m[1] * 3600 + +m[2] * 60 + +m[3] + (m[4] ? +m[4] / fps : 0);
}
export function fmtTc(sec, fps = 30) {
  if (sec === null || sec === undefined || isNaN(sec)) return "--:--:--:--";
  const p = (n) => String(Math.floor(n)).padStart(2, "0");
  const f = Math.floor((sec % 1) * fps + 1e-6);
  return `${p(sec / 3600)}:${p((sec / 60) % 60)}:${p(sec % 60)}:${p(f)}`;
}

/** Valor de una línea de automatización en t (interpolación lineal). */
export function laneValue(points, t) {
  if (!points.length) return null;
  if (t <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    if (t < points[i][0]) {
      const [t0, v0] = points[i - 1], [t1, v1] = points[i];
      return v0 + (v1 - v0) * ((t - t0) / Math.max(1e-6, t1 - t0));
    }
  }
  return points[points.length - 1][1];
}

export class ShowEngine {
  constructor(app) {
    this.app = app;
    this.external = null;     // último timecode externo { seconds, fps, at, source }
    this.internalStart = 0;   // S.clock al empezar el show (interno)
    this.recording = null;    // { sceneId, start }
    this.lastChased = null;
    this.ltc = null;          // { ctx, node, stream }
    this.ltcError = "";
    app.params.onRecord = (id, v) => this.record(id, v);
  }
  get cfg() { return this.app.S.project.settings.show; }

  /* ---------------- Timecode ---------------- */
  /** Timecode externo recibido (MTC, LTC u OSC). */
  external_(source, tc) {
    this.external = { seconds: tc.seconds, fps: tc.fps || 30, at: performance.now(), source };
  }
  /** Timecode actual en segundos según la fuente elegida (null si no llega señal). */
  now() {
    const c = this.cfg, S = this.app.S;
    if (c.tcSource === "internal") return Math.max(0, S.clock - this.internalStart);
    const e = this.external;
    if (!e || e.source !== c.tcSource) return null;
    const age = (performance.now() - e.at) / 1000;
    if (age > 1.2) return null;                 // sin señal: se detiene (no se inventa tiempo)
    return e.seconds + Math.min(age, 0.2);      // entre cuadros se interpola un poco
  }
  fps() { return this.cfg.tcSource === "internal" ? 30 : this.external?.fps || 30; }
  resetInternal() { this.internalStart = this.app.S.clock; this.lastChased = null; }

  /* ---------------- Cues por timecode ---------------- */
  tick() {
    const S = this.app.S, P = S.project;
    const t = this.now();
    S.tcNow = t;
    if (this.cfg.chase && t !== null) {
      let best = null, bestT = -1;
      for (const sc of P.scenes) {
        const ct = parseTc(sc.tc, this.fps());
        if (ct !== null && ct <= t + 1e-3 && ct > bestT) { best = sc; bestT = ct; }
      }
      if (best && best.id !== this.lastChased) {
        this.lastChased = best.id;
        if (best.id !== P.sceneId) this.app.actions.goScene(best.id);
      }
    }
    // Automatización: las líneas de la escena actual (salvo la que se está grabando).
    const tl = S.clock - S.sceneStart;
    for (const lane of this.cfg.lanes) {
      if (!lane.enabled || lane.sceneId !== P.sceneId || !lane.points.length) continue;
      if (this.recording && this.recording.sceneId === lane.sceneId && this.recording.targets?.has(lane.target)) continue;
      const len = lane.points[lane.points.length - 1][0];
      const sc = P.scenes.find(s => s.id === lane.sceneId);
      const tt = lane.loop && len > 0 ? tl % len : sc?.duration > 0 ? Math.min(tl, sc.duration) : tl;
      const v = laneValue(lane.points, tt);
      if (v !== null) this.app.params.modulateExt("lane:" + lane.id, lane.target, v, "timeline");
    }
  }

  /* ---------------- Grabación de automatización ---------------- */
  startRecording() {
    const S = this.app.S;
    this.recording = { sceneId: S.project.sceneId, start: S.clock - S.sceneStart, targets: new Set() };
  }
  stopRecording() { const r = this.recording; this.recording = null; return r; }
  record(id, value) {
    const R = this.recording, S = this.app.S;
    if (!R || S.project.sceneId !== R.sceneId) return;
    const t = Math.round((S.clock - S.sceneStart) * 1000) / 1000;
    let lane = this.cfg.lanes.find(l => l.sceneId === R.sceneId && l.target === id);
    if (!lane) { lane = { id: uid("lane"), sceneId: R.sceneId, target: id, points: [], enabled: true, loop: false }; this.cfg.lanes.push(lane); }
    if (!R.targets.has(id)) {
      // Primera vez en esta toma: se borra lo grabado desde aquí en adelante (regrabar).
      lane.points = lane.points.filter(p => p[0] < t);
      R.targets.add(id);
    }
    const last = lane.points[lane.points.length - 1];
    if (last && t - last[0] < 0.02) { last[1] = value; return; }
    lane.points.push([t, value]);
  }

  /* ---------------- LTC por una entrada de audio ---------------- */
  async startLtc(deviceId = "") {
    this.stopLtc();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
      const ctx = new AudioContext({ latencyHint: "interactive" });
      await ctx.audioWorklet.addModule(new URL("./ltc-worklet.js", import.meta.url));
      const node = new AudioWorkletNode(ctx, "lumamap-ltc");
      node.port.onmessage = (e) => this.external_("ltc", e.data);
      ctx.createMediaStreamSource(stream).connect(node);
      this.ltc = { ctx, node, stream };
      this.ltcError = "";
      return true;
    } catch (e) { this.ltcError = e.message; return false; }
  }
  stopLtc() {
    if (!this.ltc) return;
    try { this.ltc.stream.getTracks().forEach(t => t.stop()); this.ltc.ctx.close(); } catch {}
    this.ltc = null;
  }
}
