// tests/effects.browser.test.js — cada efecto, estilo y animación se dibuja de verdad en la GPU
// (WebGL2 por software en la CI) y se comprueba que hace algo: sobre una imagen con detalle Y
// sobre una animación, sin errores de WebGL, sin salir negro y (las animaciones) moviéndose.
import { createServer } from "../server/index.js";
import { test, report } from "./harness.js";
import assert from "node:assert/strict";

let chromium;
try { ({ chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright")); }
catch { console.log("Playwright no está instalado: se omiten las pruebas de efectos."); process.exit(0); }

const srv = createServer({ port: 0, osc: false });
await new Promise(r => srv.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await (await browser.newContext()).newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message));
await page.goto(`http://127.0.0.1:${srv.address().port}/output.html`);

const r = await page.evaluate(async () => {
  const { Renderer, STYLES } = await import("./js/renderer.js");
  const M = await import("./js/model.js");
  const W = 256, H = 160;
  const cv = Object.assign(document.createElement("canvas"), { width: W, height: H });
  const R = new Renderer(cv, { preserve: true });
  const gl = R.gl, surf = M.createQuad({ corners: M.rectCorners(0, 0, W, H) });
  // Imagen con detalle (barras de color, damero, círculo), como un video.
  const pc = Object.assign(document.createElement("canvas"), { width: 320, height: 200 }), g = pc.getContext("2d");
  ["#ff0000", "#00ff00", "#0000ff", "#ffff00", "#00ffff", "#ff00ff", "#ffffff", "#000000"].forEach((c, i) => { g.fillStyle = c; g.fillRect(i * 40, 0, 40, 100); });
  for (let y = 0; y < 5; y++) for (let x = 0; x < 16; x++) { g.fillStyle = (x + y) % 2 ? "#202020" : "#e0e0e0"; g.fillRect(x * 20, 100 + y * 20, 20, 20); }
  g.fillStyle = "#ff8800"; g.beginPath(); g.arc(160, 100, 45, 0, 7); g.fill();
  const px = new Uint8Array(W * H * 4);
  const shot = (look, time) => {
    R.begin([0, 0, 0, 1]);
    const tex = look.source.type === "media" ? R.texture("pat", pc, 1) : null;
    R.drawSurface(surf, look, { view: { sx: 1, sy: 1, tx: 0, ty: 0 }, time, alpha: 1, tex, levels: { bass: 0.5, mid: 0.5, high: 0.5, level: 0.5, beat: 0.5 }, master: 1 });
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px.slice();
  };
  const mean = (a) => { let s = 0; for (let i = 0; i < a.length; i += 4) s += a[i] + a[i + 1] + a[i + 2]; return s / (a.length * 0.75); };
  const sd = (a) => { const m = mean(a); let s = 0; for (let i = 0; i < a.length; i += 4) { const v = (a[i] + a[i + 1] + a[i + 2]) / 3; s += (v - m) ** 2; } return Math.sqrt(s / (a.length / 4)); };
  const diff = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) if ((i & 3) !== 3) d += Math.abs(a[i] - b[i]); return d / (a.length * 0.75); };
  const out = { fx: [], fxAnim: [], styles: [], gens: [], glErr: 0 };
  const img = { type: "media", mediaId: "pat" }, ani = { type: "gen", gen: "fire", color: "#ffcc00", color2: "#ff2d55", speed: 1, scale: 1 };
  const baseImg = shot(M.createLook(img), 1.3), baseAni = shot(M.createLook(ani), 1.3);
  for (const [name, gen] of Object.entries(M.FX_PRESETS)) {
    const fx = { ...M.DEFAULT_FX(), ...gen() };
    const li = M.createLook(img); li.fx = fx;
    const la = M.createLook(ani); la.fx = fx;
    // El estroboscopio apaga a ratos: se mira en varios momentos.
    const ts = fx.strobe ? [1.3, 1.37, 1.44, 1.51, 1.58] : [1.3];
    let di = 0, da = 0, m = 0;
    for (const t of ts) { const a = shot(li, t), b = shot(la, t); di = Math.max(di, diff(a, baseImg)); da = Math.max(da, diff(b, baseAni)); m = Math.max(m, mean(a)); }
    out.fx.push({ name, d: di, mean: m }); out.fxAnim.push({ name, d: da });
    out.glErr |= gl.getError();
  }
  for (const [id, label] of STYLES) { const l = M.createLook(img); l.fx = { ...M.DEFAULT_FX(), style: id }; const a = shot(l, 1.3); out.styles.push({ name: label, d: diff(a, baseImg), mean: mean(a) }); }
  for (const G of M.GENERATORS) {
    const l = M.createLook({ type: "gen", gen: G.id, color: "#00e5ff", color2: "#ff00aa" });
    let s = 0, m = 0, dt = 0, prev = null;
    for (const t of [0.4, 2.3, 4.1, 6.7]) { const a = shot(l, t); s = Math.max(s, sd(a)); m = Math.max(m, mean(a)); if (prev) dt = Math.max(dt, diff(a, prev)); prev = a; }
    out.gens.push({ id: G.id, name: G.name, sd: s, mean: m, dt });
  }
  out.glErr |= gl.getError();
  // Shaders ISF de los plugins incluidos: compilan, dibujan y se mueven.
  const { ShaderCache } = await import("./js/isf.js");
  const { loadPlugins, listPlugins, getShader } = await import("./js/plugins.js");
  loadPlugins();
  const sc = new ShaderCache();
  out.shaders = [];
  for (const a of M.ANIM_LIBRARY.filter(x => x.shader)) {
    const sh = getShader(a.shader);
    const pick = (e) => { const c = document.createElement("canvas"); c.width = 128; c.height = 72; const g2 = c.getContext("2d"); g2.drawImage(e.canvas, 0, 0, 128, 72); return g2.getImageData(0, 0, 128, 72).data; };
    const e1 = sc.draw("t", sh.id, sh.isf, {}, { width: 256, height: 144, time: 1.1 }); const a1 = e1 && pick(e1);
    const e2 = sc.draw("t", sh.id, sh.isf, {}, { width: 256, height: 144, time: 2.9 }); const a2 = e2 && pick(e2);
    out.shaders.push({ name: a.name, err: sc.error(sh.id), mean: a1 ? mean(a1) : 0, dt: a1 && a2 ? diff(a1, a2) : 0 });
  }
  out.plugins = listPlugins().length;
  return out;
});

console.log("== Todos los efectos, estilos y animaciones (GPU) ==");
const NEUTRAL = new Set(["Limpio"]);
// Recortes que dependen del color del contenido: en la animación de fuego no hay verde, azul ni negro.
const COLOR_DEPENDENT = /fondo verde|fondo azul|el negro/;
await test(`${r.fx.length} efectos de la biblioteca cambian una imagen (y ninguno la deja negra)`, () => {
  const bad = r.fx.filter(x => !NEUTRAL.has(x.name) && (x.d < 1 || x.mean < 3)).map(x => `${x.name} (${x.d.toFixed(1)})`);
  assert.deepEqual(bad, []);
});
await test("los mismos efectos también funcionan sobre una animación (desplazar, mosaico, desenfoque, RGB, contornos…)", () => {
  const bad = r.fxAnim.filter(x => !NEUTRAL.has(x.name) && !COLOR_DEPENDENT.test(x.name) && x.d < 1).map(x => `${x.name} (${x.d.toFixed(1)})`);
  assert.deepEqual(bad, []);
});
await test(`${r.styles.length - 1} estilos de imagen (ASCII, dither, Game Boy…) se ven`, () => {
  const bad = r.styles.filter(x => x.name !== "Ninguno" && (x.d < 1 || x.mean < 2)).map(x => x.name);
  assert.deepEqual(bad, []);
});
// Fijas a propósito: cartas de ajuste. Destellos: dependen del golpe de la música o son relámpagos sueltos.
const STATIC = new Set(["calib", "checker", "grid", "solid"]), FLASH = new Set(["lightning", "beatflash"]);
await test(`${r.gens.length} animaciones: dibujan algo y se mueven`, () => {
  const blank = r.gens.filter(x => !FLASH.has(x.id) && (x.mean < 2 || x.sd < 1)).map(x => x.name);
  const still = r.gens.filter(x => !STATIC.has(x.id) && !FLASH.has(x.id) && x.dt < 0.2).map(x => `${x.name} (${x.dt.toFixed(2)})`);
  assert.deepEqual({ blank, still }, { blank: [], still: [] });
});
await test(`plugins incluidos (${r.plugins}): sus ${r.shaders.length} shaders ISF compilan, dibujan y se mueven`, () => {
  assert.ok(r.shaders.length >= 4);
  const bad = r.shaders.filter(x => x.err || x.mean < 3 || x.dt < 0.3).map(x => `${x.name}: ${x.err || `media ${x.mean.toFixed(1)}, cambio ${x.dt.toFixed(2)}`}`);
  assert.ok(!bad.length, bad.join(" | "));
});
await test("sin errores de WebGL ni de JavaScript", () => { assert.equal(r.glErr, 0); assert.deepEqual(errors, []); });

await browser.close();
srv.close();
report();
process.exit(process.exitCode || 0);
