// web/js/panels-timers.js
// «Encender y apagar por tiempos» (pestaña En vivo): plantillas de un toque
// (todas a la vez, una tras otra, alternar, persecución) y una lista de pasos
// con su tiempo, que se puede editar a mano. Igual en Windows, Android y navegador.
import { h, row, btn, toggle, segmented, hint, toast } from "./ui.js";
import { uid } from "./model.js";
import { TIMER_TEMPLATES, templateSteps, timerTargets, targetName, fmtTime, parseTime, sortSteps, cycleLength } from "./timers.js";

const ui = { gap: 5, who: "screens" };

export function timersSection(app) {
  const S = app.S, P = S.project, T = app.timers, c = P.settings.timers;
  const save = (panel = true) => { app.changed({ panel }); app.commitSoon(); };
  const wrap = h("div", { class: "timers" });

  // Estado (se refresca solo mientras la pestaña está abierta).
  const state = h("p", { class: "tstate" });
  const paint = () => {
    if (!state.isConnected) return;
    const nx = T.next();
    state.className = `tstate ${T.running ? "on" : ""}`;
    state.replaceChildren(h("i"), T.running
      ? `En marcha · ${fmtTime(T.elapsed() % cycleLength(c))} de ${fmtTime(cycleLength(c))}${nx ? ` · siguiente: ${targetName(P, nx.target)} ${nx.on ? "ON" : "OFF"} a los ${fmtTime(nx.at)}` : ""}`
      : c.steps.length ? `Parado · ${c.steps.length} pasos listos` : "Sin pasos: elige una plantilla o añade un paso");
    setTimeout(paint, 250);
  };
  paint();
  wrap.append(state,
    row(T.running
      ? btn({ label: "Parar", ic: "stop", kind: "wide danger", onClick: () => { T.stop(); toast("Tiempos parados"); } })
      : btn({ label: "Empezar", ic: "play", kind: "wide primary", disabled: !c.steps.length, onClick: () => { T.start(); toast("Tiempos en marcha"); } }),
    btn({ label: "Desde el principio", ic: "restart", kind: "wide", disabled: !c.steps.length, onClick: () => T.start() })));

  // Plantillas de un toque.
  const screensUsed = [1, 2, 3, 4].filter(n => n === 1 || P.surfaces.some(s => (s.screen || 0) === n)).map(n => `screen:${n}`);
  const targetsFor = () => ui.who === "surfaces" ? P.surfaces.map(s => `surface:${s.id}`) : screensUsed.length > 1 ? screensUsed : ["screen:1", "screen:2"];
  wrap.append(h("div", { class: "lbl" }, "Plantillas: un toque y listo"),
    segmented({ options: [["screens", "Pantallas"], ["surfaces", "Superficies"]], value: ui.who, small: true, onChange: (v) => { ui.who = v; app.renderPanel(); } }),
    h("div", { class: "lbl" }, "Cada cuánto"),
    segmented({ options: [[1, "1 s"], [2, "2 s"], [5, "5 s"], [10, "10 s"], [30, "30 s"], [60, "1 min"]], value: ui.gap, small: true, onChange: (v) => { ui.gap = v; } }),
    h("div", { class: "chips" }, ...TIMER_TEMPLATES.map(([k, name, desc]) => h("button", { class: "chip", title: desc, onclick: () => {
      const tg = targetsFor();
      if (!tg.length) return toast("Añade primero superficies", "err");
      const r = templateSteps(k, tg, ui.gap);
      c.steps = r.steps; c.length = r.length;
      save(); toast(`${name}: ${tg.length} ${ui.who === "surfaces" ? "superficies" : "pantallas"} cada ${fmtTime(ui.gap)} · pulsa Empezar`);
    } }, name))));

  // Pasos (editables a mano).
  const list = h("div", { class: "tsteps" });
  const targets = timerTargets(P);
  for (const s of sortSteps([...c.steps])) {
    const time = h("input", { class: "text-in ttime", value: fmtTime(s.at), inputmode: "numeric", title: "Minutos:segundos (p. ej. 1:30) o segundos" });
    time.addEventListener("change", () => {
      const v = parseTime(time.value);
      if (v === null) { time.value = fmtTime(s.at); return toast("Escribe el tiempo como 1:30 o 90", "err"); }
      s.at = v; save();
    });
    const sel = h("select", { class: "sel" }, ...targets.map(([v, l]) => h("option", { value: v, selected: v === s.target }, l)));
    sel.addEventListener("change", () => { s.target = sel.value; save(false); });
    list.append(h("div", { class: `tstep ${T.fired.has(s.id) ? "done" : ""}` },
      time, sel,
      btn({ label: s.on ? "ON" : "OFF", kind: s.on ? "primary small" : "danger small", onClick: () => { s.on = !s.on; save(); } }),
      btn({ ic: "trash", kind: "icon", title: "Quitar paso", onClick: () => { c.steps = c.steps.filter(x => x !== s); save(); } })));
  }
  wrap.append(h("div", { class: "lbl" }, "Pasos (minutos:segundos desde que pulsas Empezar)"), list,
    btn({ label: "Añadir paso", ic: "plus", kind: "block", onClick: () => {
      const last = c.steps.reduce((m, s) => Math.max(m, s.at), -5);
      c.steps.push({ id: uid("tm"), at: last + 5, target: "screen:1", on: true });
      save();
    } }));

  wrap.append(
    toggle({ label: "Repetir en bucle", value: c.loop, onChange: (v) => { c.loop = v; save(false); } }),
    toggle({ label: "Empezar solo al abrir el proyecto", value: c.autoStart, onChange: (v) => { c.autoStart = v; save(false); } }),
    (() => {
      const at = h("input", { class: "text-in ttime", type: "time", value: c.startAt || "" });
      at.addEventListener("change", () => { c.startAt = at.value || ""; save(false); toast(c.startAt ? `Empezará sola cada día a las ${c.startAt}` : "Sin hora de inicio"); });
      return h("label", { class: "tclock" }, h("span", {}, "Empezar sola a esta hora (instalaciones):"), at);
    })(),
    hint("En Android la salida es la pantalla externa (Pantalla 1); las superficies se encienden y apagan igual en todos los equipos."));
  return wrap;
}
