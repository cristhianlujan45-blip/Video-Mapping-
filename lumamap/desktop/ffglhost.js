// desktop/ffglhost.js
// Plugins FFGL de Resolume (.dll) en la app de Windows. Cada plugin abierto corre en su
// propio proceso «ffglhost» (ffgl/ffglhost.cpp): si el plugin se cuelga o se cae, muere
// solo ese proceso y LumaMap sigue; se reinicia solo (con un límite) y se avisa.
// Sin Electron: lo usan main.js y las pruebas (tests/ffgl.test.js).
const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");

const EXE = process.platform === "win32" ? "ffglhost.exe" : "ffglhost";
const PLUGIN_EXT = process.platform === "win32" ? ".dll" : ".so";
const MAX_SIDE = 4096;

/** Ruta del anfitrión: junto a la app (fuera del .asar) o el compilado en ffgl/bin. */
function findHost(base = __dirname) {
  const unpacked = base.replace(/app\.asar(?=[\\/]|$)/, "app.asar.unpacked");
  const cands = [process.env.LUMAMAP_FFGLHOST, path.join(unpacked, "ffgl", EXE), path.join(unpacked, "ffgl", "bin", EXE)];
  return cands.find(f => f && fs.existsSync(f)) || null;
}

/** Explica en castellano por qué terminó el proceso del plugin. */
function exitReason(code, signal, stderr) {
  if (/FFGLHOST_CRASH/.test(stderr)) return "El plugin se cerró de golpe (fallo interno del plugin)";
  if (signal === "SIGKILL" || signal === "SIGTERM") return "Se cerró el proceso del plugin";
  if (code === 3221225477 || code === -1073741819) return "El plugin se cerró de golpe (acceso a memoria no válido)";
  if (code === 3221225781 || code === -1073741515) return "Falta un archivo .dll que necesita el anfitrión o el plugin";
  return `El proceso del plugin terminó (código ${code ?? signal})`;
}

/* ------------------------------------------------ Conexión con un proceso */
class HostConn {
  /** cmd: [ejecutable, ...argumentos]. */
  constructor(cmd, { env, onExit } = {}) {
    this.proc = spawn(cmd[0], cmd.slice(1), { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env: { ...process.env, ...env } });
    this.pending = [];
    this.chunks = []; this.have = 0;
    this.stderr = "";
    this.dead = null;
    this.proc.stdout.on("data", (d) => { this.chunks.push(d); this.have += d.length; this._parse(); });
    this.proc.stderr.on("data", (d) => { this.stderr = (this.stderr + d.toString()).slice(-4000); });
    this.proc.stdin.on("error", () => {});   // tubería rota: lo resuelve el «exit»
    this.proc.on("error", (e) => this._die(e.code === "ENOENT" ? "No se encuentra el anfitrión de plugins (ffglhost)" : e.message, null));
    // «exit» puede llegar antes que los últimos datos de stdout/stderr (p. ej. la respuesta de error
    // de un plugin roto justo antes de cerrarse): se espera a que las dos tuberías terminen de leerse
    // (con un tope, por si un proceso hijo del plugin las dejara abiertas) y luego se explica el cierre.
    let ended = 0, onEnded = null;
    const ends = () => new Promise(r => { if (ended >= 2) r(); else onEnded = r; });
    for (const st of [this.proc.stdout, this.proc.stderr]) st.on("close", () => { if (++ended >= 2) onEnded?.(); });
    this.proc.on("exit", (code, signal) => {
      Promise.race([ends(), new Promise(r => setTimeout(r, 500))]).then(() => {
        this._die(exitReason(code, signal, this.stderr), code ?? signal);
        onExit?.(code, signal);
      });
    });
  }
  _take(n) {
    const all = this.chunks.length === 1 ? this.chunks[0] : Buffer.concat(this.chunks, this.have);
    const out = all.subarray(0, n), rest = all.subarray(n);
    this.chunks = rest.length ? [rest] : []; this.have = rest.length;
    return out;
  }
  _parse() {
    while (this.have >= 5) {
      const head = this.chunks[0].length >= 5 ? this.chunks[0] : Buffer.concat(this.chunks, this.have);
      const len = head.readUInt32LE(1);
      if (this.have < 5 + len) return;
      const msg = this._take(5 + len);
      const p = this.pending.shift();
      if (!p) continue;
      clearTimeout(p.timer);
      const data = msg.subarray(5);
      if (msg[0] === 0x4b) p.resolve(data);   // 'K'
      else {
        let m = "Error del plugin";
        try { m = JSON.parse(data.toString("utf8")).error || m; } catch {}
        p.reject(Object.assign(new Error(m), { code: "PLUGIN_ERROR" }));
      }
    }
  }
  _die(reason, code) {
    if (this.dead) return;
    this.dead = { reason, code };
    for (const p of this.pending.splice(0)) { clearTimeout(p.timer); p.reject(Object.assign(new Error(reason), { code: "CRASHED" })); }
  }
  /** Envía un comando y espera su respuesta (en orden). Si tarda demasiado, el plugin se da por colgado. */
  request(cmd, payload = Buffer.alloc(0), timeoutMs = 5000) {
    if (this.dead) return Promise.reject(Object.assign(new Error(this.dead.reason), { code: "CRASHED" }));
    return new Promise((resolve, reject) => {
      const p = { resolve, reject, timer: setTimeout(() => {
        this._die(`El plugin no responde (más de ${Math.round(timeoutMs / 1000)} s): se ha cerrado`, "timeout");
        this.kill();
      }, timeoutMs) };
      this.pending.push(p);
      const head = Buffer.alloc(5);
      head[0] = cmd.charCodeAt(0);
      head.writeUInt32LE(payload.length, 1);
      this.proc.stdin.write(head);
      if (payload.length) this.proc.stdin.write(payload);
    });
  }
  kill() { try { this.proc.kill("SIGKILL"); } catch {} }
}

/* ------------------------------------------------------------- Un plugin */
/**
 * Un plugin abierto. API: FFGLPlugin.open(ruta) → plugin (con .info);
 * plugin.render({ width, height, time, bpm, barPhase, params, input }) → { width, height, data (RGBA, fila 0 arriba) };
 * plugin.close().
 */
class FFGLPlugin {
  constructor(file, opts) {
    this.file = file;
    this.opts = { openTimeout: 15000, renderTimeout: 5000, maxRestarts: 3, restartWindowMs: 60000, ...opts };
    this.values = {};       // índice → valor enviado (número o texto)
    this.restarts = [];
    this.conn = null;
    this.info = null;
    this.closed = false;
    this.lastError = "";
  }
  static async open(file, opts = {}) {
    const p = new FFGLPlugin(file, opts);
    await p._start();
    return p;
  }
  get alive() { return !!this.conn && !this.conn.dead; }
  get pid() { return this.conn?.proc.pid; }

  async _start() {
    const host = this.opts.host || findHost();
    if (!host) throw Object.assign(new Error("No está el anfitrión de plugins FFGL (ffglhost) en esta instalación"), { code: "NO_HOST" });
    const cmd = this.opts.prefix ? [...this.opts.prefix, host] : [host];
    this.conn = new HostConn(cmd, { env: this.opts.env, onExit: () => this.opts.onExit?.(this) });
    let data;
    try { data = await this.conn.request("O", Buffer.from(this.opts.mapPath ? this.opts.mapPath(this.file) : this.file, "utf8"), this.opts.openTimeout); }
    catch (e) { this.conn.kill(); throw e; }
    this.info = JSON.parse(data.toString("utf8"));
    // Tras un reinicio: se vuelven a poner los valores que tenía.
    const prev = this.values; this.values = {};
    if (Object.keys(prev).length) await this.setParams(prev);
    return this.info;
  }

  /** Reinicia el proceso si se cayó (como mucho maxRestarts veces por minuto). */
  async _ensure() {
    if (this.closed) throw Object.assign(new Error("El plugin está cerrado"), { code: "CLOSED" });
    if (this.alive) return;
    const now = Date.now();
    this.restarts = this.restarts.filter(t => now - t < this.opts.restartWindowMs);
    if (this.restarts.length >= this.opts.maxRestarts)
      throw Object.assign(new Error(`El plugin se ha caído ${this.restarts.length} veces seguidas: se ha desactivado (${this.conn?.dead?.reason || "?"})`), { code: "GAVE_UP" });
    this.restarts.push(now);
    this.conn?.kill();
    await this._start();
  }

  /** Cambia parámetros: { índice: número | texto }. Solo se envían los que cambian. */
  async setParams(params = {}) {
    for (const [k, v] of Object.entries(params || {})) {
      const i = +k, p = this.info?.params?.[i];
      if (!p || !Number.isInteger(i) || this.values[i] === v) continue;
      if (p.type === "text" || p.type === "file") {
        const s = Buffer.from(String(v ?? ""), "utf8");
        const b = Buffer.alloc(4 + s.length); b.writeUInt32LE(i, 0); s.copy(b, 4);
        await this.conn.request("S", b, this.opts.renderTimeout);
      } else {
        const n = Number(v);
        if (!Number.isFinite(n)) continue;
        const b = Buffer.alloc(8); b.writeUInt32LE(i, 0); b.writeFloatLE(n, 4);
        await this.conn.request("P", b, this.opts.renderTimeout);
      }
      this.values[i] = v;
    }
  }

  /** Dibuja un fotograma. input (efectos): RGBA width×height (Buffer/Uint8Array), fila 0 arriba. */
  async render({ width, height, time = 0, bpm = 120, barPhase = 0, beat, params, input } = {}) {
    width = Math.round(width); height = Math.round(height);
    if (!(width >= 1 && height >= 1 && width <= MAX_SIDE && height <= MAX_SIDE)) throw Object.assign(new Error("Tamaño de imagen no válido"), { code: "BAD_SIZE" });
    if (input && input.length !== width * height * 4) throw Object.assign(new Error("La imagen de entrada no coincide con el tamaño"), { code: "BAD_SIZE" });
    if (beat && typeof beat === "object") { bpm = beat.bpm ?? bpm; barPhase = beat.phase ?? beat.barPhase ?? barPhase; }
    await this._ensure();
    try {
      if (params) await this.setParams(params);
      const head = Buffer.alloc(28);
      head.writeUInt32LE(width, 0); head.writeUInt32LE(height, 4);
      head.writeDoubleLE(Number(time) || 0, 8); head.writeFloatLE(Number(bpm) || 0, 16); head.writeFloatLE(Number(barPhase) || 0, 20);
      head.writeUInt32LE(input ? input.length : 0, 24);
      const payload = input ? Buffer.concat([head, Buffer.from(input.buffer, input.byteOffset, input.length)]) : head;
      const data = await this.conn.request("R", payload, this.opts.renderTimeout);
      const w = data.readUInt32LE(0), h = data.readUInt32LE(4);
      this.lastError = "";
      return { width: w, height: h, data: data.subarray(8, 8 + w * h * 4) };
    } catch (e) { this.lastError = e.message; throw e; }
  }

  /** Información con los valores actuales. */
  async refreshInfo() { await this._ensure(); this.info = JSON.parse((await this.conn.request("I")).toString("utf8")); return this.info; }

  async close() {
    if (this.closed) return;
    this.closed = true;
    const c = this.conn;
    if (!c || c.dead) return;
    const t = setTimeout(() => c.kill(), 2000);
    try { await c.request("Q", undefined, 2000); } catch {}
    clearTimeout(t);
    setTimeout(() => { if (!c.dead) c.kill(); }, 500).unref?.();
  }
}

const openPlugin = (file, opts) => FFGLPlugin.open(file, opts);

/* ------------------------------------------------------- Buscar plugins */
/** Carpetas donde Resolume guarda los plugins FFGL (solo las que existen). */
function defaultDirs({ documents, commonFiles = process.env.CommonProgramFiles } = {}) {
  const out = [];
  if (documents) {
    for (const app of ["Resolume Arena", "Resolume Avenue", "Resolume Arena 7", "Resolume Avenue 7", "Resolume Arena 6", "Resolume Avenue 6", "Resolume Wire"])
      for (const sub of ["Extra Effects", "Extra Sources", "FFGL Plugins"]) out.push(path.join(documents, app, sub));
  }
  if (commonFiles) out.push(path.join(commonFiles, "FreeFrame"), path.join(commonFiles, "FFGL"));
  return out.filter(d => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
}

/** Arquitectura de un .dll de Windows (cabecera PE) o de un .so (ELF). */
function binaryArch(file) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const b = Buffer.alloc(4096);
    const n = fs.readSync(fd, b, 0, 4096, 0);
    if (n >= 64 && b[0] === 0x4d && b[1] === 0x5a) {   // «MZ»
      const pe = b.readUInt32LE(0x3c);
      let h = b;
      if (pe + 6 > n) { h = Buffer.alloc(6); fs.readSync(fd, h, 0, 6, pe); return peMachine(h, 0); }
      return peMachine(h, pe);
    }
    if (n >= 20 && b.readUInt32BE(0) === 0x7f454c46) {   // ELF
      const m = b.readUInt16LE(18);
      return m === 0x3e ? "x64" : m === 0xb7 ? "arm64" : m === 0x03 ? "x86" : "otro";
    }
    return "desconocido";
  } catch { return "desconocido"; }
  finally { if (fd !== undefined) try { fs.closeSync(fd); } catch {} }
}
function peMachine(b, pe) {
  if (b.readUInt32LE(pe) !== 0x00004550) return "desconocido";
  const m = b.readUInt16LE(pe + 4);
  return m === 0x8664 ? "x64" : m === 0x14c ? "x86" : m === 0xaa64 ? "arm64" : "otro";
}

/** Archivos de plugin dentro de una carpeta (y subcarpetas, hasta 3 niveles). */
function listPluginFiles(dir, depth = 0, out = [], ext = PLUGIN_EXT) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const f = path.join(dir, e.name);
    if (e.isDirectory() && depth < 3) listPluginFiles(f, depth + 1, out, ext);
    else if (e.isFile() && e.name.toLowerCase().endsWith(ext)) out.push(f);
    if (out.length >= 500) break;
  }
  return out;
}

/**
 * Busca plugins en las carpetas y los prueba uno a uno (cada uno en su proceso).
 * Devuelve [{ file, dir, ok, error?, arch, info? }]. cache: Map ruta → resultado (por tamaño y fecha).
 */
async function scanPlugins(dirs, { cache = new Map(), concurrency = 3, onProgress, ext = PLUGIN_EXT, ...opts } = {}) {
  const files = [];
  for (const d of dirs) for (const f of listPluginFiles(d, 0, [], ext)) if (!files.some(x => x.file === f)) files.push({ file: f, dir: d });
  const results = new Array(files.length);
  let next = 0, done = 0;
  const probe = async ({ file, dir }) => {
    let st; try { st = fs.statSync(file); } catch { return { file, dir, ok: false, error: "No se puede leer el archivo" }; }
    const sig = `${st.size}:${st.mtimeMs}`;
    const c = cache.get(file);
    if (c && c.sig === sig) return c.result;
    const arch = binaryArch(file);
    let result;
    if (arch === "x86") result = { file, dir, arch, ok: false, error: "Plugin de 32 bits: no sirve en LumaMap (es de 64 bits). Busca la versión de 64 bits." };
    else if (arch === "arm64" || arch === "otro") result = { file, dir, arch, ok: false, error: "Plugin para otro tipo de procesador" };
    else if (arch === "desconocido") result = { file, dir, arch, ok: false, error: "No es un archivo de plugin válido" };
    else {
      try {
        const p = await FFGLPlugin.open(file, { openTimeout: 10000, ...opts });
        result = { file, dir, arch, ok: true, info: p.info };
        await p.close();
      } catch (e) { result = { file, dir, arch, ok: false, error: e.message }; }
    }
    cache.set(file, { sig, result });
    return result;
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, files.length)) }, async () => {
    while (next < files.length) {
      const i = next++;
      results[i] = await probe(files[i]);
      onProgress?.(++done, files.length);
    }
  }));
  return results;
}

/** ¿Está la ruta dentro de alguna de las carpetas de plugins? (solo se cargan plugins de ahí). */
function insideDirs(file, dirs) {
  const f = path.resolve(file);
  const norm = (p) => process.platform === "win32" ? p.toLowerCase() : p;
  return f.toLowerCase().endsWith(PLUGIN_EXT) && dirs.some(d => norm(f).startsWith(norm(path.resolve(d)) + path.sep));
}

module.exports = { FFGLPlugin, openPlugin, findHost, defaultDirs, scanPlugins, listPluginFiles, binaryArch, insideDirs, PLUGIN_EXT, MAX_SIDE };
