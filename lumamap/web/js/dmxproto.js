// web/js/dmxproto.js
// Protocolos de iluminación sin dependencias (lo usan el servicio DMX de
// escritorio, el panel Luces y las pruebas):
//   · Art-Net 4 (Artistic Licence): ArtDmx, ArtPoll, ArtPollReply. Puerto UDP 6454.
//   · sACN / E1.31 (ANSI E1.31-2018): paquete de datos. Puerto UDP 5568,
//     multicast 239.255.<hi>.<lo> por universo.
//   · Parcheo de píxeles en universos (auto span y align).
// Trabaja con Uint8Array para servir igual en Node y en el navegador.

export const ARTNET_PORT = 6454;
export const SACN_PORT = 5568;
const ID = [0x41, 0x72, 0x74, 0x2d, 0x4e, 0x65, 0x74, 0x00];   // "Art-Net\0"
export const OP = { poll: 0x2000, pollReply: 0x2100, dmx: 0x5000, sync: 0x5200 };

/* ---------------- Art-Net ---------------- */

/** Dirección de puerto Art-Net de 15 bits a partir de net (0-127), subnet (0-15) y universo (0-15). */
export const portAddress = (net, sub, uni) => ((net & 0x7f) << 8) | ((sub & 0x0f) << 4) | (uni & 0x0f);
export const splitPortAddress = (pa) => ({ net: (pa >> 8) & 0x7f, sub: (pa >> 4) & 0x0f, uni: pa & 0x0f });

/** ArtDmx: 18 bytes de cabecera + datos (longitud par, 2..512). */
export function artDmx(portAddr, data, sequence = 0, physical = 0) {
  let len = Math.min(512, Math.max(2, data.length));
  if (len & 1) len++;
  const p = new Uint8Array(18 + len);
  p.set(ID, 0);
  p[8] = OP.dmx & 0xff; p[9] = OP.dmx >> 8;     // OpCode (little endian)
  p[10] = 0; p[11] = 14;                          // versión del protocolo 14
  p[12] = sequence & 0xff;                        // 0 = sin secuencia
  p[13] = physical & 0xff;
  p[14] = portAddr & 0xff;                        // SubUni
  p[15] = (portAddr >> 8) & 0x7f;                 // Net
  p[16] = len >> 8; p[17] = len & 0xff;           // longitud (big endian)
  p.set(data.subarray ? data.subarray(0, len) : data.slice(0, len), 18);
  return p;
}

/** ArtPoll: pide a todos los nodos que respondan (con ArtPollReply cuando cambien). */
export function artPoll() {
  const p = new Uint8Array(14);
  p.set(ID, 0);
  p[8] = OP.poll & 0xff; p[9] = OP.poll >> 8;
  p[10] = 0; p[11] = 14;
  p[12] = 0x02;      // TalkToMe: enviar ArtPollReply cuando cambie el estado del nodo
  p[13] = 0x00;      // prioridad de diagnóstico
  return p;
}

const str = (b, off, len) => { let s = ""; for (let i = 0; i < len && b[off + i]; i++) s += String.fromCharCode(b[off + i]); return s.trim(); };

/** Reconoce un paquete Art-Net: { op, ... } o null. */
export function parseArtNet(b) {
  if (!b || b.length < 10) return null;
  for (let i = 0; i < 8; i++) if (b[i] !== ID[i]) return null;
  const op = b[8] | (b[9] << 8);
  if (op === OP.dmx && b.length >= 18) {
    const len = (b[16] << 8) | b[17];
    return { op: "dmx", sequence: b[12], physical: b[13], portAddress: b[14] | ((b[15] & 0x7f) << 8), data: b.slice(18, 18 + Math.min(len, 512)) };
  }
  if (op === OP.poll) return { op: "poll" };
  if (op === OP.pollReply && b.length >= 207) {
    const ip = `${b[10]}.${b[11]}.${b[12]}.${b[13]}`;
    const numPorts = Math.min(4, (b[172] << 8) | b[173]);
    const netSw = b[18] & 0x7f, subSw = b[19] & 0x0f;
    const outs = [], ins = [];
    for (let i = 0; i < numPorts; i++) {
      const type = b[174 + i];
      if (type & 0x80) outs.push(portAddress(netSw, subSw, b[190 + i] & 0x0f));   // el nodo puede emitir DMX (salida física)
      if (type & 0x40) ins.push(portAddress(netSw, subSw, b[186 + i] & 0x0f));
    }
    return {
      op: "pollReply", ip, port: b[14] | (b[15] << 8), version: (b[16] << 8) | b[17],
      oem: (b[20] << 8) | b[21], esta: b[24] | (b[25] << 8), estaCode: String.fromCharCode(b[24]) + String.fromCharCode(b[25]),
      shortName: str(b, 26, 18), longName: str(b, 44, 64), report: str(b, 108, 64),
      ports: numPorts, outputs: outs, inputs: ins, mac: [...b.slice(201, 207)].map(x => x.toString(16).padStart(2, "0")).join(":"),
      bindIndex: b.length > 212 ? b[212] : 0, status: b[23],
    };
  }
  return { op: "other", code: op };
}

/** ArtPollReply mínimo (para pruebas y para anunciar LumaMap como controlador). */
export function artPollReply({ ip = "0.0.0.0", shortName = "LumaMap", longName = "LumaMap", net = 0, sub = 0, outputs = [], esta = [0x7f, 0xff] } = {}) {
  const p = new Uint8Array(239);
  p.set(ID, 0);
  p[8] = OP.pollReply & 0xff; p[9] = OP.pollReply >> 8;
  ip.split(".").forEach((x, i) => { p[10 + i] = +x; });
  p[14] = ARTNET_PORT & 0xff; p[15] = ARTNET_PORT >> 8;
  p[18] = net; p[19] = sub; p[24] = esta[0]; p[25] = esta[1];
  for (let i = 0; i < shortName.length && i < 17; i++) p[26 + i] = shortName.charCodeAt(i);
  for (let i = 0; i < longName.length && i < 63; i++) p[44 + i] = longName.charCodeAt(i);
  p[173] = Math.min(4, outputs.length);
  outputs.slice(0, 4).forEach((u, i) => { p[174 + i] = 0x80; p[190 + i] = u & 0x0f; });
  return p;
}

/* ---------------- sACN / E1.31 ---------------- */

const ACN_ID = [0x41, 0x53, 0x43, 0x2d, 0x45, 0x31, 0x2e, 0x31, 0x37, 0x00, 0x00, 0x00];   // "ASC-E1.17\0\0\0"
export const sacnMulticast = (universe) => `239.255.${(universe >> 8) & 0xff}.${universe & 0xff}`;

/** Paquete de datos E1.31 (126 bytes de cabecera + 512 canales). cid: 16 bytes. */
export function sacnPacket(universe, data, { sequence = 0, priority = 100, sourceName = "LumaMap", cid, preview = false, terminate = false } = {}) {
  const n = Math.min(512, data.length);
  const p = new Uint8Array(126 + n);
  const dv = new DataView(p.buffer);
  // Capa raíz
  dv.setUint16(0, 0x0010); dv.setUint16(2, 0x0000);
  p.set(ACN_ID, 4);
  dv.setUint16(16, 0x7000 | (110 + n));            // flags + longitud (desde el byte 16)
  dv.setUint32(18, 0x00000004);                    // VECTOR_ROOT_E131_DATA
  p.set(cid || new Uint8Array(16), 22);
  // Capa de trama
  dv.setUint16(38, 0x7000 | (88 + n));
  dv.setUint32(40, 0x00000002);                    // VECTOR_E131_DATA_PACKET
  for (let i = 0; i < 63 && i < sourceName.length; i++) p[44 + i] = sourceName.charCodeAt(i);
  p[108] = priority;
  dv.setUint16(109, 0);                            // sync address
  p[111] = sequence & 0xff;
  p[112] = (preview ? 0x80 : 0) | (terminate ? 0x40 : 0);
  dv.setUint16(113, universe);
  // Capa DMP
  dv.setUint16(115, 0x7000 | (11 + n));
  p[117] = 0x02; p[118] = 0xa1;                    // vector, tipo de dirección
  dv.setUint16(119, 0x0000); dv.setUint16(121, 0x0001);
  dv.setUint16(123, n + 1);                        // nº de valores + código de inicio
  p[125] = 0x00;                                   // código de inicio DMX
  p.set(data.subarray ? data.subarray(0, n) : data.slice(0, n), 126);
  return p;
}

/** Reconoce un paquete de datos E1.31: { universe, priority, sequence, sourceName, data } o null. */
export function parseSacn(b) {
  if (!b || b.length < 126) return null;
  for (let i = 0; i < 12; i++) if (b[4 + i] !== ACN_ID[i]) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (dv.getUint32(18) !== 4 || dv.getUint32(40) !== 2) return null;
  if (b[125] !== 0) return null;                   // solo código de inicio 0 (DMX)
  const count = dv.getUint16(123) - 1;
  return { universe: dv.getUint16(113), priority: b[108], sequence: b[111], sourceName: str(b, 44, 64), terminated: !!(b[112] & 0x40), data: b.slice(126, 126 + Math.max(0, Math.min(512, count))) };
}

/* ---------------- Parcheo de píxeles ---------------- */

/** Canales por píxel según el orden de color. */
export const COLOR_ORDERS = { RGB: [0, 1, 2], RBG: [0, 2, 1], GRB: [1, 0, 2], GBR: [1, 2, 0], BRG: [2, 0, 1], BGR: [2, 1, 0], RGBW: [0, 1, 2, 3], GRBW: [1, 0, 2, 3], W: [3], RGBWAU: [0, 1, 2, 3, 4, 5] };
export const channelsPerPixel = (order) => (COLOR_ORDERS[order] || COLOR_ORDERS.RGB).length;

/**
 * Asigna cada píxel a universo y canal.
 * startUniverse: número lógico; startChannel: 1..512.
 * autoSpan: pasa al siguiente universo al llenar 512 canales.
 * align: un píxel nunca queda partido entre dos universos (si no cabe entero, empieza en el siguiente).
 * Devuelve [{ universe, channel }] (channel 1..512) y el último universo usado.
 */
export function patchPixels(count, { startUniverse = 1, startChannel = 1, order = "RGB", autoSpan = true, align = true } = {}) {
  const k = channelsPerPixel(order);
  const out = [];
  let u = startUniverse, ch = Math.max(1, Math.min(512, startChannel));
  for (let i = 0; i < count; i++) {
    if (ch + k - 1 > 512) {
      if (!autoSpan) { out.push(null); continue; }
      if (align) { u++; ch = 1; }
    }
    out.push({ universe: u, channel: ch });
    ch += k;
    if (ch > 512 && autoSpan) { u += Math.floor((ch - 1) / 512); ch = ((ch - 1) % 512) + 1; }
  }
  return { patch: out, lastUniverse: u, perPixel: k };
}

/** Escribe un color (0..255 RGB + W opcional) en un buffer DMX respetando el orden; sin align puede partirse entre universos. */
export function writePixel(bufFor, universe, channel, order, rgbw) {
  const idx = COLOR_ORDERS[order] || COLOR_ORDERS.RGB;
  let u = universe, c = channel - 1, buf = bufFor(u);
  for (let i = 0; i < idx.length; i++) {
    if (c >= 512) { u++; c = 0; buf = bufFor(u); }
    if (buf) buf[c] = rgbw[idx[i]] ?? 0;
    c++;
  }
}

/** Blanco a partir de RGB (para tiras RGBW): W = mínimo común, se resta de RGB. */
export function rgbToRgbw(r, g, b, mode = "subtract") {
  const w = Math.min(r, g, b);
  if (mode === "add") return [r, g, b, w];
  return [r - w, g - w, b - w, w, 0, 0];
}

/** Posiciones (0..1) de los píxeles de un pixel map según su forma y orden de cableado. */
export function pixelPositions(pm) {
  const pts = [];
  const { x = 0, y = 0, w = 1, h = 1 } = pm;
  const cols = Math.max(1, pm.cols | 0), rows = Math.max(1, pm.rows | 0), n = Math.max(1, pm.count | 0);
  if (pm.shape === "line") {
    for (let i = 0; i < n; i++) { const t = n === 1 ? 0.5 : i / (n - 1); pts.push([x + w * t, y + h * t]); }
  } else if (pm.shape === "circle" || pm.shape === "arc") {
    const a0 = (pm.startAngle ?? 0) * Math.PI / 180, span = (pm.shape === "circle" ? 360 : (pm.arc ?? 180)) * Math.PI / 180;
    for (let i = 0; i < n; i++) {
      const t = pm.shape === "circle" ? i / n : (n === 1 ? 0.5 : i / (n - 1));
      const a = a0 + span * t;
      pts.push([x + w / 2 + Math.cos(a) * w / 2, y + h / 2 + Math.sin(a) * h / 2]);
    }
  } else if (pm.shape === "custom" && Array.isArray(pm.points)) {
    for (const p of pm.points) pts.push([p[0], p[1]]);
  } else {
    // grid / matrix: celdas cols × rows con el orden de cableado indicado
    const cell = (c, r) => [x + w * (cols === 1 ? 0.5 : (c + 0.5) / cols), y + h * (rows === 1 ? 0.5 : (r + 0.5) / rows)];
    const vertical = pm.order === "ttb" || pm.order === "btt";
    const lines = vertical ? cols : rows, per = vertical ? rows : cols;
    for (let l = 0; l < lines; l++) {
      const zig = pm.serpentine && l % 2 === 1;
      for (let j = 0; j < per; j++) {
        let k = zig ? per - 1 - j : j;
        let c, r;
        if (vertical) { c = l; r = k; if (pm.order === "btt") r = rows - 1 - r; }
        else { r = l; c = k; if (pm.order === "rtl") c = cols - 1 - c; }
        pts.push(cell(c, r));
      }
    }
  }
  if (pm.reverse) pts.reverse();
  return pts;
}
