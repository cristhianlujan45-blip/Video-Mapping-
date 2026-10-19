// tests/py.test.js — el Python de LumaMap: lenguaje, errores con su línea, seguridad y límites.
import { test, report } from "./harness.js";
import assert from "node:assert/strict";
import { Interp, parse, checkSyntax, formatError, pyStr, PyError } from "../web/js/td/py.js";
import { newNetwork, addNode, connect, Cooker } from "../web/js/td/graph.js";
import { pyConsole, replRun } from "../web/js/td/pyapi.js";

/** Ejecuta y devuelve lo impreso (líneas). */
function run(src, o = {}) {
  const out = [];
  const I = new Interp({ print: (t) => out.push(t), ...o });
  I.run(src);
  return out;
}
const one = (src) => run(src).join("\n");
const err = (src) => { try { run(src); return null; } catch (e) { return e; } };

console.log("== Python de LumaMap ==");
await test("números, textos, operadores de Python (//, %, **, and/or, in, is, ternario, comparaciones encadenadas)", () => {
  assert.equal(one("print(7 // 2, -7 // 2, 7 % 3, -7 % 3, 2 ** 10, 2 ** -1)"), "3 -4 1 2 1024 0.5");
  assert.equal(one("print(1 < 2 < 3, 3 > 2 > 5, 1 == 1.0, 'a' in 'casa', 3 not in [1, 2])"), "True False True True True");
  assert.equal(one("x = None\nprint(x is None, x is not None, 0 or 'b', 1 and 2, not [])"), "True False b 2 True");
  assert.equal(one("print('si' if 3 > 2 else 'no', -2 ** 2, (1 + 2) * 3, 10 / 4)"), "si -4 9 2.5");
  assert.equal(one("print(0.1 + 0.2, 1e20, 1/3, 5.0, int('42') + 1, float('2.5'))"), "0.30000000000000004 1e+20 0.3333333333333333 5 43 2.5");
  assert.equal(one("print(0x1F, 0b101, 1_000_000, ~5, 6 & 3, 6 | 3, 6 ^ 3, 1 << 4, 256 >> 2)"), "31 5 1000000 -6 2 7 5 16 64");
  assert.equal(one("print('ab' * 3, [0] * 3, 'x' + 'y', len('hola'))"), "ababab [0, 0, 0] xy 4");
});
await test("textos: métodos, rebanadas, f-strings con formato, .format() y %", () => {
  assert.equal(one("s = '  Hola Mundo  '\nprint(s.strip().upper(), s.strip().lower().split(' '), '-'.join(['a', 'b']))"), "HOLA MUNDO ['hola', 'mundo'] a-b");
  assert.equal(one("s = 'LumaMap'\nprint(s[0], s[-1], s[1:4], s[::-1], s[::2])"), "L p uma paMamuL LmMp");
  assert.equal(one("v = 3.14159\nn = 42\nprint(f'{v:.2f} {n:05d} {n:>5}| {\"x\"!r} {n*2} {v:.1%} {1234567:,}')"), "3.14 00042    42| 'x' 84 314.2% 1,234,567");
  assert.equal(one("x = 5\nprint(f'{x=}', f'{{literal}}')"), "x=5 {literal}");
  assert.equal(one("print('{} y {}'.format(1, 'dos'), '{a:.1f}'.format(a=2), '%d de %s: %.2f' % (3, 'x', 1.5))"), "1 y dos 2.0 3 de x: 1.50");
  assert.equal(one("print('a,b,,c'.split(','), 'aXbXc'.replace('X', '-'), 'casa'.startswith('ca'), 'abc'.find('c'), 'x'.zfill(3))"), "['a', 'b', '', 'c'] a-b-c True 2 00x");
  assert.equal(one("print('''tres\nlineas''')"), "tres\nlineas");
});
await test("listas, tuplas, diccionarios, conjuntos y comprensiones", () => {
  assert.equal(one("a = [3, 1, 2]\na.append(5)\na.sort()\nprint(a, a.pop(), a, len(a), sum(a), min(a), max(a))"), "[1, 2, 3] 5 [1, 2, 3] 3 6 1 3");
  assert.equal(one("print([x * x for x in range(5) if x % 2 == 0], {k: v for k, v in [('a', 1), ('b', 2)]}, {x % 3 for x in range(6)})"), "[0, 4, 16] {'a': 1, 'b': 2} {0, 1, 2}");
  assert.equal(one("d = {'a': 1}\nd['b'] = 2\nd.update(c=3)\nprint(d, d.get('z', 0), list(d.keys()), 'a' in d, len(d))\ndel d['a']\nprint(d)"), "{'a': 1, 'b': 2, 'c': 3} 0 ['a', 'b', 'c'] True 3\n{'b': 2, 'c': 3}");
  assert.equal(one("t = (1, 2, 3)\na, *b = t\nx, y = y, x = 1, 2\nprint(a, b, t[1:], (5,), x, y)"), "1 [2, 3] (2, 3) (5,) 2 1");
  assert.equal(one("print(sorted([3, 1, 2], reverse=True), sorted(['bb', 'a', 'ccc'], key=len), list(zip([1, 2], 'ab')), list(enumerate('xy', 1)))"), "[3, 2, 1] ['a', 'bb', 'ccc'] [(1, 'a'), (2, 'b')] [(1, 'x'), (2, 'y')]");
  assert.equal(one("m = [[0] * 2 for _ in range(2)]\nm[0][1] = 7\nprint(m, [[i, j] for i in range(2) for j in range(2) if i != j])"), "[[0, 7], [0, 0]] [[0, 1], [1, 0]]");
  assert.equal(one("print(list(map(lambda v: v * 2, [1, 2])), list(filter(None, [0, 1, 2])), any([0, 1]), all([]), sum(x for x in range(4)))"), "[2, 4] [1, 2] True True 6");
});
await test("control: if/elif/else, for/while con break, continue y else, funciones con valores por defecto, *args, **kwargs, recursión y closures", () => {
  assert.equal(one("for i in range(10):\n    if i == 2:\n        continue\n    if i > 4:\n        break\n    print(i)\nelse:\n    print('nunca')"), "0\n1\n3\n4");
  assert.equal(one("n = 0\nwhile n < 3:\n    n += 1\nelse:\n    print('fin', n)"), "fin 3");
  assert.equal(one("def f(a, b=2, *rest, c=10, **kw):\n    return a + b + sum(rest) + c + len(kw)\nprint(f(1), f(1, 1, 1, 1, c=0, z=9, w=8))"), "13 6");
  assert.equal(one("def fib(n):\n    return n if n < 2 else fib(n - 1) + fib(n - 2)\nprint([fib(i) for i in range(10)])"), "[0, 1, 1, 2, 3, 5, 8, 13, 21, 34]");
  assert.equal(one("def contador():\n    c = [0]\n    def mas():\n        c[0] += 1\n        return c[0]\n    return mas\nm = contador()\nm(); m()\nprint(m())"), "3");
  assert.equal(one("total = 0\ndef sumar(v):\n    global total\n    total += v\nsumar(2); sumar(3)\nprint(total)"), "5");
  assert.equal(one("x = 3\nif x > 5:\n    print('a')\nelif x > 2:\n    print('b')\nelse:\n    print('c')"), "b");
  assert.equal(one("def f(): pass\nprint(f())"), "None");
});
await test("módulos permitidos: math, random (con semilla), colorsys, time; los demás se niegan", () => {
  assert.equal(one("import math\nprint(round(math.sin(math.pi / 2), 3), math.sqrt(16), math.floor(2.7), math.radians(180) == math.pi)"), "1 4 2 True");
  assert.equal(one("from math import pi, cos as c\nprint(round(c(pi), 1))"), "-1");
  const r = run("import random\nrandom.seed(7)\na = [random.random() for _ in range(3)]\nrandom.seed(7)\nb = [random.random() for _ in range(3)]\nprint(a == b, 0 <= a[0] < 1, random.randint(1, 1))");
  assert.equal(r[0], "True True 1");
  assert.equal(one("import colorsys\nprint(colorsys.hsv_to_rgb(0, 1, 1))"), "(1, 0, 0)");
  const e = err("import os");
  assert.equal(e.pyType, "ImportError"); assert.match(e.message, /math/);
  assert.equal(err("open('x.txt')").pyType, "PermissionError");
  assert.equal(err("exec('1')").pyType, "PermissionError");
});
await test("errores con su línea y una pista en español; try/except/else/finally; raise y assert", () => {
  const e1 = err("a = 1\nb = c + 1");
  assert.equal(e1.pyType, "NameError"); assert.equal(e1.line, 2);
  assert.match(formatError(e1), /^Línea 2 · NameError: «c» no existe\n→ /);
  const e2 = err("x = 'edad: ' + 5");
  assert.equal(e2.pyType, "TypeError"); assert.match(e2.message, /str\(numero\)/);
  assert.equal(err("print(1/0)").pyType, "ZeroDivisionError");
  assert.equal(err("[1][3]").pyType, "IndexError");
  assert.equal(err("{}['x']").pyType, "KeyError");
  assert.equal(err("if True\n    pass").pyType, "SyntaxError");
  assert.equal(err("if True:\npass").pyType, "IndentationError");
  assert.equal(err("print((1, 2)").pyType, "SyntaxError");
  assert.equal(err("class A: pass").pyType, "SyntaxError");
  assert.equal(one("try:\n    1 / 0\nexcept ZeroDivisionError as e:\n    print('cero', e)\nelse:\n    print('no')\nfinally:\n    print('fin')"), "cero división entre cero\nfin");
  assert.equal(one("try:\n    raise ValueError('mal')\nexcept (KeyError, ValueError) as e:\n    print(type(e) is None, str(e))"), "True mal");
  assert.equal(one("def f():\n    try:\n        return 1\n    finally:\n        print('limpio')\nprint(f())"), "limpio\n1");
  assert.equal(err("assert 1 == 2, 'no son iguales'").message, "no son iguales");
  assert.equal(checkSyntax("x = (1, 2"), "Línea 1 · SyntaxError: falta cerrar un paréntesis, corchete o llave\n→ Mira la línea: suele faltar «:» al final de if/for/def, cerrar un paréntesis o unas comillas.");
  assert.equal(checkSyntax("def f(x):\n    return x * 2\n"), "");
});
await test("seguridad del show: un bucle infinito o una recursión sin fin se cortan con un aviso", () => {
  const t0 = Date.now();
  const e = err("while True:\n    pass");
  assert.equal(e.pyType, "TimeoutError"); assert.ok(Date.now() - t0 < 3000, "se corta rápido");
  const r = err("def f(n):\n    return f(n + 1)\nf(0)");
  assert.equal(r.pyType, "RecursionError");
  const I = new Interp({ maxSteps: 1000 });
  assert.throws(() => I.run("for i in range(100000):\n    x = i"), (x) => x instanceof PyError && x.pyType === "TimeoutError");
});
await test("el módulo guarda sus variables entre llamadas; callbacks; objetos del anfitrión (getattr/setattr/getitem)", () => {
  const par = { brightness: 1 };
  const host = { __typename: "un nodo", __getattr__: (n) => n === "par" ? { __getattr__: (k) => par[k], __setattr__: (k, v) => { par[k] = v; } } : n === "name" ? "level1" : undefined, __getitem__: (k) => k === "chan1" ? 0.5 : 0 };
  const out = [];
  const I = new Interp({ print: (t) => out.push(t), globals: { op: (name) => host } });
  I.run("cuenta = 0\ndef onFrameStart(frame):\n    global cuenta\n    cuenta += 1\n    op('level1').par.brightness = op('lfo1')['chan1'] * 2 + cuenta\n    print(op('level1').name, frame)");
  I.callIfExists("onFrameStart", [10]);
  I.callIfExists("onFrameStart", [11]);
  assert.equal(par.brightness, 3);
  assert.deepEqual(out, ["level1 10", "level1 11"]);
  assert.equal(I.callIfExists("noExiste"), undefined);
  assert.equal(pyStr(I.evalExpr("cuenta * 10")), "20");
  assert.ok(parse("x = 1").length === 1);
});
await test("Python en la red: Script CHOP con entradas, «Ejecutar» que cambia parámetros y reacciona al golpe, tablas, me y la consola", () => {
  const net = newNetwork("py");
  const lfo = addNode(net, "CHOP", "constant", { p: { name0: "v", value0: 0.25 } });
  const sc = addNode(net, "CHOP", "script", { p: { code: "def onCook(scriptOp):\n    scriptOp.clear()\n    scriptOp.numSamples = 3\n    x = scriptOp.appendChan('doble')\n    for i in range(3):\n        x[i] = scriptOp.inputs[0]['v'] * 2 + i\n    y = scriptOp.appendChan('nombre_len')\n    y[0] = len(me.name)" } });
  connect(net, lfo.id, sc.id, 0);
  const lv = addNode(net, "TOP", "level", { p: { brightness: 1 } });
  const tb = addNode(net, "DAT", "table", { p: { text: "1, 2\n3, hola" } });
  const bt = addNode(net, "COMP", "button", { p: { value: 0 } });
  const ex = addNode(net, "DAT", "execute", { p: { chop: "", code: "golpes = 0\ndef onStart():\n    print('inicio', me.name)\ndef onFrameStart(frame):\n    op('level1').par.brightness = op('script1')['doble'][1] + op('table1')[1, 0]\ndef onOffToOn(channel):\n    global golpes\n    golpes += 1\n    op('table1')[0, 1] = golpes" } });
  const ck = new Cooker();
  const frame = (k) => { ck.begin(net, { t: k / 60, dt: 1 / 60, frame: k }); ck.runScripts(); };
  const out0 = pyConsole.lines.length;
  frame(1);
  const c = ck.chop(sc);
  assert.deepEqual(c.names, ["doble", "nombre_len"]);
  assert.deepEqual(c.data.doble, [0.5, 1.5, 2.5]);
  assert.equal(c.data.nombre_len[0], 7);
  assert.equal(lv.p.brightness, 4.5, "1,5 + 3 de la tabla");
  assert.ok(pyConsole.lines.slice(out0).some(l => l.text === "inicio execute1"), "onStart imprime en la consola");
  // Vigilar el botón: cada vez que pasa de 0 a 1, onOffToOn.
  ex.p.chop = bt.name;
  frame(2); bt.p.value = 1; frame(3); frame(4); bt.p.value = 0; frame(5); bt.p.value = 1; frame(6);
  assert.equal(tb.p.text.split("\n")[0], "1, 2", "la primera vez que vigila solo mira");
  frame(7);
  assert.match(tb.p.text.split("\n")[0], /^1, [12]$/);
  // Un error en un script: el nodo lo dice con la línea, y la consola también; el resto sigue.
  sc.p.code = "def onCook(scriptOp):\n    x = noexiste + 1";
  ck.begin(net, { t: 1, dt: 1 / 60, frame: 9 });
  ck.chop(sc);
  assert.match(ck.errors.get(sc.id), /^Línea 2 · NameError: «noexiste» no existe/);
  // Consola: expresiones enseñan su valor; las variables se quedan.
  const n1 = pyConsole.lines.length;
  replRun(ck, net, "a = op('table1')[1, 0] * 10");
  replRun(ck, net, "a + 1");
  replRun(ck, net, "op('level1').par.brightness");
  replRun(ck, net, "op('nada')");
  const L = pyConsole.lines.slice(n1).map(l => l.kind + ":" + l.text);
  assert.ok(L.includes("out:31"), JSON.stringify(L));
  assert.ok(L.some(x => /^out:4\.5$|^out:\d/.test(x)));
  assert.ok(L.some(x => x.startsWith("err:") && /nada/.test(x)));
});
report();
