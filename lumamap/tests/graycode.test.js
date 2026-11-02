// tests/graycode.test.js — luz estructurada (código Gray) para calibrar el 3D con la cámara:
// patrones, decodificación con una cámara simulada (perspectiva, luz ambiente, superficie de
// distinto color, ruido y desenfoque de píxel) y búsqueda del píxel del proyector.
import { test, report } from "./harness.js";
import assert from "node:assert/strict";
import { GRAY_BITS, grayPatterns, grayBit, drawGray, decodeGray, lookupUV, scanGray, luminance } from "../web/js/graycode.js";
import { homography, applyH } from "../web/js/math.js";

/** Contexto 2D falso que pinta en un búfer (para drawGray). */
function fakeCtx(W, H) {
  const px = new Uint8Array(W * H);
  let fill = 0;
  return { px, set fillStyle(c) { fill = c === "#fff" ? 1 : 0; }, fillRect(x, y, w, h) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) px[j * W + i] = fill; } };
}
/** Cámara simulada: ve el proyector a través de una homografía (cámara → uv del proyector). */
function camera(names, { w = 320, h = 240, quad = [[60, 40], [270, 55], [255, 215], [70, 200]], ambient = 30, gain = 170, noise = 5, ss = 3, seed = 7 } = {}) {
  const H = homography(quad, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  let s = seed; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const lit = (name, u, v) => {
    if (name === "white") return 1; if (name === "black") return 0;
    const [, axis, k, bits, inv] = name.split(":"), N = 1 << +bits;
    const i = Math.min(N - 1, Math.floor((axis === "x" ? u : v) * N));
    return grayBit(i, +k, +bits) ^ +inv;
  };
  const frames = {};
  for (const name of names) {
    const f = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const [u, v] = applyH(H, x + (sx + 0.5) / ss - 0.5, y + (sy + 0.5) / ss - 0.5);
        if (u >= 0 && u < 1 && v >= 0 && v < 1) acc += lit(name, u, v) * (0.6 + 0.4 * Math.sin(u * 7) ** 2);   // superficie con manchas
      }
      f[y * w + x] = ambient + gain * acc / (ss * ss) + (rnd() - 0.5) * 2 * noise;
    }
    frames[name] = f;
  }
  return { frames, H, w, h };
}

console.log("== Luz estructurada (calibrar con la cámara) ==");
await test("patrones: blanco, negro y franjas Gray de los dos ejes con su inversa (42 con 10 bits)", () => {
  const p = grayPatterns();
  assert.equal(p.length, 2 + 2 * GRAY_BITS * 2);
  assert.deepEqual(p.slice(0, 4), ["white", "black", "gray:x:0:10:0", "gray:x:0:10:1"]);
  // Franjas vecinas: el código Gray cambia un solo bit.
  for (let i = 1; i < 1024; i++) { let diff = 0; for (let k = 0; k < 10; k++) diff += grayBit(i, k, 10) ^ grayBit(i - 1, k, 10); assert.equal(diff, 1); }
});
await test("dibujar: el bit grueso parte la imagen en dos y la inversa es el negativo exacto", () => {
  const W = 64, H = 32, a = fakeCtx(W, H), b = fakeCtx(W, H);
  drawGray(a, "gray:x:0:6:0", W, H); drawGray(b, "gray:x:0:6:1", W, H);
  assert.equal(a.px[5], 0); assert.equal(a.px[W - 5], 1);
  for (let i = 0; i < W * H; i++) assert.equal(a.px[i] + b.px[i], 1);
  const c = fakeCtx(W, H); drawGray(c, "gray:y:1:6:0", W, H);   // eje Y: filas
  assert.deepEqual([c.px[0], c.px[10 * W], c.px[20 * W], c.px[31 * W]], [0, 1, 1, 0]);
});
await test("decodificar con una cámara de verdad simulada: cada píxel sabe su píxel del proyector (error < 0,4 %)", () => {
  const cam = camera(grayPatterns());
  const map = decodeGray(cam.frames, cam.w, cam.h);
  assert.ok(map.coverage > 0.35 && map.coverage < 0.6, "cobertura ≈ la zona proyectada: " + map.coverage.toFixed(2));
  assert.ok(Number.isNaN(map.u[5 * cam.w + 5]), "fuera de la proyección: no se sabe");
  let worst = 0, n = 0;
  for (let y = 60; y < 190; y += 9) for (let x = 90; x < 240; x += 11) {
    const uv = lookupUV(map, x, y); assert.ok(uv, `sin dato en ${x},${y}`);
    const [tu, tv] = applyH(cam.H, x, y);
    worst = Math.max(worst, Math.abs(uv[0] - tu), Math.abs(uv[1] - tv)); n++;
  }
  assert.ok(n > 100);
  assert.ok(worst < 0.004, `error máximo ${(worst * 100).toFixed(3)} % del ancho`);
});
await test("si la cámara no ve la proyección (poco contraste) no inventa nada", () => {
  const cam = camera(grayPatterns(), { gain: 8 });
  const map = decodeGray(cam.frames, cam.w, cam.h);
  assert.equal(map.coverage, 0);
  assert.equal(lookupUV(map, 160, 120), null);
});
await test("escaneo completo: proyecta cada patrón, espera, fotografía y quita el patrón al terminar", async () => {
  const shown = [];
  let cur = null;
  const cam = camera(grayPatterns(4), { w: 80, h: 60, quad: [[10, 8], [70, 8], [70, 52], [10, 52]], noise: 0, ss: 2 });
  const toImg = (f) => { const d = new Uint8ClampedArray(f.length * 4); for (let i = 0; i < f.length; i++) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = Math.max(0, Math.min(255, f[i])); d[i * 4 + 3] = 255; } return { width: 80, height: 60, data: d }; };
  const steps = [];
  const r = await scanGray({ bits: 4, settle: 1, firstSettle: 1, showPattern: (p) => { cur = p; shown.push(p); }, grabFrame: async () => toImg(cam.frames[cur]), onStep: (i, n) => steps.push(`${i}/${n}`) });
  assert.deepEqual(shown, [...grayPatterns(4), null]);
  assert.equal(steps.at(-1), "18/18");
  assert.equal(r.photo.width, 80);
  assert.ok(r.map.coverage > 0.5);
  const uv = lookupUV(r.map, 40, 30, 1);
  assert.ok(Math.abs(uv[0] - 0.5) < 0.07 && Math.abs(uv[1] - 0.5) < 0.07, "centro: " + uv);
  assert.equal(luminance({ width: 1, height: 1, data: [255, 255, 255, 255] })[0], 255);
  // Si falla la cámara, el patrón también se quita.
  shown.length = 0;
  await assert.rejects(scanGray({ bits: 2, settle: 1, firstSettle: 1, showPattern: (p) => shown.push(p), grabFrame: async () => null }), /no da imagen/);
  assert.equal(shown.at(-1), null);
});
report();
