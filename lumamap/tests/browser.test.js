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
await test("asa lateral: arrastrar el lado derecho ensancha sin mover el izquierdo", async () => {
  await page.keyboard.press("Escape");
  await page.evaluate(() => { const a = window.__lumamap; a.actions.addShape("rect"); });
  const before = await page.evaluate(() => window.__lumamap.surf().points.map(p => ({ ...p })));
  const xs = before.map(p => p.x), ys = before.map(p => p.y);
  const right = Math.max(...xs), midY = (Math.min(...ys) + Math.max(...ys)) / 2;
  const [x, y] = await toScreen([right, midY]);
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 60, y + 15, { steps: 4 }); await page.mouse.up();
  const after = await page.evaluate(() => window.__lumamap.surf().points);
  const L = (pts) => pts.filter((_, i) => i === 0 || i === 2);   // rejilla TL, TR, BL, BR
  assert.deepEqual(L(after), L(before), "lado izquierdo fijo");
  assert.ok(after[1].x > before[1].x + 20 && Math.abs(after[1].y - before[1].y) < 0.01, "lado derecho se aleja en horizontal");
});
await test("asa de giro: arrastrar el círculo gira la superficie a cualquier ángulo", async () => {
  await page.evaluate(() => { const a = window.__lumamap; a.actions.addShape("rect"); });
  const info = await page.evaluate(async () => {
    const { rotateHandle, centroid } = await import("./js/math.js");
    const { ROT_OFF } = await import("./js/overlay.js");
    const app = window.__lumamap, P = app.S.project, st = document.querySelector("#stage"), d = Math.min(devicePixelRatio, 2);
    const s = Math.min(st.clientWidth * d / P.width, st.clientHeight * d / P.height) * 0.92 * app.S.view.zoom;
    const sf = app.surf();
    return { h: rotateHandle(sf, ROT_OFF * d / s), c: centroid(sf.points), p: sf.points.map(q => ({ ...q })) };
  });
  const [hx, hy] = await toScreen([info.h.x, info.h.y]);
  const [cx, cy] = await toScreen([info.c.x, info.c.y]);
  // gira 90° alrededor del centro (en pantalla)
  const tx = cx - (hy - cy), ty = cy + (hx - cx);
  await page.mouse.move(hx, hy); await page.mouse.down();
  for (let k = 1; k <= 8; k++) {
    const a = (Math.PI / 2) * k / 8, dx = hx - cx, dy = hy - cy;
    await page.mouse.move(cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a));
  }
  await page.mouse.move(tx, ty); await page.mouse.up();
  const after = await page.evaluate(() => window.__lumamap.surf().points);
  const ang = (a, b) => Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  const turned = ((ang(after[0], after[1]) - ang(info.p[0], info.p[1]) + 540) % 360) - 180;
  assert.ok(Math.abs(turned - 90) < 2, "giró " + turned);
  await page.keyboard.press("Control+z");
});
await test("pestaña Animaciones: sin selección crea una superficie a pantalla completa", async () => {
  await page.keyboard.press("Escape");
  await page.evaluate(() => { const a = window.__lumamap; a.select?.(null); a.S.sel = null; a.openTab("anim"); });
  const n0 = await page.evaluate(() => window.__lumamap.S.project.surfaces.length);
  await page.locator(".tile", { hasText: "Hiperespacio" }).first().click();
  const r = await page.evaluate(() => { const a = window.__lumamap; const s = a.surf(); const xs = s.points.map(p => p.x), ys = s.points.map(p => p.y);
    return { n: a.S.project.surfaces.length, gen: a.lookSel().source.gen, w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), W: a.S.project.width, H: a.S.project.height }; });
  assert.equal(r.n, n0 + 1); assert.equal(r.gen, "warp");
  assert.equal(Math.round(r.w), r.W); assert.equal(Math.round(r.h), r.H);
  await page.evaluate(() => { window.__lumamap.actions.rotateContent(90); window.__lumamap.actions.rotateContent(-90); window.__lumamap.actions.rotateContent(180); });
  assert.equal(await page.evaluate(() => window.__lumamap.lookSel().fx.rotate), 180);
  await page.evaluate(() => window.__lumamap.openTab("anim"));
});
await test("biblioteca de efectos: aplicar «Contorno neón» y combinar «Espejo selfie»", async () => {
  await page.evaluate(() => window.__lumamap.openTab("fx"));
  await page.locator(".fxlib .chip", { hasText: "Contorno neón" }).first().click();
  await page.evaluate(() => { document.querySelectorAll(".toggle input")[0].click(); });   // Combinar
  await page.locator(".fxlib .chip", { hasText: "Espejo selfie" }).first().click();
  const fx = await page.evaluate(() => window.__lumamap.lookSel().fx);
  assert.equal(fx.edges, 1); assert.equal(fx.flipX, true);
});
await test("catálogo de animaciones y texto animado desde el panel", async () => {
  await page.evaluate(() => { window.__lumamap.actions.setSource({ type: "gen" }); window.__lumamap.openTab("content"); });
  await page.locator("input[type=search]").first().fill("aurora");
  await page.locator(".tile", { hasText: "Aurora boreal" }).first().click();
  const gen = await page.evaluate(() => window.__lumamap.lookSel().source.gen);
  assert.equal(gen, "aurora");
  await page.evaluate(() => { window.__lumamap.actions.setSource({ type: "text", text: "Hola" }); });
  await page.locator(".chip", { hasText: "Ola" }).first().click();
  assert.equal(await page.evaluate(() => window.__lumamap.lookSel().source.textAnim), "wave");
});
await test("las 92 animaciones base, el catálogo y los efectos compilan y dibujan sin errores de GPU", async () => {
  const errs = await page.evaluate(async () => {
    const { Renderer } = await import("./js/renderer.js");
    const M = await import("./js/model.js");
    const c = document.createElement("canvas"); c.width = 64; c.height = 40;
    const r = new Renderer(c);
    const s = M.createQuad({ corners: M.rectCorners(0, 0, 64, 40) });
    const bad = [];
    const all = { ...M.DEFAULT_FX(), twirl: 1, bulge: 0.5, ripple: 1, tile: 2, polar: true, glitch: 1, chroma: 0.01, crt: 1, posterize: 4, sepia: 1, gamma: 1.5, threshold: 0.3, vignette: 1, scanlines: 1, halftone: 1, duotone: 1, colormap: "thermal", chromaKey: 0.3, lumaKey: 0.2, flipX: true };
    for (const g of M.GENERATORS) {
      const look = M.createLook({ type: "gen", gen: g.id }); look.fx = all;
      r.begin(); r.drawSurface(s, look, { view: { sx: 1, sy: 1, tx: 0, ty: 0 }, time: 1, alpha: 1, tex: null, levels: { beat: 1, bass: 1, count: 3 }, master: 1 });
      const e = r.gl.getError(); if (e) bad.push(g.id + ":" + e);
    }
    return bad;
  });
  assert.deepEqual(errs, []);
});
await test("resolución personalizada y ajustes del proyector", async () => {
  await page.evaluate(() => { window.__lumamap.actions.setResolution(); });
  await page.locator("#modal input[type=number]").first().fill("2560");
  await page.locator("#modal input[type=number]").nth(1).fill("1440");
  await page.locator("#modal button", { hasText: "Usar" }).click();
  assert.deepEqual(await page.evaluate(() => [window.__lumamap.S.project.width, window.__lumamap.S.project.height]), [2560, 1440]);
  await page.evaluate(() => window.__lumamap.openTab("output"));
  await page.locator("summary", { hasText: "Orientación del proyector" }).click();
  await page.locator(".toggle", { hasText: "Retroproyección" }).click();
  assert.equal(await page.evaluate(() => window.__lumamap.S.project.settings.output.flipH), true);
});
await test("sin errores de JavaScript", () => assert.deepEqual(errors, []));

await browser.close();
srv.close();
report();
process.exit(process.exitCode || 0);
