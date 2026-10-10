// web/js/panels-pro.js
// Paneles del modo profesional: Control (MIDI, teclado, audio → parámetros,
// macros, bancos, sincronía, monitor y diagnóstico) y Rendimiento.
// En modo simple estas pestañas no aparecen.
import { h, section, row, btn, slider, segmented, toggle, hint, dialog, prompt } from "./ui.js";
import { catalog, describe, MODES, MERGES, REL_KINDS, MODIFIERS, SOURCE_NAMES, normalizeMapping } from "./params.js";
import { uid } from "./model.js";
import { padControlName } from "./gamepad.js";

const ctlUI = { monitorFilter: "", showMonitor: true };

/** Selector de parámetro destino (agrupado). */
export function targetSelect(app, value, onChange) {
  const sel = h("select", { class: "text-in" });
  let found = false;
  for (const g of catalog(app)) {
    const og = h("optgroup", { label: g.group });
    for (const it of g.items) {
      const o = h("option", { value: it.id }, it.name);
      if (it.id === value) { o.selected = true; found = true; }
      og.append(o);
    }
    sel.append(og);
  }
  if (!found && value) {
    const d = describe(app, value);
    sel.prepend(h("option", { value, selected: true }, d ? d.name : value + " (no existe)"));
  }
  sel.addEventListener("change", () => onChange(sel.value));
  return sel;
}

function selectEl(options, value, onChange) {
  const sel = h("select", { class: "text-in" });
  for (const [v, label] of options) sel.append(h("option", { value: v, selected: String(v) === String(value) }, label));
  sel.addEventListener("change", () => onChange(sel.value));
  return sel;
}

function field(label, el) { return h("label", { class: "field" }, h("span", { class: "lab" }, label), el); }

function controlName(m) {
  const k = m.key || "";
  if (m.src === "midi") {
    const [t, n] = k.split(":");
    return { cc: `CC ${n}`, note: `Nota ${n}`, pb: "Pitch bend", pc: `Program ${n}`, at: "Aftertouch", pat: `Aftertouch ${n}` }[t] || k;
  }
  if (m.src === "gamepad") return padControlName(k);
  if (m.src === "audio") return { bass: "Graves", mid: "Medios", high: "Agudos", level: "Volumen", beat: "Golpe" }[k] || k;
  return k;
}

/** Diálogo de edición de un mapeo. */
async function editMapping(app, m) {
  const P = app.params, C = app.S.project.settings.control;
  const w = { ...m };
  const devices = ["*", ...new Set([...(app.midiDriver?.active ? app.midiDriver.ports().inputs : []).map(p => p.name), ...(app.pads?.list() || []).map(p => p.device), m.device].filter(Boolean))];
  const content = h("div", { class: "mapedit" },
    field("Nombre", Object.assign(h("input", { class: "text-in", value: w.name || "", placeholder: "(automático)" }), { oninput: (e) => { w.name = e.target.value; } })),
    field("Destino", targetSelect(app, w.target, (v) => { w.target = v; })),
    row(
      field("Fuente", selectEl(Object.entries(SOURCE_NAMES).filter(([k]) => ["midi", "osc", "dmx", "key", "gamepad", "audio", "tracking"].includes(k)), w.src, (v) => { w.src = v; })),
      field("Dispositivo", selectEl(devices.map(d => [d, d === "*" ? "Cualquiera" : d]), w.device, (v) => { w.device = v; })),
    ),
    row(
      field("Canal", selectEl([[0, "Omni (todos)"], ...Array.from({ length: 16 }, (_, i) => [i + 1, String(i + 1)])], w.channel || 0, (v) => { w.channel = +v; })),
      field("Control", Object.assign(h("input", { class: "text-in", value: w.key, placeholder: "cc:7 · note:36 · pb · /osc/ruta · u1:c5 · bass · btn:0 · axis:2" }), { oninput: (e) => { w.key = e.target.value.trim(); } })),
    ),
    row(
      field("Modo", selectEl(MODES, w.mode, (v) => { w.mode = v; })),
      field("Mezcla", selectEl(MERGES, w.merge, (v) => { w.merge = v; })),
    ),
    row(
      field("Encoder relativo", selectEl(REL_KINDS, w.rel, (v) => { w.rel = v; })),
      field("Banco", selectEl([["", "Todos"], ...C.banks.map(b => [b, b])], w.bank, (v) => { w.bank = v; })),
    ),
    field("Modificador", selectEl(MODIFIERS, w.mod, (v) => { w.mod = v; })),
    slider({ label: "Mínimo", min: 0, max: 1, value: w.min, def: 0, fmt: (v) => Math.round(v * 100) + "%", onInput: (v) => { w.min = v; } }),
    slider({ label: "Máximo", min: 0, max: 1, value: w.max, def: 1, fmt: (v) => Math.round(v * 100) + "%", onInput: (v) => { w.max = v; } }),
    slider({ label: "Sensibilidad (encoder)", min: 0.1, max: 8, step: 0.1, value: w.sens || 1, def: 1, fmt: (v) => v.toFixed(1) + "×", onInput: (v) => { w.sens = v; } }),
    toggle({ label: "Invertir", value: w.invert, onChange: (v) => { w.invert = v; } }),
    toggle({ label: "Soft takeover (sin saltos)", hint: "El control solo actúa cuando alcanza el valor actual", value: w.takeover, onChange: (v) => { w.takeover = v; } }),
    toggle({ label: "Feedback al controlador", hint: "LED, pads RGB, motores: el controlador muestra el valor", value: w.feedback, onChange: (v) => { w.feedback = v; } }),
    toggle({ label: "Activo", value: w.enabled !== false, onChange: (v) => { w.enabled = v; } }),
  );
  const r = await dialog({ title: "Mapeo", content, wide: true, buttons: [
    { label: "Volver a aprender", value: "relearn" }, { label: "Restablecer", value: "reset" },
    { label: "Cancelar", value: null }, { label: "Guardar", kind: "primary", value: "save" }] });
  const i = C.mappings.findIndex(x => x.id === m.id);
  if (r === "save") { C.mappings[i] = normalizeMapping(w); P.dropMods(m.id); P.runtime.delete(m.id); app.paramMappingsChanged(); }
  if (r === "reset") { C.mappings[i] = normalizeMapping({ id: m.id, src: m.src, device: m.device, channel: m.channel, key: m.key, target: m.target }); P.dropMods(m.id); P.runtime.delete(m.id); app.paramMappingsChanged(); }
  if (r === "relearn") {
    C.mappings.splice(i, 1); P.dropMods(m.id);
    app.paramMappingsChanged();
    app.actions.learn(m.target);
  }
}

/** Diálogo de una macro: lista de pasos (destino, valor, espera). */
async function editMacro(app, mac) {
  const C = app.S.project.settings.control;
  const w = { ...mac, steps: mac.steps.map(s => ({ ...s })) };
  const list = h("div", { class: "list" });
  const draw = () => {
    list.innerHTML = "";
    w.steps.forEach((st, i) => {
      const d = describe(app, st.target);
      const val = d && d.kind === "float" ? Object.assign(h("input", { class: "text-in num", type: "number", step: "any", value: st.value ?? d.def }), { oninput: (e) => { st.value = +e.target.value; } })
        : d && d.kind === "bool" ? selectEl([[1, "Encender"], [0, "Apagar"]], st.value ? 1 : 0, (v) => { st.value = +v; }) : h("span", { class: "hint" }, "disparo");
      list.append(h("div", { class: "macrostep" },
        targetSelect(app, st.target, (v) => { st.target = v; draw(); }), val,
        Object.assign(h("input", { class: "text-in num", type: "number", min: 0, step: 50, value: st.delay || 0, title: "Espera antes de este paso (ms)" }), { oninput: (e) => { st.delay = +e.target.value; } }),
        btn({ ic: "trash", kind: "icon", onClick: () => { w.steps.splice(i, 1); draw(); } })));
    });
    if (!w.steps.length) list.append(hint("Añade los pasos que debe hacer este botón (escena, brillo, play, apagón…)."));
  };
  draw();
  const content = h("div", {},
    field("Nombre", Object.assign(h("input", { class: "text-in", value: w.name }), { oninput: (e) => { w.name = e.target.value; } })),
    h("p", { class: "hint" }, "Paso · valor · espera (ms)"), list,
    btn({ label: "Añadir paso", ic: "plus", kind: "block", onClick: () => { w.steps.push({ target: "global/play", value: 1, delay: 0 }); draw(); } }));
  const r = await dialog({ title: "Macro", content, wide: true, buttons: [{ label: "Probar", value: "test" }, { label: "Cancelar", value: null }, { label: "Guardar", kind: "primary", value: "save" }] });
  if (r === "save" || r === "test") {
    const i = C.macros.findIndex(x => x.id === mac.id);
    if (i >= 0) C.macros[i] = w; else C.macros.push(w);
    app.paramMappingsChanged();
    if (r === "test") app.params.runMacro(w.id);
  }
}

/* ======================================================================
   Panel Control
   ====================================================================== */
const control = {
  title: () => "Control · MIDI, teclado y audio",
  render(app) {
    const S = app.S, A = app.actions, P = app.params, C = S.project.settings.control, drv = app.midiDriver;
    const wrap = h("div", {});

    // ---- Dispositivos ----
    const dev = section("Controladores MIDI");
    if (!drv.supported) dev.append(hint("Este navegador no tiene Web MIDI. En la app de Windows funciona siempre."));
    else if (!drv.active) dev.append(hint("Conecta tu controlador por USB, Bluetooth o red (rtpMIDI) y actívalo. Se detecta solo al enchufarlo o desenchufarlo."),
      btn({ label: "Activar MIDI", ic: "midi", kind: "primary block", onClick: () => A.midi() }));
    else {
      const { inputs, outputs } = drv.ports();
      const tbl = h("div", { class: "devlist" });
      for (const p of inputs) tbl.append(h("div", { class: `dev ${p.state}` }, h("i"), h("b", {}, p.name), h("small", {}, `${p.manufacturer || "—"} · entrada · ${p.state === "connected" ? "conectado" : "desconectado"}`)));
      for (const p of outputs) tbl.append(h("div", { class: `dev ${p.state}` }, h("i"), h("b", {}, p.name), h("small", {}, `${p.manufacturer || "—"} · salida (feedback) · ${p.state === "connected" ? "conectado" : "desconectado"}`)));
      if (!inputs.length && !outputs.length) tbl.append(hint("No hay dispositivos MIDI. Conéctalo: aparecerá aquí sin reiniciar."));
      dev.append(tbl);
    }
    wrap.append(dev);
    // ---- Mandos de juego ----
    const padsBox = section("Mandos de juego (Xbox, PlayStation…)");
    const pl = app.pads?.list() || [];
    if (!app.pads?.supported) padsBox.append(hint("Este navegador no lee mandos de juego."));
    else if (!pl.length) padsBox.append(hint("Conecta el mando por USB o Bluetooth y pulsa cualquier botón: aparece aquí."));
    else for (const p of pl) padsBox.append(h("div", { class: "dev connected" }, h("i"), h("b", {}, `${p.device} · ${p.kindName}`), h("small", {}, `${C.mappings.filter(m => m.src === "gamepad" && (m.device === p.device || m.device === "*")).length} asignaciones`),
      btn({ label: "Mapa listo", ic: "plus", onClick: () => A.loadBasicPadMap(p.device), title: "A = GO · B = anterior · X = play · Y = apagón · LB/RB = escenas · RT = bajar brillo" })));
    wrap.append(padsBox);

    // ---- Aprender ----
    wrap.append(section("Asignar controles",
      hint("Clic derecho (o mantener pulsado) sobre cualquier deslizador o interruptor → «Aprender…» y mueve el knob, fader o pad. También funciona con teclas, OSC y DMX."),
      row(btn({ label: "Añadir mapeo", ic: "plus", onClick: () => newMapping(app) }),
        btn({ label: "Mapa básico", ic: "midi", onClick: A.loadBasicMidiMap, title: "Notas 36-51 = escenas · 60 play · 63/64 siguiente/anterior · CC1 brillo · CC21 opacidad" }))));

    // ---- Bancos y modificadores ----
    const banks = h("div", { class: "chips" });
    for (const b of ["", ...C.banks]) banks.append(h("button", { class: `chip ${C.bank === b ? "on" : ""}`, onclick: () => { P.setBank(b); } }, b || "Todos"));
    banks.append(h("button", { class: "chip", onclick: async () => {
      const name = (await prompt("Nombre del banco", ""))?.trim();
      if (name && !C.banks.includes(name)) { C.banks.push(name); app.paramMappingsChanged(); }
    } }, "+ banco"));
    wrap.append(section("Banco activo", banks,
      h("p", { class: "hint" }, `Modificador pulsado: ${P.modifier ? P.modifier.toUpperCase() : "ninguno"}. Un mismo knob puede hacer otra cosa con SHIFT/ALT/CTRL (asigna un botón a «Modificador»).`)));

    // ---- Mapeos ----
    const maps = C.mappings;
    const tbl = h("div", { class: "maptable" },
      h("div", { class: "mrow head" }, ...["Dispositivo", "Tipo", "Canal", "Control", "Destino", "Mín", "Máx", "Modo", ""].map(t => h("span", {}, t))));
    for (const m of maps) {
      const d = describe(app, m.target);
      const active = performance.now() - (P.activity.get(m.id) || 0) < 600;
      const r = h("div", { class: `mrow ${m.enabled === false ? "off" : ""} ${active ? "hit" : ""} ${d ? "" : "broken"}`, dataset: { map: m.id } },
        h("span", {}, m.device === "*" ? "Cualquiera" : m.device),
        h("span", {}, SOURCE_NAMES[m.src] || m.src),
        h("span", {}, m.src === "midi" ? (m.channel ? String(m.channel) : "Omni") : "—"),
        h("span", {}, controlName(m)),
        h("span", { class: "tgt" }, (m.name ? m.name + " · " : "") + (d ? d.name : "⚠ " + m.target), m.bank ? h("small", {}, " [" + m.bank + "]") : null, m.mod ? h("small", {}, " +" + m.mod.toUpperCase()) : null),
        h("span", {}, Math.round(m.min * 100) + "%"), h("span", {}, Math.round(m.max * 100) + "%"),
        h("span", {}, (MODES.find(x => x[0] === m.mode) || [, m.mode])[1] + (m.merge !== "override" ? " · " + (MERGES.find(x => x[0] === m.merge) || [, m.merge])[1] : "")),
        h("span", { class: "acts" },
          btn({ ic: m.enabled === false ? "eyeoff" : "eye", kind: "icon", title: m.enabled === false ? "Activar" : "Desactivar", onClick: () => { m.enabled = m.enabled === false; P.dropMods(m.id); app.paramMappingsChanged(); } }),
          btn({ ic: "pen", kind: "icon", title: "Editar", onClick: () => editMapping(app, m) }),
          btn({ ic: "copy", kind: "icon", title: "Duplicar", onClick: () => { maps.splice(maps.indexOf(m) + 1, 0, normalizeMapping({ ...m, id: undefined, name: (m.name || "") + " (copia)" })); app.paramMappingsChanged(); } }),
          btn({ ic: "trash", kind: "icon", title: "Eliminar", onClick: () => { maps.splice(maps.indexOf(m), 1); P.dropMods(m.id); app.paramMappingsChanged(); } })));
      tbl.append(r);
    }
    if (!maps.length) tbl.append(hint("Todavía no hay controles asignados."));
    wrap.append(section(`Mapeos (${maps.length})`, tbl));

    // ---- Macros ----
    const macros = h("div", { class: "list" });
    for (const mac of C.macros) macros.append(h("div", { class: "item" },
      h("span", {}, mac.name, h("small", {}, ` · ${mac.steps.length} pasos`)),
      btn({ ic: "play", kind: "icon", title: "Ejecutar", onClick: () => P.runMacro(mac.id) }),
      btn({ ic: "pen", kind: "icon", title: "Editar", onClick: () => editMacro(app, mac) }),
      btn({ ic: "midi", kind: "icon", title: "Asignar a un botón MIDI / tecla", onClick: () => app.actions.learn("macro/" + mac.id) }),
      btn({ ic: "trash", kind: "icon", title: "Eliminar", onClick: () => { C.macros.splice(C.macros.indexOf(mac), 1); app.paramMappingsChanged(); } })));
    wrap.append(section("Macros (un botón, varias acciones)", macros,
      btn({ label: "Nueva macro", ic: "plus", kind: "block", onClick: () => editMacro(app, { id: uid("mac"), name: "SHOW START", steps: [] }) })));

    // ---- Sincronía ----
    const outs = drv.active ? drv.ports().outputs.filter(p => p.state === "connected") : [];
    wrap.append(section("Sincronía MIDI",
      toggle({ label: "Seguir el tempo del MIDI Clock", hint: drv.clockBpm ? `Recibiendo ${drv.clockBpm.toFixed(1)} BPM` : "Sin MIDI Clock de entrada", value: C.sync.clockIn, onChange: (v) => { C.sync.clockIn = v; app.paramMappingsChanged(); } }),
      toggle({ label: "Start / Stop / Continue del MIDI Clock", hint: "Reproduce, para y reinicia con la mesa o el DAW", value: C.sync.transportIn, onChange: (v) => { C.sync.transportIn = v; app.paramMappingsChanged(); } }),
      field("Enviar MIDI Clock a", selectEl([["", "No enviar"], ...outs.map(p => [p.name, p.name])], C.sync.clockOut, (v) => {
        C.sync.clockOut = v; app.paramMappingsChanged();
        drv.setClockOut(v, () => S.project.settings.bpm || 120, () => S.playing);
      })),
      h("p", { class: "hint", id: "mtcInfo" }, drv.mtc.last ? `MTC: ${fmtTc(drv.mtc.last)}` : "MIDI Time Code: sin señal")));

    // ---- Monitor ----
    const mon = h("div", { class: "monitor" });
    const filter = Object.assign(h("input", { class: "text-in", type: "search", placeholder: "Filtrar (dispositivo, CC 7, nota…)", value: ctlUI.monitorFilter }), {
      oninput: (e) => { ctlUI.monitorFilter = e.target.value; drawMon(); } });
    const drawMon = () => {
      const q = ctlUI.monitorFilter.toLowerCase();
      const rows = P.monitor.filter(e => !q || `${e.device} ${e.label} ${e.key} ch${e.channel}`.toLowerCase().includes(q)).slice(-80).reverse();
      mon.innerHTML = "";
      for (const e of rows) mon.append(h("div", { class: "mon" },
        h("span", {}, new Date(e.t).toLocaleTimeString() + "." + String(e.t % 1000).padStart(3, "0")),
        h("span", {}, (SOURCE_NAMES[e.src] || e.src) + (e.device ? " · " + e.device : "")),
        h("span", {}, e.channel ? "ch " + e.channel : ""),
        h("span", {}, e.label || e.key),
        h("span", {}, e.v !== undefined ? (e.v * 100).toFixed(1) + "%" : "")));
      if (!rows.length) mon.append(hint(P.monitorPaused ? "En pausa." : "Mueve un control para verlo aquí."));
    };
    let pending = 0;
    P.onMonitor = () => { if (!pending && S.tab === "control") pending = requestAnimationFrame(() => { pending = 0; if (mon.isConnected) drawMon(); }); };
    drawMon();
    wrap.append(section("Monitor MIDI / OSC / DMX / teclas",
      row(btn({ label: P.monitorPaused ? "Reanudar" : "Pausa", ic: P.monitorPaused ? "play" : "pause", onClick: () => { P.monitorPaused = !P.monitorPaused; app.renderPanel(); } }),
        btn({ label: "Limpiar", ic: "trash", onClick: () => { P.monitor.length = 0; drawMon(); } })),
      filter, mon));

    // ---- Diagnóstico ----
    const diag = h("div", { class: "diag" });
    const ok = (good, text) => diag.append(h("div", { class: good ? "ok" : "bad" }, (good ? "✓ " : "✗ ") + text));
    ok(drv.supported, drv.supported ? "Web MIDI disponible" : "Web MIDI no disponible en este entorno");
    ok(drv.active, drv.active ? "Acceso MIDI concedido" : (drv.error || "MIDI sin activar"));
    if (drv.active) {
      const { inputs, outputs } = drv.ports();
      ok(inputs.some(p => p.state === "connected"), `${inputs.filter(p => p.state === "connected").length} entrada(s) conectada(s)`);
      ok(outputs.some(p => p.state === "connected"), `${outputs.filter(p => p.state === "connected").length} salida(s) conectada(s) (feedback y clock)`);
      for (const p of inputs) diag.append(h("div", { class: "hint" }, `${p.name}: ${p.last ? "último mensaje " + Math.round((Date.now() - p.last.t) / 1000) + " s · [" + p.last.bytes.join(" ") + "]" : "sin mensajes todavía"}`));
    }
    diag.append(hint("LumaMap no instala ni cambia drivers. Si un controlador no aparece, revisa que Windows lo vea (Administrador de dispositivos) y que otra aplicación no lo tenga ocupado."));
    wrap.append(section("Diagnóstico MIDI", diag));
    return wrap;
  },
};

function fmtTc(tc) { const p = (n) => String(n).padStart(2, "0"); return `${p(tc.h)}:${p(tc.m)}:${p(tc.s)}:${p(tc.f)} @ ${tc.fps} fps`; }

async function newMapping(app) {
  const m = normalizeMapping({ src: "midi", key: "cc:1", target: app.S.sel ? "surf/sel/opacity" : "global/master" });
  app.S.project.settings.control.mappings.push(m);
  await editMapping(app, m);
  app.paramMappingsChanged();
}

/* ======================================================================
   Panel Rendimiento
   ====================================================================== */
let perfTimer = 0;
const perfPanel = {
  title: () => "Rendimiento",
  render(app) {
    const box = h("div", { class: "perf" });
    const sys = h("div", { class: "perf" });
    const fmtMB = (b) => (b / 1048576).toFixed(0) + " MB";
    const draw = async () => {
      if (!box.isConnected) { clearInterval(perfTimer); perfTimer = 0; window.LumaDesktop?.perfWatch?.(false); return; }
      const p = app.perf();
      const cells = [
        ["FPS (editor)", p.fps.toFixed(1), p.fps < p.refreshHz * 0.9 ? "warn" : ""],
        ["Tiempo de fotograma", `${p.frameMs.toFixed(1)} ms (máx ${p.frameMax.toFixed(0)})`, ""],
        ["Trabajo de CPU por fotograma", `${p.workMs.toFixed(2)} ms (máx ${p.workMax.toFixed(1)})`, p.workMax > 1000 / p.refreshHz ? "warn" : ""],
        ["Fotogramas perdidos", `${p.dropped} en ${p.seconds.toFixed(0)} s`, p.dropped ? "warn" : ""],
        ["Pantalla", `${p.refreshHz.toFixed(0)} Hz`, ""],
        ["Vista previa", `${Math.round(p.preview.scale * 100)} % · ${p.preview.fps ? p.preview.fps + " fps" : "fps de la pantalla"}`, ""],
        ["Salidas con motor compartido", p.outputs.length ? p.outputs.map(n => "P" + n).join(", ") : "ninguna abierta", ""],
        ["Memoria JS", p.heap ? `${fmtMB(p.heap.used)} de ${fmtMB(p.heap.limit)}` : "no disponible", ""],
      ];
      box.innerHTML = "";
      for (const [k, v, c] of cells) box.append(h("div", { class: "pc " + c }, h("small", {}, k), h("b", {}, v)));
      for (const v of p.videos) box.append(h("div", { class: "pc" + (v.dropped ? " warn" : "") }, h("small", {}, "Video · " + v.name),
        h("b", {}, `${v.w}×${v.h} · ${v.decoded} decodificados · ${v.dropped} perdidos${v.paused ? " · en pausa" : ""}`)));
      if (window.LumaDesktop?.metrics) {
        try {
          const m = await window.LumaDesktop.metrics();
          sys.innerHTML = "";
          const add = (k, v, c = "") => sys.append(h("div", { class: "pc " + c }, h("small", {}, k), h("b", {}, v)));
          add("CPU (todos los procesos de LumaMap)", m.cpu.toFixed(1) + " %");
          add("RAM (LumaMap)", fmtMB(m.ram));
          add("Sistema", `${m.cpuModel} · ${m.cores} núcleos · ${fmtMB(m.totalMem)} RAM`);
          add("GPU", m.gpu || "desconocida");
          add("Uso de GPU", m.gpuUtil !== null ? m.gpuUtil.toFixed(0) + " %" : "no disponible en este sistema", m.gpuUtil > 90 ? "warn" : "");
          add("VRAM usada", m.vram !== null ? fmtMB(m.vram) : "no disponible en este sistema");
          for (const pr of m.procs) add("Proceso · " + pr.type, `${pr.cpu.toFixed(1)} % CPU · ${fmtMB(pr.mem)}`);
        } catch (e) { sys.textContent = "Métricas del sistema no disponibles: " + e.message; }
      }
    };
    clearInterval(perfTimer);
    perfTimer = setInterval(draw, 700);
    window.LumaDesktop?.perfWatch?.(true);
    setTimeout(draw, 0);   // cuando el panel ya está en pantalla (si no, se daría por cerrado)
    const S = app.S;
    return h("div", {},
      section("Render", box,
        btn({ label: "Reiniciar contadores", ic: "restart", onClick: () => { app.perfReset(); draw(); } })),
      window.LumaDesktop ? section("Sistema (medido por Windows)", sys) : section("Sistema", hint("CPU, GPU y VRAM se miden en la app de escritorio.")),
      section("Vista previa del editor",
        hint("Reduce solo la vista previa: la salida al proyector y la grabación mantienen su resolución y fps."),
        segmented({ options: [[1, "100 %"], [0.75, "75 %"], [0.5, "50 %"]], value: S.previewScale || 1, onChange: (v) => app.actions.setPreview({ scale: +v }) }),
        segmented({ options: [[30, "30 fps (más ligero)"], [60, "60 fps"], [-1, "Los de la pantalla"]], value: S.previewFps === 30 || S.previewFps === -1 ? S.previewFps : 60, onChange: (v) => app.actions.setPreview({ fps: +v }) }),
        hint("60 fps es lo recomendado: con un monitor de 144 Hz, «Los de la pantalla» dibuja 144 veces por segundo y gasta más del doble.")),
    );
  },
};

export const PRO_PANELS = { control, perf: perfPanel };
export const PRO_TABS = [
  { id: "control", label: "Control", ic: "knob", pro: true },
  { id: "perf", label: "Rendimiento", ic: "gauge", pro: true },
];
