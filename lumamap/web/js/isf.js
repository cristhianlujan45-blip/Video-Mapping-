// web/js/isf.js
// Shaders ISF (Interactive Shader Format, el formato de shaders de VJ que usan Resolume,
// VDMX, Millumin…): un comentario JSON con los controles (INPUTS) + GLSL. Aquí se leen y se
// dibujan como animaciones nuevas (fuente «shader» de una superficie). Corren en la GPU,
// aislados (WebGL): no pueden tocar archivos, red ni nada de la app.
// Compatibles: generadores de una pasada con controles float/bool/long/color/point2D.
// Con imágenes de entrada, audio o varias pasadas: EN DESARROLLO (se avisa al instalarlos).

const KINDS = { float: "float", bool: "bool", long: "int", color: "vec4", point2D: "vec2", event: "bool" };

/** Lee un shader ISF → { name, credit, description, inputs:[{name,type,label,min,max,def}], body } o lanza un error claro. */
export function parseISF(text, fallbackName = "Shader") {
  const src = String(text || "");
  const m = /\/\*([\s\S]*?)\*\//.exec(src);
  let meta = null;
  if (m) { try { meta = JSON.parse(m[1]); } catch {} }
  if (!meta || typeof meta !== "object") throw new Error("No es un shader ISF: falta la cabecera JSON /* { … } */ al principio.");
  const body = src.slice(m.index + m[0].length).replace(/^\s*#version[^\n]*\n/m, "");
  if (!/void\s+main\s*\(/.test(body)) throw new Error("El shader no tiene «void main()».");
  const passes = Array.isArray(meta.PASSES) ? meta.PASSES : [];
  if (passes.length > 1 || passes.some(p => p && (p.TARGET || p.PERSISTENT)))
    throw new Error("Este shader usa varias pasadas o memoria entre fotogramas: EN DESARROLLO (aún no compatible).");
  if (Array.isArray(meta.IMPORTED) ? meta.IMPORTED.length : meta.IMPORTED && Object.keys(meta.IMPORTED).length)
    throw new Error("Este shader usa imágenes importadas: EN DESARROLLO (aún no compatible).");
  const inputs = [];
  for (const i of Array.isArray(meta.INPUTS) ? meta.INPUTS : []) {
    if (!i || typeof i.NAME !== "string" || !/^[A-Za-z_]\w{0,40}$/.test(i.NAME)) continue;
    if (!KINDS[i.TYPE]) throw new Error(`El control «${i.NAME}» es de tipo «${i.TYPE}» (imagen o audio): EN DESARROLLO (aún no compatible).`);
    const num = (v, d) => Number.isFinite(+v) ? +v : d;
    let def = i.DEFAULT;
    if (i.TYPE === "float") def = num(def, (num(i.MIN, 0) + num(i.MAX, 1)) / 2);
    else if (i.TYPE === "long") def = Math.round(num(def, Array.isArray(i.VALUES) ? i.VALUES[0] : num(i.MIN, 0)));
    else if (i.TYPE === "bool" || i.TYPE === "event") def = !!def;
    else if (i.TYPE === "color") def = Array.isArray(def) && def.length >= 3 ? [0, 1, 2, 3].map(k => num(def[k], k === 3 ? 1 : 1)) : [1, 1, 1, 1];
    else if (i.TYPE === "point2D") def = Array.isArray(def) && def.length >= 2 ? [num(def[0], 0), num(def[1], 0)] : [0, 0];
    inputs.push({ name: i.NAME, type: i.TYPE, label: String(i.LABEL || i.NAME).slice(0, 40),
      min: num(i.MIN, i.TYPE === "long" ? 0 : 0), max: num(i.MAX, i.TYPE === "long" ? 10 : 1), def,
      values: Array.isArray(i.VALUES) ? i.VALUES.slice(0, 32).map(v => Math.round(+v)) : null,
      labels: Array.isArray(i.LABELS) ? i.LABELS.slice(0, 32).map(x => String(x).slice(0, 30)) : null });
  }
  return {
    name: String(meta.NAME || meta.DESCRIPTION || fallbackName).slice(0, 60),
    credit: String(meta.CREDIT || "").slice(0, 80),
    description: String(meta.DESCRIPTION || "").slice(0, 200),
    inputs, body,
  };
}

const VERT = `attribute vec2 a_pos;
varying vec2 isf_FragNormCoord;
void main(){ isf_FragNormCoord = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

/** Cabecera GLSL que ISF da hecha (uniformes estándar + los controles del shader). */
function header(isf) {
  const ins = isf.inputs.map(i => `uniform ${KINDS[i.type]} ${i.name};`).join("\n");
  return `precision highp float;
precision highp int;
uniform vec2 RENDERSIZE;
uniform float TIME;
uniform float TIMEDELTA;
uniform int FRAMEINDEX;
uniform int PASSINDEX;
uniform vec4 DATE;
varying vec2 isf_FragNormCoord;
${ins}
`;
}

/**
 * Dibuja shaders ISF con un solo contexto WebGL (compartido por todas las superficies);
 * cada superficie recibe su imagen en un lienzo propio que el compositor usa como textura.
 */
export class ShaderCache {
  constructor() { this.gl = null; this.canvas = null; this.progs = new Map(); this.out = new Map(); this.errors = new Map(); }
  ensureGL() {
    if (this.gl) return this.gl;
    this.canvas = document.createElement("canvas");
    const gl = this.canvas.getContext("webgl2", { preserveDrawingBuffer: true, alpha: false, antialias: false }) || this.canvas.getContext("webgl", { preserveDrawingBuffer: true, alpha: false });
    if (!gl) throw new Error("WebGL no disponible");
    this.gl = gl;
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    return gl;
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
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, header(isf) + isf.body));
      gl.bindAttribLocation(prog, 0, "a_pos");
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || "no enlaza");
      const u = (n) => gl.getUniformLocation(prog, n);
      p = { prog, isf, loc: { size: u("RENDERSIZE"), time: u("TIME"), dt: u("TIMEDELTA"), frame: u("FRAMEINDEX"), pass: u("PASSINDEX"), date: u("DATE"), ins: isf.inputs.map(i => u(i.name)) } };
    } catch (e) { this.errors.set(id, String(e.message || e).slice(0, 400)); }
    this.progs.set(id, p);
    return p;
  }
  /** Error de compilación de un shader (o ""). */
  error(id) { return this.errors.get(id) || ""; }
  forget(id) { const p = this.progs.get(id); if (p && this.gl) this.gl.deleteProgram(p.prog); this.progs.delete(id); this.errors.delete(id); }

  /** Dibuja un shader en el lienzo de esta superficie: { canvas, version } o null. */
  draw(key, id, isf, params = {}, { width = 960, height = 540, time = 0 } = {}) {
    const p = this.program(id, isf);
    if (!p) return null;
    const gl = this.gl, c = this.canvas;
    if (c.width !== width || c.height !== height) { c.width = width; c.height = height; }
    gl.viewport(0, 0, width, height);
    gl.useProgram(p.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    let e = this.out.get(key);
    if (!e) { e = { canvas: document.createElement("canvas"), version: 0, last: time, frame: 0 }; e.ctx = e.canvas.getContext("2d"); this.out.set(key, e); }
    const L = p.loc, d = new Date();
    gl.uniform2f(L.size, width, height);
    gl.uniform1f(L.time, time);
    gl.uniform1f(L.dt, Math.max(0, time - e.last));
    gl.uniform1i(L.frame, e.frame++);
    gl.uniform1i(L.pass, 0);
    gl.uniform4f(L.date, d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds());
    isf.inputs.forEach((i, k) => {
      const v = params[i.name] ?? i.def, l = L.ins[k];
      if (!l) return;
      if (i.type === "float") gl.uniform1f(l, +v);
      else if (i.type === "long") gl.uniform1i(l, Math.round(+v));
      else if (i.type === "bool" || i.type === "event") gl.uniform1i(l, v ? 1 : 0);
      else if (i.type === "color") gl.uniform4f(l, ...[0, 1, 2, 3].map(j => +(v?.[j] ?? 1)));
      else if (i.type === "point2D") gl.uniform2f(l, +(v?.[0] ?? 0), +(v?.[1] ?? 0));
    });
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    e.last = time;
    if (e.canvas.width !== width || e.canvas.height !== height) { e.canvas.width = width; e.canvas.height = height; }
    e.ctx.drawImage(c, 0, 0);
    e.version++;
    return e;
  }
}

/** «#rrggbb» ↔ color ISF [r,g,b,a] (0-1). */
export const hexToIsf = (hex) => { const n = parseInt(String(hex).slice(1), 16) || 0; return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255, 1]; };
export const isfToHex = (c) => "#" + [0, 1, 2].map(k => Math.round(Math.max(0, Math.min(1, +(c?.[k] ?? 1))) * 255).toString(16).padStart(2, "0")).join("");
