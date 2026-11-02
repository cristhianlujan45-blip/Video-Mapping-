// web/js/visuals.js
// «🎛 Mis visuales» (gestor de presets): guarda lo que tiene una superficie —contenido, efectos,
// opacidad, mezcla, transporte del video y lo que se mueve solo (Señales, pistas)— con su
// miniatura, en carpetas, para cambiar de visual con un toque (o con MIDI/teclado: siguiente /
// anterior). Se guardan en este equipo (no en el proyecto: valen para todos tus shows) y se pueden
// exportar e importar como un archivo .json (una carpeta entera de una vez).
// Lo de aquí no toca la pantalla (se prueba en Node).

export const VIS_KEY = "lumamap:visuals";
export const MAX_VISUALS = 300;
const LOOK_KEYS = ["source", "fit", "opacity", "blend", "volume", "rate", "play", "fx", "audio"];
const clean = (s, d, n = 60) => String(s ?? d).replace(/[<>]/g, "").trim().slice(0, n) || d;
let seq = 0;
const vid = () => "vis" + Date.now().toString(36) + (seq++).toString(36);

/** Una señal de una superficie se guarda sin su id («surf/@/fx/zoom») para valer en cualquiera. */
export const relParam = (param, surfId) => String(param).replace(new RegExp(`^surf/(?:${surfId.replace(/[^\w-]/g, "")}|sel)/`), "surf/@/");
export const absParam = (param, surfId) => String(param).replace(/^surf\/@\//, `surf/${surfId}/`);

export function normalizeVisual(v) {
  if (!v || typeof v !== "object" || !v.look || typeof v.look !== "object" || !v.look.source) return null;
  const look = {};
  for (const k of LOOK_KEYS) if (v.look[k] !== undefined) look[k] = JSON.parse(JSON.stringify(v.look[k]));
  const thumb = typeof v.thumb === "string" && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v.thumb) && v.thumb.length < 60000 ? v.thumb : "";
  const lfos = Array.isArray(v.lfos) ? v.lfos.filter(l => l && /^surf\/@\//.test(l.param || "")).slice(0, 40).map(l => ({ ...l })) : [];
  return { id: /^[\w-]{1,40}$/.test(v.id || "") ? v.id : vid(), name: clean(v.name, "Visual"), folder: clean(v.folder, "General", 40), at: +v.at || Date.now(), thumb, look, lfos, media: Array.isArray(v.media) ? v.media.slice(0, 8).map(m => clean(m, "", 120)).filter(Boolean) : [] };
}

/** Crea un visual a partir del look de una superficie y sus Señales. mediaName(id) → nombre del archivo. */
export function makeVisual({ look, surfId, lfos = [], name, folder, thumb = "", mediaName = () => "" }) {
  const mine = lfos.filter(l => new RegExp(`^surf/(?:${surfId}|sel)/`).test(l.param)).map(l => ({ ...l, id: undefined, param: relParam(l.param, surfId) }));
  const ids = [look.source?.mediaId, look.next?.source?.mediaId].filter(Boolean);
  return normalizeVisual({ name, folder, thumb, at: Date.now(), look, lfos: mine, media: ids.map(mediaName).filter(Boolean) });
}

/** Lo que hay que cambiar para poner un visual en una superficie: { look, lfos } (lfos ya con su id). */
export function applyPlan(v, surfId, baseLook, newId = () => "lfo" + Math.random().toString(36).slice(2, 10)) {
  const look = { ...JSON.parse(JSON.stringify(baseLook)) };
  for (const k of LOOK_KEYS) if (v.look[k] !== undefined) look[k] = JSON.parse(JSON.stringify(v.look[k]));
  look.next = null;
  const lfos = v.lfos.map(l => ({ ...l, id: newId(), param: absParam(l.param, surfId) }));
  return { look, lfos };
}

export function loadVisuals(storage = globalThis.localStorage) {
  try { const a = JSON.parse(storage?.getItem(VIS_KEY) || "[]"); return Array.isArray(a) ? a.map(normalizeVisual).filter(Boolean) : []; } catch { return []; }
}
/** Guarda la lista. Lanza un error claro si no cabe (miniaturas grandes, muchos visuales). */
export function saveVisuals(list, storage = globalThis.localStorage) {
  try { storage.setItem(VIS_KEY, JSON.stringify(list.slice(0, MAX_VISUALS))); }
  catch { throw new Error("No cabe más en este equipo: borra o exporta algunos visuales"); }
}
export const folders = (list) => [...new Set(list.map(v => v.folder))].sort((a, b) => a.localeCompare(b, "es"));

/** Archivo .json con unos visuales (una carpeta o todos). */
export const exportVisuals = (list) => JSON.stringify({ format: "lumamap-visuals", version: 1, exportedAt: new Date().toISOString(), visuals: list }, null, 1);
/** Lee un archivo exportado (o una lista suelta). Devuelve los visuales válidos, con ids nuevos si chocan. */
export function importVisuals(text, have = []) {
  let j;
  try { j = JSON.parse(text); } catch { throw new Error("El archivo no es un JSON válido"); }
  const arr = Array.isArray(j) ? j : j?.format === "lumamap-visuals" ? j.visuals : j?.look ? [j] : null;
  if (!Array.isArray(arr)) throw new Error("El archivo no tiene visuales de LumaMap");
  const ids = new Set(have.map(v => v.id));
  return arr.map(normalizeVisual).filter(Boolean).map(v => (ids.has(v.id) ? { ...v, id: vid() } : v));
}
/** El siguiente visual (dir = 1 / -1) dentro de una carpeta (o de todos), dando la vuelta. */
export function stepVisual(list, currentId, dir = 1, folder = "") {
  const pool = folder ? list.filter(v => v.folder === folder) : list;
  if (!pool.length) return null;
  const i = pool.findIndex(v => v.id === currentId);
  return pool[(i < 0 ? (dir > 0 ? 0 : pool.length - 1) : (i + dir + pool.length) % pool.length)];
}
