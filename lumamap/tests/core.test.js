// tests/core.test.js — núcleo sin navegador: geometría, modelo, historial y dibujo.
import assert from "node:assert/strict";
import {
  homography, applyH, tryHomography, UNIT_SQUARE, evalMesh, gridFromCorners, resampleGrid, gridCornerIdx,
  screenToUV, uvToScreen, triangulatePolygon, simplify, pointInPolygon, surfaceOutline, surfaceAspect, transformPoints,
  edgeHandles, dragEdge, bbox,
} from "../web/js/math.js";
import * as M from "../web/js/model.js";
import { History } from "../web/js/history.js";
import { hitStroke, isAnimated, strokesSignature } from "../web/js/drawing.js";
import { detectQuads } from "../web/js/automap.js";
import { estimateBpm, estimateTempo, foldBpm } from "../web/js/audio.js";
import { test, report } from "./harness.js";
import { keyOf, normalizeKeys, buildCommands } from "../web/js/commands.js";

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

console.log("== Geometría ==");
await test("homografía lleva el cuadrado unidad a las 4 esquinas", () => {
  const dst = [[100, 50], [500, 80], [480, 400], [120, 380]];
  const H = homography(UNIT_SQUARE, dst);
  UNIT_SQUARE.forEach(([u, v], i) => { const [x, y] = applyH(H, u, v); assert.ok(near(x, dst[i][0]) && near(y, dst[i][1])); });
});
await test("homografía degenerada no lanza (tryHomography = null)", () => {
  assert.equal(tryHomography(UNIT_SQUARE, [[0, 0], [0, 0], [0, 0], [0, 0]]), null);
});
await test("pantalla → UV → pantalla es la identidad en un quad deformado", () => {
  const s = M.createQuad({ corners: [[100, 50], [500, 80], [480, 400], [120, 380]] });
  for (const [u, v] of [[0.2, 0.3], [0.5, 0.5], [0.9, 0.1]]) {
    const p = uvToScreen(s, u, v), uv = screenToUV(s, p.x, p.y);
    assert.ok(near(uv.u, u, 1e-6) && near(uv.v, v, 1e-6));
  }
});
await test("la interpolación (u/w, v/w, 1/w) del shader reproduce la perspectiva exacta", () => {
  // Simula el rasterizador: interpolación lineal en pantalla entre dos vértices.
  const corners = [[0, 0], [400, 60], [400, 240], [0, 300]];
  const H = homography(UNIT_SQUARE, corners);
  const attr = ([u, v]) => { const q = 1 / (H[6] * u + H[7] * v + H[8]); return [u * q, v * q, q]; };
  const a = attr([0, 0]), b = attr([1, 1]);
  const pa = applyH(H, 0, 0), pb = applyH(H, 1, 1);
  const t = 0.37, m = a.map((x, i) => x + (b[i] - x) * t);
  const uv = [m[0] / m[2], m[1] / m[2]];
  const screen = [pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t];
  const back = applyH(H, uv[0], uv[1]);
  assert.ok(near(back[0], screen[0], 1e-6) && near(back[1], screen[1], 1e-6));
});
await test("malla Catmull-Rom pasa exactamente por sus puntos de control", () => {
  const pts = gridFromCorners([[0, 0], [300, 0], [300, 200], [0, 200]], 4, 3);
  pts[5].x += 25; pts[5].y -= 10; // deforma un punto interior
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
    const p = evalMesh(pts, 4, 3, c / 3, r / 2), q = pts[r * 4 + c];
    assert.ok(near(p.x, q.x, 1e-6) && near(p.y, q.y, 1e-6), `punto ${c},${r}`);
  }
});
await test("cambiar la resolución de la malla conserva la forma", () => {
  const corners = [[10, 20], [410, 0], [400, 300], [30, 280]];
  const g2 = gridFromCorners(corners, 2, 2);
  const g5 = resampleGrid(g2, 2, 2, 5, 4);
  const idx = gridCornerIdx(5, 4);
  idx.forEach((i, k) => assert.ok(near(g5[i].x, corners[k][0], 1e-6) && near(g5[i].y, corners[k][1], 1e-6)));
  const back = resampleGrid(g5, 5, 4, 2, 2);
  gridCornerIdx(2, 2).forEach((i, k) => assert.ok(near(back[i].x, corners[k][0], 1e-4)));
});
await test("triangulación de polígono cóncavo (estrella) cubre n-2 triángulos", () => {
  const star = M.SHAPES.star.make(0, 0, 100).points;
  const tris = triangulatePolygon(star);
  assert.equal(tris.length, (star.length - 2) * 3);
});
await test("simplificación conserva extremos y reduce puntos", () => {
  const pts = []; for (let i = 0; i <= 100; i++) pts.push({ x: i, y: Math.abs(50 - i) < 1 ? 30 : 0 });
  const s = simplify(pts, 1);
  assert.ok(s.length < 10 && s[0].x === 0 && s.at(-1).x === 100);
});
await test("contorno y contacto de un quad", () => {
  const s = M.createQuad({ corners: M.rectCorners(0, 0, 100, 50) });
  const o = surfaceOutline(s);
  assert.equal(o.length, 4);
  assert.ok(pointInPolygon({ x: 50, y: 25 }, o) && !pointInPolygon({ x: 150, y: 25 }, o));
  assert.ok(near(surfaceAspect(s).aspect, 2));
});
await test("escala y rotación alrededor del centro", () => {
  const p = transformPoints([{ x: 10, y: 0 }], { x: 0, y: 0 }, 2, Math.PI / 2)[0];
  assert.ok(near(p.x, 0, 1e-9) && near(p.y, 20, 1e-9));
});

await test("asa lateral: estira sin girar (lado opuesto fijo, mismo ángulo)", () => {
  const s = M.createQuad({ corners: [[100, 100], [500, 150], [480, 400], [120, 380]] });
  const right = edgeHandles(s).find(e => e.side === "right");
  const pts = dragEdge(s.points, right, 60, 10);
  const idx = gridCornerIdx(2, 2); // TL, TR, BR, BL
  assert.deepEqual([pts[idx[0]], pts[idx[3]]], [s.points[idx[0]], s.points[idx[3]]], "el lado izquierdo no se mueve");
  const dir = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
  assert.ok(near(dir(pts[idx[1]], pts[idx[2]]), dir(s.points[idx[1]], s.points[idx[2]]), 1e-9), "el lado derecho conserva su ángulo");
  const moved = Math.hypot(pts[idx[1]].x - s.points[idx[1]].x, pts[idx[1]].y - s.points[idx[1]].y);
  assert.ok(moved > 50, "se estira hacia fuera: " + moved);
});
await test("asas laterales en mallas y polígonos reparten el estiramiento", () => {
  const m = M.createQuad({ corners: M.rectCorners(0, 0, 300, 200), cols: 4, rows: 3 });
  const top = edgeHandles(m).find(e => e.side === "top");
  const pts = dragEdge(m.points, top, 0, -40);
  assert.ok(near(pts[0].y, -40, 1e-9) && near(pts[4].y, 100 - 20, 1e-9) && near(pts[8].y, 200, 1e-9), "fila media sube la mitad, la de abajo fija");
  const star = M.SHAPES.star.make(100, 100, 50);
  const b0 = bbox(star.points);
  const r = edgeHandles(star).find(e => e.side === "right");
  const b1 = bbox(dragEdge(star.points, r, 30, 0));
  assert.ok(near(b1.x, b0.x, 1e-9) && near(b1.w, b0.w + 30, 1e-9), "el polígono se ensancha 30 px");
});

console.log("== Modelo de proyecto ==");
await test("todas las plantillas se construyen y validan", () => {
  for (const [k, t] of Object.entries(M.TEMPLATES)) {
    const p = M.normalizeProject(JSON.parse(JSON.stringify(t.build())));
    for (const s of p.surfaces) assert.ok(p.scenes[0].looks[s.id], `${k}: look para ${s.name}`);
  }
});
await test("cubo 3D: las caras comparten esquinas exactas (para moverlas juntas)", () => {
  const p = M.TEMPLATES.cube.build();
  const all = p.surfaces.flatMap(s => s.points.map(q => `${q.x},${q.y}`));
  const shared = all.filter((k, i) => all.indexOf(k) !== i);
  assert.ok(shared.length >= 4, "esquinas compartidas: " + shared.length);
});
await test("addSurface crea contenido en todas las escenas; removeSurface lo limpia", () => {
  const p = M.createProject();
  M.duplicateScene(p, p.sceneId);
  const s = M.addSurface(p, M.createQuad({ corners: M.rectCorners(0, 0, 10, 10) }), { type: "color", color: "#ff0000" });
  assert.ok(p.scenes.every(sc => sc.looks[s.id]?.source.color === "#ff0000"));
  p.scenes[0].looks[s.id].source.color = "#00ff00";
  assert.equal(p.scenes[1].looks[s.id].source.color, "#ff0000", "los looks no comparten referencia");
  M.removeSurface(p, s.id);
  assert.ok(p.scenes.every(sc => !sc.looks[s.id]) && !p.surfaces.length);
});
await test("duplicar superficie copia geometría desplazada y sus looks", () => {
  const p = M.TEMPLATES.screen.build();
  const c = M.duplicateSurface(p, p.surfaces[0].id, 40);
  assert.equal(p.surfaces.length, 2);
  assert.equal(c.points[0].x, p.surfaces[0].points[0].x + 40);
  assert.ok(p.scenes[0].looks[c.id]);
});
await test("medios usados se detectan en cualquier escena", () => {
  const p = M.TEMPLATES.screen.build();
  const sc2 = M.duplicateScene(p, p.sceneId);
  sc2.looks[p.surfaces[0].id].source = { ...M.DEFAULT_SOURCE(), type: "media", mediaId: "med_1" };
  assert.deepEqual([...M.usedMediaIds(p)], ["med_1"]);
});
await test("migra proyectos de LumaMap v1", () => {
  const v1 = {
    version: 1, name: "Viejo", width: 1280, height: 720, currentSceneId: "sc1",
    surfaces: [
      { id: "a", name: "Quad", type: "quad", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }], mediaId: "m1", opacity: 0.5, blend: "add", fx: { saturation: 0 } },
      { id: "b", name: "Poly", type: "poly", points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 25, y: 40 }] },
    ],
    scenes: [{ id: "sc1", name: "Uno", layers: [{ id: "l1", surfaceId: "a" }, { id: "l2", surfaceId: "b" }] }],
    media: [{ id: "m1", name: "v.mp4", kind: "video", dataUrl: "data:video/mp4;base64,AAAA" }],
  };
  const p = M.normalizeProject(v1);
  assert.equal(p.version, 2);
  const q = p.surfaces.find(s => s.id === "a");
  assert.equal(q.type, "quad"); assert.deepEqual([q.points[2].x, q.points[2].y, q.points[3].x], [0, 80, 100], "orden de rejilla TL,TR,BL,BR");
  const look = p.scenes[0].looks.a;
  assert.equal(look.source.mediaId, "m1"); assert.equal(look.opacity, 0.5); assert.equal(look.blend, "add"); assert.equal(look.fx.saturation, 0);
  assert.equal(p.media[0].dataUrl.slice(0, 10), "data:video");
});
await test("rechaza archivos que no son proyectos", () => {
  assert.throws(() => M.normalizeProject(null));
  assert.throws(() => M.normalizeProject({ version: 99 }));
});
await test("efectos rápidos parten de valores limpios", () => {
  const l = M.createLook();
  l.fx.brightness = 1.7;
  M.applyFxPreset(l, "Caleidoscopio");
  assert.equal(l.fx.kaleido, 6); assert.equal(l.fx.brightness, 1);
});

await test("biblioteca de efectos: más de 100 y solo usa parámetros que existen", () => {
  assert.ok(M.FX_LIBRARY.length >= 100, "efectos: " + M.FX_LIBRARY.length);
  const keys = new Set(Object.keys(M.DEFAULT_FX()));
  for (const e of M.FX_LIBRARY) for (const k of Object.keys(e.fx)) assert.ok(keys.has(k), `${e.name}: parámetro desconocido «${k}»`);
  const maps = new Set(M.COLORMAPS.map(c => c[0]));
  for (const e of M.FX_LIBRARY) if (e.fx.colormap) assert.ok(maps.has(e.fx.colormap), e.name);
});
await test("92 animaciones base con identificador único; «Calibrar» conserva su número", () => {
  assert.equal(M.GENERATORS.length, 92);
  assert.equal(new Set(M.GENERATORS.map(g => g.id)).size, 92);
  assert.equal(M.GEN_INDEX.calib, 15);
});
await test("resoluciones de composición hasta 8K y ajustes de salida por defecto", () => {
  const all = M.RESOLUTIONS.flatMap(g => g.list.map(([w, h]) => `${w}x${h}`));
  for (const r of ["1920x1080", "2048x1080", "2560x1440", "3840x2160", "4096x2160", "7680x4320", "1080x1920"]) assert.ok(all.includes(r), r);
  const p = M.normalizeProject({ ...M.createProject(), settings: { output: { fps: 30, softEdge: { left: 0.2 } } } });
  assert.equal(p.settings.output.fps, 30);
  assert.equal(p.settings.output.softEdge.left, 0.2);
  assert.equal(p.settings.output.softEdge.curve, 2.2, "completa lo que falta");
  assert.equal(p.settings.record.height, 1080);
});

await test("catálogo de más de 100 animaciones, todas válidas y catalogadas", () => {
  assert.ok(M.ANIM_LIBRARY.length >= 180, String(M.ANIM_LIBRARY.length));
  assert.equal(new Set(M.ANIM_LIBRARY.map(a => a.id)).size, M.ANIM_LIBRARY.length);
  const cats = new Set(M.ANIM_CATEGORIES);
  for (const a of M.ANIM_LIBRARY) {
    assert.ok(a.gen in M.GEN_INDEX, `${a.name}: ${a.gen}`);
    assert.ok(cats.has(a.cat), `${a.name}: ${a.cat}`);
    assert.match(a.color, /^#[0-9a-f]{6}$/i, a.name);
    if (a.fx) for (const k of Object.keys(a.fx)) assert.ok(k in M.DEFAULT_FX(), `${a.name}: fx ${k}`);
  }
  for (const c of M.ANIM_CATEGORIES) if (c !== "Todas") assert.ok(M.ANIM_LIBRARY.some(a => a.cat === c), `categoría vacía ${c}`);
});

console.log("== Texto animado ==");
await test("todas las animaciones de texto se dibujan sin errores", async () => {
  const { TEXT_ANIMS, renderText } = await import("../web/js/sources.js");
  assert.ok(TEXT_ANIMS.length >= 15);
  let draws = 0;
  const ctx = new Proxy({}, { get: (o, k) => k in o ? o[k] : k === "measureText" ? (t) => ({ width: String(t).length * 10 }) : (k === "fillText" || k === "strokeText") ? () => { draws++; } : () => {}, set: (o, k, v) => { o[k] = v; return true; } });
  const canvas = { width: 400, height: 200, getContext: () => ctx };
  for (const [id] of TEXT_ANIMS) {
    const before = draws;
    for (const t of [0, 0.7, 3.3]) renderText(canvas, { ...M.DEFAULT_SOURCE(), type: "text", text: "Hola\nLumaMap", textAnim: id, textGlow: 0.5, textOutline: 0.3 }, t, 0.5);
    assert.ok(draws > before, `${id} no dibuja`);
  }
});

console.log("== Actualizaciones ==");
await test("compara compilaciones para saber si hay versión nueva", async () => {
  const { buildOf, isNewer } = await import("../web/js/updater.js");
  assert.equal(buildOf("2.3.57"), 57);
  assert.equal(buildOf(""), 0);
  assert.ok(isNewer({ build: 58 }, { platform: "android", build: 57 }));
  assert.ok(!isNewer({ build: 57 }, { platform: "windows", build: 57 }));
  assert.ok(!isNewer({ build: 99 }, { platform: "web", build: 0 }), "en la web no se instala");
});

console.log("== Optimizador de video ==");
await test("analiza ffmpeg y decide conservar, re-empaquetar o convertir", async () => {
  const { createRequire } = await import("node:module");
  const { decide, parseProbe } = createRequire(import.meta.url)("../desktop/optimize.js");
  const info = parseProbe(`Input #0, mov,mp4 from 'a.mov':
  Duration: 00:01:02.50, start: 0.000000, bitrate: 45000 kb/s
  Stream #0:0(und): Video: prores (HQ) (apch / 0x68637061), yuv422p10le, 3840x2160, 44000 kb/s, 29.97 fps
  Stream #0:1(und): Audio: aac (LC), 48000 Hz, stereo`);
  assert.equal(info.codec, "prores"); assert.equal(info.width, 3840); assert.equal(info.height, 2160);
  assert.equal(info.duration, 62.5); assert.equal(info.bitrate, 45000); assert.ok(info.audio);
  const T = { width: 1920, height: 1080 };
  assert.equal(decide(info, ".mov", T).action, "encode");
  const ok = { codec: "h264", width: 1920, height: 1080, fps: 30, bitrate: 8000 };
  assert.equal(decide(ok, ".mp4", T).action, "keep");
  assert.equal(decide(ok, ".mkv", T).action, "remux");
  assert.equal(decide({ ...ok, width: 3840, height: 2160 }, ".mp4", T).action, "encode");
  assert.equal(decide({ ...ok, fps: 120 }, ".mp4", T).action, "encode");
  assert.equal(decide({ codec: null }, ".mp4", T).action, "keep");
});

console.log("== Mezcla en vivo, pantallas y sensores ==");
await test("cubierta B: fader manual, fundido por tiempo y contenido de B", async () => {
  const { mixOf, deckB } = await import("../web/js/compose.js");
  const look = M.createLook({ type: "gen", gen: "plasma" });
  look.next = { source: { ...M.DEFAULT_SOURCE(), type: "gen", gen: "warp", color: "#ffffff" }, fx: null, fit: null };
  look.mix = 0.3;
  assert.equal(mixOf(look, 10), 0.3);
  look.fade = { t0: 10, dur: 2 };
  assert.equal(mixOf(look, 10), 0); assert.equal(mixOf(look, 11), 0.5); assert.equal(mixOf(look, 20), 1);
  const b = deckB(look);
  assert.equal(b.source.gen, "warp"); assert.equal(b.next, null); assert.equal(b.fx, look.fx, "sin fx propio usa los de A");
});
await test("el proyecto conserva lo «siguiente», las pantallas y los sensores", () => {
  const p = M.createProject();
  const s = M.createQuad({ corners: M.rectCorners(0, 0, 100, 100) });
  M.addSurface(p, s);
  s.screen = 2;
  p.scenes[0].looks[s.id].next = { source: { type: "gen", gen: "dna" } };
  p.settings.screens = { 2: { on: false } };
  p.settings.sensors = [{ id: "x", action: "beat" }];
  const n = M.normalizeProject(JSON.parse(JSON.stringify(p)));
  const l = n.scenes[0].looks[s.id];
  assert.equal(l.next.source.gen, "dna"); assert.equal(l.next.source.speed, 1, "completa la fuente de B");
  assert.equal(n.surfaces[0].screen, 2);
  assert.equal(n.settings.screens[2].on, false); assert.equal(n.settings.screens[2].master, 1);
  assert.equal(n.settings.screens[4].on, true);
  assert.equal(n.settings.sensors[0].action, "beat");
});
await test("efectos de pantalla y umbral de sensores", () => {
  for (const [id] of M.SCREEN_FX) assert.equal(typeof M.screenFilter(id, 1.5), "string");
  assert.equal(M.screenFilter("none"), "");
  assert.match(M.screenFilter("hue", 1), /hue-rotate\(60deg\)/);
  assert.ok(M.sensorThreshold({ sens: 1 }) < M.sensorThreshold({ sens: 0 }), "más sensible = umbral más bajo");
});

console.log("== Historial ==");
await test("deshacer / rehacer por instantáneas", () => {
  const h = new History();
  const p = { a: 1 };
  h.reset(p);
  p.a = 2; h.commit(p);
  p.a = 3; h.commit(p);
  assert.equal(h.commit(p), false, "sin cambios no crea paso");
  assert.equal(h.undo().a, 2);
  assert.equal(h.undo().a, 1);
  assert.equal(h.undo(), null);
  assert.equal(h.redo().a, 2);
  assert.ok(h.canRedo);
});

console.log("== Dibujo ==");
await test("borrador encuentra el trazo bajo el dedo", () => {
  const strokes = [
    { id: "1", tool: "pen", width: 0.01, pts: [[0.1, 0.1], [0.4, 0.1]] },
    { id: "2", tool: "rect", width: 0.01, pts: [[0.5, 0.5], [0.8, 0.8]] },
    { id: "3", tool: "ellipse", width: 0.01, fill: true, pts: [[0.1, 0.5], [0.3, 0.9]] },
  ];
  assert.equal(hitStroke(strokes, 0.25, 0.105, 0.02), 0);
  assert.equal(hitStroke(strokes, 0.8, 0.65, 0.02), 1);
  assert.equal(hitStroke(strokes, 0.2, 0.7, 0.02), 2, "elipse rellena: cualquier punto interior");
  assert.equal(hitStroke(strokes, 0.95, 0.05, 0.02), -1);
});
await test("firma de trazos detecta cambios y animaciones", () => {
  const a = [{ id: "x", pts: [[0, 0]] }];
  assert.notEqual(strokesSignature(a), strokesSignature([...a, { id: "y", pts: [] }]));
  assert.equal(isAnimated(a), false);
  assert.equal(isAnimated([{ id: "z", anim: "pulse", pts: [] }]), true);
});

console.log("== Ritmo ==");
await test("estima el BPM con golpes desplazados por los fotogramas (±16 ms)", () => {
  const t = []; let x = 0;
  for (let i = 0; i < 16; i++) { t.push(Math.round((x + (i % 3 - 1) * 16) * 10) / 10); x += 60000 / 128; }
  assert.ok(Math.abs(estimateBpm(t) - 128) < 3, String(estimateBpm(t)));
});
await test("tolera golpes perdidos y lleva el tempo al rango musical", () => {
  const p = 60000 / 100, t = [0, p, 3 * p, 4 * p, 5 * p, 7 * p, 8 * p];
  assert.ok(Math.abs(estimateBpm(t) - 100) < 1.5, String(estimateBpm(t)));
  assert.equal(Math.round(foldBpm(60000 / 60)), 120);
  assert.equal(estimateBpm([0, 500]), null);
});

await test("bombo + caja a contratiempo: tempo y fase siguen al bombo", () => {
  const P = 60000 / 95, t = [], w = [];
  for (let i = 0; i < 18; i++) {
    t.push(1000 + i * P + ((i * 7) % 5 - 2) * 6); w.push(3);           // bombo
    t.push(1000 + i * P + P / 2 + ((i * 3) % 5 - 2) * 6); w.push(1);   // caja
  }
  const order = t.map((x, i) => i).sort((a, b) => t[a] - t[b]);
  const est = estimateTempo(order.map(i => t[i]), order.map(i => w[i]));
  assert.ok(Math.abs(est.bpm - 95) < 1, "bpm " + est.bpm);
  const ph = (((est.ref - 1000) / P) % 1 + 1) % 1;
  assert.ok(Math.min(ph, 1 - ph) < 0.05, "fase en el bombo: " + ph);
});

console.log("== Atajos de teclado ==");
await test("los atajos se reconocen igual que se escriben", () => {
  const ev = (key, o = {}) => ({ key, ctrlKey: !!o.ctrl, metaKey: false, altKey: false, shiftKey: !!o.shift });
  assert.equal(keyOf(ev("k", { ctrl: true })), normalizeKeys("Ctrl+K"));
  assert.equal(keyOf(ev("S", { ctrl: true, shift: true })), normalizeKeys("Ctrl+Shift+S"));
  assert.equal(keyOf(ev(" ")), "Space");
  assert.equal(keyOf(ev("+", { shift: true })), normalizeKeys("+"));
  assert.equal(keyOf(ev("R", { shift: true })), normalizeKeys("Shift+R"));
  assert.equal(keyOf(ev("r")), normalizeKeys("R"));
  assert.equal(keyOf(ev("]", { ctrl: true })), normalizeKeys("Ctrl+]"));
});
await test("ningún atajo está repetido y todos los comandos tienen nombre", () => {
  const app = { actions: new Proxy({}, { get: () => () => {} }), S: {}, audio: () => ({ bpm: 120 }), openTab() {}, setMode() {} };
  const cmds = buildCommands(app);
  const seen = new Map();
  for (const c of cmds) {
    assert.ok(c.label && typeof c.run === "function", c.id);
    if (!c.keys) continue;
    const k = normalizeKeys(c.keys);
    assert.ok(!seen.has(k), `${k} repetido en ${c.id} y ${seen.get(k)}`);
    seen.set(k, c.id);
  }
  assert.equal(new Set(cmds.map(c => c.id)).size, cmds.length, "ids únicos");
  assert.ok(cmds.length > 60, "comandos: " + cmds.length);
});
await test("cada opción del menú de Windows ejecuta un comando que existe", async () => {
  const fs = await import("node:fs");
  const main = fs.readFileSync(new URL("../desktop/main.js", import.meta.url), "utf8");
  const ids = [...main.matchAll(/cmd\("[^"]+", "([^"]+)"/g)].map(m => m[1]);
  const app = { actions: new Proxy({}, { get: () => () => {} }), S: {}, audio: () => ({ bpm: 120 }), openTab() {}, setMode() {} };
  const known = new Set(buildCommands(app).map(c => c.id));
  assert.ok(ids.length > 50, "opciones de menú: " + ids.length);
  const missing = ids.filter(id => !known.has(id));
  assert.deepEqual(missing, []);
});

console.log("== Detección de superficies en foto (experimental) ==");
function synthImage(w, h, draw) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data[i * 4 + 3] = 255;
  draw((x, y, v) => { const i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = v; });
  return { width: w, height: h, data };
}
await test("detecta un rectángulo blanco sobre negro", () => {
  const img = synthImage(80, 60, (px) => { for (let y = 15; y < 40; y++) for (let x = 20; x < 50; x++) px(x, y, 255); });
  const quads = detectQuads(img);
  assert.ok(quads.length >= 1);
  const xs = quads[0].points.map(p => p.x), ys = quads[0].points.map(p => p.y);
  assert.ok(Math.min(...xs) >= 17 && Math.max(...xs) <= 53 && Math.min(...ys) >= 12 && Math.max(...ys) <= 43);
});
await test("imagen vacía: no inventa superficies", () => {
  assert.equal(detectQuads(synthImage(60, 40, () => {})).length, 0);
});

await test("modo sin conexión (APK y navegador): todos los módulos están en la caché", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const sw = readFileSync(new URL("../web/sw.js", import.meta.url), "utf8");
  const walk = (d) => readdirSync(new URL("../web/" + d, import.meta.url), { withFileTypes: true })
    .flatMap(e => e.isDirectory() ? walk(d + "/" + e.name) : e.name.endsWith(".js") ? [d + "/" + e.name] : []);
  const missing = walk("js").filter(f => !sw.includes(`"${f}"`));
  assert.deepEqual(missing, []);
});

report();
