// web/js/rdm.js
// RDM (ANSI E1.20) dentro de Art-Net 4: las luces que lo admiten dicen solas qué
// son (fabricante, modelo, tipo, nº de canales, dirección DMX y qué hace cada
// canal). Con eso LumaMap crea el fixture correcto sin que el usuario elija nada.
//
//   ArtTodRequest (0x8000) → el nodo responde ArtTodData (0x8100) con los UID
//   de las luces conectadas a cada salida; luego, por cada luz, ArtRdm (0x8300)
//   con peticiones GET: DEVICE_INFO, MANUFACTURER_LABEL, DEVICE_MODEL_DESCRIPTION,
//   DEVICE_LABEL y SLOT_INFO.
// Las luces sin RDM no pueden avisar: para ellas hay perfiles y la detección guiada.
// Sin dependencias del DOM (se prueba en Node).

const ID = [0x41, 0x72, 0x74, 0x2d, 0x4e, 0x65, 0x74, 0x00];   // "Art-Net\0"
export const OP_RDM = { todRequest: 0x8000, todData: 0x8100, todControl: 0x8200, rdm: 0x8300 };
export const CC = { get: 0x20, getResponse: 0x21, set: 0x30, setResponse: 0x31 };
export const PID = {
  deviceInfo: 0x0060, modelDescription: 0x0080, manufacturerLabel: 0x0081, deviceLabel: 0x0082,
  slotInfo: 0x0120, slotDescription: 0x0121, dmxStartAddress: 0x00f0, identify: 0x1000,
};
/** UID del controlador: fabricante 0x7FF0 (rango de prototipos de ESTA) + número al azar. */
export function controllerUid() {
  const r = Math.floor(Math.random() * 0xffffffff) >>> 0;
  return [0x7f, 0xf0, (r >>> 24) & 255, (r >>> 16) & 255, (r >>> 8) & 255, r & 255];
}
export const uidStr = (u) => `${hex(u[0])}${hex(u[1])}:${hex(u[2])}${hex(u[3])}${hex(u[4])}${hex(u[5])}`;
const hex = (v) => v.toString(16).padStart(2, "0").toUpperCase();
export function parseUid(s) { const h = s.replace(/[^0-9a-f]/gi, ""); return [0, 2, 4, 6, 8, 10].map(i => parseInt(h.slice(i, i + 2), 16)); }

/* ---------------- Paquetes RDM (E1.20) ---------------- */
/**
 * Mensaje RDM completo (con el código de inicio 0xCC y la suma de verificación).
 * Longitud del mensaje = 24 + PDL (desde el código de inicio hasta el final de los datos).
 */
export function rdmPacket({ dest, src, tn = 0, port = 1, msgCount = 0, subDevice = 0, cc = CC.get, pid, data = [] }) {
  const pdl = data.length, len = 24 + pdl;
  const p = new Uint8Array(len + 2);
  p[0] = 0xcc; p[1] = 0x01; p[2] = len;
  p.set(dest, 3); p.set(src, 9);
  p[15] = tn & 0xff; p[16] = port & 0xff; p[17] = msgCount & 0xff;
  p[18] = (subDevice >> 8) & 0xff; p[19] = subDevice & 0xff;
  p[20] = cc; p[21] = (pid >> 8) & 0xff; p[22] = pid & 0xff; p[23] = pdl;
  p.set(data, 24);
  let sum = 0;
  for (let i = 0; i < len; i++) sum += p[i];
  p[len] = (sum >> 8) & 0xff; p[len + 1] = sum & 0xff;
  return p;
}
/** Lee un mensaje RDM (con o sin el código de inicio 0xCC). Devuelve null si está mal o la suma no cuadra. */
export function parseRdm(b) {
  if (!b || b.length < 25) return null;
  let off = 0;
  if (b[0] === 0xcc) off = 0; else if (b[0] === 0x01) off = -1; else return null;   // ArtRdm lo envía sin 0xCC
  const at = (i) => i + off;
  const len = b[at(2)];
  if (b[at(1)] !== 0x01 || len < 24 || at(len) + 2 > b.length) return null;
  let sum = off === -1 ? 0xcc : 0;
  for (let i = 0; i < len + off; i++) sum += b[i];
  const ck = (b[at(len)] << 8) | b[at(len) + 1];
  if ((sum & 0xffff) !== ck) return null;
  const pdl = b[at(23)];
  return {
    dest: [...b.slice(at(3), at(9))], src: [...b.slice(at(9), at(15))], tn: b[at(15)], responseType: b[at(16)], msgCount: b[at(17)],
    subDevice: (b[at(18)] << 8) | b[at(19)], cc: b[at(20)], pid: (b[at(21)] << 8) | b[at(22)], data: b.slice(at(24), at(24) + pdl),
  };
}
export const RESPONSE = { ack: 0x00, ackTimer: 0x01, nack: 0x02, ackOverflow: 0x03 };

/* ---------------- Art-Net con RDM ---------------- */
function header(op, len) {
  const p = new Uint8Array(len);
  p.set(ID, 0); p[8] = op & 0xff; p[9] = op >> 8; p[10] = 0; p[11] = 14;
  return p;
}
/** ArtTodRequest: pide la lista de luces RDM de unas direcciones de puerto (todas del mismo Net). */
export function artTodRequest(portAddresses) {
  const p = header(OP_RDM.todRequest, 56);
  const list = [...new Set(portAddresses)].slice(0, 32);
  p[21] = list.length ? (list[0] >> 8) & 0x7f : 0;   // Net
  p[22] = 0x00;                                       // TodFull
  p[23] = list.length;                                // AdCount
  list.forEach((pa, i) => { p[24 + i] = pa & 0xff; });   // Sub-Net + Universe
  return p;
}
/** ArtRdm: un mensaje RDM hacia la salida (dirección de puerto) de un nodo. Sin el 0xCC. */
export function artRdm(portAddr, rdm) {
  const body = rdm[0] === 0xcc ? rdm.slice(1) : rdm;
  const p = header(OP_RDM.rdm, 24 + body.length);
  p[12] = 0x01;                       // RdmVer
  p[21] = (portAddr >> 8) & 0x7f;     // Net
  p[22] = 0x00;                       // ArProcess
  p[23] = portAddr & 0xff;            // Address
  p.set(body, 24);
  return p;
}
/** ArtTodData (lo envía el nodo; aquí también para pruebas). */
export function artTodData(portAddr, uids, { bindIndex = 1, port = 1 } = {}) {
  const p = header(OP_RDM.todData, 28 + uids.length * 6);
  p[12] = 0x01; p[13] = port; p[20] = bindIndex; p[21] = (portAddr >> 8) & 0x7f; p[22] = 0x00; p[23] = portAddr & 0xff;
  p[24] = (uids.length >> 8) & 0xff; p[25] = uids.length & 0xff; p[26] = 0; p[27] = uids.length;
  uids.forEach((u, i) => p.set(u, 28 + i * 6));
  return p;
}
/** Lee paquetes Art-Net de RDM. Devuelve null si no lo son. */
export function parseArtRdm(b) {
  if (!b || b.length < 24) return null;
  for (let i = 0; i < 8; i++) if (b[i] !== ID[i]) return null;
  const op = b[8] | (b[9] << 8);
  if (op === OP_RDM.todData && b.length >= 28) {
    const portAddress = ((b[21] & 0x7f) << 8) | b[23], n = b[27], uids = [];
    for (let i = 0; i < n && 28 + i * 6 + 6 <= b.length; i++) uids.push([...b.slice(28 + i * 6, 34 + i * 6)]);
    return { op: "todData", portAddress, total: (b[24] << 8) | b[25], block: b[26], uids };
  }
  if (op === OP_RDM.todRequest) return { op: "todRequest", net: b[21], addresses: [...b.slice(24, 24 + b[23])].map(a => ((b[21] & 0x7f) << 8) | a) };
  if (op === OP_RDM.rdm) return { op: "rdm", portAddress: ((b[21] & 0x7f) << 8) | b[23], rdm: parseRdm(b.slice(24)) };
  return null;
}

/* ---------------- Datos de las respuestas ---------------- */
const u16 = (d, i) => (d[i] << 8) | d[i + 1];
export function parseDeviceInfo(d) {
  if (!d || d.length < 19) return null;
  return {
    rdmVersion: u16(d, 0), modelId: u16(d, 2), category: u16(d, 4), software: ((d[6] << 24) | (d[7] << 16) | (d[8] << 8) | d[9]) >>> 0,
    footprint: u16(d, 10), personality: d[12], personalities: d[13], startAddress: u16(d, 14), subDevices: u16(d, 16), sensors: d[18],
  };
}
export function deviceInfoData(o) {
  const d = new Uint8Array(19);
  const w = (i, v) => { d[i] = (v >> 8) & 255; d[i + 1] = v & 255; };
  w(0, 0x0100); w(2, o.modelId || 1); w(4, o.category || 0x0101); d.set([0, 0, 0, 1], 6); w(10, o.footprint || 1);
  d[12] = 1; d[13] = 1; w(14, o.startAddress || 1); w(16, 0); d[18] = 0;
  return d;
}
export const asciiOf = (d) => String.fromCharCode(...(d || [])).replace(/\0+$/, "").trim();
/** SLOT_INFO: 5 bytes por canal: desplazamiento (2), tipo (1), etiqueta (2). */
export function parseSlotInfo(d) {
  const out = [];
  for (let i = 0; i + 5 <= (d?.length || 0); i += 5) out.push({ offset: u16(d, i), type: d[i + 2], label: u16(d, i + 3) });
  return out.sort((a, b) => a.offset - b.offset);
}
export function slotInfoData(slots) {
  const d = new Uint8Array(slots.length * 5);
  slots.forEach((s, i) => { d[i * 5] = s.offset >> 8; d[i * 5 + 1] = s.offset & 255; d[i * 5 + 2] = s.type || 0; d[i * 5 + 3] = s.label >> 8; d[i * 5 + 4] = s.label & 255; });
  return d;
}

/* ---------------- Tipos (E1.20, tablas A-5 y C-2) ---------------- */
export const CATEGORY = {
  0x0100: "Foco", 0x0101: "Foco fijo", 0x0102: "Cabeza móvil", 0x0103: "Escáner (espejo móvil)", 0x0104: "Luz",
  0x0200: "Accesorio", 0x0201: "Cambiador de color", 0x0202: "Accesorio móvil", 0x0203: "Espejo móvil", 0x0204: "Efecto", 0x0205: "Accesorio de haz",
  0x0300: "Proyector", 0x0301: "Proyector fijo", 0x0302: "Proyector móvil", 0x0303: "Proyector con espejo",
  0x0400: "Efecto atmosférico", 0x0401: "Máquina de humo / niebla", 0x0402: "Pirotecnia",
  0x0500: "Dimmer", 0x0600: "Alimentación", 0x0700: "Escenografía", 0x0800: "Red de datos", 0x0900: "Audio / vídeo", 0x7fff: "Otro",
};
/** Etiqueta de canal (SLOT_INFO) → tipo de canal de LumaMap (dmx.js CHANNEL_TYPES). */
export const SLOT_LABEL = {
  0x0001: "intensity", 0x0002: "dimmer", 0x0101: "pan", 0x0102: "tilt",
  0x0201: "color", 0x0205: "red", 0x0206: "green", 0x0207: "blue", 0x0211: "amber", 0x0212: "white", 0x0213: "white", 0x0214: "white", 0x0215: "uv",
  0x0301: "gobo", 0x0302: "gobo", 0x0404: "strobe", 0x0502: "speed",
};
export const SLOT_TYPE_FINE = 0x01;   // ST_SEC_FINE: byte fino del canal anterior

/** Nombre corto del tipo de luz (para la lista). Láseres: por el modelo, el RDM no tiene categoría propia. */
export function kindOf(dev) {
  const m = `${dev.model || ""} ${dev.label || ""}`.toLowerCase();
  if (/laser|láser/.test(m)) return "Láser";
  if (/fog|haze|smoke|humo|niebla/.test(m)) return "Máquina de humo";
  if (/strobe|estrobo/.test(m)) return "Estrobo";
  if (/bar\b|barra|batten/.test(m)) return "Barra LED";
  if (/wash/.test(m) && dev.category === 0x0102) return "Cabeza móvil (wash)";
  if (/beam|spot/.test(m) && dev.category === 0x0102) return "Cabeza móvil (beam/spot)";
  if (/par\b|par\d/.test(m)) return "Foco PAR";
  return CATEGORY[dev.category] || CATEGORY[dev.category & 0xff00] || "Luz";
}

/**
 * Canales de un dispositivo detectado → lista [{type, name}] de LumaMap.
 * Con SLOT_INFO se usa exactamente; si no, se deduce por categoría y nº de canales.
 */
export function channelsOf(dev, CHANNEL_NAMES = {}) {
  const name = (t) => CHANNEL_NAMES[t] || t;
  if (dev.slots?.length) {
    const out = [];
    for (const s of dev.slots) {
      let t = SLOT_LABEL[s.label] || "custom";
      const prev = out[out.length - 1];
      if (s.type === SLOT_TYPE_FINE && prev) t = prev.type === "pan" ? "panFine" : prev.type === "tilt" ? "tiltFine" : "custom";
      out.push({ type: t, name: name(t) });
    }
    while (out.length < (dev.footprint || 0)) out.push({ type: "custom", name: name("custom") });
    return out.slice(0, Math.max(1, dev.footprint || out.length));
  }
  return guessChannels(dev.category, dev.footprint || 1, kindOf(dev)).map(t => ({ type: t, name: name(t) }));
}
/** Disposición más habitual según tipo y nº de canales (si la luz no informa de sus canales). */
export function guessChannels(category, n, kind = "") {
  const fill = (arr) => { const a = arr.slice(0, n); while (a.length < n) a.push("custom"); return a; };
  if (/Láser/.test(kind)) return fill(["intensity", "custom", "custom", "speed", "custom", "custom", "red", "green", "blue"]);
  if (category === 0x0102 || category === 0x0103 || category === 0x0302) {
    if (n >= 16) return fill(["pan", "panFine", "tilt", "tiltFine", "speed", "dimmer", "strobe", "red", "green", "blue", "white", "color", "gobo"]);
    if (n >= 9) return fill(["pan", "tilt", "speed", "dimmer", "strobe", "red", "green", "blue", "white"]);
    return fill(["pan", "tilt", "dimmer", "color", "gobo", "strobe"]);
  }
  if (category === 0x0401) return fill(["intensity", "custom"]);
  if (category === 0x0500 || n === 1) return fill(["dimmer"]);
  if (n === 3) return fill(["red", "green", "blue"]);
  if (n === 4) return fill(["red", "green", "blue", "white"]);
  if (n === 5) return fill(["dimmer", "red", "green", "blue", "strobe"]);
  if (n === 6) return fill(["dimmer", "red", "green", "blue", "white", "strobe"]);
  if (n === 7) return fill(["dimmer", "red", "green", "blue", "white", "amber", "strobe"]);
  if (n === 8) return fill(["dimmer", "red", "green", "blue", "white", "amber", "uv", "strobe"]);
  return fill(["dimmer", "red", "green", "blue"]);
}
