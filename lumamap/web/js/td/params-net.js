// web/js/td/params-net.js
// Los parámetros de los nodos como parámetros de LumaMap: se pueden mover con MIDI, OSC, el mando,
// el teclado o «Mi panel» (Aprender), igual que la opacidad o los efectos de una superficie.
//   net/<red>/<nodo>/<parámetro>
import { registerParams } from "../params.js";
import { defOf } from "./ops.js";
import { nodeById, isExpr } from "./graph.js";

const NUMERIC = ["f", "i", "t", "m", "pulse"];
const kindOf = (q) => q.type === "t" ? "bool" : q.type === "pulse" ? "trigger" : "float";
const rangeOf = (q) => q.type === "t" ? [0, 1] : q.type === "m" ? [Math.min(...q.opts.map(o => +o[0])), Math.max(...q.opts.map(o => +o[0]))] : q.type === "pulse" ? [0, 1] : [q.min ?? 0, q.max ?? 1];

export function registerNetParams() {
  registerParams("net", (app, id, p) => {
    const net = app.S.project.networks?.find(n => n.id === p[1]);
    const node = nodeById(net, p[2]);
    const q = defOf(node)?.params.find(x => x.k === p[3]);
    if (!q || !NUMERIC.includes(q.type)) return null;
    const kind = kindOf(q), [min, max] = rangeOf(q);
    return {
      id, name: `${net.name} · ${node.name} · ${q.label}`, group: "Red · " + net.name, kind, min, max, def: +q.def || 0,
      step: q.type === "i" || q.type === "m" ? 1 : undefined,
      get: () => { const v = node.p[q.k]; if (isExpr(v)) { const c = app.td?.cookers?.get(net.id); return c ? +c.param(node, q.k) || 0 : 0; } return typeof v === "boolean" ? (v ? 1 : 0) : +v || 0; },
      // Si el parámetro tiene una expresión, manda la expresión (como en TouchDesigner).
      set: (v) => {
        if (isExpr(node.p[q.k])) return;
        if (kind === "trigger") node.p[q.k] = (+node.p[q.k] || 0) + 1;
        else if (kind === "bool") node.p[q.k] = v ? 1 : 0;
        else node.p[q.k] = q.type === "i" || q.type === "m" ? Math.round(v) : v;
      },
    };
  }, (app) => (app.S.project.networks || []).map(net => ({
    group: "Red · " + net.name,
    items: net.nodes.flatMap(node => (defOf(node)?.params || []).filter(q => NUMERIC.includes(q.type) && !q.hidden)
      .map(q => ({ id: `net/${net.id}/${node.id}/${q.k}`, name: `${node.name} · ${q.label}`, kind: kindOf(q) }))),
  })).filter(g => g.items.length));
}

/** Parámetros de LumaMap a los que un «Exportar a LumaMap» puede mandar un canal (los que admiten modulación). */
export function exportTargets(groups) {
  const ok = (id) => /^global\/master$/.test(id) || /^screen\/\d\/master$/.test(id) || /^surf\/[^/]+\/(opacity|mix|fx\/[A-Za-z0-9]+)$/.test(id);
  return groups.map(g => ({ group: g.group, items: g.items.filter(it => ok(it.id) && it.kind !== "trigger") })).filter(g => g.items.length);
}
