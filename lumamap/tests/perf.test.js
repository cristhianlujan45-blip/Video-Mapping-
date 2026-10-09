// tests/perf.test.js — pruebas de velocidad como en un móvil Android modesto:
// pantalla de teléfono (412×915, táctil) y CPU 4 veces más lenta (emulación de
// Chromium). Cada medida tiene un límite: si una versión nueva lo supera, falla.
// Ejecuta: node tests/perf.test.js   (necesita Playwright, igual que browser.test.js)
import { createServer } from "../server/index.js";
import { test, report } from "./harness.js";
import assert from "node:assert/strict";

let chromium;
try { ({ chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright")); }
catch { console.log("Playwright no está instalado: se omiten las pruebas de velocidad."); process.exit(0); }

// Límites con la CPU a ×4 (en un equipo de CI típico). Holgados para no fallar por
// ruido, pero cazan cualquier cosa que haga la app el doble de lenta.
const BUDGET = {
  startupMs: 6000,      // de abrir la página a la app lista y dibujando
  firstFrameMs: 9000,   // primer fotograma dibujado
  tabMs: 800,           // abrir cualquier pestaña del modo simple
  workMs: 20,           // trabajo medio por fotograma con un proyecto de 3 caras animadas
  lightsMs: 12,         // 2000 LED con un efecto en movimiento (por fotograma)
  interMs: 30,          // efecto interactivo «Ondas» a 480×270 (por fotograma)
  analyzeMs: 30,        // diagnóstico del proyecto («¿Qué hago ahora?»)
  heapMB: 160,          // memoria de JavaScript tras usar la app
};
const CPU_SLOWDOWN = Number(process.env.LUMAMAP_CPU_SLOWDOWN || 4);

const srv = createServer({ port: 0, osc: false });
await new Promise(r => srv.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${srv.address().port}/`;
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist",
  "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--enable-precise-memory-info"] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ["camera"] });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_SLOWDOWN });
const errors = [];
page.on("pageerror", e => errors.push(e.message));
const results = [];
const check = (name, value, budget, unit = "ms") => {
  results.push([name, value, budget, unit]);
  assert.ok(value <= budget, `${name}: ${value.toFixed(1)} ${unit} (límite ${budget} ${unit})`);
};

console.log(`== Velocidad (móvil 412×915, CPU ×${CPU_SLOWDOWN}) ==`);

await test("arranque: la app está lista y dibuja rápido", async () => {
  const t0 = Date.now();
  await page.goto(base);
  await page.waitForFunction(() => window.__lumamap?.S?.project, null, { timeout: 30000 });
  const ready = Date.now() - t0;
  await page.waitForFunction(() => window.__lumamap.perf().frames > 2, null, { timeout: 30000 });
  const frame = Date.now() - t0;
  check("Arranque", ready, BUDGET.startupMs);
  check("Primer fotograma", frame, BUDGET.firstFrameMs);
});

await test("pestañas del modo simple: cada una abre al momento", async () => {
  await page.getByText("Cubo 3D").click().catch(() => {});
  await page.waitForTimeout(500);
  const tabs = await page.evaluate(() => [...document.querySelectorAll("#dock button[data-tab]")].map(b => b.dataset.tab));
  assert.ok(tabs.length >= 5, "pestañas: " + tabs.join(","));
  let worst = 0, worstTab = "";
  for (const t of tabs) {
    // Tiempo de la app para construir la pestaña (sin esperar al dibujo de la GPU,
    // que en CI es por software y no se parece al de un teléfono).
    const open = () => page.evaluate((tab) => {
      window.__lumamap.openTab(null);
      const t0 = performance.now();
      window.__lumamap.openTab(tab);
      document.querySelector("#panelBody")?.getBoundingClientRect();   // fuerza el diseño de la página
      return performance.now() - t0;
    }, t);
    let ms = await open();
    await page.waitForTimeout(150);
    // Un pico aislado del equipo de pruebas no cuenta: si se pasa, se mide otra vez (cuenta la mejor).
    if (ms > BUDGET.tabMs) { ms = Math.min(ms, await open()); await page.waitForTimeout(150); }
    if (ms > worst) { worst = ms; worstTab = t; }
    if (ms > BUDGET.tabMs / 3) results.push([`  pestaña ${t}`, ms, 0, "ms"]);
  }
  await page.evaluate(() => window.__lumamap.openTab(null));
  results.push([`  (la más lenta: ${worstTab})`, worst, BUDGET.tabMs, "ms"]);
  check("Abrir pestaña (peor caso)", worst, BUDGET.tabMs);
});

await test("bucle de la app: trabajo por fotograma con caras animadas", async () => {
  await page.evaluate(() => {
    const a = window.__lumamap, P = a.S.project, anim = a.M.ANIM_LIBRARY.find(x => x.gen === "plasma") || a.M.ANIM_LIBRARY[0];
    for (const s of P.surfaces) { a.select(s.id); a.actions.setSource({ type: "anim", gen: anim.gen }); }
  });
  // Calentamiento: la primera vez se compilan los shaders (una sola vez por animación).
  await page.waitForTimeout(2000);
  await page.evaluate(() => window.__lumamap.perfReset());
  await page.waitForTimeout(3000);
  const p = await page.evaluate(() => window.__lumamap.perf());
  results.push(["  fps medidos", p.fps, 0, "fps"]);
  check("Trabajo por fotograma", p.workMs, BUDGET.workMs);
});

await test("prueba de velocidad de la app: luces, interactivo y diagnóstico", async () => {
  const r = await page.evaluate(() => window.__lumamap.actions.speedTest({ silent: true }));
  check("Luces 2000 LED", r.lightsMs, BUDGET.lightsMs);
  check("Efecto interactivo", r.interMs, BUDGET.interMs);
  check("Diagnóstico del proyecto", r.analyzeMs, BUDGET.analyzeMs);
  assert.ok(["low", "balanced", "high"].includes(r.rec), "recomendación: " + r.rec);
  results.push(["  calidad recomendada: " + r.rec, 0, 0, ""]);
});

await test("la prueba de velocidad se ve en el menú y aplica la calidad con un toque", async () => {
  await page.evaluate(() => { window.__lumamap.actions.speedTest(); });   // el diálogo queda abierto
  await page.getByText("Calidad recomendada para que vaya fluido").waitFor({ timeout: 30000 });
  await page.locator("#modal button", { hasText: /^Aplicar / }).click();
  const q = await page.evaluate(() => localStorage.getItem("lumamap:quality"));
  assert.ok(["low", "balanced", "high"].includes(q), "calidad guardada: " + q);
});

await test("memoria de JavaScript", async () => {
  const mb = await page.evaluate(() => (performance.memory?.usedJSHeapSize || 0) / 2 ** 20);
  if (mb) check("Memoria JS", mb, BUDGET.heapMB, "MB");
});

await test("sin errores de JavaScript", () => assert.deepEqual(errors, []));

console.log("\n  Medida                          Valor        Límite");
for (const [n, v, b, u] of results) console.log(`  ${n.padEnd(32)} ${u ? (v.toFixed(1) + " " + u).padEnd(12) : "".padEnd(12)} ${b ? b + " " + u : ""}`);

await browser.close();
srv.close();
report();
process.exit(process.exitCode || 0);
