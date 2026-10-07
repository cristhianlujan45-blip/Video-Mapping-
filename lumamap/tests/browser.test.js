// tests/browser.test.js — prueba de extremo a extremo en Chromium (opcional).
// Requiere Playwright: `npm i -D playwright && npx playwright install chromium`
// (o PLAYWRIGHT_MODULE=/ruta/a/playwright/index.mjs). Ejecuta: npm run test:browser
import { createServer } from "../server/index.js";
import { test, report } from "./harness.js";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import zlib from "node:zlib";

let chromium;
try { ({ chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright")); }
catch { console.log("Playwright no está instalado: se omiten las pruebas de navegador."); process.exit(0); }

// PNG de prueba (degradado 64×36) sin dependencias.
function makePng(file) {
  const w = 64, h = 36, rows = [];
  for (let y = 0; y < h; y++) { const r = [0]; for (let x = 0; x < w; x++) r.push(x * 4, y * 7, 128); rows.push(Buffer.from(r)); }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]));
}

const srv = createServer({ port: 0, osc: false });
await new Promise(r => srv.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${srv.address().port}/`;
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message));
await page.goto(base);
await page.waitForTimeout(800);
await page.getByText("Cubo 3D").click();
await page.waitForTimeout(300);

const toScreen = (p) => page.evaluate(([x, y]) => {
  const app = window.__lumamap, r = document.querySelector("#ov").getBoundingClientRect();
  const st = document.querySelector("#stage"), d = Math.min(devicePixelRatio, 2), P = app.S.project;
  const cw = st.clientWidth * d, ch = st.clientHeight * d, s = Math.min(cw / P.width, ch / P.height) * 0.92 * app.S.view.zoom;
  return [r.left + (x * s + (cw - P.width * s) / 2 + app.S.view.panX * d) / d, r.top + (y * s + (ch - P.height * s) / 2 + app.S.view.panY * d) / d];
}, p);
const pts = () => page.evaluate(() => JSON.stringify(window.__lumamap.S.project.surfaces.map(s => s.points)));

await test("la esquina compartida del cubo arrastra las 3 caras; Ctrl+Z lo deshace", async () => {
  const before = await pts();
  const [x, y] = await toScreen([960, 560]);
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 30, y + 20, { steps: 5 }); await page.mouse.up();
  const moved = JSON.parse(await pts()).flat().filter((p, i) => p.x !== JSON.parse(before).flat()[i].x).length;
  assert.equal(moved, 3);
  await page.keyboard.press("Control+z");
  assert.equal(await pts(), before);
});
await test("importar una imagen la asigna a la superficie seleccionada", async () => {
  const file = path.join(os.tmpdir(), "lumamap-test.png");
  makePng(file);
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.evaluate(() => { window.__lumamap.actions.importMedia("selected"); })]);
  await chooser.setFiles(file);
  await page.waitForFunction(() => window.__lumamap.S.project.media.length === 1);
  assert.equal(await page.evaluate(() => window.__lumamap.lookSel().source.type), "media");
});
await test("dibujar en la pared guarda trazos y se pueden deshacer", async () => {
  await page.locator('#dock [data-tab="draw"]').click();
  const [x, y] = await toScreen([300, 300]);
  await page.mouse.move(x, y); await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(x + i * 10, y + Math.sin(i / 3) * 40);
  await page.mouse.up();
  assert.equal(await page.evaluate(() => window.__lumamap.lookSel().source.strokes.length), 1);
  await page.evaluate(() => window.__lumamap.actions.undoStroke());
  assert.equal(await page.evaluate(() => window.__lumamap.lookSel().source.strokes.length), 0);
});
await test("la ventana de salida recibe el proyecto del editor", async () => {
  const out = await ctx.newPage();
  out.on("pageerror", e => errors.push("salida: " + e.message));
  await out.goto(base + "output.html");
  await out.waitForFunction(() => /Cubo 3D/.test(document.querySelector("#hud small").textContent), null, { timeout: 5000 });
  await out.close();
});
await test("paleta de comandos (Ctrl+K) y copiar/pegar", async () => {
  await page.keyboard.press("Escape");
  await page.locator('#dock [data-tab="add"]').click();
  const n = () => page.evaluate(() => window.__lumamap.S.project.surfaces.length);
  const n0 = await n();
  await page.keyboard.press("Control+k");
  await page.keyboard.type("estrella");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(150);
  assert.equal(await n(), n0 + 1);
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+v");
  assert.equal(await n(), n0 + 2);
  await page.keyboard.press("Control+z");
  assert.equal(await n(), n0 + 1);
});
await test("menú contextual con clic derecho", async () => {
  const [x, y] = await toScreen([960, 540]);
  await page.mouse.click(x, y, { button: "right" });
  assert.equal(await page.locator(".ctxmenu").count(), 1);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".ctxmenu").count(), 0);
});
await test("sin errores de JavaScript", () => assert.deepEqual(errors, []));

await browser.close();
srv.close();
report();
process.exit(process.exitCode || 0);
