// desktop/remote-service.mjs
// Mando remoto y OSC de la app de escritorio, en su propio proceso: el mismo
// servidor de la versión web (server/index.js) sirve el mando para teléfono,
// tablet u otro PC por la red local (WebSocket) y escucha OSC por UDP. El
// editor de este equipo se conecta como «display»; los mandos necesitan el PIN.
import { createServer, startHttps } from "./server/index.js";

const want = Number(process.env.LUMAMAP_REMOTE_PORT || 8080);
const oscPort = Number(process.env.LUMAMAP_OSC_PORT || 9129);
const pin = process.env.LUMAMAP_PIN || "";
const httpsWant = Number(process.env.LUMAMAP_HTTPS_PORT || 8443);

function listen(port, tries = 0) {
  const srv = createServer({ port, osc: true, oscPort, pin });
  srv.once("error", (e) => {
    if (e.code === "EADDRINUSE" && tries < 20) return listen(port + 1, tries + 1);
    process.parentPort.postMessage({ t: "error", msg: e.message });
  });
  // Además, https para el móvil como cámara (los navegadores solo dan la cámara a páginas seguras).
  srv.listen(port, "0.0.0.0", async () => {
    const httpsPort = await startHttps({ want: httpsWant, pin, dataDir: process.env.LUMAMAP_DATA }).catch(() => 0);
    process.parentPort.postMessage({ t: "ready", port, oscPort, httpsPort });
  });
}
listen(want);
