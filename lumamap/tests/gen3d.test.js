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
  assert.equal(r.parts[1].p[0], 20); assert.equal(r.parts[1].d[0], 0.01);
  assert.equal(r.parts[1].c, "#8a93a6"); assert.equal(r.parts[1].m, "paint");
  assert.ok(!JSON.stringify(r).includes("alert"));
  assert.throws(() => G.validateRecipe({ parts: [{ s: "eval" }] }), /no devolvió piezas/);
  assert.match(G.aiPrompt("un dragón").user, /SOLO|JSON/);
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
