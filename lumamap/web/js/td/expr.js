// web/js/td/expr.js
// Expresiones de los parámetros de la red (como las expresiones de TouchDesigner, sin ejecutar
// código: se analizan y se evalúan con un intérprete propio, así que son seguras).
//   absTime.seconds * 0.5          lfo1.chan1 * 2 + 0.5          op('noise1')['tx'][me.digits]
//   fit(audio1.bass, 0, 1, 0.2, 3) clamp(track1.right_hand_y, 0, 1)   me.time   sin(t * pi)
//   op('level1').par.brightness    tab('table1', 2, 1)            beat > 0.5 ? 1 : 0
// Referencias: nombre de un nodo → sus canales (CHOP) o sus parámetros (.par.x).
// compileExpr(texto) → { fn(env) → número, error, refs: Set(nombres de nodos) }.

const FUNCS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
  abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: Math.round, sqrt: Math.sqrt, pow: Math.pow, exp: Math.exp,
  log: Math.log, log10: Math.log10, sign: Math.sign, min: Math.min, max: Math.max, hypot: Math.hypot,
  int: (x) => Math.trunc(x), float: (x) => +x,
  clamp: (x, a = 0, b = 1) => Math.min(Math.max(x, a), b),
  fit: (x, a, b, c, d) => { const k = b === a ? 0 : (x - a) / (b - a); return c + Math.min(1, Math.max(0, k)) * (d - c); },
  fitu: (x, a, b, c, d) => b === a ? c : c + (x - a) / (b - a) * (d - c),   // sin limitar
  lerp: (a, b, t) => a + (b - a) * t, mix: (a, b, t) => a + (b - a) * t,
  step: (e, x) => x < e ? 0 : 1,
  smoothstep: (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a || 1))); return t * t * (3 - 2 * t); },
  fract: (x) => x - Math.floor(x), mod: (a, b) => ((a % b) + b) % b,
  rand: (s = 0) => hash1(s * 12.9898 + 0.137),
  noise: (x = 0, y = 0, z = 0) => noise3(x, y, z),
  pulse: (x, w = 0.5) => (x - Math.floor(x)) < w ? 1 : 0,
  tri: (x) => 1 - Math.abs(((x % 1) + 1) % 1 * 2 - 1),
  deg: (r) => r * 180 / Math.PI, rad: (d) => d * Math.PI / 180,
};
const CONSTS = { pi: Math.PI, PI: Math.PI, e: Math.E, true: 1, false: 0, True: 1, False: 0 };
export const EXPR_FUNCS = Object.keys(FUNCS);

/* ---------------- Ruido (determinista: mismo resultado en el editor y en la salida) ---------------- */
function hash1(n) { const s = Math.sin(n) * 43758.5453123; return s - Math.floor(s); }
function hash3(x, y, z) { return hash1(x * 127.1 + y * 311.7 + z * 74.7); }
const fade = (t) => t * t * (3 - 2 * t);
/** Ruido de valor suave en 3D, de 0 a 1. */
export function noise3(x, y = 0, z = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = fade(x - xi), yf = fade(y - yi), zf = fade(z - zi);
  const l = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), xf), l(c(0, 1, 0), c(1, 1, 0), xf), yf),
           l(l(c(0, 0, 1), c(1, 0, 1), xf), l(c(0, 1, 1), c(1, 1, 1), xf), yf), zf);
}

/* ---------------- Analizador ---------------- */
function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] || ""))) {
      const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
      if (!m) throw new Error(`número mal escrito cerca de «${src.slice(i, i + 6)}»`);
      out.push({ t: "num", v: parseFloat(m[0]) }); i += m[0].length; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
      out.push({ t: "id", v: m[0] }); i += m[0].length; continue;
    }
    if (c === "'" || c === '"') {
      const j = src.indexOf(c, i + 1);
      if (j < 0) throw new Error("falta cerrar las comillas");
      out.push({ t: "str", v: src.slice(i + 1, j) }); i = j + 1; continue;
    }
    const two = src.slice(i, i + 2);
    if (["**", "<=", ">=", "==", "!=", "&&", "||"].includes(two)) { out.push({ t: "op", v: two }); i += 2; continue; }
    if ("+-*/%^<>!?:()[],.".includes(c)) { out.push({ t: "op", v: c }); i++; continue; }
    throw new Error(`no entiendo «${c}»`);
  }
  out.push({ t: "end" });
  return out;
}

function parse(src) {
  const T = tokenize(src);
  let p = 0;
  const peek = () => T[p], next = () => T[p++];
  const isOp = (v) => T[p].t === "op" && T[p].v === v;
  const isWord = (v) => T[p].t === "id" && T[p].v === v;
  const expect = (v) => { if (!isOp(v)) throw new Error(`falta «${v}»`); p++; };
  function expr() { return ternary(); }
  function ternary() {
    const c = or();
    if (isOp("?")) { p++; const a = expr(); expect(":"); const b = expr(); return { k: "if", c, a, b }; }
    // Estilo Python: a if c else b
    if (isWord("if")) { p++; const cond = or(); if (!isWord("else")) throw new Error("falta «else»"); p++; const b = expr(); return { k: "if", c: cond, a: c, b }; }
    return c;
  }
  function or() { let a = and(); while (isOp("||") || isWord("or")) { p++; a = { k: "or", a, b: and() }; } return a; }
  function and() { let a = cmp(); while (isOp("&&") || isWord("and")) { p++; a = { k: "and", a, b: cmp() }; } return a; }
  function cmp() {
    let a = add();
    while (T[p].t === "op" && ["<", ">", "<=", ">=", "==", "!="].includes(T[p].v)) { const o = next().v; a = { k: "bin", o, a, b: add() }; }
    return a;
  }
  function add() { let a = mul(); while (isOp("+") || isOp("-")) { const o = next().v; a = { k: "bin", o, a, b: mul() }; } return a; }
  function mul() { let a = unary(); while (isOp("*") || isOp("/") || isOp("%")) { const o = next().v; a = { k: "bin", o, a, b: unary() }; } return a; }
  function unary() {
    if (isOp("-")) { p++; return { k: "neg", a: unary() }; }
    if (isOp("+")) { p++; return unary(); }
    if (isOp("!") || isWord("not")) { p++; return { k: "not", a: unary() }; }
    return pow();
  }
  function pow() {
    const a = postfix();
    if (isOp("**") || isOp("^")) { p++; return { k: "bin", o: "**", a, b: unary() }; }
    return a;
  }
  function postfix() {
    let a = primary();
    for (;;) {
      if (isOp(".")) { p++; const t = next(); if (t.t !== "id") throw new Error("falta un nombre después del punto"); a = { k: "get", a, key: { k: "str", v: t.v } }; continue; }
      if (isOp("[")) { p++; const key = expr(); expect("]"); a = { k: "get", a, key }; continue; }
      if (isOp("(")) {
        p++; const args = [];
        if (!isOp(")")) { do { args.push(expr()); } while (isOp(",") && ++p); }
        expect(")");
        a = { k: "call", f: a, args }; continue;
      }
      return a;
    }
  }
  function primary() {
    const t = next();
    if (t.t === "num") return { k: "num", v: t.v };
    if (t.t === "str") return { k: "str", v: t.v };
    if (t.t === "id") return { k: "id", v: t.v };
    if (t.t === "op" && t.v === "(") { const e = expr(); expect(")"); return e; }
    throw new Error(t.t === "end" ? "la expresión está incompleta" : `sobra «${t.v}»`);
  }
  const ast = expr();
  if (peek().t !== "end") throw new Error(`sobra «${peek().v}»`);
  return ast;
}

/* ---------------- Valores ---------------- */
/** Referencia a un nodo (lo que da `op('x')` o un nombre suelto). */
export class NodeRef { constructor(env, name) { this.env = env; this.name = name; } }
/** Un canal de un CHOP (se lee como número: la muestra `me.i`, o la 0). */
export class ChanRef { constructor(arr, i = 0) { this.arr = arr; this.i = i; } }
class ParRef { constructor(env, name) { this.env = env; this.name = name; } }

export function toNum(v, env) {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof ChanRef) { const a = v.arr; if (!a || !a.length) return 0; const i = Math.min(a.length - 1, Math.max(0, v.i ?? env?.i ?? 0)); return a[i] ?? 0; }
  if (v instanceof NodeRef) { const c = env?.chop?.(v.name); const first = c && c.names[0]; return first ? (c.data[first][Math.min(c.len - 1, env?.i ?? 0)] ?? 0) : 0; }
  if (typeof v === "string") { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; }
  return 0;
}
function getMember(o, key, env) {
  if (o instanceof NodeRef) {
    if (key === "par") return new ParRef(env, o.name);
    const c = env.chop?.(o.name);
    if (key === "numChans") return c ? c.names.length : 0;
    if (key === "numSamples") return c ? c.len : 0;
    if (typeof key === "number") { const n = c?.names[key]; return n ? new ChanRef(c.data[n], env.i) : 0; }
    if (c && c.data[key]) return new ChanRef(c.data[key], env.i);
    if (key === "name") return o.name;
    env.missing?.(`${o.name}.${key}`);
    return 0;
  }
  if (o instanceof ParRef) return env.par ? env.par(o.name, key) : 0;
  if (o instanceof ChanRef) return typeof key === "number" ? new ChanRef(o.arr, key | 0) : 0;
  if (o && typeof o === "object" && key in o) return o[key];
  return 0;
}

function build(n, refs) {
  switch (n.k) {
    case "num": { const v = n.v; return () => v; }
    case "str": { const v = n.v; return () => v; }
    case "id": {
      const name = n.v;
      if (name in CONSTS) { const v = CONSTS[name]; return () => v; }
      if (name === "absTime") return (env) => ({ seconds: env.t ?? 0, frame: env.frame ?? 0 });
      if (name === "me") return (env) => env.me || {};
      if (name in FUNCS) return () => FUNCS[name];
      if (name === "op") return (env) => (nm) => { refs.add(String(nm)); return new NodeRef(env, String(nm)); };
      if (name === "tab") return (env) => (tname, r, c) => env.tab ? env.tab(String(tname), r, c) : 0;
      // Variables del momento: t, time, frame, bpm, beat, i (instancia), y los niveles de audio.
      return (env) => {
        if (env.vars && name in env.vars) return env.vars[name];
        refs.add(name);
        return new NodeRef(env, name);
      };
    }
    case "get": {
      const a = build(n.a, refs), k = build(n.key, refs);
      if (n.a.k === "id" && n.key.k === "str") refs.add(n.a.v);
      return (env) => { let key = k(env); if (key instanceof ChanRef || key instanceof NodeRef) key = toNum(key, env); return getMember(a(env), key, env); };
    }
    case "call": {
      const f = build(n.f, refs), args = n.args.map(x => build(x, refs));
      const raw = n.f.k === "id" && (n.f.v === "op" || n.f.v === "tab");
      if (n.f.k === "id" && n.f.v === "op" && n.args[0]?.k === "str") refs.add(n.args[0].v);
      return (env) => {
        const fn = f(env);
        if (typeof fn !== "function") return 0;
        const vals = args.map(x => x(env));
        return fn(...(raw ? vals.map((v, i) => i === 0 ? v : toNum(v, env)) : vals.map(v => toNum(v, env))));
      };
    }
    case "neg": { const a = build(n.a, refs); return (env) => -toNum(a(env), env); }
    case "not": { const a = build(n.a, refs); return (env) => toNum(a(env), env) ? 0 : 1; }
    case "and": { const a = build(n.a, refs), b = build(n.b, refs); return (env) => toNum(a(env), env) && toNum(b(env), env) ? 1 : 0; }
    case "or": { const a = build(n.a, refs), b = build(n.b, refs); return (env) => toNum(a(env), env) || toNum(b(env), env) ? 1 : 0; }
    case "if": { const c = build(n.c, refs), a = build(n.a, refs), b = build(n.b, refs); return (env) => toNum(c(env), env) ? a(env) : b(env); }
    case "bin": {
      const a = build(n.a, refs), b = build(n.b, refs), o = n.o;
      return (env) => {
        const x = toNum(a(env), env), y = toNum(b(env), env);
        switch (o) {
          case "+": return x + y; case "-": return x - y; case "*": return x * y;
          case "/": return y === 0 ? 0 : x / y; case "%": return y === 0 ? 0 : ((x % y) + y) % y; case "**": return Math.pow(x, y);
          case "<": return x < y ? 1 : 0; case ">": return x > y ? 1 : 0; case "<=": return x <= y ? 1 : 0; case ">=": return x >= y ? 1 : 0;
          case "==": return x === y ? 1 : 0; case "!=": return x !== y ? 1 : 0;
        }
        return 0;
      };
    }
  }
  throw new Error("expresión no válida");
}

const cache = new Map();
/** Compila (una vez) una expresión. Nunca lanza: si está mal, `error` dice por qué y fn da 0. */
export function compileExpr(src) {
  src = String(src ?? "");
  let c = cache.get(src);
  if (c) return c;
  const refs = new Set();
  try {
    const f = build(parse(src), refs);
    c = { fn: (env) => { const v = toNum(f(env), env); return Number.isFinite(v) ? v : 0; }, raw: f, error: "", refs };
  } catch (e) {
    c = { fn: () => 0, raw: () => 0, error: e.message || String(e), refs };
  }
  if (cache.size > 2000) cache.clear();
  cache.set(src, c);
  return c;
}
/** Evalúa una expresión y devuelve también los fallos (nombres que no existen). */
export function evalExpr(src, env = {}) {
  const c = compileExpr(src);
  const missing = [];
  const v = c.fn({ ...env, missing: (m) => missing.push(m) });
  return { value: v, error: c.error || (missing.length ? `no existe ${missing[0]}` : "") };
}
/** Cambia las referencias a un nodo renombrado dentro de una expresión. */
export function renameInExpr(src, from, to) {
  const esc = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return String(src)
    .replace(new RegExp(`op\\((['"])${esc}\\1\\)`, "g"), `op('${to}')`)
    .replace(new RegExp(`(^|[^A-Za-z0-9_.'"])${esc}(?=\\s*[.\\[])`, "g"), `$1${to}`);
}
