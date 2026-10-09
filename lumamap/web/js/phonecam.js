// web/js/phonecam.js
// Móviles como cámara (lado del programa). El móvil abre phonecam.html (https del
// propio LumaMap), manda su cámara por WebRTC directamente por la red local
// (Wi-Fi o cable USB con «anclaje de red») y aquí se recibe como una cámara más:
// clave «phone:<id>» en sources.js, igual que una webcam USB. El servidor solo
// pasa la señalización (oferta/respuesta); el video no pasa por él.

const PREFIX = "phone:";
export const isPhoneKey = (k) => typeof k === "string" && k.startsWith(PREFIX);
export const phoneKey = (cam) => PREFIX + cam;

const phones = new Map();     // clave -> { key, cam, name, clientId, online, pc, stream, state }
const listeners = new Set();
const waiters = new Map();    // clave -> [resolve]
let remote = null;

/** Avisa cuando cambia algo (móvil conectado, desconectado, video nuevo): fn(clave). */
export function onPhoneChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const notify = (key) => { for (const fn of listeners) { try { fn(key); } catch {} } };

/** Video que manda un móvil (si está llegando). */
export function phoneStream(key) {
  const p = phones.get(key);
  return p?.stream && p.stream.getVideoTracks().some(t => t.readyState === "live") ? p.stream : null;
}
/** Espera a que llegue el video de un móvil (o falla con un mensaje claro). */
export function waitPhone(key, ms = 20000) {
  const s = phoneStream(key);
  if (s) return Promise.resolve(s);
  return new Promise((resolve, reject) => {
    const list = waiters.get(key) || [];
    const done = (st) => { clearTimeout(to); resolve(st); };
    list.push(done); waiters.set(key, list);
    const to = setTimeout(() => {
      const l = waiters.get(key) || []; l.splice(l.indexOf(done), 1);
      reject(new Error("El móvil no está conectado: en el móvil abre la página de LumaMap y pulsa «Empezar»."));
    }, ms);
  });
}

/** Móviles conocidos en esta sesión, como cámaras para las listas. */
export function listPhones() {
  return [...phones.values()].map(p => ({
    id: p.key, label: p.name, kind: "phone", kindName: p.online ? "Móvil (Wi-Fi)" : "Móvil (desconectado)",
    stream: "color", sensor: false, is3d: false, online: p.online, live: !!phoneStream(p.key), state: p.state,
  }));
}

/** Conecta el receptor al WebSocket del programa (remote.js). */
export function startPhoneCams(r) {
  remote = r;
  return { handle, list: listPhones };
}

/** Mensajes del servidor que son de los móviles. */
export function handle(m) {
  if (m.type === "cameras") onList(m.cameras || []);
  else if (m.type === "rtc" && m.data) onRtc(m);
}

function entry(cam, name) {
  const key = phoneKey(cam);
  let p = phones.get(key);
  if (!p) { p = { key, cam, name: name || "Móvil", clientId: 0, online: false, pc: null, stream: null, state: "esperando" }; phones.set(key, p); }
  if (name) p.name = name;
  return p;
}

function onList(list) {
  const seen = new Set();
  for (const c of list) {
    const p = entry(c.cam, c.name);
    seen.add(p.key);
    const changed = !p.online || p.clientId !== c.id;
    p.online = true; p.clientId = c.id;
    // Un móvil que ya estaba enviando antes de abrir el programa: se le pide la oferta.
    const st = p.pc?.connectionState;
    if (changed && (!p.pc || st === "failed" || st === "closed")) remote?.send({ type: "rtc", to: c.id, data: { want: "offer" } });
    if (changed) notify(p.key);
  }
  for (const p of phones.values()) if (p.online && !seen.has(p.key)) { p.online = false; p.state = "desconectado"; notify(p.key); }
}

async function onRtc(m) {
  const sdp = m.data.sdp;
  if (!sdp || sdp.type !== "offer" || !m.cam) return;
  const p = entry(m.cam, m.name);
  p.clientId = m.from; p.online = true;
  try { p.pc?.close(); } catch {}
  const pc = p.pc = new RTCPeerConnection({ iceServers: [] });
  p.state = "conectando";
  pc.ontrack = (e) => {
    if (p.pc !== pc) return;
    p.stream = e.streams?.[0] || new MediaStream([e.track]);
    p.state = "recibiendo";
    for (const w of waiters.get(p.key) || []) w(p.stream);
    waiters.delete(p.key);
    notify(p.key);
  };
  pc.onconnectionstatechange = () => {
    if (p.pc !== pc) return;
    const s = pc.connectionState;
    if (s === "connected") p.state = "recibiendo";
    else if (s === "failed" || s === "closed") {
      p.state = "sin conexión";
      for (const t of p.stream?.getTracks() || []) { try { t.stop(); } catch {} }
      // La pista terminada hace que sources.js marque la cámara como desconectada (y vuelve sola).
      p.stream = null;
    }
    notify(p.key);
  };
  try {
    await pc.setRemoteDescription(sdp);
    await pc.setLocalDescription(await pc.createAnswer());
    await iceDone(pc);
    if (p.pc === pc) remote?.send({ type: "rtc", to: m.from, data: { sdp: pc.localDescription } });
  } catch (e) {
    console.warn("cámara del móvil:", e);
    p.state = "error";
    notify(p.key);
  }
}

/** Espera a reunir las direcciones de red (en la red local tarda muy poco). */
export function iceDone(pc, ms = 2500) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const to = setTimeout(resolve, ms);
    pc.addEventListener("icegatheringstatechange", () => { if (pc.iceGatheringState === "complete") { clearTimeout(to); resolve(); } });
  });
}

/* ---------------- Direcciones para el móvil (QR) ---------------- */

/**
 * Direcciones donde el móvil abre la página de cámara: [{ name, ip, url }] y el código.
 * En la app de Windows las da el servicio del mando; en la versión web, el servidor.
 */
export async function phoneUrls() {
  const D = globalThis.LumaDesktop;
  if (D?.remoteInfo) {
    const info = await D.remoteInfo();
    if (!info.httpsPort) return { ok: false, why: "El servicio de la cámara del móvil no arrancó. Cierra y abre LumaMap." };
    return { ok: true, pin: info.pin || "", list: (info.urls || []).filter(u => u.cam).map(u => ({ name: u.name, ip: u.ip, url: u.cam + (info.pin ? `?pin=${info.pin}` : "") })) };
  }
  if (globalThis.LumaNative || location.protocol === "file:") return { ok: false, android: true };
  try {
    const j = await (await fetch("api/ping", { cache: "no-store" })).json();
    if (!j.httpsPort) return { ok: false, why: "El servidor de LumaMap no tiene https activo (necesario para la cámara del móvil)." };
    const ips = j.ips?.length ? j.ips : [location.hostname];
    return { ok: true, pin: "", list: ips.map(ip => ({ name: "", ip, url: `https://${ip}:${j.httpsPort}/phonecam.html` })) };
  } catch { return { ok: false, why: "Sin servidor de LumaMap: la cámara del móvil necesita la app de Windows (o el servidor de LumaMap)." }; }
}

/** Nombre amigable de cada red: Wi-Fi, cable o el móvil por USB. */
export function netLabel(n) {
  const name = String(n.name || ""), ip = String(n.ip || "");
  if (/wi-?fi|wlan|wireless|inalámbrica/i.test(name)) return `Wi-Fi · ${ip}`;
  if (/rndis|usb|ncm|iphone|apple mobile/i.test(name) || /^192\.168\.42\./.test(ip)) return `Cable USB (anclaje del móvil) · ${ip}`;
  if (/ethernet|eth|en\d|local area/i.test(name)) return `Cable de red · ${ip}`;
  return name ? `${name} · ${ip}` : ip;
}
