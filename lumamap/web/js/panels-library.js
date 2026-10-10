// web/js/panels-library.js
// «Biblioteca»: todos los videos, fotos y GIF del proyecto en un sitio, con lo que se está
// convirtiendo en segundo plano (barra de progreso) y un botón para subir archivos pesados.
import { h, btn, hint, dialog, closeDialog, toast } from "./ui.js";
import { mediaCell } from "./panels.js";
import { canConvert, queueState } from "./convqueue.js";

export async function openMediaLibrary(app, { pick = false } = {}) {
  const A = app.actions, body = h("div", { class: "medialib" });
  const draw = () => {
    const P = app.S.project, media = P.media.filter(m => m.kind !== "model");
    const q = queueState(), busy = (q.running ? 1 : 0) + q.waiting.length;
    const grid = h("div", { class: "mediagrid" }, ...media.map(m => {
      const used = [...new Set(P.scenes.flatMap(sc => Object.entries(sc.looks).filter(([, l]) => l.source.mediaId === m.id).map(([sid]) => sid)))];
      const cell = mediaCell(m, { onClick: () => {
        if (m.pending?.error) return toast(m.pending.error, "err");
        const l = app.S.sel && app.lookSel?.();
        if (l) { A.setSource({ type: "media", mediaId: m.id }); closeDialog(); toast(`«${m.name}» en la superficie`); }
        else toast("Toca primero una superficie del escenario para poner ahí el archivo");
      } });
      if (used.length) cell.append(h("b", { class: "used" }, "En uso"));
      return cell;
    }));
    body.replaceChildren(...[
      busy ? h("p", { class: "hint" }, `🎞 Convirtiendo en segundo plano: ${busy} archivo(s). Puedes seguir trabajando; al terminar quedan listos aquí.`) : null,
      media.length ? grid : hint("Aún no hay archivos. Súbelos aquí: los pesados se convierten solos mientras sigues trabajando."),
      btn({ label: canConvert() ? "Subir archivos (también pesados: 4K, MOV, ProRes, TIFF…)" : "Subir video, imagen o GIF", ic: "upload", kind: "block primary", onClick: () => upload() }),
      hint("Toca un archivo para ponerlo en la superficie elegida. Mantén pulsado (en el panel Contenido) para quitarlo."),
    ].filter(Boolean));
  };
  const upload = async () => { await A.importMedia("library"); draw(); };
  // Se repinta mientras convierte (la barra se mueve sola; esto pone las miniaturas al terminar).
  const sig = () => app.S.project.media.map(m => m.id + (m.pending ? (m.pending.error ? "e" : "p") : "")).join() + queueState().waiting.length;
  let last = "";
  const t = setInterval(() => { const s = sig(); if (body.isConnected && s !== last) { last = s; draw(); } }, 1000);
  last = sig(); draw();
  if (pick) setTimeout(upload, 50);
  await dialog({ title: "📁 Biblioteca", content: body, wide: true, buttons: [{ label: "Cerrar", value: null }] });
  clearInterval(t);
}
