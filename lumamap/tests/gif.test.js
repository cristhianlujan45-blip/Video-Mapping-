// tests/gif.test.js — buscar GIF animados (Openverse / GIPHY / enlace) sin internet.
import { test, report } from "./harness.js";
import assert from "node:assert/strict";
import fs from "node:fs";
const G = await import("../web/js/gifsearch.js");
const gif = new Uint8Array(fs.readFileSync(new URL("./fixtures/anim.gif", import.meta.url)));

console.log("== Buscar GIF animados ==");

/** fetch falso: responde según la URL y apunta lo pedido. */
function fakeFetch(routes) {
  const asked = [];
  const f = async (url) => {
    asked.push(String(url));
    for (const [re, body, status = 200, type = "application/json"] of routes) if (re.test(url)) {
      const bytes = body instanceof Uint8Array ? body : new TextEncoder().encode(JSON.stringify(body));
      return { ok: status < 400, status, headers: { get: (k) => k === "content-type" ? type : null }, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) };
    }
    throw new TypeError("Failed to fetch");
  };
  f.asked = asked;
  return f;
}

await test("Openverse: busca solo GIF, sin contenido adulto, y trae autor y licencia", async () => {
  const f = fakeFetch([[/api\.openverse\.org/, { page_count: 3, results: [
    { id: "a1", title: "Fuego", url: "https://upload.wikimedia.org/fuego.gif", thumbnail: "https://api.openverse.org/v1/images/a1/thumb/", creator: "Ana", license: "by-sa", license_version: "4.0", width: 320, height: 240 },
    { id: "a2", title: "Sin url" }] }]]);
  const r = await G.searchGifs("fuego", { fetchImpl: f });
  assert.match(f.asked[0], /extension=gif/); assert.match(f.asked[0], /mature=false/); assert.match(f.asked[0], /q=fuego/);
  assert.equal(r.items.length, 1); assert.equal(r.more, true);
  assert.equal(r.items[0].credit, "© Ana · CC BY-SA 4.0");
});

await test("GIPHY: sin clave avisa claro; con clave usa el original (o uno más pequeño si pesa mucho)", async () => {
  await assert.rejects(() => G.searchGifs("neon", { source: "giphy", key: "" }), (e) => e.code === "key");
  const f = fakeFetch([[/api\.giphy\.com\/v1\/gifs\/search/, { pagination: { total_count: 100 }, data: [
    { id: "x", title: "Neon", images: { original: { url: "https://media.giphy.com/x.gif", size: "900000", width: "480", height: "270" }, fixed_width_small: { url: "https://media.giphy.com/x_s.gif" } } },
    { id: "y", title: "Enorme", images: { original: { url: "https://media.giphy.com/y.gif", size: "40000000" }, downsized_large: { url: "https://media.giphy.com/y_d.gif", width: "400", height: "300" } } }] }]]);
  const r = await G.searchGifs("neon", { source: "giphy", key: "K", fetchImpl: f });
  assert.match(f.asked[0], /api_key=K/); assert.match(f.asked[0], /rating=g/);
  assert.deepEqual(r.items.map(i => i.url), ["https://media.giphy.com/x.gif", "https://media.giphy.com/y_d.gif"]);
  const bad = fakeFetch([[/giphy/, { message: "Invalid key" }, 401]]);
  await assert.rejects(() => G.searchGifs("neon", { source: "giphy", key: "mala", fetchImpl: bad }), (e) => e.code === "key" && /clave de GIPHY/.test(e.message));
});

await test("enlaces: una página de GIPHY se convierte en el GIF; solo se descargan GIF/WebP de verdad", async () => {
  assert.equal(G.directGifUrl("https://giphy.com/gifs/party-confetti-3o7abKhOpu0NwenH3O"), "https://media.giphy.com/media/3o7abKhOpu0NwenH3O/giphy.gif");
  assert.equal(G.sniffAnim(gif), "image/gif");
  const f = fakeFetch([[/ok\.gif/, gif, 200, "image/gif"], [/page\.html/, new TextEncoder().encode("<html>hola</html>"), 200, "text/html"]]);
  const file = await G.downloadGif({ url: "https://example.org/ok.gif", title: "Mi: GIF?" }, { fetchImpl: f });
  assert.equal(file.type, "image/gif"); assert.equal(file.name, "Mi GIF.gif"); assert.equal(file.size, gif.length);
  await assert.rejects(() => G.downloadGif({ url: "https://example.org/page.html" }, { fetchImpl: f }), (e) => e.code === "not-gif");
  await assert.rejects(() => G.downloadGif({ url: "http://example.org/ok.gif" }, { fetchImpl: f }), (e) => e.code === "not-https");
});

await test("sin internet: mensaje claro, nunca un error raro", async () => {
  const f = fakeFetch([]);
  await assert.rejects(() => G.searchGifs("fuego", { fetchImpl: f }), (e) => e instanceof G.GifError && /internet/.test(e.message));
});

await test("Windows y Android: la descarga pasa por la app (sin CORS)", async () => {
  globalThis.LumaDesktop = { net: { get: async (url) => ({ ok: true, status: 200, type: "image/gif", data: gif, url }) } };
  let r = await G.netGet("https://example.org/a.gif");
  assert.equal(r.ok, true); assert.equal(r.bytes.length, gif.length);
  delete globalThis.LumaDesktop;
  const b64 = Buffer.from(gif).toString("base64");
  globalThis.LumaNative = { netGet(id, url, max) { assert.ok(max <= 16_000_000); setTimeout(() => globalThis.__lumaNetGet(id, { ok: true, status: 200, type: "image/gif", b64 }), 1); } };
  r = await G.netGet("https://example.org/a.gif");
  assert.equal(r.ok, true); assert.equal(G.sniffAnim(r.bytes), "image/gif");
  globalThis.LumaNative = { netGet(id) { setTimeout(() => globalThis.__lumaNetGet(id, { ok: false, error: "not-public" }), 1); } };
  await assert.rejects(() => G.downloadGif({ url: "https://router.local/x.gif" }), (e) => e.code === "not-public");
  delete globalThis.LumaNative;
});

await test("Windows (proceso principal): solo https y solo internet, también tras redirecciones", async () => {
  const { createRequire } = await import("node:module");
  const N = createRequire(import.meta.url)("../desktop/net.js");
  for (const ip of ["127.0.0.1", "10.0.0.5", "192.168.1.20", "172.20.1.1", "169.254.1.1", "::1", "fd00::1", "fe80::1", "::ffff:192.168.0.1", "0.0.0.0"]) assert.equal(N.privateIp(ip), true, ip);
  for (const ip of ["8.8.8.8", "151.101.1.1", "2606:4700::1111"]) assert.equal(N.privateIp(ip), false, ip);
  assert.equal((await N.get("http://example.org/a.gif")).error, "not-https");
  assert.equal((await N.get("https://127.0.0.1/a.gif")).error, "not-public");
  assert.equal((await N.get("https://[::1]/a.gif")).error, "not-public");
  assert.equal((await N.get("nada")).error, "bad-url");
});

report();
