// web/js/td/py.js
// «Python de LumaMap»: un intérprete de Python escrito para LumaMap, como los scripts de
// TouchDesigner pero seguro (no puede tocar tus archivos, la red ni el sistema).
//   · El núcleo del lenguaje: variables, if/elif/else, for/while (break, continue, else), def con
//     valores por defecto, *args y **kwargs, lambda, return, global, try/except/finally, raise,
//     assert, del, listas, tuplas, diccionarios, conjuntos, rebanadas, comprensiones,
//     f-strings, .format() y %, operadores de Python (//, %, **, in, is, not, and/or).
//   · Módulos: math, random, time, colorsys (import math, from random import randint…).
//   · Lo que le da el anfitrión (la red): op('noise1').par.period = 3, me, absTime, print…
// Lo que no tiene (a propósito o aún): clases propias, importar otras librerías (numpy…),
// archivos y red. Un script que tarda demasiado se corta para que el show no se congele.

/* ======================================================================
   Errores
   ====================================================================== */
export class PyError extends Error {
  constructor(type, msg, line = 0) { super(msg); this.pyType = type; this.line = line; this.args = [msg]; }
  toString() { return `${this.pyType}: ${this.message}`; }
}
const HINTS = {
  NameError: "Revisa cómo está escrito el nombre (mayúsculas incluidas) o si falta crearlo antes.",
  SyntaxError: "Mira la línea: suele faltar «:» al final de if/for/def, cerrar un paréntesis o unas comillas.",
  IndentationError: "Los bloques van con la misma sangría (4 espacios) dentro de if/for/def.",
  TypeError: "Se mezclan tipos que no van juntos (por ejemplo texto + número: usa str(n)).",
  ZeroDivisionError: "Se divide entre 0.",
  IndexError: "La posición no existe en la lista (empiezan en 0).",
  KeyError: "Esa clave no está en el diccionario (usa .get(clave, valor_por_defecto)).",
  TimeoutError: "Un bucle no termina o hace demasiado trabajo en un fotograma.",
  AttributeError: "Ese objeto no tiene esa propiedad o función.",
};
/** Texto de un error para mostrarlo: «Línea 3 · NameError: …» + pista. */
export function formatError(e) {
  if (!(e instanceof PyError)) return String(e?.message || e);
  return `${e.line ? `Línea ${e.line} · ` : ""}${e.pyType}: ${e.message}${HINTS[e.pyType] ? "\n→ " + HINTS[e.pyType] : ""}`;
}

/* ======================================================================
   Tipos
   ====================================================================== */
export class Tuple { constructor(a) { this.a = a; } }
export class PySet { constructor(it = []) { this.m = new Map(); for (const v of it) this.m.set(hashKey(v), v); } }
export class Dict {
  constructor() { this.m = new Map(); }
  get(k) { return this.m.get(hashKey(k))?.[1]; }
  has(k) { return this.m.has(hashKey(k)); }
  set(k, v) { this.m.set(hashKey(k), [k, v]); }
  del(k) { return this.m.delete(hashKey(k)); }
  keys() { return [...this.m.values()].map(e => e[0]); }
  values() { return [...this.m.values()].map(e => e[1]); }
  items() { return [...this.m.values()].map(e => new Tuple([e[0], e[1]])); }
  get size() { return this.m.size; }
  static from(obj) { const d = new Dict(); for (const [k, v] of Object.entries(obj)) d.set(k, v); return d; }
}
class Range {
  constructor(a, b, c) { this.start = a; this.stop = b; this.step = c; if (!c) throw new PyError("ValueError", "range() con paso 0"); }
  get length() { const n = Math.ceil((this.stop - this.start) / this.step); return Math.max(0, n); }
  *[Symbol.iterator]() { for (let i = this.start; this.step > 0 ? i < this.stop : i > this.stop; i += this.step) yield i; }
  at(i) { return this.start + i * this.step; }
}
export class PyFunc { constructor(name, params, body, closure, isLambda = false) { Object.assign(this, { name, params, body, closure, isLambda }); } }
/** Función de JavaScript que se puede llamar desde Python: fn(args, kwargs, interp). */
export const builtin = (name, fn) => { fn.__py = name; return fn; };
const ExcClass = (name, base = "Exception") => { const f = builtin(name, (args) => new PyError(name, args.length ? pyStr(args[0]) : "")); f.__exc = name; f.__base = base; return f; };

function hashKey(v) {
  if (v === null || v === undefined) return "N";
  switch (typeof v) {
    case "number": return "n" + v;
    case "boolean": return "n" + (v ? 1 : 0);
    case "string": return "s" + v;
  }
  if (v instanceof Tuple) return "t(" + v.a.map(hashKey).join(",") + ")";
  if (Array.isArray(v) || v instanceof Dict || v instanceof PySet) throw new PyError("TypeError", "una lista o diccionario no se puede usar como clave");
  return "o" + (v.__id ||= ++oid);
}
let oid = 0;

/* ======================================================================
   Texto (str / repr / formatos)
   ====================================================================== */
function numStr(v) {
  if (Number.isNaN(v)) return "nan";
  if (v === Infinity) return "inf";
  if (v === -Infinity) return "-inf";
  if (Object.is(v, -0)) return "-0.0";
  if (Math.abs(v) >= 1e16 || (v !== 0 && Math.abs(v) < 1e-4)) return v.toExponential().replace(/e([+-])(\d)$/, "e$10$2");
  return String(v);
}
export function pyRepr(v) {
  if (typeof v === "string") return "'" + v.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n") + "'";
  return pyStr(v, true);
}
export function pyStr(v, inner = false) {
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "number") return numStr(v);
  if (typeof v === "string") return inner ? pyRepr(v) : v;
  if (Array.isArray(v)) return "[" + v.map(pyRepr).join(", ") + "]";
  if (v instanceof Tuple) return "(" + v.a.map(pyRepr).join(", ") + (v.a.length === 1 ? "," : "") + ")";
  if (v instanceof Dict) return "{" + [...v.m.values()].map(([k, x]) => pyRepr(k) + ": " + pyRepr(x)).join(", ") + "}";
  if (v instanceof PySet) return v.m.size ? "{" + [...v.m.values()].map(pyRepr).join(", ") + "}" : "set()";
  if (v instanceof Range) return `range(${v.start}, ${v.stop}${v.step !== 1 ? ", " + v.step : ""})`;
  if (v instanceof PyError) return inner ? `${v.pyType}(${pyRepr(v.message)})` : v.message;
  if (v instanceof PyFunc) return `<función ${v.name}>`;
  if (typeof v === "function") return `<función ${v.__py || v.name || "?"}>`;
  if (v.__repr__) return v.__repr__();
  if (v.__module) return `<módulo ${v.__module}>`;
  return "<objeto>";
}
/** Formato de f-strings y .format(): [[relleno]alineado][signo][0][ancho][,][.precisión][tipo] */
function formatSpec(v, spec) {
  if (!spec) return pyStr(v);
  const m = /^(?:(.)?([<>^=]))?([+\- ])?(0)?(\d+)?([,_])?(?:\.(\d+))?([bcdeEfFgGnosxX%])?$/.exec(spec);
  if (!m) throw new PyError("ValueError", `formato no válido: «${spec}»`);
  let [, fill = " ", align, sign = "-", zero, width, group, prec, type] = m;
  let s;
  if (typeof v === "number" || typeof v === "boolean") {
    let n = +v;
    const p = prec !== undefined ? +prec : null;
    switch (type) {
      case "f": case "F": s = Math.abs(n).toFixed(p ?? 6); break;
      case "e": case "E": s = Math.abs(n).toExponential(p ?? 6).replace(/e([+-])(\d)$/, "e$10$2"); if (type === "E") s = s.toUpperCase(); break;
      case "%": s = (Math.abs(n) * 100).toFixed(p ?? 6) + "%"; break;
      case "d": s = String(Math.trunc(Math.abs(n))); break;
      case "x": s = Math.trunc(Math.abs(n)).toString(16); break;
      case "X": s = Math.trunc(Math.abs(n)).toString(16).toUpperCase(); break;
      case "b": s = Math.trunc(Math.abs(n)).toString(2); break;
      case "o": s = Math.trunc(Math.abs(n)).toString(8); break;
      case "g": case "G": s = p !== null ? String(+Math.abs(n).toPrecision(p || 1)) : numStr(Math.abs(n)); break;
      default: s = p !== null ? Math.abs(n).toFixed(p) : numStr(Math.abs(n));
    }
    if (group) { const [i, f] = s.split("."); s = i.replace(/\B(?=(\d{3})+(?!\d))/g, group) + (f !== undefined ? "." + f : ""); }
    const neg = n < 0 || Object.is(n, -0);
    const sg = neg ? "-" : sign === "+" ? "+" : sign === " " ? " " : "";
    if (zero && !align) { const w = +(width || 0); s = sg + s.padStart(Math.max(0, w - sg.length), "0"); return s; }
    s = sg + s;
    if (!align) align = ">";
  } else {
    s = pyStr(v);
    if (prec !== undefined) s = s.slice(0, +prec);
    if (!align) align = "<";
  }
  const w = +(width || 0);
  if (s.length >= w) return s;
  const pad = w - s.length;
  if (align === "<") return s + fill.repeat(pad);
  if (align === "^") return fill.repeat(Math.floor(pad / 2)) + s + fill.repeat(Math.ceil(pad / 2));
  return fill.repeat(pad) + s;
}
function percentFormat(fmt, args) {
  const list = args instanceof Tuple ? args.a : [args];
  let k = 0;
  return fmt.replace(/%([-+ 0]*)(\d+)?(?:\.(\d+))?([sdifrx%])/g, (m, flags, w, p, t) => {
    if (t === "%") return "%";
    const v = list[k++];
    let spec = (flags.includes("-") ? "<" : "") + (flags.includes("+") ? "+" : "") + (flags.includes("0") ? "0" : "") + (w || "") + (p !== undefined ? "." + p : "");
    if (t === "s") return formatSpec(pyStr(v), spec);
    if (t === "r") return formatSpec(pyRepr(v), spec);
    return formatSpec(v, spec + (t === "i" ? "d" : t));
  });
}

/* ======================================================================
   Tokens
   ====================================================================== */
const KEYWORDS = new Set(["False", "None", "True", "and", "as", "assert", "break", "continue", "def", "del", "elif", "else", "except", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda", "nonlocal", "not", "or", "pass", "raise", "return", "try", "while", "with", "yield", "class"]);
const OPS3 = ["**=", "//=", ">>=", "<<=", "..."];
const OPS2 = ["**", "//", "==", "!=", "<=", ">=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "->", "<<", ">>", ":="];
const OPS1 = "+-*/%<>=()[]{}:,.;@&|^~!";

export function tokenize(src) {
  const toks = [], indents = [0];
  const lines = String(src).replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
  let depth = 0, contLine = false;
  const err = (msg, ln) => { throw new PyError("SyntaxError", msg, ln); };
  for (let li = 0; li < lines.length; li++) {
    let line = lines[li], i = 0;
    const ln = li + 1;
    // Sangría (solo al empezar una línea lógica fuera de paréntesis).
    if (depth === 0 && !contLine) {
      const m = /^ */.exec(line)[0].length;
      const rest = line.slice(m);
      if (!rest.trim() || rest.trimStart().startsWith("#")) continue;
      if (m > indents.at(-1)) { indents.push(m); toks.push({ t: "INDENT", line: ln }); }
      else {
        while (m < indents.at(-1)) { indents.pop(); toks.push({ t: "DEDENT", line: ln }); }
        if (m !== indents.at(-1)) throw new PyError("IndentationError", "la sangría no coincide con la de ningún bloque anterior", ln);
      }
      i = m;
    }
    contLine = false;
    while (i < line.length) {
      const c = line[i];
      if (c === " ") { i++; continue; }
      if (c === "#") break;
      if (c === "\\" && i === line.length - 1) { contLine = true; i++; continue; }
      // Números
      if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(line[i + 1] || ""))) {
        const m = /^(0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*)?\.?\d*(?:[eE][+-]?\d+)?)/.exec(line.slice(i));
        let s = m[0];
        if (!s) err("número mal escrito", ln);
        const clean = s.replace(/_/g, "");
        const v = /^0[xX]/.test(clean) ? parseInt(clean.slice(2), 16) : /^0[bB]/.test(clean) ? parseInt(clean.slice(2), 2) : /^0[oO]/.test(clean) ? parseInt(clean.slice(2), 8) : parseFloat(clean);
        toks.push({ t: "NUM", v, line: ln });
        i += s.length;
        continue;
      }
      // Textos (con prefijos f, r, b, combinados)
      const pm = /^([rRbBfFuU]{0,2})(['"])/.exec(line.slice(i));
      if (pm && (pm[1] === "" || /^[rRbBfFuU]+$/.test(pm[1])) && (pm[1] || c === "'" || c === '"')) {
        const pre = pm[1].toLowerCase(), q = pm[2];
        let j = i + pm[1].length;
        const triple = line.slice(j, j + 3) === q.repeat(3);
        const close = triple ? q.repeat(3) : q;
        j += close.length;
        let out = "", startLine = ln;
        for (;;) {
          if (j >= line.length) {
            if (!triple) err("falta cerrar las comillas", startLine);
            out += "\n"; li++;
            if (li >= lines.length) err("falta cerrar las comillas triples", startLine);
            line = lines[li]; j = 0; continue;
          }
          if (line.startsWith(close, j)) { j += close.length; break; }
          const ch = line[j];
          if (ch === "\\" && !pre.includes("r")) {
            const n = line[j + 1];
            if (n === undefined) { j++; continue; }
            const map = { n: "\n", t: "\t", r: "\r", "\\": "\\", "'": "'", '"': '"', "0": "\0", a: "\x07", b: "\b", f: "\f", v: "\v" };
            if (n === "x") { out += String.fromCharCode(parseInt(line.substr(j + 2, 2), 16)); j += 4; continue; }
            if (n === "u") { out += String.fromCharCode(parseInt(line.substr(j + 2, 4), 16)); j += 6; continue; }
            out += map[n] ?? ("\\" + n); j += 2; continue;
          }
          out += ch; j++;
        }
        const tok = pre.includes("f") ? { t: "FSTR", v: out, line: startLine } : { t: "STR", v: out, line: startLine };
        // Textos seguidos se juntan ('a' 'b' → 'ab').
        const prev = toks.at(-1);
        if (prev && prev.t === "STR" && tok.t === "STR") prev.v += tok.v; else toks.push(tok);
        i = j;
        continue;
      }
      if (/[A-Za-z_À-ɏ]/.test(c)) {
        const m = /^[A-Za-z_À-ɏ][A-Za-z0-9_À-ɏ]*/.exec(line.slice(i))[0];
        toks.push({ t: KEYWORDS.has(m) ? "KW" : "NAME", v: m, line: ln });
        i += m.length;
        continue;
      }
      const o3 = OPS3.find(o => line.startsWith(o, i)), o2 = !o3 && OPS2.find(o => line.startsWith(o, i));
      const op = o3 || o2 || (OPS1.includes(c) ? c : null);
      if (!op) err(`carácter no válido «${c}»`, ln);
      if ("([{".includes(op)) depth++;
      if (")]}".includes(op)) depth = Math.max(0, depth - 1);
      toks.push({ t: "OP", v: op, line: ln });
      i += op.length;
    }
    if (depth === 0 && !contLine && toks.length && toks.at(-1).t !== "NEWLINE" && toks.at(-1).t !== "INDENT" && toks.at(-1).t !== "DEDENT") toks.push({ t: "NEWLINE", line: ln });
  }
  if (depth > 0) err("falta cerrar un paréntesis, corchete o llave", lines.length);
  if (toks.length && toks.at(-1).t !== "NEWLINE") toks.push({ t: "NEWLINE", line: lines.length });
  while (indents.length > 1) { indents.pop(); toks.push({ t: "DEDENT", line: lines.length }); }
  toks.push({ t: "EOF", line: lines.length });
  return toks;
}

/* ======================================================================
   Análisis (árbol)
   ====================================================================== */
class Parser {
  constructor(toks) { this.toks = toks; this.i = 0; }
  get cur() { return this.toks[this.i]; }
  peek(k = 1) { return this.toks[this.i + k]; }
  is(t, v) { const c = this.cur; return c.t === t && (v === undefined || c.v === v); }
  isOp(v) { return this.is("OP", v); }
  isKw(v) { return this.is("KW", v); }
  next() { return this.toks[this.i++]; }
  err(msg, tok = this.cur) { throw new PyError("SyntaxError", msg, tok.line); }
  expect(t, v, msg) { if (!this.is(t, v)) this.err(msg || `se esperaba «${v ?? t}»${this.cur.v !== undefined ? ` y hay «${this.cur.v}»` : ""}`); return this.next(); }
  accept(t, v) { if (this.is(t, v)) { this.next(); return true; } return false; }

  file() { const body = []; while (!this.is("EOF")) { if (this.accept("NEWLINE")) continue; body.push(...this.statement()); } return body; }
  block() {
    this.expect("OP", ":", "falta «:» al final de la línea");
    if (this.accept("NEWLINE")) {
      if (!this.is("INDENT")) throw new PyError("IndentationError", "se esperaba un bloque con sangría", this.cur.line);
      this.next();
      const body = [];
      while (!this.is("DEDENT") && !this.is("EOF")) { if (this.accept("NEWLINE")) continue; body.push(...this.statement()); }
      this.accept("DEDENT");
      return body;
    }
    return this.simpleLine();
  }
  statement() {
    const c = this.cur, ln = c.line;
    if (c.t === "KW") {
      switch (c.v) {
        case "if": return [this.ifStmt()];
        case "while": { this.next(); const test = this.expr(); const body = this.block(); let orelse = []; if (this.isKw("else")) { this.next(); orelse = this.block(); } return [{ k: "while", test, body, orelse, line: ln }]; }
        case "for": {
          this.next(); const target = this.targetList(); this.expect("KW", "in", "falta «in» en el for"); const iter = this.exprList();
          const body = this.block(); let orelse = []; if (this.isKw("else")) { this.next(); orelse = this.block(); }
          return [{ k: "for", target, iter, body, orelse, line: ln }];
        }
        case "def": return [this.def()];
        case "try": return [this.tryStmt()];
        case "with": this.err("«with» no está disponible en el Python de LumaMap");
        case "class": this.err("las clases propias no están disponibles en el Python de LumaMap (usa funciones y diccionarios)");
      }
    }
    if (c.t === "OP" && c.v === "@") this.err("los decoradores no están disponibles");
    return this.simpleLine();
  }
  simpleLine() {
    const out = [this.simple()];
    while (this.accept("OP", ";")) { if (this.is("NEWLINE")) break; out.push(this.simple()); }
    if (!this.accept("NEWLINE") && !this.is("EOF") && !this.is("DEDENT")) this.err(`sobra algo al final: «${this.cur.v ?? this.cur.t}»`);
    return out;
  }
  ifStmt() {
    const ln = this.next().line, test = this.expr(), body = this.block();
    let orelse = [];
    if (this.isKw("elif")) { this.toks[this.i] = { ...this.cur, v: "if" }; orelse = [this.ifStmt()]; }
    else if (this.isKw("else")) { this.next(); orelse = this.block(); }
    return { k: "if", test, body, orelse, line: ln };
  }
  def() {
    const ln = this.next().line, name = this.expect("NAME", undefined, "falta el nombre de la función").v;
    this.expect("OP", "(", "falta «(» después del nombre");
    const params = this.params(")");
    this.expect("OP", ")");
    if (this.accept("OP", "->")) this.expr();
    return { k: "def", name, params, body: this.block(), line: ln };
  }
  params(end) {
    const ps = [];
    while (!this.isOp(end)) {
      if (this.accept("OP", "*")) { if (this.is("NAME")) ps.push({ name: this.next().v, star: 1 }); }
      else if (this.accept("OP", "**")) ps.push({ name: this.expect("NAME").v, star: 2 });
      else {
        const name = this.expect("NAME", undefined, "falta el nombre de un parámetro").v;
        if (end === ")" && this.accept("OP", ":")) this.expr();
        const def = this.accept("OP", "=") ? this.expr() : null;
        ps.push({ name, def });
      }
      if (!this.accept("OP", ",")) break;
    }
    return ps;
  }
  tryStmt() {
    const ln = this.next().line, body = this.block(), handlers = [];
    let orelse = [], fin = [];
    while (this.isKw("except")) {
      this.next();
      let types = null, as = null;
      if (!this.isOp(":")) { types = this.expr(); if (this.accept("KW", "as")) as = this.expect("NAME").v; }
      handlers.push({ types, as, body: this.block() });
    }
    if (this.isKw("else")) { this.next(); orelse = this.block(); }
    if (this.isKw("finally")) { this.next(); fin = this.block(); }
    if (!handlers.length && !fin.length) this.err("un try necesita un except o un finally");
    return { k: "try", body, handlers, orelse, fin, line: ln };
  }
  simple() {
    const c = this.cur, ln = c.line;
    if (c.t === "KW") {
      switch (c.v) {
        case "pass": this.next(); return { k: "pass", line: ln };
        case "break": this.next(); return { k: "break", line: ln };
        case "continue": this.next(); return { k: "continue", line: ln };
        case "return": this.next(); return { k: "return", value: this.is("NEWLINE") || this.isOp(";") || this.is("EOF") ? null : this.exprList(), line: ln };
        case "global": case "nonlocal": { this.next(); const names = [this.expect("NAME").v]; while (this.accept("OP", ",")) names.push(this.expect("NAME").v); return { k: "global", names, line: ln }; }
        case "del": { this.next(); const targets = [this.expr()]; while (this.accept("OP", ",")) targets.push(this.expr()); return { k: "del", targets, line: ln }; }
        case "raise": { this.next(); const exc = this.is("NEWLINE") ? null : this.expr(); if (this.accept("KW", "from")) this.expr(); return { k: "raise", exc, line: ln }; }
        case "assert": { this.next(); const test = this.expr(); const msg = this.accept("OP", ",") ? this.expr() : null; return { k: "assert", test, msg, line: ln }; }
        case "import": {
          this.next(); const mods = [];
          do { const name = this.dotted(); const as = this.accept("KW", "as") ? this.expect("NAME").v : null; mods.push({ name, as }); } while (this.accept("OP", ","));
          return { k: "import", mods, line: ln };
        }
        case "from": {
          this.next(); const mod = this.dotted(); this.expect("KW", "import");
          const names = [];
          if (this.accept("OP", "*")) names.push({ name: "*" });
          else { const par = this.accept("OP", "("); do { if (par && this.isOp(")")) break; const name = this.expect("NAME").v; names.push({ name, as: this.accept("KW", "as") ? this.expect("NAME").v : null }); } while (this.accept("OP", ",")); if (par) this.expect("OP", ")"); }
          return { k: "from", mod, names, line: ln };
        }
        case "yield": this.err("«yield» (generadores) no está disponible");
      }
    }
    const e = this.exprList(true);
    if (this.isOp("=")) {
      const targets = [e];
      let value;
      while (this.accept("OP", "=")) { value = this.exprList(true); targets.push(value); }
      targets.pop();
      for (const t of targets) this.checkTarget(t);
      return { k: "assign", targets, value, line: ln };
    }
    const aug = ["+=", "-=", "*=", "/=", "//=", "%=", "**=", "&=", "|=", "^=", ">>=", "<<="];
    if (this.is("OP") && aug.includes(this.cur.v)) {
      const op = this.next().v.slice(0, -1);
      this.checkTarget(e);
      return { k: "aug", target: e, op, value: this.exprList(), line: ln };
    }
    if (this.isOp(":") && (e.k === "name" || e.k === "attr" || e.k === "sub")) {   // anotación: x: int = 3
      this.next(); this.expr();
      if (this.accept("OP", "=")) return { k: "assign", targets: [e], value: this.exprList(), line: ln };
      return { k: "pass", line: ln };
    }
    return { k: "expr", value: e, line: ln };
  }
  checkTarget(t) {
    if (t.k === "name" || t.k === "attr" || t.k === "sub") return;
    if ((t.k === "tuple" || t.k === "list") && t.items.every(x => (this.checkTarget(x), true))) return;
    if (t.k === "star") return this.checkTarget(t.value);
    throw new PyError("SyntaxError", "no se puede asignar a eso (a la izquierda del = va un nombre, op(...).par.x, lista[i]…)", t.line);
  }
  dotted() { let n = this.expect("NAME").v; while (this.accept("OP", ".")) n += "." + this.expect("NAME").v; return n; }
  targetList() {
    const ln = this.cur.line, items = [this.bitor()];
    let tuple = false;
    while (this.accept("OP", ",")) { tuple = true; if (this.isKw("in")) break; items.push(this.bitor()); }
    const t = tuple ? { k: "tuple", items, line: ln } : items[0];
    this.checkTarget(t);
    return t;
  }
  exprList(allowStar = false) {
    const ln = this.cur.line, first = allowStar && this.isOp("*") ? (this.next(), { k: "star", value: this.bitor(), line: ln }) : this.expr();
    if (!this.isOp(",")) return first;
    const items = [first];
    while (this.accept("OP", ",")) {
      if (this.is("NEWLINE") || this.isOp("=") || this.isOp(")") || this.is("EOF") || this.isOp(";") || (this.is("OP") && this.cur.v.endsWith("=") && this.cur.v.length > 1 && !["==", "!=", "<=", ">="].includes(this.cur.v))) break;
      items.push(allowStar && this.isOp("*") ? (this.next(), { k: "star", value: this.bitor(), line: ln }) : this.expr());
    }
    return { k: "tuple", items, line: ln };
  }
  expr() {
    const ln = this.cur.line;
    if (this.isKw("lambda")) {
      this.next();
      const params = this.params(":");
      this.expect("OP", ":");
      return { k: "lambda", params, body: this.expr(), line: ln };
    }
    const a = this.or();
    if (this.isKw("if") ) {
      // Solo como ternario si hay «else» después (en comprensiones «if» filtra).
      const save = this.i;
      this.next();
      const test = this.or();
      if (this.accept("KW", "else")) return { k: "ifexp", test, body: a, orelse: this.expr(), line: ln };
      this.i = save;
    }
    return a;
  }
  or() { let a = this.and(); while (this.isKw("or")) { const ln = this.next().line; a = { k: "bool", op: "or", a, b: this.and(), line: ln }; } return a; }
  and() { let a = this.not(); while (this.isKw("and")) { const ln = this.next().line; a = { k: "bool", op: "and", a, b: this.not(), line: ln }; } return a; }
  not() { if (this.isKw("not")) { const ln = this.next().line; return { k: "not", a: this.not(), line: ln }; } return this.compare(); }
  compare() {
    const ln = this.cur.line, first = this.bitor(), ops = [], rest = [];
    for (;;) {
      let op = null;
      if (this.is("OP") && ["<", ">", "==", ">=", "<=", "!="].includes(this.cur.v)) op = this.next().v;
      else if (this.isKw("in")) { this.next(); op = "in"; }
      else if (this.isKw("not") && this.peek()?.t === "KW" && this.peek().v === "in") { this.next(); this.next(); op = "not in"; }
      else if (this.isKw("is")) { this.next(); op = this.accept("KW", "not") ? "is not" : "is"; }
      if (!op) break;
      ops.push(op); rest.push(this.bitor());
    }
    return ops.length ? { k: "cmp", first, ops, rest, line: ln } : first;
  }
  bin(next, ops) { return () => { let a = next(); while (this.is("OP") && ops.includes(this.cur.v)) { const t = this.next(); a = { k: "bin", op: t.v, a, b: next(), line: t.line }; } return a; }; }
  bitor() { return this._bitor ||= this.bin(() => this.bitxor(), ["|"]), this._bitor(); }
  bitxor() { return this._bitxor ||= this.bin(() => this.bitand(), ["^"]), this._bitxor(); }
  bitand() { return this._bitand ||= this.bin(() => this.shift(), ["&"]), this._bitand(); }
  shift() { return this._shift ||= this.bin(() => this.arith(), ["<<", ">>"]), this._shift(); }
  arith() { return this._arith ||= this.bin(() => this.term(), ["+", "-"]), this._arith(); }
  term() { return this._term ||= this.bin(() => this.unary(), ["*", "/", "//", "%", "@"]), this._term(); }
  unary() {
    if (this.is("OP") && ["-", "+", "~"].includes(this.cur.v)) { const t = this.next(); return { k: "unary", op: t.v, a: this.unary(), line: t.line }; }
    return this.power();
  }
  power() {
    const a = this.primary();
    if (this.isOp("**")) { const ln = this.next().line; return { k: "bin", op: "**", a, b: this.unary(), line: ln }; }
    return a;
  }
  primary() {
    let e = this.atom();
    for (;;) {
      const ln = this.cur.line;
      if (this.accept("OP", ".")) { e = { k: "attr", obj: e, name: this.expect("NAME", undefined, "falta un nombre después del punto").v, line: ln }; continue; }
      if (this.accept("OP", "(")) { e = { k: "call", fn: e, ...this.callArgs(), line: ln }; this.expect("OP", ")", "falta cerrar el paréntesis de la llamada"); continue; }
      if (this.accept("OP", "[")) { e = { k: "sub", obj: e, index: this.subscript(), line: ln }; this.expect("OP", "]", "falta «]»"); continue; }
      return e;
    }
  }
  callArgs() {
    const args = [], kwargs = [];
    while (!this.isOp(")")) {
      const ln = this.cur.line;
      if (this.accept("OP", "*")) args.push({ k: "star", value: this.expr(), line: ln });
      else if (this.accept("OP", "**")) kwargs.push({ name: null, value: this.expr() });
      else if (this.is("NAME") && this.peek()?.t === "OP" && this.peek().v === "=") { const name = this.next().v; this.next(); kwargs.push({ name, value: this.expr() }); }
      else {
        const v = this.expr();
        if (this.isKw("for")) args.push(this.comp("list", v, ln));   // sum(x for x in y)
        else args.push(v);
      }
      if (!this.accept("OP", ",")) break;
    }
    return { args, kwargs };
  }
  subscript() {
    const ln = this.cur.line;
    const one = () => {
      if (this.isOp(":") || this.isOp("]")) return this.slice(null, ln);
      const a = this.expr();
      return this.isOp(":") ? this.slice(a, ln) : a;
    };
    const first = one();
    if (!this.isOp(",")) return first;
    const items = [first];
    while (this.accept("OP", ",")) { if (this.isOp("]")) break; items.push(one()); }
    return { k: "tuple", items, line: ln };
  }
  slice(lo, ln) {
    this.expect("OP", ":");
    const hi = this.isOp(":") || this.isOp("]") || this.isOp(",") ? null : this.expr();
    let step = null;
    if (this.accept("OP", ":")) step = this.isOp("]") || this.isOp(",") ? null : this.expr();
    return { k: "slice", lo, hi, step, line: ln };
  }
  comp(kind, elt, ln, val = null) {
    const gens = [];
    while (this.isKw("for")) {
      this.next();
      const target = this.targetList();
      this.expect("KW", "in");
      const iter = this.or();
      const ifs = [];
      while (this.isKw("if")) { this.next(); ifs.push(this.or()); }
      gens.push({ target, iter, ifs });
    }
    return { k: "comp", kind, elt, val, gens, line: ln };
  }
  atom() {
    const c = this.cur, ln = c.line;
    switch (c.t) {
      case "NUM": this.next(); return { k: "const", v: c.v, line: ln };
      case "STR": this.next(); return { k: "const", v: c.v, line: ln };
      case "FSTR": this.next(); return this.fstring(c.v, ln);
      case "NAME": this.next(); return { k: "name", id: c.v, line: ln };
      case "KW":
        if (c.v === "True" || c.v === "False") { this.next(); return { k: "const", v: c.v === "True", line: ln }; }
        if (c.v === "None") { this.next(); return { k: "const", v: null, line: ln }; }
        break;
      case "OP":
        if (c.v === "(") {
          this.next();
          if (this.accept("OP", ")")) return { k: "tuple", items: [], line: ln };
          const first = this.isOp("*") ? (this.next(), { k: "star", value: this.bitor(), line: ln }) : this.expr();
          if (this.isKw("for")) { const g = this.comp("list", first, ln); this.expect("OP", ")"); return g; }
          if (this.accept("OP", ")")) return first.k === "star" ? { k: "tuple", items: [first], line: ln } : first;
          const items = [first];
          while (this.accept("OP", ",")) { if (this.isOp(")")) break; items.push(this.isOp("*") ? (this.next(), { k: "star", value: this.bitor(), line: ln }) : this.expr()); }
          this.expect("OP", ")", "falta cerrar el paréntesis");
          return { k: "tuple", items, line: ln };
        }
        if (c.v === "[") {
          this.next();
          if (this.accept("OP", "]")) return { k: "list", items: [], line: ln };
          const first = this.isOp("*") ? (this.next(), { k: "star", value: this.bitor(), line: ln }) : this.expr();
          if (this.isKw("for")) { const g = this.comp("list", first, ln); this.expect("OP", "]"); return g; }
          const items = [first];
          while (this.accept("OP", ",")) { if (this.isOp("]")) break; items.push(this.isOp("*") ? (this.next(), { k: "star", value: this.bitor(), line: ln }) : this.expr()); }
          this.expect("OP", "]", "falta cerrar el corchete");
          return { k: "list", items, line: ln };
        }
        if (c.v === "{") {
          this.next();
          if (this.accept("OP", "}")) return { k: "dict", keys: [], vals: [], line: ln };
          if (this.accept("OP", "**")) { const v = this.expr(); const keys = [null], vals = [v]; while (this.accept("OP", ",")) { if (this.isOp("}")) break; if (this.accept("OP", "**")) { keys.push(null); vals.push(this.expr()); } else { keys.push(this.expr()); this.expect("OP", ":"); vals.push(this.expr()); } } this.expect("OP", "}"); return { k: "dict", keys, vals, line: ln }; }
          const k0 = this.expr();
          if (this.accept("OP", ":")) {
            const v0 = this.expr();
            if (this.isKw("for")) { const g = this.comp("dict", k0, ln, v0); this.expect("OP", "}"); return g; }
            const keys = [k0], vals = [v0];
            while (this.accept("OP", ",")) { if (this.isOp("}")) break; if (this.accept("OP", "**")) { keys.push(null); vals.push(this.expr()); continue; } keys.push(this.expr()); this.expect("OP", ":", "falta «:» en el diccionario"); vals.push(this.expr()); }
            this.expect("OP", "}", "falta cerrar la llave");
            return { k: "dict", keys, vals, line: ln };
          }
          if (this.isKw("for")) { const g = this.comp("set", k0, ln); this.expect("OP", "}"); return g; }
          const items = [k0];
          while (this.accept("OP", ",")) { if (this.isOp("}")) break; items.push(this.expr()); }
          this.expect("OP", "}");
          return { k: "set", items, line: ln };
        }
    }
    if (c.t === "EOF" || c.t === "NEWLINE") this.err("la línea se acaba antes de tiempo (¿falta algo después?)");
    if (c.t === "INDENT") throw new PyError("IndentationError", "sangría de más", ln);
    this.err(`no se esperaba «${c.v ?? c.t}» aquí`);
  }
  fstring(s, ln) {
    const parts = [];
    let i = 0, lit = "";
    while (i < s.length) {
      const ch = s[i];
      if (ch === "{" && s[i + 1] === "{") { lit += "{"; i += 2; continue; }
      if (ch === "}" && s[i + 1] === "}") { lit += "}"; i += 2; continue; }
      if (ch === "{") {
        if (lit) { parts.push({ k: "const", v: lit, line: ln }); lit = ""; }
        let depth = 1, j = i + 1, q = null;
        while (j < s.length && depth) { const c = s[j]; if (q) { if (c === q) q = null; } else if (c === "'" || c === '"') q = c; else if ("([{".includes(c)) depth++; else if (")]}".includes(c)) depth--; if (depth) j++; }
        const inner = s.slice(i + 1, j);
        // expresión[!r][:formato] (el «:» de primer nivel)
        let d = 0, cut = -1, q2 = null;
        for (let k = 0; k < inner.length; k++) { const c = inner[k]; if (q2) { if (c === q2) q2 = null; continue; } if (c === "'" || c === '"') q2 = c; else if ("([{".includes(c)) d++; else if (")]}".includes(c)) d--; else if (c === ":" && d === 0) { cut = k; break; } }
        let code = cut >= 0 ? inner.slice(0, cut) : inner;
        const spec = cut >= 0 ? inner.slice(cut + 1) : "";
        let conv = null;
        const cm = /!([rs])\s*$/.exec(code);
        if (cm) { conv = cm[1]; code = code.slice(0, cm.index); }
        let selfDoc = false;
        if (/=\s*$/.test(code) && !/[=!<>]=\s*$/.test(code)) { selfDoc = true; code = code.replace(/=\s*$/, ""); }
        const toks = tokenize(code.trim()).filter(t => t.t !== "NEWLINE" && t.t !== "INDENT" && t.t !== "DEDENT");
        toks.forEach(t => { t.line = ln; });
        const p = new Parser(toks);
        const e = p.exprList();
        if (selfDoc) parts.push({ k: "const", v: code.trim() + "=", line: ln });
        parts.push({ k: "fmt", value: e, spec: spec.includes("{") ? this.fstring(spec, ln) : spec, conv: conv || (selfDoc && !spec ? "r" : null), line: ln });
        i = j + 1;
        continue;
      }
      lit += ch; i++;
    }
    if (lit || !parts.length) parts.push({ k: "const", v: lit, line: ln });
    return { k: "fstr", parts, line: ln };
  }
}

/** Analiza un programa. Devuelve el árbol (o lanza PyError con la línea). */
export function parse(src) { return new Parser(tokenize(src)).file(); }
/** ¿Es una sola expresión (como «2 + 2» o «op('lfo1')['chan1']»)? Solo mira cómo está escrita. */
export function isExpression(src) {
  try { const p = new Parser(tokenize(src)); p.exprList(); while (p.accept("NEWLINE")) { /* nada */ } return p.is("EOF"); } catch { return false; }
}
/** ¿Está bien escrito? Devuelve "" o el error formateado. */
export function checkSyntax(src) { try { parse(src); return ""; } catch (e) { return formatError(e); } }

/* ======================================================================
   Intérprete
   ====================================================================== */
const BREAK = { k: "break" }, CONTINUE = { k: "continue" };
class Return { constructor(v) { this.v = v; } }

export class Interp {
  /**
   * o: { globals?: {nombre: valor}, print?(texto), maxSteps? (por llamada), modules?: {nombre: módulo} }
   */
  constructor(o = {}) {
    this.print = o.print || (() => {});
    this.maxSteps = o.maxSteps || 2_000_000;
    this.steps = 0; this.depth = 0; this.line = 0;
    this.modules = { ...stdModules(), ...(o.modules || {}) };
    this.builtins = makeBuiltins(this);
    this.globals = new Map(Object.entries(o.globals || {}));
  }
  /** Ejecuta un programa entero en el módulo (las variables quedan para la próxima vez). */
  run(src, astCache = null) {
    const ast = astCache || parse(src);
    this.steps = 0;
    this.execBlock(ast, { vars: this.globals, globals: this.globals, glob: null });
    return ast;
  }
  /** Llama a una función del módulo si existe (callbacks como onFrameStart). */
  callIfExists(name, args = [], kwargs = {}) {
    const f = this.globals.get(name);
    if (f === undefined) return undefined;
    this.steps = 0;
    return this.call(f, args, kwargs);
  }
  has(name) { return this.globals.has(name); }
  /** Evalúa una expresión suelta (consola). */
  evalExpr(src) {
    const p = new Parser(tokenize(src));
    const e = p.exprList();
    while (p.accept("NEWLINE") || p.accept("DEDENT")) { /* nada */ }
    if (!p.is("EOF")) p.err("eso no es una sola expresión");
    this.steps = 0;
    return this.ev(e, { vars: this.globals, globals: this.globals, glob: null });
  }
  tick(node) {
    if (++this.steps > this.maxSteps) throw new PyError("TimeoutError", "el script tardó demasiado y se cortó (para que el show no se congele)", node?.line || this.line);
  }

  execBlock(body, sc) {
    for (const st of body) {
      const r = this.exec(st, sc);
      if (r) return r;
    }
    return null;
  }
  exec(st, sc) {
    this.tick(st);
    this.line = st.line;
    try {
      switch (st.k) {
        case "expr": this.ev(st.value, sc); return null;
        case "assign": { const v = this.ev(st.value, sc); for (const t of st.targets) this.assign(t, v, sc); return null; }
        case "aug": {
          const t = st.target;
          if (t.k === "name") { this.setName(t.id, this.binop(st.op, this.lookup(t.id, sc, t), this.ev(st.value, sc), t, true), sc); return null; }
          if (t.k === "attr") { const o = this.ev(t.obj, sc); this.setattr(o, t.name, this.binop(st.op, this.getattr(o, t.name, t), this.ev(st.value, sc), t, true), t); return null; }
          const o = this.ev(t.obj, sc), idx = this.ev(t.index, sc);
          this.setitem(o, idx, this.binop(st.op, this.getitem(o, idx, t), this.ev(st.value, sc), t, true), t);
          return null;
        }
        case "if": return this.truthy(this.ev(st.test, sc)) ? this.execBlock(st.body, sc) : this.execBlock(st.orelse, sc);
        case "while": {
          while (this.truthy(this.ev(st.test, sc))) {
            this.tick(st);
            const r = this.execBlock(st.body, sc);
            if (r === BREAK) return null;
            if (r instanceof Return) return r;
          }
          return this.execBlock(st.orelse, sc);
        }
        case "for": {
          for (const v of this.iter(this.ev(st.iter, sc), st)) {
            this.tick(st);
            this.assign(st.target, v, sc);
            const r = this.execBlock(st.body, sc);
            if (r === BREAK) return null;
            if (r instanceof Return) return r;
          }
          return this.execBlock(st.orelse, sc);
        }
        case "break": return BREAK;
        case "continue": return CONTINUE;
        case "pass": return null;
        case "return": return new Return(st.value ? this.ev(st.value, sc) : null);
        case "def": this.setName(st.name, this.makeFunc(st.name, st.params, st.body, sc), sc); return null;
        case "global": for (const n of st.names) (sc.glob ||= new Set()).add(n); return null;
        case "del": {
          for (const t of st.targets) {
            if (t.k === "name") { if (sc.vars.has(t.id)) sc.vars.delete(t.id); else throw new PyError("NameError", `«${t.id}» no existe`); }
            else if (t.k === "sub") this.delitem(this.ev(t.obj, sc), this.ev(t.index, sc), t);
            else throw new PyError("SyntaxError", "solo se puede borrar un nombre o un elemento");
          }
          return null;
        }
        case "raise": {
          if (!st.exc) { if (sc.handling) throw sc.handling; throw new PyError("RuntimeError", "raise sin error que relanzar"); }
          let e = this.ev(st.exc, sc);
          if (typeof e === "function" && e.__exc) e = new PyError(e.__exc, "");
          if (!(e instanceof PyError)) throw new PyError("TypeError", "solo se pueden lanzar errores (p. ej. raise ValueError('…'))");
          e.line ||= st.line;
          throw e;
        }
        case "assert": if (!this.truthy(this.ev(st.test, sc))) throw new PyError("AssertionError", st.msg ? pyStr(this.ev(st.msg, sc)) : ""); return null;
        case "import": {
          for (const m of st.mods) {
            const mod = this.importMod(m.name);
            this.setName(m.as || m.name.split(".")[0], m.as ? mod : this.importMod(m.name.split(".")[0]), sc);
          }
          return null;
        }
        case "from": {
          const mod = this.importMod(st.mod);
          for (const n of st.names) {
            if (n.name === "*") { for (const [k, v] of Object.entries(mod)) if (!k.startsWith("_")) this.setName(k, v, sc); continue; }
            if (!(n.name in mod)) throw new PyError("ImportError", `«${st.mod}» no tiene «${n.name}»`);
            this.setName(n.as || n.name, mod[n.name], sc);
          }
          return null;
        }
        case "try": return this.execTry(st, sc);
      }
      throw new PyError("SyntaxError", "instrucción desconocida " + st.k);
    } catch (e) {
      if (e instanceof PyError) { e.line ||= st.line; throw e; }
      if (e instanceof RangeError) throw new PyError("RecursionError", "demasiadas llamadas anidadas", st.line);
      throw new PyError("RuntimeError", String(e?.message || e), st.line);
    }
  }
  execTry(st, sc) {
    let r = null, pending = null;
    try {
      try { r = this.execBlock(st.body, sc); if (!r) r = this.execBlock(st.orelse, sc); }
      catch (e) {
        if (!(e instanceof PyError) || e.pyType === "TimeoutError") throw e;
        const h = st.handlers.find(h => this.matches(e, h.types ? this.ev(h.types, sc) : null));
        if (!h) throw e;
        if (h.as) this.setName(h.as, e, sc);
        const prev = sc.handling; sc.handling = e;
        try { r = this.execBlock(h.body, sc); } finally { sc.handling = prev; }
      }
    } catch (e) { pending = e; }
    if (st.fin.length) { const f = this.execBlock(st.fin, sc); if (f) return f; }
    if (pending) throw pending;
    return r;
  }
  matches(e, types) {
    if (types === null) return true;
    const list = types instanceof Tuple ? types.a : [types];
    return list.some(t => {
      const name = t?.__exc;
      if (!name) return false;
      if (name === "Exception" || name === "BaseException" || name === e.pyType) return true;
      // Familias: LookupError ⊃ IndexError, KeyError; ArithmeticError ⊃ ZeroDivisionError…
      const fam = { LookupError: ["IndexError", "KeyError"], ArithmeticError: ["ZeroDivisionError", "OverflowError"] };
      return fam[name]?.includes(e.pyType);
    });
  }
  importMod(name) {
    const m = this.modules[name];
    if (!m) throw new PyError("ImportError", `no se puede importar «${name}»: en LumaMap hay ${Object.keys(this.modules).filter(k => !k.startsWith("_")).sort().join(", ")}`);
    return m;
  }

  /* ---------------- Nombres ---------------- */
  lookup(id, sc, node) {
    if (sc.vars.has(id)) return sc.vars.get(id);
    for (let p = sc.parent; p; p = p.parent) if (p.vars.has(id)) return p.vars.get(id);
    if (sc.globals.has(id)) return sc.globals.get(id);
    if (id in this.builtins) return this.builtins[id];
    throw new PyError("NameError", `«${id}» no existe`, node?.line);
  }
  setName(id, v, sc) {
    if (sc.glob?.has(id)) sc.globals.set(id, v); else sc.vars.set(id, v);
  }
  assign(t, v, sc) {
    switch (t.k) {
      case "name": this.setName(t.id, v, sc); return;
      case "attr": this.setattr(this.ev(t.obj, sc), t.name, v, t); return;
      case "sub": this.setitem(this.ev(t.obj, sc), this.ev(t.index, sc), v, t); return;
      case "tuple": case "list": {
        const vals = [...this.iter(v, t)];
        const si = t.items.findIndex(x => x.k === "star");
        if (si < 0) {
          if (vals.length !== t.items.length) throw new PyError("ValueError", `hay ${vals.length} valores para ${t.items.length} nombres`, t.line);
          t.items.forEach((x, k) => this.assign(x, vals[k], sc));
        } else {
          const after = t.items.length - si - 1;
          if (vals.length < t.items.length - 1) throw new PyError("ValueError", "faltan valores para desempaquetar", t.line);
          t.items.slice(0, si).forEach((x, k) => this.assign(x, vals[k], sc));
          this.assign(t.items[si].value, vals.slice(si, vals.length - after), sc);
          t.items.slice(si + 1).forEach((x, k) => this.assign(x, vals[vals.length - after + k], sc));
        }
        return;
      }
    }
    throw new PyError("SyntaxError", "no se puede asignar a eso", t.line);
  }

  /* ---------------- Expresiones ---------------- */
  ev(e, sc) {
    switch (e.k) {
      case "const": return e.v;
      case "name": return this.lookup(e.id, sc, e);
      case "fstr": return e.parts.map(p => p.k === "const" ? p.v : this.fmtPart(p, sc)).join("");
      case "list": return this.items(e.items, sc);
      case "tuple": return new Tuple(this.items(e.items, sc));
      case "set": return new PySet(this.items(e.items, sc));
      case "dict": {
        const d = new Dict();
        e.keys.forEach((k, i) => {
          if (k === null) { const o = this.ev(e.vals[i], sc); if (!(o instanceof Dict)) throw new PyError("TypeError", "** necesita un diccionario", e.line); for (const [kk, vv] of o.m.values()) d.set(kk, vv); }
          else d.set(this.ev(k, sc), this.ev(e.vals[i], sc));
        });
        return d;
      }
      case "attr": return this.getattr(this.ev(e.obj, sc), e.name, e);
      case "sub": {
        const o = this.ev(e.obj, sc);
        if (e.index.k === "slice") return this.slice(o, e.index, sc);
        return this.getitem(o, this.ev(e.index, sc), e);
      }
      case "call": {
        const fn = this.ev(e.fn, sc);
        const args = [];
        for (const a of e.args) { if (a.k === "star") args.push(...this.iter(this.ev(a.value, sc), a)); else args.push(this.ev(a, sc)); }
        const kwargs = {};
        for (const kw of e.kwargs) {
          if (kw.name) kwargs[kw.name] = this.ev(kw.value, sc);
          else { const d = this.ev(kw.value, sc); if (!(d instanceof Dict)) throw new PyError("TypeError", "** necesita un diccionario", e.line); for (const [k, v] of d.m.values()) kwargs[pyStr(k)] = v; }
        }
        this.line = e.line;
        return this.call(fn, args, kwargs, e);
      }
      case "unary": {
        const a = this.ev(e.a, sc);
        if (e.op === "-") { if (typeof a === "number" || typeof a === "boolean") return -a; if (a?.__neg__) return a.__neg__(); throw new PyError("TypeError", `no se puede poner - delante de ${typeName(a)}`, e.line); }
        if (e.op === "+") { if (typeof a === "number" || typeof a === "boolean") return +a; throw new PyError("TypeError", `+ no va con ${typeName(a)}`, e.line); }
        return ~this.num(a, e);
      }
      case "not": return !this.truthy(this.ev(e.a, sc));
      case "bool": {
        const a = this.ev(e.a, sc);
        if (e.op === "and") return this.truthy(a) ? this.ev(e.b, sc) : a;
        return this.truthy(a) ? a : this.ev(e.b, sc);
      }
      case "bin": return this.binop(e.op, this.ev(e.a, sc), this.ev(e.b, sc), e);
      case "cmp": {
        let a = this.ev(e.first, sc);
        for (let k = 0; k < e.ops.length; k++) {
          const b = this.ev(e.rest[k], sc);
          if (!this.compareOp(e.ops[k], a, b, e)) return false;
          a = b;
        }
        return true;
      }
      case "ifexp": return this.truthy(this.ev(e.test, sc)) ? this.ev(e.body, sc) : this.ev(e.orelse, sc);
      case "lambda": return this.makeFunc("<lambda>", e.params, [{ k: "return", value: e.body, line: e.line }], sc, true);
      case "comp": return this.comprehension(e, sc);
      case "slice": throw new PyError("SyntaxError", "«:» solo va dentro de [ ]", e.line);
      case "star": throw new PyError("SyntaxError", "* solo va en una llamada o una lista", e.line);
    }
    throw new PyError("SyntaxError", "expresión desconocida " + e.k, e.line);
  }
  items(list, sc) { const out = []; for (const x of list) { if (x.k === "star") out.push(...this.iter(this.ev(x.value, sc), x)); else out.push(this.ev(x, sc)); } return out; }
  fmtPart(p, sc) {
    let v = this.ev(p.value, sc);
    if (p.conv === "r") v = pyRepr(v);
    else if (p.conv === "s") v = pyStr(v);
    const spec = typeof p.spec === "string" ? p.spec : this.ev(p.spec, sc);
    return formatSpec(v, spec);
  }
  comprehension(e, sc) {
    // Las comprensiones tienen sus propias variables y ven las del sitio donde están.
    const local = { vars: new Map(), parent: sc.vars === sc.globals ? null : sc, globals: sc.globals, glob: null };
    const out = e.kind === "dict" ? new Dict() : e.kind === "set" ? new PySet() : [];
    const loop = (gi) => {
      if (gi === e.gens.length) {
        if (e.kind === "dict") out.set(this.ev(e.elt, local), this.ev(e.val, local));
        else if (e.kind === "set") { const v = this.ev(e.elt, local); out.m.set(hashKey(v), v); }
        else out.push(this.ev(e.elt, local));
        return;
      }
      const g = e.gens[gi];
      for (const v of this.iter(this.ev(g.iter, local), e)) {
        this.tick(e);
        this.assign(g.target, v, local);
        if (g.ifs.every(c => this.truthy(this.ev(c, local)))) loop(gi + 1);
      }
    };
    loop(0);
    return out;
  }
  slice(o, s, sc) {
    const len = this.len(o, s);
    const step = s.step ? this.num(this.ev(s.step, sc), s) : 1;
    if (step === 0) throw new PyError("ValueError", "el paso de una rebanada no puede ser 0", s.line);
    const norm = (v, d) => { if (v === null || v === undefined) return d; v = Math.trunc(this.num(v, s)); if (v < 0) v += len; return step > 0 ? Math.max(0, Math.min(len, v)) : Math.max(-1, Math.min(len - 1, v)); };
    const lo = norm(s.lo ? this.ev(s.lo, sc) : null, step > 0 ? 0 : len - 1), hi = norm(s.hi ? this.ev(s.hi, sc) : null, step > 0 ? len : -1);
    const idx = [];
    for (let i = lo; step > 0 ? i < hi : i > hi; i += step) idx.push(i);
    if (typeof o === "string") return idx.map(i => o[i]).join("");
    const arr = o instanceof Tuple ? o.a : o instanceof Range ? null : o;
    if (o instanceof Range) return idx.map(i => o.at(i));
    if (!Array.isArray(arr)) throw new PyError("TypeError", `no se puede cortar ${typeName(o)}`, s.line);
    const r = idx.map(i => arr[i]);
    return o instanceof Tuple ? new Tuple(r) : r;
  }
  makeFunc(name, params, body, sc, isLambda = false) {
    const defs = params.map(p => p.def ? this.ev(p.def, sc) : undefined);
    const closure = sc.vars === sc.globals ? null : sc;
    const f = new PyFunc(name, params, body, closure, isLambda);
    f.defs = defs;
    return f;
  }

  /* ---------------- Llamadas ---------------- */
  call(f, args = [], kwargs = {}, node = null) {
    if (f instanceof PyFunc) {
      if (++this.depth > 150) { this.depth--; throw new PyError("RecursionError", "demasiadas llamadas anidadas (¿una función que se llama a sí misma sin parar?)", node?.line); }
      try {
        const vars = new Map();
        const ps = f.params;
        let ai = 0;
        const extra = {};
        for (const k of Object.keys(kwargs)) extra[k] = kwargs[k];
        ps.forEach((p, i) => {
          if (p.star === 1) { vars.set(p.name, new Tuple(args.slice(ai))); ai = args.length; return; }
          if (p.star === 2) { const d = new Dict(); for (const [k, v] of Object.entries(extra)) d.set(k, v); vars.set(p.name, d); for (const k of Object.keys(extra)) delete extra[k]; return; }
          if (ai < args.length) { vars.set(p.name, args[ai++]); if (p.name in extra) throw new PyError("TypeError", `${f.name}() recibe «${p.name}» dos veces`, node?.line); return; }
          if (p.name in extra) { vars.set(p.name, extra[p.name]); delete extra[p.name]; return; }
          if (f.defs[i] !== undefined) { vars.set(p.name, f.defs[i]); return; }
          throw new PyError("TypeError", `${f.name}() necesita el valor «${p.name}»`, node?.line);
        });
        if (ai < args.length) throw new PyError("TypeError", `${f.name}() recibe ${ps.filter(p => !p.star).length} valores y le das ${args.length}`, node?.line);
        const left = Object.keys(extra);
        if (left.length) throw new PyError("TypeError", `${f.name}() no tiene el parámetro «${left[0]}»`, node?.line);
        const sc = { vars, parent: f.closure, globals: this.globals, glob: null };
        const r = this.execBlock(f.body, sc);
        return r instanceof Return ? r.v : null;
      } finally { this.depth--; }
    }
    if (typeof f === "function") {
      if (f.__py) return f(args, kwargs, this);
      return f(...args);
    }
    if (f?.__call__) return f.__call__(args, kwargs, this);
    throw new PyError("TypeError", `${typeName(f)} no se puede llamar como una función`, node?.line);
  }

  /* ---------------- Operaciones ---------------- */
  truthy(v) {
    if (v === null || v === undefined || v === false || v === 0 || v === "") return false;
    if (Array.isArray(v)) return v.length > 0;
    if (v instanceof Tuple) return v.a.length > 0;
    if (v instanceof Dict || v instanceof PySet) return (v.size ?? v.m.size) > 0;
    if (v instanceof Range) return v.length > 0;
    if (typeof v === "number" && Number.isNaN(v)) return true;
    if (v?.__bool__) return v.__bool__();
    return true;
  }
  num(v, node) {
    if (typeof v === "number") return v;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (v?.__float__) return v.__float__();
    throw new PyError("TypeError", `se esperaba un número y hay ${typeName(v)}`, node?.line);
  }
  binop(op, a, b, node, inplace = false) {
    if (a?.__float__ && typeof b !== "string") a = a.__float__();
    if (b?.__float__ && typeof a !== "string") b = b.__float__();
    const isNum = (x) => typeof x === "number" || typeof x === "boolean";
    if (isNum(a) && isNum(b)) {
      a = +a; b = +b;
      switch (op) {
        case "+": return a + b;
        case "-": return a - b;
        case "*": return a * b;
        case "/": if (b === 0) throw new PyError("ZeroDivisionError", "división entre cero", node?.line); return a / b;
        case "//": if (b === 0) throw new PyError("ZeroDivisionError", "división entera entre cero", node?.line); return Math.floor(a / b);
        case "%": if (b === 0) throw new PyError("ZeroDivisionError", "resto de dividir entre cero", node?.line); return a - b * Math.floor(a / b);
        case "**": if (a === 0 && b < 0) throw new PyError("ZeroDivisionError", "0 elevado a negativo", node?.line); return Math.pow(a, b);
        case "&": return a & b;
        case "|": return a | b;
        case "^": return a ^ b;
        case "<<": return a * Math.pow(2, b);
        case ">>": return Math.floor(a / Math.pow(2, b));
      }
    }
    if (op === "+") {
      if (typeof a === "string" && typeof b === "string") return a + b;
      if (Array.isArray(a) && Array.isArray(b)) { if (inplace) { a.push(...b); return a; } return [...a, ...b]; }
      if (Array.isArray(a) && inplace) { a.push(...this.iter(b, node)); return a; }
      if (a instanceof Tuple && b instanceof Tuple) return new Tuple([...a.a, ...b.a]);
    }
    if (op === "*") {
      if (typeof a === "string" && isNum(b)) return a.repeat(Math.max(0, Math.trunc(+b)));
      if (isNum(a) && typeof b === "string") return b.repeat(Math.max(0, Math.trunc(+a)));
      if (Array.isArray(a) && isNum(b)) { const out = []; for (let k = 0; k < Math.trunc(+b); k++) out.push(...a); return out; }
      if (isNum(a) && Array.isArray(b)) { const out = []; for (let k = 0; k < Math.trunc(+a); k++) out.push(...b); return out; }
      if (a instanceof Tuple && isNum(b)) { const out = []; for (let k = 0; k < Math.trunc(+b); k++) out.push(...a.a); return new Tuple(out); }
    }
    if (op === "%" && typeof a === "string") return percentFormat(a, b);
    if (op === "|" && a instanceof Dict && b instanceof Dict) { const d = new Dict(); for (const [k, v] of a.m.values()) d.set(k, v); for (const [k, v] of b.m.values()) d.set(k, v); return d; }
    if (a instanceof PySet && b instanceof PySet) {
      const s = new PySet();
      if (op === "|") { for (const [k, v] of a.m) s.m.set(k, v); for (const [k, v] of b.m) s.m.set(k, v); return s; }
      if (op === "&") { for (const [k, v] of a.m) if (b.m.has(k)) s.m.set(k, v); return s; }
      if (op === "-") { for (const [k, v] of a.m) if (!b.m.has(k)) s.m.set(k, v); return s; }
    }
    const opName = { "+": "sumar", "-": "restar", "*": "multiplicar", "/": "dividir", "//": "dividir", "%": "sacar el resto de", "**": "elevar" }[op] || op;
    throw new PyError("TypeError", `no se puede ${opName} ${typeName(a)} y ${typeName(b)}${op === "+" && (typeof a === "string" || typeof b === "string") ? " (para juntar texto y número usa str(numero) o un f-string)" : ""}`, node?.line);
  }
  eq(a, b) {
    if (a === b) return true;
    if ((typeof a === "number" || typeof a === "boolean") && (typeof b === "number" || typeof b === "boolean")) return +a === +b;
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, k) => this.eq(x, b[k]));
    if (a instanceof Tuple && b instanceof Tuple) return a.a.length === b.a.length && a.a.every((x, k) => this.eq(x, b.a[k]));
    if (a instanceof Dict && b instanceof Dict) return a.size === b.size && [...a.m.entries()].every(([k, e]) => b.m.has(k) && this.eq(e[1], b.m.get(k)[1]));
    if (a instanceof PySet && b instanceof PySet) return a.m.size === b.m.size && [...a.m.keys()].every(k => b.m.has(k));
    if (a === null || b === null || a === undefined || b === undefined) return (a ?? null) === (b ?? null);
    if (a?.__float__ && typeof b === "number") return a.__float__() === b;
    if (b?.__float__ && typeof a === "number") return b.__float__() === a;
    return false;
  }
  lt(a, b, node) {
    if (a?.__float__) a = a.__float__();
    if (b?.__float__) b = b.__float__();
    const isNum = (x) => typeof x === "number" || typeof x === "boolean";
    if (isNum(a) && isNum(b)) return +a < +b;
    if (typeof a === "string" && typeof b === "string") return a < b;
    const A = Array.isArray(a) ? a : a instanceof Tuple ? a.a : null, B = Array.isArray(b) ? b : b instanceof Tuple ? b.a : null;
    if (A && B) { for (let k = 0; k < Math.min(A.length, B.length); k++) { if (this.eq(A[k], B[k])) continue; return this.lt(A[k], B[k], node); } return A.length < B.length; }
    throw new PyError("TypeError", `no se puede comparar ${typeName(a)} con ${typeName(b)}`, node?.line);
  }
  compareOp(op, a, b, node) {
    switch (op) {
      case "==": return this.eq(a, b);
      case "!=": return !this.eq(a, b);
      case "<": return this.lt(a, b, node);
      case ">": return this.lt(b, a, node);
      case "<=": return this.lt(a, b, node) || this.eq(a, b);
      case ">=": return this.lt(b, a, node) || this.eq(a, b);
      case "is": return a === b || (a == null && b == null);
      case "is not": return !(a === b || (a == null && b == null));
      case "in": return this.contains(b, a, node);
      case "not in": return !this.contains(b, a, node);
    }
    return false;
  }
  contains(c, v, node) {
    if (typeof c === "string") { if (typeof v !== "string") throw new PyError("TypeError", "«in» con un texto necesita otro texto", node?.line); return c.includes(v); }
    if (c instanceof Dict) return c.has(v);
    if (c instanceof PySet) return c.m.has(hashKey(v));
    if (c instanceof Range) { const n = this.num(v, node); return Number.isInteger(n) && (c.step > 0 ? n >= c.start && n < c.stop : n <= c.start && n > c.stop) && (n - c.start) % c.step === 0; }
    if (c?.__contains__) return c.__contains__(v);
    for (const x of this.iter(c, node)) if (this.eq(x, v)) return true;
    return false;
  }
  *iter(v, node) {
    if (Array.isArray(v)) { yield* [...v]; return; }
    if (typeof v === "string") { yield* v; return; }
    if (v instanceof Tuple) { yield* v.a; return; }
    if (v instanceof Range) { yield* v; return; }
    if (v instanceof Dict) { yield* v.keys(); return; }
    if (v instanceof PySet) { yield* [...v.m.values()]; return; }
    if (v?.__iter__) { yield* v.__iter__(); return; }
    throw new PyError("TypeError", `no se puede recorrer ${typeName(v)} con un for`, node?.line);
  }
  len(v, node) {
    if (typeof v === "string" || Array.isArray(v)) return v.length;
    if (v instanceof Tuple) return v.a.length;
    if (v instanceof Dict) return v.size;
    if (v instanceof PySet) return v.m.size;
    if (v instanceof Range) return v.length;
    if (v?.__len__) return v.__len__();
    throw new PyError("TypeError", `${typeName(v)} no tiene len()`, node?.line);
  }
  index(seqLen, i, node) {
    if (typeof i === "boolean") i = +i;
    if (typeof i !== "number" || !Number.isInteger(i)) throw new PyError("TypeError", "la posición tiene que ser un número entero", node?.line);
    const k = i < 0 ? i + seqLen : i;
    if (k < 0 || k >= seqLen) throw new PyError("IndexError", `la posición ${i} no existe (hay ${seqLen})`, node?.line);
    return k;
  }
  getitem(o, i, node) {
    if (Array.isArray(o)) return o[this.index(o.length, i, node)];
    if (typeof o === "string") return o[this.index(o.length, i, node)];
    if (o instanceof Tuple) return o.a[this.index(o.a.length, i, node)];
    if (o instanceof Range) return o.at(this.index(o.length, i, node));
    if (o instanceof Dict) { if (!o.has(i)) throw new PyError("KeyError", pyRepr(i), node?.line); return o.get(i); }
    if (o?.__getitem__) return o.__getitem__(i instanceof Tuple ? i.a : i);
    throw new PyError("TypeError", `${typeName(o)} no se puede indexar con [ ]`, node?.line);
  }
  setitem(o, i, v, node) {
    if (Array.isArray(o)) { o[this.index(o.length, i, node)] = v; return; }
    if (o instanceof Dict) { o.set(i, v); return; }
    if (o?.__setitem__) { o.__setitem__(i instanceof Tuple ? i.a : i, v); return; }
    throw new PyError("TypeError", `${typeName(o)} no se puede cambiar con [ ] =`, node?.line);
  }
  delitem(o, i, node) {
    if (Array.isArray(o)) { o.splice(this.index(o.length, i, node), 1); return; }
    if (o instanceof Dict) { if (!o.del(i)) throw new PyError("KeyError", pyRepr(i), node?.line); return; }
    throw new PyError("TypeError", `no se puede borrar de ${typeName(o)}`, node?.line);
  }
  getattr(o, name, node) {
    const m = methodsOf(o, this);
    if (m && name in m) { const f = m[name]; return typeof f === "function" && !f.__prop ? f : f.__prop ? f() : f; }
    if (o && o.__getattr__) { const v = o.__getattr__(name); if (v !== undefined) return v; }
    if (o && o.__module && name in o) return o[name];
    if (o instanceof PyError && name === "args") return new Tuple([o.message]);
    throw new PyError("AttributeError", `${typeName(o)} no tiene «${name}»`, node?.line);
  }
  setattr(o, name, v, node) {
    if (o?.__setattr__) { o.__setattr__(name, v); return; }
    throw new PyError("AttributeError", `no se puede cambiar «${name}» de ${typeName(o)}`, node?.line);
  }
}

export function typeName(v) {
  if (v === null || v === undefined) return "None";
  if (typeof v === "boolean") return "un booleano";
  if (typeof v === "number") return Number.isInteger(v) ? "un número entero" : "un número decimal";
  if (typeof v === "string") return "un texto";
  if (Array.isArray(v)) return "una lista";
  if (v instanceof Tuple) return "una tupla";
  if (v instanceof Dict) return "un diccionario";
  if (v instanceof PySet) return "un conjunto";
  if (v instanceof Range) return "un range";
  if (v instanceof PyFunc || typeof v === "function") return "una función";
  if (v.__typename) return v.__typename;
  if (v.__module) return "un módulo";
  return "un objeto";
}

/* ======================================================================
   Métodos de los tipos
   ====================================================================== */
const B = builtin;
function methodsOf(o, I) {
  if (typeof o === "string") return strMethods(o, I);
  if (Array.isArray(o)) return listMethods(o, I);
  if (o instanceof Dict) return dictMethods(o, I);
  if (o instanceof Tuple) return { count: B("count", ([x]) => o.a.filter(y => I.eq(x, y)).length), index: B("index", ([x]) => { const k = o.a.findIndex(y => I.eq(x, y)); if (k < 0) throw new PyError("ValueError", "no está en la tupla"); return k; }) };
  if (o instanceof PySet) return {
    add: B("add", ([x]) => { o.m.set(hashKey(x), x); return null; }), discard: B("discard", ([x]) => { o.m.delete(hashKey(x)); return null; }),
    remove: B("remove", ([x]) => { if (!o.m.delete(hashKey(x))) throw new PyError("KeyError", pyRepr(x)); return null; }),
    union: B("union", ([x]) => I.binop("|", o, new PySet(I.iter(x)))), intersection: B("intersection", ([x]) => I.binop("&", o, new PySet(I.iter(x)))),
    clear: B("clear", () => { o.m.clear(); return null; }),
  };
  if (typeof o === "number") return { is_integer: B("is_integer", () => Number.isInteger(o)), real: Object.assign(() => o, { __prop: true }), imag: Object.assign(() => 0, { __prop: true }) };
  return null;
}
function strMethods(s, I) {
  const str = (v) => pyStr(v);
  return {
    upper: B("upper", () => s.toUpperCase()), lower: B("lower", () => s.toLowerCase()), title: B("title", () => s.replace(/\b\w/g, c => c.toUpperCase())),
    capitalize: B("capitalize", () => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()),
    strip: B("strip", ([c]) => c ? s.replace(new RegExp(`^[${esc(c)}]+|[${esc(c)}]+$`, "g"), "") : s.trim()),
    lstrip: B("lstrip", ([c]) => c ? s.replace(new RegExp(`^[${esc(c)}]+`), "") : s.trimStart()),
    rstrip: B("rstrip", ([c]) => c ? s.replace(new RegExp(`[${esc(c)}]+$`), "") : s.trimEnd()),
    split: B("split", ([sep, max], kw) => { sep ??= kw.sep ?? null; max = max ?? kw.maxsplit ?? -1; let parts = sep === null ? s.trim().split(/\s+/).filter(Boolean) : s.split(sep); if (max >= 0 && parts.length > max + 1) parts = [...parts.slice(0, max), parts.slice(max).join(sep ?? " ")]; return parts; }),
    splitlines: B("splitlines", () => s.split(/\r?\n/)),
    join: B("join", ([it]) => [...I.iter(it)].map(x => { if (typeof x !== "string") throw new PyError("TypeError", "join() necesita textos (usa str())"); return x; }).join(s)),
    replace: B("replace", ([a, b, n]) => { if (n === undefined) return s.split(a).join(b); let out = s; for (let k = 0; k < n; k++) out = out.replace(a, b); return out; }),
    startswith: B("startswith", ([p]) => p instanceof Tuple ? p.a.some(x => s.startsWith(x)) : s.startsWith(p)),
    endswith: B("endswith", ([p]) => p instanceof Tuple ? p.a.some(x => s.endsWith(x)) : s.endsWith(p)),
    find: B("find", ([x]) => s.indexOf(x)), rfind: B("rfind", ([x]) => s.lastIndexOf(x)),
    index: B("index", ([x]) => { const k = s.indexOf(x); if (k < 0) throw new PyError("ValueError", "no está en el texto"); return k; }),
    count: B("count", ([x]) => x ? s.split(x).length - 1 : s.length + 1),
    isdigit: B("isdigit", () => /^\d+$/.test(s)), isalpha: B("isalpha", () => /^[A-Za-zÀ-ÿ]+$/.test(s)), isspace: B("isspace", () => /^\s+$/.test(s)),
    isupper: B("isupper", () => s === s.toUpperCase() && s !== s.toLowerCase()), islower: B("islower", () => s === s.toLowerCase() && s !== s.toUpperCase()),
    zfill: B("zfill", ([w]) => s.padStart(w, "0")), center: B("center", ([w, f = " "]) => formatSpec(s, f + "^" + w)),
    ljust: B("ljust", ([w, f = " "]) => s.padEnd(w, f)), rjust: B("rjust", ([w, f = " "]) => s.padStart(w, f)),
    format: B("format", (args, kw) => { let auto = 0; return s.replace(/\{\{|\}\}|\{([^{}]*)\}/g, (m, inner) => { if (m === "{{") return "{"; if (m === "}}") return "}"; const [key, spec = ""] = inner.split(/:(.*)/s); const v = key === "" ? args[auto++] : /^\d+$/.test(key) ? args[+key] : kw[key]; return formatSpec(v, spec); }); }),
    encode: B("encode", () => s), __str: str,
  };
}
const esc = (c) => String(c).replace(/[\]\\^-]/g, "\\$&");
function listMethods(a, I) {
  return {
    append: B("append", ([x]) => { a.push(x); return null; }),
    extend: B("extend", ([x]) => { a.push(...I.iter(x)); return null; }),
    insert: B("insert", ([i, x]) => { a.splice(i < 0 ? Math.max(0, a.length + i) : i, 0, x); return null; }),
    pop: B("pop", ([i]) => { if (!a.length) throw new PyError("IndexError", "pop() de una lista vacía"); return a.splice(i === undefined ? a.length - 1 : I.index(a.length, i), 1)[0]; }),
    remove: B("remove", ([x]) => { const k = a.findIndex(y => I.eq(x, y)); if (k < 0) throw new PyError("ValueError", "no está en la lista"); a.splice(k, 1); return null; }),
    index: B("index", ([x]) => { const k = a.findIndex(y => I.eq(x, y)); if (k < 0) throw new PyError("ValueError", `${pyRepr(x)} no está en la lista`); return k; }),
    count: B("count", ([x]) => a.filter(y => I.eq(x, y)).length),
    clear: B("clear", () => { a.length = 0; return null; }),
    reverse: B("reverse", () => { a.reverse(); return null; }),
    copy: B("copy", () => [...a]),
    sort: B("sort", (args, kw) => { const s = sortList(a, kw, I); a.splice(0, a.length, ...s); return null; }),
  };
}
function dictMethods(d, I) {
  return {
    get: B("get", ([k, def = null]) => d.has(k) ? d.get(k) : def),
    keys: B("keys", () => d.keys()), values: B("values", () => d.values()), items: B("items", () => d.items()),
    update: B("update", ([o], kw) => { if (o instanceof Dict) for (const [k, v] of o.m.values()) d.set(k, v); else if (o) for (const p of I.iter(o)) { const [k, v] = [...I.iter(p)]; d.set(k, v); } for (const [k, v] of Object.entries(kw)) d.set(k, v); return null; }),
    pop: B("pop", ([k, def]) => { if (d.has(k)) { const v = d.get(k); d.del(k); return v; } if (def !== undefined) return def; throw new PyError("KeyError", pyRepr(k)); }),
    setdefault: B("setdefault", ([k, def = null]) => { if (!d.has(k)) d.set(k, def); return d.get(k); }),
    clear: B("clear", () => { d.m.clear(); return null; }),
    copy: B("copy", () => { const c = new Dict(); for (const [k, v] of d.m.values()) c.set(k, v); return c; }),
  };
}
function sortList(a, kw, I) {
  const key = kw.key ? (x) => I.call(kw.key, [x]) : (x) => x;
  const dec = a.map(x => [key(x), x]);
  dec.sort((p, q) => I.lt(p[0], q[0]) ? -1 : I.lt(q[0], p[0]) ? 1 : 0);
  const out = dec.map(p => p[1]);
  if (I.truthy(kw.reverse ?? false)) out.reverse();
  return out;
}

/* ======================================================================
   Funciones de siempre (builtins) y módulos
   ====================================================================== */
function makeBuiltins(I) {
  const toInt = (v, base) => {
    if (typeof v === "string") { const s = v.trim().replace(/_/g, ""); const n = base ? parseInt(s, base) : /^[+-]?\d+$/.test(s) ? parseInt(s, 10) : NaN; if (Number.isNaN(n)) throw new PyError("ValueError", `«${v}» no es un número entero`); return n; }
    const n = I.num(v);
    if (!Number.isFinite(n)) throw new PyError("ValueError", "no se puede convertir infinito o nan a entero");
    return Math.trunc(n);
  };
  const minmax = (sign) => (args, kw) => {
    const list = args.length === 1 ? [...I.iter(args[0])] : args;
    if (!list.length) { if ("default" in kw) return kw.default; throw new PyError("ValueError", `${sign > 0 ? "max" : "min"}() de algo vacío`); }
    const key = kw.key ? (x) => I.call(kw.key, [x]) : (x) => x;
    let best = list[0], bk = key(best);
    for (const x of list.slice(1)) { const k = key(x); if (sign > 0 ? I.lt(bk, k) : I.lt(k, bk)) { best = x; bk = k; } }
    return best;
  };
  const exc = Object.fromEntries(["Exception", "BaseException", "ValueError", "TypeError", "NameError", "KeyError", "IndexError", "ZeroDivisionError", "RuntimeError", "AttributeError", "AssertionError", "StopIteration", "LookupError", "ArithmeticError", "NotImplementedError", "TimeoutError", "ImportError", "RecursionError", "OverflowError"].map(n => [n, ExcClass(n)]));
  return {
    ...exc,
    print: B("print", (args, kw) => { I.print(args.map(a => pyStr(a)).join(kw.sep ?? " ") + (kw.end ?? "")); return null; }),
    len: B("len", ([v]) => I.len(v)),
    range: B("range", (args) => { const n = args.map(a => toInt(a)); return n.length === 1 ? new Range(0, n[0], 1) : new Range(n[0], n[1], n[2] ?? 1); }),
    int: B("int", ([v = 0, base]) => toInt(v, base)),
    float: B("float", ([v = 0]) => { if (typeof v === "string") { const s = v.trim().toLowerCase(); if (s === "inf" || s === "+inf") return Infinity; if (s === "-inf") return -Infinity; if (s === "nan") return NaN; const n = Number(s); if (s === "" || Number.isNaN(n)) throw new PyError("ValueError", `«${v}» no es un número`); return n; } return I.num(v); }),
    str: B("str", ([v = ""]) => pyStr(v)),
    repr: B("repr", ([v]) => pyRepr(v)),
    bool: B("bool", ([v = false]) => I.truthy(v)),
    list: B("list", ([v]) => v === undefined ? [] : [...I.iter(v)]),
    tuple: B("tuple", ([v]) => new Tuple(v === undefined ? [] : [...I.iter(v)])),
    dict: B("dict", ([v], kw) => { const d = new Dict(); if (v instanceof Dict) for (const [k, x] of v.m.values()) d.set(k, x); else if (v !== undefined) for (const p of I.iter(v)) { const [k, x] = [...I.iter(p)]; d.set(k, x); } for (const [k, x] of Object.entries(kw)) d.set(k, x); return d; }),
    set: B("set", ([v]) => new PySet(v === undefined ? [] : I.iter(v))),
    abs: B("abs", ([v]) => Math.abs(I.num(v))),
    min: B("min", minmax(-1)), max: B("max", minmax(1)),
    sum: B("sum", ([it, start = 0]) => { let s = start; for (const x of I.iter(it)) s = I.binop("+", s, x); return s; }),
    round: B("round", ([v, nd]) => { const n = I.num(v); if (nd === undefined || nd === null) { const r = Math.round(n); return Math.abs(n % 1) === 0.5 ? (r % 2 === 0 ? r : r - 1) : r; } const k = Math.pow(10, nd); return Math.round(n * k) / k; }),
    pow: B("pow", ([a, b]) => Math.pow(I.num(a), I.num(b))),
    divmod: B("divmod", ([a, b]) => new Tuple([I.binop("//", a, b), I.binop("%", a, b)])),
    enumerate: B("enumerate", ([it, start = 0]) => { let k = start; return [...I.iter(it)].map(x => new Tuple([k++, x])); }),
    zip: B("zip", (args) => { const ls = args.map(a => [...I.iter(a)]); const n = ls.length ? Math.min(...ls.map(l => l.length)) : 0; return Array.from({ length: n }, (_, k) => new Tuple(ls.map(l => l[k]))); }),
    sorted: B("sorted", ([it], kw) => sortList([...I.iter(it)], kw, I)),
    reversed: B("reversed", ([it]) => [...I.iter(it)].reverse()),
    any: B("any", ([it]) => { for (const x of I.iter(it)) if (I.truthy(x)) return true; return false; }),
    all: B("all", ([it]) => { for (const x of I.iter(it)) if (!I.truthy(x)) return false; return true; }),
    map: B("map", ([f, ...its]) => { const ls = its.map(a => [...I.iter(a)]); const n = Math.min(...ls.map(l => l.length)); return Array.from({ length: n }, (_, k) => I.call(f, ls.map(l => l[k]))); }),
    filter: B("filter", ([f, it]) => [...I.iter(it)].filter(x => f === null ? I.truthy(x) : I.truthy(I.call(f, [x])))),
    isinstance: B("isinstance", ([v, t]) => {
      const ts = t instanceof Tuple ? t.a : [t];
      return ts.some(T => (T === I.builtins.int && typeof v === "number" && Number.isInteger(v) && typeof v !== "boolean") || (T === I.builtins.float && typeof v === "number") || (T === I.builtins.str && typeof v === "string") || (T === I.builtins.list && Array.isArray(v)) || (T === I.builtins.dict && v instanceof Dict) || (T === I.builtins.tuple && v instanceof Tuple) || (T === I.builtins.bool && typeof v === "boolean") || (T?.__exc && v instanceof PyError && (T.__exc === v.pyType || T.__exc === "Exception")));
    }),
    type: B("type", ([v]) => typeof v === "number" ? (Number.isInteger(v) ? I.builtins.int : I.builtins.float) : typeof v === "string" ? I.builtins.str : typeof v === "boolean" ? I.builtins.bool : Array.isArray(v) ? I.builtins.list : v instanceof Dict ? I.builtins.dict : v instanceof Tuple ? I.builtins.tuple : null),
    chr: B("chr", ([n]) => String.fromCodePoint(n)), ord: B("ord", ([s]) => s.codePointAt(0)),
    hex: B("hex", ([n]) => (n < 0 ? "-0x" : "0x") + Math.abs(n).toString(16)), bin: B("bin", ([n]) => (n < 0 ? "-0b" : "0b") + Math.abs(n).toString(2)),
    callable: B("callable", ([f]) => f instanceof PyFunc || typeof f === "function"),
    hasattr: B("hasattr", ([o, n]) => { try { I.getattr(o, n); return true; } catch { return false; } }),
    getattr: B("getattr", ([o, n, d]) => { try { return I.getattr(o, n); } catch (e) { if (d !== undefined) return d; throw e; } }),
    setattr: B("setattr", ([o, n, v]) => { I.setattr(o, n, v); return null; }),
    iter: B("iter", ([v]) => [...I.iter(v)]),
    next: B("next", ([v, d]) => { if (Array.isArray(v) && v.length) return v.shift(); if (d !== undefined) return d; throw new PyError("StopIteration", ""); }),
    globals: B("globals", () => { const d = new Dict(); for (const [k, v] of I.globals) d.set(k, v); return d; }),
    open: B("open", () => { throw new PyError("PermissionError", "el Python de LumaMap no abre archivos (por seguridad)"); }),
    exec: B("exec", () => { throw new PyError("PermissionError", "exec() no está disponible"); }),
    eval: B("eval", ([s]) => I.evalExpr(String(s))),
    input: B("input", () => { throw new PyError("RuntimeError", "input() no está disponible: usa un Deslizador o un Botón de panel"); }),
  };
}
function stdModules() {
  const M = (name, o) => ({ __module: name, ...o });
  // Azar reproducible (random.seed) con un generador pequeño (mulberry32).
  let seed = (Math.random() * 2 ** 32) >>> 0;
  const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const math = M("math", {
    pi: Math.PI, e: Math.E, tau: Math.PI * 2, inf: Infinity, nan: NaN,
    sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, sqrt: (x) => { if (x < 0) throw new PyError("ValueError", "raíz de un número negativo"); return Math.sqrt(x); },
    exp: Math.exp, log: (x, b) => { if (x <= 0) throw new PyError("ValueError", "logaritmo de 0 o negativo"); return b === undefined ? Math.log(x) : Math.log(x) / Math.log(b); },
    log10: Math.log10, log2: Math.log2, pow: Math.pow, floor: Math.floor, ceil: Math.ceil, trunc: Math.trunc, fabs: Math.abs,
    hypot: Math.hypot, radians: (d) => d * Math.PI / 180, degrees: (r) => r * 180 / Math.PI, fmod: (a, b) => a % b, copysign: (a, b) => Math.sign(b) * Math.abs(a) || Math.abs(a) * (Object.is(b, -0) ? -1 : 1),
    isnan: Number.isNaN, isinf: (x) => x === Infinity || x === -Infinity, isclose: (a, b) => Math.abs(a - b) <= Math.max(1e-9 * Math.max(Math.abs(a), Math.abs(b)), 0),
    factorial: (n) => { let r = 1; for (let k = 2; k <= n; k++) r *= k; return r; }, gcd: (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; },
    dist: (p, q) => Math.hypot(...[...(p.a || p)].map((v, k) => v - (q.a || q)[k])),
  });
  const random = M("random", {
    random: rnd, seed: (s = 0) => { seed = (typeof s === "number" ? s : String(s).split("").reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261)) >>> 0; return null; },
    uniform: (a, b) => a + (b - a) * rnd(), randint: (a, b) => a + Math.floor(rnd() * (b - a + 1)), randrange: (a, b, s = 1) => { if (b === undefined) { b = a; a = 0; } const n = Math.ceil((b - a) / s); return a + Math.floor(rnd() * n) * s; },
    choice: B("choice", ([seq]) => { const a = seq instanceof Tuple ? seq.a : typeof seq === "string" ? [...seq] : seq; if (!a?.length) throw new PyError("IndexError", "choice() de algo vacío"); return a[Math.floor(rnd() * a.length)]; }),
    shuffle: B("shuffle", ([a]) => { for (let k = a.length - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); [a[k], a[j]] = [a[j], a[k]]; } return null; }),
    sample: B("sample", ([seq, n]) => { const a = [...(seq.a || seq)]; for (let k = a.length - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); [a[k], a[j]] = [a[j], a[k]]; } return a.slice(0, n); }),
    gauss: (mu = 0, s = 1) => mu + s * Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd()),
  });
  const time = M("time", { time: () => Date.now() / 1000, perf_counter: () => (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000, monotonic: () => (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000 });
  const colorsys = M("colorsys", {
    hsv_to_rgb: (h, s, v) => { const f = (n) => { const k = (n + h * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); }; return new Tuple([f(5), f(3), f(1)]); },
    rgb_to_hsv: (r, g, b) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0; if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h /= 6; if (h < 0) h += 1; } return new Tuple([h, mx ? d / mx : 0, mx]); },
  });
  return { math, random, time, colorsys };
}

/* ======================================================================
   Pasar valores entre Python y JavaScript
   ====================================================================== */
export function toJS(v) {
  if (v instanceof Tuple) return v.a.map(toJS);
  if (Array.isArray(v)) return v.map(toJS);
  if (v instanceof Dict) { const o = {}; for (const [k, x] of v.m.values()) o[pyStr(k)] = toJS(x); return o; }
  if (v instanceof PySet) return [...v.m.values()].map(toJS);
  if (v instanceof Range) return [...v];
  return v;
}
export function toPy(v) {
  if (Array.isArray(v)) return v.map(toPy);
  if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) { const d = new Dict(); for (const [k, x] of Object.entries(v)) d.set(k, toPy(x)); return d; }
  return v;
}
