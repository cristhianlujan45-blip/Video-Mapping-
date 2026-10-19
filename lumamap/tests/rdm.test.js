// tests/rdm.test.js — RDM (E1.20) sobre Art-Net 4, con bytes calculados a mano.
import { test, report } from "./harness.js";
import assert from "node:assert/strict";
import * as R from "../web/js/rdm.js";

console.log("== RDM (detección automática de luces) ==");

await test("GET DEVICE_INFO: bytes exactos según E1.20 (longitud 24, suma de verificación)", () => {
  const dest = [0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc], src = [0x7f, 0xf0, 0, 0, 0, 1];
  const p = R.rdmPacket({ dest, src, tn: 0, port: 1, cc: R.CC.get, pid: R.PID.deviceInfo });
  const expect = [0xcc, 0x01, 0x18, 0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0x7f, 0xf0, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x20, 0x00, 0x60, 0x00];
  const sum = expect.reduce((a, b) => a + b, 0);   // 204+1+24+18+52+86+120+154+188+127+240+1+1+32+96 = 1344 = 0x0540
  assert.equal(sum, 0x0540);
  assert.deepEqual([...p], [...expect, 0x05, 0x40]);
  const back = R.parseRdm(p);
  assert.equal(back.pid, 0x0060); assert.equal(back.cc, 0x20); assert.deepEqual(back.dest, dest);
  const bad = p.slice(); bad[25] ^= 1;
  assert.equal(R.parseRdm(bad), null, "suma mal → se descarta");
});

await test("ArtTodRequest / ArtRdm / ArtTodData: cabeceras Art-Net 4 (OpCode, Net, Address, sin 0xCC)", () => {
  const q = R.artTodRequest([0x0101, 0x0102]);
  assert.equal(q.length, 56);
  assert.deepEqual([...q.slice(0, 12)], [0x41, 0x72, 0x74, 0x2d, 0x4e, 0x65, 0x74, 0x00, 0x00, 0x80, 0, 14]);
  assert.deepEqual([q[21], q[22], q[23], q[24], q[25]], [1, 0, 2, 0x01, 0x02]);
  const rdm = R.rdmPacket({ dest: [1, 2, 3, 4, 5, 6], src: [0x7f, 0xf0, 0, 0, 0, 1], pid: R.PID.deviceLabel });
  const a = R.artRdm(0x0203, rdm);
  assert.deepEqual([a[8], a[9], a[12], a[21], a[22], a[23]], [0x00, 0x83, 1, 2, 0, 3]);
  assert.equal(a[24], 0x01, "el mensaje RDM va sin el código de inicio 0xCC");
  assert.equal(a.length, 24 + rdm.length - 1);
  const pr = R.parseArtRdm(a);
  assert.equal(pr.op, "rdm"); assert.equal(pr.portAddress, 0x0203); assert.equal(pr.rdm.pid, R.PID.deviceLabel, "se lee aunque falte el 0xCC");
  const td = R.parseArtRdm(R.artTodData(0x0001, [[0x4c, 0x55, 0, 0, 0, 7], [0x4c, 0x55, 0, 0, 0, 8]]));
  assert.equal(td.op, "todData"); assert.equal(td.uids.length, 2); assert.equal(R.uidStr(td.uids[1]), "4C55:00000008");
});

await test("DEVICE_INFO y SLOT_INFO → tipo de luz y canales correctos (cabeza móvil con pan/tilt finos)", () => {
  const info = R.parseDeviceInfo(R.deviceInfoData({ category: 0x0102, footprint: 7, startAddress: 33 }));
  assert.deepEqual([info.category, info.footprint, info.startAddress], [0x0102, 7, 33]);
  const slots = R.parseSlotInfo(R.slotInfoData([{ offset: 0, label: 0x0101 }, { offset: 1, type: 1, label: 0x0101 }, { offset: 2, label: 0x0102 }, { offset: 3, type: 1, label: 0x0102 },
    { offset: 4, label: 0x0001 }, { offset: 5, label: 0x0205 }, { offset: 6, label: 0x0404 }]));
  const ch = R.channelsOf({ ...info, slots }).map(c => c.type);
  assert.deepEqual(ch, ["pan", "panFine", "tilt", "tiltFine", "intensity", "red", "strobe"]);
  assert.equal(R.kindOf({ category: 0x0102, model: "Beam 230" }), "Cabeza móvil (beam/spot)");
  assert.equal(R.kindOf({ category: 0x0104, model: "RGB Laser 500mW" }), "Láser");
  assert.deepEqual(R.channelsOf({ category: 0x0101, footprint: 4 }).map(c => c.type), ["red", "green", "blue", "white"], "sin SLOT_INFO se deduce");
});

await test("USB-DMX (protocolo DMX USB Pro): 0x7E, etiqueta 6, longitud 513, código de inicio 0, 0xE7", async () => {
  const { proPacket, looksLikeDmx } = await import("../web/js/usbdmx.js");
  const d = new Uint8Array(512); d[0] = 255; d[511] = 9;
  const p = proPacket(d);
  assert.equal(p.length, 518);
  assert.deepEqual([p[0], p[1], p[2], p[3], p[4], p[5]], [0x7e, 6, 0x01, 0x02, 0x00, 255]);
  assert.equal(p[516], 9); assert.equal(p[517], 0xe7);
  assert.ok(looksLikeDmx({ usbVendorId: 0x0403 })); assert.ok(!looksLikeDmx({ usbVendorId: 0x1234, name: "Arduino" }));
});

await test("Láser Ether Dream: el anuncio de red (36 bytes) se reconoce", async () => {
  const { parseEtherDream, DmxNet } = await import("../web/js/dmxnet.js");
  const b = new Uint8Array(36); b.set([0x00, 0x11, 0x22, 0x33, 0x44, 0x55], 0); b[10] = 0x00; b[11] = 0x07; b[12] = 0x30; b[13] = 0x75;
  const l = parseEtherDream(b, "192.168.1.50");
  assert.equal(l.ip, "192.168.1.50"); assert.equal(l.mac, "00:11:22:33:44:55"); assert.equal(l.buffer, 1792); assert.equal(l.maxRate, 30000);
  assert.equal(parseEtherDream(new Uint8Array(10), "x"), null);
  // El núcleo de red funciona con cualquier adaptador (el de Android es así).
  const sent = [];
  const adapter = { interfaces: () => [{ name: "wlan0", address: "192.168.1.20", netmask: "255.255.255.0", internal: false }],
    socket: async () => ({ send: (b, port, host, cb) => { sent.push({ len: b.length, port, host }); cb?.(null); }, close() {} }), randomBytes: (n) => new Uint8Array(n) };
  const msgs = [];
  const net = new DmxNet(adapter, (m) => msgs.push(m));
  net.onMessage({ t: "config", cfg: { iface: "192.168.1.20", universes: [{ num: 1, protocol: "artnet", portAddress: 0, dest: "broadcast", enabled: true }], inputs: [] } });
  await new Promise(r => setTimeout(r, 20));
  net.onMessage({ t: "frame", list: [[1, new Uint8Array(512).fill(7)]] });
  net.loop(); clearTimeout(net.loopTimer);
  assert.ok(sent.some(s => s.port === 6454 && s.host === "192.168.1.255" && s.len === 530), JSON.stringify(sent));
  net.stop();
});

report();
