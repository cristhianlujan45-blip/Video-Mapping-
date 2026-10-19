// tests/show.test.js — timecode (LTC), cues por timecode, automatización y emergencia.
import { test, report } from "./harness.js";
import assert from "node:assert/strict";
import * as M from "../web/js/model.js";
import { ParamEngine } from "../web/js/params.js";
import { ShowEngine, parseTc, fmtTc, laneValue } from "../web/js/show.js";
import { LtcDecoder, encodeLtc } from "../web/js/ltc-core.js";
import { sceneLayers } from "../web/js/compose.js";

let now = 1000;
globalThis.performance = { now: () => now };

function makeApp() {
  const project = M.createProject();
  const s = M.createQuad({ name: "Pared", corners: M.rectCorners(0, 0, 100, 100) });
  M.addSurface(project, s);
  const s2 = M.createScene("Escena 2"), s3 = M.createScene("Escena 3");
  project.scenes.push(s2, s3);
  const went = [];
  const app = {
    S: { project, sel: s.id, master: 1, clock: 0, sceneStart: 0, playing: true },
    actions: { goScene: (id) => { went.push(id); project.sceneId = id; app.S.sceneStart = app.S.clock; } },
    paramTouched() {}, paramMappingsChanged() {},
  };
  app.params = new ParamEngine(app);
  app.show = new ShowEngine(app);
  return { app, s, went, scenes: project.scenes };
}

console.log("== Show ==");

await test("timecode: texto ↔ segundos", () => {
  assert.equal(parseTc("01:02:03:15", 30), 3723.5);
  assert.equal(parseTc("1:00:00", 25), 3600);
  assert.equal(parseTc("abc"), null);
  assert.equal(fmtTc(3723.5, 30), "01:02:03:15");
});

await test("LTC: decodifica 24/25/30 fps, con ruido y nivel bajo", () => {
  for (const fps of [24, 25, 30]) {
    const sig = encodeLtc({ h: 10, m: 20, s: 30, f: 5, fps, frames: 40, sampleRate: 48000, amp: 0.05 });
    let seed = 1; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
    for (let i = 0; i < sig.length; i++) sig[i] += rnd() * 0.01;      // ruido del 20 % de la señal
    const d = new LtcDecoder(48000), got = [];
    d.onFrame = (t) => got.push(t);
    for (let i = 0; i < sig.length; i += 128) d.process(sig.subarray(i, i + 128));
    assert.ok(got.length >= 38, `${fps} fps: ${got.length} cuadros`);
    assert.deepEqual([got[0].h, got[0].m, got[0].s, got[0].f], [10, 20, 30, 5]);
    assert.equal(got.at(-1).fps, fps);
    for (let i = 1; i < got.length; i++) assert.ok(Math.abs(got[i].seconds - got[i - 1].seconds - 1 / fps) < 1e-6, "cuadros consecutivos");
  }
});

await test("cues por timecode (chase): entran solas, también al saltar atrás; sin señal no se inventa", () => {
  const { app, went, scenes } = makeApp();
  const sh = app.S.project.settings.show;
  sh.tcSource = "mtc"; sh.chase = true;
  scenes[0].tc = "00:00:00:00"; scenes[1].tc = "00:00:10:00"; scenes[2].tc = "00:00:20:00";
  app.show.external_("mtc", { seconds: 12, fps: 25 }); app.show.tick();
  assert.equal(went.at(-1), scenes[1].id);
  app.show.external_("mtc", { seconds: 21, fps: 25 }); app.show.tick();
  assert.equal(went.at(-1), scenes[2].id);
  app.show.external_("mtc", { seconds: 3, fps: 25 }); app.show.tick();
  assert.equal(went.at(-1), scenes[0].id);
  now += 5000; app.show.tick();                     // la señal se cortó hace 5 s
  assert.equal(app.S.tcNow, null);
});

await test("automatización: grabar un fader MIDI y reproducirlo como modulación", () => {
  const { app } = makeApp();
  const C = app.S.project.settings.control;
  C.mappings.push(M.normalizeMapping({ src: "midi", key: "cc:1", target: "global/master", takeover: false }));
  app.show.startRecording();
  for (let i = 0; i <= 10; i++) { app.S.clock = i * 0.1; app.params.input({ src: "midi", key: "cc:1", v: i / 10, raw: i * 12 }); }
  const r = app.show.stopRecording();
  assert.equal(r.targets.size, 1);
  const lane = app.S.project.settings.show.lanes[0];
  assert.equal(lane.target, "global/master"); assert.equal(lane.points.length, 11);
  // Reproducción: en t = 0.55 s el brillo vale ~0.55 sin tocar el valor guardado.
  app.S.master = 0.1; app.S.clock = 0.55; app.S.sceneStart = 0;
  app.show.tick();
  const mods = app.params.modList();
  assert.ok(Math.abs(mods.find(m => m.id === "global/master").value - 0.55) < 1e-6);
  assert.equal(app.S.master, 0.1);
  assert.equal(laneValue([[0, 0], [1, 10]], 0.25), 2.5);
});

await test("transiciones: fundido por opacidad; cortinilla/disolver/iris por zonas", () => {
  const P = M.createProject(); const b = M.createScene("B"); P.scenes.push(b);
  const from = P.sceneId; P.sceneId = b.id;
  const fade = sceneLayers(P, { fromId: from, start: 0, dur: 1000, mode: "fade" }, 500);
  assert.ok(Math.abs(fade[0].alpha - 0.5) < 1e-9 && fade[0].tr.role === 0 && fade[1].tr.role === 1);
  const wipe = sceneLayers(P, { fromId: from, start: 0, dur: 1000, mode: "wipe" }, 500);
  assert.deepEqual(wipe.map(l => l.alpha), [1, 1]); assert.equal(wipe[1].tr.mode, "wipe");
  assert.equal(sceneLayers(P, { fromId: from, start: 0, dur: 1000, mode: "iris" }, 2000).length, 1);
});

report();
