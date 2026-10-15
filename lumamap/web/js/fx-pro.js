// web/js/fx-pro.js
// Efectos interactivos «de verdad», como los de los suelos y paredes interactivos
// comerciales: simulaciones en la GPU (WebGL2) que reaccionan a la silueta de la
// gente que ve la cámara:
//   · Agua: ecuación de onda (las ondas se propagan, rebotan y se mezclan) con
//     refracción, cáusticas y brillo; también en versión neón y con peces koi.
//   · Fluido: simulación de fluidos (advección, vorticidad, presión) donde el
//     cuerpo empuja tinta de colores o humo.
//   · Arena y nieve: huellas que se marcan al pisar y se rellenan despacio.
//   · Niebla: la gente la aparta y deja ver un cielo de colores detrás.
//   · Hojas, pétalos y una pelota gigante: física de partículas que la gente empuja.
// Entrada: la máscara de la persona ya alineada con la proyección (alfa = persona).
// Salida: un canvas con los colores finales (la superficie lo muestra tal cual).
// Si el equipo no tiene WebGL2 con texturas flotantes, cada efecto usa un
// respaldo en 2D (más sencillo) en lugar de fallar.

export const PRO_MODES = [
  ["agua", "Agua real"], ["agua_neon", "Agua de neón"], ["koi", "Estanque con peces koi"],
  ["fluido", "Fluido de colores"], ["humo_pro", "Humo que empujas"], ["arena", "Arena con huellas"],
  ["nieve", "Nieve con huellas"], ["niebla", "Niebla que se aparta"], ["hojas", "Hojas de otoño"],
  ["petalos", "Pétalos de flores"], ["pelota", "Pelota gigante"], ["polvo", "Polvo de estrellas"],
  ["burbujas_pro", "Burbujas de jabón (tócalas)"],
];
export const PRO_MODE_IDS = new Set(PRO_MODES.map(m => m[0]));

const VS = `#version 300 es
in vec2 p; out vec2 uv;
void main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

const HEAD = `#version 300 es
precision highp float; precision highp sampler2D;
in vec2 uv; out vec4 o;
`;

const FS = {
  copy: HEAD + `uniform sampler2D t; void main(){ o = texture(t, uv); }`,
  // Movimiento de la máscara (actual − anterior) y la propia máscara.
  // ---------------- Agua: ecuación de onda ----------------
  wave: HEAD + `uniform sampler2D s, m, mp; uniform vec2 px; uniform float damp, rain, t;
  float hash(vec2 q){ return fract(sin(dot(q, vec2(12.9898,78.233))) * 43758.5453); }
  void main(){
    vec2 h = texture(s, uv).rg;
    float n = texture(s, uv + vec2(px.x,0.)).r + texture(s, uv - vec2(px.x,0.)).r + texture(s, uv + vec2(0.,px.y)).r + texture(s, uv - vec2(0.,px.y)).r;
    float nh = (n * 0.5 - h.g) * damp;
    float a = texture(m, uv).a, b = texture(mp, uv).a;
    nh += clamp(abs(a - b) * 2.0, 0.0, 1.0) * 0.28;            // al moverse, el agua se agita
    nh += a * 0.004 * sin(t * 9.0 + uv.x * 40.0);               // quieto: pequeñas ondas alrededor
    if (rain > 0.0 && hash(floor(uv / px / 3.0) + floor(t * 7.0)) > 1.0 - rain) nh += 0.35;   // gotas sueltas
    o = vec4(clamp(nh, -4.0, 4.0), h.r, 0.0, 1.0);
  }`,
  waterShade: HEAD + `uniform sampler2D s; uniform vec2 px; uniform float t, neon; uniform vec3 c1, c2;
  float tile(vec2 q){ vec2 g = abs(fract(q) - 0.5); return smoothstep(0.47, 0.49, max(g.x, g.y)); }
  void main(){
    float hl = texture(s, uv - vec2(px.x,0.)).r, hr = texture(s, uv + vec2(px.x,0.)).r;
    float hd = texture(s, uv - vec2(0.,px.y)).r, hu = texture(s, uv + vec2(0.,px.y)).r;
    vec3 nrm = normalize(vec3(hl - hr, hd - hu, 0.6));
    vec2 r = uv + nrm.xy * 0.035;                              // refracción
    if (neon > 0.5) {
      float e = clamp(length(nrm.xy) * 5.0, 0.0, 1.0);
      vec3 col = mix(c2 * 0.08, c1, e) + c2 * pow(e, 3.0) * 1.5;
      o = vec4(col, 1.0); return;
    }
    float cs = 0.0; vec2 q = r * 7.0;                          // cáusticas
    for (int i = 0; i < 3; i++) { q += vec2(sin(q.y * 1.7 + t * 0.9), cos(q.x * 1.3 - t * 0.7)) * 0.45; cs += 0.5 + 0.5 * sin(q.x + q.y); }
    cs = pow(cs / 3.0, 6.0) * 1.8;
    vec3 floorCol = mix(c2, c2 * 1.25 + 0.05, tile(r * vec2(12.0, 12.0 * px.x / px.y)));
    vec3 col = mix(floorCol, c1 * 0.7, 0.55) + cs * vec3(0.55, 0.85, 1.0) * 0.35;
    float spec = pow(max(0.0, dot(reflect(-normalize(vec3(0.4, 0.5, 1.0)), nrm), vec3(0.0, 0.0, 1.0))), 80.0);
    col += spec * 0.9 + clamp((1.0 - nrm.z) * 2.5, 0.0, 0.5);
    o = vec4(col, 1.0);
  }`,
  // ---------------- Fluido (estilo «stable fluids») ----------------
  advect: HEAD + `uniform sampler2D v, x; uniform vec2 vpx; uniform float dt, diss;
  void main(){ vec2 c = uv - dt * texture(v, uv).xy * vpx; o = texture(x, c) * diss; }`,
  curl: HEAD + `uniform sampler2D v; uniform vec2 vpx;
  void main(){ float l = texture(v, uv - vec2(vpx.x,0.)).y, r = texture(v, uv + vec2(vpx.x,0.)).y, b = texture(v, uv - vec2(0.,vpx.y)).x, tp = texture(v, uv + vec2(0.,vpx.y)).x;
    o = vec4(0.5 * (r - l - tp + b), 0., 0., 1.); }`,
  vort: HEAD + `uniform sampler2D v, c; uniform vec2 vpx; uniform float dt, k;
  void main(){ float l = texture(c, uv - vec2(vpx.x,0.)).x, r = texture(c, uv + vec2(vpx.x,0.)).x, b = texture(c, uv - vec2(0.,vpx.y)).x, tp = texture(c, uv + vec2(0.,vpx.y)).x, cc = texture(c, uv).x;
    vec2 f = 0.5 * vec2(abs(tp) - abs(b), abs(r) - abs(l)); f /= length(f) + 1e-4; f *= k * cc; f.y *= -1.0;
    o = vec4(texture(v, uv).xy + f * dt, 0., 1.); }`,
  div: HEAD + `uniform sampler2D v; uniform vec2 vpx;
  void main(){ float l = texture(v, uv - vec2(vpx.x,0.)).x, r = texture(v, uv + vec2(vpx.x,0.)).x, b = texture(v, uv - vec2(0.,vpx.y)).y, tp = texture(v, uv + vec2(0.,vpx.y)).y;
    o = vec4(0.5 * (r - l + tp - b), 0., 0., 1.); }`,
  jacobi: HEAD + `uniform sampler2D pr, d; uniform vec2 vpx;
  void main(){ float l = texture(pr, uv - vec2(vpx.x,0.)).x, r = texture(pr, uv + vec2(vpx.x,0.)).x, b = texture(pr, uv - vec2(0.,vpx.y)).x, tp = texture(pr, uv + vec2(0.,vpx.y)).x;
    o = vec4((l + r + b + tp - texture(d, uv).x) * 0.25, 0., 0., 1.); }`,
  grad: HEAD + `uniform sampler2D pr, v; uniform vec2 vpx;
  void main(){ float l = texture(pr, uv - vec2(vpx.x,0.)).x, r = texture(pr, uv + vec2(vpx.x,0.)).x, b = texture(pr, uv - vec2(0.,vpx.y)).x, tp = texture(pr, uv + vec2(0.,vpx.y)).x;
    o = vec4(texture(v, uv).xy - 0.5 * vec2(r - l, tp - b), 0., 1.); }`,
  scale: HEAD + `uniform sampler2D x; uniform float k; void main(){ o = texture(x, uv) * k; }`,
  // El cuerpo empuja: fuerza = −∇máscara · (actual − anterior): el borde que avanza empuja hacia delante.
  bodyForce: HEAD + `uniform sampler2D v, m, mp; uniform vec2 mpx; uniform float k;
  void main(){ float a = texture(m, uv).a, b = texture(mp, uv).a;
    vec2 g = vec2(texture(m, uv + vec2(mpx.x*2.,0.)).a - texture(m, uv - vec2(mpx.x*2.,0.)).a, texture(m, uv + vec2(0.,mpx.y*2.)).a - texture(m, uv - vec2(0.,mpx.y*2.)).a);
    vec2 f = -g * (a - b) * k;
    o = vec4(texture(v, uv).xy + f, 0., 1.); }`,
  bodyDye: HEAD + `uniform sampler2D x, m, mp; uniform vec3 col; uniform float k;
  void main(){ float a = texture(m, uv).a, b = texture(mp, uv).a; float e = clamp(abs(a - b) * 3.0 + a * 0.006, 0.0, 1.0) * k;
    o = vec4(texture(x, uv).rgb + col * e, 1.); }`,
  fluidShade: HEAD + `uniform sampler2D x; uniform float smoke; uniform vec3 c2;
  void main(){ vec3 c = texture(x, uv).rgb;
    if (smoke > 0.5) { float l = clamp(dot(c, vec3(0.33)), 0.0, 1.0); o = vec4(mix(c2 * 0.05, vec3(0.92, 0.95, 1.0), pow(l, 0.8)), 1.0); return; }
    c = c / (1.0 + c * 0.35); o = vec4(pow(c, vec3(0.85)) + c2 * 0.04, 1.0); }`,
  // ---------------- Arena / nieve (huellas que se rellenan) ----------------
  dent: HEAD + `uniform sampler2D s, m; uniform float refill;
  void main(){ float h = texture(s, uv).r; float a = texture(m, uv).a; h = min(mix(h, 1.0, refill), 1.0 - a * 0.85); o = vec4(h, 0., 0., 1.); }`,
  groundShade: HEAD + `uniform sampler2D s; uniform vec2 px; uniform vec3 c1, c2; uniform float snow, t;
  float hash(vec2 q){ return fract(sin(dot(q, vec2(12.9898,78.233))) * 43758.5453); }
  void main(){
    float hl = texture(s, uv - vec2(px.x,0.)).r, hr = texture(s, uv + vec2(px.x,0.)).r, hd = texture(s, uv - vec2(0.,px.y)).r, hu = texture(s, uv + vec2(0.,px.y)).r, h = texture(s, uv).r;
    vec3 n = normalize(vec3((hl - hr) * 3.0, (hd - hu) * 3.0, 0.25));
    float dif = clamp(dot(n, normalize(vec3(-0.5, 0.6, 0.7))), 0.0, 1.0);
    float grain = hash(floor(uv / px * 1.5)) * 0.08;
    vec3 base = mix(c2, c1, h);
    vec3 col = base * (0.35 + 0.8 * dif) + grain;
    if (snow > 0.5) col += step(0.997, hash(floor(uv / px * 2.0) + floor(t * 2.0))) * 0.9 * h;   // destellos de nieve
    o = vec4(col, 1.0);
  }`,
  // ---------------- Niebla que se aparta ----------------
  fog: HEAD + `uniform sampler2D s, m; uniform float regrow;
  void main(){ float f = texture(s, uv).r; float a = texture(m, uv).a; f = min(mix(f, 1.0, regrow), 1.0 - a); o = vec4(f, 0., 0., 1.); }`,
  fogShade: HEAD + `uniform sampler2D s; uniform float t; uniform vec3 c1, c2;
  float hash(vec2 q){ return fract(sin(dot(q, vec2(127.1,311.7))) * 43758.5453); }
  float noise(vec2 q){ vec2 i = floor(q), f = fract(q); f = f*f*(3.0-2.0*f); return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
  float fbm(vec2 q){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(q); q *= 2.03; a *= 0.5; } return v; }
  void main(){
    float f = smoothstep(0.0, 1.0, texture(s, uv).r);
    vec3 sky = mix(c1, c2, uv.y + 0.25 * sin(t * 0.3 + uv.x * 3.0)) + 0.25 * vec3(fbm(uv * 3.0 + t * 0.05));
    vec2 q = uv * 4.0 + vec2(t * 0.06, t * 0.02);
    vec3 fogc = vec3(0.78, 0.82, 0.88) * (0.55 + 0.6 * fbm(q + fbm(q)));
    o = vec4(mix(sky, fogc, f * 0.97), 1.0);
  }`,
};

const hexRgb = (h, d = [0.1, 0.6, 1]) => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ""); if (!m) return d; const n = parseInt(m[1], 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
const hsl = (h, s, l) => { const k = (n) => (n + h * 12) % 12, a = s * Math.min(l, 1 - l); return [0, 8, 4].map(n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))); };

/** Motor GPU: un contexto WebGL2 propio y pequeño, compartido por todos los efectos de una superficie. */
class GPU {
  constructor(w, h) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = w; this.canvas.height = h;
    const gl = this.gl = this.canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl || !gl.getExtension("EXT_color_buffer_float")) throw new Error("Sin WebGL2 con texturas flotantes");
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.progs = {};
    this.maskTex = this.tex(2, 2, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    this.maskPrev = this.target(2, 2, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
  }
  prog(name) {
    if (this.progs[name]) return this.progs[name];
    const gl = this.gl, mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(name + ": " + gl.getShaderInfoLog(s)); return s; };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, VS)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, FS[name]));
    gl.bindAttribLocation(p, 0, "p"); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(name + ": " + gl.getProgramInfoLog(p));
    const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name] = gl.getUniformLocation(p, a.name); }
    return (this.progs[name] = { p, u });
  }
  tex(w, h, ifmt, fmt, type) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return { t, w, h };
  }
  target(w, h, ifmt = this.gl.RGBA16F, fmt = this.gl.RGBA, type = this.gl.HALF_FLOAT) {
    const gl = this.gl, x = this.tex(w, h, ifmt, fmt, type);
    x.fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, x.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, x.t, 0);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    return x;
  }
  double(w, h) { return { a: this.target(w, h), b: this.target(w, h), swap() { [this.a, this.b] = [this.b, this.a]; } }; }
  /** Dibuja con un programa en un destino (null = pantalla). uniforms: número, [x,y], [r,g,b] o textura {t}. */
  run(name, dst, uniforms) {
    const gl = this.gl, { p, u } = this.prog(name);
    gl.useProgram(p);
    let unit = 0;
    for (const [k, v] of Object.entries(uniforms)) {
      const loc = u[k]; if (loc === undefined) continue;
      if (v && v.t) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, v.t); gl.uniform1i(loc, unit++); }
      else if (Array.isArray(v)) (v.length === 2 ? gl.uniform2f : gl.uniform3f).call(gl, loc, ...v);
      else gl.uniform1f(loc, v);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst ? dst.fb : null);
    gl.viewport(0, 0, dst ? dst.w : this.canvas.width, dst ? dst.h : this.canvas.height);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  /** Sube la máscara nueva (la anterior queda en maskPrev para medir el movimiento). */
  upload(mask) {
    const gl = this.gl;
    if (this.maskPrev.w !== mask.width || this.maskPrev.h !== mask.height) {
      this.maskPrev = this.target(mask.width, mask.height, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
      this.maskTex = this.tex(mask.width, mask.height, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    } else this.run("copy", this.maskPrev, { t: this.maskTex });
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex.t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, mask);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }
  dispose() { try { this.gl.getExtension("WEBGL_lose_context")?.loseContext(); } catch {} }
}

/** Partículas que la gente empuja (hojas, pétalos) y la pelota: física sencilla en la CPU. */
/** Una burbuja de jabón: casi transparente, con borde de arcoíris y brillos. */
function drawBubble(ctx, x, y, r, hue, ph) {
  const body = ctx.createRadialGradient(x, y, r * 0.55, x, y, r);
  body.addColorStop(0, "rgba(120,180,255,0.02)"); body.addColorStop(0.85, "rgba(170,210,255,0.10)"); body.addColorStop(1, "rgba(220,240,255,0.30)");
  ctx.fillStyle = body; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  // Borde iridiscente (colores que giran despacio).
  let rim;
  if (ctx.createConicGradient) {
    rim = ctx.createConicGradient(ph * 0.5, x, y);
    for (let k = 0; k <= 6; k++) rim.addColorStop(k / 6, `hsla(${(hue + k * 60) % 360},95%,70%,0.55)`);
  } else rim = `hsla(${hue % 360},95%,70%,0.55)`;
  ctx.strokeStyle = rim; ctx.lineWidth = Math.max(1.5, r * 0.07);
  ctx.beginPath(); ctx.arc(x, y, r * 0.96, 0, Math.PI * 2); ctx.stroke();
  // Brillo principal arriba a la izquierda y reflejo pequeño abajo a la derecha.
  const hl = ctx.createRadialGradient(x - r * 0.38, y - r * 0.42, 0, x - r * 0.38, y - r * 0.42, r * 0.32);
  hl.addColorStop(0, "rgba(255,255,255,0.85)"); hl.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = hl; ctx.beginPath(); ctx.ellipse(x - r * 0.38, y - r * 0.42, r * 0.3, r * 0.18, -0.6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.beginPath(); ctx.ellipse(x + r * 0.42, y + r * 0.45, r * 0.1, r * 0.05, -0.6, 0, Math.PI * 2); ctx.fill();
}
/** «Pop» corto sintetizado (sin archivos): solo en la ventana del editor, una vez. */
let popCtx = null, lastPop = 0;
function popSound(size = 0.5) {
  if (typeof window === "undefined" || !window.__lumamap || window.__lumamap.S?.muted) return;
  const now = performance.now();
  if (now - lastPop < 40) return;
  lastPop = now;
  try {
    popCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    const t = popCtx.currentTime, o = popCtx.createOscillator(), g = popCtx.createGain();
    o.type = "sine"; o.frequency.setValueAtTime(900 - size * 500, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.09);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g).connect(popCtx.destination); o.start(t); o.stop(t + 0.13);
  } catch {}
}

class Bodies {
  constructor() { this.items = []; this.grid = null; }
  sense(mask, W, H) {
    const gw = 64, gh = Math.max(8, Math.round(gw * H / W));
    this.small ??= document.createElement("canvas");
    if (this.small.width !== gw || this.small.height !== gh) { this.small.width = gw; this.small.height = gh; this.prev = null; }
    const c = this.small.getContext("2d", { willReadFrequently: true });
    c.clearRect(0, 0, gw, gh); c.drawImage(mask, 0, 0, gw, gh);
    const d = c.getImageData(0, 0, gw, gh).data, n = gw * gh;
    if (!this.prev || this.prev.length !== n) { this.prev = new Float32Array(n); this.cur = new Float32Array(n); }
    [this.prev, this.cur] = [this.cur, this.prev];
    for (let i = 0; i < n; i++) this.cur[i] = d[i * 4 + 3] / 255;
    this.gw = gw; this.gh = gh;
  }
  at(x, y, W, H, arr = this.cur) { const i = Math.min(this.gw - 1, Math.max(0, (x / W * this.gw) | 0)), j = Math.min(this.gh - 1, Math.max(0, (y / H * this.gh) | 0)); return arr[j * this.gw + i]; }
  /** Empuje en (x, y): sale del cuerpo (−gradiente) y es mayor si la persona se mueve. */
  push(x, y, W, H) {
    const e = W / this.gw;
    const gx = this.at(x + e, y, W, H) - this.at(x - e, y, W, H), gy = this.at(x, y + e, W, H) - this.at(x, y - e, W, H);
    const a = this.at(x, y, W, H), mv = Math.abs(a - this.at(x, y, W, H, this.prev));
    return [-gx * (0.6 + mv * 4), -gy * (0.6 + mv * 4), a];
  }
}

/** Efectos de una superficie. render() devuelve false si el modo no es de los suyos. */
export class ProFX {
  constructor() { this.gpu = undefined; this.mode = ""; this.state = null; this.b = new Bodies(); this.t = 0; this.out2d = null; }
  ensure(W, H) {
    if (this.gpu === null) return null;
    if (this.gpu && (this.gpu.canvas.width !== W || this.gpu.canvas.height !== H)) { this.gpu.dispose(); this.gpu = undefined; this.state = null; }
    if (!this.gpu) { try { this.gpu = new GPU(W, H); } catch (e) { console.warn("Efectos en GPU no disponibles: respaldo en 2D", e); this.gpu = null; } }
    return this.gpu;
  }
  /** out: canvas 2D de salida; mask: máscara alineada (alfa = persona). */
  render(out, mask, mode, W, H, dt, opts = {}) {
    if (!PRO_MODE_IDS.has(mode)) return false;
    this.t += dt;
    if (mode !== this.mode) { this.mode = mode; this.state = null; this.b.items = []; }
    const c1 = hexRgb(opts.color, [0.1, 0.55, 0.95]), c2 = hexRgb(opts.color2, [0.02, 0.12, 0.3]);
    const ctx = out.getContext("2d");
    const gpuMode = ["agua", "agua_neon", "koi", "fluido", "humo_pro", "arena", "nieve", "niebla"].includes(mode);
    const g = gpuMode ? this.ensure(W, H) : null;
    if (g) {
      try { g.upload(mask); this[mode === "agua_neon" || mode === "koi" ? "agua" : mode === "humo_pro" ? "fluido" : mode === "nieve" ? "arena" : mode](g, W, H, dt, c1, c2, mode); }
      catch (e) { console.warn("Efecto GPU", e); this.gpu.dispose(); this.gpu = null; }
    }
    ctx.globalCompositeOperation = "source-over";
    if (g && this.gpu) ctx.drawImage(g.canvas, 0, 0, W, H);
    else if (gpuMode) this.fallback(ctx, mask, mode, W, H, c1, c2);
    if (mode === "burbujas_pro") { this.b.sense(mask, W, H); this.soap(ctx, W, H, dt, opts); return true; }
    if (mode === "koi" || mode === "hojas" || mode === "petalos" || mode === "pelota" || mode === "polvo") { this.b.sense(mask, W, H); this[mode === "koi" ? "fish" : mode === "pelota" ? "ball" : mode === "polvo" ? "stardust" : "leaves"](ctx, W, H, dt, mode, opts); }
    return true;
  }

  /* ---------------- GPU ---------------- */
  agua(g, W, H, dt, c1, c2, mode) {
    const sw = Math.round(W / 2), sh = Math.round(H / 2);
    this.state ??= { s: g.double(sw, sh) };
    const S = this.state.s, px = [1 / sw, 1 / sh];
    for (let i = 0; i < 2; i++) { g.run("wave", S.b, { s: S.a, m: g.maskTex, mp: g.maskPrev, px, damp: 0.985, rain: mode === "agua" ? 0.00002 : 0, t: this.t + i }); S.swap(); }
    if (mode === "koi") g.run("waterShade", null, { s: S.a, px, t: this.t, neon: 0, c1: [0.05, 0.32, 0.36], c2: [0.02, 0.12, 0.1] });
    else g.run("waterShade", null, { s: S.a, px, t: this.t, neon: mode === "agua_neon" ? 1 : 0, c1, c2 });
  }
  fluido(g, W, H, dt, c1, c2, mode) {
    const vw = 128, vh = Math.max(32, Math.round(128 * H / W));
    this.state ??= { v: g.double(vw, vh), d: g.double(W, H), p: g.double(vw, vh), div: g.target(vw, vh), curl: g.target(vw, vh), hue: 0 };
    const st = this.state, vpx = [1 / vw, 1 / vh], step = Math.min(dt, 1 / 30);
    const smoke = mode === "humo_pro";
    g.run("bodyForce", st.v.b, { v: st.v.a, m: g.maskTex, mp: g.maskPrev, mpx: [1 / g.maskTex.w, 1 / g.maskTex.h], k: 900 }); st.v.swap();
    st.hue = (st.hue + dt * 0.15) % 1;
    const col = smoke ? [0.9, 0.9, 0.95] : hsl(st.hue, 1, 0.5);
    g.run("bodyDye", st.d.b, { x: st.d.a, m: g.maskTex, mp: g.maskPrev, col, k: smoke ? 0.45 : 0.6 }); st.d.swap();
    g.run("curl", st.curl, { v: st.v.a, vpx });
    g.run("vort", st.v.b, { v: st.v.a, c: st.curl, vpx, dt: step, k: 28 }); st.v.swap();
    g.run("div", st.div, { v: st.v.a, vpx });
    g.run("scale", st.p.b, { x: st.p.a, k: 0.8 }); st.p.swap();
    for (let i = 0; i < 18; i++) { g.run("jacobi", st.p.b, { pr: st.p.a, d: st.div, vpx }); st.p.swap(); }
    g.run("grad", st.v.b, { pr: st.p.a, v: st.v.a, vpx }); st.v.swap();
    g.run("advect", st.v.b, { v: st.v.a, x: st.v.a, vpx, dt: step, diss: 0.985 }); st.v.swap();
    g.run("advect", st.d.b, { v: st.v.a, x: st.d.a, vpx, dt: step, diss: smoke ? 0.985 : 0.975 }); st.d.swap();
    g.run("fluidShade", null, { x: st.d.a, smoke: smoke ? 1 : 0, c2 });
  }
  arena(g, W, H, dt, c1, c2, mode) {
    const sw = Math.round(W / 2), sh = Math.round(H / 2);
    if (!this.state) { this.state = { s: g.double(sw, sh) }; g.run("scale", this.state.s.a, { x: this.state.s.b, k: 0 }); }
    const S = this.state.s, snow = mode === "nieve";
    if (!this.state.init) { this.state.init = true; for (const x of [S.a, S.b]) { g.gl.bindFramebuffer(g.gl.FRAMEBUFFER, x.fb); g.gl.clearColor(1, 0, 0, 1); g.gl.clear(g.gl.COLOR_BUFFER_BIT); } }
    g.run("dent", S.b, { s: S.a, m: g.maskTex, refill: snow ? 0.004 : 0.008 }); S.swap();
    g.run("groundShade", null, { s: S.a, px: [1 / sw, 1 / sh], t: this.t, snow: snow ? 1 : 0,
      c1: snow ? [0.95, 0.97, 1] : [0.93, 0.78, 0.52], c2: snow ? [0.45, 0.55, 0.75] : [0.45, 0.3, 0.16] });
  }
  niebla(g, W, H, dt, c1, c2) {
    const sw = Math.round(W / 2), sh = Math.round(H / 2);
    if (!this.state) { this.state = { s: g.double(sw, sh) }; for (const x of [this.state.s.a, this.state.s.b]) { g.gl.bindFramebuffer(g.gl.FRAMEBUFFER, x.fb); g.gl.clearColor(1, 0, 0, 1); g.gl.clear(g.gl.COLOR_BUFFER_BIT); } }
    const S = this.state.s;
    g.run("fog", S.b, { s: S.a, m: g.maskTex, regrow: 0.006 }); S.swap();
    g.run("fogShade", null, { s: S.a, t: this.t, c1: c1[0] + c1[1] + c1[2] > 0.3 ? c1 : [0.6, 0.2, 0.9], c2: [1, 0.45, 0.25] });
  }

  /* ---------------- CPU / 2D ---------------- */
  /** Peces koi que nadan en grupo y huyen de la gente. */
  fish(ctx, W, H, dt) {
    const B = this.b;
    if (!B.items.length) for (let i = 0; i < 14; i++) B.items.push({ x: Math.random() * W, y: Math.random() * H, a: Math.random() * 6.28, v: 30 + Math.random() * 20, s: 0.7 + Math.random() * 0.6, c: i % 3, ph: Math.random() * 6 });
    for (const f of B.items) {
      const [px, py, here] = B.push(f.x + Math.cos(f.a) * 25, f.y + Math.sin(f.a) * 25, W, H);
      const scared = here > 0.2 || Math.hypot(px, py) > 0.05;
      if (scared) f.a = Math.atan2(py || Math.sin(f.a + 3), px || Math.cos(f.a + 3));
      else f.a += (Math.sin(this.t * 0.7 + f.ph) * 0.6) * dt;
      // Bordes: girar hacia dentro.
      if (f.x < 30 || f.x > W - 30 || f.y < 30 || f.y > H - 30) f.a += (Math.atan2(H / 2 - f.y, W / 2 - f.x) - f.a) * 0.08;
      const sp = f.v * (scared ? 3.2 : 1) * f.s;
      f.x += Math.cos(f.a) * sp * dt; f.y += Math.sin(f.a) * sp * dt; f.ph += dt * (scared ? 14 : 5);
      this.drawFish(ctx, f);
    }
  }
  drawFish(ctx, f) {
    const L = 34 * f.s, col = [["#ff7a1a", "#fff3e6"], ["#ffffff", "#ff3b1f"], ["#f2c230", "#ffffff"]][f.c];
    ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.a);
    const wig = Math.sin(f.ph) * 0.35;
    ctx.globalAlpha = 0.35; ctx.fillStyle = "#000"; ctx.beginPath(); ctx.ellipse(4, 5, L * 0.55, L * 0.2, 0, 0, 6.28); ctx.fill(); ctx.globalAlpha = 1;
    ctx.fillStyle = col[0];
    ctx.beginPath(); ctx.ellipse(0, 0, L * 0.5, L * 0.19, 0, 0, 6.28); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-L * 0.45, 0); ctx.lineTo(-L * 0.85, -L * 0.22 + wig * 10); ctx.lineTo(-L * 0.85, L * 0.22 + wig * 10); ctx.closePath(); ctx.fill();
    ctx.fillStyle = col[1]; ctx.beginPath(); ctx.ellipse(L * 0.08, -L * 0.04, L * 0.18, L * 0.09, 0.3, 0, 6.28); ctx.fill();
    ctx.restore();
  }
  /** Hojas o pétalos: caen despacio, se amontonan y salen volando cuando alguien pasa. */
  leaves(ctx, W, H, dt, mode) {
    const B = this.b, petal = mode === "petalos";
    if (!B.items.length) for (let i = 0; i < 220; i++) B.items.push({ x: Math.random() * W, y: Math.random() * H, vx: 0, vy: 0, a: Math.random() * 6.28, va: 0, s: 0.6 + Math.random() * 0.8, h: Math.random() });
    // Suelo: tierra para las hojas, césped oscuro para los pétalos.
    const gr = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
    gr.addColorStop(0, petal ? "#1d3a1a" : "#3a2412"); gr.addColorStop(1, petal ? "#0b1a0a" : "#160c05");
    ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
    for (const p of B.items) {
      const [fx, fy, here] = B.push(p.x, p.y, W, H);
      p.vx += fx * 900 * dt; p.vy += fy * 900 * dt;
      if (here > 0.3) { p.vx += (Math.random() - 0.5) * 60; p.vy += (Math.random() - 0.5) * 60; p.va += (Math.random() - 0.5) * 8; }
      p.vx *= 1 - Math.min(1, 2.2 * dt); p.vy *= 1 - Math.min(1, 2.2 * dt); p.va *= 1 - Math.min(1, 1.5 * dt);
      p.x += p.vx * dt; p.y += p.vy * dt; p.a += p.va * dt;
      if (p.x < -20) p.x = W + 20; if (p.x > W + 20) p.x = -20; if (p.y < -20) p.y = H + 20; if (p.y > H + 20) p.y = -20;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); const s = 9 * p.s;
      if (petal) { ctx.fillStyle = `hsl(${330 + p.h * 40}, 85%, ${70 + p.h * 15}%)`; ctx.beginPath(); ctx.ellipse(0, 0, s, s * 0.55, 0, 0, 6.28); ctx.fill(); }
      else {
        ctx.fillStyle = `hsl(${12 + p.h * 38}, 85%, ${38 + p.h * 18}%)`;
        ctx.beginPath(); ctx.moveTo(-s, 0); ctx.quadraticCurveTo(0, -s * 0.8, s, 0); ctx.quadraticCurveTo(0, s * 0.8, -s, 0); ctx.fill();
        ctx.strokeStyle = "rgba(60,25,5,.6)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-s, 0); ctx.lineTo(s, 0); ctx.stroke();
      }
      ctx.restore();
    }
  }
  /** Pelota gigante que rebota en la gente y en los bordes (fútbol en el suelo o la pared). */
  /**
   * Burbujas de jabón: suben flotando con reflejos de arcoíris; si alguien las toca (su
   * silueta las alcanza en la proyección) revientan en gotas, suenan («pop») y suman.
   */
  soap(ctx, W, H, dt, opts = {}) {
    const B = this.b;
    const st = this.state ??= { bubbles: [], pops: [], drops: [], score: 0, spawn: 0, shown: 0 };
    const R = Math.min(W, H);
    // Fondo: negro con un leve degradado del color 2 (en la proyección, lo negro no se ve).
    const bg = ctx.createRadialGradient(W / 2, H * 0.6, 0, W / 2, H * 0.6, Math.max(W, H) * 0.8);
    const c2 = opts.color2 || "#06203f";
    bg.addColorStop(0, c2 + "66"); bg.addColorStop(1, "#000000");
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    // Nacen abajo (y algunas por los lados) hasta ~22 a la vez.
    st.spawn -= dt;
    if (st.spawn <= 0 && st.bubbles.length < 22) {
      st.spawn = 0.25 + Math.random() * 0.45;
      const r = R * (0.045 + Math.random() * 0.08);
      st.bubbles.push({ x: r + Math.random() * (W - 2 * r), y: H + r, r, vy: R * (0.06 + Math.random() * 0.08), ph: Math.random() * 6.28, wob: 0.5 + Math.random(), age: 0, hue: Math.random() * 360 });
    }
    ctx.globalCompositeOperation = "lighter";
    for (let i = st.bubbles.length - 1; i >= 0; i--) {
      const b = st.bubbles[i];
      b.age += dt; b.ph += dt * b.wob;
      b.y -= b.vy * dt;
      const x = b.x + Math.sin(b.ph) * b.r * 0.35, y = b.y;
      if (y < -b.r * 1.5) { st.bubbles.splice(i, 1); continue; }
      // ¿La toca alguien? Centro y 8 puntos del borde.
      let touched = b.age > 0.3 && B.at(x, y, W, H) > 0.4;
      for (let k = 0; !touched && b.age > 0.3 && k < 8; k++) { const a = k / 8 * Math.PI * 2; touched = B.at(x + Math.cos(a) * b.r * 0.85, y + Math.sin(a) * b.r * 0.85, W, H) > 0.4; }
      if (touched) {
        st.bubbles.splice(i, 1); st.score++; st.shown = 2.5;
        st.pops.push({ x, y, r: b.r, life: 1, hue: b.hue });
        for (let k = 0; k < 16; k++) { const a = Math.random() * 6.28, sp = R * (0.2 + Math.random() * 0.5); st.drops.push({ x: x + Math.cos(a) * b.r * 0.8, y: y + Math.sin(a) * b.r * 0.8, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - R * 0.1, life: 1, s: 1 + Math.random() * 2.5 }); }
        if (opts.sound) popSound(Math.min(1, b.r / (R * 0.12)));
        continue;
      }
      drawBubble(ctx, x, y, b.r, b.hue + this.t * 40, b.ph);
    }
    // Estallidos: anillo que se abre y gotas que caen.
    for (let i = st.pops.length - 1; i >= 0; i--) {
      const p = st.pops[i]; p.life -= dt * 3.2;
      if (p.life <= 0) { st.pops.splice(i, 1); continue; }
      ctx.strokeStyle = `hsla(${p.hue},100%,75%,${p.life})`; ctx.lineWidth = 1 + p.life * 3;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 + (1 - p.life) * 0.8), 0, Math.PI * 2); ctx.stroke();
    }
    if (st.drops.length > 900) st.drops.splice(0, st.drops.length - 900);
    for (let i = st.drops.length - 1; i >= 0; i--) {
      const d = st.drops[i]; d.life -= dt * 1.4;
      if (d.life <= 0) { st.drops.splice(i, 1); continue; }
      d.vy += R * 1.2 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.vx *= 0.98;
      ctx.fillStyle = `rgba(200,235,255,${d.life * 0.9})`;
      ctx.beginPath(); ctx.arc(d.x, d.y, d.s, 0, Math.PI * 2); ctx.fill();
    }
    // Contador (se ve un momento después de cada burbuja reventada).
    st.shown = Math.max(0, st.shown - dt);
    if (st.score && st.shown > 0 && opts.score !== false) {
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = Math.min(1, st.shown);
      ctx.font = `800 ${Math.round(R * 0.07)}px system-ui, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillStyle = "#ffffff"; ctx.shadowColor = opts.color || "#4fc3ff"; ctx.shadowBlur = R * 0.03;
      ctx.fillText(`🫧 ${st.score}`, W / 2, R * 0.03);
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = "source-over";
  }

  ball(ctx, W, H, dt) {
    const B = this.b;
    if (!B.items.length) B.items.push({ x: W / 2, y: H / 2, vx: 120, vy: 60, r: Math.min(W, H) * 0.09, a: 0 });
    const b = B.items[0];
    let fx = 0, fy = 0, hit = 0;
    for (let k = 0; k < 12; k++) { const ang = k / 12 * 6.28, x = b.x + Math.cos(ang) * b.r, y = b.y + Math.sin(ang) * b.r; const v = B.at(x, y, W, H), mv = Math.abs(v - B.at(x, y, W, H, B.prev)); if (v > 0.3) { fx -= Math.cos(ang) * (1 + mv * 6); fy -= Math.sin(ang) * (1 + mv * 6); hit++; } }
    if (hit) { b.vx += fx * 70; b.vy += fy * 70; }
    b.vx *= 1 - Math.min(1, 0.25 * dt); b.vy *= 1 - Math.min(1, 0.25 * dt);
    const sp = Math.hypot(b.vx, b.vy), max = W * 1.5; if (sp > max) { b.vx *= max / sp; b.vy *= max / sp; }
    b.x += b.vx * dt; b.y += b.vy * dt; b.a += b.vx * dt / b.r;
    if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx) * 0.9; } if (b.x > W - b.r) { b.x = W - b.r; b.vx = -Math.abs(b.vx) * 0.9; }
    if (b.y < b.r) { b.y = b.r; b.vy = Math.abs(b.vy) * 0.9; } if (b.y > H - b.r) { b.y = H - b.r; b.vy = -Math.abs(b.vy) * 0.9; }
    const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(W, H)); gr.addColorStop(0, "#0d3a14"); gr.addColorStop(1, "#06200b");
    ctx.fillStyle = "#0b2f12"; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.lineWidth = 3; ctx.strokeRect(8, 8, W - 16, H - 16);
    ctx.beginPath(); ctx.moveTo(W / 2, 8); ctx.lineTo(W / 2, H - 8); ctx.stroke(); ctx.beginPath(); ctx.arc(W / 2, H / 2, H * 0.18, 0, 6.28); ctx.stroke();
    ctx.save(); ctx.translate(b.x, b.y);
    ctx.fillStyle = "rgba(0,0,0,.4)"; ctx.beginPath(); ctx.ellipse(b.r * 0.2, b.r * 0.25, b.r, b.r * 0.9, 0, 0, 6.28); ctx.fill();
    ctx.rotate(b.a); ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(0, 0, b.r, 0, 6.28); ctx.fill();
    ctx.fillStyle = "#111"; for (let k = 0; k < 5; k++) { const ang = k / 5 * 6.28; ctx.beginPath(); ctx.arc(Math.cos(ang) * b.r * 0.62, Math.sin(ang) * b.r * 0.62, b.r * 0.2, 0, 6.28); ctx.fill(); }
    ctx.beginPath(); ctx.arc(0, 0, b.r * 0.24, 0, 6.28); ctx.fill();
    ctx.restore();
  }
  /** Polvo de estrellas: la silueta hecha de chispas que se van con estela al moverse. */
  stardust(ctx, W, H, dt) {
    const B = this.b, P = B.items;
    ctx.fillStyle = "rgba(6,3,10,1)"; ctx.fillRect(0, 0, W, H);
    // Nacen chispas donde hay persona (más donde se mueve).
    for (let k = 0; k < 700; k++) {
      const x = Math.random() * W, y = Math.random() * H, a = B.at(x, y, W, H);
      if (a < 0.4) continue;
      const mv = Math.abs(a - B.at(x, y, W, H, B.prev));
      if (P.length < 2600) P.push({ x, y, px: x, py: y, vx: (Math.random() - 0.3) * 30 + mv * 260, vy: (Math.random() - 0.5) * 30 - mv * 60, life: 0.6 + Math.random() * 1.2, age: 0, s: 0.6 + Math.random() * 1.4 });
    }
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i];
      p.age += dt; if (p.age > p.life) { P.splice(i, 1); continue; }
      p.px = p.x; p.py = p.y; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.985; p.vy *= 0.985;
      const k = 1 - p.age / p.life, sp = Math.hypot(p.vx, p.vy);
      if (sp > 40) { ctx.strokeStyle = `rgba(255,170,110,${0.18 * k})`; ctx.lineWidth = p.s; ctx.beginPath(); ctx.moveTo(p.x - p.vx * 0.12, p.y - p.vy * 0.12); ctx.lineTo(p.x, p.y); ctx.stroke(); }
      ctx.fillStyle = `rgba(255,${200 + 55 * k | 0},${150 + 90 * k | 0},${0.9 * k})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.s * (0.8 + k * 1.2), 0, 6.28); ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
  }
  /** Sin GPU: versión sencilla en 2D (fondo del color del efecto y la silueta que brilla). */
  fallback(ctx, mask, mode, W, H, c1, c2) {
    const css = (c, k = 1) => `rgb(${(c[0] * 255 * k) | 0},${(c[1] * 255 * k) | 0},${(c[2] * 255 * k) | 0})`;
    const gr = ctx.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, css(c1, 0.8)); gr.addColorStop(1, css(c2)); ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
    if (["hojas", "petalos", "pelota", "polvo"].includes(mode)) return;
    ctx.globalCompositeOperation = mode === "niebla" ? "destination-out" : "lighter";
    ctx.globalAlpha = 0.8; ctx.drawImage(mask, 0, 0, W, H); ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }
  dispose() { this.gpu?.dispose(); this.gpu = undefined; }
}
