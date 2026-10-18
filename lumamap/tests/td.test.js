// tests/td.test.js — la red tipo TouchDesigner sin GPU: expresiones, catálogo de operadores,
// cables (sin bucles), copiar/pegar, renombrar y el cocinado de CHOPs fotograma a fotograma.
import { test, report } from "./harness.js";
import assert from "node:assert/strict";
import { compileExpr, evalExpr, renameInExpr, noise3 } from "../web/js/td/expr.js";
import { OP_LIST, opDef, FAMILIES, searchOps, acceptsInput } from "../web/js/td/ops.js";
import { Particles } from "../web/js/td/particles.js";
import { evalChan, setKey, animTime, normalizeAnim, valueRange } from "../web/js/td/anim.js";
import { netTime, playNet, pauseNet, seekNet, setNetRate, groupIntoBase, ungroupBase, syncReplicators, subOut, resolveOut, childrenOf, outFam } from "../web/js/td/graph.js";
import { newNetwork, addNode, connect, disconnect, removeNodes, removeKeepWires, copyNodes, pasteNodes, renameNode, Cooker, normalizeNetworks, nodeByName, uniqueName, dependsOn } from "../web/js/td/graph.js";

const close = (a, b, e = 1e-6) => Math.abs(a - b) < e;

console.log("== Red de nodos tipo TouchDesigner (núcleo) ==");
await test("expresiones: aritmética, funciones, condicionales y estilo Python; los errores no rompen nada", () => {
  const v = (e, env = {}) => evalExpr(e, env).value;
  assert.equal(v("1 + 2 * 3"), 7);
  assert.equal(v("(1 + 2) * 3"), 9);
  assert.equal(v("2 ** 3 ** 2"), 512);
  assert.equal(v("-2 ** 2"), -4);
  assert.equal(v("10 % 3"), 1);
  assert.equal(v("1 / 0"), 0, "dividir entre 0 no da infinito");
  assert.ok(close(v("sin(pi / 2)"), 1));
  assert.equal(v("fit(0.5, 0, 1, 10, 20)"), 15);
  assert.equal(v("fit(2, 0, 1, 10, 20)"), 20, "fit limita");
  assert.equal(v("clamp(-3, 0, 1)"), 0);
  assert.equal(v("1 if 2 > 1 else 5"), 1);
  assert.equal(v("3 > 2 and 1 < 0 ? 4 : 6"), 6);
  assert.equal(v("not 0"), 1);
  for (const bad of ["1 +", "(1", "sin(", "1 2", "@"]) { const r = evalExpr(bad); assert.equal(r.value, 0); assert.ok(r.error, bad); }
  assert.ok(noise3(1.3, 2.1) >= 0 && noise3(1.3, 2.1) <= 1);
  assert.equal(noise3(4.2, 1, 0), noise3(4.2, 1, 0), "el ruido es siempre igual (editor y salida coinciden)");
});
await test("expresiones: canales de CHOP (lfo1.chan1, op('x')['y'][i]), parámetros (.par) y tablas; dice qué falta", () => {
  const chops = { lfo1: { names: ["chan1", "tx"], len: 3, data: { chan1: [0.25, 0.5, 0.75], tx: [1, 2, 3] } } };
  const env = { t: 2, frame: 120, i: 0, vars: { t: 2 }, me: { digits: 7 }, chop: (n) => chops[n] || null, par: (n, k) => n === "level1" && k === "brightness" ? 1.5 : 0, tab: (n, r, c) => r * 10 + c };
  assert.equal(evalExpr("lfo1.chan1 * 2", env).value, 0.5);
  assert.equal(evalExpr("op('lfo1')['tx'][2]", env).value, 3);
  assert.equal(evalExpr("lfo1['tx']", { ...env, i: 1 }).value, 2, "con instancias, la muestra de cada copia");
  assert.equal(evalExpr("op('level1').par.brightness", env).value, 1.5);
  assert.equal(evalExpr("absTime.seconds + me.digits", env).value, 9);
  assert.equal(evalExpr("tab('tabla1', 2, 3)", env).value, 23);
  assert.equal(evalExpr("lfo1.numChans", env).value, 2);
  const miss = evalExpr("nada1.chan1", env);
  assert.equal(miss.value, 0); assert.match(miss.error, /nada1/);
  assert.deepEqual([...compileExpr("op('a')['x'] + b.c * fit(d.e, 0, 1, 0, 1)").refs].sort(), ["a", "b", "d"]);
  assert.equal(renameInExpr("op('lfo1')['x'] + lfo1.chan1 + mylfo1.x + lfo1x.y", "lfo1", "onda"), "op('onda')['x'] + onda.chan1 + mylfo1.x + lfo1x.y");
});
await test("catálogo: 6 familias, más de 70 operadores, todos con nombre, descripción y parámetros válidos; búsqueda como el Tab de TouchDesigner", () => {
  assert.deepEqual(Object.keys(FAMILIES), ["TOP", "CHOP", "SOP", "COMP", "MAT", "DAT"]);
  assert.ok(OP_LIST.length >= 70, "operadores: " + OP_LIST.length);
  const keys = new Set();
  for (const o of OP_LIST) {
    const k = o.fam + ":" + o.type;
    assert.ok(!keys.has(k), "repetido " + k); keys.add(k);
    assert.ok(o.label && o.desc && Array.isArray(o.params) && o.inputs.length === 2, k);
    if (o.fam === "TOP") assert.ok(o.glsl || o.special, k + " sin shader");
    if (o.fam === "CHOP") assert.equal(typeof o.cook, "function", k);
    for (const q of o.params) { assert.ok(q.k && q.label && q.type, k + "." + q.k); if (q.type === "m") assert.ok(q.opts.some(([v]) => v === q.def), k + "." + q.k + " por defecto fuera del menú"); }
  }
  for (const fam of Object.keys(FAMILIES)) assert.ok(OP_LIST.some(o => o.fam === fam), fam);
  assert.equal(searchOps("ruido")[0].type, "noise");
  assert.ok(searchOps("camara").some(o => o.type === "videoin"), "sin acentos también");
  assert.ok(searchOps("", "MAT").every(o => o.fam === "MAT"));
  assert.ok(acceptsInput("TOP", "level", "TOP") && !acceptsInput("TOP", "level", "CHOP") && acceptsInput("COMP", "geo", "SOP") && !acceptsInput("COMP", "camera", "SOP"));
});
await test("red: nombres como TouchDesigner (noise1, noise2), cables con su familia, sin bucles, quitar dejando pasar", () => {
  const net = newNetwork();
  const n1 = addNode(net, "TOP", "noise"), n2 = addNode(net, "TOP", "noise"), lv = addNode(net, "TOP", "level"), out = addNode(net, "TOP", "out"), lfo = addNode(net, "CHOP", "lfo");
  assert.deepEqual([n1.name, n2.name, lv.name, out.name, lfo.name], ["noise1", "noise2", "level1", "out1", "lfo1"]);
  assert.equal(net.display, n1.id, "la primera imagen se ve de fondo");
  assert.equal(connect(net, n1.id, lv.id, 0), "");
  assert.equal(connect(net, lv.id, out.id, 0), "");
  assert.match(connect(net, out.id, n1.id, 0), /solo tiene 0 entradas|bucle/);
  assert.match(connect(net, out.id, lv.id, 0), /bucle/, "out → level haría un bucle");
  assert.match(connect(net, lfo.id, lv.id, 0), /CHOP no se puede conectar a un TOP/);
  assert.match(connect(net, n2.id, lv.id, 1), /solo tiene 1 entrada/);
  removeKeepWires(net, lv.id);
  assert.equal(out.in[0], n1.id, "al quitar el nivel, el ruido llega directo a la salida");
  removeNodes(net, [n1.id]);
  assert.equal(out.in[0], null);
  assert.notEqual(net.display, n1.id);
  disconnect(net, out.id, 0);
  assert.deepEqual(out.in, []);
  assert.equal(uniqueName(net, "noise7"), "noise1", "el número se pone solo");
});
await test("copiar, pegar y renombrar: las copias se conectan entre sí y las expresiones siguen al nombre nuevo", () => {
  const net = newNetwork();
  const lfo = addNode(net, "CHOP", "lfo"), nz = addNode(net, "TOP", "noise", { x: 10, y: 20 }), lv = addNode(net, "TOP", "level");
  connect(net, nz.id, lv.id, 0);
  lv.p.brightness = { e: "lfo1.chan1 + 1" };
  lv.p.opacity = { e: "op('noise1').par.amp" };
  const clip = copyNodes(net, [nz.id, lv.id]);
  const pasted = pasteNodes(net, JSON.parse(JSON.stringify(clip)), 50, 0);
  assert.equal(pasted.length, 2);
  const [nz2, lv2] = pasted;
  assert.equal(nz2.name, "noise2"); assert.equal(lv2.name, "level2");
  assert.equal(lv2.in[0], nz2.id, "la copia del nivel recibe la copia del ruido");
  assert.equal(nz2.x, 60);
  assert.equal(lv2.p.opacity.e, "op('noise2').par.amp", "la expresión de la copia apunta a la copia");
  assert.equal(lv2.p.brightness.e, "lfo1.chan1 + 1", "lo que no se copió sigue igual");
  assert.equal(renameNode(net, lfo.id, "onda"), "");
  assert.equal(lv.p.brightness.e, "onda.chan1 + 1");
  assert.match(renameNode(net, lfo.id, "noise1"), /Ya hay/);
  assert.match(renameNode(net, lfo.id, "1mal"), /solo puede/);
  assert.deepEqual([...dependsOn(net, lv)].sort(), ["noise1", "onda"]);
});
await test("cocinar CHOPs: LFO, matemáticas, suavizado, temporizador, disparo, contador y expresiones que los leen", () => {
  const net = newNetwork();
  const lfo = addNode(net, "CHOP", "lfo", { p: { rate: 1, amp: 1 } });
  const math = addNode(net, "CHOP", "math", { p: { range: 1, fromlo: -1, fromhi: 1, tolo: 0, tohi: 10 } });
  connect(net, lfo.id, math.id, 0);
  const lv = addNode(net, "TOP", "level", { p: { brightness: { e: "math1.chan1 / 10" } } });
  const ck = new Cooker();
  ck.begin(net, { t: 0.25, dt: 1 / 60, frame: 15 });
  assert.ok(close(ck.chop(lfo).data.chan1[0], 1), "seno a ¼ de vuelta = 1");
  assert.ok(close(ck.chop(math).data.chan1[0], 10), "de −1…1 a 0…10");
  assert.ok(close(ck.param(lv, "brightness"), 1), "la expresión lee el CHOP");
  // Suavizado: se acerca poco a poco.
  const cst = addNode(net, "CHOP", "constant", { p: { value0: { e: "0 if absTime.seconds < 0 else 1" } } }), flt = addNode(net, "CHOP", "filter", { p: { up: 0.5, down: 0.5 } });
  connect(net, cst.id, flt.id, 0);
  ck.begin(net, { t: -1, dt: 1 / 60, frame: 0 }); assert.equal(ck.chop(flt).data.chan1[0], 0);
  let prev = -1;
  for (let k = 0; k < 30; k++) { ck.begin(net, { t: k / 60, dt: 1 / 60, frame: k }); const v = ck.chop(flt).data.chan1[0]; assert.ok(v >= prev); prev = v; }
  assert.ok(prev > 0.2 && prev < 0.9, "medio segundo de suavizado: " + prev);
  // Temporizador de 2 s con vueltas.
  const tm = addNode(net, "CHOP", "timer", { p: { length: 2 } });
  for (let k = 0; k <= 50; k++) { ck.begin(net, { t: 10 + k * 0.1, dt: 0.1, frame: k }); ck.chop(tm); }
  const T = ck.chop(tm).data;
  assert.ok(close(T.timer_fraction[0], 0.5, 1e-6), "5 s → media vuelta: " + T.timer_fraction[0]);
  assert.equal(T.cycles[0], 2);
  // Disparo y contador con un golpe que sube y baja.
  const beat = addNode(net, "CHOP", "constant", { p: { value0: { e: "1 if fract(absTime.seconds) < 0.1 else 0" } } });
  const trig = addNode(net, "CHOP", "trigger", { p: { attack: 0, release: 0.5 } }), cnt = addNode(net, "CHOP", "count");
  connect(net, beat.id, trig.id, 0); connect(net, beat.id, cnt.id, 0);
  let peak = 0;
  for (let k = 0; k < 300; k++) { ck.begin(net, { t: 20 + k / 100, dt: 0.01, frame: k }); peak = Math.max(peak, ck.chop(trig).data.chan1[0]); ck.chop(cnt); }
  assert.equal(ck.chop(cnt).data.chan1[0], 3, "tres golpes en tres segundos");
  assert.ok(peak > 0.9);
});
await test("CHOPs de entrada: audio, espectro, ratón, teclado, MIDI/OSC, cuerpo con cámara y movimiento", () => {
  const net = newNetwork(), ck = new Cooker();
  const au = addNode(net, "CHOP", "audio"), sp = addNode(net, "CHOP", "spectrum", { p: { bins: 8 } }), ms = addNode(net, "CHOP", "mouse"), kb = addNode(net, "CHOP", "keyboard", { p: { key: "a" } });
  const inp = addNode(net, "CHOP", "input", { p: { src: "midi", key: "cc:1:7" } }), tr = addNode(net, "CHOP", "tracking"), mo = addNode(net, "CHOP", "motion");
  const fft = new Uint8Array(256); fft.fill(255, 0, 32);
  ck.begin(net, { t: 1, dt: 0.016, frame: 1, levels: { bass: 0.8, mid: 0.2, high: 0.1, level: 0.5, beat: 1, bpm: 128 }, fft: () => fft, pointer: { x: 0.25, y: 0.75, down: true },
    keys: new Set(["a"]), input: (s, k) => s === "midi" && k === "cc:1:7" ? 0.6 : 0, tracking: () => ({ presence: 1, right_hand_x: 0.9, right_hand_y: 0.8 }), motion: () => ({ amount: 0.4, x: 0.2, y: 0.6 }) });
  assert.equal(ck.chop(au).data.bass[0], 0.8); assert.equal(ck.chop(au).data.bpm[0], 128);
  const S = ck.chop(sp); assert.equal(S.len, 8); assert.ok(S.data.spectrum[0] > 0.9 && S.data.spectrum[7] < 0.1, "graves llenos, agudos vacíos");
  assert.deepEqual([ck.chop(ms).data.tx[0], ck.chop(ms).data.ty[0], ck.chop(ms).data.select[0]], [0.25, 0.75, 1]);
  assert.equal(ck.chop(kb).data.a[0], 1);
  assert.equal(ck.chop(inp).data.value[0], 0.6);
  assert.equal(ck.chop(tr).data.right_hand_x[0], 0.9);
  assert.equal(ck.chop(tr).data.head_x[0], 0.5, "lo que no llega queda en el centro");
  assert.ok(close(ck.chop(mo).data.x[0], 0.8), "espejo por defecto");
});
await test("instancias: Pattern y Noise CHOP con muchas muestras; Select y Merge; exportar a un parámetro de LumaMap", () => {
  const net = newNetwork(), ck = new Cooker();
  const pat = addNode(net, "CHOP", "pattern", { p: { kind: 3, length: 10, amp: 2, offset: -1, name: "tx" } });
  const nz = addNode(net, "CHOP", "noise", { p: { samples: 10, chans: 2, names: "ty tz" } });
  const mg = addNode(net, "CHOP", "merge"); connect(net, pat.id, mg.id, 0); connect(net, nz.id, mg.id, 1);
  const sel = addNode(net, "CHOP", "select", { p: { chans: "t?", rename: "a b c" } }); connect(net, mg.id, sel.id, 0);
  ck.begin(net, { t: 3, dt: 0.016, frame: 1 });
  const M = ck.chop(mg);
  assert.deepEqual(M.names, ["tx", "ty", "tz"]); assert.equal(M.len, 10);
  assert.ok(close(M.data.tx[0], -1) && close(M.data.tx[5], 0), "rampa de −1 a 1");
  assert.deepEqual(ck.chop(sel).names, ["a", "b", "c"]);
  const ex = addNode(net, "CHOP", "export", { p: { target: "surf/sel/opacity", lo: 0.2, hi: 1 } }); connect(net, pat.id, ex.id, 0);
  const cst = addNode(net, "CHOP", "constant", { p: { value0: 0.5 } }); const ex2 = addNode(net, "CHOP", "export", { p: { target: "global/master" } }); connect(net, cst.id, ex2.id, 0);
  ck.begin(net, { t: 3, dt: 0.016, frame: 2 });
  const out = ck.exports();
  assert.equal(out.length, 2);
  assert.ok(close(out[0].value, 0.2 + (-1) * 0.8) && out[1].value === 0.5 && out[1].target === "global/master");
});
await test("bypass, expresiones que se nombran a sí mismas y redes guardadas con datos raros", () => {
  const net = newNetwork(), ck = new Cooker();
  const a = addNode(net, "CHOP", "constant", { p: { value0: 2 } }), m = addNode(net, "CHOP", "math", { p: { mult: 10 } });
  connect(net, a.id, m.id, 0);
  m.bypass = true;
  ck.begin(net, { t: 0, frame: 0 });
  assert.equal(ck.chop(m).data.chan1[0], 2, "en bypass deja pasar la entrada");
  const self = addNode(net, "CHOP", "constant", { p: { value0: { e: "constant2.chan1 + 1" } } });
  ck.begin(net, { t: 0, frame: 1 });
  assert.doesNotThrow(() => ck.chop(self));
  const tab = addNode(net, "DAT", "table", { p: { text: "1, 2, 3\n4, 5, 6" } });
  assert.equal(ck.tab(tab.name, 1, 2), 6);
  const nets = normalizeNetworks([{ name: "X", res: [99999, -3], nodes: [{ fam: "TOP", type: "noexiste" }, { fam: "TOP", type: "level", id: "a", in: ["fantasma"] }], display: "zz" }, null, 5]);
  assert.equal(nets.length, 1);
  assert.deepEqual(nets[0].res, [4096, 16]);
  assert.equal(nets[0].nodes.length, 1);
  assert.deepEqual(nets[0].nodes[0].in, [null]);
  assert.equal(nets[0].display, null);
  assert.equal(nodeByName(nets[0], "level1")?.type, "level");
  assert.ok(opDef("TOP", "glsl").params.some(q => q.type === "code"));
});
await test("partículas: nacen al ritmo pedido, explotan con el botón o al pasar de 0,5, caen con la gravedad, rebotan y mueren al acabar su vida", () => {
  const P = new Particles(1000), base = { rate: 100, life: 1, lifeVar: 0, speed: 1, speedVar: 0, spread: 0, dx: 0, dy: 1, dz: 0, gravity: 0, drag: 0, turb: 0, max: 1000, play: 1, burst: 0, burstCount: 50 };
  for (let k = 0; k < 30; k++) P.step(base, 1 / 60);
  assert.ok(Math.abs(P.n - 50) <= 2, "100/s durante 0,5 s ≈ 50: " + P.n);
  let maxY = 0; for (let k = 0; k < P.n; k++) maxY = Math.max(maxY, P.pos[k * 3 + 1]);
  assert.ok(maxY > 0.4 && maxY <= 0.51, "suben a 1 m/s: " + maxY);
  P.step({ ...base, rate: 0, burst: 1 }, 1 / 60);
  assert.ok(P.n >= 99, "💥 explosión de 50: " + P.n);
  P.step({ ...base, rate: 0, burst: 1, trig: 1 }, 1 / 60);
  assert.ok(P.n >= 148, "el golpe (trig > 0,5) explota una vez: " + P.n);
  const n0 = P.n; P.step({ ...base, rate: 0, burst: 1, trig: 1 }, 1 / 60);
  assert.ok(P.n <= n0, "mientras sigue arriba no vuelve a explotar");
  for (let k = 0; k < 80; k++) P.step({ ...base, rate: 0, burst: 1 }, 1 / 60);
  assert.equal(P.n, 0, "a los 1,3 s ya no queda ninguna (vida 1 s)");
  // Gravedad y suelo con rebote.
  const Q = new Particles(10);
  Q.step({ ...base, rate: 0, burstCount: 5, burst: 0, gravity: -9.8, speed: 0, life: 5, floor: 1, floorY: -1, bounce: 0.5 }, 1 / 60);
  Q.step({ ...base, rate: 0, burstCount: 5, burst: 1, gravity: -9.8, speed: 0, life: 5, floor: 1, floorY: -1, bounce: 0.5 }, 1 / 60);
  for (let k = 0; k < 120; k++) Q.step({ ...base, rate: 0, burstCount: 5, burst: 1, gravity: -9.8, speed: 0, life: 5, floor: 1, floorY: -1, bounce: 0.5 }, 1 / 60);
  for (let k = 0; k < Q.n; k++) assert.ok(Q.pos[k * 3 + 1] >= -1 - 1e-6, "no atraviesan el suelo");
  assert.equal(Q.n, 5, "el máximo es 10 y salieron 5");
  // Color y tamaño cambian con la edad; desde la geometría conectada nacen en sus vértices.
  const C = new Particles(100);
  C.step({ ...base, rate: 0, burstCount: 20, burst: 0, emitter: 4, speed: 0 }, 0.01, new Float32Array([5, 5, 5]), [1, 0, 0], [0, 0, 1]);
  C.step({ ...base, rate: 0, burstCount: 20, burst: 1, emitter: 4, speed: 0 }, 0.01, new Float32Array([5, 5, 5]), [1, 0, 0], [0, 0, 1]);
  assert.equal(C.n, 20);
  assert.ok(C.pos[0] === 5 && C.pos[1] === 5 && C.pos[2] === 5, "en el vértice de la entrada");
  for (let k = 0; k < 50; k++) C.step({ ...base, rate: 0, burstCount: 20, burst: 1, emitter: 4, speed: 0, psize: 1, sizeEnd: 0 }, 0.01, new Float32Array([5, 5, 5]), [1, 0, 0], [0, 0, 1]);
  assert.ok(C.col[0] < 0.6 && C.col[2] > 0.4 && C.size[0] < 0.6, "a media vida: entre rojo y azul, más pequeña");
  assert.ok(opDef("COMP", "particles") && acceptsInput("COMP", "particles", "SOP") && opDef("SOP", "file"), "Partículas y Modelo 3D en el catálogo");
});
await test("fotogramas clave: suave, recta, escalón, curva continua, acelerar/frenar; poner claves; tiempo con vueltas; Animation CHOP con la línea de tiempo de la red", () => {
  const ch = { name: "x", keys: [] };
  setKey(ch, 2, 10, "linear"); setKey(ch, 0, 0, "linear"); setKey(ch, 4, 0);
  assert.deepEqual(ch.keys.map(k => k.t), [0, 2, 4], "ordenadas");
  assert.equal(evalChan(ch, 1), 5, "recta a la mitad");
  assert.equal(evalChan(ch, -1), 0); assert.equal(evalChan(ch, 9), 0, "fuera: el valor del extremo");
  ch.keys[1].e = "smooth"; assert.equal(evalChan(ch, 3), 5, "suave: a la mitad también la mitad");
  assert.ok(evalChan(ch, 2.5) > 7.5, "suave: sale despacio");
  ch.keys[1].e = "step"; assert.equal(evalChan(ch, 3.9), 10, "escalón");
  ch.keys[1].e = "in"; assert.equal(evalChan(ch, 3), 7.5, "acelerar");
  ch.keys[1].e = "out"; assert.equal(evalChan(ch, 3), 2.5, "frenar");
  ch.keys[0].e = "spline"; const sp = evalChan(ch, 1); assert.ok(sp > 5, "curva continua: pasa más alta que la recta " + sp);
  setKey(ch, 2, 3); assert.equal(ch.keys.length, 3, "misma clave: cambia el valor"); assert.equal(ch.keys[1].v, 3);
  assert.equal(animTime({ length: 4 }, 9), 1); assert.equal(animTime({ length: 4 }, -1), 3); assert.equal(animTime({ length: 4 }, 9, false), 4);
  assert.deepEqual(normalizeAnim({ length: -2, chans: [{ name: "a b", keys: [{ t: 2, v: 1 }, { t: "x", v: 2 }, { t: 0, v: 5, e: "raro" }] }, null] }), { length: 0.05, chans: [{ name: "a_b", keys: [{ t: 0, v: 5, e: "smooth" }, { t: 2, v: 1, e: "smooth" }] }] });
  assert.deepEqual(valueRange([]), [0, 1]);
  // Línea de tiempo de la red: con el reloj de la pared, pausa, buscar, velocidad, vueltas.
  const net = newNetwork("t"); net.timeline.t0 = 100; net.timeline.length = 10;
  assert.equal(netTime(net, 103), 3);
  assert.equal(netTime(net, 113), 3, "da la vuelta a los 10 s");
  pauseNet(net, 104); assert.equal(netTime(net, 200), 4, "en pausa se queda");
  seekNet(net, 7, 200); assert.equal(netTime(net, 300), 7);
  playNet(net, 300); assert.equal(netTime(net, 301), 8);
  setNetRate(net, 2, 301); assert.equal(netTime(net, 302), 0, "a doble velocidad: 8 + 2 = 10 → 0");
  net.timeline.loop = 0; seekNet(net, 9, 400); assert.equal(netTime(net, 410), 10, "sin repetir: se para al final");
  // Animation CHOP: sigue la línea de tiempo de la red.
  const a = addNode(net, "CHOP", "animation", { p: { anim: { length: 4, chans: [{ name: "u", keys: [{ t: 0, v: 0, e: "linear" }, { t: 4, v: 8, e: "linear" }] }] } } });
  const b = addNode(net, "CHOP", "animation");
  assert.notEqual(a.p.anim, b.p.anim, "cada nodo con sus propias curvas");
  assert.notEqual(b.p.anim, opDef("CHOP", "animation").params[0].def, "no comparte el valor por defecto");
  const ck = new Cooker();
  ck.begin(net, { t: 50, dt: 1 / 60, frame: 1, local: 1 });
  assert.equal(ck.chop(a).data.u[0], 2);
  ck.begin(net, { t: 50, dt: 1 / 60, frame: 2, local: 6 });
  assert.equal(ck.chop(a).data.u[0], 4, "con vueltas: 6 s → 2 s de 4");
  const lv = addNode(net, "TOP", "level", { p: { brightness: { e: "animation1.u + me.time.seconds" } } });
  assert.equal(ck.param(lv, "brightness"), 10, "me.time.seconds es el tiempo de la red");
});
await test("subredes (Base COMP): agrupar con entradas y salida, las señales pasan por dentro, copiar/pegar con lo de dentro, borrar y deshacer la subred", () => {
  const net = newNetwork("s");
  const lfo = addNode(net, "CHOP", "lfo", { p: { rate: 0, offset: 0.25, amp: 0 } });
  const m = addNode(net, "CHOP", "math", { p: { mult: 2 } });
  const nl = addNode(net, "CHOP", "null");
  connect(net, lfo.id, m.id, 0); connect(net, m.id, nl.id, 0);
  const r = groupIntoBase(net, [m.id]);
  assert.ok(r.base, r.error);
  const b = r.base;
  assert.equal(m.parent, b.id);
  const kids = childrenOf(net, b.id).map(n => n.type).sort();
  assert.deepEqual(kids, ["in", "math", "out"], "una entrada, el nodo y una salida");
  assert.equal(b.in[0], lfo.id, "lo de fuera entra por la subred");
  assert.equal(nl.in[0], b.id, "lo que salía ahora sale de la subred");
  assert.equal(outFam(net, b), "CHOP");
  assert.equal(resolveOut(net, b, "CHOP").type, "out");
  const ck = new Cooker(); ck.begin(net, { t: 1, dt: 1 / 60, frame: 1 });
  assert.equal(ck.chop(nl).data.chan1[0], 0.5, "0,25 × 2 atravesando la subred");
  assert.equal(ck.chopByName(b.name).data.chan1[0], 0.5, "la subred por nombre da su salida");
  // Dos salidas distintas no se pueden agrupar.
  const x = addNode(net, "CHOP", "constant"), y = addNode(net, "CHOP", "null"), z = addNode(net, "CHOP", "null"), w = addNode(net, "CHOP", "math");
  connect(net, x.id, y.id, 0); connect(net, x.id, z.id, 0); connect(net, y.id, w.id, 0); connect(net, z.id, w.id, 1);
  assert.match(groupIntoBase(net, [y.id, z.id]).error, /solo puede salir una/);
  removeNodes(net, [x.id, y.id, z.id, w.id]);
  // Copiar y pegar la subred: lo de dentro también, dentro de la copia.
  const clip = copyNodes(net, [b.id]);
  assert.equal(clip.nodes.length, 4);
  const pasted = pasteNodes(net, clip, 40, 40);
  const nb = pasted.find(n => n.type === "base");
  assert.equal(childrenOf(net, nb.id).length, 3);
  assert.equal(subOut(net, nb).parent, nb.id);
  // Borrar la subred borra lo de dentro.
  const n0 = net.nodes.length; removeNodes(net, [nb.id]); assert.equal(net.nodes.length, n0 - 4);
  // Deshacer la subred: los cables vuelven a ir directos.
  assert.ok(ungroupBase(net, b.id));
  assert.equal(m.parent, ""); assert.equal(m.in[0], lfo.id); assert.equal(nl.in[0], m.id);
  assert.ok(!net.nodes.some(n => n.type === "base" || n.type === "in" || n.type === "out"), "sin restos");
});
await test("replicador: N copias del maestro con me.digits, siguen sus cambios, menos copias borra las que sobran; controles de panel como canales", () => {
  const net = newNetwork("r");
  const master = addNode(net, "CHOP", "constant", { name: "boton", p: { value0: { e: "me.digits * 10" } } });
  const rep = addNode(net, "COMP", "replicator", { p: { master: "boton", count: 3, prefix: "copia" } });
  assert.ok(syncReplicators(net));
  const reps = () => net.nodes.filter(n => n.repOf === rep.id).map(n => n.name);
  assert.deepEqual(reps(), ["copia1", "copia2", "copia3"]);
  const ck = new Cooker(); ck.begin(net, { t: 1, dt: 1 / 60, frame: 1 });
  assert.equal(ck.chopByName("copia2").data.chan1[0], 20, "me.digits es el número de la copia");
  master.p.name0 = "nivel";
  assert.ok(syncReplicators(net));
  assert.equal(net.nodes.find(n => n.name === "copia1").p.name0, "nivel", "siguen al maestro");
  assert.equal(syncReplicators(net), false, "si nada cambia, no toca nada");
  rep.p.count = 1; syncReplicators(net);
  assert.deepEqual(reps(), ["copia1"]);
  removeNodes(net, [rep.id]);
  assert.deepEqual(net.nodes.map(n => n.name), ["boton"], "borrar el replicador borra sus copias");
  // Controles de panel: canales que se leen desde expresiones.
  const sl = addNode(net, "COMP", "slider", { p: { value: 0.25, min: 0, max: 8 } });
  const xy = addNode(net, "COMP", "xy", { p: { x: 0.1, y: 0.9 } });
  const lv = addNode(net, "TOP", "level", { p: { brightness: { e: `${sl.name}.value + ${xy.name}.y` } } });
  const c2 = new Cooker(); c2.begin(net, { t: 1, dt: 1 / 60, frame: 1 });
  assert.equal(c2.param(lv, "brightness"), 2.9);
});
report();
