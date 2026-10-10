// web/js/panels-gif.js
// Ventana «GIF animados»: se abre con GIF ya cargados, busca sola mientras escribes
// (en español; se traduce solo), en varias fuentes gratis a la vez (sin cuentas ni
// claves), carga más al bajar y, al tocar uno, entra en la proyección: con fundido en
// la superficie elegida, como capa encima, como «siguiente» o solo a la biblioteca.
// El GIF se empieza a descargar al pasar el ratón por encima: el toque es inmediato.
import { h, row, btn, segmented, hint, toast, dialog, closeDialog } from "./ui.js";
import { GIF_SOURCES, GIF_IDEAS, GIF_DEFAULT, searchAll, searchGifs, downloadGif, GifError, toEnglish } from "./gifsearch.js";

const ui = { q: "", source: "all", mode: "" };
const KEY = "lumamap.giphyKey", CACHE_KEY = "lumamap:gifcache";
const getKey = () => { try { return localStorage.getItem(KEY) || ""; } catch { return ""; } };
const setKey = (k) => { try { k ? localStorage.setItem(KEY, k) : localStorage.removeItem(KEY); } catch {} };
// Resultados ya buscados (en memoria) y los del arranque (guardados: la ventana abre al instante).
const memo = new Map();
const loadSaved = () => { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); } catch { return null; } };
const saveFirst = (q, items) => { try { localStorage.setItem(CACHE_KEY, JSON.stringify({ q, items: items.slice(0, 30), at: Date.now() })); } catch {} };
// Descargas adelantadas (al pasar el ratón): id → promesa del archivo.
const pre = new Map();
const fetchFile = (it) => { if (!pre.has(it.id)) { const p = downloadGif(it); p.catch(() => pre.delete(it.id)); pre.set(it.id, p); if (pre.size > 12) pre.delete(pre.keys().next().value); } return pre.get(it.id); };

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

  let page = 1, busy = false, searchId = 0, more = false, loadingMore = false, timer = 0;
  const status = h("p", { class: "hint gifstatus" });
  const grid = h("div", { class: "gifgrid" });
  const input = h("input", { class: "text-in", type: "search", value: ui.q, placeholder: "Escribe qué buscas: fuego, neón, corazones, confeti…" });
  // Busca sola al escribir (sin pulsar nada).
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => run(1), 450); });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { clearTimeout(timer); run(1); } });
  const keyBox = h("div", {});

  const drawKey = () => {
    keyBox.replaceChildren();
    if (ui.source !== "giphy") return;
    const k = getKey();
    if (k) { keyBox.append(row(hint("GIPHY listo (clave guardada en este equipo)."), btn({ label: "Quitar clave", onClick: () => { setKey(""); drawKey(); } }))); return; }
    const ki = h("input", { class: "text-in", placeholder: "Pega aquí tu clave de GIPHY" });
    keyBox.append(hint("GIPHY es opcional y necesita una clave gratuita (developers.giphy.com → «Create an App» → «API»). Las otras fuentes no necesitan nada."),
      row(ki, btn({ label: "Guardar", kind: "primary", onClick: () => { const v = ki.value.trim(); if (!v) return; setKey(v); drawKey(); run(1); } })));
  };

  async function add(item, cell) {
    if (busy) return;
    busy = true; cell?.classList.add("loading");
    status.textContent = "Añadiendo «" + item.title + "»…";
    try {
      const file = await fetchFile(item);
      const r = await A.addGif(file, { mode: ui.mode, surfaceId, credit: item.credit });
      if (r) { closeDialog(); toast(r); }
    } catch (e) {
      pre.delete(item.id);
      status.textContent = e instanceof GifError ? e.message : "No se pudo añadir: " + (e?.message || e);
    } finally { busy = false; cell?.classList.remove("loading"); }
  }

  const cellOf = (it) => {
    const cell = h("button", { class: "gifcell", title: it.title + (it.credit ? "\n" + it.credit : "") },
      h("img", { src: it.thumb, alt: it.title, loading: "lazy", decoding: "async", referrerpolicy: "no-referrer" }),
      it.credit ? h("small", {}, it.credit) : null);
    cell.querySelector("img").addEventListener("error", () => cell.remove(), { once: true });
    let hover = 0;
    cell.addEventListener("pointerenter", () => { hover = setTimeout(() => fetchFile(it), 180); });
    cell.addEventListener("pointerleave", () => clearTimeout(hover));
    cell.addEventListener("click", () => add(it, cell));
    return cell;
  };
  const skeleton = () => { grid.replaceChildren(...Array.from({ length: 12 }, () => h("div", { class: "gifcell sk" }))); };

  async function run(p = 1) {
    ui.q = input.value.trim();
    if (ui.source === "giphy" && !getKey()) { drawKey(); status.textContent = "Falta la clave de GIPHY (o elige «Todo (gratis)», que no necesita nada)."; return; }
    const id = ++searchId, q = ui.q || GIF_DEFAULT, key = `${ui.source}|${toEnglish(q)}|${p}`;
    page = p;
    // Mientras llega la búsqueda nueva se ven los anteriores (o recuadros de carga si no hay).
    if (p === 1 && !memo.has(key) && !grid.querySelector(".gifcell:not(.sk)")) skeleton();
    const show = (items) => {
      if (id !== searchId) return;
      grid.querySelectorAll(".sk").forEach(e => e.remove());
      const have = new Set([...grid.querySelectorAll(".gifcell")].map(c => c.dataset.url));
      for (const it of items) if (!have.has(it.url)) { const c = cellOf(it); c.dataset.url = it.url; grid.append(c); }
    };
    if (memo.has(key)) {
      const r = memo.get(key);
      if (p === 1) grid.replaceChildren();
      show(r.items); more = r.more; finish(id, null);
      return;
    }
    status.textContent = p === 1 ? `Buscando «${q}»…` : "Cargando más…";
    let first = true;
    try {
      const r = ui.source === "all"
        ? await searchAll(q, { page: p, onItems: (items) => { if (p === 1 && first) { first = false; if (id === searchId) grid.replaceChildren(); } show(items); } })
        : await searchGifs(ui.source === "giphy" ? q : toEnglish(q), { source: ui.source, key: getKey(), page: p }).then(r => { if (p === 1) grid.replaceChildren(); show(r.items); return r; });
      if (id !== searchId) return;
      if (p === 1 && first && ui.source === "all") grid.replaceChildren();   // sin resultados: fuera los anteriores
      memo.set(key, { items: r.items, more: r.more });
      if (p === 1 && !ui.q && ui.source === "all") saveFirst(q, r.items);
      more = r.more; finish(id, null);
    } catch (e) { finish(id, e); }
  }
  function finish(id, err) {
    if (id !== searchId) return;
    loadingMore = false;
    grid.querySelectorAll(".sk").forEach(e => e.remove());
    const n = grid.querySelectorAll(".gifcell").length;
    status.textContent = err ? (err instanceof GifError ? err.message : "No se pudo buscar. " + (err?.message || ""))
      : n ? `Toca un GIF para añadirlo${more ? " · baja para ver más" : ""}. Licencia libre: cita al autor si la licencia lo pide.`
      : "No hay resultados. Prueba con otra palabra (fuego, neón, estrellas…).";
  }
  // Más resultados solos al llegar abajo.
  grid.addEventListener("scroll", () => {
    if (!more || loadingMore || grid.scrollTop + grid.clientHeight < grid.scrollHeight - 200) return;
    loadingMore = true; run(page + 1);
  });

  const link = h("input", { class: "text-in", placeholder: "Pega el enlace de un GIF (GIPHY, Tenor, una web)" });
  const content = h("div", { class: "gifsearch" },
    row(input, btn({ label: "Buscar", ic: "search", kind: "primary", onClick: () => run(1) })),
    h("div", { class: "chips" }, ...GIF_IDEAS.map(q => h("button", { class: "chip", onclick: () => { input.value = q.replace(/^\S+\s/, ""); run(1); } }, q))),
    row(h("div", { class: "lbl" }, "Al tocar un GIF"), segmented({ options: modes, value: ui.mode, small: true, onChange: (v) => { ui.mode = v; } })),
    status, grid,
    h("details", { class: "fold" }, h("summary", {}, "Más opciones (otras fuentes, pegar un enlace)"),
      segmented({ options: GIF_SOURCES, value: ui.source, small: true, onChange: (v) => { ui.source = v; drawKey(); run(1); } }),
      keyBox,
      row(link, btn({ label: "Añadir enlace", ic: "plus", onClick: () => { const u = link.value.trim(); if (u) add({ id: "link:" + u, url: u, title: "GIF" }); } }))));
  drawKey();
  dialog({ title: "🎞 GIF animados", content, wide: true, buttons: [] });
  setTimeout(() => input.focus(), 50);
  // Al abrir: lo último guardado se ve al instante y se actualiza por detrás.
  const saved = !ui.q && ui.source === "all" ? loadSaved() : null;
  if (saved?.items?.length) { grid.replaceChildren(...saved.items.map(it => { const c = cellOf(it); c.dataset.url = it.url; return c; })); status.textContent = "Toca un GIF para añadirlo."; }
  run(1);
}
