// tests/plugins.test.js — plugins: solo datos validados, shaders ISF compatibles (y los que no,
// avisados como EN DESARROLLO), y que entran y salen de las bibliotecas al encender/apagar.
import assert from "node:assert/strict";
import { test, report } from "./harness.js";
import { parseISF } from "../web/js/isf.js";
import { validatePlugin, pluginFromFile, cleanFx, loadPlugins, installPlugin, setPluginEnabled, removePlugin, listPlugins, getShader } from "../web/js/plugins.js";
import { BUNDLED } from "../web/js/plugins-bundled.js";
import { FX_LIBRARY, FX_PRESETS, ANIM_LIBRARY, ANIM_CATEGORIES, GENERATORS } from "../web/js/model.js";

console.log("== Plugins ==");
const SIMPLE = `/*{ "DESCRIPTION": "Prueba", "CREDIT": "Ana", "INPUTS": [
  { "NAME": "amount", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 2, "LABEL": "Cantidad" },
  { "NAME": "on", "TYPE": "bool", "DEFAULT": true },
  { "NAME": "tint", "TYPE": "color", "DEFAULT": [1, 0, 0.5, 1] },
  { "NAME": "where", "TYPE": "point2D", "DEFAULT": [0.2, 0.8] },
  { "NAME": "mode", "TYPE": "long", "VALUES": [0, 1, 2], "LABELS": ["A", "B", "C"], "DEFAULT": 1 } ] }*/
void main(){ gl_FragColor = vec4(isf_FragNormCoord * amount, 0.5, 1.0); }`;

await test("lee un shader ISF con sus controles (número, interruptor, color, punto y lista)", () => {
  const s = parseISF(SIMPLE);
  assert.equal(s.description, "Prueba"); assert.equal(s.credit, "Ana");
  assert.deepEqual(s.inputs.map(i => [i.name, i.type, JSON.stringify(i.def)]), [["amount", "float", "0.3"], ["on", "bool", "true"], ["tint", "color", "[1,0,0.5,1]"], ["where", "point2D", "[0.2,0.8]"], ["mode", "long", "1"]]);
  assert.deepEqual(s.inputs[4].labels, ["A", "B", "C"]);
  assert.match(s.body, /void main/);
});
await test("ISF que aún no se puede usar lo dice claro (EN DESARROLLO), sin fingir", () => {
  assert.throws(() => parseISF(`/*{ "INPUTS": [ { "NAME": "inputImage", "TYPE": "image" } ] }*/ void main(){}`), /EN DESARROLLO/);
  assert.throws(() => parseISF(`/*{ "PASSES": [ { "TARGET": "buf", "PERSISTENT": true }, {} ] }*/ void main(){}`), /EN DESARROLLO/);
  assert.throws(() => parseISF(`/*{ "INPUTS": [ { "NAME": "fft", "TYPE": "audioFFT" } ] }*/ void main(){}`), /EN DESARROLLO/);
  assert.throws(() => parseISF(`void main(){ gl_FragColor = vec4(1.0); }`), /cabecera JSON/);
});
await test("un plugin solo trae datos: se quitan ajustes que no existen, colores raros y animaciones inventadas", () => {
  const p = validatePlugin({ "lumamap-plugin": 1, id: "Mi Pack!", name: "Mi pack <b>",
    effects: [{ name: "Bueno", fx: { saturation: 1.5, evil: "alert(1)", duoA: "javascript:x", duoB: "#ff00aa", invert: 1, contrast: 9999 } }, { name: "Vacío", fx: { nada: 1 } }],
    animations: [{ name: "Real", gen: "fire", color: "#123456", color2: "url(x)" }, { name: "Inventada", gen: "no-existe" }],
    onLoad: "fetch('http://malo')" });
  assert.equal(p.id, "mi-pack-");
  assert.equal(p.name, "Mi pack b");
  assert.deepEqual(p.effects, [{ name: "Bueno", fx: { saturation: 1.5, duoB: "#ff00aa", invert: true, contrast: 100 } }]);
  assert.deepEqual(p.animations.map(a => [a.name, a.gen, a.color, a.color2]), [["Real", "fire", "#123456", "#ff00aa"]]);
  assert.ok(!("onLoad" in p));
  assert.deepEqual(cleanFx({ __proto__: { x: 1 }, hue: "0.5" }), { hue: 0.5 });
  assert.throws(() => validatePlugin({ id: "x" }), /No es un plugin/);
  assert.throws(() => validatePlugin({ "lumamap-plugin": 1, id: "x", effects: [{ name: "a", fx: { nada: 1 } }] }), /no añade nada/);
});
await test("los plugins incluidos son válidos y sus animaciones existen", () => {
  const ids = new Set(GENERATORS.map(g => g.id));
  for (const b of BUNDLED) {
    const p = validatePlugin(b);
    assert.equal(p.effects.length, (b.effects || []).length, b.id + " efectos");
    assert.equal(p.animations.length, (b.animations || []).length, b.id + " animaciones");
    for (const a of b.animations || []) assert.ok(ids.has(a.gen), a.gen);
    for (const s of b.shaders || []) assert.ok(parseISF(s.isf).inputs.length > 0, s.name);
  }
});
await test("instalar un shader .fs suelto, apagarlo y quitarlo: entra y sale de las bibliotecas", () => {
  loadPlugins();
  const nA = ANIM_LIBRARY.length, nF = FX_LIBRARY.length;
  assert.ok(ANIM_LIBRARY.some(a => a.shader === "isf-clasicos/0"), "shaders incluidos en el catálogo");
  assert.ok(FX_PRESETS["Neón rosa"], "efectos incluidos");
  const p = installPlugin(SIMPLE, "brillo.fs");
  assert.equal(p.shaders.length, 1);
  const item = ANIM_LIBRARY.find(a => a.plugin === p.id);
  assert.ok(item && getShader(item.shader)?.isf.inputs.length === 5);
  assert.ok(ANIM_CATEGORIES.includes("🧩 " + p.name));
  assert.equal(ANIM_LIBRARY.length, nA + 1);
  setPluginEnabled(p.id, false);
  assert.equal(ANIM_LIBRARY.length, nA); assert.equal(getShader(item.shader), null);
  setPluginEnabled(p.id, true);
  assert.equal(ANIM_LIBRARY.length, nA + 1);
  assert.ok(removePlugin(p.id));
  assert.equal(ANIM_LIBRARY.length, nA); assert.equal(FX_LIBRARY.length, nF);
  assert.ok(!ANIM_CATEGORIES.includes("🧩 " + p.name));
  // Los incluidos se apagan pero no se pueden quitar ni pisar.
  assert.equal(removePlugin("fiesta-neon"), false);
  setPluginEnabled("fiesta-neon", false);
  assert.ok(!FX_PRESETS["Neón rosa"]);
  setPluginEnabled("fiesta-neon", true);
  assert.ok(FX_PRESETS["Neón rosa"]);
  assert.throws(() => installPlugin(JSON.stringify(BUNDLED[0])), /ya viene incluido/);
  assert.ok(listPlugins().length >= 3);
});
await test("un .json que no es plugin o un texto cualquiera se rechaza con un mensaje claro", () => {
  assert.throws(() => pluginFromFile("hola", "x.json"), /ni un shader ISF/);
  assert.throws(() => pluginFromFile('{"a":1}', "x.json"), /No es un plugin/);
});
report();
