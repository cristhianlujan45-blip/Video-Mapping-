// web/js/objscan-worker.js
// Reconocer el objeto y calcular la caja en un hilo aparte: el cálculo va a toda velocidad y la
// app no se congela (en un equipo sin tarjeta gráfica o en un móvil lento, compartir el hilo con
// el dibujo lo hacía muchas veces más lento).
import { analyzeObject, solveBoxSteps } from "./objscan.js";

self.onmessage = (e) => {
  const { id, map, proj, opts } = e.data || {};
  try {
    const ana = analyzeObject(map);
    let sol = null;
    if (ana.kind === "box" && proj) {
      const it = solveBoxSteps(ana, proj, opts || {});
      let r = it.next(), t = 0;
      while (!r.done) { const now = performance.now(); if (now - t > 150) { self.postMessage({ id, progress: r.value }); t = now; } r = it.next(); }
      sol = r.value;
    }
    self.postMessage({ id, ana, sol });
  } catch (err) { self.postMessage({ id, error: String(err?.message || err) }); }
};
