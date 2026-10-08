// web/js/midi.js
// Controladores MIDI reales con Web MIDI (Chromium / Electron en Windows,
// macOS y Linux; también Android con Chrome). Todo lo que llega se entrega al
// motor de parámetros (params.js), que decide qué hace cada control.
//
// · Detección automática de entradas y salidas, fabricante y estado, y
//   conexión en caliente: al desconectar no se bloquea nada; al reconectar los
//   mapeos vuelven a funcionar solos (se asocian por nombre del dispositivo).
// · Notas, CC, pitch bend (14 bits), program change y aftertouch, canales 1-16.
// · CC de alta resolución: si el controlador envía el LSB (CC 32-63) junto al
//   MSB (CC 0-31) se combinan en 14 bits (16384 pasos) en lugar de 128.
// · MIDI Clock (BPM, start/stop/continue) y MIDI Time Code de entrada; MIDI
//   Clock de salida programado con marcas de tiempo (sin depender del render).
// · Feedback: devuelve los valores al controlador (LED, pads, motores).

const STATUS = { 0x80: "noteoff", 0x90: "note", 0xa0: "polyat", 0xb0: "cc", 0xc0: "pc", 0xd0: "at", 0xe0: "pb" };

export class MidiDriver {
  constructor({ onInput, onStatus, onClock, onTransport, onTimecode } = {}) {
    this.onInput = onInput || (() => {});
    this.onStatus = onStatus || (() => {});
    this.onClock = onClock || (() => {});
    this.onTransport = onTransport || (() => {});
    this.onTimecode = onTimecode || (() => {});
    this.access = null;
    this.error = "";
    this.msb = new Map();        // "disp|canal|cc" -> último MSB
    this.hires = new Set();      // controles que envían LSB (14 bits)
    this.clockTicks = [];        // marcas de tiempo de los últimos 0xF8
    this.clockBpm = 0;
    this.mtc = { parts: new Array(8).fill(0), rate: 30, last: null };
    this.lastByPort = new Map(); // nombre -> último mensaje (diagnóstico)
    this.clockOut = null;
  }

  get supported() { return typeof navigator !== "undefined" && !!navigator.requestMIDIAccess; }
  get active() { return !!this.access; }

  async start() {
    if (this.access) return true;
    if (!this.supported) { this.error = "Este navegador no tiene Web MIDI (usa la app de escritorio, Chrome o Edge)."; this.onStatus(); return false; }
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch (e) {
      this.error = "Permiso MIDI denegado: " + e.message; this.onStatus(); return false;
    }
    this.error = "";
    this.bind();
    this.access.onstatechange = () => { this.bind(); this.onStatus(); };
    this.onStatus();
    return true;
  }

  bind() {
    for (const input of this.access.inputs.values()) {
      if (input._lumaBound) continue;
      input._lumaBound = true;
      input.onmidimessage = (e) => this.message(input, e.data, e.timeStamp);
    }
  }

  /** Puertos para la vista de diagnóstico. */
  ports() {
    if (!this.access) return { inputs: [], outputs: [] };
    const map = (p) => ({ id: p.id, name: p.name || "(sin nombre)", manufacturer: p.manufacturer || "", state: p.state, connection: p.connection, version: p.version || "", last: this.lastByPort.get(p.name) || null });
    return { inputs: [...this.access.inputs.values()].map(map), outputs: [...this.access.outputs.values()].map(map) };
  }
  outputFor(name) {
    if (!this.access) return null;
    const outs = [...this.access.outputs.values()].filter(o => o.state === "connected");
    return outs.find(o => o.name === name) || outs.find(o => name && (o.name.includes(name) || name.includes(o.name))) || null;
  }

  message(input, data, ts) {
    const dev = input.name || "MIDI";
    const st = data[0];
    if (st >= 0xf8) return this.realtime(st, ts);
    if (st === 0xf1) return this.quarterFrame(data[1]);
    if (st >= 0xf0) return;
    const type = STATUS[st & 0xf0], ch = (st & 0x0f) + 1, d1 = data[1] ?? 0, d2 = data[2] ?? 0;
    this.lastByPort.set(dev, { t: Date.now(), bytes: [...data] });
    const base = { src: "midi", device: dev, channel: ch };
    switch (type) {
      case "note":
        if (d2 > 0) return this.onInput({ ...base, key: "note:" + d1, v: d2 / 127, raw: d2, on: true, label: `Nota ${d1} vel ${d2}` });
      // nota con velocidad 0 = soltar
      // falls through
      case "noteoff":
        return this.onInput({ ...base, key: "note:" + d1, v: 0, raw: 0, on: false, label: `Nota ${d1} off` });
      case "cc": {
        const k = `${dev}|${ch}|`;
        if (d1 >= 32 && d1 < 64 && this.msb.has(k + (d1 - 32))) {
          // LSB de un control de 14 bits
          const cc = d1 - 32, msb = this.msb.get(k + cc);
          this.hires.add(k + cc);
          const v14 = (msb << 7) | d2;
          return this.onInput({ ...base, key: "cc:" + cc, v: v14 / 16383, raw: msb, hires: true, label: `CC ${cc} = ${v14} (14 bits)` });
        }
        if (d1 < 32) this.msb.set(k + d1, d2);
        return this.onInput({ ...base, key: "cc:" + d1, v: d2 / 127, raw: d2, on: d2 >= 64, label: `CC ${d1} = ${d2}` });
      }
      case "pb": {
        const v14 = (d2 << 7) | d1;
        return this.onInput({ ...base, key: "pb", v: v14 / 16383, raw: d2, label: `Pitch bend ${v14 - 8192}` });
      }
      case "pc":
        return this.onInput({ ...base, key: "pc:" + d1, v: 1, raw: 127, on: true, button: true, label: `Program change ${d1}` });
      case "at":
        return this.onInput({ ...base, key: "at", v: d1 / 127, raw: d1, label: `Aftertouch ${d1}` });
      case "polyat":
        return this.onInput({ ...base, key: "pat:" + d1, v: d2 / 127, raw: d2, label: `Aftertouch nota ${d1} = ${d2}` });
    }
  }

  /* ---------------- MIDI Clock ---------------- */
  realtime(st, ts) {
    if (st === 0xf8) {
      const t = this.clockTicks;
      t.push(ts);
      if (t.length > 49) t.shift();                 // ~2 negras a 24 ppq
      if (t.length >= 25) {
        const dt = (t[t.length - 1] - t[0]) / (t.length - 1);
        const bpm = 60000 / (dt * 24);
        if (bpm > 20 && bpm < 400) {
          this.clockBpm = this.clockBpm ? this.clockBpm * 0.8 + bpm * 0.2 : bpm;
          this.onClock({ bpm: Math.round(this.clockBpm * 10) / 10 });
        }
      }
    } else if (st === 0xfa) { this.clockTicks = []; this.onTransport("start"); }
    else if (st === 0xfb) this.onTransport("continue");
    else if (st === 0xfc) this.onTransport("stop");
  }

  /* ---------------- MIDI Time Code (cuartos de cuadro) ---------------- */
  quarterFrame(d) {
    const piece = d >> 4, val = d & 0x0f, p = this.mtc.parts;
    p[piece] = val;
    if (piece === 7) {
      const rateCode = (val >> 1) & 3;
      this.mtc.rate = [24, 25, 29.97, 30][rateCode];
      const tc = { h: ((p[7] & 1) << 4) | p[6], m: (p[5] << 4) | p[4], s: (p[3] << 4) | p[2], f: (p[1] << 4) | p[0], fps: this.mtc.rate };
      tc.seconds = tc.h * 3600 + tc.m * 60 + tc.s + (tc.f + 2) / tc.fps;   // +2 cuadros: el código completo llega 2 cuadros tarde
      this.mtc.last = tc;
      this.onTimecode(tc);
    }
  }

  /* ---------------- Salida ---------------- */
  /** Feedback de un mapeo (v = 0..1). */
  sendFeedback(m, v) {
    const out = this.outputFor(m.device === "*" ? this.firstOutputName() : m.device);
    if (!out) return;
    const ch = Math.max(1, m.channel || 1) - 1;
    const [kind, num] = m.key.split(":");
    try {
      if (kind === "cc") {
        const n = +num, k = `${m.device}|${m.channel || 1}|${n}`;
        if (this.hires.has(k) && n < 32) {
          const v14 = Math.round(v * 16383);
          out.send([0xb0 | ch, n, v14 >> 7]); out.send([0xb0 | ch, n + 32, v14 & 127]);
        } else out.send([0xb0 | ch, +num, Math.round(v * 127)]);
      } else if (kind === "note") out.send([0x90 | ch, +num, v >= 0.5 ? Math.max(1, Math.round(v * 127)) : 0]);
      else if (kind === "pb") { const v14 = Math.round(v * 16383); out.send([0xe0 | ch, v14 & 127, v14 >> 7]); }
    } catch { /* el dispositivo se desconectó */ }
  }
  firstOutputName() { const o = this.access && [...this.access.outputs.values()].find(x => x.state === "connected"); return o ? o.name : ""; }

  /** MIDI Clock de salida a un dispositivo (null para parar). */
  setClockOut(name, getBpm, getPlaying) {
    clearInterval(this.clockOut?.timer);
    this.clockOut = null;
    if (!name) return;
    const state = { name, next: performance.now(), wasPlaying: false };
    state.timer = setInterval(() => {
      const out = this.outputFor(name);
      if (!out) return;
      const playing = getPlaying();
      try {
        if (playing && !state.wasPlaying) out.send([0xfa]);
        if (!playing && state.wasPlaying) out.send([0xfc]);
      } catch {}
      state.wasPlaying = playing;
      const tick = 60000 / (Math.max(20, getBpm()) * 24);
      const horizon = performance.now() + 60;
      if (state.next < performance.now() - 100) state.next = performance.now();
      while (state.next < horizon) { try { out.send([0xf8], state.next); } catch {} state.next += tick; }
    }, 25);
    this.clockOut = state;
  }
}
