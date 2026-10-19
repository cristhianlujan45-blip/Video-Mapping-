// web/sw.js — caché offline de la app (PWA). Red primero para recibir
// actualizaciones; si no hay conexión, se sirve la copia guardada.
const CACHE = "lumamap-v51";
const SHELL = ["./", "index.html", "output.html", "controller.html", "css/app.css", "icon.svg", "manifest.webmanifest",
  "js/editor.js", "js/panels.js", "js/ui.js", "js/icons.js", "js/model.js", "js/math.js", "js/history.js", "js/store.js",
  "js/renderer.js", "js/compose.js", "js/drawing.js", "js/sources.js", "js/audio.js", "js/link.js", "js/overlay.js",
  "js/output.js", "js/thumbs.js", "js/commands.js", "js/updater.js", "js/automap.js", "js/midi.js", "js/remote.js", "js/body.js",
  "js/params.js", "js/panels-pro.js", "js/dmx.js", "js/dmxproto.js", "js/panels-dmx.js",
  "js/show.js", "js/panels-show.js", "js/ltc-core.js", "js/ltc-worklet.js", "js/panels-3d.js", "js/three3d.js",
  "vendor/three/three.module.min.js", "vendor/three/three.core.min.js", "vendor/three/addons/controls/OrbitControls.js", "vendor/three/addons/controls/TransformControls.js",
  "js/tracking.js", "js/tracking-worker.js", "js/rules.js", "js/panels-tracking.js",
  "js/panels-assistant.js", "js/ai/providers.js", "js/ai/context.js", "js/ai/analyzer.js", "js/ai/actions.js", "js/ai/knowledge.js", "js/ai/commands.js", "js/ai/showplan.js", "js/ai/hardware.js", "js/ai/academy.js", "js/lightfx.js", "js/interactive.js", "js/panels-interactive.js", "js/dmxnet.js", "js/rdm.js", "js/usbdmx.js", "js/dmx-android.js", "js/timers.js", "js/panels-timers.js", "js/gamepad.js", "js/panels-controllers.js", "js/gifsearch.js", "js/panels-gif.js", "js/hologram.js", "js/panels-hologram.js", "js/gen3d.js", "js/render3d.js", "js/panels-create3d.js", "js/fx-pro.js", "js/ai/songanalysis.js", "js/experiences.js", "js/midi-android.js", "js/osc-web.js", "js/qr.js", "js/phonecam.js", "js/panels-phonecam.js", "phonecam.html", "js/phonecam-send.js", "js/phonecam-enc.js", "js/phoneusb-ui.js", "js/convqueue.js", "js/panels-library.js", "js/isf.js", "js/plugins.js", "js/plugins-bundled.js", "js/plugins-viral.js", "js/plugins-pro.js", "js/plugins-loops3d.js", "js/plugins-toons.js", "js/panels-plugins.js", "js/ffgl.js", "js/panels-ffgl.js", "js/autovj.js", "js/panels-vj.js", "js/lfo.js", "js/transport.js", "js/deck.js", "js/panels-deck.js", "js/panels-signals.js", "js/panels-nodes.js", "js/panels-camfx.js", "js/tutorial.js", "js/calib3d.js", "js/panels-3dcalib.js", "js/panels-timeline.js", "js/featured.js", "js/netout.js", "js/gpuguard.js", "js/graycode.js", "js/whatsnew.js", "js/objscan.js", "js/panels-3dauto.js", "js/exportshow.js", "js/mp4mux.js", "js/panels-export.js", "js/mypanel.js", "js/panels-mypanel.js", "js/coach.js", "js/objscan-worker.js", "js/td/expr.js", "js/td/ops.js", "js/td/graph.js", "js/td/engine.js", "js/td/params-net.js", "js/td/examples.js", "js/td/particles.js", "js/td/gpuparticles.js", "js/td/viewer3d.js", "js/td/anim.js", "js/td/animeditor.js", "js/td/py.js", "js/td/pyapi.js", "js/panels-network.js", "vendor/three/addons/utils/BufferGeometryUtils.js"];
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
