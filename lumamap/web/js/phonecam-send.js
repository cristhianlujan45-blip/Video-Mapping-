// web/js/phonecam-send.js
// Página del móvil (phonecam.html): abre la cámara y la manda al programa por
// WebRTC en la red local. El servidor de LumaMap solo pasa la oferta/respuesta.
// Si se corta (Wi-Fi, el programa se cierra…), vuelve a conectar sola.
// Por cable USB (el programa la abre sola con ?usb=1, a través de adb) WebRTC no puede
// llegar al PC: entonces manda fotos JPEG seguidas por el mismo WebSocket. Si por Wi-Fi
// WebRTC no conecta (redes que aíslan a los aparatos), también cambia a ese modo solo.
const $ = (id) => document.getElementById(id);
const qs = new URLSearchParams(location.search);
const store = { get: (k, d = "") => { try { return localStorage.getItem("lumamap:cam:" + k) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem("lumamap:cam:" + k, v); } catch {} } };
const QUALITY = { 480: [854, 480, 1.5e6, 640], 720: [1280, 720, 4e6, 800], 1080: [1920, 1080, 8e6, 1280] };
const USB = qs.get("usb") === "1";

// Identificador estable: al volver a abrir la página sigue siendo «la misma cámara».
let camId = store.get("id");
if (!camId) { camId = Math.random().toString(36).slice(2, 10); store.set("id", camId); }
$("pin").value = qs.get("pin") || store.get("pin");
$("facing").value = store.get("facing", "environment");
$("quality").value = store.get("quality", "720");
$("name").value = store.get("name") || qs.get("name") || (/iPhone/.test(navigator.userAgent) ? "iPhone" : /iPad/.test(navigator.userAgent) ? "iPad" : "Móvil");
navigator.userAgentData?.getHighEntropyValues?.(["model"]).then(v => { if (v.model && !store.get("name")) $("name").value = v.model; }).catch(() => {});

let stream = null, ws = null, pc = null, running = false, wake = null, retry = 0, offering = false, offeredAt = 0;
let frames = USB, frameTimer = 0, fallbackTimer = 0, sending = false, sent = 0;
/** Fotos enviadas por el WebSocket (para comprobarlo). */
window.__lumaCamSent = () => sent;
const state = (t, kind = "") => { const el = $("state"); el.textContent = t; el.className = kind; };

if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
  state("Esta página necesita abrirse con https:// (el código QR del programa ya la abre así).", "err");
  $("go").disabled = true;
} else state("Pulsa «Empezar» para enviar la cámara al programa.");

async function openCamera() {
  stream?.getTracks().forEach(t => t.stop());
  const [w, h] = QUALITY[$("quality").value] || QUALITY[720];
  stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: $("facing").value }, width: { ideal: w }, height: { ideal: h }, frameRate: { ideal: 30 } } });
  $("preview").srcObject = stream;
}

function connect() {
  if (!running) return;
  try { ws?.close(); } catch {}
  ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws");
  ws.onopen = () => { retry = 0; ws.send(JSON.stringify({ type: "hello", role: "camera", camId, name: $("name").value.trim() || "Móvil", pin: $("pin").value.trim() })); };
  ws.onmessage = async (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type === "auth") {
      if (!m.ok) { state(m.needPin ? "Código (PIN) incorrecto: míralo en el programa (Interactivo → Usar el móvil como cámara)." : "El programa no aceptó la conexión.", "err"); stop(false); return; }
      state("Conectado al programa. Enviando la cámara…");
      if (frames) startFrames();
      else {
        offer();
        // WebRTC que no llega a conectar: se manda por el WebSocket (siempre funciona).
        clearTimeout(fallbackTimer);
        fallbackTimer = setTimeout(() => { if (running && pc?.connectionState !== "connected") { frames = true; try { pc?.close(); } catch {} pc = null; startFrames(); } }, 12000);
      }
    } else if (m.type === "rtc" && m.data && !frames) {
      // El programa (re)abierto pide la imagen. Si ya hay una oferta en marcha, no se cruza otra.
      if (m.data.want === "offer") { const st = pc?.connectionState; if (!(pc && (st === "new" || st === "connecting") && Date.now() - offeredAt < 6000)) offer(); }
      else if (m.data.sdp?.type === "answer" && pc) { try { await pc.setRemoteDescription(m.data.sdp); } catch (e) { state("No se pudo conectar: " + e.message, "err"); } }
    }
  };
  ws.onclose = () => { if (!running) return; state("Sin conexión con el programa. Reintentando…", "err"); setTimeout(connect, Math.min(10000, 1000 * 2 ** retry++)); };
  ws.onerror = () => { try { ws.close(); } catch {} };
}

async function offer() {
  if (!running || !stream || offering || frames) return;
  offering = true; offeredAt = Date.now();
  try { await makeOffer(); }
  catch (e) { if (running) state("No se pudo conectar: " + (e.message || e) + ". Reintentando…", "err"); setTimeout(() => { if (running && pc?.connectionState !== "connected") offer(); }, 2000); }
  finally { offering = false; }
}
async function makeOffer() {
  try { pc?.close(); } catch {}
  const p = pc = new RTCPeerConnection({ iceServers: [] });
  for (const t of stream.getTracks()) {
    const s = p.addTrack(t, stream);
    // Más bits para que la IA vea bien a las personas; si la red flojea, baja la nitidez, no los fotogramas.
    try { const prm = s.getParameters(); prm.encodings = [{ ...(prm.encodings?.[0] || {}), maxBitrate: (QUALITY[$("quality").value] || QUALITY[720])[2] }]; prm.degradationPreference = "maintain-framerate"; await s.setParameters(prm); } catch {}
  }
  p.onconnectionstatechange = () => {
    if (p !== pc) return;
    const s = p.connectionState;
    if (s === "connected") state("✓ Enviando la cámara al programa. Deja esta página abierta.", "ok");
    if (s === "failed") { state("Se cortó el video. Reconectando…", "err"); setTimeout(() => { if (p === pc) offer(); }, 1500); }
  };
  await p.setLocalDescription(await p.createOffer());
  await new Promise((resolve) => {
    if (p.iceGatheringState === "complete") return resolve();
    const to = setTimeout(resolve, 2500);
    p.addEventListener("icegatheringstatechange", () => { if (p.iceGatheringState === "complete") { clearTimeout(to); resolve(); } });
  });
  if (p === pc && ws?.readyState === 1) ws.send(JSON.stringify({ type: "rtc", data: { sdp: p.localDescription } }));
}

/** Fotos JPEG seguidas por el WebSocket (~24 por segundo, sin acumular retraso). */
function startFrames() {
  clearTimeout(frameTimer);
  state(USB ? "✓ Enviando la cámara por el cable USB. Deja esta página abierta." : "✓ Enviando la cámara al programa. Deja esta página abierta.", "ok");
  // El JPEG se codifica en un hilo aparte (phonecam-enc.js): en la página, Chrome espera a que
  // esté libre para codificar y, con la cámara en marcha, puede tardar un segundo por foto.
  const video = $("preview");
  let worker = null, since = 0, mc = null, mctx = null;
  try { if (typeof OffscreenCanvas === "function") worker = new Worker("js/phonecam-enc.js"); } catch {}
  const cv = document.createElement("canvas"), ctx = cv.getContext("2d");
  const encodeHere = () => new Promise(r => cv.toBlob(r, "image/jpeg", 0.72)).then(b => b?.arrayBuffer());
  const encodeWorker = (bitmap) => new Promise((resolve) => {
    worker.onmessage = (e) => resolve(e.data instanceof ArrayBuffer ? e.data : null);
    worker.postMessage({ bitmap, quality: 0.72 }, [bitmap]);
  });
  const tick = async () => {
    if (!running || !frames) return;
    frameTimer = setTimeout(tick, 1000 / 24);
    if (sending && performance.now() - since > 3000) sending = false;   // una foto que no termina no para el envío
    if (sending || ws?.readyState !== 1 || ws.bufferedAmount > 512 * 1024 || !video.videoWidth) return;
    sending = true; since = performance.now();
    try {
      const w = Math.min(video.videoWidth, (QUALITY[$("quality").value] || QUALITY[720])[3]);
      const hgt = Math.round(w * video.videoHeight / video.videoWidth);
      let buf;
      if (worker) {
        // Se dibuja aquí (rápido, en la GPU) y la imagen pasa al hilo de codificación sin copiarla.
        if (!mc || mc.width !== w || mc.height !== hgt) { mc = new OffscreenCanvas(w, hgt); mctx = mc.getContext("2d"); }
        mctx.drawImage(video, 0, 0, w, hgt);
        buf = await encodeWorker(mc.transferToImageBitmap());
      } else {
        if (cv.width !== w || cv.height !== hgt) { cv.width = w; cv.height = hgt; }
        ctx.drawImage(video, 0, 0, w, hgt);
        buf = await encodeHere();
      }
      if (buf && ws?.readyState === 1) { ws.send(buf); sent++; }
    } catch {} finally { sending = false; }
  };
  tick();
}

async function keepAwake() {
  try { wake = await navigator.wakeLock?.request("screen"); } catch {}
}
document.addEventListener("visibilitychange", () => { if (running && document.visibilityState === "visible") { keepAwake(); if (!stream?.getVideoTracks().some(t => t.readyState === "live")) restartCamera(); } });

async function restartCamera() {
  try { await openCamera(); if (!frames) offer(); } catch (e) { state("No se pudo abrir la cámara: " + (e.message || e), "err"); }
}
async function start() {
  for (const k of ["pin", "name", "facing", "quality"]) store.set(k, $(k).value.trim());
  try { await openCamera(); }
  catch (e) { state(e.name === "NotAllowedError" ? "Permite el uso de la cámara para esta página (icono del candado → Permisos)." : "No se pudo abrir la cámara: " + (e.message || e), "err"); return; }
  running = true;
  $("go").textContent = "■ Parar"; $("go").className = "stop";
  keepAwake();
  connect();
}
function stop(user = true) {
  running = false;
  clearTimeout(frameTimer); clearTimeout(fallbackTimer); frames = USB;
  try { pc?.close(); } catch {} pc = null;
  try { ws?.close(); } catch {} ws = null;
  stream?.getTracks().forEach(t => t.stop()); stream = null;
  try { wake?.release(); } catch {}
  $("go").textContent = "▶ Empezar"; $("go").className = "go";
  if (user) state("Parado. Pulsa «Empezar» para volver a enviar.");
}
$("go").addEventListener("click", () => running ? stop() : start());
for (const id of ["facing", "quality"]) $(id).addEventListener("change", () => { store.set(id, $(id).value); if (running) restartCamera(); });
// Por cable el PIN ya viene en la dirección y no hace falta tocar nada.
if (USB) { $("pinrow").style.display = "none"; }
// Si llega con ?auto=1 (por cable, o en las pruebas) empieza sola.
if (qs.get("auto") === "1" && !$("go").disabled) start();
