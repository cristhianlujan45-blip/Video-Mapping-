// web/js/ffgl.js
// Plugins FFGL de Resolume (.dll) como contenido de una superficie. Solo en la app de
// Windows: cada plugin corre en su propio proceso (desktop/ffglhost.js) y aquí se piden
// sus fotogramas (como mucho 960×540 a 30 por segundo) y se pintan en un lienzo que el
// compositor usa como cualquier otra fuente. Sin window.LumaDesktop.ffgl no hace nada.
const api = () => globalThis.LumaDesktop?.ffgl || null;
export const ffglAvailable = () => !!api();

export const FFGL_MAX_W = 960, FFGL_MAX_H = 540;
const FRAME_MS = 1000 / 30;
const RETRY_MS = 5000;     // tras un fallo al dibujar, se espera esto antes de pedir otro fotograma
const IDLE_MS = 8000;      // un plugin que ya no se dibuja se cierra (libera su proceso)

/** Quita el envoltorio de los errores del IPC de Electron. */
export const cleanError = (e) => String(e?.message || e || "").replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

/** Tamaño de los fotogramas para una superficie: su forma, como mucho 960×540. */
export function ffglSize(aspect = 16 / 9) {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
  let w = FFGL_MAX_W, h = Math.round(w / a);
  if (h > FFGL_MAX_H) { h = FFGL_MAX_H; w = Math.round(h * a); }
  return { w: Math.max(16, w - (w % 2)), h: Math.max(16, h - (h % 2)) };
}

/** Estado por plugin (ruta) para enseñarlo en el panel: { error, info, fps }. */
const statusByPath = new Map();
export const ffglStatus = (path) => statusByPath.get(path) || null;
/** «Reintentar» del panel: vuelve a abrir el plugin aunque se hubiera desactivado. */
const retries = new Map();
export function ffglRetry(path) { retries.set(path, (retries.get(path) || 0) + 1); statusByPath.delete(path); }

export class FFGLCache {
  constructor() { this.map = new Map(); this.lastSweep = 0; }

  /**
   * Último fotograma del plugin de la superficie `key`: { canvas, version } o null.
   * Pide el siguiente sin esperar (el dibujo nunca se para por un plugin lento).
   * o: { aspect, time, bpm, phase, input } (input: video, cámara o imagen para los efectos).
   */
  get(key, src, o = {}) {
    if (!api() || !src?.ffglPath) return null;
    const now = performance.now();
    let e = this.map.get(key);
    // Otro plugin o «Reintentar»: se (re)abre. Si falló al dibujar se sigue con el mismo proceso
    // (el anfitrión lo reinicia solo hasta 3 veces por minuto y luego lo desactiva).
    if (e && (e.path !== src.ffglPath || e.gen !== (retries.get(src.ffglPath) || 0))) { this.drop(key); e = null; }
    if (!e) e = this._open(key, src.ffglPath);
    e.used = now;
    const ready = e.id && !e.busy && !e.off && (!e.error || now - e.failedAt > RETRY_MS);
    if (ready && now - e.last >= FRAME_MS) this._request(e, src, o, now);
    if (now - this.lastSweep > 2000) this._sweep(now);
    return e.version ? { canvas: e.canvas, version: e.version } : null;
  }

  _open(key, path) {
    const canvas = document.createElement("canvas");
    canvas.width = 16; canvas.height = 16;
    const e = { path, gen: retries.get(path) || 0, id: null, info: null, canvas, ctx: canvas.getContext("2d"), version: 0, busy: true, last: 0, error: "", failedAt: 0, used: 0, frames: 0, fpsAt: performance.now() };
    this.map.set(key, e);
    api().open(path).then((r) => {
      e.id = r.id; e.info = r.info; e.busy = false;
      statusByPath.set(path, { error: "", info: r.info, fps: 0 });
      if (e.dropped) api().close(r.id).catch(() => {});
    }).catch((err) => { this._fail(e, err); e.off = true; });   // no se pudo abrir: hasta «Reintentar»
    return e;
  }

  _fail(e, err) {
    e.error = cleanError(err); e.failedAt = performance.now(); e.busy = false;
    if (/se ha desactivado|No está el anfitrión|Solo se cargan/.test(e.error)) e.off = true;   // no se reintenta solo
    statusByPath.set(e.path, { ...(statusByPath.get(e.path) || {}), error: e.error });
  }

  /** Imagen de entrada de un efecto, a la medida pedida (RGBA, fila 0 arriba). */
  _grab(e, el, w, h) {
    if (!el) return null;
    if (el.readyState !== undefined && el.readyState < 2) return null;   // video aún sin fotograma
    if (!e.inCanvas) { e.inCanvas = document.createElement("canvas"); e.inCtx = e.inCanvas.getContext("2d", { willReadFrequently: true }); }
    if (e.inCanvas.width !== w || e.inCanvas.height !== h) { e.inCanvas.width = w; e.inCanvas.height = h; }
    try {
      e.inCtx.clearRect(0, 0, w, h);
      e.inCtx.drawImage(el, 0, 0, w, h);
      const d = e.inCtx.getImageData(0, 0, w, h).data;
      return new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
    } catch { return null; }
  }

  async _request(e, src, o, now) {
    const { w, h } = ffglSize(o.aspect);
    let input;
    if (e.info?.type === "effect") {
      input = this._grab(e, o.input, w, h);
      if (!input) return;   // el efecto necesita una imagen: sin ella no se pide nada
    }
    e.busy = true; e.last = now;
    try {
      const fr = await api().render(e.id, { width: w, height: h, time: o.time || 0, bpm: o.bpm || 120, barPhase: o.phase || 0, params: src.ffglParams || {}, input });
      if (e.dropped) return;
      if (e.canvas.width !== fr.width || e.canvas.height !== fr.height) { e.canvas.width = fr.width; e.canvas.height = fr.height; }
      const px = new Uint8ClampedArray(fr.data.buffer, fr.data.byteOffset, fr.data.byteLength);
      e.ctx.putImageData(new ImageData(px, fr.width, fr.height), 0, 0);
      e.version++; e.frames++; e.error = "";
      const t = performance.now();
      if (t - e.fpsAt > 1000) {
        statusByPath.set(e.path, { error: "", info: e.info, fps: Math.round(e.frames * 1000 / (t - e.fpsAt)) });
        e.frames = 0; e.fpsAt = t;
      }
    } catch (err) { this._fail(e, err); }
    finally { e.busy = false; }
  }

  drop(key) {
    const e = this.map.get(key);
    if (!e) return;
    this.map.delete(key);
    e.dropped = true;
    if (e.id) api()?.close(e.id).catch(() => {});
  }

  _sweep(now) {
    this.lastSweep = now;
    for (const [k, e] of this.map) if (now - e.used > IDLE_MS) this.drop(k);
  }

  dispose() { for (const k of [...this.map.keys()]) this.drop(k); }
}
