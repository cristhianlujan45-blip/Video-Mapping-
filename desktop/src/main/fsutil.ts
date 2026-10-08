import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

/**
 * Atomic write: write to a temp file in the same folder, fsync, then rename over the
 * target. A crash or power loss leaves either the old or the new file, never a torn one.
 */
export async function writeFileAtomic(file: string, data: string | Uint8Array) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const fh = await fsp.open(tmp, 'w');
  try {
    await fh.writeFile(data);
    await fh.sync();
  } finally {
    await fh.close();
  }
  await fsp.rename(tmp, file);
}

export function readJsonSync<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export async function exists(p: string) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Deletes the oldest files matching a prefix in `dir`, keeping `keep`. */
export async function pruneFiles(dir: string, prefix: string, keep: number) {
  let names: string[];
  try {
    names = (await fsp.readdir(dir)).filter((n) => n.startsWith(prefix));
  } catch {
    return;
  }
  const stats = await Promise.all(names.map(async (n) => ({ n, t: (await fsp.stat(path.join(dir, n))).mtimeMs })));
  stats.sort((a, b) => b.t - a.t);
  for (const s of stats.slice(keep)) await fsp.rm(path.join(dir, s.n), { force: true });
}

export function sanitizeFileName(name: string) {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().slice(0, 120) || 'proyecto';
}
