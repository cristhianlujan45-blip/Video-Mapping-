// tests/timers.test.js — encender y apagar pantallas y superficies por tiempos.
import { test, report } from "./harness.js";
import assert from "node:assert/strict";
const M = await import("../web/js/model.js");
const T = await import("../web/js/timers.js");
const { runAction } = await import("../web/js/rules.js");
const { parseCommand } = await import("../web/js/ai/commands.js");
const { validateAction, applyAction } = await import("../web/js/ai/actions.js");

console.log("== Pantallas por tiempos ==");

function makeApp() {
  const project = M.createProject();
  M.addSurface(project, M.createQuad({ name: "Pared", corners: M.rectCorners(0, 0, 960, 1080) }), { type: "gen", gen: "plasma" });
  M.addSurface(project, M.createQuad({ name: "Suelo", corners: M.rectCorners(960, 0, 960, 1080) }), { type: "gen", gen: "plasma" });
  const app = { S: { project, sel: null, tab: null }, changed() {}, commit() {}, commitSoon() {}, openTab() {}, setPro() {} };
  app.actions = { setScreenCfg: (n, patch) => Object.assign(project.settings.screens[n], patch) };
  app.timers = new T.TimerEngine(app);
  return app;
}
const scr = (app) => [1, 2, 3, 4].map(n => app.S.project.settings.screens[n].on ? 1 : 0).join("");

await test("tiempos: se escriben como 1:30, 90 o 2m y se muestran como mm:ss", () => {
  assert.equal(T.parseTime("1:30"), 90); assert.equal(T.parseTime("90"), 90); assert.equal(T.parseTime("2m"), 120);
  assert.equal(T.parseTime("1m 5s"), 65); assert.equal(T.parseTime("abc"), null); assert.equal(T.fmtTime(75), "01:15");
});

await test("pasos a mano: a los 0 s P2 OFF, a los 2 s P2 ON, a los 4 s P1 OFF; en bucle vuelve a empezar", () => {
  const app = makeApp(), c = app.S.project.settings.timers;
  c.steps = [{ id: "a", at: 0, target: "screen:2", on: false }, { id: "b", at: 2, target: "screen:2", on: true }, { id: "c", at: 4, target: "screen:1", on: false }];
  c.loop = true; c.length = 6;
  app.timers.start(0);
  assert.equal(scr(app), "1011");
  app.timers.tick(2100); assert.equal(scr(app), "1111");
  app.timers.tick(4100); assert.equal(scr(app), "0111");
  // Segunda vuelta (6 s): el paso de 0 s vuelve a ocurrir.
  app.S.project.settings.screens[1].on = true;
  app.timers.tick(6100); assert.equal(scr(app), "1011");
  assert.ok(app.timers.running);
});

await test("sin bucle se para al final; las superficies se encienden y apagan", () => {
  const app = makeApp(), P = app.S.project, c = P.settings.timers, [a, b] = P.surfaces;
  c.steps = [{ id: "1", at: 0, target: `surface:${a.id}`, on: false }, { id: "2", at: 1, target: `surface:${a.id}`, on: true }];
  c.loop = false;
  app.timers.start(0);
  assert.equal(M.lookOf(M.currentScene(P), a.id).hidden, true);
  app.timers.tick(1500); assert.equal(M.lookOf(M.currentScene(P), a.id).hidden, false);
  app.timers.tick(5000); assert.equal(app.timers.running, false);
  assert.ok(!M.lookOf(M.currentScene(P), b.id).hidden);
});

await test("plantillas: a la vez (sincronizadas), una tras otra, alternar y persecución", () => {
  const tg = ["screen:1", "screen:2", "screen:3"];
  const run = (kind, times) => {
    const app = makeApp(), c = app.S.project.settings.timers, r = T.templateSteps(kind, tg, 5);
    c.steps = r.steps; c.length = r.length; c.loop = true;
    app.timers.start(0);
    return times.map(t => { app.timers.tick(t * 1000); return scr(app).slice(0, 3); });
  };
  assert.deepEqual(run("together", [0.1, 9, 10.1]), ["111", "111", "000"]);
  assert.deepEqual(run("cascade", [0.1, 5.1, 10.1, 20.1]), ["100", "110", "111", "000"]);
  assert.deepEqual(run("chase", [0.1, 5.1, 10.1, 15.1]), ["100", "010", "001", "100"]);
  const alt = (() => { const app = makeApp(), c = app.S.project.settings.timers, r = T.templateSteps("alternate", ["screen:1", "screen:2"], 5);
    c.steps = r.steps; c.length = r.length; app.timers.start(0); const o = [scr(app).slice(0, 2)]; app.timers.tick(5100); o.push(scr(app).slice(0, 2)); app.timers.tick(10100); o.push(scr(app).slice(0, 2)); return o; })();
  assert.deepEqual(alt, ["10", "01", "10"]);
});

await test("empieza sola a la hora indicada (instalaciones) y el proyecto lo guarda", () => {
  const app = makeApp(), c = app.S.project.settings.timers;
  c.steps = [{ id: "x", at: 0, target: "screen:3", on: false }]; c.startAt = "20:30";
  app.timers.tick(0, new Date(2026, 0, 1, 20, 29)); assert.equal(app.timers.running, false);
  app.timers.tick(10, new Date(2026, 0, 1, 20, 30)); assert.equal(app.timers.running, true);
  assert.equal(app.S.project.settings.screens[3].on, false);
  const n = M.normalizeProject(JSON.parse(JSON.stringify(app.S.project)));
  assert.equal(n.settings.timers.startAt, "20:30"); assert.equal(n.settings.timers.steps.length, 1);
  assert.deepEqual(M.normalizeProject({ ...JSON.parse(JSON.stringify(app.S.project)), settings: { timers: { steps: [{ at: "x" }], startAt: "99" } } }).settings.timers, { ...M.defaultTimers() });
});

await test("reglas: «al entrar alguien → enciende la Pantalla 2» y «poner un video»", () => {
  const app = makeApp(), P = app.S.project;
  P.settings.screens[2].on = false;
  runAction(app, { type: "screen", target: "screen:2", on: true });
  assert.equal(P.settings.screens[2].on, true);
  runAction(app, { type: "screen", target: "screen:2", on: "toggle" });
  assert.equal(P.settings.screens[2].on, false);
  P.media.push({ id: "m1", name: "intro.mp4", kind: "video" });
  let restarted = null; app.actions.restartMedia = (id) => { restarted = id; };
  runAction(app, { type: "video", mediaId: "m1", surface: "all" });
  assert.equal(restarted, "m1");
  assert.ok(P.surfaces.every(s => M.lookOf(M.currentScene(P), s.id).source.mediaId === "m1"));
});

await test("IA sin conexión: entiende las órdenes de pantallas y las propone validadas", async () => {
  const app = makeApp();
  const r1 = parseCommand(app, "Apaga la pantalla 2");
  assert.deepEqual(r1.actions, [{ action: "screen_power", parameters: { screen: "2", on: false } }]);
  const r2 = parseCommand(app, "que las pantallas se enciendan una tras otra cada 10 segundos");
  assert.deepEqual(r2.actions[0], { action: "screen_timer", parameters: { template: "cascade", every: 10, who: "screens" } });
  assert.equal(parseCommand(app, "sincroniza las pantallas").actions[0].parameters.template, "together");
  const r3 = parseCommand(app, "cuando alguien entre enciende la pantalla 3");
  assert.equal(r3.actions[0].parameters.then.type, "screen");
  const v = validateAction(app, r2.actions[0]);
  assert.ok(v.ok, v.error);
  await applyAction(app, v);
  assert.ok(app.timers.running); assert.ok(app.S.project.settings.timers.steps.length >= 4);
  assert.equal(validateAction(app, { action: "screen_power", parameters: { screen: "9" } }).ok, false, "pantalla inexistente");
});

report();
