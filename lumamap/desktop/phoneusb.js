// desktop/phoneusb.js
// Móvil Android por cable USB como cámara, sin tocar nada en el PC:
//  1. Windows ve el móvil enchufado (pnputil) y se reconoce la marca por su número USB.
//  2. Con la «depuración USB» del móvil activada (una sola vez), adb lo ve. Si este PC no
//     tiene adb, se descarga el oficial de Google (comprobando su huella SHA-1 publicada
//     por Google, o su firma digital) en la carpeta de LumaMap.
//  3. «adb reverse» hace que en el móvil «localhost:PUERTO» sea LumaMap del PC (por el
//     cable, sin Wi-Fi), y se abre allí la página de cámara, que empieza sola.
// El móvil manda la imagen por el WebSocket (phonecam-send.js, modo ?usb=1).
// Sin Electron: se prueba con un adb simulado (tests/phoneusb.test.js).
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");

/** Números de fabricante USB (VID) de los móviles Android más comunes. */
const PHONE_VIDS = {
  "2717": "Xiaomi", "18D1": "Google", "22B8": "Motorola", "339B": "Honor", "22D9": "OPPO / realme", "2D95": "vivo",
  "2A70": "OnePlus", "1004": "LG", "0FCE": "Sony", "0BB4": "HTC", "2A45": "Meizu", "29A9": "Nothing", "2E04": "Nokia",
  "1BBB": "Alcatel / TCL", "1EBF": "Coolpad", "2B4C": "ZUK",
  // Marcas que también hacen otras cosas USB (impresoras, módems, bases): solo si parece un móvil.
  "04E8": "Samsung", "12D1": "Huawei", "19D2": "ZTE", "17EF": "Lenovo", "0E8D": "MediaTek",
};
const SHARED_VIDS = new Set(["04E8", "12D1", "19D2", "17EF", "0E8D"]);
const LOOKS_PHONE = /\b(mtp|adb|android|phone|galaxy|portable|wpd|móvil|teléfono|redmi|xiaomi|pixel)\b/i;

const run = (cmd, args, opts = {}) => new Promise((resolve) => execFile(cmd, args, { windowsHide: true, timeout: 15000, maxBuffer: 8 << 20, ...opts },
  (err, out, errOut) => resolve({ err, out: String(out || ""), errOut: String(errOut || "") })));

/**
 * Salida de «pnputil /enum-devices /connected» → móviles enchufados [{ vid, brand, name, id }].
 * Cada aparato es un bloque «Instance ID: USB\VID_2717&PID_FF48\…» + «Device Description: …».
 */
function parsePnp(text) {
  const out = new Map();
  const field = (block, re) => new RegExp(`^\\s*(?:${re})[^:\\r\\n]*:\\s*(.+)$`, "im").exec(block)?.[1]?.trim() || "";
  for (const block of String(text).split(/\r?\n\s*\r?\n/)) {
    const id = field(block, "Instance ID|Id\\. de instancia|ID de instancia");
    if (!/^USB\\/i.test(id)) continue;
    const vid = /VID_([0-9A-F]{4})/i.exec(id)?.[1]?.toUpperCase();
    if (!vid || !PHONE_VIDS[vid]) continue;
    const name = field(block, "Device Description|Descripción del dispositivo");
    const cls = field(block, "Class Name|Nombre de clase");
    if (SHARED_VIDS.has(vid) && !LOOKS_PHONE.test(name + " " + cls)) continue;
    // Un móvil sale varias veces (el aparato y cada interfaz MTP/ADB): uno por VID+PID, con el nombre del aparato.
    const key = /VID_[0-9A-F]{4}&PID_[0-9A-F]{4}/i.exec(id)[0].toUpperCase();
    const iface = /&MI_\d+/i.test(id), prev = out.get(key);
    if (!prev || (prev.iface && !iface)) out.set(key, { vid, brand: PHONE_VIDS[vid], name, id, iface });
  }
  return [...out.values()].map(({ iface, ...d }) => d);
}

/** Salida de «adb devices -l» → [{ serial, state, model }] (state: device | unauthorized | offline). */
function parseAdbDevices(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^(\S+)\s+(device|unauthorized|offline|authorizing|no permissions|recovery|sideload)\b(.*)$/.exec(line.trim());
    if (!m || line.startsWith("List of")) continue;
    out.push({ serial: m[1], state: m[2], model: /model:(\S+)/.exec(m[3])?.[1]?.replace(/_/g, " ") || "" });
  }
  return out;
}

/**
 * Busca en el manifiesto oficial de Google (repository2-3.xml) el zip de platform-tools
 * para Windows y su huella SHA-1: { url, sha1, size }.
 */
function parseRepository(xml, os = "windows") {
  const pkgs = String(xml).split(/<remotePackage\b/).slice(1).filter(b => /^\s*path="platform-tools"/.test(b));
  // El canal estable (channel-0) primero.
  pkgs.sort((a, b) => (/channelRef ref="channel-0"/.test(b) ? 1 : 0) - (/channelRef ref="channel-0"/.test(a) ? 1 : 0));
  for (const pkg of pkgs) {
    for (const arch of pkg.split(/<archive>/).slice(1)) {
      if (!new RegExp(`<host-os>${os}</host-os>`).test(arch)) continue;
      const sha1 = /<checksum(?:\s+type="sha1")?>\s*([0-9a-f]{40})\s*<\/checksum>/i.exec(arch)?.[1];
      const url = /<url>\s*([^<\s]+)\s*<\/url>/.exec(arch)?.[1];
      const size = Number(/<size>(\d+)<\/size>/.exec(arch)?.[1]) || 0;
      if (sha1 && url) return { url: /^https?:/.test(url) ? url : "https://dl.google.com/android/repository/" + url, sha1: sha1.toLowerCase(), size };
    }
  }
  return null;
}

/** adb que ya tenga este PC (de LumaMap, de Android Studio o en el PATH). */
function findAdb({ dataDir, env = process.env, platform = process.platform, exists = fs.existsSync } = {}) {
  if (env.LUMAMAP_ADB) return env.LUMAMAP_ADB;
  const exe = platform === "win32" ? "adb.exe" : "adb";
  const dirs = [dataDir && path.join(dataDir, "platform-tools"),
    env.ANDROID_HOME && path.join(env.ANDROID_HOME, "platform-tools"), env.ANDROID_SDK_ROOT && path.join(env.ANDROID_SDK_ROOT, "platform-tools"),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Android", "Sdk", "platform-tools"),
    ...String(env.PATH || env.Path || "").split(path.delimiter)].filter(Boolean);
  for (const d of dirs) { const f = path.join(d, exe); if (exists(f)) return f; }
  return null;
}

/**
 * Descarga adb (platform-tools oficial de Google) a dataDir/platform-tools.
 * Se comprueba con la huella SHA-1 que publica Google; si no se pudo leer el manifiesto,
 * se exige la firma digital de Google en adb.exe.
 */
async function downloadAdb({ dataDir, onProgress = () => {}, log = () => {}, fetchImpl = fetch, signatureOf } = {}) {
  if (process.platform !== "win32") return { ok: false, error: "only-windows" };
  let info = null;
  try { const r = await fetchImpl("https://dl.google.com/android/repository/repository2-3.xml"); if (r.ok) info = parseRepository(await r.text()); } catch {}
  const url = info?.url || "https://dl.google.com/android/repository/platform-tools-latest-windows.zip";
  const zip = path.join(dataDir, "platform-tools.zip");
  fs.mkdirSync(dataDir, { recursive: true });
  try {
    const r = await fetchImpl(url);
    if (!r.ok || !r.body) return { ok: false, error: "HTTP " + r.status };
    const total = Number(r.headers.get("content-length")) || info?.size || 0;
    const hash = crypto.createHash("sha1"), out = fs.createWriteStream(zip);
    let done = 0, last = 0;
    for await (const chunk of r.body) {
      hash.update(chunk); done += chunk.length;
      if (!out.write(chunk)) await new Promise(res => out.once("drain", res));
      if (Date.now() - last > 250) { last = Date.now(); onProgress({ completed: done, total }); }
    }
    await new Promise((res, rej) => out.end((e) => e ? rej(e) : res()));
    const sha1 = hash.digest("hex");
    if (info && sha1 !== info.sha1) { fs.rmSync(zip, { force: true }); log("warn", `adb: huella distinta (${sha1})`); return { ok: false, error: "bad-checksum" }; }
    const dest = path.join(dataDir, "platform-tools");
    fs.rmSync(dest, { recursive: true, force: true });
    // tar.exe viene con Windows 10/11 y abre .zip; si no, PowerShell.
    let x = await run("tar.exe", ["-xf", zip, "-C", dataDir], { timeout: 120000 });
    if (x.err) x = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${dataDir.replace(/'/g, "''")}' -Force`], { timeout: 180000 });
    fs.rmSync(zip, { force: true });
    const adb = path.join(dest, "adb.exe");
    if (!fs.existsSync(adb)) return { ok: false, error: "extract-failed" };
    if (!info) {
      const sig = signatureOf ? await signatureOf(adb) : { valid: false, subject: "" };
      log("info", `adb: firma ${sig.valid ? "válida" : "NO válida"} (${sig.subject})`);
      if (!sig.valid || !/google/i.test(sig.subject)) { fs.rmSync(dest, { recursive: true, force: true }); return { ok: false, error: "bad-signature" }; }
    }
    log("info", `adb descargado (${done} bytes, sha1 ${sha1})`);
    return { ok: true, adb };
  } catch (e) {
    try { fs.rmSync(zip, { force: true }); } catch {}
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * Vigilante del cable USB. send(estado) recibe cada cambio:
 * { adb: "ok"|"missing"|"downloading"|"error", progress?, plugged: [{brand,name}], phones: [{serial, model, state, error?}] }
 * state del móvil: "unauthorized" (aceptar en el móvil), "opening" (abriendo la cámara),
 * "open" (página abierta), "error".
 */
function createPhoneUsb({ dataDir, getPort, getPin = () => "", send = () => {}, log = () => {}, platform = process.platform,
  scanUsb, adbPath, download, every = 3000 } = {}) {
  let adb = adbPath || null, timer = null, busy = false, downloading = null, adbState = "missing", progress = null, lastJson = "";
  const opened = new Map();    // serie -> { state, model, error }
  let plugged = [];
  const scan = scanUsb || (async () => {
    if (platform !== "win32") return [];
    const r = await run("pnputil.exe", ["/enum-devices", "/connected"], { timeout: 10000 });
    return r.err ? [] : parsePnp(r.out);
  });
  const adbRun = (args, opts) => run(adb, args, opts);
  const emit = () => {
    const st = { adb: adbState, progress, plugged, phones: [...opened.entries()].map(([serial, p]) => ({ serial, model: p.model || "", state: p.state, error: p.error || "" })) };
    const j = JSON.stringify(st);
    if (j !== lastJson) { lastJson = j; send(st); }
  };

  async function ensureAdb() {
    if (adb) return adb;
    adb = findAdb({ dataDir });
    if (adb) return adb;
    if (!download) return null;
    if (!downloading) {
      adbState = "downloading"; progress = null; emit();
      downloading = download({ dataDir, onProgress: (p) => { progress = p; emit(); }, log }).then((r) => {
        downloading = null;
        if (r.ok) { adb = r.adb; adbState = "ok"; } else { adbState = "error"; log("warn", "adb: " + r.error); }
        progress = null; emit();
      });
    }
    return null;
  }

  /** Abre la cámara en el móvil (por el cable). */
  async function connect(serial) {
    const port = getPort();
    if (!adb || !port) return { ok: false, error: "no-adb" };
    const p = opened.get(serial) || {};
    p.state = "opening"; p.error = ""; p.at = Date.now(); opened.set(serial, p); emit();
    const s = ["-s", serial];
    if (!p.model) {
      const m = await adbRun([...s, "shell", "getprop", "ro.product.marketname"]);
      const m2 = m.out.trim() ? m : await adbRun([...s, "shell", "getprop", "ro.product.model"]);
      p.model = m2.out.trim().slice(0, 40);
    }
    const rev = await adbRun([...s, "reverse", `tcp:${port}`, `tcp:${port}`]);
    if (rev.err) { p.state = "error"; p.error = (rev.errOut || rev.err.message).trim().slice(0, 200); emit(); return { ok: false, error: p.error }; }
    const pin = getPin();
    const url = `http://localhost:${port}/phonecam.html?auto=1&usb=1` + (pin ? `&pin=${encodeURIComponent(pin)}` : "") + (p.model ? `&name=${encodeURIComponent(p.model)}` : "");
    await adbRun([...s, "shell", "input", "keyevent", "KEYCODE_WAKEUP"]);
    // La URL va entre comillas simples: el móvil la recibe por su intérprete de órdenes.
    const view = ["shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", `'${url}'`];
    let r = await adbRun([...s, ...view, "-p", "com.android.chrome"]);
    if (r.err || /Error|does not exist|unable to resolve/i.test(r.out + r.errOut)) r = await adbRun([...s, ...view]);
    if (r.err || /^Error/m.test(r.out + r.errOut)) { p.state = "error"; p.error = (r.errOut || r.out || r.err?.message || "").trim().slice(0, 200); emit(); return { ok: false, error: p.error }; }
    p.state = "open"; emit();
    log("info", `Móvil por USB: cámara abierta en ${p.model || serial}`);
    return { ok: true };
  }

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      plugged = (await scan().catch(() => [])).map(d => ({ brand: d.brand, name: d.name }));
      if (!adb && plugged.length) await ensureAdb();
      else if (!adb) adb = findAdb({ dataDir });
      let devs = [];
      if (adb) {
        adbState = "ok";
        const r = await adbRun(["devices", "-l"], { timeout: 20000 });
        devs = r.err ? [] : parseAdbDevices(r.out);
      }
      const seen = new Set(devs.map(d => d.serial));
      for (const k of [...opened.keys()]) if (!seen.has(k)) opened.delete(k);   // desenchufado: al volver se abre otra vez
      for (const d of devs) {
        const p = opened.get(d.serial);
        // Recién enchufado (o recién aceptado en el móvil): se abre la cámara. Si falló, se reintenta cada 15 s.
        if (d.state === "device") { if (!p || p.state === "unauthorized" || (p.state === "error" && Date.now() - (p.at || 0) > 15000)) await connect(d.serial); }
        else if (d.state === "unauthorized" || d.state === "authorizing") opened.set(d.serial, { ...(p || {}), model: p?.model || d.model, state: "unauthorized" });
      }
      emit();
    } catch (e) { log("warn", "Móvil por USB: " + (e?.message || e)); }
    finally { busy = false; }
  }

  return {
    start() { if (!timer) { tick(); timer = setInterval(tick, every); } },
    stop() {
      clearInterval(timer); timer = null;
      if (!adb) return;
      for (const k of opened.keys()) run(adb, ["-s", k, "reverse", "--remove-all"]).catch(() => {});
      // El adb que trajo LumaMap se cierra con LumaMap (el de Android Studio se deja como estaba).
      if (dataDir && adb.startsWith(dataDir)) run(adb, ["kill-server"]).catch(() => {});
    },
    tick, connect,
    /** Volver a abrir la cámara en todos los móviles conectados (botón «Reintentar»). */
    async retry() { for (const [k, p] of opened) if (p.state !== "unauthorized") await connect(k); emit(); return { ok: true }; },
    status: () => JSON.parse(lastJson || "null"),
  };
}

module.exports = { parsePnp, parseAdbDevices, parseRepository, findAdb, downloadAdb, createPhoneUsb, PHONE_VIDS };
