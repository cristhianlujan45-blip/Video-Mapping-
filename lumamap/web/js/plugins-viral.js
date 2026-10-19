// web/js/plugins-viral.js
// Biblioteca «Virales Pro»: shaders ISF propios (escritos para LumaMap) inspirados en los
// efectos que más se ven en redes y en los shows de VJ: ventanas de Windows 98, datamosh,
// pixel sort, «Time Warp Scan», ecos, cortes desplazados, pared de video, espejo infinito,
// caleidoscopio, glitch de bloques, puzzle deslizante, HUD de glifos, pop art, CRT/VHS
// analógico (con perillas, estilo Glaze) y visuales de club que siguen el sonido.
// Son datos (texto ISF) como cualquier plugin: se validan y corren aislados en la GPU.

const HASH = `float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hash1(float n) { return fract(sin(n) * 43758.5453); }
float lumi(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }`;
const BAND = `float band(float a, float b) { float s = 0.0; for (int i = 0; i < 8; i++) { s += IMG_NORM_PIXEL(audioFFT, vec2(mix(a, b, (float(i) + 0.5) / 8.0), 0.5)).r; } return s / 8.0; }`;
const CAM = `{ "NAME": "inputImage", "TYPE": "image", "LABEL": "Cámara o video" }`;
const AUD = `{ "NAME": "audioFFT", "TYPE": "audioFFT", "LABEL": "Sonido" }`;
const head = (desc, inputs, extra = "") => `/*{
  "DESCRIPTION": "${desc}",
  "CREDIT": "LumaMap",
  "INPUTS": [ ${inputs.join(",\n    ")} ]${extra}
}*/
${HASH}
`;

/* ======================= Cámara / video ======================= */

const WIN98 = head("Tu cámara dentro de ventanas de Windows 98 (Paint) que se abren, se apilan y saltan con el ritmo", [CAM, AUD,
  `{ "NAME": "count", "TYPE": "float", "DEFAULT": 6.0, "MIN": 1.0, "MAX": 10.0, "LABEL": "Ventanas" }`,
  `{ "NAME": "rate", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 4.0, "LABEL": "Cambios por segundo" }`,
  `{ "NAME": "beatJump", "TYPE": "bool", "DEFAULT": true, "LABEL": "Saltan con los graves" }`,
  `{ "NAME": "bgStyle", "TYPE": "long", "DEFAULT": 1, "VALUES": [0, 1, 2], "LABELS": ["Escritorio azul", "Cámara de colores", "Negro"], "LABEL": "Fondo" }`]) + BAND + `
vec3 paintPost(vec3 c) { float l = lumi(c); return l > 0.66 ? vec3(1.0) : l > 0.45 ? vec3(0.78, 0.6, 1.0) : l > 0.25 ? vec3(0.5, 0.25, 0.9) : vec3(0.12, 0.05, 0.35); }
vec3 swatch(float i) {
  float k = mod(i, 14.0);
  if (k < 1.0) return vec3(0.0); if (k < 2.0) return vec3(0.5); if (k < 3.0) return vec3(0.5, 0.0, 0.0); if (k < 4.0) return vec3(0.5, 0.5, 0.0);
  if (k < 5.0) return vec3(0.0, 0.5, 0.0); if (k < 6.0) return vec3(0.0, 0.5, 0.5); if (k < 7.0) return vec3(0.0, 0.0, 0.5); if (k < 8.0) return vec3(0.5, 0.0, 0.5);
  if (k < 9.0) return vec3(1.0, 0.0, 0.0); if (k < 10.0) return vec3(1.0, 1.0, 0.0); if (k < 11.0) return vec3(0.0, 1.0, 0.0); if (k < 12.0) return vec3(0.0, 1.0, 1.0);
  if (k < 13.0) return vec3(0.0, 0.0, 1.0); return vec3(1.0, 0.0, 1.0);
}
void main() {
  vec2 uv = isf_FragNormCoord;
  float k = RENDERSIZE.y / 540.0;
  float bass = band(0.0, 0.08);
  float stp = floor(TIME * rate);
  vec3 cam = IMG_NORM_PIXEL(inputImage, uv).rgb;
  vec3 col = bgStyle == 0 ? vec3(0.0, 0.5, 0.5) : bgStyle == 1 ? paintPost(cam) : vec3(0.0);
  for (int i = 0; i < 10; i++) {
    if (float(i) >= count) break;
    float s = float(i) * 13.17 + stp * 7.31;
    vec2 size = vec2(0.24 + hash1(s) * 0.2, 0.42 + hash1(s + 1.0) * 0.3);
    vec2 pos = vec2(hash1(s + 2.0) * (1.0 - size.x), hash1(s + 3.0) * (1.0 - size.y));
    if (beatJump) pos += (vec2(hash1(s + 4.0), hash1(s + 5.0)) - 0.5) * bass * 0.06;
    vec2 q = (uv - pos) / size;
    if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) continue;
    vec2 wpx = size * RENDERSIZE / k;          // tamaño de la ventana en «píxeles de 540p»
    vec2 p = q * wpx;                           // desde abajo-izquierda
    float top = wpx.y - p.y;                    // desde arriba
    vec3 c = vec3(0.753);
    float title0 = 3.0, title1 = 21.0, menu1 = 38.0, pal = 34.0, tool = 56.0;
    if (top > title0 && top < title1 && p.x > 3.0 && p.x < wpx.x - 3.0) {
      c = mix(vec3(0.0, 0.0, 0.5), vec3(0.06, 0.52, 0.82), p.x / wpx.x);
      if (p.x > 24.0 && p.x < 24.0 + min(90.0, wpx.x * 0.35) && abs(top - 12.0) < 3.5 && mod(p.x, 9.0) < 7.0) c = vec3(1.0);   // título
      if (p.x > 6.0 && p.x < 18.0 && abs(top - 12.0) < 6.0) c = vec3(0.95, 0.85, 0.3);                                             // icono
      for (int b = 0; b < 3; b++) {                                                                                                   // _ □ ×
        float bx = wpx.x - 6.0 - 17.0 * float(b + 1);
        if (p.x > bx && p.x < bx + 15.0 && top > 6.0 && top < 19.0) {
          c = vec3(0.753);
          if (p.x < bx + 1.0 || top < 7.0) c = vec3(1.0);
          if (p.x > bx + 14.0 || top > 18.0) c = vec3(0.3);
          vec2 g = vec2(p.x - bx - 7.5, top - 12.5);
          if (b == 0 && (abs(g.x - g.y) < 1.2 || abs(g.x + g.y) < 1.2) && abs(g.x) < 4.0) c = vec3(0.0);
          if (b == 1 && (abs(abs(g.x) - 4.0) < 0.9 || abs(abs(g.y) - 3.5) < 0.9) && abs(g.x) < 4.5 && abs(g.y) < 4.0) c = vec3(0.0);
          if (b == 2 && abs(g.y - 3.0) < 1.0 && abs(g.x) < 4.0) c = vec3(0.0);
        }
      }
    } else if (top >= title1 && top < menu1) {
      if (abs(top - 29.0) < 3.0 && p.x > 8.0 && p.x < min(wpx.x - 10.0, 230.0) && mod(p.x - 8.0, 46.0) < 30.0 && mod(p.x, 6.0) < 4.5) c = vec3(0.1);  // menús
    } else if (top >= menu1 && p.y > pal && p.x > 4.0 && p.x < tool) {
      vec2 t = vec2(p.x - 4.0, top - menu1);
      vec2 cell = floor(t / 25.0), f = mod(t, 25.0);
      if (cell.y < 8.0) {
        c = vec3(0.753);
        if (f.x < 1.5 || f.y < 1.5) c = vec3(1.0);
        if (f.x > 23.0 || f.y > 23.0) c = vec3(0.35);
        if (length(f - 12.5) < 4.0 + hash(cell + 3.0) * 3.0 && hash(cell) > 0.25) c = mix(vec3(0.0), swatch(cell.x * 8.0 + cell.y), 0.4);
      }
    } else if (p.y <= pal && p.y > 4.0) {
      vec2 t = vec2(p.x - tool, p.y - 4.0);
      if (t.x > 30.0) { vec2 cell = floor((t - vec2(30.0, 2.0)) / 13.0), f = mod(t - vec2(30.0, 2.0), 13.0);
        if (cell.y < 2.0 && cell.x < 20.0 && f.x < 11.0 && f.y < 11.0) c = swatch(cell.x + cell.y * 7.0); }
      if (t.x > 2.0 && t.x < 26.0 && t.y > 2.0 && t.y < 26.0) c = t.x < 16.0 && t.y > 12.0 ? vec3(0.0) : vec3(1.0);
    } else if (top >= menu1 && p.x >= tool && p.x < wpx.x - 6.0 && p.y > pal) {
      // Lienzo: la cámara (cada ventana con su encuadre; algunas «pintadas» en morado).
      vec2 cq = vec2((p.x - tool) / (wpx.x - 6.0 - tool), (p.y - pal) / (wpx.y - menu1 - pal));
      float z = 0.55 + hash1(s + 6.0) * 0.45;
      vec2 cuv = vec2(hash1(s + 7.0), hash1(s + 8.0)) * (1.0 - z) + cq * z;
      vec3 v = IMG_NORM_PIXEL(inputImage, cuv).rgb;
      c = hash1(s + 9.0) > 0.72 ? paintPost(v) : v * 1.05;
      if (cq.x < 0.004 || cq.y > 0.996) c = vec3(0.3);
    }
    if (p.x < 1.5 || top < 1.5) c = vec3(1.0);
    if (p.x > wpx.x - 1.5 || p.y < 1.5) c = vec3(0.0);
    col = c;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const DATAMOSH = head("Datamosh: la imagen se derrite y se arrastra como un video roto; los graves la rompen más", [CAM, AUD,
  `{ "NAME": "amount", "TYPE": "float", "DEFAULT": 0.85, "MIN": 0.0, "MAX": 1.0, "LABEL": "Cuánto se arrastra" }`,
  `{ "NAME": "blockSize", "TYPE": "float", "DEFAULT": 16.0, "MIN": 4.0, "MAX": 64.0, "LABEL": "Bloques" }`,
  `{ "NAME": "refresh", "TYPE": "float", "DEFAULT": 0.06, "MIN": 0.0, "MAX": 0.5, "LABEL": "Bloques que se limpian" }`],
  `,\n  "PASSES": [ { "TARGET": "mosh", "PERSISTENT": true }, {} ]`) + BAND + `
void main() {
  vec2 uv = isf_FragNormCoord;
  float bass = band(0.0, 0.08), mid = band(0.08, 0.35);
  if (PASSINDEX == 0) {
    vec2 blk = floor(uv * RENDERSIZE / blockSize);
    float t = floor(TIME * 6.0);
    // Con un golpe de graves, algunos bloques saltan de sitio (como un fotograma clave perdido).
    vec2 jump = (vec2(hash(blk + 3.1 + t), hash(blk + 5.3 + t)) - 0.5) * 0.12 * smoothstep(0.25, 0.9, bass) * step(0.55, hash(blk * 1.7 + t));
    vec3 cur = IMG_NORM_PIXEL(inputImage, fract(uv + jump)).rgb;
    vec2 mv = (vec2(hash(blk + t * 0.13), hash(blk + 7.7 + t * 0.29)) - 0.5) * (0.004 + bass * 0.03) * amount;
    vec3 smear = IMG_NORM_PIXEL(mosh, uv - mv).rgb;
    float clean = step(hash(blk + t), refresh + mid * 0.1);
    float keep = FRAMEINDEX < 2 ? 0.0 : amount * (1.0 - clean);
    vec3 o = mix(cur, smear, keep * 0.97);
    o = mix(o, cur, smoothstep(0.6, 1.0, length(cur - smear)) * 0.15);
    gl_FragColor = vec4(o, 1.0);
  } else gl_FragColor = vec4(IMG_NORM_PIXEL(mosh, uv).rgb, 1.0);
}`;

const PIXELSORT = head("Pixel sort: lo brillante chorrea en rayas (vertical u horizontal), más largas con los graves", [CAM, AUD,
  `{ "NAME": "threshold", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.0, "MAX": 1.0, "LABEL": "Desde qué brillo" }`,
  `{ "NAME": "len", "TYPE": "float", "DEFAULT": 0.25, "MIN": 0.02, "MAX": 0.8, "LABEL": "Largo" }`,
  `{ "NAME": "horizontal", "TYPE": "bool", "DEFAULT": false, "LABEL": "Horizontal" }`]) + BAND + `
void main() {
  vec2 uv = isf_FragNormCoord;
  float bass = band(0.0, 0.08);
  vec3 c = IMG_NORM_PIXEL(inputImage, uv).rgb;
  float L = len * (0.4 + bass * 1.2);
  vec2 dir = horizontal ? vec2(-1.0, 0.0) : vec2(0.0, 1.0);
  for (int i = 1; i <= 32; i++) {
    float f = float(i) / 32.0;
    vec3 s = IMG_NORM_PIXEL(inputImage, uv + dir * f * L).rgb;
    if (lumi(s) > threshold && lumi(s) > lumi(c)) { c = mix(s, c, f * 0.8); break; }
  }
  gl_FragColor = vec4(c, 1.0);
}`;

const TIMEWARP = head("Time Warp Scan: una línea recorre la imagen y deja congelado lo que ya pasó (el filtro viral de TikTok)", [CAM,
  `{ "NAME": "speed", "TYPE": "float", "DEFAULT": 0.12, "MIN": 0.02, "MAX": 1.0, "LABEL": "Velocidad de la línea" }`,
  `{ "NAME": "horizontal", "TYPE": "bool", "DEFAULT": false, "LABEL": "De lado (no de arriba abajo)" }`,
  `{ "NAME": "lineColor", "TYPE": "color", "DEFAULT": [0.0, 0.9, 1.0, 1.0], "LABEL": "Color de la línea" }`],
  `,\n  "PASSES": [ { "TARGET": "frozen", "PERSISTENT": true }, {} ]`) + `
void main() {
  vec2 uv = isf_FragNormCoord;
  float pos = fract(TIME * speed);
  float coord = horizontal ? uv.x : 1.0 - uv.y;
  if (PASSINDEX == 0) {
    vec3 cam = IMG_NORM_PIXEL(inputImage, uv).rgb;
    vec3 prev = IMG_NORM_PIXEL(frozen, uv).rgb;
    gl_FragColor = vec4(coord < pos && FRAMEINDEX > 1 ? prev : cam, 1.0);
  } else {
    vec3 c = IMG_NORM_PIXEL(frozen, uv).rgb;
    float line = smoothstep(2.5 / RENDERSIZE.y, 0.0, abs(coord - pos));
    gl_FragColor = vec4(mix(c, lineColor.rgb, line), 1.0);
  }
}`;

const ECHO = head("Ecos: la persona deja clones de colores que la siguen (más con los graves)", [CAM, AUD,
  `{ "NAME": "decay", "TYPE": "float", "DEFAULT": 0.9, "MIN": 0.5, "MAX": 0.98, "LABEL": "Duración del eco" }`,
  `{ "NAME": "drift", "TYPE": "point2D", "DEFAULT": [0.006, 0.0], "MIN": [-0.03, -0.03], "MAX": [0.03, 0.03], "LABEL": "Hacia dónde se van" }`,
  `{ "NAME": "rainbow", "TYPE": "bool", "DEFAULT": true, "LABEL": "Clones de colores" }`],
  `,\n  "PASSES": [ { "TARGET": "trail", "PERSISTENT": true }, {} ]`) + BAND + `
vec3 hue(float t) { return 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + t)); }
void main() {
  vec2 uv = isf_FragNormCoord;
  float bass = band(0.0, 0.08);
  vec3 cam = IMG_NORM_PIXEL(inputImage, uv).rgb;
  if (PASSINDEX == 0) {
    vec2 d = (drift - 0.5) * 0.0 + drift;
    vec3 prev = IMG_NORM_PIXEL(trail, uv - d * (1.0 + bass * 3.0)).rgb * decay;
    vec3 ghost = rainbow ? lumi(cam) * hue(TIME * 0.2) * 1.4 : cam;
    gl_FragColor = vec4(max(prev, ghost * (0.35 + bass * 0.5)), 1.0);
  } else {
    vec3 t = IMG_NORM_PIXEL(trail, uv).rgb;
    gl_FragColor = vec4(max(t, cam * 0.95), 1.0);
  }
}`;

const SLICES = head("Cortes desplazados: la imagen en franjas que se mueven a los lados con el ritmo, con separación de color", [CAM, AUD,
  `{ "NAME": "slices", "TYPE": "float", "DEFAULT": 24.0, "MIN": 2.0, "MAX": 120.0, "LABEL": "Franjas" }`,
  `{ "NAME": "amount", "TYPE": "float", "DEFAULT": 0.12, "MIN": 0.0, "MAX": 0.5, "LABEL": "Desplazamiento" }`,
  `{ "NAME": "rate", "TYPE": "float", "DEFAULT": 4.0, "MIN": 0.0, "MAX": 20.0, "LABEL": "Cambios por segundo" }`,
  `{ "NAME": "vertical", "TYPE": "bool", "DEFAULT": false, "LABEL": "Franjas verticales" }`]) + BAND + `
void main() {
  vec2 uv = isf_FragNormCoord;
  float bass = band(0.0, 0.08), high = band(0.35, 0.9);
  float row = floor((vertical ? uv.x : uv.y) * slices), t = floor(TIME * rate);
  float off = (hash1(row * 1.7 + t) - 0.5) * amount * (0.3 + bass * 1.5) * step(0.35, hash1(row + t * 3.1));
  vec2 o = vertical ? vec2(0.0, off) : vec2(off, 0.0);
  vec2 ch = (vertical ? vec2(0.0, 1.0) : vec2(1.0, 0.0)) * (0.003 + high * 0.012);
  vec3 c = vec3(IMG_NORM_PIXEL(inputImage, fract(uv + o + ch)).r, IMG_NORM_PIXEL(inputImage, fract(uv + o)).g, IMG_NORM_PIXEL(inputImage, fract(uv + o - ch)).b);
  gl_FragColor = vec4(c, 1.0);
}`;

const VIDEOWALL = head("Pared de video: la cámara repetida en pantallas, cada una con su color; una salta con cada golpe", [CAM, AUD,
  `{ "NAME": "grid", "TYPE": "long", "DEFAULT": 3, "VALUES": [2, 3, 4, 6], "LABELS": ["2×2", "3×3", "4×4", "6×6"], "LABEL": "Pantallas" }`,
  `{ "NAME": "gap", "TYPE": "float", "DEFAULT": 0.06, "MIN": 0.0, "MAX": 0.3, "LABEL": "Separación" }`,
  `{ "NAME": "colors", "TYPE": "bool", "DEFAULT": true, "LABEL": "Cada pantalla de un color" }`]) + BAND + `
vec3 hue(float t) { return 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + t)); }
void main() {
  vec2 uv = isf_FragNormCoord;
  float bass = band(0.0, 0.08);
  float n = float(grid);
  vec2 cell = floor(uv * n), f = fract(uv * n);
  float id = cell.x + cell.y * n;
  float hot = floor(hash1(floor(TIME * 2.0) + 0.5) * n * n);
  float z = id == hot ? 1.0 - bass * 0.25 : 1.0;
  vec2 q = (f - 0.5) / (1.0 - gap) * z + 0.5;
  if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec3 c = IMG_NORM_PIXEL(inputImage, q).rgb;
  if (colors) c = mix(c, lumi(c) * hue(id / (n * n) + TIME * 0.05) * 1.5, 0.6);
  if (id == hot) c *= 1.0 + bass * 0.8;
  gl_FragColor = vec4(c, 1.0);
}`;

const INFINITE = head("Espejo infinito: la imagen dentro de sí misma una y otra vez (túnel de cuadros), gira con la música", [CAM, AUD,
  `{ "NAME": "scale", "TYPE": "float", "DEFAULT": 0.82, "MIN": 0.5, "MAX": 0.95, "LABEL": "Tamaño del cuadro de dentro" }`,
  `{ "NAME": "twist", "TYPE": "float", "DEFAULT": 0.05, "MIN": -0.4, "MAX": 0.4, "LABEL": "Giro" }`,
  `{ "NAME": "frameColor", "TYPE": "color", "DEFAULT": [1.0, 0.2, 0.6, 1.0], "LABEL": "Color del marco" }`],
  `,\n  "PASSES": [ { "TARGET": "rec", "PERSISTENT": true }, {} ]`) + BAND + `
void main() {
  vec2 uv = isf_FragNormCoord;
  float bass = band(0.0, 0.08);
  if (PASSINDEX == 0) {
    vec2 c = uv - 0.5;
    float a = twist * (1.0 + bass * 2.0);
    c = mat2(cos(a), -sin(a), sin(a), cos(a)) * c / (scale - bass * 0.05);
    vec2 q = c + 0.5;
    vec3 col = IMG_NORM_PIXEL(inputImage, uv).rgb;
    if (q.x > 0.0 && q.x < 1.0 && q.y > 0.0 && q.y < 1.0) {
      float edge = min(min(q.x, 1.0 - q.x), min(q.y, 1.0 - q.y));
      col = edge < 0.015 ? frameColor.rgb * (1.0 + bass) : IMG_NORM_PIXEL(rec, q).rgb;
    }
    gl_FragColor = vec4(col, 1.0);
  } else gl_FragColor = vec4(IMG_NORM_PIXEL(rec, uv).rgb, 1.0);
}`;

const KALEIDO = head("Caleidoscopio de la cámara: espejos en círculo que giran con la música", [CAM, AUD,
  `{ "NAME": "segments", "TYPE": "float", "DEFAULT": 8.0, "MIN": 2.0, "MAX": 24.0, "LABEL": "Espejos" }`,
  `{ "NAME": "spin", "TYPE": "float", "DEFAULT": 0.2, "MIN": -2.0, "MAX": 2.0, "LABEL": "Giro" }`,
  `{ "NAME": "zoom", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 3.0, "LABEL": "Zoom" }`]) + BAND + `
void main() {
  vec2 uv = isf_FragNormCoord;
  float bass = band(0.0, 0.08);
  float a = RENDERSIZE.x / RENDERSIZE.y;
  vec2 p = vec2((uv.x - 0.5) * a, uv.y - 0.5);
  float r = length(p) / (zoom * (1.0 + bass * 0.3)), th = atan(p.y, p.x) + TIME * spin;
  float seg = 6.2831 / floor(segments);
  th = mod(th, seg); th = min(th, seg - th);
  vec2 q = 0.5 + vec2(cos(th), sin(th)) * r;
  gl_FragColor = vec4(IMG_NORM_PIXEL(inputImage, clamp(q, 0.0, 1.0)).rgb * (1.0 + bass * 0.4), 1.0);
}`;

const BLOCKGLITCH = head("Glitch de bloques: trozos de imagen que saltan, cambian de canal de color y se pixelan con cada golpe", [CAM, AUD,
  `{ "NAME": "intensity", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0.0, "MAX": 1.0, "LABEL": "Intensidad" }`,
  `{ "NAME": "blocks", "TYPE": "float", "DEFAULT": 12.0, "MIN": 3.0, "MAX": 40.0, "LABEL": "Bloques" }`]) + BAND + `
void main() {
  vec2 uv = isf_FragNormCoord;
  float bass = band(0.0, 0.08), high = band(0.35, 0.9);
  float t = floor(TIME * 10.0);
  vec2 b = floor(uv * vec2(blocks, blocks * 0.6));
  float g = step(1.0 - intensity * (0.15 + bass * 0.8), hash(b + t));
  vec2 off = (vec2(hash(b + t + 1.0), hash(b + t + 2.0)) - 0.5) * 0.2 * g;
  vec2 q = uv + off;
  float px = mix(1.0, 40.0, g * hash(b + 9.0));
  q = (floor(q * RENDERSIZE / px) + 0.5) * px / RENDERSIZE;
  vec3 c = IMG_NORM_PIXEL(inputImage, fract(q)).rgb;
  if (g > 0.5 && hash(b + t + 5.0) > 0.5) c = c.gbr;
  c += (hash(uv * RENDERSIZE + t) - 0.5) * high * 0.3;
  gl_FragColor = vec4(c, 1.0);
}`;

const PUZZLE = head("Puzzle deslizante: la imagen en fichas que se deslizan como el puzzle viral, al ritmo", [CAM, AUD,
  `{ "NAME": "tiles", "TYPE": "long", "DEFAULT": 4, "VALUES": [3, 4, 5, 6], "LABELS": ["3×3", "4×4", "5×5", "6×6"], "LABEL": "Fichas" }`,
  `{ "NAME": "bpm", "TYPE": "float", "DEFAULT": 120.0, "MIN": 40.0, "MAX": 200.0, "LABEL": "Tempo (golpes por minuto)" }`]) + BAND + `
void main() {
  vec2 uv = isf_FragNormCoord;
  float bass = band(0.0, 0.08);
  float n = float(tiles);
  float beat = TIME * bpm / 60.0, stp = floor(beat), ph = smoothstep(0.0, 0.35, fract(beat));
  // En cada golpe una fila (o columna) se desliza una ficha.
  float isRow = step(0.5, hash1(stp * 1.3));
  float line = floor(hash1(stp * 2.1) * n), dir = hash1(stp * 3.7) > 0.5 ? 1.0 : -1.0;
  vec2 g = uv * n;
  if (isRow > 0.5 && floor(g.y) == line) g.x -= dir * ph;
  if (isRow < 0.5 && floor(g.x) == line) g.y -= dir * ph;
  vec2 cell = mod(floor(g), n), f = fract(g);
  // Cada ficha guarda de qué parte de la imagen es (cambia de forma estable cada 8 golpes).
  float seed = floor(stp / 8.0);
  vec2 src = mod(cell + floor(vec2(hash(cell + seed), hash(cell + seed + 4.0)) * 2.0), n);
  vec3 c = IMG_NORM_PIXEL(inputImage, (src + f) / n).rgb;
  float edge = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
  c *= smoothstep(0.0, 0.04, edge);
  if (cell.x == n - 1.0 && cell.y == 0.0) c = vec3(0.04);    // el hueco del puzzle
  gl_FragColor = vec4(c * (1.0 + bass * 0.3), 1.0);
}`;

const HUD = head("HUD de glifos: mira de ciencia ficción encima de la cámara (anillos que giran, cifras, esquinas), late con el sonido", [CAM, AUD,
  `{ "NAME": "hudColor", "TYPE": "color", "DEFAULT": [0.2, 1.0, 0.8, 1.0], "LABEL": "Color" }`,
  `{ "NAME": "dim", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.0, "MAX": 1.0, "LABEL": "Oscurecer la imagen" }`]) + BAND + `
void main() {
  vec2 uv = isf_FragNormCoord;
  float bass = band(0.0, 0.08), high = band(0.35, 0.9);
  float a = RENDERSIZE.x / RENDERSIZE.y;
  vec3 cam = IMG_NORM_PIXEL(inputImage, uv).rgb;
  vec3 col = mix(cam, vec3(lumi(cam)) * hudColor.rgb * 0.6, 0.5) * (1.0 - dim * 0.6);
  vec2 p = vec2((uv.x - 0.5) * a, uv.y - 0.5);
  float r = length(p), th = atan(p.y, p.x);
  float w = 1.5 / RENDERSIZE.y;
  float hud = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i), R = 0.12 + fi * 0.07 + bass * 0.03;
    float rot = TIME * (0.4 - fi * 0.3);
    float ticks = step(0.5, fract((th + rot) * (12.0 + fi * 12.0) / 6.2831));
    float arc = step(0.3, fract((th + rot) / 6.2831 * (2.0 + fi)));
    hud += smoothstep(w * 2.0, 0.0, abs(r - R)) * mix(arc, ticks, 0.5);
  }
  hud += smoothstep(w, 0.0, abs(p.x)) * step(0.03, abs(p.y)) * step(abs(p.y), 0.09);
  hud += smoothstep(w, 0.0, abs(p.y)) * step(0.03, abs(p.x)) * step(abs(p.x), 0.09);
  vec2 cq = abs(uv - 0.5);
  if (cq.x > 0.42 && cq.y > 0.36 && (abs(cq.x - 0.45) < w * 1.5 || abs(cq.y - 0.44) < w * 1.5)) hud += 1.0;
  // Columnas de «cifras» que cambian.
  if (uv.x < 0.12 || uv.x > 0.88) {
    vec2 g = floor(vec2(uv.x * 120.0, uv.y * 40.0 + TIME * 2.0));
    vec2 f = fract(vec2(uv.x * 120.0, uv.y * 40.0 + TIME * 2.0));
    float on = step(0.45, hash(g + floor(TIME * (4.0 + high * 20.0))));
    hud += on * step(0.15, f.x) * step(f.x, 0.85) * step(0.2, f.y) * step(f.y, 0.75) * 0.6;
  }
  gl_FragColor = vec4(col + hudColor.rgb * clamp(hud, 0.0, 1.0) * (0.8 + bass * 0.6), 1.0);
}`;

const POPART = head("Pop art: la cámara en cuatro cuadros de colores como un cuadro de Warhol; los colores cambian con los graves", [CAM, AUD,
  `{ "NAME": "levels", "TYPE": "float", "DEFAULT": 3.0, "MIN": 2.0, "MAX": 6.0, "LABEL": "Niveles de color" }`]) + BAND + `
vec3 pal(float i, float t) {
  float k = mod(i + t, 4.0);
  return k < 1.0 ? vec3(1.0, 0.1, 0.5) : k < 2.0 ? vec3(1.0, 0.9, 0.0) : k < 3.0 ? vec3(0.0, 0.8, 1.0) : vec3(0.5, 1.0, 0.2);
}
void main() {
  vec2 uv = isf_FragNormCoord;
  float bass = band(0.0, 0.08);
  vec2 cell = floor(uv * 2.0), f = fract(uv * 2.0);
  float id = cell.x + cell.y * 2.0, t = floor(TIME * 0.5 + bass * 1.5);
  float l = floor(lumi(IMG_NORM_PIXEL(inputImage, f).rgb) * levels) / max(levels - 1.0, 1.0);
  vec3 bg = pal(id, t), fg = pal(id + 2.0, t);
  gl_FragColor = vec4(mix(fg * 0.25, mix(bg, fg, 0.5) * 1.2, l) + step(0.92, l) * 0.3, 1.0);
}`;

/* ======================= Analógico (estilo Glaze CRT) ======================= */
const ANALOG = (name, d) => head(name, [CAM,
  `{ "NAME": "curvature", "TYPE": "float", "DEFAULT": ${d.curv}, "MIN": 0.0, "MAX": 0.5, "LABEL": "Curvatura de la pantalla" }`,
  `{ "NAME": "scanlines", "TYPE": "float", "DEFAULT": ${d.scan}, "MIN": 0.0, "MAX": 1.0, "LABEL": "Líneas" }`,
  `{ "NAME": "mask", "TYPE": "float", "DEFAULT": ${d.mask}, "MIN": 0.0, "MAX": 1.0, "LABEL": "Rejilla RGB del tubo" }`,
  `{ "NAME": "bloom", "TYPE": "float", "DEFAULT": ${d.bloom}, "MIN": 0.0, "MAX": 1.5, "LABEL": "Resplandor" }`,
  `{ "NAME": "bleed", "TYPE": "float", "DEFAULT": ${d.bleed}, "MIN": 0.0, "MAX": 1.0, "LABEL": "Sangrado de color" }`,
  `{ "NAME": "noise", "TYPE": "float", "DEFAULT": ${d.noise}, "MIN": 0.0, "MAX": 1.0, "LABEL": "Ruido / grano" }`,
  `{ "NAME": "jitter", "TYPE": "float", "DEFAULT": ${d.jitter}, "MIN": 0.0, "MAX": 1.0, "LABEL": "Temblor" }`,
  `{ "NAME": "tracking", "TYPE": "float", "DEFAULT": ${d.track}, "MIN": 0.0, "MAX": 1.0, "LABEL": "Banda de tracking (VHS)" }`,
  `{ "NAME": "vignette", "TYPE": "float", "DEFAULT": ${d.vig}, "MIN": 0.0, "MAX": 1.0, "LABEL": "Viñeta" }`,
  `{ "NAME": "warmth", "TYPE": "float", "DEFAULT": ${d.warm}, "MIN": -1.0, "MAX": 1.0, "LABEL": "Color (frío ↔ cálido)" }`]) + `
void main() {
  vec2 uv = isf_FragNormCoord;
  vec2 c = uv - 0.5;
  c *= 1.0 + curvature * dot(c, c) * 1.6;
  vec2 q = c + 0.5;
  if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float t = TIME;
  float line = floor(q.y * RENDERSIZE.y);
  q.x += (hash(vec2(line, floor(t * 30.0))) - 0.5) * jitter * 0.004;
  float band = smoothstep(0.06, 0.0, abs(q.y - fract(t * 0.13)));
  q.x += band * tracking * 0.03 * sin(q.y * 400.0 + t * 20.0);
  float b = bleed * 0.006;
  vec3 col = vec3(IMG_NORM_PIXEL(inputImage, q + vec2(b, 0.0)).r, IMG_NORM_PIXEL(inputImage, q).g, IMG_NORM_PIXEL(inputImage, q - vec2(b, 0.0)).b);
  // Sangrado: el color se corre a la derecha (como el croma del VHS).
  vec3 smear = vec3(0.0);
  for (int i = 1; i <= 6; i++) smear += IMG_NORM_PIXEL(inputImage, q - vec2(float(i) * b * 1.5, 0.0)).rgb;
  col = mix(col, vec3(lumi(col)) + (smear / 6.0 - vec3(lumi(smear / 6.0))), bleed * 0.6);
  // Resplandor: lo brillante se abre.
  vec3 glow = vec3(0.0);
  for (int i = 0; i < 8; i++) { float a = float(i) * 0.785; glow += max(IMG_NORM_PIXEL(inputImage, q + vec2(cos(a), sin(a)) * 0.006).rgb - 0.55, 0.0); }
  col += glow / 8.0 * bloom * 2.0;
  col *= 1.0 - scanlines * 0.45 * (0.5 + 0.5 * cos(q.y * RENDERSIZE.y * 3.1416));
  float m = mod(gl_FragCoord.x, 3.0);
  vec3 mk = m < 1.0 ? vec3(1.0, 0.7, 0.7) : m < 2.0 ? vec3(0.7, 1.0, 0.7) : vec3(0.7, 0.7, 1.0);
  col *= mix(vec3(1.0), mk * 1.15, mask);
  col += (hash(q * RENDERSIZE + fract(t * 7.0) * 100.0) - 0.5) * noise * 0.25 + band * tracking * 0.15;
  col *= 1.0 - vignette * smoothstep(0.25, 0.75, length(c));
  col *= vec3(1.0 + warmth * 0.12, 1.0, 1.0 - warmth * 0.15);
  float corner = smoothstep(0.0, 0.02, min(min(q.x, 1.0 - q.x), min(q.y, 1.0 - q.y)));
  gl_FragColor = vec4(col * corner, 1.0);
}`;
const CRT_TV = ANALOG("Televisor de tubo (CRT): curvatura, rejilla RGB, líneas y resplandor", { curv: 0.22, scan: 0.6, mask: 0.6, bloom: 0.7, bleed: 0.2, noise: 0.15, jitter: 0.15, track: 0.0, vig: 0.6, warm: 0.1 });
const VHS = ANALOG("VHS: color corrido, banda de tracking, temblor y ruido de cinta", { curv: 0.05, scan: 0.3, mask: 0.0, bloom: 0.4, bleed: 0.8, noise: 0.45, jitter: 0.5, track: 0.7, vig: 0.4, warm: 0.3 });
const FILM = ANALOG("Película de 16 mm: grano, resplandor suave y color cálido", { curv: 0.0, scan: 0.0, mask: 0.0, bloom: 0.9, bleed: 0.1, noise: 0.6, jitter: 0.3, track: 0.0, vig: 0.7, warm: 0.6 });
const BETACAM = ANALOG("Betacam de noticias de los 90: nitidez de vídeo, líneas finas y color frío", { curv: 0.08, scan: 0.35, mask: 0.2, bloom: 0.3, bleed: 0.35, noise: 0.2, jitter: 0.1, track: 0.15, vig: 0.3, warm: -0.4 });

/* ======================= Club (siguen el sonido) ======================= */
const SPECTRUM = head("Barras de espectro de neón en espejo, como un ecualizador de festival", [AUD,
  `{ "NAME": "bars", "TYPE": "float", "DEFAULT": 48.0, "MIN": 8.0, "MAX": 128.0, "LABEL": "Barras" }`,
  `{ "NAME": "colorA", "TYPE": "color", "DEFAULT": [0.0, 0.9, 1.0, 1.0], "LABEL": "Color abajo" }`,
  `{ "NAME": "colorB", "TYPE": "color", "DEFAULT": [1.0, 0.1, 0.6, 1.0], "LABEL": "Color arriba" }`]) + `
void main() {
  vec2 uv = isf_FragNormCoord;
  float x = abs(uv.x - 0.5) * 2.0;
  float i = floor(x * bars);
  float v = IMG_NORM_PIXEL(audioFFT, vec2((i + 0.5) / bars * 0.8, 0.5)).r;
  v = max(v, 0.05 + 0.04 * sin(TIME * 2.3 + i * 0.7));
  float y = abs(uv.y - 0.5) * 2.0;
  float bar = step(fract(x * bars), 0.75) * step(y, v);
  float seg = step(0.25, fract(y * 24.0));
  vec3 col = mix(colorA.rgb, colorB.rgb, y) * bar * seg * 1.3;
  col += mix(colorA.rgb, colorB.rgb, y) * smoothstep(0.08, 0.0, abs(y - v)) * 0.6;
  gl_FragColor = vec4(col + 0.04 * (1.0 - y), 1.0);
}`;

const RIDGES = head("Montañas de sonido: líneas que guardan la historia del espectro (como la portada de Joy Division)", [AUD,
  `{ "NAME": "lines", "TYPE": "float", "DEFAULT": 40.0, "MIN": 10.0, "MAX": 80.0, "LABEL": "Líneas" }`,
  `{ "NAME": "height", "TYPE": "float", "DEFAULT": 0.22, "MIN": 0.02, "MAX": 0.5, "LABEL": "Altura" }`,
  `{ "NAME": "lineColor", "TYPE": "color", "DEFAULT": [1.0, 1.0, 1.0, 1.0], "LABEL": "Color" }`],
  `,\n  "PASSES": [ { "TARGET": "hist", "PERSISTENT": true, "WIDTH": 128, "HEIGHT": 64 }, {} ]`) + `
void main() {
  vec2 uv = isf_FragNormCoord;
  if (PASSINDEX == 0) {
    // Fila de abajo = el espectro de ahora; el resto sube una fila cada fotograma.
    float row = floor(uv.y * 64.0);
    vec3 v = (row < 1.0 || FRAMEINDEX == 0) ? vec3(IMG_NORM_PIXEL(audioFFT, vec2(uv.x * 0.7, 0.5)).r) : IMG_NORM_PIXEL(hist, uv - vec2(0.0, 1.0 / 64.0)).rgb;
    gl_FragColor = vec4(v, 1.0);
  } else {
    vec3 col = vec3(0.0);
    // De la de atrás (arriba) a la de delante: cada montaña tapa lo que queda debajo de ella.
    for (int j = 0; j < 80; j++) {
      if (float(j) >= lines) break;
      int k = int(lines) - 1 - j;
      float y0 = 0.1 + float(k) / lines * 0.75;
      float env = smoothstep(0.2, 0.42, uv.x) * smoothstep(0.8, 0.58, uv.x);
      float v = IMG_NORM_PIXEL(hist, vec2(uv.x, (float(k) + 0.5) / lines)).r;
      // Rumor suave (como el pulso de la portada original), también en silencio.
      float nx = uv.x * 28.0, nt = float(k) * 3.7 + floor(TIME * 6.0);
      v += 0.35 * mix(hash(vec2(floor(nx), nt)), hash(vec2(floor(nx) + 1.0, nt)), smoothstep(0.0, 1.0, fract(nx)));
      float y = y0 + v * height * env;
      if (uv.y < y - 0.002) col = vec3(0.0);
      col = max(col, lineColor.rgb * smoothstep(2.0 / RENDERSIZE.y, 0.0, abs(uv.y - y)));
    }
    gl_FragColor = vec4(col, 1.0);
  }
}`;

const WAVERING = head("Anillo de onda: la forma de onda del sonido dibujada en círculo, que se abre con los graves", [AUD,
  { toString: () => `{ "NAME": "audio", "TYPE": "audio", "LABEL": "Onda" }` },
  `{ "NAME": "ringColor", "TYPE": "color", "DEFAULT": [0.6, 0.3, 1.0, 1.0], "LABEL": "Color" }`,
  `{ "NAME": "trailsOn", "TYPE": "bool", "DEFAULT": true, "LABEL": "Con estela" }`],
  `,\n  "PASSES": [ { "TARGET": "fb", "PERSISTENT": true }, {} ]`) + BAND + `
void main() {
  vec2 uv = isf_FragNormCoord;
  float a = RENDERSIZE.x / RENDERSIZE.y;
  float bass = band(0.0, 0.08);
  if (PASSINDEX == 0) {
    vec2 p = vec2((uv.x - 0.5) * a, uv.y - 0.5);
    float th = atan(p.y, p.x) / 6.2831 + 0.5;
    float w = IMG_NORM_PIXEL(audio, vec2(th, 0.5)).r - 0.5;
    float R = 0.22 + bass * 0.12 + w * 0.25;
    float ring = smoothstep(3.0 / RENDERSIZE.y, 0.0, abs(length(p) - R));
    vec3 prev = trailsOn ? IMG_NORM_PIXEL(fb, 0.5 + (uv - 0.5) * 0.985).rgb * 0.92 : vec3(0.0);
    gl_FragColor = vec4(max(prev, ringColor.rgb * ring * 1.5), 1.0);
  } else gl_FragColor = vec4(IMG_NORM_PIXEL(fb, uv).rgb, 1.0);
}`;

const DOTSPHERE = head("Esfera de puntos que gira y late con los graves", [AUD,
  `{ "NAME": "density", "TYPE": "float", "DEFAULT": 40.0, "MIN": 10.0, "MAX": 90.0, "LABEL": "Puntos" }`,
  `{ "NAME": "dotColor", "TYPE": "color", "DEFAULT": [1.0, 0.75, 0.2, 1.0], "LABEL": "Color" }`]) + BAND + `
void main() {
  vec2 uv = isf_FragNormCoord;
  float a = RENDERSIZE.x / RENDERSIZE.y;
  float bass = band(0.0, 0.08), high = band(0.35, 0.9);
  vec2 p = vec2((uv.x - 0.5) * a, uv.y - 0.5);
  float R = 0.3 + bass * 0.08;
  float d2 = R * R - dot(p, p);
  vec3 col = vec3(0.0);
  if (d2 > 0.0) {
    vec3 n = normalize(vec3(p, sqrt(d2)));
    float ang = TIME * 0.4;
    n.xz = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * n.xz;
    float lat = asin(clamp(n.y, -1.0, 1.0)), lon = atan(n.z, n.x);
    vec2 g = vec2(lon / 6.2831 * density * 2.0, lat / 3.1416 * density);
    vec2 f = fract(g) - 0.5;
    float r = 0.22 + hash(floor(g)) * 0.1 + high * 0.1;
    float dotv = smoothstep(r, r * 0.5, length(f));
    col = dotColor.rgb * dotv * (0.4 + 0.6 * n.z) * (1.0 + bass);
  }
  col += dotColor.rgb * 0.08 * smoothstep(0.5, 0.0, length(p));
  gl_FragColor = vec4(col, 1.0);
}`;

const LASERS = head("Láseres al ritmo: rayos que salen de abajo, se abren con los medios y brillan con los graves", [AUD,
  `{ "NAME": "beams", "TYPE": "float", "DEFAULT": 9.0, "MIN": 1.0, "MAX": 24.0, "LABEL": "Rayos" }`,
  `{ "NAME": "laserColor", "TYPE": "color", "DEFAULT": [0.1, 1.0, 0.3, 1.0], "LABEL": "Color" }`,
  `{ "NAME": "sweep", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0.0, "MAX": 2.0, "LABEL": "Barrido" }`]) + BAND + `
void main() {
  vec2 uv = isf_FragNormCoord;
  float a = RENDERSIZE.x / RENDERSIZE.y;
  float bass = band(0.0, 0.08), mid = band(0.08, 0.35);
  vec2 o = vec2(0.5 * a, -0.05);
  vec2 p = vec2(uv.x * a, uv.y) - o;
  float th = atan(p.x, p.y);
  float col = 0.0;
  for (int i = 0; i < 24; i++) {
    if (float(i) >= beams) break;
    float fi = float(i) / max(beams - 1.0, 1.0) - 0.5;
    float ang = fi * (0.6 + mid * 1.4) + sin(TIME * sweep + float(i)) * 0.15;
    float d = abs(sin(th - ang)) * length(p);
    col += smoothstep(0.006, 0.0, d) + smoothstep(0.04, 0.0, d) * 0.2;
  }
  vec3 c = laserColor.rgb * col * (0.9 + bass * 1.5);
  c += laserColor.rgb * 0.1 * smoothstep(0.4, 0.0, length(p)) * (1.0 + bass);
  gl_FragColor = vec4(c, 1.0);
}`;

/* ======================= Nube de puntos 3D (look LiDAR / Kinect) ======================= */

const POINTCLOUD = head("Nube de puntos 3D tipo LiDAR/Kinect: la imagen se vuelve miles de puntos con profundidad que giran en 3D; graves = profundidad, medios = ondas, agudos = dispersión. La profundidad sale del brillo (con la imagen de una cámara de profundidad es la distancia real)", [CAM, AUD,
  `{ "NAME": "density", "TYPE": "float", "DEFAULT": 90.0, "MIN": 30.0, "MAX": 200.0, "LABEL": "Puntos" }`,
  `{ "NAME": "depth", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0.0, "MAX": 1.2, "LABEL": "Profundidad" }`,
  `{ "NAME": "orbit", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0.0, "MAX": 1.2, "LABEL": "Giro" }`,
  `{ "NAME": "orbitSpeed", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.0, "MAX": 2.0, "LABEL": "Velocidad de giro" }`,
  `{ "NAME": "dotSize", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.1, "MAX": 0.5, "LABEL": "Tamaño del punto" }`,
  `{ "NAME": "colorMode", "TYPE": "long", "DEFAULT": 0, "VALUES": [0, 1, 2, 3], "LABELS": ["Falso color (profundidad)", "Colores de la imagen", "Un color", "Térmico"], "LABEL": "Color" }`,
  `{ "NAME": "tint", "TYPE": "color", "DEFAULT": [0.2, 0.9, 1.0, 1.0], "LABEL": "Color (modo un color)" }`,
  `{ "NAME": "invert", "TYPE": "bool", "DEFAULT": false, "LABEL": "Invertir profundidad" }`,
  `{ "NAME": "react", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 3.0, "LABEL": "Reacción al sonido" }`]) + BAND + `
vec3 turbo(float x) {
  // Aproximación polinómica del mapa «Turbo» (azul → verde → amarillo → rojo).
  x = clamp(x, 0.0, 1.0);
  vec4 v4 = vec4(1.0, x, x * x, x * x * x);
  vec2 v2 = v4.zw * v4.z;
  return clamp(vec3(
    dot(v4, vec4(0.13572138, 4.61539260, -42.66032258, 132.13108234)) + dot(v2, vec2(-152.94239396, 59.28637943)),
    dot(v4, vec4(0.09140261, 2.19418839, 4.84296658, -14.18503333)) + dot(v2, vec2(4.27729857, 2.82956604)),
    dot(v4, vec4(0.10667330, 12.64194608, -60.58204836, 110.36276771)) + dot(v2, vec2(-89.90310912, 27.34824973))), 0.0, 1.0);
}
vec3 thermal(float x) { return clamp(vec3(x * 2.0 - 0.2, x * x * 1.6 - 0.3, sin(x * 3.1416) * 0.9 - x * 0.5 + 0.2), 0.0, 1.0); }
void main() {
  float a = RENDERSIZE.x / RENDERSIZE.y;
  vec2 sc = (isf_FragNormCoord - 0.5) * vec2(a, 1.0);
  float bass = band(0.0, 0.08) * react, mid = band(0.08, 0.35) * react, high = band(0.35, 0.9) * react;
  // Cámara que orbita alrededor de la nube (con un pequeño cabeceo).
  float yaw = sin(TIME * orbitSpeed) * orbit, pitch = 0.18 + sin(TIME * orbitSpeed * 0.7 + 1.0) * orbit * 0.25;
  vec3 fw = normalize(vec3(-sin(yaw) * cos(pitch), -sin(pitch), -cos(yaw) * cos(pitch)));
  vec3 ro = -fw * 2.4 + vec3(0.0, 0.0, depth * 0.5);
  vec3 rt = normalize(cross(fw, vec3(0.0, 1.0, 0.0))), up = cross(rt, fw);
  vec3 rd = normalize(fw * 1.6 + rt * sc.x + up * sc.y);
  // La nube vive en x∈[-a/2,a/2], y∈[-0.5,0.5], z∈[0, prof] (más cerca = más z).
  float dz = depth * (1.0 + bass * 1.2) + 0.08;
  float t0 = (dz + 0.04 - ro.z) / rd.z, t1 = (-0.06 - ro.z) / rd.z;
  if (t0 > t1) { float tt = t0; t0 = t1; t1 = tt; }
  t0 = max(t0, 0.0);
  float cells = density, cw = 1.0 / cells;
  vec3 col = vec3(0.0);
  float hit = 0.0;
  const int STEPS = 96;
  for (int i = 0; i < STEPS; i++) {
    if (hit > 0.5) break;
    float t = mix(t0, t1, (float(i) + 0.5) / float(STEPS));
    vec3 p = ro + rd * t;
    vec2 g = vec2(p.x / a + 0.5, p.y + 0.5);
    if (g.x < 0.0 || g.x > 1.0 || g.y < 0.0 || g.y > 1.0) continue;
    vec2 cell = floor(g * cells);
    // Revisa esta celda y sus vecinas (un punto alto puede caer sobre la celda de al lado).
    for (int k = 0; k < 4; k++) {
      vec2 cc = cell + vec2(mod(float(k), 2.0), floor(float(k) / 2.0)) - vec2(step(fract(g.x * cells), 0.5), step(fract(g.y * cells), 0.5));
      vec2 uvc = (cc + 0.5) * cw;
      if (uvc.x < 0.0 || uvc.x > 1.0 || uvc.y < 0.0 || uvc.y > 1.0) continue;
      vec3 img = IMG_NORM_PIXEL(inputImage, uvc).rgb;
      float d = lumi(img);
      if (invert) d = 1.0 - d;
      float jit = hash(cc) - 0.5;
      float z = d * depth * (1.0 + bass * 1.2) + sin(uvc.x * 9.0 + TIME * 2.5) * mid * 0.06 + jit * high * 0.12;
      vec3 P = vec3((uvc.x - 0.5) * a, uvc.y - 0.5, z);
      float dist = length(cross(P - ro, rd));
      float r = cw * dotSize * (0.7 + d * 0.6);
      if (dist < r) {
        float k2 = 1.0 - dist / r;
        float shade = clamp(z / max(depth * 1.2, 0.01), 0.0, 1.0);
        vec3 c = colorMode == 0 ? turbo(0.15 + shade * 0.85) : colorMode == 1 ? img * 1.3 : colorMode == 2 ? tint.rgb * (0.4 + d) : thermal(d);
        col = c * (0.55 + k2 * 0.9) * (1.0 + high * 0.6);
        hit = 1.0;
        break;
      }
    }
  }
  // Rejilla del suelo muy tenue, como en las vistas de un escáner.
  if (hit < 0.5 && rd.y < 0.0) {
    float tf = (-0.62 - ro.y) / rd.y;
    vec2 fp = (ro + rd * tf).xz * 6.0;
    vec2 gl = abs(fract(fp) - 0.5);
    col += vec3(0.0, 0.35, 0.45) * smoothstep(0.04, 0.0, min(gl.x, gl.y)) * exp(-tf * 0.35) * 0.5;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export const VIRAL = [
  {
    "lumamap-plugin": 1, id: "virales-camara", name: "Virales Pro: cámara y video", version: "1.0", author: "LumaMap",
    description: "Los efectos que más se ven en redes y shows, sobre la cámara o tus videos: ventanas de Windows 98, datamosh, pixel sort, Time Warp Scan, ecos, cortes desplazados, pared de video, espejo infinito, caleidoscopio, glitch de bloques, puzzle deslizante, HUD de glifos y pop art.",
    shaders: [
      { name: "Ventanas Windows 98", isf: WIN98 }, { name: "Datamosh", isf: DATAMOSH, use: "video" }, { name: "Pixel sort", isf: PIXELSORT },
      { name: "Time Warp Scan", isf: TIMEWARP, use: "camera" }, { name: "Ecos de colores", isf: ECHO, use: "camera" }, { name: "Cortes desplazados", isf: SLICES },
      { name: "Pared de video", isf: VIDEOWALL }, { name: "Espejo infinito", isf: INFINITE }, { name: "Caleidoscopio de cámara", isf: KALEIDO },
      { name: "Glitch de bloques", isf: BLOCKGLITCH }, { name: "Puzzle deslizante", isf: PUZZLE }, { name: "HUD de glifos", isf: HUD, use: "camera" },
      { name: "Pop art", isf: POPART },
    ],
  },
  {
    "lumamap-plugin": 1, id: "virales-analogico", name: "Virales Pro: analógico", version: "1.0", author: "LumaMap",
    description: "Emulación analógica con perillas (curvatura, líneas, rejilla RGB, resplandor, sangrado de color, ruido, temblor, tracking, viñeta y color): televisor CRT, VHS, película de 16 mm y Betacam.",
    shaders: [{ name: "Televisor CRT", isf: CRT_TV }, { name: "VHS", isf: VHS }, { name: "Película 16 mm", isf: FILM }, { name: "Betacam 90s", isf: BETACAM }],
  },
  {
    "lumamap-plugin": 1, id: "nube-de-puntos", name: "Nube de puntos 3D (LiDAR)", version: "1.0", author: "LumaMap",
    description: "La cámara o un video convertidos en una nube de puntos 3D que gira, como un escaneo LiDAR o Kinect, con falso color por profundidad, colores reales, un color o térmico; reacciona al sonido (graves = profundidad, medios = ondas, agudos = dispersión). La profundidad se toma del brillo de la imagen; con una cámara de profundidad (Kinect, RealSense) es la distancia real. Profundidad estimada por IA desde una cámara normal: EN DESARROLLO.",
    shaders: [{ name: "Nube de puntos 3D", isf: POINTCLOUD }],
  },
  {
    "lumamap-plugin": 1, id: "virales-club", name: "Virales Pro: club", version: "1.0", author: "LumaMap",
    description: "Visuales que siguen el sonido: barras de espectro de neón, montañas de sonido, anillo de onda, esfera de puntos y láseres al ritmo.",
    shaders: [{ name: "Espectro de neón", isf: SPECTRUM }, { name: "Montañas de sonido", isf: RIDGES }, { name: "Anillo de onda", isf: WAVERING },
      { name: "Esfera de puntos", isf: DOTSPHERE }, { name: "Láseres al ritmo", isf: LASERS }],
  },
];
