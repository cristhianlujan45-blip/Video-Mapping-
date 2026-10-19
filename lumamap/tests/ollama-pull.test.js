// tests/ollama-pull.test.js — la descarga de la IA no se queda colgada: si Ollama deja
// de mandar datos, se corta y se reanuda sola; dice la fase (descargando, comprobando,
// instalando) y suma todas las partes del modelo.
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import { test, report } from "./harness.js";
const { pullModel, phaseOf } = createRequire(import.meta.url)("../desktop/ollama-pull.js");

/** Ollama simulado. stallOnce: la primera vez se queda colgado al 94 % (como en la foto del usuario). */
function fakeOllama({ stallOnce = false, error = "", dropOnce = false, stuck = false } = {}) {
  let calls = 0, have = 0;
  const state = { stuck };   // «stuck»: colgado por dentro hasta que se reinicia   // bytes ya descargados (Ollama continúa donde iba)
  const TOTAL = 4.9e9, SMALL = 11e3;
  const srv = http.createServer((req, res) => {
    let b = ""; req.on("data", c => b += c); req.on("end", async () => {
      calls++;
      res.setHeader("content-type", "application/x-ndjson");
      if (error) { res.statusCode = 500; return res.end(JSON.stringify({ error })); }
      const w = (o) => res.write(JSON.stringify(o) + "\n");
      w({ status: "pulling manifest" });
      for (const step of [0.5, 0.8, 0.94, 1]) {
        const target = Math.round(TOTAL * step);
        if (step === 1 && state.stuck) return;   // colgado por dentro: nunca pasa del 94 %
        if (target <= have) continue;
        have = target;
        w({ status: "pulling a1b2", digest: "sha256:a1b2", total: TOTAL, completed: have });
        await new Promise(r => setTimeout(r, 30));
        if (step === 0.94 && stallOnce && calls === 1) return;           // se queda colgado: ni datos ni cierre
        if (step === 0.8 && dropOnce && calls === 1) return res.destroy(); // se corta la conexión
      }
      w({ status: "pulling c3d4", digest: "sha256:c3d4", total: SMALL, completed: SMALL });
      w({ status: "verifying sha256 digest" });
      await new Promise(r => setTimeout(r, 100));
      w({ status: "writing manifest" });
      res.end(JSON.stringify({ status: "success" }) + "\n");
    });
  });
  return new Promise(r => srv.listen(0, "127.0.0.1", () => r({ srv, state, url: `http://127.0.0.1:${srv.address().port}`, calls: () => calls })));
}

await test("fases que se entienden", () => {
  assert.deepEqual(["pulling manifest", "pulling a1b2", "verifying sha256 digest", "writing manifest", "success"].map(phaseOf), ["manifest", "download", "verify", "write", "success"]);
});
await test("si se queda colgada al 94 %, se reanuda sola donde iba y termina", async () => {
  const f = await fakeOllama({ stallOnce: true });
  const prog = [];
  const r = await pullModel({ endpoint: f.url, model: "qwen3:8b", stallMs: 400, retryDelay: 50, onProgress: (p) => prog.push(p) });
  f.srv.close();
  assert.equal(r.ok, true); assert.equal(r.retries, 1); assert.equal(f.calls(), 2);
  assert.ok(prog.some(p => p.phase === "retry"), "avisa de que reintenta");
  assert.ok(prog.some(p => p.phase === "verify"), "dice que está comprobando");
  assert.equal(prog.at(-1).phase, "success");
  // Suma las dos partes y nunca retrocede.
  const dl = prog.filter(p => p.total);
  assert.equal(dl.at(-1).total, 4.9e9 + 11e3);
  for (let i = 1; i < dl.length; i++) assert.ok(dl[i].completed >= dl[i - 1].completed, "el progreso no retrocede");
});
await test("si Ollama se queda enganchado por dentro, se reinicia solo y termina", async () => {
  const f = await fakeOllama({ stuck: true });
  let restarted = 0;
  const prog = [];
  const r = await pullModel({ endpoint: f.url, model: "qwen3:8b", stallMs: 300, retryDelay: 30, onProgress: (p) => prog.push(p.phase),
    onStuck: async () => { restarted++; f.state.stuck = false; } });
  f.srv.closeAllConnections?.(); f.srv.close();
  assert.equal(r.ok, true); assert.equal(restarted, 1);
  assert.ok(prog.includes("restart"));
});
await test("si se corta la conexión, también continúa", async () => {
  const f = await fakeOllama({ dropOnce: true });
  const r = await pullModel({ endpoint: f.url, model: "qwen3:8b", stallMs: 2000, retryDelay: 50 });
  f.srv.close();
  assert.equal(r.ok, true); assert.equal(r.retries, 1);
});
await test("sin internet o modelo inexistente: no reintenta en bucle, lo dice", async () => {
  const f = await fakeOllama({ error: "pull model manifest: Get \"https://registry.ollama.ai/v2/library/qwen3/manifests/8b\": dial tcp: lookup registry.ollama.ai: no such host" });
  const r = await pullModel({ endpoint: f.url, model: "qwen3:8b", stallMs: 400, retryDelay: 50 });
  f.srv.close();
  assert.equal(r.ok, false); assert.match(r.error, /no such host/); assert.equal(f.calls(), 1);
  const closed = await new Promise(r => { const s = http.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
  const off = await pullModel({ endpoint: `http://127.0.0.1:${closed}`, model: "qwen3:8b", stallMs: 400, retryDelay: 50 });
  assert.equal(off.ok, false); assert.equal(off.error, "offline");
});
await test("cancelar para la descarga enseguida", async () => {
  const f = await fakeOllama({ stallOnce: true });
  const ctl = new AbortController();
  setTimeout(() => ctl.abort(), 150);
  const t0 = Date.now();
  const r = await pullModel({ endpoint: f.url, model: "qwen3:8b", stallMs: 10000, signal: ctl.signal });
  f.srv.closeAllConnections?.(); f.srv.close();
  assert.equal(r.error, "cancelled"); assert.ok(Date.now() - t0 < 2000);
});
report();
