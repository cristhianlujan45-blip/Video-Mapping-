// web/js/updater.js
// Actualizaciones: cada compilación de GitHub Actions publica version.json junto
// al instalador de Windows y al APK. La app lo consulta al abrirse (y con el
// botón «Buscar actualizaciones») y, si hay una versión nueva, la instala con un
// toque: Windows se reinstala solo; Android abre la pantalla de instalación.
export const RELEASE_BASE = "https://github.com/cristhianlujan45-blip/Video-Mapping-/releases/download/lumamap-latest";
export const VERSION_URL = RELEASE_BASE + "/version.json";
export const RELEASES_PAGE = "https://github.com/cristhianlujan45-blip/Video-Mapping-/releases/tag/lumamap-latest";

/** Plataforma y versión instalada. build = número de compilación (crece en cada cambio). */
export function currentVersion() {
  const D = window.LumaDesktop, N = window.LumaNative;
  if (D?.version) return { platform: "windows", version: D.version, build: buildOf(D.version) };
  if (N?.appVersion) {
    const [version, code] = String(N.appVersion()).split("|");
    return { platform: "android", version, build: (+code || 0) - 1000 };
  }
  return { platform: "web", version: "web", build: 0 };
}

export function buildOf(version) {
  const m = String(version || "").match(/(\d+)$/);
  return m ? +m[1] : 0;
}

/** ¿La versión publicada es más nueva que la instalada? */
export function isNewer(remote, current) {
  return !!remote && current.platform !== "web" && (remote.build || 0) > (current.build || 0);
}

/** Lee version.json (la parte nativa hace la descarga: sin problemas de CORS). */
export async function fetchLatest() {
  const D = window.LumaDesktop, N = window.LumaNative;
  if (D?.checkUpdate) return D.checkUpdate(VERSION_URL);
  if (N?.checkUpdate) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { delete window.__lumaUpdateInfo; reject(new Error("Sin respuesta (¿hay internet?)")); }, 20000);
      window.__lumaUpdateInfo = (json) => {
        clearTimeout(t); delete window.__lumaUpdateInfo;
        json ? resolve(typeof json === "string" ? JSON.parse(json) : json) : reject(new Error("No se pudo consultar (¿hay internet?)"));
      };
      N.checkUpdate(VERSION_URL);
    });
  }
  const r = await fetch(VERSION_URL, { cache: "no-store" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

/** Descarga e instala la versión nueva. onProgress(0..1). */
export function install(remote, onProgress) {
  const D = window.LumaDesktop, N = window.LumaNative;
  if (D?.installUpdate) {
    D.onUpdateProgress?.((p) => onProgress(p));
    return D.installUpdate(remote.windows.url, { version: remote.windows.version || remote.version, sha256: remote.windows.sha256 || "", size: remote.windows.size || 0 });
  }
  if (N?.installUpdate) {
    window.__lumaUpdateProgress = (p) => onProgress(p);
    N.installUpdate(remote.android.url, remote.build | 0);
    return Promise.resolve();
  }
  location.reload();
  return Promise.resolve();
}

/* ---------------- Actualizar sola ---------------- */
// La versión nueva se descarga en segundo plano sin preguntar. Windows la instala al cerrar
// LumaMap (o ya, con «Instalar ahora»); Android al salir de la app (desde Android 12, sin
// preguntar después de la primera vez). Nunca durante un show. En el Mac y en el navegador no.
const AUTO_KEY = "lumamap:autoUpdate";
export function autoUpdateOn() { try { return localStorage.getItem(AUTO_KEY) !== "0"; } catch { return true; } }
export function setAutoUpdate(on) {
  try { localStorage.setItem(AUTO_KEY, on ? "1" : "0"); } catch {}
  try { window.LumaDesktop?.setAutoUpdate?.(!!on); } catch {}
  try { window.LumaNative?.setAutoUpdate?.(!!on); } catch {}
}
/** ¿Esta app puede descargar sola e instalar sin reinstalar a mano? */
export function canAutoUpdate(cur = currentVersion()) {
  if (cur.platform === "windows") return !!window.LumaDesktop?.downloadUpdate && window.LumaDesktop.platform === "win32";   // el Mac no (sin firma de Apple)
  if (cur.platform === "android") return !!window.LumaNative?.downloadUpdate;
  return false;
}
/** Descarga la versión nueva en segundo plano. Resuelve { version } cuando está lista. */
export function downloadInBackground(remote) {
  const D = window.LumaDesktop, N = window.LumaNative;
  if (D?.downloadUpdate) {
    const w = remote.windows || {};
    return D.downloadUpdate(w.url, { version: w.version || remote.version, sha256: w.sha256 || "", size: w.size || 0 }).then(() => ({ version: remote.version }));
  }
  if (N?.downloadUpdate) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { delete window.__lumaUpdateDownloaded; reject(new Error("La descarga tarda demasiado")); }, 30 * 60 * 1000);
      window.__lumaUpdateDownloaded = () => { clearTimeout(t); delete window.__lumaUpdateDownloaded; resolve({ version: remote.version }); };
      window.__lumaUpdateFailed = (msg) => { clearTimeout(t); delete window.__lumaUpdateDownloaded; reject(new Error(msg || "error")); };
      N.downloadUpdate(remote.android.url, remote.build | 0);
    });
  }
  return Promise.reject(new Error("Esta versión no se actualiza sola"));
}
/** ¿Hay una versión ya descargada esperando? → { version } o null. */
export async function pendingUpdate() {
  const D = window.LumaDesktop, N = window.LumaNative;
  if (D?.pendingUpdate) return (await D.pendingUpdate().catch(() => null)) || null;
  if (N?.pendingUpdate) { const b = +N.pendingUpdate() || 0; return b > 0 ? { version: "2.3." + b, build: b } : null; }
  return null;
}
/** Instala ya lo descargado (Windows cierra, instala y vuelve a abrir; Android puede pedir confirmar). */
export function installPending() {
  const D = window.LumaDesktop, N = window.LumaNative;
  if (D?.installPendingUpdate) return D.installPendingUpdate();
  if (N?.installPendingUpdate) return Promise.resolve(N.installPendingUpdate());
  return Promise.reject(new Error("No hay nada descargado"));
}
/** Android: ¿se instalará sin preguntar? (Android 12+ y LumaMap ya instaló la app alguna vez). */
export const silentOnAndroid = () => { try { return !!window.LumaNative?.updateSilent?.(); } catch { return false; } };
