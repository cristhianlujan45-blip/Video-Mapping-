// web/js/isf.js
// Shaders ISF (Interactive Shader Format, el formato de shaders de VJ que usan Resolume,
// VDMX, Millumin…): un comentario JSON con los controles (INPUTS) + GLSL. Aquí se leen y se
// dibujan como animaciones nuevas (fuente «shader» de una superficie). Corren en la GPU,
// aislados (WebGL): no pueden tocar archivos, red ni nada de la app.
// Compatibles:
//  - controles float, bool, long (lista), color, point2D, event;
//  - imágenes de entrada (image): la cámara o un video/foto de la biblioteca;
//  - audio (onda) y audioFFT (espectro): lo que escucha el micrófono (o el pulso del tempo);
//  - varias pasadas (PASSES) con TARGET, PERSISTENT (memoria entre fotogramas: estelas,
//    feedback), WIDTH/HEIGHT con expresiones ($WIDTH/2…) y FLOAT.
// Imágenes importadas (IMPORTED): EN DESARROLLO (se avisa al instalarlo).

const KINDS = { float: "float", bool: "bool", long: "int", color: "vec4", point2D: "vec2", event: "bool", image: "sampler2D", audio: "sampler2D", audioFFT: "sampler2D" };
export const isTexInput = (i) => i.type === "image" || i.type === "audio" || i.type === "audioFFT";

/** Expresión de tamaño de una pasada («$WIDTH/2.0», «floor($HEIGHT*0.5)»…) → número. Sin eval. */
export function evalSize(expr, W, H) {
  if (expr === undefined || expr === null || expr === "") return null;
  if (typeof expr === "number") return expr;
  const s = String(expr).replace(/\$WIDTH/g, String(W)).replace(/\$HEIGHT/g, String(H)).replace(/\s+/g, "");
  let i = 0;
  const num = () => { const m = /^\d+(\.\d*)?|^\.\d+/.exec(s.slice(i)); if (!m) throw new Error("expresión"); i += m[0].length; return +m[0]; };
  const fns = { floor: Math.floor, ceil: Math.ceil, round: Math.round, max: Math.max, min: Math.min, abs: Math.abs };
  function atom() {
    if (s[i] === "(") { i++; const v = add(); if (s[i++] !== ")") throw new Error("expresión"); return v; }
    if (s[i] === "-") { i++; return -atom(); }
    const f = /^[a-z]+/.exec(s.slice(i));
    if (f && fns[f[0]]) { i += f[0].length; if (s[i++] !== "(") throw new Error("expresión"); const args = [add()]; while (s[i] === ",") { i++; args.push(add()); } if (s[i++] !== ")") throw new Error("expresión"); return fns[f[0]](...args); }
    return num();
  }
  function mul() { let v = atom(); while (s[i] === "*" || s[i] === "/") { const op = s[i++]; const r = atom(); v = op === "*" ? v * r : v / r; } return v; }
  function add() { let v = mul(); while (s[i] === "+" || s[i] === "-") { const op = s[i++]; const r = mul(); v = op === "+" ? v + r : v - r; } return v; }
  try { const v = add(); return i === s.length && Number.isFinite(v) ? v : null; } catch { return null; }
}

/** Lee un shader ISF → { name, credit, description, inputs, passes, body } o lanza un error claro. */
export function parseISF(text, fallbackName = "Shader") {
  const src = String(text || "");
  const m = /\/\*([\s\S]*?)\*\//.exec(src);
  let meta = null;
  if (m) { try { meta = JSON.parse(m[1]); } catch {} }
  if (!meta || typeof meta !== "object") throw new Error("No es un shader ISF: falta la cabecera JSON /* { … } */ al principio.");
  const body = src.slice(m.index + m[0].length).replace(/^\s*#version[^\n]*\n/m, "");
  if (!/void\s+main\s*\(/.test(body)) throw new Error("El shader no tiene «void main()».");
  if (Array.isArray(meta.IMPORTED) ? meta.IMPORTED.length : meta.IMPORTED && Object.keys(meta.IMPORTED).length)
    throw new Error("Este shader usa imágenes importadas (IMPORTED): EN DESARROLLO (aún no compatible).");
  const passes = (Array.isArray(meta.PASSES) ? meta.PASSES : []).slice(0, 8).map(p => ({
    target: p && typeof p.TARGET === "string" && /^[A-Za-z_]\w{0,40}$/.test(p.TARGET) ? p.TARGET : "",
    persistent: !!(p?.PERSISTENT), float: !!(p?.FLOAT), width: p?.WIDTH ?? null, height: p?.HEIGHT ?? null }));
  const inputs = [];
  for (const i of Array.isArray(meta.INPUTS) ? meta.INPUTS : []) {
    if (!i || typeof i.NAME !== "string" || !/^[A-Za-z_]\w{0,40}$/.test(i.NAME)) continue;
    if (!KINDS[i.TYPE]) throw new Error(`El control «${i.NAME}» es de tipo «${i.TYPE}»: no compatible.`);
    const num = (v, d) => Number.isFinite(+v) ? +v : d;
    let def = i.DEFAULT;
    if (i.TYPE === "float") def = num(def, (num(i.MIN, 0) + num(i.MAX, 1)) / 2);
    else if (i.TYPE === "long") def = Math.round(num(def, Array.isArray(i.VALUES) ? i.VALUES[0] : num(i.MIN, 0)));
    else if (i.TYPE === "bool" || i.TYPE === "event") def = !!def;
    else if (i.TYPE === "color") def = Array.isArray(def) && def.length >= 3 ? [0, 1, 2, 3].map(k => num(def[k], 1)) : [1, 1, 1, 1];
    else if (i.TYPE === "point2D") def = Array.isArray(def) && def.length >= 2 ? [num(def[0], 0), num(def[1], 0)] : [0.5, 0.5];
    else def = null;   // imagen o audio: los pone la app
    inputs.push({ name: i.NAME, type: i.TYPE, label: String(i.LABEL || i.NAME).slice(0, 40),
      min: num(i.MIN, 0), max: num(i.MAX, i.TYPE === "long" ? 10 : 1), def,
      values: Array.isArray(i.VALUES) ? i.VALUES.slice(0, 32).map(v => Math.round(+v)) : null,
      labels: Array.isArray(i.LABELS) ? i.LABELS.slice(0, 32).map(x => String(x).slice(0, 30)) : null });
  }
  for (const p of passes) if (p.target && inputs.some(i => i.name === p.target)) throw new Error(`La pasada «${p.target}» se llama igual que un control.`);
  return {
    name: String(meta.NAME || meta.DESCRIPTION || fallbackName).slice(0, 60),
    credit: String(meta.CREDIT || "").slice(0, 80),
    description: String(meta.DESCRIPTION || "").slice(0, 200),
    inputs, passes, body,
    usesCamera: inputs.some(i => i.type === "image"), usesAudio: inputs.some(i => i.type === "audio" || i.type === "audioFFT"),
  };
}

const VERT = `attribute vec2 a_pos;
varying vec2 isf_FragNormCoord;
void main(){ isf_FragNormCoord = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

/** Imágenes que ve el shader: entradas de imagen/audio y las pasadas con nombre. */
const samplers = (isf) => [...isf.inputs.filter(isTexInput).map(i => i.name), ...new Set(isf.passes.map(p => p.target).filter(Boolean))];

/** Cabecera GLSL que ISF da hecha + las funciones IMG_* (sin pegar símbolos: GLSL ES no tiene ##). */
function header(isf) {
  const ins = isf.inputs.filter(i => !isTexInput(i)).map(i => `uniform ${KINDS[i.type]} ${i.name};`);
  const tex = samplers(isf).map(n => `uniform sampler2D ${n};\nuniform vec2 _${n}_imgSize;`);
  return `precision highp float;
precision highp int;
uniform vec2 RENDERSIZE;
uniform float TIME;
uniform float TIMEDELTA;
uniform int FRAMEINDEX;
uniform int PASSINDEX;
uniform vec4 DATE;
varying vec2 isf_FragNormCoord;
${ins.join("\n")}
${tex.join("\n")}
vec4 _isf_px(sampler2D s, vec2 size, vec2 c) { return texture2D(s, c / size); }
`;
}
/** IMG_PIXEL(img, c) → _isf_px(img, _img_imgSize, c) … (texto: los nombres de imagen son conocidos). */
function translate(isf) {
  let b = isf.body;
  for (const n of samplers(isf)) {
    b = b.replace(new RegExp(`IMG_SIZE\\s*\\(\\s*${n}\\s*\\)`, "g"), `_${n}_imgSize`)
      .replace(new RegExp(`IMG_THIS_(NORM_)?PIXEL\\s*\\(\\s*${n}\\s*\\)`, "g"), `texture2D(${n}, isf_FragNormCoord)`)
      .replace(new RegExp(`IMG_NORM_PIXEL\\s*\\(\\s*${n}\\s*,`, "g"), `texture2D(${n},`)
      .replace(new RegExp(`IMG_PIXEL\\s*\\(\\s*${n}\\s*,`, "g"), `_isf_px(${n}, _${n}_imgSize,`);
  }
  return b;
}

/** Espectro de 256 franjas (escala musical: más detalle en graves) desde los datos del analizador. */
export function spectrum256(bins, out = new Uint8Array(256)) {
  const n = bins?.length || 0;
  if (!n) return out.fill(0);
  for (let k = 0; k < 256; k++) {
    const a = Math.floor(Math.pow(n, k / 256)), b = Math.max(a + 1, Math.floor(Math.pow(n, (k + 1) / 256)));
    let m = 0; for (let i = a; i < b && i < n; i++) m = Math.max(m, bins[i]);
    out[k] = m;
  }
  return out;
}
/** Sin micrófono: un espectro sencillo a partir de los niveles (para que reaccione al tempo). */
export function spectrumFromLevels(lv = {}, out = new Uint8Array(256)) {
  const b = lv.bass || 0, m = lv.mid || 0, h = lv.high || 0, beat = lv.beat || 0;
  for (let k = 0; k < 256; k++) {
    const x = k / 255, v = x < 0.12 ? Math.max(b, beat * 0.8) : x < 0.45 ? m : h * (1 - (x - 0.45) * 0.8);
    out[k] = Math.max(0, Math.min(255, Math.round(v * 255)));
  }
  return out;
}

/**
 * Dibuja shaders ISF con un solo contexto WebGL (compartido por todas las superficies);
 * cada superficie recibe su imagen en un lienzo propio que el compositor usa como textura.
 * Las pasadas con memoria (PERSISTENT) se guardan por superficie (dos texturas que se turnan).
 */
export class ShaderCache {
  constructor() { this.gl = null; this.canvas = null; this.progs = new Map(); this.out = new Map(); this.errors = new Map(); this.blank = null; }
  ensureGL() {
    if (this.gl) return this.gl;
    this.canvas = document.createElement("canvas");
    const gl = this.canvas.getContext("webgl2", { preserveDrawingBuffer: true, alpha: false, antialias: false });
    if (!gl) throw new Error("WebGL2 no disponible");
    this.gl = gl;
    this.floatOk = !!gl.getExtension("EXT_color_buffer_float");
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    // Textura negra para entradas sin imagen todavía (cámara que aún no llega).
    this.blank = this.newTex(1, 1, new Uint8Array([0, 0, 0, 255]));
    return gl;
  }
  newTex(w, h, data = null, float = false) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (float && this.floatOk) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return t;
  }
  /** Programa de un shader (se compila una vez). Devuelve null y guarda el error si no compila. */
  program(id, isf) {
    if (this.progs.has(id)) return this.progs.get(id);
    const gl = this.ensureGL();
    const sh = (type, code) => { const s = gl.createShader(type); gl.shaderSource(s, code); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const e = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error(e || "no compila"); } return s; };
    let p = null;
    try {
      const prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, header(isf) + translate(isf)));
      gl.bindAttribLocation(prog, 0, "a_pos");
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || "no enlaza");
      const u = (n) => gl.getUniformLocation(prog, n);
      p = { prog, isf, loc: { size: u("RENDERSIZE"), time: u("TIME"), dt: u("TIMEDELTA"), frame: u("FRAMEINDEX"), pass: u("PASSINDEX"), date: u("DATE"),
        ins: isf.inputs.map(i => isTexInput(i) ? null : u(i.name)),
        tex: samplers(isf).map(n => ({ name: n, s: u(n), size: u(`_${n}_imgSize`) })) } };
    } catch (e) { this.errors.set(id, String(e.message || e).slice(0, 400)); }
    this.progs.set(id, p);
    return p;
  }
  /** Error de compilación de un shader (o ""). */
  error(id) { return this.errors.get(id) || ""; }
  forget(id) { const p = this.progs.get(id); if (p && this.gl) this.gl.deleteProgram(p.prog); this.progs.delete(id); this.errors.delete(id); }

  /** Sube una imagen (video, lienzo, foto) a la textura de esta superficie. */
  upload(e, name, el) {
    const gl = this.gl;
    const w = el?.videoWidth || el?.naturalWidth || el?.width || 0, h = el?.videoHeight || el?.naturalHeight || el?.height || 0;
    if (!el || !w || !h) return null;
    let t = e.tex.get(name);
    if (!t) { t = { tex: this.newTex(1, 1), w: 0, h: 0 }; e.tex.set(name, t); }
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);   // en GLSL la «y» va de abajo arriba
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el); t.w = w; t.h = h; } catch {}
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    return t;
  }
  uploadBytes(e, name, bytes, wave = false) {
    const gl = this.gl;
    let t = e.tex.get(name);
    if (!t) { t = { tex: this.newTex(1, 1), w: 0, h: 0 }; e.tex.set(name, t); }
    const n = bytes.length, rgba = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) { const v = bytes[i]; rgba[i * 4] = v; rgba[i * 4 + 1] = v; rgba[i * 4 + 2] = v; rgba[i * 4 + 3] = 255; }
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, n, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    t.w = n; t.h = 1; t.wave = wave;
    return t;
  }

  /**
   * Dibuja un shader en el lienzo de esta superficie: { canvas, version } o null.
   * images: { nombre: elemento (video/lienzo/img) } · audio: { fft: Uint8Array(256), wave: Uint8Array }
   */
  draw(key, id, isf, params = {}, { width = 960, height = 540, time = 0, images = {}, audio = null } = {}) {
    const p = this.program(id, isf);
    if (!p) return null;
    const gl = this.gl, c = this.canvas;
    let e = this.out.get(key);
    if (!e) { e = { canvas: document.createElement("canvas"), version: 0, last: time, frame: 0, tex: new Map(), targets: new Map(), id }; e.ctx = e.canvas.getContext("2d"); this.out.set(key, e); }
    if (e.id !== id) { this.dropTargets(e); e.id = id; e.frame = 0; }
    // Entradas de imagen y audio.
    for (const i of isf.inputs) {
      if (i.type === "image") this.upload(e, i.name, images[i.name]) || e.tex.delete(i.name);
      else if (i.type === "audioFFT") this.uploadBytes(e, i.name, audio?.fft || new Uint8Array(256));
      else if (i.type === "audio") this.uploadBytes(e, i.name, audio?.wave || new Uint8Array(256).fill(128), true);
    }
    gl.useProgram(p.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const L = p.loc, d = new Date();
    gl.uniform1f(L.time, time);
    gl.uniform1f(L.dt, Math.max(0, time - e.last));
    gl.uniform1i(L.frame, e.frame);
    gl.uniform4f(L.date, d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds());
    isf.inputs.forEach((i, k) => {
      const v = params[i.name] ?? i.def, l = L.ins[k];
      if (!l) return;
      if (i.type === "float") gl.uniform1f(l, +v);
      else if (i.type === "long") gl.uniform1i(l, Math.round(+v));
      else if (i.type === "bool" || i.type === "event") gl.uniform1i(l, v ? 1 : 0);
      else if (i.type === "color") gl.uniform4f(l, ...[0, 1, 2, 3].map(j => +(v?.[j] ?? 1)));
      else if (i.type === "point2D") gl.uniform2f(l, +(v?.[0] ?? 0.5), +(v?.[1] ?? 0.5));
    });
    const passes = isf.passes.length ? isf.passes : [{ target: "" }];
    passes.forEach((ps, pi) => {
      let fb = null, w = width, h = height;
      if (ps.target) {
        w = Math.max(1, Math.round(evalSize(ps.width, width, height) ?? width));
        h = Math.max(1, Math.round(evalSize(ps.height, width, height) ?? height));
        const t = this.target(e, ps, w, h);
        fb = t.fb[1 - t.cur];
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      if (!fb && (c.width !== width || c.height !== height)) { c.width = width; c.height = height; }
      gl.viewport(0, 0, w, h);
      gl.uniform2f(L.size, w, h);
      gl.uniform1i(L.pass, pi);
      // Texturas: entradas y pasadas (de esta pasada se lee la anterior, nunca la que se escribe).
      L.tex.forEach((tx, unit) => {
        gl.activeTexture(gl.TEXTURE0 + unit);
        const tg = e.targets.get(tx.name), inp = e.tex.get(tx.name);
        const tex = tg ? tg.tex[tg.cur] : inp ? inp.tex : this.blank;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        if (tx.s) gl.uniform1i(tx.s, unit);
        if (tx.size) gl.uniform2f(tx.size, tg ? tg.w : inp ? inp.w : 1, tg ? tg.h : inp ? inp.h : 1);
      });
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (ps.target) { const t = e.targets.get(ps.target); t.cur = 1 - t.cur; }
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE0);
    // Si la última pasada fue a una imagen con nombre, se ve esa.
    const lastT = passes[passes.length - 1].target;
    if (lastT) this.blitTarget(e, lastT, width, height);
    e.last = time; e.frame++; e.stamp = performance.now();
    if (e.canvas.width !== width || e.canvas.height !== height) { e.canvas.width = width; e.canvas.height = height; }
    e.ctx.drawImage(c, 0, 0);
    e.version++;
    return e;
  }
  /** Imagen de una pasada (dos texturas que se turnan; las PERSISTENT conservan lo anterior). */
  target(e, ps, w, h) {
    const gl = this.gl;
    let t = e.targets.get(ps.target);
    if (t && (t.w !== w || t.h !== h)) { this.dropTarget(t); t = null; }
    if (!t) {
      t = { w, h, cur: 0, tex: [this.newTex(w, h, null, ps.float), this.newTex(w, h, null, ps.float)], fb: [] };
      for (const tx of t.tex) { const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tx, 0); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); t.fb.push(f); }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      e.targets.set(ps.target, t);
    }
    if (!ps.persistent) {   // sin memoria: empieza en negro cada fotograma
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb[1 - t.cur]); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    }
    return t;
  }
  blitTarget(e, name, width, height) {
    const gl = this.gl, t = e.targets.get(name);
    if (!t) return;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, t.fb[t.cur]);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
    gl.blitFramebuffer(0, 0, t.w, t.h, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.LINEAR);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  }
  dropTarget(t) { const gl = this.gl; for (const x of t.tex) gl.deleteTexture(x); for (const f of t.fb) gl.deleteFramebuffer(f); }
  dropTargets(e) { for (const t of e.targets.values()) this.dropTarget(t); e.targets.clear(); }
  /** Quita una salida entera (texturas de entrada y memoria de pasadas). */
  dropEntry(key) {
    const e = this.out.get(key);
    if (!e) return;
    this.dropTargets(e);
    if (this.gl) for (const t of e.tex.values()) this.gl.deleteTexture(t.tex);
    this.out.delete(key);
  }
  /**
   * La cubierta B (lo que entra en vivo) pasa a ser la A: su memoria (estelas, feedback) sigue
   * igual en vez de empezar de cero o recuperar fotogramas viejos de la A.
   */
  adopt(keyA, keyB, id) {
    const a = this.out.get(keyA), b = this.out.get(keyB);
    // (si la A con este mismo shader se está dibujando ahora, es un fundido entre dos: no se toca)
    if (!b || b.id !== id || (a && a.id === id && performance.now() - (a.stamp || 0) < 250)) return;
    if (a) this.dropEntry(keyA);
    this.out.set(keyA, b); this.out.delete(keyB);
  }
  /** Libera el contexto WebGL propio (lienzos temporales: capturas, grabación). */
  dispose() {
    for (const k of [...this.out.keys()]) this.dropEntry(k);
    for (const id of [...this.progs.keys()]) this.forget(id);
    this.gl?.getExtension("WEBGL_lose_context")?.loseContext();
    this.gl = null;
  }
}

/** «#rrggbb» ↔ color ISF [r,g,b,a] (0-1). */
export const hexToIsf = (hex) => { const n = parseInt(String(hex).slice(1), 16) || 0; return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255, 1]; };
export const isfToHex = (c) => "#" + [0, 1, 2].map(k => Math.round(Math.max(0, Math.min(1, +(c?.[k] ?? 1))) * 255).toString(16).padStart(2, "0")).join("");
