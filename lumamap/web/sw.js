// web/sw.js — caché offline del shell de la aplicación
const CACHE = "lumap-v1";
const SHELL = ["/", "/index.html", "/css/app.css", "/js/app.js", "/js/renderer.js",
  "/js/project.js", "/js/store.js", "/js/remote.js", "/js/ui.js", "/output.html",
  "/js/output.js", "/controller.html", "/shared/homography.js", "/manifest.webmanifest"];
self.addEventListener("install", e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))));
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", e => {
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
