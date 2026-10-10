// tests/params.test.js — motor de parámetros y driver MIDI (sin navegador).
import { test, report } from "./harness.js";
import assert from "node:assert/strict";
import * as M from "../web/js/model.js";
import { ParamEngine, describe, applyModList, catalog, relSteps } from "../web/js/params.js";
import { MidiDriver } from "../web/js/midi.js";

globalThis.performance ??= { now: () => Date.now() };

/** App mínima con el mismo contrato que editor.js. */
function makeApp() {
  const project = M.createProject();
  const s = M.createQuad({ name: "Pared", corners: M.rectCorners(0, 0, 100, 100) });
  M.addSurface(project, s);
  const calls = [];
  const app = {
    S: { project, sel: s.id, master: 1, blackout: false, playing: true, liveFade: 2, guides: false },
    actions: {
      blackout: () => { app.S.blackout = !app.S.blackout; calls.push("blackout"); },
      togglePlay: () => { app.S.playing = !app.S.playing; },
      stepScene: (d) => calls.push("step" + d), restart: () => calls.push("restart"),
      goScene: (id) => calls.push("go:" + id), setBpm: (v) => { project.settings.bpm = v; },
      setScreenCfg: (n, cfg) => Object.assign(project.settings.screens[n], cfg),
      setMix: (id, v) => { M.lookOf(M.currentScene(project), id).mix = v; },
      go: () => calls.push("go"), randomNext: () => calls.push("rnd"), goAll: () => {}, randomAll: () => {}, tap: () => {}, toggleReact: () => {}, toggleGuides: () => {},
    },
    touched: [], paramTouched(id) { this.touched.push(id); }, paramMappingsChanged() {},
  };
  app.params = new ParamEngine(app);
  return { app, s, calls };
}
const cc = (n, v, extra = {}) => ({ src: "midi", device: "Mi Controlador", channel: 1, key: "cc:" + n, v: v / 127, raw: v, on: v >= 64, ...extra });

console.log("== Motor de parámetros ==");

await test("describe: global, superficie, efecto, pantalla, escena y «seleccionada»", () => {
  const { app, s } = makeApp();
  assert.equal(describe(app, "global/master").max, 1);
  const fx = describe(app, `surf/${s.id}/fx/brightness`);
  assert.deepEqual([fx.min, fx.max, fx.def], [0, 2, 1]);
  fx.set(1.5);
  assert.equal(M.lookOf(M.currentScene(app.S.project), s.id).fx.brightness, 1.5);
  assert.equal(describe(app, "surf/sel/opacity").id, `surf/${s.id}/opacity`);
  assert.equal(describe(app, "screen/2/master").get(), 1);
  assert.equal(describe(app, "surf/no-existe/opacity"), null);
  const cat = catalog(app);
  assert.ok(cat.some(g => g.group === "General") && cat.some(g => g.group.startsWith("Superficie · Pared")));
});

await test("MIDI LEARN: mover un knob crea el mapeo con dispositivo, canal y CC", async () => {
  const { app } = makeApp();
  const P = app.params;
  const pending = P.learn("global/master");
  P.input(cc(7, 90));
  const m = await pending;
  assert.equal(m.device, "Mi Controlador"); assert.equal(m.channel, 1); assert.equal(m.key, "cc:7"); assert.equal(m.mode, "absolute");
  assert.match(m.id || "", /^map_/, "el mapeo nuevo tiene id (sin id el diálogo de aprender no se cerraba)");
  assert.equal(app.S.project.settings.control.mappings.length, 1);
  // A partir de ahí el knob controla el brillo (con soft takeover: primero alcanza el valor actual = 100 %).
  P.input(cc(7, 127)); P.input(cc(7, 64));
  assert.ok(Math.abs(app.S.master - 64 / 127) < 1e-9);
});

await test("soft takeover: no salta hasta alcanzar el valor actual", () => {
  const { app } = makeApp();
  app.S.project.settings.control.mappings.push(M.normalizeMapping({ src: "midi", device: "*", key: "cc:1", target: "global/master" }));
  app.S.master = 0.5;
  app.params.input(cc(1, 10));                    // lejos: se ignora
  assert.equal(app.S.master, 0.5);
  app.params.input(cc(1, 40)); app.params.input(cc(1, 70));   // cruza el 50 %: lo recoge
  assert.ok(Math.abs(app.S.master - 70 / 127) < 1e-9);
  app.S.master = 0.1;                              // otro control lo cambia
  app.params.input(cc(1, 72));
  assert.equal(app.S.master, 0.1);                 // vuelve a esperar
});

await test("botones: alternar, momentáneo y disparo; notas y teclas", () => {
  const { app, calls } = makeApp();
  const C = app.S.project.settings.control;
  C.mappings.push(M.normalizeMapping({ src: "midi", key: "note:36", target: "global/blackout", mode: "toggle" }));
  C.mappings.push(M.normalizeMapping({ src: "midi", key: "note:37", target: "global/guides", mode: "momentary" }));
  C.mappings.push(M.normalizeMapping({ src: "key", key: "N", target: "global/next" }));
  app.actions.toggleGuides = () => { app.S.guides = !app.S.guides; };
  const note = (n, on) => ({ src: "midi", device: "X", channel: 10, key: "note:" + n, v: on ? 1 : 0, on });
  app.params.input(note(36, true)); app.params.input(note(36, false));
  assert.equal(app.S.blackout, true);
  app.params.input(note(36, true));
  assert.equal(app.S.blackout, false);
  app.params.input(note(37, true)); assert.equal(app.S.guides, true);
  app.params.input(note(37, false)); assert.equal(app.S.guides, false);
  app.params.input({ src: "key", key: "N", on: true }); app.params.input({ src: "key", key: "N", on: false });
  assert.ok(calls.includes("step1"));
});

await test("encoder relativo (complemento a 2, desplazado, signo) con sensibilidad", () => {
  assert.equal(relSteps(1), 1); assert.equal(relSteps(127), -1); assert.equal(relSteps(65, "offset"), 1); assert.equal(relSteps(63, "offset"), -1);
  assert.equal(relSteps(65, "sign"), -1); assert.equal(relSteps(3, "sign"), 3);
  const { app } = makeApp();
  app.S.project.settings.control.mappings.push(M.normalizeMapping({ src: "midi", key: "cc:16", target: "global/master", mode: "relative", sens: 2 }));
  app.S.master = 0.5;
  app.params.input(cc(16, 4));
  assert.ok(Math.abs(app.S.master - (0.5 + 8 / 128)) < 1e-9);
  app.params.input(cc(16, 124));
  assert.ok(Math.abs(app.S.master - 0.5) < 1e-9);
});

await test("mezclas: audio suma al brillo sin tocar el valor guardado y caduca", () => {
  const { app, s } = makeApp();
  const C = app.S.project.settings.control;
  C.mappings.push(M.normalizeMapping({ src: "audio", key: "bass", target: `surf/${s.id}/fx/brightness`, merge: "add", max: 0.5 }));
  app.params.input({ src: "audio", key: "bass", v: 1 });
  const mods = app.params.modList();
  assert.equal(mods.length, 1);
  assert.ok(Math.abs(mods[0].value - 2) < 1e-9);            // 1 + 0.5 × rango (2) = 2 (máximo)
  const { project } = applyModList(app.S.project, 1, mods);
  assert.equal(M.lookOf(M.currentScene(project), s.id).fx.brightness, 2);
  assert.equal(M.lookOf(M.currentScene(app.S.project), s.id).fx.brightness, 1);   // el proyecto no cambia
  assert.equal(app.params.modList(performance.now() + 2000), null);               // sin datos: desaparece
});

await test("varias fuentes sobre el mismo parámetro: multiplicar, máximo y mínimo", () => {
  const { app } = makeApp();
  const C = app.S.project.settings.control;
  app.S.master = 0.8;
  C.mappings.push(M.normalizeMapping({ id: "a", src: "tracking", key: "people", target: "global/master", merge: "multiply" }));
  C.mappings.push(M.normalizeMapping({ id: "b", src: "osc", key: "/x", target: "global/master", merge: "max" }));
  app.params.input({ src: "tracking", key: "people", v: 0.5 });
  app.params.input({ src: "osc", key: "/x", v: 0.3 });
  const [{ value }] = app.params.modList();
  assert.ok(Math.abs(value - 0.4) < 1e-9);          // 0.8 × 0.5 = 0.4, máx(0.4, 0.3) = 0.4
  const { master } = applyModList(app.S.project, app.S.master, app.params.modList());
  assert.ok(Math.abs(master - 0.4) < 1e-9);
});

await test("bancos y modificador SHIFT: el mismo knob controla otra cosa", () => {
  const { app, s } = makeApp();
  const C = app.S.project.settings.control;
  C.mappings.push(M.normalizeMapping({ src: "midi", key: "cc:20", target: "global/master", takeover: false }));
  C.mappings.push(M.normalizeMapping({ src: "midi", key: "cc:20", target: `surf/${s.id}/opacity`, mod: "shift", takeover: false }));
  C.mappings.push(M.normalizeMapping({ src: "midi", key: "note:1", target: "mod/shift", mode: "momentary" }));
  C.mappings.push(M.normalizeMapping({ src: "midi", key: "cc:21", target: "global/bpm", bank: "Luces", takeover: false }));
  app.params.input(cc(20, 0));
  assert.equal(app.S.master, 0);
  app.params.input({ src: "midi", key: "note:1", on: true, v: 1 });
  app.params.input(cc(20, 127));
  assert.equal(app.S.master, 0);
  assert.equal(M.lookOf(M.currentScene(app.S.project), s.id).opacity, 1);
  app.params.input(cc(20, 0));
  assert.equal(M.lookOf(M.currentScene(app.S.project), s.id).opacity, 0);
  app.params.input({ src: "midi", key: "note:1", on: false, v: 0 });
  app.params.input(cc(21, 127)); assert.equal(app.S.project.settings.bpm, 120);   // banco no activo
  app.params.setBank("Luces"); app.params.input(cc(21, 127));
  assert.equal(app.S.project.settings.bpm, 240);
});

await test("macros: una acción ejecuta varias, en orden", () => {
  const { app, calls } = makeApp();
  const C = app.S.project.settings.control;
  C.macros.push({ id: "m1", name: "SHOW START", steps: [{ target: "scene/0" }, { target: "global/master", value: 0.7 }, { target: "global/blackout", value: 1 }] });
  C.mappings.push(M.normalizeMapping({ src: "midi", key: "note:60", target: "macro/m1" }));
  app.params.input({ src: "midi", key: "note:60", on: true, v: 1 });
  assert.ok(calls.some(c => c.startsWith("go:")));
  assert.equal(app.S.master, 0.7); assert.equal(app.S.blackout, true);
});

await test("feedback: envía al controlador los valores que cambian (una vez)", () => {
  const { app } = makeApp();
  const sent = [];
  app.params.feedback = (m, v) => sent.push(v);
  app.S.project.settings.control.mappings.push(M.normalizeMapping({ src: "midi", key: "cc:7", target: "global/master" }));
  app.params.tickFeedback(1000); app.params.tickFeedback(2000);
  assert.deepEqual(sent, [1]);
  app.S.master = 0.25; app.params.tickFeedback(3000);
  assert.deepEqual(sent, [1, 0.25]);
});

await test("el proyecto guarda los mapeos sin estado interno y los restaura", () => {
  const { app } = makeApp();
  app.S.project.settings.control.mappings.push(M.normalizeMapping({ src: "midi", key: "cc:1", target: "global/master" }));
  app.params.input(cc(1, 127));
  const json = JSON.parse(JSON.stringify(app.S.project));
  assert.ok(!JSON.stringify(json.settings.control).includes("_picked"));
  const back = M.normalizeProject(json);
  assert.equal(back.settings.control.mappings[0].key, "cc:1");
});

console.log("== Driver MIDI ==");

await test("CC de 14 bits (MSB+LSB), pitch bend, notas con velocidad 0 y program change", () => {
  const got = [];
  const d = new MidiDriver({ onInput: (e) => got.push(e) });
  const inp = { name: "Fader 14" };
  d.message(inp, [0xb0, 7, 100]); d.message(inp, [0xb0, 39, 64]);
  assert.equal(got[1].key, "cc:7"); assert.ok(got[1].hires);
  assert.ok(Math.abs(got[1].v - ((100 << 7) | 64) / 16383) < 1e-9);
  d.message(inp, [0xe1, 0, 64]);
  assert.equal(got[2].key, "pb"); assert.equal(got[2].channel, 2); assert.ok(Math.abs(got[2].v - 8192 / 16383) < 1e-9);
  d.message(inp, [0x90, 36, 0]);
  assert.equal(got[3].on, false);
  d.message(inp, [0xc0, 5]);
  assert.equal(got[4].key, "pc:5");
});

await test("MIDI Clock: 24 pulsos por negra → BPM; start/stop; MTC completo", () => {
  let bpm = 0; const tr = []; let tc = null;
  const d = new MidiDriver({ onClock: (c) => { bpm = c.bpm; }, onTransport: (t) => tr.push(t), onTimecode: (t) => { tc = t; } });
  const inp = { name: "DAW" };
  d.message(inp, [0xfa], 0);
  const tick = 60000 / (128 * 24);
  for (let i = 0; i < 60; i++) d.message(inp, [0xf8], i * tick);
  assert.ok(Math.abs(bpm - 128) < 0.5, "bpm " + bpm);
  d.message(inp, [0xfc], 0);
  assert.deepEqual(tr, ["start", "stop"]);
  // 01:02:03:04 a 25 fps
  const h = 1, m = 2, s = 3, f = 4, rate = 1;
  const parts = [f & 15, f >> 4, s & 15, s >> 4, m & 15, m >> 4, h & 15, (h >> 4) | (rate << 1)];
  parts.forEach((v, i) => d.message(inp, [0xf1, (i << 4) | v]));
  assert.deepEqual([tc.h, tc.m, tc.s, tc.f, tc.fps], [1, 2, 3, 4, 25]);
});

console.log("== Mandos de juego y varios dispositivos a la vez ==");
const { GamepadHub, basicPadMap, padKind, padControlName } = await import("../web/js/gamepad.js");

/** Mandos falsos (como los devuelve navigator.getGamepads()). */
function fakePads() {
  const mk = (index, id) => ({ index, id, connected: true, buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] });
  const pads = [mk(0, "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)"), mk(1, "DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c)")];
  Object.defineProperty(globalThis, "navigator", { value: { getGamepads: () => pads }, configurable: true, writable: true });
  const press = (p, b, on = true) => { pads[p].buttons[b] = { pressed: on, value: on ? 1 : 0 }; };
  return { pads, press };
}

await test("mandos: tipo por nombre y nombres de botones (Xbox y PlayStation)", () => {
  assert.equal(padKind("Xbox 360 Controller (XInput STANDARD GAMEPAD)"), "xbox");
  assert.equal(padKind("DualSense Wireless Controller"), "playstation");
  assert.equal(padKind("USB Gamepad"), "generic");
  assert.equal(padControlName("btn:0", "xbox"), "A");
  assert.equal(padControlName("btn:0", "playstation"), "✕");
  assert.equal(padControlName("btn:7", "playstation"), "R2");
  assert.equal(padControlName("axis:2"), "Stick der. ↔");
});

await test("dos mandos y el teclado a la vez, cada uno con su función (aprender por dispositivo)", async () => {
  const { app, calls } = makeApp();
  const P = app.params, { press } = fakePads();
  const hub = new GamepadHub((ev) => P.input(ev), { learning: () => !!P.learning });
  assert.equal(hub.list().length, 2);
  assert.deepEqual(hub.list().map(p => p.device + " " + p.kindName), ["Mando 1 Xbox", "Mando 2 PlayStation"]);
  hub.poll();   // primer estado: no dispara
  // Mando 1 · A → apagón
  let w = P.learn("global/blackout"); press(0, 0); hub.poll(); let m = await w;
  assert.equal(m.src, "gamepad"); assert.equal(m.device, "Mando 1"); assert.equal(m.key, "btn:0"); assert.equal(m.mode, "toggle");
  press(0, 0, false); hub.poll();
  // Mando 2 · A (el mismo botón, otro mando) → siguiente escena
  w = P.learn("global/next"); press(1, 0); hub.poll(); m = await w;
  assert.equal(m.device, "Mando 2");
  press(1, 0, false); hub.poll();
  // Teclado · B → reproducir / pausa
  w = P.learn("global/play"); P.input({ src: "key", key: "B", on: true, label: "B" }); m = await w;
  assert.equal(m.src, "key");
  assert.equal(app.S.project.settings.control.mappings.length, 3);
  // Ahora se usan a la vez: cada uno hace solo lo suyo.
  calls.length = 0;
  press(1, 0); hub.poll(); press(1, 0, false); hub.poll();
  assert.deepEqual(calls, ["step1"]); assert.equal(app.S.blackout, false);
  press(0, 0); hub.poll(); press(0, 0, false); hub.poll();
  assert.equal(app.S.blackout, true); assert.deepEqual(calls, ["step1", "blackout"]);
  P.input({ src: "key", key: "B", on: true }); assert.equal(app.S.playing, false);
});

await test("mandos: el stick con zona muerta; al aprender, la deriva no cuenta y un movimiento claro sí", async () => {
  const { app } = makeApp();
  const P = app.params, { pads } = fakePads();
  const hub = new GamepadHub((ev) => P.input(ev), { learning: () => !!P.learning });
  hub.poll();
  let got = null;
  const w = P.learn("global/master").then(m => { got = m; });
  pads[0].axes[2] = 0.08; hub.poll(); await Promise.resolve();
  assert.equal(got, null, "la deriva del stick no se aprende");
  pads[0].axes[2] = 0.9; hub.poll(); await w;
  assert.equal(got.key, "axis:2"); assert.equal(got.mode, "absolute");
  pads[0].axes[2] = -1; hub.poll();
  assert.ok(Math.abs(app.S.master - 0) < 1e-6);
  pads[0].axes[2] = 0.05; hub.poll();   // dentro de la zona muerta = centro
  assert.ok(Math.abs(app.S.master - 0.5) < 1e-6);
});

await test("mandos: mapa listo (A = GO, Y = apagón, RT = bajar brillo) solo para ese mando", () => {
  const { app, calls } = makeApp();
  const P = app.params, { pads, press } = fakePads();
  for (const m of basicPadMap("Mando 2")) app.S.project.settings.control.mappings.push(M.normalizeMapping(m));
  const hub = new GamepadHub((ev) => P.input(ev));
  hub.poll();
  press(0, 0); hub.poll();   // Mando 1: no tiene mapa
  assert.deepEqual(calls, []);
  press(1, 0); hub.poll();
  assert.deepEqual(calls, ["step1"]);
  press(1, 3); hub.poll(); assert.equal(app.S.blackout, true);
  pads[1].buttons[7] = { pressed: true, value: 0.75 }; hub.poll();
  assert.ok(Math.abs(app.S.master - 0.25) < 1e-6, "RT a 3/4 → brillo 25 %");
  pads[1].buttons[7] = { pressed: false, value: 0 }; hub.poll();
  assert.equal(app.S.master, 1);
});

report();
