// server/osc.js
// Codec OSC 1.0 (Open Sound Control) mínimo y correcto: mensajes con
// argumentos i (int32), f (float32), s (string), T/F (booleanos sin payload).
// Sin bundles (documentado en README). Usado por el backend para control externo.

function pad4(n) { return (4 - (n % 4)) % 4; }

export function encodeOSC(address, args = []) {
  const tags = "," + args.map(a => a.type).join("");
  const chunks = [];
  const str = (s) => {
    const b = Buffer.from(s + "\0", "utf8");
    return Buffer.concat([b, Buffer.alloc(pad4(b.length))]);
  };
  chunks.push(str(address));
  chunks.push(str(tags));
  for (const a of args) {
    if (a.type === "i") { const b = Buffer.alloc(4); b.writeInt32BE(a.value | 0, 0); chunks.push(b); }
    else if (a.type === "f") { const b = Buffer.alloc(4); b.writeFloatBE(a.value, 0); chunks.push(b); }
    else if (a.type === "s") chunks.push(str(String(a.value)));
    else if (a.type === "T" || a.type === "F") { /* sin payload */ }
    else throw new Error("encodeOSC: tipo no soportado " + a.type);
  }
  return Buffer.concat(chunks);
}

function readString(buf, off) {
  let end = off;
  while (end < buf.length && buf[end] !== 0) end++;
  const s = buf.toString("utf8", off, end);
  const next = end + 1 + pad4(end + 1 - off);
  return [s, next];
}

export function decodeOSC(buf) {
  let off = 0;
  const [address, o1] = readString(buf, off); off = o1;
  const [tags, o2] = readString(buf, off); off = o2;
  if (!tags.startsWith(",")) throw new Error("decodeOSC: falta typetag");
  const args = [];
  for (const t of tags.slice(1)) {
    if (t === "i") { args.push({ type: "i", value: buf.readInt32BE(off) }); off += 4; }
    else if (t === "f") { args.push({ type: "f", value: buf.readFloatBE(off) }); off += 4; }
    else if (t === "s") { const [s, no] = readString(buf, off); args.push({ type: "s", value: s }); off = no; }
    else if (t === "T") args.push({ type: "T", value: true });
    else if (t === "F") args.push({ type: "F", value: false });
    else throw new Error("decodeOSC: typetag no soportado " + t);
  }
  return { address, args };
}
