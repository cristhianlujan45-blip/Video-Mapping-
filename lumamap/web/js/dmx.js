// web/js/dmx.js
// Iluminación: pixel mapping, fixtures, universos DMX, snapshots, entrada DMX.
//
//   VIDEO / IMAGEN / CÁMARA / ANIMACIÓN (composición de la salida)
//        ↓  muestreo en la GPU (solo se leen los píxeles de los LED)
//   PIXEL MAP → RGB / RGBW → universos DMX → Art-Net / sACN → nodo → LED / fixture
//
// · La composición se dibuja con las fuentes ya decodificadas del editor (no se
//   vuelve a decodificar ningún video) en un lienzo pequeño, y un shader calcula
//   el color de cada LED (con promedio de área, brillo, contraste, saturación,
//   gamma e intensidad). Solo ese puñado de bytes vuelve a la CPU, de forma
//   asíncrona (PBO + fence), sin frenar el render.
// · Los universos «virtuales» permiten preparar todo sin hardware; luego se
//   cambian a Art-Net o sACN sin rehacer el pixel map (el mapa apunta a números
//   de universo, no a direcciones de red).
// · El envío por red lo hace el servicio DMX de escritorio (proceso aparte).
import { Renderer } from "./renderer.js";
import { Compositor, sceneLayers } from "./compose.js";
import { patchPixels, pixelPositions, writePixel, rgbToRgbw, channelsPerPixel } from "./dmxproto.js";
import { registerParams } from "./params.js";
import { uid, defaultPixelMap } from "./model.js";
import { prepareFx, prepareMove, defaultLightFx } from "./lightfx.js";
import { channelsOf, kindOf } from "./rdm.js";
import { UsbDmx } from "./usbdmx.js";

/** Tipos de fixture: canales en orden. */
export const FIXTURE_TYPES = {
  rgb: { label: "RGB (3 canales)", channels: ["red", "green", "blue"] },
  rgbw: { label: "RGBW (4 canales)", channels: ["red", "green", "blue", "white"] },
  drgb: { label: "Dimmer + RGB (4)", channels: ["dimmer", "red", "green", "blue"] },
  drgbw: { label: "Dimmer + RGBW (5)", channels: ["dimmer", "red", "green", "blue", "white"] },
  drgbws: { label: "Dimmer + RGBW + estrobo (6)", channels: ["dimmer", "red", "green", "blue", "white", "strobe"] },
  dimmer: { label: "Dimmer (1 canal)", channels: ["dimmer"] },
  par7: { label: "PAR LED 7 canales", channels: ["dimmer", "red", "green", "blue", "white", "strobe", "custom"] },
  moving: { label: "Cabeza móvil (11)", channels: ["pan", "panFine", "tilt", "tiltFine", "speed", "dimmer", "strobe", "red", "green", "blue", "white"] },
  rgbwa: { label: "Dimmer + RGBWA (6)", channels: ["dimmer", "red", "green", "blue", "white", "amber"] },
  rgbwauv: { label: "Dimmer + RGBWA + UV + estrobo (8)", channels: ["dimmer", "red", "green", "blue", "white", "amber", "uv", "strobe"] },
  wash: { label: "Cabeza móvil wash (14)", channels: ["pan", "panFine", "tilt", "tiltFine", "speed", "dimmer", "strobe", "red", "green", "blue", "white", "custom", "custom", "custom"] },
  beam: { label: "Cabeza móvil beam / spot (16)", channels: ["pan", "panFine", "tilt", "tiltFine", "speed", "dimmer", "strobe", "color", "gobo", "custom", "custom", "custom", "custom", "custom", "custom", "custom"] },
  laser7: { label: "Láser DMX (7)", channels: ["intensity", "custom", "custom", "custom", "custom", "speed", "color"] },
  laser13: { label: "Láser RGB DMX (13)", channels: ["intensity", "custom", "custom", "custom", "custom", "custom", "custom", "custom", "custom", "speed", "red", "green", "blue"] },
  strobe: { label: "Estrobo (2)", channels: ["dimmer", "strobe"] },
  fog: { label: "Máquina de humo (1)", channels: ["intensity"] },
  uv: { label: "Luz UV (3)", channels: ["dimmer", "uv", "strobe"] },
  blinder: { label: "Blinder 2 lámparas (2)", channels: ["dimmer", "dimmer"] },
  custom: { label: "Personalizado", channels: ["custom"] },
};
/** Respuestas de la detección guiada → tipo de canal. */
export const PROBE_ANSWERS = [
  ["dimmer", "Se encendió / brillo"], ["red", "Rojo"], ["green", "Verde"], ["blue", "Azul"], ["white", "Blanco"], ["amber", "Ámbar"], ["uv", "UV / violeta"],
  ["pan", "Se movió de lado"], ["tilt", "Se movió arriba/abajo"], ["strobe", "Parpadea (estrobo)"], ["color", "Cambió el color (rueda)"], ["gobo", "Cambió la figura"],
  ["speed", "Cambió la velocidad"], ["custom", "Otra cosa"], ["", "No pasó nada"],
];
export const CHANNEL_TYPES = [
  ["dimmer", "Dimmer"], ["red", "Rojo"], ["green", "Verde"], ["blue", "Azul"], ["white", "Blanco"], ["amber", "Ámbar"], ["uv", "UV"],
  ["strobe", "Estrobo"], ["pan", "Pan"], ["panFine", "Pan fino"], ["tilt", "Tilt"], ["tiltFine", "Tilt fino"], ["speed", "Velocidad"],
  ["color", "Rueda de color"], ["gobo", "Gobo"], ["intensity", "Intensidad"], ["custom", "Personalizado"],
];
const COLOR_CH = { red: 0, green: 1, blue: 2, white: 3, amber: 4, uv: 5 };
const DEF_VALUE = { dimmer: 255, intensity: 255, pan: 128, tilt: 128 };
export const TEST_COLORS = { red: [255, 0, 0, 0], green: [0, 255, 0, 0], blue: [0, 0, 255, 0], white: [255, 255, 255, 255], full: [255, 255, 255, 255], off: [0, 0, 0, 0] };

const TW = 256;   // ancho de la textura de LED
/** Parte fina (16 bits) de un valor 0..1: el byte bajo. */
const frac256 = (v) => (Math.max(0, Math.min(1, v)) * 65535) & 255;

/* ======================================================================
   Muestreo en la GPU
   ====================================================================== */
const SAMPLE_VS = `#version 300 es
in vec2 a_pos; void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }`;
const SAMPLE_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc;      // composición
uniform highp sampler2D uPts; // por LED: x, y (uv), radio x, radio y
uniform int uTaps;
uniform vec4 uAdj;           // brillo, contraste, saturación, gamma
uniform float uIntensity;
out vec4 o;
void main(){
  vec4 d = texelFetch(uPts, ivec2(gl_FragCoord.xy), 0);
  vec3 c = vec3(0.0);
  if (uTaps <= 1) c = texture(uSrc, d.xy).rgb;
  else {
    float n = float(uTaps);
    for (int j = 0; j < 8; j++) { if (j >= uTaps) break;
      for (int i = 0; i < 8; i++) { if (i >= uTaps) break;
        vec2 off = ((vec2(float(i), float(j)) + 0.5) / n - 0.5) * 2.0 * d.zw;
        c += texture(uSrc, clamp(d.xy + off, 0.0, 1.0)).rgb; } }
    c /= n * n;
  }
  c = (c - 0.5) * uAdj.y + 0.5;
  c *= uAdj.x;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, uAdj.z);
  c = pow(max(c, 0.0), vec3(1.0 / max(uAdj.w, 0.05)));
  o = vec4(clamp(c * uIntensity, 0.0, 1.0), 1.0);
}`;

class Sampler {
  constructor(shared) {
    this.canvas = new OffscreenCanvas(320, 180);
    this.r = new Renderer(this.canvas);
    this.comp = new Compositor(this.r, null, shared);
    const gl = this.gl = this.r.gl;
    const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    this.prog = gl.createProgram();
    gl.attachShader(this.prog, sh(gl.VERTEX_SHADER, SAMPLE_VS));
    gl.attachShader(this.prog, sh(gl.FRAGMENT_SHADER, SAMPLE_FS));
    gl.bindAttribLocation(this.prog, 0, "a_pos");
    gl.linkProgram(this.prog);
    if (!gl.getProgramParameter(this.prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.prog));
    this.u = {};
    for (const n of ["uSrc", "uPts", "uTaps", "uAdj", "uIntensity"]) this.u[n] = gl.getUniformLocation(this.prog, n);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.srcTex = new Map();   // pantalla -> textura con la composición
    this.ptsTex = gl.createTexture();
    this.ledTex = gl.createTexture();
    this.fbo = gl.createFramebuffer();
    this.pbo = gl.createBuffer();
    this.rows = 0; this.fence = null; this.pending = null; this.result = null;
  }

  /** Dibuja la composición de una pantalla en el lienzo pequeño y la copia a una textura. */
  compose(screen, f, sw, sh) {
    const gl = this.gl, P = f.project;
    this.r.resize(sw, sh);
    this.comp.frame(P, {
      layers: f.layers, time: f.time, levels: f.levels, view: { sx: sw / P.width, sy: sh / P.height, tx: 0, ty: 0 },
      master: f.master * (P.settings.screens?.[screen]?.master ?? 1), blackout: false, clear: [0, 0, 0, 1], screen,
    });
    let t = this.srcTex.get(screen);
    if (!t) {
      t = { tex: gl.createTexture(), w: 0, h: 0 };
      this.srcTex.set(screen, t);
    }
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    if (t.w !== sw || t.h !== sh) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, sw, sh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      t.w = sw; t.h = sh;
    }
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, sw, sh);
  }

  /**
   * jobs: [{ screen, pts: Float32Array (x,y,rx,ry por LED, uv con y hacia abajo), n, taps, adj:[b,c,s,g], intensity }]
   * Lanza el muestreo; el resultado (Uint8Array RGBA por LED) llega en el siguiente tick (collect()).
   */
  run(jobs, f, sw, sh) {
    const gl = this.gl;
    for (const sc of new Set(jobs.map(j => j.screen))) this.compose(sc, f, sw, sh);
    // Textura de posiciones (una fila por cada 256 LED; cada trabajo empieza en fila nueva).
    let rows = 0;
    for (const j of jobs) { j.row = rows; rows += Math.ceil(j.n / TW); }
    rows = Math.max(1, rows);
    const pts = new Float32Array(TW * rows * 4);
    for (const j of jobs) pts.set(j.pts, j.row * TW * 4);
    gl.bindTexture(gl.TEXTURE_2D, this.ptsTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, TW, rows, 0, gl.RGBA, gl.FLOAT, pts);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D, this.ledTex);
    if (this.rows !== rows) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, TW, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      this.rows = rows;
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, TW * rows * 4, gl.STREAM_READ);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.ledTex, 0);
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    gl.disable(gl.BLEND);
    gl.enable(gl.SCISSOR_TEST);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.ptsTex); gl.uniform1i(this.u.uPts, 1);
    gl.activeTexture(gl.TEXTURE0); gl.uniform1i(this.u.uSrc, 0);
    gl.viewport(0, 0, TW, rows);
    for (const j of jobs) {
      gl.bindTexture(gl.TEXTURE_2D, this.srcTex.get(j.screen).tex);
      gl.uniform1i(this.u.uTaps, j.taps);
      gl.uniform4f(this.u.uAdj, ...j.adj);
      gl.uniform1f(this.u.uIntensity, j.intensity);
      gl.scissor(0, j.row, TW, Math.ceil(j.n / TW));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.disable(gl.SCISSOR_TEST);
    // Lectura asíncrona: a un buffer de la GPU; se recoge cuando la GPU termina.
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
    gl.readPixels(0, 0, TW, rows, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
    if (this.fence) gl.deleteSync(this.fence);
    this.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    this.pending = { jobs, rows };
  }

  /** Recoge el último muestreo si la GPU ya terminó: { jobs, data } o null. */
  collect() {
    const gl = this.gl;
    if (!this.pending || !this.fence) return null;
    const st = gl.getSyncParameter(this.fence, gl.SYNC_STATUS);
    if (st !== gl.SIGNALED) return null;
    const data = new Uint8Array(TW * this.pending.rows * 4);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, data);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    const out = { jobs: this.pending.jobs, data };
    this.pending = null;
    gl.deleteSync(this.fence); this.fence = null;
    return out;
  }
}

/* ======================================================================
   Motor DMX
   ====================================================================== */
const hexRgb = (hx) => { const n = parseInt(String(hx || "#ffffff").slice(1), 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

export class DmxEngine {
  constructor(app) {
    this.app = app;
    this.port = null;            // canal con el servicio de red (escritorio)
    this.service = { ready: false, interfaces: [], nodes: [], stats: null, error: "" };
    this.out = new Map();        // universo -> Uint8Array(512) del último fotograma
    this.inputs = new Map();     // "artnet:N" / "sacn:N" -> Uint8Array(512)
    this.ledColors = new Map();  // pixelMapId -> Uint8Array RGBA (para la vista previa)
    this.sampler = null; this.samplerError = "";
    this.lastTick = 0; this.lastCfgSig = ""; this.cache = new Map();
    this.test = null;            // { color, target }
    this.snapshot = null;        // id de la snapshot activa
    this.blackout = false;       // apagón solo de luces
    this.frames = 0; this.lastSendMs = 0;
    this.onUpdate = null;        // refresco del panel
    this.detected = null;        // luces RDM detectadas { devices, progress, done }
    this.lasers = [];            // DAC láser detectados en la red
    this.probe = null;           // detección guiada { universe, address, index, count, known }
    // Interfaz USB-DMX: se abre sola si ya estaba autorizada y al enchufarla.
    this.usb = new UsbDmx();
    this.usb.onChange = () => { if (this.usb.ready) this.useUsb(); this.onUpdate?.("usb"); };
    if (this.usb.supported && globalThis.LumaDesktop) {
      this.usb.auto();
      try { navigator.serial.addEventListener("connect", () => this.usb.auto()); } catch {}
    }
    registerDmxParams(this);
  }
  get cfg() { return this.app.S.project.settings.dmx; }
  /** ¿Hay salida de red real? Windows (servicio aparte) o Android (UDP nativo de la app). */
  get desktop() { return !!globalThis.LumaDesktop?.dmxStart || !!globalThis.LumaNative?.udpOpen; }

  /* ---------------- Servicio de red ---------------- */
  connect() {
    if (!this.desktop || this.connecting) return;
    // Android: el mismo núcleo de red dentro de la app, con UDP nativo.
    if (!globalThis.LumaDesktop?.dmxStart) {
      if (this.port) return;
      this.connecting = true;
      import("./dmx-android.js").then(({ startAndroidDmx }) => {
        const { port } = startAndroidDmx(globalThis.LumaNative);
        this.port = port;
        this.port.onmessage = (ev) => this.onService(ev.data);
        this.port.start?.();
        this.lastCfgSig = ""; this.connecting = false;
      }).catch((e) => { this.service.error = e.message; this.connecting = false; });
      return;
    }
    this.connecting = true;
    if (!this.portListener) {
      this.portListener = (e) => {
        if (e.source !== window || e.data !== "lumamap:dmx-port" || !e.ports?.[0]) return;
        this.port?.close?.();
        this.port = e.ports[0];
        this.port.onmessage = (ev) => this.onService(ev.data);
        this.port.start?.();
        this.lastCfgSig = "";
        this.connecting = false;
      };
      window.addEventListener("message", this.portListener);
      window.LumaDesktop.onDmxExit?.(() => {
        this.port = null; this.service.ready = false; this.service.error = "El servicio DMX se reinició";
        setTimeout(() => this.connect(), 800);
      });
    }
    window.LumaDesktop.dmxStart().catch((e) => { this.service.error = e.message; this.connecting = false; });
  }
  onService(m) {
    if (m.t === "ready") { this.service.ready = true; this.service.interfaces = m.interfaces; this.service.error = ""; this.sendConfig(true); }
    else if (m.t === "interfaces") this.service.interfaces = m.list;
    else if (m.t === "stats") this.service.stats = m.stats;
    else if (m.t === "nodes") this.service.nodes = m.list;
    else if (m.t === "input") this.onInput(m.list);
    else if (m.t === "rdm") this.detected = { devices: m.devices || [], progress: m.progress || "", done: !!m.done, error: m.error || "" };
    else if (m.t === "lasers") this.lasers = m.list;
    this.onUpdate?.(m.t);
  }

  /** Al conectar una interfaz USB-DMX: el primer universo (o el 1) sale por ella. */
  useUsb() {
    const c = this.cfg;
    if (c.universes.some(u => u.protocol === "usb")) return;
    let u = c.universes.find(x => x.protocol === "virtual") || null;
    if (!u) { u = { num: c.universes.length ? Math.max(...c.universes.map(x => x.num)) + 1 : 1, name: "", portAddress: 0, sacnUniverse: 1, dest: "broadcast", ip: "", enabled: true, delayMs: 0, priority: 100 }; c.universes.push(u); }
    u.protocol = "usb"; u.name = "USB-DMX";
    this.app.changed?.({ panel: true });
  }

  /* ---------------- Detección automática (RDM) ---------------- */
  /** Pide a todos los nodos la lista de luces RDM y qué es cada una. */
  detectLights() {
    if (!this.port) { this.connect(); setTimeout(() => this.port && this.detectLights(), 800); return; }
    this.detected = { devices: [], progress: "Buscando luces…", done: false, error: "" };
    this.port.postMessage({ t: "rdm-discover" });
  }
  /** ¿Esta luz detectada ya está en el proyecto? (mismo UID) */
  hasDetected(dev) { return this.cfg.fixtures.some(f => f.rdmUid === dev.uid); }
  /**
   * Añade una luz detectada: universo de su salida (Art-Net a la IP del nodo),
   * su dirección DMX, sus canales tal como los describe y un efecto para empezar.
   */
  addDetected(dev, names = {}) {
    const c = this.cfg;
    if (this.hasDetected(dev)) return null;
    let u = c.universes.find(x => x.protocol === "artnet" && (x.portAddress ?? x.num - 1) === dev.portAddress);
    if (!u) {
      const num = Math.max(0, ...c.universes.map(x => x.num)) + 1;
      u = { num, name: dev.model || "", protocol: "artnet", portAddress: dev.portAddress, sacnUniverse: num, dest: "unicast", ip: dev.ip, enabled: true, delayMs: 0, priority: 100 };
      c.universes.push(u); c.universes.sort((a, b) => a.num - b.num);
    } else if (u.protocol === "artnet" && !u.ip) Object.assign(u, { dest: "unicast", ip: dev.ip });
    const channels = channelsOf(dev, names);
    const hasColor = channels.some(ch => ch.type in COLOR_CH), moving = channels.some(ch => ch.type === "pan" || ch.type === "tilt");
    const n = c.fixtures.length;
    const f = { id: uid("fix"), name: dev.label || dev.model || kindOf(dev), type: "custom", universe: u.num, address: Math.max(1, dev.startAddress || 1),
      channels, values: [], x: 0.1 + ((n * 0.13) % 0.8), y: 0.2 + (Math.floor(n / 6) % 4) * 0.15, source: hasColor ? "effect" : "manual", fx: hasColor ? defaultLightFx() : undefined,
      move: moving ? { kind: "none", speed: 1, size: 0.5 } : undefined, screen: 1, enabled: true,
      rdmUid: dev.uid, kind: dev.kind || kindOf(dev), maker: dev.manufacturer || "" };
    c.fixtures.push(f);
    this.ensureUniverses();
    return f;
  }
  sendConfig(force = false) {
    const c = this.cfg;
    const cfg = { iface: c.iface, rate: c.rate, mode: c.mode, discovery: c.discovery, universes: c.universes, inputs: c.inputs };
    const sig = JSON.stringify(cfg);
    if (!force && sig === this.lastCfgSig) return;
    this.lastCfgSig = sig;
    this.port?.postMessage({ t: "config", cfg });
  }
  discover() { this.port?.postMessage({ t: "discover" }); }
  refreshInterfaces() { this.port?.postMessage({ t: "interfaces" }); }

  /* ---------------- Universos ---------------- */
  universe(num) { return this.cfg.universes.find(u => u.num === num) || null; }
  /** Crea (como virtuales) los universos que usan los pixel maps y fixtures y aún no existen: AUTO SPAN. */
  ensureUniverses() {
    const need = new Set();
    for (const pm of this.cfg.pixelMaps) for (const p of this.patchOf(pm).patch) if (p) need.add(p.universe);
    for (const f of this.cfg.fixtures) { need.add(f.universe); if (f.address - 1 + f.channels.length > 512) need.add(f.universe + 1); }
    let added = 0;
    const proto = this.cfg.universes[0];
    for (const n of [...need].sort((a, b) => a - b)) {
      if (this.universe(n)) continue;
      // Si ya hay universos de red, los nuevos siguen el mismo protocolo y destino.
      this.cfg.universes.push({ num: n, name: "", protocol: proto?.protocol || "virtual", dest: proto?.dest || "broadcast", ip: proto?.dest === "unicast" ? proto.ip : "",
        enabled: true, delayMs: proto?.delayMs || 0, priority: 100, portAddress: n - 1, sacnUniverse: n });
      added++;
    }
    this.cfg.universes.sort((a, b) => a.num - b.num);
    return added;
  }

  patchOf(pm) {
    const sig = `${pm.shape}|${pm.cols}|${pm.rows}|${pm.count}|${pm.order}|${pm.serpentine}|${pm.reverse}|${pm.colorOrder}|${pm.universe}|${pm.channel}|${pm.autoSpan}|${pm.align}|${pm.x}|${pm.y}|${pm.w}|${pm.h}|${pm.startAngle}|${pm.arc}|${(pm.points || []).length}`;
    let c = this.cache.get(pm.id);
    if (!c || c.sig !== sig) {
      const pos = pixelPositions(pm);
      const { patch, lastUniverse } = patchPixels(pos.length, { startUniverse: pm.universe, startChannel: pm.channel, order: pm.colorOrder, autoSpan: pm.autoSpan, align: pm.align });
      c = { sig, pos, patch, lastUniverse };
      this.cache.set(pm.id, c);
    }
    return c;
  }

  /* ---------------- Ciclo ---------------- */
  /** Llamado en cada fotograma del editor; trabaja a la frecuencia DMX configurada. */
  tick(now, frame) {
    const c = this.cfg;
    const active = c.enabled || this.monitoring;
    if (!active) return;
    if (this.desktop && !this.port && !this.connecting) this.connect();
    this.sendConfig();
    if (now - this.lastTick < 1000 / Math.max(1, Math.min(60, c.rate || 40)) - 1) return;
    this.lastTick = now;
    const t0 = performance.now();

    // 1) Muestreo de video de la vuelta anterior (asíncrono) y lanzamiento del siguiente.
    const videoMaps = c.pixelMaps.filter(pm => pm.enabled && pm.source === "video");
    const videoFix = c.fixtures.filter(f => f.enabled !== false && f.source === "video" && f.channels.some(ch => ch.type in COLOR_CH));
    if (this.sampler) {
      // Nunca se espera a la GPU: si el muestreo anterior no ha terminado, las luces
      // mantienen el último color y no se lanza otro encima.
      const res = this.sampler.collect();
      if (res) {
        for (const j of res.jobs) {
          const off = j.row * TW * 4;
          this.ledColors.set(j.id, res.data.subarray(off, off + j.n * 4).slice());
        }
      }
    }
    if ((videoMaps.length || videoFix.length) && frame && !this.sampler?.pending) {
      try {
        if (!this.sampler) this.sampler = new Sampler(this.app.sharedComp());
        const P = frame.project;
        const sw = Math.max(32, Math.min(1920, c.sampleRes || 320)), sh = Math.max(18, Math.round(sw * P.height / P.width));
        const jobs = [];
        for (const pm of videoMaps) {
          const { pos } = this.patchOf(pm);
          const n = pos.length, pts = new Float32Array(Math.ceil(n / TW) * TW * 4);
          // Radio de muestreo: media celda (promedio del área de cada LED) o un punto.
          const cell = pm.shape === "line" || pm.shape === "circle" || pm.shape === "arc" ? Math.max(pm.w, pm.h) / Math.max(1, n) : Math.max(pm.w / Math.max(1, pm.cols), pm.h / Math.max(1, pm.rows));
          let rx = pm.sampling === "point" ? 0 : cell / 2, ry = rx * P.width / P.height;
          if (pm.average) {           // un solo color para todo el mapa: promedio de su área
            for (let i = 0; i < n; i++) pts.set([pm.x + pm.w / 2, 1 - (pm.y + pm.h / 2), pm.w / 2, pm.h / 2], i * 4);
          } else for (let i = 0; i < n; i++) pts.set([pos[i][0], 1 - pos[i][1], rx, ry], i * 4);
          jobs.push({ id: pm.id, screen: pm.screen || 1, pts, n, taps: pm.average ? 8 : pm.sampling === "point" ? 1 : 3,
            adj: [pm.brightness, pm.contrast, pm.saturation, pm.gamma], intensity: pm.intensity * this.paramValue(`dmx/map/${pm.id}/intensity`, 1) });
        }
        for (const f of videoFix) {
          const pts = new Float32Array(TW * 4);
          pts.set([f.x, 1 - f.y, 0.02, 0.02 * P.width / P.height], 0);
          jobs.push({ id: "fx:" + f.id, screen: f.screen || 1, pts, n: 1, taps: 3, adj: [1, 1, 1, 1], intensity: 1 });
        }
        this.sampler.run(jobs, frame, sw, sh);
        this.samplerError = "";
      } catch (e) { this.samplerError = e.message; console.warn("DMX sampler", e); }
    }

    // 2) Universos
    const bufs = new Map();
    for (const u of c.universes) bufs.set(u.num, new Uint8Array(512));
    const bufFor = (n) => { let b = bufs.get(n); if (!b) bufs.set(n, b = new Uint8Array(512)); return b; };
    const master = c.master * this.paramValue("dmx/master", 1);
    const test = this.test ? TEST_COLORS[this.test.color] : null;
    const rgbw = [0, 0, 0, 0, 0, 0];

    // Efectos de luz (biblioteca): reloj del show, tempo y música.
    const secs = now / 1000, lv = this.app.S.levels || {}, bpm = this.app.S.project.settings.bpm || 120;
    const fxOut = [0, 0, 0];
    for (const pm of c.pixelMaps) {
      if (!pm.enabled) continue;
      const { patch, pos } = this.patchOf(pm);
      let col = this.ledColors.get(pm.id);
      if (pm.source === "effect") {
        // El efecto se calcula para cada LED según su posición; se guarda como si fuera video (vista previa y monitor).
        const run = prepareFx(pm.fx || defaultLightFx(), secs, lv, bpm), n = pos.length;
        if (!col || col.length !== n * 4) this.ledColors.set(pm.id, col = new Uint8Array(n * 4));
        for (let i = 0; i < n; i++) { run(i, n, pos[i][0], pos[i][1], fxOut); col[i * 4] = fxOut[0]; col[i * 4 + 1] = fxOut[1]; col[i * 4 + 2] = fxOut[2]; col[i * 4 + 3] = 255; }
      }
      const fixed = hexRgb(pm.color);
      const isW = channelsPerPixel(pm.colorOrder) >= 4;
      const k = master * (pm.source === "video" ? 1 : pm.intensity * this.paramValue(`dmx/map/${pm.id}/intensity`, 1));
      for (let i = 0; i < patch.length; i++) {
        const p = patch[i];
        if (!p) continue;
        let r, g, b;
        if (test && (!this.test.target || this.test.target === pm.id)) { [r, g, b] = test; }
        else if (pm.source === "video" || pm.source === "effect") { if (!col) continue; r = col[i * 4]; g = col[i * 4 + 1]; b = col[i * 4 + 2]; }
        else if (pm.source === "color") [r, g, b] = fixed;
        else continue;
        r *= k; g *= k; b *= k;
        if (isW) {
          const q = test && this.test.color === "white" ? [0, 0, 0, 255 * master] : rgbToRgbw(r, g, b);
          rgbw[0] = q[0]; rgbw[1] = q[1]; rgbw[2] = q[2]; rgbw[3] = q[3]; rgbw[4] = 0; rgbw[5] = 0;
        } else { rgbw[0] = r; rgbw[1] = g; rgbw[2] = b; rgbw[3] = 0; }
        for (let q = 0; q < 6; q++) rgbw[q] = Math.round(Math.max(0, Math.min(255, rgbw[q])));
        writePixel(bufFor, p.universe, p.channel, pm.colorOrder, rgbw);
      }
    }
    // Focos con efecto: cada foco es un «LED» del efecto (en su orden), y las cabezas móviles se mueven solas.
    const fxFix = c.fixtures.filter(f => f.enabled !== false && f.source === "effect");
    const moving = c.fixtures.filter(f => f.enabled !== false && f.move?.kind && f.move.kind !== "none");
    for (const f of c.fixtures) {
      if (f.enabled === false) continue;
      let col = this.ledColors.get("fx:" + f.id);
      if (f.source === "effect") {
        const k = fxFix.indexOf(f);
        prepareFx(f.fx || defaultLightFx(), secs, lv, bpm)(k, fxFix.length, f.x ?? 0.5, f.y ?? 0.5, fxOut);
        if (!col) this.ledColors.set("fx:" + f.id, col = new Uint8Array(4));
        col[0] = fxOut[0]; col[1] = fxOut[1]; col[2] = fxOut[2]; col[3] = 255;
      }
      const mv = moving.includes(f) ? prepareMove(f.move, secs, bpm)(moving.indexOf(f), moving.length) : null;
      f.channels.forEach((ch, i) => {
        let v = f.values[i] ?? ch.def ?? DEF_VALUE[ch.type] ?? 0;
        if (mv && (ch.type === "pan" || ch.type === "tilt")) v = (Math.max(0, Math.min(1, mv[ch.type === "pan" ? 0 : 1])) * 65535) >> 8;
        if (mv && (ch.type === "panFine" || ch.type === "tiltFine")) v = Math.round(frac256(mv[ch.type === "panFine" ? 0 : 1]));
        v = this.paramValue(`dmx/fix/${f.id}/${i}`, v);
        if (ch.type in COLOR_CH) {
          if (test && (!this.test.target || this.test.target === f.id)) v = test[Math.min(3, COLOR_CH[ch.type])] ?? 0;
          else if ((f.source === "video" || f.source === "effect") && col) {
            const j = COLOR_CH[ch.type];
            v = j < 3 ? col[j] : j === 3 ? Math.min(col[0], col[1], col[2]) : 0;
          }
          v *= master;
        } else if ((ch.type === "dimmer" || ch.type === "intensity") && test) v = 255;
        const addr = f.address - 1 + i, u = f.universe + Math.floor(addr / 512);
        bufFor(u)[addr % 512] = Math.round(Math.max(0, Math.min(255, v)));
      });
    }
    // Detección guiada: un canal al máximo (y los ya identificados como brillo, para ver el color).
    if (this.probe) {
      const pb = this.probe, b = bufFor(pb.universe);
      for (let i = 0; i < pb.count; i++) b[(pb.address - 1 + i) % 512] = 0;
      pb.known.forEach((t, i) => { if (t === "dimmer" || t === "intensity") b[(pb.address - 1 + i) % 512] = 255; });
      b[(pb.address - 1 + pb.index) % 512] = 255;
    }
    // 3) Snapshot activa (o la de EMERGENCIA): sustituye los universos que guardó.
    const em = this.app.S.emergency ? this.app.S.project.settings.show.emergency.snapshot : null;
    const snapId = em || this.snapshot;
    if (snapId) {
      const sn = c.snapshots.find(s => s.id === snapId);
      if (sn) for (const [num, arr] of Object.entries(sn.data)) bufFor(+num).set(arr.slice(0, 512));
    }
    // 4) Apagón (de luces o el general si así se configura): todo a cero.
    const dark = this.blackout || this.paramValue("dmx/blackout", 0) >= 0.5 || (c.followBlackout && this.app.S.blackout) || (this.app.S.emergency && !em);
    if (dark) for (const b of bufs.values()) b.fill(0);
    if (dark !== this.sentBlackout) { this.sentBlackout = dark; this.port?.postMessage({ t: "blackout", on: dark }); }

    this.out = bufs;
    this.frames++;
    // USB-DMX: el universo marcado como «usb» sale por la interfaz (una por universo).
    if (this.usb.ready && c.enabled) {
      const u = c.universes.find(x => x.protocol === "usb" && x.enabled !== false);
      if (u) this.usb.send(bufs.get(u.num) || (this.ZERO || (this.ZERO = new Uint8Array(512))));
    }
    if (c.enabled && this.port) {
      const list = [...bufs.entries()].filter(([n]) => this.universe(n)?.protocol !== "virtual");
      if (list.length) this.port.postMessage({ t: "frame", at: Date.now(), list });
    }
    this.lastSendMs = performance.now() - t0;
  }

  /** Valor de un parámetro DMX con las modulaciones del motor (audio, tracking…). */
  paramValue(id, base) {
    const m = this.app.S.mods?.find(x => x.id === id);
    return m ? m.value : base;
  }

  /* ---------------- Entrada DMX → motor de parámetros ---------------- */
  onInput(list) {
    const P = this.app.params;
    for (const [key, data] of list) {
      const prev = this.inputs.get(key);
      this.inputs.set(key, data);
      for (let ch = 0; ch < 512; ch++) {
        if (prev && prev[ch] === data[ch]) continue;
        if (!prev && data[ch] === 0) continue;
        P.input({ src: "dmx", device: key.split(":")[0], key: `${key}:c${ch + 1}`, v: data[ch] / 255, raw: data[ch] >> 1, label: `${key} canal ${ch + 1} = ${data[ch]}` });
      }
    }
  }

  /* ---------------- Snapshots ---------------- */
  capture(name) {
    const data = {};
    for (const [n, b] of this.out) data[n] = [...b];
    const sn = { id: uid("snap"), name: name || `Snapshot ${this.cfg.snapshots.length + 1}`, data };
    this.cfg.snapshots.push(sn);
    return sn;
  }
  recall(id) { this.snapshot = id || null; }

  /* ---------------- Altas ---------------- */
  addPixelMap(opts = {}) {
    const pm = { ...defaultPixelMap(), ...opts, id: uid("pm") };
    if (pm.shape !== "line" && pm.shape !== "circle" && pm.shape !== "arc") pm.count = pm.cols * pm.rows;
    pm.name = opts.name || `Pixel map ${this.cfg.pixelMaps.length + 1}`;
    this.cfg.pixelMaps.push(pm);
    this.ensureUniverses();
    return pm;
  }
  addFixture(type = "drgb", opts = {}) {
    const T = FIXTURE_TYPES[type] || FIXTURE_TYPES.rgb;
    // Siguiente dirección libre tras el último fixture del universo.
    const u = opts.universe || 1;
    const used = this.cfg.fixtures.filter(f => f.universe === u).map(f => f.address + f.channels.length);
    const f = { id: uid("fix"), name: opts.name || `${T.label.split(" (")[0]} ${this.cfg.fixtures.length + 1}`, type, universe: u, address: opts.address || Math.max(1, ...used),
      channels: T.channels.map(t => ({ type: t, name: (CHANNEL_TYPES.find(c => c[0] === t) || [, t])[1] })), values: [], x: 0.5, y: 0.5, source: "video", screen: 1, enabled: true, ...opts };
    this.cfg.fixtures.push(f);
    this.ensureUniverses();
    return f;
  }

  /**
   * Alta fácil de una luz (modo simple): se coloca sola en el escenario y en el
   * primer canal libre, y empieza con un efecto para que se vea algo al instante.
   */
  addLight(kind, opts = {}) {
    const c = this.cfg;
    const lastUsed = () => {
      let u = 0;
      for (const pm of c.pixelMaps) u = Math.max(u, this.patchOf(pm).lastUniverse || pm.universe);
      for (const f of c.fixtures) u = Math.max(u, f.universe + (f.address - 1 + f.channels.length > 512 ? 1 : 0));
      return u;
    };
    const n = c.pixelMaps.length + c.fixtures.length, y = 0.15 + (n % 6) * 0.13;
    const fx = defaultLightFx(opts.fx);
    const strip = (o) => this.addPixelMap({ universe: lastUsed() + 1, channel: 1, source: "effect", fx, sampling: "average", ...o });
    switch (kind) {
      case "strip": return strip({ name: `Tira LED ${n + 1}`, shape: "line", count: opts.count || 60, cols: opts.count || 60, rows: 1, x: 0.1, y, w: 0.8, h: 0.02 });
      case "bar": return strip({ name: `Barra LED ${n + 1}`, shape: "line", count: opts.count || 12, cols: opts.count || 12, rows: 1, x: 0.3, y, w: 0.4, h: 0.02 });
      case "ring": return strip({ name: `Aro LED ${n + 1}`, shape: "circle", count: opts.count || 24, cols: opts.count || 24, rows: 1, x: 0.4, y: 0.35, w: 0.2, h: 0.3 });
      case "matrix": return strip({ name: `Matriz LED ${n + 1}`, shape: "grid", cols: opts.cols || 16, rows: opts.rows || 16, serpentine: true, x: 0.3, y: 0.25, w: 0.4, h: 0.5, fx: defaultLightFx(opts.fx || "Plasma") });
      case "par": case "parw": case "moving": {
        const type = kind === "par" ? "drgb" : kind === "parw" ? "drgbw" : "moving";
        const fixtures = c.fixtures.filter(f => f.type === type);
        const u = fixtures.at(-1)?.universe || (lastUsed() + (c.pixelMaps.length ? 1 : 0)) || 1;
        const f = this.addFixture(type, { universe: u, source: "effect", fx, name: `${kind === "moving" ? "Cabeza móvil" : "Foco PAR"} ${fixtures.length + 1}`,
          ...(kind === "moving" ? { move: { kind: "circle", speed: 1, size: 0.5 } } : {}) });
        f.x = 0.1 + ((fixtures.length * 0.17) % 0.8); f.y = y;
        return f;
      }
    }
    return null;
  }
  /** Todas las luces que tienen color (pixel maps y focos con canales de color). */
  lights() {
    const c = this.cfg;
    return [...c.pixelMaps, ...c.fixtures.filter(f => f.channels.some(ch => ch.type in COLOR_CH))];
  }

  /** Diagnóstico paso a paso: [{ ok, label, detail }]. */
  diagnostics() {
    const c = this.cfg, st = this.service.stats, out = [];
    const net = c.universes.filter(u => u.protocol !== "virtual" && u.enabled !== false);
    if (!this.desktop) return [{ ok: false, label: "Salida de red", detail: "El navegador no puede enviar Art-Net/sACN. Usa la app de Windows (los universos virtuales sí funcionan aquí)." }];
    out.push({ ok: !!this.port && this.service.ready, label: "Servicio DMX", detail: this.port ? "en marcha (proceso aparte)" : this.service.error || "sin arrancar" });
    const iface = this.service.interfaces.find(i => i.address === c.iface);
    out.push({ ok: !!iface, label: "Interfaz de red", detail: iface ? `${iface.name} · ${iface.address} / ${iface.netmask}` : st?.issues?.iface || "Elige la interfaz de red de las luces" });
    out.push({ ok: !!st?.artnetListening, label: "Art-Net (puerto 6454)", detail: st?.issues?.artnetPort || (st?.artnetListening ? "escuchando respuestas y entrada" : "sin escuchar") });
    const online = this.service.nodes.filter(n => n.online);
    out.push({ ok: online.length > 0, label: "Nodo", detail: online.length ? online.map(n => `${n.shortName || n.longName} (${n.ip})`).join(", ") : "Ningún nodo Art-Net respondió (los nodos sACN no responden a la búsqueda: es normal)" });
    out.push({ ok: net.length > 0, label: "Universo", detail: net.length ? net.map(u => `${u.num} ${u.protocol === "sacn" ? "sACN " + u.sacnUniverse : "Art-Net " + u.portAddress}${u.dest === "unicast" ? " → " + u.ip : ""}`).join(" · ") : "Todos los universos son virtuales: cambia alguno a Art-Net o sACN" });
    for (const u of net.filter(u => u.dest === "unicast")) {
      if (iface && u.ip && !sameNet(u.ip, iface)) out.push({ ok: false, label: `Universo ${u.num}`, detail: `La IP ${u.ip} no está en la red de ${iface.address}/${iface.netmask}: revisa la IP del nodo o la interfaz` });
    }
    const sending = (st?.perUniverse || []).filter(p => p.age < 2000).length;
    out.push({ ok: c.enabled && sending > 0 && !(st?.errors > 0 && st?.pps === 0), label: "Salida", detail: !c.enabled ? "Salida DMX apagada (pulsa PLAY de luces)" : sending ? `${sending} universo(s) enviando · ${st.pps.toFixed(0)} paquetes/s${st.errors ? " · " + st.errors + " errores: " + st.lastError : ""}` : st?.lastError || "No sale ningún paquete" });
    return out;
  }
}

function sameNet(ip, iface) {
  const a = ip.split(".").map(Number), b = iface.address.split(".").map(Number), m = iface.netmask.split(".").map(Number);
  return a.length === 4 && a.every((x, i) => (x & m[i]) === (b[i] & m[i]));
}

/* ---------------- Parámetros DMX (MIDI, OSC, audio, tracking, macros…) ---------------- */
function registerDmxParams(eng) {
  registerParams("dmx", (app, id, p) => {
    const c = app.S.project.settings.dmx;
    const mk = (o) => ({ id, def: 0, min: 0, max: 1, group: "Luces", ...o });
    if (p[1] === "master") return mk({ name: "Luces · master", kind: "float", def: 1, get: () => c.master, set: (v) => { c.master = v; } });
    if (p[1] === "blackout") return mk({ name: "Luces · apagón", kind: "bool", get: () => eng.blackout, set: (v) => { eng.blackout = !!v; } });
    if (p[1] === "enabled") return mk({ name: "Luces · salida (PLAY)", kind: "bool", get: () => c.enabled, set: (v) => { c.enabled = !!v; } });
    if (p[1] === "snapshot") {
      if (p[2] === "off") return mk({ name: "Luces · soltar snapshot", kind: "trigger", set: () => eng.recall(null) });
      const sn = c.snapshots.find(s => s.id === p[2]);
      return sn ? mk({ name: `Luces · snapshot «${sn.name}»`, kind: "trigger", set: () => eng.recall(sn.id) }) : null;
    }
    if (p[1] === "test") return TEST_COLORS[p[2]] ? mk({ name: `Luces · prueba ${p[2]}`, kind: "trigger", set: () => { eng.test = p[2] === "off" ? null : { color: p[2] }; } }) : null;
    if (p[1] === "map") {
      const pm = c.pixelMaps.find(x => x.id === p[2]);
      if (!pm) return null;
      if (p[3] === "intensity") return mk({ name: `${pm.name} · intensidad`, kind: "float", def: 1, get: () => pm.intensity, set: (v) => { pm.intensity = v; } });
      if (p[3] === "enabled") return mk({ name: `${pm.name} · activo`, kind: "bool", get: () => pm.enabled, set: (v) => { pm.enabled = !!v; } });
      return null;
    }
    if (p[1] === "fix") {
      const f = c.fixtures.find(x => x.id === p[2]), i = +p[3];
      if (!f || !f.channels[i]) return null;
      const ch = f.channels[i];
      return mk({ name: `${f.name} · ${ch.name || ch.type}`, kind: "float", min: 0, max: 255, def: DEF_VALUE[ch.type] ?? 0, step: 1,
        get: () => f.values[i] ?? ch.def ?? DEF_VALUE[ch.type] ?? 0, set: (v) => { f.values[i] = Math.round(v); } });
    }
    return null;
  }, (app) => {
    const c = app.S.project.settings.dmx;
    const ids = ["dmx/master", "dmx/blackout", "dmx/enabled", "dmx/snapshot/off", ...c.snapshots.map(s => "dmx/snapshot/" + s.id),
      ...["red", "green", "blue", "white", "off"].map(x => "dmx/test/" + x),
      ...c.pixelMaps.flatMap(pm => [`dmx/map/${pm.id}/intensity`, `dmx/map/${pm.id}/enabled`]),
      ...c.fixtures.flatMap(f => f.channels.map((_, i) => `dmx/fix/${f.id}/${i}`))];
    return [{ group: "Luces (DMX)", items: ids.map(id => app.describeParam(id)).filter(Boolean).map(d => ({ id: d.id, name: d.name, kind: d.kind })) }];
  });
}
