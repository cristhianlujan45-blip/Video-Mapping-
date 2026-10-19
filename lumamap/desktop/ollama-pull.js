// desktop/ollama-pull.js
// Descarga de un modelo de Ollama («ollama pull») que no se queda colgada:
//  - suma el progreso de todas las partes (el modelo grande y los ficheros pequeños);
//  - dice en qué fase va (descargando, comprobando, instalando);
//  - si no llega ni un byte en un rato (pasa a veces cerca del final), corta y vuelve
//    a pedirla: Ollama continúa donde iba, no empieza de cero;
//  - si se cae la conexión con Ollama, reintenta sola.
// Sin Electron: se prueba con un Ollama simulado (tests/ai.test.js).

/** Fase legible a partir del estado que manda Ollama. */
function phaseOf(status = "") {
  if (/^pulling manifest/.test(status)) return "manifest";
  if (/^(pulling|downloading)/.test(status)) return "download";
  if (/verifying/.test(status)) return "verify";
  if (/writing|removing|success/.test(status)) return status === "success" ? "success" : "write";
  return "other";
}

/**
 * pullModel({ endpoint, model, onProgress, signal }) → { ok, error?, retries }
 * onProgress({ phase, status, completed, total, retries }) se llama como mucho 5 veces por segundo.
 */
/**
 * onStuck(): si un reintento tampoco avanza ni un byte (Ollama se quedó enganchado a una
 * descarga colgada por dentro), se llama para reiniciar Ollama antes del siguiente intento.
 */
async function pullModel({ endpoint = "http://localhost:11434", model, onProgress = () => {}, signal, onStuck,
  stallMs = 45000, verifyMs = 600000, maxRetries = 12, retryDelay = 2000, fetchImpl = fetch } = {}) {
  const url = String(endpoint).replace(/\/+$/, "") + "/api/pull";
  const parts = new Map();     // digest -> { total, completed } (se conserva entre reintentos)
  let retries = 0, lastSend = 0, phase = "manifest", status = "", restarts = 0;
  const bytes = () => { let n = 0; for (const p of parts.values()) n += p.completed; return n; };
  const send = (force = false) => {
    if (!force && Date.now() - lastSend < 200) return;
    lastSend = Date.now();
    let total = 0, completed = 0;
    for (const p of parts.values()) { total += p.total; completed += Math.min(p.total, p.completed); }
    onProgress({ phase, status, completed, total, retries });
  };
  for (;;) {
    if (signal?.aborted) return { ok: false, error: "cancelled", retries };
    const ctl = new AbortController();
    const onAbort = () => ctl.abort();
    signal?.addEventListener("abort", onAbort);
    let lastData = Date.now(), stalled = false, done = false, error = "";
    const before = bytes();
    // Vigilante: sin datos nuevos en «stallMs» (o «verifyMs» mientras comprueba) → se corta y se reintenta.
    const watch = setInterval(() => {
      const limit = phase === "verify" || phase === "write" ? verifyMs : stallMs;
      if (Date.now() - lastData > limit) { stalled = true; ctl.abort(); }
    }, Math.min(1000, Math.max(50, stallMs / 4)));
    try {
      const r = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model, stream: true }), signal: ctl.signal });
      if (!r.ok || !r.body) {
        const t = (await r.text().catch(() => "")).slice(0, 300);
        let msg = t; try { msg = JSON.parse(t).error || t; } catch {}
        return { ok: false, error: msg || "HTTP " + r.status, retries };
      }
      const dec = new TextDecoder();
      let buf = "";
      for await (const chunk of r.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line) continue;
          let m; try { m = JSON.parse(line); } catch { continue; }
          if (m.error) { error = String(m.error).slice(0, 300); break; }
          status = m.status || status;
          const prev = phase;
          phase = phaseOf(status);
          // Solo cuenta como «avance» lo que trae bytes nuevos (o un cambio de fase).
          if (m.digest && m.total) {
            const p = parts.get(m.digest) || { total: m.total, completed: 0 };
            if ((m.completed || 0) > p.completed || m.total !== p.total) lastData = Date.now();
            p.total = m.total; p.completed = Math.max(p.completed, m.completed || 0);
            parts.set(m.digest, p);
          } else lastData = Date.now();
          if (phase === "success") { done = true; send(true); }
          else send(phase !== prev);   // un cambio de fase se avisa siempre
        }
        if (error || done) break;
      }
    } catch (e) {
      if (signal?.aborted) return { ok: false, error: "cancelled", retries };
      if (!stalled) error = e?.cause?.code === "ECONNREFUSED" ? "offline" : "";   // conexión caída: se reintenta
    } finally {
      clearInterval(watch);
      signal?.removeEventListener("abort", onAbort);
    }
    if (done) return { ok: true, retries };
    // Errores que no se arreglan reintentando (sin internet, no existe, sin espacio…).
    if (error && (error === "offline" || /not found|manifest|does not exist|no space|disk|no such host|lookup|dial tcp/i.test(error))) return { ok: false, error, retries };
    if (++retries > maxRetries) return { ok: false, error: error || "La descarga se paró varias veces. Comprueba internet y vuelve a intentarlo (continuará donde iba).", retries };
    phase = "retry"; send(true);
    // Reintento que no avanzó nada: Ollama sigue enganchado → se reinicia (como mucho 2 veces).
    if (retries >= 2 && stalled && bytes() === before && onStuck && restarts < 2) {
      restarts++;
      phase = "restart"; send(true);
      try { await onStuck(); } catch {}
    }
    await new Promise(r => setTimeout(r, retryDelay));
  }
}

module.exports = { pullModel, phaseOf };
