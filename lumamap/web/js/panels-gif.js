// web/js/panels-gif.js
// «Buscar GIF animado»: escribe qué buscas (o toca una idea), toca un GIF y entra
// en la proyección: con fundido en la superficie elegida, como capa encima, como
// «siguiente» o solo a la biblioteca. Funciona igual en Windows, Android y navegador
// (en el navegador, algunos sitios no dejan descargar: se avisa claramente).
import { h, row, btn, segmented, hint, toast, dialog, closeDialog } from "./ui.js";
import { GIF_SOURCES, GIF_IDEAS, searchGifs, downloadGif, GifError } from "./gifsearch.js";

const ui = { q: "", source: "openverse", mode: "" };
const KEY = "lumamap.giphyKey";
const getKey = () => { try { return localStorage.getItem(KEY) || ""; } catch { return ""; } };
const setKey = (k) => { try { k ? localStorage.setItem(KEY, k) : localStorage.removeItem(KEY); } catch {} };

/**
 * opts.query: búsqueda inicial · opts.surfaceId: superficie · opts.mode: "go" | "next" | "layer" | "library"
 */
export function openGifSearch(app, opts = {}) {
  const S = app.S, A = app.actions;
  if (opts.query) ui.q = opts.query;
  const surfaceId = opts.surfaceId || S.sel || null;
  const sName = S.project.surfaces.find(s => s.id === surfaceId)?.name;
  const modes = [...(sName ? [["go", `Entrar ya en «${sName.slice(0, 18)}»`], ["next", "Preparar como siguiente"]] : []), ["layer", "Capa nueva encima"], ["library", "Solo a la biblioteca"]];
  ui.mode = opts.mode && modes.some(m => m[0] === opts.mode) ? opts.mode : modes.some(m => m[0] === ui.mode) ? ui.mode : modes[0][0];

  let page = 1, busy = false;
  const status = h("p", { class: "hint gifstatus" });
  const grid = h("div", { class: "gifgrid" });
  const more = btn({ label: "Más resultados", kind: "block", onClick: () => run(page + 1) });
  more.style.display = "none";
  const input = h("input", { class: "text-in", type: "search", value: ui.q, placeholder: "Busca: fuego, neón, corazones, confeti…" });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") run(1); });
  const keyBox = h("div", {});

  const drawKey = () => {
    keyBox.innerHTML = "";
    if (ui.source !== "giphy") return;
    const k = getKey();
    if (k) { keyBox.append(row(hint("GIPHY listo (clave guardada en este equipo)."), btn({ label: "Quitar clave", onClick: () => { setKey(""); drawKey(); } }))); return; }
    const ki = h("input", { class: "text-in", placeholder: "Pega aquí tu clave de GIPHY" });
    keyBox.append(hint("GIPHY necesita una clave gratuita: entra en developers.giphy.com → «Create an App» → «API» y copia la clave. Solo se pide una vez."),
      row(ki, btn({ label: "Guardar", kind: "primary", onClick: () => { const v = ki.value.trim(); if (!v) return; setKey(v); drawKey(); run(1); } })));
  };

  async function add(item, cell) {
    if (busy) return;
    busy = true; cell?.classList.add("loading");
    status.textContent = "Descargando «" + item.title + "»…";
    try {
      const file = await downloadGif(item);
      const r = await A.addGif(file, { mode: ui.mode, surfaceId, credit: item.credit });
      if (r) { closeDialog(); toast(r); }
    } catch (e) {
      status.textContent = e instanceof GifError ? e.message : "No se pudo añadir: " + (e?.message || e);
    } finally { busy = false; cell?.classList.remove("loading"); }
  }

  async function run(p = 1) {
    ui.q = input.value.trim();
    if (ui.source === "giphy" && !getKey()) { drawKey(); status.textContent = "Falta la clave de GIPHY (o usa Openverse, que es gratis sin cuenta)."; return; }
    page = p;
    if (p === 1) grid.innerHTML = "";
    status.textContent = "Buscando…"; more.style.display = "none";
    try {
      const { items, more: hasMore } = await searchGifs(ui.q, { source: ui.source, key: getKey(), page: p });
      for (const it of items) {
        const cell = h("button", { class: "gifcell", title: it.title + (it.credit ? "\n" + it.credit : "") },
          h("img", { src: it.thumb, alt: it.title, loading: "lazy", referrerpolicy: "no-referrer" }),
          it.credit ? h("small", {}, it.credit) : null);
        cell.addEventListener("click", () => add(it, cell));
        grid.append(cell);
      }
      status.textContent = grid.children.length ? "Toca un GIF para añadirlo." + (ui.source === "openverse" ? " Son de licencia libre: cita al autor si lo pide la licencia." : "")
        : "No hay resultados. Prueba otra palabra (en inglés suele haber más: fire, neon, hearts…).";
      more.style.display = hasMore && items.length ? "" : "none";
    } catch (e) {
      status.textContent = e instanceof GifError ? e.message : "No se pudo buscar. " + (e?.message || "");
    }
  }

  const link = h("input", { class: "text-in", placeholder: "…o pega el enlace de un GIF (GIPHY, Tenor, una web)" });
  const content = h("div", { class: "gifsearch" },
    row(input, btn({ label: "Buscar", ic: "search", kind: "primary", onClick: () => run(1) })),
    h("div", { class: "chips" }, ...GIF_IDEAS.map(q => h("button", { class: "chip", onclick: () => { input.value = q; run(1); } }, q))),
    segmented({ options: GIF_SOURCES, value: ui.source, small: true, onChange: (v) => { ui.source = v; drawKey(); run(1); } }),
    keyBox,
    h("div", { class: "lbl" }, "Al tocar un GIF"),
    segmented({ options: modes, value: ui.mode, small: true, cols: 2, onChange: (v) => { ui.mode = v; } }),
    status, grid, more,
    row(link, btn({ label: "Añadir enlace", ic: "plus", onClick: () => { const u = link.value.trim(); if (u) add({ url: u, title: "GIF" }); } })));
  drawKey();
  dialog({ title: "Buscar GIF animado", content, wide: true, buttons: [] });
  setTimeout(() => input.focus(), 50);
  run(1);
}
