// tests/ollama-real.test.js — la IA local de verdad (Ollama), sin simulaciones.
// La CI instala Ollama y lo arranca; esta prueba usa el mismo código que la app:
//   · detecta Ollama y sus modelos,
//   · descarga el modelo con «Descargar la IA» (lo mismo que hace la app en Android y el navegador),
//   · Luma (el tutorial) responde a una pregunta con la IA, no con la guía de reserva,
//   · el asistente conversa y propone acciones válidas.
// Sin Ollama en este equipo se omite (salvo con REQUIRE_OLLAMA=1, como en la CI).
import { test, report } from "./harness.js";
import assert from "node:assert/strict";
const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };

const ENDPOINT = process.env.OLLAMA_URL || "http://localhost:11434";
const MODEL = process.env.OLLAMA_MODEL || "qwen3:0.6b";
const up = await fetch(ENDPOINT + "/api/version", { signal: AbortSignal.timeout(3000) }).then(r => r.ok).catch(() => false);
if (!up) {
  if (process.env.REQUIRE_OLLAMA) { console.error(`✗ Ollama no responde en ${ENDPOINT}`); process.exit(1); }
  console.log(`Ollama no está en ${ENDPOINT}: se omite la prueba de la IA real.`);
  process.exit(0);
}

const M = await import("../web/js/model.js");
const { AIEngine } = await import("../web/js/ai/providers.js");
const project = M.createProject();
M.addSurface(project, M.SHAPES.rect.make(500, 500, 200));
const app = { S: { project, sel: project.surfaces[0].id, pro: false }, changed() {}, commit() {}, commitSoon() {}, select() {}, openTab() {}, setPro() {}, actions: {} };
const ai = new AIEngine(app);
ai.hw = { ramGB: 16, vramGB: 0, gpu: "CI" };
Object.assign(ai.settings, { endpoint: ENDPOINT, model: "", provider: "auto", allowLocal: true });

console.log(`== IA local real: Ollama en ${ENDPOINT} con ${MODEL} ==`);
await test("detecta Ollama encendido", async () => {
  await ai.refresh({ force: true });
  assert.ok(ai.state.local, "sin estado");
  assert.ok(ai.state.local.code !== "offline" && ai.state.local.code !== "notInstalled", JSON.stringify(ai.state.local));
});
await test(`«Descargar la IA»: baja ${MODEL} con el código de la app y queda elegida`, async () => {
  const steps = [];
  const st = await ai.pullModel(MODEL, (p) => steps.push(p.status));
  assert.equal(steps.at(-1), "success");
  assert.ok(st.available, JSON.stringify(st));
  assert.equal(ai.settings.model, MODEL);
  const line = ai.statusLine();
  assert.equal(line.ok, true, line.text); assert.equal(line.mode, "Local");
});
await test("Luma (tutorial) responde una duda con la IA local, no con la guía de reserva", async () => {
  const t0 = Date.now();
  const r = await ai.explain("¿cómo hago una máscara?");
  console.log(`    (${((Date.now() - t0) / 1000).toFixed(1)} s) ${String(r.text).slice(0, 160).replace(/\s+/g, " ")}…`);
  assert.equal(ai.notice, "", "aviso: " + ai.notice);
  assert.ok(!r.fallback, "respondió la guía de reserva: la IA falló");
  assert.ok(String(r.text).trim().length > 10, "respuesta vacía");
});
await test("el asistente conversa con la IA y nunca devuelve acciones inválidas sin marcarlas", async () => {
  const r = await ai.chat("¿Qué me recomiendas para un show en una pared con música?");
  assert.ok(String(r.reply || "").trim().length > 0, "sin respuesta");
  for (const p of r.proposals || []) assert.equal(typeof p.ok, "boolean");
  console.log(`    fuente: ${r.source} · ${String(r.reply).slice(0, 120).replace(/\s+/g, " ")}…`);
});
report();
