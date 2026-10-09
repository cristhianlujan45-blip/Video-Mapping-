// Optimizador automático de video (como Alley de Resolume, pero sin hacer nada):
// al importar, analiza el archivo y, solo si hace falta, lo convierte a un
// H.264 ligero a la resolución de la composición, pensado para reproducirse
// fluido en bucle (fotogramas clave frecuentes, sin B-frames, «fastdecode»).
// Usa el codificador por hardware de la tarjeta gráfica (NVIDIA, Intel, AMD)
// si existe; si no, x264 «ultrafast». Si el archivo ya es adecuado no se toca
// (importación instantánea); si solo el contenedor es raro, se re-empaqueta
// sin recodificar (segundos).
const { execFile, spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

function ffmpegPath() {
  let p = require("ffmpeg-static");
  // Dentro del instalador el binario vive fuera del .asar.
  return p ? p.replace("app.asar", "app.asar.unpacked") : null;
}

const GOOD_CODECS = new Set(["h264", "vp8", "vp9"]);
const GOOD_CONTAINERS = new Set([".mp4", ".m4v", ".webm"]);

/** Lee códec, tamaño, fps, duración y bitrate de la salida de `ffmpeg -i`. */
function parseProbe(text) {
  const info = { duration: 0, bitrate: 0, codec: null, width: 0, height: 0, fps: 0, audio: false };
  const d = text.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  if (d) info.duration = +d[1] * 3600 + +d[2] * 60 + +d[3];
  const b = text.match(/bitrate:\s*(\d+)\s*kb\/s/);
  if (b) info.bitrate = +b[1];
  const v = text.match(/Stream #\S+.*?Video:\s*([a-z0-9_]+)[^\n]*?(\d{2,5})x(\d{2,5})/i);
  if (v) { info.codec = v[1].toLowerCase(); info.width = +v[2]; info.height = +v[3]; }
  const f = text.match(/([\d.]+)\s*fps/);
  if (f) info.fps = +f[1];
  info.audio = /Stream #\S+.*?Audio:/.test(text);
  return info;
}

function probe(file) {
  return new Promise((resolve) => {
    execFile(ffmpegPath(), ["-hide_banner", "-i", file], { maxBuffer: 4 << 20 }, (_e, _o, stderr) => resolve(parseProbe(String(stderr))));
  });
}

/**
 * ¿Qué hacer con este video? target = {width, height} de la composición.
 * → { action: "keep" | "remux" | "encode", reason }
 */
function decide(info, ext, target) {
  if (!info.codec) return { action: "keep", reason: "no es un video reconocible" };
  const tw = Math.max(640, target.width || 1920), th = Math.max(360, target.height || 1080);
  const big = info.width > tw * 1.05 && info.height > th * 1.05;          // mayor que la salida en ambos ejes
  if (!GOOD_CODECS.has(info.codec)) return { action: "encode", reason: `códec ${info.codec.toUpperCase()} pesado o no compatible` };
  if (big) return { action: "encode", reason: `${info.width}×${info.height} es más grande que la salida` };
  if (info.bitrate > 30000) return { action: "encode", reason: `bitrate muy alto (${Math.round(info.bitrate / 1000)} Mbps)` };
  if (info.fps > 61) return { action: "encode", reason: `${Math.round(info.fps)} fps` };
  if (!GOOD_CONTAINERS.has(ext)) return { action: "remux", reason: `contenedor ${ext}` };
  return { action: "keep", reason: "ya es ligero" };
}

/* ---------------- Codificadores ---------------- */

let encodersCache = null;
function hardwareEncoders() {
  if (encodersCache) return encodersCache;
  encodersCache = new Promise((resolve) => {
    execFile(ffmpegPath(), ["-hide_banner", "-encoders"], { maxBuffer: 4 << 20 }, (_e, out) => {
      const list = [];
      for (const name of process.platform === "darwin" ? ["h264_videotoolbox"] : ["h264_nvenc", "h264_qsv", "h264_amf"])
        if (String(out).includes(name)) list.push(name);
      resolve(list);
    });
  });
  return encodersCache;
}

/** Codificadores por hardware que de verdad funcionan en este equipo (prueba de 1 fotograma). */
let usableCache = null;
function usableEncoders() {
  if (usableCache) return usableCache;
  usableCache = hardwareEncoders().then((list) => Promise.all(list.map((enc) => new Promise((resolve) => {
    execFile(ffmpegPath(), ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=black:s=256x144:d=0.2", "-frames:v", "1", "-c:v", enc, "-f", "null", "-"],
      { timeout: 15000 }, (err) => resolve(err ? null : enc));
  })))).then((r) => r.filter(Boolean));
  return usableCache;
}

function encoderArgs(enc) {
  const gop = ["-g", "30", "-bf", "0"];
  switch (enc) {
    case "h264_nvenc": return ["-c:v", "h264_nvenc", "-preset", "p2", "-rc", "vbr", "-cq", "21", "-b:v", "0", ...gop];
    case "h264_qsv": return ["-c:v", "h264_qsv", "-preset", "veryfast", "-global_quality", "22", ...gop];
    case "h264_amf": return ["-c:v", "h264_amf", "-quality", "speed", "-rc", "cqp", "-qp_i", "20", "-qp_p", "22", ...gop];
    case "h264_videotoolbox": return ["-c:v", "h264_videotoolbox", "-q:v", "65", ...gop];
    default: return ["-c:v", "libx264", "-preset", "ultrafast", "-tune", "fastdecode", "-crf", "20", ...gop];
  }
}

// ffmpeg en marcha: se cierran al salir de LumaMap (si no, retienen archivos de
// la carpeta de instalación y el instalador no puede actualizar).
const running = new Set();
function killAll() { for (const p of running) { try { p.kill("SIGKILL"); } catch {} } running.clear(); }

function run(args, duration, onProgress) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath(), args, { windowsHide: true });
    running.add(p);
    p.on("exit", () => running.delete(p));
    let err = "", buf = "";
    p.stdout.on("data", (d) => {
      buf += d;
      const m = buf.match(/out_time_us=(\d+)/g);
      if (m && duration) onProgress?.(Math.min(0.99, +m[m.length - 1].split("=")[1] / 1e6 / duration));
      if (buf.length > 4096) buf = buf.slice(-1024);
    });
    p.stderr.on("data", (d) => { err = (err + d).slice(-4000); });
    p.on("error", reject);
    p.on("close", (code) => code === 0 ? resolve() : reject(new Error(err.split("\n").filter(Boolean).slice(-3).join(" "))));
  });
}

/**
 * Optimiza un video si hace falta. Devuelve {action, reason, file, info, ms}.
 * file = ruta del archivo a usar (el original si action === "keep").
 */
async function optimize(input, target, outDir, onProgress) {
  const t0 = Date.now();
  const ext = path.extname(input).toLowerCase();
  const info = await probe(input);
  const plan = decide(info, ext, target);
  if (plan.action === "keep") return { ...plan, file: input, info, ms: Date.now() - t0 };
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `${path.basename(input, ext).replace(/[^\w\-]+/g, "_").slice(0, 60)}-${Date.now().toString(36)}.mp4`);
  const audio = info.audio ? ["-map", "0:a:0?", "-c:a", "aac", "-b:a", "160k"] : ["-an"];
  const base = ["-y", "-hide_banner", "-nostats", "-progress", "pipe:1", "-i", input, "-map", "0:v:0", ...audio, "-movflags", "+faststart"];
  if (plan.action === "remux") {
    try {
      await run([...base, "-c:v", "copy", out], info.duration, onProgress);
      return { ...plan, file: out, info, ms: Date.now() - t0, encoder: "copia" };
    } catch { plan.action = "encode"; plan.reason += " (re-empaquetado falló)"; }
  }
  const tw = Math.max(640, target.width || 1920), th = Math.max(360, target.height || 1080);
  const vf = ["-vf", `scale=w='min(iw,${tw})':h='min(ih,${th})':force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuv420p` + (info.fps > 61 ? ",fps=60" : "")];
  // Primero el hardware de la tarjeta gráfica; si falla (no hay GPU compatible), x264.
  const tries = [...(await hardwareEncoders()), "libx264"];
  let lastErr = null;
  for (const enc of tries) {
    try {
      await run([...base, ...vf, ...encoderArgs(enc), out], info.duration, onProgress);
      return { ...plan, file: out, info, ms: Date.now() - t0, encoder: enc };
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("No se pudo convertir el video");
}

module.exports = { optimize, probe, decide, parseProbe, ffmpegPath, usableEncoders, killAll };
