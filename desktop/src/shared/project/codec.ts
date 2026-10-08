import { createProject, defaultDmx } from './defaults';
import { PROJECT_FORMAT, PROJECT_VERSION, type Project } from './model';

export class ProjectFormatError extends Error {}

type Migration = (p: Record<string, unknown>) => Record<string, unknown>;

/** migrations[n] upgrades a version-n document to n+1. */
const migrations: Record<number, Migration> = {};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Fills every missing key of `value` from `defaults` (recursively for plain objects).
 * Arrays and primitives in `value` are kept as they are; unknown keys are preserved so
 * a newer file opened by an older build does not lose data on re-save.
 */
export function withDefaults<T>(value: unknown, defaults: T): T {
  if (!isObj(defaults)) return (value === undefined || value === null ? defaults : value) as T;
  if (!isObj(value)) return structuredClone(defaults);
  const out: Record<string, unknown> = { ...value };
  for (const [k, d] of Object.entries(defaults)) {
    if (!(k in out) || out[k] === undefined) out[k] = structuredClone(d);
    else if (isObj(d) && isObj(out[k])) out[k] = withDefaults(out[k], d);
  }
  return out as T;
}

export function parseProject(text: string): Project {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new ProjectFormatError(`El archivo no es un proyecto válido (JSON): ${(e as Error).message}`);
  }
  if (!isObj(raw) || raw.format !== PROJECT_FORMAT) throw new ProjectFormatError('El archivo no es un proyecto de LUJAN MAPPING Studio.');
  let doc = raw;
  let version = typeof doc.version === 'number' ? doc.version : 1;
  if (version > PROJECT_VERSION) {
    // Newer file: open best-effort (unknown keys are preserved).
    version = PROJECT_VERSION;
  }
  while (version < PROJECT_VERSION) {
    const m = migrations[version];
    if (!m) throw new ProjectFormatError(`No hay migración desde la versión ${version}.`);
    doc = m(doc);
    version++;
  }
  doc.version = PROJECT_VERSION;
  const base = createProject();
  const project = withDefaults<Project>(doc, base);
  project.dmx = withDefaults(project.dmx, defaultDmx());
  for (const k of ['media', 'compositions', 'outputs', 'cameras', 'rules', 'macros', 'cues', 'drawings', 'mappings'] as const) {
    if (!Array.isArray(project[k])) (project as unknown as Record<string, unknown>)[k] = [];
  }
  return project;
}

export function serializeProject(p: Project): string {
  return JSON.stringify({ ...p, format: PROJECT_FORMAT, version: PROJECT_VERSION, modifiedAt: Date.now() }, null, 1);
}

/** Folder layout created next to the project file. */
export const PROJECT_FOLDERS = [
  'Media',
  'Media/Videos',
  'Media/Images',
  'Media/Audio',
  'Media/Proxies',
  'Media/Thumbnails',
  'Scenes',
  'Mapping',
  '3D',
  'Presets',
  'Tracking',
  'DMX',
  'MIDI',
  'Outputs',
  'Exports',
  'Backups',
] as const;
