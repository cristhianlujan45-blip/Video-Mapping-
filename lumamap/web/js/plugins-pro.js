// web/js/plugins-pro.js
// «Pro 50»: 50 shaders ISF propios (escritos para LumaMap), en cinco paquetes:
// generativos, mapping de fachadas, cámara artística, club (siguen el sonido) y retro.
// Son datos (texto ISF) como cualquier plugin: se validan y corren aislados en la GPU.
// Todo lo que depende del tamaño en píxeles se mide en «píxeles de 540p» (k = alto / 540):
// en HD o 4K se ve igual de fino, con más detalle.

const HASH = `float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hash1(float n) { return fract(sin(n) * 43758.5453); }
float lumi(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
vec2 hash2(vec2 p) { return vec2(hash(p), hash(p + 19.19)); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return v; }
vec3 hsv(float h, float s, float v) { vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); return v * mix(vec3(1.0), k, s); }
vec2 asp(vec2 uv) { return (uv - 0.5) * vec2(RENDERSIZE.x / RENDERSIZE.y, 1.0); }
vec3 cyc(float t, vec3 a, vec3 b, vec3 c) { t = fract(t) * 3.0;
  return t < 1.0 ? mix(a, b, smoothstep(0.0, 1.0, t)) : t < 2.0 ? mix(b, c, smoothstep(1.0, 2.0, t)) : mix(c, a, smoothstep(2.0, 3.0, t)); }
vec3 pal(int s, float t) {
  if (s == 1) return cyc(t, vec3(1.0, 0.25, 0.0), vec3(1.0, 0.75, 0.1), vec3(0.85, 0.05, 0.12));
  if (s == 2) return cyc(t, vec3(0.0, 0.35, 0.95), vec3(0.0, 0.9, 0.8), vec3(0.35, 0.6, 1.0));
  if (s == 3) return hsv(t, 0.85, 1.0);
  if (s == 4) return cyc(t, vec3(1.0, 0.8, 0.35), vec3(0.85, 0.5, 0.1), vec3(1.0, 0.95, 0.7));
  if (s == 5) return cyc(t, vec3(0.45, 1.0, 0.1), vec3(0.0, 0.85, 0.5), vec3(0.9, 1.0, 0.2));
  return cyc(t, vec3(0.0, 0.9, 1.0), vec3(1.0, 0.1, 0.8), vec3(0.4, 0.2, 1.0));
}`;
const BAND = `float band(float a, float b) { float s = 0.0; for (int i = 0; i < 8; i++) { s += IMG_NORM_PIXEL(audioFFT, vec2(mix(a, b, (float(i) + 0.5) / 8.0), 0.5)).r; } return s / 8.0; }`;
const CAM = `{ "NAME": "inputImage", "TYPE": "image", "LABEL": "Cámara o video" }`;
const AUD = `{ "NAME": "audioFFT", "TYPE": "audioFFT", "LABEL": "Sonido" }`;
const WAVE = `{ "NAME": "audioWave", "TYPE": "audio", "LABEL": "Onda del sonido" }`;
const SPEED = `{ "NAME": "speed", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 4.0, "LABEL": "Velocidad" }`;
const F = (name, label, def, min, max) => `{ "NAME": "${name}", "TYPE": "float", "DEFAULT": ${def.toFixed(3)}, "MIN": ${min.toFixed(3)}, "MAX": ${max.toFixed(3)}, "LABEL": "${label}" }`;
const B = (name, label, def) => `{ "NAME": "${name}", "TYPE": "bool", "DEFAULT": ${def}, "LABEL": "${label}" }`;
const C = (name, label, rgb) => `{ "NAME": "${name}", "TYPE": "color", "DEFAULT": [${rgb.join(", ")}, 1.0], "LABEL": "${label}" }`;
const L = (name, label, labels, def = 0) => `{ "NAME": "${name}", "TYPE": "long", "DEFAULT": ${def}, "VALUES": [${labels.map((_, i) => i).join(", ")}], "LABELS": [${labels.map(x => `"${x}"`).join(", ")}], "LABEL": "${label}" }`;
const COLS = (def = 0) => L("colores", "Colores", ["Neón", "Fuego", "Océano", "Arcoíris", "Oro", "Ácido"], def);
const head = (desc, inputs, extra = "") => `/*{
  "DESCRIPTION": "${desc}",
  "CREDIT": "LumaMap",
  "INPUTS": [ ${inputs.join(",\n    ")} ]
}*/
${HASH}
${extra}
`;

/* ============================ Generativos ============================ */

const TUNNEL = head("Túnel infinito de neón: anillos y paneles que vienen hacia ti", [SPEED,
  F("twist", "Giro", 0.6, 0.0, 2.0), F("segs", "Paneles", 12, 4, 24), COLS()]) + `
void main() {
  vec2 p = asp(isf_FragNormCoord) * rot(sin(TIME * 0.2) * 0.3);
  float r = length(p) + 1e-4, a = atan(p.y, p.x);
  float z = 0.3 / r + TIME * speed;
  float S = floor(segs);
  float u = a / 6.28318 + z * twist * 0.05;
  vec2 g = vec2(fract(u * S), fract(z * 1.5));
  float e = min(min(g.x, 1.0 - g.x) * 2.0, min(g.y, 1.0 - g.y) * 3.0);
  float ln = smoothstep(0.12, 0.0, e);
  float cell = hash(floor(vec2(u * S, z * 1.5)));
  vec3 c = pal(colores, cell * 0.3 + z * 0.05);
  vec3 col = c * (0.06 + 0.3 * step(0.75, cell)) + c * ln * 1.4;
  col += pal(colores, z * 0.05 + 0.5) * pow(0.5 + 0.5 * sin(z * 3.14159), 20.0) * 0.8;
  col *= smoothstep(0.0, 0.3, r);
  col += pal(colores, TIME * 0.05) * exp(-r * 12.0) * 0.4;
  gl_FragColor = vec4(col, 1.0);
}`;

const KIFS = head("Fractal caleidoscópico que se pliega y respira (KIFS)", [SPEED,
  F("zoom", "Zoom", 1.0, 0.5, 3.0), F("detail", "Detalle", 7, 3, 9), COLS(3)]) + `
void main() {
  vec2 p = asp(isf_FragNormCoord) * 3.0 / zoom;
  float t = TIME * speed * 0.15, sc = 1.0;
  vec3 col = vec3(0.0);
  for (int i = 0; i < 9; i++) {
    if (float(i) >= detail) break;
    p = abs(p) - vec2(0.9 + 0.25 * sin(t * 1.3), 0.55 + 0.2 * cos(t * 0.9));
    p = rot(0.6 + t + float(i) * 0.15) * p;
    p *= 1.3; sc *= 1.3;
    float d = abs(p.y) / sc;
    col += pal(colores, float(i) * 0.09 + t * 0.4) * (0.012 / (d + 0.012)) * 0.45;
  }
  col += pal(colores, t + 0.5) * smoothstep(0.03, 0.0, length(p) / sc);
  col = 1.0 - exp(-col * 2.2);
  gl_FragColor = vec4(col, 1.0);
}`;

const AURORA = head("Aurora boreal: cortinas de luz que ondulan sobre un cielo con estrellas", [SPEED,
  F("intensity", "Intensidad", 1.0, 0.0, 2.0), F("height", "Altura", 0.35, 0.1, 0.8),
  L("tonos", "Tonos", ["Verde", "Violeta", "Arcoíris"])]) + `
vec3 tone(int s, float t) {
  if (s == 0) return mix(vec3(0.1, 1.0, 0.5), vec3(0.2, 0.6, 1.0), t);
  if (s == 1) return mix(vec3(0.7, 0.2, 1.0), vec3(1.0, 0.3, 0.6), t);
  return hsv(t, 0.8, 1.0);
}
void main() {
  vec2 uv = isf_FragNormCoord;
  float ar = RENDERSIZE.x / RENDERSIZE.y, t = TIME * speed;
  vec3 col = mix(vec3(0.0, 0.01, 0.04), vec3(0.01, 0.04, 0.1), uv.y);
  float st = hash(floor(uv * RENDERSIZE / (2.0 * RENDERSIZE.y / 540.0)));
  col += step(0.996, st) * (0.5 + 0.5 * sin(TIME * 3.0 + st * 60.0)) * 0.8;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float x = uv.x * ar * (1.2 + fi * 0.25) + fi * 3.1;
    float base = height + fi * 0.08 + 0.18 * (fbm(vec2(x * 0.8 + t * 0.06, fi * 2.3 + t * 0.04)) - 0.5) + 0.05 * sin(x * 2.0 + t * 0.4);
    float d = uv.y - base;
    float curtain = d > 0.0 ? exp(-d * (4.0 + fi * 2.0)) : smoothstep(-0.015, 0.0, d);
    float rays = 0.55 + 0.45 * vnoise(vec2(x * 25.0, t * 0.8 + fi));
    col += tone(tonos, fi / 4.0 + 0.3 * vnoise(vec2(x * 2.0, t * 0.2))) * curtain * rays * intensity * 0.45;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const MARBLE = head("Mármol líquido: tinta que fluye y se retuerce con vetas brillantes", [SPEED,
  F("scale", "Tamaño", 2.5, 1.0, 6.0), F("vetas", "Vetas", 0.5, 0.0, 1.0), COLS(2)]) + `
void main() {
  vec2 p = asp(isf_FragNormCoord) * scale;
  float t = TIME * speed * 0.12;
  vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - t));
  vec2 r = vec2(fbm(p + 3.5 * q + vec2(1.7, 9.2) + 0.7 * t), fbm(p + 3.5 * q + vec2(8.3, 2.8) - 0.5 * t));
  float f = fbm(p + 3.5 * r);
  vec3 col = pal(colores, f * 1.1 + length(q) * 0.4 + t * 0.2);
  col *= 0.35 + 1.1 * f * f;
  col += vec3(1.0) * pow(max(0.0, 1.0 - abs(f - 0.55) * 7.0), 4.0) * vetas;
  gl_FragColor = vec4(col, 1.0);
}`;

const CRYSTALS = head("Cristales de Voronoi: celdas que se mueven con bordes de luz", [SPEED,
  F("scale", "Tamaño", 7, 3, 20), F("glow", "Brillo de bordes", 1.0, 0.0, 2.0), COLS()]) + `
void main() {
  vec2 p = asp(isf_FragNormCoord) * scale;
  vec2 ip = floor(p), fp = fract(p), id = vec2(0.0);
  float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = 0.5 + 0.42 * sin(TIME * speed * 0.6 + 6.28318 * hash2(ip + g));
      vec2 rr = g + o - fp;
      float d = dot(rr, rr);
      if (d < d1) { d2 = d1; d1 = d; id = ip + g; } else if (d < d2) { d2 = d; }
    }
  }
  float e = sqrt(d2) - sqrt(d1), h = hash(id);
  vec3 c = pal(colores, h * 0.35 + TIME * speed * 0.03);
  vec3 col = c * (0.15 + 0.85 * pow(1.0 - sqrt(d1), 2.0)) * (0.55 + 0.45 * sin(TIME * speed * 1.5 + h * 6.28));
  col += mix(c, vec3(1.0), 0.6) * smoothstep(0.07, 0.0, e) * glow;
  gl_FragColor = vec4(col, 1.0);
}`;

const HYPER = head("Salto al hiperespacio: estrellas que se estiran hacia ti", [SPEED,
  F("density", "Cantidad", 0.55, 0.1, 1.0), COLS(2)]) + `
void main() {
  vec2 p = asp(isf_FragNormCoord);
  float r = length(p), a = atan(p.y, p.x) / 6.28318 + 0.5;
  float px = 1.5 / RENDERSIZE.y;
  vec3 col = pal(colores, 0.3) * fbm(p * 3.0 + TIME * 0.05) * 0.08;
  for (int i = 0; i < 3; i++) {
    float fi = float(i), n = 90.0 + fi * 70.0;
    float sec = floor(a * n);
    float h = hash(vec2(sec, fi * 7.0));
    if (h > density) continue;
    float z = fract(hash(vec2(sec, fi + 3.0)) + TIME * speed * (0.25 + 0.2 * h));
    float hd = z * z * 1.3;
    float len = 0.03 + z * z * 0.35 * min(speed, 2.0) * 0.5;
    float da = abs(fract(a * n) - 0.5) / n * 6.28318 * r;
    float s = smoothstep(px * (1.0 + 2.0 * z), 0.0, da) * smoothstep(hd - len, hd, r) * step(r, hd);
    col += mix(pal(colores, h * 2.0), vec3(1.0), 0.4) * s * (0.5 + z * 1.5);
  }
  col += pal(colores, TIME * 0.05) * exp(-r * 9.0) * 0.6;
  gl_FragColor = vec4(col, 1.0);
}`;

const FLOWER = head("Flor de la vida: geometría sagrada que gira y late con luz", [SPEED,
  F("capas", "Anillos", 2, 1, 4), F("glow", "Brillo", 1.0, 0.3, 2.0), COLS(4)]) + `
void main() {
  vec2 p = rot(TIME * speed * 0.08) * asp(isf_FragNormCoord);
  float n = floor(capas), R = 0.45 / (n + 1.0);
  vec2 e1 = vec2(R, 0.0), e2 = vec2(R * 0.5, R * 0.8660254);
  float bb = p.y / e2.y, aa = (p.x - bb * e2.x) / R;
  vec2 base = floor(vec2(aa, bb));
  float d = 1e3, ring = 0.0;
  for (int j = -1; j <= 2; j++) {
    for (int i = -1; i <= 2; i++) {
      vec2 ij = base + vec2(float(i), float(j));
      float hx = (abs(ij.x) + abs(ij.y) + abs(ij.x + ij.y)) * 0.5;
      if (hx > n + 0.01) continue;
      vec2 c = ij.x * e1 + ij.y * e2;
      float dd = abs(length(p - c) - R);
      if (dd < d) { d = dd; ring = hx; }
    }
  }
  float dout = abs(length(p) - (n + 1.0) * R);
  float px = 1.0 / RENDERSIZE.y;
  vec3 c1 = pal(colores, ring * 0.15 - TIME * speed * 0.2);
  float beat = 0.55 + 0.45 * sin(ring * 2.0 - TIME * speed * 2.5);
  vec3 col = c1 * (glow * 0.003 / (d + 0.003) * 0.6 + smoothstep(px * 2.0, 0.0, d)) * beat;
  col += pal(colores, 0.5) * (glow * 0.003 / (dout + 0.003) * 0.5 + smoothstep(px * 2.0, 0.0, dout));
  col = 1.0 - exp(-col * 1.3);
  gl_FragColor = vec4(col, 1.0);
}`;

const TRUCHET = head("Laberinto Truchet: arcos de luz que fluyen por la pared", [SPEED,
  F("scale", "Tamaño", 8, 3, 20), F("grosor", "Grosor", 0.1, 0.04, 0.25), COLS()]) + `
void main() {
  vec2 p = asp(isf_FragNormCoord) * scale;
  vec2 id = floor(p), f = fract(p) - 0.5;
  if (hash(id) > 0.5) f.x = -f.x;
  float d1 = abs(length(f - vec2(0.5)) - 0.5), d2 = abs(length(f + vec2(0.5)) - 0.5);
  vec2 c = d1 < d2 ? vec2(0.5) : vec2(-0.5);
  float d = min(d1, d2);
  float ang = atan(f.y - c.y, f.x - c.x);
  float dir = mod(id.x + id.y, 2.0) * 2.0 - 1.0;
  float flow = fract(ang / 1.5708 * 2.0 * dir + TIME * speed);
  float ln = smoothstep(grosor, grosor * 0.6, d);
  float dash = smoothstep(0.0, 0.15, flow) * smoothstep(1.0, 0.55, flow);
  vec3 c0 = pal(colores, hash(id) * 0.15 + (id.x + id.y) * 0.03 + TIME * 0.05);
  vec3 col = vec3(0.02, 0.02, 0.04) + c0 * ln * (0.3 + 0.95 * dash);
  col += c0 * 0.25 * smoothstep(grosor * 2.5, grosor, d) * (1.0 - ln);
  gl_FragColor = vec4(col, 1.0);
}`;

const GALAXY = head("Galaxia espiral que gira con su núcleo brillante y polvo de estrellas", [SPEED,
  F("brazos", "Brazos", 3, 2, 6), F("torsion", "Torsión", 4, 1, 8), COLS()]) + `
void main() {
  vec2 p = rot(TIME * speed * 0.1) * asp(isf_FragNormCoord) * 2.2;
  float r = length(p) + 1e-4, a = atan(p.y, p.x);
  float arm = pow(0.5 + 0.5 * sin(floor(brazos) * a - log(r) * torsion), 2.5);
  float dust = fbm(p * 4.0 + vec2(TIME * 0.05));
  vec3 col = pal(colores, r * 0.35 + 0.1) * arm * exp(-r * 1.3) * (0.5 + dust) * 1.8;
  col += vec3(1.0, 0.85, 0.65) * exp(-r * 7.0) * 1.3;
  float s = hash(floor(p * 90.0));
  col += vec3(0.9, 0.95, 1.0) * step(0.993, s) * (0.4 + arm) * (0.6 + 0.4 * sin(TIME * 4.0 + s * 50.0));
  gl_FragColor = vec4(col, 1.0);
}`;

const FIRE = head("Muro de fuego realista con chispas que suben", [SPEED,
  F("altura", "Altura", 0.85, 0.3, 1.5), F("turb", "Turbulencia", 1.5, 0.5, 3.0),
  L("tono", "Tono", ["Fuego", "Azul", "Verde", "Violeta"])]) + `
vec3 fireCol(int s, float h) {
  vec3 c = vec3(1.6 * h, 1.6 * h * h, h * h * h * h * 1.2);
  if (s == 1) return c.bgr;
  if (s == 2) return vec3(c.b, c.r, c.g);
  if (s == 3) return vec3(c.r * 0.85, c.b, c.r);
  return c;
}
void main() {
  vec2 uv = isf_FragNormCoord;
  vec2 p = vec2(uv.x * RENDERSIZE.x / RENDERSIZE.y, uv.y);
  float t = TIME * speed;
  float n = fbm(vec2(p.x * 2.5 * turb, p.y * 2.0 - t * 1.4));
  float n2 = fbm(vec2(p.x * 5.0 * turb + 3.0, p.y * 4.0 - t * 2.3));
  float h = clamp((1.0 - uv.y / altura) * (0.55 + 0.9 * n + 0.35 * n2) - 0.25, 0.0, 1.0);
  vec3 col = fireCol(tono, pow(h, 1.2));
  vec2 sg = vec2(p.x * 40.0, p.y * 40.0 - t * 12.0);
  float sp = step(0.985, hash(floor(sg))) * step(length(fract(sg) - 0.5), 0.25) * smoothstep(0.9, 0.2, uv.y);
  col += fireCol(tono, 0.9) * sp;
  gl_FragColor = vec4(col, 1.0);
}`;

const PLASMA = head("Bola de plasma: rayos eléctricos que buscan el cristal", [SPEED,
  F("rayos", "Rayos", 6, 2, 10), F("brillo", "Brillo", 1.0, 0.3, 2.0), C("tinte", "Color", [0.75, 0.4, 1.0])]) + `
void main() {
  vec2 p = asp(isf_FragNormCoord) * 2.2;
  float r = length(p), a = atan(p.y, p.x), R = 0.85, t = TIME * speed;
  vec3 tc = tinte.rgb;
  vec3 col = tc * 0.08 * smoothstep(R, 0.0, r) + tc * exp(-r * 6.0) * 1.2 + vec3(1.0) * exp(-r * 18.0);
  col += tc * smoothstep(0.025, 0.0, abs(r - R)) * 0.5;
  for (int i = 0; i < 10; i++) {
    if (float(i) >= rayos) break;
    float fi = float(i);
    float ba = fi * 6.28318 / rayos + sin(t * (0.4 + 0.5 * hash1(fi)) + fi * 1.7) * 1.3;
    float wob = (vnoise(vec2(r * 5.0 - t * 2.5, fi * 13.0)) - 0.5) * 1.2 * r + (vnoise(vec2(r * 14.0 - t * 5.0, fi * 5.0)) - 0.5) * 0.35 * r;
    float da = abs(mod(a - ba - wob + 3.14159, 6.28318) - 3.14159) * r;
    float bolt = (0.004 / (da + 0.004)) * smoothstep(R, R - 0.05, r) * smoothstep(0.05, 0.15, r);
    col += mix(tc, vec3(1.0), 0.4) * bolt * brillo * 0.5;
  }
  col = 1.0 - exp(-col * 1.3);
  gl_FragColor = vec4(col, 1.0);
}`;

const LAVA = head("Lámpara de lava: burbujas que se juntan, se separan y flotan", [SPEED,
  F("blobs", "Burbujas", 6, 3, 10), COLS(1)]) + `
void main() {
  vec2 uv = isf_FragNormCoord, p = asp(uv);
  float ar = RENDERSIZE.x / RENDERSIZE.y, f = 0.0;
  for (int i = 0; i < 10; i++) {
    if (float(i) >= blobs) break;
    float fi = float(i);
    vec2 c = vec2(sin(TIME * speed * 0.3 * (0.5 + hash1(fi)) + fi * 2.0) * 0.42 * ar, sin(TIME * speed * 0.22 * (0.5 + hash1(fi + 3.0)) + fi * 1.3) * 0.42);
    float rr = 0.07 + 0.07 * hash1(fi + 7.0);
    f += rr * rr / (dot(p - c, p - c) + 1e-4);
  }
  float m = smoothstep(0.9, 1.1, f);
  vec3 bg = pal(colores, uv.y * 0.5 + 0.6) * 0.18;
  vec3 blob = pal(colores, min(f, 4.0) * 0.08 + uv.y * 0.3) * (0.75 + 0.35 * smoothstep(1.0, 3.0, f));
  vec3 col = mix(bg, blob, m) + pal(colores, 0.2) * smoothstep(0.35, 1.0, f) * 0.3 * (1.0 - m);
  gl_FragColor = vec4(col, 1.0);
}`;

/* ============================ Fachadas (mapping) ============================ */

const SWEEP = head("Barrido de luz sobre una pared de ladrillo, como un foco que la recorre", [SPEED,
  F("ancho", "Ancho de la luz", 0.18, 0.05, 0.6), F("ladrillo", "Tamaño del ladrillo", 26, 10, 60), C("tinte", "Color de la luz", [1.0, 0.8, 0.55])]) + `
void main() {
  vec2 uv = isf_FragNormCoord;
  vec2 px = uv * RENDERSIZE / (RENDERSIZE.y / 540.0);
  vec2 b = px / vec2(ladrillo * 2.2, ladrillo);
  b.x += 0.5 * mod(floor(b.y), 2.0);
  vec2 id = floor(b), f = fract(b);
  float mortar = step(0.04, f.x) * step(f.x, 0.96) * step(0.08, f.y) * step(f.y, 0.92);
  vec3 brick = vec3(0.62, 0.33, 0.24) * (0.7 + 0.3 * hash(id)) * (0.85 + 0.3 * vnoise(px * 0.35));
  vec3 wall = mix(vec3(0.2), brick, mortar);
  wall *= 1.0 + mortar * (smoothstep(0.75, 0.92, f.y) * 0.25 - smoothstep(0.25, 0.08, f.y) * 0.25);
  float ar = RENDERSIZE.x / RENDERSIZE.y;
  float pos = fract(TIME * speed * 0.18) * (ar + 1.2) - 0.6;
  float d = uv.x * ar + (uv.y - 0.5) * 0.35 - pos;
  float lt = exp(-d * d / (ancho * ancho));
  vec3 col = wall * (0.06 + lt * 1.4 * tinte.rgb) + tinte.rgb * lt * lt * 0.25 * (1.0 - mortar);
  gl_FragColor = vec4(col, 1.0);
}`;

const WINDOWS = head("Ventanas de un edificio que se encienden: al azar, en ola, en ajedrez o de abajo arriba", [SPEED,
  F("columnas", "Columnas", 10, 3, 24), F("filas", "Pisos", 6, 2, 14),
  L("modo", "Cómo se encienden", ["Al azar", "En ola", "Ajedrez", "De abajo arriba"]), C("tinte", "Luz de las ventanas", [1.0, 0.78, 0.4])]) + `
void main() {
  vec2 uv = isf_FragNormCoord;
  vec2 g = uv * vec2(floor(columnas), floor(filas));
  vec2 id = floor(g), f = fract(g);
  float inside = step(0.18, f.x) * step(f.x, 0.82) * step(0.14, f.y) * step(f.y, 0.86);
  float t = TIME * speed, on;
  if (modo == 0) on = step(0.45, hash(id + floor(t * 0.7 + hash(id) * 5.0) * 0.37));
  else if (modo == 1) on = smoothstep(0.2, 0.8, 0.5 + 0.5 * sin(id.x * 0.7 + id.y * 0.35 - t * 2.0));
  else if (modo == 2) on = mod(id.x + id.y + floor(t), 2.0);
  else on = step(id.y + 0.5, fract(t * 0.15) * (floor(filas) + 1.0));
  vec3 room = tinte.rgb * (0.75 + 0.35 * hash(id + 7.0)) * (0.8 + 0.2 * f.y);
  room *= 1.0 - 0.45 * step(0.6, hash(id + 3.0)) * step(0.5 + 0.3 * hash(id + 5.0), f.y);
  vec3 dark = vec3(0.03, 0.05, 0.09) + vec3(0.05, 0.08, 0.12) * f.y;
  vec3 wall = vec3(0.07, 0.07, 0.09) * (0.8 + 0.4 * vnoise(uv * RENDERSIZE * 0.05));
  float frame = inside * (1.0 - step(0.2, f.x) * step(f.x, 0.8) * step(0.16, f.y) * step(f.y, 0.84));
  vec3 col = mix(wall, mix(dark, room, on), inside);
  col = mix(col, vec3(0.25), frame * 0.6);
  col += tinte.rgb * on * 0.12 * (1.0 - inside) * smoothstep(0.5, 0.0, length(f - 0.5) - 0.3);
  gl_FragColor = vec4(col, 1.0);
}`;

const BUILDWALL = head("Muro que se construye: ladrillos que caen uno a uno hasta llenar la pared", [SPEED,
  F("filas", "Filas", 10, 4, 20), COLS(1)]) + `
vec3 brickCol(float k, vec2 q, float row, float rows) {
  float inside = step(0.04, q.x) * step(q.x, 0.96) * step(0.1, q.y) * step(q.y, 0.9);
  return pal(colores, hash1(k) * 0.25 + row / rows * 0.3) * (0.7 + 0.3 * hash1(k + 4.0)) * (0.8 + 0.3 * q.y) * inside;
}
void main() {
  vec2 uv = isf_FragNormCoord;
  float rows = floor(filas);
  float cols = floor(rows * RENDERSIZE.x / RENDERSIZE.y * 0.5) + 1.0, per = cols + 1.0, N = rows * per;
  float c = mod(TIME * speed * 6.0 + N * 0.15, N + 18.0);
  float fade = smoothstep(N + 18.0, N + 12.0, c);
  vec3 col = vec3(0.02, 0.02, 0.03);
  float row = floor(uv.y * rows), off = 0.5 * mod(row, 2.0);
  float ci = floor(uv.x * cols + off);
  float idx = row * per + ci;
  if (idx < floor(c)) col = brickCol(idx, vec2(fract(uv.x * cols + off), fract(uv.y * rows)), row, rows) * fade;
  float k = floor(c);
  if (k < N) {
    float kr = floor(k / per), kc = mod(k, per);
    float y = mix(1.05, kr / rows, fract(c) * fract(c));
    float x0 = (kc - 0.5 * mod(kr, 2.0)) / cols;
    vec2 q = vec2((uv.x - x0) * cols, (uv.y - y) * rows);
    if (q.x > 0.0 && q.x < 1.0 && q.y > 0.0 && q.y < 1.0) col = brickCol(k, q, kr, rows);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const CRACKS = head("La pared se agrieta desde el centro y deja ver lava por las grietas", [SPEED,
  F("escala", "Tamaño de las placas", 5, 2, 10), C("tinte", "Color de las grietas", [1.0, 0.45, 0.1])]) + `
void main() {
  vec2 p = asp(isf_FragNormCoord), s = p * escala;
  vec2 ip = floor(s), fp = fract(s), id = vec2(0.0);
  float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 rr = g + hash2(ip + g) - fp;
      float d = dot(rr, rr);
      if (d < d1) { d2 = d1; d1 = d; id = ip + g; } else if (d < d2) { d2 = d; }
    }
  }
  float e = (sqrt(d2) - sqrt(d1)) / escala * 5.0;
  float cyc = fract(TIME * speed * 0.12), R = cyc * 1.6;
  vec3 col = vec3(0.35 + 0.25 * fbm(p * 6.0) + 0.1 * vnoise(p * 40.0)) * vec3(0.9, 0.88, 0.85);
  float reach = smoothstep(R, R - 0.15, length(p));
  col *= 1.0 - smoothstep(0.55, 1.0, cyc) * 0.5 * hash(id);
  col = mix(col, tinte.rgb * 1.6, smoothstep(0.06, 0.0, e) * reach);
  col += tinte.rgb * smoothstep(0.2, 0.0, e) * reach * 0.35 * (0.6 + 0.4 * sin(TIME * 6.0 + hash(id) * 10.0));
  gl_FragColor = vec4(col, 1.0);
}`;

const NEONGRID = head("Rejilla de neón: pulsos de luz que corren por las líneas", [SPEED,
  F("celdas", "Celdas", 6, 2, 14), F("estela", "Estela", 0.35, 0.05, 0.9), COLS()]) + `
void main() {
  float ar = RENDERSIZE.x / RENDERSIZE.y;
  vec2 g = isf_FragNormCoord * vec2(ar, 1.0) * celdas, f = fract(g);
  float px = celdas / RENDERSIZE.y;
  float dx = min(f.x, 1.0 - f.x), dy = min(f.y, 1.0 - f.y);
  float lv = floor(g.x + 0.5), lh = floor(g.y + 0.5), t = TIME * speed;
  float ph = fract(g.x * 0.25 - t * 0.6 * (0.6 + hash1(lh)) + hash1(lh * 3.1));
  float pv = fract(g.y * 0.25 - t * 0.6 * (0.6 + hash1(lv + 50.0)) + hash1(lv * 1.7));
  float bh = smoothstep(1.0 - estela, 1.0, ph), bv = smoothstep(1.0 - estela, 1.0, pv);
  float gh = exp(-dy / (px * 2.0)), gv = exp(-dx / (px * 2.0));
  vec3 ch = pal(colores, hash1(lh) * 0.5 + t * 0.03), cv = pal(colores, hash1(lv + 9.0) * 0.5 + 0.5 + t * 0.03);
  vec3 col = ch * gh * (0.18 + 1.3 * bh) + cv * gv * (0.18 + 1.3 * bv);
  col += vec3(1.0) * exp(-length(vec2(dx, dy)) / (px * 3.0)) * 0.3 * max(bh, bv);
  gl_FragColor = vec4(col, 1.0);
}`;

const WATER = head("El agua sube por la pared, con olas, espuma y reflejos", [SPEED,
  F("nivel", "Nivel", 0.45, 0.0, 1.0), F("olas", "Olas", 0.5, 0.0, 1.0), C("tinte", "Color del agua", [0.0, 0.55, 0.85])]) + `
void main() {
  vec2 uv = isf_FragNormCoord;
  float ar = RENDERSIZE.x / RENDERSIZE.y, t = TIME * speed;
  float lvl = nivel + 0.06 * sin(t * 0.4);
  float x = uv.x * ar;
  float surf = lvl + olas * 0.025 * (sin(x * 9.0 + t * 1.8) + 0.5 * sin(x * 23.0 - t * 2.7) + 0.3 * sin(x * 51.0 + t * 4.0));
  vec2 q = vec2(x, uv.y) * 7.0;
  float n1 = vnoise(q + vec2(t * 0.5, t * 0.3)), n2 = vnoise(q * 1.7 - vec2(t * 0.4, -t * 0.6));
  float ca = pow(max(0.0, 1.0 - abs(n1 - n2) * 2.0), 8.0);
  vec3 col;
  if (uv.y < surf) {
    float depth = surf - uv.y;
    col = tinte.rgb * (0.25 + 0.55 * (1.0 - depth)) + vec3(0.8, 0.95, 1.0) * ca * 0.55 * (1.0 - depth * 0.7);
    col += vec3(1.0) * smoothstep(0.012, 0.0, depth) * 0.8;
  } else {
    float h = uv.y - surf;
    col = vec3(0.12, 0.12, 0.14) * (0.8 + 0.3 * vnoise(uv * RENDERSIZE * 0.04)) + tinte.rgb * (ca * exp(-h * 6.0) * 0.5 + 0.08 * exp(-h * 10.0));
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const BEAMS = head("Haces de luz de escenario que barren la pared entre humo", [SPEED,
  F("haces", "Haces", 10, 2, 24), F("niebla", "Humo", 0.6, 0.0, 1.0), COLS()]) + `
void main() {
  vec2 uv = isf_FragNormCoord;
  float ar = RENDERSIZE.x / RENDERSIZE.y, t = TIME * speed, n = floor(haces);
  vec2 p = vec2(uv.x * ar, uv.y);
  vec3 col = vec3(0.0);
  for (int i = 0; i < 24; i++) {
    if (float(i) >= n) break;
    float fi = float(i);
    vec2 o = vec2((fi + 0.5) / n * ar, 1.02);
    float ang = sin(t * (0.5 + 0.4 * hash1(fi)) + fi * 1.3) * 0.55;
    vec2 dir = vec2(sin(ang), -cos(ang)), v = p - o;
    float along = dot(v, dir), across = abs(v.x * dir.y - v.y * dir.x);
    float w = 0.01 + max(along, 0.0) * 0.06;
    float beam = exp(-across * across / (w * w)) * step(0.0, along) * (0.35 + 0.65 * niebla) * exp(-along * (1.2 - niebla));
    col += pal(colores, fi / n + t * 0.05) * beam * 0.7;
  }
  col *= 0.75 + 0.5 * fbm(p * 3.0 + vec2(t * 0.1, 0.0)) * niebla;
  gl_FragColor = vec4(col, 1.0);
}`;

const LASERSCAN = head("Escaneo láser: una línea recorre la pared y deja una rejilla de luz", [SPEED,
  F("rejilla", "Rejilla", 12, 4, 30), F("memoria", "Cuánto dura", 0.6, 0.0, 1.0), C("tinte", "Color", [0.1, 1.0, 0.4])]) + `
void main() {
  vec2 uv = isf_FragNormCoord;
  float ar = RENDERSIZE.x / RENDERSIZE.y;
  float scan = fract(TIME * speed * 0.25);
  float age = mod(scan - uv.y, 1.0);
  float reveal = exp(-age * mix(12.0, 1.5, memoria));
  vec2 f = abs(fract(vec2(uv.x * ar, uv.y) * rejilla) - 0.5);
  float px = rejilla / RENDERSIZE.y;
  float grid = exp(-(0.5 - max(f.x, f.y)) / (px * 1.5));
  float dots = exp(-length(0.5 - f) / (px * 2.5));
  vec3 tc = tinte.rgb;
  vec3 col = tc * grid * reveal * 0.8 + vec3(1.0) * dots * reveal * 0.6 + tc * 0.03;
  float dl = abs(uv.y - scan);
  col += mix(tc, vec3(1.0), 0.6) * exp(-dl * RENDERSIZE.y / 3.0) * 1.5 + tc * exp(-dl * 25.0) * 0.35;
  gl_FragColor = vec4(col, 1.0);
}`;

const ISOCUBES = head("Cubos isométricos (ilusión 3D) que se iluminan en ola", [SPEED,
  F("escala", "Tamaño", 7, 3, 16), COLS(2)]) + `
void main() {
  vec2 p = asp(isf_FragNormCoord) * escala;
  vec2 r = vec2(1.0, 1.7320508), h = r * 0.5;
  vec2 a = mod(p, r) - h, b = mod(p - h, r) - h;
  vec2 g = dot(a, a) < dot(b, b) ? a : b;
  vec2 id = p - g;
  float ang = atan(g.y, g.x);
  float face = (ang > 0.5236 && ang < 2.618) ? 0.0 : ((ang >= 2.618 || ang < -1.5708) ? 1.0 : 2.0);
  float pulse = 0.5 + 0.5 * sin(length(id) * 1.2 - TIME * speed * 2.0);
  float shade = face < 0.5 ? 1.0 : face < 1.5 ? 0.62 : 0.38;
  vec3 col = pal(colores, hash(id) * 0.15 + length(id) * 0.04 + TIME * speed * 0.05) * shade * (0.35 + 0.85 * pulse);
  float lw = escala / RENDERSIZE.y * 1.5;
  float hd = max(abs(g.x), abs(g.x) * 0.5 + abs(g.y) * 0.8660254);
  float e = smoothstep(lw * 2.0, lw, 0.5 - hd);
  float dr = 1e3;
  if (dot(g, vec2(0.8660254, 0.5)) > 0.0) dr = min(dr, abs(g.x * 0.5 - g.y * 0.8660254));
  if (dot(g, vec2(-0.8660254, 0.5)) > 0.0) dr = min(dr, abs(g.x * 0.5 + g.y * 0.8660254));
  if (g.y < 0.0) dr = min(dr, abs(g.x));
  e = max(e, smoothstep(lw * 2.0, lw, dr));
  col = mix(col, vec3(0.02), e * 0.85);
  gl_FragColor = vec4(col, 1.0);
}`;

const FLAPS = head("Tablero de paletas (como los de los aeropuertos): las piezas voltean en ola y cambian la imagen", [SPEED,
  F("columnas", "Columnas", 16, 4, 40), COLS(3)]) + `
void main() {
  vec2 uv = isf_FragNormCoord;
  float ar = RENDERSIZE.x / RENDERSIZE.y, n = floor(columnas);
  vec2 g = vec2(uv.x * n, uv.y * n / ar);
  vec2 id = floor(g), f = fract(g);
  float wave = TIME * speed * 0.35 - (id.x / n * 0.7 + id.y / n * 0.3 * ar) - hash(id) * 0.08;
  float k = floor(wave);
  float ph = clamp(fract(wave) * 2.5, 0.0, 1.0);
  float sy = abs(cos(ph * 3.14159));
  float side = ph < 0.5 ? k : k + 1.0;
  vec2 c = (id + 0.5) / vec2(n, n / ar);
  float img = mod(side, 2.0) < 0.5 ? 0.5 + 0.5 * sin((c.x + c.y) * 12.0 + side) : 0.5 + 0.5 * sin(length(c - 0.5) * 18.0 - side);
  vec3 col = pal(colores, img * 0.6 + side * 0.17) * (0.3 + 0.7 * img);
  col *= step(abs(f.y - 0.5), 0.46 * sy) * step(0.04, f.x) * step(f.x, 0.96) * (0.55 + 0.45 * sy);
  col *= 1.0 - 0.6 * smoothstep(0.03, 0.0, abs(f.y - 0.5));
  gl_FragColor = vec4(col + vec3(0.02), 1.0);
}`;

/* ============================ Cámara artística ============================ */

const SOBEL = `vec2 sobel(vec2 uv, vec2 d) {
  float tl = lumi(IMG_NORM_PIXEL(inputImage, uv + vec2(-d.x, d.y)).rgb), tc = lumi(IMG_NORM_PIXEL(inputImage, uv + vec2(0.0, d.y)).rgb), tr = lumi(IMG_NORM_PIXEL(inputImage, uv + d).rgb);
  float ml = lumi(IMG_NORM_PIXEL(inputImage, uv - vec2(d.x, 0.0)).rgb), mr = lumi(IMG_NORM_PIXEL(inputImage, uv + vec2(d.x, 0.0)).rgb);
  float bl = lumi(IMG_NORM_PIXEL(inputImage, uv - d).rgb), bc = lumi(IMG_NORM_PIXEL(inputImage, uv - vec2(0.0, d.y)).rgb), br = lumi(IMG_NORM_PIXEL(inputImage, uv + vec2(d.x, -d.y)).rgb);
  return vec2(tr + 2.0 * mr + br - tl - 2.0 * ml - bl, tl + 2.0 * tc + tr - bl - 2.0 * bc - br);
}`;
// Un píxel de 540p en coordenadas 0..1 (para que se vea igual en HD o 4K).
const PX = `vec2 px540() { return vec2(RENDERSIZE.y / 540.0) / RENDERSIZE; }`;

const THERMAL = head("Cámara térmica: tu imagen como la ve un sensor de calor", [CAM,
  F("contraste", "Contraste", 1.4, 0.5, 3.0), F("ruido", "Ruido", 0.06, 0.0, 0.3),
  L("paleta", "Paleta", ["Hierro", "Arcoíris", "Blanco caliente"])], PX) + `
vec3 iron(float x) {
  vec3 c = mix(vec3(0.0, 0.0, 0.1), vec3(0.35, 0.0, 0.6), smoothstep(0.0, 0.25, x));
  c = mix(c, vec3(0.9, 0.1, 0.2), smoothstep(0.2, 0.5, x));
  c = mix(c, vec3(1.0, 0.6, 0.0), smoothstep(0.45, 0.75, x));
  return mix(c, vec3(1.0, 1.0, 0.85), smoothstep(0.75, 1.0, x));
}
void main() {
  vec2 uv = isf_FragNormCoord, d = px540() * 1.5;
  float l = 0.0;
  l += lumi(IMG_NORM_PIXEL(inputImage, uv).rgb) * 0.4;
  l += lumi(IMG_NORM_PIXEL(inputImage, uv + vec2(d.x, 0.0)).rgb) * 0.15 + lumi(IMG_NORM_PIXEL(inputImage, uv - vec2(d.x, 0.0)).rgb) * 0.15;
  l += lumi(IMG_NORM_PIXEL(inputImage, uv + vec2(0.0, d.y)).rgb) * 0.15 + lumi(IMG_NORM_PIXEL(inputImage, uv - vec2(0.0, d.y)).rgb) * 0.15;
  float x = clamp((l - 0.5) * contraste + 0.5 + (hash(uv * RENDERSIZE + TIME) - 0.5) * ruido, 0.0, 1.0);
  vec3 col = paleta == 0 ? iron(x) : paleta == 1 ? hsv(0.7 - x * 0.75, 1.0, 0.2 + 0.8 * smoothstep(0.0, 0.15, x)) : vec3(x);
  vec2 c = abs(uv - 0.5) * RENDERSIZE / (RENDERSIZE.y / 540.0);
  float reticle = step(max(c.x, c.y), 18.0) * step(min(c.x, c.y), 0.8) * step(5.0, max(c.x, c.y));
  col = mix(col, vec3(1.0), reticle * 0.8);
  gl_FragColor = vec4(col, 1.0);
}`;

const NIGHT = head("Visión nocturna: verde fósforo con grano, líneas y binoculares", [CAM,
  F("ganancia", "Ganancia", 2.5, 1.0, 6.0), F("ruido", "Ruido", 0.15, 0.0, 0.5), B("binoculares", "Binoculares", "true")]) + `
void main() {
  vec2 uv = isf_FragNormCoord;
  float l = lumi(IMG_NORM_PIXEL(inputImage, uv).rgb);
  float bl = lumi(IMG_NORM_PIXEL(inputImage, uv + vec2(0.004, 0.0)).rgb) + lumi(IMG_NORM_PIXEL(inputImage, uv - vec2(0.004, 0.0)).rgb);
  float v = l * ganancia + bl * 0.15 * ganancia + (hash(uv * RENDERSIZE + fract(TIME) * 100.0) - 0.5) * ruido;
  v *= 0.9 + 0.1 * sin(uv.y * RENDERSIZE.y * 1.5);
  vec3 col = vec3(0.15, 1.0, 0.3) * v + vec3(0.6, 1.0, 0.6) * max(v - 1.0, 0.0);
  vec2 p = asp(uv);
  if (binoculares) {
    float d = min(length(p - vec2(-0.24, 0.0)), length(p - vec2(0.24, 0.0)));
    col *= smoothstep(0.43, 0.39, d);
  } else col *= smoothstep(0.95, 0.35, length(p));
  gl_FragColor = vec4(col, 1.0);
}`;

const NEONEDGES = head("Bordes de neón: los contornos de la cámara brillan con colores que cambian", [CAM, SPEED,
  F("grosor", "Grosor", 1.5, 0.5, 4.0), F("fondo", "Imagen de fondo", 0.15, 0.0, 1.0), COLS()], PX + SOBEL) + `
void main() {
  vec2 uv = isf_FragNormCoord, d = px540() * grosor;
  vec2 gr = sobel(uv, d), gr2 = sobel(uv, d * 3.0);
  float m = length(gr), m2 = length(gr2);
  vec3 c = pal(colores, atan(gr.y, gr.x) / 6.28318 + TIME * speed * 0.1 + uv.x * 0.3);
  vec3 col = IMG_NORM_PIXEL(inputImage, uv).rgb * fondo + c * smoothstep(0.1, 0.5, m) * 1.5 + c * smoothstep(0.05, 0.4, m2) * 0.4;
  gl_FragColor = vec4(col, 1.0);
}`;

const HALFTONE = head("Semitono de imprenta: la cámara hecha de puntos (CMYK, blanco y negro o pop)", [CAM,
  F("tamano", "Tamaño del punto", 9, 3, 30), L("modo", "Estilo", ["Imprenta CMYK", "Blanco y negro", "Pop"])]) + `
float layer(vec2 px, float ang, float s, int ch) {
  vec2 q = rot(ang) * px / s;
  vec2 cell = floor(q) + 0.5;
  vec2 cuv = (rot(-ang) * (cell * s)) / RENDERSIZE;
  vec3 c = IMG_NORM_PIXEL(inputImage, clamp(cuv, 0.0, 1.0)).rgb;
  float k = 1.0 - max(c.r, max(c.g, c.b));
  float v = ch == 0 ? (1.0 - c.r - k) / max(1.0 - k, 0.001) : ch == 1 ? (1.0 - c.g - k) / max(1.0 - k, 0.001) : ch == 2 ? (1.0 - c.b - k) / max(1.0 - k, 0.001) : ch == 3 ? k : 1.0 - lumi(c);
  float r = sqrt(clamp(v, 0.0, 1.0)) * 0.62;
  float d = length(fract(q) - 0.5);
  return smoothstep(r + 0.06, r - 0.06, d);
}
void main() {
  vec2 px = isf_FragNormCoord * RENDERSIZE;
  float s = tamano * RENDERSIZE.y / 540.0;
  vec3 col;
  if (modo == 1) col = vec3(0.97, 0.96, 0.92) * (1.0 - 0.95 * layer(px, 0.785, s, 4));
  else if (modo == 2) {
    vec3 c = IMG_NORM_PIXEL(inputImage, isf_FragNormCoord).rgb;
    col = mix(vec3(0.05, 0.02, 0.12), hsv(fract(atan(c.g - c.b, c.r - c.g) / 6.28318 + 0.1), 0.9, 1.0), layer(px, 0.3, s, 4) * 0.4 + layer(px, 0.3, s * 0.5, 4) * 0.6);
  } else {
    col = vec3(0.98, 0.97, 0.94);
    col.r *= 1.0 - 0.9 * layer(px, 0.2618, s, 0);
    col.g *= 1.0 - 0.9 * layer(px, 1.309, s, 1);
    col.b *= 1.0 - 0.9 * layer(px, 0.0, s, 2);
    col *= 1.0 - 0.85 * layer(px, 0.785, s, 3);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const OIL = head("Pintura al óleo: pinceladas suaves que respetan los bordes (Kuwahara)", [CAM,
  F("radio", "Pincel", 3, 1, 6)], PX) + `
void main() {
  vec2 uv = isf_FragNormCoord, st = px540() * radio * 0.75;
  vec3 best = vec3(0.0); float bestV = 1e9;
  for (int q = 0; q < 4; q++) {
    vec2 sg = vec2(q == 0 || q == 3 ? -1.0 : 1.0, q < 2 ? -1.0 : 1.0);
    vec3 m = vec3(0.0), m2 = vec3(0.0);
    for (int j = 0; j < 4; j++) {
      for (int i = 0; i < 4; i++) {
        vec3 c = IMG_NORM_PIXEL(inputImage, uv + sg * vec2(float(i), float(j)) * st).rgb;
        m += c; m2 += c * c;
      }
    }
    m /= 16.0;
    vec3 v3 = m2 / 16.0 - m * m;
    float v = v3.r + v3.g + v3.b;
    if (v < bestV) { bestV = v; best = m; }
  }
  best = mix(vec3(lumi(best)), best, 1.25);
  best *= 0.93 + 0.07 * vnoise(uv * RENDERSIZE * 0.3 / (RENDERSIZE.y / 540.0));
  gl_FragColor = vec4(best, 1.0);
}`;

const SKETCH = head("Dibujo a lápiz: contornos y sombreado con trazos cruzados sobre papel", [CAM,
  F("trazo", "Separación de trazos", 1.0, 0.5, 3.0), C("papel", "Papel", [0.96, 0.93, 0.86]), B("colores", "Lápices de colores", "false")], PX + SOBEL) + `
float hatch(float t) { return smoothstep(0.36, 0.47, abs(fract(t) - 0.5)); }
void main() {
  vec2 uv = isf_FragNormCoord;
  vec2 px = uv * RENDERSIZE / (RENDERSIZE.y / 540.0);
  vec3 cam = IMG_NORM_PIXEL(inputImage, uv).rgb;
  float l = lumi(cam), s = max(6.0 * trazo, 4.0 * 540.0 / RENDERSIZE.y), w = vnoise(px * 0.02) * 0.25;   // al menos 4 píxeles reales entre trazos
  float sh = hatch((px.x + px.y) / s + w) * smoothstep(0.8, 0.6, l);
  sh = max(sh, hatch((px.x - px.y) / s + w) * smoothstep(0.55, 0.35, l));
  sh = max(sh, hatch(px.y / (s * 0.7) + w) * smoothstep(0.3, 0.15, l));
  float ink = smoothstep(0.15, 0.5, length(sobel(uv, px540() * 1.2)));
  vec3 col = papel.rgb * (1.0 - 0.75 * max(sh, ink));
  if (colores) col *= mix(vec3(1.0), cam * 1.4, 0.55);
  col *= 0.95 + 0.05 * hash(floor(px));
  gl_FragColor = vec4(col, 1.0);
}`;

const COMIC = head("Cómic: colores planos, tinta negra en los bordes y puntos en las sombras", [CAM,
  F("niveles", "Niveles de color", 4, 2, 6), F("tinta", "Tinta", 0.6, 0.0, 1.0), B("puntos", "Puntos en las sombras", "true")], PX + SOBEL) + `
void main() {
  vec2 uv = isf_FragNormCoord;
  vec3 c = IMG_NORM_PIXEL(inputImage, uv).rgb;
  float n = floor(niveles);
  vec3 q = floor(c * n + 0.5) / n;
  q = clamp(mix(vec3(lumi(q)), q, 1.6), 0.0, 1.0);
  float ink = smoothstep(0.35 - tinta * 0.25, 0.45 - tinta * 0.2, length(sobel(uv, px540() * 1.5)));
  vec2 px = uv * RENDERSIZE / (RENDERSIZE.y / 540.0);
  float dt = step(length(fract(rot(0.785) * px / 6.0) - 0.5), 0.33);
  if (puntos) q *= 1.0 - 0.55 * dt * smoothstep(0.45, 0.25, lumi(c));
  gl_FragColor = vec4(q * (1.0 - ink), 1.0);
}`;

const HEXMOS = head("Mosaico de hexágonos: la cámara hecha de baldosas con relieve", [CAM,
  F("tamano", "Tamaño", 18, 4, 60), F("borde", "Junta", 0.08, 0.0, 0.3)]) + `
void main() {
  float s = tamano * RENDERSIZE.y / 540.0;
  vec2 p = isf_FragNormCoord * RENDERSIZE / s;
  vec2 r = vec2(1.0, 1.7320508), h = r * 0.5;
  vec2 a = mod(p, r) - h, b = mod(p - h, r) - h;
  vec2 g = dot(a, a) < dot(b, b) ? a : b;
  vec3 c = IMG_NORM_PIXEL(inputImage, clamp((p - g) * s / RENDERSIZE, 0.0, 1.0)).rgb;
  float hd = max(abs(g.x), abs(g.x) * 0.5 + abs(g.y) * 0.8660254);
  float e = 0.5 - hd;
  vec3 col = c * smoothstep(0.0, borde + 0.01, e) * (0.85 + 0.3 * smoothstep(0.3, -0.3, g.y - g.x * 0.3));
  gl_FragColor = vec4(col, 1.0);
}`;

const LEDWALL = head("Pantalla LED gigante: la cámara en puntos de luz redondos", [CAM,
  F("tamano", "Tamaño del LED", 8, 3, 30), F("brillo", "Brillo", 1.9, 0.5, 3.0), F("niveles", "Niveles", 8, 2, 16)]) + `
void main() {
  float s = tamano * RENDERSIZE.y / 540.0;
  vec2 px = isf_FragNormCoord * RENDERSIZE / s;
  vec2 cell = floor(px), f = fract(px) - 0.5;
  vec3 c = IMG_NORM_PIXEL(inputImage, clamp((cell + 0.5) * s / RENDERSIZE, 0.0, 1.0)).rgb;
  c = floor(c * niveles + 0.5) / niveles;
  float d = length(f);
  vec3 col = c * brillo * (smoothstep(0.47, 0.36, d) + exp(-d * 5.0) * 0.4) + vec3(0.015);
  gl_FragColor = vec4(col, 1.0);
}`;

const RIPPLES = head("Gotas de agua que caen sobre la imagen y la ondulan", [CAM, SPEED,
  F("fuerza", "Fuerza", 1.0, 0.0, 2.0), F("gotas", "Gotas", 4, 1, 8)]) + `
void main() {
  vec2 uv = isf_FragNormCoord, p = asp(uv);
  float ar = RENDERSIZE.x / RENDERSIZE.y, spec = 0.0;
  vec2 off = vec2(0.0);
  for (int i = 0; i < 8; i++) {
    if (float(i) >= gotas) break;
    float fi = float(i), tt = TIME * speed * 0.4 + hash1(fi);
    vec2 c = (hash2(vec2(fi, floor(tt))) - 0.5) * vec2(ar, 1.0) * 0.9;
    float age = fract(tt), r = length(p - c), x = r - age * 0.8;
    float w = sin(x * 60.0) * exp(-abs(x) * 12.0) * (1.0 - age);
    off += (p - c) / (r + 1e-4) * w * 0.012 * fuerza;
    spec += max(w, 0.0);
  }
  vec3 col = IMG_NORM_PIXEL(inputImage, uv + off).rgb + vec3(spec) * 0.25 * fuerza;
  gl_FragColor = vec4(col, 1.0);
}`;

const SHARDS = head("Vidrio roto: la imagen partida en pedazos que reflejan la luz", [CAM, SPEED,
  F("piezas", "Pedazos", 8, 3, 20), F("romper", "Cuánto se separan", 0.5, 0.0, 1.0)]) + `
void main() {
  vec2 uv = isf_FragNormCoord, s = asp(uv) * piezas;
  vec2 ip = floor(s), fp = fract(s), id = vec2(0.0);
  float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 rr = g + hash2(ip + g) - fp;
      float d = dot(rr, rr);
      if (d < d1) { d2 = d1; d1 = d; id = ip + g; } else if (d < d2) { d2 = d; }
    }
  }
  float e = sqrt(d2) - sqrt(d1), h = hash(id);
  vec2 o = (hash2(id + 5.0) - 0.5) * 0.06 * romper + vec2(sin(TIME * speed + h * 6.28), cos(TIME * speed * 0.8 + h * 6.28)) * 0.004 * romper;
  float z = 1.0 + (hash(id + 3.0) - 0.5) * 0.12 * romper;
  vec3 col = IMG_NORM_PIXEL(inputImage, clamp((uv - 0.5) * z + 0.5 + o, 0.0, 1.0)).rgb;
  col *= 0.9 + 0.2 * h;
  col = mix(col, vec3(0.02), smoothstep(0.03, 0.0, e));
  col += vec3(1.0) * smoothstep(0.08, 0.03, e) * 0.35 * (0.5 + 0.5 * sin(TIME * speed * 2.0 + h * 9.0));
  gl_FragColor = vec4(col, 1.0);
}`;

const DUOTONE = head("Duotono: la cámara pintada con dos colores, como en los carteles", [CAM,
  C("sombra", "Sombras", [0.1, 0.0, 0.35]), C("luz", "Luces", [1.0, 0.35, 0.55]),
  F("contraste", "Contraste", 1.2, 0.5, 2.5), F("grano", "Grano", 0.04, 0.0, 0.2)]) + `
void main() {
  vec2 uv = isf_FragNormCoord;
  float l = clamp((lumi(IMG_NORM_PIXEL(inputImage, uv).rgb) - 0.5) * contraste + 0.5, 0.0, 1.0);
  vec3 col = mix(sombra.rgb, luz.rgb, smoothstep(0.0, 1.0, l)) + (hash(uv * RENDERSIZE) - 0.5) * grano;
  gl_FragColor = vec4(col, 1.0);
}`;

/* ============================ Club (siguen el sonido) ============================ */

const CIRCSPEC = head("Espectro circular: barras de sonido en un anillo con el centro que late con los graves", [AUD, SPEED,
  F("barras", "Barras", 64, 16, 128), COLS()], BAND) + `
void main() {
  vec2 p = asp(isf_FragNormCoord);
  float bass = band(0.0, 0.08);
  p = rot(TIME * speed * 0.15) * p;
  float r = length(p), a = atan(p.y, p.x);
  float R0 = 0.17 + bass * 0.08, n = floor(barras);
  float x = abs(a) / 3.14159;
  float idx = floor(x * n);
  float f = IMG_NORM_PIXEL(audioFFT, vec2((idx + 0.5) / n * 0.7, 0.5)).r;
  float len = 0.02 + f * 0.3;
  float bar = step(R0 + 0.01, r) * step(r, R0 + 0.01 + len) * step(abs(fract(x * n) - 0.5), 0.35);
  vec3 col = pal(colores, x + TIME * speed * 0.05) * bar * (0.5 + f);
  col += pal(colores, TIME * 0.1 + 0.5) * smoothstep(R0, R0 - 0.01, r) * (0.12 + bass * 0.7);
  col += pal(colores, TIME * 0.1) * exp(-abs(r - R0) * 80.0) * (0.4 + bass);
  float da = abs(fract(a / 6.28318 * 40.0 - TIME * speed * 0.3) - 0.5);
  col += vec3(0.8) * smoothstep(0.012, 0.0, abs(r - 0.43)) * step(da, 0.2) * 0.6;
  gl_FragColor = vec4(col, 1.0);
}`;

const BASSTUNNEL = head("Túnel de graves: anillos que salen hacia ti y engordan con cada golpe", [AUD, SPEED,
  F("anillos", "Anillos", 12, 4, 30), COLS(1)], BAND) + `
void main() {
  float bass = band(0.0, 0.08);
  vec2 p = asp(isf_FragNormCoord) * (1.0 - bass * 0.15);
  float r = length(p) + 1e-4;
  float z = log(r) * anillos * 0.3 - TIME * speed * 0.8;
  float dv = abs(fract(z) - 0.5);
  float th = 0.06 + bass * 0.25;
  float ring = 1.0 - smoothstep(th * 0.5, th * 0.5 + 0.03, dv);
  vec3 col = pal(colores, floor(z) * 0.13) * ring * (0.4 + 1.2 * bass) * smoothstep(0.0, 0.08, r);
  col += pal(colores, TIME * 0.1) * exp(-r * 5.0) * (0.1 + 0.8 * bass);
  gl_FragColor = vec4(col, 1.0);
}`;

const SCOPE = head("Osciloscopio: la onda del sonido dibujada con luz de fósforo", [AUD, WAVE, SPEED,
  F("ganancia", "Ganancia", 1.2, 0.5, 3.0), C("tinte", "Color", [0.2, 1.0, 0.6])], BAND) + `
float waveY(float x) { return 0.5 + (IMG_NORM_PIXEL(audioWave, vec2(x, 0.5)).r - 0.5) * ganancia * 0.8; }
void main() {
  vec2 uv = isf_FragNormCoord;
  float k = RENDERSIZE.y / 540.0, bass = band(0.0, 0.08);
  vec3 tc = tinte.rgb;
  vec2 g = abs(fract(vec2(uv.x * 10.0 + TIME * speed * 0.05, uv.y * 8.0)) - 0.5);
  vec3 col = tc * (0.03 + 0.03 * (1.0 - length(uv - 0.5))) + tc * 0.1 * exp(-(0.5 - max(g.x, g.y)) * RENDERSIZE.y / (8.0 * k)) + tc * bass * 0.25;
  float y = waveY(uv.x), y2 = waveY(uv.x + 1.0 / RENDERSIZE.x);
  float dy = (y2 - y) * RENDERSIZE.y;
  float d = abs(uv.y - y) * RENDERSIZE.y / sqrt(1.0 + dy * dy);
  float sw = fract(TIME * speed * 0.5);
  float trail = 0.35 + 0.65 * exp(-fract(sw - uv.x) * 4.0);
  col += mix(tc, vec3(1.0), 0.3) * (exp(-d / (2.0 * k)) + exp(-d / (14.0 * k)) * 0.35) * trail;
  vec2 sp = vec2(sw, waveY(sw));
  col += vec3(1.0) * exp(-length((uv - sp) * RENDERSIZE) / (6.0 * k)) * 0.8;
  gl_FragColor = vec4(col, 1.0);
}`;

const EQCITY = head("Ciudad ecualizador: los edificios crecen con cada frecuencia y el cielo destella con los graves", [AUD, SPEED,
  F("edificios", "Edificios", 20, 8, 48), COLS()], BAND) + `
void main() {
  vec2 uv = isf_FragNormCoord;
  float bass = band(0.0, 0.08), n = floor(edificios), k = RENDERSIZE.y / 540.0;
  float xs = uv.x + TIME * speed * 0.03;
  float bi = floor(xs * n), fx = fract(xs * n);
  float f = IMG_NORM_PIXEL(audioFFT, vec2((mod(bi, n) + 0.5) / n * 0.6, 0.5)).r;
  float h = 0.15 + hash1(bi) * 0.3 + f * 0.4;
  vec3 col = mix(vec3(0.02, 0.0, 0.06), pal(colores, 0.6) * 0.35, uv.y) * (0.6 + bass * 1.4);
  vec2 mp = asp(uv) - vec2(0.45, 0.32);
  col += vec3(1.0, 0.95, 0.85) * smoothstep(0.07 + bass * 0.03, 0.065 + bass * 0.03, length(mp));
  if (uv.y < h && fx > 0.06 && fx < 0.94) {
    vec2 w = vec2(fract(fx * 4.0), fract(uv.y * RENDERSIZE.y / (10.0 * k)));
    float row = floor(uv.y * RENDERSIZE.y / (10.0 * k));
    float lit = step(0.5, hash(vec2(bi * 4.0 + floor(fx * 4.0), row) + floor(TIME * 0.5)));
    col = vec3(0.03, 0.03, 0.05) + pal(colores, hash1(bi) * 0.4) * lit * step(0.25, w.x) * step(w.x, 0.75) * step(0.3, w.y) * step(w.y, 0.8) * (0.6 + f);
    col += pal(colores, f) * exp(-(h - uv.y) * RENDERSIZE.y / (3.0 * k)) * (0.6 + f * 1.5);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const BURST = head("Estallido de partículas: chispas que salen del centro, más fuertes con los graves", [AUD, SPEED,
  F("particulas", "Partículas", 70, 20, 120), COLS(3)], BAND) + `
void main() {
  vec2 p = asp(isf_FragNormCoord);
  float bass = band(0.0, 0.08);
  vec3 col = vec3(0.0);
  for (int i = 0; i < 120; i++) {
    if (float(i) >= particulas) break;
    float fi = float(i), h1 = hash1(fi * 1.31), h2 = hash1(fi * 7.7);
    float ang = h1 * 6.28318 + sin(TIME * 0.3 + fi) * 0.2;
    float life = fract(TIME * speed * 0.25 * (0.3 + 0.7 * h2) + hash1(fi * 3.3));
    vec2 pos = vec2(cos(ang), sin(ang)) * life * (0.55 + bass * 0.45);
    float sz = (0.004 + 0.01 * (1.0 - life)) * (1.0 + bass * 2.0);
    float d = length(p - pos);
    col += pal(colores, h1 + TIME * 0.05) * (sz * sz / (d * d + sz * sz * 0.3)) * (1.0 - life) * 0.6;
  }
  col += pal(colores, TIME * 0.07) * exp(-length(p) * 6.0) * (0.15 + bass * 1.2);
  col = 1.0 - exp(-col);
  gl_FragColor = vec4(col, 1.0);
}`;

const POLYPULSE = head("Polígonos que giran unos dentro de otros y se expanden con los graves", [AUD, SPEED,
  F("lados", "Lados", 6, 3, 8), F("capas", "Capas", 8, 3, 14), COLS()], BAND) + `
float polyDist(vec2 p, float n) { float a = atan(p.y, p.x), s = 6.28318 / n; return cos(floor(0.5 + a / s) * s - a) * length(p); }
void main() {
  vec2 p = asp(isf_FragNormCoord);
  float bass = band(0.0, 0.08), n = floor(lados), k = RENDERSIZE.y / 540.0;
  vec3 col = vec3(0.0);
  for (int i = 0; i < 14; i++) {
    if (float(i) >= capas) break;
    float fi = float(i);
    vec2 q = rot(TIME * speed * 0.3 * (mod(fi, 2.0) * 2.0 - 1.0) * (1.0 + fi * 0.1)) * p;
    float R = (fi + 1.0) / capas * 0.48 * (1.0 + bass * 0.25 * (1.0 - fi / capas));
    float d = abs(polyDist(q, n) - R) * RENDERSIZE.y;
    col += pal(colores, fi / capas + TIME * 0.05) * (exp(-d / (1.5 * k)) + exp(-d / (10.0 * k)) * 0.3 * (0.3 + bass));
  }
  col += pal(colores, TIME * 0.1) * exp(-length(p) * 5.0) * bass * 0.8;
  gl_FragColor = vec4(col, 1.0);
}`;

const STROBE = head("Estrobo geométrico suave: rayas, cuadros, anillos y rayos que cambian con el tempo (destellos moderados)", [AUD, SPEED,
  F("intensidad", "Destello", 0.5, 0.0, 1.0), COLS(3)], BAND) + `
void main() {
  vec2 p = asp(isf_FragNormCoord);
  float bass = band(0.0, 0.08), t = TIME * speed;
  float k = floor(t * 2.0), pat = mod(k, 4.0), v;
  if (pat < 1.0) v = step(0.5, fract(p.x * 8.0 + t));
  else if (pat < 2.0) { vec2 q = rot(0.785 + t * 0.2) * p * 8.0; v = mod(floor(q.x) + floor(q.y), 2.0); }
  else if (pat < 3.0) v = step(0.5, fract(length(p) * 10.0 - t * 2.0));
  else v = step(0.5, fract(atan(p.y, p.x) / 6.28318 * 12.0 + t * 0.5));
  float on = 0.2 + 0.8 * bass + intensidad * 0.3 * step(0.5, fract(t * 2.0));
  gl_FragColor = vec4(pal(colores, k * 0.23) * v * on + vec3(0.01), 1.0);
}`;

const BREATHGRID = head("Cuadrícula que respira: se hincha desde el centro con cada golpe de graves", [AUD, SPEED,
  F("celdas", "Celdas", 14, 4, 30), COLS(2)], BAND) + `
void main() {
  vec2 p = asp(isf_FragNormCoord);
  float bass = band(0.0, 0.08), mid = band(0.1, 0.4), k = RENDERSIZE.y / 540.0, r = length(p);
  vec2 q = p * (1.0 - bass * 0.35 * exp(-r * 3.0)) + 0.02 * vec2(sin(p.y * 10.0 + TIME * speed * 2.0), cos(p.x * 10.0 - TIME * speed * 1.7)) * (0.3 + mid);
  vec2 f = abs(fract(q * celdas) - 0.5);
  float dl = (0.5 - max(f.x, f.y)) / celdas * RENDERSIZE.y;
  float node = exp(-length(0.5 - f) / celdas * RENDERSIZE.y / (3.0 * k));
  vec3 col = pal(colores, r * 0.8 - TIME * speed * 0.1) * (exp(-dl / (1.2 * k)) + exp(-dl / (8.0 * k)) * 0.3 + node * 0.8) * (0.6 + bass * 1.2);
  gl_FragColor = vec4(col, 1.0);
}`;

/* ============================ Retro y arcade ============================ */

const SYNTHWAVE = head("Synthwave: sol a rayas, montañas y la rejilla de neón que corre hacia el horizonte", [SPEED,
  F("sol", "Brillo del sol", 1.0, 0.0, 1.5), B("montanas", "Montañas", "true")]) + `
void main() {
  vec2 uv = isf_FragNormCoord;
  float ar = RENDERSIZE.x / RENDERSIZE.y, hz = 0.42, x = (uv.x - 0.5) * ar;
  vec3 col;
  if (uv.y > hz) {
    col = mix(vec3(1.0, 0.3, 0.55), vec3(0.08, 0.0, 0.22), smoothstep(hz, 1.0, uv.y));
    col += step(0.997, hash(floor(uv * RENDERSIZE / (2.0 * RENDERSIZE.y / 540.0)))) * smoothstep(0.6, 0.9, uv.y);
    vec2 sc = vec2(x, uv.y - hz - 0.17);
    float sd = length(sc);
    float cut = sc.y < 0.0 ? step(fract(sc.y * 22.0 - TIME * speed * 0.3), 0.35 + sc.y * 2.2) : 1.0;
    col = mix(col, mix(vec3(1.0, 0.15, 0.55), vec3(1.0, 0.9, 0.2), smoothstep(-0.2, 0.2, sc.y)) * sol, smoothstep(0.205, 0.2, sd) * cut);
    col += vec3(1.0, 0.3, 0.6) * exp(-sd * 6.0) * 0.25 * sol;
    if (montanas) {
      float m = hz + 0.05 + 0.13 * fbm(vec2(x * 2.5, 1.0)) * smoothstep(0.0, 0.6, abs(x));
      if (uv.y < m) col = vec3(0.12, 0.02, 0.2) + vec3(1.0, 0.2, 0.8) * exp(-(m - uv.y) * RENDERSIZE.y / 3.0);
    }
  } else {
    float z = 0.3 / (hz - uv.y + 0.002);
    float gx = abs(fract(x * z * 1.2) - 0.5), gz = abs(fract(z - TIME * speed * 1.5) - 0.5);
    float lw = 0.03 + 0.004 * z;
    float ln = max(smoothstep(lw, 0.0, gx), smoothstep(lw * 2.0, 0.0, gz)) * exp(-z * 0.08);
    col = vec3(0.06, 0.0, 0.12) + vec3(1.0, 0.15, 0.85) * ln * 1.2 + vec3(1.0, 0.4, 0.6) * exp(-(hz - uv.y) * 14.0) * 0.4;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const RAIN = head("Lluvia digital: columnas de símbolos que caen como en la película", [SPEED,
  F("tamano", "Tamaño", 16, 8, 40), F("densidad", "Densidad", 0.7, 0.2, 1.0), C("tinte", "Color", [0.2, 1.0, 0.4])]) + `
void main() {
  vec2 uv = isf_FragNormCoord;
  float k = RENDERSIZE.y / 540.0;
  vec2 cell = vec2(tamano * 0.6, tamano) * k;
  vec2 g = vec2(uv.x * RENDERSIZE.x, (1.0 - uv.y) * RENDERSIZE.y) / cell;
  float col0 = floor(g.x), row = floor(g.y), rows = RENDERSIZE.y / cell.y;
  float spd = 0.5 + hash1(col0) * 1.5;
  float hd = mod(TIME * speed * spd * 6.0 + hash1(col0 * 3.1) * 50.0, rows + 25.0);
  float d = hd - row;
  float bright = d < 0.0 ? 0.0 : exp(-d * 0.12 / densidad) * step(hash1(col0 * 7.7), densidad + 0.15);
  float ch = floor(hash(vec2(col0, row)) * 10.0 + TIME * speed * (hash(vec2(row, col0)) > 0.9 ? 4.0 : 0.5));
  vec2 f = fract(g);
  vec2 gp = floor(f * vec2(5.0, 7.0));
  float bit = step(0.5, hash(vec2(ch, gp.x + gp.y * 5.0))) * step(0.1, f.x) * step(f.x, 0.9) * step(0.08, f.y) * step(f.y, 0.92);
  vec3 c = mix(tinte.rgb, vec3(0.9, 1.0, 0.95), step(d, 1.0) * step(0.0, d));
  gl_FragColor = vec4(c * bit * bright + tinte.rgb * 0.02, 1.0);
}`;

const COPPER = head("Barras de cobre de la demoscene: bandas brillantes que suben y bajan", [SPEED,
  F("barras", "Barras", 7, 3, 12), COLS(3)]) + `
void main() {
  vec2 uv = isf_FragNormCoord;
  vec3 col = mix(vec3(0.02, 0.0, 0.05), vec3(0.0, 0.02, 0.08), uv.y);
  float bz = -2.0;
  for (int i = 0; i < 12; i++) {
    if (float(i) >= barras) break;
    float fi = float(i), ph = TIME * speed * 1.3 + fi * 0.55;
    float y = 0.5 + 0.35 * sin(ph), z = cos(ph), d = abs(uv.y - y), w = 0.045;
    if (d < w && z > bz) {
      float sh = cos(d / w * 1.5708);
      col = pal(colores, fi / barras) * (0.25 + 0.75 * sh) + vec3(1.0) * pow(sh, 12.0) * 0.6;
      bz = z;
    }
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const ROTOZOOM = head("Rotozoom: un dibujo que gira y se acerca sin parar, como en las demos de los 90", [SPEED,
  L("patron", "Dibujo", ["Ajedrez", "Baldosas", "Círculos"]), COLS()]) + `
void main() {
  vec2 p = asp(isf_FragNormCoord);
  float t = TIME * speed, zoom = 1.5 + sin(t * 0.4) * 1.2;
  vec2 q = rot(t * 0.3) * p * zoom * 4.0 + vec2(t * 0.5, t * 0.2);
  vec2 id = floor(q), f = fract(q);
  vec3 col;
  if (patron == 0) col = mix(pal(colores, id.x * 0.05), pal(colores, id.y * 0.05 + 0.5), mod(id.x + id.y, 2.0));
  else if (patron == 1) col = pal(colores, hash(id)) * (0.7 + 0.3 * smoothstep(0.0, 0.15, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)))) * step(0.04, min(f.x, f.y));
  else col = pal(colores, length(id) * 0.05) * smoothstep(0.42, 0.38, length(f - 0.5)) + pal(colores, 0.5) * 0.1;
  col *= 0.92 + 0.08 * sin(isf_FragNormCoord.y * RENDERSIZE.y * 1.5);
  gl_FragColor = vec4(col, 1.0);
}`;

const TWISTER = head("Torsión de la demoscene: una columna de cuatro caras que se retuerce", [SPEED,
  F("torsion", "Torsión", 1.5, 0.0, 4.0), COLS(1)]) + `
void main() {
  vec2 uv = isf_FragNormCoord;
  float x = (uv.x - 0.5) * RENDERSIZE.x / RENDERSIZE.y, W = 0.18;
  float ang = TIME * speed + sin(uv.y * 3.0 + TIME * speed * 0.7) * torsion;
  vec3 col = mix(vec3(0.02, 0.0, 0.06), vec3(0.06, 0.02, 0.12), uv.y);
  for (int k = 0; k < 4; k++) {
    float fk = float(k);
    float x1 = sin(ang + fk * 1.5708) * W, x2 = sin(ang + (fk + 1.0) * 1.5708) * W;
    if (x2 > x1 && x > x1 && x < x2) {
      float sh = (x2 - x1) / (W * 1.4142);
      col = pal(colores, fk * 0.25) * (0.25 + 0.75 * sh) * (0.85 + 0.15 * step(0.5, fract(uv.y * 10.0 + fk * 0.5)));
      col += vec3(1.0) * pow(sh, 8.0) * 0.25;
    }
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const STARS8 = head("Estrellas de 8 bits: cielo pixelado con capas que pasan y una nebulosa tramada", [SPEED,
  F("pixel", "Tamaño del píxel", 4, 2, 12), COLS(2)]) + `
float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
void main() {
  float P = pixel * RENDERSIZE.y / 540.0;
  vec2 pc = floor(isf_FragNormCoord * RENDERSIZE / P);
  vec2 uq = pc * P / RENDERSIZE;
  float v = fbm(uq * vec2(RENDERSIZE.x / RENDERSIZE.y, 1.0) * 3.0 + vec2(TIME * speed * 0.03, 0.0));
  float lv = floor((v * 1.4 - 0.35) * 4.0 + bayer4(pc)) / 4.0;
  vec3 col = pal(colores, 0.2 + lv * 0.5) * clamp(lv, 0.0, 1.0) * 0.45;
  for (int l = 0; l < 3; l++) {
    float fl = float(l);
    float sx = floor(pc.x + TIME * speed * (3.0 + fl * 6.0));
    float s = step(0.988 - fl * 0.004, hash(vec2(sx, pc.y + fl * 100.0)));
    col += vec3(0.35 + fl * 0.32) * s * (0.7 + 0.3 * sin(TIME * 5.0 + sx));
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const TERMINAL = head("Terminal antigua: texto verde que se escribe solo en una pantalla curva", [SPEED,
  F("tamano", "Tamaño de letra", 18, 8, 30), F("curvatura", "Curvatura", 0.4, 0.0, 1.0), C("tinte", "Color", [0.3, 1.0, 0.4])]) + `
void main() {
  vec2 p = isf_FragNormCoord * 2.0 - 1.0;
  p *= 1.0 + curvatura * 0.12 * dot(p, p);
  vec2 uv = p * 0.5 + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float k = RENDERSIZE.y / 540.0;
  vec2 cs = vec2(tamano * 0.6, tamano * 1.25) * k;
  vec2 g = vec2(uv.x * RENDERSIZE.x - 20.0 * k, (1.0 - uv.y) * RENDERSIZE.y - 16.0 * k) / cs;
  float cols = floor((RENDERSIZE.x - 40.0 * k) / cs.x), rows = floor((RENDERSIZE.y - 32.0 * k) / cs.y);
  float c = floor(g.x), r = floor(g.y);
  float lineT = 46.0, t = TIME * speed * 30.0 + rows * lineT;
  float cur = floor(t / lineT), inCur = mod(t, lineT);
  float li = r + max(0.0, cur - rows + 1.0);
  float len = min(floor(hash1(li) * 38.0) + 4.0, cols);
  float shown = li < cur ? len : li == cur ? min(floor(inCur), len) : 0.0;
  vec2 f = fract(g), gp = floor(f * vec2(5.0, 7.0));
  float bit = 0.0;
  if (g.x >= 0.0 && c < shown) {
    if (c < 1.0) bit = step(abs(gp.x - 1.0 - (3.0 - abs(gp.y - 3.0)) * 0.67), 0.5);   // «>» del indicador
    else if (c >= 2.0) bit = step(0.45, hash(vec2(hash1(li * 13.0 + c), gp.x + gp.y * 5.0)));
  }
  bit *= step(0.1, f.x) * step(f.x, 0.9) * step(0.08, f.y) * step(f.y, 0.92);
  float cursor = (li == cur && c == shown && g.x >= 0.0) ? step(0.5, fract(TIME * 2.0)) : 0.0;
  vec3 col = tinte.rgb * max(bit, cursor * 0.9);
  col += tinte.rgb * 0.04;
  col += tinte.rgb * 0.08 * smoothstep(0.12, 0.0, abs(fract(uv.y - TIME * 0.2) - 0.5));   // barrido de refresco del tubo
  col *= 0.85 + 0.15 * sin(uv.y * RENDERSIZE.y * 1.6);
  col *= smoothstep(1.4, 0.6, length(p)) * (0.97 + 0.03 * sin(TIME * 50.0));
  gl_FragColor = vec4(col, 1.0);
}`;

const PIPES = head("Tuberías 3D del salvapantallas clásico: tubos de colores que van llenando la pantalla", [SPEED,
  F("celdas", "Tamaño", 14, 6, 30), COLS(3)]) + `
void main() {
  vec2 g = asp(isf_FragNormCoord) * celdas;
  vec2 id = floor(g), f = fract(g) - 0.5;
  float cyc = mod(TIME * speed * 1.5, 20.0);
  vec3 col = vec3(0.0);
  if (hash(id + 11.3) < 0.25 + 0.75 * cyc / 14.0) {
    float t = floor(hash(id) * 6.0), d;
    if (t < 1.0) d = abs(f.y);
    else if (t < 2.0) d = abs(f.x);
    else {
      vec2 cn = t < 3.0 ? vec2(-0.5, 0.5) : t < 4.0 ? vec2(0.5, 0.5) : t < 5.0 ? vec2(0.5, -0.5) : vec2(-0.5, -0.5);
      d = abs(length(f - cn) - 0.5);
    }
    float R = 0.18;
    vec3 c = pal(colores, hash(floor(id / 4.0)) );
    if (d < R) {
      float s = sqrt(1.0 - (d / R) * (d / R));
      col = c * (0.25 + 0.75 * s) + vec3(1.0) * pow(s, 20.0) * 0.5;
    }
    float jb = length(f);
    if (t >= 2.0 && hash(id + 4.0) > 0.6 && jb < 0.24) {
      float s = sqrt(1.0 - (jb / 0.24) * (jb / 0.24));
      col = c * (0.25 + 0.75 * s) + vec3(1.0) * pow(s, 20.0) * 0.6;
    }
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export const PRO = [
  {
    "lumamap-plugin": 1, id: "pro-generativos", name: "Pro 50: generativos", version: "1.0", author: "LumaMap",
    description: "Visuales que se crean solos: túnel infinito, fractal caleidoscópico, aurora boreal, mármol líquido, cristales, hiperespacio, flor de la vida, Truchet, galaxia, muro de fuego, bola de plasma y lámpara de lava.",
    shaders: [
      { name: "Túnel infinito", isf: TUNNEL }, { name: "Fractal caleidoscópico", isf: KIFS }, { name: "Aurora boreal", isf: AURORA },
      { name: "Mármol líquido", isf: MARBLE }, { name: "Cristales de Voronoi", isf: CRYSTALS }, { name: "Hiperespacio", isf: HYPER },
      { name: "Flor de la vida", isf: FLOWER }, { name: "Laberinto Truchet", isf: TRUCHET }, { name: "Galaxia espiral", isf: GALAXY },
      { name: "Muro de fuego", isf: FIRE }, { name: "Bola de plasma", isf: PLASMA }, { name: "Lámpara de lava", isf: LAVA },
    ],
  },
  {
    "lumamap-plugin": 1, id: "pro-fachadas", name: "Pro 50: mapping de fachadas", version: "1.0", author: "LumaMap",
    description: "Pensados para proyectar sobre edificios y paredes: barrido de luz, ventanas que se encienden, muro que se construye, grietas con lava, rejilla de neón, agua que sube, haces de escenario, escaneo láser, cubos isométricos y tablero de paletas.",
    shaders: [
      { name: "Barrido de luz", isf: SWEEP }, { name: "Ventanas que se encienden", isf: WINDOWS }, { name: "Muro que se construye", isf: BUILDWALL },
      { name: "Grietas con lava", isf: CRACKS }, { name: "Rejilla de neón", isf: NEONGRID }, { name: "Agua que sube", isf: WATER },
      { name: "Haces de escenario", isf: BEAMS }, { name: "Escaneo láser", isf: LASERSCAN }, { name: "Cubos isométricos", isf: ISOCUBES },
      { name: "Tablero de paletas", isf: FLAPS },
    ],
  },
  {
    "lumamap-plugin": 1, id: "pro-camara", name: "Pro 50: cámara artística", version: "1.0", author: "LumaMap",
    description: "Sobre la cámara o tus videos: cámara térmica, visión nocturna, bordes de neón, semitono, óleo, lápiz, cómic, mosaico de hexágonos, pantalla LED, gotas de agua, vidrio roto y duotono.",
    shaders: [
      { name: "Cámara térmica", isf: THERMAL }, { name: "Visión nocturna", isf: NIGHT }, { name: "Bordes de neón", isf: NEONEDGES },
      { name: "Semitono de imprenta", isf: HALFTONE }, { name: "Pintura al óleo", isf: OIL }, { name: "Dibujo a lápiz", isf: SKETCH },
      { name: "Cómic", isf: COMIC }, { name: "Mosaico de hexágonos", isf: HEXMOS }, { name: "Pantalla LED", isf: LEDWALL },
      { name: "Gotas de agua", isf: RIPPLES }, { name: "Vidrio roto", isf: SHARDS }, { name: "Duotono", isf: DUOTONE },
    ],
  },
  {
    "lumamap-plugin": 1, id: "pro-club", name: "Pro 50: club", version: "1.0", author: "LumaMap",
    description: "Siguen el sonido: espectro circular, túnel de graves, osciloscopio, ciudad ecualizador, estallido de partículas, polígonos al ritmo, estrobo geométrico suave y cuadrícula que respira.",
    shaders: [
      { name: "Espectro circular", isf: CIRCSPEC }, { name: "Túnel de graves", isf: BASSTUNNEL }, { name: "Osciloscopio", isf: SCOPE },
      { name: "Ciudad ecualizador", isf: EQCITY }, { name: "Estallido de partículas", isf: BURST }, { name: "Polígonos al ritmo", isf: POLYPULSE },
      { name: "Estrobo geométrico", isf: STROBE }, { name: "Cuadrícula que respira", isf: BREATHGRID },
    ],
  },
  {
    "lumamap-plugin": 1, id: "pro-retro", name: "Pro 50: retro y arcade", version: "1.0", author: "LumaMap",
    description: "Nostalgia de los 80 y 90: synthwave, lluvia digital, barras de cobre, rotozoom, torsión de la demoscene, estrellas de 8 bits, terminal antigua y tuberías 3D del salvapantallas.",
    shaders: [
      { name: "Synthwave", isf: SYNTHWAVE }, { name: "Lluvia digital", isf: RAIN }, { name: "Barras de cobre", isf: COPPER },
      { name: "Rotozoom", isf: ROTOZOOM }, { name: "Torsión", isf: TWISTER }, { name: "Estrellas de 8 bits", isf: STARS8 },
      { name: "Terminal antigua", isf: TERMINAL }, { name: "Tuberías 3D", isf: PIPES },
    ],
  },
];
