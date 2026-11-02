// web/js/panels-visuals.js
// Contenido → «🎛 Mis visuales»: tus presets con miniatura, por carpetas. Un toque los pone en la
// superficie elegida; ◀ ▶ (o MIDI/teclado: «Mis visuales: siguiente/anterior») los recorre.
import { h, btn, hint, toast, dialog, closeDialog, prompt, confirmDlg } from "./ui.js";
import * as Vis from "./visuals.js";

const LS_FOLDER = "lumamap:visFolder";
const readFolder = () => { try { return localStorage.getItem(LS_FOLDER) || ""; } catch { return ""; } };
const writeFolder = (f) => { try { localStorage.setItem(LS_FOLDER, f); } catch {} };
const download = (name, text) => { const a = h("a", { href: URL.createObjectURL(new Blob([text], { type: "application/json" })), download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000); };

export function visualsSection(app) {
  const A = app.actions;
  const list = Vis.loadVisuals(), dirs = Vis.folders(list);
  let folder = readFolder();
  if (folder && !dirs.includes(folder)) folder = "";
  const shown = folder ? list.filter(v => v.folder === folder) : list;
  const save = (l) => { try { Vis.saveVisuals(l); } catch (e) { toast(e.message, "err"); } app.renderPanel(); };

  async function saveNew() {
    const name = h("input", { class: "text-in", value: "", placeholder: "Nombre (p. ej. «Drop neón»)", "aria-label": "Nombre del visual", maxlength: 60 });
    const dir = h("input", { class: "text-in", value: folder || "General", list: "visfolders", "aria-label": "Carpeta", maxlength: 40 });
    const dl = h("datalist", { id: "visfolders" }, ...dirs.map(d => h("option", { value: d })));
    const ok = await new Promise((res) => dialog({ title: "💾 Guardar como visual", content: h("div", {},
      hint("Se guarda lo de esta superficie: contenido, efectos, opacidad, mezcla y lo que se mueve solo (Señales y pistas)."),
      h("label", {}, "Nombre", name), h("label", {}, "Carpeta", dir, dl),
      h("div", { class: "row" }, btn({ label: "Cancelar", onClick: () => { closeDialog(); res(false); } }), btn({ label: "Guardar", kind: "primary", onClick: () => { closeDialog(); res(true); } }))) }));
    if (!ok) return;
    const v = await A.visualSave(name.value.trim(), dir.value.trim() || "General");
    if (v) { writeFolder(v.folder); app.renderPanel(); }
  }
  function importFiles() {
    const inp = h("input", { type: "file", accept: ".json,application/json", multiple: true });
    inp.onchange = async () => {
      let cur = Vis.loadVisuals(), n = 0;
      for (const f of inp.files || []) {
        try { const add = Vis.importVisuals(await f.text(), cur); cur = [...add, ...cur]; n += add.length; }
        catch (e) { toast(`${f.name}: ${e.message}`, "err"); }
      }
      if (n) { save(cur); toast(`🎛 ${n} visual${n === 1 ? "" : "es"} importado${n === 1 ? "" : "s"}`); }
    };
    inp.click();
  }
  function menu(v) {
    dialog({ title: `🎛 ${v.name}`, content: h("div", { class: "col" },
      v.media.length ? hint("Usa el archivo «" + v.media.join(", ") + "»: tiene que estar en la biblioteca del proyecto.") : null,
      btn({ label: "▶ Poner en la superficie elegida", kind: "primary", onClick: () => { closeDialog(); A.visualApply(v.id); } }),
      btn({ label: "✎ Renombrar", onClick: async () => { closeDialog(); const nm = await prompt("Nombre del visual", v.name); if (nm) save(Vis.loadVisuals().map(x => x.id === v.id ? { ...x, name: nm.slice(0, 60) } : x)); } }),
      btn({ label: "📁 Mover a otra carpeta", onClick: async () => { closeDialog(); const d = await prompt("Carpeta", v.folder); if (d) save(Vis.loadVisuals().map(x => x.id === v.id ? { ...x, folder: d.slice(0, 40) } : x)); } }),
      btn({ label: "♻ Actualizar con lo de la superficie", title: "Sustituye este visual por lo que tiene ahora la superficie elegida", onClick: async () => { closeDialog(); const nv = await A.visualSave(v.name, v.folder); if (nv) save(Vis.loadVisuals().filter(x => x.id !== v.id)); } }),
      btn({ label: "⬇ Exportar este visual", onClick: () => { closeDialog(); download(`visual-${v.name.replace(/[^\w-]+/g, "_")}.json`, Vis.exportVisuals([v])); } }),
      btn({ label: "🗑 Borrar", kind: "danger", onClick: async () => { closeDialog(); if (await confirmDlg("Borrar visual", `¿Borrar «${v.name}»?`, "Borrar")) save(Vis.loadVisuals().filter(x => x.id !== v.id)); } })) });
  }
  const cur = app.visualCurrent?.();
  const grid = h("div", { class: "visgrid" }, ...shown.map(v => {
    const card = h("button", { class: `viscard ${v.id === cur ? "on" : ""}`, "data-vis": v.id, title: `${v.name} · ${v.folder}\nToque: ponerlo · clic derecho o ⋯: más`, onclick: () => { A.visualApply(v.id); app.renderPanel(); } },
      v.thumb ? h("img", { src: v.thumb, alt: "" }) : h("span", { class: "visnothumb" }, "🎛"),
      h("b", {}, v.name), h("small", {}, v.folder));
    card.addEventListener("contextmenu", (e) => { e.preventDefault(); menu(v); });
    const more = h("span", { class: "vismore", role: "button", "aria-label": "Más opciones de " + v.name, onclick: (e) => { e.stopPropagation(); menu(v); } }, "⋯");
    card.append(more);
    return card;
  }));
  const chips = dirs.length > 1 ? h("div", { class: "chips" },
    h("button", { class: `chip ${!folder ? "on" : ""}`, onclick: () => { writeFolder(""); app.renderPanel(); } }, `Todas (${list.length})`),
    ...dirs.map(d => h("button", { class: `chip ${folder === d ? "on" : ""}`, onclick: () => { writeFolder(d); app.renderPanel(); } }, `📁 ${d} (${list.filter(v => v.folder === d).length})`))) : null;
  const body = h("div", { class: "visbody" },
    h("div", { class: "row" },
      btn({ label: "💾 Guardar esta superficie", kind: "small primary", onClick: () => saveNew() }),
      list.length ? btn({ label: "◀", kind: "small", title: "Visual anterior (MIDI/teclado: «Mis visuales: anterior»)", onClick: () => { A.visualStep(-1); app.renderPanel(); } }) : null,
      list.length ? btn({ label: "▶", kind: "small", title: "Visual siguiente", onClick: () => { A.visualStep(1); app.renderPanel(); } }) : null,
      h("span", { class: "grow" }),
      btn({ label: "⬆ Importar", kind: "small", title: "Abrir visuales de un archivo .json", onClick: () => importFiles() }),
      list.length ? btn({ label: "⬇ Exportar", kind: "small", title: folder ? `Exportar la carpeta «${folder}»` : "Exportar todos", onClick: () => download(`visuales-${(folder || "todos").replace(/[^\w-]+/g, "_")}.json`, Vis.exportVisuals(shown)) }) : null),
    chips, list.length ? grid : hint("Guarda aquí tus combinaciones favoritas (contenido + efectos + lo que se mueve con la música) y cámbialas con un toque durante el show."));
  return h("details", { class: "sec visuals", open: list.length ? true : undefined }, h("summary", {}, h("h3", {}, `🎛 Mis visuales${list.length ? ` (${list.length})` : ""}`)), body);
}
