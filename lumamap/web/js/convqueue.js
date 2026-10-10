// web/js/convqueue.js
// Cola de conversión (app de Windows): los archivos pesados o en formatos raros (video 4K,
// ProRes, HEVC, MOV/AVI/MKV, TIFF, Photoshop, HEIC…) entran AL MOMENTO en la biblioteca
// con «Convirtiendo… %» y se convierten uno tras otro en segundo plano con ffmpeg
// (desktop/optimize.js). Al terminar quedan listos en la biblioteca del proyecto; si una
// superficie ya los usaba, aparecen solos. Si se cierra la app a medias, al volver a
// abrir el proyecto la conversión sigue donde estaba (desde el archivo original).
import { notice, closeNotice, toast } from "./ui.js";

/** Imágenes que solo se abren convirtiéndolas (igual que en desktop/optimize.js). */
export const IMAGE_CONVERT = /\.(tiff?|tga|psd|exr|dpx|heic|heif|jp2|j2k|pcx|sgi|ppm|pgm|pbm|hdr|dds|qoi)$/i;

const jobs = [];          // { id, path, file?, name }
let running = null, hooked = false, appRef = null, hooks = null;

/** ¿Hay conversión en segundo plano en esta app? */
export const canConvert = () => !!globalThis.LumaDesktop?.planMedia;

/**
 * Prepara la cola. hooks.finish(id, file, mediaEntry) importa el archivo ya convertido con ese id
 * (lo guarda en la biblioteca y crea su reproductor).
 */
export function setupQueue(app, h) {
  appRef = app; hooks = h;
  const D = globalThis.LumaDesktop;
  if (!D?.onVideoProgress || hooked) return;
  hooked = true;
  D.onVideoProgress(({ file, pct }) => {
    if (!running || running.path !== file) return;
    const m = entry(running.id);
    if (!m?.pending) return;
    m.pending.pct = pct;
    paintCell(m);
    paintNotice();
  });
}

const entry = (id) => appRef?.S.project.media.find(m => m.id === id);

/**
 * Mira un archivo: si hay que convertirlo, lo deja en la biblioteca como «convirtiendo»
 * y lo pone en la cola. Devuelve la entrada de la biblioteca, o null si no hace falta.
 */
export async function maybeQueue(file, target, makeId) {
  const D = globalThis.LumaDesktop;
  if (!canConvert()) return null;
  const path = D.filePath?.(file) || "";
  if (!path) return null;
  let plan;
  try { plan = await D.planMedia(path, target); } catch { return null; }
  if (!plan || plan.action === "keep" || plan.action === "missing" || !plan.out) return null;
  const image = plan.out === "png";
  const m = {
    id: makeId(), name: file.name.replace(/\.[^.]+$/, "") + (image ? ".png" : ".mp4"), kind: image ? "image" : "video",
    mime: image ? "image/png" : "video/mp4", width: plan.info?.width || 0, height: plan.info?.height || 0, duration: plan.info?.duration || 0,
    size: file.size, thumb: "", pending: { path, pct: 0, reason: plan.reason, original: file.name },
  };
  appRef.S.project.media.push(m);
  jobs.push({ id: m.id, path, file, name: file.name });
  paintNotice();
  pump();
  return m;
}

/** Al abrir un proyecto: lo que quedó a medias se vuelve a poner en la cola. */
export function resumePending() {
  if (!canConvert() || !appRef) return;
  for (const m of appRef.S.project.media) {
    if (!m.pending || m.pending.error || jobs.some(j => j.id === m.id) || running?.id === m.id) continue;
    m.pending.pct = 0;
    jobs.push({ id: m.id, path: m.pending.path, name: m.pending.original || m.name });
  }
  paintNotice();
  pump();
}

/** Quita un archivo de la cola (si aún no empezó). */
export function cancelJob(id) {
  const i = jobs.findIndex(j => j.id === id);
  if (i >= 0) jobs.splice(i, 1);
  paintNotice();
}

export const queueState = () => ({ running: running ? { id: running.id, name: running.name } : null, waiting: jobs.map(j => j.id) });

async function pump() {
  if (running || !jobs.length) return;
  running = jobs.shift();
  const job = running, D = globalThis.LumaDesktop;
  const S = appRef.S;
  try {
    const m = entry(job.id);
    if (!m) return;   // se borró de la biblioteca mientras esperaba
    const plan = await D.planMedia(job.path, { width: S.project.width, height: S.project.height });
    if (plan?.action === "missing") throw new Error("No se encuentra el archivo original (¿se movió o se borró?)");
    const r = await D.convertPath(job.path, { width: S.project.width, height: S.project.height });
    const cur = entry(job.id);
    if (!cur) { if (r.url) D.releaseVideo(r.url); return; }
    let out;
    if (r.url) {
      const blob = await (await fetch(r.url)).blob();
      D.releaseVideo(r.url);
      out = new File([blob], cur.name, { type: cur.mime });
    } else if (job.file) out = job.file;   // al final no hizo falta convertir
    else throw new Error("Vuelve a importar el archivo original");
    await hooks.finish(job.id, out, cur);
    delete cur.pending;
    paintCell(cur);
    notice({ id: "conv-done", text: `✓ Listo: ${cur.name}`, sub: r.reason ? `${r.reason} · ${(r.ms / 1000).toFixed(0)} s` : "", timeout: 8000 });
  } catch (e) {
    const cur = entry(job.id);
    if (cur?.pending) { cur.pending.error = String(e?.message || e).slice(0, 200); paintCell(cur); }
    notice({ id: "conv-err-" + job.id, kind: "err", text: `No se pudo convertir ${job.name}`, sub: String(e?.message || e).slice(0, 160), timeout: 20000,
      actions: job.file ? [{ label: "Usar el original", onClick: () => hooks.finish(job.id, job.file, entry(job.id)).then(() => { const c = entry(job.id); if (c) { delete c.pending; paintCell(c); } }).catch(err => toast(err.message, "err")) }] : [] });
  } finally {
    running = null;
    appRef.changed({ panel: true }); appRef.commitSoon();
    paintNotice();
    pump();
  }
}

/** Aviso fijo con lo que queda en la cola. */
function paintNotice() {
  const n = (running ? 1 : 0) + jobs.length;
  if (!n) { closeNotice("convq"); return; }
  const m = running && entry(running.id), pct = m?.pending ? Math.round(100 * (m.pending.pct || 0)) : 0;
  const text = `🎞 Convirtiendo ${n === 1 ? "1 archivo" : n + " archivos"} en segundo plano`;
  const sub = m ? `${m.pending?.original || m.name} · ${pct} %${jobs.length ? ` · ${jobs.length} en espera` : ""}` : "";
  const el = document.querySelector('#notices [data-id="convq"]');
  if (el) { el.querySelector(".ntx b").textContent = text; const s = el.querySelector(".ntx small"); if (s) s.textContent = sub; return; }
  notice({ id: "convq", text, sub: sub || "Preparando…", actions: [{ label: "Ver biblioteca", onClick: () => appRef.openMediaLibrary?.() }] });
}

/** Barra de progreso en la celda de la biblioteca (sin redibujar todo el panel). */
function paintCell(m) {
  for (const cell of document.querySelectorAll(`[data-mid="${CSS.escape(m.id)}"]`)) {
    const bar = cell.querySelector(".mprog");
    if (!m.pending) { cell.classList.remove("pending"); bar?.remove(); continue; }
    cell.classList.toggle("failed", !!m.pending.error);
    const label = m.pending.error ? "Error" : `${Math.round(100 * (m.pending.pct || 0))} %`;
    if (bar) { bar.style.setProperty("--p", m.pending.pct || 0); bar.dataset.label = label; }
  }
}
