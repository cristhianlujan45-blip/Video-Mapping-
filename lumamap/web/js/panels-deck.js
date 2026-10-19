// web/js/panels-deck.js
// Vista de la «Mesa de clips» (deck.js): filas = superficies, columnas numeradas. Tocar una casilla
// la lanza; tocar «▶ 3» lanza la columna 3 en todas. Una casilla vacía (o mantener pulsada una
// llena) la elige para rellenarla desde abajo: animaciones, shaders, tus videos/fotos o un color.
import { h, section, btn, segmented, toggle, hint, toast, dialog, tiles, lazyThumb, stepper } from "./ui.js";
import { QUANTIZE, AUTOPILOT, DECK_MAX_COLS, cleanClip } from "./deck.js";
import { ANIM_LIBRARY, ANIM_CATEGORIES } from "./model.js";
import { animThumb } from "./thumbs.js";
import { clipOfAnim, clipOfMedia } from "./panels-vj.js";

const COLORS = ["#ffffff", "#ff0040", "#ff8a00", "#ffe600", "#39ff6a", "#00e5ff", "#2d6bff", "#b44dff", "#ff2d95", "#000000"];

/** Miniatura de un clip: imagen (o función perezosa) o color. */
function clipThumb(app, c) {
  if (c.kind === "media") return app.S.project.media.find(m => m.id === c.mediaId)?.thumb || "";
  if (c.kind === "color") return null;
  const lib = ANIM_LIBRARY.find(a => a.id === c.id);
  return () => animThumb(lib || { id: c.id || c.shaderId || c.gen, gen: c.gen, color: c.color, color2: c.color2, speed: c.speed, scale: c.scale, fx: c.fx, shader: c.shaderId });
}

export async function openDeck(app) {
  const S = app.S, A = app.actions;
  const D = () => S.project.settings.deck;
  const ui = { pick: null, cat: "Todas", src: "anim" };
  const body = h("div", { class: "deck" });
  const save = () => { app.changed(); app.commitSoon(); };
  const setCell = (sid, col, clip) => {
    const d = D(), row = d.cells[sid] || (d.cells[sid] = []);
    row[col] = clip ? cleanClip(clip) : null;
    if (!row.some(Boolean)) delete d.cells[sid];
    save();
  };

  let grid;
  function cellEl(s, col) {
    const c = D().cells[s.id]?.[col] || null;
    const picked = ui.pick?.sid === s.id && ui.pick?.col === col;
    const el = h("button", { class: `dcell ${c ? "full" : "empty"} ${picked ? "picked" : ""}`, "data-sid": s.id, "data-col": col, title: c ? `${c.name} · mantén pulsado para cambiarlo` : "Vacía: tócala para elegir un clip" });
    if (c) {
      const th = clipThumb(app, c);
      if (th === null) el.style.background = c.color;
      else { const img = h("img", { alt: "" }); if (typeof th === "function") lazyThumb(img, th); else if (th) img.src = th; el.append(img); }
      el.append(h("span", { class: "nm" }, c.name));
    } else el.append(h("span", { class: "plus" }, "+"));
    let held = false, t = 0;
    el.addEventListener("pointerdown", () => { held = false; t = setTimeout(() => { held = true; ui.pick = { sid: s.id, col }; draw(); }, 550); });
    const cancel = () => clearTimeout(t);
    el.addEventListener("pointerup", cancel); el.addEventListener("pointerleave", cancel);
    el.addEventListener("contextmenu", (e) => { e.preventDefault(); ui.pick = { sid: s.id, col }; draw(); });
    el.addEventListener("click", () => {
      if (held) return;
      if (!c || picked) { ui.pick = { sid: s.id, col }; draw(); return; }
      A.deckLaunch(s.id, col) ? paintState() : toast("Ese video ya no está en la biblioteca");
    });
    return el;
  }
  // Qué suena y qué espera al golpe (se repinta solo, sin redibujar todo).
  function paintState() {
    if (!grid?.isConnected) return;
    const st = app.deckState;
    grid.querySelectorAll(".dcell").forEach(el => {
      const sid = el.dataset.sid, col = +el.dataset.col;
      el.classList.toggle("live", st.playing[sid] === col);
      el.classList.toggle("wait", st.pending.some(p => p.sid === sid && p.col === col));
    });
  }

  function picker() {
    const p = ui.pick, surf = p && S.project.surfaces.find(s => s.id === p.sid);
    if (!surf) return hint("Toca una casilla vacía para elegir qué clip va ahí. Mantén pulsada una llena para cambiarla.");
    const cur = D().cells[p.sid]?.[p.col];
    const put = (clip) => { setCell(p.sid, p.col, clip); ui.pick = p.col + 1 < D().cols ? { sid: p.sid, col: p.col + 1 } : null; draw(); };
    const media = S.project.media.filter(m => (m.kind === "video" || m.kind === "image" || m.kind === "anim") && !m.pending);
    const catalog = ANIM_LIBRARY.filter(a => a.cat !== "Calibración" && (ui.cat === "Todas" || a.cat === ui.cat));
    return section(`Casilla ${p.col + 1} de «${surf.name}»`,
      segmented({ options: [["anim", "Animaciones y shaders"], ["media", `Tus videos (${media.length})`], ["color", "Color"]], value: ui.src, small: true, onChange: (v) => { ui.src = v; draw(); } }),
      ui.src === "anim" ? h("div", {},
        h("div", { class: "chips" }, ...["Todas", ...ANIM_CATEGORIES.filter(c => c !== "Calibración")].map(c => h("button", { class: `chip ${ui.cat === c ? "on" : ""}`, onclick: () => { ui.cat = c; draw(); } }, c))),
        tiles(catalog.map(a => ({ id: a.id, label: a.name, img: () => animThumb(a) })), { cols: 4, onPick: (id) => put(clipOfAnim(ANIM_LIBRARY.find(a => a.id === id))) })) : null,
      ui.src === "media" ? (media.length ? tiles(media.map(m => ({ id: m.id, label: m.name, img: m.thumb || "" })), { cols: 4, onPick: (id) => put(clipOfMedia(S.project.media.find(m => m.id === id))) })
        : h("div", {}, hint("Aún no hay videos ni fotos en la biblioteca."), btn({ label: "Importar video, imagen o GIF", ic: "upload", kind: "block", onClick: async () => { await A.importMedia("library"); draw(); } }))) : null,
      ui.src === "color" ? h("div", { class: "chips" }, ...COLORS.map(c => h("button", { class: "chip swatch", style: `background:${c};width:38px;height:38px`, title: c, onclick: () => put({ kind: "color", name: "Color " + c, color: c }) }))) : null,
      cur ? btn({ label: "Vaciar esta casilla", kind: "block danger", onClick: () => { setCell(p.sid, p.col, null); draw(); } }) : null);
  }

  function fillAuto() {
    const pool = ANIM_LIBRARY.filter(a => a.cat !== "Calibración");
    for (const s of S.project.surfaces) for (let c = 0; c < D().cols; c++) if (!D().cells[s.id]?.[c]) setCell(s.id, c, clipOfAnim(pool[Math.floor(Math.random() * pool.length)]));
    draw();
    toast("Mesa llena: toca una columna para lanzarla");
  }

  function draw() {
    const d = D(), surfs = S.project.surfaces.filter(s => !s.hidden);
    grid = h("div", { class: "dgrid", style: `grid-template-columns: 96px repeat(${d.cols}, 72px)` },
      h("div", { class: "dhead corner" }, "Superficie"),
      ...Array.from({ length: d.cols }, (_, c) => h("button", { class: "dhead colbtn", title: `Lanzar la columna ${c + 1} en todas`, onclick: () => { A.deckLaunchCol(c) ? paintState() : toast("Columna vacía"); } }, `▶ ${c + 1}`)),
      ...surfs.flatMap(s => [h("div", { class: "drow" }, s.name), ...Array.from({ length: d.cols }, (_, c) => cellEl(s, c))]));
    body.replaceChildren(
      surfs.length ? h("div", { class: "dscroll" }, grid) : hint("Primero crea una superficie (Añadir) para tener filas."),
      h("div", { class: "deckopts" },
        h("div", { class: "lbl" }, "Lanzar"),
        segmented({ options: QUANTIZE, value: d.quantize, small: true, onChange: (v) => { d.quantize = v; save(); } }),
        h("div", { class: "lbl" }, "Autopiloto: la siguiente columna cada…"),
        segmented({ options: AUTOPILOT.map(([v, l]) => [String(v), l]), value: String(d.autopilot), small: true, onChange: (v) => { d.autopilot = +v; save(); } }),
        toggle({ label: "Autopiloto al azar", value: d.random, onChange: (v) => { d.random = v; save(); } }),
        stepper({ label: "Columnas", value: d.cols, min: 1, max: DECK_MAX_COLS, onChange: (v) => { d.cols = v; for (const r of Object.values(d.cells)) r.length = Math.min(r.length, v); save(); draw(); } }),
        btn({ label: "✨ Llenar las casillas vacías con animaciones", kind: "block", onClick: fillAuto })),
      picker());
    paintState();
  }
  draw();
  const t = setInterval(() => { if (!body.isConnected) return clearInterval(t); paintState(); }, 250);
  await dialog({ title: "🎛 Mesa de clips", content: body, wide: true, buttons: [{ label: "Listo", kind: "primary", value: null }] });
  clearInterval(t);
  app.renderPanel();
}

/** Sección del panel En vivo. */
export function deckSection(app) {
  const d = app.S.project.settings.deck, n = Object.values(d.cells).reduce((k, r) => k + r.filter(Boolean).length, 0);
  return section("🎛 Mesa de clips",
    hint("Como en Resolume: cada superficie es una fila de clips; toca uno y entra con la transición, o toca una columna y cambian todas. Al golpe o al compás, y con autopiloto."),
    btn({ label: n ? `Abrir la mesa (${n} clips)` : "Abrir la mesa de clips", kind: "block primary", onClick: () => app.openDeck() }));
}
