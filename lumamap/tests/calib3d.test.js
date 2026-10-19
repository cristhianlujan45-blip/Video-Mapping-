// tests/calib3d.test.js — calibrar el proyector virtual con el real por puntos (como CamSchnappr).
import { test, report } from "./harness.js";
import assert from "node:assert/strict";
const C = await import("../web/js/calib3d.js");
const THREE = await import("../web/vendor/three/three.module.min.js");
const M = await import("../web/js/model.js");

console.log("== Calibrar el proyector 3D con el real ==");
// Semilla fija: las pruebas siempre iguales.
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const cube = []; for (const x of [-0.5, 0.5]) for (const y of [0, 1]) for (const z of [-0.5, 0.5]) cube.push([x, y, z]);
const start = { pos: [0, 1.2, 4], rot: [-8, 0, 0], fov: 32, res: [1920, 1080], shift: [0, 0] };
const truthOf = () => ({ pos: [rnd() * 3 - 1.5, 0.5 + rnd() * 1.5, 3 + rnd() * 3], rot: [-14 + rnd() * 8, -20 + rnd() * 40, -2 + rnd() * 4], fov: 18 + rnd() * 25, res: [1920, 1080], shift: [rnd() * 0.08 - 0.04, rnd() * 0.3 - 0.15] });

await test("el modelo de cámara es el mismo que dibuja three.js (FOV, aspecto y lens shift)", () => {
  for (let k = 0; k < 30; k++) {
    const p = truthOf(), cam = new THREE.PerspectiveCamera(p.fov, p.res[0] / p.res[1], 0.05, 100);
    cam.position.fromArray(p.pos); cam.rotation.set(...p.rot.map(v => v * Math.PI / 180), "YXZ");
    cam.setViewOffset(p.res[0], p.res[1], -p.shift[0] * p.res[0], p.shift[1] * p.res[1], p.res[0], p.res[1]);
    cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    for (const w of cube) {
      const v = new THREE.Vector3(...w).project(cam), m = C.projectPoint(p, w);
      assert.ok(Math.abs((v.x + 1) / 2 - m[0]) < 1e-9 && Math.abs((1 - v.y) / 2 - m[1]) < 1e-9);
    }
    assert.deepEqual(C.matToEuler(C.eulerToMat(p.rot)).map(v => +v.toFixed(6)), p.rot.map(v => +v.toFixed(6)));
  }
});
await test("con 8 esquinas encuentra el proyector real (posición, giro, lente y lens shift), aunque empiece lejos", () => {
  for (let k = 0; k < 15; k++) {
    const t = truthOf(), pts = cube.map((w, i) => ({ id: "p" + i, w, uv: C.projectPoint(t, w) }));
    const r = C.calibrate(pts, start);
    assert.ok(r.ok);
    assert.ok(Math.hypot(...r.proj.pos.map((v, i) => v - t.pos[i])) < 1e-4, JSON.stringify([r.proj, t]));
    assert.ok(Math.abs(r.proj.fov - t.fov) < 1e-3 && Math.abs(r.proj.shift[1] - t.shift[1]) < 1e-4);
    assert.ok(r.rms < 0.01);
  }
});
await test("con cruces puestas a mano (±1,5 px de error) la imagen cae donde debe: menos de 2,5 px en cada esquina", () => {
  for (let k = 0; k < 10; k++) {
    const t = truthOf(), pts = cube.map((w, i) => { const uv = C.projectPoint(t, w); return { id: "p" + i, w, uv: [uv[0] + (rnd() - 0.5) * 3 / 1920, uv[1] + (rnd() - 0.5) * 3 / 1080] }; });
    const r = C.calibrate(pts, start), got = { ...r.proj, res: t.res };
    // Lo que importa al proyectar: dónde caen las esquinas de verdad (con un poco de ruido, la lente y la distancia se compensan).
    for (const w of cube) { const a = C.projectPoint(t, w), b = C.projectPoint(got, w); assert.ok(Math.hypot((a[0] - b[0]) * 1920, (a[1] - b[1]) * 1080) < 2.5, "esquina " + w); }
    assert.ok(Math.hypot(...r.proj.pos.map((v, i) => v - t.pos[i])) < 0.1, "posición " + JSON.stringify([r.proj.pos, t.pos]));
    assert.ok(r.rms > 0 && r.rms < 2, "rms " + r.rms);
    assert.equal(r.errors.length, 8);
  }
});
await test("con la lente conocida bastan 4 esquinas; con menos lo dice claro", () => {
  const t = truthOf(), pts = cube.slice(0, 5).map((w, i) => ({ id: "p" + i, w, uv: C.projectPoint(t, w) }));
  const known = { ...start, fov: t.fov, shift: t.shift };
  const r = C.calibrate(pts.slice(0, 4), known, { fixLens: true });
  assert.ok(r.ok && Math.hypot(...r.proj.pos.map((v, i) => v - t.pos[i])) < 1e-3, JSON.stringify(r));
  assert.equal(r.proj.fov, t.fov, "la lente no se toca");
  const few = C.calibrate(pts.slice(0, 5), start);
  assert.equal(few.ok, false); assert.match(few.why, /hacen falta 6/);
  assert.match(C.calibrate(pts.slice(0, 3), start, { fixLens: true }).why, /hacen falta 4/);
});
await test("lente: relación de proyección ⇄ FOV (la de la ficha del proyector)", () => {
  for (const tr of [0.5, 0.8, 1.2, 1.5, 2.0]) assert.ok(Math.abs(C.throwFromFov(C.fovFromThrow(tr, [1920, 1080]), [1920, 1080]) - tr) < 1e-9);
  // 1.5 en 16:9: ~36,9° de ancho → ~21,2° de alto.
  assert.ok(Math.abs(C.fovFromThrow(1.5, [1920, 1080]) - 21.24) < 0.05);
});
await test("proyectos viejos o raros: la calibración mal formada se limpia al abrir", () => {
  const d = M.normalizeStage3d({ projectors: [{ id: "a", calib: { on: true, points: "x" } }, { id: "b", calib: { on: false, points: [{ id: "q", w: [0, 1, 2], uv: [0.5, 0.5] }, { id: "r", w: [0, "x"], uv: [0, 0] }, null] } }] });
  assert.equal(d.projectors[0].calib, undefined);
  assert.deepEqual(d.projectors[1].calib.points.map(q => q.id), ["q"]);
});
report();
