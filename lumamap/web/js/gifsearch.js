// web/js/gifsearch.js
// Buscar GIF animados en internet y traerlos a la proyección.
//  - Openverse: gratis, sin cuenta, imágenes con licencia libre (hay que citar al autor).
//  - GIPHY: el catálogo grande de GIF; necesita una clave gratuita (developers.giphy.com).
//  - Un enlace pegado (de GIPHY, Tenor u otra web) también vale.
// Las descargas pasan por la app de Windows (proceso principal) o la de Android
// (NetGet.kt) para que CORS no las bloquee; en el navegador se intenta con fetch.

export const GIF_SOURCES = [["openverse", "Openverse (gratis)"], ["giphy", "GIPHY"]];
export const GIF_IDEAS = ["fuego", "humo", "neón", "corazones", "estrellas", "confeti", "fuegos artificiales", "lluvia", "agua", "baile", "brillo", "partículas", "espacio", "fiesta", "flores", "nieve"];
const MAX_BYTES = 16_000_000;

/* ---------------- Descarga (sin CORS en Windows y Android) ---------------- */
const waiting = new Map();
let seq = 0;
function androidGet(N, url, maxBytes) {
  globalThis.__lumaNetGet = (id, r) => { const f = waiting.get(id); waiting.delete(id); f?.(r || { ok: false, error: "network" }); };
  return new Promise((resolve) => {
    const id = ++seq;
    waiting.set(id, resolve);
    try { N.netGet(id, url, maxBytes); } catch { waiting.delete(id); resolve({ ok: false, error: "network" }); }
  });
}
const b64ToBytes = (b64) => { const s = atob(b64 || ""); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; };

/** GET de internet: { ok, status, type, bytes } o { ok:false, error }. */
export async function netGet(url, { maxBytes = MAX_BYTES, fetchImpl } = {}) {
  const D = globalThis.LumaDesktop?.net, N = globalThis.LumaNative;
  if (!fetchImpl && D?.get) {
    const r = await D.get(url, { maxBytes });
    return r.ok ? { ok: true, status: r.status, type: r.type, bytes: new Uint8Array(r.data) } : r;
  }
  if (!fetchImpl && N?.netGet) {
    const r = await androidGet(N, url, maxBytes);
    return r.ok ? { ok: true, status: r.status, type: r.type, bytes: b64ToBytes(r.b64) } : r;
  }
  try {
    const r = await (fetchImpl || fetch)(url, { signal: AbortSignal.timeout(25000) });
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.length > maxBytes) return { ok: false, error: "too-big" };
    return { ok: r.ok, status: r.status, type: r.headers.get("content-type") || "", bytes };
  } catch (e) {
    return { ok: false, error: e?.name === "TimeoutError" ? "timeout" : "blocked" };
  }
}
export async function netJson(url, opts) {
  const r = await netGet(url, { ...opts, maxBytes: 4_000_000 });
  if (!r.ok) throw new GifError(r.status === 401 || r.status === 403 ? "key" : r.error || "http", r.status);
  return JSON.parse(new TextDecoder().decode(r.bytes));
}

export class GifError extends Error {
  constructor(code, status) { super(explain(code, status)); this.code = code; this.status = status; }
}
export function explain(code, status) {
  return {
    key: "La clave de GIPHY no es válida (o se acabó su cupo). Revísala o usa Openverse.",
    timeout: "Internet tardó demasiado. Prueba otra vez.",
    blocked: "Sin conexión a internet, o este navegador no deja descargar de ese sitio. En la app de Windows o Android sí funciona.",
    "too-big": "Ese GIF es demasiado grande (más de 16 MB). Elige otro.",
    "not-https": "Solo se pueden descargar enlaces https://.",
    "not-public": "Ese enlace apunta a este equipo o a la red local; solo se descargan GIF de internet.",
    "not-gif": "Ese enlace no es un GIF animado (ni WebP).",
    "bad-url": "El enlace no es válido.",
  }[code] || (status ? `El servidor respondió con un error (${status}). Prueba otra vez.` : "Sin conexión a internet. Prueba otra vez.");
}

/* ---------------- Búsqueda ---------------- */
export function openverseUrl(q, page = 1) {
  return `https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&extension=gif&page_size=30&page=${page}&mature=false`;
}
export function parseOpenverse(j) {
  return (j?.results || []).filter(r => r?.url).map(r => ({
    id: "ov:" + r.id, title: r.title || "GIF", thumb: r.thumbnail || r.url, url: r.url, w: r.width || 0, h: r.height || 0,
    credit: [r.creator ? "© " + r.creator : "", r.license ? `CC ${String(r.license).toUpperCase()}${r.license_version ? " " + r.license_version : ""}` : ""].filter(Boolean).join(" · "),
    page: r.foreign_landing_url || "",
  }));
}
export function giphyUrl(q, key, page = 1) {
  const off = (page - 1) * 30;
  return q.trim()
    ? `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(key)}&q=${encodeURIComponent(q)}&limit=30&offset=${off}&rating=g&lang=es`
    : `https://api.giphy.com/v1/gifs/trending?api_key=${encodeURIComponent(key)}&limit=30&offset=${off}&rating=g`;
}
export function parseGiphy(j) {
  return (j?.data || []).map(g => {
    const im = g.images || {}, big = im.original && +im.original.size <= MAX_BYTES ? im.original : im.downsized_large || im.downsized || im.original;
    return { id: "gp:" + g.id, title: g.title || "GIF", thumb: im.fixed_width_small?.url || im.fixed_width?.url || im.preview_gif?.url || big?.url, url: big?.url,
      w: +(big?.width || 0), h: +(big?.height || 0), credit: "GIPHY" + (g.username ? " · " + g.username : ""), page: g.url || "" };
  }).filter(g => g.url);
}

/** Busca GIF: { items, more }. */
export async function searchGifs(q, { source = "openverse", key = "", page = 1, fetchImpl } = {}) {
  if (source === "giphy") {
    if (!key) throw new GifError("key");
    const j = await netJson(giphyUrl(q, key, page), { fetchImpl });
    const items = parseGiphy(j);
    return { items, more: (j?.pagination?.total_count || 0) > page * 30 };
  }
  if (!q.trim()) q = "animated";
  const j = await netJson(openverseUrl(q, page), { fetchImpl });
  const items = parseOpenverse(j);
  return { items, more: page < (j?.page_count || 1) };
}

/** Enlace pegado → enlace directo al GIF (las páginas de GIPHY se convierten solas). */
export function directGifUrl(link) {
  const s = String(link || "").trim();
  const m = /giphy\.com\/(?:gifs|stickers)\/(?:[^/?#]*-)?([A-Za-z0-9]{6,})(?:[/?#]|$)/.exec(s);
  if (m) return `https://media.giphy.com/media/${m[1]}/giphy.gif`;
  return s;
}

/** ¿Los bytes son un GIF o un WebP? */
export function sniffAnim(bytes) {
  if (!bytes || bytes.length < 12) return null;
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return "image/gif";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}

/** Descarga un GIF y lo devuelve como archivo listo para importar. */
export async function downloadGif(item, { fetchImpl } = {}) {
  let url = directGifUrl(item.url);
  try { new URL(url); } catch { throw new GifError("bad-url"); }
  if (!/^https:/i.test(url)) throw new GifError("not-https");
  const r = await netGet(url, { fetchImpl });
  if (!r.ok) throw new GifError(r.error || "http", r.status);
  const mime = sniffAnim(r.bytes);
  if (!mime) throw new GifError("not-gif");
  const base = String(item.title || "GIF").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 40) || "GIF";
  return new File([r.bytes], `${base}.${mime === "image/gif" ? "gif" : "webp"}`, { type: mime });
}
