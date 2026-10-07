// web/js/panels.js
// Contenido de los paneles del editor. Cada panel recibe la API `app`
// (estado + acciones de editor.js) y devuelve un nodo DOM.
import {
  GENERATORS, FX_PRESETS, BLEND_MODES, BORDER_ANIMS, AUDIO_TARGETS, AUDIO_BANDS,
  DRAW_TOOLS, DRAW_ANIMS, SHAPES, DEFAULT_FX, applyFxPreset, lookOf,
} from "./model.js";
import { h, section, row, btn, slider, segmented, toggle, swatches, stepper, tiles, hint, toast, dialog } from "./ui.js";
import { icon } from "./icons.js";
import { PATTERNS } from "./overlay.js";
import { genThumbs } from "./thumbs.js";

export const TABS = [
  { id: "add", label: "Añadir", ic: "plus" },
  { id: "draw", label: "Dibujar", ic: "pen" },
  { id: "content", label: "Contenido", ic: "content" },
  { id: "fx", label: "Efectos", ic: "fx" },
  { id: "shape", label: "Forma", ic: "shape" },
  { id: "layers", label: "Capas", ic: "layers" },
  { id: "scenes", label: "Escenas", ic: "scenes" },
  { id: "audio", label: "Audio", ic: "audio" },
];

const pct = (v) => Math.round(v * 100) + "%";
const fix = (n) => (v) => (+v).toFixed(n);

function needSelection(app, text = "Toca una superficie en el escenario para editarla.") {
  return h("div", {}, hint(text),
    app.S.project.surfaces.length ? null : btn({ label: "Añadir superficie", ic: "plus", kind: "primary block", onClick: () => app.openTab("add") }));
}

/* ---------------------------------------------------------------- Añadir */
const add = {
  title: () => "Añadir",
  render(app) {
    const A = app.actions;
    const shapeTiles = [
      { id: "rect", label: "4 esquinas", ic: "rect" },
      { id: "mesh", label: "Malla curva", ic: "mesh" },
      { id: "circle", label: "Círculo", ic: "circle" },
      { id: "triangle", label: "Triángulo", ic: "triangle" },
      { id: "hexagon", label: "Hexágono", ic: "hexagon" },
      { id: "star", label: "Estrella", ic: "star" },
      { id: "diamond", label: "Rombo", ic: "diamond" },
      { id: "trace", label: "Trazar a mano", ic: "freehand" },
      { id: "points", label: "Por puntos", ic: "points" },
    ];
    return h("div", {},
      section("Contenido rápido",
        tiles([
          { id: "media", label: "Video / imagen", ic: "upload" },
          { id: "draw", label: "Dibujar", ic: "pen" },
          { id: "text", label: "Texto", ic: "text" },
          { id: "camera", label: "Cámara", ic: "camera" },
        ], { onPick: async (id) => {
          if (id === "media") return A.importMedia("new");
          if (id === "draw") return app.openTab("draw");
          A.addShape("rect");
          A.setSource(id === "text" ? { type: "text" } : { type: "camera" });
          app.openTab("content");
        } })),
      section("Superficies",
        hint("Se añaden en el centro. Arrastra sus puntos amarillos hasta las esquinas reales de la pared."),
        tiles(shapeTiles, { onPick: (id) => {
          if (id === "mesh") A.addMesh();
          else if (id === "trace" || id === "points") A.startShape(id);
          else A.addShape(id);
        } })),
      section("Conjuntos",
        tiles([
          { id: "cube", label: "Cubo 3D", ic: "cube" },
          { id: "facade", label: "Fachada", ic: "building" },
          { id: "stage", label: "Escenario", ic: "stage" },
        ], { onPick: (id) => A.addTemplate(id) }),
        btn({ label: "Detectar superficies en una foto (experimental)", ic: "wand", kind: "block", onClick: A.detectFromPhoto })),
    );
  },
};
void SHAPES;

/* ---------------------------------------------------------------- Dibujar */
const draw = {
  title: () => "Dibujar en la pared",
  render(app) {
    const S = app.S, A = app.actions, d = S.draw;
    const look = app.lookSel();
    const n = look?.source.strokes?.length || 0;
    return h("div", {},
      hint("Dibuja con el dedo sobre el escenario: se proyecta en vivo. Dos dedos mueven la vista."),
      segmented({ options: DRAW_TOOLS, value: d.tool, cols: 3, onChange: (v) => { d.tool = v; app.renderPanel(); } }),
      swatches({ value: d.color, onChange: (c) => { d.color = c; } }),
      slider({ label: "Grosor", min: 0.002, max: 0.08, step: 0.001, value: d.width, def: 0.012, fmt: (v) => (v * 100).toFixed(1), onInput: (v) => { d.width = v; } }),
      d.tool === "neon" ? slider({ label: "Brillo neón", min: 0, max: 1, value: d.glow, def: 0.7, fmt: pct, onInput: (v) => { d.glow = v; } }) : null,
      ["rect", "ellipse", "pen"].includes(d.tool) ? toggle({ label: "Relleno", value: d.fill, onChange: (v) => { d.fill = v; } }) : null,
      h("div", { class: "sl-head" }, h("span", { class: "lab" }, "Animación del trazo")),
      segmented({ options: DRAW_ANIMS, value: d.anim, cols: 3, small: true, onChange: (v) => { d.anim = v; } }),
      row(
        btn({ label: "Deshacer trazo", ic: "undo", kind: "wide", onClick: () => { A.undoStroke(); app.renderPanel(); }, disabled: !n }),
        btn({ label: "Borrar todo", ic: "trash", kind: "wide danger", onClick: async () => { await A.clearDrawing(); app.renderPanel(); }, disabled: !n })),
      row(btn({ label: "Nuevo lienzo encima", ic: "plus", kind: "wide", onClick: () => { A.newCanvas(); app.setMode("draw"); } })),
      hint(`${n} trazo(s) en «${app.surf()?.name || ""}». El lienzo es una superficie más: puedes moverlo, deformarlo o aplicarle efectos.`),
    );
  },
};

/* ---------------------------------------------------------------- Contenido */
const SOURCE_TYPES = [
  { id: "media", label: "Video / imagen", ic: "photo" },
  { id: "gen", label: "Animación", ic: "wand" },
  { id: "color", label: "Color", ic: "sun" },
  { id: "text", label: "Texto", ic: "text" },
  { id: "drawing", label: "Dibujo", ic: "pen" },
  { id: "camera", label: "Cámara", ic: "camera" },
  { id: "none", label: "Solo borde", ic: "shape" },
];

const FONTS = [
  ["Impact, 'Arial Black', sans-serif", "Impacto"], ["system-ui, sans-serif", "Moderna"],
  ["Georgia, serif", "Clásica"], ["'Courier New', monospace", "Máquina"], ["'Comic Sans MS', 'Segoe Print', cursive", "Manuscrita"],
];

const content = {
  title: (app) => app.surf() ? `Contenido · ${app.surf().name}` : "Contenido",
  render(app) {
    const s = app.surf();
    if (!s) return needSelection(app);
    const A = app.actions, look = app.lookSel(), src = look.source;
    const wrap = h("div", {},
      tiles(SOURCE_TYPES.map(t => ({ ...t })), { value: src.type, cols: 4, onPick: (id) => {
        if (id === "media" && !app.S.project.media.length) return A.importMedia("selected");
        A.setSource({ type: id });
      } }));

    if (src.type === "media") {
      const grid = h("div", { class: "mediagrid" });
      for (const m of app.S.project.media) {
        const cell = h("button", { class: `mcell ${src.mediaId === m.id ? "on" : ""}`, onclick: () => A.setSource({ type: "media", mediaId: m.id }) },
          h("img", { src: m.thumb || "", alt: "" }), h("span", {}, m.name), h("b", { class: "kind" }, m.kind === "video" ? "VIDEO" : m.kind === "anim" ? "GIF" : "IMG"));
        let pressT = 0;
        cell.addEventListener("pointerdown", () => { pressT = setTimeout(() => A.removeMedia(m.id), 700); });
        cell.addEventListener("pointerup", () => clearTimeout(pressT));
        cell.addEventListener("pointerleave", () => clearTimeout(pressT));
        grid.append(cell);
      }
      wrap.append(section("Biblioteca", grid,
        btn({ label: "Importar video o imagen", ic: "upload", kind: "block primary", onClick: () => A.importMedia("selected") }),
        hint("Mantén pulsado un archivo para quitarlo. Formatos: MP4, WebM, MOV, JPG, PNG, WebP, GIF animado.")));
      wrap.append(section("Encaje",
        segmented({ options: [["stretch", "Estirar"], ["cover", "Recortar"], ["contain", "Ajustar"]], value: look.fit, onChange: (v) => app.edit(() => { look.fit = v; }) }),
        app.S.project.media.find(m => m.id === src.mediaId)?.kind === "video" ? h("div", {},
          slider({ label: "Velocidad", min: 0.25, max: 2, step: 0.05, value: look.rate, def: 1, fmt: (v) => v.toFixed(2) + "×", onInput: (v) => app.edit(() => { look.rate = v; }) }),
          slider({ label: "Volumen", min: 0, max: 1, value: look.volume, def: 0, fmt: pct, onInput: (v) => app.edit(() => { look.volume = v; }) }),
          btn({ label: "Reiniciar videos", ic: "restart", kind: "block", onClick: A.restart })) : null));
    }

    if (src.type === "gen") {
      const items = GENERATORS.map(g => ({ id: g.id, label: g.name, img: genThumbs()[g.id] }));
      wrap.append(section("Animación", tiles(items, { value: src.gen, cols: 4, onPick: (id) => A.setSource({ gen: id }) })));
      wrap.append(section("Colores",
        swatches({ label: "Color principal", value: src.color, onChange: (c) => app.edit(() => { src.color = c; }) }),
        swatches({ label: "Color secundario", value: src.color2, onChange: (c) => app.edit(() => { src.color2 = c; }) }),
        slider({ label: "Velocidad", min: 0, max: 4, step: 0.05, value: src.speed, def: 1, fmt: (v) => v.toFixed(2) + "×", onInput: (v) => app.edit(() => { src.speed = v; }) }),
        slider({ label: "Escala", min: 0.2, max: 4, step: 0.05, value: src.scale, def: 1, fmt: fix(2), onInput: (v) => app.edit(() => { src.scale = v; }) })));
    }

    if (src.type === "color") {
      wrap.append(section("Color", swatches({ value: src.color, onChange: (c) => app.edit(() => { src.color = c; }) })));
    }

    if (src.type === "text") {
      const ta = h("textarea", { class: "text-in", placeholder: "Escribe tu texto" });
      ta.value = src.text;
      ta.addEventListener("input", () => app.edit(() => { src.text = ta.value; }));
      const sel = h("select", { class: "sel" }, ...FONTS.map(([v, l]) => { const o = h("option", { value: v }, l); if (v === src.font) o.selected = true; return o; }));
      sel.addEventListener("change", () => app.edit(() => { src.font = sel.value; }));
      wrap.append(section("Texto", ta, sel,
        swatches({ label: "Color del texto", value: src.textColor, onChange: (c) => app.edit(() => { src.textColor = c; }) }),
        swatches({ label: "Fondo", value: src.textBg?.slice(0, 7) || "#000000", palette: ["#000000", "#ffffff", "#ff2d55", "#0a84ff", "#34c759", "#bf5af2"], onChange: (c) => app.edit(() => { src.textBg = c; }) }),
        row(btn({ label: "Sin fondo", kind: "wide", onClick: () => app.edit(() => { src.textBg = "#00000000"; }) }),
          btn({ label: look.fx.scrollX ? "Detener marquesina" : "Marquesina", ic: "right", kind: "wide", onClick: () => { app.edit(() => { look.fx.scrollX = look.fx.scrollX ? 0 : -0.15; }); app.renderPanel(); } }))));
    }

    if (src.type === "drawing") {
      wrap.append(section("Dibujo", hint(`${src.strokes?.length || 0} trazos.`), btn({ label: "Dibujar aquí", ic: "pen", kind: "primary block", onClick: () => app.openTab("draw") })));
    }
    if (src.type === "camera") {
      wrap.append(section("Cámara", hint("Proyecta en vivo lo que ve la cámara trasera del dispositivo (permite el acceso cuando se pida).")));
    }
    if (src.type === "none") {
      wrap.append(section("Solo borde", hint("La superficie no muestra relleno: ve a Efectos → Borde para crear líneas de neón animadas sobre el contorno."),
        btn({ label: "Activar borde neón", ic: "fx", kind: "block", onClick: () => { app.edit(() => { Object.assign(look.fx, { border: 0.015, borderAnim: "chase", borderGlow: 0.8 }); }); app.openTab("fx"); } })));
    }

    wrap.append(section("Mezcla",
      slider({ label: "Opacidad", min: 0, max: 1, value: look.opacity, def: 1, fmt: pct, onInput: (v) => app.edit(() => { look.opacity = v; }) }),
      segmented({ options: BLEND_MODES, value: look.blend, small: true, onChange: (v) => app.edit(() => { look.blend = v; }) }),
      app.S.project.scenes.length > 1 ? btn({ label: "Usar este contenido en todas las escenas", kind: "block", onClick: A.applyToAllScenes }) : null));
    return wrap;
  },
};

/* ---------------------------------------------------------------- Efectos */
const fx = {
  title: (app) => app.surf() ? `Efectos · ${app.surf().name}` : "Efectos",
  render(app) {
    const s = app.surf();
    if (!s) return needSelection(app);
    const look = app.lookSel(), f = look.fx;
    const set = (k) => (v) => app.edit(() => { f[k] = v; });
    const chips = h("div", { class: "chips" });
    for (const name of Object.keys(FX_PRESETS)) {
      chips.append(h("button", { class: "chip", onclick: () => { app.edit(() => applyFxPreset(look, name)); app.renderPanel(); } }, name));
    }
    return h("div", {},
      section("Efectos rápidos", chips),
      section("Borde neón (líneas sobre el contorno)",
        slider({ label: "Grosor", min: 0, max: 0.08, step: 0.001, value: f.border, def: 0, fmt: (v) => v ? (v * 100).toFixed(1) : "No", onInput: set("border") }),
        swatches({ value: f.borderColor, onChange: set("borderColor") }),
        slider({ label: "Resplandor", min: 0, max: 1, value: f.borderGlow, def: 0.5, fmt: pct, onInput: set("borderGlow") }),
        segmented({ options: BORDER_ANIMS, value: f.borderAnim, small: true, onChange: set("borderAnim") })),
      section("Color",
        slider({ label: "Brillo", min: 0, max: 2, value: f.brightness, def: 1, fmt: pct, onInput: set("brightness") }),
        slider({ label: "Contraste", min: 0, max: 2, value: f.contrast, def: 1, fmt: pct, onInput: set("contrast") }),
        slider({ label: "Saturación", min: 0, max: 3, value: f.saturation, def: 1, fmt: pct, onInput: set("saturation") }),
        slider({ label: "Tono", min: 0, max: 1, step: 0.005, value: f.hue, def: 0, fmt: (v) => Math.round(v * 360) + "°", onInput: set("hue") }),
        toggle({ label: "Negativo", value: f.invert, onChange: set("invert") })),
      section("Movimiento",
        slider({ label: "Zoom", min: 0.2, max: 4, value: f.zoom, def: 1, fmt: fix(2), onInput: set("zoom") }),
        slider({ label: "Rotación", min: -180, max: 180, step: 1, value: f.rotate, def: 0, fmt: (v) => v + "°", onInput: set("rotate") }),
        slider({ label: "Giro continuo", min: -3, max: 3, step: 0.05, value: f.spin, def: 0, fmt: fix(2), onInput: set("spin") }),
        slider({ label: "Desplazar ↔", min: -1, max: 1, step: 0.01, value: f.scrollX, def: 0, fmt: fix(2), onInput: set("scrollX") }),
        slider({ label: "Desplazar ↕", min: -1, max: 1, step: 0.01, value: f.scrollY, def: 0, fmt: fix(2), onInput: set("scrollY") }),
        slider({ label: "Ondas", min: 0, max: 2, value: f.wave, def: 0, fmt: pct, onInput: set("wave") })),
      section("Distorsión",
        slider({ label: "Caleidoscopio", min: 0, max: 16, step: 1, value: f.kaleido, def: 0, fmt: (v) => v < 2 ? "No" : v + " lados", onInput: set("kaleido") }),
        segmented({ options: [["none", "Sin espejo"], ["h", "Espejo ↔"], ["v", "Espejo ↕"], ["quad", "Cuádruple"]], value: f.mirror, small: true, onChange: set("mirror") }),
        slider({ label: "Pixelado", min: 0, max: 1, value: f.pixelate, def: 0, fmt: pct, onInput: set("pixelate") }),
        slider({ label: "Separación RGB", min: 0, max: 0.03, step: 0.0005, value: f.rgbShift, def: 0, fmt: (v) => (v * 1000).toFixed(0), onInput: set("rgbShift") }),
        slider({ label: "Desenfoque", min: 0, max: 2, value: f.blur, def: 0, fmt: pct, onInput: set("blur") }),
        slider({ label: "Ruido / grano", min: 0, max: 0.6, value: f.noise, def: 0, fmt: pct, onInput: set("noise") })),
      section("Estroboscopio",
        slider({ label: "Destellos por segundo", min: 0, max: 15, step: 0.5, value: f.strobe, def: 0, fmt: (v) => v ? v + " Hz" : "No", onInput: set("strobe") })),
      btn({ label: "Quitar todos los efectos", kind: "block", onClick: () => { app.edit(() => { look.fx = DEFAULT_FX(); }); app.renderPanel(); } }),
    );
  },
};

/* ---------------------------------------------------------------- Forma */
const shape = {
  title: (app) => app.surf() ? `Forma · ${app.surf().name}` : "Forma",
  render(app) {
    const s = app.surf();
    if (!s) return needSelection(app);
    const A = app.actions, S = app.S;
    const wrap = h("div", {},
      row(btn({ label: s.name, ic: "pen", kind: "wide", title: "Renombrar", onClick: () => A.rename() })),
      section("Ajuste",
        hint("Arrastra los puntos amarillos. Con dos dedos sobre la forma la escalas y giras. Usa la cruceta para mover el punto rojo píxel a píxel."),
        toggle({ label: "Unir esquinas que coinciden", hint: "Mueve juntas las caras de un cubo o fachada", value: S.linkCorners, onChange: (v) => { S.linkCorners = v; } }),
        row(btn({ ic: "flipH", label: "Espejo", kind: "wide", onClick: () => A.flip("h") }), btn({ ic: "flipV", label: "Voltear", kind: "wide", onClick: () => A.flip("v") }), btn({ ic: "rotate", label: "90°", kind: "wide", onClick: A.rotate90 })),
        s.type === "quad" ? row(btn({ ic: "straight", label: "Enderezar", kind: "wide", onClick: A.straighten }), btn({ ic: "fit", label: "Pantalla entera", kind: "wide", onClick: A.fillFrame })) : null),
    );
    if (s.type === "quad") {
      wrap.append(section("Malla de deformación",
        hint("Más puntos = puedes curvar la imagen sobre columnas, esquinas redondeadas o superficies irregulares."),
        stepper({ label: "Columnas", value: s.cols, min: 2, max: 10, onChange: (v) => A.setMesh(v, s.rows) }),
        stepper({ label: "Filas", value: s.rows, min: 2, max: 10, onChange: (v) => A.setMesh(s.cols, v) }),
        s.cols > 2 || s.rows > 2 ? btn({ label: "Volver a 4 esquinas", kind: "block", onClick: () => { A.setMesh(2, 2); app.renderPanel(); } }) : null));
    }
    const m = s.mask;
    wrap.append(section("Máscara (recortar zonas)",
      hint("Dibuja un contorno: solo se verá lo de dentro (o lo de fuera si la inviertes). Ideal para esquivar ventanas, puertas o muebles."),
      row(btn({ label: m.points.length ? "Editar máscara" : "Dibujar máscara", ic: "mask", kind: "wide primary", onClick: A.editMask }),
        m.points.length ? btn({ ic: "trash", kind: "icon", title: "Quitar máscara", onClick: A.clearMask }) : null),
      m.points.length >= 3 ? h("div", {},
        toggle({ label: "Máscara activa", value: m.enabled, onChange: (v) => app.edit(() => { m.enabled = v; }) }),
        toggle({ label: "Invertir (ocultar lo de dentro)", value: m.invert, onChange: (v) => app.edit(() => { m.invert = v; }) }),
        slider({ label: "Borde suave", min: 0.0005, max: 0.15, step: 0.0005, value: m.feather, def: 0.01, fmt: (v) => (v * 100).toFixed(1), onInput: (v) => app.edit(() => { m.feather = v; }) })) : null));
    wrap.append(section("Superficie",
      row(btn({ ic: "copy", label: "Duplicar", kind: "wide", onClick: A.duplicate }),
        btn({ ic: s.locked ? "lock" : "unlock", label: s.locked ? "Bloqueada" : "Bloquear", kind: `wide ${s.locked ? "on" : ""}`, onClick: () => A.toggleLock() }),
        btn({ ic: s.hidden ? "eyeoff" : "eye", label: s.hidden ? "Oculta" : "Ocultar", kind: `wide ${s.hidden ? "on" : ""}`, onClick: () => A.toggleHide() })),
      row(btn({ ic: "trash", label: "Eliminar superficie", kind: "wide danger", onClick: () => A.remove() }))));
    return wrap;
  },
};

/* ---------------------------------------------------------------- Capas */
const layers = {
  title: () => "Capas",
  render(app) {
    const S = app.S, A = app.actions, sc = app.scene();
    const list = h("div", { class: "list" });
    const arr = [...S.project.surfaces].reverse();
    if (!arr.length) return needSelection(app, "Aún no hay superficies.");
    for (const s of arr) {
      const look = sc.looks[s.id];
      const src = look?.source;
      const m = src?.type === "media" ? S.project.media.find(x => x.id === src.mediaId) : null;
      const sw = h("div", { class: "sw-mini", style: m?.thumb ? { backgroundImage: `url(${m.thumb})` } : { background: src?.type === "gen" || src?.type === "color" ? `linear-gradient(135deg, ${src.color}, ${src.color2})` : "#000" } });
      const kind = { media: m ? m.name : "Sin archivo", gen: "Animación", color: "Color", text: "Texto", drawing: `Dibujo · ${src?.strokes?.length || 0} trazos`, camera: "Cámara", none: "Solo borde" }[src?.type || "none"];
      list.append(h("div", { class: `item ${s.id === S.sel ? "on" : ""} ${s.hidden ? "dim" : ""}`, onclick: (e) => { if (e.target.closest("button")) return; app.select(s.id); app.renderPanel(); } },
        sw,
        h("div", { class: "name" }, s.name, h("small", {}, kind + (s.type === "quad" && (s.cols > 2 || s.rows > 2) ? ` · malla ${s.cols}×${s.rows}` : ""))),
        btn({ ic: s.hidden ? "eyeoff" : "eye", kind: "icon", title: "Mostrar / ocultar", onClick: () => A.toggleHide(s.id) }),
        btn({ ic: s.locked ? "lock" : "unlock", kind: "icon", title: "Bloquear", onClick: () => A.toggleLock(s.id) }),
        btn({ ic: "up", kind: "icon", title: "Subir", onClick: () => A.moveLayer(s.id, 1) }),
        btn({ ic: "down", kind: "icon", title: "Bajar", onClick: () => A.moveLayer(s.id, -1) })));
    }
    return h("div", {}, hint("La de arriba se dibuja encima de las demás."), list);
  },
};

/* ---------------------------------------------------------------- Escenas */
const scenes = {
  title: () => "Escenas",
  render(app) {
    const S = app.S, A = app.actions, P = S.project;
    const list = h("div", { class: "list" });
    P.scenes.forEach((sc, i) => {
      const on = sc.id === P.sceneId;
      list.append(h("div", { class: `item ${on ? "on" : ""}`, onclick: (e) => { if (e.target.closest("button")) return; A.goScene(sc.id); } },
        h("div", { class: "badge" }, i + 1),
        h("div", { class: "name" }, sc.name, h("small", {}, (sc.duration ? `${sc.duration} s` : "manual") + (sc.transition === "cut" ? " · corte" : " · fundido"))),
        btn({ ic: "pen", kind: "icon", title: "Renombrar", onClick: () => A.renameScene(sc.id) }),
        btn({ ic: "up", kind: "icon", title: "Antes", onClick: () => { const k = P.scenes.indexOf(sc); if (k > 0) { P.scenes.splice(k, 1); P.scenes.splice(k - 1, 0, sc); app.changed({ panel: true }); app.commit(); } } }),
        btn({ ic: "trash", kind: "icon", title: "Eliminar", onClick: () => A.removeScene(sc.id) })));
    });
    const cur = app.scene();
    return h("div", {},
      hint("Las escenas usan el mismo mapeo con distinto contenido. Tócalas en directo para cambiar."),
      row(btn({ label: "Anterior", ic: "left", kind: "wide", onClick: () => A.stepScene(-1) }), btn({ label: "Siguiente", ic: "right", kind: "wide primary", onClick: () => A.stepScene(1) })),
      h("div", { style: { height: "10px" } }),
      list,
      btn({ label: "Nueva escena (copia de la actual)", ic: "plus", kind: "block", onClick: A.addScene }),
      section(`Escena actual · ${cur.name}`,
        slider({ label: "Duración en reproducción automática", min: 0, max: 120, step: 1, value: cur.duration, def: 0, fmt: (v) => v ? v + " s" : "manual", onInput: (v) => app.edit(() => { cur.duration = v; }) }),
        segmented({ options: [["fade", "Fundido"], ["cut", "Corte"]], value: cur.transition, onChange: (v) => app.edit(() => { cur.transition = v; }) })),
      section("Reproducción",
        toggle({ label: "Avanzar escenas automáticamente", hint: "Usa la duración de cada escena", value: P.settings.autoAdvance, onChange: (v) => app.edit(() => { P.settings.autoAdvance = v; S.sceneStart = S.clock; }) }),
        toggle({ label: "Volver a la primera al terminar", value: P.settings.loopScenes, onChange: (v) => app.edit(() => { P.settings.loopScenes = v; }) }),
        slider({ label: "Duración del fundido", min: 0, max: 4000, step: 50, value: P.settings.transitionMs, def: 800, fmt: (v) => (v / 1000).toFixed(2) + " s", onInput: (v) => app.edit(() => { P.settings.transitionMs = v; }) })),
    );
  },
};

/* ---------------------------------------------------------------- Audio */
const REACT_PARTS = [
  ["pulse", "Destello de luz"], ["zoom", "Golpe de zoom"], ["color", "Cambio de color"],
  ["motion", "Acelerar animación"], ["flash", "Parpadeo"],
];

const audio = {
  title: () => "Audio y ritmo",
  render(app) {
    const S = app.S, A = app.actions, au = app.audio(), R = S.project.settings.react;
    // Medidores en vivo
    const meters = h("div", {});
    const bars = {};
    for (const [k, label] of AUDIO_BANDS) {
      const b = h("b");
      bars[k] = b;
      meters.append(h("div", { class: "meter" }, label, h("div", {}, b)));
    }
    const beatBar = h("b");
    meters.append(h("div", { class: "meter" }, "Golpe", h("div", {}, beatBar)));
    const bpmOut = h("output", { class: "bpm" }, "—");
    const bpmSrc = h("small", {});
    const lamp = h("span", { class: "beatlamp" });
    const loop = () => {
      if (!meters.isConnected) return;
      const L = S.levels;
      for (const k of Object.keys(bars)) bars[k].style.width = Math.round((L[k] || 0) * 100) + "%";
      beatBar.style.width = Math.round((L.beat || 0) * 100) + "%";
      lamp.style.opacity = 0.15 + (L.beat || 0) * 0.85;
      bpmOut.textContent = Math.round(L.bpm || au.bpm);
      bpmSrc.textContent = au.active ? (L.locked ? "✓ sincronizado con la música" : au.detected ? "detectado · ajustando el compás…" : "escuchando… pon música con golpes marcados") : "tempo manual (TAP o botones)";
      bpmSrc.style.color = L.locked ? "var(--ok)" : "";
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    const setR = (k) => (v) => app.edit(() => { R[k] = v; });

    const parts = h("div", { class: "chips" });
    for (const [k, label] of REACT_PARTS) {
      const b = h("button", { class: `chip ${R[k] ? "on" : ""}`, onclick: () => { app.edit(() => { R[k] = !R[k]; }); b.classList.toggle("on", R[k]); } }, label);
      parts.append(b);
    }
    const tap = h("button", { class: "tapbtn", onclick: () => { A.tap(); } }, "TAP");

    const wrap = h("div", {},
      section("Micrófono",
        btn({ label: au.active ? "Micrófono activo · apagar" : "Escuchar la música con el micrófono", ic: "mic", kind: `bigbtn ${au.active ? "on" : "primary"}`, onClick: A.toggleMic }),
        h("div", { class: "bpmrow" }, lamp, h("div", {}, h("div", {}, bpmOut, " BPM"), bpmSrc)),
        meters,
        slider({ label: "Sensibilidad", min: 0.3, max: 3, value: au.gain, def: 1, fmt: fix(1), onInput: (v) => { au.gain = v; } }),
        hint("Si no detecta los golpes, acerca el dispositivo al altavoz o sube la sensibilidad.")),
      section("Todo reacciona al ritmo",
        toggle({ label: "Modo ritmo", hint: "Todas las superficies cambian con cada golpe", value: R.enabled, onChange: (v) => { app.edit(() => { R.enabled = v; }); } }),
        slider({ label: "Intensidad", min: 0.2, max: 2, value: R.amount, def: 1, fmt: pct, onInput: setR("amount") }),
        h("div", { class: "sl-head" }, h("span", { class: "lab" }, "Qué cambia en cada golpe")),
        parts,
        stepper({ label: "Cambiar de escena cada (golpes, 0 = no)", value: R.sceneBeats, min: 0, max: 64, onChange: setR("sceneBeats") }),
        S.project.scenes.length < 2 && R.sceneBeats ? hint("Crea al menos 2 escenas para que cambien al ritmo.") : null),
      section("Tempo",
        tap,
        h("div", { class: "row" },
          btn({ label: "½×", kind: "wide", title: "Mitad de tempo", onClick: () => A.scaleTempo(0.5) }),
          btn({ label: "−1", kind: "wide", onClick: () => A.setBpm(au.bpm - 1) }),
          btn({ label: "+1", kind: "wide", onClick: () => A.setBpm(au.bpm + 1) }),
          btn({ label: "2×", kind: "wide", title: "Doble de tempo", onClick: () => A.scaleTempo(2) }),
          btn({ label: "1", kind: "wide primary", title: "Marca el primer tiempo ahora", onClick: () => au.downbeat() })),
        hint("Sin micrófono: toca TAP 4 veces al ritmo. «1» marca el primer tiempo del compás. ½× y 2× corrigen si va al doble o a la mitad."),
        slider({ label: "Sincronía (adelanto de la imagen)", min: -150, max: 250, step: 5, value: au.offset, def: 60, fmt: (v) => v + " ms", onInput: (v) => au.setOffset(v) }),
        hint("Si los destellos llegan tarde respecto al sonido, sube este valor; si llegan antes, bájalo.")));

    const s = app.surf();
    if (s) {
      const look = app.lookSel(), a = look.audio;
      wrap.append(section(`Solo esta superficie · ${s.name}`,
        toggle({ label: "Reacción propia al audio", value: a.enabled, onChange: (v) => { app.edit(() => { a.enabled = v; }); } }),
        h("div", { class: "sl-head" }, h("span", { class: "lab" }, "Escuchar")),
        segmented({ options: AUDIO_BANDS, value: a.band, small: true, onChange: (v) => app.edit(() => { a.band = v; }) }),
        h("div", { class: "sl-head" }, h("span", { class: "lab" }, "Para mover")),
        segmented({ options: AUDIO_TARGETS, value: a.target, cols: 3, small: true, onChange: (v) => app.edit(() => { a.target = v; }) }),
        slider({ label: "Intensidad", min: 0, max: 2, value: a.amount, def: 1, fmt: pct, onInput: (v) => app.edit(() => { a.amount = v; }) }),
        btn({ label: "Aplicar a todas las superficies", kind: "block", onClick: () => {
          app.edit(() => { for (const o of S.project.surfaces) lookOf(app.scene(), o.id).audio = { ...a, enabled: true }; });
          toast("Todas las superficies reaccionan al audio");
        } })));
    }
    return wrap;
  },
};

/* ---------------------------------------------------------------- Proyección */
const output = {
  title: () => "Proyectar",
  render(app) {
    const S = app.S, A = app.actions;
    const isNative = !!window.LumaNative;
    const wrap = h("div", {});
    if (isNative) {
      const n = S.extDisplays;
      wrap.append(section("Proyector (HDMI / USB-C)",
        hint(n ? `Pantalla externa detectada${window.LumaNative.externalSize ? " · " + window.LumaNative.externalSize() : ""}.` : "Conecta el proyector con un adaptador USB-C → HDMI. Se detecta automáticamente."),
        btn({ label: S.output === "native" ? "Detener proyección" : "Proyectar en pantalla externa", ic: "project", kind: `bigbtn ${S.output === "native" ? "danger" : "primary"}`, disabled: !n && S.output !== "native", onClick: A.projectExternal })));
    } else {
      const desktop = /Electron/.test(navigator.userAgent);
      wrap.append(section(desktop ? "Proyector (segunda pantalla)" : "Otra pantalla",
        hint(desktop
          ? "Conecta el proyector como pantalla extendida (en Windows: tecla Win + P → Extender). La salida se abre sola a pantalla completa en el proyector."
          : "Abre la salida en una ventana, llévala al proyector (pantalla extendida) y pulsa «Pantalla completa»."),
        btn({ label: S.outWin && !S.outWin.closed ? "Ventana de salida abierta" : "Abrir ventana de salida", ic: "screen", kind: "bigbtn primary", onClick: A.openWindow })));
      if (desktop && window.LumaDesktop) {
        // Elegir en qué pantalla sale la imagen (proyector, TV, segundo monitor).
        const box = h("div", { class: "list" }, hint("Buscando pantallas…"));
        wrap.append(section("Pantalla de salida", box));
        window.LumaDesktop.displays().then((list) => {
          box.innerHTML = "";
          const pick = (id) => { window.LumaDesktop.setOutputDisplay(id); setTimeout(() => app.renderPanel(), 400); };
          box.append(h("button", { class: `item ${list.some(d => d.chosen) ? "" : "on"}`, onclick: () => pick(null) },
            h("div", { class: "badge", html: icon("wand") }), h("div", { class: "name" }, "Automática", h("small", {}, "La pantalla que no tiene el editor"))));
          for (const d of list) {
            box.append(h("button", { class: `item ${d.chosen ? "on" : ""}`, onclick: () => pick(d.id) },
              h("div", { class: "badge", html: icon("screen") }),
              h("div", { class: "name" }, `${d.label} · ${d.width}×${d.height}`,
                h("small", {}, [d.primary ? "principal" : "secundaria", d.isOutput ? "salida actual" : ""].filter(Boolean).join(" · ")))));
          }
          if (list.length < 2) box.append(hint("Solo hay una pantalla. Conecta el proyector y pon Windows en modo Extender (Win + P)."));
        });
      }
    }
    wrap.append(section("Esta pantalla",
      hint("Para proyector en modo espejo, Chromecast o cable HDMI duplicando la pantalla. La interfaz se oculta; toca para ver los controles."),
      btn({ label: "Pantalla completa aquí", ic: "fit", kind: "bigbtn", onClick: () => A.projectHere(true) })));
    wrap.append(section("En directo",
      toggle({ label: "Guías en el proyector", hint: "Muestra contornos y puntos en la pared para alinear", value: S.guides, onChange: (v) => { S.guides = v; } }),
      slider({ label: "Brillo general", min: 0, max: 1, value: S.master, def: 1, fmt: pct, onInput: (v) => { S.master = v; } }),
      row(btn({ label: S.blackout ? "Apagón ACTIVO" : "Apagón", ic: "blackout", kind: `wide ${S.blackout ? "danger" : ""}`, onClick: A.blackout }),
        btn({ label: S.muted ? "Sonido apagado" : "Sonido", ic: S.muted ? "mute" : "volume", kind: "wide", onClick: () => { S.muted = !S.muted; app.renderPanel(); } }))));
    const chips = h("div", { class: "chips" });
    for (const [id, label] of PATTERNS) chips.append(h("button", { class: `chip ${S.pattern === id ? "on" : ""}`, onclick: () => A.setPattern(id) }, label));
    wrap.append(section("Patrón de prueba", hint("Para enfocar y encuadrar el proyector. Toca otra vez para quitarlo."), chips));
    return wrap;
  },
};

/* ---------------------------------------------------------------- Menú */
const menu = {
  title: (app) => app.S.project.name,
  render(app) {
    const S = app.S, A = app.actions;
    const item = (ic, label, fn, sub) => h("button", { class: "item", style: { width: "100%", textAlign: "left" }, onclick: fn },
      h("div", { class: "badge", html: icon(ic) }), h("div", { class: "name" }, label, sub ? h("small", {}, sub) : null));
    return h("div", {},
      section("Proyecto", h("div", { class: "list" },
        item("plus", "Nuevo", A.newProject, "Desde una plantilla"),
        item("folder", "Abrir", A.open, "Proyectos guardados en este dispositivo"),
        item("save", "Guardar", () => A.save(false), "También se guarda solo cada pocos segundos"),
        item("copy", "Guardar como…", () => A.save(true)),
        item("download", "Exportar archivo .lumamap", A.exportProject, "Incluye videos e imágenes: para copia o para otro equipo"),
        item("upload", "Importar archivo", A.importProject),
        item("screen", `Resolución · ${S.project.width}×${S.project.height}`, A.setResolution))),
      section("Show", h("div", { class: "list" },
        item("wand", "Todos los comandos", A.palette, "Busca cualquier acción escribiendo · Ctrl+K"),
        item("camera", S.rec ? "Detener grabación" : "Grabar video de la salida", A.record, "Guarda el show en video (con la música si el micrófono está activo)"),
        item("photo", "Capturar imagen de la salida", A.snapshot, "PNG a la resolución de salida"))),
      section("Referencia para dibujar formas",
        hint("Una foto de la pared tomada desde el proyector ayuda a trazar las formas. Solo se ve en el editor."),
        row(btn({ label: S.ref.url ? "Cambiar foto" : "Foto de la pared", ic: "photo", kind: "wide", onClick: A.refPhoto }),
          btn({ label: S.ref.camera ? "Cámara: sí" : "Cámara en vivo", ic: "camera", kind: `wide ${S.ref.camera ? "on" : ""}`, onClick: () => A.refCamera(!S.ref.camera) })),
        S.ref.url || S.ref.camera ? h("div", {},
          slider({ label: "Opacidad de la referencia", min: 0.05, max: 1, value: S.ref.opacity, def: 0.5, fmt: pct, onInput: (v) => { S.ref.opacity = v; } }),
          btn({ label: "Quitar referencia", kind: "block", onClick: A.refClear })) : null),
      section("Control", h("div", { class: "list" },
        item("midi", "Conectar controlador MIDI", A.midi, "Notas 36-51 = escenas · 60 play · 63/64 siguiente/anterior"),
        item("help", "Ayuda y atajos", () => A.help()),
        item("info", "Acerca de LumaMap", () => dialog({ title: "LumaMap 2", content: h("p", {}, "Video mapping táctil para Android, tablet y navegador. Código abierto (MIT). Funciona sin internet.") })))),
    );
  },
};

export function showHelp(app) {
  const c = h("div", { class: "help" });
  c.innerHTML = `
  <h4>Primeros pasos</h4>
  <ol><li>Conecta el proyector (USB-C → HDMI) o usa la ventana de salida.</li>
  <li><b>Añadir</b> → elige una forma. Arrastra sus puntos amarillos hasta las esquinas reales de la pared (activa «Guías en el proyector» para verlas en la pared).</li>
  <li><b>Contenido</b> → video, imagen, animación, texto, cámara o dibujo.</li>
  <li><b>Efectos</b> y <b>Audio</b> para darle vida. <b>Escenas</b> para el show.</li></ol>
  <h4>Gestos</h4>
  <ul><li>Un dedo sobre una forma: moverla.</li><li>Un dedo sobre un punto: moverlo (aparece una lupa).</li>
  <li>Dos dedos sobre la forma seleccionada: escalar y girar.</li><li>Dos dedos fuera: zoom y desplazamiento de la vista. Doble toque en vacío: encajar vista.</li>
  <li>Cruceta: mueve el punto rojo píxel a píxel (centro: siguiente punto; «fino» = ¼ px).</li></ul>
  <h4>Ratón (PC)</h4>
  <ul><li>Clic derecho: menú de la superficie. Rueda: zoom. En táctil, mantén pulsado para el mismo menú.</li>
  <li><kbd>Ctrl+K</kbd>: busca y ejecuta cualquier comando escribiendo.</li></ul>
  <h4>Teclado</h4>
  <ul><li><kbd>Flechas</kbd> empujar el punto o la forma (<kbd>Mayús</kbd> ×10) · <kbd>Tab</kbd> siguiente punto · <kbd>1-9</kbd> escenas · <kbd>Esc</kbd> salir / deseleccionar</li></ul>`;
  const groups = {};
  for (const cmd of app?.commands || []) if (cmd.keys) (groups[cmd.group] ||= []).push(cmd);
  for (const [g, list] of Object.entries(groups))
    c.insertAdjacentHTML("beforeend", `<h4>${g}</h4><ul class="keys">${list.map(k => `<li><kbd>${k.keys}</kbd> ${k.label}</li>`).join("")}</ul>`);
  return dialog({ title: "Ayuda", content: c, wide: true });
}

export const PANELS = { add, draw, content, fx, shape, layers, scenes, audio, output, menu };
