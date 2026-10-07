// Puente seguro entre la ventana (app web) y la parte de escritorio (Electron).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("LumaDesktop", {
  isDesktop: true,
  /** Recibe los comandos del menú de la ventana (ids del registro de comandos). */
  onCommand: (cb) => ipcRenderer.on("command", (_e, id) => cb(id)),
  /** Pantallas conectadas: [{id, label, width, height, primary, isOutput}]. */
  displays: () => ipcRenderer.invoke("displays"),
  /** Elige la pantalla de salida (proyector) y abre/coloca allí la ventana de salida. */
  setOutputDisplay: (id) => ipcRenderer.invoke("output-display", id),
  onDisplaysChanged: (cb) => ipcRenderer.on("displays-changed", () => cb()),
  setFullScreen: (on) => ipcRenderer.invoke("fullscreen", on),
});
