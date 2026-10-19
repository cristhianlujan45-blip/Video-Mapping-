// web/js/td/pyapi.js
// Lo que ve el Python de LumaMap de la red (como el módulo td de TouchDesigner):
//   op('noise1').par.period = 3          op('lfo1')['chan1']            op('tabla1')[1, 2]
//   me.name / me.digits / me.par…        absTime.seconds, absTime.frame  parent()
//   ops('bola*')                         print(…) → la consola
//   lumamap.scene('DROP'), lumamap.blackout(True), lumamap.set_param('global/master', 0.5)…
// y los objetos de los nodos de script: scriptOp (Script CHOP / Script TOP) y los avisos del
// «Ejecutar» DAT (onStart, onFrameStart, onValueChange, onOffToOn, onOnToOff).
import { Interp, PyError, Tuple, Dict, builtin, formatError, pyStr, isExpression } from "./py.js";
import { defOf } from "./ops.js";

/* ---------------- Consola (lo que imprimen los scripts) ---------------- */
export const pyConsole = {
  lines: [], listeners: new Set(),
  push(text, kind = "out", from = "") {
    const line = { text: String(text), kind, from, t: Date.now() };
    this.lines.push(line);
    if (this.lines.length > 500) this.lines.splice(0, this.lines.length - 500);
    for (const f of this.listeners) { try { f(line); } catch {} }
  },
  clear() { this.lines.length = 0; for (const f of this.listeners) { try { f(null); } catch {} } },
};

const byName = (net, name) => net?.nodes.find(n => n.name === name) || null;
const byId = (net, id) => net?.nodes.find(n => n.id === id) || null;
const isExpr = (v) => !!v && typeof v === "object" && typeof v.e === "string";
const B = builtin;

/* ---------------- Objetos de la red ---------------- */
/** El valor de un parámetro numérico: se usa como un número (y tiene .val, .eval(), .expr, .default…). */
function parRef(ck, node, q) {
  const val = () => { const v = ck.param(node, q.k); return typeof v === "number" ? v : +v || 0; };
  return {
    __typename: "un parámetro",
    __float__: val, valueOf: val,
    __repr__: () => pyStr(val()),
    __getattr__: (n) => {
      switch (n) {
        case "val": case "eval": return n === "eval" ? B("eval", () => val()) : val();
        case "name": return q.k;
        case "label": return q.label;
        case "default": return q.def;
        case "min": case "normMin": return q.min ?? 0;
        case "max": case "normMax": return q.max ?? 1;
        case "expr": return isExpr(node.p[q.k]) ? node.p[q.k].e : "";
        case "mode": return isExpr(node.p[q.k]) ? "EXPRESSION" : "CONSTANT";
        case "pulse": return B("pulse", () => { node.p[q.k] = (+node.p[q.k] || 0) + 1; return null; });
      }
      return undefined;
    },
    __setattr__: (n, v) => {
      if (n === "val") return setPar(node, q, v);
      if (n === "expr") { node.p[q.k] = { e: pyStr(v) }; return; }
      throw new PyError("AttributeError", `no se puede cambiar «${n}» de un parámetro`);
    },
  };
}
function setPar(node, q, v) {
  if (v && typeof v === "object" && v.__float__) v = v.__float__();
  if (["f", "i", "t", "m", "pulse"].includes(q.type)) {
    let n = typeof v === "boolean" ? (v ? 1 : 0) : +v;
    if (!Number.isFinite(n)) throw new PyError("TypeError", `${q.label} necesita un número`);
    if (q.type === "i" || q.type === "m") n = Math.round(n);
    node.p[q.k] = n;
  } else node.p[q.k] = typeof v === "string" ? v : pyStr(v);
}
function parProxy(ck, node) {
  const def = defOf(node);
  const find = (k) => def?.params.find(q => q.k === k);
  return {
    __typename: "los parámetros de " + node.name,
    __getattr__: (k) => {
      const q = find(k);
      if (!q) return undefined;
      if (["f", "i", "t", "m", "pulse"].includes(q.type)) return parRef(ck, node, q);
      const v = ck.param(node, k);
      return v && typeof v === "object" ? null : v;
    },
    __setattr__: (k, v) => {
      const q = find(k);
      if (!q) throw new PyError("AttributeError", `${node.name} no tiene el parámetro «${k}» (tiene: ${(def?.params || []).map(x => x.k).join(", ")})`);
      setPar(node, q, v);
    },
  };
}
/** Un canal de un CHOP: se usa como un número (su primera muestra) y como lista ([i], .vals). */
function chanRef(name, arr) {
  const v0 = () => +arr[0] || 0;
  return {
    __typename: "un canal", __float__: v0, valueOf: v0, __repr__: () => pyStr(v0()),
    __getattr__: (n) => n === "name" ? name : n === "vals" ? [...arr] : n === "numSamples" ? arr.length : n === "eval" ? B("eval", () => v0()) : undefined,
    __getitem__: (i) => { i = Math.trunc(+i); if (i < 0) i += arr.length; if (i < 0 || i >= arr.length) throw new PyError("IndexError", `el canal ${name} tiene ${arr.length} muestras`); return arr[i]; },
    __len__: () => arr.length,
    __iter__: () => arr[Symbol.iterator](),
  };
}
const proxies = new WeakMap();
export function opProxy(ck, node) {
  if (!node) return null;
  let cache = proxies.get(node);
  if (cache && cache.ck === ck) return cache.p;
  const net = () => ck.net;
  const chop = () => ck.chopOf?.(node) || null;
  const p = {
    __typename: "el nodo " + node.name,
    __repr__: () => `op('${node.name}')`,
    __getattr__: (n) => {
      switch (n) {
        case "name": return node.name;
        case "type": return node.type;
        case "family": return node.fam;
        case "id": return node.id;
        case "path": return "/" + node.name;
        case "digits": return +(/(\d+)$/.exec(node.name)?.[1] || 0);
        case "par": return parProxy(ck, node);
        case "bypass": return !!node.bypass;
        case "comment": return node.comment || "";
        case "nodeX": return node.x;
        case "nodeY": return node.y;
        case "inputs": return node.in.map(id => opProxy(ck, byId(net(), id))).filter(Boolean);
        case "outputs": return net().nodes.filter(o => o.in.includes(node.id)).map(o => opProxy(ck, o));
        case "parent": return B("parent", () => opProxy(ck, byId(net(), node.parent)));
        case "text": return node.fam === "DAT" ? String(node.p.text ?? node.p.code ?? "") : undefined;
        case "numChans": return chop()?.names.length ?? 0;
        case "numSamples": return chop()?.len ?? 0;
        case "chans": return B("chans", ([pat = "*"]) => { const c = chop(); if (!c) return []; const re = new RegExp("^" + String(pat).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$"); return c.names.filter(nm => re.test(nm)).map(nm => chanRef(nm, c.data[nm])); });
        case "chan": return B("chan", ([nm]) => { const c = chop(); return c && c.data[nm] ? chanRef(nm, c.data[nm]) : null; });
        case "cook": return B("cook", () => null);
        case "numRows": return node.fam === "DAT" ? tableRows(node).length : undefined;
        case "numCols": return node.fam === "DAT" ? Math.max(0, ...tableRows(node).map(r => r.length)) : undefined;
        case "row": return B("row", ([r]) => tableRows(node)[r | 0] || null);
        case "col": return B("col", ([c]) => tableRows(node).map(r => r[c | 0] ?? ""));
        case "appendRow": return B("appendRow", ([vals]) => { if (node.fam !== "DAT") throw new PyError("AttributeError", "solo las tablas tienen appendRow"); const rows = tableRows(node); rows.push([...(Array.isArray(vals) ? vals : vals?.a || [vals])].map(v => pyStr(v))); node.p.text = rows.map(r => r.join(", ")).join("\n"); return null; });
        case "clear": return node.fam === "DAT" ? B("clear", () => { node.p.text = ""; return null; }) : undefined;
      }
      return undefined;
    },
    __setattr__: (n, v) => {
      if (n === "bypass") { node.bypass = !!(v?.__float__ ? v.__float__() : v); return; }
      if (n === "text" && node.fam === "DAT") { node.p.text = pyStr(v); return; }
      if (n === "comment") { node.comment = pyStr(v); return; }
      if (n === "nodeX") { node.x = +v; return; }
      if (n === "nodeY") { node.y = +v; return; }
      throw new PyError("AttributeError", `no se puede cambiar «${n}» de ${node.name} (los parámetros van en .par: op('${node.name}').par.algo = …)`);
    },
    __getitem__: (k) => {
      if (node.fam === "CHOP" || (node.fam === "COMP" && ["slider", "button", "xy", "base"].includes(node.type))) {
        const c = chop();
        if (!c) return 0;
        if (typeof k === "number") { const nm = c.names[k < 0 ? k + c.names.length : k]; if (nm === undefined) throw new PyError("IndexError", `${node.name} tiene ${c.names.length} canales`); return chanRef(nm, c.data[nm]); }
        const nm = String(k);
        if (!c.data[nm]) throw new PyError("KeyError", `${node.name} no tiene el canal «${nm}» (tiene: ${c.names.join(", ") || "ninguno"})`);
        return chanRef(nm, c.data[nm]);
      }
      if (node.fam === "DAT") {
        const rows = tableRows(node);
        const [r, c] = Array.isArray(k) ? k : [k, 0];
        const row = rows[r | 0];
        if (!row) throw new PyError("IndexError", `la tabla ${node.name} no tiene la fila ${r}`);
        const cell = row[c | 0] ?? "";
        const n = Number(cell);
        return cell !== "" && Number.isFinite(n) ? n : cell;
      }
      throw new PyError("TypeError", `${node.name} no se puede indexar con [ ]`);
    },
    __setitem__: (k, v) => {
      if (node.fam !== "DAT") throw new PyError("TypeError", `solo se puede escribir en una tabla con [fila, columna]`);
      const rows = tableRows(node);
      const [r, c] = Array.isArray(k) ? k : [k, 0];
      while (rows.length <= r) rows.push([]);
      while (rows[r].length <= c) rows[r].push("");
      rows[r][c] = pyStr(v);
      node.p.text = rows.map(x => x.join(", ")).join("\n");
    },
  };
  proxies.set(node, { ck, p });
  return p;
}
const tableRows = (node) => String(node.p.text ?? "").split(/\r?\n/).filter((l, k, a) => l.length || k < a.length - 1).map(l => l.split(/[,\t;]/).map(x => x.trim()));

/* ---------------- El módulo lumamap (controlar el show) ---------------- */
function lumamapModule(host) {
  const app = host?.app;
  const need = () => { if (!app) throw new PyError("RuntimeError", "esto solo funciona en la ventana del editor de LumaMap"); return app; };
  const S = () => need().S;
  return {
    __module: "lumamap",
    toast: B("toast", ([msg]) => { need().toast?.(pyStr(msg)); return null; }),
    scenes: B("scenes", () => S().project.scenes.map(s => s.name)),
    surfaces: B("surfaces", () => S().project.surfaces.map(s => s.name)),
    scene: B("scene", ([which]) => {
      const sc = S().project.scenes, t = typeof which === "number" ? sc[which - 1] : sc.find(s => s.name.toLowerCase() === String(which).toLowerCase());
      if (!t) throw new PyError("ValueError", `no hay ninguna escena «${which}» (hay: ${sc.map(s => s.name).join(", ")})`);
      need().actions.goScene(t.id); return null;
    }),
    next_scene: B("next_scene", () => { need().actions.stepScene(1); return null; }),
    prev_scene: B("prev_scene", () => { need().actions.stepScene(-1); return null; }),
    current_scene: B("current_scene", () => S().project.scenes.find(s => s.id === S().project.sceneId)?.name || ""),
    blackout: B("blackout", ([on]) => { const a = need(); if (on === undefined || !!a.S.blackout !== !!on) a.actions.blackout(); return !!a.S.blackout; }),
    play: B("play", ([on = true]) => { const a = need(); if (!!a.S.playing !== !!on) a.actions.togglePlay(); return null; }),
    bpm: B("bpm", () => S().project.settings.bpm || 120),
    set_bpm: B("set_bpm", ([v]) => { need().actions.setBpm(+v); return null; }),
    level: B("level", ([band = "level"]) => +(S().levels?.[band] || 0)),
    get_param: B("get_param", ([id]) => { const d = need().describeParam?.(String(id)); if (!d) throw new PyError("ValueError", `no existe el parámetro «${id}»`); return d.get(); }),
    set_param: B("set_param", ([id, v]) => { const d = need().describeParam?.(String(id)); if (!d) throw new PyError("ValueError", `no existe el parámetro «${id}» (p. ej. global/master o surf/<nombre>/opacity)`); d.set(+v); need().changed?.(); return null; }),
  };
}

/* ---------------- Intérprete de cada nodo ---------------- */
/**
 * El intérprete de un nodo de script (se crea cuando cambia el código y ejecuta el módulo una vez).
 * Devuelve { I, fresh } o lanza el error (con su línea).
 */
export function pyFor(ck, node, code, extra = {}) {
  let st = ck.state.get(node.id);
  if (!st) ck.state.set(node.id, st = {});
  if (st.pySrc === code && st.py && !st.pyErr) return { I: st.py, fresh: false };
  if (st.pySrc === code && st.pyErr) throw st.pyErr;
  st.pySrc = code; st.pyErr = null; st.py = null; st.started = false;
  const I = new Interp({ print: (t) => pyConsole.push(t, "out", node.name), maxSteps: 400_000, modules: { lumamap: lumamapModule(ck.host), td: null }, globals: makeGlobals(ck, node, extra) });
  delete I.modules.td;
  I.modules.td = { __module: "td", ...Object.fromEntries([...I.globals.entries()]) };
  try { I.run(code); }
  catch (e) { st.pyErr = e; pyConsole.push(formatError(e), "err", node.name); throw e; }
  st.py = I;
  return { I, fresh: true };
}
/** Las variables que todo script tiene a mano. */
export function makeGlobals(ck, node, extra = {}) {
  const net = () => ck.net;
  const absTime = { __typename: "el tiempo", __getattr__: (n) => n === "seconds" ? ck.env.t || 0 : n === "frame" ? ck.env.frame || 0 : undefined, __repr__: () => `absTime(${(ck.env.t || 0).toFixed(2)} s)` };
  const op = B("op", ([name]) => {
    const n = byName(net(), String(name).replace(/^.*\//, ""));
    if (!n) throw new PyError("NameError", `no hay ningún nodo «${name}» en la red`);
    return opProxy(ck, n);
  });
  return {
    op,
    ops: B("ops", (pats) => { const res = pats.map(p => new RegExp("^" + String(p).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$")); return net().nodes.filter(n => res.some(r => r.test(n.name))).map(n => opProxy(ck, n)); }),
    me: node ? opProxy(ck, node) : null,
    parent: B("parent", () => node?.parent ? opProxy(ck, byId(net(), node.parent)) : null),
    absTime,
    project: { __typename: "el proyecto", __getattr__: (n) => n === "name" ? ck.host?.app?.S.project.name ?? "" : n === "bpm" ? ck.host?.app?.S.project.settings.bpm ?? (ck.env.bpm || 120) : undefined },
    ...extra,
  };
}

/* ---------------- Script CHOP ---------------- */
/** Ejecuta onCook(scriptOp) y devuelve { names, data, len }. */
export function runScriptChop(ck, node, code, inputs) {
  const { I } = pyFor(ck, node, code);
  const chans = [];
  let numSamples = 1;
  const sop = {
    __typename: "scriptOp",
    __getattr__: (n) => {
      switch (n) {
        case "clear": return B("clear", () => { chans.length = 0; return null; });
        case "appendChan": return B("appendChan", ([name]) => {
          const nm = String(name || "chan" + (chans.length + 1));
          const ch = { name: nm, vals: new Array(numSamples).fill(0) };
          chans.push(ch);
          return { __typename: "un canal", __getattr__: (k) => k === "name" ? nm : k === "vals" ? [...ch.vals] : undefined, __setattr__: (k, v) => { if (k === "vals") ch.vals = [...(Array.isArray(v) ? v : v.a || [])].map(x => +x || 0); }, __setitem__: (i, v) => { i = Math.trunc(+i); if (i < 0 || i >= ch.vals.length) throw new PyError("IndexError", `el canal tiene ${ch.vals.length} muestras (cambia scriptOp.numSamples)`); ch.vals[i] = v?.__float__ ? v.__float__() : +v || 0; }, __getitem__: (i) => ch.vals[Math.trunc(+i)] ?? 0, __len__: () => ch.vals.length };
        });
        case "numSamples": return numSamples;
        case "numChans": return chans.length;
        case "inputs": return inputs.map((c, k) => c ? inputProxy(c, k) : null).filter(Boolean);
        case "name": return node.name;
        case "par": return parProxy(ck, node);
      }
      return undefined;
    },
    __setattr__: (n, v) => {
      if (n === "numSamples") { numSamples = Math.max(1, Math.min(100000, Math.round(+(v?.__float__ ? v.__float__() : v) || 1))); for (const c of chans) c.vals = Array.from({ length: numSamples }, (_, i) => c.vals[i] ?? 0); return; }
      throw new PyError("AttributeError", `no se puede cambiar «${n}» de scriptOp`);
    },
  };
  const ret = I.callIfExists("onCook", [sop]);
  if (ret instanceof Dict) {   // También vale devolver {'x': 0.5, 'y': [..]}
    for (const [k, v] of ret.m.values()) chans.push({ name: pyStr(k), vals: Array.isArray(v) ? v.map(x => +x || 0) : v instanceof Tuple ? v.a.map(x => +x || 0) : [+v || 0] });
  }
  const names = [], data = {};
  let len = 1;
  for (const c of chans) { let nm = c.name, k = 2; while (data[nm]) nm = c.name + k++; names.push(nm); data[nm] = c.vals.map(x => +x || 0); len = Math.max(len, c.vals.length); }
  return { names, data, len };
}
function inputProxy(c, k) {
  return {
    __typename: "la entrada " + (k + 1), __repr__: () => `<entrada ${k + 1}: ${c.names.join(", ")}>`,
    __getattr__: (n) => n === "numChans" ? c.names.length : n === "numSamples" ? c.len : n === "chans" ? B("chans", () => c.names.map(nm => chanRef(nm, c.data[nm]))) : undefined,
    __getitem__: (key) => { const nm = typeof key === "number" ? c.names[key] : String(key); if (!c.data[nm]) throw new PyError("KeyError", `la entrada no tiene el canal «${key}» (tiene: ${c.names.join(", ")})`); return chanRef(nm, c.data[nm]); },
  };
}

/* ---------------- Ejecutar (DAT) ---------------- */
/** Una vez por fotograma: onStart (la primera vez), onFrameStart y los avisos del CHOP vigilado. */
export function runExecute(ck, node, p) {
  const { I, fresh } = pyFor(ck, node, String(p.code || ""));
  const st = ck.state.get(node.id);
  if (fresh || st.restart !== p.restart) { st.restart = p.restart; st.prev = null; I.callIfExists("onStart"); }
  I.callIfExists("onFrameStart", [ck.env.frame || 0]);
  if (p.chop) {
    const c = ck.chopByName(p.chop);
    if (c) {
      const prev = st.prev || {};
      const next = {};
      for (const nm of c.names) {
        const v = +c.data[nm][0] || 0, was = prev[nm];
        next[nm] = v;
        if (was === undefined) continue;
        if (v !== was) {
          const ch = chanRef(nm, c.data[nm]);
          I.callIfExists("onValueChange", [ch, v, was]);
          if (was < 0.5 && v >= 0.5) I.callIfExists("onOffToOn", [ch]);
          if (was >= 0.5 && v < 0.5) I.callIfExists("onOnToOff", [ch]);
        }
      }
      st.prev = next;
    }
  }
}

/* ---------------- Consola (REPL) ---------------- */
/** Un intérprete para la consola de una red: las variables se quedan entre líneas. */
export function replFor(ck, net) {
  const key = "__repl:" + net.id;
  let st = ck.state.get(key);
  if (!st) {
    st = {};
    st.I = new Interp({ print: (t) => pyConsole.push(t, "out", "consola"), maxSteps: 2_000_000, modules: { lumamap: lumamapModule(ck.host) }, globals: makeGlobals(ck, null) });
    ck.state.set(key, st);
  }
  return st.I;
}
/** Ejecuta una línea (o un bloque) en la consola: si es una expresión, enseña su valor. */
export function replRun(ck, net, src) {
  const I = replFor(ck, net);
  pyConsole.push(src.split("\n").map((l, k) => (k ? "... " : ">>> ") + l).join("\n"), "in", "consola");
  try {
    // Una expresión suelta enseña su valor (como la consola de Python); lo demás se ejecuta.
    const looksExpr = !/^\s*(import|from|def|for|while|if|try|global|del|pass|return|raise|assert)\b/.test(src) && !/(^|[^=!<>])=($|[^=])/.test(src.replace(/(["']).*?\1/g, ""));
    if (looksExpr && isExpression(src)) { const v = I.evalExpr(src); if (v !== null && v !== undefined) pyConsole.push(pyStr(v, true), "out", "consola"); }
    else I.run(src);
    return true;
  } catch (e) { pyConsole.push(formatError(e), "err", "consola"); return false; }
}
