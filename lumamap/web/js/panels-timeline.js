// web/js/panels-timeline.js
// «🎞 Línea de tiempo del show»: todo el show en una sola vista, como en un editor de video.
// Cada escena es un bloque (su duración = su ancho; arrastra el borde derecho para cambiarla),
// con su transición al principio. Debajo, en pistas: las luces de cada escena, su
// automatización grabada y la canción del show (si hay). Un cabezal enseña por dónde va.
// Lee y cambia los datos de siempre (duración, transición, luces, automatización): no es
// una copia aparte, así que la lista de escenas y la línea de tiempo siempre dicen lo mismo.
import { h, section, row, btn, segmented, hint, toast } from "./ui.js";
import { LIGHT_FX } from "./lightfx.js";

const MANUAL = 8;          // lo que ocupa en el dibujo una escena «manual» (sin duración)
const ui = { zoom: "fit" };
const COLS = ["#7c3aed", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#14b8a6", "#8b5cf6"];

/** Inicio y largo de cada escena en la línea de tiempo (segundos). */
export function layoutShow(scenes) {
  let t = 0;
  const out = scenes.map((sc) => {
    const len = sc.duration > 0 ? sc.duration : MANUAL;
    const b = { id: sc.id, start: t, len, manual: !(sc.duration > 0) };
    t += len;
    return b;
  });
  return { blocks: out, total: t };
}
export const fmtTime = (s) => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

export function timelineSection(app) {
  const S = app.S, A = app.actions, P = S.project, sh = P.settings.show;
  const { blocks, total } = layoutShow(P.scenes);
  // «Ajustar»: que todo el show quepa en el ancho real del panel (sin barra de desplazamiento).
  const wrapW = Math.max(260, (document.getElementById("panelBody")?.clientWidth || 640) - 34);
  const pxs = ui.zoom === "fit" ? Math.max(6, (wrapW - 90) / Math.max(10, total)) : { "2": 24, "4": 48 }[ui.zoom] || 12;
  const W = Math.ceil(total * pxs) + 24;
  const x = (t) => 84 + t * pxs;

  const inner = h("div", { class: "tlinner", style: { width: 84 + W + "px" } });
  // Regla con los segundos.
  const step = pxs >= 40 ? 1 : pxs >= 20 ? 5 : pxs >= 8 ? 10 : 30;
  const ruler = h("div", { class: "tlruler", title: "Toca para saltar a ese momento" });
  for (let t = 0; t <= total + 0.01; t += step) ruler.append(h("span", { style: { left: x(t) + "px" } }, fmtTime(t)));
  ruler.addEventListener("click", (e) => {
    const r = inner.getBoundingClientRect(), t = (e.clientX - r.left - 84) / pxs;
    const b = blocks.find(q => t >= q.start && t < q.start + q.len) || blocks.at(-1);
    if (!b) return;
    A.goScene(b.id, { instant: true });
    S.sceneStart = S.clock - Math.max(0, t - b.start);   // el avance automático sigue desde ahí
  });
  inner.append(ruler);

  const track = (name, ...kids) => h("div", { class: "tltrack" }, h("b", { class: "tlname" }, name), ...kids);
  // Pista de escenas.
  const scTrack = track("Escenas");
  blocks.forEach((b, i) => {
    const sc = P.scenes[i], col = COLS[i % COLS.length];
    const trW = Math.min(b.len * pxs, ((sc.trMs ?? P.settings.transitionMs) / 1000) * pxs);
    const grip = h("i", { class: "tlgrip", title: "Arrastra para cambiar la duración" });
    const lab = h("small", {}, b.manual ? "manual" : `${+sc.duration.toFixed(1)} s`);
    const el = h("div", { class: `tlblock ${sc.id === P.sceneId ? "on" : ""} ${b.manual ? "manual" : ""}`, "data-scene": sc.id, style: { left: x(b.start) + "px", width: b.len * pxs + "px", "--c": col },
      title: `${sc.name} · ${b.manual ? "manual (pasa con GO)" : sc.duration + " s"}${sc.tc ? " · timecode " + sc.tc : ""}`,
      onclick: (e) => { if (e.target === grip) return; A.goScene(sc.id); } },
      h("span", { class: "tltr", style: { width: trW + "px" } }), h("span", { class: "tlbn" }, `${i + 1} · ${sc.name}`), lab, grip);
    el.style.setProperty("--c", col);
    // Arrastrar el borde: duración en pasos de ½ s (mínimo 1 s).
    grip.addEventListener("pointerdown", (e) => {
      e.stopPropagation(); e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      const x0 = e.clientX, len0 = b.len;
      const move = (ev) => {
        const len = Math.max(1, Math.round((len0 + (ev.clientX - x0) / pxs) * 2) / 2);
        el.style.width = len * pxs + "px"; lab.textContent = `${len} s`;
        sc.duration = len;
      };
      const up = () => { grip.removeEventListener("pointermove", move); app.changed(); app.commit(); app.renderPanel(); };
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", up, { once: true });
      grip.addEventListener("pointercancel", up, { once: true });
    });
    scTrack.append(el);
  });
  // Pista de luces: el efecto de luces de cada escena (entra con la escena).
  const ltTrack = track("Luces");
  blocks.forEach((b, i) => {
    const sc = P.scenes[i];
    const sel = h("select", { class: "tlsel", title: "Efecto de luces al entrar en esta escena", style: { left: x(b.start) + "px", width: Math.max(40, b.len * pxs - 4) + "px" } },
      h("option", { value: "" }, "— sin cambio"), ...LIGHT_FX.map(f => h("option", { value: f.name, selected: sc.lights === f.name }, f.name)));
    sel.addEventListener("change", () => { app.edit(() => { if (sel.value) sc.lights = sel.value; else delete sc.lights; }); toast(sel.value ? `Luces en «${sc.name}»: ${sel.value}` : "Sin cambio de luces"); });
    ltTrack.append(sel);
  });
  // Pista de automatización: lo grabado en cada escena, dibujado.
  const auTrack = track("Automat.");
  blocks.forEach((b, i) => {
    const sc = P.scenes[i], lanes = (sh.lanes || []).filter(l => l.sceneId === sc.id && l.points.length > 1);
    if (!lanes.length) return;
    const w = Math.max(20, b.len * pxs - 4), H = 26;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "tlauto"); svg.setAttribute("width", w); svg.setAttribute("height", H);
    svg.style.left = x(b.start) + "px";
    for (const [k, ln] of lanes.slice(0, 3).entries()) {
      const vs = ln.points.map(p => p[1]), lo = Math.min(...vs), hi = Math.max(...vs) || 1, span = hi - lo || 1;
      const pts = ln.points.filter(p => p[0] <= b.len).map(p => `${(p[0] / b.len) * w},${H - 3 - ((p[1] - lo) / span) * (H - 6)}`).join(" ");
      const pl = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      pl.setAttribute("points", pts); pl.setAttribute("fill", "none"); pl.setAttribute("stroke", COLS[(k + 2) % COLS.length]); pl.setAttribute("stroke-width", "1.5");
      svg.append(pl);
    }
    const t = document.createElementNS("http://www.w3.org/2000/svg", "title"); t.textContent = `${lanes.length} parámetro(s) grabado(s)`; svg.append(t);
    auTrack.append(svg);
  });
  inner.append(scTrack, ltTrack, auTrack);
  // Pista de la canción del show (si hay una sonando o cargada).
  const song = A.songState?.();
  if (song && song.duration) inner.append(track("Canción", h("div", { class: "tlsong", style: { left: x(0) + "px", width: song.duration * pxs + "px" } }, "♪ " + song.name)));

  // Cabezal: por dónde va el show.
  const head = h("i", { class: "tlhead" });
  inner.append(head);
  const tick = () => {
    if (!head.isConnected) return;
    const i = P.scenes.findIndex(s => s.id === P.sceneId), b = blocks[i];
    if (b) head.style.left = x(b.start + Math.min(b.len, Math.max(0, S.clock - S.sceneStart))) + "px";
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  const autoN = blocks.filter(b => !b.manual).length;
  return section(`🎞 Línea de tiempo · ${fmtTime(total)}`,
    hint("Todo el show de un vistazo. Arrastra el borde derecho de una escena para cambiar cuánto dura; toca la regla para saltar; elige las luces de cada escena en su pista. Las escenas «manual» esperan a GO."),
    row(segmented({ options: [["fit", "Ajustar"], ["1", "1×"], ["2", "2×"], ["4", "4×"]], value: ui.zoom, small: true, onChange: (v) => { ui.zoom = v; app.renderPanel(); } }),
      btn({ label: "▶ Desde el principio", kind: "small primary", title: "Primera escena, avance automático y Play", onClick: () => {
        A.goScene(P.scenes[0].id, { instant: true });
        app.edit(() => { P.settings.autoAdvance = true; });
        S.sceneStart = S.clock;
        if (!S.playing) A.togglePlay();
        app.renderPanel();
      } })),
    autoN < blocks.length ? hint(`${blocks.length - autoN} escena(s) manual(es): ocupan ${MANUAL} s en el dibujo; dales una duración arrastrando su borde.`) : null,
    h("div", { class: "tlscroll" }, inner));
}
