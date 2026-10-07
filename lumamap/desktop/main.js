// LumaMap para escritorio (Windows / macOS / Linux) con Electron.
// Sirve la app web desde un protocolo propio seguro (app://) para que funcionen
// los módulos ES, IndexedDB, micrófono y cámara, y abre la ventana de salida
// directamente a pantalla completa en el proyector (segunda pantalla).
const { app, BrowserWindow, protocol, screen, session, shell, Menu } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

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

/** Pantalla para la salida: la que no tiene el editor (el proyector), si existe. */
function projectorDisplay() {
  const all = screen.getAllDisplays();
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
    backgroundColor: "#0b0d12", title: "LumaMap", autoHideMenuBar: true, show: false,
    icon: path.join(WEB, "icon.png"),
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false },
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

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  protocol.handle("app", (req) => {
    let p = decodeURIComponent(new URL(req.url).pathname);
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
  screen.on("display-added", () => output && placeOutput(output));
  screen.on("display-removed", () => output && !projectorDisplay() && output.setFullScreen(false));

  createEditor();
});

app.on("second-instance", () => { if (editor) { if (editor.isMinimized()) editor.restore(); editor.focus(); } });
app.on("window-all-closed", () => app.quit());
