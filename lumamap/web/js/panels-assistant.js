// web/js/panels-assistant.js
// Panel «Asistente» (modo profesional): escribir órdenes en español que se
// ejecutan de verdad. Indica siempre si responde la IA (Claude) o el intérprete
// local sin IA, y qué acciones se hicieron.
import { h, section, btn, hint, toast, dialog } from "./ui.js";
import { Assistant } from "./assistant.js";

const EXAMPLES = ["Cuando levante la mano cambia el color a rojo", "Ve a la escena 2", "Pon Disco en todas", "Añade un cubo 3D", "Cuando haya dos personas pon la siguiente escena", "Apagón"];

function get(app) {
  if (!app.assistant) app.assistant = new Assistant(app);
  return app.assistant;
}

async function configureKey(app) {
  const input = h("input", { type: "password", class: "text-in", placeholder: "sk-ant-…", autocomplete: "off" });
  setTimeout(() => input.focus(), 50);
  const content = h("div", {},
    hint("Pega tu clave de la API de Claude (console.anthropic.com → API Keys). Se guarda cifrada en este equipo y solo la usa la app de escritorio. El uso se cobra en tu cuenta de la API."),
    input);
  const r = await dialog({ title: "Clave de la API de Claude", content, buttons: [{ label: "Quitar clave", value: "remove" }, { label: "Cancelar", value: null }, { label: "Guardar", kind: "primary", value: () => input.value }] });
  if (r === null || r === undefined) return;
  const res = await globalThis.LumaDesktop.ai.setKey(r === "remove" ? "" : r);
  toast(res.ok ? (res.removed ? "Clave quitada: el asistente funciona sin IA" : "Clave comprobada y guardada") : res.error, res.ok ? "" : "error");
  app.renderPanel();
}

const assistantPanel = {
  title: () => "Asistente",
  render(app) {
    const a = get(app);
    const wrap = h("div", { class: "asst" });
    const state = h("p", { class: "hint asst-state" }, "…");
    a.status().then(st => {
      state.textContent = st.ai ? `Con IA: Claude (${st.model}), necesita internet. Si Claude no puede responder, la API lo reintenta con un modelo alternativo.`
        : st.why === "browser" ? "Sin IA: órdenes simples. La IA con Claude está en la app de escritorio."
        : "Sin IA: órdenes simples. Para órdenes libres, configura la clave de la API de Claude.";
      state.classList.toggle("on", !!st.ai);
    });

    const log = h("div", { class: "asst-log" });
    const paint = () => {
      log.innerHTML = "";
      if (!a.log.length) log.append(hint("Escribe lo que quieres que pase. Todo lo que haga se puede deshacer con Ctrl+Z."));
      for (const m of a.log) log.append(h("div", { class: "asst-msg " + m.who },
        m.who === "act" ? "✓ " + m.text : m.who === "local" ? "✓ " + m.text + "  (sin IA)" : m.text));
      if (a.busy) log.append(h("div", { class: "asst-msg busy" }, "Pensando…"));
      log.scrollTop = log.scrollHeight;
      sendB.disabled = a.busy; cancelB.style.display = a.busy ? "" : "none";
    };
    const input = h("textarea", { class: "text-in asst-in", rows: 2, placeholder: "Ej.: cuando levante la mano cambia el color a rojo" });
    const send = () => { const t = input.value; input.value = ""; a.send(t); };
    input.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
    const sendB = btn({ label: "Enviar", ic: "play", kind: "primary", onClick: send });
    const cancelB = btn({ label: "Cancelar", ic: "close", onClick: () => a.cancel() });
    a.onChange = () => { if (log.isConnected) paint(); };

    wrap.append(state, log, h("div", { class: "asst-row" }, input, sendB, cancelB),
      h("div", { class: "chips" }, ...EXAMPLES.map(t => h("button", { class: "chip", onclick: () => { input.value = t; input.focus(); } }, t))));
    const cfg = [btn({ label: "Nueva conversación", ic: "plus", onClick: () => a.reset() })];
    if (globalThis.LumaDesktop?.ai) cfg.push(btn({ label: "Clave de la API", ic: "ai", onClick: () => configureKey(app) }));
    wrap.append(section("", h("div", { class: "row" }, ...cfg)));
    paint();
    return wrap;
  },
};

export const ASSISTANT_PANELS = { assistant: assistantPanel };
export const ASSISTANT_TABS = [{ id: "assistant", label: "Asistente", ic: "ai", pro: true }];
