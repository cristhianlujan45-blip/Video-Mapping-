/**
 * OSC 1.0 message/bundle encoding and decoding (types i f s b T F N I d h t).
 */

export type OscArg =
  | { type: 'i'; value: number }
  | { type: 'f'; value: number }
  | { type: 'd'; value: number }
  | { type: 'h'; value: bigint }
  | { type: 's'; value: string }
  | { type: 'b'; value: Uint8Array }
  | { type: 'T' | 'F' | 'N' | 'I'; value: boolean | null }
  | { type: 't'; value: bigint };

export interface OscMessage {
  address: string;
  args: OscArg[];
}

export interface OscBundle {
  timetag: bigint;
  elements: (OscMessage | OscBundle)[];
}

const pad4 = (n: number) => (n + 3) & ~3;

function encodeString(s: string): Uint8Array {
  const bytes = new TextEncoder().encode(s);
  const out = new Uint8Array(pad4(bytes.length + 1));
  out.set(bytes);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function encodeMessage(msg: OscMessage): Uint8Array {
  const parts: Uint8Array[] = [encodeString(msg.address), encodeString(',' + msg.args.map((a) => a.type).join(''))];
  for (const a of msg.args) {
    switch (a.type) {
      case 'i': {
        const b = new Uint8Array(4);
        new DataView(b.buffer).setInt32(0, a.value);
        parts.push(b);
        break;
      }
      case 'f': {
        const b = new Uint8Array(4);
        new DataView(b.buffer).setFloat32(0, a.value);
        parts.push(b);
        break;
      }
      case 'd': {
        const b = new Uint8Array(8);
        new DataView(b.buffer).setFloat64(0, a.value);
        parts.push(b);
        break;
      }
      case 'h':
      case 't': {
        const b = new Uint8Array(8);
        new DataView(b.buffer).setBigUint64(0, BigInt.asUintN(64, a.value));
        parts.push(b);
        break;
      }
      case 's':
        parts.push(encodeString(a.value));
        break;
      case 'b': {
        const b = new Uint8Array(4 + pad4(a.value.length));
        new DataView(b.buffer).setInt32(0, a.value.length);
        b.set(a.value, 4);
        parts.push(b);
        break;
      }
      default:
        break;
    }
  }
  return concat(parts);
}

export function encodeBundle(b: OscBundle): Uint8Array {
  const parts: Uint8Array[] = [encodeString('#bundle')];
  const tt = new Uint8Array(8);
  new DataView(tt.buffer).setBigUint64(0, b.timetag);
  parts.push(tt);
  for (const e of b.elements) {
    const data = 'address' in e ? encodeMessage(e) : encodeBundle(e);
    const size = new Uint8Array(4);
    new DataView(size.buffer).setInt32(0, data.length);
    parts.push(size, data);
  }
  return concat(parts);
}

function readString(buf: Uint8Array, off: number): [string, number] {
  let end = off;
  while (end < buf.length && buf[end] !== 0) end++;
  if (end >= buf.length) throw new Error('OSC: string sin terminar');
  return [new TextDecoder().decode(buf.subarray(off, end)), pad4(end + 1)];
}

export function decodePacket(buf: Uint8Array): (OscMessage | OscBundle) {
  if (buf.length >= 8 && buf[0] === 0x23 /* # */) {
    const [tag, off0] = readString(buf, 0);
    if (tag === '#bundle') {
      const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      const timetag = dv.getBigUint64(off0);
      let off = off0 + 8;
      const elements: (OscMessage | OscBundle)[] = [];
      while (off + 4 <= buf.length) {
        const size = dv.getInt32(off);
        off += 4;
        if (size <= 0 || off + size > buf.length) break;
        elements.push(decodePacket(buf.subarray(off, off + size)));
        off += size;
      }
      return { timetag, elements };
    }
  }
  return decodeMessage(buf);
}

export function decodeMessage(buf: Uint8Array): OscMessage {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const [address, o1] = readString(buf, 0);
  if (!address.startsWith('/')) throw new Error('OSC: dirección inválida');
  if (o1 >= buf.length) return { address, args: [] };
  const [tags, o2] = readString(buf, o1);
  let off = o2;
  const args: OscArg[] = [];
  for (const t of tags.slice(1)) {
    switch (t) {
      case 'i':
        args.push({ type: 'i', value: dv.getInt32(off) });
        off += 4;
        break;
      case 'f':
        args.push({ type: 'f', value: dv.getFloat32(off) });
        off += 4;
        break;
      case 'd':
        args.push({ type: 'd', value: dv.getFloat64(off) });
        off += 8;
        break;
      case 'h':
        args.push({ type: 'h', value: dv.getBigInt64(off) });
        off += 8;
        break;
      case 't':
        args.push({ type: 't', value: dv.getBigUint64(off) });
        off += 8;
        break;
      case 's':
      case 'S': {
        const [s, n] = readString(buf, off);
        args.push({ type: 's', value: s });
        off = n;
        break;
      }
      case 'b': {
        const len = dv.getInt32(off);
        args.push({ type: 'b', value: buf.slice(off + 4, off + 4 + len) });
        off += 4 + pad4(len);
        break;
      }
      case 'T':
        args.push({ type: 'T', value: true });
        break;
      case 'F':
        args.push({ type: 'F', value: false });
        break;
      case 'N':
        args.push({ type: 'N', value: null });
        break;
      case 'I':
        args.push({ type: 'I', value: true });
        break;
      default:
        throw new Error(`OSC: tipo no soportado '${t}'`);
    }
  }
  return { address, args };
}

/** First numeric value of a message as a number (bools → 0/1). */
export function firstNumber(msg: OscMessage): number | null {
  for (const a of msg.args) {
    if (a.type === 'i' || a.type === 'f' || a.type === 'd') return a.value;
    if (a.type === 'h') return Number(a.value);
    if (a.type === 'T') return 1;
    if (a.type === 'F') return 0;
  }
  return null;
}

/** OSC address pattern matching (?, *, [abc], [!a-z], {foo,bar}). */
export function matchAddress(pattern: string, address: string): boolean {
  let re = '^';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '[') {
      const end = pattern.indexOf(']', i);
      if (end < 0) return false;
      let body = pattern.slice(i + 1, end);
      if (body.startsWith('!')) body = '^' + body.slice(1);
      re += `[${body.replace(/\\/g, '\\\\')}]`;
      i = end;
    } else if (c === '{') {
      const end = pattern.indexOf('}', i);
      if (end < 0) return false;
      re += `(?:${pattern
        .slice(i + 1, end)
        .split(',')
        .map((s) => s.replace(/[.+^$()|\\]/g, '\\$&'))
        .join('|')})`;
      i = end;
    } else re += c.replace(/[.+^$()|\\]/g, '\\$&');
  }
  return new RegExp(re + '$').test(address);
}

/** NTP timetag ↔ seconds since 1900. */
export const timetagToSeconds = (t: bigint) => Number(t >> 32n) + Number(t & 0xffffffffn) / 2 ** 32;
