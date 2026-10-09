// tests/interactive.test.js — alineación cámara ↔ proyección (sin cámara real).
import { test, report } from "./harness.js";
import assert from "node:assert/strict";
globalThis.ImageData ??= class { constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); } };
const I = await import("../web/js/interactive.js");
const { detectQuads } = await import("../web/js/automap.js");
const M = await import("../web/js/model.js");

console.log("== Proyección interactiva ==");

await test("sin alinear no hay transformación; con alineación las esquinas de la proyección van a 0..1", () => {
  const cal = { enabled: false, quad: [[0.2, 0.1], [0.8, 0.15], [0.85, 0.9], [0.15, 0.85]] };
  assert.equal(I.camToProj(cal), null);
  cal.enabled = true;
  const f = I.camToProj(cal);
  const close = (a, b) => assert.ok(Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6, `${a} ≈ ${b}`);
  close(f(0.2, 0.1), [0, 0]); close(f(0.8, 0.15), [1, 0]); close(f(0.85, 0.9), [1, 1]); close(f(0.15, 0.85), [0, 1]);
  const c = f(0.5, 0.5); assert.ok(c[0] > 0.4 && c[0] < 0.6 && c[1] > 0.4 && c[1] < 0.6, "el centro cae cerca del centro");
});

await test("orden de esquinas: siempre arriba-izq, arriba-der, abajo-der, abajo-izq", () => {
  const q = I.orderQuad([[0.9, 0.85], [0.1, 0.1], [0.12, 0.9], [0.88, 0.12]]);
  assert.deepEqual(q, [[0.1, 0.1], [0.88, 0.12], [0.9, 0.85], [0.12, 0.9]]);
});

await test("calibración automática: la diferencia blanco − negro encuentra el cuadrilátero proyectado", () => {
  // Cámara sintética de 160×90: fondo gris con ruido; el proyector ilumina un trapecio.
  const w = 160, h = 90, mk = () => new ImageData(w, h);
  const black = mk(), white = mk();
  const quad = [[30, 15], [130, 20], [125, 75], [35, 70]];
  const inside = (x, y) => { let s = 0; for (let i = 0; i < 4; i++) { const [ax, ay] = quad[i], [bx, by] = quad[(i + 1) % 4]; s += Math.sign((bx - ax) * (y - ay) - (by - ay) * (x - ax)); } return Math.abs(s) === 4; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const j = (y * w + x) * 4, n = (x * 7 + y * 13) % 9;
    for (const im of [black, white]) { im.data[j] = im.data[j + 1] = im.data[j + 2] = 60 + n; im.data[j + 3] = 255; }
    if (inside(x, y)) white.data[j] = white.data[j + 1] = white.data[j + 2] = 220 + n;
  }
  const { img, contrast } = I.projectedArea(white, black);
  assert.ok(contrast > 100);
  const found = detectQuads(img, { maxQuads: 2, minAreaRatio: 0.03 });
  assert.ok(found.length >= 1, "detecta la proyección");
  const q = I.orderQuad(found[0].points.map(p => [p.x / w, p.y / h]));
  quad.forEach(([x, y], i) => assert.ok(Math.hypot(q[i][0] * w - x, q[i][1] * h - y) < 6, `esquina ${i + 1}: ${q[i].map(v => v.toFixed(3))}`));
});

await test("los proyectos guardan la alineación y la normalizan si viene rota", () => {
  const p = M.createProject();
  assert.deepEqual(p.settings.interactive.quad, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  p.settings.interactive = { enabled: true, quad: [[0, 0], "x"] };
  const n = M.normalizeProject(JSON.parse(JSON.stringify(p)));
  assert.equal(n.settings.interactive.quad.length, 4);
  p.settings.tracking.provider = "kinect";
  assert.equal(M.normalizeProject(JSON.parse(JSON.stringify(p))).settings.tracking.provider, "webcam", "proveedores antiguos → cámara");
});

await test("galería: cada efecto interactivo usa un modo que existe", async () => {
  const { BODY_MODES } = await import("../web/js/body.js");
  const modes = new Set(BODY_MODES.map(m => m[0]));
  for (const f of I.INTERACTIVE_FX) assert.ok(modes.has(f.mode), f.mode);
  assert.ok(I.INTERACTIVE_FX.length >= 15);
});

report();
