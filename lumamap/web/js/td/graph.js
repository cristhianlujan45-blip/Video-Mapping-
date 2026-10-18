// web/js/td/graph.js
// Las redes (como las de TouchDesigner) dentro del proyecto: project.networks = [red…].
//   red  = { id, name, res:[ancho, alto], display, nodes:[nodo…], view:{x, y, z} }
//   nodo = { id, fam, type, name, x, y, p:{ clave: valor | { e: "expresión" } }, in:[id|null…],
//            bypass, viewer, comment }
// Funciones puras (sin GPU): crear, cablear (sin ciclos), copiar/pegar, renombrar (arregla las
// expresiones que lo nombran) y el «cocinero» de CHOPs y parámetros, que el motor usa cada fotograma.
import { opDef, defOf, acceptsInput, baseName, panelChop } from "./ops.js";
import { compileExpr, renameInExpr } from "./expr.js";

let seq = 0;
const uid = (p) => p + Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 5);

export function newNetwork(name = "Red 1") {
  return { id: uid("net"), name, res: [1280, 720], display: null, nodes: [], view: { x: 0, y: 0, z: 1 }, timeline: newTimeline() };
}
/* ---------------- Línea de tiempo de la red (como la de TouchDesigner) ----------------
   { play, rate, length, loop, t0, at }: mientras suena, el tiempo es (ahora − t0) × rate (con el
   reloj de la pared, igual en el editor y en las ventanas de salida); en pausa se queda en `at`. */
export const newTimeline = () => ({ play: 1, rate: 1, length: 10, loop: 1, t0: 0, at: 0 });
const wallNow = () => Date.now() / 1000;
/** Tiempo de la red (segundos dentro de su línea de tiempo). */
export function netTime(net, now = wallNow()) {
  const tl = net?.timeline || newTimeline(), L = Math.max(0.05, +tl.length || 10);
  if (!tl.play) return Math.max(0, Math.min(L, +tl.at || 0));
  const raw = (now - (+tl.t0 || 0)) * (+tl.rate || 1);
  return tl.loop !== 0 ? ((raw % L) + L) % L : Math.max(0, Math.min(L, raw));
}
export function playNet(net, now = wallNow()) { const tl = net.timeline ||= newTimeline(); if (tl.play) return; const at = netTime(net, now); tl.play = 1; tl.t0 = now - at / (+tl.rate || 1); }
export function pauseNet(net, now = wallNow()) { const tl = net.timeline ||= newTimeline(); if (!tl.play) return; tl.at = netTime(net, now); tl.play = 0; }
export function seekNet(net, t, now = wallNow()) {
  const tl = net.timeline ||= newTimeline(), L = Math.max(0.05, +tl.length || 10);
  t = Math.max(0, Math.min(L, +t || 0));
  if (tl.play) tl.t0 = now - t / (+tl.rate || 1); else tl.at = t;
}
export function setNetRate(net, rate, now = wallNow()) { const at = netTime(net, now); net.timeline.rate = +rate || 1; seekNet(net, at, now); }
/** Arregla redes de un proyecto guardado (o de otra versión). */
export function normalizeNetworks(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(n => n && typeof n === "object").map(n => {
    const net = { ...newNetwork(String(n.name || "Red")), ...n };
    net.res = Array.isArray(n.res) && n.res.length === 2 ? n.res.map(v => Math.max(16, Math.min(4096, Math.round(+v || 0)))) : [1280, 720];
    net.view = { x: 0, y: 0, z: 1, ...(n.view || {}) };
    net.timeline = { ...newTimeline(), ...(n.timeline && typeof n.timeline === "object" ? n.timeline : {}) };
    net.nodes = (Array.isArray(n.nodes) ? n.nodes : []).filter(x => x && opDef(x.fam, x.type)).map(x => {
      const def = opDef(x.fam, x.type);
      return { id: x.id || uid("n"), fam: x.fam, type: x.type, name: String(x.name || baseName(def) + "1"), x: +x.x || 0, y: +x.y || 0,
        p: x.p && typeof x.p === "object" ? x.p : {}, in: Array.isArray(x.in) ? x.in.slice(0, def.inputs[1]) : [], bypass: !!x.bypass, viewer: x.viewer !== false, comment: String(x.comment || ""),
        parent: String(x.parent || ""), ...(x.repOf ? { repOf: String(x.repOf), repIndex: +x.repIndex || 0 } : {}) };
    });
    const ids = new Set(net.nodes.map(x => x.id)), bases = new Set(net.nodes.filter(x => x.type === "base").map(x => x.id));
    for (const x of net.nodes) { x.in = x.in.map(v => ids.has(v) ? v : null); if (x.parent && (!bases.has(x.parent) || x.parent === x.id)) x.parent = ""; }
    if (!ids.has(net.display)) net.display = null;
    return net;
  });
}

export const nodeById = (net, id) => net?.nodes.find(n => n.id === id) || null;
export const nodeByName = (net, name) => net?.nodes.find(n => n.name === name) || null;
/** Nombre libre: noise1, noise2… */
export function uniqueName(net, base) {
  base = String(base || "op").replace(/[^A-Za-z0-9_]/g, "_").replace(/\d+$/, "") || "op";
  if (/^\d/.test(base)) base = "op" + base;
  let n = 1;
  while (net.nodes.some(x => x.name === base + n)) n++;
  return base + n;
}
/** Valores por defecto de un operador. */
export function defaultParams(def) {
  const p = {};
  for (const q of def.params) p[q.k] = q.def && typeof q.def === "object" ? JSON.parse(JSON.stringify(q.def)) : q.def;
  return p;
}
export function addNode(net, fam, type, { x = 0, y = 0, name = "", p = {}, parent = "" } = {}) {
  const def = opDef(fam, type);
  if (!def) throw new Error("Operador desconocido: " + fam + ":" + type);
  const node = { id: uid("n"), fam, type, name: name && !nodeByName(net, name) ? name : uniqueName(net, baseName(def)), x, y,
    p: { ...defaultParams(def), ...p }, in: [], bypass: false, viewer: true, comment: "", parent: parent || "" };
  // Una «Entrada de la subred» nueva: la siguiente entrada libre.
  if (type === "in" && parent && p.index === undefined) node.p.index = Math.min(4, net.nodes.filter(n => n.parent === parent && n.type === "in").length + 1);
  net.nodes.push(node);
  // La primera imagen de la red se ve de fondo (bandera de «display», como en TouchDesigner).
  if (fam === "TOP" && !net.display) net.display = node.id;
  return node;
}
/** ¿Conectar src → dst crearía un bucle? (los bucles se hacen con el Feedback TOP). */
export function wouldCycle(net, srcId, dstId) {
  if (srcId === dstId) return true;
  const seen = new Set(), stack = [srcId];
  while (stack.length) {
    const id = stack.pop();
    if (id === dstId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const n = nodeById(net, id);
    if (n) for (const v of n.in) if (v) stack.push(v);
  }
  return false;
}
/** Conecta la salida de src a la entrada `idx` de dst. Devuelve "" o el motivo por el que no se puede. */
export function connect(net, srcId, dstId, idx = 0) {
  const a = nodeById(net, srcId), b = nodeById(net, dstId);
  if (!a || !b) return "No existe el nodo";
  const db = defOf(b), af = outFam(net, a);
  if (!af) return `${a.name} no tiene salida${a.type === "base" ? ": pon una «Salida» dentro de la subred" : ""}`;
  if (!acceptsInput(b.fam, b.type, af)) return `Un ${af} no se puede conectar a un ${b.fam}${b.fam === "COMP" ? " (a un Objeto 3D se le conecta una geometría SOP)" : ""}`;
  if (idx >= db.inputs[1]) return `${b.name} solo tiene ${db.inputs[1]} entrada${db.inputs[1] === 1 ? "" : "s"}`;
  if (wouldCycle(net, srcId, dstId)) return "Eso haría un bucle: usa un Feedback TOP para volver atrás";
  while (b.in.length <= idx) b.in.push(null);
  b.in[idx] = srcId;
  return "";
}
/** Primera entrada libre de un nodo (o la última si están todas ocupadas). */
export function freeInput(node) {
  const def = defOf(node);
  for (let k = 0; k < def.inputs[1]; k++) if (!node.in[k]) return k;
  return Math.max(0, def.inputs[1] - 1);
}
export function disconnect(net, dstId, idx) {
  const b = nodeById(net, dstId);
  if (!b || idx >= b.in.length) return;
  b.in[idx] = null;
  while (b.in.length && b.in.at(-1) === null) b.in.pop();
}
export function removeNodes(net, ids) {
  const set = new Set(ids);
  // Con una subred se va todo lo de dentro; con un replicador, sus copias.
  for (const id of ids) for (const d of descendants(net, id)) set.add(d.id);
  for (const n of net.nodes) if (n.repOf && set.has(n.repOf)) set.add(n.id);
  net.nodes = net.nodes.filter(n => !set.has(n.id));
  for (const n of net.nodes) n.in = n.in.map(v => set.has(v) ? null : v);
  if (set.has(net.display)) net.display = net.nodes.find(n => n.fam === "TOP")?.id || null;
}
/** Quita un nodo dejando pasar sus cables (lo que entraba sale ahora directo). */
export function removeKeepWires(net, id) {
  const n = nodeById(net, id);
  if (!n) return;
  const src = n.in.find(Boolean) || null;
  for (const o of net.nodes) o.in = o.in.map(v => v === id ? src : v);
  removeNodes(net, [id]);
}
/** Nodos que usan la salida de este (cables que salen). */
export const outputsOf = (net, id) => net.nodes.filter(n => n.in.includes(id));

/* ---------------- Copiar, pegar, duplicar, renombrar ---------------- */
export function copyNodes(net, ids) {
  const set = new Set(ids);
  for (const id of ids) for (const d of descendants(net, id)) set.add(d.id);
  const nodes = net.nodes.filter(n => set.has(n.id)).map(n => JSON.parse(JSON.stringify(n)));
  return { kind: "lumamap-nodes", nodes };
}
/** Pega (con nombres nuevos si hacen falta; los cables entre los pegados se conservan). Devuelve los nodos nuevos. */
export function pasteNodes(net, clip, dx = 40, dy = 40, parent = "") {
  if (!clip || clip.kind !== "lumamap-nodes" || !Array.isArray(clip.nodes)) return [];
  const map = new Map(), names = new Map(), out = [];
  for (const n of clip.nodes) {
    if (!opDef(n.fam, n.type)) continue;
    const id = uid("n");
    const name = nodeByName(net, n.name) || [...names.values()].includes(n.name) ? uniqueName({ nodes: [...net.nodes, ...out] }, n.name) : n.name;
    map.set(n.id, id); names.set(n.name, name);
    out.push({ ...JSON.parse(JSON.stringify(n)), id, name, x: n.x + dx, y: n.y + dy });
  }
  for (const n of out) {
    n.in = n.in.map(v => map.get(v) || null);
    // Lo que estaba dentro de una subred copiada sigue dentro de la copia; lo demás va donde estás.
    if (n.parent && map.has(n.parent)) { n.parent = map.get(n.parent); n.x -= dx; n.y -= dy; } else n.parent = parent || "";
    delete n.repOf; delete n.repIndex;
    // Las expresiones entre los nodos pegados apuntan a las copias.
    for (const [from, to] of names) if (from !== to) renameRefsInNode(n, from, to);
  }
  net.nodes.push(...out);
  return out;
}
function renameRefsInNode(n, from, to) {
  const def = defOf(n);
  for (const [k, v] of Object.entries(n.p)) {
    if (v && typeof v === "object" && typeof v.e === "string") v.e = renameInExpr(v.e, from, to);
    else if (def?.params.find(q => q.k === k)?.type === "op" && v === from) n.p[k] = to;
    else if (k === "code" && typeof v === "string") n.p[k] = v;
  }
}
/** Renombra un nodo y todo lo que lo nombra (expresiones y referencias). Devuelve "" o el motivo. */
export function renameNode(net, id, name) {
  const n = nodeById(net, id);
  name = String(name || "").trim().replace(/\s+/g, "_");
  if (!n) return "No existe el nodo";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return "El nombre solo puede tener letras, números y _ (y no empezar por número)";
  if (name === n.name) return "";
  if (nodeByName(net, name)) return "Ya hay un nodo con ese nombre";
  const old = n.name;
  n.name = name;
  for (const o of net.nodes) renameRefsInNode(o, old, name);
  return "";
}

/* ---------------- Subredes (Base COMP) ----------------
   Los nodos de dentro de una subred tienen parent = id de la subred (los nombres siguen siendo
   únicos en toda la red, así las expresiones funcionan desde cualquier sitio). */
export const childrenOf = (net, id) => net.nodes.filter(n => (n.parent || "") === (id || ""));
export function descendants(net, id) {
  const out = [], stack = [id], seen = new Set();
  while (stack.length) { const p = stack.pop(); if (seen.has(p)) continue; seen.add(p); for (const n of net.nodes) if (n.parent === p) { out.push(n); if (n.type === "base") stack.push(n.id); } }
  return out;
}
/** La «Salida» de una subred (la de esa familia, o la primera). */
export function subOut(net, base, fam = "") {
  const outs = net.nodes.filter(n => n.parent === base.id && n.type === "out");
  return (fam ? outs.find(n => n.fam === fam) : outs[0]) || null;
}
/** Familia de lo que sale de un nodo (de una subred: la de su Salida). */
export function outFam(net, node) {
  if (node?.type === "base") return subOut(net, node)?.fam || null;
  if (!node || ["MAT", "DAT"].includes(node.fam) || (node.fam === "COMP")) return null;
  return node.fam;
}
/** El nodo que de verdad da la salida de `node` como `fam` (atraviesa subredes). */
export function resolveOut(net, node, fam, depth = 0) {
  if (!node || depth > 16) return null;
  if (node.type === "base") return resolveOut(net, subOut(net, node, fam), fam, depth + 1);
  return node.fam === fam ? node : null;
}
/** Lo que le entra a una «Entrada de la subred»: el nodo de fuera conectado a esa entrada. */
export function subIn(net, inNode) {
  const base = nodeById(net, inNode?.parent);
  if (!base) return null;
  const k = Math.max(1, Math.min(4, Math.round(+inNode.p.index || 1))) - 1;
  return nodeById(net, base.in[k]);
}
/**
 * Agrupa nodos en una subred nueva (como «Collapse into Base» de TouchDesigner): los cables que
 * entraban pasan por «Entradas de la subred», el que salía por una «Salida». Devuelve { base } o { error }.
 */
export function groupIntoBase(net, ids, parent = "") {
  const S = new Set(ids), list = net.nodes.filter(n => S.has(n.id));
  if (!list.length) return { error: "Elige los nodos que quieres meter en la subred" };
  const ins = [];                 // [{ src, fam, inNode }]
  for (const n of list) n.in.forEach((src, k) => { if (src && !S.has(src) && !ins.some(x => x.src === src)) ins.push({ src, fam: outFam(net, nodeById(net, src)) }); void k; });
  if (ins.length > 4) return { error: "Una subred tiene como mucho 4 entradas (aquí entrarían " + ins.length + ")" };
  const outside = net.nodes.filter(n => !S.has(n.id) && n.in.some(v => S.has(v)));
  const outSrc = [...new Set(outside.flatMap(n => n.in.filter(v => S.has(v))))];
  if (outSrc.length > 1) return { error: "De la subred solo puede salir una cosa (ahora saldrían " + outSrc.length + "): mete también lo que las junta" };
  const cx = list.reduce((a, n) => a + n.x, 0) / list.length, cy = list.reduce((a, n) => a + n.y, 0) / list.length;
  const base = addNode(net, "COMP", "base", { x: Math.round(cx / 10) * 10, y: Math.round(cy / 10) * 10, parent });
  const minX = Math.min(...list.map(n => n.x)), minY = Math.min(...list.map(n => n.y));
  ins.forEach((x, k) => {
    const inN = addNode(net, x.fam || "TOP", "in", { x: minX - 220, y: minY + k * 170, parent: base.id, p: { index: k + 1 } });
    for (const n of list) n.in = n.in.map(v => v === x.src ? inN.id : v);
    base.in[k] = x.src;
  });
  for (const n of list) n.parent = base.id;
  if (outSrc.length) {
    const src = nodeById(net, outSrc[0]), fam = outFam(net, src);
    const o = addNode(net, fam, "out", { x: Math.max(...list.map(n => n.x)) + 220, y: src.y, parent: base.id });
    o.in = [src.id];
    for (const n of outside) n.in = n.in.map(v => S.has(v) ? base.id : v);
  }
  return { base };
}
/** Deshace una subred: lo de dentro sale a su nivel y los cables vuelven a ir directos. */
export function ungroupBase(net, baseId) {
  const base = nodeById(net, baseId);
  if (!base || base.type !== "base") return false;
  const kids = childrenOf(net, base.id), out = subOut(net, base);
  const ioIds = new Set();
  for (const k of kids) if (k.type === "in") { ioIds.add(k.id); const src = subIn(net, k)?.id || null; for (const n of net.nodes) n.in = n.in.map(v => v === k.id ? src : v); }
  const outSrc = out ? out.in[0] || null : null;
  for (const k of kids) if (k.type === "out") ioIds.add(k.id);
  for (const n of net.nodes) n.in = n.in.map(v => v === base.id ? outSrc : v);
  for (const k of kids) if (!ioIds.has(k.id)) { k.parent = base.parent || ""; k.x += base.x - 300; k.y += base.y; }
  net.nodes = net.nodes.filter(n => n.id !== base.id && !ioIds.has(n.id));
  for (const n of net.nodes) { n.in = n.in.map(v => v === base.id || ioIds.has(v) ? null : v); while (n.in.length && n.in.at(-1) === null) n.in.pop(); }
  if (net.display === base.id || ioIds.has(net.display)) net.display = net.nodes.find(n => n.fam === "TOP")?.id || null;
  return true;
}
/**
 * Replicadores: mantiene N copias del maestro (crea las que faltan, borra las que sobran y, si se
 * pide, les copia los cambios del maestro). count(rep) = número de copias. Devuelve si cambió algo.
 */
const repState = new WeakMap();   // replicador → { rec, sig } (no se guarda en el proyecto)
export function syncReplicators(net, count = (r) => +r.p.count || 0) {
  let changed = false;
  for (const r of net.nodes.filter(n => n.type === "replicator" && !n.bypass)) {
    let st = repState.get(r);
    if (!st) repState.set(r, st = { rec: r.p.recreate, sig: undefined });
    const master = nodeByName(net, r.p.master);
    let reps = net.nodes.filter(n => n.repOf === r.id).sort((a, b) => a.repIndex - b.repIndex);
    const want = master && master !== r && !master.repOf ? Math.max(0, Math.min(200, Math.round(count(r)) || 0)) : 0;
    const sig = master ? JSON.stringify([master.fam, master.type, master.p, master.in, r.p.prefix, r.p.wire, r.p.recreate]) : "";
    // Volver a crear (botón, maestro distinto o de otro tipo): todas fuera.
    if (reps.length && (st.rec !== r.p.recreate || reps[0].type !== master?.type || reps[0].fam !== master?.fam)) { removeNodes(net, reps.map(n => n.id)); reps = []; changed = true; }
    st.rec = r.p.recreate;
    if (reps.length > want) { removeNodes(net, reps.slice(want).map(n => n.id)); reps = reps.slice(0, want); changed = true; }
    const prefix = String(r.p.prefix || "item").replace(/[^A-Za-z0-9_]/g, "_").replace(/\d+$/, "") || "item";
    for (let k = reps.length; k < want; k++) {
      let name = prefix + (k + 1);
      if (nodeByName(net, name)) name = uniqueName(net, prefix);
      const n = addNode(net, master.fam, master.type, { x: r.x + 200 + (k % 8) * 190, y: r.y + Math.floor(k / 8) * 170, name, parent: r.parent || "", p: JSON.parse(JSON.stringify(master.p)) });
      n.repOf = r.id; n.repIndex = k;
      if (r.p.wire) n.in = [...master.in];
      reps.push(n); changed = true;
    }
    // Copiar los cambios del maestro (la primera vez tras abrir el proyecto solo se mira si difieren).
    if (r.p.follow && sig !== st.sig) {
      const mp = JSON.stringify(master?.p ?? null);
      for (const n of reps) if (JSON.stringify(n.p) !== mp || (r.p.wire && JSON.stringify(n.in) !== JSON.stringify(master.in))) { n.p = JSON.parse(mp); if (r.p.wire) n.in = [...master.in]; changed = true; }
    }
    st.sig = sig;
  }
  return changed;
}

/* ---------------- Parámetros ---------------- */
export const isExpr = (v) => !!v && typeof v === "object" && typeof v.e === "string";
/** Nombres de los nodos de los que depende un nodo (cables + expresiones + referencias). */
export function dependsOn(net, node) {
  const def = defOf(node), out = new Set();
  for (const v of node.in) { const n = nodeById(net, v); if (n) out.add(n.name); }
  for (const q of def?.params || []) {
    const v = node.p[q.k];
    if (isExpr(v)) for (const r of compileExpr(v.e).refs) out.add(r);
    else if (q.type === "op" && v) out.add(v);
  }
  return out;
}

/**
 * Cocinero de una red: evalúa parámetros (con expresiones) y CHOPs, una vez por fotograma y bajo
 * demanda (como TouchDesigner: solo se calcula lo que alguien usa). El estado de cada CHOP
 * (suavizados, temporizadores…) se conserva entre fotogramas.
 */
export class Cooker {
  constructor() { this.state = new Map(); this.memo = new Map(); this.busy = new Set(); this.last = new Map(); this.errors = new Map(); this.frameNo = 0; this.env = {}; this.cookMs = new Map(); }
  /** Empieza un fotograma. env = { t, dt, frame, bpm, levels, fft(), pointer, keys, input(), tracking(), motion(), export() } */
  begin(net, env) {
    this.net = net; this.env = env; this.memo.clear(); this.frameNo++;
    // Estado de nodos borrados: fuera.
    if (this.frameNo % 120 === 0) { const ids = new Set(net.nodes.map(n => n.id)); for (const k of this.state.keys()) if (!ids.has(k)) this.state.delete(k); }
  }
  /** Entorno de las expresiones de un nodo. */
  exprEnv(node, i = 0) {
    const env = this.env, digits = +(/(\d+)$/.exec(node.name)?.[1] || 0);
    return {
      t: env.t, frame: env.frame, i,
      vars: { t: env.t, time: env.t, frame: env.frame, localtime: env.local ?? env.t, bpm: env.levels?.bpm || env.bpm || 120, beat: env.levels?.beat || 0, i,
        bass: env.levels?.bass || 0, mid: env.levels?.mid || 0, high: env.levels?.high || 0, level: env.levels?.level || 0 },
      me: { name: node.name, digits, time: { seconds: env.local ?? env.t, frame: Math.round((env.local ?? env.t) * 60) }, i },
      chop: (name) => this.chopByName(name),
      par: (name, key) => { const n = nodeByName(this.net, name); return n ? this.param(n, key) : 0; },
      tab: (name, r, c) => this.tab(name, r, c),
    };
  }
  /** Valor de un parámetro (número, texto o interruptor; las expresiones se calculan). */
  param(node, key, i = 0) {
    const v = node.p[key];
    if (isExpr(v)) {
      const mk = node.id + "/" + key + "/" + i;
      if (this.memo.has(mk)) return this.memo.get(mk);
      if (this.busy.has(mk)) return this.last.get(mk) ?? 0;   // se nombra a sí mismo: el valor anterior
      this.busy.add(mk);
      const c = compileExpr(v.e);
      let r = 0;
      try { r = c.fn(this.exprEnv(node, i)); } finally { this.busy.delete(mk); }
      if (c.error) this.errors.set(node.id + "/" + key, c.error); else this.errors.delete(node.id + "/" + key);
      this.memo.set(mk, r); this.last.set(mk, r);
      return r;
    }
    if (v === undefined) { const q = defOf(node)?.params.find(x => x.k === key); return q ? q.def : 0; }
    if (typeof v === "boolean") return v ? 1 : 0;
    return v;
  }
  /** Todos los parámetros de un nodo ya evaluados. */
  params(node, i = 0) {
    const out = {};
    for (const q of defOf(node)?.params || []) {
      let v = this.param(node, q.k, i);
      if (["f", "i", "t", "m", "pulse"].includes(q.type)) { v = +v; if (!Number.isFinite(v)) v = 0; if (q.type === "i") v = Math.round(v); }
      out[q.k] = v;
    }
    return out;
  }
  chopByName(name) { return this.chopOf(nodeByName(this.net, name)); }
  /** Canales de un nodo: un CHOP, la salida CHOP de una subred o un COMP de panel. */
  chopOf(n) {
    if (!n) return null;
    if (n.fam === "CHOP") return this.chop(n);
    if (n.type === "base") { const r = resolveOut(this.net, n, "CHOP"); return r ? this.chop(r) : null; }
    if (n.fam === "COMP") return panelChop(n);
    return null;
  }
  /** Cocina un CHOP (una vez por fotograma). */
  chop(node) {
    const mk = "chop:" + node.id;
    if (this.memo.has(mk)) return this.memo.get(mk);
    if (this.busy.has(mk)) return this.last.get(mk) || null;
    this.busy.add(mk);
    const t0 = typeof performance !== "undefined" ? performance.now() : 0;
    let out = null;
    try {
      const def = defOf(node);
      const inputs = node.in.map(id => this.chopOf(nodeById(this.net, id)));
      if (node.type === "in") out = this.chopOf(subIn(this.net, node));
      else if (node.bypass) out = inputs.find(Boolean) || null;
      else {
        let state = this.state.get(node.id);
        if (!state) this.state.set(node.id, state = {});
        out = def.cook({ p: this.params(node), inputs, state, env: { ...this.env, chop: (nm) => this.chopByName(nm) }, node });
      }
      this.errors.delete(node.id);
    } catch (e) { this.errors.set(node.id, String(e.message || e)); out = this.last.get(mk) || null; }
    finally { this.busy.delete(mk); }
    if (typeof performance !== "undefined") this.cookMs.set(node.id, performance.now() - t0);
    this.memo.set(mk, out); this.last.set(mk, out);
    return out;
  }
  /** Un número de una tabla DAT: tab('tabla1', fila, columna). */
  tab(name, r, c) {
    const n = nodeByName(this.net, name);
    if (!n || n.fam !== "DAT") return 0;
    const rows = String(n.p.text ?? "").split(/\r?\n/).map(l => l.split(/[,\t;]/).map(x => x.trim()));
    const v = parseFloat(rows[r | 0]?.[c | 0]);
    return Number.isFinite(v) ? v : 0;
  }
  /** Texto de un DAT (para el Text TOP). */
  text(name) { const n = nodeByName(this.net, name); return n && n.fam === "DAT" ? String(n.p.text ?? "") : ""; }
  /** Cocina todos los CHOP «Exportar a LumaMap» y devuelve [{ target, value }]. */
  exports() {
    const out = [];
    for (const n of this.net.nodes) {
      if (n.fam !== "CHOP" || n.type !== "export" || n.bypass) continue;
      const p = this.params(n);
      if (!p.active || !p.target) continue;
      const c = this.chop(n);
      const ch = c && (c.data[p.chan] || c.data[c.names[0]]);
      if (!ch || !ch.length) continue;
      out.push({ target: p.target, value: p.lo + (ch[0] ?? 0) * (p.hi - p.lo), node: n.id });
    }
    return out;
  }
}
