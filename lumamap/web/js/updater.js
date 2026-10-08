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
    return D.installUpdate(remote.windows.url);
  }
  if (N?.installUpdate) {
    window.__lumaUpdateProgress = (p) => onProgress(p);
    N.installUpdate(remote.android.url);
    return Promise.resolve();
  }
  location.reload();
  return Promise.resolve();
}
