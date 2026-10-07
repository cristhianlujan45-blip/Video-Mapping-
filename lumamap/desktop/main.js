// LumaMap para escritorio (Windows / macOS / Linux) con Electron.
// Sirve la app web desde un protocolo propio seguro (app://) para que funcionen
// los módulos ES, IndexedDB, micrófono y cámara, y abre la ventana de salida
// directamente a pantalla completa en el proyector (segunda pantalla).
const { app, BrowserWindow, protocol, screen, session, shell, Menu, ipcMain, net } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { optimize } = require("./optimize.js");

const OPT_DIR = path.join(os.tmpdir(), "lumamap-optimized");

const WEB = path.join(__dirname, "web");
const ORIGIN = "app://lumamap";
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
};

protocol.registerSchemesAsPrivileged([{
  scheme: "app",
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
}]);

// Solo una instancia: si se abre otra vez, se enfoca la existente.
if (!app.requestSingleInstanceLock()) app.quit();

let editor = null;
let output = null;
let chosenDisplay = null; // pantalla elegida a mano para la salida (id)

/** Pantalla para la salida: la elegida, o la que no tiene el editor (el proyector). */
function projectorDisplay() {
  const all = screen.getAllDisplays();
  if (chosenDisplay !== null) {
    const d = all.find(x => x.id === chosenDisplay);
    if (d) return d;
  }
  if (all.length < 2 || !editor) return null;
  const mine = screen.getDisplayMatching(editor.getBounds());
  return all.find(d => d.id !== mine.id) || null;
}

function placeOutput(win) {
  const d = projectorDisplay();
  if (d) {
    win.setFullScreen(false);
    win.setBounds(d.bounds);
    win.setFullScreen(true);
  }
}

function createEditor() {
  editor = new BrowserWindow({
    width: 1440, height: 900, minWidth: 800, minHeight: 560,
    backgroundColor: "#0b0d12", title: "LumaMap", show: false,
    icon: path.join(WEB, "icon.png"),
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false, preload: path.join(__dirname, "preload.js") },
  });
  editor.once("ready-to-show", () => { editor.maximize(); editor.show(); });
  editor.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(ORIGIN) && url.includes("output.html")) {
      const d = projectorDisplay();
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          ...(d ? { ...d.bounds, fullscreen: true, frame: false } : { width: 1280, height: 720 }),
          backgroundColor: "#000000", title: "LumaMap · Salida", autoHideMenuBar: true,
          webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false },
        },
      };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });
  editor.webContents.on("did-create-window", (win) => {
    output = win;
    win.on("closed", () => { if (output === win) output = null; });
  });
  editor.on("closed", () => { editor = null; app.quit(); });
  editor.loadURL(ORIGIN + "/index.html");
}

/* ---------------- Menú de la ventana ---------------- */
// Los atajos los atiende la propia app (registerAccelerator: false): el menú solo
// los muestra, así nunca se ejecuta un comando dos veces.
function cmd(label, id, accelerator) {
  return { label, accelerator, registerAccelerator: false, click: () => editor?.webContents.send("command", id) };
}
function buildMenu() {
  const displays = screen.getAllDisplays();
  const template = [
    { label: "Archivo", submenu: [
      cmd("Nuevo proyecto", "new", "Ctrl+N"), cmd("Abrir proyecto…", "open", "Ctrl+O"),
      { type: "separator" },
      cmd("Guardar", "save", "Ctrl+S"), cmd("Guardar como…", "saveAs", "Ctrl+Shift+S"),
      cmd("Exportar proyecto .lumamap…", "export", "Ctrl+E"), cmd("Importar proyecto…", "importProject", "Ctrl+Shift+O"),
      cmd("Importar video o imagen…", "importMedia", "Ctrl+I"),
      { type: "separator" },
      cmd("Grabar video de la salida", "record", "Ctrl+R"), cmd("Capturar imagen (PNG)", "snapshot", "Ctrl+Shift+P"),
      cmd("Resolución de salida…", "resolution"),
      { type: "separator" },
      { label: "Salir", role: "quit" },
    ] },
    { label: "Editar", submenu: [
      cmd("Deshacer", "undo", "Ctrl+Z"), cmd("Rehacer", "redo", "Ctrl+Y"),
      { type: "separator" },
      cmd("Copiar superficie", "copy", "Ctrl+C"), cmd("Pegar superficie", "paste", "Ctrl+V"), cmd("Duplicar", "duplicate", "Ctrl+D"),
      cmd("Copiar estilo", "copyStyle", "Ctrl+Shift+C"), cmd("Pegar estilo", "pasteStyle", "Ctrl+Shift+V"),
      { type: "separator" },
      cmd("Traer al frente", "front", "Ctrl+]"), cmd("Enviar al fondo", "back", "Ctrl+["),
      cmd("Centrar en la salida", "center", "C"), cmd("Ocupar toda la salida", "fill"),
      cmd("Enderezar", "straighten"), cmd("Espejo horizontal", "flipH"), cmd("Voltear vertical", "flipV"), cmd("Girar 90°", "rotate"),
      cmd("Malla de deformación 4×3", "mesh"), cmd("Dibujar máscara", "mask"),
      { type: "separator" },
      cmd("Bloquear / desbloquear", "lock", "L"), cmd("Ocultar / mostrar", "hide", "H"), cmd("Renombrar", "rename", "F2"),
      cmd("Eliminar", "delete", "Delete"),
      { type: "separator" },
      cmd("Todos los comandos…", "palette", "Ctrl+K"),
    ] },
    { label: "Añadir", submenu: [
      cmd("Rectángulo (4 esquinas)", "addRect", "Shift+R"), cmd("Malla curva", "addMesh", "Shift+M"),
      cmd("Círculo", "addCircle", "Shift+C"), cmd("Triángulo", "addTriangle"), cmd("Hexágono", "addHex"), cmd("Estrella", "addStar"),
      cmd("Trazar forma a mano", "addTrace", "Shift+F"), cmd("Forma por puntos", "addPoints", "Shift+P"),
      { type: "separator" },
      cmd("Dibujar en la pared", "draw", "D"), cmd("Texto", "addText", "Shift+T"),
      { type: "separator" },
      cmd("Cubo 3D", "addCube"), cmd("Fachada", "addFacade"), cmd("Escenario", "addStage"),
    ] },
    { label: "Ver", submenu: [
      cmd("Encajar vista", "fit", "Home"), cmd("Acercar", "zoomIn", "+"), cmd("Alejar", "zoomOut", "-"),
      cmd("Vista previa sin guías", "preview", "V"),
      { type: "separator" },
      cmd("Panel Añadir", "tab-add"), cmd("Panel Contenido", "tab-content"), cmd("Panel Efectos", "tab-fx"),
      cmd("Panel Forma", "tab-shape"), cmd("Panel Capas", "tab-layers"), cmd("Panel Escenas", "tab-scenes"), cmd("Panel Audio y ritmo", "tab-audio"),
      { type: "separator" },
      { label: "Pantalla completa del editor", role: "togglefullscreen", accelerator: "F11" },
    ] },
    { label: "Proyección", submenu: [
      cmd("Abrir ventana de salida en el proyector", "outWindow", "Ctrl+Shift+F"),
      { label: "Pantalla de salida", submenu: [
        { label: "Automática (la que no tiene el editor)", type: "radio", checked: chosenDisplay === null, click: () => setOutputDisplay(null) },
        ...displays.map((d, i) => ({
          label: `Pantalla ${i + 1}: ${d.size.width}×${d.size.height}${d.id === screen.getPrimaryDisplay().id ? " (principal)" : ""}`,
          type: "radio", checked: chosenDisplay === d.id, click: () => setOutputDisplay(d.id),
        })),
      ] },
      cmd("Pantalla completa aquí", "here", "P"),
      { type: "separator" },
      cmd("Guías en el proyector", "guides", "G"), cmd("Apagón", "blackout", "B"), cmd("Sonido de los videos", "mute", "Ctrl+M"),
      { label: "Patrón de prueba", submenu: [
        cmd("Cuadrícula", "pattern-grid"), cmd("Blanco", "pattern-white"), cmd("Barras de color", "pattern-bars"),
        cmd("Rojo", "pattern-red"), cmd("Verde", "pattern-green"), cmd("Azul", "pattern-blue"),
      ] },
    ] },
    { label: "Escenas", submenu: [
      cmd("Reproducir / pausa", "play", "Space"), cmd("Reiniciar videos", "restart", "Ctrl+0"),
      cmd("Escena siguiente", "nextScene", "PageDown"), cmd("Escena anterior", "prevScene", "PageUp"),
      cmd("Nueva escena", "newScene", "Ctrl+Shift+N"),
    ] },
    { label: "Audio", submenu: [
      cmd("Micrófono: escuchar la música", "mic", "M"), cmd("Modo ritmo", "react", "R"),
      cmd("TAP (marcar tempo)", "tap", "T"), cmd("Marcar el primer tiempo", "downbeat", "Ctrl+1"),
      cmd("Tempo a la mitad", "half"), cmd("Tempo al doble", "double"),
      { type: "separator" },
      cmd("Conectar controlador MIDI", "midi"),
    ] },
    { label: "Ayuda", submenu: [
      cmd("Ayuda y atajos", "help", "F1"), cmd("Todos los comandos", "palette", "Ctrl+K"),
      { type: "separator" },
      { label: "Herramientas de desarrollo", role: "toggleDevTools" },
      { label: `LumaMap ${app.getVersion()}`, enabled: false },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function setOutputDisplay(id) {
  chosenDisplay = id;
  buildMenu();
  if (output) placeOutput(output);
  else editor?.webContents.send("command", "outWindow");
}

ipcMain.handle("displays", () => {
  const out = output ? screen.getDisplayMatching(output.getBounds()).id : null;
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id, label: `Pantalla ${i + 1}`, width: d.size.width, height: d.size.height,
    primary: d.id === screen.getPrimaryDisplay().id, isOutput: d.id === out, chosen: d.id === chosenDisplay,
  }));
});
ipcMain.handle("output-display", (_e, id) => setOutputDisplay(id));
ipcMain.handle("fullscreen", (_e, on) => editor?.setFullScreen(!!on));

// Optimización automática de video al importar (ver optimize.js).
ipcMain.handle("video:optimize", async (e, file, target) => {
  const r = await optimize(file, target || {}, OPT_DIR, (pct) => e.sender.send("video:progress", { file, pct }));
  return { action: r.action, reason: r.reason, ms: r.ms, encoder: r.encoder || null, info: r.info,
    url: r.action === "keep" ? null : `${ORIGIN}/__opt/${encodeURIComponent(path.basename(r.file))}` };
});
/* ---------------- Actualizaciones ---------------- */
ipcMain.on("app-version", (e) => { e.returnValue = app.getVersion(); });
ipcMain.handle("update:check", async (_e, url) => {
  const r = await net.fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
});
// Descarga el instalador nuevo y lo ejecuta en silencio; al terminar abre LumaMap otra vez.
ipcMain.handle("update:install", async (e, url) => {
  if (process.platform !== "win32") { shell.openExternal(url); return; }
  const r = await net.fetch(url);
  if (!r.ok) throw new Error("HTTP " + r.status);
  const total = +r.headers.get("content-length") || 0;
  const file = path.join(os.tmpdir(), "LumaMap-Setup-update.exe");
  const out = fs.createWriteStream(file);
  const reader = r.body.getReader();
  let got = 0, lastSent = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.write(Buffer.from(value));
    got += value.length;
    if (total && Date.now() - lastSent > 250) { lastSent = Date.now(); e.sender.send("update:progress", got / total); }
  }
  await new Promise((res, rej) => out.end((err) => (err ? rej(err) : res())));
  if (total && got < total) throw new Error("Descarga incompleta");
  spawn(file, ["/S", "--force-run"], { detached: true, stdio: "ignore" }).unref();
  setTimeout(() => app.quit(), 500);
});

ipcMain.handle("video:release", (_e, url) => {
  try { fs.rmSync(path.join(OPT_DIR, path.basename(decodeURIComponent(new URL(url).pathname))), { force: true }); } catch {}
});

app.whenReady().then(() => {
  buildMenu();
  protocol.handle("app", (req) => {
    let p = decodeURIComponent(new URL(req.url).pathname);
    // Videos optimizados (carpeta temporal): la app los lee una vez y los guarda en su biblioteca.
    if (p.startsWith("/__opt/")) {
      const f = path.join(OPT_DIR, path.basename(p));
      if (!fs.existsSync(f)) return new Response("404", { status: 404 });
      return new Response(fs.readFileSync(f), { headers: { "content-type": "video/mp4" } });
    }
    if (p === "/" || !p) p = "/index.html";
    const file = path.normalize(path.join(WEB, p));
    if (!file.startsWith(WEB + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile())
      return new Response("404", { status: 404 });
    return new Response(fs.readFileSync(file), { headers: { "content-type": MIME[path.extname(file)] || "application/octet-stream" } });
  });
  // Micrófono (audio reactivo), cámara, MIDI y pantalla completa sin preguntar: es una app local.
  const allowed = new Set(["media", "fullscreen", "midi", "clipboard-sanitized-write", "window-management"]);
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(allowed.has(perm)));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => allowed.has(perm));

  // Conectar o desconectar el proyector con la salida abierta: se recoloca sola.
  const displaysChanged = () => { buildMenu(); editor?.webContents.send("displays-changed"); };
  screen.on("display-added", () => { displaysChanged(); if (output) placeOutput(output); });
  screen.on("display-removed", () => { displaysChanged(); if (output && !projectorDisplay()) output.setFullScreen(false); });

  createEditor();
});

app.on("second-instance", () => { if (editor) { if (editor.isMinimized()) editor.restore(); editor.focus(); } });
app.on("window-all-closed", () => app.quit());
