// web/js/td/engine.js
// Motor de las redes en la tarjeta gráfica (three.js, un solo contexto WebGL):
//   · cada TOP es una pasada de shader a su propia imagen (render target), solo si alguien la usa;
//   · Feedback TOP (memoria del fotograma anterior), GLSL TOP (tu propio código), Text, Video,
//     Cámara y los shaders de los plugins;
//   · Render TOP: los Objetos 3D (Geometry COMP) con su geometría (SOP), material (MAT, también
//     con imágenes de la red), luces, cámara e instancias movidas por un CHOP;
//   · CHOPs y expresiones con el cocinero de graph.js, con el sonido, la cámara (cuerpo y
//     movimiento), el ratón, el teclado y MIDI/OSC/mando de LumaMap.
// Las imágenes salen a las superficies (fuente «Red de nodos») y a los visores del editor.
import * as THREE from "../../vendor/three/three.module.min.js";
import { mergeGeometries } from "../../vendor/three/addons/utils/BufferGeometryUtils.js";
import { defOf, opDef } from "./ops.js";
import { Cooker, nodeById, nodeByName, netTime, resolveOut, subIn } from "./graph.js";
import { cameraIfReady, getCamera } from "../sources.js";
import { ShaderCache, spectrumFromLevels } from "../isf.js";
import { getShader } from "../plugins.js";
import { Particles } from "./particles.js";

const MOBILE = typeof navigator !== "undefined" && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent || "");
const MAX_SIDE = MOBILE ? 1280 : 2048;

/* ---------------- Shaders ---------------- */
const VERT = `in vec3 position; in vec2 uv; out vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const HEAD = `precision highp float; precision highp int;
in vec2 vUv; out vec4 fragColor;
uniform vec2 res; uniform float time; uniform vec2 px;
uniform sampler2D s0; uniform sampler2D s1; uniform sampler2D s2; uniform sampler2D s3;
uniform float has0; uniform float has1; uniform float has2; uniform float has3;
vec4 tex0(vec2 u) { return texture(s0, u); } vec4 tex1(vec2 u) { return texture(s1, u); }
vec4 tex2(vec2 u) { return texture(s2, u); } vec4 tex3(vec2 u) { return texture(s3, u); }
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
vec3 hsv2rgb(vec3 c) { vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0); return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y); }
vec3 rgb2hsv(vec3 c) { vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0); vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g)); vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r)); float d = q.x - min(q.w, q.y); float e = 1.0e-10; return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x); }
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; } vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); } vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) { const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0); const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy)); vec3 x0 = v - i + dot(i, C.xxx); vec3 g = step(x0.yzx, x0.xyz); vec3 l = 1.0 - g; vec3 i1 = min(g.xyz, l.zxy); vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx; vec3 x2 = x0 - i2 + C.yyy; vec3 x3 = x0 - D.yyy; i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857; vec3 ns = n_ * D.wyz - D.xzx; vec4 j = p - 49.0 * floor(p * ns.z * ns.z); vec4 x_ = floor(j * ns.z); vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy; vec4 y = y_ * ns.x + ns.yyyy; vec4 h = 1.0 - abs(x) - abs(y); vec4 b0 = vec4(x.xy, y.xy); vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0; vec4 s1 = floor(b1) * 2.0 + 1.0; vec4 sh = -step(h, vec4(0.0)); vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy; vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x); vec3 p1 = vec3(a0.zw, h.y); vec3 p2 = vec3(a1.xy, h.z); vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3))); p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0); m = m * m; return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3))); }
float fbm(vec3 p, int oct) { float a = 0.5, s = 0.0; for (int k = 0; k < 8; k++) { if (k >= oct) break; s += a * snoise(p); p *= 2.02; a *= 0.5; } return s; }
`;
const uniName = (k) => "p_" + k;
/** Uniforms de los parámetros numéricos y de color de un operador. */
function paramUniforms(def) {
  return def.params.filter(q => ["f", "i", "t", "m", "c"].includes(q.type)).map(q => `uniform ${q.type === "c" ? "vec3" : "float"} ${uniName(q.k)};`).join("\n");
}
const fragFor = (def, body) => `${HEAD}${paramUniforms(def)}\nvec2 uv;\nvec4 cook() {\n${body}\n}\nvoid main() { uv = vUv; fragColor = cook(); }`;
// Pasadas internas: copiar, encajar una imagen (llenar/estirar/entero, espejo), pasar de lineal a sRGB.
const BLIT = `${HEAD}uniform float flipX; uniform float fit; uniform vec2 srcSize;
void main() { vec2 q = vUv; if (flipX > 0.5) q.x = 1.0 - q.x;
  float ra = res.x / res.y, sa = srcSize.x / max(1.0, srcSize.y);
  if (fit < 0.5 && srcSize.x > 0.0) { if (sa > ra) q.x = 0.5 + (q.x - 0.5) * ra / sa; else q.y = 0.5 + (q.y - 0.5) * sa / ra; }
  else if (fit > 1.5 && srcSize.x > 0.0) { if (sa > ra) { q.y = 0.5 + (q.y - 0.5) * sa / ra; } else { q.x = 0.5 + (q.x - 0.5) * ra / sa; } if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) { fragColor = vec4(0, 0, 0, 1); return; } }
  fragColor = texture(s0, q); }`;
const ENCODE = `${HEAD}void main() { vec4 c = texture(s0, vUv); vec3 l = c.rgb; vec3 s = mix(l * 12.92, 1.055 * pow(max(l, 0.0), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, l)); fragColor = vec4(s, c.a); }`;
const FAIL = `${HEAD}void main() { float k = mod(floor(vUv.x * 16.0) + floor(vUv.y * 9.0), 2.0); fragColor = vec4(mix(vec3(0.35, 0.0, 0.2), vec3(0.6, 0.0, 0.35), k), 1.0); }`;
/** Código del usuario (GLSL TOP): una función cook() o un main() completo. */
function userFrag(def, code) {
  const c = String(code || "");
  const pre = `${HEAD}${paramUniforms(def)}\nuniform float u1; uniform float u2; uniform float u3; uniform float u4;\nvec2 uv;\n`;
  if (/void\s+main\s*\(/.test(c)) return pre + c.replace(/gl_FragColor/g, "fragColor").replace(/texture2D/g, "texture");
  return `${pre}vec4 cook() {\n${c}\n}\nvoid main() { uv = vUv; fragColor = cook(); }`;
}

const FONTS = ["Impact, 'Arial Black', sans-serif", "'Segoe UI', Roboto, Arial, sans-serif", "'Courier New', monospace", "Georgia, 'Times New Roman', serif"];
const hex = (v, d = "#000000") => /^#[0-9a-f]{6}$/i.test(String(v)) ? String(v) : d;

/* ======================================================================
   El motor
   ====================================================================== */
export class NetEngine {
  /** opts: { project: () => proyecto, app?, pool? } */
  constructor(opts = {}) {
    this.opts = opts;
    this.canvas = document.createElement("canvas");
    this.canvas.width = 640; this.canvas.height = 360;
    this.r = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: false, antialias: false, preserveDrawingBuffer: true, powerPreference: "high-performance" });
    this.r.autoClear = false;
    this.shaderErrors = new Map();
    this.compiling = null;
    this.r.debug.onShaderError = (gl, program, vs, fs) => {
      const log = (gl.getShaderInfoLog(fs) || "") + (gl.getProgramInfoLog(program) || "");
      if (this.compiling) this.shaderErrors.set(this.compiling, log.trim().split("\n").filter(Boolean).slice(0, 4).join("\n") || "no compila");
    };
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.qscene = new THREE.Scene(); this.qscene.add(this.quad);
    this.black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); this.black.needsUpdate = true;
    this.mats = new Map();        // clave → RawShaderMaterial
    this.rts = new Map();         // nodo → WebGLRenderTarget
    this.extra = new Map();       // nodo → recursos propios (lienzo de texto, textura de video, escena 3D…)
    this.cookers = new Map();     // red → Cooker
    this.memo = new Map();        // nodo → resultado TOP del fotograma
    this.fb = new Map();          // feedback: nodo → { target, prev }
    this.outCanvases = new Map(); // salida → lienzo 2D
    this.time = -1; this.version = 0; this.frameNo = 0; this.lastT = 0;
    this.pointer = { x: 0.5, y: 0.5, down: 0 };
    this.keys = new Set();
    this.inputs = new Map(); this.learnCb = null;
    this.motionState = new Map();
    this.shaders = null;
    this.topMs = new Map();
    this.history = new Map();     // CHOP → últimos valores (para los visores)
    this.models = new Map();      // archivo de modelo 3D → { geo, ver, err }
    this.recs = new Map();        // Grabar video: nodo → { rec, canvas, t0, chunks… }
    this.installTaps();
  }

  get project() { return this.opts.project?.() || null; }
  net(id) { return this.project?.networks?.find(n => n.id === id) || null; }
  cooker(net) { let c = this.cookers.get(net.id); if (!c) this.cookers.set(net.id, c = new Cooker()); return c; }

  /* ---------------- Entradas de fuera: teclado, MIDI/OSC/mando ---------------- */
  installTaps() {
    if (typeof window !== "undefined" && !this.onKey) {
      this.onKey = (e) => { const k = String(e.key || "").toLowerCase(); if (e.type === "keydown") this.keys.add(k); else this.keys.delete(k); };
      window.addEventListener("keydown", this.onKey, true);
      window.addEventListener("keyup", this.onKey, true);
      window.addEventListener("blur", () => this.keys.clear());
    }
    const P = this.opts.app?.params;
    if (P && !P.__tdTap) {
      const orig = P.input.bind(P);
      P.__tdTap = true;
      P.input = (ev) => {
        const v = ev.v ?? (ev.on ? 1 : 0);
        this.inputs.set(ev.src + "|" + ev.key, v);
        if (this.learnCb && !["audio", "tracking"].includes(ev.src)) { const cb = this.learnCb; this.learnCb = null; try { cb(ev); } catch {} }
        return orig(ev);
      };
    }
  }
  /** Siguiente control que se mueva (MIDI, OSC, mando…) → cb({ src, key }). */
  learn(cb) { this.learnCb = cb; }

  /** Señales del cuerpo para el Cuerpo CHOP (arranca el tracking de esa cámara si hace falta). */
  trackingSignals(cam) {
    const T = this.opts.app?.tracking;
    if (!T) return {};
    const key = cam || T.cfg?.camId || "default";
    let tr = T.trackers?.get(key);
    if (!tr && !this._trackAsk?.[key]) { (this._trackAsk ||= {})[key] = 1; try { tr = T.ensure(key); } catch {} setTimeout(() => { delete this._trackAsk[key]; }, 4000); }
    if (!tr) return {};
    const sig = { ...(tr.signals || {}) };
    const first = tr.people?.find(p => !p.ghost);
    if (first?.lm) { sig.left_hand_x = first.lm[15][0]; sig.right_hand_x = first.lm[16][0]; }
    const hd = tr.hands || [];
    hd.slice(0, 2).forEach((h, k) => { const c = h.lm?.[9]; if (c) { sig[`hand${k + 1}_x`] = c[0]; sig[`hand${k + 1}_y`] = 1 - c[1]; } });
    if (hd[0]?.lm?.[4] && hd[0].lm[8]) { const a = hd[0].lm[4], b = hd[0].lm[8]; sig.pinch = Math.max(0, Math.min(1, 1 - Math.hypot(a[0] - b[0], a[1] - b[1]) / 0.15)); }
    return sig;
  }
  /** Movimiento en la imagen de la cámara (diferencia entre fotogramas, 64×48): cuánto y dónde. */
  motion(cam, sens = 0.5) {
    const key = cam || "default";
    let st = this.motionState.get(key);
    if (!st) { const c = document.createElement("canvas"); c.width = 64; c.height = 48; st = { c, x: c.getContext("2d", { willReadFrequently: true }), prev: null, out: { amount: 0, x: 0.5, y: 0.5 }, f: -1 }; this.motionState.set(key, st); }
    if (st.f === this.frameNo) return st.out;
    st.f = this.frameNo;
    const camObj = cameraIfReady(key);
    if (!camObj) { getCamera(key).catch(() => {}); return st.out; }
    const v = camObj.el;
    if (!v.videoWidth) return st.out;
    st.x.drawImage(v, 0, 0, 64, 48);
    const d = st.x.getImageData(0, 0, 64, 48).data;
    const g = new Uint8Array(64 * 48);
    for (let k = 0; k < g.length; k++) g[k] = (d[k * 4] + d[k * 4 + 1] * 2 + d[k * 4 + 2]) >> 2;
    if (st.prev) {
      const th = 12 + (1 - sens) * 50;
      let n = 0, sx = 0, sy = 0;
      for (let k = 0; k < g.length; k++) if (Math.abs(g[k] - st.prev[k]) > th) { n++; sx += k % 64; sy += (k / 64) | 0; }
      const amount = Math.min(1, n / (g.length * 0.15));
      const o = st.out, a = 0.35;
      o.amount = o.amount + (amount - o.amount) * 0.5;
      if (n > 6) { o.x += ((sx / n) / 63 - o.x) * a; o.y += ((1 - (sy / n) / 47) - o.y) * a; }
    }
    st.prev = g;
    return st.out;
  }
  /** Entorno de un fotograma para los CHOPs. */
  envFor(time, levels) {
    const dt = this.lastT ? Math.max(0, Math.min(0.25, time - this.lastT)) : 1 / 60;
    return {
      t: time, dt, frame: this.frameNo, levels: levels || {}, bpm: levels?.bpm || this.project?.settings?.bpm || 120,
      fft: () => globalThis.__lumaAudio?.()?.fft || (levels ? spectrumFromLevels(levels, this._fft ||= new Uint8Array(256)) : null),
      pointer: this.pointer, keys: this.keys,
      input: (src, key) => this.inputs.get(src + "|" + key) ?? 0,
      inputsAll: (src) => { const out = []; for (const [k, v] of this.inputs) if (k.startsWith(src + "|")) out.push([k.slice(src.length + 1), v]); return out; },
      audioFile: (node, p, local) => this.audioFile(node, p, local),
      tracking: (cam) => this.trackingSignals(cam),
      motion: (cam, sens) => this.motion(cam, sens),
    };
  }

  /* ---------------- Fotogramas ---------------- */
  /** Empieza un fotograma nuevo si el tiempo cambió (lo llaman el editor, las salidas y los visores). */
  ensureFrame(time, levels) {
    if (time === this.time) return;
    // Feedback: antes de olvidar el fotograma anterior, cada memoria copia lo que salió de su TOP.
    for (const [id, f] of this.fb) {
      const src = this.rts.get(f.target);
      if (!src || !f.used) continue;
      f.used = false;
      if (!f.prev || f.prev.width !== src.width || f.prev.height !== src.height) { f.prev?.dispose(); f.prev = this.newRT(src.width, src.height); }
      this.pass(this.mat("blit", BLIT), f.prev, { s0: src.texture, srcSize: [src.width, src.height], fit: 1, flipX: 0 });
      f.ready = true;
      void id;
    }
    this.frameNo++;
    this.lastT = this.time >= 0 ? this.time : time;
    this.time = time; this.levels = levels || {};
    this.memo.clear();
    const env = this.envFor(time, levels);
    // Cada red con el tiempo de su línea de tiempo (me.time, Animación CHOP).
    for (const net of this.project?.networks || []) this.cooker(net).begin(net, { ...env, local: netTime(net) });
    this.lastT = time;
    // CHOPs para los visores: guardan los últimos valores.
  }
  /**
   * Una vez por fotograma desde el editor (con su reloj, que no se para al pausar el show, como
   * absTime en TouchDesigner): cocina lo que se exporta a LumaMap. Devuelve [{ target, value, node }]
   * y el editor lo aplica como modulación (no cambia el proyecto guardado).
   */
  frame(time, levels) {
    this.driven = typeof performance !== "undefined" ? performance.now() : 0;
    this.ensureFrame(time, levels);
    const out = [];
    for (const net of this.project?.networks || []) {
      // Lo que tiene que funcionar aunque nadie use su salida: grabar video y que suene el audio.
      for (const n of net.nodes) {
        if (n.bypass) continue;
        if (n.fam === "TOP" && n.type === "movieout" && (n.p.record || this.recs.has(n.id))) this.top(net, n);
        else if (n.fam === "CHOP" && n.type === "audiofile") this.cooker(net).chop(n);
      }
      if (!net.nodes.some(n => n.type === "export" && n.fam === "CHOP")) continue;
      for (const e of this.cooker(net).exports()) out.push(e);
    }
    return out;
  }
  /** Las salidas y los visores siguen el reloj del editor si lo hay; si no (ventana de salida sola), el suyo. */
  follow(time, levels) { if (!this.driven || performance.now() - this.driven > 250) this.ensureFrame(time, levels); }

  /* ---------------- Recursos de GPU ---------------- */
  newRT(w, h, depth = false) {
    const rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: depth, stencilBuffer: false, type: THREE.UnsignedByteType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
    rt.texture.wrapS = rt.texture.wrapT = THREE.ClampToEdgeWrapping;
    return rt;
  }
  rtFor(id, w, h) {
    let rt = this.rts.get(id);
    if (!rt || rt.width !== w || rt.height !== h) { rt?.dispose(); rt = this.newRT(w, h); this.rts.set(id, rt); }
    return rt;
  }
  mat(key, frag, uniforms = null) {
    let m = this.mats.get(key);
    if (m) return m;
    m = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: frag, uniforms: uniforms || {}, depthTest: false, depthWrite: false, transparent: false });
    const u = m.uniforms;
    for (const k of ["s0", "s1", "s2", "s3"]) u[k] ||= { value: this.black };
    for (const k of ["has0", "has1", "has2", "has3", "time", "flipX", "fit", "u1", "u2", "u3", "u4"]) u[k] ||= { value: 0 };
    u.res ||= { value: new THREE.Vector2(1, 1) }; u.px ||= { value: new THREE.Vector2(0, 0) }; u.srcSize ||= { value: new THREE.Vector2(0, 0) };
    this.mats.set(key, m);
    return m;
  }
  /** Una pasada de shader a `target` (o a la pantalla del motor con viewport). */
  pass(m, target, vals = {}, vp = null) {
    const u = m.uniforms;
    for (const [k, v] of Object.entries(vals)) {
      if (!u[k]) u[k] = { value: v };
      if (Array.isArray(v)) { if (u[k].value?.set) u[k].value.set(...v); else u[k].value = new THREE.Vector2(...v); }
      else u[k].value = v;
    }
    const w = target ? target.width : vp[2], h = target ? target.height : vp[3];
    u.res.value.set(w, h);
    u.time.value = this.time;
    this.quad.material = m;
    this.r.setRenderTarget(target);
    if (target) this.r.setViewport(0, 0, w, h);
    else { this.r.setViewport(vp[0], vp[1], vp[2], vp[3]); this.r.setScissor(vp[0], vp[1], vp[2], vp[3]); this.r.setScissorTest(true); }
    this.r.render(this.qscene, this.cam);
    if (!target) this.r.setScissorTest(false);
  }
  /** Una textura de una imagen/video/lienzo (se vuelve a subir si cambia `key`). */
  elTexture(id, el, key) {
    let x = this.extra.get(id);
    if (!x || x.el !== el) { x?.tex?.dispose(); x = { el, tex: new THREE.Texture(el), key: undefined }; x.tex.minFilter = THREE.LinearFilter; x.tex.generateMipmaps = false; this.extra.set(id, x); }
    if (x.key !== key) { x.tex.needsUpdate = true; x.key = key; }
    return x.tex;
  }

  /* ---------------- Cocinar TOPs ---------------- */
  netRes(net) {
    let [w, h] = net.res || [1280, 720];
    const k = Math.min(1, MAX_SIDE / Math.max(w, h));
    return [Math.max(16, Math.round(w * k)), Math.max(16, Math.round(h * k))];
  }
  /** Imagen de un TOP en este fotograma: { tex, w, h } (null si no hay). */
  top(net, node) {
    if (node?.type === "base") node = resolveOut(net, node, "TOP");   // una subred: lo que sale por su Salida
    if (!node || node.fam !== "TOP") return null;
    if (this.memo.has(node.id)) return this.memo.get(node.id);
    this.memo.set(node.id, null);        // cortafuegos ante referencias circulares (Select, Feedback…)
    const t0 = performance.now();
    let out = null;
    try { out = this.cookTop(net, node); }
    catch (e) { this.cooker(net).errors.set(node.id, String(e.message || e)); out = null; }
    this.topMs.set(node.id, performance.now() - t0);
    this.memo.set(node.id, out);
    return out;
  }
  inputsOf(net, node) { return node.in.map(id => this.top(net, nodeById(net, id))); }
  cookTop(net, node) {
    const def = defOf(node), ck = this.cooker(net), p = ck.params(node);
    const ins = this.inputsOf(net, node);
    if (node.bypass) return ins.find(Boolean) || null;
    const [NW, NH] = this.netRes(net);
    const first = ins.find(Boolean);
    let [w, h] = first ? [first.w, first.h] : [NW, NH];
    switch (def.special) {
      case "resolution": w = Math.max(16, Math.min(MAX_SIDE, p.w | 0)); h = Math.max(16, Math.min(MAX_SIDE, p.h | 0)); break;
      case "select": { const n = nodeByName(net, p.top); return n && n !== node ? this.top(net, n) : null; }
      case "in": return this.top(net, subIn(net, node));
      case "movieout": if (first) this.record(net, node, p, first); return first || null;
      case "feedback": {
        const target = nodeByName(net, p.target);
        let f = this.fb.get(node.id);
        if (!f) this.fb.set(node.id, f = { target: null, prev: null, ready: false, used: false, reset: p.reset });
        if (f.reset !== p.reset) { f.ready = false; f.reset = p.reset; }
        f.target = target?.id || null; f.used = !!target;
        if (f.ready && f.prev && target) return { tex: f.prev.texture, w: f.prev.width, h: f.prev.height };
        return first || null;
      }
      case "text": return this.textTop(net, node, p, NW, NH);
      case "media": return this.mediaTop(node, p, NW, NH);
      case "camera": return this.cameraTop(node, p, NW, NH);
      case "plugin": return this.pluginTop(node, p, NW, NH);
      case "render": return this.renderTop(net, node, p, NW, NH);
      case "glsl": break;
      default: if (def.inputs[0] === 0) [w, h] = [NW, NH];
    }
    // Pasada de shader normal.
    if (def.inputs[0] > 0 && !first) return null;                 // un filtro sin entrada no tiene imagen
    const key = def.special === "glsl" ? "glsl:" + node.id + ":" + hashStr(String(p.code)) : "op:" + def.fam + ":" + def.type;
    if (this.shaderErrors.has(key)) { ck.errors.set(node.id, "Error de GLSL:\n" + this.shaderErrors.get(key)); return this.failImage(node.id, w, h); }
    const m = this.mat(key, def.special === "glsl" ? userFrag(def, p.code) : fragFor(def, def.glsl));
    const rt = this.rtFor(node.id, w, h);
    const vals = {};
    for (const q of def.params) {
      if (q.type === "c") vals[uniName(q.k)] = new THREE.Vector3(...srgb(hex(p[q.k])));
      else if (["f", "i", "t", "m"].includes(q.type)) vals[uniName(q.k)] = +p[q.k] || 0;
    }
    if (def.special === "glsl") for (const k of ["u1", "u2", "u3", "u4"]) vals[k] = +p[k] || 0;
    for (let k = 0; k < 4; k++) { vals["s" + k] = ins[k]?.tex || this.black; vals["has" + k] = ins[k] ? 1 : 0; }
    vals.px = first ? [1 / first.w, 1 / first.h] : [1 / w, 1 / h];
    this.compiling = key;
    this.pass(m, rt, vals);
    this.compiling = null;
    if (this.shaderErrors.has(key)) { ck.errors.set(node.id, "Error de GLSL:\n" + this.shaderErrors.get(key)); return this.failImage(node.id, w, h); }
    if (def.special === "glsl") ck.errors.delete(node.id);
    return { tex: rt.texture, w, h };
  }
  failImage(id, w, h) { const rt = this.rtFor(id, w, h); this.pass(this.mat("fail", FAIL), rt); return { tex: rt.texture, w, h, failed: true }; }
  /** Encaja una imagen de fuera (video, cámara, lienzo) en la imagen del nodo. */
  fitInto(id, tex, sw, sh, w, h, fit = 0, flipX = 0) {
    const rt = this.rtFor(id, w, h);
    this.pass(this.mat("blit", BLIT), rt, { s0: tex, srcSize: [sw, sh], fit, flipX });
    return { tex: rt.texture, w, h };
  }
  textTop(net, node, p, w, h) {
    let x = this.extra.get(node.id + ":txt");
    if (!x) { const c = document.createElement("canvas"); x = { c, g: c.getContext("2d"), sig: "" }; this.extra.set(node.id + ":txt", x); }
    const text = p.dat ? this.cooker(net).text(p.dat) : String(p.text ?? "");
    const sig = [text, w, h, p.size, p.color, p.bg, p.font, p.align, p.cx, p.cy, p.glow].join("|");
    if (sig !== x.sig) {
      x.sig = sig;
      if (x.c.width !== w || x.c.height !== h) { x.c.width = w; x.c.height = h; }
      const g = x.g, lines = text.split(/\n/);
      g.fillStyle = hex(p.bg); g.fillRect(0, 0, w, h);
      const size = Math.max(4, p.size * h);
      g.font = `bold ${size}px ${FONTS[p.font | 0] || FONTS[0]}`;
      g.textAlign = ["center", "left", "right"][p.align | 0] || "center"; g.textBaseline = "middle";
      g.fillStyle = hex(p.color, "#ffffff");
      if (p.glow > 0) { g.shadowColor = hex(p.color, "#ffffff"); g.shadowBlur = p.glow * size; }
      const X = p.cx * w, Y = (1 - p.cy) * h;
      lines.forEach((l, k) => g.fillText(l, X, Y + (k - (lines.length - 1) / 2) * size * 1.15));
      g.shadowBlur = 0;
      x.ver = (x.ver || 0) + 1;
    }
    const tex = this.elTexture(node.id + ":txtTex", x.c, x.ver);
    return this.fitInto(node.id, tex, w, h, w, h, 1);
  }
  mediaTop(node, p, w, h) {
    const pool = this.opts.pool;
    if (!p.media || !pool) return null;
    const rt = pool.get(p.media);
    if (!rt) { pool.ensure(p.media); return null; }
    const el = rt.source(this.time * (p.speed ?? 1));
    if (!el) return null;
    const sw = el.videoWidth || el.naturalWidth || el.width || 0, sh = el.videoHeight || el.naturalHeight || el.height || 0;
    if (!sw || !sh) return null;
    const tex = this.elTexture(node.id + ":el", el, rt.frameKey(this.time * (p.speed ?? 1)));
    return this.fitInto(node.id, tex, sw, sh, w, h, [0, 1, 2][p.fit | 0] === 1 ? 1 : (p.fit | 0) === 2 ? 2 : 0);
  }
  cameraTop(node, p, w, h) {
    const key = p.cam || globalThis.__lumaDefaultCam?.() || "default";
    const cam = cameraIfReady(key);
    if (!cam) { if (!this._camAsk?.[key]) { (this._camAsk ||= {})[key] = 1; getCamera(key).catch(e => console.warn(e)).finally(() => setTimeout(() => { delete this._camAsk[key]; }, 3000)); } return null; }
    const el = cam.el;
    if (!el.videoWidth) return null;
    const tex = this.elTexture(node.id + ":cam", el, cam.frameKey());
    return this.fitInto(node.id, tex, el.videoWidth, el.videoHeight, w, h, 0, p.mirror ? 1 : 0);
  }
  pluginTop(node, p, w, h) {
    const sh = getShader(p.shader);
    if (!sh) return null;
    this.shaders ||= new ShaderCache();
    const images = {};
    for (const inp of sh.isf.inputs) if (inp.type === "image") { const c = cameraIfReady(globalThis.__lumaDefaultCam?.() || "default"); if (c) images[inp.name] = c.el; }
    const audio = sh.isf.usesAudio ? (globalThis.__lumaAudio?.() || { fft: spectrumFromLevels(this.levels || {}, this._fft ||= new Uint8Array(256)), wave: null }) : null;
    const e = this.shaders.draw("td:" + node.id, sh.id, sh.isf, {}, { width: Math.min(w, 1280), height: Math.min(h, 720), time: this.time * (p.speed ?? 1), images, audio });
    if (!e) { const err = this.shaders.error(sh.id); if (err) this.cookers.forEach(c => c.errors.set(node.id, err)); return null; }
    const tex = this.elTexture(node.id + ":plug", e.canvas, e.version);
    return this.fitInto(node.id, tex, e.canvas.width, e.canvas.height, w, h, 1);
  }

  /* ---------------- 3D: SOP, MAT, COMP y Render TOP ---------------- */
  /** Geometría de un SOP (las que no cambian se guardan; el Ruido SOP se recalcula cada fotograma). */
  sop(net, node, depth = 0) {
    if (node?.type === "base") node = resolveOut(net, node, "SOP");
    if (!node || node.fam !== "SOP" || depth > 32) return null;
    if (node.type === "in") return this.sop(net, subIn(net, node), depth + 1);
    const mk = "sop:" + node.id;
    if (this.memo.has(mk)) return this.memo.get(mk);
    const ck = this.cooker(net), p = ck.params(node);
    const ins = node.in.map(id => this.sop(net, nodeById(net, id), depth + 1));
    let g = null;
    if (node.bypass) g = ins.find(Boolean) || null;
    else {
      const sig = node.type + JSON.stringify(p) + ins.map(x => x?.userData.sig || "-").join(",") + (node.type === "file" ? ":" + (this.models.get(p.model)?.ver || 0) : "");
      let x = this.extra.get(mk);
      if (x && x.sig === sig && node.type !== "noise") g = x.geo;
      else {
        try { g = this.buildSop(node.type, p, ins); } catch (e) { ck.errors.set(node.id, String(e.message || e)); g = null; }
        if (g) { g.userData.sig = node.type === "noise" ? sig + this.frameNo : sig; if (x?.geo && x.geo !== g && x.own) x.geo.dispose(); this.extra.set(mk, { sig, geo: g, own: !ins.includes(g) }); }
      }
    }
    this.memo.set(mk, g);
    return g;
  }
  buildSop(type, p, ins) {
    const T = THREE;
    switch (type) {
      case "box": return new T.BoxGeometry(p.sx || 0.001, p.sy || 0.001, p.sz || 0.001, 2, 2, 2);
      case "sphere": return new T.SphereGeometry(Math.max(0.001, p.radius), Math.max(3, p.detail), Math.max(2, (p.detail / 2) | 0));
      case "torus": return new T.TorusGeometry(Math.max(0.001, p.radius), Math.max(0.001, p.tube), Math.max(3, (p.detail / 3) | 0), Math.max(3, p.detail));
      case "grid": { const g = new T.PlaneGeometry(p.sx || 0.001, p.sy || 0.001, Math.max(1, p.cols), Math.max(1, p.rows)); return g; }
      case "tube": return new T.CylinderGeometry(p.top, p.bottom, p.height || 0.001, Math.max(3, p.detail), 1, false);
      case "cone": return new T.ConeGeometry(Math.max(0.001, p.radius), p.height || 0.001, Math.max(3, p.detail));
      case "platonic": { const r = Math.max(0.001, p.radius), d = Math.max(0, Math.min(5, p.detail | 0)); return [new T.TetrahedronGeometry(r, d), new T.OctahedronGeometry(r, d), new T.DodecahedronGeometry(r, d), new T.IcosahedronGeometry(r, d)][p.kind | 0] || new T.IcosahedronGeometry(r, d); }
      case "knot": return new T.TorusKnotGeometry(Math.max(0.001, p.radius), Math.max(0.001, p.tube), 160, 16, Math.max(1, p.p | 0), Math.max(1, p.q | 0));
      case "circle": return new T.CircleGeometry(Math.max(0.001, p.radius), Math.max(3, p.divs));
      case "transform": {
        const src = ins[0]; if (!src) return null;
        const g = src.clone(), u = p.scale ?? 1;
        const mtx = new T.Matrix4().compose(new T.Vector3(p.tx, p.ty, p.tz), new T.Quaternion().setFromEuler(new T.Euler(p.rx * Math.PI / 180, p.ry * Math.PI / 180, p.rz * Math.PI / 180)), new T.Vector3(p.sx * u, p.sy * u, p.sz * u));
        g.applyMatrix4(mtx);
        return g;
      }
      case "noise": {
        const src = ins[0]; if (!src) return null;
        const g = src.clone(), pos = g.attributes.position, nor = g.attributes.normal, z = this.time * p.speed, k = 1 / Math.max(0.01, p.period);
        for (let j = 0; j < pos.count; j++) {
          const x = pos.getX(j), y = pos.getY(j), w = pos.getZ(j);
          const n = (noise3s(x * k, y * k + z, w * k) - 0.5) * 2 * p.amp;
          if (nor) pos.setXYZ(j, x + nor.getX(j) * n, y + nor.getY(j) * n, w + nor.getZ(j) * n); else pos.setY(j, y + n);
        }
        g.computeVertexNormals();
        return g;
      }
      case "merge": {
        const list = ins.filter(Boolean).map(g => { const x = g.index ? g.toNonIndexed() : g.clone(); for (const a of Object.keys(x.attributes)) if (!["position", "normal", "uv"].includes(a)) x.deleteAttribute(a); if (!x.attributes.uv) x.setAttribute("uv", new T.Float32BufferAttribute(new Float32Array(x.attributes.position.count * 2), 2)); if (!x.attributes.normal) x.computeVertexNormals(); return x; });
        return list.length ? mergeGeometries(list) : null;
      }
      case "null": case "out": return ins[0] ? ins[0] : null;
      case "file": {
        const base = this.modelGeo(p.model);
        if (!base) return null;
        const g = base.clone();
        g.computeBoundingBox();
        const b = g.boundingBox, c = b.getCenter(new T.Vector3()), sz = b.getSize(new T.Vector3()), big = Math.max(sz.x, sz.y, sz.z) || 1;
        if (p.center) g.translate(-c.x, -c.y, -c.z);
        if (p.fit) g.scale(p.size / big, p.size / big, p.size / big);
        return g;
      }
    }
    return null;
  }
  /** Geometría de un modelo 3D de la biblioteca (se lee una vez; mientras tanto, nada). */
  modelGeo(id) {
    if (!id) return null;
    let m = this.models.get(id);
    if (!m) {
      m = { ver: 0, geo: null, err: "" };
      this.models.set(id, m);
      this.loadModel(id).then(g => { m.geo = g; m.ver++; }).catch(e => { m.err = String(e?.message || e); m.ver++; });
    }
    if (m.err) throw new Error("No se pudo leer el modelo: " + m.err);
    return m.geo;
  }
  async loadModel(id) {
    const Store = await import("../store.js");
    const rec = await Store.getMedia(id);
    if (!rec?.blob) throw new Error("falta el archivo en la biblioteca");
    const ext = (String(rec.name || "").split(".").pop() || "").toLowerCase();
    const buf = await rec.blob.arrayBuffer();
    const L = "../../vendor/three/addons/loaders/";
    let obj;
    if (ext === "obj") { const { OBJLoader } = await import(L + "OBJLoader.js"); obj = new OBJLoader().parse(new TextDecoder().decode(buf)); }
    else if (ext === "gltf" || ext === "glb") { const { GLTFLoader } = await import(L + "GLTFLoader.js"); obj = (await new GLTFLoader().parseAsync(buf, "")).scene; }
    else if (ext === "fbx") { const { FBXLoader } = await import(L + "FBXLoader.js"); obj = new FBXLoader().parse(buf, ""); }
    else if (ext === "stl") { const { STLLoader } = await import(L + "STLLoader.js"); obj = new THREE.Mesh(new STLLoader().parse(buf)); }
    else if (ext === "ply") { const { PLYLoader } = await import(L + "PLYLoader.js"); obj = new THREE.Mesh(new PLYLoader().parse(buf)); }
    else throw new Error("formato no admitido (." + ext + ")");
    return meshToGeometry(obj);
  }
  /** Material de un MAT (se actualiza cada fotograma con sus parámetros). */
  material(net, node) {
    if (!node || node.fam !== "MAT") return null;
    const ck = this.cooker(net), p = ck.params(node), mk = "mat:" + node.id;
    let x = this.extra.get(mk);
    if (!x || x.type !== node.type) {
      x?.mat?.dispose();
      const T = THREE;
      const mat = node.type === "pbr" ? new T.MeshStandardMaterial() : node.type === "constant" ? new T.MeshBasicMaterial() : node.type === "normal" ? new T.MeshNormalMaterial() : new T.MeshBasicMaterial({ wireframe: true });
      // Las imágenes de la red ya vienen en sRGB: se pasan a lineal dentro del shader.
      mat.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace("#include <map_fragment>", "#ifdef USE_MAP\n vec4 sampledDiffuseColor = texture2D( map, vMapUv ); sampledDiffuseColor.rgb = pow( sampledDiffuseColor.rgb, vec3( 2.2 ) ); diffuseColor *= sampledDiffuseColor;\n#endif"); };
      x = { type: node.type, mat, hasMap: false };
      this.extra.set(mk, x);
    }
    const m = x.mat;
    if (m.color && p.color !== undefined) m.color.set(hex(p.color, "#ffffff"));
    if (node.type === "pbr") { m.metalness = p.metal; m.roughness = p.rough; m.emissive.set(hex(p.emit)); m.emissiveIntensity = p.emitAmt; }
    if (node.type !== "normal") { m.opacity = p.opacity ?? 1; m.transparent = (p.opacity ?? 1) < 1; }
    m.wireframe = node.type === "wire" ? true : !!p.wire;
    m.side = p.double ? THREE.DoubleSide : THREE.FrontSide;
    if (node.type === "pbr" || node.type === "constant") {
      const mapNode = p.map ? nodeByName(net, p.map) : null;
      const img = mapNode ? this.top(net, mapNode) : null;
      const has = !!img;
      if (has !== x.hasMap) { x.hasMap = has; m.needsUpdate = true; }
      m.map = img ? img.tex : null;
    }
    return m;
  }
  renderTop(net, node, p, w, h) {
    const ck = this.cooker(net), key = node.id + ":3d";
    let x = this.extra.get(key);
    if (!x) {
      x = { scene: new THREE.Scene(), objs: new Map(), lights: new Map(), proxies: new Map(), cam: null, persp: new THREE.PerspectiveCamera(45, w / h, 0.01, 500), ortho: new THREE.OrthographicCamera(-2, 2, 2, -2, 0.01, 500), amb: new THREE.AmbientLight(0xffffff, 0.25), defLight: new THREE.DirectionalLight(0xffffff, 2.2), rt: null, msaa: -1 };
      x.defLight.position.set(2, 3, 4);
      x.scene.add(x.amb, x.defLight);
      this.extra.set(key, x);
    }
    const S = x.scene;
    S.background = null;
    x.amb.intensity = p.ambient;
    const filter = String(p.geos || "").split(/[\s,]+/).filter(Boolean);
    const seen = new Set();
    // Objetos 3D
    for (const g of net.nodes) {
      if (g.fam !== "COMP" || g.type !== "geo" || g.bypass) continue;
      if (filter.length && !filter.includes(g.name)) continue;
      const gp = ck.params(g);
      if (!gp.render) continue;
      const geo = this.sop(net, nodeById(net, g.in[0]));
      if (!geo) continue;
      const mat = this.material(net, nodeByName(net, gp.material)) || (x.defMat ||= new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.5, metalness: 0.1 }));
      const chop = gp.instancing && gp.instanceop ? ck.chopByName(gp.instanceop) : null;
      const count = gp.instancing ? Math.max(0, Math.min(5000, gp.instances > 0 ? gp.instances : chop?.len || 0)) : 0;
      let o = x.objs.get(g.id);
      const wantInst = !!(gp.instancing && count > 0);
      if (!o || !!o.isInstancedMesh !== wantInst || o.userData.kind || (wantInst && o.instanceMatrix.count < count)) {
        if (o) S.remove(o);
        o = wantInst ? new THREE.InstancedMesh(geo, mat, Math.max(count, 16)) : new THREE.Mesh(geo, mat);
        o.frustumCulled = false;
        x.objs.set(g.id, o); S.add(o);
      }
      o.geometry = geo; o.material = mat;
      const u = gp.scale ?? 1;
      o.position.set(gp.tx, gp.ty, gp.tz);
      o.rotation.set(gp.rx * Math.PI / 180, gp.ry * Math.PI / 180, gp.rz * Math.PI / 180);
      o.scale.set(gp.sx * u, gp.sy * u, gp.sz * u);
      if (wantInst) {
        o.count = count;
        const ch = (name) => chop?.data[String(name || "")] || null;
        const TX = ch(gp.itx), TY = ch(gp.ity), TZ = ch(gp.itz), SC = ch(gp.iscale), RY = ch(gp.iry), R = ch(gp.ir), G = ch(gp.ig), B = ch(gp.ib);
        const at = (a, k, d) => a ? (a[Math.min(a.length - 1, k)] ?? d) : d;
        const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3(), col = new THREE.Color();
        for (let k = 0; k < count; k++) {
          e.set(0, at(RY, k, 0) * Math.PI / 180, 0); q.setFromEuler(e);
          const sc = at(SC, k, 1);
          mtx.compose(v.set(at(TX, k, 0), at(TY, k, 0), at(TZ, k, 0)), q, s.set(sc, sc, sc));
          o.setMatrixAt(k, mtx);
          if (R || G || B) o.setColorAt(k, col.setRGB(at(R, k, 1), at(G, k, 1), at(B, k, 1)));
        }
        o.instanceMatrix.needsUpdate = true;
        if (o.instanceColor) o.instanceColor.needsUpdate = true;
      }
      seen.add(g.id);
    }
    // Partículas
    for (const pn of net.nodes) {
      if (pn.fam !== "COMP" || pn.type !== "particles" || pn.bypass) continue;
      if (filter.length && !filter.includes(pn.name)) continue;
      const pp = ck.params(pn), sim = this.particleSim(net, pn, pp);
      const look = pp.look | 0, shape = look === 2 ? this.sop(net, nodeByName(net, pp.shape)) : null;
      const kind = shape ? "inst" : "points";
      let o = x.objs.get(pn.id);
      if (!o || o.userData.kind !== kind || o.userData.max !== sim.max || (kind === "inst" && o.geometry !== shape)) {
        if (o) { S.remove(o); if (o.userData.kind === "points") { o.geometry.dispose(); o.material.dispose(); } }
        o = kind === "inst" ? new THREE.InstancedMesh(shape, this.material(net, nodeByName(net, pp.material)) || (x.defMat ||= new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.5, metalness: 0.1 })), sim.max) : pointsObject(sim);
        o.userData.kind = kind; o.userData.max = sim.max; o.frustumCulled = false;
        x.objs.set(pn.id, o); S.add(o);
      }
      if (kind === "points") {
        const G = o.geometry;
        for (const a of ["position", "pcol", "palpha", "psize"]) G.attributes[a].needsUpdate = true;
        G.setDrawRange(0, sim.n);
        const M = o.material;
        M.uniforms.uScale.value = h / 2; M.uniforms.uSoft.value = look === 0 ? 1 : 0;
        M.blending = pp.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
      } else {
        o.material = this.material(net, nodeByName(net, pp.material)) || x.defMat;
        const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color();
        o.count = sim.n;
        for (let k = 0; k < sim.n; k++) {
          const z = sim.size[k];
          mtx.compose(v.set(sim.pos[k * 3], sim.pos[k * 3 + 1], sim.pos[k * 3 + 2]), q, sc.set(z, z, z));
          o.setMatrixAt(k, mtx);
          o.setColorAt(k, col.setRGB(sim.col[k * 3], sim.col[k * 3 + 1], sim.col[k * 3 + 2]));
        }
        o.instanceMatrix.needsUpdate = true;
        if (o.instanceColor) o.instanceColor.needsUpdate = true;
      }
      // Un punto invisible en el emisor: el gizmo del visor lo mueve.
      let px = x.proxies.get(pn.id);
      if (!px) { px = new THREE.Object3D(); x.proxies.set(pn.id, px); S.add(px); }
      px.position.set(pp.ex, pp.ey, pp.ez);
      seen.add(pn.id);
    }
    for (const [id, o] of x.objs) if (!seen.has(id)) { S.remove(o); if (o.userData.kind === "points") { o.geometry.dispose(); o.material.dispose(); } x.objs.delete(id); }
    for (const [id, o] of x.proxies) if (!seen.has(id)) { S.remove(o); x.proxies.delete(id); }
    // Luces
    const lseen = new Set();
    for (const l of net.nodes) {
      if (l.fam !== "COMP" || l.type !== "light" || l.bypass) continue;
      const lp = ck.params(l), kind = lp.kind | 0;
      let L = x.lights.get(l.id);
      if (!L || L.userData.kind !== kind) {
        if (L) S.remove(L);
        L = [new THREE.PointLight(), new THREE.DirectionalLight(), new THREE.SpotLight(), new THREE.AmbientLight()][kind] || new THREE.PointLight();
        L.userData.kind = kind;
        if (L.isPointLight || L.isSpotLight) { L.decay = 0; }
        x.lights.set(l.id, L); S.add(L);
      }
      L.color.set(hex(lp.color, "#ffffff")); L.intensity = lp.intensity;
      L.position?.set(lp.tx, lp.ty, lp.tz);
      lseen.add(l.id);
    }
    for (const [id, L] of x.lights) if (!lseen.has(id)) { S.remove(L); x.lights.delete(id); }
    x.defLight.visible = lseen.size === 0;
    // Cámara
    const camNode = (p.camera && nodeByName(net, p.camera)) || net.nodes.find(n => n.fam === "COMP" && n.type === "camera" && !n.bypass);
    let cam = x.persp;
    if (camNode) {
      const cp = ck.params(camNode);
      cam = cp.ortho ? x.ortho : x.persp;
      const a = this.time * (cp.orbit || 0) * Math.PI * 2;
      const dx = cp.tx - cp.lookx, dz = cp.tz - cp.lookz;
      cam.position.set(cp.lookx + dx * Math.cos(a) - dz * Math.sin(a), cp.ty, cp.lookz + dx * Math.sin(a) + dz * Math.cos(a));
      cam.up.set(0, 1, 0);
      cam.lookAt(cp.lookx, cp.looky, cp.lookz);
      if (cam.isPerspectiveCamera) { cam.fov = Math.max(5, Math.min(150, cp.fov)); cam.aspect = w / h; }
      else { const d = Math.hypot(dx, cp.ty - cp.looky, dz) * Math.tan(cp.fov * Math.PI / 360); cam.left = -d * w / h; cam.right = d * w / h; cam.top = d; cam.bottom = -d; }
    } else { cam.position.set(0, 0.6, 4); cam.lookAt(0, 0, 0); cam.aspect = w / h; }
    cam.updateProjectionMatrix();
    x.cam = cam; x.w = w; x.h = h; x.camNode = camNode?.id || null; x.bg = p.bg; x.bgAlpha = p.bgAlpha ?? 1; x.msaaWant = p.antialias ? 4 : 0;
    // Dibujar (con suavizado de bordes) y pasar a sRGB.
    const msaa = p.antialias ? 4 : 0;
    if (!x.rt || x.rt.width !== w || x.rt.height !== h || x.msaa !== msaa) {
      x.rt?.dispose();
      x.rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true, samples: msaa, type: THREE.UnsignedByteType });
      x.msaa = msaa;
    }
    const bg = new THREE.Color(hex(p.bg));
    this.r.setRenderTarget(x.rt);
    this.r.setViewport(0, 0, w, h);
    this.r.setClearColor(bg, p.bgAlpha ?? 1);
    this.r.clear(true, true, false);
    this.compiling = "render:" + node.id;
    this.r.render(S, cam);
    this.compiling = null;
    this.r.setClearColor(0x000000, 1);
    const out = this.rtFor(node.id, w, h);
    this.pass(this.mat("encode", ENCODE), out, { s0: x.rt.texture });
    return { tex: out.texture, w, h };
  }

  /* ---------------- Audio de un archivo ---------------- */
  /**
   * Reproduce y analiza un audio de la biblioteca (Audio File In CHOP). Solo suena en la ventana
   * del editor; en las salidas se analiza en silencio. Todas van a la misma posición (reloj de la
   * pared o línea de tiempo de la red), corrigiendo si se separan.
   */
  audioFile(node, p, local = 0) {
    const key = node.id + ":af";
    let a = this.extra.get(key);
    if (!a || a.media !== p.audio) {
      if (a?.el) { a.el.pause(); a.el.removeAttribute("src"); try { a.src?.disconnect(); } catch {} if (a.url) URL.revokeObjectURL(a.url); }
      a = { media: p.audio, el: null, ready: false, bins: null, beatT: -1, avg: 0, f: -1, out: null };
      this.extra.set(key, a);
      if (p.audio) this.loadAudio(a).catch(e => { a.err = String(e?.message || e); });
    }
    if (a.err) throw new Error("No se pudo leer el audio: " + a.err);
    if (!a.ready) return null;
    if (a.f === this.frameNo) return a.out;
    a.f = this.frameNo;
    const el = a.el, ctx = this.actx;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    a.gain.gain.value = this.opts.app && p.sound ? Math.max(0, Math.min(1, p.volume)) : 0;
    if (p.play) { if (el.paused) el.play().catch(() => {}); } else if (!el.paused) el.pause();
    const dur = el.duration || 0;
    if (dur > 0 && p.play) {
      const target = (p.sync | 0) === 1 ? Math.min(dur - 0.01, local || 0) : (Date.now() / 1000) % dur;
      if (Math.abs(el.currentTime - target) > 0.3) { try { el.currentTime = target; } catch {} }
    }
    const an = a.an, b = a.bins ||= new Uint8Array(an.frequencyBinCount);
    an.getByteFrequencyData(b);
    const band = (lo, hi) => { const n = b.length, sr = ctx.sampleRate / 2; let s0 = 0, c = 0; for (let k = Math.floor(lo / sr * n); k < Math.min(n, Math.ceil(hi / sr * n)); k++) { s0 += b[k]; c++; } return c ? s0 / c / 255 : 0; };
    const bass = band(20, 200), mid = band(200, 2000), high = band(2000, 12000), level = (bass + mid + high) / 3;
    // Golpe: los graves suben de golpe por encima de su media.
    a.avg = a.avg * 0.92 + bass * 0.08;
    const t = this.time;
    if (bass > a.avg * 1.35 && bass > 0.25 && t - a.beatT > 0.18) a.beatT = t;
    const beat = t - a.beatT < 0.1 ? 1 : 0;
    a.out = { bass, mid, high, level, beat, pos: el.currentTime || 0, dur, fft: b };
    return a.out;
  }
  async loadAudio(a) {
    const Store = await import("../store.js");
    const rec = await Store.getMedia(a.media);
    if (!rec?.blob) throw new Error("falta el archivo en la biblioteca");
    const el = new Audio();
    a.url = URL.createObjectURL(rec.blob);
    el.src = a.url; el.loop = true; el.preload = "auto"; el.crossOrigin = "anonymous";
    const ctx = this.actx ||= new (globalThis.AudioContext || globalThis.webkitAudioContext)();
    a.src = ctx.createMediaElementSource(el);
    a.an = ctx.createAnalyser(); a.an.fftSize = 1024; a.an.smoothingTimeConstant = 0.6;
    a.gain = ctx.createGain(); a.gain.gain.value = 0;
    a.src.connect(a.an); a.an.connect(a.gain); a.gain.connect(ctx.destination);
    a.el = el; a.ready = true;
  }

  /* ---------------- Grabar video (Movie File Out TOP) ---------------- */
  record(net, node, p, img) {
    let R = this.recs.get(node.id);
    const want = !!p.record && !!this.opts.app && typeof MediaRecorder !== "undefined";
    if (!want) { if (R && R.state === "rec") this.stopRecord(node, R); return; }
    if (!R || R.state !== "rec") {
      const c = document.createElement("canvas");
      c.width = Math.max(64, Math.min(3840, p.w | 0)) & ~1; c.height = Math.max(64, Math.min(2160, p.h | 0)) & ~1;
      const fps = +p.fps || 30, bps = [8e6, 16e6, 40e6][p.quality | 0] || 16e6;
      // WebM (VP9/VP8) primero: lo graba cualquier Chromium/Electron (el MP4 depende de que haya códec H.264).
      const types = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4;codecs=avc1.640028", "video/mp4"];
      const mime = types.find(t => MediaRecorder.isTypeSupported?.(t)) || "";
      // Cada fotograma se entrega a mano (requestFrame): así no se pierde ninguno aunque el equipo vaya lento.
      const stream = c.captureStream(0);
      const rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: bps });
      R = { state: "rec", canvas: c, g: c.getContext("2d"), rec, chunks: [], t0: performance.now(), mime: rec.mimeType || mime || "video/webm", name: String(p.name || "grabacion"), track: stream.getVideoTracks()[0], fps, last: 0 };
      rec.ondataavailable = (e) => { if (e.data?.size) R.chunks.push(e.data); };
      rec.start(1000);
      this.recs.set(node.id, R);
    }
    const w = R.canvas.width, h = R.canvas.height;
    this.ensureCanvas(w, h);
    this.pass(this.mat("blit", BLIT), null, { s0: img.tex, srcSize: [img.w, img.h], fit: 1, flipX: 0 }, [0, 0, w, h]);
    R.g.drawImage(this.canvas, 0, this.canvas.height - h, w, h, 0, 0, w, h);
    const now = performance.now();
    if (now - R.last >= 1000 / R.fps - 2) { R.last = now; R.track?.requestFrame?.(); }
  }
  stopRecord(node, R) {
    R.state = "stopping";
    R.rec.onstop = () => {
      const blob = new Blob(R.chunks, { type: R.mime.split(";")[0] });
      const ext = /mp4/.test(R.mime) ? "mp4" : "webm";
      const name = `${R.name.replace(/[^\w-]+/g, "_") || "grabacion"}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.${ext}`;
      this.recs.delete(node.id);
      this.lastRecording = { blob, name, secs: (performance.now() - R.t0) / 1000 };
      this.opts.onRecorded?.(this.lastRecording);
    };
    try { R.rec.stop(); } catch { this.recs.delete(node.id); }
  }
  /** Estado de la grabación de un nodo: null o { secs }. */
  recInfo(id) { const R = this.recs.get(id); return R ? { secs: (performance.now() - R.t0) / 1000, state: R.state } : null; }

  /** Simula las partículas de un nodo una vez por fotograma. */
  particleSim(net, node, pp) {
    const key = node.id + ":ps";
    let st = this.extra.get(key);
    if (!st) { st = { sim: new Particles(pp.max), f: -1, t: this.time }; this.extra.set(key, st); }
    if (st.f !== this.frameNo) {
      const dt = st.f < 0 ? 1 / 60 : Math.max(0, Math.min(0.1, this.time - st.t));
      st.f = this.frameNo; st.t = this.time;
      let src = null;
      if ((pp.emitter | 0) === 4) { const g = this.sop(net, nodeById(net, node.in[0])); src = g?.attributes.position?.array || null; }
      const c1 = new THREE.Color(hex(pp.color1, "#ffffff")), c2 = new THREE.Color(hex(pp.color2, "#ffffff"));
      st.sim.step({ ...pp, max: Math.min(pp.max | 0 || 5000, MOBILE ? 20000 : 100000) }, dt, src, [c1.r, c1.g, c1.b], [c2.r, c2.g, c2.b]);
    }
    return st.sim;
  }

  /* ---------------- Visor 3D del editor ---------------- */
  /** La escena 3D de un Render TOP ya cocinada en este fotograma (para elegir objetos y el gizmo). */
  scene3d(net, node) { if (!node || node.type !== "render") return null; this.top(net, node); return this.extra.get(node.id + ":3d") || null; }
  /** El objeto 3D que mueve el gizmo para un nodo: el Objeto 3D, la luz o el emisor de partículas. */
  object3d(net, renderNode, nodeId) {
    const x = this.extra.get(renderNode.id + ":3d");
    if (!x) return null;
    const n = nodeById(net, nodeId);
    if (!n) return null;
    if (n.type === "particles") return x.proxies.get(n.id) || null;
    if (n.type === "light") return x.lights.get(n.id) || null;
    return x.objs.get(n.id) || null;
  }
  /** ¿Qué Objeto 3D hay bajo el puntero? ndc = [-1…1, -1…1]. */
  pick3d(net, renderNode, ndc, cam = null) {
    const x = this.extra.get(renderNode.id + ":3d");
    if (!x || !(cam || x.cam)) return null;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndc[0], ndc[1]), cam || x.cam);
    const list = [...x.objs.entries()].filter(([, o]) => o.isMesh && o.visible);
    const hit = ray.intersectObjects(list.map(e => e[1]), false)[0];
    return hit ? list.find(([, o]) => o === hit.object)?.[0] || null : null;
  }
  /**
   * Dibuja un Render TOP en un lienzo 2D para el visor flotante: con la cámara de la red o con una
   * cámara libre del editor (solo para mirar), más una capa encima (gizmo) y ayudas (rejilla, luces…).
   */
  drawView3d(net, node, ctx2d, w, h, { cam = null, helpers = null, overlay = null } = {}) {
    const x = this.scene3d(net, node);
    if (!x) return false;
    this.ensureCanvas(w, h);
    const vp = [0, 0, w, h];
    if (cam || helpers) {
      let v = this.extra.get(node.id + ":view");
      if (!v || v.rt.width !== w || v.rt.height !== h) { v?.rt.dispose(); v = { rt: new THREE.WebGLRenderTarget(w, h, { depthBuffer: true, samples: 4, type: THREE.UnsignedByteType }) }; this.extra.set(node.id + ":view", v); }
      const C = cam || x.cam;
      if (cam) { if (cam.isPerspectiveCamera) cam.aspect = w / h; cam.updateProjectionMatrix(); }
      if (helpers) x.scene.add(helpers);
      this.r.setRenderTarget(v.rt); this.r.setViewport(0, 0, w, h);
      this.r.setClearColor(new THREE.Color(hex(x.bg)), 1); this.r.clear(true, true, false);
      this.r.render(x.scene, C);
      this.r.setClearColor(0x000000, 1);
      if (helpers) x.scene.remove(helpers);
      this.pass(this.mat("encode", ENCODE), null, { s0: v.rt.texture }, vp);
    } else {
      const img = this.top(net, node);
      if (!img) return false;
      this.pass(this.mat("blit", BLIT), null, { s0: img.tex, srcSize: [img.w, img.h], fit: 1, flipX: 0 }, vp);
    }
    if (overlay) {
      this.r.setRenderTarget(null);
      this.r.setViewport(0, 0, w, h); this.r.setScissor(0, 0, w, h); this.r.setScissorTest(true);
      this.r.clearDepth();
      this.r.render(overlay, cam || x.cam);
      this.r.setScissorTest(false);
    }
    ctx2d.drawImage(this.canvas, 0, this.canvas.height - h, w, h, 0, 0, w, h);
    return true;
  }

  /* ---------------- Salidas ---------------- */
  /** Dibuja la imagen de un TOP en un lienzo 2D (de cualquier tamaño). */
  drawTo(net, node, ctx2d, w, h, fit = 1) {
    const img = this.top(net, node);
    if (!img) { if (fit === 2) { ctx2d.fillStyle = "#000"; ctx2d.fillRect(0, 0, w, h); } return false; }
    this.ensureCanvas(w, h);
    // fit 1: estirar a la medida (salidas, visores) · 2: entera sin deformar (fondo del editor)
    this.pass(this.mat("blit", BLIT), null, { s0: img.tex, srcSize: [img.w, img.h], fit, flipX: 0 }, [0, 0, w, h]);
    ctx2d.drawImage(this.canvas, 0, this.canvas.height - h, w, h, 0, 0, w, h);
    return true;
  }
  ensureCanvas(w, h) {
    if (this.canvas.width < w || this.canvas.height < h) this.r.setSize(Math.max(this.canvas.width, w), Math.max(this.canvas.height, h), false);
  }
  /**
   * La imagen de una red para una superficie: { el, key } (como las demás fuentes del compositor).
   * nodeId vacío = la primera Salida (Out TOP), o lo que se ve de fondo.
   */
  output(netId, nodeId, { time = 0, levels = null, w = 1280, h = 720 } = {}) {
    const net = this.net(netId);
    if (!net) return null;
    this.follow(time, levels);
    const node = nodeById(net, nodeId) || net.nodes.find(n => n.fam === "TOP" && n.type === "out") || nodeById(net, net.display);
    if (!node) return null;
    const img = this.top(net, node);
    if (!img) return null;
    const ow = Math.max(16, Math.min(MAX_SIDE, Math.round(w || img.w))), oh = Math.max(16, Math.min(MAX_SIDE, Math.round(h || img.h)));
    let o = this.outCanvases.get(netId + ":" + node.id);
    if (!o) { const c = document.createElement("canvas"); o = { c, g: c.getContext("2d"), ver: 0, t: -1 }; this.outCanvases.set(netId + ":" + node.id, o); }
    if (o.t !== this.frameNo) {
      if (o.c.width !== ow || o.c.height !== oh) { o.c.width = ow; o.c.height = oh; }
      this.drawTo(net, node, o.g, ow, oh);
      o.t = this.frameNo; o.ver++;
    }
    return { el: o.c, key: o.ver };
  }
  /** Visores del editor: [{ net, node, ctx, w, h }] (cada uno con su lienzo 2D). */
  viewers(list, time, levels) {
    this.follow(time, levels);
    for (const v of list) { try { this.drawTo(v.net, v.node, v.ctx, v.w, v.h, v.fit || 1); } catch (e) { console.warn("visor", e); } }
  }
  /** Información de un nodo para el editor: resolución, tiempo de cálculo y error. */
  info(net, node) {
    const ck = this.cooker(net), rt = this.rts.get(node.id);
    const errs = [ck.errors.get(node.id), ...[...ck.errors.entries()].filter(([k]) => k.startsWith(node.id + "/")).map(([k, v]) => `${k.split("/")[1]}: ${v}`)].filter(Boolean);
    return { w: rt?.width || 0, h: rt?.height || 0, ms: node.fam === "TOP" ? this.topMs.get(node.id) || 0 : ck.cookMs.get(node.id) || 0, error: errs.join("\n") };
  }
  /** Datos de un CHOP con su historia (para el visor de canales). */
  chop(net, node) {
    const c = this.cooker(net).chop(node);
    if (!c) return null;
    let hist = this.history.get(node.id);
    if (!hist) this.history.set(node.id, hist = { f: -1, rows: [] });
    if (hist.f !== this.frameNo) {
      hist.f = this.frameNo;
      hist.rows.push(c.names.slice(0, 6).map(n => c.data[n][0] ?? 0));
      if (hist.rows.length > 180) hist.rows.shift();
    }
    return { ...c, hist: hist.rows };
  }
  /** Suelta lo que ya no existe (nodos borrados) para no gastar memoria de la tarjeta. */
  gc() {
    const live = new Set((this.project?.networks || []).flatMap(n => n.nodes.map(x => x.id)));
    for (const [id, rt] of this.rts) if (!live.has(id)) { rt.dispose(); this.rts.delete(id); }
    for (const [k, x] of this.extra) {
      const id = k.replace(/^(sop|mat):/, "").split(":")[0];
      if (live.has(id)) continue;
      x.tex?.dispose?.(); x.geo?.dispose?.(); x.mat?.dispose?.(); x.rt?.dispose?.();
      if (x.el) { x.el.pause(); try { x.src?.disconnect(); } catch {} if (x.url) URL.revokeObjectURL(x.url); }
      this.extra.delete(k);
    }
    for (const [id, f] of this.fb) if (!live.has(id)) { f.prev?.dispose(); this.fb.delete(id); }
    for (const k of [...this.mats.keys()]) if (k.startsWith("glsl:") && !live.has(k.split(":")[1])) { this.mats.get(k).dispose(); this.mats.delete(k); this.shaderErrors.delete(k); }
  }
  dispose() {
    if (this.onKey) { window.removeEventListener("keydown", this.onKey, true); window.removeEventListener("keyup", this.onKey, true); }
    for (const rt of this.rts.values()) rt.dispose();
    this.shaders?.dispose();
    this.r.dispose();
  }
}

/** Todas las mallas de un modelo (con sus posiciones) en una sola geometría. */
function meshToGeometry(obj) {
  obj.updateMatrixWorld(true);
  const list = [];
  obj.traverse(c => {
    if (!c.isMesh || !c.geometry?.attributes?.position) return;
    let g = c.geometry.clone();
    g.morphAttributes = {};
    g.applyMatrix4(c.matrixWorld);
    if (g.index) g = g.toNonIndexed();
    for (const a of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(a)) g.deleteAttribute(a);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    list.push(g);
  });
  if (!list.length) throw new Error("el archivo no tiene ninguna malla");
  const g = list.length === 1 ? list[0] : mergeGeometries(list);
  if (!g) throw new Error("no se pudieron juntar sus mallas");
  return g;
}
/** Puntos de partículas (con color, opacidad y tamaño de cada una). */
function pointsObject(sim) {
  const G = new THREE.BufferGeometry();
  G.setAttribute("position", new THREE.BufferAttribute(sim.pos, 3));
  G.setAttribute("pcol", new THREE.BufferAttribute(sim.col, 3));
  G.setAttribute("palpha", new THREE.BufferAttribute(sim.alpha, 1));
  G.setAttribute("psize", new THREE.BufferAttribute(sim.size, 1));
  for (const a of Object.values(G.attributes)) a.setUsage(THREE.DynamicDrawUsage);
  const M = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 360 }, uSoft: { value: 1 } },
    vertexShader: `attribute vec3 pcol; attribute float palpha; attribute float psize; uniform float uScale; varying vec3 vC; varying float vA;
      void main() { vC = pcol; vA = palpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
        float k = projectionMatrix[3][3] > 0.5 ? projectionMatrix[1][1] : projectionMatrix[1][1] / max(0.001, -mv.z);
        gl_PointSize = clamp(psize * k * uScale, 1.0, 256.0); }`,
    fragmentShader: `uniform float uSoft; varying vec3 vC; varying float vA;
      void main() { vec2 q = gl_PointCoord * 2.0 - 1.0; float d = dot(q, q); if (d > 1.0) discard;
        float a = uSoft > 0.5 ? exp(-d * 3.5) : 1.0 - smoothstep(0.8, 1.0, d); gl_FragColor = vec4(vC, a * vA); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(G, M);
}
function srgb(h) { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
function hashStr(s) { let h = 2166136261; for (let k = 0; k < s.length; k++) { h ^= s.charCodeAt(k); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
function noise3s(x, y, z) {
  const h = (a, b, c) => { const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return s - Math.floor(s); };
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
  const f = (t) => t * t * (3 - 2 * t), u = f(xf), v = f(yf), w = f(zf), l = (a, b, t) => a + (b - a) * t;
  return l(l(l(h(xi, yi, zi), h(xi + 1, yi, zi), u), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v),
           l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v), w);
}

/* ---------------- Un motor por ventana ---------------- */
let shared = null;
/** El motor de esta ventana (se crea la primera vez que una red se usa). */
export function netEngine(opts) {
  if (!shared) shared = new NetEngine(opts);
  else if (opts) { Object.assign(shared.opts, Object.fromEntries(Object.entries(opts).filter(([, v]) => v))); shared.installTaps(); }
  return shared;
}
export const engineIfAny = () => shared;
export { opDef, THREE };
