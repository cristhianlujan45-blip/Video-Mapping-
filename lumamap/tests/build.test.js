// tests/build.test.js — «✨ Escribe y se construye»: de una frase a una red de nodos que funciona.
import assert from "node:assert/strict";
import { test, report } from "./harness.js";
import * as B from "../web/js/td/build.js";
import { newNetwork, nodeById } from "../web/js/td/graph.js";
import { opDef } from "../web/js/td/ops.js";
import { compileExpr } from "../web/js/td/expr.js";
import { AIProvider } from "../web/js/ai/providers.js";

/** Comprueba que una red construida está bien: cables válidos, Salida conectada y a la vista, referencias y expresiones. */
function checkNet(net) {
  const names = new Set(net.nodes.map(n => n.name));
  assert.equal(names.size, net.nodes.length, "nombres únicos");
  for (const n of net.nodes) {
    const d = opDef(n.fam, n.type);
    assert.ok(d, n.type);
    n.in.forEach((id, k) => { if (id) { assert.ok(nodeById(net, id), `${n.name}: entrada ${k}`); assert.ok(k < d.inputs[1], `${n.name}: entrada ${k} existe`); } });
    for (const q of d.params) {
      const v = n.p[q.k];
      if (v && typeof v === "object" && "e" in v) assert.equal(compileExpr(v.e).error, "", `${n.name}.${q.k}: ${v.e}`);
      if (q.type === "op" && v) assert.ok(names.has(v), `${n.name}.${q.k} → ${v}`);
    }
  }
  const out = net.nodes.find(n => n.type === "out");
  assert.ok(out && out.in[0], "termina en una Salida conectada");
  assert.equal(net.display, out.id, "la Salida se ve de fondo");
  return out;
}

console.log("== Escribe y se construye ==");
await test("sin IA: cada frase de ejemplo da una red que funciona y termina en la Salida", () => {
  const phrases = ["Colores que bailan con la música en caleidoscopio", "Mi cámara con bordes de neón y estela", "Un cubo 3D que gira con ruido de colores al golpe",
    "Texto «HOLA» rojo que late al ritmo", "Partículas que explotan al golpe", "Rayas azules y amarillas con ondas en espejo", "algo bonito", "una esfera con mi cámara pegada que se mueve con la mano",
    "video en blanco y negro pixelado", "a kaleidoscope of my webcam with glow that moves with the music"];
  for (const q of phrases) {
    const { plan, warnings } = B.validatePlan(B.planFromText(q));
    assert.deepEqual(warnings, [], q);
    const net = newNetwork("t");
    B.applyPlan(net, plan);
    checkNet(net);
    assert.ok(plan.say.length > 5, "dice qué construyó");
  }
});
await test("sin IA: entiende lo que se pide (orden de los efectos, colores, texto, 3D, estela, música)", () => {
  const build = (q) => { const net = newNetwork("t"); B.applyPlan(net, B.validatePlan(B.planFromText(q)).plan); return net; };
  const chain = (net) => { const out = net.nodes.find(n => n.type === "out"), r = []; let n = nodeById(net, out.in[0]); while (n) { r.unshift(n.type); n = n.in[0] ? nodeById(net, n.in[0]) : null; } return r; };
  assert.deepEqual(chain(build("rayas con ondas y después espejo")), ["pattern", "wave", "mirror"]);
  assert.deepEqual(chain(build("rayas en espejo con ondas")), ["pattern", "mirror", "wave"]);
  const t = build("texto «FIESTA» amarillo que late").nodes.find(n => n.type === "text");
  assert.equal(t.p.text, "FIESTA"); assert.equal(t.p.color, "#ffd400"); assert.match(t.p.size.e, /beat1\.beat/);
  const c = build("un cubo que gira").nodes;
  for (const ty of ["box", "geo", "camera", "light", "render", "out"]) assert.ok(c.some(n => n.type === ty), ty);
  assert.ok(!c.some(n => n.type === "transform"), "en 3D gira el objeto, no la imagen");
  const fb = build("mi cámara con estela").nodes.find(n => n.type === "feedback");
  assert.equal(fb.p.target, build("mi cámara con estela").nodes.find(n => n.type === "composite").name);
  const k = build("colores en caleidoscopio con la música").nodes;
  assert.match(k.find(n => n.type === "kaleido").p.rot.e, /audio1\.bass/); assert.ok(k.some(n => n.type === "audio"));
  const l = build("ruido rojo y azul").nodes.find(n => n.type === "lookup");
  assert.deepEqual([l.p.map, l.p.color1, l.p.color2], [4, "#ff2a2a", "#2a6bff"]);
});
await test("un plan roto o con trampas de la IA llega limpio a la red", () => {
  const { plan, warnings } = B.validatePlan({ title: "<b>x</b>", nodes: [
    { id: "a", op: "TOP/noise", p: { period: 999, kind: "Celdas", mono: true, tx: "nope", inventado: 3 } },
    { id: "b", op: "TOP/explotar" },
    { id: "c", op: "kaleido", p: { segments: { e: "fetch('http://x')" }, zoom: { e: "constructor.constructor" }, rot: { e: "absTime.seconds * 10" } } },
    { id: "d", op: "TOP/circle", p: { color: "rojo", bg: "javascript:alert(1)" } },
    { id: "e", op: "TOP/add" }, { id: "f", op: "SOP/box" },
  ], wires: [{ from: "a", to: "c" }, { from: "c", to: "a" }, { from: "c", to: "e", input: 7 }, { from: "d", to: "e", input: 0 }, { from: "f", to: "c" }, { from: "zz", to: "c" }],
  moves: [{ node: "c", with: "telepatia" }, { node: "d", param: "radius", with: "beat", range: [0, 99] }] });
  const a = plan.nodes.find(n => n.id === "a"), c = plan.nodes.find(n => n.id === "c"), d = plan.nodes.find(n => n.id === "d");
  assert.equal(a.p.period, 20, "dentro del rango"); assert.equal(a.p.kind, 2, "menú por su nombre"); assert.equal(a.p.mono, 1);
  assert.ok(!("tx" in a.p) && !("inventado" in a.p));
  assert.ok(!plan.nodes.some(n => n.type === "explotar"));
  assert.ok(!("segments" in c.p), "expresión con funciones que no existen"); assert.ok(!("zoom" in c.p), "ni nombres raros"); assert.equal(c.p.rot.e, "absTime.seconds * 10");
  assert.equal(d.p.color, "#ff2a2a"); assert.ok(!("bg" in d.p));
  assert.equal(plan.title, "bx/b");
  assert.ok(!plan.wires.some(w => w.from === "c" && w.to === "a"), "sin bucles");
  assert.ok(!plan.wires.some(w => w.from === "f" && w.to === "c"), "una forma 3D no entra en una imagen");
  const toE = plan.wires.filter(w => w.to === "e").map(w => w.input).sort();
  assert.deepEqual(toE, [0, 1], "las dos entradas de la mezcla, sin repetir");
  assert.deepEqual(plan.moves, [{ node: "d", param: "radius", with: "beat", range: [0, 1] }]);
  assert.ok(warnings.length >= 6, warnings.join(" | "));
  const net = newNetwork("t"); B.applyPlan(net, plan); checkNet(net);
  // Demasiados nodos: se corta.
  const big = B.validatePlan({ nodes: Array.from({ length: 80 }, (_, k) => ({ id: "n" + k, op: "TOP/noise" })) });
  assert.ok(big.plan.nodes.length <= B.MAX_PLAN_NODES + 1);
});
await test("3D a medias de la IA: pone cámara, luz, render y Salida; una geo sin forma lleva una caja", () => {
  const { plan } = B.validatePlan({ nodes: [{ id: "g", op: "COMP/geo", p: { ry: { e: "absTime.seconds * 30" } } }] });
  const types = plan.nodes.map(n => n.type).sort();
  assert.deepEqual(types, ["box", "camera", "geo", "light", "out", "render"]);
  const net = newNetwork("t"); B.applyPlan(net, plan); checkNet(net);
});
await test("se construye debajo de lo que ya hay, sin pisarlo, y paso a paso (para verlo aparecer)", () => {
  const net = newNetwork("t");
  B.applyPlan(net, B.validatePlan(B.planFromText("rayas")).plan);
  const maxY = Math.max(...net.nodes.map(n => n.y)), before = net.nodes.length;
  const origin = B.freeOrigin(net);
  assert.ok(origin[1] > maxY);
  const { steps } = B.planSteps(net, B.validatePlan(B.planFromText("colores en caleidoscopio")).plan, { origin });
  assert.ok(steps.length >= 4 && steps.at(-1).kind === "done");
  steps[0].run();
  assert.equal(net.nodes.length, before + 1, "un paso, un nodo");
  for (const s of steps.slice(1)) s.run();
  assert.ok(net.nodes.slice(before).every(n => n.y >= origin[1]));
  assert.equal(new Set(net.nodes.map(n => n.name)).size, net.nodes.length, "sin nombres repetidos con lo que había");
});
await test("con IA: el plan del modelo se valida; si no sirve, se usa el planificador sin IA", async () => {
  class Fake extends AIProvider { constructor(r) { super({ app: {} }); this.r = r; } get label() { return "Prueba"; } async ask(o) { this.got = o; return this.r; } }
  const ok = new Fake({ title: "Túnel", say: "Un túnel", nodes: [{ id: "a", op: "TOP/circle" }, { id: "b", op: "TOP/polar" }, { id: "o", op: "TOP/out" }], wires: [{ from: "a", to: "b" }, { from: "b", to: "o" }] });
  const r = await ok.buildNetwork({ text: "un túnel", summary: "" });
  assert.equal(r.source, "Prueba"); assert.equal(r.plan.nodes.length, 3);
  assert.match(ok.got.user, /TOP\/kaleido/, "le da el catálogo"); assert.match(ok.got.system, /Salida/);
  await assert.rejects(new Fake({ nodes: [{ id: "x", op: "TOP/nada" }] }).buildNetwork({ text: "x" }), /red que se pueda usar/);
});
await test("el catálogo para la IA: todos los operadores útiles, en poco espacio", () => {
  const c = B.catalogText();
  for (const op of ["TOP/noise", "TOP/feedback", "CHOP/audio", "SOP/box", "COMP/geo", "MAT/pbr", "TOP/out"]) assert.ok(c.includes(op), op);
  assert.ok(!c.includes("TOP/script") && !c.includes("DAT/execute"), "sin código");
  assert.ok(c.length < 16000, "tamaño " + c.length);
});
report();
