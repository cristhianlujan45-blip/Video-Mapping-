// tests/phonecam.test.js — móvil como cámara: código QR (comparado con una
// implementación de referencia), nombres de red y lista de móviles conectados.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test, report } from "./harness.js";
import { qrMatrix, qrSvg, rsRemainder } from "../web/js/qr.js";
import { startPhoneCams, handle, listPhones, netLabel, isPhoneKey, phoneKey, onPhoneChange } from "../web/js/phonecam.js";

// Huellas de la matriz generada por la librería «qrcode» de Python (modo byte, nivel M,
// máscara automática): mismo código bit a bit, incluida la elección de la máscara.
const REF = [
  ["HOLA", 1, "b5f6f1692586adfc3989bd71a6cd7cb9c9e66e2f322a6cf6b247cd74297e3600"],
  ["https://192.168.1.20:8443/phonecam.html?pin=4821", 4, "c872f65f48381d5be9d6c873975c8ac08aaddf6db7d90c04f6ffc9ba5c1aa5d4"],
  ["https://192.168.100.200:8443/phonecam.html?pin=1234&n=Escenario%20principal", 5, "82678c0bcd78b173876f4cc1d98d5fa05640d6fb58f40b21e69f7c7e5976520a"],
  ["https://10.0.0.5:8443/phonecam.html?pin=1234&k=abcdefghijk=abcdefghijk=abcdefghijk=abcdefghijk=abcdefghijk=abcdefghijk=abcdefghijk=abcdefghijk=abcdefghij", 9, "58caeaa0c190fe95b97aeefbdd70b1b5d1111a759623f3af46978ca9b1b2cefd"],
  ["https://lumamap.local:8443/phonecam.html?abcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghij", 10, "8eefb0c3f79a7fe6ce102e91f7db06afc9d1cd02086613b84405e37ab7ae73a3"],
  ["https://83.77.202.167:4188/phonecam.html?pin=1186", 4, "c795e0b47f88398c30a33097eadb10b9620b707f7f9ec1340a1dc04c9af3738c"],
  ["https://211.48.187.150:4825/phonecam.html?pin=8313", 4, "a3c685f53942ec28200ec49da04899d0f1824c4865209d32c45acaa6426f2244"],
  ["https://55.19.44.112:28429/phonecam.html?pin=1144", 4, "38037625bef0839ed1b444beb7070f620fd927dbbddb4c23e0329edc08a4e064"],
  ["https://62.46.217.16:55212/phonecam.html?pin=9264", 4, "3d26f01fa73679c3a365c6dfc35a9b70a1cd3faa5d1d539845597dc37d4d9b3e"],
  ["https://32.114.31.148:39398/phonecam.html?pin=6499", 4, "f5eb05004a2653ca272635522c715f4e81df45df1de0d92fa693d1a494739d6e"],
  ["https://13.113.23.143:57284/phonecam.html?pin=2181", 4, "f66bed5d4aa991affdc131a8bfcba7417992ee6e2656e3c129e86beaf8e33327"],
  ["https://75.214.73.139:8743/phonecam.html?pin=9353", 4, "33b259a63587fd017244e82a1b932324e96aaaee331200ae582b2987d42dbbe0"],
  ["https://79.92.52.149:38458/phonecam.html?pin=3078", 4, "ca6e078c31c8195e52901e9e832ea0926adbea6d739093876579a48a686d29ce"],
];
const hash = (m) => crypto.createHash("sha256").update(m.map(r => r.map(x => x ? "1" : "0").join("")).join("")).digest("hex");

console.log("== Código QR ==");
await test("Reed-Solomon: el ejemplo de la norma (versión 1-M, «01234567»)", () => {
  assert.deepEqual(rsRemainder([16, 32, 12, 86, 97, 128, 236, 17, 236, 17, 236, 17, 236, 17, 236, 17], 10), [165, 36, 212, 193, 237, 54, 199, 135, 44, 85]);
});
await test("idéntico a la implementación de referencia (versiones 1 a 10, con versión y máscara)", () => {
  for (const [t, v, h] of REF) {
    const m = qrMatrix(t);
    assert.equal((m.length - 17) / 4, v, t.slice(0, 30));
    assert.equal(hash(m), h, "matriz distinta: " + t.slice(0, 40));
  }
});
await test("SVG con margen y texto demasiado largo avisa", () => {
  const svg = qrSvg("https://192.168.1.20:8443/phonecam.html", { size: 200 });
  assert.match(svg, /^<svg[^>]+viewBox="0 0 37 37"/);   // versión 3 (29) + 4 de margen a cada lado
  assert.throws(() => qrMatrix("x".repeat(300)), /demasiado largo/);
});

console.log("== Móviles conectados ==");
await test("nombres de red sencillos (Wi-Fi, cable, móvil por USB)", () => {
  assert.equal(netLabel({ name: "Wi-Fi", ip: "192.168.1.20" }), "Wi-Fi · 192.168.1.20");
  assert.match(netLabel({ name: "Ethernet 2", ip: "10.0.0.4" }), /^Cable de red/);
  assert.match(netLabel({ name: "Remote NDIS based Internet Sharing Device", ip: "192.168.42.10" }), /^Cable USB/);
  assert.equal(isPhoneKey(phoneKey("ab12")), true); assert.equal(isPhoneKey("default"), false);
});
await test("el programa ve los móviles, les pide la imagen y sabe cuándo se van", () => {
  const sent = [], changes = [];
  startPhoneCams({ send: (m) => sent.push(m) });
  const off = onPhoneChange((k) => changes.push(k));
  handle({ type: "cameras", cameras: [{ id: 7, cam: "ab12", name: "Galaxy S23" }] });
  assert.deepEqual(sent, [{ type: "rtc", to: 7, data: { want: "offer" } }], "pide la oferta al móvil que ya estaba enviando");
  let l = listPhones();
  assert.equal(l.length, 1);
  assert.deepEqual([l[0].id, l[0].label, l[0].kind, l[0].online, l[0].live], ["phone:ab12", "Galaxy S23", "phone", true, false]);
  handle({ type: "cameras", cameras: [{ id: 7, cam: "ab12", name: "Galaxy S23" }] });
  assert.equal(sent.length, 1, "no repite la petición si nada cambió");
  handle({ type: "cameras", cameras: [] });
  l = listPhones();
  assert.equal(l[0].online, false); assert.match(l[0].kindName, /desconectado/);
  assert.deepEqual(changes, ["phone:ab12", "phone:ab12"]);
  off();
});
report();
