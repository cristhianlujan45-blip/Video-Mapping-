// tests/resolume.test.js — lo que se añadió comparando con Resolume: animar parámetros al ritmo
// (LFO), transporte de video (reversa, ida y vuelta, una vez, entrada/salida, al tempo) y la
// mesa de clips (cuantizar al golpe, autopiloto, datos limpios).
import { test, report } from "./harness.js";
import assert from "node:assert/strict";
import { shapeAt, createLfoClock, normalizeLfos, newLfo, soundAt, isSoundShape } from "../web/js/lfo.js";
import { stepTransport, normalizePlay, isPlain } from "../web/js/transport.js";
import { normalizeDeck, quantizeAt, nextCol, cleanClip, usedCols } from "../web/js/deck.js";
import * as M from "../web/js/model.js";

console.log("== Como Resolume: LFO, transporte y mesa de clips ==");

await test("LFO: las formas van de 0 a 1 y repiten cada ciclo", () => {
  for (const s of ["sine", "triangle", "saw", "square", "random"]) {
    for (let k = 0; k <= 40; k++) { const v = shapeAt(s, k / 10); assert.ok(v >= 0 && v <= 1, `${s} ${v}`); }
    if (s !== "random") assert.ok(Math.abs(shapeAt(s, 0.3) - shapeAt(s, 2.3)) < 1e-9, s);
  }
  assert.equal(shapeAt("sine", 0), 0); assert.ok(Math.abs(shapeAt("sine", 0.5) - 1) < 1e-9);
  assert.equal(shapeAt("square", 0.2), 1); assert.equal(shapeAt("square", 0.7), 0);
});

await test("LFO: sigue el tempo sin saltar si el BPM cambia, y respeta el rango", () => {
  const c = createLfoClock(), l = { ...newLfo("global/master"), shape: "saw", beats: 4, lo: 0.2, hi: 0.6 };
  let got = null;
  c.tick(0, 120, [l], () => {});
  c.tick(1, 120, [l], (_, w) => { got = w; });       // 1 s a 120 BPM = 2 golpes = medio ciclo
  assert.equal(c.beat, 2); assert.ok(Math.abs(got - 0.4) < 1e-9, String(got));
  c.tick(2, 60, [l], (_, w) => { got = w; });        // a 60 BPM: 1 golpe más (no recalcula desde 0)
  assert.equal(c.beat, 3);
  l.on = false; got = null; c.tick(3, 60, [l], (_, w) => { got = w; });
  assert.equal(got, null, "en pausa no mueve");
});

await test("LFO: lo guardado se limpia (formas y números raros fuera)", () => {
  const n = normalizeLfos([{ param: "global/master", shape: "zigzag", beats: 9999, lo: -3, hi: 7 }, { shape: "sine" }, null]);
  assert.equal(n.length, 1);
  assert.deepEqual({ shape: n[0].shape, beats: n[0].beats, lo: n[0].lo, hi: n[0].hi, on: n[0].on }, { shape: "sine", beats: 64, lo: 0, hi: 1, on: true });
  const p = M.normalizeProject(JSON.parse(JSON.stringify({ ...M.createProject(), settings: { lfos: [{ param: "global/master" }] } })));
  assert.equal(p.settings.lfos.length, 1);
});

await test("señales (como los CHOP): golpe que se apaga, ruido sin saltos, azar en cada golpe", () => {
  assert.equal(shapeAt("hit", 0), 1);
  assert.ok(shapeAt("hit", 0.5) < 0.1 && shapeAt("hit", 0.5) > 0, "se apaga dentro del ciclo");
  for (let k = 0; k < 200; k++) { const a = shapeAt("noise", k / 50), b = shapeAt("noise", (k + 1) / 50); assert.ok(Math.abs(a - b) < 0.1, "el ruido suave no salta"); assert.ok(a >= 0 && a <= 1); }
  assert.equal(shapeAt("randbeat", 2.1), shapeAt("randbeat", 2.9), "mismo valor dentro de un ciclo");
  assert.notEqual(shapeAt("randbeat", 2.5), shapeAt("randbeat", 3.5), "otro valor en el siguiente");
});

await test("señales que siguen el sonido (graves, medios, agudos, volumen) con sensibilidad y suavizado", () => {
  assert.ok(isSoundShape("bass") && !isSoundShape("sine"));
  assert.equal(soundAt("bass", { bass: 0.3 }, 2), 0.6);
  assert.equal(soundAt("high", { high: 0.8 }, 2), 1, "nunca pasa de 1");
  const c = createLfoClock(), l = { ...newLfo("global/master"), shape: "bass", gain: 1 };
  let got = null;
  c.tick(0, 120, [l], () => {}, true, { bass: 0 });
  c.tick(0.016, 120, [l], (_, w) => { got = w; }, true, { bass: 0.9 });
  assert.ok(Math.abs(got - 0.9) < 1e-9, "sin suavizado llega al instante");
  const s = { ...newLfo("global/master"), shape: "bass", smooth: 1 }, c2 = createLfoClock();
  c2.tick(0, 120, [s], () => {}, true, { bass: 0 });
  c2.tick(0.016, 120, [s], (_, w) => { got = w; }, true, { bass: 1 });
  assert.ok(got > 0 && got < 0.1, "con suavizado sube poco a poco: " + got);
  for (let t = 0.032; t < 3; t += 0.016) c2.tick(t, 120, [s], (_, w) => { got = w; }, true, { bass: 1 });
  assert.ok(got > 0.95, "y termina llegando: " + got);
  assert.ok(c2.values.has(s.id), "el valor queda para el monitor de señales");
  const n = normalizeLfos([{ param: "global/master", shape: "high", smooth: 7, gain: 99 }])[0];
  assert.deepEqual([n.shape, n.smooth, n.gain], ["high", 1, 4]);
});

await test("transporte: bucle normal no hace nada; entrada/salida vuelve a la entrada", () => {
  assert.ok(isPlain(normalizePlay(null)));
  const p = normalizePlay({ mode: "loop", in: 0.2, out: 0.5 }), st = {};
  assert.ok(!isPlain(p));
  assert.deepEqual(stepTransport(st, p, 3, 10, 0.016), { native: true, rate: 1, seek: null });
  assert.equal(stepTransport(st, p, 5, 10, 0.016).seek, 2, "al llegar a la salida vuelve a la entrada");
  assert.equal(stepTransport(st, p, 0.5, 10, 0.016).seek, 2, "antes de la entrada salta a ella");
});

await test("transporte: reversa va hacia atrás a mano y da la vuelta; ida y vuelta cambia de sentido", () => {
  const rev = normalizePlay({ mode: "reverse" }), st = {};
  let r = stepTransport(st, rev, 5, 10, 0.5, 2);
  assert.equal(r.native, false); assert.equal(r.seek, 4);
  r = stepTransport(st, rev, 0.4, 10, 0.5, 2);
  assert.equal(r.seek, 10, "del principio salta al final");
  const pp = normalizePlay({ mode: "pingpong" }), s2 = {};
  assert.equal(stepTransport(s2, pp, 9.995, 10, 0.016).seek, 10); assert.equal(s2.dir, -1);
  r = stepTransport(s2, pp, 0.01, 10, 0.5);
  assert.equal(s2.dir, 1); assert.equal(r.native, true);
});

await test("transporte: una vez se para al final; al tempo ajusta la velocidad al BPM", () => {
  const once = normalizePlay({ mode: "once" });
  assert.equal(stepTransport({}, once, 9.999, 10, 0.016).pause, true);
  // 8 s de tramo que deben durar 4 golpes a 120 BPM (2 s) → velocidad 4×.
  const sync = normalizePlay({ mode: "loop", in: 0.1, out: 0.9, beats: 4 });
  assert.equal(stepTransport({}, sync, 3, 10, 0.016, 1, 120).rate, 4);
  assert.equal(normalizePlay({ beats: 7 }).beats, 0, "solo golpes válidos");
  assert.deepEqual(normalizePlay({ in: 0.8, out: 0.2 }), { mode: "loop", in: 0.2, out: 0.8, beats: 0 });
});

await test("mesa de clips: cuantizar al golpe y al compás", () => {
  assert.equal(quantizeAt(5.3, "off"), 5.3);
  assert.equal(quantizeAt(5.3, "beat"), 6);
  assert.equal(quantizeAt(5.3, "bar"), 8);
  assert.equal(quantizeAt(8, "bar"), 12, "justo en el compás: el siguiente");
});

await test("mesa de clips: autopiloto salta columnas vacías y al azar no repite", () => {
  const d = normalizeDeck({ cols: 6, cells: { a: [{ kind: "color", color: "#ff0000" }, null, null, { kind: "color", color: "#00ff00" }], b: [null, null, null, null, { kind: "color", color: "#0000ff" }] } });
  assert.deepEqual(usedCols(d, ["a", "b"]), [0, 3, 4]);
  assert.equal(nextCol(d, ["a", "b"], 0), 3);
  assert.equal(nextCol(d, ["a", "b"], 4), 0, "vuelve al principio");
  assert.equal(nextCol(d, ["a"], 3), 0, "solo filas que existen");
  d.random = true;
  for (let i = 0; i < 20; i++) assert.notEqual(nextCol(d, ["a", "b"], 3), 3);
  assert.equal(nextCol(normalizeDeck({}), ["a"], -1), -1);
});

await test("mesa de clips: lo guardado se limpia (clips inventados, columnas, colores)", () => {
  const d = normalizeDeck({ cols: 500, quantize: "bad", autopilot: 7, cells: { a: [{ kind: "exe", path: "C:/x" }, { kind: "color", color: "red" }, { kind: "anim", gen: "plasma", color: "#123456", evil: 1 }], b: [null] } });
  assert.equal(d.cols, 32); assert.equal(d.quantize, "off"); assert.equal(d.autopilot, 0);
  assert.equal(d.cells.a[0], null);
  assert.equal(d.cells.a[1].color, "#ffffff");
  assert.equal(d.cells.a[2].evil, undefined);
  assert.equal(d.cells.b, undefined, "filas vacías fuera");
  assert.equal(cleanClip({ kind: "media", mediaId: "m1", name: "x".repeat(500) }).name.length, 80);
  const p = M.normalizeProject(JSON.parse(JSON.stringify(M.createProject())));
  assert.equal(p.settings.deck.cols, 8);
  assert.deepEqual(M.createLook().play, { mode: "loop", in: 0, out: 1, beats: 0 });
});

report();
