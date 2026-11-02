// web/js/td/build.js
// «✨ Escribe y se construye»: describes lo que quieres («colores que bailan con la música en
// caleidoscopio», «mi cámara con estela de neón», «un cubo 3D que gira con ruido») y la red de
// nodos se arma sola, nodo a nodo, delante de ti.
//   · Con IA (local o en la nube): el modelo devuelve un PLAN en JSON con los operadores del
//     catálogo; aquí se valida todo (operadores, parámetros, rangos, colores, cables, expresiones)
//     antes de tocar la red. Nada inventado llega a la red.
//   · Sin IA: un planificador propio entiende la frase (español e inglés) y arma recetas probadas.
// El plan:
//   { title, say, nodes: [{ id, op: "TOP/noise", name?, p: { k: valor | { e: "expresión" } } }],
//     wires: [{ from, to, input? }], moves: [{ node, param?, with: music|beat|wave|random|hand|motion }] }
// Este archivo no toca la pantalla (se prueba en Node); la interfaz está en panels-network.js.
import { OP_LIST, opDef } from "./ops.js";
import { addNode, connect, nodeByName } from "./graph.js";
import { MOVERS, moveExpr, mainParam } from "./easy.js";
import { compileExpr, EXPR_FUNCS } from "./expr.js";

export const MAX_PLAN_NODES = 24;
const COL = 210, ROW = 150;
const strip = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/* ------------------------------------------------------------------ catálogo para la IA */

/** El catálogo en pocas líneas (lo que la IA puede usar). */
export function catalogText() {
  const fmt = (q) => {
    if (q.type === "f" || q.type === "i") return `${q.k}(${q.type === "i" ? "entero " : ""}${q.min ?? ""}..${q.max ?? ""}, ${q.def})`;
    if (q.type === "m") return `${q.k}(menú: ${q.opts.map(([v, l]) => `${v}=${l}`).join(", ")})`;
    if (q.type === "t") return `${q.k}(0/1)`;
    if (q.type === "c") return `${q.k}(color #rrggbb)`;
    if (q.type === "s") return `${q.k}(texto)`;
    if (q.type === "op") return `${q.k}(id de otro nodo ${q.fam || ""})`;
    return null;
  };
  return OP_LIST.filter(d => !["in", "out", "script", "execute", "replicator", "window", "base", "select", "animation", "input"].includes(d.type) || (d.fam === "TOP" && d.type === "out"))
    .map(d => `${d.fam}/${d.type} «${d.label}» entradas ${d.inputs[0]}-${d.inputs[1]}: ${d.params.filter(q => !q.hidden).map(fmt).filter(Boolean).join(" ")}`).join("\n");
}

export const PLAN_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" }, say: { type: "string" },
    nodes: { type: "array", items: { type: "object", properties: { id: { type: "string" }, op: { type: "string" }, p: { type: "object" } }, required: ["id", "op"] } },
    wires: { type: "array", items: { type: "object", properties: { from: { type: "string" }, to: { type: "string" }, input: { type: "number" } }, required: ["from", "to"] } },
    moves: { type: "array", items: { type: "object", properties: { node: { type: "string" }, param: { type: "string" }, with: { type: "string" }, range: { type: "array", items: { type: "number" } } }, required: ["node", "with"] } },
  },
  required: ["nodes"],
};

export const BUILD_SYSTEM = `Eres el constructor de redes de nodos de LumaMap (como TouchDesigner). Conviertes lo que pide la persona en un PLAN JSON con los operadores del catálogo.
Reglas:
- Usa SOLO operadores del catálogo ("op": "FAM/tipo") y SOLO sus parámetros. Valores dentro de su rango; colores #rrggbb; menús con su número.
- Cables ("wires"): la imagen va de izquierda a derecha: fuente TOP → efectos TOP → "TOP/out" (la Salida: termina SIEMPRE en una). Las mezclas (add, over, multiply, composite) tienen la entrada 0 y 1.
- 3D: SOP (forma) → COMP/geo; un COMP/camera, un COMP/light y un TOP/render (sin cables: el render ve todas las geo) → efectos → TOP/out. Material: MAT/pbr y en la geo "material": id del MAT.
- Partículas: COMP/particles + COMP/camera + TOP/render.
- Para que algo se mueva con la música, el golpe, una onda, al azar, la mano o el movimiento usa "moves": [{"node": id, "param": "k", "with": "music|beat|wave|random|hand|motion", "range": [de, a]}] (range opcional).
- Una expresión es {"e": "..."} con absTime.seconds, sin(), cos(), fit(); úsalas poco (giro: {"e": "absTime.seconds * 30"}).
- Feedback (estela): TOP/feedback con su parámetro "target" = id del nodo cuyo fotograma anterior se lee.
- Máximo ${MAX_PLAN_NODES} nodos. Ids cortos (a, b, c…). "say": una frase en español de lo que construiste.
Responde SOLO el JSON: {"title": "...", "say": "...", "nodes": [...], "wires": [...], "moves": [...]}`;

/** El mensaje para la IA: la petición, el catálogo y (si hay) la red actual. */
export function buildPrompt(text, netSummary = "") {
  return [`PETICIÓN: ${String(text).slice(0, 600)}`, netSummary ? `RED ACTUAL (para no repetir nombres): ${netSummary}` : "", `CATÁLOGO:\n${catalogText()}`].filter(Boolean).join("\n\n");
}

/* ------------------------------------------------------------------ validar un plan */

const HEX = /^#[0-9a-f]{6}$/i;
const COLOR_WORDS = {
  rojo: "#ff2a2a", red: "#ff2a2a", azul: "#2a6bff", blue: "#2a6bff", verde: "#22e06b", green: "#22e06b", amarillo: "#ffd400", yellow: "#ffd400",
  naranja: "#ff7a00", orange: "#ff7a00", rosa: "#ff4fd8", pink: "#ff4fd8", morado: "#8b3dff", violeta: "#8b3dff", purple: "#8b3dff", lila: "#b48cff",
  cian: "#00e5ff", cyan: "#00e5ff", turquesa: "#00e5c0", blanco: "#ffffff", white: "#ffffff", dorado: "#ffc84a", oro: "#ffc84a", gold: "#ffc84a",
  magenta: "#ff00b4", fucsia: "#ff00b4", negro: "#000000", black: "#000000",
};
/** Un color de lo que diga la IA o la persona («#ff0000», «rojo»…), o null. */
export function colorOf(v) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (HEX.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) return ("#" + [...s.slice(1)].map(c => c + c).join("")).toLowerCase();
  const w = strip(s);
  return COLOR_WORDS[w] || COLOR_WORDS[w.replace(/(es|s)$/, "")] || COLOR_WORDS[w.replace(/as$/, "o").replace(/a$/, "o")] || COLOR_WORDS[w.replace(/es$/, "")] || null;
}
const COLOR_RE = /\b(roj[oa]s?|red|azul(?:es)?|blue|verdes?|green|amarill[oa]s?|yellow|naranjas?|orange|rosas?|pink|morad[oa]s?|violetas?|purple|lilas?|cian|cyan|turquesas?|blanc[oa]s?|white|dorad[oa]s?|oro|gold|magentas?|fucsias?)\b/g;
/**
 * Una expresión de un plan: compila, solo usa funciones conocidas (sin, fit, noise…) y solo mira
 * el tiempo (absTime, me). Las referencias a otros nodos van por «moves» (los nombres reales no
 * existen hasta crearlos).
 */
function okExpr(e, names = null) {
  if (typeof e !== "string" || !e.trim() || e.length > 200) return false;
  const c = compileExpr(e);
  if (c.error) return false;
  if ([...c.refs].some(r => r !== "absTime" && r !== "me" && !names?.has(r))) return false;
  for (const m of e.matchAll(/([A-Za-z_]\w*)\s*\(/g)) if (!EXPR_FUNCS.includes(m[1])) return false;
  return true;
}

/**
 * Un valor de parámetro válido para q, o undefined. refs: ids del plan (para los tipo «op»);
 * names: nombres de nodos que ya existen (en una red de verdad: sus expresiones y referencias).
 */
function cleanValue(q, v, refs, names = null) {
  if (v && typeof v === "object" && typeof v.e === "string") return (q.type === "f" || q.type === "i" || q.type === "t") && okExpr(v.e, names) ? { e: v.e } : undefined;
  switch (q.type) {
    case "f": case "i": {
      const n = typeof v === "boolean" ? +v : +v;
      if (!Number.isFinite(n)) return undefined;
      let x = q.type === "i" ? Math.round(n) : n;
      if (q.min != null) x = Math.max(q.min, x);
      if (q.max != null) x = Math.min(q.max, x);
      return x;
    }
    case "t": return v === true || v === 1 || v === "1" || v === "true" ? 1 : 0;
    case "m": {
      const vals = q.opts.map(o => o[0]);
      if (vals.includes(+v)) return +v;
      const byLabel = q.opts.find(o => strip(o[1]) === strip(v));
      return byLabel ? byLabel[0] : undefined;
    }
    case "c": return colorOf(v) ?? undefined;
    case "s": case "txt": return typeof v === "string" || typeof v === "number" ? String(v).replace(/[<>]/g, "").slice(0, q.type === "s" ? 120 : 2000) : undefined;
    case "op": return typeof v === "string" && refs.has(v) ? { ref: v } : typeof v === "string" && names?.has(v) ? v : v === "" ? "" : undefined;
    default: return undefined;   // código, archivos, cámaras…: los elige la persona
  }
}

/**
 * Parámetros para un nodo que ya existe en una red (los cambia el agente MCP): mismas reglas que
 * un plan, pero las expresiones pueden mirar otros nodos de la red por su nombre.
 * Devuelve { p, warnings }.
 */
export function cleanParams(fam, type, raw, names = new Set()) {
  const def = opDef(fam, type), p = {}, warnings = [];
  if (!def) return { p, warnings: [`no existe ${fam}/${type}`] };
  for (const [k, v] of Object.entries(raw && typeof raw === "object" ? raw : {})) {
    const q = def.params.find(x => x.k === k);
    if (!q) { warnings.push(`${type}: no tiene «${k}»`); continue; }
    const c = cleanValue(q, v, new Set(), names);
    if (c === undefined) warnings.push(`${type}.${k}: valor no válido`); else p[k] = c;
  }
  return { p, warnings };
}

/** Acepta «TOP/noise», {fam,type} o un nombre suelto («noise»): { fam, type, def } o null. */
export function resolveOp(op, fam, type) {
  let F = fam, T = type;
  if (typeof op === "string") { const m = op.trim().match(/^([A-Za-z]+)\s*[/.:]\s*(\w+)$/); if (m) { F = m[1].toUpperCase(); T = m[2]; } else T = op.trim(); }
  if (F && T) { const d = opDef(F, T); return d ? { fam: F, type: T, def: d } : null; }
  if (T) { const d = OP_LIST.find(x => x.type === T && x.fam === "TOP") || OP_LIST.find(x => x.type === T); return d ? { fam: d.fam, type: d.type, def: d } : null; }
  return null;
}

/** ¿Puede un nodo de la familia src entrar en dst? */
function canWire(src, dst) {
  if (dst.fam === "TOP") return src.fam === "TOP";
  if (dst.fam === "CHOP") return src.fam === "CHOP";
  if (dst.fam === "SOP") return src.fam === "SOP";
  if (dst.fam === "COMP") return src.fam === "SOP";
  return false;
}

/**
 * Comprueba y arregla un plan (de la IA o de las reglas). Devuelve { plan, warnings }.
 * Lo que no existe se quita (y se dice); falta la Salida → se añade; 3D sin cámara o sin
 * render → se añaden; los cables imposibles o que harían un bucle se quitan.
 */
export function validatePlan(raw) {
  const warnings = [];
  const src = raw && typeof raw === "object" ? raw : {};
  const nodes = [], ids = new Set();
  for (const n of (Array.isArray(src.nodes) ? src.nodes : []).slice(0, MAX_PLAN_NODES)) {
    const r = resolveOp(n?.op, n?.fam, n?.type);
    if (!r) { warnings.push(`no existe el operador «${n?.op || n?.type}»`); continue; }
    let id = String(n.id || "").replace(/[^\w-]/g, "").slice(0, 24) || "n" + nodes.length;
    while (ids.has(id)) id += "_";
    ids.add(id);
    nodes.push({ id, fam: r.fam, type: r.type, name: typeof n.name === "string" ? n.name.replace(/[^\w]/g, "").slice(0, 24) : "", rawP: n.p && typeof n.p === "object" ? n.p : {} });
  }
  for (const n of nodes) {
    const def = opDef(n.fam, n.type), p = {};
    for (const [k, v] of Object.entries(n.rawP)) {
      const q = def.params.find(x => x.k === k);
      if (!q) { warnings.push(`${n.type}: no tiene «${k}»`); continue; }
      const c = cleanValue(q, v, ids);
      if (c === undefined) warnings.push(`${n.type}.${k}: valor no válido`);
      else p[k] = c;
    }
    n.p = p; delete n.rawP;
  }
  const byId = new Map(nodes.map(n => [n.id, n]));
  // Cables: familias compatibles, entradas que existen, sin repetir entrada y sin bucles.
  const wires = [], used = new Set();
  const reaches = (a, b) => { const seen = new Set(), st = [a]; while (st.length) { const x = st.pop(); if (x === b) return true; if (seen.has(x)) continue; seen.add(x); for (const w of wires) if (w.from === x) st.push(w.to); } return false; };
  for (const w of Array.isArray(src.wires) ? src.wires : []) {
    const from = byId.get(String(w?.from ?? (Array.isArray(w) ? w[0] : ""))), to = byId.get(String(w?.to ?? (Array.isArray(w) ? w[1] : "")));
    if (!from || !to || from === to) { warnings.push("cable con un nodo que no existe"); continue; }
    const tdef = opDef(to.fam, to.type);
    let input = Math.max(0, Math.round(+(w.input ?? (Array.isArray(w) ? w[2] : 0)) || 0));
    if (!canWire(from, to) || tdef.inputs[1] === 0) { warnings.push(`no se puede conectar ${from.type} → ${to.type}`); continue; }
    if (input >= tdef.inputs[1] || used.has(to.id + ":" + input)) input = [...Array(tdef.inputs[1]).keys()].find(k => !used.has(to.id + ":" + k)) ?? -1;
    if (input < 0) { warnings.push(`${to.type} no tiene más entradas`); continue; }
    if (reaches(to.id, from.id)) { warnings.push(`${from.type} → ${to.type} haría un bucle (usa Feedback)`); continue; }
    used.add(to.id + ":" + input);
    wires.push({ from: from.id, to: to.id, input });
  }
  const hasIn = (n, k = 0) => used.has(n.id + ":" + k);
  const add = (fam, type, p = {}, id = type) => { let i = id; while (byId.has(i)) i += "_"; const n = { id: i, fam, type, name: "", p }; nodes.push(n); byId.set(i, n); return n; };
  // 3D: render, cámara y luz si faltan.
  const geos = nodes.filter(n => n.type === "geo" || n.type === "particles");
  if (geos.length) {
    if (!nodes.some(n => n.type === "camera")) add("COMP", "camera", { tz: 4, ty: 0.5 }, "cam");
    if (geos.some(n => n.type === "geo") && !nodes.some(n => n.type === "light")) add("COMP", "light", { tx: 2, ty: 3, tz: 3, intensity: 3 }, "luz");
    if (!nodes.some(n => n.type === "render")) add("TOP", "render", { bg: "#05060a" }, "render");
  }
  // Una geo sin forma: una caja.
  for (const g of nodes.filter(n => n.type === "geo" && !hasIn(n))) { const b = add("SOP", "box", {}, "caja"); wires.push({ from: b.id, to: g.id, input: 0 }); used.add(g.id + ":0"); }
  // Efectos de imagen sin entrada: se cuelgan de la imagen anterior (en el orden del plan).
  const tops = () => nodes.filter(n => n.fam === "TOP");
  for (const n of tops()) {
    const d = opDef(n.fam, n.type);
    if (d.inputs[0] > 0 && n.type !== "out" && !hasIn(n)) {
      const prev = tops().slice(0, tops().indexOf(n)).reverse().find(x => x.type !== "out" && !["movieout", "netout"].includes(x.type) && !reaches(n.id, x.id));
      if (prev) { wires.push({ from: prev.id, to: n.id, input: 0 }); used.add(n.id + ":0"); }
    }
  }
  // Mezclas con la segunda entrada vacía: se quedan con una (no fallan) — nada que hacer.
  // La Salida: al final de la cadena de imagen.
  let out = nodes.find(n => n.fam === "TOP" && n.type === "out");
  const ends = tops().filter(n => n.type !== "out" && !["movieout", "netout"].includes(n.type) && !wires.some(w => w.from === n.id && byId.get(w.to).fam === "TOP"));
  if (!out && ends.length) { out = add("TOP", "out", {}, "salida"); }
  if (out && !hasIn(out)) {
    const end = ends.at(-1);
    if (end) { wires.push({ from: end.id, to: out.id, input: 0 }); used.add(out.id + ":0"); }
  }
  // Feedback sin destino: lee lo que sale de él mismo hacia delante (la estela clásica).
  for (const fb of nodes.filter(n => n.type === "feedback" && !n.p.target)) {
    const next = wires.find(w => w.from === fb.id);
    const tgt = next ? byId.get(next.to) : null;
    if (tgt) fb.p.target = { ref: tgt.id };
  }
  // Movimientos.
  const moves = [];
  for (const m of Array.isArray(src.moves) ? src.moves : []) {
    const n = byId.get(String(m?.node || "")), mv = MOVERS.find(x => x.key === m?.with);
    if (!n || !mv) { warnings.push("movimiento con un nodo o una fuente que no existe"); continue; }
    const def = opDef(n.fam, n.type), q = m.param ? def.params.find(x => x.k === m.param && (x.type === "f" || x.type === "i")) : mainParam(n);
    if (!q) { warnings.push(`${n.type}: «${m.param}» no se puede mover`); continue; }
    const mm = { node: n.id, param: q.k, with: mv.key };
    // Un rango opcional [de, a] (dentro del de su parámetro).
    if (Array.isArray(m.range) && m.range.length === 2 && m.range.every(Number.isFinite)) {
      const cl = (x) => Math.min(q.max ?? Infinity, Math.max(q.min ?? -Infinity, x));
      mm.range = [cl(+m.range[0]), cl(+m.range[1])];
    }
    moves.push(mm);
  }
  const title = String(src.title || "").replace(/[<>]/g, "").slice(0, 60);
  const say = String(src.say || "").replace(/[<>]/g, "").slice(0, 300);
  return { plan: { title, say, nodes, wires, moves }, warnings };
}

/* ------------------------------------------------------------------ sin IA: entender la frase */

// Palabras → lo que hacen. El orden en la frase es el orden de la cadena.
const SOURCES = [
  [/\b(camara|webcam|camera|en vivo|selfie)\b/, { op: "TOP/videoin" }, "tu cámara"],
  [/\b(video|clip|foto|imagen|picture|movie)\b/, { op: "TOP/moviein" }, "tu video o foto"],
  [/\b(texto|text|letras|palabra|titulo|que diga|que ponga)\b/, { op: "TOP/text", p: { text: "LUMAMAP", size: 0.22, glow: 0.6 } }, "un texto"],
  [/\b(degradado|gradiente|gradient)\b/, { op: "TOP/ramp", p: { kind: 2 } }, "un degradado"],
  [/\b(circulo|aro|anillo|ring|circle)\b/, { op: "TOP/circle", p: { radius: 0.22, ring: 0.03, soft: 0.01 } }, "un aro"],
  [/\b(rayas|lineas|stripes)\b/, { op: "TOP/pattern", p: { kind: 1 } }, "rayas"],
  [/\b(cuadros|tablero|ajedrez|checker)\b/, { op: "TOP/pattern", p: { kind: 0 } }, "cuadros"],
  [/\b(puntos|lunares|dots)\b/, { op: "TOP/pattern", p: { kind: 3 } }, "puntos"],
  [/\b(hexagonos|panal|hexagon)\b/, { op: "TOP/pattern", p: { kind: 4 } }, "hexágonos"],
  [/\b(ruido|nubes|humo|colores|plasma|noise|clouds|smoke|manchas|aurora)\b/, { op: "TOP/noise", p: { mono: 0, kind: 1, period: 2.5, speed: 0.35 } }, "colores que se mueven"],
];
const SHAPES = [
  [/\b(cubo|caja|cube|box)\b/, "box", "un cubo"], [/\b(esfera|bola|planeta|sphere|ball)\b/, "sphere", "una esfera"],
  [/\b(nudo|knot)\b/, "knot", "un nudo"], [/\b(rosquilla|dona|donut|toro|torus)\b/, "torus", "una rosquilla"],
  [/\b(piramide|tetraedro|diamante|cristal|icosaedro|gema)\b/, "platonic", "un cristal"], [/\b(cono|cone)\b/, "cone", "un cono"],
  [/\b(cilindro|tubo|columna|cylinder)\b/, "tube", "un cilindro"],
];
const EFFECTS = [
  [/\b(caleidoscopio|kaleido\w*|mandala)\b/, { op: "TOP/kaleido", p: { segments: 6 } }, "caleidoscopio"],
  [/\b(espejo|mirror|reflej\w*)\b/, { op: "TOP/mirror" }, "espejo"],
  [/\b(mosaico|repetir|repetid\w*|tile|copias)\b/, { op: "TOP/tile", p: { rx: 3, ry: 3, mirror: 1 } }, "mosaico"],
  [/\b(desenfoque|desenfocad\w*|borros\w*|blur|suave)\b/, { op: "TOP/blur", p: { size: 0.3 } }, "desenfoque"],
  [/\b(pixel\w*|8 ?bits|retro)\b/, { op: "TOP/pixelate", p: { size: 0.4 } }, "píxeles"],
  [/\b(ondas|ondul\w*|agua|liquid\w*|wave\w*)\b/, { op: "TOP/wave", p: { amp: 0.4, freq: 0.4, speed: 0.4 } }, "ondas"],
  [/\b(tunel|polar|espiral|tunnel|vortice|remolino)\b/, { op: "TOP/polar", p: { twist: 0.4 } }, "túnel"],
  [/\b(bordes|contorno\w*|silueta|edges?|outline)\b/, { op: "TOP/edge", p: { strength: 0.7, color: 1 } }, "bordes"],
  [/\b(glitch|rgb|separ\w* colores|tele vieja|vhs)\b/, { op: "TOP/rgbsplit", p: { amount: 0.4 } }, "glitch RGB"],
  [/\b(posteriz\w*|pop art|comic)\b/, { op: "TOP/posterize", p: { levels: 4 } }, "posterizado"],
  [/\b(blanco y negro|b\/n|gris|grayscale|monocrom\w*)\b/, { op: "TOP/hsv", p: { sat: 0 } }, "blanco y negro"],
  [/\b(negativo|invert\w*)\b/, { op: "TOP/level", p: { invert: 1 } }, "negativo"],
  [/\b(arcoiris|rainbow|cambia de color|colores que cambian|tono)\b/, { op: "TOP/hsv", p: { hue: { e: "absTime.seconds * 0.1" } } }, "colores que giran"],
  [/\b(term\w*|calor|thermal)\b/, { op: "TOP/lookup", p: { map: 0 } }, "térmica"],
  [/\b(fuego|llamas|fire)\b/, { op: "TOP/lookup", p: { map: 1 } }, "fuego"],
  [/\b(hielo|frio|ice)\b/, { op: "TOP/lookup", p: { map: 2 } }, "hielo"],
  [/\b(gira\w*|rota\w*|da vueltas|spin\w*|rotat\w*)\b/, { op: "TOP/transform", p: { rot: { e: "absTime.seconds * 20" }, extend: 1 } }, "que gira"],
  [/\b(neon|resplandor|brill\w*|glow|luminos\w*)\b/, { op: "TOP/glow", p: { amount: 1.2, size: 0.4, threshold: 0.4 } }, "resplandor neón"],
];
const TRAIL = /\b(estela|rastro|feedback|trail\w*|eco|ecos|psicodel\w*|infinito)\b/;
const PARTICLES = /\b(particulas|chispas|sparks?|particles?|fuegos artificiales|confeti|estrellas|polvo)\b/;
const MOVE_WORDS = [
  [/\b(golpe|ritmo|beat|bombo|kick|al compas|late|latir|palpit\w*)\b/, "beat"],
  [/\b(musica|audio|sonido|graves|bajo|bass|cancion|music|sound|baila\w*)\b/, "music"],
  [/\b(mano|manos|hand|gesto)\b/, "hand"],
  [/\b(movimiento|gente|personas|publico|motion|se mueve la gente)\b/, "motion"],
  [/\b(azar|aleatori\w*|random|caos)\b/, "random"],
  [/\b(suave|lento|despacio|respira\w*|calma|slow)\b/, "wave"],
];

/**
 * Sin IA: entiende la frase y arma un plan con recetas probadas. Siempre devuelve algo que
 * funciona (si no reconoce nada, «colores que bailan»).
 */
export function planFromText(text) {
  const t = " " + strip(text) + " ";
  const pos = (re) => { const m = t.match(re); return m ? m.index : -1; };
  const nodes = [], wires = [], moves = [], said = [];
  let n = 0;
  const node = (op, p = {}) => { const id = "n" + (++n); nodes.push({ id, op, p: JSON.parse(JSON.stringify(p)) }); return id; };
  const wire = (from, to, input = 0) => wires.push({ from, to, input });
  const colors = [...t.matchAll(COLOR_RE)].map(m => colorOf(m[1])).filter(Boolean);
  const quoted = (String(text).match(/[«"“']([^»"”']{1,60})[»"”']/) || [])[1];

  // 1 · La imagen de partida (o el 3D, o las partículas).
  let chain = null;
  const shape = SHAPES.find(([re]) => re.test(t));
  const particles = PARTICLES.test(t);
  const srcs = SOURCES.filter(([re]) => re.test(t)).sort((a, b) => pos(a[0]) - pos(b[0]));
  if (shape || particles) {
    const cam = node("COMP/camera", { tz: 4, ty: 0.5 });
    void cam;
    if (shape) {
      const sop = node("SOP/" + shape[1], shape[1] === "platonic" ? { kind: 3 } : {});
      // La textura: lo que se nombre (cámara, ruido, video…) va pegado al objeto.
      let tex = null;
      if (srcs.length) { const s = srcs[0][1]; tex = node(s.op, s.p || {}); said.push(srcs[0][2] + " pegado a " + shape[2]); }
      const mat = node("MAT/pbr", { rough: 0.35, metal: 0.25, ...(tex ? { map: tex } : {}), ...(colors[0] && !tex ? { color: colors[0] } : {}) });
      const geo = node("COMP/geo", { material: mat, ry: { e: "absTime.seconds * 35" }, rx: { e: "absTime.seconds * 17" } });
      wire(sop, geo);
      node("COMP/light", { tx: 2, ty: 3, tz: 3, intensity: 3, ...(colors[1] ? { color: colors[1] } : {}) });
      if (!tex) said.push(shape[2] + " 3D que gira");
      if (particles) { node("COMP/particles", { emitter: 2, esize: 0.6, outward: 1, rate: 500 }); said.push("con partículas"); }
    } else {
      node("COMP/particles", { emitter: 2, esize: 0.3, outward: 1, rate: 800 });
      said.push("partículas que salen sin parar");
    }
    chain = node("TOP/render", { bg: "#05060a" });
  } else if (srcs.length) {
    const [re, s, name] = srcs[0];
    void re;
    const p = { ...(s.p || {}) };
    if (s.op === "TOP/text" && quoted) p.text = quoted;
    if (colors[0]) { if (s.op === "TOP/circle" || s.op === "TOP/text") p.color = colors[0]; if (s.op === "TOP/ramp" || s.op === "TOP/pattern") { p.color1 = colors[0]; if (colors[1]) p.color2 = colors[1]; } }
    chain = node(s.op, p);
    said.push(name);
    // Una segunda imagen nombrada: se suman como dos proyectores.
    if (srcs[1] && srcs[1][1].op !== s.op) {
      const b = node(srcs[1][1].op, srcs[1][1].p || {});
      const mix = node("TOP/add", { opacity: 0.8 });
      wire(chain, mix, 0); wire(b, mix, 1);
      chain = mix; said.push("+ " + srcs[1][2]);
    }
    // Colores para lo que no tiene color propio (ruido, cámara, video): un mapa de dos colores.
    if (colors.length >= 1 && !["TOP/circle", "TOP/text", "TOP/ramp", "TOP/pattern"].includes(s.op)) {
      const lk = node("TOP/lookup", { map: 4, color1: colors[0], color2: colors[1] || "#000000" });
      wire(chain, lk); chain = lk;
    }
  } else {
    chain = node("TOP/noise", { mono: 0, kind: 1, period: 2.5, speed: 0.35 });
    said.push("colores que se mueven");
    if (colors.length) { const lk = node("TOP/lookup", { map: 4, color1: colors[0], color2: colors[1] || "#000000" }); wire(chain, lk); chain = lk; }
  }

  // 2 · Los efectos, en el orden en que se nombran.
  // En 3D el objeto ya gira: «que gira» no gira la imagen entera.
  const fx = EFFECTS.filter(([re, e]) => re.test(t) && !((shape || particles) && e.op === "TOP/transform")).sort((a, b) => pos(a[0]) - pos(b[0]));
  const done = new Set();
  let lastFx = null;
  for (const [, e, name] of fx) {
    if (done.has(e.op + JSON.stringify(e.p || {}))) continue;
    done.add(e.op + JSON.stringify(e.p || {}));
    if (e.op === "TOP/hsv" && colors.length && e.p?.hue) continue;
    const id = node(e.op, e.p || {});
    wire(chain, id); chain = id; lastFx = id; said.push(name);
  }
  if (!fx.length && !shape && !particles && !srcs.length) { const k = node("TOP/kaleido", { segments: 6 }); wire(chain, k); chain = k; lastFx = k; said.push("caleidoscopio"); }

  // 3 · Estela (feedback): lo anterior se queda, gira un poco y se apaga despacio.
  if (TRAIL.test(t)) {
    const fb = node("TOP/feedback");
    const tr = node("TOP/transform", { sx: 0.98, sy: 0.98, rot: 0.6 });
    const fade = node("TOP/level", { opacity: 0.92 });
    const comp = node("TOP/composite", { mode: 6 });
    wire(chain, fb); wire(fb, tr); wire(tr, fade); wire(fade, comp, 0); wire(chain, comp, 1);
    nodes.find(x => x.id === fb).p.target = comp;
    chain = comp; said.push("con estela");
  }

  // 4 · Que se mueva solo.
  const mv = MOVE_WORDS.filter(([re]) => re.test(t)).sort((a, b) => pos(a[0]) - pos(b[0]));
  if (mv.length) {
    const target = lastFx || chain;
    const tnode = nodes.find(x => x.id === target);
    // Lo que más se nota de cada cosa (en un render 3D, el giro del objeto).
    const geo = nodes.find(x => x.op === "COMP/geo"), parts = nodes.find(x => x.op === "COMP/particles");
    if (geo && !lastFx) moves.push({ node: geo.id, param: "scale", with: mv[0][1], range: [1, 1.45] });
    else if (parts && !lastFx) moves.push({ node: parts.id, param: "speed", with: mv[0][1], range: [1, 4] });
    else moves.push({ node: target, with: mv[0][1] });
    if (mv[1] && tnode) moves.push({ node: srcs.length && !shape ? "n1" : target, with: mv[1][1] });
    said.push({ music: "con la música", beat: "al golpe", hand: "con tu mano", motion: "con el movimiento de la gente", random: "al azar", wave: "suave" }[mv[0][1]]);
  }

  node("TOP/out");
  wire(chain, "n" + n);
  const title = said.filter(Boolean).slice(0, 3).join(", ");
  return { title: title.charAt(0).toUpperCase() + title.slice(1), say: "Construí: " + said.filter(Boolean).join(", ") + ".", nodes, wires, moves };
}

/* ------------------------------------------------------------------ poner el plan en la red */

/**
 * Columnas de izquierda a derecha según los cables (la cadena se lee como una frase); los nodos
 * sin cables (cámara, luz, señales) van debajo de lo que mueven o al principio.
 */
function layout(plan) {
  const col = new Map(), byId = new Map(plan.nodes.map(n => [n.id, n]));
  const inc = (id) => plan.wires.filter(w => w.to === id);
  const depth = (id, seen = new Set()) => {
    if (col.has(id)) return col.get(id);
    if (seen.has(id)) return 0;
    seen.add(id);
    const d = inc(id).reduce((m, w) => Math.max(m, depth(w.from, seen) + 1), 0);
    col.set(id, d);
    return d;
  };
  for (const n of plan.nodes) depth(n.id);
  // El render va detrás de las geo (aunque no tenga cables).
  const render = plan.nodes.find(n => n.type === "render");
  if (render) {
    const g = Math.max(0, ...plan.nodes.filter(n => n.type === "geo" || n.type === "particles").map(n => col.get(n.id)));
    const shift = g + 1 - col.get(render.id);
    if (shift > 0) for (const n of plan.nodes) if (n.fam === "TOP" && (n.id === render.id || reach(plan, render.id, n.id))) col.set(n.id, col.get(n.id) + shift);
  }
  const rows = new Map(), pos = new Map();
  for (const n of plan.nodes) {
    let c = col.get(n.id), r;
    if (n.fam === "MAT" || n.type === "camera" || n.type === "light") r = 2;
    else if (n.fam === "SOP" || n.type === "geo" || n.type === "particles") r = 1;
    else r = 0;
    if (n.type === "camera" || n.type === "light") c = Math.max(0, (col.get(render?.id) ?? 1) - 1) + (n.type === "light" ? 1 : 0);
    const key = c + ":" + r;
    const k = rows.get(key) || 0; rows.set(key, k + 1);
    pos.set(n.id, [c * COL, (r + k * 0.9) * ROW]);
  }
  void byId;
  return pos;
}
function reach(plan, a, b) { const st = [a], seen = new Set(); while (st.length) { const x = st.pop(); if (x === b) return true; if (seen.has(x)) continue; seen.add(x); for (const w of plan.wires) if (w.from === x) st.push(w.to); } return false; }

/**
 * Los pasos para poner un plan (ya validado) en la red, uno a uno (para verlos aparecer):
 * [{ label, run() }]. Al terminar, ctx.created tiene { idDelPlan: nodo }. origin: [x, y].
 */
export function planSteps(net, plan, { origin = [0, 0], parent = "" } = {}) {
  const pos = layout(plan), ctx = { created: {}, out: null }, steps = [];
  const node = (id) => ctx.created[id];
  // Orden: por columnas (las fuentes primero), y dentro de cada columna como venían.
  const order = [...plan.nodes].sort((a, b) => pos.get(a.id)[0] - pos.get(b.id)[0] || pos.get(a.id)[1] - pos.get(b.id)[1]);
  for (const n of order) {
    steps.push({ label: `＋ ${opDef(n.fam, n.type).label}`, kind: "node", run() {
      const [x, y] = pos.get(n.id);
      const p = {};
      for (const [k, v] of Object.entries(n.p)) if (!(v && typeof v === "object" && "ref" in v)) p[k] = v;
      const made = addNode(net, n.fam, n.type, { x: origin[0] + x, y: origin[1] + y, p, parent, name: n.name && !nodeByName(net, n.name) ? n.name : "" });
      ctx.created[n.id] = made;
      if (n.type === "out") ctx.out = made;
      // Sus cables de entrada (lo que ya está creado).
      for (const w of plan.wires.filter(w => w.to === n.id && node(w.from))) connect(net, node(w.from).id, made.id, w.input);
      for (const w of plan.wires.filter(w => w.from === n.id && node(w.to))) connect(net, made.id, node(w.to).id, w.input);
    } });
  }
  steps.push({ label: "Enlazar materiales, cámaras y estelas", kind: "refs", run() {
    for (const n of plan.nodes) for (const [k, v] of Object.entries(n.p)) if (v && typeof v === "object" && "ref" in v && node(v.ref)) node(n.id).p[k] = node(v.ref).name;
  } });
  for (const m of plan.moves) {
    const mv = MOVERS.find(x => x.key === m.with);
    steps.push({ label: `${mv.emoji} ${mv.label}`, kind: "move", run() {
      const target = node(m.node);
      if (!target) return;
      const q = opDef(target.fam, target.type).params.find(x => x.k === m.param);
      let chop = net.nodes.find(x => x.fam === "CHOP" && x.type === mv.type && (x.parent || "") === parent);
      if (!chop) chop = addNode(net, "CHOP", mv.type, { x: target.x, y: target.y + ROW * 1.3, p: { ...(mv.p || {}) }, parent });
      const r = (x) => Math.round(x * 1000) / 1000;
      target.p[q.k] = { e: m.range ? `fit(${chop.name}.${mv.chan}, 0, 1, ${r(m.range[0])}, ${r(m.range[1])})` : moveExpr(chop.name, mv.chan, q) };
    } });
  }
  steps.push({ label: "Listo", kind: "done", run() { if (ctx.out) net.display = ctx.out.id; } });
  return { steps, ctx };
}

/** Pone un plan entero de una vez (para las pruebas y para «sin animación»). */
export function applyPlan(net, plan, opts) {
  const { steps, ctx } = planSteps(net, plan, opts);
  for (const s of steps) s.run();
  return ctx;
}

/** Dónde empezar a construir: debajo de lo que ya hay en la red (en la subred abierta). */
export function freeOrigin(net, parent = "") {
  const here = net.nodes.filter(n => (n.parent || "") === parent);
  if (!here.length) return [0, 0];
  return [Math.min(...here.map(n => n.x)), Math.max(...here.map(n => n.y)) + ROW * 2];
}

/** Resumen corto de la red para la IA (nombres y tipos). */
export const netSummary = (net) => net.nodes.slice(0, 40).map(n => `${n.name}(${n.fam}/${n.type})`).join(", ");
