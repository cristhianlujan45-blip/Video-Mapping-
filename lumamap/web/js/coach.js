// web/js/coach.js
// 🎓 Tutorial interactivo con Luma, la guía con IA. Encima de la Academia (ai/academy.js):
//   · cada paso es una actividad de verdad (Luma comprueba que la hiciste y pasa sola al siguiente);
//   · resalta el botón que hay que tocar;
//   · ◀ Atrás, ⟲ Repetir, Saltar ▶, «Hazlo por mí», 🙈 Ocultar (queda una burbuja) y 📚 Capítulos
//     (cualquiera, cuando quieras, también para repetirlo);
//   · «🤖 Explícamelo» y «Pregúntale a Luma»: responde la IA local (Ollama) si la hay; si no, la guía.
//   · 🔊 Leer en voz alta (opcional).
// Se guarda dónde te quedaste: «Continuar» sigue por ahí.
import { h, btn, dialog, closeDialog, hint } from "./ui.js";
import { LEVELS, COURSE } from "./ai/academy.js";
import { searchKnowledge } from "./ai/knowledge.js";

const ui = { answer: null, asking: false, askOpen: false, speak: (() => { try { return localStorage.getItem("lumamap:coachVoice") === "1"; } catch { return false; } })() };
let hlEls = [];

function clearHighlight() { for (const el of hlEls) el.classList.remove("coach-hl"); hlEls = []; }
/** Busca lo que hay que tocar: selector, { sel, text } (un botón por su texto) o una lista (el primero que exista). */
function findTarget(target) {
  if (Array.isArray(target)) { for (const t of target) { const e = findTarget(t); if (e.length) return e; } return []; }
  try {
    if (typeof target === "string") return [...document.querySelectorAll(target)].filter(e => e.offsetParent || e.getClientRects().length).slice(0, 1);
    return [...document.querySelectorAll(target.sel)].filter(e => e.textContent.includes(target.text)).slice(0, 1);
  } catch { return []; }
}
/** Resalta lo que hay que tocar. */
function highlight(target) {
  clearHighlight();
  if (!target) return;
  const els = findTarget(target);
  for (const el of els) { el.classList.add("coach-hl"); if (!el.closest("#top, #dock")) el.scrollIntoView?.({ block: "nearest", behavior: "smooth" }); }
  hlEls = els;
}

function say(text) {
  if (!ui.speak || typeof speechSynthesis === "undefined") return;
  try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text.replace(/[«»🤖🙈⟲▶◀✨↶📷🎬]/g, "")); u.lang = "es-ES"; u.rate = 1.02; speechSynthesis.speak(u); } catch {}
}

/** Lo que la IA está usando ahora, en una frase. */
function aiLabel(app) {
  const s = app.ai?.statusLine?.();
  return s?.ok ? `IA ${s.mode.toLowerCase()} · ${s.model}` : "guía de LumaMap (sin IA)";
}
async function ask(app, question) {
  const A = app.academy;
  A.asked++;
  ui.asking = true; ui.answer = null; paintCoach(app);
  let text = "", source = "";
  try {
    // Con IA (Ollama en tu equipo, o la remota si la activaste) responde el modelo con la guía de LumaMap delante;
    // sin IA, la guía directamente.
    const r = await app.ai.explain(question);
    text = r?.text || ""; source = app.ai.notice || r?.fallback ? "guía de LumaMap (la IA no respondió)" : aiLabel(app);
  } catch {}
  if (!text) { const a = searchKnowledge(question, 1)[0]; text = a ? `${a.title}: ${a.text}` : "Aún no tengo una guía sobre eso. Prueba con otras palabras (máscaras, proyector, luces, 3D, escenas…)."; source = "guía de LumaMap"; }
  ui.asking = false; ui.answer = { q: question, text, source };
  say(text);
  paintCoach(app);
}

/** Ventana de capítulos: cualquiera, cuando quieras (también para repetirlo). */
export function openChapters(app) {
  const A = app.academy;
  const list = h("div", { class: "lessons coachlist" }, ...COURSE.map((n, k) => {
    const L = LEVELS.find(l => l.level === n);
    return h("button", { class: `lesson ${A.done.has(n) ? "done" : ""} ${A.cur?.level === n ? "on" : ""}`, onclick: () => { closeDialog(); A.start(n); } },
      h("b", {}, A.done.has(n) ? "✓" : String(k + 1)), h("span", {}, L.title), h("small", {}, `${L.steps.length} pasos`));
  }));
  const done = COURSE.filter(n => A.done.has(n)).length;
  dialog({ title: "📚 Capítulos del tutorial", wide: true, content: h("div", {},
    hint(`${done} de ${COURSE.length} terminados. Toca cualquiera para hacerlo (o repetirlo). Cada uno son actividades cortas que Luma comprueba.`),
    list,
    h("div", { class: "row" },
      btn({ label: A.saved() ? "▶ Continuar donde lo dejé" : "▶ Empezar el curso", kind: "primary", onClick: () => { closeDialog(); A.startCourse(); } }),
      btn({ label: "Empezar de cero", kind: "small", onClick: () => { A.resetProgress(); closeDialog(); A.startCourse({ restart: true }); } }))), buttons: [{ label: "Cerrar", value: null }] });
}

/** Tarjeta de Luma (o su burbuja si está oculta). Se llama en cada cambio de la academia. */
export function paintCoach(app) {
  const A = app.academy, L = A?.level, st = A?.step;
  let el = document.getElementById("academyCard");
  const stage = document.getElementById("stage");
  if (!st && !A?.finished) { el?.remove(); clearHighlight(); return; }
  if (!el) { el = h("div", { id: "academyCard", class: "academy coach" }); stage?.append(el); }
  // Oculto: solo una burbuja para volver.
  if (A.hidden) {
    clearHighlight();
    el.className = "academy coach mini";
    el.replaceChildren(h("button", { class: "coachbubble", title: "Volver al tutorial", onclick: () => A.hide(false) }, "🤖 Luma", h("small", {}, L ? ` · ${A.cur.i + 1}/${L.steps.length}` : "")));
    return;
  }
  el.className = "academy coach";
  // Capítulo terminado.
  if (!st) {
    clearHighlight();
    const nx = A.nextLevel(A.finished), NL = nx && LEVELS.find(l => l.level === nx);
    const FL = LEVELS.find(l => l.level === A.finished);
    el.replaceChildren(
      h("div", { class: "coachhead" }, h("span", { class: "coachav" }, "🤖"), h("div", {}, h("small", {}, "Luma · tutorial"), h("b", {}, `🎉 ¡Capítulo «${FL?.title || ""}» terminado!`))),
      h("p", {}, NL ? `El siguiente es «${NL.title}».` : "¡Has terminado el curso completo! Puedes repetir cualquier capítulo cuando quieras."),
      h("div", { class: "row" },
        NL ? btn({ label: `Siguiente capítulo ▶`, kind: "small primary", onClick: () => A.start(nx) }) : null,
        btn({ label: "📚 Capítulos", kind: "small", onClick: () => openChapters(app) }),
        btn({ label: "Cerrar", kind: "small", onClick: () => { A.finished = 0; paintCoach(app); } })));
    return;
  }
  const k = COURSE.indexOf(L.level);
  const qIn = h("input", { class: "text-in small", placeholder: "Escribe tu duda (p. ej. ¿cómo hago una máscara?)", "aria-label": "Pregúntale a Luma" });
  const send = () => { const q = qIn.value.trim(); if (q) ask(app, q); };
  qIn.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); send(); } e.stopPropagation(); });
  const askOpen = ui.askOpen || st.ask || ui.asking || !!ui.answer;
  el.replaceChildren(...[
    h("div", { class: "coachhead" },
      h("span", { class: "coachav" }, "🤖"),
      h("div", {}, h("small", {}, `Luma · ${k >= 0 ? `capítulo ${k + 1}/${COURSE.length}` : "Academia"}: ${L.title}`), h("b", {}, `PASO ${A.cur.i + 1}/${L.steps.length}`)),
      h("span", { class: "grow" }),
      h("button", { class: "coachx", title: ui.speak ? "No leer en voz alta" : "Leer en voz alta", onclick: () => { ui.speak = !ui.speak; try { localStorage.setItem("lumamap:coachVoice", ui.speak ? "1" : "0"); } catch {} if (ui.speak) say(st.text); else { try { speechSynthesis.cancel(); } catch {} } paintCoach(app); } }, ui.speak ? "🔊" : "🔈"),
      h("button", { class: "coachx", title: "Ocultar (queda una burbuja para volver)", onclick: () => A.hide(true) }, "🙈"),
      h("button", { class: "coachx", title: "Salir del tutorial (luego puedes continuar donde lo dejaste)", "aria-label": "Salir", onclick: () => A.stop() }, "✕")),
    h("div", { class: "coachdots" }, ...L.steps.map((_, i) => h("i", { class: i < A.cur.i ? "ok" : i === A.cur.i ? "on" : "" }))),
    h("p", { class: "coachtext" }, st.text),
    A.doneFlash ? h("p", { class: "coachok" }, "✓ ¡Bien hecho!") : st.info ? null : h("small", { class: "dim coachwait" }, "Hazlo tú y paso solo al siguiente."),
    h("div", { class: "row coachbtns" },
      btn({ label: "◀", kind: "small", title: "Paso anterior", disabled: A.cur.i === 0, onClick: () => A.prev() }),
      btn({ label: "⟲ Repetir", kind: "small", title: "Hacer este paso otra vez", onClick: () => A.repeat() }),
      st.doIt ? btn({ label: "Hazlo por mí", kind: "small", title: "Lo hago yo para que veas el resultado", onClick: () => A.doIt() }) : null,
      btn({ label: st.info ? "Siguiente ▶" : "Saltar ▶", kind: `small ${st.info ? "primary" : ""}`, title: st.info ? "Siguiente paso" : "Saltar este paso", onClick: () => A.next() })),
    h("div", { class: "row coachbtns" },
      btn({ label: "📚 Capítulos", kind: "small", onClick: () => openChapters(app) }),
      btn({ label: "🤖 Explícamelo", kind: "small", title: "Luma te lo explica con otras palabras", onClick: () => ask(app, st.text) }),
      askOpen ? null : btn({ label: "💬 Pregúntale", kind: "small", title: "Pregúntale a Luma lo que quieras", onClick: () => { ui.askOpen = true; paintCoach(app); document.querySelector("#academyCard .coachask input")?.focus(); } })),
    askOpen ? h("div", { class: "row coachask" }, qIn, btn({ label: "Preguntar", kind: "small primary", onClick: send })) : null,
    ui.asking ? h("p", { class: "coachans dim" }, "Luma está pensando…") : null,
    ui.answer ? h("div", { class: "coachans" }, h("p", {}, ui.answer.text), h("small", { class: "dim" }, `Respondió: ${ui.answer.source}`)) : null,
  ].filter(Boolean));
  highlight(st.target);
}

let lastKey = "";
/** Se llama en cada cambio: vuelve a pintar y lee el paso nuevo si toca. */
export function coachChanged(app) {
  const A = app.academy, key = A?.cur ? `${A.cur.level}:${A.cur.i}` : "";
  if (key !== lastKey) { ui.answer = null; ui.askOpen = false; lastKey = key; if (key && !A.hidden) say(A.step?.text || ""); }
  paintCoach(app);
}
/** El resaltado sigue al botón aunque el panel se vuelva a dibujar. */
export function coachTick(app) {
  const st = app.academy?.step;
  if (st?.target && !app.academy.hidden && !hlEls.some(e => e.isConnected)) highlight(st.target);
}
