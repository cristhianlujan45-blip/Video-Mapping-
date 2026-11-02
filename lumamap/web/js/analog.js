// web/js/analog.js
// «📼 Analógico y película»: efectos que dan al contenido el aspecto de un soporte real, hechos
// desde cero para LumaMap (WebGL2, en la misma tarjeta que dibuja la proyección):
//   · Tiempo: datamosh (los bloques de la imagen siguen el movimiento y se arrastran como un video
//     roto), slit-scan (cada franja muestra un instante distinto), ecos de movimiento y fotogramas
//     congelados.
//   · Soporte: cinta VHS (color que se corre, ondulación, banda de tracking, cambio de cabezas,
//     dropouts), película (curva de copia de cine, vaivén de la ventanilla, parpadeo), grano,
//     halación, polvo y rayones, fugas de luz y quemaduras.
//   · Pantalla: fósforo de tubo (rejilla, máscara de sombra, ranuras), LCD y pared de LED, con brillo;
//     «circuito doblado» (pierde la sincronía, canales cambiados) y la pantalla fotografiada con una
//     lente (cámara en mano, bordes desenfocados, reflejo del cristal).
//   · Película: siete caracteres (natural, cálida, naranja y verde azulado, blanqueo, B/N, proceso
//     cruzado, desvaída).
// Se aplica a la imagen de la superficie ANTES del resto de efectos (color, distorsión, bordes…),
// así que se combina con todo. Los efectos de tiempo guardan fotogramas anteriores por superficie.
// Lo de aquí arriba (lista de parámetros y «¿hace falta?») no toca la GPU y se prueba en Node.

/** Parámetros numéricos (0 = apagado) que activan el procesador. */
export const ANALOG_KEYS = ["mosh", "slit", "echo", "stutter", "vhs", "bend", "film", "grain", "halation", "dust", "burn", "phosphor", "lens"];
export const FILM_STOCKS = [["natural", "Natural"], ["warm", "Cálida"], ["tealorange", "Naranja y verde azulado"], ["bleach", "Blanqueo (plata)"], ["bw", "Blanco y negro"], ["cross", "Proceso cruzado"], ["faded", "Desvaída (vintage)"]];
export const PHOSPHOR_TYPES = [["grille", "Rejilla (tubo)"], ["shadow", "Máscara de puntos"], ["slot", "Ranuras (arcade)"], ["lcd", "LCD"], ["led", "Pared de LED"]];
export const SLIT_DIRS = [["down", "↓ Arriba primero"], ["up", "↑ Abajo primero"], ["right", "→ Izquierda primero"], ["left", "← Derecha primero"], ["center", "◎ Desde el centro"]];
const PTYPE = Object.fromEntries(PHOSPHOR_TYPES.map(([k], i) => [k, i]));
const STOCK = Object.fromEntries(FILM_STOCKS.map(([k], i) => [k, i]));
const SDIR = Object.fromEntries(SLIT_DIRS.map(([k], i) => [k, i]));

/** ¿Este look usa algún efecto analógico? */
export const analogActive = (fx) => !!fx && ANALOG_KEYS.some(k => (+fx[k] || 0) > 0.001);
/** ¿Necesita fotogramas anteriores? */
export const analogTemporal = (fx) => ["mosh", "slit", "echo", "stutter"].some(k => (+fx[k] || 0) > 0.001);

/** Ruido determinista (igual en todas las salidas y al exportar fotograma a fotograma). */
export const hash1 = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/**
 * ¿Congelar ahora? Decide, para el instante t (s), si empieza una congelación y cuánto dura.
 * Determinista por pasos de 1/24 s. Devuelve la duración (s) o 0.
 */
export function stutterAt(t, amount, beat = 0) {
  if (amount <= 0) return 0;
  const step = Math.floor(t * 24);
  const p = 0.015 + amount * 0.07 + (beat > 0.9 && amount > 0.4 ? 0.5 : 0);
  if (hash1(step) > p) return 0;
  return (0.06 + hash1(step + 0.5) * 0.45) * (0.5 + amount);
}

const VS = `#version 300 es
out vec2 uv;
void main(){ vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); uv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
const HEAD = `#version 300 es
precision highp float; precision highp sampler2D; precision highp sampler2DArray;
in vec2 uv; out vec4 o;
float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for(int i=0;i<4;i++){ v += a*vnoise(p); p *= 2.07; a *= 0.5; } return v; }
float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
`;

const FS = {
  copy: HEAD + `uniform sampler2D t; void main(){ o = texture(t, uv); }`,

  // Movimiento por bloques (como el de un códec): para cada bloque, el desplazamiento que mejor
  // explica la imagen actual a partir de la anterior. Sale codificado en 0..1 (±R px).
  flow: HEAD + `uniform sampler2D cur, prv; uniform vec2 px, blocks; uniform float R;
  void main(){
    vec2 c = (floor(gl_FragCoord.xy) + 0.5) / blocks, bs = 1.0 / blocks;
    float best = 1e9; vec2 bv = vec2(0.0);
    for (int dy = -4; dy <= 4; dy++) for (int dx = -4; dx <= 4; dx++) {
      vec2 off = vec2(float(dx), float(dy)) * (R / 4.0) * px, e2 = vec2(0.0);
      float e = 0.0;
      for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) {
        vec2 q = c + (vec2(float(i), float(j)) - 1.5) * 0.25 * bs;
        e += abs(lum(texture(cur, q).rgb) - lum(texture(prv, q - off).rgb));
      }
      e += length(vec2(float(dx), float(dy))) * 0.01;          // a igualdad, el movimiento más corto
      if (e < best) { best = e; bv = vec2(float(dx), float(dy)) / 4.0; }
    }
    o = vec4(bv * 0.5 + 0.5, clamp(best / 4.0, 0.0, 1.0), 1.0);
  }`,

  // Datamosh: lo anterior se mueve con los vectores de movimiento; lo nuevo solo entra en parte
  // («residuo»), así la imagen vieja se arrastra y se funde con la nueva como un video roto.
  mosh: HEAD + `uniform sampler2D cur, prv, last, flow; uniform vec2 px; uniform float amt, R, refresh, push;
  void main(){
    vec4 f = texture(flow, uv);
    vec2 off = (f.xy * 2.0 - 1.0) * R * px;
    vec2 big = floor(off * (1.0 + amt * 2.5 + push) / px + 0.5) * px;   // a píxeles enteros: los bloques no se emborronan
    vec4 c = texture(cur, uv);
    vec3 moved = texture(last, uv - big).rgb;
    vec3 res = c.rgb - texture(prv, uv - floor(off / px + 0.5) * px).rgb;
    vec3 m = moved + res * (1.0 - amt) * 0.85;
    float k = max(refresh, 0.015 * (1.0 - amt));
    o = vec4(clamp(mix(m, c.rgb, k), 0.0, 1.0), c.a);
  }`,

  // Slit-scan y ecos con la memoria de fotogramas (una textura por capa).
  time: HEAD + `uniform sampler2D cur; uniform sampler2DArray hist; uniform int head, n, filled, dir; uniform float slit, echo;
  vec4 histAt(vec2 q, float d){
    float top = float(filled - 1); d = clamp(d, 0.0, top);
    float a = floor(d), f = d - a, b = min(a + 1.0, top);
    vec4 x = texture(hist, vec3(q, mod(float(head) - a + float(n), float(n))));
    vec4 y = texture(hist, vec3(q, mod(float(head) - b + float(n), float(n))));
    return mix(x, y, f);
  }
  void main(){
    vec4 c = texture(cur, uv);
    if (slit > 0.0 && filled > 1) {
      float pos = dir == 0 ? uv.y : dir == 1 ? 1.0 - uv.y : dir == 2 ? uv.x : dir == 3 ? 1.0 - uv.x : clamp(length(uv - 0.5) * 1.414, 0.0, 1.0);
      float d = pos * slit * float(n - 1);
      if (d > 0.5) c = histAt(uv, d);
    }
    if (echo > 0.0 && filled > 2) {
      float g = 2.0 + echo * 6.0;
      vec3 e1 = histAt(uv, g).rgb, e2 = histAt(uv, g * 2.0).rgb, e3 = histAt(uv, g * 3.0).rgb;
      c.rgb = max(c.rgb, max(e1 * 0.75 * echo, max(e2 * 0.5 * echo, e3 * 0.3 * echo)));
    }
    o = c;
  }`,

  // Soporte y pantalla, en una sola pasada. src tiene mipmaps (para halación, desenfoque y brillo).
  look: HEAD + `uniform sampler2D src; uniform vec2 px, res; uniform float t, vhs, film, grain, halation, dust, burn, phosphor, psize, bend, lens; uniform int ptype, stock;
  vec3 yiq(vec3 c){ return vec3(dot(c, vec3(0.299, 0.587, 0.114)), dot(c, vec3(0.596, -0.274, -0.322)), dot(c, vec3(0.211, -0.523, 0.312))); }
  vec3 rgbOf(vec3 y){ return vec3(y.x + 0.956*y.y + 0.621*y.z, y.x - 0.272*y.y - 0.647*y.z, y.x - 1.106*y.y + 1.703*y.z); }
  vec3 aces(vec3 x){ return (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14); }
  void main(){
    float fr = floor(t * 24.0);
    vec2 q = uv;
    // Lente: la pantalla «fotografiada» por una cámara en mano (deriva lenta, algo de barril).
    if (lens > 0.0) {
      vec2 c = q - 0.5;
      float z = 1.0 + lens * 0.07 + sin(t * 0.37) * 0.012 * lens, a = sin(t * 0.23) * 0.012 * lens;
      c = mat2(cos(a), -sin(a), sin(a), cos(a)) * c / z + vec2(sin(t * 0.31), cos(t * 0.27)) * 0.01 * lens;
      c *= 1.0 + dot(c, c) * 0.12 * lens;
      q = c + 0.5;
    }
    vec2 sq = q;                               // coordenadas de la pantalla (para sus subpíxeles)
    // Circuito doblado: la imagen pierde la sincronía (se va hacia abajo a saltos) y se rasga.
    float seam = 1.0;
    if (bend > 0.0) {
      float ep = floor(t * 0.6);
      if (hash(vec2(ep, 2.0)) < 0.35 + bend * 0.45) {
        float roll = fract(t * (0.25 + hash(vec2(ep, 4.0)) * 0.6) * bend);
        q.y = fract(q.y + roll);
        seam = smoothstep(0.0, 0.035, q.y) * smoothstep(1.0, 0.985, q.y);
      }
      float bid = floor(uv.y * 14.0 + hash(vec2(fr, 1.0)) * 3.0);
      if (hash(vec2(bid, floor(t * 7.0))) > 1.0 - bend * 0.45) q.x += (hash(vec2(bid, fr)) - 0.5) * 0.25 * bend;
    }
    // Película: vaivén de la ventanilla (la imagen baila un poco).
    if (film > 0.0) q += (vec2(vnoise(vec2(t * 5.0, 1.3)), vnoise(vec2(2.7, t * 4.0))) - 0.5) * 0.004 * film;
    // VHS: cada línea ondula; banda de tracking que sube; cambio de cabezas abajo.
    float trk = 0.0, line = floor(uv.y * 240.0);
    if (vhs > 0.0) {
      float wob = (vnoise(vec2(line * 0.08, t * 3.0)) - 0.5) * 0.003 * vhs;
      float band = 1.0 - fract(t * 0.07);
      trk = (1.0 - smoothstep(0.0, 0.04, abs(uv.y - band))) * vhs;
      wob += trk * (hash(vec2(line, fr)) - 0.5) * 0.04;
      float hs = smoothstep(0.965, 1.0, uv.y) * vhs;
      wob += hs * (0.015 + 0.025 * hash(vec2(line, floor(t * 60.0))));
      q.x += wob;
    }
    vec4 base = texture(src, q);
    vec3 col = base.rgb;
    if (lens > 0.0) col = mix(col, textureLod(src, q, 2.0 + lens).rgb, smoothstep(0.2, 0.75, length(uv - 0.5)) * lens);   // bordes desenfocados
    if (vhs > 0.0) {
      // Luma algo blanda pero con el «realce» de bordes de los vídeos; el color corrido hacia la
      // derecha (llega tarde) y con menos ancho de banda.
      float Yc = lum(col), Yb = 0.0;
      for (int i = -2; i <= 2; i++) Yb += lum(texture(src, q + vec2(float(i) * px.x * 1.5, 0.0)).rgb) * 0.2;
      float Y = Yb + (Yc - Yb) * (0.6 + vhs * 0.9);
      vec2 IQ = vec2(0.0); float ws = 0.0;
      for (int i = 0; i < 10; i++) { float w = exp(-float(i) * 0.3); IQ += yiq(textureLod(src, q - vec2(float(i) * px.x * 2.5 + 0.003 * vhs, 0.0), 1.0).rgb).yz * w; ws += w; }
      IQ /= ws;
      col = mix(col, rgbOf(vec3(Y, IQ * (1.0 - 0.25 * vhs))), vhs);
      float dro = step(0.9975, hash(vec2(floor(uv.y * 480.0), fr))) * step(0.55, hash(vec2(floor(uv.x * 9.0 + line), fr)));
      col += dro * 0.7 * vhs + trk * 0.3 * hash(uv * res + fract(t) * 100.0);
      col += (hash(uv * res + fract(t * 7.0) * 100.0) - 0.5) * 0.07 * vhs;
    }
    // Halación: lo muy brillante se desborda en un halo rojizo (la luz rebota detrás de la película).
    if (halation > 0.0) {
      vec3 b = textureLod(src, q, 3.0).rgb * 0.45 + textureLod(src, q, 4.5).rgb * 0.35 + textureLod(src, q, 6.0).rgb * 0.2;
      float h = lum(max(b - 0.55, 0.0)) * 2.6;
      col += vec3(1.0, 0.3, 0.1) * h * halation * 1.3;
    }
    // Película: curva de copia (las luces se redondean sin perder el blanco, negro algo levantado),
    // el carácter de cada película y un parpadeo leve de proyector.
    if (film > 0.0) {
      vec3 fc = clamp(aces(col) / 0.8038, 0.0, 1.0);
      float l = lum(fc);
      if (stock == 0) {                        // natural: sombras algo frías, luces algo cálidas
        fc += vec3(0.03, 0.0, -0.035) * smoothstep(0.45, 1.0, l) + vec3(-0.02, 0.006, 0.03) * (1.0 - smoothstep(0.0, 0.4, l));
      } else if (stock == 1) {                 // cálida
        fc *= vec3(1.07, 1.0, 0.86); fc += vec3(0.02, 0.008, -0.01) * (1.0 - l);
      } else if (stock == 2) {                 // naranja y verde azulado (cine de acción)
        fc = mix(fc, fc * vec3(0.8, 1.02, 1.12), 1.0 - smoothstep(0.1, 0.55, l));
        fc = mix(fc, fc * vec3(1.14, 1.0, 0.8), smoothstep(0.4, 0.9, l));
      } else if (stock == 3) {                 // blanqueo: poco color, mucho contraste, plata
        fc = mix(fc, vec3(l), 0.55); fc = clamp((fc - 0.5) * 1.35 + 0.5, 0.0, 1.0);
      } else if (stock == 4) {                 // blanco y negro de cine
        float g = clamp((l - 0.5) * 1.25 + 0.5, 0.0, 1.0); fc = vec3(g) * vec3(1.02, 1.0, 0.96);
      } else if (stock == 5) {                 // proceso cruzado: amarillos, cian, contraste raro
        fc = vec3(smoothstep(-0.05, 1.0, fc.r), pow(fc.g, 0.88), fc.b * 0.7 + 0.14);
      } else {                                 // desvaído (vintage): negro lavado, blanco bajo, cálido
        fc = mix(vec3(l), fc, 0.75) * 0.8 + vec3(0.13, 0.11, 0.08);
      }
      fc = fc * 0.95 + 0.03;
      fc *= 1.0 + (hash(vec2(fr, 3.7)) - 0.5) * 0.07;
      col = mix(col, fc, film);
    }
    // Fugas de luz y quemaduras: manchas naranjas que entran por los bordes y destellos sueltos.
    if (burn > 0.0) {
      float n1 = fbm(vec2(uv.x * 1.6 + t * 0.13, uv.y * 1.2 - t * 0.09));
      float side = 0.5 + 0.5 * sin(t * 0.31);
      float edge = mix(1.0 - uv.x, uv.x, side);
      float leak = smoothstep(0.45, 0.95, n1 * 0.9 + edge * 0.55) * burn;
      vec3 lc = mix(vec3(1.0, 0.28, 0.05), vec3(1.0, 0.8, 0.35), n1);
      col = 1.0 - (1.0 - col) * (1.0 - lc * leak * 1.4);
      col += step(0.986, hash(vec2(floor(t * 12.0), 7.0))) * burn * 0.45 * vec3(1.0, 0.75, 0.45);
      if (burn > 0.6) { float hole = smoothstep(0.82, 0.9, fbm(uv * 3.0 + vec2(t * 0.05, 0.0)) + (burn - 0.6) * 0.6 - 0.2); col = mix(col, vec3(1.0, 0.9, 0.7), hole); }
    }
    // Circuito doblado: canales cambiados, bandas en negativo, color pasado e interferencia.
    if (bend > 0.0) {
      float bb = hash(vec2(floor(uv.y * 6.0 + t * 2.0), floor(t * 4.0)));
      if (bb > 1.0 - bend * 0.35) col = bb > 1.0 - bend * 0.1 ? 1.0 - col : col.brg;
      col = clamp(mix(vec3(lum(col)), col, 1.0 + bend * 0.9), 0.0, 1.0);
      col += sin((uv.x * 3.0 + uv.y * 45.0 + t * 9.0) * 6.2831) * 0.05 * bend;
      col *= seam;
    }
    // Grano: más fuerte en los medios tonos, nuevo en cada fotograma de cine.
    if (grain > 0.0) {
      vec2 g = floor(uv * res / 1.4);
      float n = hash(g + fr * 1.71) + hash(g * 1.3 + fr * 2.33) - 1.0;
      float l = lum(col);
      col += vec3(n, n * 0.96, n * 1.05) * grain * 0.17 * (1.0 - abs(l - 0.5) * 1.3);
    }
    // Polvo y rayones.
    if (dust > 0.0) {
      for (int k = 0; k < 3; k++) {
        float fk = float(k), per = 3.0 + fk * 2.0, st = floor(fr / per);
        if (hash(vec2(fk * 7.1, st)) < 0.25 + dust * 0.5) {
          float sx = hash(vec2(fk, st)) + sin(uv.y * 6.0 + fr) * 0.002;
          float d = abs(uv.x - sx);
          float sc = (1.0 - smoothstep(0.0, 0.0009 + fk * 0.0004, d)) * (0.6 + 0.4 * vnoise(vec2(uv.y * 40.0, fr)));
          col = mix(col, hash(vec2(fk, st + 9.0)) > 0.5 ? vec3(0.95, 0.93, 0.85) : vec3(0.05), sc * dust);
        }
      }
      vec2 gg = uv * vec2(48.0, 27.0), id = floor(gg);
      if (hash(id + fr * 1.37) > 1.0 - dust * 0.05) {
        vec2 c = vec2(hash(id + fr + 3.0), hash(id + fr + 5.0));
        float d = length((fract(gg) - c) * vec2(1.0, 0.56));
        float sp = 1.0 - smoothstep(0.0, 0.03 + 0.09 * hash(id + 9.0), d);
        col = mix(col, hash(id + 11.0) > 0.4 ? vec3(0.03) : vec3(0.95), sp * min(1.0, dust * 1.5));
      }
    }
    // Pantalla: la imagen hecha de subpíxeles rojo, verde y azul (nunca más pequeños que un
    // píxel de la salida, para no dar muaré), con brillo para no perder luz.
    if (phosphor > 0.0) {
      float sub = mix(1.0, 3.6, psize);       // ancho de un subpíxel, en píxeles de la salida
      vec2 S = res / sub, pp = sq * S;
      vec3 m; float k;
      if (ptype == 0) {                        // rejilla de tubo: franjas verticales continuas
        k = mod(floor(pp.x), 3.0); m = vec3(k == 0.0, k == 1.0, k == 2.0);
        m *= 0.55 + 0.45 * smoothstep(0.0, 0.25, fract(pp.x)) * (1.0 - smoothstep(0.75, 1.0, fract(pp.x)));
      } else if (ptype == 1) {                 // máscara de puntos en triángulo
        vec2 r = pp; float row = floor(r.y / 1.5); r.x += mod(row, 2.0) * 1.5;
        k = mod(floor(r.x), 3.0); m = vec3(k == 0.0, k == 1.0, k == 2.0);
        vec2 f = vec2(fract(r.x), fract(r.y / 1.5)) - 0.5;
        m *= 0.25 + 0.75 * (1.0 - smoothstep(0.25, 0.5, length(f)));
      } else if (ptype == 2) {                 // ranuras de arcade: franjas cortadas, al tresbolillo
        k = mod(floor(pp.x), 3.0); m = vec3(k == 0.0, k == 1.0, k == 2.0);
        float cell = floor(pp.x / 3.0), yy = fract(pp.y / 3.0 + mod(cell, 2.0) * 0.5);
        m *= 0.3 + 0.7 * smoothstep(0.0, 0.15, yy) * (1.0 - smoothstep(0.85, 1.0, yy));
      } else if (ptype == 3) {                 // LCD: cada píxel de un color, con su rejilla negra
        vec2 cell = floor(pp / 3.0); col = mix(col, texture(src, (cell + 0.5) * 3.0 / S).rgb, phosphor);
        k = mod(floor(pp.x), 3.0); m = vec3(k == 0.0, k == 1.0, k == 2.0);
        vec2 f = fract(pp / 3.0);
        m *= step(0.08, f.y) * step(f.y, 0.92) * (0.35 + 0.65 * smoothstep(0.0, 0.2, fract(pp.x)) * (1.0 - smoothstep(0.8, 1.0, fract(pp.x))));
      } else {                                 // pared de LED: diodos redondos con mucho negro
        vec2 S2 = S / 3.0, cell = floor(sq * S2); col = mix(col, texture(src, (cell + 0.5) / S2).rgb, phosphor);
        vec2 f = fract(sq * S2) - 0.5;
        m = vec3(1.0 - smoothstep(0.26, 0.42, length(f))) / 2.2;
      }
      // La máscara no apaga del todo lo que no le toca (el fósforo brilla y se mezcla a la vista):
      // así se ve la textura de la pantalla sin perder los colores ni la luz.
      vec3 glow = textureLod(src, q, 3.0).rgb;
      vec3 mm = ptype == 4 ? m * 2.2 : mix(vec3(1.0), m * 3.0, 0.62);
      vec3 scr = col * mm * 1.05 + glow * 0.16;
      col = mix(col, scr, phosphor);
    }
    // La lente: viñeta, reflejo del cristal y, fuera de la pantalla, el marco oscuro.
    if (lens > 0.0) {
      col *= 1.0 - dot(uv - 0.5, uv - 0.5) * 1.1 * lens;
      float gl = 1.0 - smoothstep(0.0, 0.32, abs(uv.x + uv.y * 0.6 - (0.35 + 0.12 * sin(t * 0.2))));
      col += vec3(0.85, 0.92, 1.0) * gl * 0.07 * lens;
      if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) col = vec3(0.015);
    }
    o = vec4(clamp(col, 0.0, 1.0), base.a);
  }`,
};

const MAX_SIDE = 1280, HIST_SIDE = 426, HIST_N = 48;

export class Analog {
  constructor(gl) {
    this.gl = gl;
    this.states = new Map();
    this.vao = gl.createVertexArray();
    this.progs = {};
  }
  prog(name) {
    if (this.progs[name]) return this.progs[name];
    const gl = this.gl, p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, FS[name]]]) {
      const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error("analog " + name + ": " + gl.getShaderInfoLog(sh));
      gl.attachShader(p, sh);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error("analog " + name + ": " + gl.getProgramInfoLog(p));
    const loc = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const u = gl.getActiveUniform(p, i); loc[u.name] = gl.getUniformLocation(p, u.name); }
    return (this.progs[name] = { p, loc });
  }
  target(w, h, nearest = false) {
    const gl = this.gl, tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE7);            // nunca en las unidades que lee el dibujo principal (0 y 1)
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const f = nearest ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fb, w, h };
  }
  free(st) {
    const gl = this.gl;
    for (const t of [st.A, st.P, st.M0, st.M1, st.T, st.L, st.F]) if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); }
    if (st.hist) { gl.deleteTexture(st.hist.tex); for (const fb of st.hist.fbs) gl.deleteFramebuffer(fb); }
  }
  forget(prefix) { for (const [k, st] of this.states) if (k.startsWith(prefix)) { this.free(st); this.states.delete(k); } }
  dispose() { for (const st of this.states.values()) this.free(st); this.states.clear(); }

  /** Una pasada de pantalla completa a `out` (null = textura de memoria `layer`). */
  pass(name, out, uniforms, texs) {
    const gl = this.gl, { p, loc } = this.prog(name);
    gl.useProgram(p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fb);
    gl.viewport(0, 0, out.w, out.h);
    let unit = 2;
    for (const [n, t, arr] of texs) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(arr ? gl.TEXTURE_2D_ARRAY : gl.TEXTURE_2D, t);
      gl.uniform1i(loc[n], unit++);
    }
    for (const [n, v] of Object.entries(uniforms)) {
      const l = loc[n]; if (!l) continue;
      if (Array.isArray(v)) v.length === 2 ? gl.uniform2f(l, v[0], v[1]) : gl.uniform3f(l, v[0], v[1], v[2]);
      else if (n === "head" || n === "n" || n === "filled" || n === "dir" || n === "ptype" || n === "stock") gl.uniform1i(l, v);
      else gl.uniform1f(l, v);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /**
   * Procesa la imagen de una superficie. key: superficie (+ capa); src: { tex, w, h }; maxSide:
   * lo que mide la superficie en la salida (no se trabaja con más detalle del que se ve).
   * Devuelve { tex, w, h } (mismo tamaño lógico que la fuente) o la fuente si algo falla.
   */
  process(key, src, fx, time, levels, maxSide = MAX_SIDE) {
    const gl = this.gl;
    const k = Math.min(1, Math.min(MAX_SIDE, Math.max(64, maxSide)) / Math.max(src.w, src.h));
    const w0 = Math.max(8, Math.round(src.w * k)), h0 = Math.max(8, Math.round(src.h * k));
    let st = this.states.get(key);
    // Se reutiliza si el tamaño sigue valiendo (la vista y la lupa piden tamaños distintos): así no
    // se pierde la memoria de fotogramas ni se recrean texturas en cada dibujo.
    const fits = st && Math.abs(st.W / st.H - w0 / h0) < 0.02 && st.W >= w0 * 0.9 && st.W <= w0 * 2.2;
    if (st && !fits) { this.free(st); st = null; }
    if (!st) { st = { W: w0, H: h0, frame: 0, t: -1, head: -1, filled: 0, freezeUntil: -1, lastKey: -1 }; this.states.set(key, st); }
    const W = st.W, H = st.H;
    st.used = performance.now();
    if (st.t === time && st.out) return { tex: st.out.tex, w: src.w, h: src.h };   // ya hecho en este fotograma
    const dt = st.t < 0 ? 0 : time - st.t;
    st.t = time;
    // Estado de WebGL que hay que devolver como estaba.
    const prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING), prevVp = gl.getParameter(gl.VIEWPORT);
    const scissor = gl.isEnabled(gl.SCISSOR_TEST), blend = gl.isEnabled(gl.BLEND);
    const prevProg = gl.getParameter(gl.CURRENT_PROGRAM), prevVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
    gl.disable(gl.SCISSOR_TEST); gl.disable(gl.BLEND);
    gl.bindVertexArray(this.vao);
    try {
      st.A ||= this.target(W, H);
      const lv = levels || {};
      const mosh = +fx.mosh || 0, slit = +fx.slit || 0, echo = +fx.echo || 0, stutter = +fx.stutter || 0;
      // Congelar: mientras dura, la imagen de entrada no cambia.
      if (stutter > 0 && time >= st.freezeUntil) {
        const d = stutterAt(time, stutter, lv.beat || 0);
        if (d > 0 && st.frame > 0) st.freezeUntil = time + d;
      }
      const frozen = stutter > 0 && time < st.freezeUntil;
      // Datamosh: necesita la entrada anterior → A (actual) y P (anterior) se turnan.
      if (!frozen) {
        if (mosh > 0) { st.P ||= this.target(W, H); const x = st.P; st.P = st.A; st.A = x; }
        this.pass("copy", st.A, {}, [["t", src.tex]]);
      }
      let cur = st.A;
      if (mosh > 0 && st.frame > 0 && !frozen) {
        const R = Math.max(4, Math.round(Math.max(W, H) / 80));
        const bw = Math.max(4, Math.round(W / 16)), bh = Math.max(4, Math.round(H / 16));
        if (!st.F || st.F.w !== bw) { if (st.F) { gl.deleteTexture(st.F.tex); gl.deleteFramebuffer(st.F.fb); } st.F = this.target(bw, bh, true); }
        st.M0 ||= this.target(W, H); st.M1 ||= this.target(W, H);
        if (!st.moshOn) { this.pass("copy", st.M0, {}, [["t", st.P.tex]]); st.moshOn = true; }
        this.pass("flow", st.F, { px: [1 / W, 1 / H], blocks: [bw, bh], R }, [["cur", st.A.tex], ["prv", st.P.tex]]);
        // Cada cierto tiempo entra una imagen limpia (como un fotograma clave); más datamosh, más espera.
        const period = 0.8 + mosh * 6;
        const refresh = Math.floor(time / period) !== Math.floor((time - dt) / period) ? 1 : 0;
        this.pass("mosh", st.M1, { px: [1 / W, 1 / H], amt: mosh, R, refresh, push: (lv.beat || 0) * mosh * 2 }, [["cur", st.A.tex], ["prv", st.P.tex], ["last", st.M0.tex], ["flow", st.F.tex]]);
        const x = st.M0; st.M0 = st.M1; st.M1 = x;
        cur = st.M0;
      } else if (mosh > 0 && frozen && st.M0) cur = st.M0;
      if (mosh <= 0) st.moshOn = false;
      // Memoria de fotogramas para slit-scan y ecos.
      if (slit > 0 || echo > 0) {
        if (!st.hist) {
          const kk = Math.min(1, HIST_SIDE / Math.max(W, H)), hw = Math.max(8, Math.round(W * kk)), hh = Math.max(8, Math.round(H * kk));
          const tex = gl.createTexture();
          gl.activeTexture(gl.TEXTURE7);
          gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
          gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, hw, hh, HIST_N);
          gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          const fbs = [];
          for (let i = 0; i < HIST_N; i++) { const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, tex, 0, i); fbs.push(fb); }
          st.hist = { tex, fbs, w: hw, h: hh };
          st.head = -1; st.filled = 0;
        }
        if (!frozen || st.filled === 0) {
          st.head = (st.head + 1) % HIST_N; st.filled = Math.min(HIST_N, st.filled + 1);
          this.pass("copy", { fb: st.hist.fbs[st.head], w: st.hist.w, h: st.hist.h }, {}, [["t", cur.tex]]);
        }
        st.T ||= this.target(W, H);
        this.pass("time", st.T, { head: st.head, n: HIST_N, filled: st.filled, dir: SDIR[fx.slitDir] ?? 0, slit, echo }, [["cur", cur.tex], ["hist", st.hist.tex, true]]);
        cur = st.T;
      } else if (st.hist) { gl.deleteTexture(st.hist.tex); for (const fb of st.hist.fbs) gl.deleteFramebuffer(fb); st.hist = null; }
      // Soporte y pantalla.
      const lk = { vhs: +fx.vhs || 0, bend: +fx.bend || 0, film: +fx.film || 0, grain: +fx.grain || 0, halation: +fx.halation || 0, dust: +fx.dust || 0, burn: +fx.burn || 0, phosphor: +fx.phosphor || 0, lens: +fx.lens || 0 };
      if (Object.values(lk).some(v => v > 0)) {
        // La entrada necesita mipmaps (halo y brillo); no puede ser A si A cambia… sí puede: se
        // generan sobre la textura de este fotograma y luego se vuelve al filtro normal.
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, cur.tex);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        st.L ||= this.target(W, H);
        this.pass("look", st.L, { ...lk, px: [1 / W, 1 / H], res: [W, H], t: time, psize: fx.phosphorSize ?? 0.4, ptype: PTYPE[fx.phosphorType] ?? 0, stock: STOCK[fx.filmStock] ?? 0 }, [["src", cur.tex]]);
        gl.bindTexture(gl.TEXTURE_2D, cur.tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        cur = st.L;
      }
      st.out = cur;
      st.frame++;
    } catch (e) {
      if (!this.warned) { console.warn("Efectos analógicos:", e); this.warned = true; }
      st.out = null;
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);
      gl.viewport(prevVp[0], prevVp[1], prevVp[2], prevVp[3]);
      if (scissor) gl.enable(gl.SCISSOR_TEST);
      if (blend) gl.enable(gl.BLEND);
      gl.useProgram(prevProg);
      gl.bindVertexArray(prevVao);
      gl.activeTexture(gl.TEXTURE0);
    }
    // Limpieza: superficies que ya no se dibujan.
    if (++this.tick % 300 === 0) { const now = performance.now(); for (const [kk, s2] of this.states) if (now - s2.used > 5000) { this.free(s2); this.states.delete(kk); } }
    return st.out ? { tex: st.out.tex, w: src.w, h: src.h } : src;
  }
}
Analog.prototype.tick = 0;
