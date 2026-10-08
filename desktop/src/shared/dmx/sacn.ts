/**
 * ANSI E1.31 (sACN, Streaming ACN) data packets.
 */

export const SACN_PORT = 5568;
const ACN_ID = [0x41, 0x53, 0x43, 0x2d, 0x45, 0x31, 0x2e, 0x31, 0x37, 0x00, 0x00, 0x00];
const VECTOR_ROOT_E131_DATA = 0x00000004;
const VECTOR_ROOT_E131_EXTENDED = 0x00000008;
const VECTOR_E131_DATA_PACKET = 0x00000002;
const VECTOR_E131_EXTENDED_SYNCHRONIZATION = 0x00000001;

export function multicastAddress(universe: number): string {
  return `239.255.${(universe >> 8) & 0xff}.${universe & 0xff}`;
}

function u16(buf: Uint8Array, off: number, v: number) {
  buf[off] = (v >> 8) & 0xff;
  buf[off + 1] = v & 0xff;
}

function u32(buf: Uint8Array, off: number, v: number) {
  buf[off] = (v >>> 24) & 0xff;
  buf[off + 1] = (v >>> 16) & 0xff;
  buf[off + 2] = (v >>> 8) & 0xff;
  buf[off + 3] = v & 0xff;
}

export interface SacnOptions {
  universe: number;
  data: Uint8Array;
  sequence: number;
  cid: Uint8Array;
  sourceName: string;
  priority?: number;
  syncAddress?: number;
  preview?: boolean;
  terminated?: boolean;
}

export function encodeSacnData(o: SacnOptions): Uint8Array {
  const slots = Math.min(512, o.data.length);
  const total = 126 + slots;
  const buf = new Uint8Array(total);
  // Root layer
  u16(buf, 0, 0x0010);
  u16(buf, 2, 0x0000);
  buf.set(ACN_ID, 4);
  u16(buf, 16, 0x7000 | (total - 16));
  u32(buf, 18, VECTOR_ROOT_E131_DATA);
  buf.set(o.cid.subarray(0, 16), 22);
  // Framing layer
  u16(buf, 38, 0x7000 | (total - 38));
  u32(buf, 40, VECTOR_E131_DATA_PACKET);
  const name = new TextEncoder().encode(o.sourceName).subarray(0, 63);
  buf.set(name, 44);
  buf[108] = Math.max(0, Math.min(200, o.priority ?? 100));
  u16(buf, 109, o.syncAddress ?? 0);
  buf[111] = o.sequence & 0xff;
  buf[112] = (o.preview ? 0x80 : 0) | (o.terminated ? 0x40 : 0);
  u16(buf, 113, o.universe);
  // DMP layer
  u16(buf, 115, 0x7000 | (total - 115));
  buf[117] = 0x02;
  buf[118] = 0xa1;
  u16(buf, 119, 0x0000);
  u16(buf, 121, 0x0001);
  u16(buf, 123, slots + 1);
  buf[125] = 0x00; // DMX start code
  buf.set(o.data.subarray(0, slots), 126);
  return buf;
}

export function encodeSacnSync(cid: Uint8Array, sequence: number, syncAddress: number): Uint8Array {
  const total = 49;
  const buf = new Uint8Array(total);
  u16(buf, 0, 0x0010);
  u16(buf, 2, 0);
  buf.set(ACN_ID, 4);
  u16(buf, 16, 0x7000 | (total - 16));
  u32(buf, 18, VECTOR_ROOT_E131_EXTENDED);
  buf.set(cid.subarray(0, 16), 22);
  u16(buf, 38, 0x7000 | (total - 38));
  u32(buf, 40, VECTOR_E131_EXTENDED_SYNCHRONIZATION);
  buf[44] = sequence & 0xff;
  u16(buf, 45, syncAddress);
  return buf;
}

export interface SacnPacket {
  universe: number;
  priority: number;
  sequence: number;
  sourceName: string;
  cid: string;
  preview: boolean;
  terminated: boolean;
  data: Uint8Array;
}

export function decodeSacnData(buf: Uint8Array): SacnPacket | null {
  if (buf.length < 126) return null;
  for (let i = 0; i < 12; i++) if (buf[4 + i] !== ACN_ID[i]) return null;
  const rootVector = (buf[18] << 24) | (buf[19] << 16) | (buf[20] << 8) | buf[21];
  if (rootVector !== VECTOR_ROOT_E131_DATA) return null;
  const framingVector = (buf[40] << 24) | (buf[41] << 16) | (buf[42] << 8) | buf[43];
  if (framingVector !== VECTOR_E131_DATA_PACKET) return null;
  if (buf[117] !== 0x02 || buf[125] !== 0x00) return null;
  const count = ((buf[123] << 8) | buf[124]) - 1;
  if (count < 0 || buf.length < 126 + count) return null;
  let end = 44;
  while (end < 108 && buf[end] !== 0) end++;
  return {
    universe: (buf[113] << 8) | buf[114],
    priority: buf[108],
    sequence: buf[111],
    sourceName: new TextDecoder().decode(buf.subarray(44, end)),
    cid: [...buf.subarray(22, 38)].map((b) => b.toString(16).padStart(2, '0')).join(''),
    preview: (buf[112] & 0x80) !== 0,
    terminated: (buf[112] & 0x40) !== 0,
    data: buf.slice(126, 126 + count),
  };
}

export function randomCid(): Uint8Array {
  const cid = new Uint8Array(16);
  for (let i = 0; i < 16; i++) cid[i] = Math.floor(Math.random() * 256);
  cid[6] = (cid[6] & 0x0f) | 0x40; // UUID v4
  cid[8] = (cid[8] & 0x3f) | 0x80;
  return cid;
}
