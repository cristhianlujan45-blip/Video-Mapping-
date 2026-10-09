// web/js/panels-hologram.js
// Asistente «Holograma»: 4 preguntas sencillas y LumaMap lo monta solo.
//  1 · ¿Qué holograma? (escenario como Tupac, tela/tul o pirámide) — con un dibujo del montaje
//  2 · ¿Qué aparece? (tu video sin fondo, la cámara en vivo, una animación o un texto)
//  3 · ¿Cuántos proyectores? (1 a 4: se reparte la imagen y se funden las uniones)
//  4 · Crear → instrucciones de montaje, proyectar y girar/espejo si hace falta.
import { h, row, btn, segmented, toggle, hint, toast, dialog, closeDialog } from "./ui.js";
import { HOLO_TYPES, HOLO_CUTS, HOLO_SOURCES, defaultHologram, buildHologram, howTo } from "./hologram.js";
import * as M from "./model.js";

/** Dibujos del montaje (SVG sencillo: se entiende de un vistazo). */
const SKETCH = {
  escenario: `<svg viewBox="0 0 160 90"><rect x="0" y="0" width="160" height="90" fill="#0b0d12"/>
    <line x1="58" y1="80" x2="102" y2="22" stroke="#9ff6ff" stroke-width="2.5"/><text x="104" y="22" fill="#9ff6ff" font-size="8">lámina 45°</text>
    <rect x="62" y="78" width="40" height="4" fill="#ddd"/><text x="40" y="89" fill="#aaa" font-size="7">pantalla en el suelo</text>
    <rect x="70" y="2" width="16" height="9" rx="2" fill="#ffb400"/><path d="M78 11 L66 77 M78 11 L98 77" stroke="#ffb400" stroke-dasharray="3 2" opacity=".7"/><text x="88" y="9" fill="#ffb400" font-size="7">proyector</text>
    <circle cx="128" cy="44" r="5" fill="#9ff6ff" opacity=".85"/><rect x="124" y="49" width="8" height="18" rx="3" fill="#9ff6ff" opacity=".85"/><text x="114" y="78" fill="#9ff6ff" font-size="7">lo que se ve</text>
    <text x="4" y="50" fill="#aaa" font-size="7">público →</text></svg>`,
  tul: `<svg viewBox="0 0 160 90"><rect width="160" height="90" fill="#0b0d12"/>
    <rect x="96" y="10" width="3" height="70" fill="#9ff6ff" opacity=".6"/><text x="102" y="16" fill="#9ff6ff" font-size="7">tela (tul)</text>
    <rect x="10" y="38" width="16" height="9" rx="2" fill="#ffb400"/><path d="M26 42 L96 14 M26 42 L96 78" stroke="#ffb400" stroke-dasharray="3 2" opacity=".7"/><text x="6" y="58" fill="#ffb400" font-size="7">proyector</text>
    <circle cx="97" cy="38" r="5" fill="#9ff6ff"/><rect x="93" y="43" width="8" height="18" rx="3" fill="#9ff6ff"/><text x="40" y="86" fill="#aaa" font-size="7">público delante de la tela</text></svg>`,
  piramide: `<svg viewBox="0 0 160 90"><rect width="160" height="90" fill="#0b0d12"/>
    <rect x="40" y="62" width="80" height="8" fill="#333"/><text x="52" y="80" fill="#aaa" font-size="7">pantalla o mesa (P1)</text>
    <path d="M60 22 L100 22 L80 60 Z" fill="#9ff6ff" opacity=".18" stroke="#9ff6ff"/><text x="104" y="30" fill="#9ff6ff" font-size="7">pirámide</text>
    <circle cx="80" cy="36" r="4" fill="#9ff6ff"/><rect x="77" y="40" width="6" height="10" rx="2" fill="#9ff6ff"/></svg>`,
};

const ui = { cfg: null, made: false, testing: null };

export function openHologram(app, preset = {}) {
  const S = app.S, A = app.actions, P = S.project;
  ui.cfg = { ...defaultHologram(), ...(P.settings.hologram || {}), ...preset };
  ui.made = !!P.surfaces.some(s => s.holo) && !Object.keys(preset).length;
  const body = h("div", { class: "holo" });
  const cfg = () => ui.cfg;
  const TEST = { source: "text", text: "↑ ARRIBA  R" };
  const make = (quiet) => {
    // Durante la prueba de orientación se ve la flecha; girar/espejo siguen cambiando la configuración real.
    const r = buildHologram(app, ui.testing ? { ...ui.cfg, ...TEST } : ui.cfg);
    P.settings.hologram = { ...ui.cfg };
    if (ui.cfg.source === "camera" && !ui.testing) app.tracking?.ensure?.(P.settings.tracking.camId || "default");
    if (!S.playing) A.togglePlay();
    app.select(r.surfaces[0]?.id || null);
    app.changed({ panel: true }); app.commit();
    ui.made = true;
    if (!quiet) toast(r.text);
    draw();
  };
  // append() escribiría «null» por las partes que no aplican: se filtran.
  const add = (...xs) => body.append(...xs.filter(Boolean));
  const draw = () => {
    const c = cfg();
    body.replaceChildren();
    // 1 · Tipo
    const types = h("div", { class: "holotypes" }, ...HOLO_TYPES.map(t => h("button", { class: `holotype ${c.type === t.id ? "on" : ""}`, onclick: () => { c.type = t.id; if (t.id === "piramide" && c.n > 1 && c.n < 4) c.n = 1; draw(); } },
      h("div", { class: "sketch", html: SKETCH[t.id] }), h("b", {}, `${t.emoji} ${t.name}`), h("small", {}, t.desc))));
    add(h("div", { class: "lbl" }, "1 · ¿Qué holograma?"), types);
    // 2 · Contenido
    add(h("div", { class: "lbl" }, "2 · ¿Qué aparece?"),
      segmented({ options: HOLO_SOURCES, value: c.source, small: true, cols: 4, onChange: (v) => { c.source = v; draw(); } }));
    if (c.source === "video") {
      const vids = P.media.filter(m => m.kind === "video" || m.kind === "anim" || m.kind === "image");
      if (!c.mediaId && vids.length) c.mediaId = (vids.find(m => m.kind === "video") || vids[0]).id;
      add(vids.length ? h("div", { class: "holomedia" }, ...vids.map(m => h("button", { class: `mcell ${c.mediaId === m.id ? "on" : ""}`, onclick: () => { c.mediaId = m.id; draw(); } },
        h("img", { src: m.thumb || "", alt: "" }), h("span", {}, m.name)))) : hint("Importa el video de la persona (cantante, presentador…). Mejor si está grabado de pies a cabeza y con la cámara quieta."),
        btn({ label: "Importar video", ic: "upload", kind: "block", onClick: async () => { await A.importMedia("library"); c.mediaId = P.media.at(-1)?.id || c.mediaId; draw(); } }),
        h("div", { class: "lbl" }, "Fondo del video"),
        segmented({ options: HOLO_CUTS, value: c.cut, small: true, cols: 2, onChange: (v) => { c.cut = v; draw(); } }),
        hint(c.cut === "ai" ? "La IA recorta a la persona en cada fotograma: el fondo queda negro (invisible en el holograma). Si el video tiene fondo verde o negro, elige esa opción: es más exacta."
          : c.cut === "green" ? "Se quita el verde (chroma key)." : c.cut === "black" ? "Lo negro se vuelve invisible." : "Se usa tal cual."));
    } else if (c.source === "camera") {
      add(hint("La persona que está delante de la cámara aparece en el holograma EN DIRECTO, sin fondo (IA). Ilumínala bien y que se vea de cuerpo entero."));
    } else if (c.source === "anim") {
      const sel = h("select", { class: "sel" }, ...M.ANIM_LIBRARY.filter(a => a.cat !== "Calibración").map(a => h("option", { value: a.name, selected: a.name === c.anim }, a.name)));
      sel.addEventListener("change", () => { c.anim = sel.value; });
      add(sel);
    } else {
      const inp = h("input", { class: "text-in", value: c.text || "", placeholder: "Texto que flota" });
      inp.addEventListener("input", () => { c.text = inp.value; });
      add(inp);
    }
    // 3 · Proyectores
    const nOpts = c.type === "piramide" ? [[1, "1 (4 vistas en cruz)"], [4, "4 (uno por cara)"]] : [[1, "1"], [2, "2"], [3, "3"], [4, "4"]];
    add(h("div", { class: "lbl" }, "3 · ¿Cuántos proyectores?"),
      segmented({ options: nOpts, value: c.n, small: true, onChange: (v) => { c.n = v; draw(); } }),
      c.n > 1 && c.type !== "piramide" ? hint(`Uno al lado del otro: la imagen se reparte entre P1-P${c.n} y donde se solapan (${Math.round(c.overlap * 100)} %) se funden solos, sin costuras.`) : null,
      toggle({ label: "Aspecto de holograma (brillo azul y líneas)", value: c.look, onChange: (v) => { c.look = v; if (ui.made) make(true); } }));
    // 4 · Crear
    add(btn({ label: ui.made ? "✨ Volver a crear con estos cambios" : "✨ Crear holograma", kind: "block primary", onClick: () => make() }));
    if (ui.made) {
      add(h("div", { class: "lbl" }, "Cómo montarlo"), h("ol", { class: "holohow" }, ...howTo(c).map(s => h("li", {}, s))),
        h("div", { class: "lbl" }, "¿Se ve al revés?"),
        row(btn({ label: "↕ Girar", kind: `wide ${c.flipV ? "primary" : ""}`, onClick: () => { c.flipV = !c.flipV; make(true); } }),
          btn({ label: "↔ Espejo", kind: `wide ${c.flipH ? "primary" : ""}`, onClick: () => { c.flipH = !c.flipH; make(true); } }),
          btn({ label: ui.testing ? "Volver a mi contenido" : "Probar orientación", kind: "wide", onClick: () => testOrientation() })),
        h("div", { class: "lbl" }, "Proyectar"),
        window.LumaNative ? hint("En Android sale por P1 (HDMI). Para 2-4 proyectores usa la app de Windows.") : null,
        row(...Array.from({ length: c.type === "piramide" && c.n < 4 ? 1 : c.n }, (_, i) => btn({ label: `Abrir P${i + 1}`, ic: "screen", kind: "wide", onClick: () => window.LumaNative ? A.projectExternal() : A.openWindow(i + 1) }))));
    }
  };
  // Prueba de orientación: una flecha y una «R» durante 8 s (o hasta pulsar otra vez).
  const testOrientation = () => {
    clearTimeout(ui.testing);
    ui.testing = ui.testing ? null : setTimeout(() => { if (ui.testing) testOrientation(); }, 8000);
    if (body.isConnected || ui.testing) make(true);
  };
  draw();
  dialog({ title: "Holograma", content: body, wide: true, buttons: [{ label: "Cerrar", value: null }] }).then(() => {
    if (ui.testing) { clearTimeout(ui.testing); ui.testing = null; buildHologram(app, ui.cfg); app.changed({ panel: true }); app.commit(); }
  });
}
