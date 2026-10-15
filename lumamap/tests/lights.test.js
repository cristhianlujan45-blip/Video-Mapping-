// tests/lights.test.js — biblioteca de efectos de luz y su salida DMX (sin red).
import { test, report } from "./harness.js";
import assert from "node:assert/strict";
import { LIGHT_FX, LIGHT_FX_CATEGORIES, prepareFx, prepareMove, MOVES, findFx, defaultLightFx } from "../web/js/lightfx.js";
import { DmxEngine } from "../web/js/dmx.js";
import * as M from "../web/js/model.js";

console.log("== Efectos de luz ==");

await test(`biblioteca: ${LIGHT_FX.length} efectos en ${LIGHT_FX_CATEGORIES.length} categorías, ids y nombres únicos`, () => {
  assert.ok(LIGHT_FX.length >= 70, "biblioteca grande");
  assert.equal(new Set(LIGHT_FX.map(f => f.id)).size, LIGHT_FX.length);
  assert.equal(new Set(LIGHT_FX.map(f => f.name)).size, LIGHT_FX.length);
  assert.equal(findFx("Fuego").algo, "fire");
});

await test("todos los efectos dan colores válidos (0-255, sin NaN) en tira y matriz, en muchos instantes", () => {
  const out = [0, 0, 0];
  const lv = { bass: 0.8, mid: 0.4, high: 0.2, level: 0.6, beat: 1 };
  for (const f of LIGHT_FX) {
    let lit = 0;
    for (const t of [0, 0.37, 1.9, 7.3, 33.1]) {
      const run = prepareFx({ id: f.id, color: f.color, color2: f.color2, speed: f.speed, size: f.size, music: true }, t, lv, 128);
      for (let i = 0; i < 64; i++) {
        run(i, 64, (i % 8) / 7, Math.floor(i / 8) / 7, out);
        for (const v of out) assert.ok(Number.isFinite(v) && v >= 0 && v <= 255, `${f.name}: ${v}`);
        if (out[0] + out[1] + out[2] > 30) lit++;
      }
    }
    assert.ok(lit > 0, `${f.name} enciende algún LED`);
  }
});

await test("se mueve con el tiempo y los efectos de música siguen al audio", () => {
  const out = [0, 0, 0];
  const at = (id, t, lv) => [...prepareFx({ id: findFx(id).id }, t, lv)(10, 60, 0.2, 0.5, out)];
  assert.notDeepEqual(at("Arcoíris", 0, {}), at("Arcoíris", 1, {}));
  const quiet = at("Pulso de graves", 0, { bass: 0 }), loud = at("Pulso de graves", 0, { bass: 1 });
  assert.ok(loud[0] > quiet[0] * 5, "más graves = más brillo");
  const vu0 = at("Vúmetro", 0, { level: 0 }), vu1 = at("Vúmetro", 0, { level: 1 });
  assert.ok(vu1[1] + vu1[0] > vu0[0] + vu0[1] + 50);
});

await test("cabezas móviles: cada movimiento da pan/tilt entre 0 y 1", () => {
  for (const [k] of MOVES) {
    const run = prepareMove({ kind: k, speed: 1, size: 1 }, 3.3, 120);
    for (let i = 0; i < 4; i++) {
      const r = run(i, 4);
      if (k === "none") { assert.equal(r, null); continue; }
      for (const v of r) assert.ok(v >= 0 && v <= 1, `${k}: ${v}`);
    }
  }
});

await test("una tira con efecto llega a los canales DMX; un foco PAR también; el apagón lo pone a cero", () => {
  const app = { S: { project: M.createProject(), levels: {}, mods: [] } };
  const D = new DmxEngine(app);
  const strip = D.addLight("strip", { count: 10, fx: "Color fijo" });
  strip.fx.color = "#ff8000";
  const par = D.addLight("par", { fx: "Color fijo" });
  par.fx.color = "#00ff00";
  D.cfg.enabled = true;
  D.tick(1000, null);
  const u1 = D.out.get(strip.universe);
  assert.deepEqual([u1[0], u1[1], u1[2]], [255, 128, 0], "LED 1 en naranja");
  assert.deepEqual([u1[27], u1[28], u1[29]], [255, 128, 0], "LED 10");
  const pu = D.out.get(par.universe), a = par.address - 1;
  assert.deepEqual([pu[a], pu[a + 1], pu[a + 2], pu[a + 3]], [255, 0, 255, 0], "dimmer 255 + verde");
  assert.notEqual(par.universe, strip.universe, "el foco no pisa los canales de la tira");
  D.blackout = true; D.lastTick = 0;
  D.tick(2000, null);
  assert.ok([...D.out.values()].every(b => b.every(v => v === 0)));
});

await test("cabeza móvil con movimiento «círculo»: pan y tilt cambian solos", () => {
  const app = { S: { project: M.createProject(), levels: {}, mods: [] } };
  const D = new DmxEngine(app);
  const mh = D.addLight("moving");
  const pan = mh.channels.findIndex(c => c.type === "pan"), a = mh.address - 1 + pan;
  D.cfg.enabled = true;
  D.tick(1000, null); const p1 = D.out.get(mh.universe)[a];
  D.lastTick = 0; D.tick(2500, null); const p2 = D.out.get(mh.universe)[a];
  assert.notEqual(p1, p2);
  assert.deepEqual(defaultLightFx("Fuego").id, findFx("Fuego").id);
});

report();
