// web/js/deck.js
// «Mesa de clips» (como la cuadrícula de Resolume): cada superficie es una fila con casillas de
// clips (animación, shader, video/foto o color). Tocar una casilla la lanza en su superficie con
// la transición en vivo; tocar el número de columna lanza toda la columna. Se puede «cuantizar»
// (el lanzamiento espera al siguiente golpe o compás) y el autopiloto avanza solo cada N golpes.
// Aquí solo están los datos y las reglas; las acciones viven en editor.js y la vista en panels-deck.js.

export const DECK_COLS = 8, DECK_MAX_COLS = 32;
export const QUANTIZE = [["off", "Al instante"], ["beat", "Al golpe"], ["bar", "Al compás (4)"]];
export const AUTOPILOT = [[0, "Apagado"], [4, "4 golpes"], [8, "8"], [16, "16"], [32, "32"], [64, "64"]];

export const defaultDeck = () => ({ cols: DECK_COLS, quantize: "off", autopilot: 0, random: false, cells: {}, colNames: [] });

const KINDS = new Set(["anim", "shader", "media", "color"]);
const HEX = /^#[0-9a-f]{6}$/i;
/** Un clip de la mesa con solo los campos que existen (los datos vienen del proyecto guardado). */
export function cleanClip(c) {
  if (!c || !KINDS.has(c.kind)) return null;
  const s = (v, n = 80) => String(v ?? "").slice(0, n);
  const out = { kind: c.kind, name: s(c.name || "Clip") };
  if (c.kind === "anim") Object.assign(out, { gen: s(c.gen, 40), color: HEX.test(c.color) ? c.color : "#00e5ff", color2: HEX.test(c.color2) ? c.color2 : "#ff00aa", speed: +c.speed || 1, scale: +c.scale || 1, fx: c.fx && typeof c.fx === "object" ? c.fx : null, id: s(c.id, 80) });
  if (c.kind === "shader") Object.assign(out, { shaderId: s(c.shaderId, 120), params: c.params && typeof c.params === "object" ? c.params : {}, id: s(c.id, 80) });
  if (c.kind === "media") Object.assign(out, { mediaId: s(c.mediaId, 80) });
  if (c.kind === "color") out.color = HEX.test(c.color) ? c.color : "#ffffff";
  return out;
}

export function normalizeDeck(d) {
  const D = defaultDeck();
  if (!d || typeof d !== "object") return D;
  const cols = Math.max(1, Math.min(DECK_MAX_COLS, Math.round(+d.cols) || DECK_COLS));
  const cells = {};
  for (const [sid, row] of Object.entries(d.cells || {})) {
    if (!Array.isArray(row)) continue;
    const r = row.slice(0, cols).map(cleanClip);
    if (r.some(Boolean)) cells[String(sid).slice(0, 80)] = r;
  }
  return {
    cols, cells,
    quantize: QUANTIZE.some(q => q[0] === d.quantize) ? d.quantize : "off",
    autopilot: AUTOPILOT.some(a => a[0] === +d.autopilot) ? +d.autopilot : 0,
    random: !!d.random,
    colNames: Array.isArray(d.colNames) ? d.colNames.slice(0, cols).map(n => String(n ?? "").slice(0, 30)) : [],
  };
}

/** Golpe (número continuo) en el que debe ocurrir un lanzamiento pedido ahora. */
export function quantizeAt(beat, q) {
  if (q === "beat") return Math.floor(beat + 1e-6) + 1;
  if (q === "bar") return (Math.floor(beat / 4 + 1e-6) + 1) * 4;
  return beat;
}

/** Columnas que tienen algo en alguna fila. */
export const usedCols = (deck, rows) => {
  const out = [];
  for (let c = 0; c < deck.cols; c++) if (rows.some(sid => deck.cells[sid]?.[c])) out.push(c);
  return out;
};

/** Siguiente columna para el autopiloto (salta las vacías; al azar si se pide, sin repetir). */
export function nextCol(deck, rows, cur, rnd = Math.random) {
  const cols = usedCols(deck, rows);
  if (!cols.length) return -1;
  if (deck.random && cols.length > 1) {
    const others = cols.filter(c => c !== cur);
    return others[Math.floor(rnd() * others.length) % others.length];
  }
  return cols.find(c => c > cur) ?? cols[0];
}
