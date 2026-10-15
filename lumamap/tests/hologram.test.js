// tests/hologram.test.js — hologramas automáticos (escenario tipo Tupac, tul, pirámide; 1-4 proyectores).
import { test, report } from "./harness.js";
import assert from "node:assert/strict";
const M = await import("../web/js/model.js");
const H = await import("../web/js/hologram.js");

console.log("== Holograma ==");
function makeApp() {
  const project = M.createProject();
  project.media.push({ id: "v1", name: "cantante.mp4", kind: "video", width: 1920, height: 1080 });
  M.addSurface(project, M.createQuad({ name: "Pared", corners: M.rectCorners(0, 0, 400, 300) }), { type: "gen", gen: "plasma" });
  return { S: { project } };
}
const looks = (P, s) => P.scenes.map(sc => sc.looks[s.id]);

await test("trozos para varios proyectores: cubren todo, se solapan lo justo y los bordes suaves van solo por dentro", () => {
  assert.deepEqual(H.slices(1), [{ a: 0, b: 1, left: 0, right: 0 }]);
  for (const n of [2, 3, 4]) {
    const p = H.slices(n, 0.15);
    assert.equal(p.length, n); assert.equal(p[0].a, 0); assert.ok(Math.abs(p[n - 1].b - 1) < 1e-6);
    for (let i = 1; i < n; i++) {
      const w = p[i].b - p[i].a, ov = p[i - 1].b - p[i].a;
      assert.ok(Math.abs(ov - w * 0.15) < 1e-5, "solape del 15 % de cada salida");
    }
    assert.equal(p[0].left, 0); assert.equal(p[n - 1].right, 0); assert.equal(p[0].right, 0.15); assert.equal(p[n - 1].left, 0.15);
  }
});

await test("escenario tipo Tupac con 3 proyectores: tu video sin fondo (IA), repartido P1-P3, negro puro y uniones suaves", () => {
  const app = makeApp(), P = app.S.project;
  const r = H.buildHologram(app, { type: "escenario", n: 3, source: "video", mediaId: "v1", cut: "ai" });
  assert.equal(r.surfaces.length, 3);
  assert.deepEqual(r.surfaces.map(s => s.screen), [1, 2, 3]);
  const l = looks(P, r.surfaces[1])[0];
  assert.equal(l.source.type, "media"); assert.equal(l.source.mediaId, "v1"); assert.equal(l.source.cutout, true);
  assert.equal(l.fit, "contain"); assert.ok(l.fx.contrast > 1 && l.fx.brightness > 1);
  assert.ok(l.span.a > 0 && l.span.b < 1);
  assert.deepEqual([P.settings.screens[1].edge, P.settings.screens[3].edge].map(e => [e.left, e.right]), [[0, 0.15], [0.15, 0]]);
  assert.match(r.text, /P1-P3/);
  // Se puede rehacer: el anterior se sustituye (no se duplican superficies).
  H.buildHologram(app, { type: "escenario", n: 2, source: "video", mediaId: "v1" });
  assert.equal(P.surfaces.filter(s => s.holo).length, 2);
  assert.equal(P.settings.screens[3].edge, undefined);
  assert.ok(P.surfaces.some(s => s.name === "Pared"), "lo demás del proyecto no se toca");
});

await test("espejo izquierda↔derecha con varios proyectores: cada salida muestra el trozo simétrico, reflejado", () => {
  const app = makeApp(), P = app.S.project;
  const r = H.buildHologram(app, { type: "tul", n: 2, source: "video", mediaId: "v1", flipH: true });
  const [a, b] = r.surfaces.map(s => looks(P, s)[0]);
  assert.equal(a.fx.flipX, true);
  assert.ok(a.span.a > 0.4 && Math.abs(a.span.b - 1) < 1e-6, "P1 (izquierda) muestra la parte derecha del video");
  assert.ok(b.span.a === 0, "P2 muestra la parte izquierda");
});

await test("fondo verde / negro, cámara en vivo, animación y texto", () => {
  const app = makeApp(), P = app.S.project;
  let l = looks(P, H.buildHologram(app, { source: "video", mediaId: "v1", cut: "green" }).surfaces[0])[0];
  assert.ok(l.fx.chromaKey > 0); assert.equal(l.source.cutout, false);
  l = looks(P, H.buildHologram(app, { source: "video", mediaId: "v1", cut: "black" }).surfaces[0])[0];
  assert.ok(l.fx.lumaKey > 0);
  l = looks(P, H.buildHologram(app, { source: "camera" }).surfaces[0])[0];
  assert.deepEqual([l.source.type, l.source.bodyMode], ["body", "persona"]);
  l = looks(P, H.buildHologram(app, { source: "anim", anim: M.ANIM_LIBRARY[3].name }).surfaces[0])[0];
  assert.equal(l.source.type, "gen");
  l = looks(P, H.buildHologram(app, { source: "text", text: "BIENVENIDOS" }).surfaces[0])[0];
  assert.deepEqual([l.source.type, l.source.text], ["text", "BIENVENIDOS"]);
});

await test("pirámide: 4 vistas en cruz por P1 (reflejadas) o un proyector por cara", () => {
  const app = makeApp(), P = app.S.project;
  let r = H.buildHologram(app, { type: "piramide", n: 1, source: "anim" });
  assert.equal(r.surfaces.length, 4);
  assert.ok(r.surfaces.every(s => s.screen === 1));
  assert.ok(r.surfaces.every(s => looks(P, s)[0].fx.flipX === true));
  r = H.buildHologram(app, { type: "piramide", n: 4, source: "anim" });
  assert.deepEqual(r.surfaces.map(s => s.screen), [1, 2, 3, 4]);
  assert.ok(H.howTo({ type: "escenario", n: 2 }).some(t => /45°/.test(t)));
});

await test("se guarda con el proyecto y vuelve a cargarse igual", () => {
  const app = makeApp(), P = app.S.project;
  H.buildHologram(app, { type: "escenario", n: 2, source: "video", mediaId: "v1" });
  const back = M.normalizeProject(JSON.parse(JSON.stringify(P)));
  const s = back.surfaces.find(x => x.holo && x.screen === 2);
  assert.ok(s); assert.ok(back.scenes[0].looks[s.id].span); assert.equal(back.settings.screens[2].edge.left, 0.15);
  assert.equal(back.settings.hologram.n, 2);
});

report();
