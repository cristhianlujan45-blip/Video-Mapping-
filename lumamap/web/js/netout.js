// web/js/netout.js
// «Salida por red»: manda la proyección (lo mismo que sale por el proyector) al servidor local
// como JPEG, unas veces por segundo, para verla en OBS, vMix, TouchDesigner o un navegador en
// http://IP:puerto/stream.mjpg. Funciona en la app de Windows/Mac y en el navegador servido por
// LumaMap; en Android no hay servidor local (allí se dice claro).
export const NET_SIZES = [[540, "540p"], [720, "720p"], [1080, "1080p"]];
export const NET_FPS = [[10, "10"], [15, "15"], [25, "25"], [30, "30"]];

/** ¿Hay por dónde mandarla? (WebSocket del servidor local abierto). */
export const netOutAvailable = (app) => !!app.remote?.ws && app.remote.ws.readyState === 1;

/**
 * Arranca el envío. make(height) → { canvas, render(now), dispose() } (lo da el editor, con el
 * mismo dibujo que la grabación). Devuelve el estado (se para con stop()).
 */
export function startNetOut(app, make, { height = 720, fps = 25, quality = 0.8 } = {}) {
  const off = make(height);
  const st = { height, fps, sent: 0, last: 0, busy: false, off, bytes: 0, t0: performance.now() };
  st.tick = (now) => {
    if (st.busy || now - st.last < 1000 / st.fps - 2) return;
    const ws = app.remote?.ws;
    if (!ws || ws.readyState !== 1 || ws.bufferedAmount > 4_000_000) return;   // sin conexión o va lenta: se salta
    st.last = now; st.busy = true;
    off.render(now);
    off.canvas.toBlob(async (blob) => {
      try { if (blob && ws.readyState === 1) { const buf = await blob.arrayBuffer(); ws.send(buf); st.sent++; st.bytes += buf.byteLength; } }
      finally { st.busy = false; }
    }, "image/jpeg", quality);
  };
  st.stop = () => { st.stopped = true; off.dispose(); };
  return st;
}
