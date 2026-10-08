import { app, BrowserWindow, dialog, ipcMain, net, protocol, screen, session, shell, webContents, safeStorage, type WebContents } from 'electron';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AppInfo, UpdateState } from '../shared/ipc';
import type { MediaKind } from '../shared/project/model';
import { log } from './log';
import { settings, type AppSettings } from './settings';
import { projects } from './services/project';
import { handleMediaProtocol, registerMediaScheme } from './services/mediaProtocol';
import { gpuCounters, hardwareReport, listDisplays, listInterfaces, systemMetrics } from './services/system';
import { SupervisedUtility } from './services/utility';
import { Updater } from './services/updater';
import { callClaude, type AiRequest } from './services/ai';

const SELF_TEST = process.argv.includes('--self-test');
const APP_SCHEME = 'app';

// ------------------------------------------------------------------ early setup (before ready)

app.setName('LUJAN MAPPING Studio');
if (process.platform === 'win32') app.setAppUserModelId('com.lujan.mapping.studio');
// Prefer the dedicated GPU on laptops with switchable graphics.
app.commandLine.appendSwitch('force_high_performance_gpu');
// Rendering and outputs must keep running when the control window is covered/minimized.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
// Hardware video decode/encode through the GPU (D3D11 / Media Foundation on Windows).
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport,MediaFoundationD3D11VideoCapture');
if (SELF_TEST) app.commandLine.appendSwitch('enable-unsafe-swiftshader');

protocol.registerSchemesAsPrivileged([{ scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
registerMediaScheme();

if (!SELF_TEST && !app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let control: BrowserWindow | null = null;
const outputs = new Map<string, BrowserWindow>();
const dmx = new SupervisedUtility('dmx', 'dmxProcess.js');
const netsvc = new SupervisedUtility('net', 'netProcess.js');
const updater = new Updater((s: UpdateState) => send('updater:state', s));
let shuttingDown = false;
const exportFiles = new Map<number, fsp.FileHandle>();
let exportCounter = 0;

function send(channel: string, ...args: unknown[]) {
  if (control && !control.isDestroyed()) control.webContents.send(channel, ...args);
}

function rendererRoot() {
  return path.join(__dirname, '..', 'renderer');
}

// ------------------------------------------------------------------ windows

function createControlWindow() {
  const b = settings.data.windowBounds;
  control = new BrowserWindow({
    x: b?.x,
    y: b?.y,
    width: b?.width ?? 1600,
    height: b?.height ?? 940,
    minWidth: 1100,
    minHeight: 680,
    show: false,
    backgroundColor: '#0d0f12',
    title: 'LUJAN MAPPING Studio',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  control.setMenuBarVisibility(false);
  if (b?.maximized) control.maximize();
  control.once('ready-to-show', () => {
    if (!SELF_TEST) control?.show();
  });
  control.on('close', (e) => {
    if (shuttingDown) return;
    e.preventDefault();
    void safeShutdown('quit').then(() => app.exit(0));
  });
  control.on('closed', () => (control = null));
  const saveBounds = () => {
    if (!control || control.isDestroyed()) return;
    const max = control.isMaximized();
    const nb = max ? (settings.data.windowBounds ?? control.getNormalBounds()) : control.getBounds();
    settings.update({ windowBounds: { ...nb, maximized: max } });
  };
  control.on('resize', saveBounds);
  control.on('move', saveBounds);

  // Output windows are opened by the renderer (same process → it can render into them).
  control.webContents.setWindowOpenHandler(({ frameName }) => {
    const m = /^lujan-output:([^:]+):(-?\d+)$/.exec(frameName);
    if (!m) return { action: 'deny' };
    const displayId = Number(m[2]);
    const display = screen.getAllDisplays().find((d) => d.id === displayId);
    const bounds = display?.bounds ?? { x: 80, y: 80, width: 960, height: 540 };
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        ...bounds,
        frame: false,
        show: true,
        backgroundColor: '#000000',
        autoHideMenuBar: true,
        fullscreenable: true,
        skipTaskbar: false,
        title: `Salida ${m[1]}`,
        webPreferences: { backgroundThrottling: false, contextIsolation: true, sandbox: true },
      },
    };
  });
  control.webContents.on('did-create-window', (win, { frameName }) => {
    const m = /^lujan-output:([^:]+):(-?\d+)$/.exec(frameName);
    if (!m) return;
    const id = m[1];
    const displayId = Number(m[2]);
    outputs.get(id)?.destroy();
    outputs.set(id, win);
    win.setMenuBarVisibility(false);
    const display = screen.getAllDisplays().find((d) => d.id === displayId);
    if (display) {
      win.setBounds(display.bounds);
      // Covers the taskbar on the projector display.
      win.setFullScreen(true);
      win.setAlwaysOnTop(true, 'screen-saver');
    }
    win.on('closed', () => {
      if (outputs.get(id) === win) outputs.delete(id);
      send('output:closed', id);
    });
  });

  control.webContents.on('render-process-gone', (_e, details) => {
    log.error('renderer', 'El proceso de interfaz/render terminó', details);
    if (shuttingDown) return;
    // Crash recovery: reload; the renderer restores the autosave.
    setTimeout(() => control?.webContents.reload(), 500);
  });
  control.webContents.on('console-message', (e) => {
    const lvl = e.level;
    if (lvl === 'error' || lvl === 'warning') log.write(lvl === 'error' ? 'ERROR' : 'WARN', 'renderer', `${e.message} (${e.sourceId}:${e.lineNumber})`);
  });

  const devUrl = process.env.LUJAN_DEV_URL;
  void control.loadURL(devUrl ? `${devUrl}/index.html` : `${APP_SCHEME}://ui/index.html`);
}

function wirePorts(wc: WebContents) {
  dmx.connect(wc, 'ui');
  dmx.connect(wc, 'render');
  netsvc.connect(wc, 'ui');
}

// ------------------------------------------------------------------ safe shutdown

/**
 * AUTOSAVE → STOP CAMERAS → STOP TRACKING → STOP RENDER → STOP EXPORT → RELEASE GPU →
 * RELEASE MIDI → RELEASE DMX → BACKUP. The renderer performs its part and acknowledges.
 */
async function safeShutdown(reason: 'quit' | 'update'): Promise<{ ok: boolean; steps: { step: string; ok: boolean; detail?: string }[] }> {
  if (shuttingDown) return { ok: true, steps: [] };
  shuttingDown = true;
  log.info('shutdown', `Cierre seguro (${reason})`);
  const steps: { step: string; ok: boolean; detail?: string }[] = [];
  if (control && !control.isDestroyed()) {
    const ack = await new Promise<{ steps: { step: string; ok: boolean; detail?: string }[]; projectText?: string; projectPath?: string | null; name?: string } | null>((resolve) => {
      const t = setTimeout(() => resolve(null), 10000);
      ipcMain.once('app:shutdown-ack', (_e, payload) => {
        clearTimeout(t);
        resolve(payload);
      });
      send('app:prepare-shutdown', reason);
    });
    if (ack) {
      steps.push(...ack.steps);
      if (ack.projectText) {
        try {
          await projects.autosave(ack.projectText, ack.projectPath ?? null, ack.name ?? '');
          if (ack.projectPath && reason === 'update') {
            const backups = path.join(path.dirname(ack.projectPath), 'Backups');
            await fsp.mkdir(backups, { recursive: true });
            await fsp.writeFile(path.join(backups, `antes-de-actualizar-${app.getVersion()}-${Date.now()}.lujanshow`), ack.projectText);
          }
          steps.push({ step: 'backup', ok: true });
        } catch (e) {
          steps.push({ step: 'backup', ok: false, detail: (e as Error).message });
        }
      }
    } else steps.push({ step: 'renderer', ok: false, detail: 'La interfaz no respondió a tiempo' });
  }
  for (const w of outputs.values()) if (!w.isDestroyed()) w.destroy();
  await Promise.all([dmx.stop(), netsvc.stop()]);
  steps.push({ step: 'dmx', ok: true }, { step: 'network', ok: true });
  gpuCounters.stop();
  for (const fh of exportFiles.values()) await fh.close().catch(() => {});
  await settings.flush().catch(() => {});
  projects.markCleanExit();
  log.info('shutdown', 'Pasos completados', steps);
  log.close();
  return { ok: steps.every((s) => s.ok), steps };
}

// ------------------------------------------------------------------ IPC

function registerIpc() {
  const win = () => control!;
  ipcMain.handle('app:info', (): AppInfo => ({
    version: app.getVersion(),
    platform: process.platform,
    userData: app.getPath('userData'),
    documents: app.getPath('documents'),
    logsDir: log.dir,
    isPackaged: app.isPackaged,
    selfTest: SELF_TEST,
  }));
  ipcMain.handle('app:hardware', () => hardwareReport());
  ipcMain.handle('app:metrics', () => systemMetrics());
  ipcMain.handle('app:displays', () => listDisplays());
  ipcMain.handle('app:interfaces', () => listInterfaces());
  ipcMain.handle('app:openLogs', () => shell.openPath(log.dir));
  ipcMain.handle('app:openPath', (_e, p: string) => shell.showItemInFolder(p));
  ipcMain.handle('app:openExternal', (_e, url: string) => (/^https?:\/\//.test(url) ? shell.openExternal(url) : undefined));
  ipcMain.handle('app:quit', () => control?.close());
  ipcMain.on('app:log', (_e, level: string, scope: string, msg: string) => log.write(level, scope, msg));
  ipcMain.handle('app:selftest-result', (_e, result: { ok: boolean; checks: { name: string; ok: boolean; detail?: string }[] }) => {
    log.info('selftest', 'Resultado', result);
    if (SELF_TEST) {
      process.stdout.write(`SELFTEST ${result.ok ? 'OK' : 'FAIL'}\n${JSON.stringify(result.checks, null, 1)}\n`);
      void safeShutdown('quit').then(() => app.exit(result.ok ? 0 : 1));
    }
  });

  ipcMain.handle('settings:get', () => ({ ...settings.data, anthropicApiKey: settings.data.anthropicApiKey ? '••••' : null }));
  ipcMain.handle('settings:set', (_e, patch: Partial<AppSettings>) => {
    const { anthropicApiKey, ...rest } = patch;
    settings.update(rest);
    if (anthropicApiKey !== undefined) {
      const enc = anthropicApiKey && safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(anthropicApiKey).toString('base64') : anthropicApiKey;
      settings.update({ anthropicApiKey: enc ? `enc:${enc}` : null });
    }
    return true;
  });

  ipcMain.handle('project:save', async (_e, file: string | null, name: string, text: string) => {
    const saved = file ? await projects.save(file, text) : await projects.saveAsDialog(win(), name, text);
    if (saved) settings.addRecent(saved, name);
    return saved;
  });
  ipcMain.handle('project:saveAs', async (_e, name: string, text: string) => {
    const saved = await projects.saveAsDialog(win(), name, text);
    if (saved) settings.addRecent(saved, name);
    return saved;
  });
  ipcMain.handle('project:open', async (_e, file?: string) => {
    const r = file ? await projects.open(file) : await projects.openDialog(win());
    return r;
  });
  ipcMain.handle('project:opened', (_e, file: string, name: string) => settings.addRecent(file, name));
  ipcMain.handle('project:autosave', (_e, text: string, file: string | null, name: string) => projects.autosave(text, file, name));
  ipcMain.handle('project:recovery', () => projects.recoveryInfo());
  ipcMain.handle('project:readRecovery', () => projects.readRecovery());
  ipcMain.handle('project:discardRecovery', () => projects.discardRecovery());
  ipcMain.handle('project:defaultDir', () => projects.defaultProjectsDir());

  ipcMain.handle('media:import', (_e, kinds?: MediaKind[]) => projects.importDialog(win(), kinds));
  ipcMain.handle('media:describe', (_e, files: string[]) => projects.describeFiles(files));
  ipcMain.handle('media:collect', (_e, projectFile: string, items) => projects.collectMedia(projectFile, items));
  ipcMain.handle('media:relink', async (_e, projectFile: string | null, items, askFolder: boolean) => {
    let dir: string | undefined;
    if (askFolder) {
      const r = await dialog.showOpenDialog(win(), { title: 'Buscar archivos perdidos en…', properties: ['openDirectory'] });
      if (r.canceled) return null;
      dir = r.filePaths[0];
    }
    return projects.relink(projectFile, items, dir);
  });
  ipcMain.handle('media:thumbnail', (_e, projectFile: string | null, mediaId: string, png: Uint8Array) => projects.writeThumbnail(projectFile, mediaId, png));

  ipcMain.handle('dialog:saveFile', async (_e, title: string, defaultName: string, ext: string[]) => {
    const r = await dialog.showSaveDialog(win(), { title, defaultPath: path.join(app.getPath('videos'), defaultName), filters: [{ name: ext.join(', ').toUpperCase(), extensions: ext }] });
    return r.canceled ? null : r.filePath;
  });
  ipcMain.handle('dialog:message', async (_e, opts: { type: 'info' | 'warning' | 'error' | 'question'; title: string; message: string; detail?: string; buttons?: string[] }) => {
    const r = await dialog.showMessageBox(win(), { ...opts, buttons: opts.buttons ?? ['Aceptar'], noLink: true });
    return r.response;
  });

  // Streaming writes for background video export (the file is never held in memory).
  ipcMain.handle('export:open', async (_e, file: string) => {
    const fh = await fsp.open(file, 'w');
    const id = ++exportCounter;
    exportFiles.set(id, fh);
    return id;
  });
  ipcMain.handle('export:write', async (_e, id: number, data: Uint8Array, position: number) => {
    const fh = exportFiles.get(id);
    if (!fh) throw new Error('Exportación cerrada');
    await fh.write(data, 0, data.length, position);
    return true;
  });
  ipcMain.handle('export:close', async (_e, id: number) => {
    const fh = exportFiles.get(id);
    exportFiles.delete(id);
    await fh?.close();
    return true;
  });
  ipcMain.handle('export:abort', async (_e, id: number, file: string) => {
    const fh = exportFiles.get(id);
    exportFiles.delete(id);
    await fh?.close().catch(() => {});
    await fsp.rm(file, { force: true });
  });

  ipcMain.handle('ports:request', (e) => wirePorts(e.sender));
  ipcMain.handle('dmx:config', (_e, msg: unknown) => dmx.rememberConfig(msg));
  ipcMain.handle('net:config', (_e, msg: unknown) => netsvc.rememberConfig(msg));
  ipcMain.handle('net:remoteRoot', () => path.join(rendererRoot(), 'remote'));

  ipcMain.handle('output:close', (_e, id: string) => outputs.get(id)?.destroy());
  ipcMain.handle('output:list', () => [...outputs.keys()]);

  ipcMain.handle('updater:check', () => updater.check());
  ipcMain.handle('updater:download', () => updater.download());
  ipcMain.handle('updater:install', async () => {
    if (updater.state.state !== 'ready') return false;
    const r = await safeShutdown('update');
    if (!updater.install(control)) {
      app.exit(r.ok ? 0 : 1);
      return false;
    }
    return true;
  });

  ipcMain.handle('ai:request', async (_e, req: AiRequest) => {
    const stored = settings.data.anthropicApiKey;
    let key: string | null = null;
    if (stored?.startsWith('enc:')) {
      const raw = stored.slice(4);
      try {
        key = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(raw, 'base64')) : raw;
      } catch {
        key = null;
      }
    }
    if (!key) return { error: 'Configura tu clave de API de Anthropic en Ajustes → Asistente IA.' };
    return callClaude(key, req);
  });
}

// ------------------------------------------------------------------ app lifecycle

app.on('second-instance', () => {
  if (control) {
    if (control.isMinimized()) control.restore();
    control.focus();
  }
});

app.whenReady().then(async () => {
  log.init();
  settings.load();
  projects.init();

  protocol.handle(APP_SCHEME, (req) => {
    const url = new URL(req.url);
    const rel = decodeURIComponent(url.pathname);
    const file = path.normalize(path.join(rendererRoot(), rel));
    if (!file.startsWith(rendererRoot())) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  handleMediaProtocol();

  // Only our own pages may use cameras, microphones, MIDI (incl. SysEx), serial and fullscreen.
  const trusted = (origin: string) => origin.startsWith(`${APP_SCHEME}://`) || (!!process.env.LUJAN_DEV_URL && origin.startsWith(process.env.LUJAN_DEV_URL));
  const allowed = new Set(['media', 'midi', 'midiSysex', 'fullscreen', 'serial', 'window-management', 'clipboard-sanitized-write', 'notifications', 'speaker-selection']);
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => cb(trusted(details.requestingUrl ?? wc.getURL()) && allowed.has(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => trusted(origin) && allowed.has(permission));
  session.defaultSession.setDevicePermissionHandler((d) => trusted(d.origin) && (d.deviceType === 'serial' || d.deviceType === 'usb' || d.deviceType === 'hid'));
  session.defaultSession.on('select-serial-port', (event, portList, _wc, callback) => {
    event.preventDefault();
    // The renderer asked for a specific port via navigator.serial.requestPort with filters;
    // pick the first matching one (USB DMX interfaces expose a single FTDI port).
    callback(portList[0]?.portId ?? '');
  });

  registerIpc();
  dmx.start();
  netsvc.start();
  gpuCounters.start();

  screen.on('display-added', () => send('displays:changed', listDisplays()));
  screen.on('display-removed', () => send('displays:changed', listDisplays()));
  screen.on('display-metrics-changed', () => send('displays:changed', listDisplays()));

  createControlWindow();

  if (SELF_TEST) {
    // Hard timeout so a broken install can never hang the installer.
    setTimeout(() => {
      process.stdout.write('SELFTEST TIMEOUT\n');
      app.exit(2);
    }, 90_000);
  }
});

app.on('window-all-closed', () => {
  if (!shuttingDown) void safeShutdown('quit').then(() => app.exit(0));
});

process.on('uncaughtException', (e) => log.error('main', 'Excepción no controlada', e));
process.on('unhandledRejection', (e) => log.error('main', 'Promesa rechazada sin manejar', e));

// keep imports referenced for bundlers that tree-shake side-effect-free modules
void webContents;
void fs;
