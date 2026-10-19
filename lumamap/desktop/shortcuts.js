// desktop/shortcuts.js — accesos directos de Windows garantizados.
// El instalador los crea, pero si por lo que sea faltan (se borraron, el instalador
// se cortó, Windows los limpió…), LumaMap los vuelve a crear al abrirse:
//  - menú Inicio: siempre;
//  - escritorio: salvo que en el instalador se desmarcara la casilla (se respeta).
const fs = require("node:fs");
const path = require("node:path");

const APP_ID = "com.lumamap.desktop";

/** ¿LumaMap está instalado (y no se ejecuta desde una carpeta suelta o de desarrollo)? */
function isInstalled(exe) {
  try { return fs.readdirSync(path.dirname(exe)).some(f => /^Uninstall .*\.exe$/i.test(f)); } catch { return false; }
}

/**
 * Crea los accesos directos que falten. pref: "0" = el usuario no quiere el del
 * escritorio; cualquier otra cosa (o nada) = sí. Devuelve la lista de los creados.
 */
function ensureShortcuts({ exe, desktopDir, startMenuDir, pref = "", name = "LumaMap", writeLink, exists = fs.existsSync }) {
  const made = [];
  const opts = { target: exe, cwd: path.dirname(exe), icon: exe, iconIndex: 0, appUserModelId: APP_ID, description: "LumaMap · video mapping" };
  const want = [[startMenuDir, true], [desktopDir, pref !== "0"]];
  for (const [dir, on] of want) {
    if (!on || !dir) continue;
    const lnk = path.join(dir, name + ".lnk");
    if (exists(lnk)) continue;
    try { if (writeLink(lnk, "create", opts)) made.push(lnk); } catch {}
  }
  return made;
}

/** Preferencia de la casilla del instalador (HKCU\Software\LumaMap · DesktopShortcut). */
function readPref(execFile = require("node:child_process").execFile) {
  return new Promise((resolve) => execFile("reg", ["query", "HKCU\\Software\\LumaMap", "/v", "DesktopShortcut"], { windowsHide: true, timeout: 10000 }, (err, out) => {
    const m = !err && /DesktopShortcut\s+REG_SZ\s+(\S*)/i.exec(String(out || ""));
    resolve(m ? m[1] : "");
  }));
}

module.exports = { ensureShortcuts, isInstalled, readPref, APP_ID };
