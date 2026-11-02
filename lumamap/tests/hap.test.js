// tests/hap.test.js — HAP (Hap1/DXT1) y el .wav aparte: se codifican aquí y, si hay ffmpeg en el
// equipo, se decodifican con él (un reproductor de verdad) y se comparan píxel a píxel.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { test, report } from "./harness.js";
import { dxt1Block, dxt1Decode, encodeHapFrame, hapSize, encodeWav } from "../web/js/hap.js";
import { Mp4Muxer, MemorySink } from "../web/js/mp4mux.js";

const ffmpeg = (() => { for (const p of [process.env.FFMPEG, "/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg"]) if (p && fs.existsSync(p)) return p; return null; })();
const frame = (w, h, t) => { const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; d[i] = (x * 255 / w + t * 40) % 256; d[i + 1] = y * 255 / h; d[i + 2] = 128 + 100 * Math.sin((x + y) / 9); d[i + 3] = 255; } return d; };
const psnr = (a, b) => { let e = 0, n = 0; for (let i = 0; i < a.length; i += 4) for (let c = 0; c < 3; c++) { const d = a[i + c] - b[i + c]; e += d * d; n++; } return 10 * Math.log10(255 * 255 / (e / n)); };

console.log("== HAP y audio aparte ==");
await test("DXT1: un bloque de un color sale exacto y un degradado se parece mucho", () => {
  const out = new Uint8Array(8), px = new Uint8Array(64);
  for (let i = 0; i < 64; i += 4) { px[i] = 255; px[i + 1] = 0; px[i + 2] = 0; px[i + 3] = 255; }
  dxt1Block(px, out, 0);
  assert.deepEqual(dxt1Decode(out)[5].map(Math.round), [255, 0, 0]);
  for (let i = 0; i < 16; i++) { px[i * 4] = i * 16; px[i * 4 + 1] = 255 - i * 16; px[i * 4 + 2] = 60; }
  dxt1Block(px, out, 0);
  const dec = dxt1Decode(out), err = dec.reduce((s, c, i) => s + Math.abs(c[0] - i * 16) + Math.abs(c[1] - (255 - i * 16)), 0) / 32;
  assert.ok(err < 20, "error medio por canal (4 colores para 240 niveles: ~15 es lo mínimo): " + err.toFixed(1));
});
await test("fotograma HAP: cabecera de sección (tamaño + 0xAB) y bloques; tamaños que no son múltiplo de 4", () => {
  const f = encodeHapFrame(frame(10, 6, 0), 10, 6);
  const [W, H] = hapSize(10, 6), size = (W / 4) * (H / 4) * 8;
  assert.deepEqual([W, H], [12, 8]);
  assert.equal(f.length, 4 + size); assert.equal(f[3], 0xab); assert.equal(f[0] | (f[1] << 8) | (f[2] << 16), size);
});
await test("audio aparte: .wav PCM de 16 bits", () => {
  const n = 4800, l = new Float32Array(n).map((_, i) => Math.sin(i / 10)), wav = encodeWav([l, l], 48000);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), "RIFF"); assert.equal(wav.length, 44 + n * 4);
  const dv = new DataView(wav.buffer); assert.equal(dv.getUint16(22, true), 2); assert.equal(dv.getUint32(24, true), 48000);
});
await test("un .mov HAP de 1 s que ffmpeg (el de un reproductor) lee: 30 fotogramas, Hap1, y la imagen se parece (PSNR > 30 dB)", () => {
  if (!ffmpeg) return console.log("    (sin ffmpeg en este equipo: solo lo de arriba)");
  const w = 160, h = 90, fps = 30, sink = new MemorySink();
  const mux = new Mp4Muxer({ video: { codec: "hap", width: w, height: h, fps }, sink });
  const frames = [];
  for (let i = 0; i < fps; i++) { const f = frame(w, h, i); frames.push(f); mux.addVideo(encodeHapFrame(f, w, h), { key: true, timestamp: i * 1e6 / fps, duration: 1e6 / fps }); }
  const { head, moov } = mux.finish();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hap-")), file = path.join(dir, "prueba.mov");
  fs.writeFileSync(file, Buffer.concat([head, ...sink.parts, moov]));
  let probe = "";
  try { execFileSync(ffmpeg, ["-hide_banner", "-i", file], { stdio: "pipe" }); } catch (e) { probe = String(e.stderr || ""); }
  assert.match(probe, /Video: hap.*160x90/i, probe.slice(0, 400));
  const raw = execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "rgba", "-"], { maxBuffer: 1 << 26 });
  assert.equal(raw.length, w * h * 4 * fps, "30 fotogramas enteros");
  const p = psnr(frames[7], raw.subarray(7 * w * h * 4, 8 * w * h * 4));
  assert.ok(p > 30, "PSNR " + p.toFixed(1) + " dB");
  fs.rmSync(dir, { recursive: true, force: true });
});
report();
