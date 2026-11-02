// tests/gen3d.test.js — objetos 3D a partir de una frase («hazme un carro»).
import { test, report } from "./harness.js";
import assert from "node:assert/strict";
const G = await import("../web/js/gen3d.js");
const M = await import("../web/js/model.js");
const H = await import("../web/js/hologram.js");

console.log("== Objetos 3D ==");

await test("frases → objeto, estilo y colores («un carro rojo deportivo», «camioneta negra», «casa»)", () => {
  let r = G.parseRequest("hazme un carro rojo deportivo");
  assert.deepEqual([r.id, r.style, r.color], ["carro", "deportivo", "#e3122b"]);
  r = G.parseRequest("quiero una camioneta negra");
  assert.deepEqual([r.id, r.style, r.color], ["carro", "camioneta", "#15171c"]);
  assert.equal(G.parseRequest("una casa").id, "casa");
  assert.equal(G.parseRequest("un pino de navidad").style, "pino");
  assert.equal(G.parseRequest("un árbol frondoso").style, "frondoso");
  assert.equal(G.parseRequest("texto 3D «BODA»").text, "BODA");
  assert.equal(G.parseRequest("un dragón"), null, "fuera de la biblioteca → la IA");
});

await test("toda la biblioteca da recetas válidas (formas y materiales permitidos, números sanos)", () => {
  for (const o of G.OBJECTS3D) for (const [st] of o.styles) {
    const r = G.libraryRecipe(o.id, { style: st });
    assert.ok(r.parts.length >= 1, o.id);
    for (const q of r.parts) {
      assert.ok(G.SHAPES3D.includes(q.s), `${o.id}: ${q.s}`);
      assert.ok(G.MATERIALS3D.includes(q.m), `${o.id}: ${q.m}`);
      for (const v of [...q.p, ...q.r, ...q.d]) assert.ok(Number.isFinite(v), o.id);
      assert.match(q.c, /^#[0-9a-f]{6}$/i);
    }
    // Ya validada, sigue igual (lo que sale de la biblioteca pasa el mismo filtro que la IA).
    assert.equal(G.validateRecipe(r).parts.length, r.parts.length);
  }
  const car = G.libraryRecipe("carro", { style: "deportivo" });
  assert.ok(car.parts.filter(q => q.s === "cylinder" && q.m === "rubber").length === 4, "4 ruedas");
  assert.ok(car.parts.some(q => q.m === "light"), "faros que brillan");
});

await test("receta de la IA: solo formas permitidas, números acotados, máximo 80 piezas; nunca código", () => {
  const r = G.validateRecipe({ name: "Dragón", parts: [
    { s: "sphere", p: [0, 1, 0], d: [1, 1, 1], c: "#00ff00", m: "paint" },
    { shape: "box", position: [999, 0, 0], size: [-5, 1, 1], color: "rojo", material: "plutonio" },
    { s: "eval", t: "alert(1)" }, { s: "script" }, null,
    ...Array.from({ length: 100 }, () => ({ s: "box" })),
  ] });
  assert.equal(r.parts.length, 80, "80 como máximo (las no permitidas se descartan)");
  // Números acotados (999 → 20, tamaño negativo → 0,01) y después centrado y escalado: todo cerca del origen.
  assert.ok(r.parts.every(q => [...q.p, ...q.d].every(Number.isFinite) && q.p.every(v => Math.abs(v) <= 6)), "todo dentro de la escena");
  assert.equal(r.parts[1].c, "#8a93a6"); assert.equal(r.parts[1].m, "paint");
  assert.ok(!JSON.stringify(r).includes("alert"));
  assert.throws(() => G.validateRecipe({ parts: [{ s: "eval" }] }), /no devolvió piezas/);
  assert.match(G.aiPrompt("un dragón").user, /SOLO|JSON/);
});

await test("lo que diseña la IA queda bien colocado: centrado, apoyado en el suelo, a buen tamaño y sin piezas diminutas", () => {
  const r = G.validateRecipe({ name: "Mini", parts: [
    { s: "box", p: [10, 5, 3], d: [0.2, 0.2, 0.2], c: "#ff0000", m: "paint" },
    { s: "sphere", p: [10.5, 5.3, 3], d: [0.3, 0.3, 0.3], c: "#00ff00", m: "paint" },
    { s: "box", p: [0, 0, 0], d: [0.001, 0.001, 0.001], c: "#000000", m: "paint" },
  ] });
  assert.equal(r.parts.length, 2, "fuera la pieza diminuta");
  const minY = Math.min(...r.parts.map(q => q.p[1] - q.d[1] / 2));
  assert.ok(Math.abs(minY) < 0.01, "apoyado en y = 0: " + minY);
  const xs = r.parts.flatMap(q => [q.p[0] - q.d[0] / 2, q.p[0] + q.d[0] / 2]);
  assert.ok(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2) < 0.05, "centrado");
  const size = Math.max(...xs) - Math.min(...xs);
  assert.ok(size > 1.5 && size < 5, "tamaño cómodo: " + size);
  // Uno enorme se reduce.
  const big = G.validateRecipe({ parts: [{ s: "box", p: [0, 9, 0], d: [18, 18, 18], c: "#fff", m: "paint" }] });
  assert.ok(Math.max(...big.parts[0].d) <= 4, "reducido");
  // La IA recibe un formato estricto (más rápido y sin errores) y un límite de texto.
  const q = G.aiPrompt("un dragón");
  assert.deepEqual(q.schema.properties.parts.items.properties.s.enum.includes("eval"), false);
  assert.ok(q.maxTokens > 0 && q.maxTokens <= 4000);
});
await test("biblioteca ampliada: moto, barco, flor, seta, globo, faro, castillo, taza, cactus y nube al instante (sin IA)", () => {
  for (const [t, id] of [["hazme una moto roja", "moto"], ["un velero", "barco"], ["una flor rosa", "flor"], ["un hongo", "seta"], ["globo aerostático", "globo"],
    ["un faro", "faro"], ["castillo azul", "castillo"], ["una taza de café", "taza"], ["un cactus", "cactus"], ["una nube", "nube"]]) assert.equal(G.parseRequest(t)?.id, id, t);
  assert.equal(G.parseRequest("hazme un dragón, te lo pido"), null, "«te» no es una taza");
  assert.equal(G.parseRequest("un carro rosa")?.id, "carro");
});
await test("holograma con un objeto 3D: en la pirámide cada cara lo ve desde su lado", () => {
  const project = M.createProject(), app = { S: { project } };
  const model = G.libraryRecipe("carro", {});
  let r = H.buildHologram(app, { type: "piramide", n: 1, source: "model", model });
  const looks = r.surfaces.map(s => project.scenes[0].looks[s.id].source);
  assert.deepEqual(looks.map(l => l.type), ["model3d", "model3d", "model3d", "model3d"]);
  assert.deepEqual(looks.map(l => l.yaw), [0, 90, 180, 270]);
  r = H.buildHologram(app, { type: "escenario", n: 2, source: "model", model });
  assert.equal(project.scenes[0].looks[r.surfaces[0].id].source.model.parts.length, model.parts.length);
});

report();
