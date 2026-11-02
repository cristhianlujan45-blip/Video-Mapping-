// tests/dmx.test.js — protocolos Art-Net / sACN y parcheo de píxeles (sin red).
import { test, report } from "./harness.js";
import assert from "node:assert/strict";
import * as P from "../web/js/dmxproto.js";

console.log("== Art-Net / sACN / pixel mapping ==");

await test("ArtDmx: cabecera exacta (ID, OpCode 0x5000, versión 14, Net/SubUni, longitud par)", () => {
  const data = new Uint8Array(512); data[0] = 255; data[511] = 7;
  const pa = P.portAddress(1, 2, 3);
  const pkt = P.artDmx(pa, data, 9);
  assert.equal(pkt.length, 530);
  assert.equal(String.fromCharCode(...pkt.slice(0, 7)), "Art-Net");
  assert.deepEqual([pkt[7], pkt[8], pkt[9], pkt[10], pkt[11]], [0, 0x00, 0x50, 0, 14]);
  assert.equal(pkt[12], 9);
  assert.equal(pkt[14], 0x23); assert.equal(pkt[15], 1);          // SubUni = sub<<4|uni, Net
  assert.deepEqual([pkt[16], pkt[17]], [2, 0]);                   // 512 big endian
  assert.equal(pkt[18], 255); assert.equal(pkt[529], 7);
  const back = P.parseArtNet(pkt);
  assert.equal(back.op, "dmx"); assert.equal(back.portAddress, pa); assert.equal(back.data[511], 7);
  assert.equal(P.artDmx(0, new Uint8Array(3)).length, 18 + 4);    // longitud mínima par
});

await test("ArtPoll y ArtPollReply: nombre, IP, fabricante y universos de salida", () => {
  const poll = P.artPoll();
  assert.equal(P.parseArtNet(poll).op, "poll");
  assert.equal(poll[12], 0x02);
  const r = P.parseArtNet(P.artPollReply({ ip: "2.0.0.10", shortName: "Nodo 4", longName: "Nodo LED de prueba", net: 0, sub: 1, outputs: [0, 1, 2, 3] }));
  assert.equal(r.op, "pollReply"); assert.equal(r.ip, "2.0.0.10"); assert.equal(r.shortName, "Nodo 4");
  assert.deepEqual(r.outputs, [16, 17, 18, 19]);
});

await test("sACN E1.31: capas, longitudes, prioridad, universo y multicast", () => {
  const data = new Uint8Array(512).map((_, i) => i & 255);
  const cid = new Uint8Array(16).fill(7);
  const pkt = P.sacnPacket(5, data, { sequence: 42, priority: 150, cid });
  assert.equal(pkt.length, 638);
  const dv = new DataView(pkt.buffer);
  assert.equal(dv.getUint16(16) & 0x0fff, 622); assert.equal(dv.getUint16(38) & 0x0fff, 600); assert.equal(dv.getUint16(115) & 0x0fff, 523);
  assert.equal(String.fromCharCode(...pkt.slice(4, 13)), "ASC-E1.17");
  const back = P.parseSacn(pkt);
  assert.equal(back.universe, 5); assert.equal(back.priority, 150); assert.equal(back.sequence, 42); assert.equal(back.sourceName, "LumaMap");
  assert.deepEqual([...back.data.slice(0, 4)], [0, 1, 2, 3]);
  assert.equal(P.sacnMulticast(5), "239.255.0.5"); assert.equal(P.sacnMulticast(300), "239.255.1.44");
});

await test("AUTO SPAN + ALIGN: 170 píxeles RGB por universo; RGBW 128; sin partir píxeles", () => {
  const rgb = P.patchPixels(400, { order: "RGB" });
  assert.deepEqual(rgb.patch[169], { universe: 1, channel: 508 });
  assert.deepEqual(rgb.patch[170], { universe: 2, channel: 1 });
  assert.equal(rgb.lastUniverse, 3);
  const w = P.patchPixels(300, { order: "RGBW", startUniverse: 4, startChannel: 5 });
  assert.deepEqual(w.patch[126], { universe: 4, channel: 509 });
  assert.deepEqual(w.patch[127], { universe: 5, channel: 1 });
  // Sin ALIGN el píxel 171 queda partido (canales 511, 512 y 1 del siguiente)
  const noAlign = P.patchPixels(200, { order: "RGB", startChannel: 2, align: false });
  assert.deepEqual(noAlign.patch[170], { universe: 1, channel: 512 });
  const bufs = new Map(), bufFor = (u) => { if (!bufs.has(u)) bufs.set(u, new Uint8Array(512)); return bufs.get(u); };
  P.writePixel(bufFor, 1, 511, "RGB", [10, 20, 30]);
  assert.deepEqual([bufs.get(1)[510], bufs.get(1)[511], bufs.get(2)[0]], [10, 20, 30]);
  // Sin AUTO SPAN lo que no cabe se queda sin canal
  assert.equal(P.patchPixels(200, { order: "RGB", autoSpan: false }).patch.filter(Boolean).length, 170);
});

await test("orden de color GRB y conversión a RGBW", () => {
  const b = new Uint8Array(512);
  P.writePixel(() => b, 1, 1, "GRB", [1, 2, 3]);
  assert.deepEqual([...b.slice(0, 3)], [2, 1, 3]);
  assert.deepEqual(P.rgbToRgbw(200, 100, 50).slice(0, 4), [150, 50, 0, 50]);
});

await test("posiciones: matriz con zig-zag, arriba→abajo, círculo e inversión", () => {
  const g = P.pixelPositions({ shape: "grid", x: 0, y: 0, w: 1, h: 1, cols: 3, rows: 2, serpentine: true, order: "ltr" });
  assert.deepEqual(g.map(p => p.map(v => +v.toFixed(3))), [[0.167, 0.25], [0.5, 0.25], [0.833, 0.25], [0.833, 0.75], [0.5, 0.75], [0.167, 0.75]]);
  const v = P.pixelPositions({ shape: "grid", x: 0, y: 0, w: 1, h: 1, cols: 2, rows: 2, order: "ttb" });
  assert.deepEqual(v.map(p => p.map(x => +x.toFixed(2))), [[0.25, 0.25], [0.25, 0.75], [0.75, 0.25], [0.75, 0.75]]);
  const c = P.pixelPositions({ shape: "circle", x: 0, y: 0, w: 1, h: 1, count: 4 });
  assert.deepEqual(c.map(p => p.map(x => +x.toFixed(2))), [[1, 0.5], [0.5, 1], [0, 0.5], [0.5, 0]]);
  const l = P.pixelPositions({ shape: "line", x: 0, y: 0, w: 1, h: 0, count: 3, reverse: true });
  assert.deepEqual(l.map(p => p[0]), [1, 0.5, 0]);
});

report();
