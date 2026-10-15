// web/js/mp4mux.js
// Empaquetador MP4 propio (sin dependencias) para «Exportar el show a video».
// Recibe lo que ya sale codificado de WebCodecs y lo guarda en un .mp4 normal:
//   · video H.264 (avc1 + avcC) o VP9 (vp09 + vpcC);
//   · audio AAC (mp4a + esds) u Opus (Opus + dOps), opcional.
// Se escribe por partes: cabecera (ftyp + mdat de 64 bits), las muestras según llegan y el índice
// (moov) al final; al terminar se corrige el tamaño de mdat. Así un show largo en 4K puede ir
// directo al disco sin tenerlo entero en memoria.

const enc = new TextEncoder();
const u8 = (...parts) => {
  let n = 0; for (const p of parts) n += p.length;
  const out = new Uint8Array(n); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const u16 = (v) => new Uint8Array([(v >>> 8) & 255, v & 255]);
const u32 = (v) => new Uint8Array([(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]);
const u64 = (v) => u8(u32(Math.floor(v / 2 ** 32)), u32(v >>> 0));
const str = (s) => enc.encode(s);
const zeros = (n) => new Uint8Array(n);
const box = (type, ...kids) => { const body = u8(...kids); return u8(u32(body.length + 8), str(type), body); };
const full = (type, version, flags, ...kids) => box(type, new Uint8Array([version, (flags >>> 16) & 255, (flags >>> 8) & 255, flags & 255]), ...kids);
const MATRIX = u8(u32(0x10000), u32(0), u32(0), u32(0), u32(0x10000), u32(0), u32(0), u32(0), u32(0x40000000));

/** Tabla de tiempos compacta (stts): duraciones iguales seguidas en una sola entrada. */
function sttsOf(durs) {
  const runs = [];
  for (const d of durs) { const r = runs.at(-1); if (r && r[1] === d) r[0]++; else runs.push([1, d]); }
  return full("stts", 0, 0, u32(runs.length), ...runs.map(([c, d]) => u8(u32(c), u32(d))));
}

/** Descriptor MPEG-4 (esds) con su tamaño en 4 bytes. */
const desc = (tag, ...kids) => { const b = u8(...kids); return u8(new Uint8Array([tag, 0x80 | ((b.length >>> 21) & 127), 0x80 | ((b.length >>> 14) & 127), 0x80 | ((b.length >>> 7) & 127), b.length & 127]), b); };
const AAC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
/** AudioSpecificConfig de AAC-LC (si el codificador no lo da). */
export function aacConfig(sampleRate, channels) {
  const fi = Math.max(0, AAC_RATES.indexOf(sampleRate));
  return u16((2 << 11) | (fi << 7) | (channels << 3));
}
/** dOps (MP4) a partir del OpusHead que da el codificador (o valores típicos). */
export function opusDops(sampleRate, channels, head) {
  let preSkip = 312, rate = sampleRate, gain = 0;
  if (head && head.length >= 19 && new TextDecoder().decode(head.subarray(0, 8)) === "OpusHead") {
    const dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
    preSkip = dv.getUint16(10, true); rate = dv.getUint32(12, true) || sampleRate; gain = dv.getInt16(16, true);
  }
  return box("dOps", new Uint8Array([0, channels]), u16(preSkip), u32(rate), u16(gain & 0xffff), new Uint8Array([0]));
}
/** vpcC (VP9) a partir de la cadena del códec «vp09.PP.LL.DD». */
export function vpcC(codec) {
  const [, p = "00", l = "10", d = "08"] = String(codec).split(".");
  return full("vpcC", 1, 0, new Uint8Array([+p, +l, ((+d) << 4) | (1 << 1) | 0, 1, 1, 1]), u16(0));
}

export class Mp4Muxer {
  /**
   * video: { codec: "avc"|"vp9", codecString, width, height, fps, description? (avcC) }
   * audio (opcional): { codec: "aac"|"opus", sampleRate, channels, description? }
   * sink: { write(Uint8Array) } — las muestras se mandan según llegan.
   */
  constructor({ video, audio = null, sink }) {
    this.v = { ...video, timescale: Math.round(video.fps * 1000), sizes: [], offs: [], durs: [], keys: [] };
    this.a = audio ? { ...audio, timescale: audio.sampleRate, sizes: [], offs: [], durs: [] } : null;
    this.sink = sink;
    this.ftyp = box("ftyp", str("isom"), u32(0x200), str("isom"), str("iso2"), str(video.codec === "avc" ? "avc1" : "vp09"), str("mp41"));
    this.pos = this.ftyp.length + 16;   // tras ftyp y la cabecera de mdat (64 bits)
    this.mdatStart = this.ftyp.length;
    this.lastVts = null;
  }
  /** Cabecera provisional (se escribe primero; se reescribe al final con el tamaño bueno). */
  head(mdatSize = 0) { return u8(this.ftyp, u32(1), str("mdat"), u64(mdatSize + 16)); }

  addVideo(data, { key, timestamp, duration }) {
    const v = this.v;
    // Duración en la escala de tiempo de la pista (fps × 1000): a ritmo fijo, 1000 por fotograma.
    const d = Math.max(1, Math.round((duration || 1e6 / v.fps) * v.timescale / 1e6));
    v.sizes.push(data.length); v.offs.push(this.pos); v.durs.push(d); if (key) v.keys.push(v.sizes.length);
    this.pos += data.length; this.sink.write(data);
  }
  addAudio(data, { duration }) {
    const a = this.a; if (!a) return;
    const d = Math.max(1, Math.round((duration || 0) * a.timescale / 1e6)) || (a.codec === "aac" ? 1024 : 960);
    a.sizes.push(data.length); a.offs.push(this.pos); a.durs.push(d);
    this.pos += data.length; this.sink.write(data);
  }
  /** Pone la configuración que da el codificador al empezar (avcC, AudioSpecificConfig, OpusHead). */
  setVideoDescription(d) { if (d) this.v.description = new Uint8Array(d.buffer ? d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) : d); }
  setAudioDescription(d) { if (d && this.a) this.a.description = new Uint8Array(d.buffer ? d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) : d); }

  get duration() { return this.v.durs.reduce((s, d) => s + d, 0) / this.v.timescale; }

  /** Índice final: { head (reescribir en la posición 0), moov (añadir al final) }. */
  finish() {
    const mdatSize = this.pos - this.mdatStart - 16;
    const durMs = (t) => Math.round(t.durs.reduce((s, d) => s + d, 0) * 1000 / t.timescale);
    const tracks = [this.trakVideo(1, durMs(this.v))];
    if (this.a && this.a.sizes.length) tracks.push(this.trakAudio(2, durMs(this.a)));
    const movieMs = Math.max(durMs(this.v), this.a?.sizes.length ? durMs(this.a) : 0);
    const mvhd = full("mvhd", 0, 0, u32(0), u32(0), u32(1000), u32(movieMs), u32(0x10000), u16(0x100), zeros(10), MATRIX, zeros(24), u32(tracks.length + 1));
    return { head: this.head(mdatSize), moov: box("moov", mvhd, ...tracks) };
  }

  stblCommon(t) {
    return [
      sttsOf(t.durs),
      ...(t.keys && t.keys.length < t.sizes.length ? [full("stss", 0, 0, u32(t.keys.length), ...t.keys.map(u32))] : []),
      full("stsc", 0, 0, u32(1), u32(1), u32(1), u32(1)),               // una muestra por bloque
      full("stsz", 0, 0, u32(0), u32(t.sizes.length), ...t.sizes.map(u32)),
      full("co64", 0, 0, u32(t.offs.length), ...t.offs.map(u64)),
    ];
  }
  trak(id, ms, t, hdlrType, name, mediaHeader, stsd, tkhdTail) {
    const mdhd = full("mdhd", 0, 0, u32(0), u32(0), u32(t.timescale), u32(t.durs.reduce((s, d) => s + d, 0)), u16(0x55c4), u16(0));
    const hdlr = full("hdlr", 0, 0, u32(0), str(hdlrType), zeros(12), str(name), new Uint8Array([0]));
    const dinf = box("dinf", full("dref", 0, 0, u32(1), full("url ", 0, 1)));
    const stbl = box("stbl", stsd, ...this.stblCommon(t));
    const tkhd = full("tkhd", 0, 3, u32(0), u32(0), u32(id), u32(0), u32(ms), zeros(8), tkhdTail);
    return box("trak", tkhd, box("mdia", mdhd, hdlr, box("minf", mediaHeader, dinf, stbl)));
  }
  trakVideo(id, ms) {
    const v = this.v;
    const cfg = v.codec === "avc" ? box("avcC", v.description || zeros(0)) : vpcC(v.codecString);
    const entry = box(v.codec === "avc" ? "avc1" : "vp09", zeros(6), u16(1), zeros(16), u16(v.width), u16(v.height),
      u32(0x480000), u32(0x480000), u32(0), u16(1), zeros(32), u16(0x18), u16(0xffff), cfg);
    const stsd = full("stsd", 0, 0, u32(1), entry);
    const tail = u8(u16(0), u16(0), u16(0), u16(0), MATRIX, u32(v.width * 65536), u32(v.height * 65536));
    return this.trak(id, ms, v, "vide", "LumaMap video", full("vmhd", 0, 1, zeros(8)), stsd, tail);
  }
  trakAudio(id, ms) {
    const a = this.a;
    let cfg;
    if (a.codec === "aac") {
      const asc = a.description && a.description.length ? a.description : aacConfig(a.sampleRate, a.channels);
      cfg = full("esds", 0, 0, desc(3, u16(id), new Uint8Array([0]),
        desc(4, new Uint8Array([0x40, 0x15]), new Uint8Array([0, 0, 0]), u32(192000), u32(192000), desc(5, asc)),
        desc(6, new Uint8Array([2]))));
    } else cfg = opusDops(a.sampleRate, a.channels, a.description);
    const entry = box(a.codec === "aac" ? "mp4a" : "Opus", zeros(6), u16(1), zeros(8), u16(a.channels), u16(16), u16(0), u16(0), u32(a.sampleRate * 65536), cfg);
    const stsd = full("stsd", 0, 0, u32(1), entry);
    const tail = u8(u16(0), u16(0), u16(0x100), u16(0), MATRIX, u32(0), u32(0));
    return this.trak(id, ms, a, "soun", "LumaMap audio", full("smhd", 0, 0, u32(0)), stsd, tail);
  }
}

/** Para guardar en memoria (móvil, navegador sin acceso a archivos): un Blob al final. */
export class MemorySink {
  constructor() { this.parts = []; this.bytes = 0; }
  write(d) { this.parts.push(d); this.bytes += d.length; }
  blob(head, moov) { return new Blob([head, ...this.parts, moov], { type: "video/mp4" }); }
}
