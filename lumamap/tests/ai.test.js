// tests/ai.test.js — AI Mapping Assistant sin red: contexto, analizador, acciones,
// intérprete sin IA, plan de show, hardware y proveedores (Ollama simulado).
import { test, report } from "./harness.js";
import assert from "node:assert/strict";
const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };

const M = await import("../web/js/model.js");
const { buildProjectContext } = await import("../web/js/ai/context.js");
const { analyzeProject, nextStep } = await import("../web/js/ai/analyzer.js");
const { validateAction, applyAction, ACTION_NAMES } = await import("../web/js/ai/actions.js");
const { parseCommand } = await import("../web/js/ai/commands.js");
const { planFromRules, normalizePlan } = await import("../web/js/ai/showplan.js");
const { recommendTier, pickModel } = await import("../web/js/ai/hardware.js");
const { AIEngine, parseModelJson, MSG, DEFAULT_SETTINGS } = await import("../web/js/ai/providers.js");
const { searchKnowledge } = await import("../web/js/ai/knowledge.js");

/** App mínima: proyecto real y las acciones del editor que usan las acciones de la IA. */
function makeApp(project = M.createProject()) {
  const app = { S: { project, sel: null, pro: false }, changed() {}, commit() {}, commitSoon() {}, select(id) { app.S.sel = id; }, openTab() {}, setPro() {} };
  app.actions = {
    addShape(kind) { const s = M.SHAPES[kind].make(500, 500, 200); M.addSurface(app.S.project, s); app.S.sel = s.id; },
    addMesh() { this.addShape("rect"); },
    remove(id) { M.removeSurface(app.S.project, id); },
    addScene() { const c = M.duplicateScene(app.S.project, app.S.project.sceneId); app.S.project.sceneId = c.id; },
    applyResolution(w, h) { app.S.project.width = w; app.S.project.height = h; return `Resolución ${w}×${h}`; },
    goScene(id) { app.S.project.sceneId = id; }, stepScene() {}, setBpm() {},
  };
  return app;
}
const withSurfaces = (n) => { const app = makeApp(); for (let i = 0; i < n; i++) app.actions.addShape("rect"); return app; };

console.log("== AI Mapping Assistant ==");

await test("ProjectContext: refleja el proyecto real (superficies, contenido, máscaras, medios, escenas) sin inventar", () => {
  const app = withSurfaces(2);
  const P = app.S.project;
  P.media.push({ id: "med1", name: "fachada.mp4", kind: "video", width: 3840, height: 2160, duration: 30, size: 50e6 });
  M.lookOf(M.currentScene(P), P.surfaces[0].id).source = { ...M.DEFAULT_SOURCE(), type: "media", mediaId: "med1" };
  const ctx = buildProjectContext(app);
  assert.equal(ctx.surfaces.length, 2);
  assert.deepEqual(ctx.surfaces.map(s => s.content.kind), ["video", "calibration"]);
  assert.equal(ctx.media[0].used, true); assert.equal(ctx.scenes.length, 1);
  assert.equal(ctx.dmx.lights, 0); assert.equal(ctx.performance, null, "sin datos de rendimiento no se inventan");
});

await test("Analizador: proyecto vacío → crear superficie es el siguiente paso; 4 superficies sin máscaras → recomendación", () => {
  const empty = buildProjectContext(makeApp());
  const a = analyzeProject(empty);
  assert.equal(a.issues[0].id, "no-surfaces");
  const n = nextStep(empty, a);
  assert.equal(n.fix.action, "create_surface");
  const ctx = buildProjectContext(withSurfaces(4));
  const b = analyzeProject(ctx);
  assert.ok(b.issues.some(i => i.id === "no-masks" && /4 superficies/.test(i.title)));
  assert.ok(b.issues.some(i => i.id === "calib-content"));
  assert.ok(b.issues.some(i => i.id === "no-output"));
  for (const v of Object.values(b.scores)) assert.ok(v === null || (v >= 0 && v <= 100));
});

await test("Analizador: video 4K con salida 1080p, recurso que falta, rendimiento bajo y luces en modo práctica", () => {
  const app = withSurfaces(2), P = app.S.project, sc = M.currentScene(P);
  P.media.push({ id: "m4k", name: "grande.mp4", kind: "video", width: 3840, height: 2160 });
  sc.looks[P.surfaces[0].id].source = { ...M.DEFAULT_SOURCE(), type: "media", mediaId: "m4k" };
  sc.looks[P.surfaces[1].id].source = { ...M.DEFAULT_SOURCE(), type: "media", mediaId: "borrado" };
  app.perf = () => ({ fps: 20, refreshHz: 60, frameMs: 50, dropped: 400, seconds: 10, preview: { scale: 1 }, videos: [], outputs: [1] });
  const ids = analyzeProject(buildProjectContext(app)).issues.map(i => i.id);
  for (const id of ["big-video", "missing-media", "low-fps"]) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes("no-output"), "con una salida abierta no avisa");
  const low = analyzeProject(buildProjectContext(app)).issues.find(i => i.id === "low-fps");
  assert.deepEqual(low.fix, { action: "set_preview", parameters: { scale: 0.75 }, label: "Bajar la vista previa" });
});

await test("Acciones: lista blanca, parámetros validados, críticas marcadas y nada se ejecuta sin aplicar", async () => {
  const app = withSurfaces(1);
  assert.ok(ACTION_NAMES.length >= 25);
  assert.equal(validateAction(app, { action: "rm -rf /", parameters: {} }).ok, false);
  assert.equal(validateAction(app, { action: "eval", parameters: { code: "alert(1)" } }).ok, false);
  assert.match(validateAction(app, { action: "set_resolution", parameters: { width: 10, height: 10 } }).error, /entre 64/);
  assert.equal(validateAction(app, { action: "set_animation", parameters: { surface: "all", name: "No existe" } }).ok, false);
  const del = validateAction(app, { action: "delete_surface", parameters: {} });
  assert.equal(del.ok, true); assert.equal(del.critical, true);
  const v = validateAction(app, { action: "create_surface", parameters: { shape: "circle", name: "Columna" } });
  assert.equal(v.ok, true);
  assert.equal(app.S.project.surfaces.length, 1, "validar no ejecuta");
  await applyAction(app, v);
  assert.equal(app.S.project.surfaces.length, 2);
  assert.equal(app.S.project.surfaces[1].name, "Columna");
  const lf = validateAction(app, { action: "light_effect", parameters: { effect: "fuego" } });
  assert.equal(lf.ok, true); assert.match(lf.text, /Fuego/);
});

await test("Sin IA: las órdenes del usuario se convierten en acciones propuestas válidas", () => {
  const app = withSurfaces(1);
  const cases = [
    ["Crear una superficie", "create_surface"], ["Agrega un proyector", "open_output"],
    ["Quiero que este vídeo reaccione a la música", "enable_audio_reactive"], ["Quiero que las luces cambien con el beat", "light_effect"],
    ["Cuando levante la mano cambia el color a rojo", "create_tracking_rule"], ["añade una tira led de 30 leds", "add_light"],
    ["Muéstrame cómo calibrarlo", "start_lesson"], ["ve a la escena 1", "go_scene"], ["apagón", "blackout"],
  ];
  for (const [text, action] of cases) {
    const c = parseCommand(app, text);
    const v = c.actions.map(a => validateAction(app, a));
    assert.ok(v.some(x => x.ok && x.action === action), `${text} → ${JSON.stringify(c)}`);
  }
  assert.equal(parseCommand(app, "Crear un show de 3 minutos").intent, "show");
  assert.equal(parseCommand(app, "¿Por qué tengo baja velocidad?").intent, "diagnose");
  assert.equal(parseCommand(app, "Optimiza este proyecto").intent, "optimize");
  assert.equal(parseCommand(app, "Quiero proyectar sobre esta pared").intent, "automap");
  assert.equal(parseCommand(app, "Quiero que las luces cambien con el beat").actions[0].parameters.effect, "Estrobo al tempo");
});

await test("Show Director: 5 minutos → 6 secciones que suman 300 s, con animaciones y luces reales", () => {
  const ctx = buildProjectContext(withSurfaces(1));
  const p = planFromRules("Quiero crear un show de 5 minutos con visuales que reaccionen a la música y cambios de iluminación.", ctx);
  assert.deepEqual(p.sections.map(s => s.name), ["INTRO", "BUILD", "DROP", "BREAK", "CLIMAX", "OUTRO"]);
  assert.equal(p.sections.reduce((a, s) => a + s.seconds, 0), 300);
  assert.ok(p.sections.every(s => M.ANIM_LIBRARY.some(a => a.name === s.animation)));
  assert.ok(p.sections.filter(s => s.lights).length === 6, "pidió luces");
  assert.ok(p.sections.some(s => s.audio), "pidió música");
  const n = normalizePlan({ title: "X", bpm: 999, sections: [{ name: "intro", seconds: 20, animation: "inventada", transition: "teleport", lights: "Fuego" }] }, ctx);
  assert.equal(n.bpm, 240); assert.equal(n.sections[0].transition, "fade");
  assert.ok(M.ANIM_LIBRARY.some(a => a.name === n.sections[0].animation), "animación inventada → una real");
});

await test("Hardware: 16 GB + GPU 8 GB → qwen3:8b; básico → 4b; potente → 14b; muy justo → sin IA local", () => {
  assert.equal(recommendTier({ ramGB: 16, vramGB: 8, gpu: "NVIDIA GeForce RTX 3070" }).model, "qwen3:8b");
  assert.equal(recommendTier({ ramGB: 8, vramGB: 0, gpu: "Intel(R) UHD Graphics" }).model, "qwen3:4b");
  assert.equal(recommendTier({ ramGB: 32, vramGB: 12, gpu: "RTX 4070" }).model, "qwen3:14b");
  assert.equal(recommendTier({ ramGB: 4, vramGB: 0 }).model, null);
  const hw = { ramGB: 16, vramGB: 8, gpu: "RTX" };
  assert.equal(pickModel(["qwen3:4b", "qwen3:8b", "nomic-embed-text"], hw), "qwen3:8b");
  assert.equal(pickModel(["qwen3:14b", "qwen3:4b"], hw), "qwen3:4b", "no elige uno que no cabe");
  assert.equal(pickModel(["llama3.2:3b"], hw), "llama3.2:3b");
  assert.equal(pickModel(["qwen3:4b"], hw, "qwen3:4b"), "qwen3:4b");
});

/* ---------------- Ollama simulado ---------------- */
function fakeOllama({ running = true, models = ["qwen3:8b"], reply, status = 200, error = "", thinkError = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, body: opts.body ? JSON.parse(opts.body) : null });
    if (!running) throw new TypeError("fetch failed: ECONNREFUSED 127.0.0.1:11434");
    const ok = (o, s = 200) => ({ ok: s < 400, status: s, text: async () => JSON.stringify(o) });
    if (url.endsWith("/api/version")) return ok({ version: "0.9.0" });
    if (url.endsWith("/api/tags")) return ok({ models: models.map(name => ({ name, size: 5e9, details: { parameter_size: "8B", family: "qwen3" } })) });
    if (url.endsWith("/api/chat")) {
      const b = JSON.parse(opts.body);
      if (thinkError && "think" in b) return ok({ error: `"${b.model}" does not support thinking` }, 400);
      if (status !== 200) return ok({ error }, status);
      return ok({ message: { role: "assistant", content: typeof reply === "function" ? reply(b) : reply } });
    }
    return ok({ error: "not found" }, 404);
  };
  return { fetchImpl, calls };
}
const engineWith = (fake, settings = {}) => {
  mem.clear();
  const e = new AIEngine(withSurfaces(1), { fetchImpl: fake.fetchImpl });
  e.hw = { ramGB: 16, vramGB: 8, gpu: "RTX" };
  Object.assign(e.settings, settings);
  return e;
};

await test("Sin Ollama (o sin internet): no bloquea, mensaje claro y el asistente responde sin IA", async () => {
  const e = engineWith(fakeOllama({ running: false }));
  await e.refresh({ force: true });
  assert.equal(e.state.local.available, false);
  assert.equal(e.state.local.reason, MSG.notInstalled);
  assert.equal(e.active, e.none);
  assert.match(e.statusLine().text, /continúa funcionando/);
  const r = await e.chat("crear una superficie");
  assert.equal(r.source, "Sin IA");
  assert.ok(r.proposals.some(p => p.ok && p.action === "create_surface"));
});

await test("Ollama sin modelos / con un modelo que no está: lo dice y sigue sin IA", async () => {
  let e = engineWith(fakeOllama({ models: [] }));
  await e.refresh({ force: true });
  assert.equal(e.state.local.code, "noModels"); assert.equal(e.active, e.none);
  e = engineWith(fakeOllama({ models: ["qwen3:4b"] }), { model: "qwen3:14b" });
  await e.refresh({ force: true });
  assert.equal(e.state.local.reason, MSG.noModel("qwen3:14b"));
  assert.equal(e.active, e.none);
});

await test("Con Ollama + Qwen3: chat con el contexto del proyecto; propuestas validadas (las inventadas se rechazan)", async () => {
  const fake = fakeOllama({ reply: (b) => '<think>pensando</think>```json\n' + JSON.stringify({ reply: "Creo la superficie de la columna.", actions: [{ action: "create_surface", parameters: { shape: "rect", name: "Columna" } }, { action: "format_disk", parameters: {} }], intent: "none" }) + "\n```" });
  const e = engineWith(fake);
  await e.refresh({ force: true });
  assert.equal(e.active, e.local); assert.equal(e.state.local.model, "qwen3:8b");
  assert.match(e.statusLine().text, /IA disponible · qwen3:8b · Local/);
  const r = await e.chat("Quiero una superficie para la columna");
  assert.equal(r.reply, "Creo la superficie de la columna.");
  assert.equal(r.proposals.length, 2);
  assert.equal(r.proposals[0].ok, true); assert.equal(r.proposals[1].ok, false);
  const req = fake.calls.find(c => c.url.endsWith("/api/chat")).body;
  assert.equal(req.model, "qwen3:8b"); assert.equal(req.stream, false); assert.ok(req.format?.properties?.actions, "salida estructurada");
  assert.match(req.messages.at(-1).content, /CONTEXTO DEL PROYECTO/);
  assert.equal(e.app.S.project.surfaces.length, 1, "nada se ejecutó solo");
});

await test("Modelo que no admite «think»: se repite sin ese campo", async () => {
  const fake = fakeOllama({ thinkError: true, reply: JSON.stringify({ reply: "ok", actions: [] }) });
  const e = engineWith(fake);
  await e.refresh({ force: true });
  const r = await e.chat("hola");
  assert.equal(r.reply, "ok");
  assert.equal(fake.calls.filter(c => c.url.endsWith("/api/chat")).length, 2);
});

await test("Si el modelo falla a mitad (memoria): aviso comprensible y respuesta sin IA", async () => {
  const e = engineWith(fakeOllama({ status: 500, error: "model requires more system memory (12 GiB) than is available" }));
  await e.refresh({ force: true });
  const r = await e.chat("diseña algo bonito para la boda de mi hermana");
  assert.equal(r.source, "Sin IA");
  assert.equal(e.notice, MSG.memory);
  assert.ok(!/ECONNREFUSED|500|GiB/.test(e.notice), "sin errores técnicos");
});

await test("Plan de show con la IA local: se valida contra las bibliotecas reales", async () => {
  const e = engineWith(fakeOllama({ reply: JSON.stringify({ title: "Show", bpm: 128, sections: [{ name: "INTRO", seconds: 30, animation: "Galaxia", transition: "fade", lights: "Respirar", audio: false }, { name: "DROP", seconds: 60, animation: "Animación inventada", transition: "flash", lights: "Luz inventada", audio: true }] }) }));
  await e.refresh({ force: true });
  const p = await e.showPlan("show de 90 segundos");
  assert.equal(p.bpm, 128); assert.equal(p.seconds, 90);
  assert.equal(p.sections[0].animation, "Galaxia");
  assert.ok(M.ANIM_LIBRARY.some(a => a.name === p.sections[1].animation));
  assert.equal(p.sections[1].lights, null, "efecto de luz inventado → ninguno");
});

await test("Privacidad: IA remota desactivada por defecto; JSON robusto; guía local", async () => {
  assert.equal(DEFAULT_SETTINGS.allowRemote, false); assert.equal(DEFAULT_SETTINGS.allowImages, false); assert.equal(DEFAULT_SETTINGS.allowProjectData, false);
  const e = engineWith(fakeOllama({ running: false }), { provider: "remote" });
  await e.refresh({ force: true });
  assert.equal(e.state.remote.code, "remoteOff"); assert.equal(e.active, e.none);
  assert.deepEqual(parseModelJson('Claro: {"reply":"x","actions":[]} fin'), { reply: "x", actions: [] });
  assert.equal(searchKnowledge("¿cómo hago una máscara?")[0].id, "mascaras");
  assert.equal(searchKnowledge("conectar artnet")[0].id, "dmx-conectar");
});

await test("show con canción: la IA escucha el tempo y las partes de la canción y monta el plan", async () => {
  const { analyzeSong } = await import("../web/js/ai/songanalysis.js");
  const { planFromSong } = await import("../web/js/ai/showplan.js");
  // Canción sintética a 124 BPM: intro, subida, drop, pausa, clímax y final.
  const sr = 11025, beat = 60 / 124, bar = beat * 4;
  const parts = [["INTRO", 16, 0.15], ["BUILD", 16, 0.45], ["DROP", 16, 1], ["BREAK", 8, 0.12], ["CLIMAX", 16, 1.15], ["OUTRO", 8, 0.1]];
  const x = new Float32Array(Math.ceil(parts.reduce((a, p) => a + p[1], 0) * bar * sr));
  let t0 = 0, seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (const [, bars, amp] of parts) {
    const t1 = t0 + bars * bar;
    for (let i = Math.floor(t0 * sr); i < Math.min(x.length, t1 * sr); i++) { const ph = (i / sr - t0) % beat; x[i] = Math.sin(2 * Math.PI * 55 * ph) * Math.exp(-ph * 18) * (0.3 + amp * 0.7) + (rnd() - 0.5) * 0.25 * amp; }
    t0 = t1;
  }
  const song = analyzeSong(x, sr);
  assert.ok(Math.abs(song.bpm - 124) < 2, "BPM " + song.bpm);
  assert.deepEqual(song.sections.map(s => s.name), ["INTRO", "BUILD", "DROP", "BREAK", "CLIMAX", "OUTRO"]);
  assert.ok(Math.abs(song.sections[2].start - 32 * bar) < bar * 1.5, "el drop empieza en el compás 33");
  const plan = planFromSong(song, "prueba");
  assert.equal(plan.sections.length, 6);
  assert.ok(plan.sections.every(s => M.ANIM_LIBRARY.some(a => a.name === s.animation)), "animaciones reales de la biblioteca");
  assert.ok(plan.sections.find(s => s.name === "DROP").audio, "el drop reacciona al ritmo");
  assert.equal(parseCommand(makeApp(), "hazme un show automático con mi canción").intent, "songshow");
});

await test("IA arreglada: las órdenes claras se resuelven al instante (sin esperar al modelo) y nunca queda en blanco", async () => {
  const fake = fakeOllama({ reply: JSON.stringify({ reply: "", actions: [{ action: "borrar_disco", parameters: {} }] }) });
  const e = engineWith(fake);
  await e.refresh({ force: true });
  const n0 = fake.calls.filter(c => c.url.endsWith("/api/chat")).length;
  let r = await e.chat("busca un gif de confeti");
  assert.equal(r.source, "Al instante");
  assert.equal(r.proposals[0].action, "search_gif"); assert.equal(r.proposals[0].params.query, "confeti");
  assert.equal(fake.calls.filter(c => c.url.endsWith("/api/chat")).length, n0, "no se esperó al modelo");
  // El modelo propone algo no permitido y no hay orden clara: responde la ayuda, no un hueco.
  r = await e.chat("haz magia");
  assert.ok(r.reply.length > 20);
  assert.ok(r.proposals.every(v => !v.ok));
});

await test("IA arreglada: entiende las frases de todos los días (y las aplica)", async () => {
  const app = withSurfaces(2);
  app.S.master = 1;
  const cases = [
    ["sube el brillo", "set_brightness"], ["brillo al 40%", "set_brightness"], ["pausa", "transport"], ["reproduce", "transport"],
    ["siguiente", "go_scene"], ["vuelve a la escena anterior", "go_scene"], ["pon una animación al azar", "random_animation"],
    ["más lento", "set_speed"], ["escribe Feliz Cumpleaños", "set_text"], ["pon la webcam", "set_camera"], ["estilo ascii", "set_style"],
    ["pon el efecto glitch", "set_fx"], ["quita los efectos", "reset_fx"], ["luces rojas", "light_color"], ["apaga las luces", "lights_play"],
    ["pon un gif de fuego", "search_gif"], ["asigna el botón A del mando al apagón", "assign_control"], ["quiero usar el mando de xbox", "gamepad_map"],
    ["graba un video", "record_video"], ["pon la cuadrícula", "test_pattern"], ["pon el tempo a 128", "set_bpm"], ["fundido a negro", "blackout"],
    ["haz un holograma como el de tupac con 2 proyectores", "hologram_setup"], ["duplica la superficie", "duplicate_surface"], ["pon un lago interactivo", "interactive_experience"],
    ["haz que cambie de color con la música", "enable_audio_reactive"],
  ];
  app.S.sel = app.S.project.surfaces[0].id;
  for (const [text, action] of cases) {
    const c = parseCommand(app, text);
    const v = c.actions.map(a => validateAction(app, a));
    assert.ok(v.some(x => x.ok && x.action === action), `${text} → ${JSON.stringify(c.actions)} ${JSON.stringify(v.filter(x => !x.ok))}`);
  }
  assert.equal(parseCommand(app, "brillo al 40%").actions[0].parameters.value, 0.4);
  assert.equal(parseCommand(app, "escribe Feliz Cumpleaños").actions[0].parameters.text, "Feliz Cumpleaños", "respeta las mayúsculas");
  assert.equal(parseCommand(app, "asigna el botón A del mando al apagón").actions[0].parameters.target, "global/blackout");
  assert.equal(parseCommand(app, "asigna una tecla a la escena 2").actions[0].parameters.target, "scene/1");
  // Antes «lago» se leía como «lag» (lento) y «más lento» como un diagnóstico.
  assert.notEqual(parseCommand(app, "pon un lago interactivo").intent, "diagnose");
  assert.equal(parseCommand(app, "¿por qué va lento?").intent, "diagnose");
  for (const t of ["hola", "ayuda", "qué puedes hacer"]) { const c = parseCommand(app, t); assert.ok(c.reply.length > 30 && !c.actions.length, t); }
  const P = app.S.project, look = () => M.lookOf(M.currentScene(P), P.surfaces[0].id);
  await applyAction(app, validateAction(app, { action: "set_style", parameters: { surface: P.surfaces[0].id, style: "ascii" } }));
  assert.equal(look().fx.style, "ascii");
  await applyAction(app, validateAction(app, { action: "set_text", parameters: { surface: P.surfaces[0].id, text: "HOLA" } }));
  assert.deepEqual([look().source.type, look().source.text], ["text", "HOLA"]);
  await applyAction(app, validateAction(app, { action: "reset_fx", parameters: { surface: "all" } }));
  assert.equal(look().fx.style, M.DEFAULT_FX().style);
});

report();

