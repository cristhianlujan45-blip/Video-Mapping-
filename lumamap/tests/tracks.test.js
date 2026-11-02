// tests/tracks.test.js — pistas de audio (multipista): envolvente ADSR, bandas y modelo.
import assert from "node:assert/strict";
import { test, report } from "./harness.js";
import { Adsr, adsrShape, bandEnergy, BandFollower, BANDS, newTrack, normalizeTracks, chanName, MAX_TRACKS } from "../web/js/tracks.js";
import { soundAt, normalizeLfos, isSoundShape } from "../web/js/lfo.js";

const run = (adsr, input, secs, p, dt = 1 / 100) => { let v = 0; for (let t = 0; t < secs; t += dt) v = adsr.step(input, dt, p); return v; };
const P = { mode: "gate", threshold: 0.4, attack: 0.1, decay: 0.2, sustain: 0.5, release: 0.3 };

console.log("== Pistas de audio ==");
await test("ADSR: sube en el ataque, cae al sostén mientras suena y se apaga en la liberación", () => {
  const a = new Adsr();
  assert.equal(run(a, 0.2, 0.5, P), 0, "por debajo del umbral no se mueve");
  const half = run(a, 0.9, 0.05, P);
  assert.ok(half > 0.35 && half < 0.65, "a mitad del ataque, a mitad: " + half);
  assert.ok(Math.abs(run(a, 0.9, 0.06, P) - 1) < 0.08, "al final del ataque, arriba");
  assert.ok(Math.abs(run(a, 0.9, 0.5, P) - 0.5) < 1e-6, "sostén mientras suena");
  assert.ok(run(a, 0.35, 0.1, P) > 0.45, "histéresis: un poco por debajo del umbral sigue sonando");
  const rel = run(a, 0, 0.15, P);
  assert.ok(rel > 0.15 && rel < 0.35, "a mitad de la liberación: " + rel);
  assert.equal(run(a, 0, 0.3, P), 0, "y se apaga");
  // Un golpe corto con caída a 0 de sostén: un destello.
  const b = new Adsr(), flash = { ...P, attack: 0, decay: 0.1, sustain: 0 };
  assert.equal(b.step(1, 0.01, flash), 1);
  assert.equal(run(b, 1, 0.2, flash), 0);
});
await test("ADSR «sigue el volumen»: suaviza la subida y la bajada", () => {
  const a = new Adsr(), F = { mode: "follow", attack: 0.2, release: 1 };
  const up = run(a, 1, 0.1, F);
  assert.ok(up > 0.5 && up < 1, "subiendo: " + up);
  assert.ok(run(a, 1, 1, F) > 0.99);
  const down = run(a, 0, 0.2, F);
  assert.ok(down > 0.3 && down < 0.9, "bajando despacio: " + down);
  assert.equal(new Adsr().step(0.7, 0.01, { mode: "follow", attack: 0, release: 0 }), 0.7, "sin tiempos: igual que el volumen");
});
await test("forma del ADSR para dibujarla", () => {
  assert.deepEqual(adsrShape(P, 0.4).map(p => p.map(x => +x.toFixed(2))), [[0, 0], [0.1, 1], [0.3, 0.5], [0.7, 0.5], [1, 0]]);
});
await test("bandas: el bombo está en los graves y los platillos en los agudos", () => {
  const sr = 44100, n = 512, hz = sr / 2 / n, bins = new Uint8Array(n);
  for (let k = Math.floor(50 / hz); k <= Math.ceil(100 / hz); k++) bins[k] = 255;   // solo graves
  const kick = bandEnergy(bins, sr, BANDS.kick.lo, BANDS.kick.hi), hats = bandEnergy(bins, sr, BANDS.hats.lo, BANDS.hats.hi);
  assert.ok(kick > 0.8, "bombo: " + kick); assert.equal(hats, 0);
  assert.equal(bandEnergy(null, sr, 20, 100), 0);
});
await test("detector de una parte: llega a 1 aunque suene bajito, y con «punch» solo los golpes", () => {
  const f = new BandFollower();
  let v = 0; for (let i = 0; i < 100; i++) v = f.step(0.1, 0.02);
  assert.ok(v > 0.9, "normalizado a su máximo: " + v);
  const p = new BandFollower();
  for (let i = 0; i < 100; i++) p.step(0.3, 0.02, true);
  assert.ok(p.step(0.3, 0.02, true) < 0.1, "un sonido constante no es un golpe");
  assert.ok(p.step(0.9, 0.02, true) > 0.5, "un golpe sí");
});
await test("modelo: pistas válidas, máximo " + MAX_TRACKS + ", y su nombre de canal para los nodos", () => {
  const t = newTrack("file", { name: "Bombo 1", media: "m1" });
  assert.equal(t.kind, "file"); assert.equal(t.band, "all"); assert.equal(t.mode, "gate");
  assert.equal(newTrack("master").band, "kick");
  const n = normalizeTracks({ list: [...Array(12)].map((_, k) => ({ id: "t" + k, name: "<b>x</b>" + k, attack: -5, sustain: 9, kind: "raro" })) });
  assert.equal(n.list.length, MAX_TRACKS);
  assert.ok(!/[<>]/.test(n.list[0].name)); assert.equal(n.list[0].attack, 0); assert.equal(n.list[0].sustain, 1); assert.equal(n.list[0].kind, "master");
  assert.deepEqual(normalizeTracks(null), { list: [], loop: true });
  assert.equal(chanName("Bombo 1"), "bombo_1"); assert.equal(chanName("Voz (ñ)"), "voz_n"); assert.equal(chanName("808"), "p808");
});
await test("señales: una pista mueve cualquier control («track:<id>») y se guarda", () => {
  assert.ok(isSoundShape("track:trk1"));
  assert.equal(soundAt("track:trk1", { tracks: { trk1: 0.8 } }), 0.8);
  assert.equal(soundAt("track:otra", { tracks: {} }), 0);
  assert.equal(normalizeLfos([{ param: "global/master", shape: "track:trk1" }])[0].shape, "track:trk1");
  assert.equal(normalizeLfos([{ param: "global/master", shape: "track:<x>" }])[0].shape, "sine", "una forma rara no entra");
});
report();
