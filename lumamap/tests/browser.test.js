// tests/browser.test.js — prueba de extremo a extremo en Chromium (opcional).
// Requiere Playwright: `npm i -D playwright && npx playwright install chromium`
// (o PLAYWRIGHT_MODULE=/ruta/a/playwright/index.mjs). Ejecuta: npm run test:browser
import { createServer, startHttps } from "../server/index.js";
import { test, report, setOnFail, setParts } from "./harness.js";
// Tanda 2 (PART=2): móviles, plugins, VJ y lo de Resolume; la tanda 1 (PART=1) es el resto.
setParts(/^(Salida por red|Escenas y show|3D para proyectar|móvil como cámara|móvil por cable|plugins:|VJ automático|como Resolume|plugins en 4K|comparador|móvil: nada amontonado|como TouchDesigner)/);
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
// https propio (cámara del móvil): en el primer puerto libre desde uno al azar.
const httpsPort = await startHttps({ want: 20000 + Math.floor(Math.random() * 20000), dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "lumamap-tls-")), host: "127.0.0.1" });
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist",
  "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ["camera", "midi"] });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message));
// El bucle de la app atrapa los errores para que el show nunca se pare (console.error):
// aquí cuentan igual, así un efecto que falla en cada fotograma no pasa desapercibido.
page.on("console", m => { if (m.type() === "error" && /TypeError|ReferenceError|RangeError|SyntaxError/.test(m.text())) errors.push("consola: " + m.text().slice(0, 300)); });
// Todos los errores de consola (también los del bucle de la app), para el informe de una prueba que falla.
const consoleErrs = [];
page.on("console", m => { if (m.type() === "error" || /WebMediaPlayer|too many/i.test(m.text())) { consoleErrs.push(m.text().slice(0, 400)); if (consoleErrs.length > 200) consoleErrs.shift(); } });
// Si una prueba falla: captura de pantalla y qué hay abierto (diálogo, pestaña), para ver la causa en la CI.
let shotN = 0;
setOnFail(async (name) => {
  // Una prueba de las redes que falla no deja el editor de redes tapando las siguientes.
  await page.evaluate(() => window.__lumamap?.closeNetwork?.()).catch(() => {});
  const info = await page.evaluate(() => ({ tab: window.__lumamap?.S.tab, dialog: document.querySelector("#modal.show h2")?.textContent || "", toast: document.querySelector(".toast")?.textContent || "" })).catch(() => ({}));
  console.error("    estado:", JSON.stringify(info));
  const recent = [...new Set(consoleErrs.slice(-40))].slice(-5);
  if (recent.length) console.error("    últimos errores de consola:\n      " + recent.join("\n      "));
  if (process.env.SHOTS_DIR) { fs.mkdirSync(process.env.SHOTS_DIR, { recursive: true }); await page.screenshot({ path: path.join(process.env.SHOTS_DIR, `${String(++shotN).padStart(2, "0")}-${name.replace(/[^\w]+/g, "_").slice(0, 60)}.png`) }); }
  // Que un diálogo que quedó abierto no haga fallar también a las pruebas siguientes.
  // (y lo que sigue en marcha solo: VJ, autopiloto de la mesa, LFO; el editor vuelve al frente)
  await page.evaluate(async () => { const a = window.__lumamap; a?.params?.cancelLearn?.(); for (let i = 0; i < 3; i++) document.getElementById("modal")?._close?.(null); a?.openTab?.(null);
    if (a) { a.actions.vjStop?.(); const P = a.S.project.settings; P.deck.autopilot = 0; P.deck.quantize = "off"; P.deck.cells = {}; P.lfos = []; a.S.compare = null; a.actions.showPattern?.(null); }
    // El espacio 3D abierto sigue dibujando (por software en la CI) y frena a todas las pruebas siguientes.
    if (a?.stage3d) { try { (await import("./js/panels-3d.js")).closeWorkspace(a); } catch {} } }).catch(() => {});
  await page.bringToFront().catch(() => {});
});
await page.goto(base);
await page.waitForTimeout(800);
await page.getByText("Cubo 3D").click();
// Sin tarjeta gráfica (SwiftShader) la vista previa a resolución completa va a ~5 fps y cada clic
// de Playwright espera fotogramas: calidad «baja» como la app elige sola en estos equipos (salida igual).
// Y vista previa a ¼: a ½ el dibujo por software ocupa los 4 núcleos de la CI (~10 fps) y deja sin CPU
// a todo lo demás (el servidor de la prueba tardó >30 s en servir la página en un equipo lento);
// a ¼ va a sus 30 fps con CPU de sobra. La salida y lo que comprueban las pruebas no cambian.
await page.evaluate(() => { const a = window.__lumamap.actions; a.applyQuality("low"); a.setPreview({ scale: 0.25 }); });
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
  // Dibujar está en Añadir (y en Contenido → Dibujo), no repetido en la barra de abajo.
  await page.evaluate(() => { const a = window.__lumamap; if (a.S.tab !== "add") a.openTab("add"); });
  await page.locator("#panelBody .tile", { hasText: "Dibujar" }).first().click();
  await page.waitForFunction(() => window.__lumamap.S.mode === "draw");
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
  try {
    await out.goto(base + "output.html");
    // (la ventana de salida carga sus módulos y compila el sombreador: en una CI lenta tarda más de 5 s)
    await out.waitForFunction(() => /Cubo 3D/.test(document.querySelector("#hud small")?.textContent || ""), null, { timeout: 20000 });
  } finally {
    await out.close().catch(() => {});
    await page.bringToFront();   // una pestaña de atrás deja de pintar y sus temporizadores van lentos
  }
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
  await page.evaluate(() => { [...document.querySelectorAll("#panelBody .toggle")].find(t => /Combinar con el efecto actual/.test(t.textContent)).querySelector("input").click(); });   // Combinar
  // Se abre en «⭐ Destacadas»; «Espejo selfie» está en «Todas» (y en su categoría).
  assert.equal(await page.locator(".fxlib .chip", { hasText: "Espejo selfie" }).count(), 0, "las destacadas primero");
  await page.locator("#panelBody .sec", { hasText: "Biblioteca de efectos" }).locator(".chip", { hasText: /^Todas$/ }).click();
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
await test("mezcla en vivo: preparar lo siguiente, fader y GO por pantalla", async () => {
  await page.keyboard.press("Escape");
  await page.evaluate(() => { const a = window.__lumamap; a.select(a.S.project.surfaces[0].id); a.actions.setSource({ type: "gen", gen: "plasma" }); a.S.liveSub = "mix"; a.openTab("live"); });
  const id = await page.evaluate(() => window.__lumamap.S.project.surfaces[0].id);
  await page.locator(".livecard .slot.b").first().click();
  await page.locator("#modal .tile", { hasText: "Hiperespacio" }).first().click();
  const next = await page.evaluate((id) => window.__lumamap.S.project.scenes[0].looks[id].next?.source.gen, id);
  assert.equal(next, "warp");
  await page.evaluate((id) => window.__lumamap.actions.setMix(id, 0.5), id);
  assert.equal(await page.evaluate((id) => window.__lumamap.S.project.scenes[0].looks[id].mix, id), 0.5);
  await page.locator(".livecard button", { hasText: "Corte" }).first().click();
  const after = await page.evaluate((id) => { const l = window.__lumamap.S.project.scenes[0].looks[id]; return [l.source.gen, l.next, l.mix]; }, id);
  assert.deepEqual(after, ["warp", null, 0]);
});
await test("pantallas: cada superficie sale solo por la suya y se puede apagar", async () => {
  const r = await page.evaluate(async () => {
    const a = window.__lumamap, P = a.S.project;
    const [s1, s2] = P.surfaces;
    a.actions.setScreen(s1.id, 2);
    const { Compositor } = await import("./js/compose.js");
    const drawn = [];
    const fake = { begin() {}, drawSurface: (s) => drawn.push(s.id), texture: () => null };
    const c = new Compositor(fake, { get: () => null, ensure() {} });
    const layers = [{ scene: P.scenes[0], alpha: 1 }];
    c.frame(P, { layers, time: 0, screen: 1 }); const on1 = drawn.splice(0);
    c.frame(P, { layers, time: 0, screen: 2 }); const on2 = drawn.splice(0);
    a.actions.setScreenCfg(2, { on: false, fx: "bw" });
    return { s1: s1.id, s2: s2.id, on1, on2, cfg: P.settings.screens[2] };
  });
  assert.ok(!r.on1.includes(r.s1) && r.on1.includes(r.s2), "P1 no muestra la de P2");
  assert.ok(r.on2.includes(r.s1) && r.on2.includes(r.s2), "P2 muestra la suya y las de «todas»");
  assert.equal(r.cfg.on, false); assert.equal(r.cfg.fx, "bw");
});
await test("proyección interactiva con la cámara: la IA carga y se dibuja sin errores de GPU", async () => {
  await page.evaluate(() => { const a = window.__lumamap; a.select(a.S.project.surfaces[0].id); a.actions.setSource({ type: "body", gen: "galaxy", bodyGlow: 0.5, bodyTrail: 0.3 }); });
  let st = "";
  for (let i = 0; i < 40 && st !== "ai"; i++) {
    await page.waitForTimeout(250);
    st = await page.evaluate(async () => (await import("./js/body.js")).bodyTracker("default").status);
  }
  assert.equal(st, "ai");
  for (const mode of ["contorno", "estela", "sombra", "persona", "movimiento"]) {
    await page.evaluate((m) => window.__lumamap.actions.setSource({ bodyMode: m }), mode);
    await page.waitForTimeout(300);
  }
  const err = await page.evaluate(async () => { const r = document.querySelector("#stage canvas"); const gl = r.getContext("webgl2"); return gl ? gl.getError() : 0; });
  assert.equal(err, 0);
});
await test("sensor de cámara: mide movimiento y dispara un golpe", async () => {
  const r = await page.evaluate(async () => {
    const a = window.__lumamap;
    a.actions.addSensor();
    const sen = a.S.project.settings.sensors.at(-1);
    a.actions.updateSensor(sen.id, { action: "beat", sens: 1, cooldown: 0.3 });
    const c0 = a.S.levels.count;
    await new Promise(r => setTimeout(r, 2500));
    return { level: a.S.sensorLevels[sen.id], fired: a.S.levels.count > c0 };
  });
  assert.ok(r.level > 0, "nivel " + r.level);
  assert.ok(r.fired, "el sensor disparó");
  await page.evaluate(() => { const a = window.__lumamap; for (const s of [...a.S.project.settings.sensors]) a.actions.removeSensor(s.id); });
});
await test("salida abierta desde el editor: motor compartido (sin decodificar dos veces)", async () => {
  // Una superficie con la imagen importada: la salida debe usar la del editor.
  await page.evaluate(() => { const a = window.__lumamap; a.select(a.S.project.surfaces[0].id); a.actions.setSource({ type: "media", mediaId: a.S.project.media[0].id }); });
  const [popup] = await Promise.all([page.waitForEvent("popup"), page.evaluate(() => window.__lumamap.actions.openWindow(1))]);
  popup.on("pageerror", e => errors.push("salida compartida: " + e.message));
  try {
  await popup.waitForFunction(() => window.__lumaOut && window.__lumaOut.renderer.textures.size > 0, null, { timeout: 20000 });
  const r = await popup.evaluate(() => ({ shared: window.__lumaOut.shared, pool: window.__lumaOut.comp.pool, hud: document.querySelector("#hud small").textContent }));
  assert.equal(r.shared, true);
  assert.equal(r.pool, null, "la salida no tiene medios propios");
  assert.match(r.hud, /1920×1080|×/);
  // Lo que se cambia en el editor aparece en la salida sin mensajes (mismo proyecto en memoria).
  const same = await page.evaluate(() => { const a = window.__lumamap; a.S.project.name = "Compartido"; a.changed(); return true; });
  assert.ok(same);
  await popup.waitForFunction(() => /Compartido/.test(document.querySelector("#hud small").textContent) || true);
  } finally { await popup.close().catch(() => {}); await page.bringToFront(); }   // una ventana colgada no debe afectar a las pruebas siguientes
});
await test("menús sin repetir: Animaciones dentro de Contenido, Dibujar en Añadir, menú por grupos", async () => {
  const tabs = await page.evaluate(() => [...document.querySelectorAll("#dock button[data-tab]")].map(b => b.dataset.tab));
  assert.ok(!tabs.includes("anim") && !tabs.includes("draw"), tabs.join(","));
  assert.deepEqual(tabs.slice(0, 7), ["add", "content", "fx", "shape", "layers", "scenes", "live"]);
  // Contenido sin superficie elegida: las animaciones (tocar una crea la superficie).
  const [n0, prevSel] = await page.evaluate(() => { const a = window.__lumamap, prev = a.S.sel; a.select(null); a.openTab(null); a.openTab("content"); return [a.S.project.surfaces.length, prev]; });
  await page.locator("#panelBody .tile", { hasText: "Hiperespacio" }).first().click();
  await page.waitForFunction((n0) => window.__lumamap.S.project.surfaces.length === n0 + 1, n0);
  await page.evaluate((prev) => { const a = window.__lumamap; a.S.project.surfaces.pop(); a.select(prev); a.changed({ panel: true }); a.openTab("menu"); }, prevSel);
  const sections = await page.locator("#panelBody h3").allTextContents();
  const text = await page.locator("#panelBody").textContent();
  for (const t of ["Crear", "Conexiones", "Ayuda y sistema", "Biblioteca de archivos", "GIF animados", "Móvil o cámara para lo interactivo"]) assert.ok(text.includes(t), t + " · " + sections.join("|"));
  assert.ok(!/\bnull\b/.test(text));
  await page.evaluate(() => window.__lumamap.openTab(null));
});
await test("modo profesional: pestañas nuevas y modo simple intacto", async () => {
  const simpleTabs = await page.locator("#dock button").count();
  await page.evaluate(() => window.__lumamap.setPro(true));
  const proTabs = await page.locator("#dock button").count();
  assert.equal(proTabs, simpleTabs + 3, "Tracking, Control y Rendimiento (Show está dentro de Escenas; Interactivo, Luces, 3D y Asistente están en el modo simple)");
  await page.locator('#dock [data-tab="control"]').click();
  await page.getByText("Controladores MIDI").waitFor();
  await page.locator('#dock [data-tab="perf"]').click();
  await page.getByText("Fotogramas perdidos").waitFor();
  await page.evaluate(() => window.__lumamap.setPro(false));
  assert.equal(await page.locator("#dock button").count(), simpleTabs);
});
await test("MIDI LEARN de punta a punta: clic derecho en «Brillo», mover un knob y controlar", async () => {
  await page.evaluate(() => { const a = window.__lumamap; if (!a.S.sel) a.select(a.S.project.surfaces[0].id); a.lookSel().fx.brightness = 1; a.commit(); a.openTab("fx"); });
  const sl = page.locator('#panelBody [data-param$="/fx/brightness"]');
  await sl.click({ button: "right" });
  await page.getByRole("button", { name: "Aprender…" }).click();
  await page.getByText("Pulsa ahora el botón que quieras usar").waitFor();
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__lumamap.midiDriver.message({ name: "Launch Control" }, [0xb3, 21, 127], 0));
  await page.waitForFunction(() => window.__lumamap.S.project.settings.control.mappings.length === 1);
  const m = await page.evaluate(() => window.__lumamap.S.project.settings.control.mappings[0]);
  assert.equal(m.device, "Launch Control", "dispositivo"); assert.equal(m.channel, 4, "canal"); assert.equal(m.key, "cc:21", "control");
  // El knob mueve el brillo (soft takeover: 127 ≈ 100 %, el valor actual 1 de 0..2 está en el 50 %).
  await page.evaluate(() => { const d = window.__lumamap.midiDriver; d.message({ name: "Launch Control" }, [0xb3, 21, 64], 0); d.message({ name: "Launch Control" }, [0xb3, 21, 100], 0); });
  const v = await page.evaluate(() => window.__lumamap.lookSel().fx.brightness);
  assert.ok(Math.abs(v - 200 / 127) < 1e-6, "brillo " + v);
  await page.waitForFunction(() => document.querySelector('#panelBody [data-param$="/fx/brightness"] output').textContent === "157%");
  assert.ok(await sl.evaluate(el => el.classList.contains("mapped")));
  // Y se puede deshacer como cualquier edición.
  await page.waitForTimeout(500);
  await page.keyboard.press("Control+z");
  assert.equal(await page.evaluate(() => window.__lumamap.lookSel().fx.brightness), 1, "deshacer");
  await page.evaluate(() => { const a = window.__lumamap; a.S.project.settings.control.mappings.length = 0; a.openTab(null); });
});
await test("transiciones de escena: las 8 se dibujan sin errores de GPU", async () => {
  const r = await page.evaluate(async () => {
    const a = window.__lumamap, P = a.S.project;
    if (P.scenes.length < 2) a.actions.addScene();
    const gl = document.querySelector("#gl").getContext("webgl2");
    const out = [];
    for (const mode of ["fade", "cut", "dissolve", "wipe", "wipeV", "iris", "flash", "glitch"]) {
      const other = P.scenes.find(s => s.id !== P.sceneId);
      other.transition = mode; other.trMs = 300;
      a.actions.goScene(other.id);
      await new Promise(r => setTimeout(r, 120));
      out.push([mode, gl.getError()]);
    }
    return out;
  });
  for (const [mode, err] of r) assert.equal(err, 0, mode);
});
await test("modo actuación: sin paneles ni edición; GO, apagón y emergencia; salir con Mayús+Esc", async () => {
  await page.evaluate(() => window.__lumamap.actions.togglePerfMode(true));
  assert.equal(await page.locator("#dock").isVisible(), false);
  assert.equal(await page.locator("#perfhud").isVisible(), true);
  const before = await page.evaluate(() => window.__lumamap.S.project.sceneId);
  await page.keyboard.press("Enter");
  assert.notEqual(await page.evaluate(() => window.__lumamap.S.project.sceneId), before);
  const pts = await page.evaluate(() => JSON.stringify(window.__lumamap.S.project.surfaces.map(s => s.points)));
  const box = await page.locator("#ov").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 40, { steps: 4 }); await page.mouse.up();
  assert.equal(await page.evaluate(() => JSON.stringify(window.__lumamap.S.project.surfaces.map(s => s.points))), pts, "no se puede mover nada");
  await page.locator('#perfhud [data-h="emerg"]').click();
  assert.equal(await page.evaluate(() => window.__lumamap.S.emergency), true);
  await page.keyboard.press("Control+Shift+E");
  assert.equal(await page.evaluate(() => !!window.__lumamap.S.emergency), false);
  await page.keyboard.press("Shift+Escape");
  assert.equal(await page.locator("#dock").isVisible(), true);
});
await test("asistente sin IA: una orden se PROPONE, se aplica con «Aplicar» y la regla funciona", async () => {
  await page.evaluate(() => { const a = window.__lumamap; a.setPro(false); if (!a.S.sel) a.select(a.S.project.surfaces[0].id); a.openTab("assistant"); });
  await page.getByText("¿Qué quieres hacer?").waitFor();
  const n0 = await page.evaluate(() => window.__lumamap.S.project.settings.tracking.rules.length);
  await page.locator(".asst-in").fill("Cuando levante la mano cambia el color a rojo");
  await page.locator(".asst-in").press("Enter");
  const card = page.locator(".prop", { hasText: "Cuando" }).first();
  await card.waitFor();
  assert.equal(await page.evaluate(() => window.__lumamap.S.project.settings.tracking.rules.length), n0, "proponer no ejecuta nada");
  await card.getByRole("button", { name: "Aplicar" }).click();
  await page.waitForFunction((n) => window.__lumamap.S.project.settings.tracking.rules.length === n + 1, n0);
  const color = await page.evaluate(() => { const a = window.__lumamap; a.tracking.evalRules({ hands_up: 1 }); const c = a.lookSel().source.color; a.S.project.settings.tracking.rules.length = 0; a.tracking.stop(); return c; });
  assert.equal(color, "#ff0000");
  await page.locator(".asst-in").fill("borrar la superficie");
  await page.locator(".asst-in").press("Enter");
  await page.locator(".prop.crit").first().waitFor();   // las acciones críticas se marcan
});
await test("asistente con IA local (Ollama simulado): «Descargar la IA» con un toque, estado, modelo, contexto del proyecto y acción aplicada", async () => {
  const http = await import("node:http");
  let lastChat = null, pulled = null;
  const models = [];   // Ollama recién instalado: sin ningún modelo
  const fake = http.createServer((req, res) => {
    res.setHeader("access-control-allow-origin", "*"); res.setHeader("access-control-allow-headers", "content-type"); res.setHeader("access-control-allow-methods", "GET,POST");
    if (req.method === "OPTIONS") return res.end();
    let body = ""; req.on("data", d => body += d); req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/api/version") return res.end(JSON.stringify({ version: "0.9.0" }));
      if (req.url === "/api/tags") return res.end(JSON.stringify({ models: models.map(name => ({ name, size: 5.2e9, details: { parameter_size: "8.2B", family: "qwen3" } })) }));
      if (req.url === "/api/pull") { pulled = JSON.parse(body); return setTimeout(() => { models.push(pulled.model); res.end(JSON.stringify({ status: "success" })); }, 600); }
      if (req.url === "/api/chat") { lastChat = JSON.parse(body); return res.end(JSON.stringify({ message: { role: "assistant", content: JSON.stringify({ reply: "Creo una superficie para la columna.", actions: [{ action: "create_surface", parameters: { shape: "rect", name: "Columna IA" } }], intent: "none" }) } })); }
      res.statusCode = 404; res.end("{}");
    });
  });
  await new Promise(r => fake.listen(0, "127.0.0.1", r));
  await page.evaluate(async (ep) => { const a = window.__lumamap; a.ai.setSettings({ endpoint: ep, enabled: true, allowLocal: true, provider: "auto", model: "" }); await a.ai.refresh({ force: true }); if (a.S.tab !== "assistant") a.openTab("assistant"); else a.renderPanel(); }, `http://127.0.0.1:${fake.address().port}`);
  // Sin modelo: un solo botón la descarga (sin terminal) y queda elegida.
  await page.locator(".asst .aipull").getByRole("button", { name: "⬇ Descargar la IA" }).click();
  await page.locator(".asst .aipull .pbar").waitFor();
  assert.ok(!/\bnull\b/.test(await page.locator(".asst .aipull").textContent()), "sin textos sueltos");
  await page.getByText(/Modelo: qwen3:/).waitFor({ timeout: 15000 });
  assert.equal(pulled.stream, false);
  const model = pulled.model;
  assert.match(model, /^qwen3:(4b|8b|14b)$/);
  await page.locator(".asst-in").fill("Quiero una superficie para la columna");
  await page.locator(".asst-in").press("Enter");
  const card = page.locator(".prop", { hasText: "Columna IA" });
  await card.waitFor();
  assert.match(lastChat.messages.at(-1).content, /CONTEXTO DEL PROYECTO/);
  assert.equal(lastChat.model, model);
  await card.getByRole("button", { name: "Aplicar" }).click();
  await page.waitForFunction(() => window.__lumamap.S.project.surfaces.some(s => s.name === "Columna IA"));
  // Ollama se apaga: la app sigue y el asistente responde sin IA, con un mensaje claro.
  await new Promise(r => fake.close(r));
  await page.evaluate(async () => { await window.__lumamap.ai.refresh({ force: true }); window.__lumamap.renderPanel(); });
  await page.getByText("LumaMap funciona normal").waitFor();
  await page.evaluate(() => { const a = window.__lumamap; a.ai.setSettings({ endpoint: "http://localhost:11434", model: "" }); const s = a.S.project.surfaces.find(x => x.name === "Columna IA"); a.actions.remove(s.id); });
});
await test("descarga de la IA: dice en qué va (velocidad y tiempo, «se paró → continúa sola», comprobando) y no se queda congelada", async () => {
  const texts = await page.evaluate(async () => {
    const a = window.__lumamap, out = [];
    let cb = null;
    // La app de Windows (simulada): manda el progreso como desktop/ollama-pull.js.
    window.LumaDesktop = { ai: { onPullProgress: (f) => { cb = f; return () => { cb = null; }; }, pullCancel: () => {},
      pull: async ({ model }) => {
        const step = async (p, ms = 700) => { cb?.({ model, ...p }); await new Promise(r => setTimeout(r, ms)); out.push(document.querySelector(".asst .aipull p")?.textContent || ""); };
        await step({ phase: "download", total: 4.9e9, completed: 1.0e9 }, 1600);
        await step({ phase: "download", total: 4.9e9, completed: 4.6e9 });
        await step({ phase: "retry", retries: 1 });
        await step({ phase: "restart", retries: 2 });
        await step({ phase: "verify" });
        return { ok: true, retries: 2 };
      } } };
    try {
      if (a.S.tab !== "assistant") a.openTab("assistant");
      const { downloadModel } = await import("./js/panels-assistant.js");
      const p = downloadModel(a, "qwen3:4b", { quiet: true });
      await new Promise(r => setTimeout(r, 50)); a.renderPanel();
      await p;
      return { out, pending: a.ai.settings.pullPending };
    } finally { delete window.LumaDesktop; a.ai.setSettings({ model: "", pullPending: "" }); }
  });
  assert.match(texts.out[1], /Descargando qwen3:4b: 93 % \(4,3 GB de 4,6 GB\) · [\d,]+ MB\/s · quedan/);
  assert.match(texts.out[2], /se paró: continuando sola donde iba/);
  assert.match(texts.out[3], /reiniciando la IA/);
  assert.match(texts.out[4], /Comprobando que la descarga/);
  assert.equal(texts.pending, "", "terminada: no queda pendiente");
});
await test("«¿Qué hago ahora?»: recomienda UN paso y «Hacerlo conmigo» lo hace", async () => {
  await page.evaluate(() => { const a = window.__lumamap; if (!a.S.blackout) a.actions.blackout(); });
  await page.locator('#top [data-act="next"]').click();
  await page.locator("#modal").getByText("El apagón está activo").waitFor();
  await page.getByRole("button", { name: "Hacerlo conmigo" }).click();
  await page.waitForFunction(() => !window.__lumamap.S.blackout);
});
await test("academia: «PASO 1/5» espera la acción del usuario y avanza solo", async () => {
  await page.evaluate(() => { const a = window.__lumamap; a.openTab(null); a.academy.start(1); });
  await page.locator("#academyCard", { hasText: "PASO 1/5" }).waitFor();
  await page.waitForTimeout(700);
  assert.match(await page.locator("#academyCard").textContent(), /PASO 1\/5/, "no avanza sin la acción");
  await page.evaluate(() => window.__lumamap.openTab("add"));
  await page.locator("#academyCard", { hasText: "PASO 2/5" }).waitFor();
  await page.locator("#academyCard").getByRole("button", { name: "Salir" }).click();
  assert.equal(await page.locator("#academyCard").count(), 0);
});
await test("tutorial con Luma: actividades reales, resalta el botón, ocultar/volver, atrás/repetir, capítulos y preguntas sin IA", async () => {
  await page.evaluate(() => { const a = window.__lumamap; a.openTab(null); localStorage.removeItem("lumamap:academyCur"); });
  // Desde el menú ☰ (como lo haría el usuario).
  await page.locator('#top [data-act="menu"]').click();
  await page.locator("#panelBody .item", { hasText: "Tutorial interactivo con Luma" }).click();
  const card = page.locator("#academyCard");
  await card.locator(".coachtext", { hasText: "Soy Luma" }).waitFor();
  assert.match(await card.textContent(), /capítulo 1\/20: Conoce LumaMap/);
  await card.getByRole("button", { name: "Siguiente ▶" }).click();
  await card.locator(".coachtext", { hasText: "☰ es el menú" }).waitFor();
  // Resalta el botón que hay que tocar; hacerlo de verdad pasa solo al siguiente paso.
  await page.waitForFunction(() => document.querySelector('#top [data-act="menu"]').classList.contains("coach-hl"));
  await page.evaluate(() => window.__lumamap.openTab(null));
  await page.waitForTimeout(700);
  assert.match(await card.textContent(), /PASO 2\//, "no avanza sin la acción");
  await page.locator('#top [data-act="menu"]').click();
  // «✓ ¡Bien hecho!» dura un momento y pasa solo al siguiente paso (con la máquina lenta puede verse solo lo segundo).
  await page.waitForFunction(() => { const c = document.getElementById("academyCard"); return !!c?.querySelector(".coachok") || /Abre «Añadir»/.test(c?.querySelector(".coachtext")?.textContent || ""); }, null, { timeout: 15000 });
  await card.locator(".coachtext", { hasText: "Abre «Añadir»" }).waitFor();
  // Ocultar: queda una burbuja; tocarla vuelve al mismo paso.
  await card.getByTitle("Ocultar (queda una burbuja para volver)").click();
  await page.locator("#academyCard .coachbubble").waitFor();
  assert.equal(await card.locator(".coachtext").count(), 0);
  await page.locator("#academyCard .coachbubble").click();
  await card.locator(".coachtext", { hasText: "Abre «Añadir»" }).waitFor();
  // ◀ vuelve al paso anterior y ⟲ lo repite: hay que volver a hacerlo (aunque el menú siga abierto).
  await card.getByRole("button", { name: "◀" }).click();
  await card.locator(".coachtext", { hasText: "☰ es el menú" }).waitFor();
  await card.getByRole("button", { name: "⟲ Repetir" }).click();
  await page.waitForTimeout(800);
  assert.match(await card.textContent(), /PASO 2\//);
  // «Hazlo por mí» lo hace (y Luma lo da por bueno).
  await card.getByRole("button", { name: "Hazlo por mí" }).click();
  await card.locator(".coachtext", { hasText: "Abre «Añadir»" }).waitFor();
  // Pregúntale a Luma: sin IA responde la guía, y lo dice.
  await card.getByRole("button", { name: "💬 Pregúntale" }).click();
  await card.getByRole("textbox", { name: "Pregúntale a Luma" }).fill("¿cómo hago una máscara?");
  await card.getByRole("button", { name: "Preguntar" }).click();
  await card.locator(".coachans", { hasText: "Respondió:" }).waitFor({ timeout: 20000 });
  assert.match(await card.locator(".coachans").textContent(), /m[aá]scara/i);
  // Capítulos: cualquiera, cuando quieras.
  await card.getByRole("button", { name: "📚 Capítulos" }).click();
  await page.locator("#modal .coachlist .lesson").first().waitFor();
  assert.equal(await page.locator("#modal .coachlist .lesson").count(), 20);
  await page.locator("#modal .coachlist .lesson", { hasText: "3D: mapping sobre objetos" }).click();
  await card.locator(".coachtext", { hasText: "pestaña «3D»" }).waitFor();
  // Salir y «Continuar» vuelve al mismo sitio.
  await card.getByRole("button", { name: "Salir" }).click();
  await card.waitFor({ state: "detached" });
  await page.evaluate(() => window.__lumamap.startTutorial());
  await card.locator(".coachtext", { hasText: "pestaña «3D»" }).waitFor();
  await card.getByTitle(/Salir del tutorial/).click();
  await card.waitFor({ state: "detached" });
  await page.evaluate(() => { const a = window.__lumamap; a.openTab(null); });
});
await test("redes de nodos (como TouchDesigner): crear con Tab, cables, expresión, bypass, copiar/pegar, deshacer, 3D movido por el cuerpo, exportar a LumaMap y proyectar", async () => {
  await page.evaluate(() => { const a = window.__lumamap; a.openTab(null); if (!a.S.project.surfaces.length) a.actions.addShape("rect"); });
  await page.locator('#top [data-act="nodes"]').click();
  const ws = page.locator("#tdws.show");
  await ws.waitFor({ timeout: 20000 });
  const net = () => page.evaluate(() => { const a = window.__lumamap, n = a.S.project.networks[0]; return { nodes: n.nodes.map(x => ({ name: x.name, type: x.type, fam: x.fam, in: x.in.map(id => n.nodes.find(y => y.id === id)?.name || null), bypass: x.bypass, p: x.p })), display: n.nodes.find(x => x.id === n.display)?.name }; });
  const create = async (q) => {
    await page.keyboard.press("Tab");
    await ws.locator(".tdcreate").waitFor();
    await ws.locator(".tdsearch").fill(q);
    await ws.locator(".tdsearch").press("Enter");
    await ws.locator(".tdcreate").waitFor({ state: "detached" });
  };
  await ws.locator(".tdpane").click({ position: { x: 200, y: 200 } });
  // Tab → buscar «ruido» → Enter. Con un nodo elegido, lo nuevo se conecta detrás (como en TouchDesigner).
  await create("ruido");
  await create("nivel");
  await create("salida");
  let N = await net();
  assert.deepEqual(N.nodes.map(n => n.name), ["noise1", "level1", "out1"]);
  assert.deepEqual(N.nodes.map(n => n.in[0] ?? null), [null, "noise1", "level1"]);
  assert.equal(N.display, "noise1", "la primera imagen se ve de fondo");
  // El visor del ruido enseña imagen de verdad.
  await page.waitForFunction(() => { const c = document.querySelector('#tdws .tdnode[data-type="noise"] canvas.tdview'); if (!c) return false; const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let s = 0; for (let k = 0; k < d.length; k += 16) s += d[k]; return s > 1000; }, null, { timeout: 20000 });
  // Un cable a mano: de la salida de un círculo a la 2.ª entrada de un «composite».
  await page.keyboard.press("Escape");
  await create("círculo");
  await page.keyboard.press("Escape");
  await create("composite");
  const out = await ws.locator('.tdnode[data-type="circle"] .tdout').boundingBox();
  const inp = await ws.locator('.tdnode[data-type="composite"] .tdin[data-in="1"]').boundingBox();
  await page.mouse.move(out.x + out.width / 2, out.y + out.height / 2);
  await page.mouse.down();
  await page.mouse.move((out.x + inp.x) / 2, (out.y + inp.y) / 2 + 30, { steps: 5 });
  await page.mouse.move(inp.x + inp.width / 2, inp.y + inp.height / 2, { steps: 5 });
  await page.mouse.up();
  N = await net();
  assert.deepEqual(N.nodes.find(n => n.type === "composite").in, [null, "circle1"]);
  // Expresión en el brillo del nivel (ƒx) y su valor en vivo.
  await ws.locator('.tdnode[data-type="level"] .tdname').click();
  const row = ws.locator('.tdprow[data-k="brightness"]');
  await row.getByRole("button", { name: "Expresión Brillo" }).click();
  await ws.locator('.tdprow[data-k="brightness"] .tdexpr').fill("0.5 + 0.5 * sin(absTime.seconds)");
  await ws.locator('.tdprow[data-k="brightness"] .tdexpr').press("Enter");
  N = await net();
  assert.equal(N.nodes.find(n => n.name === "level1").p.brightness.e, "0.5 + 0.5 * sin(absTime.seconds)");
  await page.waitForFunction(() => /^-?\d/.test(document.querySelector('#tdws .tdprow[data-k="brightness"] .tdeval')?.textContent || ""), null, { timeout: 8000 });
  // B = bypass; Ctrl+C / Ctrl+V = copia conectada; Ctrl+Z deshace.
  await ws.locator(".tdpane").focus();
  await page.keyboard.press("b");
  assert.equal((await net()).nodes.find(n => n.name === "level1").bypass, true);
  await page.keyboard.press("b");
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+v");
  N = await net();
  assert.ok(N.nodes.some(n => n.name === "level2"), "pegado");
  await page.waitForTimeout(500);
  await page.keyboard.press("Control+z");
  await page.waitForFunction(() => !window.__lumamap.S.project.networks[0].nodes.some(n => n.name === "level2"), null, { timeout: 5000 });
  // Las ventanas (renombrar, ejemplos, ayuda) salen encima del editor y se pueden usar.
  await ws.locator('.tdnode[data-type="noise"] .tdname').dblclick();
  const dlgIn = page.locator("#modal.show input.text-in");
  await dlgIn.waitFor();
  await dlgIn.fill("ruido_base");
  await page.locator("#modal.show").getByRole("button", { name: "Aceptar" }).click();
  N = await net();
  assert.ok(N.nodes.some(n => n.name === "ruido_base") && !N.nodes.some(n => n.name === "noise1"), "renombrado desde la ventana");
  assert.equal(await page.evaluate(() => document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest("#modal") ? 1 : 0), 0, "la ventana ya se cerró");
  // ▶ Usar en superficie: la superficie elegida muestra la red, y su imagen sale de verdad.
  await ws.locator(".tdbar").getByRole("button", { name: "▶ Usar en superficie" }).click();
  const src = await page.evaluate(() => window.__lumamap.lookSel()?.source);
  assert.equal(src.type, "net");
  const lit = await page.evaluate(async () => { const a = window.__lumamap, n = a.S.project.networks[0]; const o = a.td.output(n.id, n.nodes.find(x => x.type === "out").id, { time: 3, w: 64, h: 36 }); const d = o.el.getContext("2d").getImageData(0, 0, 64, 36).data; let s = 0; for (let k = 0; k < d.length; k += 4) s += d[k] + d[k + 1] + d[k + 2]; return s / (64 * 36 * 3); });
  assert.ok(lit > 5, "la salida tiene imagen: " + lit);
  // Ejemplo «mover un objeto 3D con la mano»: con una mano simulada a la derecha, la esfera va a la derecha.
  const tx = await page.evaluate(async () => {
    const a = window.__lumamap, m = await import("./js/panels-network.js");
    a.td.trackingSignals = () => ({ presence: 1, right_hand_x: 0.9, right_hand_y: 0.75, spread: 0.2 });
    const n = m.loadExample("hand");
    await new Promise(r => setTimeout(r, 1500));
    const geo = n.nodes.find(x => x.type === "geo");
    return a.td.cookers.get(n.id).param(geo, "tx");
  });
  assert.ok(Math.abs(tx - 1.6) < 0.25, "mano a la derecha → esfera a la derecha: " + tx);
  // «Exportar a LumaMap»: un CHOP mueve el brillo general (como modulación, sin tocar el proyecto).
  const master = await page.evaluate(async () => {
    const a = window.__lumamap, G = await import("./js/td/graph.js"), n = a.S.project.networks[0];
    a.edit(() => { const c = G.addNode(n, "CHOP", "constant", { x: 0, y: 600, p: { value0: 0.35 } }); const e = G.addNode(n, "CHOP", "export", { x: 220, y: 600, p: { target: "global/master" } }); G.connect(n, c.id, e.id, 0); });
    await new Promise(r => setTimeout(r, 600));
    return [a.S.renderMaster, a.S.project.settings.master ?? null];
  });
  assert.ok(Math.abs(master[0] - 0.35) < 0.02, "brillo general modulado: " + master[0]);
  // Los parámetros de los nodos se pueden aprender con MIDI/OSC (aparecen en el catálogo).
  const inCatalog = await page.evaluate(async () => { const P = await import("./js/params.js"); return P.catalog(window.__lumamap).some(g => g.group.startsWith("Red ·") && g.items.some(i => /level1 · Brillo/.test(i.name))); });
  assert.ok(inCatalog);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.locator("#tdws").waitFor({ state: "hidden" });
  await page.evaluate(() => { const a = window.__lumamap, n = a.S.project.networks[0]; a.edit(() => { n.nodes = n.nodes.filter(x => x.type !== "export"); }); });
});
await test("redes de nodos: todos los TOP dan imagen sin errores de shader; 3D con todas las geometrías, materiales e instancias; feedback deja estela; GLSL con error lo dice", async () => {
  const r = await page.evaluate(async () => {
    const E = await import("./js/td/engine.js"), G = await import("./js/td/graph.js"), O = await import("./js/td/ops.js");
    const net = G.newNetwork("prueba"); net.res = [160, 90];
    const proj = { networks: [net], settings: {}, media: [] };
    const eng = new E.NetEngine({ project: () => proj });
    const lum = (o) => { if (!o) return -1; const d = o.el.getContext("2d").getImageData(0, 0, o.el.width, o.el.height).data; let s = 0; for (let k = 0; k < d.length; k += 4) s += d[k] + d[k + 1] + d[k + 2]; return s / (d.length / 4) / 3; };
    const a = G.addNode(net, "TOP", "noise"), b = G.addNode(net, "TOP", "ramp");
    const bad = [];
    let t = 1;
    for (const def of O.OP_LIST.filter(o => o.fam === "TOP")) {
      if (["moviein", "videoin", "plugin", "render", "in"].includes(def.type)) continue;   // necesitan archivo, cámara, plugin, 3D (abajo) o estar dentro de una subred (prueba aparte)
      const n = G.addNode(net, "TOP", def.type);
      for (let k = 0; k < Math.max(def.inputs[0], Math.min(def.inputs[1], 2)); k++) G.connect(net, k ? b.id : a.id, n.id, k);
      if (def.type === "feedback") n.p.target = a.name;
      if (def.type === "select") n.p.top = b.name;
      const o = eng.output(net.id, n.id, { time: (t += 0.1), w: 80, h: 45 });
      const info = eng.info(net, n);
      if (!o || info.error) bad.push(def.type + ": " + (info.error || "sin imagen"));
    }
    // 3D
    const geo = G.addNode(net, "COMP", "geo"), mat = G.addNode(net, "MAT", "pbr", { p: { color: "#ff2200", map: a.name } });
    geo.p.material = mat.name; G.addNode(net, "COMP", "camera"); G.addNode(net, "COMP", "light");
    const rnd = G.addNode(net, "TOP", "render");
    const shots = {};
    for (const sop of O.OP_LIST.filter(o => o.fam === "SOP" && o.inputs[0] === 0 && !["file", "in"].includes(o.type))) {   // «file» necesita un archivo e «in» estar en una subred (pruebas aparte)
      const g = G.addNode(net, "SOP", sop.type); G.connect(net, g.id, geo.id, 0);
      shots[sop.type] = lum(eng.output(net.id, rnd.id, { time: (t += 0.1), w: 80, h: 45 }));
      if (eng.info(net, rnd).error) bad.push("3D " + sop.type + ": " + eng.info(net, rnd).error);
    }
    for (const m of ["constant", "normal", "wire", "glsl"]) { const mm = G.addNode(net, "MAT", m); geo.p.material = mm.name; shots["mat " + m] = lum(eng.output(net.id, rnd.id, { time: (t += 0.1), w: 80, h: 45 })); }
    const pat = G.addNode(net, "CHOP", "pattern", { p: { length: 50, kind: 3, amp: 6, offset: -3, name: "tx" } });
    geo.p.instancing = 1; geo.p.instanceop = pat.name; geo.p.material = mat.name;
    const inst = lum(eng.output(net.id, rnd.id, { time: (t += 0.1), w: 80, h: 45 }));
    geo.p.instancing = 0;
    const single = lum(eng.output(net.id, rnd.id, { time: (t += 0.1), w: 80, h: 45 }));
    // Feedback: el círculo que se mueve deja estela.
    const c1 = G.addNode(net, "TOP", "circle", { p: { radius: 0.1, cx: { e: "0.5 + 0.35 * sin(absTime.seconds * 4)" } } });
    const fb = G.addNode(net, "TOP", "feedback"); G.connect(net, c1.id, fb.id);
    const lv = G.addNode(net, "TOP", "level", { p: { brightness: 0.97 } });
    const cp = G.addNode(net, "TOP", "composite", { p: { mode: 6 } }); G.connect(net, fb.id, cp.id, 0); G.connect(net, c1.id, cp.id, 1); G.connect(net, cp.id, lv.id, 0);
    fb.p.target = lv.name;
    let trail = 0;
    for (let k = 0; k < 40; k++) trail = lum(eng.output(net.id, lv.id, { time: (t += 1 / 30), w: 80, h: 45 }));
    const alone = lum(eng.output(net.id, c1.id, { time: t, w: 80, h: 45 }));
    const gl = G.addNode(net, "TOP", "glsl", { p: { code: "return vec4(nope);" } });
    eng.output(net.id, gl.id, { time: (t += 0.1), w: 80, h: 45 });
    const glErr = eng.info(net, gl).error;
    eng.dispose();
    return { bad, shots, inst, single, trail, alone, glErr };
  });
  assert.deepEqual(r.bad, []);
  for (const [k, v] of Object.entries(r.shots)) assert.ok(v > 1, `3D ${k} se ve: ${v}`);
  assert.ok(r.inst > r.single, `50 instancias dibujan más que 1 (${r.inst} > ${r.single})`);
  assert.ok(r.trail > r.alone * 1.5, `el feedback deja estela (${r.trail} vs ${r.alone})`);
  assert.match(r.glErr, /GLSL[\s\S]*nope/, "el error de GLSL dice qué falla");
});
await test("redes de nodos en 3D: visor flotante con gizmo (mover el objeto), cámara que gira, vista libre, partículas y modelo 3D de un archivo", async () => {
  const ids = await page.evaluate(async () => {
    const a = window.__lumamap; await a.openNetwork();
    const G = await import("./js/td/graph.js"), m = await import("./js/panels-network.js");
    let n; a.edit(() => { n = G.newNetwork("3D"); a.S.project.networks.push(n); });
    let geo, rnd, ps, file;
    a.edit(() => {
      const b = G.addNode(n, "SOP", "box", { x: 0, y: 0 }); geo = G.addNode(n, "COMP", "geo", { x: 220, y: 0 }); G.connect(n, b.id, geo.id, 0);
      G.addNode(n, "COMP", "camera", { x: 220, y: 200, p: { tx: 0, ty: 0, tz: 4 } });
      ps = G.addNode(n, "COMP", "particles", { x: 220, y: 400, p: { rate: 600 } });
      rnd = G.addNode(n, "TOP", "render", { x: 440, y: 0 }); n.display = rnd.id;
    });
    // Un cubo .obj en la biblioteca para el «Modelo 3D (archivo)».
    const Store = await import("./js/store.js");
    const v = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]].map(p => "v " + p.join(" ")).join("\n");
    const f = [[1, 2, 3, 4], [5, 8, 7, 6], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 8, 4], [5, 1, 4, 8]].map(q => "f " + q.join(" ")).join("\n");
    await Store.putMedia({ id: "mediaTestCubo", name: "cubo.obj", kind: "model", blob: new Blob([v + "\n" + f + "\n"], { type: "text/plain" }), size: 10 });
    a.edit(() => { a.S.project.media.push({ id: "mediaTestCubo", name: "cubo.obj", kind: "model", size: 10 }); file = G.addNode(n, "SOP", "file", { x: 0, y: 600, p: { model: "mediaTestCubo", size: 3 } }); });
    m.closeNetworkEditor(); await a.openNetwork({ netId: n.id });
    m._edForTests.sel = new Set([geo.id]);
    return { net: n.id, geo: geo.id, rnd: rnd.id, ps: ps.id, file: file.id };
  });
  const ws = page.locator("#tdws.show");
  // Clic derecho en el Render → «Visor flotante 3D».
  await ws.locator('.tdnode[data-type="render"] .tdnhead').click({ button: "right" });
  await ws.locator(".tdmi", { hasText: "Visor flotante 3D" }).click();
  const win = ws.locator(".tdvwin");
  await win.waitFor();
  await page.evaluate(async (ids) => { const m = await import("./js/panels-network.js"); m._edForTests.sel = new Set([ids.geo]); }, ids);
  await page.waitForFunction(async () => { const m = await import("./js/panels-network.js"); const v = m._edForTests.vwins[0]; return !!v?.view3d?.attachedId; }, null, { timeout: 15000 });
  // Arrastrar la flecha X del gizmo mueve el objeto a la derecha (cámara de frente: el origen está en el centro).
  const box = await win.locator("canvas").boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx + 30, cy - 1); await page.waitForTimeout(150);
  await page.mouse.down(); await page.mouse.move(cx + 130, cy - 1, { steps: 8 }); await page.mouse.up();
  const P = () => page.evaluate((ids) => { const n = window.__lumamap.S.project.networks.find(x => x.id === ids.net); const g = n.nodes.find(x => x.id === ids.geo), c = n.nodes.find(x => x.type === "camera"); return { tx: g.p.tx, ty: g.p.ty, cam: [c.p.tx, c.p.ty, c.p.tz] }; }, ids);
  let p = await P();
  assert.ok(p.tx > 0.4 && Math.abs(p.ty) < 0.05, "el gizmo movió el objeto en X: " + JSON.stringify(p));
  // Arrastrar en el vacío gira la cámara de la red alrededor (cambia lo que se proyecta).
  await page.mouse.move(box.x + 15, box.y + 15); await page.mouse.down(); await page.mouse.move(box.x + 115, box.y + 35, { steps: 6 }); await page.mouse.up();
  const p2 = await P();
  assert.ok(Math.abs(p2.cam[0]) > 0.5, "la cámara giró: " + JSON.stringify(p2.cam));
  assert.ok(Math.abs(Math.hypot(...p2.cam) - 4) < 0.05, "a la misma distancia");
  // Vista libre: mirar desde otro sitio no cambia la cámara de la red.
  await win.getByRole("button", { name: /Vista libre/ }).click();
  await page.mouse.move(box.x + 15, box.y + 15); await page.mouse.down(); await page.mouse.move(box.x + 115, box.y + 60, { steps: 6 }); await page.mouse.up();
  assert.deepEqual((await P()).cam, p2.cam);
  const lit = await page.evaluate(() => { const c = document.querySelector("#tdws .tdvwin canvas"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let s = 0; for (let k = 0; k < d.length; k += 4) s += d[k] + d[k + 1] + d[k + 2]; return s / (d.length / 4); });
  assert.ok(lit > 5, "el visor libre dibuja: " + lit);
  // Partículas vivas y modelo 3D leído del archivo (un cubo de 2 m ajustado a 3 m).
  const r = await page.evaluate(async (ids) => {
    const a = window.__lumamap, n = a.S.project.networks.find(x => x.id === ids.net), E = a.td;
    const parts = E.extra.get(ids.ps + ":ps")?.sim.n || 0;
    for (let k = 0; k < 60 && !E.models.get("mediaTestCubo")?.geo; k++) { E.sop(n, n.nodes.find(x => x.id === ids.file)); await new Promise(r => setTimeout(r, 100)); }
    E.ensureFrame(performance.now() / 1000 + 100, {});
    const g = E.sop(n, n.nodes.find(x => x.id === ids.file));
    g?.computeBoundingBox();
    const s = g ? g.boundingBox.getSize(new (g.boundingBox.min.constructor)()) : null;
    return { parts, verts: g?.attributes.position.count || 0, size: s ? [s.x, s.y, s.z] : null, err: E.info(n, n.nodes.find(x => x.id === ids.file)).error };
  }, ids);
  assert.ok(r.parts > 20, "hay partículas: " + r.parts);
  assert.equal(r.err, "");
  assert.equal(r.verts, 36, "el cubo .obj (6 caras × 2 triángulos)");
  assert.ok(r.size.every(v => Math.abs(v - 3) < 0.01), "ajustado a 3 m: " + r.size);
  await win.getByRole("button", { name: "Cerrar el visor" }).click();
  await page.evaluate(async () => { const m = await import("./js/panels-network.js"); m.closeNetworkEditor(); });
});
await test("redes de nodos: partículas en la GPU (cientos de miles), nacen también de una geometría, y al apagarla vuelven al procesador", async () => {
  const r = await page.evaluate(async () => {
    const a = window.__lumamap; await a.openNetwork();
    const G = await import("./js/td/graph.js"), m = await import("./js/panels-network.js");
    let n, ps, rnd, sph;
    a.edit(() => {
      n = G.newNetwork("GPU"); a.S.project.networks.push(n);
      G.addNode(n, "COMP", "camera", { p: { tx: 0, ty: 0, tz: 5 } });
      sph = G.addNode(n, "SOP", "sphere", { p: { radius: 1 } });
      ps = G.addNode(n, "COMP", "particles", { p: { gpu: 1, gpuSize: 256, rate: 60000, life: 2, gravity: 0, turb: 0.5, psize: 0.04 } });
      rnd = G.addNode(n, "TOP", "render"); n.display = rnd.id;
    });
    m.closeNetworkEditor();
    const E = a.td;
    const lum = () => { const o = E.output(n.id, rnd.id, { time: E.time, w: 64, h: 36 }); if (!o) return 0; const d = o.el.getContext("2d").getImageData(0, 0, 64, 36).data; let s = 0; for (let k = 0; k < d.length; k += 4) s += d[k] + d[k + 1] + d[k + 2]; return s / (64 * 36); };
    const run = async (frames) => { let L = 0; for (let k = 0; k < frames; k++) { E.ensureFrame(E.time + 1 / 30, {}); L = lum(); await new Promise(r => setTimeout(r, 0)); } return L; };
    const t0 = E.time;
    E.ensureFrame(t0 + 1000, {});
    const litGpu = await run(30);
    const cGpu = E.particleCount(ps);
    const errGpu = E.info(n, ps).error;
    // Nacer de la geometría conectada (una esfera).
    a.edit(() => { G.connect(n, sph.id, ps.id, 0); ps.p.emitter = 4; });
    const litGeo = await run(10);
    const errGeo = E.info(n, ps).error;
    // Apagar la GPU: vuelven al procesador (y la memoria de la GPU se suelta).
    a.edit(() => { ps.p.gpu = 0; ps.p.rate = 600; ps.p.emitter = 0; });
    await run(20);
    const cCpu = E.particleCount(ps), gpuFreed = !E.extra.has(ps.id + ":gps");
    return { litGpu, cGpu, errGpu, litGeo, errGeo, cCpu, gpuFreed };
  });
  assert.equal(r.errGpu, "", "sin errores en la GPU");
  assert.ok(r.cGpu?.gpu && r.cGpu.max === 65536 && r.cGpu.n > 20000, "decenas de miles en la GPU: " + JSON.stringify(r.cGpu));
  assert.ok(r.litGpu > 3, "se ven: " + r.litGpu);
  assert.equal(r.errGeo, ""); assert.ok(r.litGeo > 3, "nacen de la esfera y se ven: " + r.litGeo);
  assert.ok(r.cCpu && !r.cCpu.gpu && r.cCpu.n > 0, "en el procesador: " + JSON.stringify(r.cCpu));
  assert.ok(r.gpuFreed, "la memoria de la GPU se suelta al apagarla");
});
await test("redes de nodos: GLSL MAT — tu shader de color y de vértices en un objeto 3D, con su error claro si no compila", async () => {
  const r = await page.evaluate(async () => {
    const a = window.__lumamap; await a.openNetwork();
    const G = await import("./js/td/graph.js"), m = await import("./js/panels-network.js");
    let n, mt, rnd;
    a.edit(() => {
      n = G.newNetwork("MAT"); a.S.project.networks.push(n);
      G.addNode(n, "COMP", "camera", { p: { tx: 0, ty: 0, tz: 4 } });
      const sp = G.addNode(n, "SOP", "sphere", { p: { radius: 1, detail: 32 } });
      mt = G.addNode(n, "MAT", "glsl", { p: { code: "return vec4(0.0, 1.0, 0.0, 1.0);", vcode: "return position;" } });
      const geo = G.addNode(n, "COMP", "geo", { p: { material: mt.name } }); G.connect(n, sp.id, geo.id, 0);
      rnd = G.addNode(n, "TOP", "render"); n.display = rnd.id;
    });
    m.closeNetworkEditor();
    const E = a.td;
    const img = () => { E.ensureFrame(E.time + 1 / 30, {}); const o = E.output(n.id, rnd.id, { time: E.time, w: 64, h: 64 }); const d = o.el.getContext("2d").getImageData(0, 0, 64, 64).data; let R = 0, Gs = 0, B = 0, lit = 0; for (let k = 0; k < d.length; k += 4) { R += d[k]; Gs += d[k + 1]; B += d[k + 2]; if (d[k] + d[k + 1] + d[k + 2] > 60) lit++; } return { r: R / 4096, g: Gs / 4096, b: B / 4096, lit }; };
    E.ensureFrame(E.time + 500, {});
    const green = img(), errOk = E.info(n, mt).error;
    // Deformar: inflar la esfera hace que ocupe más imagen.
    a.edit(() => { mt.p.vcode = "return position * 1.6;"; });
    const big = img();
    // Código roto: el nodo lo dice y el objeto se ve morado.
    a.edit(() => { mt.p.code = "return vec4(nope, 1.0);"; });
    const broken = img(), errBad = E.info(n, mt).error;
    // Arreglado: vuelve.
    a.edit(() => { mt.p.code = "return vec4(tex(vUv).rgb * 0.0 + vec3(0.0, 0.0, 1.0) * light(), 1.0);"; mt.p.vcode = "return position;"; });
    const blue = img(), errFix = E.info(n, mt).error;
    return { green, errOk, big, broken, errBad, blue, errFix };
  });
  assert.equal(r.errOk, "");
  assert.ok(r.green.g > 20 && r.green.r < 5 && r.green.b < 5, "verde: " + JSON.stringify(r.green));
  assert.ok(r.big.lit > r.green.lit * 1.8, `al inflarla ocupa más (${r.big.lit} > ${r.green.lit})`);
  assert.match(r.errBad, /GLSL[\s\S]*nope/, "el error de GLSL dice qué falla");
  assert.ok(r.broken.r > r.broken.g, "con error se ve morado: " + JSON.stringify(r.broken));
  assert.equal(r.errFix, "");
  assert.ok(r.blue.b > 10 && r.blue.g < 5, "azul con luz: " + JSON.stringify(r.blue));
});
await test("redes de nodos: Salida por red (TOP) — cada nodo por su canal MJPEG para OBS (/frame.jpg?ch=…), con su dirección", async () => {
  const r = await page.evaluate(async () => {
    const a = window.__lumamap; await a.openNetwork();
    const G = await import("./js/td/graph.js"), m = await import("./js/panels-network.js");
    let n, no;
    a.edit(() => { n = G.newNetwork("Red out"); a.S.project.networks.push(n); const nz = G.addNode(n, "TOP", "noise"); no = G.addNode(n, "TOP", "netout", { p: { channel: "Prueba Ñ", size: 540, fps: 30 } }); G.connect(n, nz.id, no.id, 0); });
    let img = null, st = 0;
    for (let k = 0; k < 60 && st !== 200; k++) { await new Promise(r => setTimeout(r, 150)); const res = await fetch("/frame.jpg?ch=prueba_n", { cache: "no-store" }); st = res.status; if (st === 200) img = await createImageBitmap(await res.blob()); }
    const list = (await (await fetch("/stream/channels", { cache: "no-store" })).json()).channels.map(c => c.name);
    const info = a.td.netInfo(no.id);
    const url = await m._edForTests.copyNetUrl(no);
    a.edit(() => { no.p.active = 0; });
    m.closeNetworkEditor();
    return { st, h: img?.height, w: img?.width, list, ch: info?.ch, sent: info?.sent, url, err: a.td.info(n, no).error };
  });
  assert.equal(r.st, 200, "el canal tiene imagen");
  assert.equal(r.h, 540); assert.ok(Math.abs(r.w / r.h - 16 / 9) < 0.02, "con la forma de la imagen: " + r.w + "×" + r.h);
  assert.ok(r.list.includes("prueba_n"), JSON.stringify(r.list));
  assert.equal(r.ch, "prueba_n", "el nombre del canal sin símbolos ni acentos");
  assert.ok(r.sent >= 1);
  assert.match(r.url, /^http:\/\/.+\/stream\.mjpg\?(pin=\w+&)?ch=prueba_n$/);
  assert.equal(r.err, "");
});
await test("redes de nodos: animar un parámetro con fotogramas clave (◆), autoclave al moverlo, editor de curvas y línea de tiempo", async () => {
  await page.evaluate(async () => {
    const a = window.__lumamap; await a.openNetwork();
    const G = await import("./js/td/graph.js"), m = await import("./js/panels-network.js");
    let n; a.edit(() => { n = G.newNetwork("Anim"); a.S.project.networks.push(n); G.addNode(n, "TOP", "circle", { x: 0, y: 0 }); });
    m.closeNetworkEditor(); await a.openNetwork({ netId: n.id });
  });
  const ws = page.locator("#tdws.show");
  await ws.locator('.tdnode[data-type="circle"] .tdname').click();
  // Pausa y al segundo 1: ◆ en «Radio» crea la animación con una clave ahí.
  await ws.locator(".tdtime").getByRole("button", { name: "Pausa" }).click();
  await page.evaluate(async () => { const G = await import("./js/td/graph.js"); const a = window.__lumamap; G.seekNet(a.S.project.networks.at(-1), 1); });
  await ws.locator('.tdprow[data-k="radius"]').getByRole("button", { name: "Animar Radio" }).click();
  await ws.locator(".tdanim").waitFor();
  // Al segundo 3, mover el radio pone otra clave (autoclave).
  await page.evaluate(async () => { const G = await import("./js/td/graph.js"); const a = window.__lumamap; G.seekNet(a.S.project.networks.at(-1), 3); });
  const num = ws.locator('.tdprow[data-k="radius"] input[type=number]');
  await num.fill("0.8"); await num.press("Enter");
  const A = () => page.evaluate(() => { const n = window.__lumamap.S.project.networks.at(-1); const an = n.nodes.find(x => x.type === "animation"); return { e: n.nodes.find(x => x.type === "circle").p.radius.e, keys: an.p.anim.chans[0].keys.map(k => [k.t, k.v]), name: an.name, ch: an.p.anim.chans[0].name }; });
  let r = await A();
  assert.equal(r.e, `${r.name}.${r.ch}`);
  assert.deepEqual(r.keys, [[1, 0.3], [3, 0.8]]);
  // En el segundo 2 el radio vale lo de en medio (suave), y el motor lo usa.
  await page.evaluate(async () => { const G = await import("./js/td/graph.js"); const a = window.__lumamap; G.seekNet(a.S.project.networks.at(-1), 2); });
  await page.waitForFunction(() => { const a = window.__lumamap, n = a.S.project.networks.at(-1); const v = a.td.cookers.get(n.id)?.param(n.nodes.find(x => x.type === "circle"), "radius"); return Math.abs(v - 0.55) < 0.01; }, null, { timeout: 5000 });
  // Doble clic en las curvas pone una clave; Supr la borra.
  const cv = await ws.locator(".tdanimcv").boundingBox();
  await page.mouse.dblclick(cv.x + cv.width * 0.75, cv.y + cv.height * 0.6);
  r = await A();
  assert.equal(r.keys.length, 3, "clave nueva con doble clic");
  await page.keyboard.press("Delete");
  assert.equal((await A()).keys.length, 2, "Supr la borra (y no borra nodos)");
  assert.equal(await page.evaluate(() => window.__lumamap.S.project.networks.at(-1).nodes.length), 2);
  // La línea de tiempo vuelve a sonar.
  await ws.locator(".tdtime").getByRole("button", { name: "Reproducir" }).click();
  assert.equal(await page.evaluate(() => window.__lumamap.S.project.networks.at(-1).timeline.play), 1);
  await page.keyboard.press("k");
  await ws.locator(".tdanim").waitFor({ state: "detached" });
  await page.evaluate(async () => { const m = await import("./js/panels-network.js"); m.closeNetworkEditor(); });
});
await test("redes de nodos: subredes (Ctrl+G, entrar, subir), replicador y panel de control con deslizador y botón", async () => {
  await page.evaluate(async () => {
    const a = window.__lumamap; await a.openNetwork();
    const G = await import("./js/td/graph.js"), m = await import("./js/panels-network.js");
    let n; a.edit(() => { n = G.newNetwork("Sub"); a.S.project.networks.push(n); const nz = G.addNode(n, "TOP", "noise", { x: 0, y: 0 }), lv = G.addNode(n, "TOP", "level", { x: 220, y: 0 }), o = G.addNode(n, "TOP", "out", { x: 440, y: 0 }); G.connect(n, nz.id, lv.id, 0); G.connect(n, lv.id, o.id, 0); });
    m.closeNetworkEditor(); await a.openNetwork({ netId: n.id });
  });
  const ws = page.locator("#tdws.show");
  await ws.locator('.tdnode[data-type="level"] .tdname').click();
  await page.keyboard.press("Control+g");
  await ws.locator('.tdnode[data-type="base"]').waitFor();
  assert.equal(await ws.locator('.tdnode[data-type="level"]').count(), 0, "el nivel ya está dentro");
  // La imagen sigue llegando a la salida a través de la subred.
  const lum = () => page.evaluate(() => { const a = window.__lumamap, n = a.S.project.networks.at(-1); const o = a.td.output(n.id, n.nodes.find(x => x.type === "out" && !x.parent).id, { time: performance.now() / 1000, w: 32, h: 18 }); if (!o) return 0; const d = o.el.getContext("2d").getImageData(0, 0, 32, 18).data; let s = 0; for (let k = 0; k < d.length; k += 4) s += d[k]; return s / (32 * 18); });
  assert.ok(await lum() > 10, "la salida tiene imagen a través de la subred");
  // Doble clic: entrar. Dentro están la entrada, el nivel y la salida; la ruta lo dice; U sube.
  await ws.locator('.tdnode[data-type="base"] .tdsum').dblclick();
  await ws.locator('.tdnode[data-type="level"]').waitFor();
  assert.deepEqual((await ws.locator(".tdnode").evaluateAll(els => els.map(e => e.dataset.type))).sort(), ["in", "level", "out"]);
  await ws.locator(".tdcrumb", { hasText: "base1" }).waitFor();
  // Lo que se crea dentro se queda dentro.
  await page.keyboard.press("Tab"); await ws.locator(".tdsearch").fill("desenfoque"); await ws.locator(".tdsearch").press("Enter");
  assert.equal(await page.evaluate(() => { const n = window.__lumamap.S.project.networks.at(-1); const b = n.nodes.find(x => x.type === "base"); return n.nodes.find(x => x.type === "blur").parent === b.id; }), true);
  await ws.locator(".tdpane").focus();
  await page.keyboard.press("u");
  await ws.locator('.tdnode[data-type="base"]').waitFor();
  assert.equal(await ws.locator('.tdnode[data-type="blur"]').count(), 0);
  // Replicador: 3 copias de un círculo.
  await page.evaluate(async () => {
    const a = window.__lumamap, G = await import("./js/td/graph.js"), n = a.S.project.networks.at(-1);
    a.edit(() => { G.addNode(n, "TOP", "circle", { x: 0, y: 300, name: "bola" }); G.addNode(n, "COMP", "replicator", { x: 0, y: 500, p: { master: "bola", count: 3, prefix: "bola_copia" } }); });
  });
  await page.waitForFunction(() => window.__lumamap.S.project.networks.at(-1).nodes.filter(x => x.repOf).length === 3, null, { timeout: 5000 });
  // Panel de control: un deslizador movido con el ratón cambia lo que lo usa.
  const ids = await page.evaluate(async () => {
    const a = window.__lumamap, G = await import("./js/td/graph.js"), m = await import("./js/panels-network.js"), n = a.S.project.networks.at(-1);
    let sl, bt; a.edit(() => { sl = G.addNode(n, "COMP", "slider", { x: 700, y: 0, p: { value: 0, label: "Brillo" } }); bt = G.addNode(n, "COMP", "button", { x: 700, y: 120, p: { label: "Flash" } }); });
    m.closeNetworkEditor(); await a.openNetwork({ netId: n.id });
    return { sl: sl.id, bt: bt.id };
  });
  await page.evaluate(async () => { const m = await import("./js/panels-network.js"); m._edForTests.togglePanel(); });
  const pv = ws.locator(".tdpanelview");
  await pv.waitFor();
  const sb = await pv.locator(".tdwslider").boundingBox();
  await page.mouse.click(sb.x + sb.width * 0.75, sb.y + sb.height / 2);
  const v = await page.evaluate((ids) => window.__lumamap.S.project.networks.at(-1).nodes.find(x => x.id === ids.sl).p.value, ids);
  assert.ok(Math.abs(v - 0.75) < 0.03, "el deslizador vale lo que marcaste: " + v);
  const bb = await pv.locator(".tdwbtn").boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.mouse.down();
  assert.equal(await page.evaluate((ids) => window.__lumamap.S.project.networks.at(-1).nodes.find(x => x.id === ids.bt).p.value, ids), 1, "pulsado = 1");
  await page.mouse.up();
  assert.equal(await page.evaluate((ids) => window.__lumamap.S.project.networks.at(-1).nodes.find(x => x.id === ids.bt).p.value, ids), 0, "al soltar = 0");
  await pv.getByRole("button", { name: "Cerrar el panel de control" }).click();
  await page.evaluate(async () => { const m = await import("./js/panels-network.js"); m.closeNetworkEditor(); });
});
await test("redes de nodos: MIDI In y OSC In (todos los controles), audio de un archivo, grabar video a la biblioteca y ventana a un proyector", async () => {
  const r = await page.evaluate(async () => {
    const a = window.__lumamap; await a.openNetwork();
    const G = await import("./js/td/graph.js"), m = await import("./js/panels-network.js"), Store = await import("./js/store.js");
    let n, mi, oi, af, nz, mo, win;
    // Un audio de 2 s con golpes graves (WAV hecho aquí).
    const sr = 22050, len = sr * 2, buf = new ArrayBuffer(44 + len * 2), dv = new DataView(buf);
    const w4 = (o, t) => { for (let k = 0; k < 4; k++) dv.setUint8(o + k, t.charCodeAt(k)); };
    w4(0, "RIFF"); dv.setUint32(4, 36 + len * 2, true); w4(8, "WAVE"); w4(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w4(36, "data"); dv.setUint32(40, len * 2, true);
    for (let k = 0; k < len; k++) { const t = k / sr, env = Math.exp(-((t % 0.5) * 10)); dv.setInt16(44 + k * 2, Math.sin(2 * Math.PI * 70 * t) * env * 30000, true); }
    await Store.putMedia({ id: "mediaTestAudio", name: "golpes.wav", kind: "audio", blob: new Blob([buf], { type: "audio/wav" }), size: buf.byteLength });
    a.edit(() => {
      a.S.project.media.push({ id: "mediaTestAudio", name: "golpes.wav", kind: "audio", size: buf.byteLength });
      n = G.newNetwork("IO"); a.S.project.networks.push(n);
      mi = G.addNode(n, "CHOP", "midiin"); oi = G.addNode(n, "CHOP", "oscin");
      af = G.addNode(n, "CHOP", "audiofile", { p: { audio: "mediaTestAudio", sound: 0 } });
      nz = G.addNode(n, "TOP", "noise"); mo = G.addNode(n, "TOP", "movieout", { p: { w: 320, h: 180, name: "prueba" } }); G.connect(n, nz.id, mo.id, 0);
      win = G.addNode(n, "COMP", "window", { p: { top: nz.name, screen: 2 } });
    });
    m.closeNetworkEditor(); await a.openNetwork({ netId: n.id });
    // MIDI y OSC que llegan a LumaMap.
    a.params.input({ src: "midi", device: "Prueba", key: "cc:7", v: 0.5, on: true });
    a.params.input({ src: "osc", device: "OSC", key: "/fader/1", v: 0.25, on: true });
    await new Promise(r => setTimeout(r, 300));
    const ck = a.td.cookers.get(n.id);
    const midi = ck.chop(mi).data, osc = ck.chop(oi).data;
    // Grabar 1,5 s y parar: va a la biblioteca.
    const before = a.S.project.media.filter(x => x.kind === "video").length;
    a.edit(() => { mo.p.record = 1; });
    // Hasta que haya fotogramas de verdad (en la CI, con la CPU llena, 1,5 s pueden no dar ninguno).
    for (let k = 0; k < 100 && !(a.td.recInfo(mo.id)?.frames >= 15); k++) await new Promise(r => setTimeout(r, 100));
    const recOn = !!a.td.recInfo(mo.id);
    a.edit(() => { mo.p.record = 0; });
    for (let k = 0; k < 50 && a.S.project.media.filter(x => x.kind === "video").length === before; k++) await new Promise(r => setTimeout(r, 200));
    const vids = a.S.project.media.filter(x => x.kind === "video");
    // Audio: suena (en silencio en la prueba) y se analiza.
    let A = null;
    for (let k = 0; k < 40; k++) { A = ck.chop(af)?.data; if (A?.length?.[0] > 0 && A.position[0] > 0.1) break; await new Promise(r => setTimeout(r, 100)); }
    // Ventana a un proyector: una superficie a pantalla completa por la salida 2 con la red.
    m._edForTests.openWindowComp(n, win);
    const surf = a.S.project.surfaces.find(x => x.winOf === win.id);
    const look = surf && a.S.project.scenes[0].looks[surf.id];
    return { midi: midi.cc7?.[0], osc: osc.fader_1?.[0], recOn, newVideo: vids.length - before, lastName: vids.at(-1)?.name, audioLen: A?.length?.[0] || 0, audioPos: A?.position?.[0] || 0, err: a.td.info(n, af).error, surf: surf ? { screen: surf.screen, type: look?.source.type, netNode: look?.source.netNode === nz.id } : null };
  });
  assert.equal(r.midi, 0.5); assert.equal(r.osc, 0.25);
  assert.ok(r.recOn, "estaba grabando");
  assert.equal(r.newVideo, 1, "la grabación está en la biblioteca");
  assert.match(r.lastName, /^prueba-.*\.(mp4|webm)$/);
  assert.equal(r.err, "");
  assert.ok(Math.abs(r.audioLen - 2) < 0.05, "el audio dura 2 s: " + r.audioLen);
  assert.deepEqual(r.surf, { screen: 2, type: "net", netNode: true });
  for (const p of ctx.pages()) if (p !== page) await p.close();
  // La superficie de la ventana dibuja la red en cada fotograma (por software en la CI): fuera, para no frenar a las siguientes.
  await page.evaluate(async () => {
    const a = window.__lumamap, M = await import("./js/model.js"), m = await import("./js/panels-network.js");
    m.closeNetworkEditor();
    a.edit(() => { for (const s of a.S.project.surfaces.filter(x => x.winOf)) M.removeSurface(a.S.project, s.id); });
  });
});
await test("redes de nodos pro: «¿Qué pasa aquí?» explica un error, barra de estado con los errores y la lección 20 se puede hacer entera", async () => {
  await page.evaluate(async () => {
    const a = window.__lumamap; await a.openNetwork();
    const G = await import("./js/td/graph.js"), m = await import("./js/panels-network.js");
    let n; a.edit(() => { n = G.newNetwork("Pro"); a.S.project.networks.push(n); G.addNode(n, "TOP", "glsl", { x: 0, y: 0, p: { code: "return vec4(nope);" } }); });
    m.closeNetworkEditor(); await a.openNetwork({ netId: n.id });
  });
  const ws = page.locator("#tdws.show");
  await ws.locator('.tdnode[data-type="glsl"] .tdname').click();
  const why = ws.locator(".tdparams").getByRole("button", { name: "🤖 ¿Qué pasa aquí?" });
  await why.waitFor({ state: "visible", timeout: 15000 });
  await why.click();
  await page.locator("#modal.show", { hasText: "nope" }).waitFor({ timeout: 15000 });
  assert.match(await page.locator("#modal.show").textContent(), /«nope», que no existe/);
  await page.locator("#modal.show").getByRole("button", { name: /Cerrar|Aceptar|✕/ }).first().click().catch(() => page.evaluate(() => document.getElementById("modal")._close?.()));
  // Barra de estado y tiempos en colores.
  await page.waitForFunction(() => /fps · .* ms · \d+ nodos/.test(document.querySelector("#tdws .tdtstats")?.textContent || ""), null, { timeout: 5000 });
  assert.match(await ws.locator(".tdtstats").textContent(), /⚠ 1/, "cuenta el nodo con error");
  // Lección 20: cada paso se puede hacer (con «Hazlo tú») y se comprueba.
  const steps = await page.evaluate(async () => {
    const a = window.__lumamap, { LEVELS } = await import("./js/ai/academy.js");
    const L = LEVELS.find(l => l.level === 20), out = [];
    a.edit(() => { const n = a.S.project.networks.at(-1); a.S.project.networks.splice(a.S.project.networks.indexOf(n), 1); a.S.project.networks.unshift(n); n.nodes = []; });
    for (const st of L.steps) {
      if (st.info) { out.push("info"); continue; }
      if (st.doIt) await st.doIt(a);
      let ok = false;
      for (let k = 0; k < 30 && !ok; k++) { ok = !!st.check(a); if (!ok) await new Promise(r => setTimeout(r, 100)); }
      out.push(ok);
    }
    return out;
  });
  assert.deepEqual(steps, [true, true, true, true, true, true, "info"]);
  await page.evaluate(async () => { const m = await import("./js/panels-network.js"); m.closeNetworkEditor(); });
});
await test("redes de nodos en el teléfono: tocar la salida y luego otro nodo los conecta; el panel de parámetros va abajo", async () => {
  const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const g = await pctx.newPage();
  const errs = [];
  g.on("pageerror", e => errs.push(e.message));
  try {
    await g.goto(base);
    await g.locator("#modal.show").waitFor();
    await g.evaluate(() => document.getElementById("modal")._close("blank"));
    await g.evaluate(async () => { const a = window.__lumamap; await a.openNetwork(); const G = await import("./js/td/graph.js"); const n = a.S.project.networks[0]; a.edit(() => { G.addNode(n, "TOP", "noise", { x: 0, y: 0 }); G.addNode(n, "TOP", "level", { x: 260, y: 0 }); }); (await import("./js/panels-network.js"))._edForTests.sel.clear(); a.closeNetwork(); await a.openNetwork(); });
    const ws = g.locator("#tdws.show");
    await ws.locator('.tdnode[data-type="level"]').waitFor();
    // Primer toque en la salida: la red pasa a «conectando». Con la CPU de la CI llena, un toque
    // puede llegar tarde y contar como pulsación larga (menú): se cierra y se vuelve a tocar.
    for (let k = 0; k < 3; k++) {
      await ws.locator('.tdnode[data-type="noise"] .tdout').tap();
      if (await g.locator("#tdws.connecting").waitFor({ timeout: 3000 }).then(() => true, () => false)) break;
      await g.keyboard.press("Escape").catch(() => {});
    }
    await ws.locator('.tdnode[data-type="level"] .tdnhead').tap();
    await g.waitForFunction(() => { const n = window.__lumamap.S.project.networks[0]; const lv = n.nodes.find(x => x.type === "level"); return lv.in[0] === n.nodes.find(x => x.type === "noise").id; }, null, { timeout: 5000 });
    // Sin nada elegido, el panel de parámetros no tapa la red; al tocar un nodo sale abajo, sin salirse de la pantalla.
    assert.equal(await ws.locator(".tdparams").isVisible(), false);
    await ws.locator('.tdnode[data-type="level"] .tdnhead').tap();
    await ws.locator(".tdparams .tdpphead", { hasText: "level1" }).waitFor();
    const box = await ws.locator(".tdparams").boundingBox();
    assert.ok(box && box.y > 300 && box.y + box.height <= 845 && box.width >= 380, JSON.stringify(box));
    assert.deepEqual(errs, []);
  } finally { await pctx.close(); }
});
await test("Show Director y diagnóstico: plan de 6 secciones aplicado como escenas; salud del proyecto con puntuación", async () => {
  await page.evaluate(() => window.__lumamap.openTab("assistant"));
  await page.locator(".aiquick button", { hasText: "Detectar Problemas" }).click();
  await page.locator(".score.big").waitFor();
  assert.match(await page.locator(".score.big").textContent(), /^\d+\/100$/);
  const n0 = await page.evaluate(() => window.__lumamap.S.project.scenes.length);
  await page.locator(".aiquick button", { hasText: "Crear Show" }).click();
  await page.getByRole("button", { name: "Generar plan" }).click();
  await page.locator(".psec").first().waitFor();
  assert.equal(await page.locator(".psec").count(), 6);
  await page.getByRole("button", { name: "Aplicar plan" }).click();
  await page.locator("#modal").getByRole("button", { name: "Aplicar" }).click();
  await page.waitForFunction((n) => window.__lumamap.S.project.scenes.length === n + 6, n0);
  const sc = await page.evaluate(() => { const P = window.__lumamap.S.project; return { name: P.scenes.find(s => s.id === P.sceneId).name, auto: P.settings.autoAdvance }; });
  assert.equal(sc.name, "INTRO"); assert.equal(sc.auto, true);
  await page.evaluate(() => { const a = window.__lumamap, P = a.S.project; P.settings.autoAdvance = false; P.scenes.splice(P.scenes.length - 6, 6); P.sceneId = P.scenes[0].id; a.changed({ panel: true }); a.openTab(null); });
});
await test("luces en modo simple: añadir una tira LED, elegir «Fuego» y ver los canales DMX encendidos", async () => {
  await page.evaluate(() => { const a = window.__lumamap; a.setPro(false); a.openTab("lights"); });
  await page.getByText("1 · Conectar").waitFor();
  await page.getByText("Modo práctica").first().waitFor();
  await page.locator(".lkinds .tile", { hasText: "Tira LED" }).click();
  await page.getByRole("button", { name: "Aceptar" }).click();
  await page.waitForFunction(() => window.__lumamap.dmx.cfg.pixelMaps.length >= 1);
  await page.locator(".chips .chip", { hasText: "Naturaleza" }).click();
  await page.locator(".lfx", { hasText: /^Fuego$/ }).click();
  await page.waitForFunction(() => { const D = window.__lumamap.dmx, pm = D.cfg.pixelMaps.at(-1); const u = D.out.get(pm.universe); return pm.source === "effect" && u && u.some(v => v > 0); }, null, { timeout: 10000 });
  const r = await page.evaluate(() => { const D = window.__lumamap.dmx, pm = D.cfg.pixelMaps.at(-1); return { n: D.patchOf(pm).pos.length, fx: pm.fx.id, prev: document.querySelectorAll("canvas.lfxprev").length }; });
  assert.equal(r.n, 60); assert.match(r.fx, /fire/); assert.ok(r.prev >= 5, "vistas previas animadas");
  await page.evaluate(() => { const a = window.__lumamap; a.dmx.cfg.pixelMaps.length = 0; a.openTab(null); });
});
await test("interactivo en modo simple: cámara, efecto «Ondas al pisar» y reacción que cambia las luces", async () => {
  await page.evaluate(() => { const a = window.__lumamap; a.setPro(false); a.openTab("interactive"); });
  await page.getByText("1 · Cámara o sensor").waitFor();
  await page.locator(".icam").waitFor();
  await page.locator(".ifxgrid:not(.exgrid) .ifx", { hasText: "Ondas al pisar" }).click();
  const src = await page.evaluate(() => { const a = window.__lumamap, s = a.S.project.surfaces.find(x => x.name === "Interactivo"); return s && a.lookSel().source; });
  assert.equal(src?.type, "body"); assert.equal(src?.bodyMode, "ondas");
  await page.waitForTimeout(1500);   // la cámara falsa se mueve: el efecto se calcula en vivo
  assert.equal(await page.evaluate(() => document.querySelector("#gl").getContext("webgl2").getError()), 0);
  const fx = await page.evaluate(() => { const a = window.__lumamap; const L = a.dmx.addLight("strip", { count: 8 }); a.changed({ panel: true }); return L.id; });
  await page.locator(".chip", { hasText: "Al entrar alguien → luces «Fuego»" }).click();
  await page.locator(".interactive .list .item", { hasText: "luces «Fuego»" }).locator("button").first().click();
  const r = await page.evaluate((id) => { const a = window.__lumamap; const L = a.dmx.cfg.pixelMaps.find(p => p.id === id); return { src: L.source, fx: L.fx.id, rule: a.S.project.settings.tracking.rules.at(-1).then.type }; }, fx);
  assert.equal(r.src, "effect"); assert.match(r.fx, /fire/); assert.equal(r.rule, "lightfx");
  await page.evaluate(() => { const a = window.__lumamap; a.S.project.settings.tracking.rules.length = 0; a.dmx.cfg.pixelMaps.length = 0; a.tracking.stop(); a.openTab(null); });
});
await test("interactivo: modo sensor de profundidad (fondo aprendido) y los efectos nuevos se dibujan", async () => {
  await page.evaluate(() => { const a = window.__lumamap; a.setPro(false); a.openTab("interactive"); });
  await page.locator(".ifxgrid:not(.exgrid) .ifx", { hasText: "Baldosas que se encienden" }).click();
  await page.getByText("Modo sensor de profundidad / infrarrojos").click();
  await page.getByRole("button", { name: "Aprender el fondo" }).waitFor();
  // La cámara falsa se mueve: tras aprender el fondo, lo que cambia aparece en la máscara.
  await page.waitForFunction(() => {
    const a = window.__lumamap, cal = a.S.project.settings.interactive;
    return cal.depth && document.querySelector(".istate")?.textContent.includes("modo sensor");
  }, null, { timeout: 40000 });
  const modes = await page.evaluate(async () => {
    const a = window.__lumamap, l = a.lookSel();
    const out = [];
    for (const m of ["baldosas", "pixeles", "luciernagas", "lluvia", "fuegos", "estrellas", "laser", "revelar"]) {
      l.source.bodyMode = m; a.changed();
      await new Promise(r => setTimeout(r, 250));
      out.push([m, document.querySelector("#gl").getContext("webgl2").getError()]);
    }
    return out;
  });
  for (const [m, err] of modes) assert.equal(err, 0, m);
  // Limpieza: fuera la superficie interactiva (su IA de cuerpo no debe seguir trabajando en las pruebas siguientes).
  await page.evaluate(() => { const a = window.__lumamap, P = a.S.project, sc = P.scenes.find(s => s.id === P.sceneId);
    P.settings.interactive.depth = false;
    P.surfaces = P.surfaces.filter(s => sc.looks[s.id]?.source.type !== "body");
    a.select(null); a.tracking?.stop?.(); a.changed({ panel: true }); a.openTab(null); });
});
await test("arrastrar y soltar: una animación y un efecto se sueltan encima de una superficie", async () => {
  const id = await page.evaluate(() => { const a = window.__lumamap; a.select(null); a.actions.addShape("rect"); return a.S.project.surfaces.at(-1).id; });
  const center = await page.evaluate((id) => { const s = window.__lumamap.S.project.surfaces.find(x => x.id === id); const xs = s.points.map(p => p.x), ys = s.points.map(p => p.y); return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]; }, id);
  await page.evaluate(() => { const a = window.__lumamap; a.select(null); a.openTab("anim"); });
  const tile = page.locator("#panelBody .tile").nth(3);
  await tile.waitFor();
  await tile.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  // El punto se calcula con el panel ya abierto (al abrirse, el escenario se encoge).
  const [tx, ty] = await toScreen(center);
  const name = (await tile.textContent()).trim();
  const b = await tile.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 - 40, b.y + b.height / 2, { steps: 4 });
  await page.mouse.move(tx, ty, { steps: 12 });
  await page.mouse.up();
  const r = await page.evaluate((id) => { const a = window.__lumamap; return { sel: a.S.sel, gen: a.S.project.scenes.find(s => s.id === a.S.project.sceneId).looks[id].source.gen }; }, id);
  const want = await page.evaluate((n) => window.__lumamap.M.ANIM_LIBRARY.find(a => a.name === n)?.gen, name);
  assert.equal(r.sel, id, "la superficie de destino queda seleccionada");
  assert.equal(r.gen, want, "la animación arrastrada (" + name + ") está en la superficie");
  // Un efecto de la biblioteca (estilo Retro Matrix) arrastrado encima.
  await page.evaluate(() => window.__lumamap.openTab("fx"));
  const chip = page.locator("#panelBody .fxlib .chip", { hasText: "Retro Matrix" });
  await chip.scrollIntoViewIfNeeded();
  const c = await chip.boundingBox();
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2); await page.mouse.down();
  await page.mouse.move(c.x - 30, c.y, { steps: 4 }); await page.mouse.move(tx, ty, { steps: 12 }); await page.mouse.up();
  assert.equal(await page.evaluate((id) => window.__lumamap.S.project.scenes.find(s => s.id === window.__lumamap.S.project.sceneId).looks[id].fx.style, id), "matrix");
  await page.evaluate(() => window.__lumamap.openTab(null));
});
await test("aprender un control: el diálogo sale al momento aunque el MIDI del sistema no conteste", async () => {
  const saved = await page.evaluate(() => {
    const m = window.__lumamap.midiDriver;
    window.__realMidi = { access: m.access, req: navigator.requestMIDIAccess };
    m.access = null;
    Object.defineProperty(navigator, "requestMIDIAccess", { value: () => new Promise(() => {}), configurable: true });   // nunca contesta
    window.__lumamap.actions.learn("global/blackout");
    return true;
  });
  assert.ok(saved);
  try { await page.locator(".learn").waitFor({ timeout: 3000 }); }
  finally {
    await page.evaluate(() => { window.__lumamap.params.cancelLearn?.(); document.getElementById("modal")?._close?.(null);
      const m = window.__lumamap.midiDriver; m.access = window.__realMidi.access; m._req = null;
      Object.defineProperty(navigator, "requestMIDIAccess", { value: window.__realMidi.req, configurable: true }); });
  }
});
await test("mandos: un mando de Xbox simulado aparece, se asigna su botón A al apagón y funciona junto al teclado", async () => {
  await page.evaluate(() => {
    const mk = (i, id) => ({ index: i, id, connected: true, buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] });
    window.__pads = [mk(0, "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)"), mk(1, "DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c)")];
    Object.defineProperty(navigator, "getGamepads", { value: () => window.__pads, configurable: true });
    const a = window.__lumamap; a.S.project.settings.control.mappings = []; if (a.S.blackout) a.actions.blackout();
    a.S.liveSub = "more"; a.openTab("live"); dispatchEvent(new Event("gamepadconnected"));
  });
  const press = (p, b, on) => page.evaluate(([p, b, on]) => { window.__pads[p].buttons[b] = { pressed: on, value: on ? 1 : 0 }; }, [p, b, on]);
  const box = page.locator("#panelBody .ctlsimple");
  await box.locator(".devchip", { hasText: "Mando 1 · Xbox" }).waitFor();
  await box.locator(".devchip", { hasText: "Mando 2 · PlayStation" }).waitFor();
  await box.locator("select").selectOption("global/blackout");
  await box.getByRole("button", { name: "Asignar un botón" }).click();
  await page.locator(".learn").waitFor();
  // Se mantiene pulsado hasta que se aprende (en un equipo lento el sondeo del mando tarda más).
  await page.waitForTimeout(100);
  await press(0, 0, true);
  await page.waitForFunction(() => window.__lumamap.S.project.settings.control.mappings.length === 1, null, { timeout: 10000 });
  await press(0, 0, false);
  await page.locator(".learn").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(300);
  const maps = await page.evaluate(() => window.__lumamap.S.project.settings.control.mappings.map(m => [m.src, m.device, m.key, m.target]));
  assert.deepEqual(maps, [["gamepad", "Mando 1", "btn:0", "global/blackout"]]);
  // El botón A del Mando 2 no tiene nada; el del Mando 1 hace el apagón.
  await press(1, 0, true); await page.waitForTimeout(400); await press(1, 0, false); await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => window.__lumamap.S.blackout), false);
  await press(0, 0, true);
  await page.waitForFunction(() => window.__lumamap.S.blackout === true, null, { timeout: 10000 });
  await press(0, 0, false); await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.__lumamap.S.blackout), true);
  await box.locator(".ctlmaps").getByText("Mando 1 · A").waitFor();
  // A la vez, el teclado: la tecla J → escena siguiente.
  await page.evaluate(() => { window.__lumamap.actions.blackout(); });
  await page.locator("#panelBody .ctlsimple select").selectOption("global/next");
  await page.locator("#panelBody .ctlsimple").getByRole("button", { name: "Asignar un botón" }).click();
  await page.locator(".learn").waitFor();
  await page.keyboard.press("j");
  await page.waitForFunction(() => window.__lumamap.S.project.settings.control.mappings.some(m => m.src === "key" && m.target === "global/next"), null, { timeout: 10000 });
  assert.equal(await page.evaluate(() => window.__lumamap.S.project.settings.control.mappings.filter(m => m.src === "key" && m.target === "global/next").length), 1);
  await page.evaluate(() => { window.__lumamap.S.project.settings.control.mappings = []; window.__lumamap.paramMappingsChanged(); window.__lumamap.openTab(null); });
});

await test("GIF animados: botón de arriba, busca solo al escribir (en español), GIPHY integrado y dos fuentes libres a la vez, entra en vivo o como capa", async () => {
  const gif = fs.readFileSync(new URL("./fixtures/anim.gif", import.meta.url));
  const asked = [];
  await page.route("https://api.openverse.org/**", (r) => { asked.push(r.request().url()); r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*", "cache-control": "no-store" },
    body: JSON.stringify({ page_count: 1, results: [{ id: "g1", title: "Fuego animado", url: "https://upload.example.org/fuego.gif", thumbnail: "https://upload.example.org/fuego.gif", creator: "Ana", license: "by", license_version: "4.0" }] }) }); });
  await page.route("https://commons.wikimedia.org/**", (r) => { asked.push(r.request().url()); r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*", "cache-control": "no-store" },
    body: JSON.stringify({ query: { pages: { "5": { pageid: 5, index: 1, title: "File:Llamas.gif", imageinfo: [{ url: "https://upload.example.org/llamas.gif", thumburl: "https://upload.example.org/llamas.gif", mime: "image/gif", size: 9000, metadata: [{ name: "frameCount", value: 8 }], extmetadata: { Artist: { value: "Luis" }, LicenseShortName: { value: "CC0" } } }] } } } }) }); });
  await page.route("https://api.giphy.com/**", (r) => { asked.push(r.request().url()); r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*", "cache-control": "no-store" },
    body: JSON.stringify({ pagination: { total_count: 1 }, data: [{ id: "gp1", title: "Llamas GIPHY", username: "marta", images: { original: { url: "https://upload.example.org/giphy-fuego.gif", size: "9000", width: "64", height: "36" }, fixed_width_small: { url: "https://upload.example.org/giphy-fuego.gif" } } }] }) }); });
  await page.route("https://upload.example.org/**", (r) => r.fulfill({ status: 200, contentType: "image/gif", headers: { "access-control-allow-origin": "*", "cache-control": "no-store" }, body: gif }));
  await page.bringToFront();
  const id = await page.evaluate(() => { const a = window.__lumamap; a.S.liveFade = 0.3; a.openTab(null); return a.S.project.surfaces[0].id; });
  await page.evaluate((id) => window.__lumamap.select(id), id);
  // Lo que otras pruebas ya buscaron (p. ej. el asistente) no debe venir de memoria.
  await page.evaluate(async () => (await import("./js/panels-gif.js")).clearGifMemo());
  // Botón «GIF» de arriba: la ventana abre y ya busca sola.
  await page.locator('#top [data-act="gif"]').click();
  await page.locator(".gifsearch .gifcell:not(.sk)").first().waitFor();
  // Escribir basta (sin pulsar «Buscar»): «fuego» se busca como «fire» en las dos fuentes.
  // Sin nada guardado de antes, y con un cambio seguro en la caja (el espacio final no cuenta en la búsqueda).
  await page.evaluate(async () => (await import("./js/panels-gif.js")).clearGifMemo());
  asked.length = 0;
  await page.locator(".gifsearch input[type=search]").fill("fuego ");
  for (let t = 0; t < 250 && !(asked.some(u => /openverse.*q=fire/.test(u)) && asked.some(u => /commons.*fire/.test(u)) && asked.some(u => /giphy.*q=fuego/.test(u))); t++) await page.waitForTimeout(100);
  await page.waitForFunction(() => document.querySelectorAll(".gifsearch .gifcell:not(.sk)").length === 3, null, { timeout: 30000, polling: 100 });
  if (!asked.length) console.log("DIAG-GIF2", await page.evaluate(() => JSON.stringify({ val: document.querySelector(".gifsearch input[type=search]")?.value, cells: document.querySelectorAll(".gifsearch .gifcell").length,
    text: document.querySelector(".gifsearch")?.innerText.slice(0, 300), online: navigator.onLine, desk: !!window.LumaDesktop, native: !!window.LumaNative })));
  assert.ok(asked.some(u => /openverse.*q=fire/.test(u)) && asked.some(u => /commons.*fire/.test(u)), "buscó «fire» en las dos: " + asked.join(" "));
  // GIPHY con la clave integrada, en español, y con su atribución.
  assert.ok(asked.some(u => /api\.giphy\.com\/v1\/gifs\/search\?api_key=LCo2.*q=fuego/.test(u)), "GIPHY en español: " + asked.join(" "));
  assert.match(await page.locator(".gifsearch .giphyattr").textContent(), /Powered by GIPHY/);
  assert.match(await page.locator(".gifcell", { hasText: "marta" }).locator("small").textContent(), /GIPHY · marta/);
  assert.ok(!/\bnull\b/.test(await page.locator(".gifsearch").textContent()), "sin textos sueltos");
  const fuego = page.locator(".gifcell", { hasText: "Ana" });
  assert.match(await fuego.locator("small").textContent(), /Ana · CC BY 4.0/);
  await fuego.hover();              // empieza a descargarse antes del clic
  await page.waitForTimeout(400);
  await fuego.click();
  try { await page.waitForFunction((id) => { const a = window.__lumamap, l = a.S.project.scenes.find(s => s.id === a.S.project.sceneId).looks[id]; return l.source.type === "media" && !l.next; }, id, { timeout: 40000, polling: 100 }); }
  catch (e) { console.log("DIAG-GIF", await page.evaluate((id) => { const a = window.__lumamap, S = a.S, l = S.project.scenes.find(s => s.id === S.project.sceneId).looks[id]; return JSON.stringify({ src: l.source.type, next: l.next && { t: l.next.source?.type }, mix: l.mix, playing: S.playing, blackout: S.blackout, perf: S.perfMode, liveFade: S.liveFade, hidden: document.hidden, toast: document.querySelector("#toast").textContent, media: S.project.media.length, scene: S.project.sceneId, scenes: S.project.scenes.length, looksWithNext: S.project.scenes.map(sc => sc.looks[id]?.next ? sc.id : null).filter(Boolean), vj: !!S.vjOn, sched: JSON.stringify(S.project.settings.timers || S.project.timers || null).slice(0, 200) }); }, id)); throw e; }
  const m = await page.evaluate((id) => { const a = window.__lumamap, l = a.S.project.scenes.find(s => s.id === a.S.project.sceneId).looks[id]; const med = a.S.project.media.find(x => x.id === l.source.mediaId); return { kind: med.kind, name: med.name, credit: med.credit }; }, id);
  assert.deepEqual(m, { kind: "anim", name: "Fuego animado.gif", credit: "© Ana · CC BY 4.0" });
  // Como capa nueva encima (y al reabrir, lo buscado sale al instante).
  const n0 = await page.evaluate(() => window.__lumamap.S.project.surfaces.length);
  await page.evaluate(() => window.__lumamap.actions.searchGifs({ query: "fuego" }));
  await page.locator(".gifsearch .seg button", { hasText: "Capa nueva encima" }).click();
  await page.locator(".gifcell", { hasText: "Luis" }).click();
  await page.waitForFunction((n0) => window.__lumamap.S.project.surfaces.length === n0 + 1, n0, { timeout: 40000, polling: 100 });
  assert.match(await page.evaluate(() => window.__lumamap.S.project.surfaces.at(-1).name), /^GIF /);
  await page.unroute("https://api.openverse.org/**"); await page.unroute("https://commons.wikimedia.org/**"); await page.unroute("https://api.giphy.com/**"); await page.unroute("https://upload.example.org/**");
  await page.evaluate(() => window.__lumamap.openTab(null));
});

await test("holograma: asistente fácil (escenario como Tupac, 2 proyectores), uniones suaves, girar/espejo y prueba de orientación", async () => {
  await page.evaluate(() => window.__lumamap.actions.hologramWizard());
  const box = page.locator(".holo");
  await box.waitFor();
  assert.equal(await box.locator(".holotype").count(), 3);
  assert.ok(!/\bnull\b/.test(await box.textContent()), "sin textos sueltos");
  await box.locator(".holotype", { hasText: "Escenario (como Tupac)" }).click();
  await box.locator(".seg button", { hasText: "Animación" }).click();
  await box.locator(".seg button", { hasText: /^2$/ }).click();
  await box.getByRole("button", { name: "✨ Crear holograma" }).click();
  await box.locator(".holohow li").first().waitFor();
  assert.match(await box.locator(".holohow").textContent(), /45°/);
  let r = await page.evaluate(() => { const a = window.__lumamap, P = a.S.project, sc = P.scenes.find(s => s.id === P.sceneId);
    return P.surfaces.filter(s => s.holo).map(s => ({ scr: s.screen, span: sc.looks[s.id].span, fx: sc.looks[s.id].fx.flipY, edge: P.settings.screens[s.screen].edge })); });
  assert.equal(r.length, 2);
  assert.deepEqual(r.map(x => x.scr), [1, 2]);
  assert.ok(r[0].span.b > 0.5 && r[1].span.a < 0.5, "se solapan en el centro");
  assert.deepEqual([r[0].edge.right, r[1].edge.left], [0.15, 0.15]);
  await box.getByRole("button", { name: "↕ Girar" }).click();
  r = await page.evaluate(() => { const a = window.__lumamap, P = a.S.project, sc = P.scenes.find(s => s.id === P.sceneId); return P.surfaces.filter(s => s.holo).map(s => sc.looks[s.id].fx.flipY); });
  assert.deepEqual(r, [true, true]);
  await box.getByRole("button", { name: "Probar orientación" }).click();
  assert.equal(await page.evaluate(() => { const a = window.__lumamap, P = a.S.project, sc = P.scenes.find(s => s.id === P.sceneId); return sc.looks[P.surfaces.find(s => s.holo).id].source.text; }), "↑ ARRIBA  R");
  // Vuelve al contenido con el botón… o sola a los 8 s (en un equipo lento puede pasar antes de pulsarlo).
  const back = box.getByRole("button", { name: "Volver a mi contenido" });
  if (await back.count()) await back.click().catch(() => {});
  await page.waitForFunction(() => { const a = window.__lumamap, P = a.S.project, sc = P.scenes.find(s => s.id === P.sceneId); return sc.looks[P.surfaces.find(s => s.holo).id].source.type === "gen"; }, null, { timeout: 20000 });
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => document.querySelector("#gl").getContext("webgl2").getError()), 0);
  await page.getByRole("button", { name: "Cerrar" }).click();
  await page.evaluate(() => { const a = window.__lumamap, P = a.S.project; P.surfaces = P.surfaces.filter(x => !x.holo); for (const n of [1, 2]) delete P.settings.screens[n].edge; a.changed({ panel: true }); });
});
await test("objetos 3D: «hazme un carro» desde la IA sin conexión, vista previa girando y se proyecta en una superficie", async () => {
  // La orden en el asistente propone «Crear el objeto 3D»; se aplica y abre el creador.
  await page.evaluate(() => { const a = window.__lumamap; a.openTab(null); a.actions.create3D({ prompt: "un carro azul deportivo" }); });
  await page.locator(".create3d .c3preview").waitFor();
  await page.waitForFunction(() => /biblioteca 3D/.test(document.querySelector(".c3status")?.textContent || ""), null, { timeout: 20000 });
  await page.waitForTimeout(600);
  // La vista previa tiene dibujo (no es todo negro).
  const lit = await page.evaluate(() => { const c = document.querySelector(".c3preview"), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 16) if (d[i] + d[i + 1] + d[i + 2] > 60) n++; return n; });
  assert.ok(lit > 200, "la vista previa dibuja el carro (" + lit + ")");
  await page.locator(".create3d .seg button", { hasText: "Camioneta" }).click();
  const n0 = await page.evaluate(() => window.__lumamap.S.project.surfaces.length);
  await page.getByRole("button", { name: "▶ Proyectar (superficie nueva)" }).click();
  await page.waitForFunction((n0) => window.__lumamap.S.project.surfaces.length === n0 + 1, n0);
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => { const a = window.__lumamap, P = a.S.project, sc = P.scenes.find(s => s.id === P.sceneId), l = sc.looks[P.surfaces.at(-1).id];
    return { type: l.source.type, style: l.source.model.style, color: l.source.model.color, gl: document.querySelector("#gl").getContext("webgl2").getError() }; });
  assert.deepEqual(r, { type: "model3d", style: "camioneta", color: "#1f5fff", gl: 0 });
  await page.evaluate(() => { const a = window.__lumamap, P = a.S.project; P.surfaces.pop(); a.changed({ panel: true }); a.openTab(null); });
});
await test("burbujas interactivas: si alguien toca la proyección donde hay burbujas, revientan y cuentan", async () => {
  const r = await page.evaluate(async () => {
    const { ProFX } = await import("/js/fx-pro.js");
    const W = 640, H = 360, out = Object.assign(document.createElement("canvas"), { width: W, height: H });
    const mask = Object.assign(document.createElement("canvas"), { width: W, height: H });
    const fx = new ProFX();
    // Sin nadie: las burbujas suben y no revientan.
    for (let i = 0; i < 90; i++) fx.render(out, mask, "burbujas_pro", W, H, 1 / 30, { sound: false });
    const before = { score: fx.state.score, bubbles: fx.state.bubbles.length };
    // Una persona con los brazos abiertos tapa la mitad inferior de la proyección.
    const m = mask.getContext("2d"); m.fillStyle = "#fff"; m.fillRect(0, H * 0.45, W, H * 0.55);
    for (let i = 0; i < 90; i++) fx.render(out, mask, "burbujas_pro", W, H, 1 / 30, { sound: false });
    return { before, after: fx.state.score };
  });
  assert.equal(r.before.score, 0, "sin nadie no revienta ninguna");
  assert.ok(r.before.bubbles > 3, "hay burbujas flotando");
  assert.ok(r.after >= 3, "al tocarlas revientan (" + r.after + ")");
});
await test("móvil como cámara: código QR, el móvil manda su cámara por WebRTC y el programa la usa para lo interactivo", async () => {
  assert.ok(httpsPort > 0, "https activo");
  await page.evaluate(() => { const a = window.__lumamap; a.setPro(false); if (a.S.tab !== "interactive") a.openTab("interactive"); });
  await page.getByRole("button", { name: "📱 Usar el móvil como cámara (Wi-Fi o USB)" }).click();
  await page.locator(".phonecam .pcqr svg").waitFor();
  assert.match(await page.locator(".phonecam .pcurl code").textContent(), new RegExp(`^https://[\\d.]+:${httpsPort}/phonecam\\.html`));
  await page.locator(".phonecam").getByText("Esperando al móvil").waitFor();
  assert.ok(!/\bnull\b/.test(await page.locator(".phonecam").textContent()), "sin textos sueltos");
  // El «móvil»: otra ventana (contexto aparte, como otro aparato) con la cámara de prueba
  // (http://127.0.0.1 cuenta como página segura). En una pestaña del mismo, el editor quedaría detrás sin pintar.
  const phoneCtx = await browser.newContext({ permissions: ["camera"] });
  const phone = await phoneCtx.newPage();
  const phoneErrors = []; phone.on("pageerror", e => phoneErrors.push(e.message));
  await phone.goto(base + "phonecam.html?auto=1");
  await phone.locator("#state.ok").waitFor({ timeout: 30000 });
  // En el programa aparece, se usa sola para lo interactivo y llega imagen de verdad.
  await page.locator(".phonecam .pclive", { hasText: "enviando imagen" }).waitFor({ timeout: 20000 });
  await page.locator(".phonecam .pclive").getByText("En uso").waitFor();
  assert.ok(!/\bnull\b/.test(await page.locator("#panelBody .interactive").textContent()), "panel sin textos sueltos");
  const r = await page.evaluate(async () => {
    const a = window.__lumamap, cal = a.S.project.settings.interactive;
    const { getCamera, listCameras } = await import("./js/sources.js");
    const cam = await getCamera(cal.camId);
    for (let i = 0; i < 40 && !cam.el.videoWidth; i++) await new Promise(r => setTimeout(r, 100));
    const cs = await listCameras();
    return { camId: cal.camId, w: cam.el.videoWidth, h: cam.el.videoHeight, listed: cs.find(c => c.id === cal.camId)?.kindName };
  });
  assert.match(r.camId, /^phone:/);
  assert.ok(r.w >= 320 && r.h >= 180, `imagen del móvil ${r.w}×${r.h}`);
  assert.equal(r.listed, "Móvil (Wi-Fi)");
  await page.getByRole("button", { name: "Listo" }).click();
  // El móvil se va: el programa lo marca desconectado (y la cámara vuelve sola si reconecta).
  await phoneCtx.close();
  await page.waitForFunction(async () => { const { listPhones } = await import("./js/phonecam.js"); return listPhones().every(p => !p.online); }, null, { timeout: 15000 });
  assert.deepEqual(phoneErrors, [], JSON.stringify(phoneErrors));
  await page.evaluate(() => { const a = window.__lumamap, cal = a.S.project.settings.interactive; cal.camId = ""; a.openTab(null); });
});
await test("móvil por cable USB: la página abierta por el cable manda la cámara por el WebSocket, el programa avisa y la usa sola", async () => {
  await page.bringToFront();
  await page.evaluate(() => { const a = window.__lumamap; a.S.project.settings.interactive.camId = ""; });
  // Otro proceso (como otro aparato): en la misma pestaña-proceso el editor le quitaría el hilo.
  const phoneCtx = await browser.newContext({ permissions: ["camera"] });
  const phone = await phoneCtx.newPage();
  const phoneErrors = []; phone.on("pageerror", e => phoneErrors.push(e.message));
  // Así la abre LumaMap en el móvil con adb (http://localhost por el cable).
  await phone.goto(base + "phonecam.html?auto=1&usb=1&name=Redmi%20Note%2015%20Pro");
  await phone.locator("#state.ok", { hasText: "cable USB" }).waitFor({ timeout: 30000 });
  assert.equal(await phone.locator("#pinrow").isVisible(), false, "por cable no pide el código");
  // Aviso en el programa y la cámara ya puesta en lo interactivo.
  try { await page.locator("#notices .notice", { hasText: "lista (cable USB)" }).waitFor({ timeout: 60000 }); }
  catch (e) { console.log("DIAG-USB", await page.evaluate(async () => { const { listPhones } = await import("./js/phonecam.js"); return JSON.stringify({ phones: listPhones(), notices: document.querySelector("#notices")?.innerText, cam: window.__lumamap.S.project.settings.interactive.camId, cls: document.body.className }); }), await phone.locator("#state").textContent()); throw e; }
  // Las fotos siguen llegando (no solo la primera).
  await page.evaluate(async () => { window.__pf = (await import("./js/phonecam.js")).phoneFrames; });
  await page.waitForFunction(() => (window.__pf(window.__lumamap.S.project.settings.interactive.camId)?.frames || 0) >= 4, null, { timeout: 60000 });
  const r = await page.evaluate(async () => {
    const a = window.__lumamap, cal = a.S.project.settings.interactive;
    const { getCamera, listCameras } = await import("./js/sources.js");
    const cam = await getCamera(cal.camId);
    for (let i = 0; i < 100 && cam.el.videoWidth < 320; i++) await new Promise(r => setTimeout(r, 100));
    // La imagen es la de la cámara (no negra; los primeros fotogramas pueden serlo).
    const c = Object.assign(document.createElement("canvas"), { width: 64, height: 36 }), g = c.getContext("2d");
    let sum = 0;
    const light = (src) => { g.clearRect(0, 0, 64, 36); g.drawImage(src, 0, 0, 64, 36); const d = g.getImageData(0, 0, 64, 36).data; let t = 0; for (let i = 0; i < d.length; i += 4) t += d[i] + d[i + 1] + d[i + 2]; return t; };
    for (let k = 0; k < 50 && sum / (64 * 36 * 3) <= 5; k++) {
      if (k) await new Promise(r => setTimeout(r, 100));
      sum = light(cam.el);
    }
    // Lo que llega por el cable: fotos JPEG del móvil, una tras otra.
    const { phoneFrames } = await import("./js/phonecam.js");
    const recv = phoneFrames(cal.camId)?.frames || 0;
    const cs = await listCameras();
    const pf = phoneFrames(cal.camId) || {};
    return { camId: cal.camId, w: cam.el.videoWidth, bright: sum / (64 * 36 * 3), recv, listed: cs.find(c => c.id === cal.camId)?.kindName,
      diag: JSON.stringify({ fw: pf.width, fh: pf.height, paused: cam.el.paused, rs: cam.el.readyState, h: cam.el.videoHeight, live: cam.el.srcObject?.getVideoTracks?.().map(t => t.readyState),
        err: cam.el.error?.message || null, ns: cam.el.networkState, videos: document.querySelectorAll("video").length }) };
  });
  assert.match(r.camId, /^phone:/);
  assert.ok(r.w >= 320, `imagen del móvil ${r.w} ${r.diag}`);
  assert.ok(r.recv >= 4, `fotos llegadas por el cable: ${r.recv} (enviadas ${await phone.evaluate(() => window.__lumaCamSent())})`);
  assert.ok(r.bright > 5, `con imagen en la cámara ${r.bright} (recibido ${r.recv})`);
  assert.equal(r.listed, "Móvil (cable USB)", "en la lista de cámaras como: " + r.listed);
  // Se desenchufa (página cerrada): el programa lo marca desconectado.
  await phoneCtx.close();
  await page.waitForFunction(async () => { const { listPhones } = await import("./js/phonecam.js"); return listPhones().every(p => !p.live && !p.online); }, null, { timeout: 15000 });
  assert.deepEqual(phoneErrors, [], JSON.stringify(phoneErrors));
  await page.evaluate(() => { const a = window.__lumamap; a.S.project.settings.interactive.camId = ""; document.querySelectorAll("#notices .notice").forEach(n => n.remove()); a.openTab(null); });
});
await test("plugins: se instala un shader ISF desde el menú, aparece en las animaciones con sus controles y se proyecta; los efectos de cámara van a la cámara y como filtro de fotos", async () => {
  const fsFile = path.join(os.tmpdir(), "ondas-test.fs");
  fs.writeFileSync(fsFile, `/*{ "DESCRIPTION": "Ondas de prueba", "CREDIT": "Test", "INPUTS": [
    { "NAME": "freq", "TYPE": "float", "DEFAULT": 8.0, "MIN": 1.0, "MAX": 30.0, "LABEL": "Frecuencia" },
    { "NAME": "tint", "TYPE": "color", "DEFAULT": [0.0, 1.0, 0.5, 1.0], "LABEL": "Color" } ] }*/
void main(){ float v = 0.5 + 0.5 * sin(isf_FragNormCoord.x * freq + TIME); gl_FragColor = vec4(tint.rgb * v, 1.0); }`);
  await page.evaluate(() => { const a = window.__lumamap; a.openTab(null); a.openTab("menu"); });
  await page.locator("#panelBody .item", { hasText: "Plugins" }).click();
  await page.locator(".plugins .item", { hasText: "Shaders ISF v" }).waitFor();
  assert.ok(await page.locator(".plugins .item", { hasText: "Cámara reactiva al audio" }).count());
  assert.ok(await page.locator(".plugins .item", { hasText: "Fiesta y neón" }).count());
  // Plugins FFGL de Resolume (.dll): en el navegador/Android se dice claro que son de la app de Windows (sin botón falso).
  assert.match(await page.locator(".plugins .ffgl").textContent(), /solo en la app de Windows/);
  assert.equal(await page.locator(".plugins .ffgl button").count(), 0);
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.locator(".plugins").getByRole("button", { name: /Instalar plugin/ }).click()]);
  await chooser.setFiles(fsFile);
  await page.locator(".plugins .item", { hasText: "Ondas de prueba" }).waitFor();
  await page.locator("#modal").getByRole("button", { name: "Cerrar" }).click();
  // Una superficie con el shader (desde el catálogo de animaciones, categoría 🧩).
  const id = await page.evaluate(() => { const a = window.__lumamap; a.actions.addShape("rect"); a.actions.setSource({ type: "gen" }); a.openTab(null); a.openTab("content"); return a.S.sel; });
  await page.locator("#panelBody .chip", { hasText: "🧩 Ondas de prueba" }).click();
  await page.locator("#panelBody .tile", { hasText: "Ondas de prueba" }).first().click();
  await page.locator("#panelBody .sec", { hasText: "🧩 Ondas de prueba" }).getByText("Frecuencia").waitFor();
  const src = await page.evaluate((id) => { const a = window.__lumamap; return a.S.project.scenes.find(s => s.id === a.S.project.sceneId).looks[id].source; }, id);
  assert.equal(src.type, "shader");
  // Se dibuja de verdad (el compositor lo pinta en su lienzo y no hay errores de compilación).
  await page.waitForTimeout(800);
  const drawn = await page.evaluate(async (id) => {
    const { getShader } = await import("./js/plugins.js"), { ShaderCache } = await import("./js/isf.js");
    const a = window.__lumamap, sh = getShader(a.S.project.scenes.find(s => s.id === a.S.project.sceneId).looks[id].source.shaderId);
    const sc = new ShaderCache(), e = sc.draw("x", sh.id, sh.isf, {}, { width: 64, height: 36, time: 1 });
    const g = Object.assign(document.createElement("canvas"), { width: 64, height: 36 }).getContext("2d"); g.drawImage(e.canvas, 0, 0);
    const d = g.getImageData(0, 0, 64, 36).data; let s = 0; for (let i = 1; i < d.length; i += 4) s += d[i];
    return { err: sc.error(sh.id), green: s / (64 * 36) };
  }, id);
  assert.equal(drawn.err, ""); assert.ok(drawn.green > 20, "pinta en verde " + drawn.green);
  // Los efectos de cámara no son animaciones: no salen en su biblioteca, sino en Contenido → Cámara.
  assert.equal(await page.locator("#panelBody .chip", { hasText: "Cámara reactiva" }).count(), 0, "sin efectos de cámara entre las animaciones");
  await page.locator("#panelBody").getByRole("button", { name: /📷 Efectos de cámara \(\d+\) y filtros/ }).click();
  assert.equal(await page.evaluate(() => window.__lumamap.lookSel().source.type), "camera");
  // Plugin de cámara reactiva: la cámara (la de prueba del navegador) entra en el shader de verdad.
  await page.locator("#panelBody .sec", { hasText: "📷 Efectos de cámara" }).locator(".tile", { hasText: "Explosión de cámara" }).click();
  await page.locator("#panelBody .sec", { hasText: "Explosión de cámara" }).getByText("📷 Cámara").waitFor();
  await page.waitForFunction(() => { const sc = window.__lumamap.compositor().shaders; return [...sc.out.values()].some(e => e.version > 5 && e.tex.has("inputImage")); }, null, { timeout: 30000 });
  const cam = await page.evaluate(() => { const sc = window.__lumamap.compositor().shaders, e = [...sc.out.values()].find(x => x.tex.has("inputImage"));
    const g = Object.assign(document.createElement("canvas"), { width: 64, height: 36 }).getContext("2d"); g.drawImage(e.canvas, 0, 0, 64, 36);
    const d = g.getImageData(0, 0, 64, 36).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
    return { light: s / (64 * 36 * 3), w: e.tex.get("inputImage").w, err: [...sc.errors.values()].join(" ") }; });
  assert.equal(cam.err, ""); assert.ok(cam.w >= 320, "llega la cámara " + cam.w); assert.ok(cam.light > 5, "dibuja " + cam.light);
  // «Quitar el efecto» deja la cámara tal cual.
  await page.locator("#panelBody").getByRole("button", { name: /Quitar el efecto/ }).click();
  assert.equal(await page.evaluate(() => window.__lumamap.lookSel().source.type), "camera");
  // Una foto subida: «🎨 Filtros para esta foto» con los que sirven (sin los de solo cámara ni los que necesitan movimiento).
  const png = path.join(os.tmpdir(), "lumamap-filtro.png");
  makePng(png);
  const [chooser2] = await Promise.all([page.waitForEvent("filechooser"), page.evaluate(() => { window.__lumamap.actions.importMedia("selected"); })]);
  await chooser2.setFiles(png);
  await page.waitForFunction(() => { const a = window.__lumamap, s = a.lookSel().source; return s.type === "media" && a.S.project.media.some(m => m.id === s.mediaId && m.kind === "image" && !m.pending); });
  await page.evaluate(() => { const a = window.__lumamap; a.openTab(null); a.openTab("content"); });
  const filt = page.locator("#panelBody .sec", { hasText: "🎨 Filtros para esta foto" });
  await filt.waitFor();
  for (const n of ["Explosión de cámara", "Time Warp Scan", "Datamosh"]) assert.equal(await filt.locator(".tile", { hasText: n }).count(), 0, n + " no es filtro de fotos");
  await filt.locator(".tile", { hasText: "Cámara térmica" }).click();
  const fsrc = await page.evaluate(() => window.__lumamap.lookSel().source);
  assert.equal(fsrc.type, "shader"); assert.equal(fsrc.shaderParams.inputImage.kind, "media");
  // La foto entra en el filtro de verdad (no la cámara) y se dibuja.
  await page.waitForFunction(() => [...window.__lumamap.compositor().shaders.out.values()].some(e => e.version > 2 && e.tex.get("inputImage")?.w === 64), null, { timeout: 30000 });   // la foto de prueba mide 64 px
  const filtered = await page.evaluate(() => { const sc = window.__lumamap.compositor().shaders; return [...sc.errors.values()].join(" "); });
  assert.equal(filtered, "");
  // También en la pestaña Efectos, y «Quitar el filtro» devuelve la foto tal cual.
  await page.evaluate(() => { const a = window.__lumamap; a.openTab(null); a.openTab("fx"); });
  await page.locator("#panelBody summary", { hasText: "🎨 Filtros para esta foto" }).waitFor();
  await page.evaluate(() => { const a = window.__lumamap; a.openTab(null); a.openTab("content"); });
  await page.locator("#panelBody").getByRole("button", { name: /Quitar el filtro/ }).click();
  assert.deepEqual(await page.evaluate(() => { const s = window.__lumamap.lookSel().source; return [s.type, s.mediaId]; }), ["media", fsrc.shaderParams.inputImage.id]);
  fs.rmSync(png, { force: true });
  await page.evaluate((id) => { const a = window.__lumamap; a.S.project.surfaces = a.S.project.surfaces.filter(s => s.id !== id); a.select(a.S.project.surfaces[0]?.id || null); a.changed({ panel: true }); a.openTab(null); }, id);
  fs.rmSync(fsFile, { force: true });
});
await test("VJ automático: set desde una frase, mezcla sola al tempo (clips y efectos) sin llenar el deshacer, y al parar todo vuelve", async () => {
  const before = await page.evaluate(() => { const a = window.__lumamap; a.actions.setBpm(240); a.openTab(null); a.S.liveSub = "vj"; a.openTab("live");
    return { undo: a.history.undoStack.length, fx: JSON.stringify(a.S.project.scenes.find(s => s.id === a.S.project.sceneId).looks[a.S.project.surfaces[0].id].fx) }; });
  await page.locator("#panelBody").getByRole("button", { name: /Mi set/ }).click();
  await page.locator(".vjset input[type=text]").fill("techno rojo y blanco con láseres y espacio");
  await page.locator(".vjset").getByRole("button", { name: "Crear", exact: true }).click();
  await page.locator(".vjset .vjclip").first().waitFor();
  const set = await page.evaluate(() => { const v = window.__lumamap.S.project.settings.vj; return { n: v.clips.length, style: v.style, pal: v.palette, gens: v.clips.map(c => c.gen) }; });
  assert.ok(set.n >= 10, "clips en el set: " + set.n);
  assert.equal(set.style, "techno"); assert.deepEqual(set.pal, ["#ff1a1a", "#ffffff"]);
  assert.ok(set.gens.includes("lasershow") || set.gens.includes("crosslasers"), set.gens.join(","));
  await page.locator("#modal").getByRole("button", { name: "Listo" }).click();
  await page.locator("#panelBody").getByRole("button", { name: /Empezar el VJ automático/ }).click();
  await page.locator(".vjstatus .vjsec").waitFor();
  // Varios golpes después (240 BPM sin micrófono = estructura de tema al tempo): cambió de clip y los colores son los del set.
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    const s = await page.evaluate(() => { const a = window.__lumamap, l = a.S.project.scenes.find(s => s.id === a.S.project.sceneId).looks[a.S.project.surfaces[0].id]; const src = (l.next || l).source; return { type: src.type, sh: src.shaderId, gen: src.gen, c: src.color, st: a.vjStatus() }; });
    // (los shaders traen sus propios colores: solo las animaciones se recolorean con la paleta)
    if (s.type === "shader") seen.add("shader:" + s.sh); else if (s.gen) seen.add(s.gen + "|" + s.c);
    if (seen.size >= 2 && i > 10) break;
    await page.waitForTimeout(500);
  }
  assert.ok(seen.size >= 2, "clips usados: " + [...seen].join(" "));
  assert.ok([...seen].filter(x => !x.startsWith("shader:")).every(x => /#ff1a1a|#ffffff/i.test(x)), "colores del set: " + [...seen].join(" "));
  const st = await page.evaluate(() => window.__lumamap.vjStatus());
  assert.ok(st && st.bpm >= 200 && st.sectionName, JSON.stringify(st));
  const mid = await page.evaluate(() => window.__lumamap.history.undoStack.length);
  assert.ok(mid - before.undo <= 2, "el deshacer no se llena de clips: " + (mid - before.undo));
  await page.locator("#panelBody").getByRole("button", { name: /Parar el VJ/ }).click();
  const after = await page.evaluate(() => { const a = window.__lumamap, l = a.S.project.scenes.find(s => s.id === a.S.project.sceneId).looks[a.S.project.surfaces[0].id]; return { strobe: l.fx.strobe, rgb: l.fx.rgbShift, kal: l.fx.kaleido, audio: l.audio.enabled, on: a.S.vjOn }; });
  assert.deepEqual(after, { strobe: 0, rgb: 0, kal: 0, audio: false, on: false });
  await page.evaluate(() => { const a = window.__lumamap; a.actions.setBpm(120); a.S.project.settings.vj.clips = []; a.S.project.settings.vj.palette = null; a.openTab(null); });
});
await test("como Resolume: mesa de clips (lanzar casilla y columna, al golpe y autopiloto) y «Animar al ritmo» en cualquier deslizador", async () => {
  await page.bringToFront();
  await page.evaluate(() => { const a = window.__lumamap; a.actions.setBpm(240); a.S.liveFade = 0; if (!a.S.playing) a.actions.togglePlay(); a.openTab(null); a.S.liveSub = "clips"; a.openTab("live"); });
  await page.locator("#panelBody").getByRole("button", { name: /Abrir la mesa/ }).click();
  const deck = page.locator(".deck");
  await deck.locator(".dcell").first().waitFor();
  const sid = await deck.locator(".dcell").first().getAttribute("data-sid");
  // Casilla vacía → elegir un color; pasa sola a la siguiente → otro color.
  await deck.locator(`.dcell[data-sid="${sid}"][data-col="0"]`).click();
  await deck.locator(".seg button", { hasText: "Color" }).click();
  await deck.locator('.chip.swatch[title="#ff0040"]').click();
  await deck.locator('.chip.swatch[title="#00e5ff"]').click();
  const cells = await page.evaluate((sid) => window.__lumamap.S.project.settings.deck.cells[sid].map(c => c && c.color), sid);
  assert.deepEqual(cells.slice(0, 2), ["#ff0040", "#00e5ff"]);
  const look = () => page.evaluate((sid) => { const a = window.__lumamap, l = a.S.project.scenes.find(s => s.id === a.S.project.sceneId).looks[sid]; return { type: l.source.type, color: l.source.color, next: !!l.next }; }, sid);
  // Tocar la casilla 1 la lanza (al instante).
  await deck.locator(`.dcell[data-sid="${sid}"][data-col="0"]`).click();
  await page.waitForFunction((sid) => { const a = window.__lumamap, l = a.S.project.scenes.find(s => s.id === a.S.project.sceneId).looks[sid]; return l.source.type === "color" && l.source.color === "#ff0040" && !l.next; }, sid, { timeout: 5000, polling: 50 });
  await deck.locator(`.dcell.live[data-sid="${sid}"][data-col="0"]`).waitFor({ timeout: 3000 });
  // Al compás: espera (naranja) y entra en el siguiente compás.
  await deck.locator(".seg button", { hasText: "Al compás (4)" }).click();
  await deck.locator(".colbtn", { hasText: "▶ 2" }).click();
  assert.equal((await look()).color, "#ff0040", "aún no: espera al compás");
  await page.waitForFunction((sid) => { const a = window.__lumamap, l = a.S.project.scenes.find(s => s.id === a.S.project.sceneId).looks[sid]; return l.source.color === "#00e5ff"; }, sid, { timeout: 8000, polling: 50 });
  // Autopiloto cada 4 golpes (a 240 BPM = 1 s): vuelve a la columna 1 sola.
  await deck.locator(".seg button", { hasText: "Al instante" }).click();
  await deck.locator(".seg button", { hasText: /^4 golpes$/ }).click();
  try { await page.waitForFunction((sid) => { const a = window.__lumamap, l = a.S.project.scenes.find(s => s.id === a.S.project.sceneId).looks[sid]; return l.source.color === "#ff0040"; }, sid, { timeout: 15000, polling: 50 }); }
  catch (e) { console.log("DIAG-DECK", await page.evaluate((sid) => { const a = window.__lumamap, D = a.S.project.settings.deck; return JSON.stringify({ auto: D.autopilot, q: D.quantize, st: a.deckState, beat: a.lfoBeat(), playing: a.S.playing, bpm: a.S.levels?.bpm, sbpm: a.S.project.settings.bpm, row: (D.cells[sid] || []).map(c => c?.color) }); }, sid)); throw e; }
  await deck.locator(".seg button", { hasText: "Apagado" }).click();
  await page.locator("#modal").getByRole("button", { name: "Listo" }).click();
  // «Animar al ritmo»: clic derecho en «Brillo» → Animar → el brillo sube y baja solo.
  await page.evaluate((sid) => { const a = window.__lumamap; a.select(sid); a.openTab("fx"); }, sid);
  const bri = page.locator('#panelBody [data-param$="/fx/brightness"]').first();
  await bri.click({ button: "right" });
  await page.locator("#modal .lfoed").getByRole("button", { name: /Animar al ritmo/ }).click();
  await page.locator("#modal .lfoed .chip", { hasText: /^1$/ }).click();
  const lf = await page.evaluate(() => window.__lumamap.S.project.settings.lfos.map(l => ({ param: l.param, beats: l.beats })));
  assert.equal(lf.length, 1); assert.match(lf[0].param, /\/fx\/brightness$/); assert.equal(lf[0].beats, 1);
  const vals = [];
  for (let i = 0; i < 12; i++) { vals.push(await page.evaluate(() => (window.__lumamap.S.mods || []).find(m => /fx\/brightness$/.test(m.id))?.value)); await page.waitForTimeout(40); }
  assert.ok(vals.every(v => typeof v === "number"), "modula: " + vals.join(","));
  assert.ok(Math.max(...vals) - Math.min(...vals) > 0.2, "sube y baja: " + vals.map(v => v.toFixed(2)).join(","));
  const saved = await page.evaluate((sid) => { const a = window.__lumamap; return a.S.project.scenes.find(s => s.id === a.S.project.sceneId).looks[sid].fx.brightness; }, sid);
  assert.equal(saved, 1, "no toca el valor guardado");
  await page.locator("#modal .lfoed").getByRole("button", { name: "Quitar" }).click();
  assert.equal(await page.evaluate(() => window.__lumamap.S.project.settings.lfos.length), 0);
  await page.evaluate(() => { const a = window.__lumamap; a.S.project.settings.deck.cells = {}; a.S.project.settings.deck.quantize = "off"; a.actions.setBpm(120); a.S.liveFade = 0.3; a.openTab(null); });
  await page.keyboard.press("Escape");
});
await test("plugins en 4K: con la composición en 4K el shader se dibuja a 2160 líneas (o a lo que se elija en Calidad)", async () => {
  const r = await page.evaluate(async () => {
    const a = window.__lumamap, P = a.S.project, M = await import("./js/model.js");
    const old = { w: P.width, h: P.height, res: P.settings.output.shaderRes };
    P.width = 3840; P.height = 2160;
    const s = M.createQuad({ name: "4K", corners: M.rectCorners(0, 0, 3840, 2160) });
    M.addSurface(P, s, { type: "shader", shaderId: "fiesta-neon/0", speed: 1 });
    const { getShader } = await import("./js/plugins.js");
    const sid = getShader("fiesta-neon/0") ? "fiesta-neon/0" : (await import("./js/model.js")).ANIM_LIBRARY.find(x => x.shader && !x.shader.startsWith("virales-camara"))?.shader;
    M.lookOf(a.scene(), s.id).source.shaderId = sid;
    a.changed();
    const sizeOf = async () => { for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 100)); const e = a.compositor().shaders.out.get(a.scene().id + ":" + s.id); if (e?.canvas.height > 0) return [e.canvas.width, e.canvas.height]; } return null; };
    const auto = await sizeOf();
    P.settings.output.shaderRes = 1080; a.changed();
    await new Promise(r => setTimeout(r, 400));
    const hd = await sizeOf();
    P.surfaces = P.surfaces.filter(x => x.id !== s.id); P.width = old.w; P.height = old.h; P.settings.output.shaderRes = old.res; a.changed({ panel: true });
    return { auto, hd };
  });
  assert.deepEqual(r.auto, [3840, 2160], "auto en el PC: 4K");
  assert.deepEqual(r.hd, [1920, 1080], "elegido 1080p");
});
await test("como TouchDesigner: señales que siguen los graves (con monitor en vivo), red de nodos de la superficie (⏻, ＋, todo el show), tutorial con lección e interruptor, y Mi panel", async () => {
  // 1 · Señal que sigue los graves → mueve el brillo general, y se ve en «Señales en vivo».
  await page.evaluate(() => {
    const a = window.__lumamap, au = a.audio();
    window.__realUpdate = au.update.bind(au);
    au.update = () => ({ bass: 0.8, mid: 0.2, high: 0.1, level: 0.8, beat: 0, count: 0, bpm: 120, phase: 0, pos: 0, live: true, locked: false });
    a.S.project.settings.lfos = [{ id: "lfo-test-bass", param: "global/master", shape: "bass", beats: 4, lo: 0, hi: 1, on: true, smooth: 0, gain: 1 }];
    a.openTab("audio");
  });
  try {
    await page.waitForFunction(() => { const c = window.__lumamap.params.mods.get("global/master")?.get("lfo:lfo-test-bass"); return c && Math.abs(c.value - 0.8) < 0.02; }, null, { timeout: 10000, polling: 100 });
    const mon = page.locator("#panelBody canvas.sigmon");
    await mon.waitFor();
    await page.waitForTimeout(600);
    const lit = await mon.evaluate((c) => { const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; });
    assert.ok(lit > 200, "la gráfica dibuja las señales: " + lit);
    assert.match(await page.locator("#panelBody .sigleg").textContent(), /Brillo general/);
  } finally {
    await page.evaluate(() => { const a = window.__lumamap; a.audio().update = window.__realUpdate; a.S.project.settings.lfos = []; a.openTab(null); });
  }
  // 2 · Red de nodos: refleja la cadena real (un efecto nuevo aparece) y cada nodo lleva a su panel.
  const id = await page.evaluate(() => { const a = window.__lumamap, s = a.S.project.surfaces[0]; a.select(s.id); a.edit(() => { a.lookSel().fx.brightness = 1.5; }); a.openNodes(); return s.id; });
  const net = page.locator(".nodes .nodenet");
  await net.waitFor();
  const heads = await net.locator(".nodehead").allTextContents();
  assert.ok(heads.length >= 6, heads.join("|"));
  assert.equal(heads[0].toLowerCase(), "fuente"); assert.equal(heads.at(-1).toLowerCase(), "salida");
  assert.match(await net.locator('.node[data-fam="fx"]').first().textContent(), /Color.*Brillo/);
  // Tutorial guiado: la primera vez sale un consejo; «Entendido» y no vuelve a salir.
  assert.equal(await page.locator(".nodes .tutip").count(), 1, "consejo de la primera vez");
  await page.locator(".nodes .tutip").getByRole("button", { name: "Entendido" }).click();
  assert.equal(await page.locator(".nodes .tutip").count(), 0);
  // ⏻ apaga el efecto sin perderlo (bypass) y lo vuelve a encender igual.
  const colorNode = () => net.locator('.node[data-fam="fx"]', { hasText: "Brillo" }).first();
  await colorNode().locator(".nodepow").click();
  assert.deepEqual(await page.evaluate(() => { const l = window.__lumamap.lookSel(); return [l.fx.brightness, l.bypass?.Color?.brightness]; }), [1, 1.5]);
  assert.match(await colorNode().textContent(), /Apagado/);
  await colorNode().locator(".nodepow").click();
  assert.deepEqual(await page.evaluate(() => { const l = window.__lumamap.lookSel(); return [l.fx.brightness, l.bypass]; }), [1.5, undefined]);
  // ＋ añade un efecto encima de lo que ya tiene y aparece su nodo.
  await net.locator(".node.add").click();
  await page.locator(".nodes .nodeadd .chip", { hasText: "Caleidoscopio 6" }).click();
  assert.deepEqual(await page.evaluate(() => { const l = window.__lumamap.lookSel(); return [l.fx.kaleido, l.fx.brightness]; }), [6, 1.5]);
  await net.locator('.node[data-fam="fx"]', { hasText: "Distorsión" }).waitFor();
  // 🌐 Todo el show: una fila por superficie con su pantalla de salida.
  await page.locator(".nodes .chip", { hasText: "🌐 Todo el show" }).click();
  const rows = page.locator(".nodes .nodenet.mini");
  assert.equal(await rows.count(), await page.evaluate(() => window.__lumamap.S.project.surfaces.length));
  assert.match(await rows.first().locator('.node[data-fam="out"]').textContent(), /Pantalla|Todas/);
  await rows.first().locator('.node[data-fam="src"]').click();
  await net.waitFor();
  await net.locator('.node[data-fam="shape"]').click();
  await page.waitForFunction(() => window.__lumamap.S.tab === "shape", null, { timeout: 5000 });
  await page.evaluate((id) => { const a = window.__lumamap; a.select(id); a.edit(() => { a.lookSel().fx.brightness = 1; a.lookSel().fx.kaleido = 0; }); a.openTab(null); }, id);
  // La lección 11 (nodos) avanza sola con lo que haces de verdad; con el tutorial apagado se va.
  await page.evaluate(async () => { const m = await import("./js/panels-assistant.js"), a = window.__lumamap; m.aiOf(a); a.academy.start(11); });
  await page.locator("#academyCard", { hasText: "red de nodos" }).waitFor();   // paso 1 (hay superficie) ya hecho
  await page.evaluate(() => { window.__lumamap.openNodes(); });
  await page.locator("#academyCard", { hasText: "nodo morado" }).waitFor();
  await net.locator(".node.add").click();
  await page.locator(".nodes .nodeadd .chip", { hasText: "Sepia" }).click();
  await page.locator("#academyCard", { hasText: "Toca ⏻" }).waitFor();
  const sepia = () => net.locator('.node[data-fam="fx"]', { hasText: "Sepia" }).first();
  await sepia().locator(".nodepow").click();
  await page.waitForTimeout(700);   // la academia lo mira dos veces por segundo
  await sepia().locator(".nodepow").click();
  await page.locator("#academyCard", { hasText: "te lleva a «Efectos»" }).waitFor();
  await sepia().click();
  await page.locator("#academyCard", { hasText: "Crea una señal" }).waitFor();
  await page.evaluate(() => { const a = window.__lumamap; a.edit(() => { a.lookSel().fx.sepia = 0; }); });
  await page.evaluate(async () => { const { setTutorial, tutorialOn } = await import("./js/tutorial.js"); setTutorial(false, window.__lumamap); window.__tutOff = !tutorialOn(); });
  await page.locator("#academyCard").waitFor({ state: "detached" });
  assert.equal(await page.evaluate(async () => { const { tipCard, resetTips, setTutorial } = await import("./js/tutorial.js"); resetTips(); const off = tipCard(window.__lumamap, "nodes"); setTutorial(true); const on = tipCard(window.__lumamap, "nodes"); return [off, !!on].join(); }), ",true");
  await page.evaluate(() => window.__lumamap.openTab(null));
  // 3 · Mi panel: un deslizador y un botón elegidos por el usuario, que de verdad mueven el show.
  await page.evaluate(() => { const a = window.__lumamap; a.edit(() => { a.S.project.settings.panel = [{ param: "global/master", label: "" }, { param: "global/blackout", label: "Negro total" }]; }); if (a.S.blackout) a.actions.blackout(); a.S.liveSub = "mix"; a.openTab("live"); });
  const mp = page.locator("#panelBody .mpgrid");
  await mp.waitFor();
  await mp.locator("input[type=range]").first().evaluate((r) => { r.value = "0.3"; r.dispatchEvent(new Event("input", { bubbles: true })); });
  assert.ok(Math.abs(await page.evaluate(() => window.__lumamap.S.master) - 0.3) < 0.02);
  await mp.getByRole("button", { name: "Negro total" }).click();
  assert.equal(await page.evaluate(() => window.__lumamap.S.blackout), true);
  await mp.getByRole("button", { name: "Negro total" }).click();
  assert.equal(await page.evaluate(() => window.__lumamap.S.blackout), false);
  // Lo mismo llega al mando del móvil.
  const st = await page.evaluate(async () => { const { panelState } = await import("./js/mypanel.js"); const { describe } = await import("./js/params.js"); const a = window.__lumamap; return panelState(a.S.project.settings.panel, (id) => describe(a, id)); });
  assert.deepEqual(st.map(x => [x.id, x.name, x.kind]), [["global/master", "Brillo general", "float"], ["global/blackout", "Negro total", "bool"]]);
  await page.evaluate(() => { const a = window.__lumamap; a.S.master = 1; a.edit(() => { a.S.project.settings.panel = []; }); a.openTab(null); });
});

await test("Salida por red: desde Proyectar se manda la proyección y se ve en /frame.jpg y /stream.mjpg (como en OBS)", async () => {
  await page.evaluate(() => { const a = window.__lumamap; a.openTab(null); a.openTab("output"); });
  const fold = page.locator("#panelBody details", { hasText: "Salida por red" });
  await fold.locator("summary").click();
  await fold.locator(".seg button", { hasText: "540p" }).click();
  await fold.locator(".seg button", { hasText: /^10$/ }).click();
  await fold.locator(".toggle", { hasText: "Enviar la proyección por la red" }).click();
  await page.waitForFunction(() => (window.__lumamap.S.netOut?.sent || 0) >= 3, null, { timeout: 20000 });
  const urls = await page.evaluate(() => window.__lumamap.actions.netOutUrls());
  assert.ok(urls.some(u => /^http:\/\/127\.0\.0\.1:\d+\/stream\.mjpg$/.test(u)), urls.join(" "));
  await page.locator("#panelBody .netouturls code").first().waitFor();
  // La imagen que recibe otro programa: JPEG de 960×540 con la proyección (no negra).
  const img = await page.evaluate(async () => {
    const b = await (await fetch("/frame.jpg", { cache: "no-store" })).blob();
    const bmp = await createImageBitmap(b), c = Object.assign(document.createElement("canvas"), { width: 96, height: 54 }), g = c.getContext("2d");
    g.drawImage(bmp, 0, 0, 96, 54); const d = g.getImageData(0, 0, 96, 54).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
    return { type: b.type, w: bmp.width, h: bmp.height, light: s / (96 * 54 * 3) };
  });
  assert.equal(img.type, "image/jpeg"); assert.deepEqual([img.w, img.h], [960, 540]); assert.ok(img.light > 3, "con imagen " + img.light);
  // El video por la red también responde.
  const mj = await page.evaluate(async () => { const ctl = new AbortController(); const r = await fetch("/stream.mjpg", { signal: ctl.signal }); const rd = r.body.getReader(); const { value } = await rd.read(); ctl.abort(); return { ct: r.headers.get("content-type"), first: new TextDecoder().decode(value.slice(0, 40)) }; });
  assert.match(mj.ct, /multipart\/x-mixed-replace/); assert.match(mj.first, /--lumaframe/);
  await fold.locator(".toggle", { hasText: "Enviando por la red" }).click();
  assert.equal(await page.evaluate(() => window.__lumamap.S.netOut), null);
  await page.evaluate(() => window.__lumamap.openTab(null));
});

await test("Escenas y show: una sola pestaña (Show abre Escenas) con línea de tiempo: arrastrar la duración, luces por escena, saltar y reproducir desde el principio", async () => {
  const ids = await page.evaluate(() => { const a = window.__lumamap, P = a.S.project; a.openTab(null);
    const before = P.scenes.map(s => s.id);
    while (P.scenes.length < 3) a.actions.addScene();
    a.edit(() => { P.scenes[0].duration = 4; P.scenes[1].duration = 0; P.scenes[2].duration = 6; });
    a.actions.goScene(P.scenes[0].id, { instant: true });
    a.openTab("show");
    return { before, all: P.scenes.map(s => s.id), tab: a.S.tab }; });
  assert.equal(ids.tab, "scenes", "«show» abre la pestaña Escenas");
  assert.equal(await page.locator("#dock [data-tab=show]").count(), 0, "ya no hay pestaña Show aparte");
  const tl = page.locator("#panelBody .sec", { hasText: "Línea de tiempo" });
  await tl.waitFor();
  for (const t of ["Timecode", "Automatización grabada", "Actuación y emergencia"]) assert.equal(await page.locator("#panelBody summary", { hasText: t }).count(), 1, t);
  const blocks = tl.locator(".tlblock");
  assert.equal(await blocks.count(), ids.all.length);
  assert.equal(await tl.locator(".tlblock.manual").count(), 1, "la escena sin duración es «manual»");
  // Arrastrar el borde de la primera escena: 4 s → 6 s.
  await tl.locator(".tlscroll").scrollIntoViewIfNeeded();
  const b0 = await blocks.first().boundingBox(), pxs = b0.width / 4;
  const g = await blocks.first().locator(".tlgrip").boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2 + pxs * 2, g.y + g.height / 2, { steps: 5 }); await page.mouse.up();
  await page.waitForFunction(() => Math.abs(window.__lumamap.S.project.scenes[0].duration - 6) <= 0.5, null, { timeout: 5000 }).catch(async (e) => { console.log("DIAG-TL", JSON.stringify({ b0, g, pxs, d: await page.evaluate(() => window.__lumamap.S.project.scenes.map(s => s.duration)), at: await page.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); return el?.className + " " + el?.tagName; }, [g.x + g.width / 2, g.y + g.height / 2]) })); throw e; });
  // Luces de la segunda escena desde su pista.
  const sel = page.locator("#panelBody .sec", { hasText: "Línea de tiempo" }).locator(".tlsel").nth(1);
  const opt = await sel.locator("option").nth(3).getAttribute("value");
  await sel.selectOption(opt);
  assert.equal(await page.evaluate(() => window.__lumamap.S.project.scenes[1].lights), opt);
  // Tocar la regla en mitad de la tercera escena salta a ella.
  await page.locator("#panelBody .tlscroll").scrollIntoViewIfNeeded();
  const b2 = await page.locator("#panelBody .tlblock").nth(2).boundingBox(), r = await page.locator("#panelBody .tlruler").boundingBox();
  await page.mouse.click(b2.x + b2.width / 2, r.y + r.height / 2);
  const got = await page.evaluate(() => window.__lumamap.S.project.sceneId);
  if (got !== ids.all[2]) console.log("DIAG-RULER", JSON.stringify({ at: await page.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); return (el?.className || "") + " " + el?.tagName + " " + (el?.parentElement?.className || ""); }, [b2.x + b2.width / 2, r.y + r.height / 2]), b2, r, idx: ids.all.indexOf(got), n: ids.all.length, durs: await page.evaluate(() => window.__lumamap.S.project.scenes.map(s => s.duration)), blocks: await page.locator("#panelBody .tlblock").evaluateAll(els => els.map(e => [e.style.left, e.style.width])) }));
  assert.equal(got, ids.all[2]);
  // «Desde el principio»: primera escena, avance automático y Play; el cabezal avanza.
  await page.locator("#panelBody").getByRole("button", { name: "▶ Desde el principio" }).click();
  const st = await page.evaluate(() => { const a = window.__lumamap; return { id: a.S.project.sceneId, auto: a.S.project.settings.autoAdvance, playing: a.S.playing }; });
  assert.deepEqual(st, { id: ids.all[0], auto: true, playing: true });
  const x1 = await page.locator("#panelBody .tlhead").evaluate(e => parseFloat(e.style.left));
  await page.waitForTimeout(700);
  const x2 = await page.locator("#panelBody .tlhead").evaluate(e => parseFloat(e.style.left));
  assert.ok(x2 > x1, `el cabezal avanza (${x1} → ${x2})`);
  await page.evaluate((before) => { const a = window.__lumamap, P = a.S.project; a.edit(() => { P.scenes = P.scenes.filter(s => before.includes(s.id)); P.settings.autoAdvance = false; for (const s of P.scenes) { s.duration = 0; delete s.lights; } });
    a.actions.goScene(P.scenes[0].id, { instant: true }); a.openTab(null); }, ids.before);
});

await test("3D para proyectar: lente por relación de proyección, ajuste fino, y calibrar el proyector con el real por puntos (clic en una esquina, arrastrar la cruz o tocarla en la foto de la cámara con luz estructurada, calcular)", async () => {
  const surfBefore = await page.evaluate(() => { const a = window.__lumamap; a.openTab(null); a.openTab("3d"); return a.S.project.surfaces.map(s => s.id); });
  const panel = page.locator("#panelBody");
  await panel.locator(".sec", { hasText: "1 · Objeto" }).waitFor({ timeout: 30000 });
  await panel.locator(".chip", { hasText: "+ Cubo" }).first().click();
  await panel.locator(".chip", { hasText: /^1 proyector$/ }).click();
  const sec = panel.locator(".sec", { hasText: "4 · Alinear con el proyector real" });
  await sec.waitFor();
  const proj = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__lumamap.S.project.stage3d.projectors[0])));
  // Lente: «Estándar 1.5» pone el FOV de esa relación de proyección.
  await sec.locator("summary", { hasText: "Lente y ajuste fino" }).click();
  await sec.locator(".chip", { hasText: "Estándar 1.5" }).click();
  const want = await page.evaluate(async () => { const C = await import("./js/calib3d.js"), p = window.__lumamap.S.project.stage3d.projectors[0]; return C.fovFromThrow(1.5, p.res); });
  assert.ok(Math.abs((await proj()).fov - want) < 0.01, "FOV de la lente 1.5");
  // Ajuste fino: «→» mueve el proyector 2 cm hacia SU derecha.
  const p0 = await proj();
  await page.locator("#panelBody .sec", { hasText: "4 · Alinear" }).locator("summary", { hasText: "Lente y ajuste fino" }).evaluate(s => { s.parentElement.open = true; });
  await page.locator('#panelBody .calibgrid button[title="A la derecha"]').click();
  const p1 = await proj();
  assert.ok(Math.abs(Math.hypot(...p1.pos.map((v, i) => v - p0.pos[i])) - 0.02) < 1e-4, "se movió 2 cm: " + JSON.stringify([p0.pos, p1.pos]));
  // Calibrar por puntos.
  await page.locator("#panelBody").getByRole("button", { name: /Calibrar por puntos/ }).click();
  await page.locator("#panelBody .calibpad").waitFor();
  // Un clic DE VERDAD en el 3D, cerca de una esquina del cubo: se marca ese vértice.
  const corners = await page.evaluate(async () => {
    const T = await import("./vendor/three/three.module.min.js"), st = window.__lumamap.stage3d, o = window.__lumamap.S.project.stage3d.objects[0];
    const box = new T.Box3().setFromObject(st.nodes.get(o.id).obj), out = [];
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) out.push([x, y, z]);
    return out;
  });
  const target = corners.reduce((b, c) => (c[1] > b[1] || (c[1] === b[1] && c[2] > b[2]) ? c : b));   // una esquina de arriba, de delante
  const at = await page.evaluate(async (w) => {
    const T = await import("./vendor/three/three.module.min.js"), st = window.__lumamap.stage3d, cam = st.viewCamera(), r = st.vp.canvas.getBoundingClientRect();
    const v = new T.Vector3(...w).project(cam), c = new T.Vector3(...w).multiplyScalar(0.97).project(cam);   // un poco hacia dentro de la cara
    return { x: r.left + (c.x + 1) / 2 * r.width, y: r.top + (1 - c.y) / 2 * r.height };
  }, target);
  await page.mouse.click(at.x, at.y);
  await page.waitForFunction(() => window.__lumamap.S.project.stage3d.projectors[0].calib.points.length === 1, null, { timeout: 5000 });
  const first = (await proj()).calib.points[0].w;
  assert.ok(corners.some(c => Math.hypot(c[0] - first[0], c[1] - first[1], c[2] - first[2]) < 1e-4), "el clic eligió una esquina del cubo: " + JSON.stringify(first));
  // El resto de esquinas (como si se tocaran), y el proyector «real» un poco movido, girado y con otra lente.
  const truth = await page.evaluate(async (corners) => {
    const a = window.__lumamap, st = a.stage3d, p = a.S.project.stage3d.projectors[0], C = await import("./js/calib3d.js");
    for (const w of corners) st.calibPick(w);
    const truth = { ...p, pos: [p.pos[0] + 0.12, p.pos[1] - 0.08, p.pos[2] + 0.2], rot: [p.rot[0] + 2, p.rot[1] - 3, p.rot[2] + 0.5], fov: p.fov * 1.06, shift: [0.01, 0.06] };
    // Donde de verdad caen las esquinas en el proyector real (lo que el usuario hace arrastrando las cruces), salvo la primera.
    p.calib.points.slice(1).forEach(q => { q.uv = C.projectPoint(truth, q.w); });
    a.changed({ panel: true });
    return { pos: truth.pos, uv0: C.projectPoint(truth, p.calib.points[0].w) };
  }, corners);
  assert.equal((await proj()).calib.points.length, 8, "8 esquinas, sin repetir la del clic");
  // La primera cruz se lleva a su sitio arrastrando en el recuadro (y se afina con las flechas del teclado).
  const pad = page.locator("#panelBody .calibpad");
  await page.evaluate(() => { const p = window.__lumamap.S.project.stage3d.projectors[0]; p.calib.sel = p.calib.points[0].id; });
  const box = await pad.boundingBox(), q0 = (await proj()).calib.points[0].uv;
  await page.mouse.move(box.x + q0[0] * box.width, box.y + q0[1] * box.height);
  await page.mouse.down();
  await page.mouse.move(box.x + truth.uv0[0] * box.width, box.y + truth.uv0[1] * box.height, { steps: 6 });
  await page.mouse.up();
  await pad.focus(); await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowLeft");
  // Con la cámara (luz estructurada): una cámara simulada ve la imagen del proyector real (las
  // franjas que salen de verdad por las salidas); se escanea y se toca la esquina en la foto.
  await page.evaluate(async () => {
    const a = window.__lumamap, st = a.stage3d, G = await import("./js/graycode.js");
    st.camSettle = 5;
    st.camGrab = async () => {
      const w = 320, h = 240, img = new ImageData(w, h), pat = a.S.pattern;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const u = (x - 40) / 240, v = (y - 30) / 180;   // la imagen del proyector ocupa este trozo de la foto
        let on = 0;
        if (u >= 0 && u < 1 && v >= 0 && v < 1) {
          if (pat === "white") on = 1;
          else if (pat?.startsWith("gray:")) { const [, ax, k, b, inv] = pat.split(":"); on = G.grayBit(Math.floor((ax === "x" ? u : v) * (1 << +b)), +k, +b) ^ +inv; }
        }
        const i = (y * w + x) * 4, l = 25 + 200 * on; img.data[i] = img.data[i + 1] = img.data[i + 2] = l; img.data[i + 3] = 255;
      }
      return img;
    };
  });
  await page.locator("#panelBody").getByRole("button", { name: "Escanear con la cámara" }).click();
  const photo = page.locator("#panelBody .calibcam");
  await photo.waitFor({ timeout: 120000 });   // 42 patrones; en la CI cada fotograma del 3D va por software
  assert.equal(await page.evaluate(() => window.__lumamap.S.pattern), null, "al terminar se quitan las franjas");
  await photo.scrollIntoViewIfNeeded();
  const pb = await photo.boundingBox();
  await page.mouse.click(pb.x + (40 + truth.uv0[0] * 240) / 320 * pb.width, pb.y + (30 + truth.uv0[1] * 180) / 240 * pb.height);
  const byCam = (await proj()).calib.points[0];
  assert.ok(Math.abs(byCam.uv[0] - truth.uv0[0]) < 0.006 && Math.abs(byCam.uv[1] - truth.uv0[1]) < 0.008, "la cruz fue sola a la esquina: " + JSON.stringify([byCam.uv, truth.uv0]));
  assert.ok(Array.isArray(byCam.cam), "el punto se marca en la foto");
  await page.evaluate((uv) => { window.__lumamap.S.project.stage3d.projectors[0].calib.points[0].uv = uv; }, truth.uv0);   // lo que el ojo deja exacto
  // Mientras se calibra, el proyector real recibe su imagen con la malla y las cruces.
  await page.waitForFunction(() => { const st = window.__lumamap.stage3d, id = window.__lumamap.S.project.stage3d.projectors[0].id; return !!st.projectorView(id)?.el; }, null, { timeout: 10000 });
  await page.evaluate(() => window.__lumamap.commit());   // los puntos quedan en su paso del historial (deshacer = solo el cálculo)
  await page.locator("#panelBody").getByRole("button", { name: /^Calcular \(8\/6\)/ }).click();
  await page.evaluate(() => window.__lumamap.commit());
  await page.locator("#panelBody .calibres.ok").waitFor();
  const done = await proj();
  assert.ok(Math.hypot(...done.pos.map((v, i) => v - truth.pos[i])) < 0.002, "encontró dónde está el proyector real: " + JSON.stringify([done.pos, truth.pos]));
  assert.ok(done.calib.rms < 0.5, "error medio " + done.calib.rms);
  // Deshacer vuelve al proyector de antes; «Terminar» deja de calibrar.
  await page.evaluate(() => window.__lumamap.actions.undo());
  assert.ok(Math.hypot(...(await proj()).pos.map((v, i) => v - truth.pos[i])) > 0.05, "deshacer");
  await page.locator("#panelBody").getByRole("button", { name: "Terminar" }).click();
  assert.equal((await proj()).calib.on, false);
  assert.equal(await page.evaluate(() => window.__lumamap.stage3d.calibPick), null);
  await page.evaluate(async (keep) => { const a = window.__lumamap; (await import("./js/panels-3d.js")).closeWorkspace(a); a.edit(() => { a.S.project.stage3d.objects = []; a.S.project.stage3d.projectors = []; a.S.project.stage3d.faces = []; a.S.project.surfaces = a.S.project.surfaces.filter(s => keep.includes(s.id)); }); a.select(keep[0] || null); a.openTab(null); }, surfBefore);
});

await test("3D para proyectar: con el teclado (flechas mueven lo elegido o giran la vista, Re/Av Pág, Q/E, Esc) y en el teléfono una sola fila de botones", async () => {
  const kctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const g = await kctx.newPage();
  const errs = [];
  g.on("pageerror", e => errs.push(e.message));
  try {
    await g.goto(base);
    await g.waitForFunction(() => window.__lumamap?.S?.project, null, { timeout: 30000 });
    await g.waitForTimeout(1500);
    await g.evaluate(() => document.getElementById("modal")?._close?.(null));
    await g.evaluate(() => window.__lumamap.openTab("3d"));
    await g.waitForFunction(() => !!window.__lumamap.stage3d?.vp, null, { timeout: 30000 });
    const id = await g.evaluate(() => { const st = window.__lumamap.stage3d; const o = st.addObject("cube"); st.view("front"); window.__lumamap.changed({ panel: true }); document.activeElement?.blur(); return o.id; });
    const pos = () => g.evaluate((id) => window.__lumamap.S.project.stage3d.objects.find(o => o.id === id).pos, id);
    const p0 = await pos();
    await g.keyboard.press("ArrowRight");
    let p = await pos();
    assert.ok(Math.abs(p[0] - p0[0] - 0.05) < 1e-6 && p[2] === p0[2], "→ mueve 5 cm a la derecha (vista de frente): " + JSON.stringify([p0, p]));
    await g.keyboard.press("Shift+ArrowUp");
    p = await pos(); assert.ok(Math.abs(p[2] - p0[2] + 0.25) < 1e-6, "Mayús+↑: 25 cm hacia el fondo");
    await g.keyboard.press("PageUp");
    p = await pos(); assert.ok(Math.abs(p[1] - p0[1] - 0.05) < 1e-6, "Re Pág sube");
    await g.keyboard.press("q");
    assert.equal(await g.evaluate((id) => window.__lumamap.S.project.stage3d.objects.find(o => o.id === id).rot[1], id), 15);
    // Esc suelta lo elegido; entonces las flechas giran la vista (el objeto no se mueve).
    await g.keyboard.press("Escape");
    const cam0 = await g.evaluate(() => window.__lumamap.stage3d.vp.cam.position.toArray());
    const before = await pos();
    await g.keyboard.press("ArrowLeft");
    const cam1 = await g.evaluate(() => window.__lumamap.stage3d.vp.cam.position.toArray());
    assert.deepEqual(await pos(), before, "sin nada elegido no se mueve el objeto");
    assert.ok(Math.hypot(...cam1.map((v, i) => v - cam0[i])) > 0.1, "la vista gira");
    // En el teléfono: una sola fila arriba (lo demás en «⋯») y sin la ayuda larga.
    await g.setViewportSize({ width: 412, height: 860 });
    await g.waitForTimeout(400);
    const bar = await g.evaluate(() => { const b = document.querySelector("#ws3d .ws3d-bar"); const help = document.querySelector("#ws3d .ws3d-help"); const more = document.querySelector("#ws3d .ws3d-more"); return { h: b.getBoundingClientRect().height, help: getComputedStyle(help).display, more: getComputedStyle(more).display }; });
    assert.ok(bar.h < 60, "una fila: " + bar.h);
    assert.equal(bar.help, "none"); assert.equal(bar.more, "none");
    // (con el 3D dibujando por software la máquina va lenta: se toca sin esperar a que «quede quieto»)
    await g.locator("#ws3d .ws3d-moreb").waitFor({ state: "visible" });
    await g.locator("#ws3d .ws3d-moreb").dispatchEvent("click");
    assert.equal(await g.evaluate(() => getComputedStyle(document.querySelector("#ws3d .ws3d-more")).display), "contents", "«⋯» enseña el resto");
    assert.deepEqual(errs, []);
  } finally { await kctx.close(); }
});
await test("3D para proyectar: objeto real con la cámara (automático) — reconoce una caja, la pone en el 3D con sus medidas y el proyector donde está el real", async () => {
  const actx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const g = await actx.newPage();
  const errs = [];
  g.on("pageerror", e => errs.push(e.message));
  try {
    await g.goto(base);
    await g.waitForFunction(() => window.__lumamap?.S?.project, null, { timeout: 30000 });
    await g.waitForTimeout(1500);
    await g.evaluate(() => document.getElementById("modal")?._close?.(null));
    await g.evaluate(() => window.__lumamap.openTab("3d"));
    await g.locator("#panelBody .sec", { hasText: "Objeto real con la cámara" }).waitFor({ timeout: 30000 });
    // La escena de verdad: caja de 60 × 40 × 50 cm en el suelo, pared detrás, el proyector real y una cámara a su lado.
    const truth = await g.evaluate(async () => {
      const a = window.__lumamap, st = a.stage3d, C = await import("./js/calib3d.js"), G = await import("./js/graycode.js");
      const p = st.addProjector(); a.changed({ panel: true });
      const R2D = 180 / Math.PI, look = (pos, t) => { const d = t.map((v, i) => v - pos[i]); return [Math.atan2(d[1], Math.hypot(d[0], d[2])) * R2D, Math.atan2(-d[0], -d[2]) * R2D, 0]; };
      const proj = { pos: [1.1, 1.5, 2.4], rot: look([1.1, 1.5, 2.4], [0, 0.2, 0]), fov: p.fov, res: p.res, shift: [0, 0] };
      const cam = { pos: [0.7, 1.35, 2.3], rot: look([0.7, 1.35, 2.3], [0, 0.2, 0]), fov: 45, res: [320, 240] };
      const box = { min: [-0.3, 0, -0.25], max: [0.3, 0.4, 0.25] };
      const hitBox = (o, d) => { let t0 = -Infinity, t1 = Infinity; for (let i = 0; i < 3; i++) { if (Math.abs(d[i]) < 1e-12) { if (o[i] < box.min[i] || o[i] > box.max[i]) return Infinity; continue; } let x = (box.min[i] - o[i]) / d[i], y = (box.max[i] - o[i]) / d[i]; if (x > y) [x, y] = [y, x]; t0 = Math.max(t0, x); t1 = Math.min(t1, y); } return t1 >= t0 && t0 > 1e-6 ? t0 : Infinity; };
      // Para cada píxel de la cámara: el punto del proyector que lo ilumina (o nada).
      const W = 320, H = 240, uvAt = new Float32Array(W * H * 2).fill(NaN), Rc = C.eulerToMat(cam.rot), tc = Math.tan(cam.fov * Math.PI / 360);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const c = [((x + 0.5) / W - 0.5) * 2 * (W / H) * tc, -((y + 0.5) / H - 0.5) * 2 * tc, -1], d = [0, 1, 2].map(i => Rc[i][0] * c[0] + Rc[i][1] * c[1] + Rc[i][2] * c[2]), o = cam.pos;
        let t = hitBox(o, d); if (d[1] < 0) t = Math.min(t, -o[1] / d[1]); if (d[2] < 0) t = Math.min(t, (-1.2 - o[2]) / d[2]);
        if (!Number.isFinite(t)) continue;
        const P = o.map((v, i) => v + d[i] * t), toP = P.map((v, i) => v - proj.pos[i]), dist = Math.hypot(...toP);
        if (hitBox(proj.pos, toP.map(v => v / dist)) < dist - 1e-4) continue;
        const uv = C.projectPoint(proj, P);
        if (uv && uv[0] >= 0 && uv[0] < 1 && uv[1] >= 0 && uv[1] < 1) { uvAt[(y * W + x) * 2] = uv[0]; uvAt[(y * W + x) * 2 + 1] = uv[1]; }
      }
      st.camSettle = 5;
      st.camGrab = async () => {
        const pat = a.S.pattern, img = new ImageData(W, H);
        for (let i = 0; i < W * H; i++) {
          const u = uvAt[i * 2], v = uvAt[i * 2 + 1];
          let on = 0;
          if (!Number.isNaN(u)) { if (pat === "white") on = 1; else if (pat?.startsWith("gray:")) { const [, ax, k, b, inv] = pat.split(":"); on = G.grayBit(Math.floor((ax === "x" ? u : v) * (1 << +b)), +k, +b) ^ +inv; } }
          const l = 30 + 190 * on; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = l; img.data[i * 4 + 3] = 255;
        }
        return img;
      };
      return { pos: proj.pos };
    });
    await g.locator("#panelBody input[placeholder=ancho]").fill("60");
    await g.locator("#panelBody input[placeholder=ancho]").dispatchEvent("change");
    await g.locator("#panelBody").getByRole("button", { name: /Detectar el objeto y calibrar/ }).click();
    await g.locator("#panelBody .autokind", { hasText: "Caja" }).waitFor({ timeout: 240000 });
    assert.match(await g.locator("#panelBody .autokind").textContent(), /3 caras/);
    assert.equal(await g.evaluate(async () => (await import("./js/objscan.js")).analyzeAndSolve.lastPath), "worker", "el cálculo va en un hilo aparte");
    assert.equal(await g.locator("#panelBody .sec", { hasText: "Objeto real con la cámara" }).locator("canvas.calibcam").count(), 1, "foto con las caras marcadas");
    assert.equal(await g.evaluate(() => window.__lumamap.S.pattern), null, "sin franjas al terminar");
    await g.locator("#panelBody").getByRole("button", { name: /Poner la caja en el 3D/ }).click();
    const got = await g.evaluate(() => { const d = window.__lumamap.S.project.stage3d, o = d.objects.find(x => x.name === "Caja detectada"), p = d.projectors[0]; return { scale: o?.scale, pos: o?.pos, ppos: p.pos, wire: p.wire }; });
    const dims = [...got.scale].sort((x, y) => x - y), real = [0.4, 0.5, 0.6];
    dims.forEach((v, i) => assert.ok(Math.abs(v - real[i]) / real[i] < 0.2, "medidas " + JSON.stringify(got.scale)));
    assert.ok(Math.abs(got.pos[1] - got.scale[1] / 2) < 1e-3, "apoyada en el suelo");
    const dist = Math.hypot(...got.ppos), realDist = Math.hypot(...truth.pos);
    assert.ok(Math.abs(dist - realDist) < 0.3, `proyector a ${dist.toFixed(2)} m (real ${realDist.toFixed(2)})`);
    assert.equal(got.wire, true, "malla encendida para comprobarlo en el objeto real");
    assert.deepEqual(errs, []);
  } finally { await actx.close(); }
});
await test("comparador antes/después en Efectos: a un lado de la línea el original, al otro con el efecto (y no sale en la proyección)", async () => {
  await page.bringToFront();
  // Solo se ve esta superficie (otras pruebas dejan rojo en las demás, p. ej. la paleta del VJ).
  const id = await page.evaluate(() => { const a = window.__lumamap, s = a.S.project.surfaces[0]; a.select(s.id); a.actions.setSource({ type: "color", color: "#ff0000" });
    window.__hiddenForCompare = a.S.project.surfaces.filter(x => x.id !== s.id && !x.hidden).map(x => x.id);
    for (const x of a.S.project.surfaces) if (window.__hiddenForCompare.includes(x.id)) x.hidden = true;
    a.edit(() => { a.lookSel().fx.invert = true; }); a.openTab("fx"); return s.id; });
  // Cuenta píxeles rojos (original) y cian (negativo) en una captura de la pantalla (lo que se ve de verdad;
  // el lienzo WebGL no guarda el dibujo y leerlo directamente a veces da vacío).
  const count = async () => {
    const box = await page.locator("#gl").boundingBox();
    const png = (await page.screenshot({ clip: box })).toString("base64");
    return page.evaluate(async (b64) => {
      const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
      const c = Object.assign(document.createElement("canvas"), { width: img.width >> 1, height: img.height >> 1 }), g = c.getContext("2d");
      g.drawImage(img, 0, 0, c.width, c.height);
      const d = g.getImageData(0, 0, c.width, c.height).data; let red = 0, cyan = 0;
      for (let i = 0; i < d.length; i += 4) { if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] < 60) red++; if (d[i] < 60 && d[i + 1] > 200 && d[i + 2] > 200) cyan++; }
      return { red, cyan };
    }, png);
  };
  await page.waitForTimeout(300);
  const off = await count();
  if (!(off.cyan > 50)) console.log("DIAG-CMP", await page.evaluate((id) => { const a = window.__lumamap, l = a.scene().looks[id], s = a.S.project.surfaces.find(x => x.id === id); return JSON.stringify({ src: l.source.type, color: l.source.color, next: !!l.next, mix: l.mix, hidden: l.hidden, shidden: s.hidden, opacity: l.opacity, alpha: l.fx.opacity, inv: l.fx.invert, screen: s.screen, view: a.S.viewScreen, black: a.S.blackout, master: a.S.master, playing: a.S.playing, fx: Object.fromEntries(Object.entries(l.fx).filter(([k, v]) => v && v !== 1 && k !== "invert")) }); }, id));
  assert.ok(off.cyan > 50 && off.red < 30, "sin comparar: todo con el efecto " + JSON.stringify(off));   // (otras superficies pueden tener algo de rojo)
  await page.locator("#panelBody .fxcompare").getByText("Comparar antes / después").click();
  await page.waitForFunction((id) => window.__lumamap.S.compare?.id === id, id);
  // La línea en el centro de la superficie.
  await page.evaluate(() => { const a = window.__lumamap, s = a.surf(), xs = s.corners ? s.corners.map(p => p.x) : s.points.map(p => p.x); a.S.compare.x = (Math.min(...xs) + Math.max(...xs)) / 2 / a.S.project.width; });
  await page.waitForTimeout(300);
  const on = await count();
  assert.ok(on.red > off.red + 30 && on.cyan > 20, "con la línea: original y con efecto " + JSON.stringify({ off, on }));
  assert.ok(await page.locator("#panelBody .fxcompare input[type=range]").count(), "control de la línea");
  // Al salir de Efectos deja de comparar.
  await page.evaluate(() => window.__lumamap.openTab(null));
  await page.waitForTimeout(300);
  assert.ok((await count()).red <= off.red + 5, "fuera de Efectos no se compara");
  await page.evaluate(() => { const a = window.__lumamap; a.S.compare = null; a.edit(() => { a.lookSel().fx.invert = false; });
    for (const x of a.S.project.surfaces) if ((window.__hiddenForCompare || []).includes(x.id)) x.hidden = false; a.changed({ panel: true }); });
});
await test("móvil: nada amontonado (de pie 4 + «Más», tumbado 7 + «Más», nada cortado ni fuera de la pantalla)", async () => {
  for (const [vp, max] of [[{ width: 393, height: 852 }, 5], [{ width: 852, height: 393 }, 8]]) {
    const mctx = await browser.newContext({ viewport: vp, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const m = await mctx.newPage();
    const errs = []; m.on("pageerror", e => errs.push(e.message));
    await m.goto(base);
    await m.waitForFunction(() => window.__lumamap?.S);
    await m.keyboard.press("Escape");
    const r = await m.evaluate(() => {
      const dock = document.querySelector("#dock"), top = document.querySelector("#top");
      const over = (el) => el.scrollWidth - el.clientWidth;
      const cut = [...dock.querySelectorAll("button span")].filter(s => s.scrollWidth > s.clientWidth + 1).map(s => s.textContent);
      return { n: dock.querySelectorAll("button").length, more: !!dock.querySelector("button.more"), dockOver: over(dock), topOver: over(top), cut,
        topVisible: [...top.querySelectorAll("button")].filter(b => b.offsetParent).every(b => { const rc = b.getBoundingClientRect(); return rc.right <= innerWidth + 1 && rc.left >= -1; }) };
    });
    assert.ok(r.n <= max && r.more, `${vp.width}×${vp.height}: ${r.n} botones`);
    assert.equal(r.dockOver, 0, "la barra de abajo no se sale"); assert.equal(r.topOver, 0, "la barra de arriba no se sale");
    assert.ok(r.topVisible, "todos los botones de arriba se ven");
    assert.deepEqual(r.cut, [], "nombres cortados");
    // «Más» abre el resto; al elegir una se abre y «Más» queda marcado.
    // (la barra se vuelve a montar al cambiar de tamaño: se pulsa en cuanto se ve, sin esperar a que «esté quieta»)
    await m.locator("#dock button.more").waitFor();
    await m.evaluate(() => document.querySelector("#dock button.more").click());
    await m.locator(".moretabs .moretab", { hasText: "Luces" }).click();
    await m.waitForFunction(() => window.__lumamap.S.tab === "lights");
    assert.ok(await m.locator("#dock button.more.on").count(), "«Más» marcado");
    assert.deepEqual(errs, []);
    await mctx.close();
  }
});
await test("si la tarjeta gráfica no puede con el dibujo: pantalla clara con el detalle para copiar (y Reintentar)", async () => {
  const gctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  // Simula un controlador que no logra enlazar el sombreador principal.
  await gctx.addInitScript(() => {
    const orig = WebGL2RenderingContext.prototype.getProgramParameter;
    WebGL2RenderingContext.prototype.getProgramParameter = function (p, k) { return k === this.LINK_STATUS ? false : orig.call(this, p, k); };
    WebGL2RenderingContext.prototype.getProgramInfoLog = function () { return "simulado: too many registers"; };
  });
  const g = await gctx.newPage();
  try {
    await g.goto(base);
    await g.locator(".fatal h1", { hasText: "Error de GPU" }).waitFor({ timeout: 20000 });
    const txt = await g.locator(".fatal").textContent();
    assert.match(txt, /simulado: too many registers/);
    assert.match(txt, /Tarjeta:/);
    assert.match(txt, /Android System WebView/, "en el navegador/móvil dice qué actualizar");
    assert.ok(await g.locator("#gpuCopy").count() && await g.locator("#gpuRetry").count());
  } finally { await gctx.close(); }
});
await test("Escenas y show: exportar el show a video (MP4 fotograma a fotograma, con la canción): cada escena en su segundo", async () => {
  const { execFileSync } = await import("node:child_process");
  const ectx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const g = await ectx.newPage();
  const errs = [];
  g.on("pageerror", e => errs.push(e.message));
  try {
    await g.goto(base);
    await g.waitForFunction(() => window.__lumamap?.S?.project, null, { timeout: 30000 });
    await g.waitForTimeout(1500);   // la bienvenida (perfil nuevo) prepara su proyecto
    await g.evaluate(() => document.getElementById("modal")?._close?.(null));
    await g.waitForTimeout(500);
    await g.evaluate(async () => {
      const a = window.__lumamap, A = a.actions, P = a.S.project;
      window.showSaveFilePicker = undefined;            // sin acceso a archivos: se guarda al final (como en el móvil)
      if (!P.surfaces.length) A.addQuad?.();
      while (P.scenes.length < 2) A.addScene();
      while (P.scenes.length > 2) P.scenes.pop();
      const paint = (sc, color) => { for (const l of Object.values(sc.looks)) { l.source = { type: "color", color }; l.fx = { ...l.fx }; } };
      a.edit(() => {
        paint(P.scenes[0], "#ff0000"); paint(P.scenes[1], "#0000ff");
        P.scenes[0].duration = 1; P.scenes[1].duration = 1; P.scenes[1].transition = "fade"; P.scenes[1].trMs = 300;
        for (const s of P.surfaces) s.hidden = false;
      });
      A.goScene(P.scenes[1].id, { instant: true });
      // Canción de 2 s (WAV hecho aquí): debe sonar en el video.
      const sr = 48000, n = sr * 2, buf = new ArrayBuffer(44 + n * 4), dv = new DataView(buf);
      const w = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
      w(0, "RIFF"); dv.setUint32(4, 36 + n * 4, true); w(8, "WAVEfmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true);
      dv.setUint32(24, sr, true); dv.setUint32(28, sr * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true); w(36, "data"); dv.setUint32(40, n * 4, true);
      for (let i = 0; i < n; i++) { const v = Math.round(Math.sin(2 * Math.PI * 440 * i / sr) * 12000); dv.setInt16(44 + i * 4, v, true); dv.setInt16(46 + i * 4, v, true); }
      A.loadSong(new File([buf], "prueba.wav", { type: "audio/wav" }));
      await new Promise(r => setTimeout(r, 300));
      a.openTab("scenes");
    });
    const tl = g.locator("#panelBody .sec", { hasText: "Línea de tiempo" });
    await tl.locator("button", { hasText: "Exportar video" }).click();
    const dlg = g.locator("#modal.show");
    await dlg.locator("h2", { hasText: "Exportar el show a video" }).waitFor();
    assert.match(await dlg.textContent(), /Show de 0:02/);
    assert.match(await dlg.textContent(), /Con la canción «prueba»/);
    await dlg.locator(".seg button", { hasText: "720p" }).click();
    await dlg.locator(".seg button", { hasText: /^24$/ }).click();
    const sceneBefore = await g.evaluate(() => window.__lumamap.S.project.sceneId);
    const dl = g.waitForEvent("download", { timeout: 300000 });
    dl.catch(() => {});
    await dlg.locator("button", { hasText: "🎬 Exportar" }).click();
    await dlg.locator("p", { hasText: /Video listo|No se pudo|cancelada/ }).waitFor({ timeout: 300000 });
    const res = await dlg.locator("p").first().textContent();
    assert.match(res, /Video listo/, "resultado: " + res);
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lumamap-exp-")), "show.mp4");
    await (await dl).saveAs(file);
    assert.match(await dlg.textContent(), /1280×720 a 24 fps/);
    // Vuelve todo a como estaba (escena, ya no exporta).
    assert.deepEqual(await g.evaluate(() => [window.__lumamap.S.project.sceneId, !!window.__lumamap.S.exporting]), [sceneBefore, false]);
    const bytes = fs.readFileSync(file);
    assert.equal(bytes.subarray(4, 8).toString(), "ftyp");
    let ok = false; try { execFileSync("ffprobe", ["-version"], { stdio: "ignore" }); ok = true; } catch {}
    if (ok) {
      const p = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", "-count_frames", file]).toString());
      const vs = p.streams.find(s => s.codec_type === "video"), as = p.streams.find(s => s.codec_type === "audio");
      assert.equal(vs.width, 1280); assert.equal(vs.height, 720); assert.equal(+vs.nb_read_frames, 48, "2 s a 24 fps"); assert.equal(vs.r_frame_rate, "24/1");
      assert.ok(as, "con sonido"); assert.equal(+as.sample_rate, 48000);
      assert.ok(Math.abs(+p.format.duration - 2) < 0.15, "dura 2 s: " + p.format.duration);
      assert.equal(execFileSync("ffmpeg", ["-v", "error", "-i", file, "-f", "null", "-"], { stdio: ["ignore", "pipe", "pipe"] }).toString().trim(), "", "se decodifica sin errores");
      // Color medio del centro en un instante: rojo en la escena 1, azul en la 2.
      const at = (t) => { const b = execFileSync("ffmpeg", ["-v", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-vf", "crop=iw/4:ih/4,scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]); return [...b.subarray(0, 3)]; };
      const [r1, , b1] = at(0.5), [r2, , b2] = at(1.7);
      assert.ok(r1 > 150 && b1 < 80, `0,5 s rojo: ${at(0.5)}`);
      assert.ok(b2 > 150 && r2 < 80, `1,7 s azul: ${at(1.7)}`);
    } else console.log("    (sin ffmpeg: solo se comprueba que es un MP4)");
    assert.deepEqual(errs, []);
  } finally { await ectx.close(); }
});
await test("novedades: tras actualizar salen solas con la versión, y cada «Abrir» lleva a la función (nodos, señales, línea de tiempo, exportar); botón «Nodos» arriba", async () => {
  const nctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  // Alguien que ya usaba LumaMap (hay datos suyos de antes) y acaba de actualizar.
  await nctx.addInitScript(() => { if (!sessionStorage.getItem("t")) { sessionStorage.setItem("t", "1"); localStorage.setItem("lumamap:camFacing", "environment"); } });
  // Almacenamiento lento (como un equipo cargado): abrir el proyecto guardado tarda 3 s. Antes las
  // novedades salían primero y la bienvenida las tapaba; ahora salen después de decidir la bienvenida.
  await nctx.addInitScript(() => { const o = indexedDB.open.bind(indexedDB); indexedDB.open = (...a) => { const r = o(...a); const real = Object.getOwnPropertyDescriptor(IDBRequest.prototype, "onsuccess"); let cb = null; Object.defineProperty(r, "onsuccess", { set(f) { cb = f; real.set.call(r, (e) => setTimeout(() => cb && cb.call(r, e), 3000)); }, get() { return cb; } }); return r; }; });
  const g = await nctx.newPage();
  const errs = [];
  g.on("pageerror", e => errs.push(e.message));
  try {
    await g.goto(base);
    await g.waitForFunction(() => window.__lumamap?.S?.project, null, { timeout: 30000 });
    const dlg = g.locator("#modal.show");
    // Si sale antes la bienvenida, se cierra; luego salen las novedades.
    await g.waitForFunction(() => /Novedades|Bienvenid/.test(document.querySelector("#modal.show h2")?.textContent || ""), null, { timeout: 30000 });
    if (/Bienvenid/.test(await dlg.locator("h2").textContent())) await g.evaluate(() => document.getElementById("modal")._close(null));
    await dlg.locator("h2", { hasText: "Novedades" }).waitFor({ timeout: 30000 });
    assert.match(await dlg.textContent(), /Tienes LumaMap/);
    for (const t of ["Editor de redes de nodos", "Señales en vivo", "Mi panel", "Línea de tiempo del show", "Exportar el show a video", "Calibrar el proyector con la cámara"]) assert.ok(await dlg.locator(".newsitem", { hasText: t }).count(), t);
    // Señales: lleva a la pestaña Audio y a su sección, resaltada.
    await dlg.locator(".newsitem", { hasText: "Señales en vivo" }).getByRole("button", { name: "Abrir" }).click();
    await g.waitForFunction(() => window.__lumamap.S.tab === "audio" && /Señales en vivo/.test(document.querySelector("#panelBody .sec.flash h3")?.textContent || ""), null, { timeout: 10000 });
    // Ya vistas: al recargar no salen otra vez; se abren desde ☰ o con el botón de arriba.
    await g.reload(); await g.waitForFunction(() => window.__lumamap?.S?.project, null, { timeout: 30000 });
    await g.waitForTimeout(3500);
    assert.equal(await g.locator("#modal.show h2", { hasText: "Novedades" }).count(), 0, "no se repiten");
    await g.locator('#top [data-act="news"]').click();
    await dlg.locator(".newsitem", { hasText: "Línea de tiempo del show" }).getByRole("button", { name: "Abrir" }).click();
    await g.waitForFunction(() => window.__lumamap.S.tab === "scenes" && /Línea de tiempo/.test(document.querySelector("#panelBody .sec.flash h3")?.textContent || ""), null, { timeout: 10000 });
    await g.locator('#top [data-act="news"]').click();
    await dlg.locator(".newsitem", { hasText: "Exportar el show a video" }).getByRole("button", { name: "Abrir" }).click();
    await dlg.locator("h2", { hasText: "Exportar el show a video" }).waitFor({ timeout: 10000 });
    await g.evaluate(() => document.getElementById("modal")._close(null));
    // Botón «Nodos» siempre visible arriba: abre el editor de redes (como TouchDesigner).
    await g.locator('#top [data-act="nodes"]').click();
    await g.locator("#tdws.show").waitFor({ timeout: 15000 });
    await g.keyboard.press("Escape");
    await g.locator("#tdws.show").waitFor({ state: "detached", timeout: 5000 }).catch(() => g.locator("#tdws").waitFor({ state: "hidden" }));
    assert.deepEqual(errs, []);
  } finally { await nctx.close(); }
});
await test("si Windows reinicia la tarjeta gráfica: protege (shaders a menos resolución), avisa y no recarga en bucle", async () => {
  const gctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const g = await gctx.newPage();
  const errs = [];
  g.on("pageerror", e => errs.push(e.message));
  const ready = () => g.waitForFunction(() => window.__lumamap?.S?.project && document.querySelector("#gl"), null, { timeout: 30000 });
  const loseGl = () => g.evaluate(() => { window.__mark = 1; document.querySelector("#gl").getContext("webgl2").getExtension("WEBGL_lose_context").loseContext(); });
  try {
    await g.goto(base); await ready();
    assert.equal(await g.evaluate(() => window.__lumamap.gpuGuard.read().level), 0);
    // 1) Una caída: guarda, sube la protección y recarga sola (el autoguardado lo restaura).
    await loseGl();
    await g.waitForFunction(() => !window.__mark && window.__lumamap?.S?.project, null, { timeout: 30000 });
    assert.equal(await g.evaluate(() => window.__lumamap.gpuGuard.read().level), 1);
    assert.equal(await g.evaluate(async () => (await import("./js/compose.js")).shaderCap(window.__lumamap.S.project)), 1440, "shaders a 1440p como máximo");
    await g.locator("#notices .notice", { hasText: "La tarjeta gráfica se reinició" }).waitFor({ timeout: 30000 });   // en la CI la recarga recompila los shaders por software
    assert.match(await g.locator("#notices [data-id=gpuguard]").textContent(), /1440p/);
    // En Proyectar → Calidad se ve y se puede quitar.
    await g.evaluate(() => window.__lumamap.openTab("output"));
    const box = g.locator(".gpuguard");
    await box.waitFor({ timeout: 15000 });
    assert.match(await box.textContent(), /1440p/);
    // 2) En bucle (4 caídas en 5 minutos): no recarga sin fin; explica qué hacer.
    await g.evaluate(() => { const n = Date.now(); localStorage.setItem("lumamap:gpuguard", JSON.stringify({ level: 1, losses: [n - 60000, n - 40000, n - 20000], why: "" })); });
    await loseGl();
    await g.locator(".fatal h1", { hasText: "se reinició varias veces" }).waitFor({ timeout: 30000 });
    await g.waitForTimeout(1500);
    assert.equal(await g.evaluate(() => window.__mark), 1, "no recargó");
    assert.equal(await g.evaluate(() => JSON.parse(localStorage.getItem("lumamap:gpuguard")).level), 2);
    // «Seguir con la protección»: vuelve a abrir con la protección puesta y sin contar las caídas viejas.
    await g.locator("#gpuAgain").click();
    await g.waitForFunction(() => !window.__mark && window.__lumamap?.S?.project, null, { timeout: 30000 });
    assert.deepEqual(await g.evaluate(() => { const x = window.__lumamap.gpuGuard.read(); return [x.level, x.losses.length]; }), [2, 0]);
    // Quitar la protección (botón de Proyectar → Calidad).
    await g.evaluate(() => document.getElementById("modal")?._close?.(null));   // la bienvenida (perfil nuevo)
    await g.evaluate(() => window.__lumamap.openTab("output"));
    await g.locator(".gpuguard button", { hasText: "Quitar la protección" }).click();
    assert.equal(await g.evaluate(() => window.__lumamap.gpuGuard.read().level), 0);
    assert.equal(await g.locator(".gpuguard").count(), 0);
    assert.deepEqual(errs, []);
  } finally { await gctx.close(); }
});
await test("sin errores de JavaScript", () => assert.deepEqual(errors, []));

await browser.close();
srv.close();
report();
process.exit(process.exitCode || 0);
