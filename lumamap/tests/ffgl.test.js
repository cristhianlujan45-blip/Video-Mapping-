// tests/ffgl.test.js — plugins FFGL de Resolume con el anfitrión REAL (desktop/ffgl/ffglhost.cpp)
// y plugins FFGL reales compilados aquí mismo (desktop/ffgl/testplugin.cpp): nada simulado.
// Compila con g++ (Linux, OpenGL por software con OSMesa) o MSVC (Windows). Sin compilador
// o sin OSMesa, se omite avisando.
//   FFGL_WINE=1        compila para Windows con MinGW y ejecuta el anfitrión .exe con Wine (Linux + Xvfb)
//   FFGL_GL_DIR=ruta   (Windows sin tarjeta gráfica, CI) carpeta con el opengl32.dll de Mesa
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test, report } from "./harness.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const F = createRequire(import.meta.url)("../desktop/ffglhost.js");
const { buildFFGL } = await import("../desktop/ffgl/build.mjs");

console.log("== Plugins FFGL (Resolume) ==");
const wine = process.env.FFGL_WINE === "1";
let built;
const t0 = Date.now();
try { built = buildFFGL({ target: wine ? "win32" : process.platform }); }
catch (e) {
  if (e.code === "NO_COMPILER") { console.log(`  (se omiten las pruebas FFGL: ${e.message})`); report(); process.exit(0); }
  throw e;
}
console.log(`  compilado en ${Date.now() - t0} ms: ${path.relative(path.join(here, ".."), built.host)}`);

const base = wine
  ? { prefix: ["wine"], mapPath: (f) => "Z:" + f.replaceAll("/", "\\"), env: { WINEDEBUG: "-all" }, openTimeout: 60000, renderTimeout: 20000 }
  : {};
base.host = built.host;
// Windows sin tarjeta gráfica (CI): el anfitrión se copia junto al OpenGL de Mesa (opengl32.dll).
if (process.platform === "win32" && process.env.FFGL_GL_DIR) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lumamap-ffglhost-"));
  fs.copyFileSync(built.host, path.join(dir, path.basename(built.host)));
  for (const f of fs.readdirSync(process.env.FFGL_GL_DIR)) if (/\.(dll|json)$/i.test(f)) fs.copyFileSync(path.join(process.env.FFGL_GL_DIR, f), path.join(dir, f));
  base.host = path.join(dir, path.basename(built.host));
}
const P = built.plugins;
const open = (file, o = {}) => F.FFGLPlugin.open(file, { ...base, ...o, env: { ...base.env, ...o.env } });

// Sin OpenGL por software (Linux sin libosmesa6) no se puede dibujar: se omite avisando.
try { const p = await open(P["lumatest-fuente"]); await p.close(); }
catch (e) {
  if (/OSMesa/.test(e.message)) { console.log(`  (se omiten las pruebas FFGL: ${e.message})`); report(); process.exit(0); }
  throw e;
}

const px = (fr, x, y) => { const i = (y * fr.width + x) * 4; return [...fr.data.subarray(i, i + 4)]; };
const near = (a, b, tol = 3) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

await test("abre la fuente FFGL 2 y lista sus parámetros (tipo, rango, opciones y texto)", async () => {
  const p = await open(P["lumatest-fuente"]);
  try {
    const i = p.info;
    assert.equal(i.name, "LumaTest Fuente"); assert.equal(i.id, "LTSR"); assert.equal(i.type, "source");
    assert.equal(i.apiMajor, 2); assert.equal(i.description, "Plugin de prueba de LumaMap");
    assert.equal(i.gl.profile, "core", JSON.stringify(i.gl));
    assert.deepEqual(i.params.map(x => [x.index, x.name, x.type]), [[0, "Brillo", "standard"], [1, "Rojo", "red"], [2, "Modo", "option"], [3, "Escala", "integer"], [4, "Etiqueta", "text"]]);
    assert.deepEqual([i.params[3].min, i.params[3].max, i.params[3].default], [1, 8, 1]);
    assert.deepEqual(i.params[2].options, [{ name: "Degradado", value: 0 }, { name: "Liso", value: 1 }]);
    assert.equal(i.params[4].default, "hola");
  } finally { await p.close(); }
});

await test("RENDER 64×64: píxeles de color reales, con la fila 0 arriba (como un canvas)", async () => {
  const p = await open(P["lumatest-fuente"]);
  try {
    const fr = await p.render({ width: 64, height: 64, time: 0 });
    assert.equal(fr.width, 64); assert.equal(fr.height, 64); assert.equal(fr.data.length, 64 * 64 * 4);
    let lit = 0;
    for (let k = 0; k < fr.data.length; k += 4) if (fr.data[k] + fr.data[k + 1] + fr.data[k + 2] > 30) lit++;
    assert.ok(lit > 64 * 64 * 0.9, `píxeles con color: ${lit}`);
    // Degradado: verde = altura (arriba = 1), rojo = x, azul = 0.5 + 0.5·sin(t).
    const tl = px(fr, 0, 0), bl = px(fr, 0, 63), tr = px(fr, 63, 0);
    assert.ok(tl[1] > 240 && bl[1] < 15, `verde arriba ${tl} / abajo ${bl}`);
    assert.ok(tr[0] > 240 && tl[0] < 15, `rojo derecha ${tr} / izquierda ${tl}`);
    assert.ok(Math.abs(tl[2] - 128) <= 2 && tl[3] === 255, `azul y alfa ${tl}`);
  } finally { await p.close(); }
});

await test("cambiar parámetros y el tiempo cambia la imagen (número, opción, entero y texto)", async () => {
  const p = await open(P["lumatest-fuente"]);
  try {
    const a = await p.render({ width: 32, height: 32 });
    const off = await p.render({ width: 32, height: 32, params: { 0: 0 } });   // Brillo 0 → negro
    assert.ok(off.data.every((v, k) => k % 4 === 3 || v === 0), "con Brillo 0 debe ser negro");
    const liso = await p.render({ width: 32, height: 32, params: { 0: 1, 2: 1 } });   // Modo «Liso»
    assert.ok(near(px(liso, 3, 3), [255, 51, 153, 255]) && near(px(liso, 30, 28), [255, 51, 153, 255]), String(px(liso, 3, 3)));
    const bandas = await p.render({ width: 32, height: 32, params: { 2: 0, 3: 4 } });   // Escala 4: bandas
    assert.notDeepEqual(px(bandas, 2, 16), px(a, 2, 16));
    const t = await p.render({ width: 32, height: 32, time: Math.PI / 2, params: { 3: 1 } });
    assert.ok(px(t, 0, 0)[2] > 250 && Math.abs(px(a, 0, 0)[2] - 128) <= 2, `azul con el tiempo: ${px(t, 0, 0)}`);
    await p.setParams({ 4: "adiós ñandú" });
    const info = await p.refreshInfo();
    assert.equal(info.params[4].value, "adiós ñandú");
    assert.equal(info.params[0].value, 1); assert.equal(info.params[3].value, 1);
  } finally { await p.close(); }
});

await test("el efecto FFGL cambia una imagen de entrada (y respeta arriba/abajo)", async () => {
  const p = await open(P["lumatest-efecto"]);
  try {
    assert.equal(p.info.type, "effect"); assert.equal(p.info.minInputs, 1);
    const W = 48, H = 40, input = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) input.set(y < H / 2 ? [255, 0, 0, 255] : [0, 0, 255, 255], (y * W + x) * 4);
    const out = await p.render({ width: W, height: H, input });
    assert.ok(near(px(out, 5, 2), [0, 255, 255, 255]), `arriba (rojo invertido = cian): ${px(out, 5, 2)}`);
    assert.ok(near(px(out, 40, 37), [255, 255, 0, 255]), `abajo (azul invertido = amarillo): ${px(out, 40, 37)}`);
    const same = await p.render({ width: W, height: H, input, params: { 0: 0 } });   // Invertir apagado → igual que la entrada
    assert.ok(near(px(same, 5, 2), [255, 0, 0, 255]) && near(px(same, 40, 37), [0, 0, 255, 255]));
    const half = await p.render({ width: W, height: H, input, params: { 0: 1, 1: 0.5 } });
    assert.ok(near(px(half, 5, 2), [128, 128, 128, 255], 2), `mezcla al 50 %: ${px(half, 5, 2)}`);
  } finally { await p.close(); }
});

await test("plugin FFGL 1.6 (OpenGL clásico): contexto de compatibilidad y dibuja", async () => {
  const p = await open(P["lumatest-ffgl1"]);
  try {
    assert.equal(p.info.apiMajor, 1); assert.equal(p.info.gl.profile, "compat");
    const a = await p.render({ width: 16, height: 16 });
    assert.ok(near(px(a, 8, 8), [0, 255, 255, 255]), String(px(a, 8, 8)));
    const b = await p.render({ width: 16, height: 16, params: { 0: 0 } });
    assert.ok(near(px(b, 8, 8), [0, 0, 255, 255]), String(px(b, 8, 8)));
  } finally { await p.close(); }
});

await test("plugin inexistente, roto o que no es FFGL: error claro (sin colgar nada)", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lumamap-ffgl-bad-"));
  const ext = path.extname(P["lumatest-fuente"]);
  await assert.rejects(open(path.join(tmp, "no-existe" + ext)), /No existe el archivo del plugin/);
  const roto = path.join(tmp, "roto" + ext);
  fs.writeFileSync(roto, Buffer.from("esto no es un plugin, solo texto ".repeat(40)));
  await assert.rejects(open(roto), (e) => e.code === "PLUGIN_ERROR" && /cargar|64 bits|dañado/i.test(e.message));
  // Una biblioteca de verdad pero sin plugMain (no es FFGL).
  const notFfgl = wine || process.platform === "win32" ? (wine ? "C:\\windows\\system32\\version.dll" : "C:\\Windows\\System32\\version.dll") : ["/lib/x86_64-linux-gnu/libm.so.6", "/usr/lib/x86_64-linux-gnu/libm.so.6", "/lib64/libm.so.6"].find(f => fs.existsSync(f));
  if (notFfgl) await assert.rejects(F.FFGLPlugin.open(notFfgl, { ...base, mapPath: wine ? (f) => f : undefined }), /no tiene la función plugMain/);
});

await test("si el proceso del plugin muere se detecta y se reinicia solo con los mismos valores", async () => {
  const p = await open(P["lumatest-fuente"]);
  try {
    await p.render({ width: 8, height: 8, params: { 0: 0 } });
    const pid = p.pid;
    process.kill(pid, "SIGKILL");
    await new Promise((r) => { const t = setInterval(() => { if (!p.alive) { clearInterval(t); r(); } }, 20); });
    assert.equal(p.alive, false);
    assert.match(p.conn.dead.reason, /Se cerró el proceso|terminó/);
    const fr = await p.render({ width: 8, height: 8 });   // se reinicia aquí
    assert.notEqual(p.pid, pid);
    assert.ok(fr.data.every((v, k) => k % 4 === 3 || v === 0), "conserva Brillo 0 tras el reinicio");
  } finally { await p.close(); }
});

await test("un plugin que se cae al dibujar solo cierra su proceso; tras varios fallos se desactiva", async () => {
  const p = await open(P["lumatest-fuente"], { env: { LUMATEST_CRASH: "1" }, maxRestarts: 1 });
  try {
    await assert.rejects(p.render({ width: 16, height: 16 }), (e) => e.code === "CRASHED" && /se cerró de golpe/.test(e.message));
    await assert.rejects(p.render({ width: 16, height: 16 }), (e) => e.code === "CRASHED");   // reintento: vuelve a caerse
    await assert.rejects(p.render({ width: 16, height: 16 }), (e) => e.code === "GAVE_UP" && /se ha desactivado/.test(e.message));
  } finally { await p.close(); }
});

await test("un plugin colgado se corta por tiempo (no bloquea la app)", async () => {
  const p = await open(P["lumatest-fuente"], { env: { LUMATEST_HANG: "1" }, renderTimeout: wine ? 4000 : 1200, maxRestarts: 0 });
  const t = Date.now();
  await assert.rejects(p.render({ width: 16, height: 16 }), /no responde/);
  assert.ok(Date.now() - t < (wine ? 10000 : 5000));
  await new Promise(r => setTimeout(r, 200));
  assert.equal(p.alive, false);
  await p.close();
});

await test("tamaños y datos de entrada se validan (en Node y en el anfitrión)", async () => {
  const p = await open(P["lumatest-efecto"]);
  try {
    await assert.rejects(p.render({ width: 0, height: 10 }), (e) => e.code === "BAD_SIZE");
    await assert.rejects(p.render({ width: 5000, height: 10 }), (e) => e.code === "BAD_SIZE");
    await assert.rejects(p.render({ width: 4, height: 4, input: new Uint8Array(10) }), (e) => e.code === "BAD_SIZE");
    // Directo al anfitrión: entrada que no coincide → error, y el proceso sigue vivo.
    const head = Buffer.alloc(28); head.writeUInt32LE(10, 0); head.writeUInt32LE(10, 4); head.writeUInt32LE(400, 24);
    await assert.rejects(p.conn.request("R", Buffer.concat([head, Buffer.alloc(100)])), /no coincide/);
    const big = Buffer.alloc(28); big.writeUInt32LE(9000, 0); big.writeUInt32LE(10, 4);
    await assert.rejects(p.conn.request("R", big), /Tamaño de imagen no válido/);
    await assert.rejects(p.conn.request("P", Buffer.alloc(8, 0xff)), /Parámetro inexistente/);
    assert.ok(p.alive);
    const fr = await p.render({ width: 4, height: 4, input: new Uint8Array(64).fill(255) });
    assert.ok(near(px(fr, 0, 0), [0, 0, 0, 255]));
  } finally { await p.close(); }
});

await test("busca plugins en carpetas: los prueba, avisa de los de 32 bits y de los rotos, y recuerda los ya vistos", async () => {
  const docs = fs.mkdtempSync(path.join(os.tmpdir(), "lumamap-ffgl-docs-"));
  const fx = path.join(docs, "Resolume Arena", "Extra Effects");
  fs.mkdirSync(path.join(fx, "sub"), { recursive: true });
  const ext = path.extname(P["lumatest-fuente"]);
  fs.copyFileSync(P["lumatest-fuente"], path.join(fx, "fuente" + ext));
  fs.copyFileSync(P["lumatest-efecto"], path.join(fx, "sub", "efecto" + ext));
  // Un .dll de 32 bits (cabecera PE con máquina i386) y un archivo que no es nada.
  const pe32 = Buffer.alloc(512); pe32.write("MZ", 0); pe32.writeUInt32LE(0x80, 0x3c); pe32.write("PE\0\0", 0x80, "latin1"); pe32.writeUInt16LE(0x14c, 0x84);
  fs.writeFileSync(path.join(fx, "viejo32" + ext), pe32);
  fs.writeFileSync(path.join(fx, "basura" + ext), "nada");
  assert.equal(F.binaryArch(path.join(fx, "viejo32" + ext)), "x86");
  const dirs = F.defaultDirs({ documents: docs, commonFiles: "" });
  assert.deepEqual(dirs, [fx]);
  const cache = new Map();
  const res = await F.scanPlugins(dirs, { ...base, cache, ext });
  const by = Object.fromEntries(res.map(r => [path.basename(r.file, ext), r]));
  assert.equal(by.fuente.ok, true); assert.equal(by.fuente.info.name, "LumaTest Fuente");
  assert.equal(by.efecto.ok, true); assert.equal(by.efecto.info.type, "effect");
  assert.equal(by.viejo32.ok, false); assert.match(by.viejo32.error, /32 bits/);
  assert.equal(by.basura.ok, false); assert.match(by.basura.error, /No es un archivo de plugin válido/);
  const t = Date.now();
  const again = await F.scanPlugins(dirs, { ...base, cache, ext });
  assert.equal(again.length, 4); assert.ok(Date.now() - t < 200, "la segunda búsqueda usa lo ya visto");
  if (ext === F.PLUGIN_EXT) {
    assert.ok(F.insideDirs(path.join(fx, "sub", "efecto" + ext), dirs));
    assert.ok(!F.insideDirs(path.join(docs, "otro" + ext), dirs));
    assert.ok(!F.insideDirs(path.join(fx, "..", "..", "x" + ext), dirs));
  }
});

await test("rendimiento: ida y vuelta de 960×540 (fuente) y con imagen de entrada (efecto)", async () => {
  const src = await open(P["lumatest-fuente"]), fx = await open(P["lumatest-efecto"]);
  try {
    const N = 20, input = new Uint8Array(960 * 540 * 4).fill(90);
    await src.render({ width: 960, height: 540 }); await fx.render({ width: 960, height: 540, input });
    let t = performance.now();
    for (let i = 0; i < N; i++) await src.render({ width: 960, height: 540, time: i / 30 });
    const a = (performance.now() - t) / N;
    t = performance.now();
    for (let i = 0; i < N; i++) await fx.render({ width: 960, height: 540, input });
    const b = (performance.now() - t) / N;
    console.log(`    960×540: fuente ${a.toFixed(1)} ms/fotograma · efecto con entrada ${b.toFixed(1)} ms/fotograma (${src.info.gl.renderer})`);
    assert.ok(a < 1000 && b < 1000);
  } finally { await src.close(); await fx.close(); }
});

report();
