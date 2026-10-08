import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { readJsonSync, writeFileAtomic } from './fsutil';

/** Persistent application settings (not part of a project). */
export interface AppSettings {
  uiMode: 'simple' | 'pro';
  qualityPreset: 'low' | 'balanced' | 'high' | 'ultra' | 'recommended';
  previewScale: number;
  previewFps: number;
  recentProjects: { path: string; name: string; openedAt: number }[];
  lastProjectPath: string | null;
  autosaveSeconds: number;
  backupsToKeep: number;
  hardwareProfiled: boolean;
  shortcuts: Record<string, string>;
  windowBounds: { x: number; y: number; width: number; height: number; maximized: boolean } | null;
  checkUpdatesOnStart: boolean;
  anthropicApiKey: string | null;
  language: 'es';
}

const DEFAULTS: AppSettings = {
  uiMode: 'simple',
  qualityPreset: 'recommended',
  previewScale: 0.5,
  previewFps: 30,
  recentProjects: [],
  lastProjectPath: null,
  autosaveSeconds: 30,
  backupsToKeep: 20,
  hardwareProfiled: false,
  shortcuts: {},
  windowBounds: null,
  checkUpdatesOnStart: true,
  anthropicApiKey: null,
  language: 'es',
};

class SettingsStore {
  private file = '';
  data: AppSettings = { ...DEFAULTS };
  private saveTimer: NodeJS.Timeout | null = null;

  load() {
    this.file = path.join(app.getPath('userData'), 'settings.json');
    this.data = { ...DEFAULTS, ...readJsonSync<Partial<AppSettings>>(this.file, {}) };
  }

  update(patch: Partial<AppSettings>) {
    this.data = { ...this.data, ...patch };
    this.scheduleSave();
  }

  private scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flush(), 300);
  }

  async flush() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    await writeFileAtomic(this.file, JSON.stringify(this.data, null, 1));
  }

  flushSync() {
    if (!this.file) return;
    try {
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 1));
    } catch {
      /* ignore on quit */
    }
  }

  addRecent(p: string, name: string) {
    const list = this.data.recentProjects.filter((r) => r.path !== p);
    list.unshift({ path: p, name, openedAt: Date.now() });
    this.update({ recentProjects: list.slice(0, 15), lastProjectPath: p });
  }
}

export const settings = new SettingsStore();
