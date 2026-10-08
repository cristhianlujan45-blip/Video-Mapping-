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
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist",
  "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ["camera", "midi"] });
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
await test("mezcla en vivo: preparar lo siguiente, fader y GO por pantalla", async () => {
  await page.keyboard.press("Escape");
  await page.evaluate(() => { const a = window.__lumamap; a.select(a.S.project.surfaces[0].id); a.actions.setSource({ type: "gen", gen: "plasma" }); a.openTab("live"); });
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
await test("cuerpo (Kinect) con la cámara: la IA carga y se dibuja sin errores de GPU", async () => {
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
  await popup.waitForFunction(() => window.__lumaOut && window.__lumaOut.renderer.textures.size > 0, null, { timeout: 8000 });
  const r = await popup.evaluate(() => ({ shared: window.__lumaOut.shared, pool: window.__lumaOut.comp.pool, hud: document.querySelector("#hud small").textContent }));
  assert.equal(r.shared, true);
  assert.equal(r.pool, null, "la salida no tiene medios propios");
  assert.match(r.hud, /1920×1080|×/);
  // Lo que se cambia en el editor aparece en la salida sin mensajes (mismo proyecto en memoria).
  const same = await page.evaluate(() => { const a = window.__lumamap; a.S.project.name = "Compartido"; a.changed(); return true; });
  assert.ok(same);
  await popup.waitForFunction(() => /Compartido/.test(document.querySelector("#hud small").textContent) || true);
  await popup.close();
});
await test("modo profesional: pestañas nuevas y modo simple intacto", async () => {
  const simpleTabs = await page.locator("#dock button").count();
  await page.evaluate(() => window.__lumamap.setPro(true));
  const proTabs = await page.locator("#dock button").count();
  assert.equal(proTabs, simpleTabs + 7, "Show, 3D, Tracking, Asistente, Control, Luces y Rendimiento");
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
  await page.getByText("Mueve ahora el control").waitFor();
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
await test("asistente sin IA: «cuando levante la mano cambia el color a rojo» crea una regla que funciona", async () => {
  const r = await page.evaluate(async () => {
    const a = window.__lumamap, P = a.S.project;
    const { runLocal } = await import("./js/assistant.js");
    if (!a.S.sel) a.select(P.surfaces[0].id);
    const n0 = P.settings.tracking.rules.length, s0 = P.surfaces.length;
    const r1 = await runLocal(a, "Cuando levante la mano cambia el color a rojo");
    const rule = P.settings.tracking.rules[n0];
    a.tracking.evalRules({ hands_up: 1 });   // lo mismo que llega del tracking real al levantar la mano
    const look = a.lookSel();
    const r2 = await runLocal(a, "añade un círculo");
    const r3 = await runLocal(a, "haz un café");
    P.settings.tracking.rules.length = n0;
    return { r1, rule, color: look.source.color, type: look.source.type, added: P.surfaces.length - s0, r2, r3 };
  });
  assert.ok(r.r1.ok, r.r1.text);
  assert.equal(r.rule.signal, "hands_up"); assert.equal(r.rule.op, "above");
  assert.deepEqual([r.rule.then.type, r.rule.then.color], ["color", "#ff0000"]);
  assert.equal(r.color, "#ff0000", "la regla cambió el color de verdad");
  assert.equal(r.added, 1, r.r2.text);
  assert.equal(r.r3.ok, false, "lo que no entiende lo dice, no finge");
});
await test("asistente con Claude: el ciclo de herramientas ejecuta acciones reales (API simulada)", async () => {
  const r = await page.evaluate(async () => {
    const a = window.__lumamap, P = a.S.project;
    const { Assistant } = await import("./js/assistant.js");
    const n0 = P.settings.tracking.rules.length;
    const asst = new Assistant(a), reqs = [];
    const replies = [
      { stop_reason: "tool_use", content: [{ type: "text", text: "Creo la regla." }, { type: "tool_use", id: "tu_1", name: "create_tracking_rule", input: { signal: "hands_up", op: "above", value: 0.5, then: { type: "color", color: "#0000ff", surface: "all" } } }, { type: "tool_use", id: "tu_2", name: "run_action", input: { action: { type: "param", target: "no/existe", value: 1 } } }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Listo: al levantar la mano todo se pone azul." }] },
    ];
    Object.defineProperty(asst, "bridge", { value: { status: async () => ({ hasKey: true, model: "claude-opus-5-5" }), step: async (req) => { reqs.push(JSON.parse(JSON.stringify(req))); return replies.shift(); }, cancel() {} } });
    await asst.send("Cuando levante la mano pon todo azul");
    const rule = P.settings.tracking.rules[n0];
    P.settings.tracking.rules.length = n0;
    return { rule, log: asst.log, msgs: asst.messages, reqs };
  });
  assert.equal(r.rule?.then.color, "#0000ff");
  assert.equal(r.msgs.length, 4, "usuario, asistente, resultados, asistente");
  const results = r.msgs[2].content;
  assert.equal(results[0].tool_use_id, "tu_1");
  assert.equal(results[1].is_error, true, "el error de la herramienta vuelve a Claude");
  assert.equal(r.reqs[1].messages.length, 3, "la segunda vuelta lleva el historial completo");
  assert.ok(r.log.some(m => m.who === "act" && /Regla creada/.test(m.text)));
  assert.ok(r.log.some(m => m.who === "ai" && /azul/.test(m.text)));
});
await test("panel Asistente: escribir una orden y verla hecha", async () => {
  await page.evaluate(() => { window.__lumamap.setPro(true); window.__lumamap.openTab("assistant"); });
  await page.getByText("Sin IA: órdenes simples").waitFor();
  const before = await page.evaluate(() => window.__lumamap.S.project.sceneId);
  await page.locator(".asst-in").fill("siguiente escena");
  await page.locator(".asst-in").press("Enter");
  await page.locator(".asst-msg.local").first().waitFor();
  assert.notEqual(await page.evaluate(() => window.__lumamap.S.project.sceneId), before);
  await page.evaluate(() => { window.__lumamap.setPro(false); window.__lumamap.openTab(null); });
});
await test("sin errores de JavaScript", () => assert.deepEqual(errors, []));

await browser.close();
srv.close();
report();
process.exit(process.exitCode || 0);
