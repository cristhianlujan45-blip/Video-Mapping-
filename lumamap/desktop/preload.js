// Puente seguro entre la ventana (app web) y la parte de escritorio (Electron).
const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("LumaDesktop", {
  isDesktop: true,
  version: ipcRenderer.sendSync("app-version"),
  checkUpdate: (url) => ipcRenderer.invoke("update:check", url),
  installUpdate: (url) => ipcRenderer.invoke("update:install", url),
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
});
