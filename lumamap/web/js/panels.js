// web/js/panels.js
// Contenido de los paneles del editor. Cada panel recibe la API `app`
// (estado + acciones de editor.js) y devuelve un nodo DOM.
import {
  GENERATORS, ANIM_LIBRARY, ANIM_CATEGORIES, FX_LIBRARY, FX_CATEGORIES, COLORMAPS, RECORD_QUALITIES, BLEND_MODES, BORDER_ANIMS, AUDIO_TARGETS, AUDIO_BANDS,
  DRAW_TOOLS, DRAW_ANIMS, SHAPES, DEFAULT_FX, lookOf,
} from "./model.js";
import { h, section, row, btn, slider, segmented, toggle, swatches, stepper, tiles, hint, toast, dialog } from "./ui.js";
import { icon } from "./icons.js";
import { PATTERNS } from "./overlay.js";
import { genThumbs, animThumb } from "./thumbs.js";
import { TEXT_ANIMS } from "./sources.js";

const animUI = { cat: "Todas", q: "" };

export const TABS = [
  { id: "add", label: "Añadir", ic: "plus" },
  { id: "anim", label: "Animaciones", ic: "wand" },
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
          { id: "media", label: "Video, foto o GIF", ic: "upload" },
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

/* ------------------------------------------------------------ Animaciones */
/** Aplica una animación del catálogo a la superficie seleccionada. */
function applyAnim(app, a) {
  const look = app.lookSel();
  if (!look) return;
  app.edit(() => {
    Object.assign(look.source, { type: "gen", gen: a.gen, color: a.color, color2: a.color2, speed: a.speed, scale: a.scale });
    if (a.fx) look.fx = { ...DEFAULT_FX(), ...a.fx };
  });
  app.renderPanel();
  toast(a.name);
}

/** Catálogo: buscador + categorías + miniaturas reales. */
function animCatalog(app, onPick) {
  const search = h("input", { type: "search", class: "text-in", placeholder: `Buscar entre ${ANIM_LIBRARY.length} animaciones…`, value: animUI.q });
  const cats = h("div", { class: "chips" });
  const grid = h("div", {});
  const norm = (t) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const cur = app.lookSel()?.source;
  const renderGrid = () => {
    const q = norm(animUI.q.trim());
    const list = ANIM_LIBRARY.filter(a => (animUI.cat === "Todas" || a.cat === animUI.cat) && (!q || norm(a.name + " " + a.cat).includes(q)));
    grid.innerHTML = "";
    const on = cur?.type === "gen" ? list.find(a => a.gen === cur.gen && a.color === cur.color && a.color2 === cur.color2)?.id : null;
    grid.append(list.length ? tiles(list.map(a => ({ id: a.id, label: a.name, img: animThumb(a) })), { value: on, cols: 4, onPick: (id) => onPick(ANIM_LIBRARY.find(x => x.id === id)) }) : hint("Ninguna animación con ese nombre."));
  };
  for (const c of ["Todas", ...ANIM_CATEGORIES]) {
    const n = c === "Todas" ? ANIM_LIBRARY.length : ANIM_LIBRARY.filter(a => a.cat === c).length;
    const b = h("button", { class: `chip ${animUI.cat === c ? "on" : ""}`, onclick: () => {
      animUI.cat = c; cats.querySelectorAll(".chip").forEach(x => x.classList.toggle("on", x === b)); renderGrid();
    } }, `${c} · ${n}`);
    cats.append(b);
  }
  search.addEventListener("input", () => { animUI.q = search.value; renderGrid(); });
  renderGrid();
  return section(`Biblioteca de animaciones (${ANIM_LIBRARY.length})`, search, cats, grid);
}

const anim = {
  title: (app) => app.surf() ? `Animaciones · ${app.surf().name}` : "Animaciones",
  render(app) {
    const A = app.actions;
    const wrap = h("div", {});
    if (!app.surf()) {
      wrap.append(hint("Toca una animación: se crea una superficie a pantalla completa con ella. Si seleccionas una superficie, la animación se pone en esa."));
      wrap.append(animCatalog(app, (a) => {
        A.addShape("rect");
        A.fillFrame();
        applyAnim(app, a);
      }));
      return wrap;
    }
    const look = app.lookSel(), src = look.source;
    wrap.append(animCatalog(app, (a) => applyAnim(app, a)));
    if (src.type === "gen") {
      wrap.append(section("Ajustar la animación",
        swatches({ label: "Color principal", value: src.color, onChange: (c) => app.edit(() => { src.color = c; }) }),
        swatches({ label: "Color secundario", value: src.color2, onChange: (c) => app.edit(() => { src.color2 = c; }) }),
        slider({ label: "Velocidad", min: 0, max: 4, step: 0.05, value: src.speed, def: 1, fmt: (v) => v.toFixed(2) + "×", onInput: (v) => app.edit(() => { src.speed = v; }) }),
        slider({ label: "Escala", min: 0.2, max: 4, step: 0.05, value: src.scale, def: 1, fmt: fix(2), onInput: (v) => app.edit(() => { src.scale = v; }) })));
    }
    return wrap;
  },
};

/** Girar la imagen dentro de la superficie y encajarla. */
function rotateFitSection(app) {
  const A = app.actions, look = app.lookSel();
  const rot = look.fx.rotate || 0;
  return section("Girar y encajar la imagen",
    slider({ label: "Girar imagen", min: -180, max: 180, step: 1, value: rot, def: 0, fmt: (v) => Math.round(v) + "°", onInput: (v) => app.edit(() => { look.fx.rotate = v; }) }),
    row(btn({ label: "⟲ 90°", kind: "wide", onClick: () => A.rotateContent(-90) }),
      btn({ label: "⟳ 90°", kind: "wide", onClick: () => A.rotateContent(90) }),
      btn({ label: "180°", kind: "wide", onClick: () => A.rotateContent(180) }),
      btn({ label: "Recta", kind: "wide", onClick: () => A.rotateContent(0, true) })),
    segmented({ options: [["stretch", "Estirar"], ["cover", "Llenar"], ["contain", "Ajustar"]], value: look.fit, onChange: (v) => app.edit(() => { look.fit = v; }) }),
    btn({ label: "Pantalla completa (un toque)", ic: "fit", kind: "block primary", onClick: A.fillFrame }));
}

/* ---------------------------------------------------------------- Contenido */
const SOURCE_TYPES = [
  { id: "media", label: "Video, foto o GIF", ic: "photo" },
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
        btn({ label: "Importar video, imagen o GIF", ic: "upload", kind: "block primary", onClick: () => A.importMedia("selected") }),
        hint("Mantén pulsado un archivo para quitarlo. Formatos: MP4, WebM, MOV, JPG, PNG, WebP, GIF animado.")));
      wrap.append(section("Video",
        app.S.project.media.find(m => m.id === src.mediaId)?.kind === "video" ? h("div", {},
          slider({ label: "Velocidad", min: 0.25, max: 2, step: 0.05, value: look.rate, def: 1, fmt: (v) => v.toFixed(2) + "×", onInput: (v) => app.edit(() => { look.rate = v; }) }),
          slider({ label: "Volumen", min: 0, max: 1, value: look.volume, def: 0, fmt: pct, onInput: (v) => app.edit(() => { look.volume = v; }) }),
          btn({ label: "Reiniciar videos", ic: "restart", kind: "block", onClick: A.restart })) : null));
    }

    if (src.type === "gen") {
      wrap.append(animCatalog(app, (a) => applyAnim(app, a)));
      wrap.append(fold(`Animaciones base (${GENERATORS.length})`, false,
        tiles(GENERATORS.map(g => ({ id: g.id, label: g.name, img: genThumbs()[g.id] })), { value: src.gen, cols: 4, onPick: (id) => A.setSource({ gen: id }) })));
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
        btn({ label: "Sin fondo", kind: "block", onClick: () => app.edit(() => { src.textBg = "#00000000"; }) })));
      const anims = h("div", { class: "chips" });
      for (const [id, label] of TEXT_ANIMS) {
        const b = h("button", { class: `chip ${(src.textAnim || "none") === id ? "on" : ""}`, onclick: () => {
          app.edit(() => { src.textAnim = id; if (id !== "none" && look.fx.scrollX) look.fx.scrollX = 0; });
          anims.querySelectorAll(".chip").forEach(x => x.classList.toggle("on", x === b));
        } }, label);
        anims.append(b);
      }
      wrap.append(section("Animar texto", anims,
        slider({ label: "Velocidad", min: 0.1, max: 4, step: 0.05, value: src.textSpeed ?? 1, def: 1, fmt: (v) => v.toFixed(2) + "×", onInput: (v) => app.edit(() => { src.textSpeed = v; }) }),
        swatches({ label: "Segundo color (karaoke, arcoíris)", value: src.textColor2 || "#ffcc00", onChange: (c) => app.edit(() => { src.textColor2 = c; }) }),
        slider({ label: "Brillo neón", min: 0, max: 1, value: src.textGlow ?? 0, def: 0, fmt: pct, onInput: (v) => app.edit(() => { src.textGlow = v; }) }),
        slider({ label: "Contorno", min: 0, max: 1, value: src.textOutline ?? 0, def: 0, fmt: pct, onInput: (v) => app.edit(() => { src.textOutline = v; }) }),
        swatches({ label: "Color del contorno", value: src.textOutlineColor || "#000000", palette: ["#000000", "#ffffff", "#ff2d55", "#0a84ff", "#34c759", "#ffcc00"], onChange: (c) => app.edit(() => { src.textOutlineColor = c; }) }),
        hint("«Pulso ♪» late con la música cuando el micrófono está activo.")));
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

    if (src.type !== "none") wrap.append(rotateFitSection(app));
    wrap.append(section("Mezcla",
      slider({ label: "Opacidad", min: 0, max: 1, value: look.opacity, def: 1, fmt: pct, onInput: (v) => app.edit(() => { look.opacity = v; }) }),
      segmented({ options: BLEND_MODES, value: look.blend, small: true, onChange: (v) => app.edit(() => { look.blend = v; }) }),
      app.S.project.scenes.length > 1 ? btn({ label: "Usar este contenido en todas las escenas", kind: "block", onClick: A.applyToAllScenes }) : null));
    return wrap;
  },
};

/* ---------------------------------------------------------------- Efectos */
const fxUI = { cat: "Todas", q: "", combine: false };
const fold = (title, open, ...children) => {
  const d = h("details", { class: "fold" }, h("summary", {}, title), ...children);
  if (open) d.open = true;
  return d;
};

const fx = {
  title: (app) => app.surf() ? `Efectos · ${app.surf().name}` : "Efectos",
  render(app) {
    const s = app.surf();
    if (!s) return needSelection(app);
    const look = app.lookSel(), f = look.fx;
    const set = (k) => (v) => app.edit(() => { f[k] = v; });
    const sl = (label, k, min, max, step, def, fmt) => slider({ label, min, max, step, value: f[k] ?? def, def, fmt, onInput: set(k) });

    // ---- Biblioteca ----
    const search = h("input", { type: "search", class: "text-in", placeholder: `Buscar entre ${FX_LIBRARY.length} efectos…`, value: fxUI.q });
    const cats = h("div", { class: "chips" });
    const grid = h("div", { class: "chips fxlib" });
    const renderGrid = () => {
      const q = fxUI.q.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      grid.innerHTML = "";
      const list = FX_LIBRARY.filter(e => (fxUI.cat === "Todas" || e.cat === fxUI.cat) &&
        (!q || (e.name + " " + e.cat).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(q)));
      for (const e of list) {
        grid.append(h("button", { class: "chip", title: e.cat, onclick: () => {
          app.edit(() => { look.fx = fxUI.combine ? { ...look.fx, ...e.fx } : { ...DEFAULT_FX(), ...e.fx }; });
          app.renderPanel();
          toast(`${e.name}${fxUI.combine ? " (combinado)" : ""}`);
        } }, e.name));
      }
      if (!list.length) grid.append(hint("Ningún efecto con ese nombre."));
    };
    for (const c of ["Todas", ...FX_CATEGORIES]) {
      const b = h("button", { class: `chip ${fxUI.cat === c ? "on" : ""}`, onclick: () => {
        fxUI.cat = c; cats.querySelectorAll(".chip").forEach(x => x.classList.toggle("on", x === b)); renderGrid();
      } }, c);
      cats.append(b);
    }
    search.addEventListener("input", () => { fxUI.q = search.value; renderGrid(); });
    renderGrid();

    return h("div", {},
      section(`Biblioteca de efectos (${FX_LIBRARY.length})`,
        search, cats,
        toggle({ label: "Combinar con el efecto actual", hint: "Apagado: cada efecto sustituye al anterior", value: fxUI.combine, onChange: (v) => { fxUI.combine = v; } }),
        grid),
      fold("Borde neón (líneas sobre el contorno)", f.border > 0,
        sl("Grosor", "border", 0, 0.08, 0.001, 0, (v) => v ? (v * 100).toFixed(1) : "No"),
        swatches({ value: f.borderColor, onChange: set("borderColor") }),
        sl("Resplandor", "borderGlow", 0, 1, 0.01, 0.5, pct),
        segmented({ options: BORDER_ANIMS, value: f.borderAnim, small: true, onChange: set("borderAnim") })),
      fold("Color", true,
        sl("Brillo", "brightness", 0, 2, 0.01, 1, pct),
        sl("Contraste", "contrast", 0, 2, 0.01, 1, pct),
        sl("Saturación", "saturation", 0, 3, 0.01, 1, pct),
        sl("Tono", "hue", 0, 1, 0.005, 0, (v) => Math.round(v * 360) + "°"),
        sl("Tono que gira solo", "hueCycle", 0, 4, 0.05, 0, (v) => v ? v.toFixed(2) : "No"),
        sl("Gamma", "gamma", 0.3, 3, 0.01, 1, fix(2)),
        toggle({ label: "Negativo", value: f.invert, onChange: set("invert") })),
      fold("Estilo de color", false,
        h("div", { class: "sl-head" }, h("span", { class: "lab" }, "Mapa de color")),
        segmented({ options: COLORMAPS, value: f.colormap || "none", cols: 4, small: true, onChange: set("colormap") }),
        sl("Sepia", "sepia", 0, 1, 0.01, 0, pct),
        sl("Duotono", "duotone", 0, 1, 0.01, 0, pct),
        swatches({ label: "Duotono: sombras", value: f.duoA, palette: ["#000000", "#1a0033", "#120800", "#001a00", "#200000", "#000a2a", "#0f380f"], onChange: set("duoA") }),
        swatches({ label: "Duotono: luces", value: f.duoB, palette: ["#ffffff", "#00e5ff", "#ffd060", "#b6ff00", "#ff7a00", "#00ffd0", "#ff3cac"], onChange: set("duoB") }),
        sl("Posterizar (niveles)", "posterize", 0, 12, 1, 0, (v) => v < 2 ? "No" : v),
        sl("Umbral blanco/negro", "threshold", 0, 1, 0.01, 0, (v) => v ? pct(v) : "No")),
      fold("Textura y luz", false,
        sl("Viñeta", "vignette", 0, 1.5, 0.01, 0, pct),
        sl("Líneas de TV", "scanlines", 0, 1, 0.01, 0, pct),
        sl("Curvatura de TV antigua", "crt", 0, 1.5, 0.01, 0, pct),
        sl("Semitono (periódico)", "halftone", 0, 1, 0.01, 0, pct),
        sl("Ruido / grano", "noise", 0, 0.6, 0.01, 0, pct),
        sl("Desenfoque", "blur", 0, 2, 0.01, 0, pct)),
      fold("Movimiento", false,
        sl("Zoom", "zoom", 0.2, 4, 0.01, 1, fix(2)),
        sl("Rotación", "rotate", -180, 180, 1, 0, (v) => v + "°"),
        sl("Giro continuo", "spin", -3, 3, 0.05, 0, fix(2)),
        sl("Desplazar ↔", "scrollX", -1, 1, 0.01, 0, fix(2)),
        sl("Desplazar ↕", "scrollY", -1, 1, 0.01, 0, fix(2)),
        sl("Temblor (más fuerte en cada golpe)", "shake", 0, 4, 0.05, 0, fix(2))),
      fold("Distorsión", false,
        sl("Caleidoscopio", "kaleido", 0, 16, 1, 0, (v) => v < 2 ? "No" : v + " lados"),
        segmented({ options: [["none", "Sin espejo"], ["h", "Espejo ↔"], ["v", "Espejo ↕"], ["quad", "Cuádruple"]], value: f.mirror, small: true, onChange: set("mirror") }),
        sl("Mosaico (repetir N×N)", "tile", 1, 10, 1, 1, (v) => v < 2 ? "No" : v + "×" + v),
        sl("Ondas", "wave", 0, 2, 0.01, 0, pct),
        sl("Remolino", "twirl", -3, 3, 0.01, 0, fix(2)),
        sl("Ojo de pez (− pellizco)", "bulge", -1, 1, 0.01, 0, fix(2)),
        sl("Gota de agua", "ripple", 0, 3, 0.01, 0, fix(2)),
        toggle({ label: "Túnel polar", value: f.polar, onChange: set("polar") }),
        sl("Pixelado", "pixelate", 0, 1, 0.01, 0, pct),
        sl("Glitch", "glitch", 0, 1, 0.01, 0, pct),
        sl("Separación RGB", "rgbShift", 0, 0.03, 0.0005, 0, (v) => (v * 1000).toFixed(0)),
        sl("Aberración cromática", "chroma", 0, 0.05, 0.0005, 0, (v) => (v * 1000).toFixed(0))),
      fold("Cámara, video y recortes", look.source.type === "camera",
        hint("Funcionan sobre cámara, video, imagen, texto y dibujo."),
        row(toggle({ label: "Espejo selfie ↔", value: f.flipX, onChange: set("flipX") }), toggle({ label: "Voltear ↕", value: f.flipY, onChange: set("flipY") })),
        sl("Contornos neón", "edges", 0, 1, 0.01, 0, pct),
        sl("Nitidez", "sharpen", 0, 2, 0.01, 0, pct),
        sl("Relieve", "emboss", 0, 1, 0.01, 0, pct),
        sl("Quitar color de fondo (croma)", "chromaKey", 0, 0.8, 0.01, 0, (v) => v ? pct(v) : "No"),
        swatches({ label: "Color a quitar", value: f.keyColor, palette: ["#00ff00", "#0044ff", "#ffffff", "#000000", "#ff0000"], onChange: set("keyColor") }),
        sl("Suavidad del recorte", "keySoft", 0, 0.5, 0.01, 0.1, pct),
        sl("Quitar lo oscuro (luma)", "lumaKey", 0, 0.9, 0.01, 0, (v) => v ? pct(v) : "No"),
        sl("Suavidad de luma", "lumaSoft", 0, 0.5, 0.01, 0.05, pct)),
      fold("Estroboscopio", f.strobe > 0,
        sl("Destellos por segundo", "strobe", 0, 15, 0.5, 0, (v) => v ? v + " Hz" : "No")),
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
        row(s.type === "quad" ? btn({ ic: "straight", label: "Enderezar", kind: "wide", onClick: A.straighten }) : null, btn({ ic: "fit", label: "Pantalla completa", kind: "wide", onClick: A.fillFrame }))),
      section("Girar la superficie",
        hint("Arrastra el círculo azul que aparece encima de la superficie para girarla a cualquier ángulo, o usa los botones."),
        row(btn({ label: "−90°", kind: "wide", onClick: () => A.rotateBy(-90) }), btn({ label: "−15°", kind: "wide", onClick: () => A.rotateBy(-15) }), btn({ label: "−1°", kind: "wide", onClick: () => A.rotateBy(-1) })),
        row(btn({ label: "+1°", kind: "wide", onClick: () => A.rotateBy(1) }), btn({ label: "+15°", kind: "wide", onClick: () => A.rotateBy(15) }), btn({ label: "+90°", kind: "wide", onClick: () => A.rotateBy(90) }))),
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

    // ---- Calidad y salida (composición, fps, render, color, orientación, bordes suaves) ----
    const P = S.project, O = P.settings.output, R = P.settings.record;
    const setO = (k) => (v) => app.edit(() => { O[k] = v; });
    const setSE = (k) => (v) => app.edit(() => { O.softEdge[k] = v; });
    wrap.append(fold("Calidad y resolución", true,
      btn({ label: `Composición: ${P.width}×${P.height}`, ic: "screen", kind: "block", onClick: A.setResolution }),
      hint("De VGA a 8K: Full HD, 2K, 4K UHD/DCI, verticales, ultrapanorámicas y varios proyectores, o un tamaño a medida."),
      h("div", { class: "sl-head" }, h("span", { class: "lab" }, "Fotogramas por segundo")),
      segmented({ options: [[24, "24"], [25, "25"], [30, "30"], [50, "50"], [60, "60"], [120, "Máx."]], value: O.fps, small: true, onChange: setO("fps") }),
      h("div", { class: "sl-head" }, h("span", { class: "lab" }, "Calidad de render")),
      segmented({ options: [[0.5, "Rápida ½"], [0.75, "Media"], [1, "Alta"], [1.5, "Ultra 1.5×"], [2, "Súper 2×"]], value: O.renderScale, small: true, onChange: setO("renderScale") }),
      hint("Ultra y Súper suavizan los bordes (supermuestreo); Rápida ayuda en equipos lentos.")));
    wrap.append(fold("Color del proyector", false,
      slider({ label: "Brillo", min: 0, max: 2, value: O.brightness, def: 1, fmt: pct, onInput: setO("brightness") }),
      slider({ label: "Contraste", min: 0, max: 2, value: O.contrast, def: 1, fmt: pct, onInput: setO("contrast") }),
      slider({ label: "Saturación", min: 0, max: 2, value: O.saturation, def: 1, fmt: pct, onInput: setO("saturation") })));
    wrap.append(fold("Orientación del proyector", false,
      toggle({ label: "Retroproyección (espejo ↔)", hint: "Proyectando desde detrás de la pantalla", value: O.flipH, onChange: setO("flipH") }),
      toggle({ label: "Voltear ↕", value: O.flipV, onChange: setO("flipV") }),
      toggle({ label: "Proyector en el techo (girar 180°)", value: O.rotate === 180, onChange: (v) => app.edit(() => { O.rotate = v ? 180 : 0; }) })));
    wrap.append(fold("Bordes suaves (varios proyectores)", false,
      hint("Une dos o más proyectores sin que se note el solape: oscurece en degradado el lado que se superpone."),
      slider({ label: "Izquierda", min: 0, max: 0.5, value: O.softEdge.left, def: 0, fmt: pct, onInput: setSE("left") }),
      slider({ label: "Derecha", min: 0, max: 0.5, value: O.softEdge.right, def: 0, fmt: pct, onInput: setSE("right") }),
      slider({ label: "Arriba", min: 0, max: 0.5, value: O.softEdge.top, def: 0, fmt: pct, onInput: setSE("top") }),
      slider({ label: "Abajo", min: 0, max: 0.5, value: O.softEdge.bottom, def: 0, fmt: pct, onInput: setSE("bottom") }),
      slider({ label: "Curva (gamma)", min: 1, max: 3.5, step: 0.05, value: O.softEdge.curve, def: 2.2, fmt: fix(2), onInput: setSE("curve") })));
    wrap.append(fold("Grabación y transmisión", false,
      h("div", { class: "sl-head" }, h("span", { class: "lab" }, "Resolución del video")),
      segmented({ options: [[720, "720p"], [1080, "1080p"], [1440, "1440p 2K"], [2160, "2160p 4K"]], value: R.height, small: true, onChange: (v) => app.edit(() => { R.height = v; }) }),
      h("div", { class: "sl-head" }, h("span", { class: "lab" }, "Fotogramas")),
      segmented({ options: [[24, "24 fps"], [30, "30 fps"], [60, "60 fps"]], value: R.fps, small: true, onChange: (v) => app.edit(() => { R.fps = v; }) }),
      h("div", { class: "sl-head" }, h("span", { class: "lab" }, "Calidad")),
      segmented({ options: RECORD_QUALITIES.map(q => [q.mbps, q.label]), value: R.mbps, cols: 2, small: true, onChange: (v) => app.edit(() => { R.mbps = v; }) }),
      btn({ label: S.rec ? "Detener grabación" : "Grabar video de la salida", ic: "camera", kind: `block ${S.rec ? "danger" : "primary"}`, onClick: () => { A.record(); setTimeout(() => app.renderPanel(), 300); } })));
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
      section("Videos",
        toggle({ label: "Optimizar videos al importarlos", hint: (window.LumaDesktop || window.LumaNative)
          ? "Convierte solo lo que hace falta (4K, HEVC, ProRes, bitrate alto…) a un H.264 ligero del tamaño de la salida, con la tarjeta gráfica. Lo que ya es ligero entra al instante."
          : "En la app de Windows y Android los videos pesados se convierten solos al importarlos.",
          value: app.autoOptimize(), onChange: (v) => app.setAutoOptimize(v) })),
      section("Control", h("div", { class: "list" },
        item("midi", "Conectar controlador MIDI", A.midi, "Notas 36-51 = escenas · 60 play · 63/64 siguiente/anterior"),
        item("help", "Ayuda y atajos", () => A.help()),
        item("download", "Buscar actualizaciones", () => A.checkUpdates(false), `Versión instalada: ${app.version().version} · también se comprueba sola al abrir`),
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

export const PANELS = { add, anim, draw, content, fx, shape, layers, scenes, audio, output, menu };
