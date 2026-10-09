// server/tls.js
// Certificado propio (autofirmado) para servir LumaMap por HTTPS en la red local.
// Los navegadores de los móviles solo dejan usar la cámara en páginas seguras
// (https): así el móvil puede ser una cámara más del programa. Sin dependencias:
// clave EC P-256 de Node y el certificado X.509 escrito a mano en DER.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ---------------- DER mínimo ---------------- */
const len = (n) => n < 128 ? Buffer.from([n]) : (() => { const b = []; while (n) { b.unshift(n & 255); n >>>= 8; } return Buffer.from([0x80 | b.length, ...b]); })();
const tlv = (tag, body) => Buffer.concat([Buffer.from([tag]), len(body.length), body]);
const seq = (...xs) => tlv(0x30, Buffer.concat(xs));
const set = (...xs) => tlv(0x31, Buffer.concat(xs));
const ctx = (n, body) => tlv(0xa0 + n, body);
const int = (b) => tlv(0x02, b[0] & 0x80 ? Buffer.concat([Buffer.from([0]), b]) : b);
const utf8 = (s) => tlv(0x0c, Buffer.from(s, "utf8"));
const octet = (b) => tlv(0x04, b);
const bits = (b) => tlv(0x03, Buffer.concat([Buffer.from([0]), b]));
function oid(s) {
  const p = s.split(".").map(Number), out = [p[0] * 40 + p[1]];
  for (const v of p.slice(2)) { const b = [v & 127]; let x = v >>> 7; while (x) { b.unshift((x & 127) | 128); x >>>= 7; } out.push(...b); }
  return tlv(0x06, Buffer.from(out));
}
function time(d) {
  // UTCTime hasta 2049 (AAMMDDHHMMSSZ).
  const z = (n) => String(n).padStart(2, "0");
  return tlv(0x17, Buffer.from(`${z(d.getUTCFullYear() % 100)}${z(d.getUTCMonth() + 1)}${z(d.getUTCDate())}${z(d.getUTCHours())}${z(d.getUTCMinutes())}${z(d.getUTCSeconds())}Z`));
}
const ipBytes = (ip) => Buffer.from(ip.split(".").map(Number));

/** IPv4 de este equipo en la red local (Wi-Fi, cable, USB del móvil…). */
export function localIPs() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces()))
    for (const a of addrs || []) if ((a.family === "IPv4" || a.family === 4) && !a.internal) out.push({ name, address: a.address });
  return out;
}

/** Crea un certificado autofirmado nuevo: { cert, key } en PEM. */
export function makeCertificate({ name = "LumaMap", ips = localIPs().map(i => i.address), days = 397 } = {}) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const ecdsaSha256 = seq(oid("1.2.840.10045.4.3.2"));
  const cn = seq(set(seq(oid("2.5.4.3"), utf8(name))));
  const serial = crypto.randomBytes(16); serial[0] &= 0x7f; serial[0] |= 0x01;
  const now = new Date(Date.now() - 60_000), until = new Date(now.getTime() + days * 86400_000);
  // Nombres alternativos: localhost, 127.0.0.1 y las IP de la red local.
  const alt = seq(tlv(0x82, Buffer.from("localhost")), ...["127.0.0.1", ...ips].filter((x, i, a) => /^\d+\.\d+\.\d+\.\d+$/.test(x) && a.indexOf(x) === i).map(ip => tlv(0x87, ipBytes(ip))));
  const exts = ctx(3, seq(
    seq(oid("2.5.29.17"), octet(alt)),                                   // subjectAltName
    seq(oid("2.5.29.37"), octet(seq(oid("1.3.6.1.5.5.7.3.1")))),         // uso: servidor web
  ));
  const tbs = seq(ctx(0, int(Buffer.from([2]))), int(serial), ecdsaSha256, cn, seq(time(now), time(until)), cn,
    publicKey.export({ type: "spki", format: "der" }), exts);
  const sig = crypto.sign("sha256", tbs, privateKey);
  const der = seq(tbs, ecdsaSha256, bits(sig));
  const pem = (label, b) => `-----BEGIN ${label}-----\n${b.toString("base64").match(/.{1,64}/g).join("\n")}\n-----END ${label}-----\n`;
  return { cert: pem("CERTIFICATE", der), key: privateKey.export({ type: "pkcs8", format: "pem" }) };
}

/**
 * Certificado guardado en la carpeta de datos (se crea la primera vez y se renueva
 * antes de caducar o si cambian las IP del equipo). Devuelve { cert, key }.
 */
export function loadCertificate(dir) {
  const fc = path.join(dir, "lumamap-https.crt"), fk = path.join(dir, "lumamap-https.key");
  const ips = localIPs().map(i => i.address);
  try {
    const cert = fs.readFileSync(fc, "utf8"), key = fs.readFileSync(fk, "utf8");
    const x = new crypto.X509Certificate(cert);
    const fresh = new Date(x.validTo).getTime() - Date.now() > 30 * 86400_000;
    const names = x.subjectAltName || "";
    if (fresh && ips.every(ip => names.includes(ip))) return { cert, key };
  } catch { /* no hay o no sirve: se crea uno nuevo */ }
  const c = makeCertificate({ ips });
  try { fs.writeFileSync(fk, c.key, { mode: 0o600 }); fs.writeFileSync(fc, c.cert); } catch { /* solo lectura: se usa en memoria */ }
  return c;
}
