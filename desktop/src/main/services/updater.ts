import { app, type BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { UpdateState } from '../../shared/ipc';
import { log } from '../log';

type AutoUpdater = typeof import('electron-updater').autoUpdater;

/**
 * Updates through electron-updater + NSIS. The downloaded installer is a separate
 * executable that runs after this app has quit, so it never replaces files in use.
 * The installer itself keeps a copy of the previous version and restores it if the
 * new version fails its post-install self-test (see build/installer.nsh).
 */
export class Updater {
  private au: AutoUpdater | null = null;
  state: UpdateState = { state: 'idle' };

  constructor(private notify: (s: UpdateState) => void) {}

  private async load(): Promise<AutoUpdater | null> {
    if (this.au) return this.au;
    if (!app.isPackaged) {
      this.set({ state: 'unconfigured', message: 'Las actualizaciones solo funcionan en la versión instalada.' });
      return null;
    }
    const feed = path.join(process.resourcesPath, 'app-update.yml');
    if (!fs.existsSync(feed)) {
      this.set({ state: 'unconfigured', message: 'Esta compilación no tiene servidor de actualizaciones configurado.' });
      return null;
    }
    const { autoUpdater } = await import('electron-updater');
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.logger = { info: (m: unknown) => log.info('updater', String(m)), warn: (m: unknown) => log.warn('updater', String(m)), error: (m: unknown) => log.error('updater', String(m)), debug: () => {} };
    autoUpdater.on('checking-for-update', () => this.set({ state: 'checking' }));
    autoUpdater.on('update-not-available', (i) => this.set({ state: 'none', version: i.version }));
    autoUpdater.on('update-available', (i) => this.set({ state: 'available', version: i.version, notes: typeof i.releaseNotes === 'string' ? i.releaseNotes : undefined }));
    autoUpdater.on('download-progress', (p) => this.set({ state: 'downloading', percent: Math.round(p.percent) }));
    autoUpdater.on('update-downloaded', (i) => this.set({ state: 'ready', version: i.version }));
    autoUpdater.on('error', (e) => this.set({ state: 'error', message: e?.message ?? String(e) }));
    this.au = autoUpdater;
    return autoUpdater;
  }

  private set(s: UpdateState) {
    this.state = s;
    this.notify(s);
  }

  async check() {
    const au = await this.load();
    if (!au) return this.state;
    try {
      await au.checkForUpdates();
    } catch (e) {
      this.set({ state: 'error', message: (e as Error).message });
    }
    return this.state;
  }

  async download() {
    const au = await this.load();
    if (!au) return;
    try {
      await au.downloadUpdate();
    } catch (e) {
      this.set({ state: 'error', message: (e as Error).message });
    }
  }

  /** Called after the safe-shutdown sequence has completed. */
  install(_win: BrowserWindow | null) {
    if (!this.au || this.state.state !== 'ready') return false;
    log.info('updater', 'Lanzando instalador independiente y cerrando la aplicación');
    // isSilent=false (show progress), isForceRunAfter=true (relaunch when done)
    this.au.quitAndInstall(false, true);
    return true;
  }
}
