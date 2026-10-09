// Puente seguro entre la ventana (app web) y la parte de escritorio (Electron).
const { contextBridge, ipcRenderer, webUtils } = require("electron");

// El puerto del servicio DMX llega al preload y se pasa a la página (un
// MessagePort no puede cruzar contextBridge, pero sí window.postMessage).
ipcRenderer.on("dmx:port", (e) => window.postMessage("lumamap:dmx-port", "*", e.ports));

contextBridge.exposeInMainWorld("LumaDesktop", {
  isDesktop: true,
  version: ipcRenderer.sendSync("app-version"),
  checkUpdate: (url) => ipcRenderer.invoke("update:check", url),
  installUpdate: (url, info) => ipcRenderer.invoke("update:install", url, info),
  rollbackUpdate: () => ipcRenderer.invoke("update:rollback"),
  repairInstall: (url, info) => ipcRenderer.invoke("update:repair", url, info),
  updateStatus: () => ipcRenderer.invoke("update:status"),
  openLogs: () => ipcRenderer.invoke("logs:open"),
  log: (kind, msg) => ipcRenderer.send("log", kind, msg),
  hardwareProfile: () => ipcRenderer.invoke("hw:profile"),
  onUpdateProgress: (cb) => { ipcRenderer.removeAllListeners("update:progress"); ipcRenderer.on("update:progress", (_e, p) => cb(p)); },
  /** Recibe los comandos del menú de la ventana (ids del registro de comandos). */
  onCommand: (cb) => ipcRenderer.on("command", (_e, id) => cb(id)),
  /** Pantallas conectadas: [{id, label, width, height, primary, isOutput}]. */
  displays: () => ipcRenderer.invoke("displays"),
  /** Elige la pantalla de salida (proyector) y abre/coloca allí la ventana de salida. */
  setOutputDisplay: (id) => ipcRenderer.invoke("output-display", id),
  onDisplaysChanged: (cb) => ipcRenderer.on("displays-changed", () => cb()),
  setFullScreen: (on) => ipcRenderer.invoke("fullscreen", on),
  /** Optimiza un video al importarlo (si hace falta). Devuelve {action, reason, url?, ms, encoder}. */
  optimizeVideo: (file, target) => {
    const p = webUtils.getPathForFile(file);
    return p ? ipcRenderer.invoke("video:optimize", p, target) : Promise.resolve({ action: "keep", reason: "sin ruta" });
  },
  releaseVideo: (url) => ipcRenderer.invoke("video:release", url),
  onVideoProgress: (cb) => ipcRenderer.on("video:progress", (_e, d) => cb(d)),
  /** Métricas reales: CPU/RAM por proceso, GPU, uso de GPU y VRAM (Windows). */
  metrics: () => ipcRenderer.invoke("perf:metrics"),
  perfWatch: (on) => ipcRenderer.invoke("perf:watch", on),
  /** Arranca (o reconecta) el servicio DMX; el puerto llega como mensaje "lumamap:dmx-port". */
  dmxStart: () => ipcRenderer.invoke("dmx:start"),
  onDmxExit: (cb) => ipcRenderer.on("dmx:exit", (_e, code) => cb(code)),
  /** Mando remoto y OSC: { port, oscPort, pin, urls:[{name,url}] }. */
  remoteInfo: () => ipcRenderer.invoke("remote:info"),
  remoteNewPin: () => ipcRenderer.invoke("remote:newPin"),
  onRemoteReady: (cb) => ipcRenderer.on("remote:ready", () => cb()),
  /** Descargas de internet (buscar GIF): solo https y solo internet. Devuelve { ok, status, type, data }. */
  net: { get: (url, opts) => ipcRenderer.invoke("net:get", url, opts) },
  /** Asistente (Claude): la clave se guarda cifrada en el proceso principal. */
  ai: {
    status: () => ipcRenderer.invoke("ai:status"),
    setKey: (key) => ipcRenderer.invoke("ai:setKey", key),
    step: (req) => ipcRenderer.invoke("ai:step", req),
    cancel: () => ipcRenderer.invoke("ai:cancel"),
    /** IA local (Ollama): solo este equipo o la red local. */
    http: (req) => ipcRenderer.invoke("ai:http", req),
    ollamaStart: (endpoint) => ipcRenderer.invoke("ai:ollamaStart", endpoint),
    pull: (req) => ipcRenderer.invoke("ai:pull", req),
    pullCancel: () => ipcRenderer.invoke("ai:pullCancel"),
    onPullProgress: (cb) => { const f = (_e, p) => cb(p); ipcRenderer.on("ai:pullProgress", f); return () => ipcRenderer.removeListener("ai:pullProgress", f); },
  },
});
