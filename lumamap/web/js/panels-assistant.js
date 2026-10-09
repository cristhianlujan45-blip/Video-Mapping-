// web/js/panels-assistant.js
// 🧠 AI MAPPING ASSISTANT (pestaña «Asistente», también en el modo simple).
// No es un chat: es una capa de ayuda encima de la app. Arriba el estado de la
// IA, luego «¿Qué quieres hacer?» con 8 accesos, las acciones sugeridas por el
// analizador y, en segundo plano, el campo para escribir. Todo lo que propone la
// IA son acciones de la lista blanca con [Aplicar] [Cancelar].
// Sin IA (sin Ollama, sin internet…) todo sigue funcionando con reglas.
import { h, section, row, btn, slider, toggle, hint, toast, dialog, closeDialog, confirmDlg } from "./ui.js";
import { AIEngine, MSG } from "./ai/providers.js";
import { validateAction, applyAction } from "./ai/actions.js";
import { AREAS, analyzeProject } from "./ai/analyzer.js";
import { Academy, LEVELS } from "./ai/academy.js";
import { planChanges, applyPlan, planFromSong } from "./ai/showplan.js";
import { analyzeFile } from "./ai/songanalysis.js";
import { MODEL_TIERS, ADVANCED_MODELS } from "./ai/hardware.js";
import { searchKnowledge } from "./ai/knowledge.js";
import { HELP } from "./ai/commands.js";

const ui = { log: [], busy: false, card: null, brief: "" };
const LOG_KEY = "lumamap:ai-log";

/** Motor y academia (uno por app). */
export function aiOf(app) {
  if (!app.ai) {
    app.ai = new AIEngine(app);
    app.academy = new Academy(app);
    app.academy.onChange = () => { paintAcademy(app); if (app.S.tab === "assistant") app.renderPanel(); };
    if (app.ai.settings.saveConversations) { try { ui.log = JSON.parse(localStorage.getItem(LOG_KEY) || "[]"); } catch {} }
  }
  return app.ai;
}
function remember(app) {
  if (!app.ai.settings.saveConversations) return;
  try { localStorage.setItem(LOG_KEY, JSON.stringify(ui.log.slice(-40).map(m => ({ who: m.who, text: m.text })))); } catch {}
}

/* ---------------- Aplicar acciones (siempre con el usuario) ---------------- */
async function applyProposal(app, v, card) {
  if (!v.ok) return;
  if (v.critical && !(await confirmDlg("Confirmar cambio", v.text + ". ¿Aplicar?", "Aplicar", "danger"))) return;
  try {
    const res = await applyAction(app, v);
    toast("✓ " + res);
    if (card) { card.classList.add("done"); card.querySelector(".pbtns")?.replaceChildren(h("span", { class: "ok" }, "✓ " + res)); }
  } catch (e) { toast(e.message, "err"); }
}
/** Ejecuta un «arreglo» del analizador: acción, pestaña o lección. */
export async function runFix(app, fix) {
  if (!fix) return;
  if (fix.action) {
    const v = validateAction(app, { action: fix.action, parameters: fix.parameters || {} });
    if (!v.ok) return toast(v.error, "err");
    return applyProposal(app, v);
  }
  if (fix.surface) app.select(fix.surface);
  if (fix.tab) { if (["show", "3d", "tracking", "control", "perf"].includes(fix.tab)) app.setPro(true); if (app.S.tab !== fix.tab) app.openTab(fix.tab); }
  if (fix.lesson) { aiOf(app); app.academy.start(fix.lesson); }
}
function proposalCard(app, v) {
  const card = h("div", { class: `prop ${v.ok ? "" : "bad"} ${v.critical ? "crit" : ""}` },
    h("span", { class: "ptext" }, v.ok ? v.text : `No se puede: ${v.error}`),
    v.critical ? h("small", { class: "pcrit" }, "Cambio importante: se pedirá confirmación") : null);
  if (v.ok) card.append(h("div", { class: "pbtns" },
    btn({ label: "Aplicar", kind: "primary small", onClick: () => applyProposal(app, v, card) }),
    btn({ label: "Cancelar", kind: "small", onClick: () => { card.classList.add("done"); card.querySelector(".pbtns").replaceChildren(h("span", {}, "Cancelado")); } })));
  return card;
}

/* ---------------- Conversación ---------------- */
async function send(app, text, redraw) {
  text = String(text || "").trim();
  if (!text || ui.busy) return;
  const ai = aiOf(app);
  ui.busy = true; ui.log.push({ who: "user", text }); redraw();
  try {
    const history = ui.log.filter(m => m.who === "user" || m.who === "ai").slice(-6).map(m => ({ role: m.who === "user" ? "user" : "assistant", content: m.text }));
    const r = await ai.chat(text, history.slice(0, -1));
    if (r.reply) ui.log.push({ who: "ai", text: r.reply, src: r.source });
    if (r.proposals?.length) ui.log.push({ who: "props", props: r.proposals });
    if (ai.notice) ui.log.push({ who: "notice", text: ai.notice });
    if (r.intent) await runIntent(app, r.intent, text);
    if (!r.reply && !r.proposals?.length && !r.intent) ui.log.push({ who: "ai", text: HELP });
  } catch (e) { ui.log.push({ who: "notice", text: MSG.generic }); console.warn(e); }
  finally { ui.busy = false; if (ui.log.length > 80) ui.log.splice(0, ui.log.length - 80); remember(app); redraw(); }
}
async function runIntent(app, intent, text = "") {
  const ai = aiOf(app);
  if (intent === "show") { ui.brief = text; await makeShow(app, text); }
  else if (intent === "songshow") ui.card = { kind: "song-start" };
  else if (intent === "diagnose") ui.card = { kind: "health", data: await ai.diagnose(text) };
  else if (intent === "optimize") ui.card = { kind: "health", data: await ai.optimize(), title: "Optimizar el proyecto" };
  else if (intent === "automap") ui.card = { kind: "automap-start" };
  app.renderPanel();
}
async function makeShow(app, text) {
  const plan = await aiOf(app).showPlan(text || "Show de 3 minutos que reaccione a la música con cambios de luces");
  ui.card = { kind: "show", data: plan };
}

/* ---------------- Tarjetas de resultado ---------------- */
function healthCard(app, data, title = "Salud del proyecto") {
  const sc = data.scores, color = (v) => v >= 85 ? "ok" : v >= 60 ? "warn" : "bad";
  const wrap = h("div", { class: "aicard" }, h("div", { class: "row" }, h("b", {}, title), h("span", { class: "grow" }),
    h("span", { class: `score big ${color(sc.total)}` }, `${sc.total}/100`)));
  wrap.append(h("div", { class: "scores" }, ...AREAS.filter(([k]) => sc[k] !== null).map(([k, label]) =>
    h("div", { class: "sc" }, h("small", {}, label), h("i", {}, h("b", { class: color(sc[k]), style: { width: sc[k] + "%" } })), h("span", {}, String(sc[k]))))));
  if (!data.issues.length) wrap.append(hint("Sin problemas detectados."));
  for (const it of data.issues.slice(0, 8)) wrap.append(h("div", { class: `issue ${it.level}` },
    h("b", {}, (it.level === "error" ? "⛔ " : it.level === "warn" ? "⚠️ " : "ℹ️ ") + it.title), h("small", {}, it.text),
    it.fix ? btn({ label: it.fix.label || "Arreglar", kind: "small", onClick: () => runFix(app, it.fix) }) : null));
  return wrap;
}
function showCard(app, plan) {
  const wrap = h("div", { class: "aicard" }, h("b", {}, "🎬 " + plan.title), h("small", { class: "dim" }, ` · plan por ${plan.source}`));
  const tb = h("div", { class: "plan" });
  for (const s of plan.sections) tb.append(h("div", { class: "psec" },
    h("b", {}, s.name), h("span", {}, `${Math.floor(s.seconds / 60)}:${String(s.seconds % 60).padStart(2, "0")} · ${s.bars} compases`),
    h("small", {}, `${s.animation} · transición ${s.transition}${s.lights ? " · luces: " + s.lights : ""}${s.audio ? " · ♪ audio" : ""}`)));
  wrap.append(tb, h("p", { class: "hint" }, "Al aplicar:"), h("ul", { class: "changes" }, ...planChanges(plan).map(c => h("li", {}, c))),
    row(btn({ label: "Aplicar plan", kind: "primary", onClick: async () => {
      if (!(await confirmDlg("Aplicar el plan de show", planChanges(plan).join(". ") + ".", "Aplicar", "primary"))) return;
      toast(applyPlan(app, plan)); ui.card = null; app.renderPanel();
    } }), btn({ label: "Cancelar", onClick: () => { ui.card = null; app.renderPanel(); } })));
  return wrap;
}

/* ---------------- Show automático con una canción ---------------- */
function pickSong(app) {
  const input = h("input", { type: "file", accept: "audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac" });
  input.addEventListener("change", async () => {
    const f = input.files[0];
    if (!f) return;
    ui.card = { kind: "song-busy", name: f.name }; app.renderPanel();
    try {
      const song = await analyzeFile(f);
      app.actions.loadSong(f);
      const plan = planFromSong(song, f.name.replace(/\.[^.]+$/, ""), { lights: (app.dmx?.lights() || []).length > 0 });
      ui.card = { kind: "song", data: plan, song };
    } catch (e) { ui.card = null; toast("No se pudo leer la canción: " + (e.message || e), "err"); }
    app.renderPanel();
  });
  input.click();
}
function songCard(app, plan, song) {
  const fmt = (v) => `${Math.floor(v / 60)}:${String(Math.round(v % 60)).padStart(2, "0")}`;
  const COL = { INTRO: "#5a6cff", BUILD: "#ffb000", DROP: "#ff2d55", BREAK: "#34c759", CLIMAX: "#ff00aa", OUTRO: "#8e9ab0" };
  // Línea de tiempo de la canción: cada parte con su color y su energía.
  const bar = h("div", { class: "songbar" }, ...plan.sections.map(s => h("i", { title: `${s.name} ${fmt(s.start)}`, style: { flex: String(s.seconds), background: COL[s.name] || "#666", opacity: String(0.45 + s.energy * 0.55) } }, h("b", {}, s.name))));
  const wrap = h("div", { class: "aicard" }, h("b", {}, "🎵 " + plan.title), h("small", { class: "dim" }, ` · ${fmt(song.duration)} · ${plan.sections.length} partes`), bar);
  const tb = h("div", { class: "plan" });
  for (const s of plan.sections) tb.append(h("div", { class: "psec" }, h("b", {}, s.name), h("span", {}, `${fmt(s.start)} → ${fmt(s.start + s.seconds)}`),
    h("small", {}, `${s.animation} · ${s.transition}${s.lights ? " · luces: " + s.lights : ""}${s.audio ? " · ♪ reacciona al ritmo" : ""}`)));
  wrap.append(tb, hint("Al aplicar se crean las escenas (las tuyas no se tocan) y empieza la canción: cada escena entra en su segundo exacto y todo sigue el ritmo."),
    row(btn({ label: "Aplicar y reproducir", ic: "play", kind: "primary", onClick: () => {
      const P = app.S.project, first = P.scenes.length;
      toast(applyPlan(app, plan));
      const ids = P.scenes.slice(first).map(x => x.id);
      app.actions.playSongShow(ids, plan.sections.map(x => x.start));
      ui.card = { kind: "song-playing" }; app.renderPanel();
    } }), btn({ label: "Otra canción", onClick: () => pickSong(app) }), btn({ label: "Cancelar", onClick: () => { app.actions.stopSong(); ui.card = null; app.renderPanel(); } })));
  return wrap;
}

/* ---------------- Auto Map ---------------- */
const MAXW = 480;
function imageDataOf(src, w0, h0) {
  const k = Math.min(1, MAXW / Math.max(w0, h0)), w = Math.max(16, Math.round(w0 * k)), hh = Math.max(16, Math.round(h0 * k));
  const c = document.createElement("canvas"); c.width = w; c.height = hh;
  const ctx = c.getContext("2d", { willReadFrequently: true }); ctx.drawImage(src, 0, 0, w, hh);
  return ctx.getImageData(0, 0, w, hh);
}
async function autoMapFrom(app, kind) {
  let img;
  try {
    if (kind === "camera") {
      const { getCamera } = await import("./sources.js");
      const cam = await getCamera(app.S.project.settings.interactive?.camId || "default");
      const v = cam.el;
      for (let i = 0; i < 30 && !v.videoWidth; i++) await new Promise(r => setTimeout(r, 100));
      img = imageDataOf(v, v.videoWidth, v.videoHeight);
    } else {
      const [file] = await app.pickFiles("#filePhoto");
      if (!file) return;
      const bmp = await createImageBitmap(file);
      img = imageDataOf(bmp, bmp.width, bmp.height); bmp.close?.();
    }
  } catch (e) { return toast("No se pudo leer la imagen: " + (e.message || e), "err"); }
  toast("Analizando la imagen…");
  const res = await aiOf(app).vision(img);
  app.S.autoMap = res.surfaces;
  ui.card = { kind: "automap", data: res };
  app.changed(); app.renderPanel();
}
function applyAutoMap(app, edit) {
  const P = app.S.project, list = app.S.autoMap || [];
  import("./model.js").then(M => {
    let first = null;
    list.forEach((s, i) => {
      const q = M.createQuad({ name: `${s.label || "Detectada"} ${i + 1}`, corners: s.points.map(([x, y]) => [x * P.width, y * P.height]) });
      M.addSurface(P, q, { type: "gen", gen: "calib" });
      first = first || q.id;
    });
    app.S.autoMap = null; ui.card = null;
    if (first) app.select(first);
    app.changed({ panel: true }); app.commit();
    if (edit) app.openTab("shape");
    toast(`${list.length} superficie(s) creadas · corrige las esquinas si hace falta`);
  });
}
function autoMapCard(app, res) {
  const n = res.surfaces.length;
  return h("div", { class: "aicard" }, h("b", {}, n ? `Detecté ${n} superficie${n > 1 ? "s" : ""}.` : "No encontré superficies claras."),
    h("small", { class: "dim" }, ` · ${res.source}`),
    hint(n ? "Se ven punteadas en el escenario. Aplícalas y luego ajusta las esquinas a mano si hace falta." : "Prueba con otra foto con buen contraste, tomada desde donde está el proyector."),
    row(n ? btn({ label: "Aplicar", kind: "primary", onClick: () => applyAutoMap(app, false) }) : null,
      n ? btn({ label: "Editar", onClick: () => applyAutoMap(app, true) }) : null,
      btn({ label: "Cancelar", onClick: () => { app.S.autoMap = null; ui.card = null; app.changed(); app.renderPanel(); } })));
}

/* ---------------- Academia ---------------- */
function academyList(app) {
  const A = app.academy;
  return h("div", { class: "aicard" }, h("b", {}, "🎓 Academia de video mapping"), hint("Lecciones paso a paso: el asistente te dice una cosa y espera a que la hagas."),
    h("div", { class: "lessons" }, ...LEVELS.map(L => h("button", { class: `lesson ${A.done.has(L.level) ? "done" : ""}`, onclick: () => { A.start(L.level); ui.card = null; app.renderPanel(); } },
      h("b", {}, `${A.done.has(L.level) ? "✓" : L.level}`), h("span", {}, L.title), h("small", {}, `${L.steps.length} pasos`)))));
}
/** Tarjeta flotante del paso actual (encima del escenario, pequeña). */
function paintAcademy(app) {
  let el = document.getElementById("academyCard");
  const A = app.academy, L = A?.level, st = A?.step;
  if (!st) {
    el?.remove();
    if (A?.finished) { toast(`🎓 ¡Lección ${A.finished} completada!`); A.finished = 0; }
    return;
  }
  if (!el) { el = h("div", { id: "academyCard", class: "academy" }); document.getElementById("stage")?.append(el); }
  el.replaceChildren(
    h("small", {}, `Academia · Nivel ${L.level}: ${L.title}`),
    h("b", {}, `PASO ${A.cur.i + 1}/${L.steps.length}`),
    h("p", {}, st.text),
    h("div", { class: "row" }, btn({ label: "Saltar paso", kind: "small", onClick: () => A.next() }), btn({ label: "Salir", kind: "small", onClick: () => A.stop() })));
}

/* ---------------- Ajustes: Inteligencia / IA ---------------- */
export async function aiSettings(app) {
  const ai = aiOf(app), s = { ...ai.settings };
  await ai.refresh({ force: true });
  const hw = ai.hw || {}, tier = ai.recommended(), st = ai.state;
  const models = st.local?.models || [];
  const modelSel = h("select", { class: "text-in" }, h("option", { value: "" }, "Automático (el recomendado que tengas)"),
    ...models.map(m => h("option", { value: m.name, selected: m.name === s.model }, `${m.name}${m.params ? " · " + m.params : ""}`)));
  modelSel.addEventListener("change", () => { s.model = modelSel.value; });
  const ep = h("input", { class: "text-in", value: s.endpoint }); ep.addEventListener("change", () => { s.endpoint = ep.value.trim() || "http://localhost:11434"; });
  const provSel = h("select", { class: "text-in" }, ...[["auto", "Automático (local → remota → sin IA)"], ["local", "Solo IA local (Ollama)"], ["remote", "Solo IA remota (Claude)"], ["none", "Sin IA (reglas y guía)"]].map(([v, l]) => h("option", { value: v, selected: v === s.provider }, l)));
  provSel.addEventListener("change", () => { s.provider = provSel.value; });
  const T = (label, k, hintText) => toggle({ label, hint: hintText, value: !!s[k], onChange: (v) => { s[k] = v; } });
  const localTxt = st.local?.available ? `✓ Ollama ${st.local.version || ""} en marcha · ${models.length} modelo(s) · se usará ${st.local.model}` : `✗ ${st.local?.reason || MSG.notInstalled}`;
  const content = h("div", { class: "aiset" },
    h("h4", { class: "res-group" }, "Diagnóstico del equipo"),
    h("div", { class: "perf" }, ...[["Sistema", hw.os || "—"], ["CPU", hw.cpu ? `${hw.cpu} · ${hw.cores} núcleos` : `${hw.cores || "?"} núcleos`], ["RAM", hw.ramGB ? hw.ramGB + " GB" + (hw.exact ? "" : " (aprox.)") : "desconocida"],
      ["GPU", hw.gpu || "desconocida"], ["VRAM", hw.vramGB ? hw.vramGB + " GB" : "desconocida"], ["Modo recomendado", `${tier.label}${tier.model ? " · " + tier.model + " (" + tier.size + ")" : ""}`]].map(([k, v]) => h("div", { class: "pc" }, h("small", {}, k), h("b", {}, v)))),
    hint(tier.note + " Si el modelo no puede ejecutarse, LumaMap sigue funcionando sin IA."),
    h("h4", { class: "res-group" }, "IA local (Ollama) · gratis y sin internet"),
    h("p", { class: `lstate ${st.local?.available ? "ok" : "warn"}` }, h("i"), localTxt),
    st.local?.available ? null : h("ol", { class: "steps" },
      h("li", {}, "Descarga e instala Ollama desde ollama.com (Windows, macOS o Linux)."),
      h("li", {}, h("span", {}, "Abre una terminal y escribe: "), h("code", {}, `ollama pull ${tier.model || "qwen3:4b"}`)),
      globalThis.LumaNative ? h("li", {}, "En Android: Ollama va en un PC de tu misma red Wi-Fi. En ese PC permite conexiones de la red (variable OLLAMA_HOST=0.0.0.0) y abajo, en «Dirección de Ollama», escribe http://IP-del-PC:11434.") : null,
      h("li", {}, "Vuelve aquí y pulsa «Comprobar de nuevo». No hace falta reiniciar LumaMap.")),
    row(btn({ label: "Comprobar de nuevo", ic: "restart", kind: "small", onClick: async () => { ai.setSettings({ endpoint: s.endpoint }); closeDialog(); aiSettings(app); } }),
      btn({ label: "Copiar comando", kind: "small", onClick: () => { navigator.clipboard?.writeText(`ollama pull ${tier.model || "qwen3:4b"}`); toast("Comando copiado"); } })),
    h("label", { class: "field" }, h("span", { class: "lab" }, "Modelo"), modelSel),
    hint(`Recomendados: ${MODEL_TIERS.filter(t => t.model).map(t => `${t.model} (${t.label.toLowerCase()})`).join(", ")}. Avanzado: ${ADVANCED_MODELS.map(m => m.model + " — " + m.note).join(" ")}`),
    h("label", { class: "field" }, h("span", { class: "lab" }, "Dirección de Ollama"), ep),
    slider({ label: "Temperatura (creatividad)", min: 0, max: 1, step: 0.05, value: s.temperature, def: 0.3, fmt: (v) => v.toFixed(2), onInput: (v) => { s.temperature = v; } }),
    slider({ label: "Tamaño de contexto", min: 2048, max: 32768, step: 1024, value: s.contextSize, def: 8192, fmt: (v) => Math.round(v / 1024) + "K", onInput: (v) => { s.contextSize = Math.round(v); } }),
    h("h4", { class: "res-group" }, "General"),
    T("IA activada", "enabled", "Desactívala y el asistente funciona solo con reglas y la guía"),
    h("label", { class: "field" }, h("span", { class: "lab" }, "Proveedor"), provSel),
    T("Sugerencias automáticas", "autoSuggestions"), T("Visión (analizar imágenes con IA)", "vision", "Necesita un modelo de visión en Ollama, p. ej. qwen2.5vl"),
    h("h4", { class: "res-group" }, "Privacidad"),
    T("Permitir IA local", "allowLocal", "Solo habla con este equipo o tu red local"),
    T("Permitir IA remota", "allowRemote", "Claude por internet (desactivada por defecto)"),
    T("Permitir análisis de imágenes", "allowImages"),
    T("Permitir enviar datos del proyecto a la IA remota", "allowProjectData", "Nombres de superficies, medios y escenas"),
    T("Guardar conversaciones en este equipo", "saveConversations"),
    globalThis.LumaDesktop?.ai ? btn({ label: "Clave de la IA remota (Claude)…", kind: "small", onClick: () => configureKey(app) }) : hint(globalThis.LumaNative ? "La IA remota (Claude) solo está en la app de Windows: en Android no se puede usar." : "La IA remota está en la app de escritorio."));
  const ok = await dialog({ title: "Inteligencia / IA", content, wide: true, buttons: [{ label: "Cancelar", value: false }, { label: "Guardar", kind: "primary", value: true }] });
  if (!ok) return;
  ai.setSettings(s);
  await ai.refresh({ force: true });
  app.renderPanel();
  toast(ai.statusLine().text);
}
async function configureKey(app) {
  const input = h("input", { type: "password", class: "text-in", placeholder: "sk-ant-…", autocomplete: "off" });
  setTimeout(() => input.focus(), 50);
  const r = await dialog({ title: "Clave de la API de Claude", content: h("div", {}, hint("Se guarda cifrada en este equipo y solo la usa la app de escritorio. El uso se cobra en tu cuenta de la API. Si Claude no puede responder una petición, la API la reintenta sola con un modelo alternativo."), input),
    buttons: [{ label: "Quitar clave", value: "remove" }, { label: "Cancelar", value: null }, { label: "Guardar", kind: "primary", value: () => input.value }] });
  if (r === null || r === undefined) return;
  const res = await globalThis.LumaDesktop.ai.setKey(r === "remove" ? "" : r);
  toast(res.ok ? (res.removed ? "Clave quitada" : "Clave comprobada y guardada") : res.error, res.ok ? "" : "err");
  await aiOf(app).refresh({ force: true });
}

/* ---------------- ¿Qué hago ahora? ---------------- */
export async function whatNow(app) {
  const ai = aiOf(app);
  const n = ai.next();
  const r = await dialog({ title: "🧠 ¿Qué hago ahora?", content: h("div", { class: "nextstep" }, h("b", {}, n.title), h("p", {}, n.text)),
    buttons: [{ label: "Ver diagnóstico", value: "diag" }, { label: "Cerrar", value: null }, ...(n.fix ? [{ label: "Hacerlo conmigo", kind: "primary", value: "do" }] : [])] });
  if (r === "do") runFix(app, n.fix);
  if (r === "diag") { ui.card = { kind: "health", data: await ai.analyze() }; if (app.S.tab !== "assistant") app.openTab("assistant"); else app.renderPanel(); }
}

/* ---------------- Panel ---------------- */
const QUICK = [
  ["Crear Mapping", "plus", (app) => { if (!app.S.project.surfaces.length) app.academy.start(1); else app.openTab("add"); }],
  ["Configurar Proyector", "project", (app) => { ui.log.push({ who: "ai", text: searchKnowledge("salida proyector", 1)[0]?.text || "" }, { who: "props", props: [validateAction(app, { action: "open_output", parameters: { screen: 1 } })] }); app.renderPanel(); }],
  ["Analizar Superficie", "photo", (app) => { ui.card = { kind: "automap-start" }; app.renderPanel(); }],
  ["Detectar Problemas", "info", async (app) => { ui.card = { kind: "health", data: await app.ai.analyze() }; app.renderPanel(); }],
  ["Aprender Mapping", "help", (app) => { ui.card = { kind: "academy" }; app.renderPanel(); }],
  ["Optimizar Proyecto", "gauge", async (app) => { ui.card = { kind: "health", data: await app.ai.optimize(), title: "Optimizar el proyecto" }; app.renderPanel(); }],
  ["Show con mi canción", "audio", (app) => pickSong(app)],
  ["Crear Show", "scenes", (app) => { ui.card = { kind: "show-start" }; app.renderPanel(); }],
  ["Preguntar a la IA", "ai", () => document.querySelector(".asst-in")?.focus()],
];

const assistantPanel = {
  title: () => "🧠 AI Mapping Assistant",
  render(app) {
    const ai = aiOf(app);
    if (!ai.state.checkedAt) ai.refresh().then(() => { if (app.S.tab === "assistant") app.renderPanel(); });
    const wrap = h("div", { class: "asst" });
    const stl = ai.statusLine();
    wrap.append(h("div", { class: "aistatus" },
      h("p", { class: `lstate ${stl.ok ? "ok" : "warn"}` }, h("i"), h("span", {}, stl.ok ? "IA disponible" : stl.mode),
        h("small", {}, stl.ok ? ` · Modelo: ${stl.model} · Modo: ${stl.mode} · Contexto: proyecto actual` : " · LumaMap funciona normal")),
      btn({ ic: "knob", kind: "icon", title: "Inteligencia / IA (ajustes)", onClick: () => aiSettings(app) })));
    // Primera vez sin IA local: aviso amable, nunca bloquea.
    if (!stl.ok && ai.state.local?.code === "notInstalled" && !ai.settings.setupDismissed && ai.settings.allowLocal) {
      wrap.append(h("div", { class: "aicard soft" }, h("p", {}, "Puedes utilizar LumaMap normalmente. Si deseas activar IA local: instala Ollama (gratis)."),
        row(btn({ label: "Configurar IA", kind: "primary small", onClick: () => aiSettings(app) }), btn({ label: "Ahora no", kind: "small", onClick: () => { ai.setSettings({ setupDismissed: true }); app.renderPanel(); } }))));
    } else if (!stl.ok && stl.why && ai.settings.allowLocal && ai.state.local?.code !== "notInstalled" && ai.state.local?.code !== "off") {
      wrap.append(h("div", { class: "aicard soft" }, h("p", {}, stl.why), row(btn({ label: "Reintentar", kind: "small", onClick: async () => { await ai.refresh({ force: true }); app.renderPanel(); } }), btn({ label: "Configuración", kind: "small", onClick: () => aiSettings(app) }))));
    }

    wrap.append(h("h3", { class: "sub" }, "¿Qué quieres hacer?"),
      h("div", { class: "aiquick" }, ...QUICK.map(([label, ic, fn]) => { const b = btn({ label, ic, kind: "tile", onClick: () => fn(app) }); return b; })));

    // Tarjeta de resultado (diagnóstico, show, auto map, academia).
    const c = ui.card;
    if (c?.kind === "health") wrap.append(healthCard(app, c.data, c.title));
    if (c?.kind === "show") wrap.append(showCard(app, c.data));
    if (c?.kind === "song") wrap.append(songCard(app, c.data, c.song));
    if (c?.kind === "song-start") wrap.append(h("div", { class: "aicard" }, h("b", {}, "🎵 Show automático con tu canción"),
      hint("Elige una canción (mp3, wav, m4a…). La IA escucha el tempo y sus partes (intro, subida, drop…) y monta el show sola."),
      row(btn({ label: "Elegir canción", ic: "audio", kind: "primary", onClick: () => pickSong(app) }), btn({ label: "Cancelar", onClick: () => { ui.card = null; app.renderPanel(); } }))));
    if (c?.kind === "song-busy") wrap.append(h("div", { class: "aicard" }, h("b", {}, "🎵 Escuchando «" + c.name + "»…"), hint("Detectando el tempo y las partes de la canción.")));
    if (c?.kind === "song-playing") { const st = app.actions.songState(); wrap.append(h("div", { class: "aicard" }, h("b", {}, st ? `🎵 Sonando «${st.name}»` : "🎵 Show terminado"),
      row(btn({ label: "Parar la canción", ic: "stop", onClick: () => { app.actions.stopSong(); ui.card = null; app.renderPanel(); } })))); }
    if (c?.kind === "automap") wrap.append(autoMapCard(app, c.data));
    if (c?.kind === "academy") wrap.append(academyList(app));
    if (c?.kind === "automap-start") wrap.append(h("div", { class: "aicard" }, h("b", {}, "Analizar superficie"),
      hint("Perfecto. Primero vamos a detectar la superficie: elige una foto de la pared (mejor desde donde está el proyector) o usa la cámara."),
      row(btn({ label: "Elegir foto", ic: "photo", kind: "primary", onClick: () => autoMapFrom(app, "file") }), btn({ label: "Usar la cámara", ic: "camera", onClick: () => autoMapFrom(app, "camera") }),
        btn({ label: "Cancelar", onClick: () => { ui.card = null; app.renderPanel(); } }))));
    if (c?.kind === "show-start") {
      const ta = h("textarea", { class: "text-in", rows: 3 }); ta.value = ui.brief || "Quiero un show de 5 minutos con visuales que reaccionen a la música y cambios de iluminación.";
      ta.addEventListener("keydown", (e) => e.stopPropagation());
      wrap.append(h("div", { class: "aicard" }, h("b", {}, "🎬 AI Show Director"), hint("Describe el show. Primero verás el plan; nada cambia hasta que lo apliques."), ta,
        row(btn({ label: "Generar plan", kind: "primary", onClick: async (e) => { e.currentTarget.disabled = true; ui.brief = ta.value; await makeShow(app, ta.value); app.renderPanel(); } }),
          btn({ label: "Cancelar", onClick: () => { ui.card = null; app.renderPanel(); } }))));
    }

    // Acciones sugeridas (analizador, sin IA): solo las 3 más importantes.
    if (ai.settings.autoSuggestions && !c) {
      const sug = suggestions(app);
      if (sug.length) wrap.append(h("h3", { class: "sub" }, "Acciones sugeridas"), h("div", { class: "list" }, ...sug.map(it => h("div", { class: "item" },
        h("span", {}, it.title), it.fix ? btn({ label: it.fix.label || "Hacer", kind: "small", onClick: () => runFix(app, it.fix) }) : null))));
    }

    // Conversación (secundaria).
    const log = h("div", { class: "asst-log" });
    for (const m of ui.log.slice(-30)) {
      if (m.who === "props") log.append(h("div", { class: "props" }, ...m.props.map(v => proposalCard(app, v))));
      else log.append(h("div", { class: "asst-msg " + m.who }, m.text, m.src ? h("small", { class: "src" }, " · " + m.src) : null));
    }
    if (ui.busy) log.append(h("div", { class: "asst-msg busy" }, "Pensando…"));
    const input = h("textarea", { class: "text-in asst-in", rows: 2, placeholder: "Escribe lo que quieres hacer…" });
    const redraw = () => { if (app.S.tab === "assistant") app.renderPanel(); };
    const go = () => { const t = input.value; input.value = ""; send(app, t, redraw); };
    input.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); go(); } });
    wrap.append(h("h3", { class: "sub" }, "Preguntar"), ui.log.length ? log : hint("Ejemplos: «crear una superficie», «¿por qué tengo baja velocidad?», «quiero que las luces cambien con el beat», «cuando levante la mano cambia el color a rojo»."),
      h("div", { class: "asst-row" }, input, btn({ label: "Enviar", ic: "play", kind: "primary", disabled: ui.busy, onClick: go })),
      ui.log.length ? btn({ label: "Borrar conversación", kind: "small", onClick: () => { ui.log = []; remember(app); app.renderPanel(); } }) : null);
    setTimeout(() => { log.scrollTop = log.scrollHeight; }, 0);
    return wrap;
  },
};
/** Las 3 sugerencias más importantes (síncrono y barato: solo reglas). */
function suggestions(app) {
  try { return analyzeProject(app.ai.context()).issues.filter(i => i.fix).slice(0, 3); } catch { return []; }
}

export const ASSISTANT_PANELS = { assistant: assistantPanel };
export const ASSISTANT_TABS = [{ id: "assistant", label: "Asistente", ic: "ai" }];
