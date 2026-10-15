// web/js/plugins-loops3d.js
// «Loops 3D techno»: escenas 3D en tiempo real (raymarching) con el aspecto de los loops que se
// renderizan en Cinema 4D/Octane para shows de techno: metal oscuro, cromo, suelo mojado que
// refleja, niebla, neones que brillan en el aire y luz que sube con los graves.
// Bucle perfecto: todo el movimiento depende de la fase PH = fract(TIME / duración), con giros y
// recorridos que terminan exactamente donde empiezan (se puede grabar uno y repetirlo sin corte).
// Son datos (texto ISF) como cualquier plugin: se validan y corren aislados en la GPU.

const HASH = `float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hash1(float n) { return fract(sin(n) * 43758.5453); }
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
vec2 asp(vec2 uv) { return (uv - 0.5) * vec2(RENDERSIZE.x / RENDERSIZE.y, 1.0); }
float band(float a, float b) { float s = 0.0; for (int i = 0; i < 8; i++) { s += IMG_NORM_PIXEL(audioFFT, vec2(mix(a, b, (float(i) + 0.5) / 8.0), 0.5)).r; } return s / 8.0; }
#define TAU 6.2831853
float PH, BASS, g_e;
float sdBox(vec3 p, vec3 b) { vec3 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0); }
float sdBox2(vec2 p, vec2 b) { vec2 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0); }
float sdTorus(vec3 p, vec2 t) { vec2 q = vec2(length(p.xz) - t.x, p.y); return length(q) - t.y; }
float sdCap(vec3 p, vec3 a, vec3 b, float r) { vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h) - r; }
float sdOcta(vec3 p, float s) { p = abs(p); return (p.x + p.y + p.z - s) * 0.57735027; }
float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
vec2 U(vec2 a, vec2 b) { return a.x < b.x ? a : b; }`;

// Materiales: 0 metal oscuro · 1 cromo · 2 neón · 3 suelo mojado · 4 neón de acento · 5 especial (detail()).
// Cada loop define map(p) → (distancia, material), cam(ro, ta), detail(col, p, n, m) y sky(dir).
const SK = `
vec3 nrm(vec3 p) { vec2 e = vec2(0.0015, 0.0); return normalize(vec3(map(p + e.xyy).x - map(p - e.xyy).x, map(p + e.yxy).x - map(p - e.yxy).x, map(p + e.yyx).x - map(p - e.yyx).x)); }
float occ(vec3 p, vec3 n) { float o = 0.0, s = 1.0; for (int i = 1; i <= 4; i++) { float h = 0.05 * float(i); o += (h - map(p + n * h).x) * s; s *= 0.6; } return clamp(1.0 - o * 2.5, 0.0, 1.0); }
// Estudio oscuro con un softbox arriba y tiras de neón a los lados: es lo que reflejan el cromo y el suelo.
vec3 envc(vec3 d) {
  vec3 c = mix(vec3(0.006, 0.006, 0.009), vec3(0.03, 0.03, 0.04), smoothstep(-0.3, 1.0, d.y));
  c += vec3(1.0) * smoothstep(0.86, 0.97, d.y) * 1.6;                                        // softbox de arriba
  c += neon.rgb * smoothstep(0.82, 1.0, abs(d.x)) * 0.3 * smoothstep(-0.3, 0.2, d.y);
  return c + sky(d);
}
bool isEm(float m) { return (m > 1.5 && m < 2.5) || (m > 3.5 && m < 4.5); }
vec3 emis(float m) { return (m > 3.5 && m < 4.5 ? acento.rgb : neon.rgb) * (2.2 + BASS * 2.5); }
// Reflejo de verdad (una pasada corta): el suelo mojado y el cromo reflejan las formas y los neones.
vec3 reflCol(vec3 p, vec3 rd) {
  float t = 0.02;
  for (int i = 0; i < 48; i++) {
    vec2 h = map(p + rd * t);
    if (h.x < 0.002) return (isEm(h.y) || h.y > 4.5) ? emis(h.y) * 0.8 : vec3(0.03) + neon.rgb * exp(-g_e * 3.0) * 0.5;
    t += h.x * STEPK;
    if (t > 20.0) break;
  }
  return envc(rd);
}
void main() {
  PH = fract(TIME / loopSec);
  BASS = band(0.0, 0.08) * reaccion;
  vec2 uv = asp(isf_FragNormCoord);
  vec3 ro, ta; cam(ro, ta);
  vec3 fw = normalize(ta - ro), rt = normalize(cross(vec3(0.0, 1.0, 0.0), fw)), up = cross(fw, rt);
  vec3 rd = normalize(uv.x * rt + uv.y * up + 1.5 * fw);
  float t = 0.05, m = -1.0, glow = 0.0;
  for (int i = 0; i < 110; i++) {
    vec2 h = map(ro + rd * t);
    glow += exp(-g_e * 16.0) * clamp(h.x, 0.01, 0.2);
    if (h.x < 0.0007 * t) { m = h.y; break; }
    t += h.x * STEPK;
    if (t > 40.0) break;
  }
  vec3 fogc = neon.rgb * 0.015 + vec3(0.004, 0.004, 0.007);
  vec3 col;
  if (m < 0.0) col = (envc(rd) - sky(rd)) * 0.08 + sky(rd);   // al fondo solo oscuridad (el estudio se ve en los reflejos)
  else {
    vec3 p = ro + rd * t, n = nrm(p);
    map(p);
    float ne = exp(-g_e * 4.0);
    if (isEm(m)) col = emis(m);
    else {
      float a = occ(p, n);
      vec3 rf = reflect(rd, n);
      float fre = pow(1.0 - max(dot(-rd, n), 0.0), 5.0);
      vec3 L = normalize(vec3(0.6, 0.9, -0.4));
      float dif = max(dot(n, L), 0.0), spe = pow(max(dot(rf, L), 0.0), 48.0);
      float chrome = (m > 0.5 && m < 1.5) ? 1.0 : 0.0, wet = (m > 2.5 && m < 3.5) ? 1.0 : 0.0;
      vec3 base = chrome > 0.5 ? vec3(0.12) : wet > 0.5 ? vec3(0.015) : vec3(0.045);
      col = base * (0.05 + dif * 0.7 * (1.0 + BASS * 0.6)) * a;
      float rw = chrome > 0.5 ? 0.95 : wet > 0.5 ? 0.12 + 0.6 * fre : 0.06 + 0.3 * fre;
      vec3 rc = (chrome > 0.5 || wet > 0.5) ? reflCol(p + n * 0.01, rf) : envc(rf);
      col += rc * rw * a;
      col += vec3(1.0) * spe * (0.2 + chrome * 0.8) * a;
      col += neon.rgb * ne * 0.25 * (1.0 + BASS) * (0.3 + 0.7 * max(dot(n, -rd), 0.0));
    }
    col = detail(col, p, n, m);
    col = mix(col, fogc, 1.0 - exp(-t * niebla * 0.04));
  }
  col += neon.rgb * glow * 0.35 * (0.5 + BASS * 1.2);
  col = 1.0 - exp(-col * 1.8);
  col = pow(col, vec3(0.75));   // contraste alto, negros profundos (aspecto de render)
  col *= 1.0 - 0.3 * dot(uv, uv);
  gl_FragColor = vec4(col, 1.0);
}`;

const NODETAIL = `vec3 detail(vec3 col, vec3 p, vec3 n, float m) { return col; }`;
const NOSKY = `vec3 sky(vec3 d) { return vec3(0.0); }`;
const FLOORGRID = `vec3 detail(vec3 col, vec3 p, vec3 n, float m) {
  if (m > 2.5 && m < 3.5) { vec2 g = abs(fract(p.xz * 0.5) - 0.5); col += neon.rgb * 0.08 * smoothstep(0.02, 0.0, min(g.x, g.y)); }
  return col;
}`;

const C = (name, label, rgb) => `{ "NAME": "${name}", "TYPE": "color", "DEFAULT": [${rgb.join(", ")}, 1.0], "LABEL": "${label}" }`;
const F = (name, label, def, min, max) => `{ "NAME": "${name}", "TYPE": "float", "DEFAULT": ${def.toFixed(3)}, "MIN": ${min.toFixed(3)}, "MAX": ${max.toFixed(3)}, "LABEL": "${label}" }`;
/** Un loop: controles comunes (duración, neón, acento, niebla, graves) + su escena. */
const loop = (desc, neon, acento, scene, { secs = 8, stepk = 0.8 } = {}) => `/*{
  "DESCRIPTION": "${desc}",
  "CREDIT": "LumaMap",
  "INPUTS": [ { "NAME": "audioFFT", "TYPE": "audioFFT", "LABEL": "Sonido" },
    ${F("loopSec", "Duración del bucle (s)", secs, 2, 32)},
    ${C("neon", "Neón", neon)},
    ${C("acento", "Acento", acento)},
    ${F("niebla", "Niebla", 1.0, 0.0, 3.0)},
    ${F("reaccion", "Reacción a los graves", 1.0, 0.0, 2.0)} ]
}*/
${HASH}
#define STEPK ${stepk.toFixed(2)}
${scene}
${SK}`;

/* ------------------------------------------------------------------ Las escenas */

const MONOLITH = loop("Monolito negro que gira sobre un suelo mojado, con una ranura de luz y un anillo de neón", [0.1, 0.8, 1.0], [1.0, 0.2, 0.5], `
vec2 map(vec3 p) {
  vec2 r = vec2(p.y + 1.0, 3.0);
  vec3 q = p - vec3(0.0, 0.55, 0.0);
  q.xz = rot(PH * TAU) * q.xz;
  float mono = sdBox(q, vec3(0.55, 1.55, 0.14)) - 0.01;
  mono = max(mono, -sdBox(q, vec3(0.03, 1.3, 0.2)));
  r = U(r, vec2(mono, 0.0));
  float core = sdBox(q, vec3(0.012, 1.28, 0.12));
  float ring = sdTorus(p + vec3(0.0, 0.98, 0.0), vec2(1.9 + 0.05 * sin(PH * TAU * 2.0), 0.015));
  g_e = min(core, ring);
  r = U(r, vec2(core, 2.0));
  r = U(r, vec2(ring, 4.0));
  return r;
}
void cam(out vec3 ro, out vec3 ta) { float a = sin(PH * TAU) * 0.5 + 0.3; ro = vec3(sin(a) * 7.0, 0.2 + 0.25 * sin(PH * TAU * 2.0), -cos(a) * 7.0); ta = vec3(0.0, 0.45, 0.0); }
${FLOORGRID}
${NOSKY}`);

const GYRO = loop("Giroscopio: tres anillos de cromo que giran sobre ejes distintos alrededor de un núcleo de luz", [1.0, 0.55, 0.15], [0.2, 0.6, 1.0], `
vec2 map(vec3 p) {
  vec2 r = vec2(p.y + 1.6, 3.0);
  float a = PH * TAU;
  vec3 q1 = p; q1.yz = rot(a) * q1.yz;
  vec3 q2 = q1; q2.xy = rot(a * 2.0) * q2.xy;
  vec3 q3 = q2; q3.xz = rot(-a) * q3.xz;
  float rings = min(sdTorus(q1, vec2(1.3, 0.07)), min(sdTorus(q2.xzy, vec2(1.0, 0.07)), sdTorus(q3, vec2(0.72, 0.06))));
  r = U(r, vec2(rings, 1.0));
  float core = length(p) - 0.28 * (1.0 + 0.1 * sin(a * 4.0));
  float floorRing = sdTorus(p + vec3(0.0, 1.58, 0.0), vec2(2.2, 0.02));
  g_e = min(core, floorRing);
  r = U(r, vec2(core, 2.0));
  r = U(r, vec2(floorRing, 4.0));
  return r;
}
void cam(out vec3 ro, out vec3 ta) { float a = PH * TAU; ro = vec3(sin(a) * 4.2, 0.8, -cos(a) * 4.2); ta = vec3(0.0, -0.1, 0.0); }
${NODETAIL}
${NOSKY}`);

const ARCHES = loop("Túnel de marcos de metal con tiras de neón que pasan hacia ti", [0.0, 0.9, 1.0], [1.0, 0.1, 0.6], `
#define SP 2.0
vec2 map(vec3 p) {
  vec2 r = vec2(p.y + 1.0, 3.0);
  vec3 q = p; q.z = mod(q.z, SP) - SP * 0.5;
  float frame = max(sdBox(q, vec3(1.6, 1.25, 0.18)), -sdBox(q, vec3(1.35, 1.0, 0.4)));
  r = U(r, vec2(frame, 0.0));
  float strip = max(sdBox(q, vec3(1.37, 1.02, 0.025)), -sdBox(q, vec3(1.33, 0.98, 0.2)));
  g_e = strip;
  r = U(r, vec2(strip, mod(floor(p.z / SP), 2.0) < 0.5 ? 2.0 : 4.0));
  return r;
}
void cam(out vec3 ro, out vec3 ta) { ro = vec3(0.25 * sin(PH * TAU), -0.1 + 0.1 * sin(PH * TAU * 2.0), PH * SP * 4.0); ta = ro + vec3(0.2 * sin(PH * TAU + 1.0), 0.0, 1.0); }
${FLOORGRID}
${NOSKY}`);

const CHROME = loop("Cromo líquido: gotas de metal que se funden y se separan, con chispas de luz alrededor", [0.6, 0.3, 1.0], [0.1, 1.0, 0.8], `
vec2 map(vec3 p) {
  vec2 r = vec2(p.y + 1.3, 3.0);
  float a = PH * TAU, d = 1e3;
  for (int i = 0; i < 5; i++) {
    float fi = float(i), k1 = 1.0 + mod(fi, 2.0), k2 = 2.0 - mod(fi, 2.0);
    vec3 c = vec3(sin(a * k1 + fi * 1.3) * 0.75, 0.15 + sin(a * k2 + fi * 2.1) * 0.45, cos(a * k1 + fi * 0.7) * 0.6);
    d = smin(d, length(p - c) - (0.38 + 0.08 * hash1(fi)), 0.35);
  }
  r = U(r, vec2(d, 1.0));
  float e = 1e3;
  for (int i = 0; i < 3; i++) {
    float fi = float(i), b = a * (fi + 1.0) + fi * 2.1;
    e = min(e, length(p - vec3(cos(b) * 1.6, 0.2 + 0.3 * sin(b * 2.0), sin(b) * 1.6)) - 0.05);
  }
  g_e = e;
  r = U(r, vec2(e, 2.0));
  return r;
}
void cam(out vec3 ro, out vec3 ta) { float a = sin(PH * TAU) * 0.8; ro = vec3(sin(a) * 4.0, 0.6, -cos(a) * 4.0); ta = vec3(0.0, 0.1, 0.0); }
${FLOORGRID}
${NOSKY}`);

const REACTOR = loop("Reactor: núcleo de energía dentro de una jaula de barras que gira", [0.2, 1.0, 0.4], [1.0, 0.9, 0.2], `
vec2 map(vec3 p) {
  vec2 r = vec2(p.y + 1.6, 3.0);
  vec3 q = p; q.xz = rot(PH * TAU * 0.25) * q.xz;
  float sec = TAU / 8.0, an = atan(q.z, q.x), rr = length(q.xz);
  float a2 = mod(an + sec * 0.5, sec) - sec * 0.5;
  vec3 qq = vec3(cos(a2) * rr, q.y, sin(a2) * rr);
  float bars = sdCap(qq, vec3(1.1, -1.2, 0.0), vec3(1.1, 1.2, 0.0), 0.06);
  r = U(r, vec2(bars, 1.0));
  float caps = min(sdTorus(p - vec3(0.0, 1.2, 0.0), vec2(1.1, 0.09)), sdTorus(p + vec3(0.0, 1.2, 0.0), vec2(1.1, 0.09)));
  caps = min(caps, sdBox(p + vec3(0.0, 1.45, 0.0), vec3(1.4, 0.15, 1.4)) - 0.03);
  r = U(r, vec2(caps, 0.0));
  float core = length(p) - 0.45 * (1.0 + 0.06 * sin(PH * TAU * 4.0));
  vec3 qr = p; qr.xy = rot(PH * TAU) * qr.xy;
  float ring = sdTorus(qr, vec2(0.8, 0.015));
  g_e = min(core, ring);
  r = U(r, vec2(core, 2.0));
  r = U(r, vec2(ring, 4.0));
  return r;
}
void cam(out vec3 ro, out vec3 ta) { float a = PH * TAU; ro = vec3(sin(a) * 4.5, 0.5, -cos(a) * 4.5); ta = vec3(0.0); }
${NODETAIL}
${NOSKY}`);

const CITY = loop("Ciudad de columnas: bloques que suben y bajan en ola con techos de neón, vista desde el aire", [0.1, 0.7, 1.0], [1.0, 0.3, 0.1], `
vec2 map(vec3 p) {
  vec2 r = vec2(p.y + 1.0, 3.0);
  vec2 id = floor(p.xz), f = fract(p.xz) - 0.5, k = mod(id, 8.0);
  float h = 0.3 + 1.1 * (0.5 + 0.5 * sin(k.x * TAU / 8.0 + k.y * TAU / 4.0 + PH * TAU)) * (0.5 + 0.5 * hash(k));
  float b = sdBox(vec3(f.x, p.y + 1.0 - h * 0.5, f.y), vec3(0.38, h * 0.5, 0.38)) - 0.02;
  r = U(r, vec2(b, 0.0));
  float cap = sdBox(vec3(f.x, p.y + 1.0 - h - 0.01, f.y), vec3(0.3, 0.012, 0.3));
  g_e = cap;
  r = U(r, vec2(cap, hash(k + 3.0) > 0.7 ? 4.0 : 2.0));
  r.x = min(r.x, 0.45);
  return r;
}
void cam(out vec3 ro, out vec3 ta) { ro = vec3(PH * 8.0, 1.6 + 0.2 * sin(PH * TAU), 0.5); ta = ro + vec3(1.0, -0.5, 0.6); }
${NODETAIL}
${NOSKY}`, { stepk: 0.6 });

const MENGER = loop("Cubo fractal (esponja de Menger) que gira con un núcleo de luz que se ve por los huecos", [1.0, 0.25, 0.1], [0.2, 0.7, 1.0], `
vec2 map(vec3 p) {
  vec2 r = vec2(p.y + 1.6, 3.0);
  vec3 q = p;
  q.xz = rot(PH * TAU * 0.25) * q.xz;
  q.xy = rot(PH * TAU * 0.25) * q.xy;
  float d = sdBox(q, vec3(1.0)), s = 1.0;
  for (int i = 0; i < 3; i++) {
    vec3 a = mod(q * s, 2.0) - 1.0;
    s *= 3.0;
    vec3 rr = abs(1.0 - 3.0 * abs(a));
    float c = (min(max(rr.x, rr.y), min(max(rr.y, rr.z), max(rr.z, rr.x))) - 1.0) / s;
    d = max(d, c);
  }
  r = U(r, vec2(d, 0.0));
  float core = length(p) - 0.3 - 0.05 * sin(PH * TAU * 4.0);
  g_e = core;
  r = U(r, vec2(core, 2.0));
  return r;
}
void cam(out vec3 ro, out vec3 ta) { float a = sin(PH * TAU) * 0.7 + 0.6; ro = vec3(sin(a) * 4.2, 1.3, -cos(a) * 4.2); ta = vec3(0.0); }
${FLOORGRID}
${NOSKY}`);

const CRYSTALS = loop("Cristales de luz que orbitan un obelisco de cromo", [0.3, 0.9, 1.0], [0.9, 0.3, 1.0], `
vec2 map(vec3 p) {
  vec2 r = vec2(p.y + 1.4, 3.0);
  vec3 q = p; q.xz = rot(0.785) * q.xz;
  float ob = max(sdBox(q, vec3(0.22, 1.5, 0.22)), dot(vec2(abs(q.x) + abs(q.z), q.y), vec2(0.7, 0.3)) - 0.55);
  ob = min(ob, sdBox(p + vec3(0.0, 1.3, 0.0), vec3(0.6, 0.1, 0.6)));
  r = U(r, vec2(ob, 1.0));
  float slit = sdBox(q, vec3(0.23, 1.2, 0.012));
  float e = slit, cr = 1e3;
  for (int i = 0; i < 6; i++) {
    float fi = float(i), an = PH * TAU + fi * TAU / 6.0;
    vec3 c = p - vec3(cos(an) * 1.7, 0.2 + 0.35 * sin(PH * TAU * 2.0 + fi), sin(an) * 1.7);
    c.xz = rot(PH * TAU * 2.0 + fi) * c.xz;
    cr = min(cr, sdOcta(vec3(c.x, c.y * 0.55, c.z), 0.26) * 0.55);
  }
  g_e = min(e, cr);
  r = U(r, vec2(slit, 2.0));
  r = U(r, vec2(cr, 4.0));
  return r;
}
void cam(out vec3 ro, out vec3 ta) { float a = sin(PH * TAU) * 0.6; ro = vec3(sin(a) * 4.6, 0.7 + 0.2 * sin(PH * TAU * 2.0), -cos(a) * 4.6); ta = vec3(0.0, 0.1, 0.0); }
${FLOORGRID}
${NOSKY}`);

const LASERS = loop("Catedral de láseres: pasillo de columnas con rayos que cruzan entre la niebla", [1.0, 0.1, 0.25], [0.1, 1.0, 0.4], `
#define SP 3.0
vec2 map(vec3 p) {
  vec2 r = vec2(p.y + 1.2, 3.0);
  float id = mod(floor(p.z / SP), 4.0);
  vec3 q = p; q.z = mod(q.z, SP) - SP * 0.5;
  float pil = sdBox(vec3(abs(p.x) - 2.4, p.y - 1.0, q.z), vec3(0.3, 2.2, 0.3)) - 0.02;
  r = U(r, vec2(pil, 0.0));
  float e1 = 1e3, e2 = 1e3;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float y1 = 0.2 + 1.2 * (0.5 + 0.5 * sin(PH * TAU * (1.0 + fi) + id * 1.7 + fi));
    float y2 = 0.2 + 1.2 * (0.5 + 0.5 * cos(PH * TAU * (1.0 + fi) + id * 2.3 + fi * 2.0));
    float l = sdCap(q, vec3(-2.1, y1 - 1.0, 0.0), vec3(2.1, y2 - 1.0, 0.0), 0.012);
    if (mod(fi + id, 2.0) < 0.5) e1 = min(e1, l); else e2 = min(e2, l);
  }
  g_e = min(e1, e2);
  r = U(r, vec2(e1, 2.0));
  r = U(r, vec2(e2, 4.0));
  return r;
}
void cam(out vec3 ro, out vec3 ta) { ro = vec3(0.3 * sin(PH * TAU), 0.1, PH * SP * 4.0); ta = ro + vec3(0.0, 0.1, 1.0); }
${FLOORGRID}
${NOSKY}`);

const TWIST = loop("Toro retorcido de metal con aristas de neón que giran a lo largo del anillo", [1.0, 0.0, 0.6], [0.0, 0.8, 1.0], `
vec2 map(vec3 p) {
  vec2 r = vec2(p.y + 1.8, 3.0);
  vec3 q = p; q.yz = rot(0.45) * q.yz;
  float phi = atan(q.z, q.x);
  vec2 cs = vec2(length(q.xz) - 1.4, q.y);
  cs = rot(phi * 1.5 + PH * TAU * 0.25) * cs;
  float d = (sdBox2(cs, vec2(0.3)) - 0.02) * 0.7;
  r = U(r, vec2(d, 0.0));
  vec2 c = vec2(0.33, 0.33);
  float e = (min(length(cs - c), length(cs + c)) - 0.035) * 0.7;
  g_e = e;
  r = U(r, vec2(e, 2.0));
  return r;
}
void cam(out vec3 ro, out vec3 ta) { float a = sin(PH * TAU) * 0.4; ro = vec3(sin(a) * 4.0, 0.9, -cos(a) * 4.0); ta = vec3(0.0, -0.1, 0.0); }
${FLOORGRID}
${NOSKY}`);

const PORTAL = loop("Portal: un anillo de cromo con un remolino de energía, columnas rotas y rocas flotando", [0.4, 0.2, 1.0], [0.0, 1.0, 0.9], `
vec2 map(vec3 p) {
  vec2 r = vec2(p.y + 1.4, 3.0);
  vec3 q = p - vec3(0.0, 0.4, 0.0);
  r = U(r, vec2(sdTorus(q.xzy, vec2(1.5, 0.16)), 1.0));
  float disk = max(abs(q.z) - 0.01, length(q.xy) - 1.35);
  g_e = disk;
  r = U(r, vec2(disk, 5.0));
  float pil = min(sdBox(p - vec3(-2.6, -0.6, 0.6), vec3(0.3, 0.8, 0.3)), sdBox(p - vec3(2.7, -0.9, 0.9), vec3(0.3, 0.5, 0.3)));
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    vec3 c = p - vec3(-2.0 + fi * 1.35, 1.5 + 0.2 * sin(PH * TAU + fi * 1.6), 1.2 - mod(fi, 2.0));
    c.xz = rot(PH * TAU + fi) * c.xz;
    pil = min(pil, sdOcta(c, 0.18 + 0.05 * fi));
  }
  r = U(r, vec2(pil - 0.01, 0.0));
  return r;
}
void cam(out vec3 ro, out vec3 ta) { ro = vec3(sin(PH * TAU) * 1.2, 0.3, -5.0 + 0.6 * sin(PH * TAU * 2.0)); ta = vec3(0.0, 0.3, 0.0); }
vec3 detail(vec3 col, vec3 p, vec3 n, float m) {
  if (m > 4.5) {
    vec2 d2 = (p - vec3(0.0, 0.4, 0.0)).xy;
    float rr = length(d2), an = atan(d2.y, d2.x);
    float sw = sin(an * 3.0 + log(rr + 0.01) * 6.0 - PH * TAU * 2.0);
    return mix(neon.rgb, acento.rgb, 0.5 + 0.5 * sw) * (1.2 + 1.8 * smoothstep(1.35, 0.0, rr)) * (1.0 + BASS * 2.0);
  }
  if (m > 2.5 && m < 3.5) { vec2 g = abs(fract(p.xz * 0.5) - 0.5); col += neon.rgb * 0.08 * smoothstep(0.02, 0.0, min(g.x, g.y)); }
  return col;
}
${NOSKY}`);

const TERRAIN = loop("Vuelo sobre montañas de alambre de neón hacia un sol en el horizonte", [1.0, 0.15, 0.7], [1.0, 0.7, 0.1], `
#define LZ 12.0
float terr(vec2 xz) {
  float k = TAU / LZ;
  return -1.2 + 0.55 * sin(xz.x * 0.9) * sin(xz.y * k * 2.0) + 0.3 * sin(xz.x * 1.7 + 1.0) * sin(xz.y * k * 5.0 + 2.0)
    + 0.15 * sin(xz.x * 3.1) * sin(xz.y * k * 9.0) + 0.08 * xz.x * xz.x;
}
vec2 map(vec3 p) { g_e = 1e3; return vec2((p.y - terr(p.xz)) * 0.55, 0.0); }
void cam(out vec3 ro, out vec3 ta) { ro = vec3(0.0, 0.35, PH * LZ); ta = ro + vec3(0.0, -0.22, 1.0); }
vec3 detail(vec3 col, vec3 p, vec3 n, float m) {
  vec2 g = abs(fract(p.xz) - 0.5);
  float ln = smoothstep(0.045, 0.0, 0.5 - max(g.x, g.y));
  return col * 0.4 + neon.rgb * ln * (1.2 + BASS * 2.0);
}
vec3 sky(vec3 d) {
  float s = length(vec2(d.x, d.y - 0.12));
  float stripes = d.y < 0.12 ? step(fract(d.y * 40.0), 0.6) : 1.0;
  return acento.rgb * smoothstep(0.2, 0.19, s) * stripes * 1.5 + neon.rgb * exp(-abs(d.y) * 8.0) * 0.25;
}`, { stepk: 0.5 });

export const LOOPS3D = [{
  "lumamap-plugin": 1, id: "loops-3d-techno", name: "Loops 3D techno", version: "1.0", author: "LumaMap",
  description: "Escenas 3D de techno que se repiten sin corte (duración ajustable): monolito, giroscopio, túnel de marcos, cromo líquido, reactor, ciudad de columnas, cubo fractal, cristales, catedral de láseres, toro retorcido, portal y montañas de neón.",
  shaders: [
    { name: "Monolito", isf: MONOLITH }, { name: "Giroscopio", isf: GYRO }, { name: "Túnel de marcos", isf: ARCHES },
    { name: "Cromo líquido", isf: CHROME }, { name: "Reactor", isf: REACTOR }, { name: "Ciudad de columnas", isf: CITY },
    { name: "Cubo fractal", isf: MENGER }, { name: "Cristales y obelisco", isf: CRYSTALS }, { name: "Catedral de láseres", isf: LASERS },
    { name: "Toro retorcido", isf: TWIST }, { name: "Portal", isf: PORTAL }, { name: "Montañas de neón", isf: TERRAIN },
  ],
}];
