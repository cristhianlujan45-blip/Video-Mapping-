// tests/mp4mux.test.js — el empaquetador MP4 de «Exportar el show a video»: cajas bien formadas,
// índices que apuntan a las muestras y, si hay ffmpeg en el equipo, que un H.264/VP9/AAC real
// empaquetado se lee y se decodifica entero (sin errores) con ffprobe/ffmpeg.
import { test, report } from "./harness.js";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Mp4Muxer, MemorySink, aacConfig, opusDops, vpcC } from "../web/js/mp4mux.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lumamux-"));
const hasFfmpeg = (() => { try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); execFileSync("ffprobe", ["-version"], { stdio: "ignore" }); return true; } catch { return false; } })();
const ff = (...a) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...a], { stdio: ["ignore", "pipe", "pipe"] });
const probe = (f, count = true) => JSON.parse(execFileSync("ffprobe", ["-v", count ? "error" : "quiet", "-print_format", "json", "-show_streams", "-show_format", ...(count ? ["-count_frames"] : []), f]).toString());

/** Lee las cajas de primer nivel (y las de dentro de las que se piden). */
function boxes(buf, start = 0, end = buf.length) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength), out = [];
  for (let o = start; o < end;) {
    let size = dv.getUint32(o); const type = new TextDecoder().decode(buf.subarray(o + 4, o + 8));
    let hdr = 8;
    if (size === 1) { size = dv.getUint32(o + 8) * 2 ** 32 + dv.getUint32(o + 12); hdr = 16; }
    assert.ok(size >= hdr && o + size <= end, `caja ${type} con tamaño ${size} dentro de ${end - o}`);
    out.push({ type, start: o, hdr, size });
    o += size;
  }
  return out;
}
async function blobBytes(b) { return new Uint8Array(await b.arrayBuffer()); }
function muxToFile(mux, sink, name) {
  const { head, moov } = mux.finish();
  return blobBytes(sink.blob(head, moov)).then((bytes) => { const f = path.join(tmp, name); fs.writeFileSync(f, bytes); return { f, bytes }; });
}

/** H.264 Annex B → unidades de acceso en formato AVCC (longitud de 4 bytes) + avcC. */
function annexB(buf) {
  const nals = []; let i = 0, s = -1;
  while (i + 3 <= buf.length) {
    const sc3 = buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 1;
    if (sc3) { if (s >= 0) nals.push(buf.subarray(s, i > 0 && buf[i - 1] === 0 ? i - 1 : i)); s = i + 3; i += 3; } else i++;
  }
  if (s >= 0) nals.push(buf.subarray(s));
  let sps, pps; const aus = []; let cur = null;
  for (const n of nals) {
    const t = n[0] & 31;
    if (t === 7) { sps = n; continue; } if (t === 8) { pps = n; continue; } if (t === 9 || t === 6) continue;
    if (t === 1 || t === 5) {
      const first = (n[1] & 0x80) !== 0;   // first_mb_in_slice == 0
      if (first || !cur) { cur = { key: t === 5, parts: [] }; aus.push(cur); }
      cur.parts.push(n);
    }
  }
  const len = (n) => new Uint8Array([(n.length >>> 24) & 255, (n.length >>> 16) & 255, (n.length >>> 8) & 255, n.length & 255]);
  const cat = (...p) => { const o = new Uint8Array(p.reduce((s, x) => s + x.length, 0)); let k = 0; for (const x of p) { o.set(x, k); k += x.length; } return o; };
  const avcC = cat(new Uint8Array([1, sps[1], sps[2], sps[3], 0xff, 0xe1, sps.length >> 8, sps.length & 255]), sps, new Uint8Array([1, pps.length >> 8, pps.length & 255]), pps);
  return { avcC, frames: aus.map(a => ({ key: a.key, data: cat(...a.parts.flatMap(p => [len(p), p])) })) };
}
/** IVF (VP9) → fotogramas. */
function ivf(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength), hl = dv.getUint16(6, true), out = [];
  for (let o = hl; o + 12 <= buf.length;) { const n = dv.getUint32(o, true); const data = buf.subarray(o + 12, o + 12 + n); out.push({ data, key: (data[0] & 0x04) === 0 }); o += 12 + n; }
  // En VP9 el bit de «no clave» va tras marco y perfil: el primero siempre es clave.
  return out.map((f, i) => ({ ...f, key: i === 0 || f.key }));
}
/** ADTS (AAC) → tramas sin cabecera. */
function adts(buf) {
  const out = [];
  for (let o = 0; o + 7 <= buf.length;) {
    const prot = buf[o + 1] & 1, len = ((buf[o + 3] & 3) << 11) | (buf[o + 4] << 3) | (buf[o + 5] >> 5);
    out.push(buf.subarray(o + (prot ? 7 : 9), o + len)); o += len;
  }
  return out;
}

console.log("== Empaquetador MP4 (exportar el show) ==");
await test("estructura: ftyp, mdat de 64 bits y moov con una pista de video; los índices apuntan a cada muestra", async () => {
  const sink = new MemorySink();
  const mux = new Mp4Muxer({ video: { codec: "vp9", codecString: "vp09.00.51.08", width: 3840, height: 2160, fps: 30 }, sink });
  const frames = Array.from({ length: 12 }, (_, i) => new Uint8Array(100 + i).fill(i + 1));
  frames.forEach((d, i) => mux.addVideo(d, { key: i % 6 === 0, timestamp: i * 1e6 / 30, duration: 1e6 / 30 }));
  const { f, bytes } = await muxToFile(mux, sink, "estructura.mp4");
  const top = boxes(bytes);
  assert.deepEqual(top.map(b => b.type), ["ftyp", "mdat", "moov"]);
  assert.equal(top[1].hdr, 16, "mdat con tamaño de 64 bits (para shows largos en 4K)");
  assert.equal(top[1].size, 16 + frames.reduce((s, d) => s + d.length, 0));
  // co64: cada desplazamiento apunta a los bytes de su fotograma.
  const txt = Buffer.from(bytes);
  const at = txt.indexOf("co64"), dv = new DataView(bytes.buffer, bytes.byteOffset);
  const n = dv.getUint32(at + 8);
  assert.equal(n, 12);
  for (let k = 0; k < n; k++) { const off = dv.getUint32(at + 12 + k * 8) * 2 ** 32 + dv.getUint32(at + 16 + k * 8); assert.equal(bytes[off], k + 1); }
  // stss: solo los fotogramas clave (1 y 7).
  const ss = txt.indexOf("stss"); assert.equal(dv.getUint32(ss + 8), 2); assert.equal(dv.getUint32(ss + 12), 1); assert.equal(dv.getUint32(ss + 16), 7);
  assert.ok(mux.duration > 0.39 && mux.duration < 0.41);
  if (hasFfmpeg) { const p = probe(f, false); assert.equal(p.streams[0].codec_name, "vp9"); assert.equal(p.streams[0].width, 3840); assert.equal(+p.format.duration, 0.4); }
});
await test("configuraciones: AAC-LC, Opus (dOps desde OpusHead) y VP9 (vpcC)", () => {
  assert.deepEqual([...aacConfig(48000, 2)], [0x11, 0x90]);
  assert.deepEqual([...aacConfig(44100, 2)], [0x12, 0x10]);
  const head = new Uint8Array([...Buffer.from("OpusHead"), 1, 2, 0x38, 0x01, 0x80, 0xbb, 0, 0, 0, 0, 0]);
  const d = opusDops(48000, 2, head);
  assert.equal(Buffer.from(d.subarray(4, 8)).toString(), "dOps");
  assert.deepEqual([...d.subarray(8)], [0, 2, 0x01, 0x38, 0, 0, 0xbb, 0x80, 0, 0, 0]);   // pre-skip 312, 48 kHz, big-endian
  const v = vpcC("vp09.00.51.08");
  assert.deepEqual([...v.subarray(12)], [0, 51, 0x82, 1, 1, 1, 0, 0]);
});
await test("H.264 + AAC reales (de ffmpeg) empaquetados: ffprobe los lee y ffmpeg los decodifica enteros", async () => {
  if (!hasFfmpeg) { console.log("    (sin ffmpeg en este equipo: se omite)"); return; }
  const h264 = path.join(tmp, "in.h264"), aac = path.join(tmp, "in.aac");
  ff("-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "25", "-bf", "0", "-bsf:v", "h264_mp4toannexb", "-f", "h264", h264);
  ff("-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2", "-ac", "2", "-c:a", "aac", "-b:a", "128k", "-f", "adts", aac);
  const { avcC, frames } = annexB(new Uint8Array(fs.readFileSync(h264)));
  assert.equal(frames.length, 50);
  const aframes = adts(new Uint8Array(fs.readFileSync(aac)));
  const sink = new MemorySink();
  const mux = new Mp4Muxer({ video: { codec: "avc", width: 640, height: 360, fps: 25 }, audio: { codec: "aac", sampleRate: 48000, channels: 2 }, sink });
  mux.setVideoDescription(avcC);
  // Intercalados como los da el codificador.
  let ai = 0;
  frames.forEach((fr, i) => {
    mux.addVideo(fr.data, { key: fr.key, timestamp: i * 40000, duration: 40000 });
    while (ai < aframes.length && ai * 1024 / 48000 <= (i + 1) / 25) mux.addAudio(aframes[ai++], { duration: 1024 / 48000 * 1e6 });
  });
  while (ai < aframes.length) mux.addAudio(aframes[ai++], { duration: 1024 / 48000 * 1e6 });
  const { f } = await muxToFile(mux, sink, "h264-aac.mp4");
  const p = probe(f);
  const vs = p.streams.find(s => s.codec_type === "video"), as = p.streams.find(s => s.codec_type === "audio");
  assert.equal(vs.codec_name, "h264"); assert.equal(+vs.nb_read_frames, 50); assert.equal(vs.r_frame_rate, "25/1");
  assert.equal(as.codec_name, "aac"); assert.equal(+as.sample_rate, 48000); assert.equal(+as.channels, 2);
  assert.ok(Math.abs(+p.format.duration - 2) < 0.1, "dura 2 s");
  // Decodificar todo: sin errores.
  const err = execFileSync("ffmpeg", ["-v", "error", "-i", f, "-f", "null", "-"], { stdio: ["ignore", "pipe", "pipe"] }).toString();
  assert.equal(err.trim(), "");
});
await test("VP9 real (de ffmpeg) empaquetado: se decodifica entero", async () => {
  if (!hasFfmpeg) { console.log("    (sin ffmpeg en este equipo: se omite)"); return; }
  const src = path.join(tmp, "in.ivf");
  ff("-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30:duration=1", "-c:v", "libvpx-vp9", "-g", "15", "-deadline", "realtime", "-cpu-used", "8", "-f", "ivf", src);
  const frames = ivf(new Uint8Array(fs.readFileSync(src)));
  const sink = new MemorySink();
  const mux = new Mp4Muxer({ video: { codec: "vp9", codecString: "vp09.00.10.08", width: 320, height: 180, fps: 30 }, sink });
  frames.forEach((fr, i) => mux.addVideo(fr.data, { key: fr.key, timestamp: i * 1e6 / 30, duration: 1e6 / 30 }));
  const { f } = await muxToFile(mux, sink, "vp9.mp4");
  const p = probe(f);
  assert.equal(p.streams[0].codec_name, "vp9"); assert.equal(+p.streams[0].nb_read_frames, frames.length);
  const err = execFileSync("ffmpeg", ["-v", "error", "-i", f, "-f", "null", "-"], { stdio: ["ignore", "pipe", "pipe"] }).toString();
  assert.equal(err.trim(), "");
});

fs.rmSync(tmp, { recursive: true, force: true });
report();
