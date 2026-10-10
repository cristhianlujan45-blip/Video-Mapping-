// web/js/panels-show.js
// Panel «Show» (modo profesional): lista de cues (escenas) con transición,
// duración y timecode; transporte GO / BACK / STOP; fuente de timecode
// (interno, MTC, LTC, OSC); automatización; modo actuación y emergencia.
import { h, section, row, btn, segmented, toggle, hint, toast } from "./ui.js";
import { TRANSITIONS } from "./compose.js";
import { TC_SOURCES, fmtTc, parseTc } from "./show.js";

function selectEl(options, value, onChange) {
  const sel = h("select", { class: "text-in small" });
  for (const [v, label] of options) sel.append(h("option", { value: v, selected: String(v) === String(value) }, label));
  sel.addEventListener("change", () => onChange(sel.value));
  return sel;
}

const showPanel = {
  title: () => "Show · cues, timecode y automatización",
  render(app) {
    const S = app.S, A = app.actions, P = S.project, sh = P.settings.show, SE = app.show;
    const set = (fn, panel = true) => { fn(); app.changed({ panel }); app.commitSoon(); };
    const wrap = h("div", { class: "showpanel" });

    // ---- Transporte ----
    const tc = h("div", { class: "tcbig" }, fmtTc(S.tcNow, SE.fps()));
    wrap.append(h("div", { class: "transport" },
      btn({ label: "BACK", ic: "left", onClick: () => A.stepScene(-1) }),
      btn({ label: "GO", ic: "right", kind: "primary", onClick: () => A.stepScene(1) }),
      btn({ label: S.playing ? "Pausa" : "Play", ic: S.playing ? "pause" : "play", onClick: () => { A.togglePlay(); app.renderPanel(); } }),
      btn({ label: "STOP", ic: "stop", onClick: () => { if (S.playing) A.togglePlay(); A.restart(); A.goScene(P.scenes[0].id, { instant: true }); SE.resetInternal(); app.renderPanel(); } })),
      tc,
      row(toggle({ label: "Auto (avanzar con la duración)", value: P.settings.autoAdvance, onChange: (v) => set(() => { P.settings.autoAdvance = v; S.sceneStart = S.clock; }) }),
        toggle({ label: "Loop", value: P.settings.loopScenes, onChange: (v) => set(() => { P.settings.loopScenes = v; }) })));
    const timer = setInterval(() => { if (!tc.isConnected) return clearInterval(timer); tc.textContent = fmtTc(S.tcNow, SE.fps()) + (sh.tcSource !== "internal" && S.tcNow === null ? "  (sin señal)" : ""); }, 100);

    // ---- Cues ----
    const cues = h("div", { class: "cuetable" }, h("div", { class: "crow head" }, ...["#", "Escena", "Transición", "Duración", "Mantener", "Timecode", ""].map(t => h("span", {}, t))));
    P.scenes.forEach((sc, i) => {
      const tcIn = h("input", { class: "text-in small", value: sc.tc || "", placeholder: "hh:mm:ss:ff" });
      tcIn.addEventListener("change", () => {
        const v = tcIn.value.trim();
        if (v && parseTc(v) === null) { toast("Timecode no válido (hh:mm:ss:ff)", "err"); return; }
        set(() => { sc.tc = v; }, false);
      });
      cues.append(h("div", { class: `crow ${sc.id === P.sceneId ? "on" : ""}` },
        h("b", {}, String(i + 1)),
        h("span", { class: "nm", onclick: () => A.goScene(sc.id) }, sc.name),
        selectEl(TRANSITIONS, sc.transition || "fade", (v) => set(() => { sc.transition = v; }, false)),
        Object.assign(h("input", { class: "text-in small num", type: "number", min: 0, step: 0.1, value: ((sc.trMs ?? P.settings.transitionMs) / 1000).toFixed(1), title: "Segundos de transición" }),
          { onchange: (e) => set(() => { sc.trMs = Math.max(0, +e.target.value) * 1000; }, false) }),
        Object.assign(h("input", { class: "text-in small num", type: "number", min: 0, step: 1, value: sc.duration || 0, title: "Segundos en pantalla antes de pasar sola (0 = manual)" }),
          { onchange: (e) => set(() => { sc.duration = Math.max(0, +e.target.value); }, false) }),
        tcIn,
        btn({ ic: "play", kind: "icon", title: "Ir a esta cue", onClick: () => A.goScene(sc.id) })));
    });
    wrap.append(section("Cues", cues, btn({ label: "Nueva cue (copia de la actual)", ic: "plus", kind: "block", onClick: A.addScene })));

    // ---- Timecode ----
    const ins = h("select", { class: "text-in small" });
    navigator.mediaDevices?.enumerateDevices?.().then(list => {
      ins.append(h("option", { value: "" }, "Entrada por defecto"));
      for (const d of list.filter(d => d.kind === "audioinput" && d.deviceId && d.deviceId !== "default")) ins.append(h("option", { value: d.deviceId, selected: d.deviceId === sh.ltcDevice }, d.label || "Entrada de audio"));
    }).catch(() => {});
    ins.addEventListener("change", () => set(() => { sh.ltcDevice = ins.value; }, false));
    wrap.append(section("Timecode",
      segmented({ options: TC_SOURCES, value: sh.tcSource, small: true, onChange: (v) => set(() => { sh.tcSource = v; if (v === "ltc") SE.startLtc(sh.ltcDevice).then(ok => { if (!ok) toast("LTC: " + SE.ltcError, "err"); app.renderPanel(); }); else SE.stopLtc(); }) }),
      sh.tcSource === "ltc" ? h("div", {}, row(ins, btn({ label: SE.ltc ? "Reiniciar LTC" : "Escuchar LTC", ic: "audio", onClick: async () => { const ok = await SE.startLtc(sh.ltcDevice); toast(ok ? "Escuchando LTC" : "LTC: " + SE.ltcError, ok ? "" : "err"); app.renderPanel(); } })),
        hint(SE.ltc ? (SE.external?.source === "ltc" ? `Recibiendo LTC a ${SE.external.fps} fps` : "Escuchando… (sin LTC todavía)") : "Conecta la salida de LTC a una entrada de audio (línea).")) : null,
      sh.tcSource === "mtc" ? hint("Activa MIDI en el panel Control. El MTC llega por cualquier entrada MIDI.") : null,
      sh.tcSource === "osc" ? hint("Envía /lumamap/timecode con \"hh:mm:ss:ff\" o segundos al puerto OSC (Menú → Mando remoto y OSC).") : null,
      sh.tcSource === "internal" ? row(hint("Reloj interno: avanza con Play y se pone a cero con STOP."), btn({ label: "Poner a 0", kind: "small", onClick: () => SE.resetInternal() })) : null,
      toggle({ label: "Disparar las cues por timecode", hint: "Cada escena con timecode entra sola al llegar a su tiempo (también al saltar hacia atrás)", value: sh.chase, onChange: (v) => set(() => { sh.chase = v; SE.lastChased = null; }) })));

    // ---- Automatización ----
    const lanes = h("div", { class: "list" });
    const cur = P.scenes.find(s => s.id === P.sceneId);
    for (const ln of sh.lanes.filter(l => l.sceneId === P.sceneId)) {
      const d = app.describeParam(ln.target);
      const dur = ln.points.length ? ln.points[ln.points.length - 1][0] : 0;
      lanes.append(h("div", { class: "item" }, h("span", {}, d ? d.name : ln.target, h("small", {}, ` · ${ln.points.length} puntos · ${dur.toFixed(1)} s`)),
        btn({ ic: ln.loop ? "restart" : "right", kind: "icon", title: ln.loop ? "En bucle" : "Una vez", onClick: () => set(() => { ln.loop = !ln.loop; }) }),
        btn({ ic: ln.enabled ? "eye" : "eyeoff", kind: "icon", title: "Activar / desactivar", onClick: () => set(() => { ln.enabled = !ln.enabled; }) }),
        btn({ ic: "trash", kind: "icon", title: "Borrar", onClick: () => set(() => { sh.lanes.splice(sh.lanes.indexOf(ln), 1); }) })));
    }
    if (!lanes.children.length) lanes.append(hint("Sin automatización en esta escena."));
    wrap.append(section(`Automatización · ${cur?.name || ""}`,
      hint("Pulsa GRABAR y mueve knobs, faders, OSC, DMX… (o deja que el audio y el tracking muevan sus parámetros). Al reproducir la escena se repiten igual."),
      btn({ label: SE.recording ? "■ Detener grabación" : "● GRABAR automatización", kind: SE.recording ? "danger block" : "block", onClick: () => {
        if (SE.recording) { const r = SE.stopRecording(); app.changed(); app.commit(); toast(`Grabado: ${r.targets.size} parámetro(s)`); }
        else { SE.startRecording(); toast("Grabando: mueve los controles"); }
        app.renderPanel();
      } }),
      lanes));

    // ---- Actuación y emergencia ----
    const snaps = P.settings.dmx.snapshots;
    wrap.append(section("Actuación y emergencia",
      btn({ label: "Entrar en MODO ACTUACIÓN", ic: "live", kind: "primary block", onClick: () => A.togglePerfMode(true) }),
      hint("Oculta los paneles, bloquea la edición y los avisos, y aligera la vista previa para dar prioridad a las salidas. Teclas: Enter = GO, Re Pág = BACK, B = apagón, Ctrl+Shift+E = emergencia. Para salir: mantén pulsado «Salir», Mayús+Esc o F10."),
      row(h("label", { class: "field" }, h("span", { class: "lab" }, "Escena de emergencia"), selectEl([["", "Negro"], ...P.scenes.map(s => [s.id, s.name])], sh.emergency.sceneId, (v) => set(() => { sh.emergency.sceneId = v; }, false))),
        h("label", { class: "field" }, h("span", { class: "lab" }, "Luces en emergencia"), selectEl([["", "Apagadas"], ...snaps.map(s => [s.id, "Snapshot: " + s.name])], sh.emergency.snapshot, (v) => set(() => { sh.emergency.snapshot = v; }, false)))),
      btn({ label: S.emergency ? "Desactivar EMERGENCIA" : "EMERGENCIA", kind: "danger block", onClick: () => { A.emergency(); app.renderPanel(); } })));
    return wrap;
  },
};

export const SHOW_PANELS = { show: showPanel };
export const SHOW_TABS = [{ id: "show", label: "Show", ic: "timeline", pro: true }];
