// tests/tracking.browser.test.js — tracking real de punta a punta en Chromium.
// Una cámara falsa muestra una foto con una persona (fixtures/pose.jpg, de los
// recursos de prueba de MediaPipe, Apache 2.0): la IA del hilo de tracking debe
// encontrarla, publicar las señales y una regla debe cambiar el color de verdad.
// Requiere Playwright y ffmpeg (desktop/node_modules/ffmpeg-static) para crear el .y4m.
import { createServer } from "../server/index.js";
import { test, report } from "./harness.js";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
let chromium, ffmpeg;
try { ({ chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright")); }
catch { console.log("Playwright no está instalado: se omite la prueba de tracking."); process.exit(0); }
try { ffmpeg = createRequire(path.join(here, "..", "desktop", "package.json"))("ffmpeg-static"); } catch {}
if (!ffmpeg || !fs.existsSync(ffmpeg)) { console.log("ffmpeg no está disponible (cd desktop && npm ci): se omite la prueba de tracking."); process.exit(0); }

const y4m = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lumamap-trk-")), "pose.y4m");
execFileSync(ffmpeg, ["-v", "error", "-loop", "1", "-i", path.join(here, "fixtures", "pose.jpg"), "-t", "2", "-r", "10", "-vf", "scale=640:-2,format=yuv420p", y4m]);

const srv = createServer({ port: 0, osc: false });
await new Promise(r => srv.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist",
  "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--use-file-for-fake-video-capture=" + y4m] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ["camera"] });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message));
page.on("console", m => { if (m.type() === "error" && /TypeError|ReferenceError|RangeError|SyntaxError/.test(m.text())) errors.push("consola: " + m.text().slice(0, 300)); });
await page.goto(`http://127.0.0.1:${srv.address().port}/`);
await page.waitForFunction(() => window.__lumamap?.tracking);
await page.waitForTimeout(500);
await page.getByText("Cubo 3D").click();
await page.waitForTimeout(300);

await test("la IA encuentra a la persona de la cámara (cuerpo con 33 puntos)", async () => {
  await page.evaluate(() => { const a = window.__lumamap; a.S.project.settings.tracking.provider = "webcam"; a.tracking.ensure("default"); });
  await page.waitForFunction(() => (window.__lumamap.tracking.main()?.people || []).some(p => !p.ghost), null, { timeout: 120000 });
  const r = await page.evaluate(() => { const t = window.__lumamap.tracking.main(); const p = t.people.find(x => !x.ghost); return { id: p.id, n: p.lm.length, delegate: t.delegate, sig: t.lastSignals }; });
  assert.equal(r.n, 33);
  assert.ok(r.id >= 1, "ID estable");
  assert.equal(r.sig.presence, 1, "señal «hay alguien»");
  console.log(`    (IA en ${r.delegate})`);
});
await test("regla «hay alguien → color verde» se dispara con el tracking real", async () => {
  await page.evaluate(() => {
    const a = window.__lumamap, P = a.S.project;
    a.select(P.surfaces[0].id);
    P.settings.tracking.rules.push({ id: "rule_test", name: "prueba", signal: "presence", op: "above", value: 0.5, cooldown: 0, then: { type: "color", surface: "all", color: "#00ff00" }, otherwise: null, enabled: true });
  });
  await page.waitForFunction(() => window.__lumamap.S.project.settings.tracking.rules.find(r => r.id === "rule_test").fired > 0, null, { timeout: 30000 });
  assert.equal(await page.evaluate(() => window.__lumamap.lookSel().source.color), "#00ff00");
});
await test("sin errores de JavaScript", () => assert.deepEqual(errors, []));

await page.evaluate(() => window.__lumamap.tracking.stop());
await browser.close();
srv.close();
report();
process.exit(process.exitCode || 0);
