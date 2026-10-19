// tests/objscan.test.js — reconocer un objeto real con la cámara y calibrar encima, solo.
// Escena sintética: una caja de verdad sobre el suelo con una pared detrás, un proyector y una
// cámara (con sombras: lo que el proyector no ilumina no cuenta) y la precisión real del escaneo
// (franjas de 1/1024). Se comprueba que reconoce caja / pared / superficie plana, que encuentra
// las esquinas de las caras en la imagen del proyector, y que con ellas saca las proporciones de
// la caja y dónde está el proyector.
import { test, report } from "./harness.js";
import assert from "node:assert/strict";
import { eulerToMat, projectPoint } from "../web/js/calib3d.js";
import { fitH, applyH, findPlanes, quadOf, analyzeObject, solveBox, reproject, rng } from "../web/js/objscan.js";

const R2D = 180 / Math.PI;
const lookAt = (pos, tgt) => { const d = tgt.map((v, i) => v - pos[i]); return [Math.atan2(d[1], Math.hypot(d[0], d[2])) * R2D, Math.atan2(-d[0], -d[2]) * R2D, 0]; };
function ray(cam, u, v) {
  const R = eulerToMat(cam.rot), t = Math.tan(cam.fov * Math.PI / 360), a = cam.res[0] / cam.res[1];
  const c = [(u - 0.5) * 2 * a * t, -(v - 0.5) * 2 * t, -1];
  return [0, 1, 2].map(i => R[i][0] * c[0] + R[i][1] * c[1] + R[i][2] * c[2]);
}
function hitBox(o, d, b) {
  let t0 = -Infinity, t1 = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-12) { if (o[i] < b.min[i] || o[i] > b.max[i]) return Infinity; continue; }
    let a = (b.min[i] - o[i]) / d[i], c = (b.max[i] - o[i]) / d[i]; if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, c);
  }
  return t1 >= t0 && t0 > 1e-6 ? t0 : Infinity;
}
/** Escanea la escena: el mapa cámara → proyector como lo da decodeGray. */
function scanScene({ box, proj, cam, w = 320, h = 240, wallZ = -1.2, withBox = true, noise = 0, seed = 3 }) {
  const rnd = rng(seed);
  const u = new Float32Array(w * h).fill(NaN), v = new Float32Array(w * h).fill(NaN);
  let ok = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = ray(cam, (x + 0.5) / w, (y + 0.5) / h), o = cam.pos;
    let t = withBox ? hitBox(o, d, box) : Infinity;
    if (d[1] < 0) { const tf = -o[1] / d[1]; if (tf < t) t = tf; }
    if (d[2] < 0) { const tw = (wallZ - o[2]) / d[2]; if (tw < t) t = tw; }
    if (!Number.isFinite(t)) continue;
    const P = o.map((c, i) => c + d[i] * t);
    if (P[2] < wallZ - 1e-6 || P[1] < -1e-6) continue;
    // ¿Lo ilumina el proyector? (la caja hace sombra)
    const toP = P.map((c, i) => c - proj.pos[i]), dist = Math.hypot(...toP), dn = toP.map(c => c / dist);
    if (withBox && hitBox(proj.pos, dn, box) < dist - 1e-4) continue;
    const uv = projectPoint(proj, P);
    if (!uv || uv[0] < 0 || uv[0] >= 1 || uv[1] < 0 || uv[1] >= 1) continue;
    const q = (a) => Math.min(1023, Math.floor(a * 1024)) / 1024 + 0.5 / 1024 + (rnd() - 0.5) * noise;
    u[y * w + x] = q(uv[0]); v[y * w + x] = q(uv[1]); ok++;
  }
  return { w, h, u, v, coverage: ok / (w * h) };
}
const BOX = { min: [-0.3, 0, -0.25], max: [0.3, 0.4, 0.25] };      // 60 × 40 × 50 cm
const corners = (b) => { const o = []; for (const x of [b.min[0], b.max[0]]) for (const y of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]]) o.push([x, y, z]); return o; };
const mkProj = (pos, fov = 34) => ({ pos, rot: lookAt(pos, [0, 0.2, 0]), fov, res: [1920, 1080], shift: [0, 0] });

console.log("== Reconocer un objeto con la cámara y calibrar encima ==");
await test("homografías: se recupera una homografía exacta y RANSAC separa dos planos mezclados", () => {
  const H = [1.2, 0.1, 0.05, -0.05, 0.9, 0.1, 0.0004, 0.0002, 1];
  const src = [], dst = [];
  for (let i = 0; i < 40; i++) { const p = [i * 7 % 300, i * 13 % 200]; src.push(p); dst.push(applyH(H, ...p)); }
  const G = fitH(src, dst);
  for (let i = 0; i < src.length; i++) { const a = applyH(G, ...src[i]); assert.ok(Math.hypot(a[0] - dst[i][0], a[1] - dst[i][1]) < 1e-6); }
  const H2 = [0.002, 0, 0.1, 0, 0.003, 0.2, 0, 0, 1], H3 = [0.0015, 0.0006, 0.5, -0.0004, 0.002, 0.1, 0.000001, 0, 1];
  const cam = [], proj = [];
  for (let y = 0; y < 100; y += 3) for (let x = 0; x < 200; x += 3) { cam.push([x, y]); proj.push(applyH(x < 100 ? H2 : H3, x, y)); }
  const planes = findPlanes(cam, proj, { tol: 0.002 });
  assert.ok(planes.length >= 2);
  assert.ok(planes[0].idx.length > 0.4 * cam.length && planes[1].idx.length > 0.4 * cam.length, planes.map(p => p.idx.length).join(","));
});
await test("las esquinas de una cara: el contorno se reduce a un cuadrilátero ordenado", () => {
  const pts = []; for (let i = 0; i <= 20; i++) for (let j = 0; j <= 20; j++) { const a = i / 20, b = j / 20; pts.push([0.2 + a * 0.4 + b * 0.05, 0.3 + b * 0.3 - a * 0.05]); }
  const q = quadOf(pts);
  assert.deepEqual(q.map(p => p.map(v => +v.toFixed(3))), [[0.2, 0.3], [0.6, 0.25], [0.65, 0.55], [0.25, 0.6]]);
});
await test("una caja de verdad (3 caras a la vista): la reconoce, encuentra sus 7 esquinas en el proyector y calcula sus proporciones y el proyector", () => {
  const proj = mkProj([1.1, 1.5, 2.4]), cam = { pos: [0.7, 1.35, 2.3], rot: lookAt([0.7, 1.35, 2.3], [0, 0.2, 0]), fov: 45, res: [320, 240] };
  const map = scanScene({ box: BOX, proj, cam });
  const ana = analyzeObject(map);
  assert.equal(ana.kind, "box", ana.message);
  assert.equal(ana.box.topo, 3);
  // Cada esquina de cara encontrada está sobre una esquina real de la caja (en la imagen del proyector).
  const truth = corners(BOX).map(c => projectPoint(proj, c)).filter(Boolean);
  for (const f of ana.faces.slice(0, 3)) for (const p of f.quad) {
    const d = Math.min(...truth.map(t => Math.hypot(t[0] - p[0], t[1] - p[1])));
    assert.ok(d < 0.02, `esquina a ${(d * 100).toFixed(1)} % de la verdadera`);
  }
  const sol = solveBox(ana, { fov: 34, res: [1920, 1080] }, { width: 0.6 });
  assert.ok(sol.ok, sol.why);
  assert.ok(sol.rms < 12, "error medio " + sol.rms.toFixed(1) + " px");
  const dims = [...sol.dims].sort((a, b) => a - b), real = [0.4, 0.5, 0.6];
  dims.forEach((d, i) => assert.ok(Math.abs(d - real[i]) / real[i] < 0.2, `medidas ${sol.dims.map(x => x.toFixed(2))} (reales 0.6 × 0.4 × 0.5)`));
  // Con el proyector calculado, las esquinas de la caja caen donde las vio la cámara.
  for (const r of reproject(sol, [1920, 1080])) assert.ok(Math.hypot(r.got[0] - r.uv[0], r.got[1] - r.uv[1]) < 0.02);
  // Si se dan las medidas reales, el proyector sale en su sitio (a pocos cm), en el marco de la caja.
  const exact = solveBox(ana, { fov: 34, res: [1920, 1080] }, { dims: [0.6, 0.4, 0.5] });
  assert.ok(exact.ok && exact.rms < 8, "con medidas: " + exact.rms);
  const dist = Math.hypot(...exact.proj.pos) , real3 = Math.hypot(proj.pos[0], proj.pos[1], proj.pos[2]);
  assert.ok(Math.abs(dist - real3) < 0.25, `distancia del proyector ${dist.toFixed(2)} m (real ${real3.toFixed(2)})`);
});
await test("la misma caja con otra lente (32°) y la cámara viendo una cara muy de lado: las esquinas no se estiran por el suelo", () => {
  const proj = mkProj([1.1, 1.5, 2.4], 32), cam = { pos: [0.7, 1.35, 2.3], rot: lookAt([0.7, 1.35, 2.3], [0, 0.2, 0]), fov: 45, res: [320, 240] };
  const ana = analyzeObject(scanScene({ box: BOX, proj, cam }));
  assert.equal(ana.kind, "box"); assert.equal(ana.box.topo, 3);
  const truth = corners(BOX).map(c => projectPoint(proj, c));
  for (const f of ana.faces.slice(0, 3)) for (const p of f.quad) assert.ok(Math.min(...truth.map(t => Math.hypot(t[0] - p[0], t[1] - p[1]))) < 0.02);
  const sol = solveBox(ana, { fov: 32, res: [1920, 1080] }, { width: 0.6 });
  const dims = [...sol.dims].sort((a, b) => a - b), real = [0.4, 0.5, 0.6];
  dims.forEach((d, i) => assert.ok(Math.abs(d - real[i]) / real[i] < 0.2, `medidas ${sol.dims.map(x => x.toFixed(2))}`));
});
await test("caja vista de frente y desde arriba (2 caras): la reconoce igual", () => {
  const proj = mkProj([0, 1.3, 2.6]), cam = { pos: [0.25, 1.2, 2.5], rot: lookAt([0.25, 1.2, 2.5], [0, 0.2, 0]), fov: 45, res: [320, 240] };
  const ana = analyzeObject(scanScene({ box: BOX, proj, cam }));
  assert.equal(ana.kind, "box", ana.message);
  assert.equal(ana.box.topo, 2);
  const sol = solveBox(ana, { fov: 34, res: [1920, 1080] }, { width: 0.6 });
  assert.ok(sol.ok && sol.rms < 15, "error medio " + sol.rms);
});
await test("sin caja (solo pared y suelo) dice que es una pared/superficie, no una caja", () => {
  const proj = mkProj([0, 1.2, 2.5]), cam = { pos: [0.3, 1.1, 2.4], rot: lookAt([0.3, 1.1, 2.4], [0, 0.6, -1.2]), fov: 45, res: [320, 240] };
  proj.rot = lookAt(proj.pos, [0, 0.9, -1.2]);
  const ana = analyzeObject(scanScene({ box: BOX, proj, cam, withBox: false }));
  assert.ok(["wall", "plane"].includes(ana.kind), ana.kind + ": " + ana.message);
});
await test("si la cámara no ve casi nada, no inventa", () => {
  const map = { w: 100, h: 80, u: new Float32Array(8000).fill(NaN), v: new Float32Array(8000).fill(NaN), coverage: 0 };
  assert.equal(analyzeObject(map).kind, "none");
});
report();
