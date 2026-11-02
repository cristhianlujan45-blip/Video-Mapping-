// web/js/panels-controllers.js
// «🎮 Mandos, teclado y MIDI» (pestaña En vivo), la forma fácil de asignar:
// eliges qué quieres hacer, pulsas el botón (tecla, mando de Xbox/PlayStation o
// controlador MIDI) y listo. Cada dispositivo tiene sus propias asignaciones, así
// que varios pueden usarse a la vez y controlar cosas distintas.
import { h, row, btn, hint, toast } from "./ui.js";
import { describe } from "./params.js";

const ui = { target: "global/go" };

/** Acciones más usadas, en lenguaje sencillo. */
function quickTargets(app) {
  const P = app.S.project, out = [
    ["global/go", "GO (siguiente)"], ["global/prev", "Escena anterior"], ["global/next", "Escena siguiente"],
    ["global/play", "Reproducir / pausa"], ["global/blackout", "Apagón"], ["global/master", "Brillo general"],
    ["global/randomAll", "Todas al azar"], ["global/goAll", "Fundir todas a lo siguiente"], ["global/tap", "Marcar el tempo (TAP)"],
    ["surf/sel/opacity", "Opacidad de la superficie elegida"], ["surf/sel/random", "Superficie elegida: siguiente al azar"],
  ];
  P.scenes.slice(0, 12).forEach((sc, i) => out.push([`scene/${i}`, `Ir a la escena «${sc.name}»`]));
  [1, 2, 3, 4].forEach(n => { if (P.settings.screens?.[n]) out.push([`screen/${n}/on`, `Pantalla ${n}: encender / apagar`]); });
  P.surfaces.slice(0, 12).forEach(s => out.push([`surf/${s.id}/hidden`, `«${s.name}»: mostrar / ocultar`], [`surf/${s.id}/go`, `«${s.name}»: GO`]));
  (P.settings.control.macros || []).forEach(m => out.push([`macro/${m.id}`, `Macro «${m.name}»`]));
  return out;
}

const devName = (m) => m.src === "key" ? "⌨ Teclado" : m.src === "gamepad" ? "🎮 " + (m.device === "*" ? "Cualquier mando" : m.device)
  : m.src === "midi" ? "🎹 MIDI" + (m.device && m.device !== "*" ? " · " + m.device : "") : m.src.toUpperCase() + (m.device && m.device !== "*" ? " · " + m.device : "");

export function controllersSection(app) {
  const S = app.S, A = app.actions, C = S.project.settings.control, P = app.params;
  const wrap = h("div", { class: "ctlsimple" });

  // Dispositivos conectados ahora.
  const devs = h("div", { class: "devchips" });
  devs.append(h("span", { class: "devchip on" }, "⌨ Teclado"));
  for (const p of app.pads?.list() || []) devs.append(h("span", { class: "devchip on" }, `🎮 ${p.device} · ${p.kindName}`));
  const midiIns = app.midiDriver?.active ? app.midiDriver.ports().inputs.filter(p => p.state === "connected") : [];
  for (const p of midiIns) devs.append(h("span", { class: "devchip on" }, "🎹 " + p.name));
  wrap.append(devs);
  if (!(app.pads?.list() || []).length) wrap.append(hint(app.pads?.supported
    ? "¿Tienes un mando de Xbox o PlayStation? Conéctalo por USB o Bluetooth y pulsa cualquier botón: aparecerá aquí."
    : "Este navegador no lee mandos de juego (en la app de Windows y en el APK sí)."));

  // Último botón pulsado (para comprobar que llega).
  const last = h("p", { class: "lastin" });
  const paint = () => {
    if (!last.isConnected) return;
    const e = P.monitor[P.monitor.length - 1];
    last.textContent = e && Date.now() - e.t < 8000 ? "Último: " + (e.label || e.key) : "Pulsa cualquier botón para comprobar que llega.";
    setTimeout(paint, 300);
  };
  paint();
  wrap.append(last);

  // Asignar: qué hacer → pulsar.
  const sel = h("select", { class: "sel" }, ...quickTargets(app).map(([v, l]) => h("option", { value: v, selected: v === ui.target }, l)));
  sel.addEventListener("change", () => { ui.target = sel.value; });
  wrap.append(h("div", { class: "lbl" }, "1 · Qué quieres que haga"), sel,
    h("div", { class: "lbl" }, "2 · Pulsa «Asignar» y luego el botón"),
    btn({ label: "Asignar un botón", ic: "knob", kind: "block primary", onClick: () => A.learn(ui.target) }));

  // Mapa listo para cada mando.
  const pl = app.pads?.list() || [];
  if (pl.length) wrap.append(h("div", { class: "lbl" }, "Mapa listo para el mando"),
    hint("A = GO · B = anterior · X = play · Y = apagón · LB/RB = escenas · RT = bajar brillo · cruceta = opacidad / al azar"),
    row(...pl.map(p => btn({ label: p.device, ic: "plus", kind: "wide", onClick: () => A.loadBasicPadMap(p.device) }))));

  // Lo que ya está asignado, por dispositivo.
  const maps = C.mappings.filter(m => ["key", "gamepad", "midi"].includes(m.src));
  if (maps.length) {
    const groups = new Map();
    for (const m of maps) { const k = devName(m); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(m); }
    const list = h("div", { class: "ctlmaps" });
    for (const [name, ms] of groups) {
      list.append(h("div", { class: "lbl" }, `${name} · ${ms.length}`));
      for (const m of ms) {
        const d = describe(app, m.target);
        list.append(h("div", { class: `item ${m.enabled === false ? "off" : ""}` },
          h("span", {}, h("b", {}, app.mappingLabel(m).replace(/^(MIDI|Tecla) (\* )?/, "")), " → ", d ? d.name : "⚠ ya no existe"),
          btn({ ic: "trash", kind: "icon", title: "Quitar", onClick: () => { C.mappings.splice(C.mappings.indexOf(m), 1); P.dropMods(m.id); app.paramMappingsChanged(); app.renderPanel(); toast("Asignación quitada"); } })));
      }
    }
    wrap.append(list);
  } else wrap.append(hint("Todavía no hay botones asignados."));
  wrap.append(hint("Consejo: también puedes hacer clic derecho (o mantener pulsado) en cualquier deslizador → «Aprender…»."));
  return wrap;
}
