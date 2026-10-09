// LumaMap para escritorio (Windows / macOS / Linux) con Electron.
// Sirve la app web desde un protocolo propio seguro (app://) para que funcionen
// los módulos ES, IndexedDB, micrófono y cámara, y abre la ventana de salida
// directamente a pantalla completa en el proyector (segunda pantalla).
const { app, BrowserWindow, protocol, screen, session, shell, Menu, ipcMain, net, utilityProcess, MessageChannelMain, powerSaveBlocker } = require("electron");
const { spawn, execFile: execFileCb } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { optimize, usableEncoders, killAll: killFfmpeg } = require("./optimize.js");

const OPT_DIR = path.join(os.tmpdir(), "lumamap-optimized");

const WEB = path.join(__dirname, "web");
const ORIGIN = "app://lumamap";
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
  ".wasm": "application/wasm", ".tflite": "application/octet-stream",
};

protocol.registerSchemesAsPrivileged([{
  scheme: "app",
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
}]);

// Los videos se decodifican una vez en el editor y las salidas los usan desde
// ahí: el editor no debe dejar de decodificar aunque quede tapado o minimizado.
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
// WebRtcHideLocalIpsWithMdns: la cámara del móvil (WebRTC en la red local) conecta directo por IP.
app.commandLine.appendSwitch("disable-features", "BackgroundVideoTrackOptimization,BackgroundVideoPauseOptimization,MediaSessionService,WebRtcHideLocalIpsWithMdns");

// Carpeta de datos alternativa (pruebas automáticas: empezar siempre desde cero).
if (process.env.LUMAMAP_USER_DATA) app.setPath("userData", process.env.LUMAMAP_USER_DATA);

// Portátiles con dos GPU: usar la dedicada (la integrada solo si no hay otra).
app.commandLine.appendSwitch("force_high_performance_gpu");

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

/** Pantalla física para la salida N (1 = la elegida o la primera libre; 2, 3… las siguientes). */
function displayForScreen(n) {
  if (n <= 1) return projectorDisplay();
  const all = screen.getAllDisplays();
  if (!editor) return null;
  const mine = screen.getDisplayMatching(editor.getBounds());
  const first = projectorDisplay();
  const free = all.filter(d => d.id !== mine.id && d.id !== first?.id);
  return free[n - 2] || null;
}
const screenOf = (url) => +(String(url).match(/[?&]screen=(\d+)/)?.[1] || 1);
const extraOutputs = new Map();   // pantalla 2, 3, 4 → ventana

function placeOutput(win) {
  const d = projectorDisplay();
  if (d && !win.isDestroyed()) {
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
      const n = screenOf(url);
      const d = displayForScreen(n);
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          ...(d ? { ...d.bounds, fullscreen: true, frame: false } : { width: 1280, height: 720 }),
          backgroundColor: "#000000", title: n > 1 ? `LumaMap · Pantalla ${n}` : "LumaMap · Salida", autoHideMenuBar: true,
          webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false },
        },
      };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });
  editor.webContents.on("did-create-window", (win, details) => {
    const n = screenOf(details?.url || win.webContents.getURL());
    if (n > 1) {
      extraOutputs.set(n, win);
      win.on("closed", () => { if (extraOutputs.get(n) === win) extraOutputs.delete(n); });
      return;
    }
    output = win;
    win.on("closed", () => { if (output === win) output = null; });
  });
  // Toda ventana de salida se recupera sola: si su proceso se cae (memoria, GPU), se
  // recarga en el mismo sitio y vuelve a recibir el proyecto del editor.
  editor.webContents.on("did-create-window", (win) => {
    win.webContents.on("render-process-gone", (_e, d) => {
      log("crash", `Salida: ${d.reason} (código ${d.exitCode})`);
      if (d.reason !== "clean-exit" && !quitting && !win.isDestroyed()) setTimeout(() => { try { win.reload(); } catch {} }, 500);
    });
    win.webContents.on("unresponsive", () => log("crash", "La salida no responde"));
  });
  editor.on("closed", () => { editor = null; app.quit(); });
  // Si el proceso del editor se cae (memoria, GPU…), se recarga: el autoguardado restaura el proyecto.
  editor.webContents.on("render-process-gone", (_e, d) => {
    log("crash", `Editor: ${d.reason} (código ${d.exitCode})`);
    if (d.reason !== "clean-exit" && !quitting && editor) setTimeout(() => { try { editor.reload(); } catch {} }, 600);
  });
  editor.webContents.on("unresponsive", () => log("crash", "El editor no responde"));
  editor.webContents.on("console-message", (e) => { if (e.level === "error") log("renderer", e.message); });
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
      cmd("Centrar en la salida", "center", "C"), cmd("Pantalla completa", "fill", "Shift+G"),
      cmd("Enderezar", "straighten"), cmd("Espejo horizontal", "flipH"), cmd("Voltear vertical", "flipV"), cmd("Girar 90°", "rotate"),
      cmd("Girar 15° a la derecha", "rotR15", "E"), cmd("Girar 15° a la izquierda", "rotL15", "Q"), cmd("Girar la imagen 90°", "rotImg", "Shift+E"),
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
      cmd("Panel Añadir", "tab-add"), cmd("Panel Animaciones", "tab-anim"), cmd("Panel En vivo", "tab-live"), cmd("Panel Contenido", "tab-content"), cmd("Panel Efectos", "tab-fx"),
      cmd("Panel Forma", "tab-shape"), cmd("Panel Capas", "tab-layers"), cmd("Panel Escenas", "tab-scenes"), cmd("Panel Audio y ritmo", "tab-audio"),
      { type: "separator" },
      { label: "Pantalla completa del editor", role: "togglefullscreen", accelerator: "F11" },
    ] },
    { label: "En vivo", submenu: [
      cmd("Panel de mezcla en vivo", "tab-live"),
      cmd("GO: fundir todas a lo siguiente", "goAll", "Enter"), cmd("Todas al azar", "randomAll", "Shift+Enter"),
      cmd("Siguiente al azar (seleccionada)", "randomSel", "Z"), cmd("GO en la seleccionada", "goSel", "X"),
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
      cmd("Abrir pantalla 2", "outWindow2"), cmd("Abrir pantalla 3", "outWindow3"), cmd("Abrir pantalla 4", "outWindow4"),
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
    id: d.id, label: `Pantalla ${i + 1}`, name: d.label || "", width: d.size.width * (d.scaleFactor || 1), height: d.size.height * (d.scaleFactor || 1), internal: !!d.internal,
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
// Actualización segura (Windows): la app ya guardó el proyecto y liberó cámaras,
// MIDI y exportaciones. Aquí se descarga y verifica el instalador, se paran los
// servicios (DMX, mando, métricas) y un actualizador INDEPENDIENTE (updater.ps1)
// espera a que LumaMap se cierre, hace copia de seguridad, instala, verifica,
// revierte si falla y vuelve a abrir la app.
const UPD_DIR = () => path.join(process.env.LOCALAPPDATA || app.getPath("temp"), "LumaMap-updates");
const BACKUP_DIR = () => path.join(process.env.LOCALAPPDATA || app.getPath("temp"), "LumaMap-backup");
const RESULT_FILE = () => path.join(app.getPath("userData"), "update-result.json");
let quitting = false;
async function download(e, url, { size, sha256 } = {}) {
  const r = await net.fetch(url);
  if (!r.ok) throw new Error("HTTP " + r.status);
  const total = +r.headers.get("content-length") || size || 0;
  fs.mkdirSync(UPD_DIR(), { recursive: true });
  const file = path.join(UPD_DIR(), "LumaMap-Setup-download.exe");
  const out = fs.createWriteStream(file);
  const hash = require("node:crypto").createHash("sha256");
  const reader = r.body.getReader();
  let got = 0, lastSent = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const b = Buffer.from(value);
    out.write(b); hash.update(b);
    got += b.length;
    if (total && Date.now() - lastSent > 250) { lastSent = Date.now(); e.sender.send("update:progress", got / total); }
  }
  await new Promise((res, rej) => out.end((err) => (err ? rej(err) : res())));
  if (total && got < total) throw new Error("Descarga incompleta");
  const digest = hash.digest("hex");
  if (sha256 && digest !== String(sha256).toLowerCase()) throw new Error("El archivo descargado no coincide con la firma SHA-256 publicada");
  log("update", `Descargado ${got} bytes · sha256 ${digest}`);
  return file;
}
function stopServicesForUpdate() {
  quitting = true;
  perfWatch(false);
  try { dmxProc?.kill(); } catch {}
  const rp = remote.proc; remote.proc = null; try { rp?.kill(); } catch {}
}
function runUpdater(args) {
  const src = path.join(__dirname, "updater.ps1");
  const script = path.join(UPD_DIR(), "updater.ps1");
  fs.mkdirSync(UPD_DIR(), { recursive: true });
  fs.writeFileSync(script, fs.readFileSync(src));   // fuera del asar y de la carpeta de la app
  const exe = app.getPath("exe");
  const all = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", script,
    "-AppPid", String(process.pid), "-InstallDir", path.dirname(exe), "-Exe", path.basename(exe), "-ResultFile", RESULT_FILE(), "-BackupRoot", BACKUP_DIR(), ...args];
  log("update", "Actualizador: " + args.join(" "));
  spawn("powershell.exe", all, { detached: true, stdio: "ignore", windowsHide: true, cwd: UPD_DIR() }).unref();   // fuera de la carpeta de la app
  setTimeout(() => app.quit(), 300);
}
ipcMain.handle("update:install", async (e, url, info = {}) => {
  if (process.platform !== "win32") { shell.openExternal(url); return; }
  const file = await download(e, url, info);
  stopServicesForUpdate();
  runUpdater(["-Installer", file, "-Version", String(info.version || ""), "-Mode", "update"]);
});
/** Volver a la versión anterior (la que guardó la última actualización). */
ipcMain.handle("update:rollback", () => {
  if (process.platform !== "win32") throw new Error("Solo en Windows");
  if (!fs.existsSync(path.join(BACKUP_DIR(), "previous", path.basename(app.getPath("exe"))))) throw new Error("No hay una versión anterior guardada");
  stopServicesForUpdate();
  runUpdater(["-Mode", "rollback"]);
});
/** Reparar: reinstala la versión actual con el instalador guardado (sin internet) o descargándolo. */
ipcMain.handle("update:repair", async (e, url, info = {}) => {
  if (process.platform !== "win32") throw new Error("Solo en Windows");
  const cached = path.join(BACKUP_DIR(), "installer", "LumaMap-Setup.exe");
  const file = fs.existsSync(cached) ? cached : await download(e, url, info);
  stopServicesForUpdate();
  runUpdater(["-Installer", file, "-Mode", "repair"]);
});
ipcMain.handle("update:status", () => {
  const prevExe = path.join(BACKUP_DIR(), "previous", path.basename(app.getPath("exe")));
  let result = null;
  try { result = JSON.parse(fs.readFileSync(RESULT_FILE(), "utf8").replace(/^\uFEFF/, "")); fs.rmSync(RESULT_FILE(), { force: true }); } catch {}
  return { canRollback: process.platform === "win32" && fs.existsSync(prevExe), canRepairOffline: fs.existsSync(path.join(BACKUP_DIR(), "installer", "LumaMap-Setup.exe")), result, logDir: logDir() };
});

/* ---------------- Registros (logs) y recuperación de cierres ---------------- */
function logDir() { return path.join(app.getPath("userData"), "logs"); }
function log(kind, msg) {
  try {
    const dir = logDir(), f = path.join(dir, "lumamap.log");
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(f) && fs.statSync(f).size > 2 * 1024 * 1024) {
      for (let i = 2; i >= 1; i--) { const a = path.join(dir, `lumamap.${i}.log`), b = path.join(dir, `lumamap.${i + 1}.log`); if (fs.existsSync(a)) fs.renameSync(a, b); }
      fs.renameSync(f, path.join(dir, "lumamap.1.log"));
    }
    fs.appendFileSync(f, `${new Date().toISOString()} [${kind}] ${msg}\n`);
  } catch {}
}
ipcMain.on("log", (_e, kind, msg) => log(kind || "renderer", String(msg).slice(0, 4000)));

// Asistente (Claude): la clave queda cifrada aquí, la página nunca la ve.
require("./ai.js").setup(log);
require("./net.js").setup();
ipcMain.handle("logs:open", () => shell.openPath(logDir()));
process.on("uncaughtException", (e) => log("main", "uncaughtException: " + (e.stack || e.message)));
process.on("unhandledRejection", (e) => log("main", "unhandledRejection: " + (e?.stack || e)));
app.on("child-process-gone", (_e, d) => log("process", `${d.type} terminó: ${d.reason} (código ${d.exitCode})${d.name ? " · " + d.name : ""}`));

/* ---------------- Rendimiento (datos reales del sistema) ---------------- */
// CPU y RAM: métricas de Electron de cada proceso de LumaMap. GPU (uso 3D y VRAM):
// contadores de rendimiento de Windows leídos por WMI (nombres no traducidos, así
// que funciona en Windows en español). Solo se miden con el panel Rendimiento abierto.
let gpuName = null;
const gpuStat = { util: null, vram: null, at: 0 };
let gpuProc = null;
async function gpuInfo() {
  if (gpuName !== null) return gpuName;
  try {
    const info = await app.getGPUInfo("complete");
    const r = info?.auxAttributes?.glRenderer || "";
    const dev = (info?.gpuDevice || []).find(d => d.active) || info?.gpuDevice?.[0];
    gpuName = r.replace(/^ANGLE \((.*)\)$/, "$1") || (dev ? `${dev.deviceString || ""} (vendor 0x${(dev.vendorId || 0).toString(16)})` : "");
  } catch { gpuName = ""; }
  return gpuName;
}
function perfWatch(on) {
  if (!on || process.platform !== "win32") {
    if (gpuProc) { try { gpuProc.kill(); } catch {} gpuProc = null; }
    return;
  }
  if (gpuProc) return;
  const ps = "$ErrorActionPreference='SilentlyContinue'; while($true){ " +
    "$e=(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine | Where-Object { $_.Name -like '*engtype_3D' } | Measure-Object UtilizationPercentage -Sum).Sum; " +
    "$m=(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory | Measure-Object DedicatedUsage -Sum).Sum; " +
    "[Console]::Out.WriteLine(\"$e;$m\"); Start-Sleep -Milliseconds 1500 }";
  gpuProc = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { windowsHide: true, cwd: os.tmpdir() });
  let buf = "";
  gpuProc.stdout.on("data", (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      const [e, m] = line.split(";");
      gpuStat.util = e === "" || isNaN(+e) ? null : Math.min(100, +e);
      gpuStat.vram = m === "" || isNaN(+m) ? null : +m;
      gpuStat.at = Date.now();
    }
  });
  gpuProc.on("exit", () => { gpuProc = null; });
}
ipcMain.handle("perf:watch", (_e, on) => perfWatch(!!on));
ipcMain.handle("perf:metrics", async () => {
  const procs = app.getAppMetrics().map(p => ({ type: p.type, cpu: p.cpu?.percentCPUUsage || 0, mem: (p.memory?.workingSetSize || 0) * 1024 }));
  const fresh = Date.now() - gpuStat.at < 5000;
  return {
    cpu: procs.reduce((a, p) => a + p.cpu, 0), ram: procs.reduce((a, p) => a + p.mem, 0), procs,
    cpuModel: os.cpus()[0]?.model?.trim() || "", cores: os.cpus().length, totalMem: os.totalmem(),
    gpu: await gpuInfo(), gpuUtil: fresh ? gpuStat.util : null, vram: fresh ? gpuStat.vram : null,
  };
});
app.on("before-quit", () => { quitting = true; perfWatch(false); killFfmpeg(); });

/* ---------------- Perfil de hardware (primer inicio y panel Rendimiento) ---------------- */
ipcMain.handle("hw:profile", async () => {
  const info = await app.getGPUInfo("complete").catch(() => ({}));
  const devs = (info.gpuDevice || []).map(d => ({ vendor: d.vendorId, device: d.deviceId, active: !!d.active, name: d.deviceString || "", driver: d.driverVersion || "" }));
  let wmi = [];
  if (process.platform === "win32") {
    wmi = await new Promise((resolve) => {
      // AdapterRAM (WMI) es de 32 bits y se queda en 4 GB: la VRAM real está en el registro (qwMemorySize).
      const ps = "Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion,CurrentRefreshRate | ConvertTo-Json -Compress; '|||'; " +
        "(Get-CimInstance Win32_SystemEnclosure).ChassisTypes -join ','; '|||'; [bool](Get-CimInstance Win32_Battery); '|||'; " +
        "Get-ItemProperty -Path 'HKLM:\\SYSTEM\\ControlSet001\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0*' -Name DriverDesc,HardwareInformation.qwMemorySize -ErrorAction SilentlyContinue | Select-Object DriverDesc,@{n='mem';e={$_.'HardwareInformation.qwMemorySize'}} | ConvertTo-Json -Compress";
      execFileCb("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { windowsHide: true, timeout: 20000, cwd: os.tmpdir() }, (_e, out) => {
        const [gpus, chassis, battery, reg] = String(out || "").split("|||").map(x => x.trim());
        let list = []; try { list = JSON.parse(gpus); if (!Array.isArray(list)) list = [list]; } catch {}
        let mem = []; try { mem = JSON.parse(reg); if (!Array.isArray(mem)) mem = [mem]; } catch {}
        for (const g of list) { const r = mem.find(m => m && m.DriverDesc === g.Name && +m.mem > 0); g.vram = r ? +r.mem : +g.AdapterRAM || 0; }
        resolve({ gpus: list, laptop: /(^|,)(8|9|10|14|31|32)(,|$)/.test(chassis || "") || /True/i.test(battery || "") });
      });
    });
  }
  const encoders = await usableEncoders().catch(() => []);
  return {
    cpu: os.cpus()[0]?.model?.trim() || "", cores: os.cpus().length, ram: os.totalmem(), platform: process.platform,
    gpu: (info.auxAttributes?.glRenderer || "").replace(/^ANGLE \((.*)\)$/, "$1"), gpuDevices: devs, wmi,
    displays: screen.getAllDisplays().map((d, i) => ({ id: d.id, label: `Pantalla ${i + 1}`, w: d.size.width * d.scaleFactor, h: d.size.height * d.scaleFactor, hz: d.displayFrequency || 0, primary: d.id === screen.getPrimaryDisplay().id })),
    encoders,
  };
});

/* ---------------- DMX / Art-Net / sACN ---------------- */
// El servicio de red corre en su propio proceso. El editor habla con él por un
// MessagePort directo (los fotogramas DMX no pasan por este proceso). Si el
// servicio se cae, el editor lo vuelve a arrancar y reenvía la configuración.
let dmxProc = null;
function startDmx(wc) {
  if (!dmxProc) {
    dmxProc = utilityProcess.fork(path.join(__dirname, "dmx-service.mjs"), [], { serviceName: "LumaMap DMX", stdio: "pipe" });
    dmxProc.stderr?.on("data", (d) => console.error("[dmx]", d.toString()));
    const me = dmxProc;
    dmxProc.on("exit", (code) => { if (dmxProc === me) dmxProc = null; log("dmx", "Servicio DMX terminó (" + code + ")"); if (!wc.isDestroyed() && !quitting) wc.send("dmx:exit", code); });
  }
  const { port1, port2 } = new MessageChannelMain();
  dmxProc.postMessage({ t: "port" }, [port1]);
  wc.postMessage("dmx:port", null, [port2]);
  return true;
}
ipcMain.handle("dmx:start", (e) => startDmx(e.sender));

/* ---------------- Mando remoto (teléfono / tablet / otro PC) y OSC ---------------- */
let remote = { proc: null, port: 0, oscPort: 0, httpsPort: 0, pin: "", error: "" };
function settingsFile() { return path.join(app.getPath("userData"), "lumamap-settings.json"); }
function readSettings() { try { return JSON.parse(fs.readFileSync(settingsFile(), "utf8")); } catch { return {}; } }
function writeSettings(s) { try { fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2)); } catch {} }
function startRemote() {
  const st = readSettings();
  if (!st.pin) { st.pin = String(Math.floor(1000 + Math.random() * 9000)); writeSettings(st); }
  remote.pin = st.pin;
  const data = path.join(app.getPath("userData"), "remote-data");
  fs.mkdirSync(data, { recursive: true });
  const proc = utilityProcess.fork(path.join(__dirname, "remote-service.mjs"), [], {
    serviceName: "LumaMap Mando",
    env: { ...process.env, LUMAMAP_DATA: data, LUMAMAP_PIN: st.pin, LUMAMAP_REMOTE_PORT: String(st.remotePort || 8080), LUMAMAP_OSC_PORT: String(st.oscPort || 9129) },
  });
  remote.proc = proc;
  proc.on("message", (m) => {
    if (m.t === "ready") { remote.port = m.port; remote.oscPort = m.oscPort; remote.httpsPort = m.httpsPort || 0; remote.error = ""; editor?.webContents.send("remote:ready"); }
    if (m.t === "error") remote.error = m.msg;
  });
  proc.on("exit", () => { if (remote.proc === proc && !quitting) { remote.proc = null; remote.port = 0; setTimeout(startRemote, 1500); } });
}
ipcMain.handle("remote:info", () => {
  const urls = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces()))
    for (const a of addrs || []) if ((a.family === "IPv4" || a.family === 4) && !a.internal) urls.push({ name, ip: a.address, url: `http://${a.address}:${remote.port}/controller.html`,
      cam: remote.httpsPort ? `https://${a.address}:${remote.httpsPort}/phonecam.html` : "" });
  return { port: remote.port, oscPort: remote.oscPort, httpsPort: remote.httpsPort, pin: remote.pin, urls, error: remote.error };
});
ipcMain.handle("remote:newPin", () => { const st = readSettings(); st.pin = String(Math.floor(1000 + Math.random() * 9000)); writeSettings(st); try { remote.proc?.kill(); } catch {} return st.pin; });
app.on("before-quit", () => { const p = remote.proc; remote.proc = null; try { p?.kill(); } catch {} });
app.on("before-quit", () => { try { dmxProc?.kill(); } catch {} });

ipcMain.handle("video:release", (_e, url) => {
  try { fs.rmSync(path.join(OPT_DIR, path.basename(decodeURIComponent(new URL(url).pathname))), { force: true }); } catch {}
});

app.whenReady().then(() => {
  buildMenu();
  // Windows: accesos directos (escritorio y menú Inicio) garantizados aunque falten.
  if (process.platform === "win32" && app.isPackaged) setTimeout(async () => {
    try {
      const S = require("./shortcuts.js");
      if (!S.isInstalled(process.execPath)) return;
      const made = S.ensureShortcuts({ exe: process.execPath, desktopDir: app.getPath("desktop"),
        startMenuDir: path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs"),
        pref: await S.readPref(), writeLink: (f, op, o) => shell.writeShortcutLink(f, op, o) });
      if (made.length) log("info", "Accesos directos creados: " + made.join(", "));
    } catch (e) { log("warn", "Accesos directos: " + (e?.message || e)); }
  }, 3000);
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
  const allowed = new Set(["media", "fullscreen", "midi", "clipboard-sanitized-write", "window-management", "serial"]);
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(allowed.has(perm)));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => allowed.has(perm));
  // Interfaces USB-DMX (Web Serial): se elige sola la que parezca DMX (chip FTDI o nombre), sin diálogos.
  session.defaultSession.setDevicePermissionHandler((d) => d.deviceType === "serial");
  session.defaultSession.on("select-serial-port", (event, list, _wc, cb) => {
    event.preventDefault();
    const isDmx = (p) => /^(0x)?0?403$|^1027$/i.test(String(p.vendorId || "")) || /dmx|enttec|ftdi|ultradmx|eurolite/i.test(`${p.displayName || ""} ${p.portName || ""}`);
    const pick = list.find(isDmx);
    log("dmx", "USB-DMX: " + (pick ? `${pick.displayName || pick.portName}` : "ninguna interfaz") + ` (${list.length} puerto(s) serie)`);
    cb(pick ? pick.portId : "");
  });

  // Conectar o desconectar el proyector con la salida abierta: se recoloca sola.
  const displaysChanged = () => { buildMenu(); editor?.webContents.send("displays-changed"); };
  screen.on("display-added", () => { displaysChanged(); if (output) placeOutput(output); });
  // Un parpadeo del HDMI (el proyector cambia de entrada, se reinicia o negocia la señal)
  // quita la pantalla un instante: se espera a que vuelva antes de mover la salida.
  let removedTimer = 0;
  screen.on("display-removed", () => {
    displaysChanged();
    clearTimeout(removedTimer);
    removedTimer = setTimeout(() => { if (output && !output.isDestroyed() && !projectorDisplay()) output.setFullScreen(false); }, 3000);
  });
  // El proyector cambió de resolución, orientación o escala: la salida se recoloca a su medida.
  screen.on("display-metrics-changed", (_e, d, changed) => {
    if (!output || output.isDestroyed()) return;
    if (projectorDisplay()?.id === d.id && changed.some(c => c === "bounds" || c === "workArea" || c === "scaleFactor" || c === "rotation")) placeOutput(output);
  });
  // Windows no apaga la pantalla ni el proyector por inactividad mientras LumaMap está abierto
  // (en un show nadie toca el ratón y el proyector se quedaba «sin señal»).
  try { powerSaveBlocker.start("prevent-display-sleep"); } catch (e) { log("app", "No se pudo impedir que se apague la pantalla: " + e.message); }

  log("app", `LumaMap ${app.getVersion()} · Electron ${process.versions.electron} · ${os.platform()} ${os.release()}`);
  startRemote();
  createEditor();
});

app.on("second-instance", () => { if (editor) { if (editor.isMinimized()) editor.restore(); editor.focus(); } });
app.on("window-all-closed", () => app.quit());
