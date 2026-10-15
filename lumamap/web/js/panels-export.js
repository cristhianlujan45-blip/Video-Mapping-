// web/js/panels-export.js
// Ventana «🎬 Exportar el show a video»: resolución (hasta 4K), fotogramas por segundo, calidad y
// la canción; luego el progreso con Cancelar. El trabajo lo hace A.exportShow (editor.js).
import { h, btn, dialog, closeDialog, segmented, toggle, hint, toast } from "./ui.js";
import { bitrateFor, fmtDur } from "./exportshow.js";

const prefs = { height: 2160, fps: 30, quality: "high", withSong: true };

export function openExport(app) {
  const A = app.actions, S = app.S, info = A.exportInfo(), P = S.project;
  if (S.exporting) return toast("Ya se está exportando");
  const sizes = [[720, "720p"], [1080, "1080p"], [1440, "2K"], [2160, "4K"]].filter(([v]) => v <= info.maxH);
  if (!sizes.some(([v]) => v === prefs.height)) prefs.height = sizes.at(-1)[0];
  const body = h("div", { class: "export" });
  const est = h("small", { class: "dim" });
  const outSize = () => {
    const k = prefs.height / P.height, w = Math.round(P.width * k / 2) * 2;
    const mb = bitrateFor(w, prefs.height, prefs.fps, prefs.quality) * info.plan.total / 8 / 1048576;
    est.textContent = `${w}×${prefs.height} · ${prefs.fps} fps · unos ${mb >= 1024 ? (mb / 1024).toFixed(1) + " GB" : Math.round(mb) + " MB"}`;
  };
  const what = info.plan.bySong ? `por la canción «${info.song.name}»` : "por las duraciones de la línea de tiempo";
  body.append(...[
    h("p", {}, h("b", {}, `Show de ${fmtDur(info.plan.total)}`), ` · ${info.plan.blocks.length} escena(s), ${what}.`),
    hint("No es grabar la pantalla: cada fotograma se dibuja en su momento exacto y se guarda, así sale perfecto en 4K aunque tu equipo no pueda moverlo en directo. Tarda más que el show."),
    h("div", { class: "sl-head" }, h("span", { class: "lab" }, "Resolución")),
    segmented({ options: sizes, value: prefs.height, small: true, onChange: (v) => { prefs.height = v; outSize(); } }),
    h("div", { class: "sl-head" }, h("span", { class: "lab" }, "Fotogramas por segundo")),
    segmented({ options: [[24, "24"], [25, "25"], [30, "30"], [60, "60"]], value: prefs.fps, small: true, onChange: (v) => { prefs.fps = v; outSize(); } }),
    h("div", { class: "sl-head" }, h("span", { class: "lab" }, "Calidad")),
    segmented({ options: [["high", "Alta"], ["max", "Máxima"]], value: prefs.quality, small: true, onChange: (v) => { prefs.quality = v; outSize(); } }),
    info.song ? toggle({ label: `Con la canción «${info.song.name}»`, hint: "Se oye en el video y lo que reacciona al ritmo reacciona igual", value: prefs.withSong, onChange: (v) => { prefs.withSong = v; } })
      : hint("Sin canción: lo que va al ritmo sigue el BPM del proyecto. Carga una canción en Escenas y show para que suene en el video."),
    info.cams ? hint("Las cámaras en vivo no se pueden volver a grabar: saldrán con lo que vean mientras se exporta.") : null,
    est].filter(Boolean));
  outSize();
  const go = btn({ label: "🎬 Exportar", kind: "primary wide", onClick: () => start() });
  if (!info.can) { go.disabled = true; body.append(hint("Este navegador no tiene codificador de video (WebCodecs). Actualiza Chrome o «Android System WebView».")); }
  body.append(h("div", { class: "row" }, go));
  let ctl = null;
  const done = dialog({ title: "🎬 Exportar el show a video", content: body, buttons: [{ label: "Cerrar", value: null }] });
  done.then(() => ctl?.abort());

  async function start() {
    const name = `${(P.name || "show").replace(/[^\w\- áéíóúñÁÉÍÓÚÑ]+/g, "").trim() || "show"}-${prefs.height}p.mp4`;
    let file = null;
    try { file = await A.exportPickFile(name); }
    catch (e) { if (e?.name === "AbortError") return; console.warn(e); }   // sin acceso a archivos: se guarda al final
    ctl = new AbortController();
    const bar = h("i"), line = h("p", {}, "Preparando…"), cancel = btn({ label: "Cancelar", kind: "danger", onClick: () => ctl.abort() });
    body.replaceChildren(h("div", { class: "exbar" }, bar), line, hint("Puedes dejarlo trabajando. La proyección se queda quieta mientras tanto."), h("div", { class: "row" }, cancel));
    try {
      const r = await A.exportShow({ ...prefs, file, signal: ctl.signal, onProgress: (p) => {
        bar.style.width = (100 * p.i / p.n).toFixed(1) + "%";
        line.textContent = `${fmtDur(p.t)} de ${fmtDur(p.total)} · ${p.w}×${p.h} ${p.codec === "avc" ? "H.264" : "VP9"}${p.audio ? " + sonido" : ""} · faltan unos ${fmtDur(p.eta)}`;
      } });
      const mb = r.size / 1048576;
      body.replaceChildren(...[h("p", {}, h("b", {}, "✓ Video listo: "), r.name),
        hint(`${r.width}×${r.height} a ${r.fps} fps · ${fmtDur(r.seconds)} · ${r.codec}${r.audio ? " + " + r.audio : " sin sonido"} · ${mb >= 1024 ? (mb / 1024).toFixed(2) + " GB" : mb.toFixed(1) + " MB"}`),
        r.codec === "VP9" ? hint("Tu equipo no codifica H.264, así que va en VP9 (dentro de MP4): lo abren VLC, Chrome, OBS y DaVinci Resolve.") : null,
        h("div", { class: "row" }, btn({ label: "Cerrar", kind: "primary", onClick: () => closeDialog() }))].filter(Boolean));
      toast(`Video exportado: ${r.name}`);
    } catch (e) {
      const aborted = e?.name === "AbortError";
      body.replaceChildren(h("p", {}, aborted ? "Exportación cancelada." : "No se pudo exportar: " + (e?.message || e)),
        h("div", { class: "row" }, btn({ label: "Cerrar", onClick: () => closeDialog() })));
      if (!aborted) console.error(e);
    }
  }
}
