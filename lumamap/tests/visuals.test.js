// tests/visuals.test.js — «Mis visuales» (presets): guardar, poner, carpetas, importar y exportar.
import assert from "node:assert/strict";
import { test, report } from "./harness.js";
import * as V from "../web/js/visuals.js";

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { if (v.length > 200000) throw new Error("quota"); m.set(k, v); } }; };
const look = { source: { type: "gen", gen: "plasma" }, fx: { brightness: 1.4, kaleido: 6 }, opacity: 0.8, blend: "add", hidden: true, next: { source: { type: "color" } } };
const lfos = [{ id: "l1", param: "surf/s1/fx/zoom", shape: "track:k1", lo: 0, hi: 1 }, { id: "l2", param: "surf/s2/opacity", shape: "sine" }, { id: "l3", param: "global/master", shape: "bass" }];

console.log("== Mis visuales ==");
await test("guardar: el look de la superficie y solo SUS señales, sin su id (valen en cualquier superficie)", () => {
  const v = V.makeVisual({ look, surfId: "s1", lfos, name: "Drop <b>neón</b>", folder: "Techno" });
  assert.equal(v.name, "Drop bneón/b"); assert.equal(v.folder, "Techno");
  assert.deepEqual(v.look.fx, look.fx); assert.equal(v.look.hidden, undefined, "no guarda si estaba oculta");
  assert.deepEqual(v.lfos.map(l => l.param), ["surf/@/fx/zoom"]);
});
await test("poner en otra superficie: el look nuevo, sin «siguiente», y sus señales en esa superficie", () => {
  const v = V.makeVisual({ look, surfId: "s1", lfos, name: "x" });
  const plan = V.applyPlan(v, "s9", { source: { type: "color" }, fit: "cover", hidden: false, next: { source: {} } }, () => "nuevo");
  assert.equal(plan.look.source.gen, "plasma"); assert.equal(plan.look.fit, "cover", "lo que no guarda se conserva"); assert.equal(plan.look.next, null);
  assert.deepEqual(plan.lfos.map(l => [l.id, l.param, l.shape]), [["nuevo", "surf/s9/fx/zoom", "track:k1"]]);
  plan.look.fx.brightness = 0; assert.equal(v.look.fx.brightness, 1.4, "copia, no referencia");
});
await test("guardar y leer en el equipo; si no cabe, lo dice claro", () => {
  const st = mem(), a = V.makeVisual({ look, surfId: "s1", name: "a", folder: "B" }), b = V.makeVisual({ look, surfId: "s1", name: "b", folder: "A" });
  V.saveVisuals([a, b], st);
  assert.deepEqual(V.loadVisuals(st).map(v => v.name), ["a", "b"]);
  assert.deepEqual(V.folders(V.loadVisuals(st)), ["A", "B"]);
  assert.throws(() => V.saveVisuals([{ ...a, look: { source: {}, big: "x".repeat(300000) } }], st), /No cabe/);
  assert.deepEqual(V.loadVisuals({ getItem: () => "{roto" }), []);
});
await test("exportar e importar: ida y vuelta, ids que chocan se renuevan, y archivos que no son visuales se rechazan", () => {
  const a = V.makeVisual({ look, surfId: "s1", name: "a", thumb: "data:image/jpeg;base64,AAAA" });
  const back = V.importVisuals(V.exportVisuals([a]), []);
  assert.equal(back[0].id, a.id); assert.equal(back[0].thumb, a.thumb);
  assert.notEqual(V.importVisuals(V.exportVisuals([a]), [a])[0].id, a.id);
  assert.throws(() => V.importVisuals("no json"), /JSON/);
  assert.throws(() => V.importVisuals('{"format":"otra"}'), /visuales/);
  assert.equal(V.normalizeVisual({ ...a, thumb: "javascript:alert(1)" }).thumb, "", "miniatura rara fuera");
  assert.equal(V.normalizeVisual({ name: "sin look" }), null);
});
await test("siguiente / anterior dentro de una carpeta, dando la vuelta", () => {
  const L = ["a", "b", "c"].map((n, k) => ({ ...V.makeVisual({ look, surfId: "s", name: n, folder: k < 2 ? "X" : "Y" }), id: n }));
  assert.equal(V.stepVisual(L, "a", 1, "X").id, "b"); assert.equal(V.stepVisual(L, "b", 1, "X").id, "a");
  assert.equal(V.stepVisual(L, "a", -1).id, "c"); assert.equal(V.stepVisual(L, null, 1).id, "a"); assert.equal(V.stepVisual([], null, 1), null);
});
report();
