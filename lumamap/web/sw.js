// web/sw.js — caché offline de la app (PWA). Red primero para recibir
// actualizaciones; si no hay conexión, se sirve la copia guardada.
const CACHE = "lumamap-v6";
const SHELL = ["./", "index.html", "output.html", "controller.html", "css/app.css", "icon.svg", "manifest.webmanifest",
  "js/editor.js", "js/panels.js", "js/ui.js", "js/icons.js", "js/model.js", "js/math.js", "js/history.js", "js/store.js",
  "js/renderer.js", "js/compose.js", "js/drawing.js", "js/sources.js", "js/audio.js", "js/link.js", "js/overlay.js",
  "js/output.js", "js/thumbs.js", "js/commands.js", "js/updater.js", "js/automap.js", "js/midi.js", "js/remote.js"];
self.addEventListener("install", e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.includes("/api/")) return;
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request)));
});
