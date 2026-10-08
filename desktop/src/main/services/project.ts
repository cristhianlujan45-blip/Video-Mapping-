import { app, dialog, type BrowserWindow } from 'electron';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_EXTENSION, uid, type MediaItem, type MediaKind } from '../../shared/project/model';
import { PROJECT_FOLDERS } from '../../shared/project/codec';
import type { ProjectFileResult, RecoveryInfo } from '../../shared/ipc';
import { exists, pruneFiles, readJsonSync, sanitizeFileName, writeFileAtomic } from '../fsutil';
import { log } from '../log';
import { settings } from '../settings';

const VIDEO_EXT = ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'ogv', 'mpg', 'mpeg', 'ts', 'm2ts', 'hevc', 'h264'];
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'svg', 'ico', 'tif', 'tiff'];
const AUDIO_EXT = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'opus', 'aif', 'aiff'];
const MODEL_EXT = ['obj', 'fbx', 'gltf', 'glb', 'stl', 'ply', 'dae', '3ds'];

export function mediaKind(file: string): MediaKind | null {
  const ext = path.extname(file).slice(1).toLowerCase();
  if (VIDEO_EXT.includes(ext)) return 'video';
  if (IMAGE_EXT.includes(ext)) return 'image';
  if (AUDIO_EXT.includes(ext)) return 'audio';
  if (MODEL_EXT.includes(ext)) return 'model3d';
  return null;
}

const KIND_FOLDER: Record<MediaKind, string> = { video: 'Media/Videos', image: 'Media/Images', audio: 'Media/Audio', model3d: '3D' };

interface SessionLock {
  pid: number;
  startedAt: number;
  clean: boolean;
}

/**
 * Project files, folder structure, backups, autosave and crash recovery.
 */
export class ProjectService {
  private autosaveDir = '';
  private lockFile = '';
  /** Set at startup when the previous session did not exit cleanly. */
  previousCrash = false;

  init() {
    const ud = app.getPath('userData');
    this.autosaveDir = path.join(ud, 'autosave');
    this.lockFile = path.join(ud, 'session.lock');
    fs.mkdirSync(this.autosaveDir, { recursive: true });
    const prev = readJsonSync<SessionLock | null>(this.lockFile, null);
    this.previousCrash = !!prev && !prev.clean;
    if (this.previousCrash) log.warn('project', 'La sesión anterior no se cerró correctamente', prev);
    fs.writeFileSync(this.lockFile, JSON.stringify({ pid: process.pid, startedAt: Date.now(), clean: false } satisfies SessionLock));
  }

  markCleanExit() {
    try {
      fs.writeFileSync(this.lockFile, JSON.stringify({ pid: process.pid, startedAt: Date.now(), clean: true } satisfies SessionLock));
    } catch (e) {
      log.error('project', 'No se pudo marcar el cierre limpio', e);
    }
  }

  defaultProjectsDir() {
    return path.join(app.getPath('documents'), 'LUJAN MAPPING Studio', 'Proyectos');
  }

  /** Creates the standard folder layout next to a project file. */
  async ensureStructure(projectFile: string) {
    const root = path.dirname(projectFile);
    await Promise.all(PROJECT_FOLDERS.map((f) => fsp.mkdir(path.join(root, f), { recursive: true })));
  }

  async save(file: string, text: string): Promise<string> {
    await this.ensureStructure(file);
    if (await exists(file)) {
      // Keep the previous version as a timestamped backup before overwriting.
      const backups = path.join(path.dirname(file), 'Backups');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const base = path.basename(file, path.extname(file));
      try {
        await fsp.copyFile(file, path.join(backups, `${base}-${stamp}.${PROJECT_EXTENSION}`));
        await pruneFiles(backups, `${base}-`, settings.data.backupsToKeep);
      } catch (e) {
        log.warn('project', 'No se pudo crear la copia de seguridad', e);
      }
    }
    await writeFileAtomic(file, text);
    log.info('project', `Guardado ${file}`);
    return file;
  }

  async saveAsDialog(win: BrowserWindow, name: string, text: string): Promise<string | null> {
    const base = sanitizeFileName(name);
    const res = await dialog.showSaveDialog(win, {
      title: 'Guardar proyecto',
      defaultPath: path.join(this.defaultProjectsDir(), base, `${base}.${PROJECT_EXTENSION}`),
      filters: [{ name: 'Proyecto LUJAN MAPPING Studio', extensions: [PROJECT_EXTENSION] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (res.canceled || !res.filePath) return null;
    let file = res.filePath;
    // If the user picked a generic folder, create a dedicated project folder.
    const parent = path.basename(path.dirname(file));
    const stem = path.basename(file, path.extname(file));
    if (parent !== stem) file = path.join(path.dirname(file), stem, `${stem}.${PROJECT_EXTENSION}`);
    return this.save(file, text);
  }

  async openDialog(win: BrowserWindow): Promise<ProjectFileResult | null> {
    const res = await dialog.showOpenDialog(win, {
      title: 'Abrir proyecto',
      defaultPath: this.defaultProjectsDir(),
      filters: [{ name: 'Proyecto LUJAN MAPPING Studio', extensions: [PROJECT_EXTENSION, 'json'] }],
      properties: ['openFile'],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    return this.open(res.filePaths[0]);
  }

  async open(file: string): Promise<ProjectFileResult> {
    const text = await fsp.readFile(file, 'utf8');
    return { path: file, text };
  }

  // ------------------------------------------------------------ autosave / recovery

  async autosave(text: string, projectPath: string | null, name: string) {
    const file = path.join(this.autosaveDir, 'current.json');
    await writeFileAtomic(file, text);
    await writeFileAtomic(path.join(this.autosaveDir, 'current.meta.json'), JSON.stringify({ projectPath, name, savedAt: Date.now() }));
  }

  /** Recovery is offered when the last session crashed and left an autosave. */
  async recoveryInfo(): Promise<RecoveryInfo | null> {
    if (!this.previousCrash) return null;
    const meta = readJsonSync<{ projectPath: string | null; name: string; savedAt: number } | null>(path.join(this.autosaveDir, 'current.meta.json'), null);
    const file = path.join(this.autosaveDir, 'current.json');
    if (!meta || !(await exists(file))) return null;
    return { autosavePath: file, projectPath: meta.projectPath, name: meta.name, savedAt: meta.savedAt };
  }

  async readRecovery(): Promise<string | null> {
    try {
      return await fsp.readFile(path.join(this.autosaveDir, 'current.json'), 'utf8');
    } catch {
      return null;
    }
  }

  async discardRecovery() {
    this.previousCrash = false;
    await fsp.rm(path.join(this.autosaveDir, 'current.meta.json'), { force: true });
  }

  // ------------------------------------------------------------ media

  async importDialog(win: BrowserWindow, kinds: MediaKind[] = ['video', 'image', 'audio', 'model3d']): Promise<MediaItem[]> {
    const exts = [...(kinds.includes('video') ? VIDEO_EXT : []), ...(kinds.includes('image') ? IMAGE_EXT : []), ...(kinds.includes('audio') ? AUDIO_EXT : []), ...(kinds.includes('model3d') ? MODEL_EXT : [])];
    const res = await dialog.showOpenDialog(win, {
      title: 'Importar medios',
      filters: [{ name: 'Medios compatibles', extensions: exts }],
      properties: ['openFile', 'multiSelections'],
    });
    if (res.canceled) return [];
    return this.describeFiles(res.filePaths);
  }

  async describeFiles(files: string[]): Promise<MediaItem[]> {
    const out: MediaItem[] = [];
    for (const f of files) {
      const kind = mediaKind(f);
      if (!kind) continue;
      try {
        const st = await fsp.stat(f);
        if (!st.isFile()) continue;
        out.push({ id: uid('media'), name: path.basename(f), kind, path: f, size: st.size });
      } catch (e) {
        log.warn('media', `No se pudo leer ${f}`, e);
      }
    }
    return out;
  }

  /** Copies media into the project folder (portable project). Returns updated items. */
  async collectMedia(projectFile: string, items: MediaItem[]): Promise<MediaItem[]> {
    const root = path.dirname(projectFile);
    const out: MediaItem[] = [];
    for (const m of items) {
      const folder = path.join(root, KIND_FOLDER[m.kind]);
      await fsp.mkdir(folder, { recursive: true });
      const dest = path.join(folder, path.basename(m.path));
      try {
        if (path.resolve(m.path) !== path.resolve(dest)) {
          if (!(await exists(dest))) await fsp.copyFile(m.path, dest);
        }
        out.push({ ...m, path: dest, rel: path.relative(root, dest) });
      } catch (e) {
        log.warn('media', `No se pudo copiar ${m.path}`, e);
        out.push(m);
      }
    }
    return out;
  }

  /** Resolves moved media: tries the stored path, then the project-relative path, then a name+size search in `searchDir`. */
  async relink(projectFile: string | null, items: MediaItem[], searchDir?: string): Promise<{ items: MediaItem[]; missing: string[] }> {
    const missing: string[] = [];
    const out: MediaItem[] = [];
    let index: Map<string, string> | null = null;
    for (const m of items) {
      if (await exists(m.path)) {
        out.push(m);
        continue;
      }
      if (projectFile && m.rel) {
        const p = path.join(path.dirname(projectFile), m.rel);
        if (await exists(p)) {
          out.push({ ...m, path: p });
          continue;
        }
      }
      if (searchDir) {
        if (!index) index = await indexDir(searchDir, 6);
        const hit = index.get(`${m.name.toLowerCase()}|${m.size}`) ?? index.get(`${m.name.toLowerCase()}|*`);
        if (hit) {
          out.push({ ...m, path: hit });
          continue;
        }
      }
      missing.push(m.id);
      out.push(m);
    }
    return { items: out, missing };
  }

  async writeThumbnail(projectFile: string | null, mediaId: string, png: Uint8Array): Promise<string> {
    const dir = projectFile ? path.join(path.dirname(projectFile), 'Media', 'Thumbnails') : path.join(app.getPath('userData'), 'thumbnails');
    const file = path.join(dir, `${mediaId}.png`);
    await writeFileAtomic(file, png);
    return file;
  }
}

async function indexDir(dir: string, depth: number): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const walk = async (d: string, level: number) => {
    if (level > depth) return;
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p, level + 1);
      else if (e.isFile()) {
        try {
          const st = await fsp.stat(p);
          map.set(`${e.name.toLowerCase()}|${st.size}`, p);
          if (!map.has(`${e.name.toLowerCase()}|*`)) map.set(`${e.name.toLowerCase()}|*`, p);
        } catch {
          /* ignore */
        }
      }
    }
  };
  await walk(dir, 0);
  return map;
}

export const projects = new ProjectService();
