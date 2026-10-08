/**
 * Art-Net 4 packet encoding/decoding (Artistic Licence, public specification).
 * Only the opcodes needed for a lighting controller are implemented:
 * ArtPoll / ArtPollReply (discovery), ArtDmx (in/out), ArtSync.
 */

export const ARTNET_PORT = 6454;
const ID = [0x41, 0x72, 0x74, 0x2d, 0x4e, 0x65, 0x74, 0x00]; // "Art-Net\0"
export const OP_POLL = 0x2000;
export const OP_POLL_REPLY = 0x2100;
export const OP_DMX = 0x5000;
export const OP_SYNC = 0x5200;
const PROT_VER = 14;

function header(buf: Uint8Array, opcode: number) {
  buf.set(ID, 0);
  buf[8] = opcode & 0xff; // little endian
  buf[9] = opcode >> 8;
}

export function isArtNet(buf: Uint8Array): boolean {
  if (buf.length < 10) return false;
  for (let i = 0; i < 8; i++) if (buf[i] !== ID[i]) return false;
  return true;
}

export function opcode(buf: Uint8Array): number {
  return buf[8] | (buf[9] << 8);
}

/**
 * ArtDmx. `portAddress` is the 15-bit Port-Address (Net 7 bits, Sub-Net 4, Universe 4).
 * Length is rounded up to an even number (required by the spec), min 2.
 */
export function encodeArtDmx(portAddress: number, data: Uint8Array, sequence: number, physical = 0): Uint8Array {
  let len = Math.min(512, data.length);
  if (len % 2) len++;
  if (len < 2) len = 2;
  const buf = new Uint8Array(18 + len);
  header(buf, OP_DMX);
  buf[10] = 0;
  buf[11] = PROT_VER;
  buf[12] = sequence & 0xff;
  buf[13] = physical & 0xff;
  buf[14] = portAddress & 0xff; // SubUni
  buf[15] = (portAddress >> 8) & 0x7f; // Net
  buf[16] = len >> 8;
  buf[17] = len & 0xff;
  buf.set(data.subarray(0, Math.min(len, data.length)), 18);
  return buf;
}

export interface ArtDmxPacket {
  portAddress: number;
  sequence: number;
  physical: number;
  data: Uint8Array;
}

export function decodeArtDmx(buf: Uint8Array): ArtDmxPacket | null {
  if (!isArtNet(buf) || opcode(buf) !== OP_DMX || buf.length < 18) return null;
  const len = (buf[16] << 8) | buf[17];
  if (len < 1 || len > 512 || buf.length < 18 + len) return null;
  return { sequence: buf[12], physical: buf[13], portAddress: (buf[15] << 8) | buf[14], data: buf.slice(18, 18 + len) };
}

export function encodeArtPoll(): Uint8Array {
  const buf = new Uint8Array(14);
  header(buf, OP_POLL);
  buf[10] = 0;
  buf[11] = PROT_VER;
  // Flags: bit1 = send ArtPollReply whenever node conditions change.
  buf[12] = 0b0000_0010;
  buf[13] = 0x10; // DiagPriority low
  return buf;
}

export function encodeArtSync(): Uint8Array {
  const buf = new Uint8Array(14);
  header(buf, OP_SYNC);
  buf[10] = 0;
  buf[11] = PROT_VER;
  return buf;
}

export interface ArtPollReply {
  ip: string;
  port: number;
  firmware: number;
  netSwitch: number;
  subSwitch: number;
  oem: number;
  estaCode: number;
  manufacturer: string;
  shortName: string;
  longName: string;
  nodeReport: string;
  numPorts: number;
  portTypes: number[];
  swIn: number[];
  swOut: number[];
  /** 15-bit port addresses of output ports (lights side). */
  outputUniverses: number[];
  inputUniverses: number[];
  goodOutput: number[];
  mac: string;
  bindIndex: number;
  style: number;
}

const readStr = (buf: Uint8Array, start: number, len: number) => {
  let end = start;
  while (end < start + len && end < buf.length && buf[end] !== 0) end++;
  return new TextDecoder('latin1').decode(buf.subarray(start, end)).trim();
};

export function decodeArtPollReply(buf: Uint8Array): ArtPollReply | null {
  if (!isArtNet(buf) || opcode(buf) !== OP_POLL_REPLY || buf.length < 207) return null;
  const ip = `${buf[10]}.${buf[11]}.${buf[12]}.${buf[13]}`;
  const netSwitch = buf[18] & 0x7f;
  const subSwitch = buf[19] & 0x0f;
  const estaCode = buf[24] | (buf[25] << 8);
  const numPorts = Math.min(4, (buf[172] << 8) | buf[173]);
  const portTypes = [...buf.subarray(174, 178)];
  const swIn = [...buf.subarray(186, 190)].map((v) => v & 0x0f);
  const swOut = [...buf.subarray(190, 194)].map((v) => v & 0x0f);
  const outputUniverses: number[] = [];
  const inputUniverses: number[] = [];
  for (let i = 0; i < numPorts; i++) {
    const base = (netSwitch << 8) | (subSwitch << 4);
    if (portTypes[i] & 0x80) outputUniverses.push(base | swOut[i]);
    if (portTypes[i] & 0x40) inputUniverses.push(base | swIn[i]);
  }
  const mac = buf.length >= 207 ? [...buf.subarray(201, 207)].map((b) => b.toString(16).padStart(2, '0')).join(':') : '';
  return {
    ip,
    port: buf[14] | (buf[15] << 8),
    firmware: (buf[16] << 8) | buf[17],
    netSwitch,
    subSwitch,
    oem: (buf[20] << 8) | buf[21],
    estaCode,
    manufacturer: estaName(estaCode),
    shortName: readStr(buf, 26, 18),
    longName: readStr(buf, 44, 64),
    nodeReport: readStr(buf, 108, 64),
    numPorts,
    portTypes,
    swIn,
    swOut,
    outputUniverses,
    inputUniverses,
    goodOutput: [...buf.subarray(182, 186)],
    mac,
    bindIndex: buf.length > 211 ? buf[211] : 0,
    style: buf[200],
  };
}

/** Builds an ArtPollReply (used by tests and by the optional "act as a node" input mode). */
export function encodeArtPollReply(opts: {
  ip: string;
  shortName: string;
  longName: string;
  estaCode?: number;
  netSwitch?: number;
  subSwitch?: number;
  outputs?: number[];
  inputs?: number[];
  mac?: number[];
}): Uint8Array {
  const buf = new Uint8Array(239);
  header(buf, OP_POLL_REPLY);
  opts.ip.split('.').forEach((o, i) => (buf[10 + i] = Number(o) & 0xff));
  buf[14] = ARTNET_PORT & 0xff;
  buf[15] = ARTNET_PORT >> 8;
  buf[18] = opts.netSwitch ?? 0;
  buf[19] = opts.subSwitch ?? 0;
  const esta = opts.estaCode ?? 0x7ff0;
  buf[24] = esta & 0xff;
  buf[25] = esta >> 8;
  const enc = new TextEncoder();
  buf.set(enc.encode(opts.shortName).subarray(0, 17), 26);
  buf.set(enc.encode(opts.longName).subarray(0, 63), 44);
  const outs = opts.outputs ?? [];
  const ins = opts.inputs ?? [];
  const n = Math.min(4, Math.max(outs.length, ins.length));
  buf[173] = n;
  for (let i = 0; i < n; i++) {
    buf[174 + i] = (outs[i] !== undefined ? 0x80 : 0) | (ins[i] !== undefined ? 0x40 : 0);
    buf[190 + i] = (outs[i] ?? 0) & 0x0f;
    buf[186 + i] = (ins[i] ?? 0) & 0x0f;
    buf[182 + i] = outs[i] !== undefined ? 0x80 : 0;
  }
  if (opts.mac) buf.set(opts.mac.slice(0, 6), 201);
  return buf;
}

/** Port-Address helpers. */
export const portAddress = (net: number, subnet: number, universe: number) => ((net & 0x7f) << 8) | ((subnet & 0x0f) << 4) | (universe & 0x0f);
export const splitPortAddress = (pa: number) => ({ net: (pa >> 8) & 0x7f, subnet: (pa >> 4) & 0x0f, universe: pa & 0x0f });
export const formatPortAddress = (pa: number) => {
  const s = splitPortAddress(pa);
  return `${s.net}:${s.subnet}:${s.universe}`;
};

/**
 * ESTA manufacturer id. Only ranges defined by the standard are named; real
 * manufacturer names come from the node's own long name (which nodes fill in).
 */
export function estaName(code: number): string {
  if (code === 0) return 'ESTA';
  if (code >= 0x7ff0 && code <= 0x7fff) return 'Prototipo (sin fabricante registrado)';
  return `ESTA 0x${code.toString(16).padStart(4, '0').toUpperCase()}`;
}
