// desktop/net.js — descargas de internet para la página (buscar GIF animados).
// La página no puede leer imágenes de otros sitios por CORS; las baja el proceso
// principal con reglas estrictas (igual que NetGet.kt en Android):
//  - solo https y solo internet (nunca este equipo ni la red local), también
//    después de cada redirección;
//  - tamaño y tiempo máximos.
const dns = require("node:dns").promises;
const net = require("node:net");

/** ¿IP de este equipo, de la red local o reservada? */
function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const s = ip.toLowerCase();
  if (s.startsWith("::ffff:")) return privateIp(s.slice(7));
  return s === "::" || s === "::1" || /^f[cd]/.test(s) || /^fe[89ab]/.test(s);
}

async function publicHttps(u) {
  if (u.protocol !== "https:") return "not-https";
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  return addrs.some(a => privateIp(a.address)) ? "not-public" : "";
}

/** Descarga: { ok, status, type, data: Uint8Array } o { ok:false, error }. */
async function get(url, { maxBytes = 30_000_000, timeout = 25000 } = {}) {
  let u;
  try { u = new URL(String(url)); } catch { return { ok: false, error: "bad-url" }; }
  const limit = Math.max(1, Math.min(30_000_000, +maxBytes || 30_000_000));
  const signal = AbortSignal.timeout(Math.max(2000, Math.min(60000, +timeout || 25000)));
  try {
    for (let hop = 0; hop < 5; hop++) {
      const bad = await publicHttps(u);
      if (bad) return { ok: false, error: bad };
      const r = await fetch(u, { redirect: "manual", signal, headers: { "user-agent": "LumaMap" } });
      if (r.status >= 300 && r.status < 400 && r.headers.get("location")) { u = new URL(r.headers.get("location"), u); continue; }
      if (+r.headers.get("content-length") > limit) return { ok: false, error: "too-big" };
      const chunks = [];
      let n = 0;
      for await (const c of r.body || []) {
        n += c.length;
        if (n > limit) return { ok: false, error: "too-big" };
        chunks.push(c);
      }
      return { ok: r.ok, status: r.status, type: r.headers.get("content-type") || "", data: new Uint8Array(Buffer.concat(chunks)) };
    }
    return { ok: false, error: "redirects" };
  } catch (err) {
    return { ok: false, error: err?.name === "TimeoutError" ? "timeout" : (err?.cause?.code || err?.code || "network") };
  }
}

// Electron solo se carga al registrar el canal (así las pruebas pueden usar get() sin Electron).
function setup() { require("electron").ipcMain.handle("net:get", (_e, url, opts) => get(url, opts)); }

module.exports = { setup, get, privateIp };
