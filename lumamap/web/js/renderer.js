// web/js/renderer.js
// Motor de composición WebGL2 de LumaMap.
//  · Corner pin con homografía exacta (UV homogéneas, división por w en el
//    fragment shader) y malla de deformación Catmull-Rom subdividida.
//  · Fuentes: textura (video, imagen, GIF, cámara, texto, dibujo), color y
//    16 generadores procedurales en GPU.
//  · Efectos por superficie en un solo shader: color, RGB split, pixelado,
//    desenfoque, ruido, caleidoscopio, espejo, ondas, zoom/giro/desplazamiento,
//    estroboscopio, borde animado (neón, persecución, pulso, arcoíris) y máscara.
import { GEN_INDEX } from "./model.js";
import { UNIT_SQUARE, tryHomography, evalMesh, triangulatePolygon, bbox, surfaceUVOutline, surfaceAspect, surfaceCorners } from "./math.js";

const MAXP = 64;

const VERT = `#version 300 es
layout(location=0) in vec2 a_pos;
layout(location=1) in vec3 a_uvh;
out vec3 v_uvh;
void main(){ v_uvh = a_uvh; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
in vec3 v_uvh;
out vec4 outColor;
uniform sampler2D u_tex;
uniform int u_src;            // 0 nada · 1 textura · 2 color · 3 generador
uniform vec4 u_fit;           // escala.xy, desplazamiento.xy
uniform int u_contain;
uniform int u_gen;
uniform vec3 u_c1, u_c2;
uniform float u_gscale, u_gtime;
uniform float u_aspect, u_time, u_alpha;
uniform float u_bri, u_con, u_sat, u_hue, u_rgb, u_pix, u_blur, u_noise;
uniform int u_inv, u_mirror;
uniform float u_kal, u_wave, u_zoom, u_rot;
uniform vec2 u_scroll;
uniform float u_border, u_glow;
uniform vec3 u_bcol;
uniform int u_banim;
uniform float u_beat;
uniform vec2 u_shape[${MAXP}];
uniform int u_shapeN;
uniform vec2 u_mask[${MAXP}];
uniform int u_maskN, u_maskInv;
uniform float u_maskFeather;

const float TAU = 6.28318530718;

float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
}
float fbm(vec2 p){ float v = 0.0, a = 0.5; for(int i=0;i<5;i++){ v += a*vnoise(p); p *= 2.03; a *= 0.5; } return v; }
vec3 hsv2rgb(vec3 c){
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
vec3 rgb2hsv(vec3 c){
  vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0*d + 1e-10)), d / (q.x + 1e-10), q.x);
}
float segDist(vec2 p, vec2 a, vec2 b){
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa,ba)/max(dot(ba,ba),1e-9), 0.0, 1.0);
  return length(pa - ba*h);
}
float gridLine(float x, float n){
  float f = abs(fract(x*n + 0.5) - 0.5) / n;
  float w = fwidth(x) * 1.2;
  return 1.0 - smoothstep(0.0, w, f);
}

vec4 generator(vec2 uv, vec2 p, float t){
  float s = u_gscale;
  vec3 A = u_c1, B = u_c2;
  if(u_gen==0){
    float v = sin(p.x*6.0*s + t) + sin((p.y*5.0*s - t)*1.3) + sin((p.x+p.y)*4.0*s + t*1.7) + sin(length(p*8.0*s) - t*2.0);
    return vec4(mix(A, B, 0.5+0.5*sin(v*1.3)), 1.0);
  }
  if(u_gen==1) return vec4(hsv2rgb(vec3(fract(uv.x*s + uv.y*0.2*s + t*0.1), 0.85, 1.0)), 1.0);
  if(u_gen==2){
    float r = length(p), a = atan(p.y, p.x)/TAU;
    float z = 0.35/max(r, 0.001) + t*0.6;
    float ring = step(0.5, fract(z*2.0*s)), seg = step(0.5, fract(a*8.0 + z*0.25));
    return vec4(mix(B, A, abs(ring-seg)) * clamp(r*2.5, 0.0, 1.0), 1.0);
  }
  if(u_gen==3){
    float k = pow(0.5+0.5*sin(length(p)*30.0*s - t*4.0), 3.0);
    return vec4(mix(B, A, k), 1.0);
  }
  if(u_gen==4) return vec4(mix(B, A, smoothstep(0.45, 0.55, abs(fract((uv.x+uv.y)*5.0*s - t*0.4)*2.0-1.0))), 1.0);
  if(u_gen==5){ vec2 g = floor(p*8.0*s + vec2(t*0.5, 0.0)); return vec4(mix(B, A, mod(g.x+g.y, 2.0)), 1.0); }
  if(u_gen==6) return vec4(mix(B, A, smoothstep(0.3, 0.8, fbm(p*3.0*s + vec2(t*0.2, t*0.1)))), 1.0);
  if(u_gen==7){
    vec2 q = vec2(p.x*4.0*s, (1.0-uv.y)*3.0*s);
    float n = fbm(q - vec2(0.0, t*1.6));
    float f = clamp(n*1.7 - (1.0-uv.y)*1.25 + 0.35, 0.0, 1.0);
    vec3 col = mix(vec3(0.0), B, smoothstep(0.0, 0.4, f));
    col = mix(col, A, smoothstep(0.35, 0.75, f));
    col = mix(col, vec3(1.0), smoothstep(0.85, 1.0, f));
    return vec4(col, 1.0);
  }
  if(u_gen==8){
    vec2 q = p*18.0*s, id = floor(q), f = fract(q)-0.5;
    float h = hash(id);
    vec2 o = vec2(hash(id+3.1), hash(id+7.7))-0.5;
    float d = length(f - o*0.6);
    float tw = 0.5+0.5*sin(t*3.0 + h*40.0);
    float k = smoothstep(0.09, 0.0, d) * step(0.55, h) * tw;
    return vec4(B*0.12 + A*k, 1.0);
  }
  if(u_gen==9){
    float r = length(p), a = atan(p.y, p.x);
    return vec4(mix(B, A, smoothstep(0.3, 0.7, 0.5+0.5*sin(a*3.0 + r*20.0*s - t*3.0))), 1.0);
  }
  if(u_gen==10){
    float x = 0.5+0.48*sin(t*1.5), y = 0.5+0.48*sin(t*1.1+1.0);
    float k = exp(-abs(uv.x-x)*70.0/s) + exp(-abs(uv.y-y)*70.0/s);
    return vec4(B*0.1 + A*k, 1.0);
  }
  if(u_gen==11){
    vec2 g = abs(fract(p*6.0*s + vec2(0.0, t*0.3)) - 0.5);
    return vec4(B*0.12 + A*exp(-min(g.x, g.y)*30.0), 1.0);
  }
  if(u_gen==12){
    float y = uv.y*10.0*s + sin(uv.x*8.0 + t*2.0)*0.6;
    return vec4(mix(B*0.1, A, smoothstep(0.12, 0.0, abs(fract(y)-0.5))), 1.0);
  }
  if(u_gen==13) return vec4(mix(A, B, 0.5+0.5*sin(uv.x*3.0*s + uv.y*2.0 + t)), 1.0);
  if(u_gen==14){
    vec2 q = vec2(uv.x*6.0*s*u_aspect, uv.y*12.0*s);
    q.x += step(1.0, mod(q.y, 2.0))*0.5;
    vec2 f = fract(q);
    float m = step(0.05, f.x)*step(0.09, f.y);
    float glow = 0.55 + 0.45*sin(t*2.0 + hash(floor(q))*TAU);
    return vec4(mix(B, A*glow, m), 1.0);
  }
  // 15: calibración — cuadrícula, diagonales, círculo y esquinas de color
  vec3 col = vec3(0.06);
  float l = max(gridLine(uv.x, 8.0), gridLine(uv.y, 8.0));
  col = mix(col, A, l*0.9);
  vec2 c = vec2((uv.x-0.5)*u_aspect, uv.y-0.5);
  float cw = fwidth(c.y)*1.5;
  col = mix(col, vec3(1.0), 1.0 - smoothstep(0.0, cw, abs(length(c) - 0.35)));
  col = mix(col, vec3(1.0), 1.0 - smoothstep(0.0, cw, min(abs(uv.x-uv.y), abs(uv.x+uv.y-1.0))*min(u_aspect,1.0)));
  float e = min(min(uv.x, 1.0-uv.x)*u_aspect, min(uv.y, 1.0-uv.y));
  col = mix(col, vec3(1.0), 1.0 - smoothstep(0.012, 0.012+cw, e));
  vec2 k = vec2(uv.x*u_aspect, uv.y);
  float R = 0.14;
  if(length(k) < R) col = vec3(1.0, 0.15, 0.15);
  if(length(k - vec2(u_aspect, 0.0)) < R) col = vec3(0.15, 1.0, 0.25);
  if(length(k - vec2(u_aspect, 1.0)) < R) col = vec3(0.2, 0.45, 1.0);
  if(length(k - vec2(0.0, 1.0)) < R) col = vec3(1.0, 0.9, 0.1);
  return vec4(col, 1.0);
}

vec4 sampleTex(vec2 cuv){
  vec2 tuv = (cuv - 0.5) * u_fit.xy + 0.5 + u_fit.zw;
  if(u_contain==1 && (tuv.x<0.0 || tuv.x>1.0 || tuv.y<0.0 || tuv.y>1.0)) return vec4(0.0);
  if(tuv.x<0.0 || tuv.x>1.0 || tuv.y<0.0 || tuv.y>1.0) tuv = fract(tuv);
  if(u_blur > 0.0){
    float r = u_blur * 0.012;
    vec4 acc = texture(u_tex, tuv) * 0.2;
    for(int i=0;i<8;i++){
      float a = float(i) * TAU / 8.0;
      acc += texture(u_tex, tuv + vec2(cos(a), sin(a)) * r) * 0.1;
    }
    return acc;
  }
  if(u_rgb > 0.0){
    vec4 c = texture(u_tex, tuv);
    c.r = texture(u_tex, tuv + vec2(u_rgb, 0.0)).r;
    c.b = texture(u_tex, tuv - vec2(u_rgb, 0.0)).b;
    return c;
  }
  return texture(u_tex, tuv);
}

float maskCoverage(vec2 p){
  bool inside = false;
  float dmin = 1e9;
  for(int i=0;i<${MAXP};i++){
    if(i>=u_maskN) break;
    vec2 a = u_mask[i];
    vec2 b = u_mask[(i+1==u_maskN)?0:i+1];
    dmin = min(dmin, segDist(p, a, b));
    if(((a.y>p.y)!=(b.y>p.y)) && (p.x < (b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)) inside = !inside;
  }
  if(u_maskInv==1) inside = !inside;
  float f = max(u_maskFeather, 1e-4);
  return clamp(0.5 + (inside?1.0:-1.0)*dmin/(2.0*f), 0.0, 1.0);
}

float shapeDist(vec2 uv){
  vec2 p = vec2(uv.x*u_aspect, uv.y);
  float d = 1e9;
  for(int i=0;i<${MAXP};i++){
    if(i>=u_shapeN) break;
    vec2 a = u_shape[i], b = u_shape[(i+1==u_shapeN)?0:i+1];
    d = min(d, segDist(p, vec2(a.x*u_aspect, a.y), vec2(b.x*u_aspect, b.y)));
  }
  return d;
}

void main(){
  vec2 uv = v_uvh.xy / v_uvh.z;
  // ---- transformación del contenido ----
  vec2 p = uv - 0.5;
  p.x *= u_aspect;
  if(u_mirror==1 || u_mirror==3) p.x = -abs(p.x);
  if(u_mirror==2 || u_mirror==3) p.y = -abs(p.y);
  if(u_kal >= 2.0){
    float r = length(p), a = atan(p.y, p.x);
    float seg = TAU / u_kal;
    a = mod(a, seg); a = abs(a - seg*0.5);
    p = r * vec2(cos(a), sin(a));
  }
  float cr = cos(u_rot), sr = sin(u_rot);
  p = mat2(cr, sr, -sr, cr) * p;
  p /= max(u_zoom, 0.01);
  if(u_wave > 0.0){
    p.x += sin(p.y*12.0 + u_time*3.0) * 0.03 * u_wave;
    p.y += cos(p.x*10.0 + u_time*2.4) * 0.03 * u_wave;
  }
  vec2 gp = p;
  vec2 cuv = vec2(p.x / u_aspect, p.y) + 0.5 + u_scroll;
  if(u_pix > 0.0){
    float cells = mix(260.0, 6.0, u_pix);
    vec2 n = vec2(cells*u_aspect, cells);
    cuv = (floor(cuv*n) + 0.5) / n;
    gp = (cuv - 0.5) * vec2(u_aspect, 1.0);
  }
  // ---- fuente ----
  vec4 c = vec4(0.0);
  if(u_src==1) c = sampleTex(cuv);
  else if(u_src==2) c = vec4(u_c1, 1.0);
  else if(u_src==3) c = generator(fract(cuv), gp, u_gtime);
  // ---- color ----
  if(c.a > 0.0){
    if(u_inv==1) c.rgb = 1.0 - c.rgb;
    c.rgb *= u_bri;
    c.rgb = (c.rgb - 0.5) * u_con + 0.5;
    float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
    c.rgb = mix(vec3(l), c.rgb, u_sat);
    if(u_hue != 0.0){ vec3 h = rgb2hsv(clamp(c.rgb, 0.0, 1.0)); h.x = fract(h.x + u_hue); c.rgb = hsv2rgb(h); }
    if(u_noise > 0.0) c.rgb += (hash(uv*vec2(1920.0, 1080.0) + fract(u_time*7.13)) - 0.5) * u_noise;
  }
  // ---- borde animado (efectos de línea sobre el contorno) ----
  if(u_border > 0.0){
    float d = shapeDist(uv);
    float w = u_border;
    float core = 1.0 - smoothstep(w*0.5, w*0.5 + fwidth(d)*1.5, d);
    float glow = exp(-max(d - w*0.5, 0.0) / max(w*(0.3 + u_glow*2.0), 1e-4)) * u_glow;
    float k = max(core, glow*0.9);
    vec3 bc = u_bcol;
    float ang = atan(uv.y-0.5, (uv.x-0.5)*u_aspect)/TAU + 0.5;
    if(u_banim==1) k *= smoothstep(0.3, 0.7, abs(fract(ang*6.0 - u_time*0.5)*2.0-1.0));
    if(u_banim==2) k *= 0.35 + 0.65*(0.5+0.5*sin(u_time*5.0)) + u_beat;
    if(u_banim==3) bc = hsv2rgb(vec3(fract(ang + u_time*0.2), 0.9, 1.0));
    k = clamp(k, 0.0, 1.0);
    c.rgb = mix(c.rgb * c.a, bc, k);
    c.a = max(c.a, k);
    if(c.a > 0.0) c.rgb /= c.a;
  }
  c.a *= u_alpha;
  if(u_maskN >= 3) c.a *= maskCoverage(uv);
  c.rgb = clamp(c.rgb, 0.0, 1.0);
  if(c.a <= 0.002) discard;
  outColor = vec4(c.rgb * c.a, c.a);   // alfa premultiplicado
}`;

const UNIFORMS = ["u_tex", "u_src", "u_fit", "u_contain", "u_gen", "u_c1", "u_c2", "u_gscale", "u_gtime",
  "u_aspect", "u_time", "u_alpha", "u_bri", "u_con", "u_sat", "u_hue", "u_rgb", "u_pix", "u_blur", "u_noise",
  "u_inv", "u_mirror", "u_kal", "u_wave", "u_zoom", "u_rot", "u_scroll", "u_border", "u_glow", "u_bcol",
  "u_banim", "u_beat", "u_shape", "u_shapeN", "u_mask", "u_maskN", "u_maskInv", "u_maskFeather"];

export function hexToRgb(hex) {
  const h = String(hex || "#ffffff").replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h.slice(0, 6), 16) || 0;
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

const MIRROR = { none: 0, h: 1, v: 2, quad: 3 };
const BANIM = { none: 0, chase: 1, pulse: 2, rainbow: 3 };

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error("Shader: " + gl.getShaderInfoLog(sh));
  return sh;
}

export function webgl2Supported() {
  try { return !!document.createElement("canvas").getContext("webgl2"); } catch { return false; }
}

export class Renderer {
  constructor(canvas, { preserve = false } = {}) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: true, preserveDrawingBuffer: preserve });
    if (!gl) throw new Error("WebGL2 no disponible en este dispositivo");
    this.gl = gl;
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("Link: " + gl.getProgramInfoLog(prog));
    this.prog = prog;
    gl.useProgram(prog);
    this.loc = {};
    for (const n of UNIFORMS) this.loc[n] = gl.getUniformLocation(prog, n);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 20, 8);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    this.textures = new Map();   // key -> {tex, w, h, frame}
    this.meshCache = new Map();  // surfaceId -> {sig, data}
    this.shapeBuf = new Float32Array(MAXP * 2);
    this.maskBuf = new Float32Array(MAXP * 2);
  }

  resize(w, h) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
  }

  begin(clear = [0, 0, 0, 1]) {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(...clear);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    gl.enable(gl.BLEND);
  }

  /** Sube (o reutiliza) una textura; solo vuelve a subir si cambia frameKey. */
  texture(key, source, frameKey) {
    const gl = this.gl;
    let t = this.textures.get(key);
    if (!t) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      t = { tex, w: 0, h: 0, frame: undefined, ok: false };
      this.textures.set(key, t);
    }
    if (source && t.frame !== frameKey) {
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        t.w = source.videoWidth || source.naturalWidth || source.width || 1;
        t.h = source.videoHeight || source.naturalHeight || source.height || 1;
        t.ok = true;
      } catch { /* fotograma todavía no disponible */ }
      t.frame = frameKey;
    }
    return t.ok ? t : null;
  }

  releaseTexture(key) {
    const t = this.textures.get(key);
    if (t) { this.gl.deleteTexture(t.tex); this.textures.delete(key); }
  }

  /** Malla de la superficie en coordenadas clip (con la vista aplicada). */
  mesh(s, view, cw, ch) {
    const sig = `${view.sx},${view.sy},${view.tx},${view.ty},${cw},${ch},${s.cols},${s.rows},` +
      s.points.map(p => p.x.toFixed(2) + "," + p.y.toFixed(2)).join(";");
    const cached = this.meshCache.get(s.id);
    if (cached && cached.sig === sig) return cached.data;
    const X = (x) => ((x * view.sx + view.tx) / cw) * 2 - 1;
    const Y = (y) => 1 - ((y * view.sy + view.ty) / ch) * 2;
    const v = [];
    if (s.type === "quad" && s.cols === 2 && s.rows === 2) {
      // Corner pin exacto: (u/w, v/w, 1/w) es lineal en pantalla, así que la
      // interpolación del rasterizador + la división en el fragment shader
      // reproducen la perspectiva sin aproximaciones. La vista es afín y no
      // altera w, por eso basta la homografía en coordenadas de proyecto.
      const corners = surfaceCorners(s);
      const H = tryHomography(UNIT_SQUARE, corners);
      for (const i of [0, 1, 2, 0, 2, 3]) {
        const [u, w] = UNIT_SQUARE[i];
        const [x, y] = corners[i];
        const q = H ? 1 / (H[6] * u + H[7] * w + H[8]) : 1;
        v.push(X(x), Y(y), u * q, w * q, q);
      }
    } else if (s.type === "quad") {
      const S = 10, N = (s.cols - 1) * S, M = (s.rows - 1) * S;
      const grid = [];
      for (let r = 0; r <= M; r++) for (let c = 0; c <= N; c++) grid.push(evalMesh(s.points, s.cols, s.rows, c / N, r / M));
      const at = (c, r) => grid[r * (N + 1) + c];
      for (let r = 0; r < M; r++) for (let c = 0; c < N; c++) {
        const q = [[c, r], [c + 1, r], [c + 1, r + 1], [c, r], [c + 1, r + 1], [c, r + 1]];
        for (const [cc, rr] of q) { const p = at(cc, rr); v.push(X(p.x), Y(p.y), cc / N, rr / M, 1); }
      }
    } else {
      const b = bbox(s.points);
      for (const i of triangulatePolygon(s.points)) {
        const p = s.points[i];
        v.push(X(p.x), Y(p.y), (p.x - b.x) / b.w, (p.y - b.y) / b.h, 1);
      }
    }
    const data = new Float32Array(v);
    this.meshCache.set(s.id, { sig, data });
    return data;
  }

  /**
   * Dibuja una superficie con su look.
   * o = { view, time, alpha, tex:{tex,w,h}|null, levels, master }
   */
  drawSurface(s, look, o) {
    const gl = this.gl, L = this.loc, fx = look.fx, src = look.source;
    const cw = this.canvas.width, ch = this.canvas.height;
    const lv = o.levels || { bass: 0, mid: 0, high: 0, level: 0, beat: 0 };
    const { aspect } = surfaceAspect(s);

    // Audio reactivo: modula un parámetro del look.
    let bri = fx.brightness, alpha = look.opacity * o.alpha, zoom = fx.zoom, hue = fx.hue, border = fx.border, strobe = fx.strobe;
    if (look.audio?.enabled) {
      const a = (lv[look.audio.band] ?? 0) * (look.audio.amount ?? 1);
      switch (look.audio.target) {
        case "brightness": bri *= 0.25 + a * 1.25; break;
        case "opacity": alpha *= Math.min(1, 0.1 + a); break;
        case "scale": zoom *= 1 + a * 0.35; break;
        case "hue": hue += a * 0.5; break;
        case "border": border = Math.max(border, 0.004) * (1 + a * 4); break;
        case "strobe": if (lv.beat < 0.5 * (look.audio.amount ?? 1)) alpha *= 0.05; break;
      }
    }
    if (strobe > 0 && Math.floor(o.time * strobe * 2) % 2 === 1) alpha *= 0.0;
    if (alpha <= 0.002) return;

    let srcType = 0;
    if (src.type === "color") srcType = 2;
    else if (src.type === "gen") srcType = 3;
    else if (o.tex) srcType = 1;
    if (srcType === 0 && border <= 0) return;

    gl.uniform1i(L.u_src, srcType);
    if (srcType === 1) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, o.tex.tex);
      gl.uniform1i(L.u_tex, 0);
      const ta = o.tex.w / Math.max(1, o.tex.h);
      let sx = 1, sy = 1;
      if (look.fit === "cover") { if (ta > aspect) sx = aspect / ta; else sy = ta / aspect; }
      else if (look.fit === "contain") { if (ta > aspect) sy = ta / aspect; else sx = aspect / ta; }
      gl.uniform4f(L.u_fit, sx, sy, 0, 0);
      gl.uniform1i(L.u_contain, look.fit === "contain" ? 1 : 0);
    } else {
      gl.uniform4f(L.u_fit, 1, 1, 0, 0);
      gl.uniform1i(L.u_contain, 0);
    }
    gl.uniform1i(L.u_gen, GEN_INDEX[src.gen] ?? 0);
    gl.uniform3fv(L.u_c1, hexToRgb(src.color));
    gl.uniform3fv(L.u_c2, hexToRgb(src.color2));
    gl.uniform1f(L.u_gscale, src.scale || 1);
    gl.uniform1f(L.u_gtime, o.time * (src.speed ?? 1) + (look.audio?.enabled ? lv.beat * 0.3 : 0));
    gl.uniform1f(L.u_aspect, aspect);
    gl.uniform1f(L.u_time, o.time);
    gl.uniform1f(L.u_alpha, Math.min(1, alpha) * (o.master ?? 1));
    gl.uniform1f(L.u_bri, bri);
    gl.uniform1f(L.u_con, fx.contrast);
    gl.uniform1f(L.u_sat, fx.saturation);
    gl.uniform1f(L.u_hue, hue);
    gl.uniform1f(L.u_rgb, fx.rgbShift);
    gl.uniform1f(L.u_pix, fx.pixelate);
    gl.uniform1f(L.u_blur, srcType === 1 ? fx.blur : 0);
    gl.uniform1f(L.u_noise, fx.noise);
    gl.uniform1i(L.u_inv, fx.invert ? 1 : 0);
    gl.uniform1i(L.u_mirror, MIRROR[fx.mirror] ?? 0);
    gl.uniform1f(L.u_kal, fx.kaleido || 0);
    gl.uniform1f(L.u_wave, fx.wave);
    gl.uniform1f(L.u_zoom, zoom);
    gl.uniform1f(L.u_rot, (fx.rotate || 0) * Math.PI / 180 + (fx.spin || 0) * o.time);
    gl.uniform2f(L.u_scroll, ((fx.scrollX || 0) * o.time) % 1, ((fx.scrollY || 0) * o.time) % 1);
    gl.uniform1f(L.u_border, border);
    gl.uniform1f(L.u_glow, fx.borderGlow ?? 0.5);
    gl.uniform3fv(L.u_bcol, hexToRgb(fx.borderColor));
    gl.uniform1i(L.u_banim, BANIM[fx.borderAnim] ?? 0);
    gl.uniform1f(L.u_beat, lv.beat || 0);

    if (border > 0) {
      const shape = surfaceUVOutline(s);
      const n = Math.min(shape.length, MAXP);
      for (let i = 0; i < n; i++) { this.shapeBuf[i * 2] = shape[i].x; this.shapeBuf[i * 2 + 1] = shape[i].y; }
      gl.uniform2fv(L.u_shape, this.shapeBuf);
      gl.uniform1i(L.u_shapeN, n);
    } else gl.uniform1i(L.u_shapeN, 0);

    const m = s.mask;
    if (m && m.enabled && m.points.length >= 3) {
      const n = Math.min(m.points.length, MAXP);
      for (let i = 0; i < n; i++) { this.maskBuf[i * 2] = m.points[i].x; this.maskBuf[i * 2 + 1] = m.points[i].y; }
      gl.uniform2fv(L.u_mask, this.maskBuf);
      gl.uniform1i(L.u_maskN, n);
      gl.uniform1i(L.u_maskInv, m.invert ? 1 : 0);
      gl.uniform1f(L.u_maskFeather, m.feather || 0.0005);
    } else gl.uniform1i(L.u_maskN, 0);

    switch (look.blend) {
      case "add": gl.blendFunc(gl.ONE, gl.ONE); break;
      case "screen": gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR); break;
      case "multiply": gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA); break;
      default: gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }
    const data = this.mesh(s, o.view, cw, ch);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, data.length / 5);
  }

  forgetSurface(id) { this.meshCache.delete(id); }
}
