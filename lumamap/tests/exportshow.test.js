// tests/exportshow.test.js — «Exportar el show a video»: plan del show (duraciones o canción),
// escena y transición de cada instante, posición de los videos y análisis del sonido sin tiempo real.
import { test, report } from "./harness.js";
import assert from "node:assert/strict";
import { layoutShow, planShow, frameAt, videoTimeAt, OfflineAnalyser, bitrateFor, fmtDur, MANUAL } from "../web/js/exportshow.js";

const project = {
  settings: { transitionMs: 1000 },
  scenes: [
    { id: "a", duration: 4 },
    { id: "b", duration: 0, transition: "fade" },                 // manual
    { id: "c", duration: 6, transition: "cut" },
    { id: "d", duration: 2, transition: "wipe", trMs: 500 },
  ],
};
console.log("== Exportar el show a video ==");
await test("plan por duraciones: las escenas manuales ocupan lo mismo que en la línea de tiempo", () => {
  const p = planShow(project);
  assert.equal(p.bySong, false);
  assert.deepEqual(p.blocks.map(b => [b.id, b.start, b.len]), [["a", 0, 4], ["b", 4, MANUAL], ["c", 12, 6], ["d", 18, 2]]);
  assert.equal(p.total, 20);
  assert.deepEqual(layoutShow(project.scenes).total, 20);
});
await test("plan por canción: cada escena entra en su segundo y el video dura lo que la canción", () => {
  const p = planShow(project, { songShow: { ids: ["a", "c", "zz", "d"], starts: [0, 10.5, 20, 30] }, songDuration: 42 });
  assert.equal(p.bySong, true); assert.equal(p.total, 42);
  assert.deepEqual(p.blocks.map(b => [b.id, b.start, +b.len.toFixed(2)]), [["a", 0, 10.5], ["c", 10.5, 9.5], ["d", 30, 12]], "una escena borrada no cuenta");
  assert.equal(planShow(project, { songShow: { ids: ["a"], starts: [0] }, songDuration: 0 }).bySong, false, "sin canción, por duraciones");
});
await test("cada instante: escena, tiempo dentro de ella y transición (fundido 1 s, corte sin transición, la suya propia)", () => {
  const p = planShow(project);
  let f = frameAt(p, project, 0);
  assert.deepEqual([f.sceneId, f.elapsed, f.tr], ["a", 0, null], "la primera escena entra sin transición");
  f = frameAt(p, project, 4.25);
  assert.equal(f.sceneId, "b"); assert.equal(+f.elapsed.toFixed(2), 0.25);
  assert.deepEqual(f.tr, { fromId: "a", start: 4000, dur: 1000, mode: "fade" });
  assert.equal(frameAt(p, project, 5.01).tr, null, "acabó el fundido");
  assert.equal(frameAt(p, project, 12.1).tr, null, "corte");
  f = frameAt(p, project, 18.2);
  assert.deepEqual(f.tr, { fromId: "c", start: 18000, dur: 500, mode: "wipe" });
  assert.equal(frameAt(p, project, 25).sceneId, "d", "pasado el final, la última");
});
await test("videos: bucle, velocidad, una vez, reversa, ida y vuelta, entrada/salida y al tempo", () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≈ ${b}`);
  near(videoTimeAt(null, 10, 3), 3);
  near(videoTimeAt(null, 10, 13), 3);
  near(videoTimeAt(null, 10, 3, 2), 6);
  const P = (o) => ({ mode: "loop", in: 0, out: 1, beats: 0, ...o });
  near(videoTimeAt(P({ in: 0.2, out: 0.6 }), 10, 5), 3);              // 2 + (5 mod 4)
  near(videoTimeAt(P({ mode: "once" }), 10, 25), 10 - 1 / 120);
  near(videoTimeAt(P({ mode: "reverse" }), 10, 3), 7);
  near(videoTimeAt(P({ mode: "pingpong" }), 10, 13), 7);
  near(videoTimeAt(P({ mode: "pingpong" }), 10, 4), 4);
  near(videoTimeAt(P({ beats: 8 }), 8, 2, 1, 120), 4);                // 8 golpes a 120 = 4 s → velocidad 2
  assert.equal(videoTimeAt(null, 0, 5), 0);
});
await test("sonido: el analizador sin tiempo real da graves con un bombo y agudos con un pitido (como Web Audio)", () => {
  const sr = 48000, n = sr * 2, L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / sr; L[i] = R[i] = t < 1 ? 0.8 * Math.sin(2 * Math.PI * 70 * t) : 0.8 * Math.sin(2 * Math.PI * 6000 * t); }
  const an = new OfflineAnalyser([L, R], sr);
  const bins = new Uint8Array(512), hz = sr / 2 / 512;
  const peak = (a, b) => { let m = 0; for (let i = Math.floor(a / hz); i < Math.floor(b / hz); i++) m = Math.max(m, bins[i]); return m; };
  an.setTime(0.5); for (let k = 0; k < 20; k++) an.getByteFrequencyData(bins);
  const b1 = peak(35, 180), h1 = peak(2000, 9000);
  assert.ok(b1 > 200 && h1 < 60, `bombo: graves ${b1} / agudos ${h1}`);
  an.setTime(1.5); for (let k = 0; k < 20; k++) an.getByteFrequencyData(bins);
  const b2 = peak(35, 180), h2 = peak(2000, 9000);
  assert.ok(h2 > 200 && b2 < 60, `pitido: graves ${b2} / agudos ${h2}`);
  const w = new Uint8Array(1024); an.setTime(0.5); an.getByteTimeDomainData(w);
  assert.ok(Math.max(...w) > 220 && Math.min(...w) < 35, "forma de onda");
  an.setTime(5); an.getByteTimeDomainData(w); assert.ok(w.every(v => v === 128), "pasado el final: silencio");
});
await test("calidad y textos", () => {
  assert.equal(bitrateFor(3840, 2160, 30), 45e6);
  assert.equal(bitrateFor(1920, 1080, 60), Math.round(14e6 * 1.6));
  assert.equal(fmtDur(65), "1:05"); assert.equal(fmtDur(3725), "1:02:05");
});
report();
