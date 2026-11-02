// tests/analog.test.js — «📼 Analógico y película»: parámetros, presets y lo que no toca la GPU.
import assert from "node:assert/strict";
import { test, report } from "./harness.js";
import * as A from "../web/js/analog.js";
import { DEFAULT_FX, FX_LIBRARY } from "../web/js/model.js";
import { FX_RANGE } from "../web/js/params.js";

console.log("== Analógico y película ==");
await test("apagado por defecto: un look normal no pasa por la cadena (no cuesta nada)", () => {
  assert.equal(A.analogActive(DEFAULT_FX()), false);
  assert.equal(A.analogActive({ ...DEFAULT_FX(), film: 0.5 }), true);
  assert.equal(A.analogTemporal({ film: 1, grain: 1 }), false, "película no necesita fotogramas anteriores");
  assert.equal(A.analogTemporal({ slit: 0.3 }), true);
});
await test("cada parámetro tiene su nombre y rango (MIDI, Señales, OSC) y su valor por defecto es «apagado»", () => {
  const D = DEFAULT_FX();
  for (const k of A.ANALOG_KEYS) { assert.ok(FX_RANGE[k], "rango de " + k); assert.equal(D[k], 0, k); assert.equal(FX_RANGE[k][4], 0); }
  assert.ok(FX_RANGE.phosphorSize);
  assert.equal(D.filmStock, "natural"); assert.equal(D.phosphorType, "grille"); assert.equal(D.slitDir, "down");
});
await test("presets «Analógico y película»: solo usan efectos que existen y opciones válidas", () => {
  const list = FX_LIBRARY.filter(e => e.cat === "Analógico y película"), D = DEFAULT_FX();
  assert.ok(list.length >= 25, "presets: " + list.length);
  const opt = { filmStock: A.FILM_STOCKS, phosphorType: A.PHOSPHOR_TYPES, slitDir: A.SLIT_DIRS };
  for (const e of list) {
    assert.ok(A.analogActive(e.fx), e.name + " usa algo analógico");
    for (const [k, v] of Object.entries(e.fx)) {
      assert.ok(k in D, `${e.name}: ${k}`);
      if (opt[k]) assert.ok(opt[k].some(([id]) => id === v), `${e.name}: ${k}=${v}`);
      else if (FX_RANGE[k] && typeof v === "number") assert.ok(v >= FX_RANGE[k][1] && v <= FX_RANGE[k][2], `${e.name}: ${k}=${v} fuera de rango`);
    }
  }
  assert.equal(new Set(list.map(e => e.name)).size, list.length, "nombres repetidos");
});
await test("congelar fotogramas: decide igual en cada salida y al exportar (determinista), más con más cantidad", () => {
  const count = (a) => { let n = 0; for (let i = 0; i < 2400; i++) if (A.stutterAt(i / 24, a) > 0) n++; return n; };
  assert.equal(A.stutterAt(12.5, 0.6), A.stutterAt(12.5, 0.6));
  assert.equal(count(0), 0);
  assert.ok(count(0.9) > count(0.2) && count(0.2) > 0, `${count(0.2)} < ${count(0.9)}`);
  for (let i = 0; i < 500; i++) { const d = A.stutterAt(i / 24, 1); assert.ok(d === 0 || (d > 0.05 && d < 1), "duración " + d); }
  let beatHits = 0; for (let i = 0; i < 400; i++) if (A.stutterAt(i / 24, 0.8, 1) > 0) beatHits++;
  assert.ok(beatHits > count(0.8) / 6, "en cada golpe congela más");
});
report();
