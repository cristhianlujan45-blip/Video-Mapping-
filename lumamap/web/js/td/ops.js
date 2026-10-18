// web/js/td/ops.js
// Catálogo de operadores de la red (como los OP de TouchDesigner), por familias:
//   TOP  imagen (en la tarjeta gráfica)     CHOP  señales/canales (números que cambian)
//   SOP  geometría 3D                       COMP  objetos 3D, cámara y luces
//   MAT  materiales                         DAT   texto y tablas
// Cada operador: { type, fam, label, desc, inputs:[mín, máx], params:[…], glsl? (TOP), cook? (CHOP) }.
// Los parámetros pueden ser un valor o una expresión (expr.js). Este archivo no toca la GPU: el
// motor (engine.js) usa `glsl` y las pruebas usan `cook` directamente.
import { noise3 } from "./expr.js";

export const FAMILIES = {
  TOP: { name: "TOP · Imagen", color: "#8b5cf6", desc: "Imágenes y video en la tarjeta gráfica: generar, filtrar y mezclar." },
  CHOP: { name: "CHOP · Señales", color: "#22c55e", desc: "Números que cambian: ondas, audio, cámara, MIDI, temporizadores… para mover cualquier parámetro." },
  SOP: { name: "SOP · Geometría", color: "#3b82f6", desc: "Formas 3D: cajas, esferas, rejillas… y deformarlas." },
  COMP: { name: "COMP · Objetos 3D", color: "#9ca3af", desc: "Objetos en la escena 3D (con instancias), cámara y luces." },
  MAT: { name: "MAT · Materiales", color: "#eab308", desc: "Cómo se ve la superficie de un objeto 3D (color, metal, una imagen de la red…)." },
  DAT: { name: "DAT · Texto y tablas", color: "#ec4899", desc: "Texto para el Text TOP y tablas de números para las expresiones (tab())." },
};

/* ---------------- Parámetros ---------------- */
// f decimal · i entero · t interruptor · m menú · c color · s texto · txt texto largo · code GLSL
// op referencia a otro nodo (fam) · media video/foto de la biblioteca · cam cámara · shader plugin
// pulse botón (Reiniciar…) · param parámetro de LumaMap (para exportar)
const f = (k, label, def, min = 0, max = 1, o = {}) => ({ k, label, type: "f", def, min, max, ...o });
const i = (k, label, def, min = 0, max = 10, o = {}) => ({ k, label, type: "i", def, min, max, ...o });
const t = (k, label, def = 0, o = {}) => ({ k, label, type: "t", def, ...o });
const m = (k, label, opts, def = 0, o = {}) => ({ k, label, type: "m", opts, def, ...o });
const c = (k, label, def, o = {}) => ({ k, label, type: "c", def, ...o });
const s = (k, label, def = "", o = {}) => ({ k, label, type: "s", def, ...o });
const opRef = (k, label, fam, o = {}) => ({ k, label, type: "op", fam, def: "", ...o });
const pulse = (k, label) => ({ k, label, type: "pulse", def: 0 });
const XYZ = (pre, label, def = [0, 0, 0], min = -5, max = 5) => ["x", "y", "z"].map((a, n) => f(pre + a, `${label} ${a.toUpperCase()}`, def[n], min, max, { page: "Transformar" }));

const ops = [];
const add = (o) => { ops.push(o); return o; };
const top = (type, label, desc, inputs, params, glsl, extra = {}) => add({ type, fam: "TOP", label, desc, inputs, params, glsl, ...extra });

/* ======================= TOP · Imagen ======================= */
// GLSL: devolver el color en `cook()`. Disponibles: uv, res, time, tex0..tex3(uv), has0..has3,
// px (tamaño de un píxel de la entrada 0), luma(), hsv2rgb(), rgb2hsv(), snoise(vec3), fbm(vec3,int),
// rot2(a). Cada parámetro numérico es p_<clave> (los colores, vec3).
const PASS = "return tex0(uv);";
// Generadores
top("constant", "Color fijo", "Un color liso (Constant TOP).", [0, 0], [c("color", "Color", "#ff3366"), f("alpha", "Opacidad", 1)],
  "return vec4(p_color, p_alpha);");
top("ramp", "Degradado", "Degradado horizontal, vertical, radial o circular (Ramp TOP).", [0, 0],
  [m("kind", "Tipo", [[0, "Horizontal"], [1, "Vertical"], [2, "Radial"], [3, "Circular"]]), c("color1", "Color 1", "#000000"), c("color2", "Color 2", "#ffffff"),
    f("period", "Repeticiones", 1, 0.1, 10), f("phase", "Fase", 0, 0, 1), t("loop", "Ida y vuelta", 0)],
  `vec2 q = uv - 0.5; q.x *= res.x / res.y; float k;
   if (p_kind < 0.5) k = uv.x; else if (p_kind < 1.5) k = uv.y; else if (p_kind < 2.5) k = length(q) * 1.414; else k = atan(q.y, q.x) / 6.28318 + 0.5;
   k = k * p_period + p_phase; k = p_loop > 0.5 ? 1.0 - abs(fract(k * 0.5) * 2.0 - 1.0) : fract(k);
   if (p_period == 1.0 && p_phase == 0.0 && p_loop < 0.5) k = clamp(k, 0.0, 1.0);
   return vec4(mix(p_color1, p_color2, k), 1.0);`);
top("noise", "Ruido", "Ruido suave, fractal, de celdas o aleatorio que se mueve (Noise TOP).", [0, 0],
  [m("kind", "Tipo", [[0, "Suave"], [1, "Fractal"], [2, "Celdas"], [3, "Aleatorio"]], 1), f("period", "Tamaño", 3, 0.1, 20), i("harmonics", "Detalle", 4, 1, 8),
    f("amp", "Amplitud", 1, 0, 2), f("offset", "Base", 0, -1, 1), f("speed", "Velocidad", 0.2, 0, 3), t("mono", "Blanco y negro", 1),
    f("tx", "Mover X", 0, -10, 10), f("ty", "Mover Y", 0, -10, 10)],
  `vec2 q = (uv - 0.5) * vec2(res.x / res.y, 1.0) * p_period + vec2(p_tx, p_ty); float z = time * p_speed;
   vec3 v;
   if (p_kind < 0.5) v = vec3(snoise(vec3(q, z)), snoise(vec3(q + 17.3, z)), snoise(vec3(q - 9.1, z))) * 0.5 + 0.5;
   else if (p_kind < 1.5) v = vec3(fbm(vec3(q, z), int(p_harmonics)), fbm(vec3(q + 17.3, z), int(p_harmonics)), fbm(vec3(q - 9.1, z), int(p_harmonics))) * 0.5 + 0.5;
   else if (p_kind < 2.5) { vec2 g = floor(q), fr = fract(q); float d = 9.0; for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) { vec2 o = vec2(x, y); vec2 r = o + 0.5 + 0.45 * sin(z * 3.0 + 6.2831 * fract(sin(dot(g + o, vec2(127.1, 311.7))) * 43758.5)) - fr; d = min(d, dot(r, r)); } v = vec3(sqrt(d)); }
   else v = vec3(fract(sin(dot(floor(uv * res) + floor(z * 30.0), vec2(12.9898, 78.233))) * 43758.5453), fract(sin(dot(floor(uv * res) + 3.1, vec2(39.3, 11.1))) * 1e4), fract(sin(dot(floor(uv * res), vec2(7.7, 91.3))) * 5e3));
   if (p_mono > 0.5) v = vec3(v.x);
   return vec4(clamp(v * p_amp + p_offset, 0.0, 1.0), 1.0);`);
top("circle", "Círculo", "Un círculo (o anillo) con borde suave (Circle TOP).", [0, 0],
  [f("radius", "Radio", 0.3, 0, 1), f("ring", "Grosor del anillo (0 = lleno)", 0, 0, 0.5), f("soft", "Suavidad", 0.01, 0, 0.5), f("cx", "Centro X", 0.5), f("cy", "Centro Y", 0.5),
    c("color", "Color", "#ffffff"), c("bg", "Fondo", "#000000")],
  `vec2 q = uv - vec2(p_cx, p_cy); q.x *= res.x / res.y; float d = length(q);
   float a = 1.0 - smoothstep(p_radius - p_soft, p_radius + p_soft, d);
   if (p_ring > 0.0) a *= smoothstep(p_radius - p_ring - p_soft, p_radius - p_ring + p_soft, d);
   return vec4(mix(p_bg, p_color, a), 1.0);`);
top("rectangle", "Rectángulo", "Un rectángulo girable con borde suave (Rectangle TOP).", [0, 0],
  [f("w", "Ancho", 0.5), f("h", "Alto", 0.5), f("cx", "Centro X", 0.5), f("cy", "Centro Y", 0.5), f("rot", "Giro (grados)", 0, -180, 180), f("soft", "Suavidad", 0.005, 0, 0.2),
    c("color", "Color", "#ffffff"), c("bg", "Fondo", "#000000")],
  `vec2 q = uv - vec2(p_cx, p_cy); q.x *= res.x / res.y; q = rot2(radians(p_rot)) * q; q.x /= res.x / res.y;
   vec2 d = abs(q) - vec2(p_w, p_h) * 0.5; float e = max(d.x, d.y);
   return vec4(mix(p_bg, p_color, 1.0 - smoothstep(-p_soft, p_soft, e)), 1.0);`);
top("pattern", "Patrón", "Tablero, rayas, rejilla, puntos o hexágonos que se mueven.", [0, 0],
  [m("kind", "Tipo", [[0, "Tablero"], [1, "Rayas"], [2, "Rejilla"], [3, "Puntos"], [4, "Hexágonos"]]), f("size", "Repeticiones", 8, 1, 64), f("width", "Grosor", 0.5),
    f("rot", "Giro", 0, -180, 180), f("speed", "Desplazar", 0, -2, 2), c("color1", "Color 1", "#ffffff"), c("color2", "Color 2", "#000000")],
  `vec2 q = (uv - 0.5) * vec2(res.x / res.y, 1.0); q = rot2(radians(p_rot)) * q * p_size; q.x += time * p_speed; float k;
   if (p_kind < 0.5) k = mod(floor(q.x) + floor(q.y), 2.0);
   else if (p_kind < 1.5) k = step(fract(q.x), p_width);
   else if (p_kind < 2.5) { vec2 g = abs(fract(q) - 0.5); k = step(0.5 - p_width * 0.1, max(g.x, g.y)); }
   else if (p_kind < 3.5) k = 1.0 - step(p_width * 0.5, length(fract(q) - 0.5));
   else { vec2 r = vec2(1.0, 1.732); vec2 h = r * 0.5; vec2 a = mod(q, r) - h; vec2 b = mod(q - h, r) - h; vec2 g = dot(a, a) < dot(b, b) ? a : b; k = step(0.5 - p_width * 0.25, max(abs(g.x) * 0.866 + abs(g.y) * 0.5, abs(g.y))); }
   return vec4(mix(p_color2, p_color1, k), 1.0);`);
top("text", "Texto", "Escribe un texto (o el de un Texto DAT) (Text TOP).", [0, 0],
  [s("text", "Texto", "LUMAMAP"), opRef("dat", "Texto de un DAT (opcional)", "DAT"), f("size", "Tamaño", 0.18, 0.01, 1), c("color", "Color", "#ffffff"), c("bg", "Fondo", "#000000"),
    m("font", "Letra", [[0, "Impacto"], [1, "Moderna"], [2, "Máquina"], [3, "Elegante"]]), m("align", "Alinear", [[0, "Centro"], [1, "Izquierda"], [2, "Derecha"]]),
    f("cx", "Posición X", 0.5), f("cy", "Posición Y", 0.5), f("glow", "Brillo", 0)],
  null, { special: "text" });
top("moviein", "Video / foto", "Un video, GIF o foto de la biblioteca (Movie File In TOP).", [0, 0],
  [{ k: "media", label: "Archivo", type: "media", def: "" }, f("speed", "Velocidad", 1, -4, 4), m("fit", "Encajar", [[0, "Llenar"], [1, "Estirar"], [2, "Entero"]])], null, { special: "media" });
top("videoin", "Cámara", "La imagen de una cámara o del móvil (Video Device In TOP).", [0, 0],
  [{ k: "cam", label: "Cámara", type: "cam", def: "" }, t("mirror", "Espejo", 1)], null, { special: "camera" });
top("glsl", "GLSL (programar)", "Escribe tu propio shader, como el GLSL TOP: tienes uv, time, res, tex0/tex1 y u1…u4.", [0, 2],
  [{ k: "code", label: "Código GLSL", type: "code", def: "// uv, time, res, tex0(uv), tex1(uv), u1..u4\nvec3 col = 0.5 + 0.5 * cos(time + uv.xyx * 6.0 + vec3(0, 2, 4)) * u1;\nreturn vec4(col, 1.0);" },
    f("u1", "u1", 1, 0, 1), f("u2", "u2", 0, 0, 1), f("u3", "u3", 0, 0, 1), f("u4", "u4", 0, 0, 1)], null, { special: "glsl" });
top("plugin", "Efecto de plugin", "Cualquier shader de los plugins instalados (ISF) como un TOP.", [0, 0],
  [{ k: "shader", label: "Shader", type: "shader", def: "" }, f("speed", "Velocidad", 1, 0, 4)], null, { special: "plugin" });
top("render", "Render 3D", "Dibuja los objetos 3D de la red con su cámara y luces (Render TOP).", [0, 0],
  [opRef("camera", "Cámara", "COMP", { kinds: ["camera"] }), s("geos", "Objetos (vacío = todos)", ""), c("bg", "Fondo", "#000000"), f("bgAlpha", "Opacidad del fondo", 1),
    f("ambient", "Luz ambiente", 0.25, 0, 2), t("antialias", "Suavizar bordes", 1)], null, { special: "render" });
top("feedback", "Feedback (memoria)", "La imagen del fotograma anterior de otro TOP: estelas, túneles, ecos (Feedback TOP).", [1, 1],
  [opRef("target", "TOP que recuerda", "TOP"), pulse("reset", "Borrar memoria")], null, { special: "feedback" });
top("select", "Seleccionar", "Usa la imagen de otro TOP de la red sin cables (Select TOP).", [0, 0], [opRef("top", "TOP", "TOP")], null, { special: "select" });
top("resolution", "Resolución", "Cambia la resolución de la imagen (Resolution TOP).", [1, 1], [i("w", "Ancho", 1280, 16, 4096), i("h", "Alto", 720, 16, 4096)], PASS, { special: "resolution" });
// Filtros
top("level", "Nivel", "Brillo, contraste, gamma, opacidad y negativo (Level TOP).", [1, 1],
  [f("brightness", "Brillo", 1, 0, 3), f("contrast", "Contraste", 1, 0, 3), f("gamma", "Gamma", 1, 0.1, 3), f("opacity", "Opacidad", 1), t("invert", "Negativo", 0)],
  `vec4 c = tex0(uv); vec3 v = (c.rgb - 0.5) * p_contrast + 0.5; v *= p_brightness; v = pow(max(v, 0.0), vec3(1.0 / p_gamma));
   if (p_invert > 0.5) v = 1.0 - v; return vec4(v, c.a * p_opacity);`);
top("hsv", "Ajustar color (HSV)", "Tono, saturación y valor (HSV Adjust TOP).", [1, 1], [f("hue", "Tono (vueltas)", 0, -1, 1), f("sat", "Saturación", 1, 0, 3), f("val", "Valor", 1, 0, 3)],
  `vec4 c = tex0(uv); vec3 h = rgb2hsv(c.rgb); h.x = fract(h.x + p_hue); h.y = clamp(h.y * p_sat, 0.0, 1.0); h.z *= p_val; return vec4(hsv2rgb(h), c.a);`);
top("blur", "Desenfoque", "Desenfoque suave (Blur TOP).", [1, 1], [f("size", "Tamaño (píxeles)", 6, 0, 64)],
  `if (p_size <= 0.0) return tex0(uv); vec4 acc = vec4(0.0); float wsum = 0.0;
   for (int y = -4; y <= 4; y++) for (int x = -4; x <= 4; x++) { vec2 o = vec2(x, y); float w = exp(-dot(o, o) / 18.0); acc += tex0(uv + o * px * p_size / 4.0) * w; wsum += w; }
   return acc / wsum;`);
top("edge", "Bordes", "Encuentra los bordes (Edge TOP).", [1, 1], [f("strength", "Fuerza", 2, 0, 10), t("color", "Mantener color", 0)],
  `float l = luma(tex0(uv - vec2(px.x, 0)).rgb), r = luma(tex0(uv + vec2(px.x, 0)).rgb), d = luma(tex0(uv - vec2(0, px.y)).rgb), u = luma(tex0(uv + vec2(0, px.y)).rgb);
   float e = clamp(length(vec2(r - l, u - d)) * p_strength, 0.0, 1.0); return vec4(p_color > 0.5 ? tex0(uv).rgb * e : vec3(e), 1.0);`);
top("transform", "Transformar", "Mover, escalar, girar y repetir la imagen (Transform TOP).", [1, 1],
  [f("tx", "Mover X", 0, -1, 1), f("ty", "Mover Y", 0, -1, 1), f("sx", "Escala X", 1, 0, 4), f("sy", "Escala Y", 1, 0, 4), f("rot", "Giro (grados)", 0, -360, 360),
    m("extend", "Fuera de la imagen", [[0, "Negro"], [1, "Repetir"], [2, "Espejo"], [3, "Estirar el borde"]])],
  `vec2 q = uv - 0.5 - vec2(p_tx, p_ty); q.x *= res.x / res.y; q = rot2(-radians(p_rot)) * q; q.x /= res.x / res.y; q /= vec2(p_sx, p_sy); q += 0.5;
   if (p_extend < 0.5) { if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) return vec4(0, 0, 0, 1); }
   else if (p_extend < 1.5) q = fract(q); else if (p_extend < 2.5) q = 1.0 - abs(mod(q, 2.0) - 1.0); else q = clamp(q, 0.0, 1.0);
   return tex0(q);`);
top("tile", "Repetir (mosaico)", "Repite la imagen en mosaico, con espejo opcional (Tile TOP).", [1, 1], [f("rx", "Veces X", 2, 1, 16), f("ry", "Veces Y", 2, 1, 16), t("mirror", "En espejo", 0)],
  `vec2 q = uv * vec2(p_rx, p_ry); q = p_mirror > 0.5 ? 1.0 - abs(mod(q, 2.0) - 1.0) : fract(q); return tex0(q);`);
top("mirror", "Espejo", "Espejo horizontal, vertical o cuádruple (Mirror TOP).", [1, 1], [m("axis", "Eje", [[0, "Izquierda → derecha"], [1, "Arriba → abajo"], [2, "Cuatro partes"]])],
  `vec2 q = uv; if (p_axis < 0.5 || p_axis > 1.5) q.x = 0.5 - abs(q.x - 0.5); if (p_axis > 0.5) q.y = 0.5 - abs(q.y - 0.5); return tex0(q);`);
top("flip", "Voltear", "Voltea en horizontal o vertical (Flip TOP).", [1, 1], [t("fx", "Horizontal", 1), t("fy", "Vertical", 0)],
  `return tex0(vec2(p_fx > 0.5 ? 1.0 - uv.x : uv.x, p_fy > 0.5 ? 1.0 - uv.y : uv.y));`);
top("crop", "Recortar", "Recorta un trozo y lo estira (Crop TOP).", [1, 1], [f("left", "Izquierda", 0), f("right", "Derecha", 1), f("bottom", "Abajo", 0), f("top", "Arriba", 1)],
  `return tex0(vec2(mix(p_left, p_right, uv.x), mix(p_bottom, p_top, uv.y)));`);
top("kaleido", "Caleidoscopio", "Caleidoscopio de N partes.", [1, 1], [f("segments", "Partes", 6, 1, 24), f("rot", "Giro", 0, -360, 360), f("zoom", "Zoom", 1, 0.1, 4)],
  `vec2 q = (uv - 0.5) * vec2(res.x / res.y, 1.0); float r = length(q) / p_zoom, a = atan(q.y, q.x) + radians(p_rot);
   float seg = 6.28318 / max(1.0, p_segments); a = abs(mod(a, seg) - seg * 0.5); vec2 o = vec2(cos(a), sin(a)) * r; o.x /= res.x / res.y; return tex0(o + 0.5);`);
top("pixelate", "Píxeles", "Pixela la imagen.", [1, 1], [f("size", "Columnas", 48, 2, 400)],
  `vec2 n = vec2(p_size, p_size * res.y / res.x); return tex0((floor(uv * n) + 0.5) / n);`);
top("posterize", "Posterizar", "Pocos colores, como un cartel.", [1, 1], [f("levels", "Niveles", 4, 2, 16)],
  `vec4 c = tex0(uv); return vec4(floor(c.rgb * p_levels) / (p_levels - 1.0), c.a);`);
top("threshold", "Umbral", "Blanco o negro según el brillo (Threshold TOP).", [1, 1], [f("level", "Nivel", 0.5), f("soft", "Suavidad", 0.02, 0, 0.5), c("color", "Color", "#ffffff"), t("alpha", "Lo oscuro transparente", 0)],
  `float k = smoothstep(p_level - p_soft, p_level + p_soft, luma(tex0(uv).rgb)); return p_alpha > 0.5 ? vec4(p_color * k, k) : vec4(p_color * k, 1.0);`);
top("lookup", "Mapa de color", "Colorea según el brillo: térmico, fuego, hielo… o con un degradado de la entrada 2 (Lookup TOP).", [1, 2],
  [m("map", "Paleta", [[0, "Térmica"], [1, "Fuego"], [2, "Hielo"], [3, "Arcoíris"], [4, "Dos colores"]]), c("color1", "Color oscuro", "#1a0033"), c("color2", "Color claro", "#00e5ff")],
  `float k = luma(tex0(uv).rgb); vec3 col;
   if (has1 > 0.5) col = tex1(vec2(k, 0.5)).rgb;
   else if (p_map < 0.5) col = clamp(vec3(k * 3.0 - 1.5, sin(k * 3.14159), 1.0 - k * 2.0) + vec3(0, 0, k > 0.8 ? (k - 0.8) * 5.0 : 0.0), 0.0, 1.0);
   else if (p_map < 1.5) col = clamp(vec3(k * 2.5, k * 1.6 - 0.4, k * 3.0 - 2.0), 0.0, 1.0);
   else if (p_map < 2.5) col = clamp(vec3(k * 3.0 - 2.0, k * 1.6 - 0.4, k * 2.5), 0.0, 1.0);
   else if (p_map < 3.5) col = hsv2rgb(vec3(k * 0.85, 1.0, step(0.02, k)));
   else col = mix(p_color1, p_color2, k);
   return vec4(col, 1.0);`);
top("chromakey", "Quitar color (chroma)", "Hace transparente un color, como el verde (Chroma Key TOP).", [1, 1], [c("color", "Color a quitar", "#00ff00"), f("tol", "Tolerancia", 0.3), f("soft", "Suavidad", 0.1)],
  `vec4 c = tex0(uv); float d = distance(c.rgb, p_color); float a = smoothstep(p_tol, p_tol + p_soft, d); return vec4(c.rgb * a, a);`);
top("lumakey", "Quitar oscuro (luma)", "Hace transparente lo oscuro (o lo claro) (Luma Key TOP).", [1, 1], [f("level", "Nivel", 0.15), f("soft", "Suavidad", 0.05), t("invert", "Quitar lo claro", 0)],
  `vec4 c = tex0(uv); float a = smoothstep(p_level, p_level + p_soft, luma(c.rgb)); if (p_invert > 0.5) a = 1.0 - a; return vec4(c.rgb * a, a);`);
top("rgbsplit", "Separar RGB", "Aberración cromática: separa rojo, verde y azul.", [1, 1], [f("amount", "Cantidad", 0.01, 0, 0.1), f("angle", "Ángulo", 0, -180, 180)],
  `vec2 d = vec2(cos(radians(p_angle)), sin(radians(p_angle))) * p_amount; return vec4(tex0(uv + d).r, tex0(uv).g, tex0(uv - d).b, 1.0);`);
top("displace", "Desplazar", "Deforma la entrada 1 con la imagen de la entrada 2 (Displace TOP).", [2, 2], [f("weight", "Fuerza", 0.05, 0, 0.5), f("mid", "Punto medio", 0.5)],
  `vec2 d = (tex1(uv).rg - p_mid) * p_weight; return tex0(uv + d);`);
top("wave", "Ondas", "Ondula la imagen.", [1, 1], [f("amp", "Amplitud", 0.02, 0, 0.2), f("freq", "Frecuencia", 10, 0, 60), f("speed", "Velocidad", 1, -10, 10), t("vertical", "Vertical", 0)],
  `vec2 q = uv; if (p_vertical > 0.5) q.y += sin(uv.x * p_freq + time * p_speed) * p_amp; else q.x += sin(uv.y * p_freq + time * p_speed) * p_amp; return tex0(q);`);
top("polar", "Túnel polar", "Convierte la imagen en un túnel (de cartesiano a polar).", [1, 1], [f("zoom", "Zoom", 1, 0.1, 4), f("twist", "Torsión", 0, -4, 4), t("inverse", "Al revés", 0)],
  `vec2 q = (uv - 0.5) * vec2(res.x / res.y, 1.0);
   if (p_inverse > 0.5) { float a = (uv.x - 0.5) * 6.28318, r = uv.y * 0.5; return tex0(vec2(cos(a), sin(a)) * r / vec2(res.x / res.y, 1.0) + 0.5); }
   float r = length(q) * 2.0 / p_zoom; float a = atan(q.y, q.x) / 6.28318 + 0.5 + r * p_twist; return tex0(vec2(fract(a), fract(r)));`);
top("glow", "Resplandor", "Hace brillar lo claro (bloom).", [1, 1], [f("threshold", "Desde", 0.6), f("size", "Tamaño", 8, 0, 40), f("amount", "Cantidad", 1, 0, 4)],
  `vec4 base = tex0(uv); vec3 acc = vec3(0.0); float ws = 0.0;
   for (int y = -3; y <= 3; y++) for (int x = -3; x <= 3; x++) { vec2 o = vec2(x, y); float w = exp(-dot(o, o) / 8.0); vec3 c = tex0(uv + o * px * p_size / 3.0).rgb; acc += max(c - p_threshold, 0.0) * w; ws += w; }
   return vec4(base.rgb + acc / ws * p_amount * 3.0, base.a);`);
top("sharpen", "Enfocar", "Más nitidez.", [1, 1], [f("amount", "Cantidad", 1, 0, 5)],
  `vec4 c = tex0(uv); vec3 b = (tex0(uv + vec2(px.x, 0)).rgb + tex0(uv - vec2(px.x, 0)).rgb + tex0(uv + vec2(0, px.y)).rgb + tex0(uv - vec2(0, px.y)).rgb) * 0.25;
   return vec4(c.rgb + (c.rgb - b) * p_amount, c.a);`);
top("null", "Null", "No cambia nada: un punto de la red para nombrar, ver o sacar la imagen (Null TOP).", [1, 1], [], PASS);
top("out", "Salida", "La imagen que sale de la red: elígela en una superficie (Contenido → Red de nodos) (Out TOP).", [1, 1], [], PASS);
// Mezclas
const MODES = [[0, "Encima (over)"], [1, "Sumar"], [2, "Multiplicar"], [3, "Trama (screen)"], [4, "Restar"], [5, "Diferencia"], [6, "Máximo"], [7, "Mínimo"], [8, "Media"]];
const COMP_GLSL = `vec4 a = tex0(uv), b = tex1(uv) * vec4(1, 1, 1, p_opacity); vec3 r;
   if (has1 < 0.5) return a;
   if (p_mode < 0.5) r = mix(a.rgb, b.rgb, b.a);
   else if (p_mode < 1.5) r = a.rgb + b.rgb * b.a;
   else if (p_mode < 2.5) r = mix(a.rgb, a.rgb * b.rgb, b.a);
   else if (p_mode < 3.5) r = mix(a.rgb, 1.0 - (1.0 - a.rgb) * (1.0 - b.rgb), b.a);
   else if (p_mode < 4.5) r = a.rgb - b.rgb * b.a;
   else if (p_mode < 5.5) r = mix(a.rgb, abs(a.rgb - b.rgb), b.a);
   else if (p_mode < 6.5) r = mix(a.rgb, max(a.rgb, b.rgb), b.a);
   else if (p_mode < 7.5) r = mix(a.rgb, min(a.rgb, b.rgb), b.a);
   else r = mix(a.rgb, (a.rgb + b.rgb) * 0.5, b.a);
   return vec4(clamp(r, 0.0, 1.0), max(a.a, b.a));`;
top("composite", "Mezclar (composite)", "Mezcla dos imágenes: encima, sumar, multiplicar, trama, diferencia… (Composite TOP).", [1, 2], [m("mode", "Modo", MODES), f("opacity", "Opacidad de la 2.ª", 1)], COMP_GLSL);
top("over", "Encima", "La entrada 2 encima de la 1 (Over TOP).", [1, 2], [m("mode", "Modo", MODES, 0, { hidden: true }), f("opacity", "Opacidad de la 2.ª", 1)], COMP_GLSL);
top("add", "Sumar luz", "Suma las dos imágenes (Add TOP).", [1, 2], [m("mode", "Modo", MODES, 1, { hidden: true }), f("opacity", "Opacidad de la 2.ª", 1)], COMP_GLSL);
top("multiply", "Multiplicar", "Multiplica las dos imágenes: sirve de máscara (Multiply TOP).", [1, 2], [m("mode", "Modo", MODES, 2, { hidden: true }), f("opacity", "Opacidad de la 2.ª", 1)], COMP_GLSL);
top("cross", "Fundido", "Funde de la entrada 1 a la 2 (Cross TOP).", [2, 2], [f("cross", "Fundido", 0.5)], `return mix(tex0(uv), tex1(uv), clamp(p_cross, 0.0, 1.0));`);
top("switch", "Interruptor", "Elige una de hasta 4 entradas; con decimales funde entre ellas (Switch TOP).", [1, 4], [f("index", "Entrada", 0, 0, 3), t("blend", "Fundir entre entradas", 0)],
  `float n = max(1.0, float(int(has0 + has1 + has2 + has3))); float k = mod(max(p_index, 0.0), n); float a = floor(k), fr = p_blend > 0.5 ? k - a : 0.0;
   vec4 c0 = a < 0.5 ? tex0(uv) : a < 1.5 ? tex1(uv) : a < 2.5 ? tex2(uv) : tex3(uv);
   float b = mod(a + 1.0, n); vec4 c1 = b < 0.5 ? tex0(uv) : b < 1.5 ? tex1(uv) : b < 2.5 ? tex2(uv) : tex3(uv);
   return mix(c0, c1, fr);`);
top("matte", "Máscara (matte)", "Entrada 1 donde la máscara (entrada 3) es negra y entrada 2 donde es blanca (Matte TOP).", [3, 3], [t("invert", "Invertir máscara", 0)],
  `float k = luma(tex2(uv).rgb); if (p_invert > 0.5) k = 1.0 - k; return mix(tex0(uv), tex1(uv), k);`);

/* ======================= CHOP · Señales ======================= */
// cook({ p, inputs, state, env, node }) → { names, data: { nombre: número[] }, len }
export function chopOut(names, data, len = 1) { return { names, data, len }; }
const one = (name, v) => chopOut([name], { [name]: [v] }, 1);
const many = (pairs) => chopOut(pairs.map(x => x[0]), Object.fromEntries(pairs.map(([n, v]) => [n, Array.isArray(v) ? v : [v]])), Math.max(1, ...pairs.map(x => Array.isArray(x[1]) ? x[1].length : 1)));
const chanNames = (str, n, base = "chan") => { const w = String(str || "").split(/[\s,]+/).filter(Boolean); return Array.from({ length: n }, (_, k) => w[k] || `${base}${k + 1}`); };
/** Mapa canal a canal (una función por valor) conservando nombres y muestras. */
function mapChop(src, fn) {
  if (!src) return chopOut([], {}, 1);
  const data = {};
  for (const n of src.names) data[n] = src.data[n].map((v, k) => fn(v, n, k));
  return chopOut([...src.names], data, src.len);
}
const wave = (kind, x) => {
  const fr = x - Math.floor(x);
  switch (kind) {
    case 1: return 1 - Math.abs(fr * 2 - 1) * 2 + 0;   // triángulo (−1..1)
    case 2: return fr < 0.5 ? 1 : -1;                  // cuadrada
    case 3: return fr * 2 - 1;                         // sierra
    case 4: return fr < 0.1 ? 1 : -1;                  // pulso
    default: return Math.sin(x * Math.PI * 2);          // seno
  }
};
const chop = (type, label, desc, inputs, params, cook, extra = {}) => add({ type, fam: "CHOP", label, desc, inputs, params, cook, ...extra });

chop("constant", "Constante / expresión", "Canales con un valor (o una expresión) cada uno (Constant CHOP).", [0, 0],
  [s("name0", "Nombre 1", "chan1"), f("value0", "Valor 1", 0, -1, 1), s("name1", "Nombre 2", ""), f("value1", "Valor 2", 0, -1, 1),
    s("name2", "Nombre 3", ""), f("value2", "Valor 3", 0, -1, 1), s("name3", "Nombre 4", ""), f("value3", "Valor 4", 0, -1, 1)],
  ({ p }) => many([0, 1, 2, 3].filter(k => k === 0 || p["name" + k]).map(k => [p["name" + k] || "chan1", +p["value" + k] || 0])));
chop("lfo", "Onda (LFO)", "Onda que sube y baja sola: seno, triángulo, cuadrada, sierra; en Hz o al ritmo (LFO CHOP).", [0, 0],
  [m("kind", "Forma", [[0, "Seno"], [1, "Triángulo"], [2, "Cuadrada"], [3, "Sierra"], [4, "Pulso"]]), f("rate", "Frecuencia (Hz o compases)", 0.5, 0, 10), t("sync", "Al ritmo (BPM)", 0),
    f("amp", "Amplitud", 1, 0, 2), f("offset", "Centro", 0, -1, 1), f("phase", "Fase", 0), s("name", "Nombre", "chan1")],
  ({ p, env }) => {
    const cycles = p.sync ? (env.t * (env.bpm || 120) / 60) / Math.max(0.01, p.rate * 4 || 4) : env.t * p.rate;
    return one(p.name || "chan1", p.offset + p.amp * wave(p.kind | 0, cycles + p.phase));
  });
chop("noise", "Ruido (CHOP)", "Valores que cambian suaves y al azar; con varias muestras sirve para instancias (Noise CHOP).", [0, 0],
  [f("rate", "Velocidad", 0.5, 0, 10), f("amp", "Amplitud", 1, 0, 4), f("offset", "Centro", 0, -2, 2), i("seed", "Semilla", 1, 0, 999), i("chans", "Canales", 1, 1, 8), s("names", "Nombres (tx ty tz…)", ""),
    i("samples", "Muestras", 1, 1, 1000), f("spread", "Variación entre muestras", 0.3, 0, 4)],
  ({ p, env }) => {
    const names = chanNames(p.names, p.chans | 0 || 1), n = Math.max(1, p.samples | 0), data = {};
    names.forEach((nm, k) => { data[nm] = Array.from({ length: n }, (_, j) => p.offset + p.amp * (noise3(env.t * p.rate, j * p.spread + k * 13.7, p.seed * 7.31) * 2 - 1)); });
    return chopOut(names, data, n);
  });
chop("pattern", "Patrón (CHOP)", "Una fila de valores (seno, rampa, azar…): ideal para colocar instancias (Pattern CHOP).", [0, 0],
  [m("kind", "Forma", [[0, "Seno"], [1, "Triángulo"], [2, "Cuadrada"], [3, "Rampa 0→1"], [5, "Azar"], [6, "Constante"]]), i("length", "Muestras", 16, 1, 2000), f("cycles", "Ciclos", 1, 0, 50),
    f("amp", "Amplitud", 1, 0, 10), f("offset", "Centro", 0, -10, 10), f("speed", "Desplazar (ciclos/s)", 0, -5, 5), s("name", "Nombre", "chan1")],
  ({ p, env }) => {
    const n = Math.max(1, p.length | 0), k = p.kind | 0, ph = env.t * p.speed;
    const arr = Array.from({ length: n }, (_, j) => {
      const x = (j / n) * p.cycles + ph;
      const v = k === 3 ? x - Math.floor(x) : k === 5 ? noise3(j * 0.731 + 0.1, 3.3, Math.floor(ph * 4)) : k === 6 ? 1 : wave(k, x);
      return p.offset + p.amp * v;
    });
    return chopOut([p.name || "chan1"], { [p.name || "chan1"]: arr }, n);
  });
chop("timer", "Temporizador", "Cuenta un tiempo (con vueltas): fracción 0→1, segundos, terminado (Timer CHOP).", [0, 0],
  [f("length", "Duración (s)", 4, 0.05, 600), t("play", "En marcha", 1), t("loop", "Repetir", 1), pulse("reset", "Reiniciar")],
  ({ p, state, env }) => {
    if (state.t0 === undefined || state.reset !== p.reset) { state.t0 = env.t; state.acc = 0; state.reset = p.reset; }
    if (state.last !== undefined && p.play) state.acc += Math.max(0, env.t - state.last);
    state.last = env.t;
    const L = Math.max(0.05, p.length), cyc = Math.floor(state.acc / L);
    const done = !p.loop && state.acc >= L;
    const sec = done ? L : state.acc - (p.loop ? cyc * L : 0);
    return many([["timer_fraction", sec / L], ["timer_seconds", sec], ["running", p.play && !done ? 1 : 0], ["done", done ? 1 : 0], ["cycles", p.loop ? cyc : Math.min(1, cyc)]]);
  });
chop("audio", "Audio (niveles)", "El sonido que entra (micrófono o la canción): graves, medios, agudos, volumen y golpe (Audio Analysis CHOP).", [0, 0],
  [f("gain", "Ganancia", 1, 0, 5)],
  ({ p, env }) => { const L = env.levels || {}; const g = p.gain; return many([["bass", (L.bass || 0) * g], ["mid", (L.mid || 0) * g], ["high", (L.high || 0) * g], ["level", (L.level || 0) * g], ["beat", L.beat || 0], ["bpm", L.bpm || env.bpm || 120]]); });
chop("spectrum", "Espectro", "Las frecuencias del sonido en N bandas (Audio Spectrum CHOP): para barras o instancias.", [0, 0],
  [i("bins", "Bandas", 32, 2, 256), f("gain", "Ganancia", 1, 0, 5)],
  ({ p, env }) => {
    const n = Math.max(2, p.bins | 0), fft = env.fft?.() || null, out = new Array(n).fill(0);
    if (fft && fft.length) { const L = fft.length; for (let k = 0; k < n; k++) { const a = Math.floor(Math.pow(k / n, 1.6) * L), b = Math.max(a + 1, Math.floor(Math.pow((k + 1) / n, 1.6) * L)); let m = 0; for (let j = a; j < b && j < L; j++) m = Math.max(m, fft[j]); out[k] = Math.min(1, (m / 255) * p.gain); } }
    else { const L = env.levels || {}; for (let k = 0; k < n; k++) { const x = k / (n - 1); out[k] = Math.min(1, ((L.bass || 0) * Math.max(0, 1 - x * 2) + (L.mid || 0) * Math.max(0, 1 - Math.abs(x - 0.5) * 2) + (L.high || 0) * Math.max(0, x * 2 - 1)) * p.gain); } }
    return chopOut(["spectrum"], { spectrum: out }, n);
  });
chop("beat", "Ritmo (BPM)", "El pulso de la música: golpe, cuenta, fase del compás y BPM (Beat CHOP).", [0, 0], [],
  ({ env }) => { const L = env.levels || {}, bpm = L.bpm || env.bpm || 120, beats = env.t * bpm / 60; return many([["beat", L.beat || 0], ["count", L.count || Math.floor(beats)], ["phase", beats - Math.floor(beats)], ["bar", (beats / 4) - Math.floor(beats / 4)], ["bpm", bpm]]); });
chop("mouse", "Toque / ratón", "Dónde tocas o pones el ratón sobre el visor de la red (Mouse In CHOP): tx, ty (0…1) y pulsado.", [0, 0], [],
  ({ env }) => { const P = env.pointer || { x: 0.5, y: 0.5, down: 0 }; return many([["tx", P.x], ["ty", P.y], ["select", P.down ? 1 : 0]]); });
chop("keyboard", "Teclado", "Una tecla: 1 mientras está pulsada (o alterna) (Keyboard In CHOP).", [0, 0], [s("key", "Tecla (a, b, space, 1…)", "space"), t("toggle", "Alternar", 0)],
  ({ p, state, env }) => {
    const k = String(p.key || "space").toLowerCase(), down = !!env.keys?.has(k === "space" ? " " : k);
    if (p.toggle) { if (down && !state.was) state.on = !state.on; state.was = down; return one(k || "key", state.on ? 1 : 0); }
    return one(k || "key", down ? 1 : 0);
  });
chop("input", "MIDI / OSC / mando", "Un control de fuera: MIDI, OSC, mando de juego, DMX… «Aprender» y mueve el control (MIDI In / OSC In CHOP).", [0, 0],
  [s("src", "Origen", ""), s("key", "Control", ""), { k: "learn", label: "Aprender (mueve el control)", type: "learn", def: 0 }, s("name", "Nombre", "value")],
  ({ p, env }) => one(p.name || "value", env.input?.(p.src, p.key) ?? 0));
chop("tracking", "Cuerpo con cámara (IA)", "Lo que hace la gente delante de la cámara: posición, manos, cabeza, velocidad… para mover objetos 3D con el cuerpo.", [0, 0],
  [{ k: "cam", label: "Cámara", type: "cam", def: "" }, t("active", "Encendido", 1)],
  ({ p, env }) => {
    const sig = p.active ? (env.tracking?.(p.cam) || {}) : {};
    const names = ["presence", "people", "x", "y", "distance", "speed", "motion", "head_x", "head_y", "left_hand_x", "left_hand_y", "right_hand_x", "right_hand_y", "hands_up", "spread", "hand1_x", "hand1_y", "hand2_x", "hand2_y", "pinch"];
    const def = { x: 0.5, y: 0.5, head_x: 0.5, head_y: 0.5, left_hand_x: 0.5, right_hand_x: 0.5, hand1_x: 0.5, hand1_y: 0.5, hand2_x: 0.5, hand2_y: 0.5 };
    return many(names.map(n => [n, sig[n] ?? def[n] ?? 0]));
  });
chop("motion", "Movimiento en cámara", "Cuánto se mueve la imagen de la cámara y dónde (sin IA, muy rápido): mover cosas agitando la mano.", [0, 0],
  [{ k: "cam", label: "Cámara", type: "cam", def: "" }, f("sens", "Sensibilidad", 0.5), t("mirror", "Espejo", 1)],
  ({ p, env }) => { const M = env.motion?.(p.cam, p.sens) || { amount: 0, x: 0.5, y: 0.5 }; return many([["amount", M.amount], ["x", p.mirror ? 1 - M.x : M.x], ["y", M.y]]); });
// Filtros
const MATH_COMB = [[0, "Ninguna"], [1, "Sumar"], [2, "Multiplicar"], [3, "Máximo"], [4, "Mínimo"], [5, "Media"]];
chop("math", "Matemáticas", "Suma, multiplica y cambia el rango (de 0…1 a lo que quieras) (Math CHOP).", [1, 4],
  [m("combine", "Combinar entradas", MATH_COMB), f("mult", "Multiplicar", 1, -10, 10), f("add", "Sumar", 0, -10, 10), t("range", "Cambiar rango", 0),
    f("fromlo", "Desde (mín.)", 0, -10, 10), f("fromhi", "Desde (máx.)", 1, -10, 10), f("tolo", "A (mín.)", 0, -10, 10), f("tohi", "A (máx.)", 1, -10, 10), t("abs", "Valor absoluto", 0), t("round", "Redondear", 0)],
  ({ p, inputs }) => {
    let src = inputs[0];
    if (!src) return chopOut([], {}, 1);
    if (p.combine && inputs.length > 1) {
      const data = {};
      for (const n of src.names) data[n] = src.data[n].map((v, k) => {
        const vals = inputs.filter(Boolean).map(ip => { const nm = ip.data[n] ? n : ip.names[src.names.indexOf(n)] || ip.names[0]; return ip.data[nm]?.[Math.min(k, ip.len - 1)] ?? 0; });
        switch (p.combine | 0) { case 1: return vals.reduce((a, b) => a + b, 0); case 2: return vals.reduce((a, b) => a * b, 1); case 3: return Math.max(...vals); case 4: return Math.min(...vals); default: return vals.reduce((a, b) => a + b, 0) / vals.length; }
      });
      src = chopOut([...src.names], data, src.len);
    }
    return mapChop(src, (v) => {
      v = v * p.mult + p.add;
      if (p.range) v = p.tolo + (p.fromhi === p.fromlo ? 0 : (v - p.fromlo) / (p.fromhi - p.fromlo)) * (p.tohi - p.tolo);
      if (p.abs) v = Math.abs(v);
      if (p.round) v = Math.round(v);
      return v;
    });
  });
chop("filter", "Suavizar (lag)", "Suaviza los saltos: sube y baja poco a poco (Filter / Lag CHOP).", [1, 1],
  [f("up", "Tiempo al subir (s)", 0.2, 0, 5), f("down", "Tiempo al bajar (s)", 0.2, 0, 5)],
  ({ p, inputs, state, env }) => {
    const src = inputs[0]; if (!src) return chopOut([], {}, 1);
    const st = (state.v ||= {}), dt = Math.max(0, Math.min(0.25, env.dt || 1 / 60));
    return mapChop(src, (v, n, k) => {
      const key = n + ":" + k, prev = st[key] ?? v, tau = v > prev ? p.up : p.down;
      const a = tau <= 0 ? 1 : 1 - Math.exp(-dt / tau);
      return (st[key] = prev + (v - prev) * a);
    });
  });
chop("speed", "Acumular (speed)", "Suma el valor cada segundo: de velocidad a posición; gira sin parar (Speed CHOP).", [1, 1],
  [f("mult", "Multiplicar", 1, -10, 10), t("wrap", "Volver a 0 al pasar de 1", 0), pulse("reset", "Reiniciar")],
  ({ p, inputs, state, env }) => {
    const src = inputs[0]; if (!src) return chopOut([], {}, 1);
    if (state.reset !== p.reset) { state.v = {}; state.reset = p.reset; }
    const st = (state.v ||= {}), dt = Math.max(0, Math.min(0.25, env.dt || 1 / 60));
    return mapChop(src, (v, n, k) => { const key = n + ":" + k; let x = (st[key] || 0) + v * p.mult * dt; if (p.wrap) x -= Math.floor(x); return (st[key] = x); });
  });
chop("trigger", "Envolvente (trigger)", "Al pasar de un nivel dispara una subida y una caída (Trigger CHOP): destellos al golpe.", [1, 1],
  [f("threshold", "Nivel", 0.5), f("attack", "Subida (s)", 0.01, 0, 2), f("hold", "Mantener (s)", 0, 0, 2), f("release", "Caída (s)", 0.3, 0, 5)],
  ({ p, inputs, state, env }) => {
    const src = inputs[0]; if (!src) return chopOut([], {}, 1);
    const st = (state.v ||= {});
    return mapChop(src, (v, n, k) => {
      const key = n + ":" + k, s0 = st[key] || { on: false, t0: -1e9, was: false };
      const above = v > p.threshold;
      if (above && !s0.was) s0.t0 = env.t;
      s0.was = above; st[key] = s0;
      const e = env.t - s0.t0;
      if (e < 0) return 0;
      if (e < p.attack) return p.attack ? e / p.attack : 1;
      if (e < p.attack + p.hold) return 1;
      const r = (e - p.attack - p.hold) / Math.max(1e-3, p.release);
      return r >= 1 ? 0 : 1 - r;
    });
  });
chop("logic", "Lógica", "Convierte en 0/1: por encima, por debajo, al pulsar o alternar (Logic CHOP).", [1, 1],
  [m("mode", "Modo", [[0, "Por encima"], [1, "Por debajo"], [2, "Al subir (un instante)"], [3, "Alternar en cada subida"]]), f("threshold", "Nivel", 0.5)],
  ({ p, inputs, state }) => {
    const src = inputs[0]; if (!src) return chopOut([], {}, 1);
    const st = (state.v ||= {});
    return mapChop(src, (v, n, k) => {
      const key = n + ":" + k, s0 = st[key] || { was: false, on: false }, above = v > p.threshold, rise = above && !s0.was;
      s0.was = above; if (rise) s0.on = !s0.on; st[key] = s0;
      switch (p.mode | 0) { case 1: return above ? 0 : 1; case 2: return rise ? 1 : 0; case 3: return s0.on ? 1 : 0; default: return above ? 1 : 0; }
    });
  });
chop("limit", "Limitar", "Mantiene los valores entre un mínimo y un máximo, o los hace dar la vuelta (Limit CHOP).", [1, 1],
  [m("kind", "Tipo", [[0, "Recortar"], [1, "Dar la vuelta"], [2, "Rebotar"]]), f("min", "Mínimo", 0, -10, 10), f("max", "Máximo", 1, -10, 10)],
  ({ p, inputs }) => mapChop(inputs[0], (v) => {
    const lo = Math.min(p.min, p.max), hi = Math.max(p.min, p.max), span = hi - lo || 1;
    if ((p.kind | 0) === 1) return lo + ((((v - lo) % span) + span) % span);
    if ((p.kind | 0) === 2) { const x = (((v - lo) % (span * 2)) + span * 2) % (span * 2); return lo + (x > span ? span * 2 - x : x); }
    return Math.min(hi, Math.max(lo, v));
  }));
chop("count", "Contador", "Cuenta cuántas veces pasa de un nivel (Count CHOP): para avanzar escenas o clips.", [1, 1],
  [f("threshold", "Nivel", 0.5), i("limit", "Volver a 0 al llegar a (0 = nunca)", 0, 0, 100), pulse("reset", "Reiniciar")],
  ({ p, inputs, state }) => {
    const src = inputs[0]; if (!src) return chopOut([], {}, 1);
    if (state.reset !== p.reset) { state.v = {}; state.reset = p.reset; }
    const st = (state.v ||= {});
    return mapChop(src, (v, n, k) => {
      const key = n + ":" + k, s0 = st[key] || { was: false, n: 0 }, above = v > p.threshold;
      if (above && !s0.was) { s0.n++; if (p.limit > 0 && s0.n >= p.limit) s0.n = 0; }
      s0.was = above; st[key] = s0; return s0.n;
    });
  });
chop("delay", "Retraso", "La señal de hace unos segundos: ecos y estelas de movimiento (Delay CHOP).", [1, 1], [f("time", "Retraso (s)", 0.5, 0, 10)],
  ({ p, inputs, state, env }) => {
    const src = inputs[0]; if (!src) return chopOut([], {}, 1);
    const buf = (state.buf ||= []);
    buf.push({ t: env.t, d: src });
    while (buf.length > 2 && buf[1].t <= env.t - p.time) buf.shift();
    if (buf.length > 4000) buf.splice(0, buf.length - 4000);
    const old = buf[0].d;   // lo más reciente que tenga al menos `time` segundos (o lo más viejo que haya)
    return chopOut([...old.names], old.data, old.len);
  });
chop("select", "Seleccionar canales", "Coge canales de otro CHOP (o de la entrada) por nombre, con * y renombrar (Select CHOP).", [0, 1],
  [opRef("chop", "CHOP (si no hay entrada)", "CHOP"), s("chans", "Canales (* = todos)", "*"), s("rename", "Nuevos nombres", "")],
  ({ p, inputs, env }) => {
    const src = inputs[0] || (p.chop ? env.chop?.(p.chop) : null);
    if (!src) return chopOut([], {}, 1);
    const pats = String(p.chans || "*").split(/[\s,]+/).filter(Boolean).map(w => new RegExp("^" + w.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$"));
    const pick = src.names.filter(n => pats.some(r => r.test(n)));
    const ren = String(p.rename || "").split(/[\s,]+/).filter(Boolean);
    const names = pick.map((n, k) => ren[k] || n);
    return chopOut(names, Object.fromEntries(pick.map((n, k) => [names[k], src.data[n]])), src.len);
  });
chop("merge", "Juntar", "Junta los canales de varias entradas en uno (Merge CHOP).", [1, 4], [],
  ({ inputs }) => {
    const names = [], data = {}; let len = 1;
    for (const ip of inputs) { if (!ip) continue; len = Math.max(len, ip.len); for (const n of ip.names) { let nm = n, k = 2; while (data[nm]) nm = n + k++; names.push(nm); data[nm] = ip.data[n]; } }
    return chopOut(names, data, len);
  });
chop("export", "Exportar a LumaMap", "Manda un canal a cualquier parámetro de LumaMap: opacidad o efectos de una superficie, brillo, luces DMX, 3D… (export de CHOP).", [1, 1],
  [s("chan", "Canal (vacío = el primero)", ""), { k: "target", label: "Parámetro de LumaMap", type: "param", def: "" }, f("lo", "Valor 0 →", 0, -10, 10), f("hi", "Valor 1 →", 1, -10, 10), t("active", "Activo", 1)],
  ({ inputs }) => inputs[0] ? chopOut([...inputs[0].names], inputs[0].data, inputs[0].len) : chopOut([], {}, 1), { exporter: true });
chop("null", "Null (CHOP)", "No cambia nada: para nombrar y referenciar señales (Null CHOP).", [1, 1], [], ({ inputs }) => inputs[0] || chopOut([], {}, 1));

/* ======================= SOP · Geometría ======================= */
const sop = (type, label, desc, inputs, params, extra = {}) => add({ type, fam: "SOP", label, desc, inputs, params, ...extra });
sop("box", "Caja", "Un cubo o caja (Box SOP).", [0, 0], [f("sx", "Ancho", 1, 0, 10), f("sy", "Alto", 1, 0, 10), f("sz", "Fondo", 1, 0, 10)]);
sop("sphere", "Esfera", "Una esfera (Sphere SOP).", [0, 0], [f("radius", "Radio", 0.6, 0, 5), i("detail", "Detalle", 32, 3, 128)]);
sop("torus", "Rosquilla (toro)", "Un toro (Torus SOP).", [0, 0], [f("radius", "Radio", 0.6, 0, 5), f("tube", "Grosor", 0.2, 0.01, 2), i("detail", "Detalle", 48, 3, 200)]);
sop("grid", "Rejilla", "Un plano con divisiones: suelo, pantalla, tela (Grid SOP).", [0, 0], [f("sx", "Ancho", 2, 0, 20), f("sy", "Alto", 2, 0, 20), i("rows", "Filas", 20, 1, 200), i("cols", "Columnas", 20, 1, 200)]);
sop("tube", "Tubo / cilindro", "Un cilindro o cono truncado (Tube SOP).", [0, 0], [f("top", "Radio arriba", 0.4, 0, 5), f("bottom", "Radio abajo", 0.4, 0, 5), f("height", "Altura", 1.2, 0, 10), i("detail", "Detalle", 40, 3, 128)]);
sop("cone", "Cono", "Un cono (Cone SOP).", [0, 0], [f("radius", "Radio", 0.5, 0, 5), f("height", "Altura", 1.2, 0, 10), i("detail", "Detalle", 40, 3, 128)]);
sop("platonic", "Sólido platónico", "Tetraedro, octaedro, dodecaedro o icosaedro (Platonic SOP).", [0, 0],
  [m("kind", "Tipo", [[0, "Tetraedro"], [1, "Octaedro"], [2, "Dodecaedro"], [3, "Icosaedro"]], 3), f("radius", "Radio", 0.7, 0, 5), i("detail", "Subdivisión", 0, 0, 5)]);
sop("knot", "Nudo", "Un nudo toroidal (decorativo).", [0, 0], [f("radius", "Radio", 0.5, 0, 5), f("tube", "Grosor", 0.15, 0.01, 2), i("p", "P", 2, 1, 10), i("q", "Q", 3, 1, 10)]);
sop("circle", "Disco", "Un círculo plano o polígono (Circle SOP).", [0, 0], [f("radius", "Radio", 0.6, 0, 5), i("divs", "Lados", 48, 3, 200)]);
sop("transform", "Transformar (SOP)", "Mueve, gira y escala la geometría (Transform SOP).", [1, 1],
  [...XYZ("t", "Mover"), ...XYZ("r", "Girar", [0, 0, 0], -360, 360), ...XYZ("s", "Escala", [1, 1, 1], 0, 5), f("scale", "Escala uniforme", 1, 0, 5)]);
sop("noise", "Ruido (SOP)", "Deforma la geometría con ruido que se mueve (Noise SOP).", [1, 1], [f("amp", "Fuerza", 0.2, 0, 2), f("period", "Tamaño", 1.5, 0.1, 10), f("speed", "Velocidad", 0.5, 0, 5)]);
sop("merge", "Juntar (SOP)", "Junta varias geometrías en una (Merge SOP).", [1, 4], []);
sop("null", "Null (SOP)", "No cambia nada (Null SOP).", [1, 1], []);

/* ======================= COMP · Objetos 3D ======================= */
const comp = (type, label, desc, inputs, params, extra = {}) => add({ type, fam: "COMP", label, desc, inputs, params, ...extra });
comp("geo", "Objeto 3D (Geometry)", "Pone una geometría (SOP conectado) en la escena con su material; con instancias, cientos de copias movidas por un CHOP (Geometry COMP).", [1, 1],
  [...XYZ("t", "Mover"), ...XYZ("r", "Girar", [0, 0, 0], -360, 360), ...XYZ("s", "Escala", [1, 1, 1], 0, 5), f("scale", "Escala uniforme", 1, 0, 5),
    opRef("material", "Material", "MAT"), t("render", "Se dibuja", 1),
    t("instancing", "Instancias", 0, { page: "Instancias" }), opRef("instanceop", "CHOP de instancias", "CHOP", { page: "Instancias" }),
    i("instances", "Copias (0 = las del CHOP)", 0, 0, 5000, { page: "Instancias" }),
    s("itx", "Canal mover X", "tx", { page: "Instancias" }), s("ity", "Canal mover Y", "ty", { page: "Instancias" }), s("itz", "Canal mover Z", "tz", { page: "Instancias" }),
    s("iscale", "Canal escala", "scale", { page: "Instancias" }), s("iry", "Canal girar Y", "ry", { page: "Instancias" }),
    s("ir", "Canal rojo", "r", { page: "Instancias" }), s("ig", "Canal verde", "g", { page: "Instancias" }), s("ib", "Canal azul", "b", { page: "Instancias" })]);
comp("camera", "Cámara 3D", "Desde dónde se ve la escena (Camera COMP). Muévela con expresiones o con el cuerpo.", [0, 0],
  [...XYZ("t", "Posición", [0, 0.5, 4], -50, 50), ...XYZ("look", "Mira a", [0, 0, 0], -20, 20), f("fov", "Ángulo de visión", 45, 5, 150), t("ortho", "Ortográfica", 0), f("orbit", "Girar alrededor (vueltas/s)", 0, -2, 2)]);
comp("light", "Luz", "Una luz: puntual, del sol, foco o ambiente (Light COMP).", [0, 0],
  [m("kind", "Tipo", [[0, "Puntual"], [1, "Del sol (direccional)"], [2, "Foco"], [3, "Ambiente"]]), c("color", "Color", "#ffffff"), f("intensity", "Intensidad", 2, 0, 20), ...XYZ("t", "Posición", [2, 3, 3], -50, 50)]);

/* ======================= MAT · Materiales ======================= */
const mat = (type, label, desc, params) => add({ type, fam: "MAT", label, desc, inputs: [0, 0], params });
mat("pbr", "Material realista (PBR)", "Color, metal, rugosidad, brillo propio y una imagen de la red como textura (PBR MAT).",
  [c("color", "Color", "#ffffff"), f("metal", "Metal", 0.1), f("rough", "Rugosidad", 0.45), c("emit", "Brillo propio", "#000000"), f("emitAmt", "Cantidad de brillo", 1, 0, 10),
    opRef("map", "Textura (un TOP)", "TOP"), f("opacity", "Opacidad", 1), t("wire", "Solo líneas", 0), t("double", "Dos caras", 1)]);
mat("constant", "Material plano (sin luz)", "Un color o una imagen sin sombras: lo que más se parece a proyectar video (Constant MAT).",
  [c("color", "Color", "#ffffff"), opRef("map", "Textura (un TOP)", "TOP"), f("opacity", "Opacidad", 1), t("wire", "Solo líneas", 0), t("double", "Dos caras", 1)]);
mat("normal", "Colores por dirección", "Pinta cada cara según hacia dónde mira (Normal MAT): para ver la forma.", [t("wire", "Solo líneas", 0)]);
mat("wire", "Líneas (neón)", "Solo las aristas, de un color brillante (Wireframe MAT).", [c("color", "Color", "#00e5ff"), f("opacity", "Opacidad", 1)]);

/* ======================= DAT · Texto y tablas ======================= */
add({ type: "text", fam: "DAT", label: "Texto (DAT)", desc: "Un texto para el Text TOP (Text DAT).", inputs: [0, 0], params: [{ k: "text", label: "Texto", type: "txt", def: "Hola" }] });
add({ type: "table", fam: "DAT", label: "Tabla", desc: "Una tabla de números (filas y columnas separadas por comas) para usar con tab('tabla1', fila, columna) (Table DAT).", inputs: [0, 0],
  params: [{ k: "text", label: "Filas (una por línea, columnas con comas)", type: "txt", def: "0, 0.5, 1\n1, 0.2, 0.8" }] });

/* ---------------- Consultas ---------------- */
export const OPS = Object.fromEntries(ops.map(o => [o.fam + ":" + o.type, o]));
export const OP_LIST = ops;
/** Definición de un operador: fam + tipo («TOP:noise»). */
export const opDef = (fam, type) => OPS[fam + ":" + type] || null;
export const defOf = (node) => node ? opDef(node.fam, node.type) : null;
/** Qué familias acepta como entrada cada familia (los cables solo unen lo que tiene sentido). */
export function acceptsInput(dstFam, dstType, srcFam) {
  if (dstFam === "COMP") return dstType === "geo" && srcFam === "SOP";
  return dstFam === srcFam && ["TOP", "CHOP", "SOP"].includes(srcFam);
}
/** Nombre base de los nodos nuevos (noise → noise1, noise2…) como en TouchDesigner. */
export const baseName = (def) => def.type === "constant" && def.fam === "CHOP" ? "constant" : def.type;
/** Búsqueda para el diálogo «Crear operador» (Tab). */
export function searchOps(q, fam = "") {
  const w = String(q || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  return ops.filter(o => (!fam || o.fam === fam) && (!w || (o.type + " " + o.label + " " + o.desc + " " + o.fam).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").includes(w)));
}
