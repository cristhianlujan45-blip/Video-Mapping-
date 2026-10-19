// web/js/panels-camfx.js
// «📷 Efectos de cámara» de los plugins (shaders ISF con imagen de entrada) y los mismos como
// «🎨 Filtros» para tus fotos y videos. No son animaciones: necesitan una imagen (la cámara en vivo,
// un video o una foto) y por eso viven aquí y no en la biblioteca de animaciones.
//   · Solo cámara ("camera"): pensados para alguien delante de la cámara (estelas, escáner, mira…).
//   · Cámara y videos ("video"): necesitan movimiento; en una foto no harían nada.
//   · Cámara, videos y fotos ("both"): filtros que van con cualquier imagen.
import { h, section, btn, tiles, hint, toast } from "./ui.js";
import { getShader, camFxFor } from "./plugins.js";
import { animThumb } from "./thumbs.js";
import { tipCard } from "./tutorial.js";

const imageInput = (sh) => sh?.isf.inputs.find(i => i.type === "image")?.name || null;
const USE_NOTE = { camera: "solo cámara", video: "cámara y videos", both: "cámara, videos y fotos" };

/** Lo que alimenta al efecto de cámara de esta fuente, o null si la fuente no es uno. */
export function camBinding(src) {
  if (src?.type !== "shader") return null;
  const name = imageInput(getShader(src.shaderId));
  return name ? ((src.shaderParams || {})[name] || { kind: "camera" }) : null;
}

/** Qué tipo de imagen hay: "camera", "video", "image" o null (animación, texto…). */
export function imageKind(app, src) {
  const media = (id) => app.S.project.media.find(m => m.id === id);
  if (src?.type === "camera") return "camera";
  if (src?.type === "media") { const k = media(src.mediaId)?.kind; return k === "video" || k === "image" ? k : null; }
  const b = camBinding(src);
  if (!b) return null;
  if (b.kind !== "media") return "camera";
  const k = media(b.id)?.kind;
  return k === "video" || k === "image" ? k : null;
}

/** Pone el efecto sobre la imagen actual (la cámara elegida, o tu foto / video). */
export function applyCamFx(app, a) {
  const look = app.lookSel(), src = look?.source;
  const sh = getShader(a.shader), inp = imageInput(sh);
  if (!src || !inp) return;
  const prev = camBinding(src);
  const bind = prev || (src.type === "media" ? { kind: "media", id: src.mediaId } : { kind: "camera", ...(src.camId ? { camId: src.camId } : {}) });
  if (a.use === "camera" && bind.kind === "media") return toast("Este efecto es solo para la cámara en vivo");
  app.actions.setSource({ type: "shader", shaderId: a.shader, shaderParams: { [inp]: bind }, speed: 1 });
  toast(a.name);
}

/** Quita el efecto y deja la cámara, la foto o el video tal cual. */
export function removeCamFx(app) {
  const b = camBinding(app.lookSel()?.source);
  if (!b) return;
  if (b.kind === "media") app.actions.setSource({ type: "media", mediaId: b.id });
  else app.actions.setSource({ type: "camera", camId: b.camId || "" });
}

/** Rejilla con los efectos que sirven para lo que hay en la superficie (o null si no hay imagen). */
export function camFxSection(app, { fold = null } = {}) {
  const src = app.lookSel()?.source;
  const kind = imageKind(app, src);
  if (!kind) return null;
  const list = camFxFor(kind);
  if (!list.length) return null;
  const on = src.type === "shader" ? list.find(a => a.shader === src.shaderId)?.id ?? null : null;
  const b = camBinding(src);
  const title = kind === "camera" ? `📷 Efectos de cámara (${list.length})` : `🎨 Filtros para ${kind === "video" ? "este video" : "esta foto"} (${list.length})`;
  const body = [
    tipCard(app, "camfx"),
    hint(kind === "camera"
      ? "Hechos para la cámara en vivo. Los que llevan 🎞 también sirven como filtro de tus fotos y videos (Contenido → Video o imagen)."
      : `Efectos de cámara que también funcionan como filtro: tu ${kind === "video" ? "video" : "foto"} sigue siendo el mismo, el filtro va encima. Los que solo tienen sentido con la cámara en vivo${kind === "image" ? " o con movimiento" : ""} no salen aquí.`),
    b ? btn({ label: b.kind === "media" ? `✕ Quitar el filtro (volver al ${kind === "video" ? "video" : "foto"} tal cual)` : "✕ Quitar el efecto (volver a la cámara tal cual)", kind: "block", onClick: () => removeCamFx(app) }) : null,
    tiles(list.map(a => ({ id: a.id, label: a.name + (kind === "camera" && a.use !== "camera" ? " 🎞" : ""), desc: `${a.name} · ${a.pack} · ${USE_NOTE[a.use]}`, img: () => animThumb(a) })),
      { value: on, cols: 4, onPick: (id) => applyCamFx(app, list.find(x => x.id === id)) }),
  ];
  if (fold) return fold(title, !!b, ...body);
  return section(title, ...body);
}

/** Atajo desde la biblioteca de animaciones: los efectos de cámara están en su sitio. */
export function camFxPointer(app) {
  const n = camFxFor("camera").length;
  if (!n) return null;
  return h("div", { class: "row" },
    btn({ label: `📷 Efectos de cámara (${n}) y filtros para fotos y videos`, kind: "block", title: "Ponen la cámara en vivo (o tu foto o video) con un efecto encima", onClick: () => {
      if (!app.surf()) { app.actions.addShape("rect"); app.actions.fillFrame(); }
      const src = app.lookSel()?.source;
      if (src && !imageKind(app, src)) app.actions.setSource({ type: "camera" });
      if (app.S.tab !== "content") app.openTab("content"); else app.renderPanel();   // abrirla otra vez la cerraría
    } }));
}
