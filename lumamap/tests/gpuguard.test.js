// tests/gpuguard.test.js — protección de la tarjeta gráfica: tras una caída del controlador, los
// shaders bajan de resolución; tirones serios la bajan antes; en bucle, no se recarga sin fin.
import { test, report } from "./harness.js";
import assert from "node:assert/strict";
const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const G = await import("../web/js/gpuguard.js");
const { shaderCap } = await import("../web/js/compose.js").catch(() => ({}));

console.log("== Protección de la tarjeta gráfica ==");
await test("cada caída baja la resolución de los shaders (4K → 1440p → 1080p → 720p) y no pasa de ahí", () => {
  G.resetGuard();
  assert.equal(G.guardCap(Date.now() + 5000), 0);
  const t0 = 1_000_000;
  assert.deepEqual(G.recordLoss("editor", t0), { level: 1, loop: false });
  assert.equal(G.guardCap(t0 + 5000), 1440);
  G.recordLoss("salida", t0 + 60_000); assert.equal(G.guardCap(t0 + 70_000), 1080);
  G.recordLoss("editor", t0 + 120_000); assert.equal(G.guardCap(t0 + 130_000), 720);
  const r = G.recordLoss("editor", t0 + 130_000);
  assert.equal(r.level, 3); assert.equal(r.loop, true, "4 caídas en 5 minutos: en bucle");
  assert.match(G.readGuard().why, /editor/);
});
await test("las caídas viejas no cuentan para «en bucle»; quitar la protección vuelve a la resolución elegida", () => {
  G.resetGuard();
  const t0 = 5_000_000;
  for (let i = 0; i < 3; i++) G.recordLoss("x", t0 + i * 20_000);
  assert.equal(G.recordLoss("x", t0 + 10 * 60_000).loop, false, "las de hace más de 5 minutos no cuentan");
  G.resetGuard();
  assert.deepEqual(G.readGuard(), { level: 0, losses: [], why: "" });
});
await test("un reinicio del controlador tumba a la vez el editor y las salidas: cuenta como una sola caída", () => {
  G.resetGuard();
  const t0 = 9_000_000;
  G.recordLoss("editor", t0); G.recordLoss("salida 1", t0 + 300); G.recordLoss("salida 2", t0 + 900);
  assert.deepEqual([G.readGuard().level, G.readGuard().losses.length], [1, 1], "no salta a 720p de golpe");
  G.recordLoss("editor", t0 + 30_000);
  assert.equal(G.readGuard().level, 2, "otra caída más tarde sí cuenta");
});
await test("vigilante: fotogramas muy lentos con shaders en pantalla bajan un nivel antes de que Windows reinicie la tarjeta", () => {
  G.resetGuard();
  const steps = [];
  const w = new G.Watchdog({ onStep: (l) => steps.push(l) });
  let t = 0;
  // Sin shaders, los tirones no cuentan (puede ser otra cosa).
  for (let i = 0; i < 5; i++) w.frame(t += 600, false);
  assert.equal(steps.length, 0);
  // Ventana oculta: tampoco.
  w.hidden = true; for (let i = 0; i < 5; i++) w.frame(t += 600, true); w.hidden = false;
  assert.equal(steps.length, 0);
  // Un tirón suelto (compilar un shader) no basta.
  w.frame(t += 16, true); w.frame(t += 900, true); for (let i = 0; i < 20; i++) w.frame(t += 16, true);
  assert.equal(steps.length, 0);
  // Dibujo por software: no hay controlador que reiniciar.
  w.soft = true; for (let i = 0; i < 8; i++) w.frame(t += 600, true); w.soft = false;
  assert.equal(steps.length, 0);
  // Con shaders, 5 fotogramas de más de 400 ms en 10 s → nivel 1.
  t += 11_000; w.frame(t, true);
  for (let i = 0; i < 5; i++) w.frame(t += 500, true);
  assert.deepEqual(steps, [1]);
  // Espera 20 s entre bajadas.
  for (let i = 0; i < 5; i++) w.frame(t += 500, true);
  assert.deepEqual(steps, [1]);
  t += 21_000; w.frame(t, true);
  for (let i = 0; i < 5; i++) w.frame(t += 500, true);
  assert.deepEqual(steps, [1, 2]);
  // Fotogramas normales no hacen nada.
  for (let i = 0; i < 100; i++) w.frame(t += 16, true);
  assert.deepEqual(steps, [1, 2]);
});
await test("la resolución de los shaders del compositor respeta la protección (también en las salidas)", () => {
  if (!shaderCap) return;   // compose.js necesita el navegador para cargarse entero; se prueba allí
  G.resetGuard();
  const p = { settings: { output: { shaderRes: 2160 } } };
  assert.equal(shaderCap(p), 2160);
  G.recordLoss("x"); assert.equal(shaderCap(p), 1440);
  p.settings.output.shaderRes = 720; assert.equal(shaderCap(p), 720, "si ya eligió menos, se respeta");
  G.resetGuard();
});
report();
