// desktop/remote-service.mjs
// Mando remoto y OSC de la app de escritorio, en su propio proceso: el mismo
// servidor de la versión web (server/index.js) sirve el mando para teléfono,
// tablet u otro PC por la red local (WebSocket) y escucha OSC por UDP. El
// editor de este equipo se conecta como «display»; los mandos necesitan el PIN.
import { createServer } from "./server/index.js";

const want = Number(process.env.LUMAMAP_REMOTE_PORT || 8080);
const oscPort = Number(process.env.LUMAMAP_OSC_PORT || 9129);
const pin = process.env.LUMAMAP_PIN || "";

function listen(port, tries = 0) {
  const srv = createServer({ port, osc: true, oscPort, pin });
  srv.once("error", (e) => {
    if (e.code === "EADDRINUSE" && tries < 20) return listen(port + 1, tries + 1);
    process.parentPort.postMessage({ t: "error", msg: e.message });
  });
  srv.listen(port, "0.0.0.0", () => process.parentPort.postMessage({ t: "ready", port, oscPort }));
}
listen(want);
