// web/js/plugins-toons.js
// Loops de dibujos animados con estilo propio (sin personajes con derechos de autor):
// «Caricaturas sci-fi» (portal verde, platillo volante, planeta alienígena, TV interdimensional,
// baba alienígena, espacio de caricatura) y «Anime» (líneas de velocidad, pétalos de sakura,
// cielo anime, ciudad de neón con lluvia, rayo de energía, aura de poder).
// Todo es dibujo vectorial (formas con contorno de tinta y colores planos, como la animación de
// verdad): se ve nítido en Full HD y en 4K. Bucle perfecto: todo depende de PH = fract(TIME/duración).
// Tus propios personajes (PNG con fondo transparente) se ponen en una capa encima.

const LIB = `float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hash1(float n) { return fract(sin(n) * 43758.5453); }
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
vec2 asp(vec2 uv) { return (uv - 0.5) * vec2(RENDERSIZE.x / RENDERSIZE.y, 1.0); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return v; }
#define TAU 6.2831853
const vec3 INK = vec3(0.04, 0.03, 0.07);
float PH, PXS, LW;
void setup() { PH = fract(TIME / loopSec); PXS = 1.2 / RENDERSIZE.y; LW = grosor / 540.0; }
float sdBox2(vec2 p, vec2 b) { vec2 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0); }
float sdRBox(vec2 p, vec2 b, float r) { return sdBox2(p, b - r) - r; }
float sdEl(vec2 p, vec2 ab) { return (length(p / ab) - 1.0) * min(ab.x, ab.y); }
float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
// Forma rellena con contorno de tinta (antialias de 1 píxel: nítido a cualquier resolución).
vec3 layer(vec3 col, float d, vec3 fill) { col = mix(col, fill, smoothstep(PXS, -PXS, d)); return mix(col, INK, smoothstep(LW + PXS, LW - PXS, abs(d)) * step(0.0001, LW)); }
vec3 fillOnly(vec3 col, float d, vec3 fill) { return mix(col, fill, smoothstep(PXS, -PXS, d)); }
// Destello de 4 puntas (estrellas de caricatura).
float sparkle(vec2 p, float s) { p = abs(p) / s; return max(0.0, 1.0 - (sqrt(p.x) + sqrt(p.y))); }
`;

const C = (name, label, rgb) => `{ "NAME": "${name}", "TYPE": "color", "DEFAULT": [${rgb.join(", ")}, 1.0], "LABEL": "${label}" }`;
const F = (name, label, def, min, max) => `{ "NAME": "${name}", "TYPE": "float", "DEFAULT": ${def.toFixed(3)}, "MIN": ${min.toFixed(3)}, "MAX": ${max.toFixed(3)}, "LABEL": "${label}" }`;
const toon = (desc, inputs, body, { secs = 6, line = 2.5 } = {}) => `/*{
  "DESCRIPTION": "${desc}",
  "CREDIT": "LumaMap",
  "INPUTS": [ ${F("loopSec", "Duración del bucle (s)", secs, 1, 30)},
    ${F("grosor", "Grosor del contorno", line, 0, 6)}${inputs.length ? ",\n    " + inputs.join(",\n    ") : ""} ]
}*/
${LIB}
${body}`;

/* ============================ Caricaturas sci-fi ============================ */

const PORTAL = toon("Portal verde de caricatura: remolino que gira con gotas alrededor", [
  C("fondo", "Fondo", [0.06, 0.04, 0.12]), C("verde", "Color del portal", [0.3, 0.95, 0.2])], `
void main() {
  setup();
  vec2 p = asp(isf_FragNormCoord);
  vec3 col = fondo.rgb * (1.0 - 0.4 * length(p));
  vec2 g = floor(p * 30.0);
  float h = hash(g);
  col += vec3(1.0) * step(0.95, h) * sparkle(fract(p * 30.0) - 0.5, 0.45) * (0.5 + 0.5 * sin(PH * TAU * 2.0 + h * 40.0));
  float a = atan(p.y, p.x), r = length(p);
  float R = 0.34 * (1.0 + 0.05 * sin(6.0 * a + PH * TAU * 2.0) + 0.03 * sin(11.0 * a - PH * TAU * 3.0));
  float d = r - R;
  col += verde.rgb * exp(-max(d, 0.0) * 14.0) * 0.5;
  float drops = 1e3;
  for (int i = 0; i < 7; i++) {
    float fi = float(i), an = fi * TAU / 7.0 + PH * TAU;
    float rr = 0.42 + 0.04 * sin(PH * TAU * 2.0 + fi * 1.7);
    drops = min(drops, length(p - vec2(cos(an), sin(an)) * rr) - (0.018 + 0.012 * hash1(fi)));
  }
  col = layer(col, drops, verde.rgb * 0.9);
  float sw = sin(a * 3.0 + log(r + 0.001) * 8.0 - PH * TAU * 2.0);
  float lv = floor((0.5 + 0.5 * sw) * 2.999) / 2.0;
  vec3 inside = mix(verde.rgb * 0.45, mix(verde.rgb, vec3(0.85, 1.0, 0.5), 0.5), lv);
  inside = mix(inside, vec3(0.95, 1.0, 0.7), smoothstep(0.12, 0.0, r));
  col = layer(col, d, inside);
  gl_FragColor = vec4(col, 1.0);
}`);

const SAUCER = toon("Platillo volante que flota sobre un planeta y abduce una roca con su rayo", [
  C("cielo1", "Cielo (abajo)", [0.1, 0.6, 0.6]), C("cielo2", "Cielo (arriba)", [0.35, 0.15, 0.5]), C("rayo", "Rayo", [0.8, 1.0, 0.3])], `
void main() {
  setup();
  vec2 uv = isf_FragNormCoord, p = asp(uv);
  float ar = RENDERSIZE.x / RENDERSIZE.y, t = PH * TAU;
  vec3 col = mix(cielo1.rgb, cielo2.rgb, uv.y);
  vec2 g = floor(p * 25.0);
  float h = hash(g);
  col += vec3(1.0) * step(0.93, h) * sparkle(fract(p * 25.0) - 0.5, 0.4) * (0.4 + 0.6 * step(0.5, fract(PH * 3.0 + h))) * step(0.0, p.y);
  vec2 mp = p - vec2(ar * 0.32, 0.28);
  col = layer(col, length(mp) - 0.09, vec3(0.95, 0.9, 0.7));
  col = fillOnly(col, max(length(mp - vec2(0.03, 0.02)) - 0.022, length(mp) - 0.09), vec3(0.8, 0.75, 0.58));
  col = fillOnly(col, max(length(mp - vec2(-0.035, -0.03)) - 0.016, length(mp) - 0.09), vec3(0.8, 0.75, 0.58));
  float gy = -0.28 + 0.035 * sin(p.x * 5.0) + 0.02 * sin(p.x * 13.0 + 1.0);
  float dg = p.y - gy;
  col = layer(col, dg, vec3(0.45, 0.25, 0.55));
  col = fillOnly(col, dg + 0.07 + 0.015 * sin(p.x * 9.0), vec3(0.36, 0.19, 0.45));
  vec2 c = vec2(0.12 * sin(t), 0.14 + 0.03 * sin(t * 2.0));
  vec2 q = rot(0.08 * sin(t * 2.0)) * (p - c);
  float bw = 0.05 + max(-0.03 - q.y, 0.0) * 0.55;
  float beam = step(q.y, -0.03) * smoothstep(bw, bw - 0.01, abs(q.x)) * step(0.0, dg);
  col = mix(col, rayo.rgb, beam * (0.38 + 0.08 * sin(t * 16.0)));
  float ry = mix(gy + 0.03, c.y - 0.07, fract(PH * 2.0));
  col = layer(col, sdRBox(rot(PH * TAU * 2.0) * (p - vec2(c.x, ry)), vec2(0.022), 0.006), vec3(0.62, 0.56, 0.5));
  col = layer(col, max(length(q) - 0.07, -q.y), vec3(0.6, 0.9, 1.0));
  col = fillOnly(col, length(q - vec2(-0.025, 0.035)) - 0.012, vec3(1.0));
  float disc = sdEl(q, vec2(0.16, 0.035));
  col = layer(col, disc, vec3(0.72, 0.74, 0.82));
  col = fillOnly(col, max(disc + LW, q.y + 0.004), vec3(0.52, 0.54, 0.62));
  for (int i = 0; i < 5; i++) {
    float fi = float(i), on = step(0.5, fract(PH * 8.0 - fi * 0.2));
    col = layer(col, length(q - vec2(-0.1 + fi * 0.05, -0.006)) - 0.009, mix(vec3(0.35, 0.1, 0.1), vec3(1.0, 0.9, 0.3), on));
  }
  gl_FragColor = vec4(col, 1.0);
}`);

const ALIENWORLD = toon("Planeta alienígena: dos soles, un planeta con anillos, nubes y plantas raras que se mecen", [
  C("cielo", "Cielo", [0.95, 0.55, 0.35]), C("planta", "Plantas", [0.2, 0.85, 0.6])], `
void main() {
  setup();
  vec2 uv = isf_FragNormCoord, p = asp(uv);
  float ar = RENDERSIZE.x / RENDERSIZE.y;
  vec3 col = mix(cielo.rgb, vec3(0.3, 0.15, 0.45), smoothstep(-0.3, 0.6, p.y));
  col = layer(col, length(p - vec2(-0.5, 0.3)) - 0.07, vec3(1.0, 0.92, 0.4));
  col = layer(col, length(p - vec2(-0.35, 0.37)) - 0.04, vec3(1.0, 1.0, 0.9));
  vec2 q = rot(-0.3) * (p - vec2(0.45, 0.2));
  float ring = abs(length(q / vec2(1.0, 0.28)) - 0.22) * 0.28 - 0.008;
  if (q.y > 0.0) col = layer(col, ring, vec3(0.95, 0.85, 0.6));
  float pl = length(q) - 0.13;
  col = layer(col, pl, mix(vec3(0.55, 0.35, 0.8), vec3(0.75, 0.5, 0.9), step(0.5, fract(q.y * 18.0 + 0.3 * sin(q.x * 20.0)))));
  col = fillOnly(col, max(pl, -(length(q - vec2(-0.04, 0.04)) - 0.13)), vec3(0.4, 0.22, 0.6));
  if (q.y <= 0.0) col = layer(col, ring, vec3(0.95, 0.85, 0.6));
  for (int i = 0; i < 3; i++) {
    float fi = float(i), w = ar + 0.6;
    vec2 cc = p - vec2(fract(hash1(fi * 3.3) + PH) * w - w * 0.5, 0.22 + 0.12 * fi);
    float cl = smin(length(cc) - 0.045, smin(length(cc - vec2(0.05, -0.01)) - 0.035, length(cc + vec2(0.05, 0.01)) - 0.03, 0.02), 0.02);
    cl = max(cl, -(cc.y + 0.025));
    col = layer(col, cl, vec3(1.0, 0.93, 0.95));
  }
  float mt = p.y - (-0.06 + 0.09 * abs(sin(p.x * 3.0 + 1.0)) + 0.03 * sin(p.x * 11.0));
  col = layer(col, mt, vec3(0.42, 0.24, 0.5));
  float gy = -0.27 + 0.02 * sin(p.x * 4.0);
  col = layer(col, p.y - gy, vec3(0.28, 0.5, 0.45));
  col = fillOnly(col, p.y - gy + 0.06, vec3(0.22, 0.42, 0.38));
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    float x = (fi / 6.0 - 0.5) * ar * 0.9 + 0.05 * hash1(fi * 5.1);
    float hh = 0.12 + 0.12 * hash1(fi);
    vec2 base = vec2(x, -0.27 + 0.02 * sin(x * 4.0));
    vec2 top = base + vec2(0.05 * sin(PH * TAU + fi), hh);
    col = layer(col, sdSeg(p, base, top) - 0.008, planta.rgb * 0.7);
    float bulb = length(p - top) - (0.028 + 0.012 * hash1(fi * 2.0));
    col = layer(col, bulb, mod(fi, 2.0) < 0.5 ? planta.rgb : vec3(1.0, 0.45, 0.6));
    col = fillOnly(col, length(p - top - vec2(0.008, 0.01)) - 0.007, vec3(1.0));
  }
  gl_FragColor = vec4(col, 1.0);
}`, { secs: 8 });

const TV = toon("Tele interdimensional: un televisor de caricatura que cambia de canal (barras, espiral, carita, pelota) con estática", [
  C("carcasa", "Carcasa", [0.85, 0.5, 0.25])], `
vec3 screen(vec2 s, vec2 uv) {
  float k = floor(PH * 4.0), lc = fract(PH * 4.0);
  vec3 c;
  if (k < 1.0) {
    float b = floor((s.x * 0.5 + 0.5) * 7.0);
    c = b < 1.0 ? vec3(1.0) : b < 2.0 ? vec3(1.0, 1.0, 0.0) : b < 3.0 ? vec3(0.0, 1.0, 1.0) : b < 4.0 ? vec3(0.0, 1.0, 0.0) : b < 5.0 ? vec3(1.0, 0.0, 1.0) : b < 6.0 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 1.0);
    if (s.y < -0.55) c = vec3(0.1) + 0.8 * step(0.5, fract(s.x * 4.0));
  } else if (k < 2.0) {
    float sp = sin(atan(s.y, s.x) * 2.0 + length(s) * 18.0 - PH * TAU * 8.0);
    c = mix(vec3(0.9, 0.2, 0.7), vec3(0.2, 0.9, 0.8), step(0.0, sp));
  } else if (k < 3.0) {
    c = vec3(0.95, 0.85, 0.5);
    vec2 f = s * vec2(1.3, 1.0);
    c = layer(c, length(f) - 0.62, vec3(0.45, 0.9, 0.4));
    c = layer(c, length(f - vec2(-0.22, 0.18)) - 0.12, vec3(1.0));
    c = layer(c, length(f - vec2(0.22, 0.18)) - 0.12, vec3(1.0));
    c = fillOnly(c, length(f - vec2(-0.2, 0.16)) - 0.05, INK);
    c = fillOnly(c, length(f - vec2(0.24, 0.16)) - 0.05, INK);
    float mo = 0.04 + 0.08 * (0.5 + 0.5 * sin(PH * TAU * 12.0));
    c = layer(c, sdEl(f - vec2(0.0, -0.22), vec2(0.18, mo)), vec3(0.5, 0.05, 0.15));
  } else {
    c = vec3(0.1, 0.1, 0.35);
    vec2 bp = vec2(abs(fract(PH * 3.0) * 2.0 - 1.0) * 1.4 - 0.7, abs(sin(PH * TAU * 2.0)) * 0.9 - 0.5);
    c = layer(c, length((s - bp) * vec2(1.3, 1.0)) - 0.2, vec3(1.0, 0.35, 0.3));
  }
  float st = hash(floor(uv * RENDERSIZE / 3.0) + floor(PH * 240.0));
  c = mix(c, vec3(st), step(lc, 0.07));
  c *= 0.88 + 0.12 * sin(uv.y * RENDERSIZE.y * 1.4);
  return c;
}
void main() {
  setup();
  vec2 uv = isf_FragNormCoord, p = asp(uv);
  vec3 col = mix(vec3(0.85, 0.7, 0.35), vec3(0.75, 0.6, 0.3), step(0.5, fract(p.x * 12.0)));
  col = fillOnly(col, p.y + 0.33, vec3(0.45, 0.28, 0.2));
  col = layer(col, sdSeg(p, vec2(-0.05, 0.26), vec2(-0.22, 0.45)) - 0.006, vec3(0.3));
  col = layer(col, sdSeg(p, vec2(0.05, 0.26), vec2(0.2, 0.47)) - 0.006, vec3(0.3));
  col = layer(col, length(p - vec2(-0.22, 0.45)) - 0.018, vec3(0.9, 0.2, 0.2));
  col = layer(col, length(p - vec2(0.2, 0.47)) - 0.018, vec3(0.9, 0.2, 0.2));
  col = layer(col, sdBox2(p - vec2(-0.25, -0.32), vec2(0.025, 0.04)), vec3(0.3, 0.2, 0.15));
  col = layer(col, sdBox2(p - vec2(0.25, -0.32), vec2(0.025, 0.04)), vec3(0.3, 0.2, 0.15));
  float body = sdRBox(p - vec2(0.0, -0.02), vec2(0.38, 0.28), 0.05);
  col = layer(col, body, carcasa.rgb);
  col = fillOnly(col, max(body + LW, -(p.y + 0.18)), carcasa.rgb * 0.8);
  vec2 sc = p - vec2(-0.06, 0.0);
  float scr = sdRBox(sc, vec2(0.25, 0.2), 0.05);
  if (scr < 0.0) col = screen(sc / vec2(0.25, 0.2), uv);
  col = mix(col, vec3(1.0), smoothstep(0.01, 0.0, abs(sc.x + sc.y * 0.8 - 0.12) - 0.012) * step(scr, 0.0) * 0.35);
  col = mix(col, INK, smoothstep(LW + PXS, LW - PXS, abs(scr)) * step(0.0001, LW));
  col = layer(col, length(p - vec2(0.27, 0.1)) - 0.035, vec3(0.9, 0.85, 0.7));
  col = layer(col, length(p - vec2(0.27, -0.03)) - 0.035, vec3(0.9, 0.85, 0.7));
  col = layer(col, sdBox2(rot(PH * TAU) * (p - vec2(0.27, 0.1)), vec2(0.004, 0.025)), INK);
  for (int i = 0; i < 4; i++) col = layer(col, sdBox2(p - vec2(0.27, -0.12 - float(i) * 0.025), vec2(0.04, 0.004)), vec3(0.35, 0.25, 0.2));
  gl_FragColor = vec4(col, 1.0);
}`, { secs: 8 });

const SLIME = toon("Baba alienígena de tres ojos que se bambolea, parpadea y gotea", [
  C("baba", "Color de la baba", [0.45, 0.95, 0.3]), C("fondo", "Fondo", [1.0, 0.55, 0.75])], `
float body(vec2 p) {
  vec2 q = p - vec2(0.0, -0.06);
  q.y /= 1.0 + 0.06 * sin(PH * TAU * 2.0);
  float d = sdEl(q, vec2(0.24, 0.2));
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    d = smin(d, length(p - vec2(sin(PH * TAU + fi * 2.1) * 0.1, 0.1 + 0.02 * sin(PH * TAU * 2.0 + fi))) - 0.08, 0.06);
  }
  for (int i = 0; i < 3; i++) {
    float fi = float(i), f = fract(PH + fi / 3.0);
    d = smin(d, length(p - vec2(-0.12 + fi * 0.12, -0.24 - f * 0.18)) - 0.03 * (1.0 - f * 0.6), 0.05);
  }
  return d;
}
void main() {
  setup();
  vec2 p = asp(isf_FragNormCoord);
  vec2 bq = p + vec2(PH, PH) * 0.25;
  vec3 col = fondo.rgb;
  col = fillOnly(col, length(fract(bq * 8.0) - 0.5) / 8.0 - 0.02, mix(fondo.rgb, vec3(1.0), 0.35));
  col = fillOnly(col, sdEl(p - vec2(0.0, -0.32), vec2(0.3, 0.04)), fondo.rgb * 0.75);
  float d = body(p);
  col = layer(col, d, baba.rgb);
  col = fillOnly(col, max(d + LW, -body(p + vec2(0.035, -0.035))), baba.rgb * 0.72);
  col = fillOnly(col, sdEl(rot(0.6) * (p - vec2(-0.13, 0.06)), vec2(0.03, 0.015)), vec3(1.0));
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 e = vec2(-0.09 + fi * 0.09, 0.05 + (fi == 1.0 ? 0.05 : 0.0));
    float ed = length(p - e) - 0.042;
    col = layer(col, ed, vec3(1.0));
    vec2 look = vec2(sin(PH * TAU), cos(PH * TAU * 2.0)) * 0.012;
    col = fillOnly(col, length(p - e - look) - 0.019, INK);
    if (fract(PH * 2.0 + fi * 0.13) < 0.05) col = layer(col, max(ed, -(p.y - e.y + 0.005)), baba.rgb * 0.85);
  }
  vec2 m = p - vec2(0.0, -0.05);
  col = mix(col, INK, smoothstep(LW + PXS, LW - PXS, abs(length(m) - 0.08)) * step(m.y, -0.04) * step(0.0001, LW));
  gl_FragColor = vec4(col, 1.0);
}`);

const TOONSPACE = toon("Espacio de caricatura: planetas que pasan, estrellas de cuatro puntas, un cohete y una estrella fugaz", [
  C("fondo", "Fondo", [0.08, 0.06, 0.2])], `
void main() {
  setup();
  vec2 uv = isf_FragNormCoord, p = asp(uv);
  float ar = RENDERSIZE.x / RENDERSIZE.y, w = ar + 0.8;
  vec3 col = mix(fondo.rgb, fondo.rgb * 1.8, uv.y);
  for (int l = 0; l < 2; l++) {
    float fl = float(l), n = 18.0 + fl * 14.0;
    vec2 g = p * n;
    float P = floor(n * w);
    g.x += PH * P;   // una vuelta entera de la franja por bucle: sin corte
    vec2 id = floor(g);
    float h = hash(vec2(mod(id.x, P), id.y) + fl * 10.0);
    col += vec3(1.0, 0.95, 0.8) * step(0.94, h) * sparkle(fract(g) - 0.5, 0.35 + 0.1 * fl) * (0.5 + 0.5 * sin(PH * TAU * 2.0 + h * 30.0));
  }
  for (int i = 0; i < 4; i++) {
    float fi = float(i), r = 0.05 + 0.06 * hash1(fi);
    vec2 c = p - vec2(fract(hash1(fi * 7.7) + PH * (1.0 + floor(fi / 2.0))) * w - w * 0.5, -0.3 + 0.2 * fi);
    vec3 pc = fi < 1.0 ? vec3(0.95, 0.45, 0.3) : fi < 2.0 ? vec3(0.4, 0.7, 1.0) : fi < 3.0 ? vec3(0.9, 0.8, 0.3) : vec3(0.6, 0.9, 0.5);
    float d = length(c) - r;
    col = layer(col, d, pc);
    col = fillOnly(col, max(d + LW, -(length(c - vec2(-r * 0.3, r * 0.3)) - r)), pc * 0.72);
    col = fillOnly(col, length(c - vec2(r * 0.3, -r * 0.2)) - r * 0.18, pc * 0.6);
    if (fi == 2.0) col = layer(col, abs(length(rot(0.4) * c / vec2(1.0, 0.25)) - r * 1.6) * 0.25 - 0.004, vec3(1.0, 0.95, 0.7));
  }
  float sx = fract(PH) * (w + 0.6) - (w + 0.6) * 0.5;
  vec2 sp = p - vec2(sx, 0.32 - (sx + w * 0.5) * 0.15);
  col += vec3(1.0, 0.95, 0.7) * smoothstep(0.006, 0.0, abs(sp.y + sp.x * 0.15)) * step(sp.x, 0.0) * smoothstep(-0.3, 0.0, sp.x);
  col = fillOnly(col, length(sp) - 0.012, vec3(1.0));
  vec2 rc = rot(-0.5 + 0.1 * sin(PH * TAU * 2.0)) * (p - vec2(0.15 * sin(PH * TAU), 0.05 * sin(PH * TAU * 2.0)));
  float fl = 0.06 + 0.02 * sin(PH * TAU * 12.0);
  col = layer(col, sdEl(rc - vec2(-0.12 - fl * 0.5, 0.0), vec2(fl, 0.025)), vec3(1.0, 0.6, 0.1));
  col = fillOnly(col, sdEl(rc - vec2(-0.12 - fl * 0.3, 0.0), vec2(fl * 0.5, 0.012)), vec3(1.0, 0.95, 0.5));
  col = layer(col, sdBox2(rc - vec2(-0.09, 0.035), vec2(0.03, 0.02)), vec3(0.9, 0.2, 0.25));
  col = layer(col, sdBox2(rc - vec2(-0.09, -0.035), vec2(0.03, 0.02)), vec3(0.9, 0.2, 0.25));
  col = layer(col, sdEl(rc, vec2(0.12, 0.04)), vec3(0.92, 0.92, 0.95));
  col = layer(col, length(rc - vec2(0.02, 0.0)) - 0.018, vec3(0.5, 0.85, 1.0));
  gl_FragColor = vec4(col, 1.0);
}`, { secs: 10 });

/* ============================ Anime ============================ */

const SPEEDLINES = toon("Líneas de velocidad de manga (como en los momentos épicos del anime)", [
  C("fondo", "Fondo", [1.0, 1.0, 1.0]), C("lineas", "Líneas", [0.05, 0.05, 0.1]),
  F("densidad", "Densidad", 0.7, 0.2, 1.0), F("centro", "Hueco del centro", 0.22, 0.05, 0.5)], `
void main() {
  setup();
  vec2 p = asp(isf_FragNormCoord);
  float a = atan(p.y, p.x), r = length(p), n = 200.0;
  float x = (a / TAU + 0.5) * n, s = floor(x), f = fract(x);
  float k = floor(PH * 24.0);
  float h = hash(vec2(s, k));
  float r0 = centro + 0.25 * hash(vec2(s, k + 3.0));
  float wd = (0.15 + 0.7 * hash(vec2(s, k + 7.0))) * smoothstep(r0, r0 + 0.5, r);
  float ln = step(h, densidad) * step(r0, r) * smoothstep(wd * 0.5 + 0.02, wd * 0.5 - 0.02, abs(f - 0.5));
  gl_FragColor = vec4(mix(fondo.rgb, lineas.rgb, ln), 1.0);
}`, { secs: 2, line: 0 });

const SAKURA = toon("Pétalos de sakura que caen girando, con una rama en flor y cielo de atardecer anime", [
  C("cielo1", "Cielo (abajo)", [1.0, 0.75, 0.8]), C("cielo2", "Cielo (arriba)", [0.45, 0.65, 0.95]),
  C("petalo", "Pétalos", [1.0, 0.72, 0.82]), F("petalos", "Pétalos", 60, 15, 120)], `
float flower(vec2 q, float r) { float a = atan(q.y, q.x); return length(q) - r * (0.72 + 0.28 * abs(cos(2.5 * a))); }
void main() {
  setup();
  vec2 uv = isf_FragNormCoord, p = asp(uv);
  float ar = RENDERSIZE.x / RENDERSIZE.y;
  vec3 col = mix(cielo1.rgb, cielo2.rgb, smoothstep(-0.4, 0.5, p.y));
  col += vec3(1.0, 0.9, 0.7) * exp(-length(p - vec2(0.35, -0.1)) * 4.0) * 0.4;
  vec2 b0 = vec2(-ar * 0.5 - 0.02, 0.42), b1 = vec2(-ar * 0.25, 0.33), b2 = vec2(-ar * 0.05, 0.38), b3 = vec2(-ar * 0.18, 0.47);
  float br = min(sdSeg(p, b0, b1) - 0.016, min(sdSeg(p, b1, b2) - 0.01, sdSeg(p, b1, b3) - 0.008));
  col = layer(col, br, vec3(0.35, 0.2, 0.18));
  for (int i = 0; i < 9; i++) {
    float fi = float(i);
    vec2 c = mix(b1, i < 4 ? b2 : b3, hash1(fi * 2.3)) + (vec2(hash1(fi), hash1(fi + 4.0)) - 0.5) * 0.06;
    if (i == 8) c = mix(b0, b1, 0.6);
    vec2 q = rot(fi + PH * TAU * 0.0) * (p - c);
    col = layer(col, flower(q, 0.03), mix(petalo.rgb, vec3(1.0), 0.3));
    col = fillOnly(col, length(q) - 0.008, vec3(1.0, 0.45, 0.6));
  }
  for (int i = 0; i < 120; i++) {
    float fi = float(i);
    if (fi >= petalos) break;
    float k = 1.0 + floor(hash1(fi) * 2.0), s = 0.7 + 0.6 * hash1(fi * 5.7);
    vec2 pos = vec2((hash1(fi * 7.3) - 0.5) * ar * 1.1 + 0.06 * sin(PH * TAU * k + fi), 0.6 - fract(hash1(fi * 3.1) + PH * k) * 1.25);
    vec2 q = rot(PH * TAU * k + fi) * (p - pos) / s;
    float sq = 0.55 + 0.45 * abs(cos(PH * TAU * k + fi * 1.3));   // gira en 3D: se ve más o menos ancho
    q.x /= sq;
    float d = (max(length(q - vec2(0.02, 0.0)), length(q + vec2(0.02, 0.0))) - 0.034) * s * sq;
    col = layer(col, d, mix(petalo.rgb, vec3(1.0), 0.25 * step(0.0, q.y)));
  }
  gl_FragColor = vec4(col, 1.0);
}`, { secs: 8, line: 1.5 });

const ANIMESKY = toon("Cielo anime: nubes enormes de colores planos que pasan, sol brillante y pájaros", [
  C("cielo", "Cielo", [0.15, 0.45, 0.95]), C("nube", "Nubes", [1.0, 1.0, 1.0])], `
float cloud(vec2 c, float s) {
  c /= s;
  float d = length(c) - 0.12;
  d = smin(d, length(c - vec2(0.13, -0.03)) - 0.09, 0.05);
  d = smin(d, length(c + vec2(0.14, 0.04)) - 0.08, 0.05);
  d = smin(d, length(c - vec2(0.05, 0.09)) - 0.08, 0.05);
  d = smin(d, length(c - vec2(-0.06, 0.07)) - 0.07, 0.05);
  return max(d, -(c.y + 0.07)) * s;
}
void main() {
  setup();
  vec2 uv = isf_FragNormCoord, p = asp(uv);
  float ar = RENDERSIZE.x / RENDERSIZE.y, w = ar + 1.0;
  vec3 col = mix(cielo.rgb * 1.35 + vec3(0.15), cielo.rgb * 0.7, smoothstep(-0.5, 0.5, p.y));
  vec2 sp = p - vec2(ar * 0.32, 0.32);
  float ra = atan(sp.y, sp.x);
  col += vec3(1.0, 0.95, 0.8) * (exp(-length(sp) * 5.0) * 0.6 + smoothstep(0.6, 1.0, sin(ra * 12.0 + PH * TAU)) * exp(-length(sp) * 3.0) * 0.25);
  col = fillOnly(col, length(sp) - 0.045, vec3(1.0, 1.0, 0.95));
  for (int l = 0; l < 3; l++) {
    float fl = float(l), s = 0.7 + fl * 0.45;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      vec2 c = p - vec2(fract(hash1(fi * 3.7 + fl * 11.0) + PH * (fl + 1.0) * 0.0 + PH) * w - w * 0.5, -0.3 + 0.18 * fl + 0.1 * hash1(fi + fl * 5.0));
      if (l == 2) c.x = p.x - (fract(hash1(fi * 3.7 + 22.0) + PH * 2.0) * w - w * 0.5);
      float d = cloud(c, s);
      vec3 shade = mix(nube.rgb, cielo.rgb * 0.5 + vec3(0.45, 0.42, 0.55), 0.55);
      col = fillOnly(col, d, nube.rgb);
      col = fillOnly(col, max(d, -cloud(c + vec2(-0.02, 0.035) * s, s)), shade);
      col = mix(col, vec3(1.0, 0.98, 0.9), smoothstep(0.006 * s, 0.0, abs(d)) * step(-0.02 * s, c.y) * 0.6);
    }
  }
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    vec2 bp = p - vec2(fract(hash1(fi) + PH) * w - w * 0.5, 0.15 + 0.08 * fi + 0.02 * sin(PH * TAU * 3.0 + fi));
    float flap = 0.4 + 0.5 * sin(PH * TAU * 6.0 + fi);
    float bd = min(sdSeg(bp, vec2(0.0), vec2(-0.025, 0.015 * flap)), sdSeg(bp, vec2(0.0), vec2(0.025, 0.015 * flap)));
    col = mix(col, INK, smoothstep(0.004, 0.002, bd));
  }
  gl_FragColor = vec4(col, 1.0);
}`, { secs: 12, line: 0 });

const NEONCITY = toon("Ciudad de neón anime de noche, con lluvia, letreros que parpadean y la calle mojada", [
  C("neon1", "Neón 1", [1.0, 0.2, 0.6]), C("neon2", "Neón 2", [0.2, 0.9, 1.0])], `
void main() {
  setup();
  vec2 uv = isf_FragNormCoord, p = asp(uv);
  float gy = -0.36;
  bool refl = p.y < gy;
  vec2 pp = refl ? vec2(p.x, 2.0 * gy - p.y + 0.01 * sin(p.y * 120.0 + PH * TAU * 4.0)) : p;
  vec3 col = mix(vec3(0.25, 0.08, 0.35), vec3(0.03, 0.02, 0.1), smoothstep(-0.3, 0.5, pp.y));
  col = layer(col, length(pp - vec2(-0.5, 0.33)) - 0.06, vec3(1.0, 0.95, 0.8));
  for (int l = 0; l < 3; l++) {
    float fl = float(l), bw = 0.12 + fl * 0.07, N = 16.0;
    float x = pp.x + PH * N * bw;
    float bi = floor(x / bw), fx = fract(x / bw), k = mod(bi, N);
    float h = -0.05 + fl * -0.08 + 0.35 * hash(vec2(k, fl)) - fl * 0.02;
    vec3 bc = mix(vec3(0.22, 0.12, 0.35), vec3(0.06, 0.04, 0.12), fl / 2.0);
    float inB = step(pp.y, h) * step(0.06, fx) * step(fx, 0.94);
    if (inB > 0.5) {
      col = bc;
      vec2 wg = vec2(fx * 5.0, (h - pp.y) * 40.0 / (1.0 + fl * 0.3));
      float lit = step(0.6, hash(floor(wg) + k * 7.0 + fl));
      col = mix(col, mix(vec3(1.0, 0.85, 0.5), neon2.rgb, step(0.7, hash(floor(wg) + 3.0))), lit * step(0.25, fract(wg.x)) * step(0.3, fract(wg.y)) * step(fract(wg.y), 0.75) * (0.5 + fl * 0.25));
      if (l == 2 && hash(vec2(k, 9.0)) > 0.4) {
        vec2 sg = vec2(fx - 0.5, pp.y - (h - 0.12));
        float sd = sdRBox(sg, vec2(0.14, 0.07), 0.02);
        vec3 nc = hash(vec2(k, 4.0)) > 0.5 ? neon1.rgb : neon2.rgb;
        float on = step(0.12, fract(PH * 4.0 + hash(vec2(k, 2.0))));
        col = mix(col, nc * 0.25, smoothstep(0.01, 0.0, sd));
        vec2 gc = floor((sg + vec2(0.14, 0.07)) * vec2(30.0, 30.0));
        col = mix(col, nc * 1.4, on * step(0.55, hash(gc + k)) * step(sd, -0.015));
        col = mix(col, nc * 1.2, on * smoothstep(0.006, 0.0, abs(sd)));
      }
      col = mix(col, INK, smoothstep(LW + PXS, LW - PXS, abs(pp.y - h)) * step(0.0001, LW));
    }
  }
  if (refl) col = col * 0.45 + vec3(0.02, 0.02, 0.05);
  vec2 rg = vec2(p.x * 70.0, p.y * 7.0 + PH * 14.0);
  float rain = step(0.93, hash(vec2(floor(rg.x), floor(rg.y)))) * step(0.5, fract(rg.y));
  col += vec3(0.6, 0.7, 0.9) * rain * 0.35;
  gl_FragColor = vec4(col, 1.0);
}`, { secs: 10, line: 1.5 });

const BEAM = toon("Rayo de energía anime: se carga una bola de luz y dispara un rayo enorme (hay sitio para tu personaje a la izquierda)", [
  C("energia", "Energía", [0.4, 0.8, 1.0])], `
void main() {
  setup();
  vec2 uv = isf_FragNormCoord, p = asp(uv);
  float ar = RENDERSIZE.x / RENDERSIZE.y;
  vec2 O = vec2(-ar * 0.28, 0.0);
  float fire = smoothstep(0.45, 0.5, PH) * (1.0 - smoothstep(0.82, 0.9, PH));
  vec3 col = mix(vec3(0.03, 0.03, 0.1), vec3(0.08, 0.1, 0.25), uv.y) + energia.rgb * fire * 0.15;
  float row = floor(p.y * 90.0);
  float sl = step(0.82, hash(vec2(row, 1.0))) * step(0.6, fract(p.x * 1.5 + hash(vec2(row, 2.0)) + PH * 10.0));
  col += vec3(0.6) * sl * (0.15 + 0.4 * fire);
  float ch = PH < 0.45 ? PH / 0.45 : PH < 0.85 ? 1.0 : 1.0 - (PH - 0.85) / 0.15;
  float R = 0.03 + 0.09 * ch;
  for (int i = 0; i < 12; i++) {
    float fi = float(i), an = hash1(fi) * TAU;
    float rr = (1.0 - fract(PH * 3.0 + hash1(fi * 3.0))) * 0.4 * step(PH, 0.45);
    vec2 a0 = O + vec2(cos(an), sin(an)) * (rr + R), a1 = O + vec2(cos(an), sin(an)) * (rr + R + 0.05);
    col += energia.rgb * smoothstep(0.004, 0.0, sdSeg(p, a0, a1)) * step(0.001, rr);
  }
  float f = clamp((PH - 0.45) / 0.4, 0.0, 1.0);
  float wb = 0.09 * smoothstep(0.0, 0.1, f) * (1.0 - smoothstep(0.8, 1.0, f)) * (1.0 + 0.08 * sin(p.x * 40.0 - PH * TAU * 20.0));
  float xEnd = mix(O.x, ar * 0.6, smoothstep(0.0, 0.15, f));
  float bd = max(abs(p.y - O.y) - wb, max(O.x - p.x, p.x - xEnd));
  if (wb > 0.001) {
    col = mix(col, energia.rgb * 0.9, smoothstep(PXS, -PXS, bd));
    col = mix(col, mix(energia.rgb, vec3(1.0), 0.6), smoothstep(PXS, -PXS, bd + wb * 0.35));
    col = mix(col, vec3(1.0), smoothstep(PXS, -PXS, bd + wb * 0.65));
    col = mix(col, INK, smoothstep(LW + PXS, LW - PXS, abs(bd)) * step(0.0001, LW));
  }
  float bd2 = length(p - O) - R * (1.0 + 0.08 * sin(PH * TAU * 24.0));
  col += energia.rgb * exp(-max(bd2, 0.0) * 25.0) * 0.6 * ch;
  col = layer(col, bd2, energia.rgb);
  col = fillOnly(col, bd2 + R * 0.35, mix(energia.rgb, vec3(1.0), 0.6));
  col = fillOnly(col, bd2 + R * 0.65, vec3(1.0));
  gl_FragColor = vec4(col, 1.0);
}`, { secs: 4, line: 2 });

const AURA = toon("Aura de poder anime: llamas de energía alrededor de un hueco para tu personaje, rayos y piedras que suben", [
  C("aura", "Aura", [1.0, 0.85, 0.2]), F("tamano", "Tamaño del hueco", 0.33, 0.15, 0.55)], `
float flames(vec2 p) {
  float L = 1.2, k = PH;
  float a = fbm(vec2(p.x * 7.0, p.y * 3.0 - k * L * 3.0));
  float b = fbm(vec2(p.x * 7.0, p.y * 3.0 - (k - 1.0) * L * 3.0));
  return mix(a, b, k);
}
void main() {
  setup();
  vec2 uv = isf_FragNormCoord, p = asp(uv);
  float k12 = floor(PH * 12.0);
  vec3 col = vec3(0.04, 0.03, 0.08);
  float an = atan(p.y, p.x), s = floor((an / TAU + 0.5) * 120.0);
  col += vec3(0.25) * step(0.85, hash(vec2(s, k12))) * smoothstep(0.3, 0.9, length(p));
  vec2 c = vec2(0.0, -0.05);
  float body = sdEl(p - c, vec2(tamano * 0.45, tamano));
  float n = flames(p);
  float up = smoothstep(-0.4, 0.5, p.y - c.y);
  float reach = 0.05 + 0.18 * n * (0.6 + 0.8 * up);
  float t = 1.0 - body / reach;
  float lv = t < 0.0 ? 0.0 : t < 0.45 ? 1.0 : t < 0.8 ? 2.0 : 3.0;
  if (lv > 0.5) col = lv < 1.5 ? aura.rgb * 0.75 : lv < 2.5 ? mix(aura.rgb, vec3(1.0), 0.45) : vec3(1.0, 1.0, 0.95);
  col = mix(col, INK, smoothstep(LW + PXS, LW - PXS, abs(t) * reach) * step(0.0001, LW));
  if (body < 0.0) col = vec3(0.04, 0.03, 0.08);
  float kk = floor(PH * 6.0);
  if (hash1(kk * 3.1) > 0.35) {
    vec2 a0 = c + vec2((hash1(kk) - 0.5) * 0.6, 0.35);
    float bolt = 1e3;
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      vec2 a1 = a0 + vec2((hash1(kk * 7.0 + fi) - 0.5) * 0.12, -0.12);
      bolt = min(bolt, sdSeg(p, a0, a1));
      a0 = a1;
    }
    col = mix(col, vec3(1.0), smoothstep(0.004, 0.0015, bolt));
    col += aura.rgb * exp(-bolt * 60.0) * 0.5;
  }
  for (int i = 0; i < 8; i++) {
    float fi = float(i), f = fract(hash1(fi * 2.0) + PH * (1.0 + floor(hash1(fi) * 2.0)));
    vec2 rp = vec2((hash1(fi * 5.0) - 0.5) * 1.2, -0.45 + f * 0.95);
    col = layer(col, sdRBox(rot(PH * TAU * 2.0 + fi) * (p - rp), vec2(0.015 + 0.01 * hash1(fi)), 0.004), vec3(0.45, 0.4, 0.38) * (1.0 - f * 0.5));
  }
  gl_FragColor = vec4(col, 1.0);
}`, { secs: 3, line: 2 });

export const TOONS = [
  {
    "lumamap-plugin": 1, id: "toons-scifi", name: "Caricaturas sci-fi", version: "1.0", author: "LumaMap",
    description: "Dibujos animados de ciencia ficción con estilo propio, nítidos en Full HD y 4K: portal verde, platillo volante, planeta alienígena, tele interdimensional, baba alienígena y espacio de caricatura. Se repiten sin corte.",
    shaders: [
      { name: "Portal verde", isf: PORTAL }, { name: "Platillo volante", isf: SAUCER }, { name: "Planeta alienígena", isf: ALIENWORLD },
      { name: "Tele interdimensional", isf: TV }, { name: "Baba alienígena", isf: SLIME }, { name: "Espacio de caricatura", isf: TOONSPACE },
    ],
  },
  {
    "lumamap-plugin": 1, id: "toons-anime", name: "Anime", version: "1.0", author: "LumaMap",
    description: "Fondos y efectos de anime dibujados a mano por código, nítidos en Full HD y 4K: líneas de velocidad, sakura, cielo anime, ciudad de neón con lluvia, rayo de energía y aura de poder (con hueco para tu personaje).",
    shaders: [
      { name: "Líneas de velocidad", isf: SPEEDLINES }, { name: "Sakura", isf: SAKURA }, { name: "Cielo anime", isf: ANIMESKY },
      { name: "Ciudad de neón anime", isf: NEONCITY }, { name: "Rayo de energía", isf: BEAM }, { name: "Aura de poder", isf: AURA },
    ],
  },
];
