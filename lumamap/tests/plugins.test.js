// tests/plugins.test.js — plugins: solo datos validados, shaders ISF compatibles (y los que no,
// avisados como EN DESARROLLO), y que entran y salen de las bibliotecas al encender/apagar.
import assert from "node:assert/strict";
import { test, report } from "./harness.js";
import { parseISF, evalSize } from "../web/js/isf.js";
import { validatePlugin, pluginFromFile, cleanFx, loadPlugins, installPlugin, setPluginEnabled, removePlugin, listPlugins, getShader, CAM_FX, CAM_CAT, camFxFor } from "../web/js/plugins.js";
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
await test("ISF con cámara, sonido y varias pasadas con memoria (feedback); lo que aún no, lo dice claro", () => {
  const f = parseISF(`/*{ "INPUTS": [ { "NAME": "inputImage", "TYPE": "image" }, { "NAME": "fft", "TYPE": "audioFFT" }, { "NAME": "w", "TYPE": "audio" } ],
    "PASSES": [ { "TARGET": "buf", "PERSISTENT": true, "WIDTH": "$WIDTH/2", "HEIGHT": "floor($HEIGHT*0.5)" }, {} ] }*/
    void main(){ gl_FragColor = IMG_NORM_PIXEL(inputImage, isf_FragNormCoord) + IMG_PIXEL(buf, gl_FragCoord.xy) * IMG_SIZE(fft).x; }`);
  assert.deepEqual(f.inputs.map(i => i.type), ["image", "audioFFT", "audio"]);
  assert.deepEqual(f.passes.map(p => [p.target, p.persistent]), [["buf", true], ["", false]]);
  assert.ok(f.usesCamera && f.usesAudio);
  assert.throws(() => parseISF(`/*{ "IMPORTED": { "logo": { "PATH": "logo.png" } } }*/ void main(){}`), /EN DESARROLLO/);
  assert.throws(() => parseISF(`/*{ "INPUTS": [ { "NAME": "x", "TYPE": "cubemap" } ] }*/ void main(){}`), /no compatible/);
  assert.throws(() => parseISF(`void main(){ gl_FragColor = vec4(1.0); }`), /cabecera JSON/);
});
await test("tamaños de pasada con expresiones ($WIDTH/2, floor…) sin ejecutar código", () => {
  assert.equal(evalSize("$WIDTH/2", 1920, 1080), 960);
  assert.equal(evalSize("floor($HEIGHT*0.33)", 1920, 1080), 356);
  assert.equal(evalSize("max($WIDTH,$HEIGHT)/4", 1920, 1080), 480);
  assert.equal(evalSize(64, 1, 1), 64);
  assert.equal(evalSize("alert(1)", 1, 1), null);
  assert.equal(evalSize("$WIDTH;x", 10, 10), null);
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
    if (b.id === "camara-reactiva") assert.ok((b.shaders || []).every(s => { const i = parseISF(s.isf); return i.usesCamera && i.usesAudio; }));
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
await test("efectos de cámara: solo en «Efectos de cámara» (no en animaciones) y como filtro de fotos/videos solo si sirven", () => {
  loadPlugins();
  // Ningún shader que necesita cámara/video está entre las animaciones; todos están en su sitio.
  assert.deepEqual(ANIM_LIBRARY.filter(a => a.shader && getShader(a.shader)?.isf.usesCamera).map(a => a.name), []);
  assert.ok(CAM_FX.length >= 34, String(CAM_FX.length));
  assert.ok(CAM_FX.every(a => a.cat === CAM_CAT && getShader(a.shader)?.isf.usesCamera));
  assert.ok(!ANIM_CATEGORIES.includes("🧩 Pro 50: cámara artística") && !ANIM_CATEGORIES.includes("🧩 Cámara reactiva al audio"), "sin categorías de cámara en animaciones");
  const names = (k) => camFxFor(k).map(a => a.name);
  assert.equal(camFxFor("camera").length, CAM_FX.length, "con la cámara, todos");
  for (const n of ["Explosión de cámara", "Time Warp Scan", "Ecos de colores", "HUD de glifos"]) { assert.ok(names("camera").includes(n)); assert.ok(!names("video").includes(n) && !names("image").includes(n), n + " es solo de cámara"); }
  assert.ok(names("video").includes("Datamosh") && !names("image").includes("Datamosh"), "datamosh necesita movimiento");
  for (const n of ["Cámara térmica", "Pintura al óleo", "VHS", "Pop art", "Nube de puntos 3D"]) assert.ok(names("image").includes(n) && names("video").includes(n), n + " sirve de filtro");
  // Un shader de terceros con imagen de entrada va a cámara y sirve de filtro (por defecto «both»); "use" raro → both.
  const p = validatePlugin({ "lumamap-plugin": 1, id: "f", shaders: [{ name: "x", use: "rara", isf: `/*{ "INPUTS": [ { "NAME": "inputImage", "TYPE": "image" } ] }*/ void main(){ gl_FragColor = IMG_NORM_PIXEL(inputImage, isf_FragNormCoord); }` }] });
  assert.equal(p.shaders[0].use, "both");
});
await test("un .json que no es plugin o un texto cualquiera se rechaza con un mensaje claro", () => {
  assert.throws(() => pluginFromFile("hola", "x.json"), /ni un shader ISF/);
  assert.throws(() => pluginFromFile('{"a":1}', "x.json"), /No es un plugin/);
});
report();
