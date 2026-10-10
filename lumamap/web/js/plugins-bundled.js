// web/js/plugins-bundled.js
// Plugins que vienen con LumaMap (se pueden apagar en Menú → Plugins). Son datos, como los
// que instala el usuario: sirven también de ejemplo del formato (ver plugins.js).

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
];
