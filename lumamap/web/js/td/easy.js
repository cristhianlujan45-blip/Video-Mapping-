// web/js/td/easy.js
// Modo fácil del editor de redes: lo mismo que TouchDesigner, pero sin jerga. En vez de 113
// operadores en familias (TOP, CHOP, SOP…), unas tarjetas por lo que quieres HACER («Empieza con
// una imagen», «Cámbiala», «Que se mueva sola»…), con nombres de todos los días. Lo nuevo se
// conecta solo en la cadena (antes de la Salida) y cualquier control se mueve solo con la
// música, una onda o la mano sin escribir expresiones. Este archivo solo tiene datos y cuentas
// (sin pantalla) para poder probarlo; la interfaz está en panels-network.js.
import { opDef } from "./ops.js";

/** Las familias con nombres de todos los días. */
export const EASY_FAMS = {
  TOP: { icon: "🖼", name: "Imagen" }, CHOP: { icon: "〰", name: "Movimiento" }, SOP: { icon: "🧊", name: "Forma 3D" },
  COMP: { icon: "🎬", name: "3D y controles" }, MAT: { icon: "🎨", name: "Material" }, DAT: { icon: "📝", name: "Texto" },
};

/** Lo que hace que algo se mueva solo (un canal que va de 0 a 1). */
export const MOVERS = [
  { key: "music", emoji: "🎵", label: "Con la música", desc: "Sube y baja con los graves", type: "audio", chan: "bass" },
  { key: "beat", emoji: "🥁", label: "Al golpe", desc: "Salta en cada golpe del ritmo", type: "beat", chan: "beat" },
  { key: "wave", emoji: "〜", label: "Onda suave", desc: "Va y viene despacio, siempre", type: "lfo", chan: "chan1", p: { amp: 0.5, offset: 0.5, rate: 0.25 } },
  { key: "random", emoji: "✨", label: "Al azar suave", desc: "Cambia sin parar, sin saltos", type: "noise", chan: "chan1", p: { amp: 0.5, offset: 0.5, rate: 0.4 } },
  { key: "hand", emoji: "✋", label: "Con la mano", desc: "Sube la mano delante de la cámara", type: "tracking", chan: "right_hand_y" },
  { key: "motion", emoji: "🌀", label: "Con el movimiento", desc: "Cuanto más se mueve la gente delante de la cámara, más", type: "motion", chan: "amount" },
];

/**
 * Las tarjetas de «＋ Añadir», por lo que quieres hacer.
 * Cada una: { key, emoji, label, desc, fam, type, p? } (un operador) o { key, emoji, label, desc, act } (una acción).
 */
export const EASY_GROUPS = [
  { id: "start", title: "1 · Empieza con una imagen", hint: "Lo primero de la cadena: de aquí sale la imagen.", items: [
    { key: "colors", emoji: "🌈", label: "Colores que se mueven", desc: "Manchas de colores suaves que no paran", fam: "TOP", type: "noise", p: { kind: 1, amp: 1 } },
    { key: "gradient", emoji: "🎨", label: "Degradado", desc: "De un color a otro", fam: "TOP", type: "ramp" },
    { key: "circle", emoji: "⭕", label: "Círculo", desc: "Un círculo o un aro", fam: "TOP", type: "circle" },
    { key: "pattern", emoji: "▦", label: "Rayas y cuadros", desc: "Rayas, cuadros o puntos que se repiten", fam: "TOP", type: "pattern" },
    { key: "text", emoji: "🔤", label: "Texto", desc: "Escribe lo que quieras", fam: "TOP", type: "text", p: { text: "Hola" } },
    { key: "video", emoji: "🎞", label: "Tu video o foto", desc: "Uno de tu biblioteca", fam: "TOP", type: "moviein" },
    { key: "camera", emoji: "📷", label: "Tu cámara", desc: "La imagen en vivo de la cámara", fam: "TOP", type: "videoin" },
    { key: "plugin", emoji: "✨", label: "Animación de la biblioteca", desc: "Cualquier shader de los plugins instalados", fam: "TOP", type: "plugin" },
  ] },
  { id: "change", title: "2 · Cámbiala", hint: "Se pone justo después de lo que tengas elegido.", items: [
    { key: "level", emoji: "☀", label: "Brillo y contraste", desc: "Más luz, más contraste u opacidad", fam: "TOP", type: "level" },
    { key: "hsv", emoji: "🎨", label: "Colores", desc: "Cambia el tono y la intensidad del color", fam: "TOP", type: "hsv" },
    { key: "kaleido", emoji: "❄", label: "Caleidoscopio", desc: "Repite la imagen en estrella", fam: "TOP", type: "kaleido" },
    { key: "mirror", emoji: "🪞", label: "Espejo", desc: "La mitad se refleja en la otra", fam: "TOP", type: "mirror" },
    { key: "tile", emoji: "🔲", label: "Repetir", desc: "Muchas copias en mosaico", fam: "TOP", type: "tile" },
    { key: "blur", emoji: "💧", label: "Desenfocar", desc: "Suave y borroso", fam: "TOP", type: "blur" },
    { key: "pixelate", emoji: "👾", label: "Píxeles", desc: "Como un videojuego antiguo", fam: "TOP", type: "pixelate" },
    { key: "wave", emoji: "🌊", label: "Ondas", desc: "La imagen ondula como el agua", fam: "TOP", type: "wave" },
    { key: "polar", emoji: "🌀", label: "Túnel", desc: "La imagen se enrolla en un túnel", fam: "TOP", type: "polar" },
    { key: "glow", emoji: "🔆", label: "Resplandor neón", desc: "Lo claro brilla y se expande", fam: "TOP", type: "glow" },
    { key: "edge", emoji: "✏", label: "Solo los bordes", desc: "Dibuja los contornos", fam: "TOP", type: "edge" },
    { key: "rgbsplit", emoji: "📺", label: "Separar colores", desc: "Efecto glitch de televisor", fam: "TOP", type: "rgbsplit" },
  ] },
  { id: "mix", title: "3 · Mézclala con otra", hint: "Después elige otra imagen en «1 · Empieza»: entra sola en la mezcla.", items: [
    { key: "add", emoji: "➕", label: "Sumar luz", desc: "Las dos a la vez, como dos proyectores", fam: "TOP", type: "add" },
    { key: "over", emoji: "🧅", label: "Una encima de otra", desc: "La segunda tapa a la primera", fam: "TOP", type: "over" },
    { key: "multiply", emoji: "✖", label: "Multiplicar", desc: "Lo oscuro de una tapa a la otra", fam: "TOP", type: "multiply" },
  ] },
  { id: "move", title: "4 · Que se mueva sola", hint: "Mueve el control principal de lo que tengas elegido (o pulsa 〰 junto a cualquier control).", items:
    MOVERS.map(m => ({ key: "move-" + m.key, emoji: m.emoji, label: m.label, desc: m.desc, act: "move", mover: m.key })) },
  { id: "3d", title: "5 · 3D", hint: "Un objeto 3D con su cámara: sale como una imagen más.", items: [
    { key: "cube", emoji: "🧊", label: "Cubo que gira", desc: "Un cubo 3D girando", act: "3d", shape: "box" },
    { key: "sphere", emoji: "🔮", label: "Esfera que gira", desc: "Una esfera 3D", act: "3d", shape: "sphere" },
    { key: "knot", emoji: "➰", label: "Nudo que gira", desc: "Un nudo retorcido", act: "3d", shape: "knot" },
    { key: "particles", emoji: "🎆", label: "Partículas", desc: "Chispas que salen sin parar", act: "particles" },
  ] },
  { id: "show", title: "6 · Mostrar", hint: "Al final de la cadena.", items: [
    { key: "out", emoji: "📺", label: "Salida (lo que se proyecta)", desc: "La imagen final de la red", fam: "TOP", type: "out" },
    { key: "record", emoji: "⏺", label: "Grabar video", desc: "Guarda lo que sale en un video", fam: "TOP", type: "movieout" },
  ] },
];

/** Una tarjeta por su clave. */
export const easyItem = (key) => EASY_GROUPS.flatMap(g => g.items).find(i => i.key === key) || null;
/** El mover por su clave. */
export const mover = (key) => MOVERS.find(m => m.key === key) || null;

// El control que más se nota de cada operador (para «Que se mueva sola» sin elegir).
const MAIN = { noise: "period", ramp: "period", circle: "radius", pattern: "rot", text: "size", level: "brightness", hsv: "hue", kaleido: "rot",
  tile: "rx", blur: "size", pixelate: "size", wave: "amp", polar: "twist", glow: "amount", edge: "strength", rgbsplit: "amount", add: "opacity",
  over: "opacity", multiply: "opacity", moviein: "speed", plugin: "speed", transform: "rot" };
/** El parámetro principal (numérico) de un nodo: { k, label, min, max, def } o null. */
export function mainParam(node) {
  const def = opDef(node.fam, node.type);
  if (!def) return null;
  const nums = def.params.filter(q => (q.type === "f" || q.type === "i") && !q.hidden);
  return nums.find(q => q.k === MAIN[node.type]) || nums[0] || null;
}
/**
 * La expresión que mueve un parámetro con un canal de 0 a 1: de su valor por defecto hacia
 * arriba (la mitad de su recorrido), sin pasarse del máximo. Si el parámetro va de 0 a 1, entero.
 */
export function moveExpr(chopName, chan, q) {
  const min = +q.min || 0, max = q.max ?? 1, base = typeof q.def === "number" ? q.def : min;
  if (min === 0 && max === 1) return `${chopName}.${chan}`;
  const span = (max - min) * 0.5;
  let lo = base, hi = Math.min(max, base + span);
  if (hi - lo < span * 0.25) { hi = base; lo = Math.max(min, base - span); }   // ya cerca del máximo: hacia abajo
  const r = (x) => Math.round(x * 1000) / 1000;
  return `fit(${chopName}.${chan}, 0, 1, ${r(lo)}, ${r(hi)})`;
}
/** ¿Es una tarjeta de imagen que empieza la cadena (sin entradas)? */
export const isSource = (item) => !!item?.fam && (opDef(item.fam, item.type)?.inputs[0] === 0) && item.type !== "out";
