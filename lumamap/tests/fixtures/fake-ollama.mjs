// tests/fixtures/fake-ollama.mjs — «Ollama» falso para la prueba de escritorio:
// se arranca como «ollama serve» (OLLAMA_HOST=127.0.0.1:PUERTO), responde a la API
// y la descarga de un modelo manda su progreso como el de verdad (NDJSON).
import http from "node:http";
if (process.argv[2] !== "serve") process.exit(2);
const [host, port] = String(process.env.OLLAMA_HOST || "127.0.0.1:11434").split(":");
const models = [];
const srv = http.createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  if (req.url === "/api/version") return res.end(JSON.stringify({ version: "0.12.0-falso" }));
  if (req.url === "/api/tags") return res.end(JSON.stringify({ models: models.map(name => ({ name, size: 2.5e9 })) }));
  if (req.url === "/quit") { res.end("{}"); return setTimeout(() => process.exit(0), 50); }
  if (req.url === "/api/pull" && req.method === "POST") {
    let b = ""; req.on("data", c => b += c); req.on("end", async () => {
      const { model } = JSON.parse(b);
      res.setHeader("content-type", "application/x-ndjson");
      res.write(JSON.stringify({ status: "pulling manifest" }) + "\n");
      for (const done of [0, 1e9, 2e9, 2.5e9]) { res.write(JSON.stringify({ status: "pulling 4c2b", total: 2.5e9, completed: done }) + "\n"); await new Promise(r => setTimeout(r, 250)); }
      res.write(JSON.stringify({ status: "verifying sha256 digest" }) + "\n");
      models.push(model);
      res.end(JSON.stringify({ status: "success" }) + "\n");
    });
    return;
  }
  res.statusCode = 404; res.end(JSON.stringify({ error: "not found" }));
});
srv.listen(Number(port), host);
