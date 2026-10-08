import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Plain-text rotating log in %APPDATA%/LUJAN MAPPING Studio/logs.
 * Writes are buffered and flushed asynchronously so logging never blocks the main loop.
 */
class Logger {
  private stream: fs.WriteStream | null = null;
  readonly dir: string;

  constructor() {
    this.dir = path.join(app.getPath('userData'), 'logs');
  }

  init() {
    fs.mkdirSync(this.dir, { recursive: true });
    const file = path.join(this.dir, 'main.log');
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > 5 * 1024 * 1024) {
        for (let i = 4; i >= 1; i--) {
          const from = `${file}.${i}`;
          if (fs.existsSync(from)) fs.renameSync(from, `${file}.${i + 1}`);
        }
        fs.renameSync(file, `${file}.1`);
      }
    } catch {
      /* rotation is best effort */
    }
    this.stream = fs.createWriteStream(file, { flags: 'a' });
    this.info('log', `--- ${app.getName()} ${app.getVersion()} started (pid ${process.pid}) ---`);
  }

  write(level: string, scope: string, msg: string, extra?: unknown) {
    const line = `${new Date().toISOString()} [${level}] [${scope}] ${msg}${extra !== undefined ? ' ' + safe(extra) : ''}\n`;
    if (level === 'ERROR') process.stderr.write(line);
    else if (!app.isPackaged) process.stdout.write(line);
    this.stream?.write(line);
  }

  info(scope: string, msg: string, extra?: unknown) {
    this.write('INFO', scope, msg, extra);
  }

  warn(scope: string, msg: string, extra?: unknown) {
    this.write('WARN', scope, msg, extra);
  }

  error(scope: string, msg: string, extra?: unknown) {
    this.write('ERROR', scope, msg, extra);
  }

  close() {
    this.stream?.end();
    this.stream = null;
  }
}

function safe(v: unknown): string {
  if (v instanceof Error) return `${v.message}\n${v.stack ?? ''}`;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export const log = new Logger();
