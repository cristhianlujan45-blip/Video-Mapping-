// web/js/panels-show.js
// Piezas del show que van dentro de la pestaña «Escenas» (escenas = cues): transporte
// GO / BACK / STOP con el timecode, fuente de timecode (interno, MTC, LTC, OSC) y el timecode de
// cada escena, automatización grabada, modo actuación y emergencia.
import { h, row, btn, segmented, toggle, hint, toast } from "./ui.js";
import { TC_SOURCES, fmtTc, parseTc } from "./show.js";

function selectEl(options, value, onChange) {
  const sel = h("select", { class: "text-in small" });
  for (const [v, label] of options) sel.append(h("option", { value: v, selected: String(v) === String(value) }, label));
  sel.addEventListener("change", () => onChange(sel.value));
  return sel;
}

/** Transporte del show: BACK / GO / Play / STOP y el timecode en grande. */
export function showTransport(app) {
  const S = app.S, A = app.actions, P = S.project, sh = P.settings.show, SE = app.show;
  const tc = h("div", { class: "tcbig" }, fmtTc(S.tcNow, SE.fps()));
  const timer = setInterval(() => { if (!tc.isConnected) return clearInterval(timer); tc.textContent = fmtTc(S.tcNow, SE.fps()) + (sh.tcSource !== "internal" && S.tcNow === null ? "  (sin señal)" : ""); }, 100);
  return h("div", { class: "showpanel" }, h("div", { class: "transport" },
    btn({ label: "BACK", ic: "left", onClick: () => A.stepScene(-1) }),
    btn({ label: "GO", ic: "right", kind: "primary", onClick: () => A.stepScene(1) }),
    btn({ label: S.playing ? "Pausa" : "Play", ic: S.playing ? "pause" : "play", onClick: () => { A.togglePlay(); app.renderPanel(); } }),
    btn({ label: "STOP", ic: "stop", onClick: () => { if (S.playing) A.togglePlay(); A.restart(); A.goScene(P.scenes[0].id, { instant: true }); SE.resetInternal(); app.renderPanel(); } })),
    tc);
}

/** Timecode: interno, MTC, LTC u OSC, y disparar cues por timecode (con el timecode de cada escena). */
export function showTimecode(app) {
  const S = app.S, P = S.project, sh = P.settings.show, SE = app.show;
  const set = (fn, panel = true) => { fn(); app.changed({ panel }); app.commitSoon(); };
  const ins = h("select", { class: "text-in small" });
  navigator.mediaDevices?.enumerateDevices?.().then(list => {
    ins.append(h("option", { value: "" }, "Entrada por defecto"));
    for (const d of list.filter(d => d.kind === "audioinput" && d.deviceId && d.deviceId !== "default")) ins.append(h("option", { value: d.deviceId, selected: d.deviceId === sh.ltcDevice }, d.label || "Entrada de audio"));
  }).catch(() => {});
  ins.addEventListener("change", () => set(() => { sh.ltcDevice = ins.value; }, false));
  // Timecode de cada escena (cue): entra sola al llegar a ese tiempo si «Disparar por timecode» está activo.
  const cues = h("div", { class: "cuetable" }, h("div", { class: "crow head" }, ...["#", "Escena", "Timecode", ""].map(t => h("span", {}, t))));
  P.scenes.forEach((sc, i) => {
    const tcIn = h("input", { class: "text-in small", value: sc.tc || "", placeholder: "hh:mm:ss:ff" });
    tcIn.addEventListener("change", () => {
      const v = tcIn.value.trim();
      if (v && parseTc(v) === null) { toast("Timecode no válido (hh:mm:ss:ff)", "err"); return; }
      set(() => { sc.tc = v; }, false);
    });
    cues.append(h("div", { class: `crow ${sc.id === P.sceneId ? "on" : ""}` }, h("b", {}, String(i + 1)), h("span", { class: "nm", onclick: () => app.actions.goScene(sc.id) }, sc.name), tcIn,
      btn({ ic: "play", kind: "icon", title: "Ir a esta escena", onClick: () => app.actions.goScene(sc.id) })));
  });
  return h("div", {},
    segmented({ options: TC_SOURCES, value: sh.tcSource, small: true, onChange: (v) => set(() => { sh.tcSource = v; if (v === "ltc") SE.startLtc(sh.ltcDevice).then(ok => { if (!ok) toast("LTC: " + SE.ltcError, "err"); app.renderPanel(); }); else SE.stopLtc(); }) }),
    sh.tcSource === "ltc" ? h("div", {}, row(ins, btn({ label: SE.ltc ? "Reiniciar LTC" : "Escuchar LTC", ic: "audio", onClick: async () => { const ok = await SE.startLtc(sh.ltcDevice); toast(ok ? "Escuchando LTC" : "LTC: " + SE.ltcError, ok ? "" : "err"); app.renderPanel(); } })),
      hint(SE.ltc ? (SE.external?.source === "ltc" ? `Recibiendo LTC a ${SE.external.fps} fps` : "Escuchando… (sin LTC todavía)") : "Conecta la salida de LTC a una entrada de audio (línea).")) : null,
    sh.tcSource === "mtc" ? hint("Activa MIDI en el panel Control. El MTC llega por cualquier entrada MIDI.") : null,
    sh.tcSource === "osc" ? hint("Envía /lumamap/timecode con \"hh:mm:ss:ff\" o segundos al puerto OSC (☰ → Conexiones → Control desde el móvil y OSC).") : null,
    sh.tcSource === "internal" ? row(hint("Reloj interno: avanza con Play y se pone a cero con STOP."), btn({ label: "Poner a 0", kind: "small", onClick: () => SE.resetInternal() })) : null,
    toggle({ label: "Disparar las escenas por timecode", hint: "Cada escena con timecode entra sola al llegar a su tiempo (también al saltar hacia atrás)", value: sh.chase, onChange: (v) => set(() => { sh.chase = v; SE.lastChased = null; }) }),
    cues);
}

/** Automatización grabada de la escena actual. */
export function showAutomation(app) {
  const S = app.S, P = S.project, sh = P.settings.show, SE = app.show;
  const set = (fn, panel = true) => { fn(); app.changed({ panel }); app.commitSoon(); };
  const lanes = h("div", { class: "list" });
  for (const ln of sh.lanes.filter(l => l.sceneId === P.sceneId)) {
    const d = app.describeParam(ln.target);
    const dur = ln.points.length ? ln.points[ln.points.length - 1][0] : 0;
    lanes.append(h("div", { class: "item" }, h("span", {}, d ? d.name : ln.target, h("small", {}, ` · ${ln.points.length} puntos · ${dur.toFixed(1)} s`)),
      btn({ ic: ln.loop ? "restart" : "right", kind: "icon", title: ln.loop ? "En bucle" : "Una vez", onClick: () => set(() => { ln.loop = !ln.loop; }) }),
      btn({ ic: ln.enabled ? "eye" : "eyeoff", kind: "icon", title: "Activar / desactivar", onClick: () => set(() => { ln.enabled = !ln.enabled; }) }),
      btn({ ic: "trash", kind: "icon", title: "Borrar", onClick: () => set(() => { sh.lanes.splice(sh.lanes.indexOf(ln), 1); }) })));
  }
  if (!lanes.children.length) lanes.append(hint("Sin automatización en esta escena."));
  return h("div", {},
    hint("Pulsa GRABAR y mueve knobs, faders, OSC, DMX… (o deja que el audio y el tracking muevan sus parámetros). Al reproducir la escena se repiten igual; se ven en la pista «Automat.» de la línea de tiempo."),
    btn({ label: SE.recording ? "■ Detener grabación" : "● GRABAR automatización", kind: SE.recording ? "danger block" : "block", onClick: () => {
      if (SE.recording) { const r = SE.stopRecording(); app.changed(); app.commit(); toast(`Grabado: ${r.targets.size} parámetro(s)`); }
      else { SE.startRecording(); toast("Grabando: mueve los controles"); }
      app.renderPanel();
    } }),
    lanes);
}

/** Modo actuación y emergencia. */
export function showPerformance(app) {
  const S = app.S, A = app.actions, P = S.project, sh = P.settings.show;
  const set = (fn, panel = true) => { fn(); app.changed({ panel }); app.commitSoon(); };
  const snaps = P.settings.dmx.snapshots;
  return h("div", {},
    btn({ label: "Entrar en MODO ACTUACIÓN", ic: "live", kind: "primary block", onClick: () => A.togglePerfMode(true) }),
    hint("Oculta los paneles, bloquea la edición y los avisos, y aligera la vista previa para dar prioridad a las salidas. Teclas: Enter = GO, Re Pág = BACK, B = apagón, Ctrl+Shift+E = emergencia. Para salir: mantén pulsado «Salir», Mayús+Esc o F10."),
    row(h("label", { class: "field" }, h("span", { class: "lab" }, "Escena de emergencia"), selectEl([["", "Negro"], ...P.scenes.map(s => [s.id, s.name])], sh.emergency.sceneId, (v) => set(() => { sh.emergency.sceneId = v; }, false))),
      h("label", { class: "field" }, h("span", { class: "lab" }, "Luces en emergencia"), selectEl([["", "Apagadas"], ...snaps.map(s => [s.id, "Snapshot: " + s.name])], sh.emergency.snapshot, (v) => set(() => { sh.emergency.snapshot = v; }, false)))),
    btn({ label: S.emergency ? "Desactivar EMERGENCIA" : "EMERGENCIA", kind: "danger block", onClick: () => { A.emergency(); app.renderPanel(); } }));
}

// Show y Escenas son lo mismo (las escenas son las cues): una sola pestaña, «Escenas» (panels.js),
// que junta la lista, la línea de tiempo y estas secciones. «show» sigue funcionando como nombre.
export const SHOW_PANELS = {};
export const SHOW_TABS = [];
