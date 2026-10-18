// web/js/td/examples.js
// Redes de ejemplo listas para usar y aprender (como los ejemplos de TouchDesigner). Cada una es
// una red normal: se puede abrir, cambiar y conectar a una superficie.
import { newNetwork, addNode, connect } from "./graph.js";

const COL = 210, ROW = 150;
/** Pone un nodo en la rejilla (columna, fila) con parámetros. */
function at(net, fam, type, c, r, p = {}, name = "") { return addNode(net, fam, type, { x: c * COL, y: r * ROW, p, name }); }
/** Conecta en cadena: a → b → c (cada uno a la primera entrada del siguiente). */
const wire = (net, ...chain) => { for (let k = 1; k < chain.length; k++) connect(net, chain[k - 1].id, chain[k].id, 0); };

export const EXAMPLES = [
  { id: "tunnel", name: "Túnel de feedback al ritmo", desc: "Un círculo que deja estela, gira y se aleja; late con la música (Feedback TOP).", build(net) {
    const au = at(net, "CHOP", "audio", 0, 2);
    const circ = at(net, "TOP", "circle", 0, 0, { radius: { e: "0.08 + audio1.bass * 0.12" }, ring: 0.02, color: "#00e5ff", cx: { e: "0.5 + 0.25 * sin(absTime.seconds)" }, cy: { e: "0.5 + 0.2 * cos(absTime.seconds * 1.3)" } });
    const fb = at(net, "TOP", "feedback", 1, 1);
    const tr = at(net, "TOP", "transform", 2, 1, { sx: 0.97, sy: 0.97, rot: 1.2 });
    const hsv = at(net, "TOP", "hsv", 3, 1, { hue: 0.004, val: 0.97 });
    const comp = at(net, "TOP", "composite", 4, 0, { mode: 6 });
    const out = at(net, "TOP", "out", 5, 0);
    wire(net, circ, fb); wire(net, fb, tr, hsv); connect(net, hsv.id, comp.id, 0); connect(net, circ.id, comp.id, 1); wire(net, comp, out);
    fb.p.target = comp.name;
    void au;
    return out;
  } },
  { id: "cube", name: "Cubo 3D con textura de la red", desc: "Ruido de colores pegado a un cubo que gira, con luz y cámara (Render TOP).", build(net) {
    const nz = at(net, "TOP", "noise", 0, 0, { mono: 0, period: 2.5, speed: 0.4 });
    const box = at(net, "SOP", "box", 0, 1);
    const mat = at(net, "MAT", "pbr", 1, 2, { map: nz.name, rough: 0.35, metal: 0.2 });
    const geo = at(net, "COMP", "geo", 1, 1, { material: mat.name, ry: { e: "absTime.seconds * 30" }, rx: { e: "absTime.seconds * 17" } });
    at(net, "COMP", "camera", 2, 2, { tz: 3.2, ty: 0.4 });
    at(net, "COMP", "light", 3, 2, { tx: 2, ty: 3, tz: 3, intensity: 3 });
    const rnd = at(net, "TOP", "render", 2, 1, { bg: "#05060a" });
    const out = at(net, "TOP", "out", 3, 1);
    wire(net, box, geo); wire(net, rnd, out);
    return out;
  } },
  { id: "hand", name: "Mover un objeto 3D con la mano (cámara + IA)", desc: "La mano derecha delante de la cámara mueve la esfera; abrir los brazos la agranda (Cuerpo CHOP → Objeto 3D).", build(net) {
    const tr = at(net, "CHOP", "tracking", 0, 0);
    const flt = at(net, "CHOP", "filter", 1, 0, { up: 0.15, down: 0.15 });
    const sph = at(net, "SOP", "sphere", 0, 1, { radius: 0.35 });
    const mat = at(net, "MAT", "pbr", 1, 2, { color: "#ff3d7f", emit: "#330011", rough: 0.3 });
    const geo = at(net, "COMP", "geo", 2, 1, { material: mat.name, tx: { e: "fit(filter1.right_hand_x, 0, 1, -2, 2)" }, ty: { e: "fit(filter1.right_hand_y, 0, 1, -1.2, 1.2)" }, scale: { e: "0.6 + filter1.spread * 1.5" } });
    at(net, "COMP", "camera", 3, 2, { tz: 4 });
    const rnd = at(net, "TOP", "render", 3, 1);
    const out = at(net, "TOP", "out", 4, 1);
    wire(net, tr, flt); wire(net, sph, geo); wire(net, rnd, out);
    return out;
  } },
  { id: "motion", name: "Mover con el movimiento (sin IA)", desc: "Agita la mano delante de la cámara: el anillo va hacia donde hay movimiento y crece con él (Movimiento CHOP).", build(net) {
    const mo = at(net, "CHOP", "motion", 0, 0, { sens: 0.6 });
    const flt = at(net, "CHOP", "filter", 1, 0, { up: 0.1, down: 0.6 });
    const tor = at(net, "SOP", "torus", 0, 1, { radius: 0.5, tube: 0.12 });
    const mat = at(net, "MAT", "pbr", 1, 2, { color: "#ffd23f", emit: "#663300", emitAmt: { e: "filter1.amount * 3" } });
    const geo = at(net, "COMP", "geo", 2, 1, { material: mat.name, tx: { e: "fit(filter1.x, 0, 1, -2, 2)" }, ty: { e: "fit(filter1.y, 0, 1, -1.2, 1.2)" }, scale: { e: "0.5 + filter1.amount * 2" }, rx: { e: "absTime.seconds * 40" } });
    at(net, "COMP", "camera", 3, 2, { tz: 4 });
    const rnd = at(net, "TOP", "render", 3, 1);
    const out = at(net, "TOP", "out", 4, 1);
    wire(net, mo, flt); wire(net, tor, geo); wire(net, rnd, out);
    return out;
  } },
  { id: "bars", name: "Barras 3D del sonido (instancias)", desc: "32 cubos, uno por banda del espectro, que crecen con la música (Instancias en el Geometry COMP).", build(net) {
    const sp = at(net, "CHOP", "spectrum", 0, 0, { bins: 32, gain: 1.5 });
    const ren = at(net, "CHOP", "select", 1, 0, { chans: "spectrum", rename: "scale" });
    const flt = at(net, "CHOP", "filter", 2, 0, { up: 0.03, down: 0.25 });
    const mth = at(net, "CHOP", "math", 3, 0, { mult: 3, add: 0.15 });
    const pos = at(net, "CHOP", "pattern", 0, 1, { kind: 3, length: 32, amp: 6, offset: -3, name: "tx" });
    const col = at(net, "CHOP", "pattern", 1, 1, { kind: 3, length: 32, amp: 1, name: "r" });
    const mg = at(net, "CHOP", "merge", 4, 0);
    const box = at(net, "SOP", "box", 3, 2, { sx: 0.16, sy: 0.6, sz: 0.16 });
    const mat = at(net, "MAT", "pbr", 4, 3, { color: "#ffffff", emit: "#002233" });
    const geo = at(net, "COMP", "geo", 4, 2, { material: mat.name, instancing: 1, instanceop: mg.name, ity: "", ig: "", ib: "" });
    at(net, "COMP", "camera", 5, 3, { tz: 5, ty: 1.5, looky: 0.3, orbit: 0.03 });
    const rnd = at(net, "TOP", "render", 5, 2, { bg: "#020308" });
    const out = at(net, "TOP", "out", 6, 2);
    wire(net, sp, ren, flt, mth); connect(net, mth.id, mg.id, 0); connect(net, pos.id, mg.id, 1); connect(net, col.id, mg.id, 2);
    wire(net, box, geo); wire(net, rnd, out);
    return out;
  } },
  { id: "camkaleido", name: "Cámara en caleidoscopio con bordes", desc: "La cámara, sus bordes de neón y un caleidoscopio que gira (Video Device In + Edge + Kaleido).", build(net) {
    const cam = at(net, "TOP", "videoin", 0, 0);
    const edge = at(net, "TOP", "edge", 1, 0, { strength: 4, color: 1 });
    const hsv = at(net, "TOP", "hsv", 2, 0, { hue: { e: "absTime.seconds * 0.1" }, sat: 2 });
    const kal = at(net, "TOP", "kaleido", 3, 0, { segments: 8, rot: { e: "absTime.seconds * 10" } });
    const glow = at(net, "TOP", "glow", 4, 0, { threshold: 0.3, amount: 2 });
    const out = at(net, "TOP", "out", 5, 0);
    wire(net, cam, edge, hsv, kal, glow, out);
    return out;
  } },
  { id: "text", name: "Texto que late con el ritmo", desc: "Un texto que crece en cada golpe y cambia de color (Text TOP + Trigger CHOP).", build(net) {
    const bt = at(net, "CHOP", "beat", 0, 1);
    const sel = at(net, "CHOP", "select", 1, 1, { chans: "beat" });
    const trg = at(net, "CHOP", "trigger", 2, 1, { threshold: 0.5, release: 0.4 });
    const txt = at(net, "TOP", "text", 0, 0, { text: "LUMAMAP", size: 0.2, glow: 0.4, color: "#ffffff" });
    const tr = at(net, "TOP", "transform", 1, 0, { sx: { e: "1 + trigger1.beat * 0.4" }, sy: { e: "1 + trigger1.beat * 0.4" } });
    const hsv = at(net, "TOP", "lookup", 2, 0, { map: 3 });
    const out = at(net, "TOP", "out", 3, 0);
    wire(net, bt, sel, trg); wire(net, txt, tr, hsv, out);
    return out;
  } },
  { id: "glsl", name: "Plasma programado (GLSL)", desc: "Un shader escrito a mano, con un parámetro movido por un LFO (GLSL TOP).", build(net) {
    const lfo = at(net, "CHOP", "lfo", 0, 1, { rate: 0.2, amp: 0.5, offset: 0.5 });
    const gl = at(net, "TOP", "glsl", 0, 0, { code: "vec2 p = (uv - 0.5) * vec2(res.x / res.y, 1.0) * (2.0 + u1 * 4.0);\nfloat v = sin(p.x * 3.0 + time) + sin(p.y * 4.0 - time * 1.3) + sin(length(p) * 5.0 - time * 2.0);\nvec3 col = 0.5 + 0.5 * cos(v + vec3(0.0, 2.1, 4.2));\nreturn vec4(col, 1.0);", u1: { e: "lfo1.chan1" } });
    const out = at(net, "TOP", "out", 1, 0);
    wire(net, gl, out); void lfo;
    return out;
  } },
  { id: "displace", name: "Imagen que se deforma con ruido", desc: "Un video o foto de tu biblioteca (o un patrón) deformado por ruido que se mueve (Displace TOP).", build(net, project) {
    const media = project?.media?.find(m => m.kind === "video" || m.kind === "image" || m.kind === "anim");
    const src = media ? at(net, "TOP", "moviein", 0, 0, { media: media.id }) : at(net, "TOP", "pattern", 0, 0, { kind: 0, size: 10, speed: 0.2 });
    const nz = at(net, "TOP", "noise", 0, 1, { mono: 0, period: 2, speed: 0.3 });
    const dp = at(net, "TOP", "displace", 1, 0, { weight: 0.08 });
    const out = at(net, "TOP", "out", 2, 0);
    connect(net, src.id, dp.id, 0); connect(net, nz.id, dp.id, 1); wire(net, dp, out);
    return out;
  } },
  { id: "sparks", name: "Chispas 3D que explotan con el golpe", desc: "Partículas que brillan, giran en remolinos y explotan en cada golpe de la música (Partículas + Render 3D).", build(net) {
    const au = at(net, "CHOP", "audio", 0, 2);
    const ps = at(net, "COMP", "particles", 1, 2, { emitter: 2, esize: 0.15, outward: 1, rate: 120, speed: 1.4, gravity: -0.4, turb: 1.2, life: 2.2, burstCount: 600, trig: { e: "audio1.beat" }, color1: "#fff3b0", color2: "#ff2d8a", psize: 0.07 });
    at(net, "COMP", "camera", 2, 3, { tz: 5, ty: 0.6, orbit: 0.02 });
    const rnd = at(net, "TOP", "render", 2, 1, { bg: "#020206" });
    const glow = at(net, "TOP", "glow", 3, 1, { threshold: 0.2, amount: 1.5 });
    const out = at(net, "TOP", "out", 4, 1);
    wire(net, rnd, glow, out);
    void au; void ps;
    return out;
  } },
  { id: "model", name: "Tu modelo 3D girando con luces", desc: "Un modelo de tu biblioteca (.glb, .obj, .fbx…; si no hay, un icosaedro) que gira con dos luces de colores (Modelo 3D SOP).", build(net, project) {
    const model = project?.media?.find(m => m.kind === "model");
    const src = model ? at(net, "SOP", "file", 0, 1, { model: model.id, size: 2 }) : at(net, "SOP", "platonic", 0, 1, { kind: 3, radius: 0.9, detail: 1 });
    const mat = at(net, "MAT", "pbr", 1, 2, { color: "#d8dde8", metal: 0.6, rough: 0.25 });
    const geo = at(net, "COMP", "geo", 1, 1, { material: mat.name, ry: { e: "absTime.seconds * 25" } });
    at(net, "COMP", "light", 2, 2, { kind: 0, color: "#00e5ff", intensity: 6, tx: -2.5, ty: 1.5, tz: 2 });
    at(net, "COMP", "light", 3, 2, { kind: 0, color: "#ff2d8a", intensity: 6, tx: 2.5, ty: 1, tz: 2 });
    at(net, "COMP", "camera", 2, 3, { tz: 4.2, ty: 0.8 });
    const rnd = at(net, "TOP", "render", 2, 1, { bg: "#05060a", ambient: 0.15 });
    const out = at(net, "TOP", "out", 3, 1);
    wire(net, src, geo); wire(net, rnd, out);
    return out;
  } },
  { id: "keys", name: "Título animado con fotogramas clave", desc: "Un texto que entra, se para y sale con curvas ◆ (Animación CHOP + línea de tiempo). Abre «Curvas» (K) para cambiarlas.", build(net) {
    const an = at(net, "CHOP", "animation", 0, 1, { anim: { length: 6, chans: [
      { name: "x", keys: [{ t: 0, v: -0.8, e: "out" }, { t: 1.5, v: 0, e: "smooth" }, { t: 4.5, v: 0, e: "in" }, { t: 6, v: 0.8, e: "smooth" }] },
      { name: "escala", keys: [{ t: 0, v: 0.6, e: "spline" }, { t: 1.5, v: 1, e: "spline" }, { t: 3, v: 1.15, e: "spline" }, { t: 4.5, v: 1, e: "spline" }, { t: 6, v: 0.6, e: "spline" }] },
      { name: "brillo", keys: [{ t: 0, v: 0, e: "linear" }, { t: 1, v: 1, e: "step" }, { t: 5, v: 1, e: "linear" }, { t: 6, v: 0, e: "linear" }] }] } });
    const txt = at(net, "TOP", "text", 0, 0, { text: "LUMAMAP", size: 0.22, glow: 0.5, color: "#00e5ff" });
    const tr = at(net, "TOP", "transform", 1, 0, { tx: { e: "animation1.x" }, sx: { e: "animation1.escala" }, sy: { e: "animation1.escala" } });
    const lv = at(net, "TOP", "level", 2, 0, { brightness: { e: "animation1.brillo" } });
    const out = at(net, "TOP", "out", 3, 0);
    wire(net, txt, tr, lv, out);
    net.timeline.length = 6;
    void an;
    return out;
  } },
  { id: "panel", name: "Panel de control para un efecto", desc: "Deslizadores, un botón y un pad XY que mueven un caleidoscopio en vivo (Red → Panel de control, o F11 para actuar con ellos).", build(net) {
    const sl1 = at(net, "COMP", "slider", 0, 2, { value: 0.3, min: 2, max: 16, label: "Partes" });
    const sl2 = at(net, "COMP", "slider", 0, 3, { value: 0.5, min: 0, max: 2, label: "Color" });
    const bt = at(net, "COMP", "button", 1, 3, { label: "Flash", mode: 0 });
    const xy = at(net, "COMP", "xy", 1, 2, { label: "Centro" });
    const nz = at(net, "TOP", "noise", 0, 0, { mono: 0, period: 4, speed: 0.4 });
    const kal = at(net, "TOP", "kaleido", 1, 0, { segments: { e: `round(${sl1.name}.value)` }, rot: { e: "absTime.seconds * 20" } });
    const tr = at(net, "TOP", "transform", 2, 0, { tx: { e: `(${xy.name}.x - 0.5) * 0.5` }, ty: { e: `(${xy.name}.y - 0.5) * 0.5` }, extend: 2 });
    const hsv = at(net, "TOP", "hsv", 3, 0, { sat: { e: `${sl2.name}.value` } });
    const lv = at(net, "TOP", "level", 4, 0, { brightness: { e: `1 + ${bt.name}.value * 1.5` } });
    const out = at(net, "TOP", "out", 5, 0);
    wire(net, nz, kal, tr, hsv, lv, out);
    return out;
  } },
];

/** Crea una red nueva a partir de un ejemplo. Devuelve { net, out }. */
export function buildExample(id, project) {
  const ex = EXAMPLES.find(e => e.id === id);
  if (!ex) return null;
  const net = newNetwork(ex.name);
  const out = ex.build(net, project);
  net.display = out?.id || net.display;
  return { net, out };
}
