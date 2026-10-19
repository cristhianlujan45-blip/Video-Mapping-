// web/js/panels-mypanel.js
// Vista de «Mi panel»: controles grandes que eliges tú (cualquier parámetro que se pueda asignar a
// MIDI), en En vivo, a pantalla grande y en el mando del móvil.
import { h, section, btn, hint, slider, dialog, closeDialog } from "./ui.js";
import { describe, catalog } from "./params.js";
import { MYPANEL_MAX } from "./mypanel.js";
import { tipCard } from "./tutorial.js";

let editing = false;
const fmtOf = (d) => (v) => d.min === 0 && d.max === 1 ? Math.round(v * 100) + "%" : (Math.abs(d.max - d.min) >= 20 ? Math.round(v) : v.toFixed(2));

function control(app, it, big = false) {
  const d = describe(app, it.param);
  const list = app.S.project.settings.panel;
  const remove = editing ? btn({ label: "✕", kind: "icon danger", title: "Quitar del panel", onClick: () => { app.edit(() => { app.S.project.settings.panel = list.filter(x => x !== it); }); app.renderPanel(); } }) : null;
  if (!d) return h("div", { class: "mpctl gone" }, h("small", {}, `«${it.label || it.param}» ya no existe`), remove);
  const name = it.label || d.name;
  let el;
  if (d.kind === "float") el = slider({ label: name, min: d.min, max: d.max, step: d.step || (d.max - d.min) / 200, value: +d.get(), def: d.def, fmt: fmtOf(d), onInput: (v) => { d.set(v); app.paramTouched?.(d.id); }, param: d.id });
  else if (d.kind === "bool") {
    el = btn({ label: name, kind: `mpbtn ${d.get() ? "on" : ""}`, onClick: () => { d.set(!d.get()); app.paramTouched?.(d.id); el.classList.toggle("on", !!d.get()); } });
  } else el = btn({ label: name, kind: "mpbtn primary", onClick: () => { d.set(true); app.paramTouched?.(d.id); } });
  return h("div", { class: `mpctl ${big ? "big" : ""} k-${d.kind}` }, el, remove);
}

/** Elegir un parámetro (los mismos que se pueden asignar a MIDI), con buscador. */
export async function pickParam(app) {
  const groups = catalog(app);
  const search = h("input", { type: "search", class: "text-in", placeholder: "Buscar control (brillo, opacidad, apagón, GO…)" });
  const out = h("div", {});
  const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const have = new Set(app.S.project.settings.panel.map(x => x.param));
  const draw = () => {
    const q = norm(search.value.trim());
    out.replaceChildren(...groups.map(g => {
      const items = g.items.filter(i => !have.has(i.id) && (!q || norm(i.name + " " + g.group).includes(q)));
      return items.length ? h("div", {}, h("div", { class: "lbl" }, g.group),
        h("div", { class: "chips" }, ...items.slice(0, 60).map(i => h("button", { class: "chip", onclick: () => closeDialog(i.id) }, i.name)))) : null;
    }).filter(Boolean));
    if (!out.children.length) out.append(hint("Nada con ese nombre."));
  };
  search.addEventListener("input", draw);
  draw();
  return dialog({ title: "Añadir a Mi panel", content: h("div", {}, search, out), wide: true });
}

async function addControl(app) {
  const P = app.S.project.settings;
  if (P.panel.length >= MYPANEL_MAX) return;
  const id = await pickParam(app);
  if (!id) return;
  app.edit(() => { P.panel.push({ param: id, label: "" }); });
  app.renderPanel();
}

/** Mi panel a pantalla grande (tableta o pantalla táctil junto a la mesa). */
export function openMyPanelBig(app) {
  const list = app.S.project.settings.panel;
  return dialog({ title: "🎚 Mi panel", wide: true, content: h("div", { class: "mpgrid big" }, ...list.map(it => control(app, it, true))) });
}

export function myPanelSection(app) {
  const list = app.S.project.settings.panel;
  return section("🎚 Mi panel",
    tipCard(app, "mypanel"),
    list.length
      ? h("div", {}, h("div", { class: "mpgrid" }, ...list.map(it => control(app, it))))
      : hint("Junta aquí los controles que más usas (como un panel de TouchDesigner): brillo, opacidad de una superficie, un efecto, GO, apagón, luces… También salen en el mando del móvil."),
    h("div", { class: "row" },
      list.length < MYPANEL_MAX ? btn({ label: "＋ Añadir control", kind: "wide", onClick: () => addControl(app) }) : null,
      list.length ? btn({ label: editing ? "Listo" : "Editar", kind: `wide ${editing ? "on" : ""}`, onClick: () => { editing = !editing; app.renderPanel(); } }) : null,
      list.length ? btn({ label: "⛶ Grande", kind: "wide", onClick: () => openMyPanelBig(app) }) : null));
}
