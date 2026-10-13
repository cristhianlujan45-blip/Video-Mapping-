// web/js/panels-nodes.js
// «Red de nodos» (como las redes de TouchDesigner): la cadena REAL de cada superficie dibujada
// como nodos conectados — Fuente → Señales y control → Efectos (solo los que cambian algo) →
// Forma → Mezcla → Salida. Cada nodo resume lo que hace y, al tocarlo, abre el panel donde se
// cambia. No es un dibujo aparte: se lee del proyecto, así que siempre dice la verdad.
import { h, dialog, closeDialog, hint, lazyThumb } from "./ui.js";
import { DEFAULT_FX, lookOf } from "./model.js";
import { FX_RANGE } from "./params.js";
import { sourceThumb } from "./panels.js";

// Familias (colores como en TouchDesigner: imagen morado, señales verde, geometría azul…).
const FAM = {
  src: ["Fuente", "#8b5cf6"], sig: ["Señales y control", "#22c55e"], fx: ["Efecto", "#a855f7"],
  shape: ["Forma", "#3b82f6"], mix: ["Mezcla", "#eab308"], out: ["Salida", "#ef4444"],
};
const FX_GROUPS = [
  ["Estilo", ["style"], "fx"], ["Borde neón", ["border"], "fx"],
  ["Color", ["brightness", "contrast", "saturation", "hue", "hueCycle", "gamma", "invert"], "fx"],
  ["Estilo de color", ["colormap", "sepia", "duotone", "posterize", "threshold"], "fx"],
  ["Textura y luz", ["vignette", "scanlines", "crt", "halftone", "noise", "blur"], "fx"],
  ["Movimiento", ["zoom", "rotate", "spin", "scrollX", "scrollY", "shake"], "fx"],
  ["Distorsión", ["kaleido", "mirror", "tile", "wave", "twirl", "bulge", "ripple", "polar", "pixelate", "glitch", "rgbShift", "chroma"], "fx"],
  ["Cámara y recortes", ["flipX", "flipY", "edges", "sharpen", "emboss", "chromaKey", "lumaKey"], "fx"],
  ["Estroboscopio", ["strobe"], "fx"],
];
const EXTRA_NAMES = { style: "Estilo", invert: "Negativo", colormap: "Mapa de color", mirror: "Espejo", polar: "Túnel polar", flipX: "Espejo selfie", flipY: "Voltear" };
const fxName = (k) => FX_RANGE[k]?.[0] || EXTRA_NAMES[k] || k;
const SHAPE_NAMES = { quad: "4 esquinas", poly: "Forma libre", circle: "Círculo", mesh: "Malla" };
const BLEND_NAMES = { normal: "Normal", add: "Sumar luz", screen: "Trama", multiply: "Multiplicar" };

/** Nodos de la cadena de una superficie (exportado para las pruebas). */
export function surfaceNodes(app, s) {
  const S = app.S, look = lookOf(app.scene(), s.id), f = look.fx, D = DEFAULT_FX();
  const nodes = [];
  const th = sourceThumb(app, look.source, null);
  nodes.push({ fam: "src", title: th.label, lines: [look.source.type === "media" ? "Video / foto" : look.source.type === "gen" ? "Animación" : ""], img: th.img, tab: "content" });

  const sig = [];
  const lfos = S.project.settings.lfos.filter(l => l.on && l.param.startsWith(`surf/${s.id}/`));
  if (lfos.length) sig.push(`${lfos.length} señal${lfos.length > 1 ? "es" : ""} animando`);
  if (look.audio?.enabled) sig.push(`Reacciona al sonido (${look.audio.band})`);
  const maps = S.project.settings.control.mappings.filter(m => m.target.startsWith(`surf/${s.id}/`) || (S.sel === s.id && m.target.startsWith("surf/sel/")));
  if (maps.length) sig.push(`${maps.length} control${maps.length > 1 ? "es" : ""} MIDI/teclas/mando`);
  if (S.project.settings.react?.enabled) sig.push("Modo ritmo general");
  nodes.push({ fam: "sig", title: sig.length ? "Se mueve solo" : "Sin señales", lines: sig.length ? sig : ["Mantén pulsado un deslizador → «Animar al ritmo»"], tab: "audio", dim: !sig.length });

  let anyFx = false;
  for (const [name, keys, tab] of FX_GROUPS) {
    const changed = keys.filter(k => k === "style" ? (f.style || "none") !== "none" : JSON.stringify(f[k]) !== JSON.stringify(D[k]));
    if (!changed.length) continue;
    anyFx = true;
    nodes.push({ fam: "fx", title: name, lines: changed.slice(0, 3).map(k => k === "style" ? `Estilo: ${f.style}` : fxName(k)).concat(changed.length > 3 ? [`+${changed.length - 3} más`] : []), tab });
  }
  if (!anyFx) nodes.push({ fam: "fx", title: "Sin efectos", lines: ["Toca para añadir"], tab: "fx", dim: true });

  const shape = [SHAPE_NAMES[s.type] || s.type];
  if (s.type === "quad" && (s.cols > 2 || s.rows > 2)) shape.push(`Malla ${s.cols}×${s.rows}`);
  if (s.mask?.enabled) shape.push("Con máscara");
  if (s.locked) shape.push("Bloqueada");
  nodes.push({ fam: "shape", title: s.name, lines: shape, tab: "shape" });

  const mix = [`Opacidad ${Math.round((look.opacity ?? 1) * 100)}%`, `Mezcla: ${BLEND_NAMES[look.blend] || look.blend}`];
  if (look.next) mix.push("Hay algo preparado (GO)");
  if (s.hidden || look.hidden) mix.push("Oculta");
  nodes.push({ fam: "mix", title: "Mezcla", lines: mix, tab: "live" });

  nodes.push({ fam: "out", title: s.screen ? `Pantalla ${s.screen}` : "Todas las pantallas", lines: [`Brillo general ${Math.round((S.master ?? 1) * 100)}%`, S.blackout ? "APAGÓN" : `${S.project.width}×${S.project.height}`], tab: "output" });
  return nodes;
}

export function openNodes(app) {
  const S = app.S;
  const body = h("div", { class: "nodes" });
  let cur = S.sel || S.project.surfaces[0]?.id;
  const draw = () => {
    const surfs = S.project.surfaces;
    if (!surfs.length) { body.replaceChildren(hint("Aún no hay superficies. Crea una en «Añadir».")); return; }
    const s = surfs.find(x => x.id === cur) || surfs[0];
    const pick = h("div", { class: "chips" }, ...surfs.map(x => h("button", { class: `chip ${x.id === s.id ? "on" : ""}`, onclick: () => { cur = x.id; app.select(x.id); draw(); } }, x.name)));
    const net = h("div", { class: "nodenet" });
    surfaceNodes(app, s).forEach((n, i) => {
      if (i) net.append(h("div", { class: "nodewire", "aria-hidden": "true" }));
      const [fam, col] = FAM[n.fam];
      const img = n.img !== undefined && n.img !== "" ? h("img", { alt: "" }) : null;
      if (img) { if (typeof n.img === "function") lazyThumb(img, n.img); else img.src = n.img; }
      const node = h("button", { class: `node ${n.dim ? "dim" : ""}`, "data-fam": n.fam, title: "Abrir donde se cambia", onclick: () => { closeDialog(); app.select(s.id); app.openTab(n.tab); } },
        h("div", { class: "nodehead" }, fam),
        img,
        h("b", {}, n.title),
        ...n.lines.filter(Boolean).map(l => h("small", {}, l)));
      node.style.setProperty("--fam", col);   // color de la familia (las variables CSS no van en el objeto style)
      net.append(node);
    });
    body.replaceChildren(pick,
      hint("Así viaja la imagen de esta superficie, de izquierda a derecha (como una red de TouchDesigner). Toca un nodo para cambiarlo."),
      h("div", { class: "nodescroll" }, net));
  };
  draw();
  return dialog({ title: "🔗 Red de nodos", content: body, wide: true, buttons: [{ label: "Cerrar", kind: "primary", value: null }] });
}
