// web/js/plugins-bundled.js
// Plugins que vienen con LumaMap (se pueden apagar en Menú → Plugins). Son datos, como los
// que instala el usuario: sirven también de ejemplo del formato (ver plugins.js).
import { VIRAL } from "./plugins-viral.js";
import { PRO } from "./plugins-pro.js";
import { LOOPS3D } from "./plugins-loops3d.js";
import { TOONS } from "./plugins-toons.js";

const TUNNEL = `/*{
  "DESCRIPTION": "Túnel de anillos de luz que avanza hacia ti",
  "CREDIT": "LumaMap",
  "CATEGORIES": ["Generator"],
  "INPUTS": [
    { "NAME": "speed", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 4.0, "LABEL": "Velocidad" },
    { "NAME": "rings", "TYPE": "float", "DEFAULT": 8.0, "MIN": 2.0, "MAX": 24.0, "LABEL": "Anillos" },
    { "NAME": "colorA", "TYPE": "color", "DEFAULT": [0.0, 0.9, 1.0, 1.0], "LABEL": "Color 1" },
    { "NAME": "colorB", "TYPE": "color", "DEFAULT": [1.0, 0.15, 0.65, 1.0], "LABEL": "Color 2" }
  ]
}*/
void main() {
  float a = RENDERSIZE.x / RENDERSIZE.y;
  vec2 p = vec2((isf_FragNormCoord.x - 0.5) * a, isf_FragNormCoord.y - 0.5);
  float r = length(p) + 0.0001;
  float z = 0.25 / r + TIME * speed;
  float ring = pow(abs(sin(z * rings * 0.5)), 12.0);
  float ang = atan(p.y, p.x);
  float spokes = 0.5 + 0.5 * sin(ang * 6.0 + z * 2.0);
  vec3 col = mix(colorA.rgb, colorB.rgb, 0.5 + 0.5 * sin(z * 0.7)) * (ring * 1.4 + spokes * 0.12);
  col *= smoothstep(0.0, 0.25, r) * (1.0 - smoothstep(0.75, 1.1, r) * 0.5);
  gl_FragColor = vec4(col, 1.0);
}`;

const PETALS = `/*{
  "DESCRIPTION": "Flor de pétalos de luz que gira y respira",
  "CREDIT": "LumaMap",
  "CATEGORIES": ["Generator"],
  "INPUTS": [
    { "NAME": "petals", "TYPE": "long", "DEFAULT": 6, "VALUES": [3, 4, 5, 6, 8, 12], "LABELS": ["3", "4", "5", "6", "8", "12"], "LABEL": "Pétalos" },
    { "NAME": "speed", "TYPE": "float", "DEFAULT": 1.0, "MIN": -3.0, "MAX": 3.0, "LABEL": "Giro" },
    { "NAME": "glow", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0.0, "MAX": 1.0, "LABEL": "Brillo" },
    { "NAME": "rainbow", "TYPE": "bool", "DEFAULT": true, "LABEL": "Arcoíris" },
    { "NAME": "tint", "TYPE": "color", "DEFAULT": [1.0, 0.4, 0.8, 1.0], "LABEL": "Color" }
  ]
}*/
void main() {
  float a = RENDERSIZE.x / RENDERSIZE.y;
  vec2 p = vec2((isf_FragNormCoord.x - 0.5) * a, isf_FragNormCoord.y - 0.5) * 2.2;
  float r = length(p), th = atan(p.y, p.x) + TIME * speed * 0.4;
  float k = float(petals);
  float breathe = 0.75 + 0.15 * sin(TIME * 1.7);
  float rose = abs(cos(th * k * 0.5)) * breathe;
  float d = abs(r - rose);
  float line = smoothstep(0.06, 0.0, d) + glow * 0.35 * exp(-d * 8.0);
  float inner = smoothstep(rose, 0.0, r) * 0.25;
  vec3 c = rainbow ? 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + th / 6.2831 + TIME * 0.05)) : tint.rgb;
  gl_FragColor = vec4(c * (line + inner), 1.0);
}`;

const DOTS = `/*{
  "DESCRIPTION": "Rejilla de puntos de luz que respira en ondas",
  "CREDIT": "LumaMap",
  "CATEGORIES": ["Generator"],
  "INPUTS": [
    { "NAME": "cells", "TYPE": "float", "DEFAULT": 18.0, "MIN": 6.0, "MAX": 60.0, "LABEL": "Puntos" },
    { "NAME": "speed", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 4.0, "LABEL": "Velocidad" },
    { "NAME": "center", "TYPE": "point2D", "DEFAULT": [0.5, 0.5], "MIN": [0.0, 0.0], "MAX": [1.0, 1.0], "LABEL": "Centro de la onda" },
    { "NAME": "colorA", "TYPE": "color", "DEFAULT": [1.0, 0.85, 0.2, 1.0], "LABEL": "Color 1" },
    { "NAME": "colorB", "TYPE": "color", "DEFAULT": [0.1, 0.4, 1.0, 1.0], "LABEL": "Color 2" }
  ]
}*/
void main() {
  float a = RENDERSIZE.x / RENDERSIZE.y;
  vec2 uv = isf_FragNormCoord;
  vec2 g = vec2(uv.x * a, uv.y) * cells;
  vec2 id = floor(g), f = fract(g) - 0.5;
  vec2 cc = (id + 0.5) / cells; cc.x /= a;
  float w = sin(length((cc - center) * vec2(a, 1.0)) * 14.0 - TIME * speed * 3.0);
  float rad = 0.12 + 0.3 * (0.5 + 0.5 * w);
  float dotv = smoothstep(rad, rad - 0.08, length(f));
  vec3 col = mix(colorB.rgb, colorA.rgb, 0.5 + 0.5 * w) * dotv;
  gl_FragColor = vec4(col, 1.0);
}`;

const CAUSTICS = `/*{
  "DESCRIPTION": "Luz de piscina (cáusticas) que ondula sobre la pared",
  "CREDIT": "LumaMap",
  "CATEGORIES": ["Generator"],
  "INPUTS": [
    { "NAME": "speed", "TYPE": "float", "DEFAULT": 0.8, "MIN": 0.0, "MAX": 3.0, "LABEL": "Velocidad" },
    { "NAME": "scale", "TYPE": "float", "DEFAULT": 4.0, "MIN": 1.0, "MAX": 12.0, "LABEL": "Tamaño" },
    { "NAME": "water", "TYPE": "color", "DEFAULT": [0.0, 0.25, 0.45, 1.0], "LABEL": "Agua" },
    { "NAME": "light", "TYPE": "color", "DEFAULT": [0.6, 1.0, 1.0, 1.0], "LABEL": "Luz" }
  ]
}*/
void main() {
  float a = RENDERSIZE.x / RENDERSIZE.y;
  vec2 p = mod(vec2(isf_FragNormCoord.x * a, isf_FragNormCoord.y) * 6.2831 * scale * 0.25, 6.2831) - 250.0;
  float t = TIME * speed + 23.0;
  vec2 i = p;
  float c = 1.0;
  for (int n = 0; n < 5; n++) {
    float tn = t * (1.0 - 3.5 / float(n + 1));
    i = p + vec2(cos(tn - i.x) + sin(tn + i.y), sin(tn - i.y) + cos(tn + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tn) / 0.005), p.y / (cos(i.y + tn) / 0.005)));
  }
  c /= 5.0;
  c = 1.17 - pow(c, 1.4);
  float v = pow(abs(c), 8.0);
  gl_FragColor = vec4(clamp(water.rgb + light.rgb * v, 0.0, 1.0), 1.0);
}`;


// ---- Cámara reactiva al audio (como los montajes de TouchDesigner para conciertos) ----
const BAND = `float band(float a, float b) { float s = 0.0; for (int i = 0; i < 8; i++) { s += IMG_NORM_PIXEL(audioFFT, vec2(mix(a, b, (float(i) + 0.5) / 8.0), 0.5)).r; } return s / 8.0; }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`;

const CAM_EXPLODE = `/*{
  "DESCRIPTION": "La cámara explota hacia fuera con los graves y deja estelas de luz (feedback)",
  "CREDIT": "LumaMap",
  "CATEGORIES": ["Camera", "Audio Reactive"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image", "LABEL": "Cámara" },
    { "NAME": "audioFFT", "TYPE": "audioFFT", "LABEL": "Sonido" },
    { "NAME": "explode", "TYPE": "float", "DEFAULT": 0.8, "MIN": 0.0, "MAX": 2.0, "LABEL": "Explosión con los graves" },
    { "NAME": "trails", "TYPE": "float", "DEFAULT": 0.86, "MIN": 0.0, "MAX": 0.97, "LABEL": "Estelas" },
    { "NAME": "turbulence", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0.0, "MAX": 2.0, "LABEL": "Turbulencia con los medios" },
    { "NAME": "edges", "TYPE": "float", "DEFAULT": 0.8, "MIN": 0.0, "MAX": 2.0, "LABEL": "Bordes con los agudos" },
    { "NAME": "tint", "TYPE": "color", "DEFAULT": [1.0, 0.22, 0.08, 1.0], "LABEL": "Color" },
    { "NAME": "center", "TYPE": "point2D", "DEFAULT": [0.5, 0.55], "LABEL": "Centro de la explosión" }
  ],
  "PASSES": [ { "TARGET": "fb", "PERSISTENT": true }, {} ]
}*/
${BAND}
void main() {
  vec2 uv = isf_FragNormCoord;
  float bass = band(0.0, 0.08), mid = band(0.08, 0.35), high = band(0.35, 0.9);
  if (PASSINDEX == 0) {
    vec2 d = uv - center;
    vec2 n = vec2(sin(uv.y * 40.0 + TIME * 6.0), cos(uv.x * 35.0 - TIME * 5.0)) * 0.012 * mid * turbulence;
    float k = 0.04 + explode * bass * 0.45;
    vec3 acc = vec3(0.0), streak = vec3(0.0); float w = 0.0;
    for (int i = 0; i < 20; i++) {
      float t = float(i) / 19.0;
      float wi = 1.0 - t * 0.75;
      vec3 sp = IMG_NORM_PIXEL(inputImage, center + d * (1.0 - k * t) + n).rgb;
      acc += sp * wi; w += wi;
      // Rayos de luz: solo lo brillante se estira mucho más hacia fuera.
      vec3 far = IMG_NORM_PIXEL(inputImage, center + d * (1.0 - k * 2.5 * t)).rgb;
      streak += max(far - 0.45, 0.0) * (1.0 - t);
    }
    vec3 cam = acc / w;
    float lum = dot(cam, vec3(0.299, 0.587, 0.114));
    vec3 graded = mix(vec3(lum) * tint.rgb * 1.7, cam, 0.3) + streak / 20.0 * (1.0 + bass * 4.0) * mix(tint.rgb, vec3(1.0), 0.5) * 2.5;
    vec3 prev = IMG_NORM_PIXEL(fb, center + (uv - center) * (0.982 - bass * 0.04)).rgb;
    gl_FragColor = vec4(max(graded, prev * trails), 1.0);
  } else {
    vec2 px = 1.0 / RENDERSIZE;
    vec3 col = IMG_NORM_PIXEL(fb, uv).rgb;
    float e = length(IMG_NORM_PIXEL(fb, uv + vec2(px.x, 0.0)).rgb - IMG_NORM_PIXEL(fb, uv - vec2(px.x, 0.0)).rgb)
            + length(IMG_NORM_PIXEL(fb, uv + vec2(0.0, px.y)).rgb - IMG_NORM_PIXEL(fb, uv - vec2(0.0, px.y)).rgb);
    col += e * high * edges * 3.0 * vec3(1.0, 0.92, 0.85);
    col *= 1.0 + bass * 0.7;
    gl_FragColor = vec4(col, 1.0);
  }
}`;

const CAM_POINTS = `/*{
  "DESCRIPTION": "La cámara convertida en miles de puntos de luz que saltan hacia ti con los graves",
  "CREDIT": "LumaMap",
  "CATEGORIES": ["Camera", "Audio Reactive"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image", "LABEL": "Cámara" },
    { "NAME": "audioFFT", "TYPE": "audioFFT", "LABEL": "Sonido" },
    { "NAME": "density", "TYPE": "float", "DEFAULT": 70.0, "MIN": 30.0, "MAX": 220.0, "LABEL": "Cantidad de puntos" },
    { "NAME": "dotSize", "TYPE": "float", "DEFAULT": 1.3, "MIN": 0.2, "MAX": 1.6, "LABEL": "Tamaño" },
    { "NAME": "depth", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 3.0, "LABEL": "Salto 3D con los graves" },
    { "NAME": "jitter", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0.0, "MAX": 2.0, "LABEL": "Vibración con los medios" },
    { "NAME": "tint", "TYPE": "color", "DEFAULT": [1.0, 0.3, 0.15, 1.0], "LABEL": "Color" },
    { "NAME": "original", "TYPE": "bool", "DEFAULT": false, "LABEL": "Colores de la cámara" }
  ]
}*/
${BAND}
void main() {
  float a = RENDERSIZE.x / RENDERSIZE.y;
  vec2 uv = isf_FragNormCoord, c = vec2(0.5);
  float bass = band(0.0, 0.08), mid = band(0.08, 0.35), high = band(0.35, 0.9);
  vec3 outc = vec3(0.0);
  // Dos capas de puntos: la de delante salta más (profundidad).
  for (int layer = 0; layer < 2; layer++) {
    float z = float(layer);
    float push = 1.0 + bass * depth * (0.25 + z * 0.35);
    vec2 uv0 = c + (uv - c) / push;
    vec2 g = vec2(uv0.x * a, uv0.y) * density * (1.0 + z * 0.5);
    vec2 cell = floor(g), f = fract(g) - 0.5;
    f += (vec2(hash(cell + z), hash(cell + 7.1 + z)) - 0.5) * mid * jitter * 0.6;
    vec2 cc = (cell + 0.5) / (density * (1.0 + z * 0.5)); cc.x /= a;
    vec3 cam = IMG_NORM_PIXEL(inputImage, cc).rgb;
    float lum = dot(cam, vec3(0.299, 0.587, 0.114));
    float r = dotSize * 0.5 * (0.15 + lum) * (1.0 - z * 0.3);
    float dotv = smoothstep(r, r * 0.4, length(f));
    vec3 col = original ? cam * 1.4 : tint.rgb * (0.5 + lum * 2.0);
    outc += col * dotv * (1.2 + high * 1.8) * (z > 0.5 ? 0.7 : 1.0);
  }
  gl_FragColor = vec4(outc, 1.0);
}`;

const CAM_LINES = `/*{
  "DESCRIPTION": "Líneas horizontales que se levantan con la forma de la cámara (relieve), más con los graves",
  "CREDIT": "LumaMap",
  "CATEGORIES": ["Camera", "Audio Reactive"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image", "LABEL": "Cámara" },
    { "NAME": "audioFFT", "TYPE": "audioFFT", "LABEL": "Sonido" },
    { "NAME": "lines", "TYPE": "float", "DEFAULT": 70.0, "MIN": 20.0, "MAX": 160.0, "LABEL": "Líneas" },
    { "NAME": "lift", "TYPE": "float", "DEFAULT": 0.05, "MIN": 0.0, "MAX": 0.2, "LABEL": "Relieve" },
    { "NAME": "boost", "TYPE": "float", "DEFAULT": 1.5, "MIN": 0.0, "MAX": 4.0, "LABEL": "Relieve con los graves" },
    { "NAME": "tint", "TYPE": "color", "DEFAULT": [1.0, 0.25, 0.1, 1.0], "LABEL": "Color" }
  ]
}*/
${BAND}
void main() {
  vec2 uv = isf_FragNormCoord;
  float bass = band(0.0, 0.08), high = band(0.35, 0.9);
  float h = lift * (1.0 + bass * boost);
  float row = floor(uv.y * lines);
  float v = 0.0; vec3 col = vec3(0.0);
  // Cada línea se dibuja subida según la luz de la cámara en su sitio; se miran las de debajo.
  for (int k = 0; k < 10; k++) {
    float r = row - float(k);
    float y0 = (r + 0.5) / lines;
    vec3 cam = IMG_NORM_PIXEL(inputImage, vec2(uv.x, y0)).rgb;
    float lum = dot(cam, vec3(0.299, 0.587, 0.114));
    float y = y0 + lum * h;
    float thick = 0.0012 + high * 0.0015;
    float lineV = smoothstep(thick * 1.8, thick * 0.4, abs(uv.y - y));
    if (lineV > v) { v = lineV; col = mix(tint.rgb, vec3(1.0), lum * 0.6) * (0.4 + lum); }
  }
  gl_FragColor = vec4(col * v * 1.6, 1.0);
}`;

const CAM_EDGES = `/*{
  "DESCRIPTION": "Contornos de neón de la cámara que dejan rastro y cambian de color con la música",
  "CREDIT": "LumaMap",
  "CATEGORIES": ["Camera", "Audio Reactive"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image", "LABEL": "Cámara" },
    { "NAME": "audioFFT", "TYPE": "audioFFT", "LABEL": "Sonido" },
    { "NAME": "decay", "TYPE": "float", "DEFAULT": 0.9, "MIN": 0.5, "MAX": 0.98, "LABEL": "Rastro" },
    { "NAME": "spin", "TYPE": "float", "DEFAULT": 0.004, "MIN": -0.03, "MAX": 0.03, "LABEL": "Giro del rastro" },
    { "NAME": "gain", "TYPE": "float", "DEFAULT": 2.0, "MIN": 0.5, "MAX": 5.0, "LABEL": "Fuerza de los bordes" }
  ],
  "PASSES": [ { "TARGET": "trail", "PERSISTENT": true }, {} ]
}*/
${BAND}
vec3 pal(float t) { return 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + t)); }
void main() {
  vec2 uv = isf_FragNormCoord;
  float bass = band(0.0, 0.08), mid = band(0.08, 0.35), high = band(0.35, 0.9);
  if (PASSINDEX == 0) {
    vec2 px = 1.5 / RENDERSIZE;
    float l = dot(IMG_NORM_PIXEL(inputImage, uv - vec2(px.x, 0.0)).rgb, vec3(0.33)), r = dot(IMG_NORM_PIXEL(inputImage, uv + vec2(px.x, 0.0)).rgb, vec3(0.33));
    float d = dot(IMG_NORM_PIXEL(inputImage, uv - vec2(0.0, px.y)).rgb, vec3(0.33)), u = dot(IMG_NORM_PIXEL(inputImage, uv + vec2(0.0, px.y)).rgb, vec3(0.33));
    float e = clamp(length(vec2(r - l, u - d)) * gain * (1.0 + high * 2.0), 0.0, 1.0);
    vec3 edge = pal(TIME * 0.05 + mid * 0.5 + uv.y * 0.3) * e;
    vec2 c = uv - 0.5;
    float ang = spin * (1.0 + bass * 2.0);
    vec2 q = 0.5 + mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * c * (0.99 - bass * 0.02);
    vec3 prev = IMG_NORM_PIXEL(trail, q).rgb * decay;
    gl_FragColor = vec4(max(edge, prev), 1.0);
  } else {
    gl_FragColor = vec4(IMG_NORM_PIXEL(trail, isf_FragNormCoord).rgb * (1.0 + bass * 0.5), 1.0);
  }
}`;

export const BUNDLED = [
  {
    "lumamap-plugin": 1, id: "fiesta-neon", name: "Fiesta y neón", version: "1.0", author: "LumaMap",
    description: "Efectos y animaciones para fiestas, discotecas y conciertos.",
    effects: [
      { name: "Neón rosa", fx: { saturation: 1.8, contrast: 1.2, duotone: 1, duoA: "#1a0030", duoB: "#ff2d95", border: 0.02, borderAnim: "pulse", borderGlow: 1 } },
      { name: "Club láser", fx: { rgbShift: 0.01, contrast: 1.4, scanlines: 0.5, saturation: 1.4 } },
      { name: "VHS de fiesta", fx: { noise: 0.15, rgbShift: 0.006, scanlines: 0.6, saturation: 1.3, vignette: 0.4 } },
      { name: "Cómic", fx: { posterize: 5, edges: 0.6, saturation: 1.4, contrast: 1.2 } },
      { name: "Latido", fx: { zoom: 1.04, shake: 0.6, saturation: 1.3 } },
      { name: "Espejo de discoteca", fx: { kaleido: 6, hueCycle: 0.8, saturation: 1.5 } },
    ],
    animations: [
      { name: "Discoteca arcoíris", gen: "discoball", color: "#ffffff", color2: "#ff2d95", speed: 1.2, scale: 1, fx: { hueCycle: 0.6 } },
      { name: "Láser verde", gen: "crosslasers", color: "#39ff14", color2: "#001a00", speed: 1.3, scale: 1 },
      { name: "Fuego azul", gen: "fire", color: "#00e5ff", color2: "#0022aa", speed: 1, scale: 1 },
      { name: "Ondas neón rosa", gen: "neonwaves", color: "#ff2d95", color2: "#7a00ff", speed: 1, scale: 1 },
      { name: "Escenario de rock", gen: "rays", color: "#ffcc00", color2: "#ff2d00", speed: 1.4, scale: 1, fx: { contrast: 1.3 } },
    ],
  },
  {
    "lumamap-plugin": 1, id: "fechas", name: "Fechas especiales", version: "1.0", author: "LumaMap",
    description: "Navidad, Halloween, San Valentín, Año Nuevo y fiestas patrias.",
    animations: [
      { name: "Navidad: nieve", gen: "snow", color: "#ffffff", color2: "#0a3d1a", speed: 0.8, scale: 1 },
      { name: "Navidad: estrellas", gen: "stars", color: "#ffd700", color2: "#b30000", speed: 1, scale: 1 },
      { name: "Halloween: calabaza", gen: "fire", color: "#ff7a00", color2: "#3d0066", speed: 0.9, scale: 1.2 },
      { name: "Halloween: niebla", gen: "smoke", color: "#7a00ff", color2: "#0a0010", speed: 0.6, scale: 1 },
      { name: "San Valentín", gen: "hearts", color: "#ff2d55", color2: "#ff9ec4", speed: 1, scale: 1 },
      { name: "Año Nuevo", gen: "fireworks", color: "#ffd700", color2: "#00e5ff", speed: 1, scale: 1 },
      { name: "Fiestas patrias", gen: "stripes", color: "#ffd100", color2: "#ce1126", speed: 0.5, scale: 1 },
      { name: "Confeti de cumpleaños", gen: "confetti", color: "#ff2d95", color2: "#00e5ff", speed: 1, scale: 1 },
    ],
    effects: [
      { name: "Navidad", fx: { duotone: 0.5, duoA: "#003311", duoB: "#ff3333", border: 0.015, borderColor: "#ffd700", borderAnim: "chase", borderGlow: 0.8 } },
      { name: "Halloween", fx: { duotone: 0.7, duoA: "#14001f", duoB: "#ff7a00", vignette: 0.7, noise: 0.06 } },
    ],
  },
  {
    "lumamap-plugin": 1, id: "isf-clasicos", name: "Shaders ISF", version: "1.0", author: "LumaMap",
    description: "Shaders en formato ISF (el de Resolume, VDMX o Millumin), con sus controles. Puedes instalar más archivos .fs.",
    shaders: [
      { name: "Túnel de luces", isf: TUNNEL },
      { name: "Pétalos de luz", isf: PETALS },
      { name: "Rejilla que respira", isf: DOTS },
      { name: "Cáusticas de piscina", isf: CAUSTICS },
    ],
  },
  {
    "lumamap-plugin": 1, id: "camara-reactiva", name: "Cámara reactiva al audio", version: "1.0", author: "LumaMap",
    description: "Como los montajes de TouchDesigner para conciertos: la cámara en vivo explota con los graves, se vuelve partículas, relieve de líneas o contornos de neón con rastro. Graves = explosión/profundidad, medios = turbulencia, agudos = brillo de bordes.",
    shaders: [
      { name: "Explosión de cámara", isf: CAM_EXPLODE },
      { name: "Partículas de cámara", isf: CAM_POINTS },
      { name: "Relieve de líneas", isf: CAM_LINES },
      { name: "Contornos de neón con rastro", isf: CAM_EDGES },
    ],
  },
  ...VIRAL,
  ...PRO,
  ...LOOPS3D,
  ...TOONS,
];
