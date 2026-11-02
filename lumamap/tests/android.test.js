// tests/android.test.js — piezas JS de la app de Android con puentes nativos falsos:
// OSC (parser y escucha por UDP), MIDI (Web MIDI imitado), USB-DMX e IA local.
import { test, report } from "./harness.js";
import assert from "node:assert/strict";
import { encodeOSC } from "../server/osc.js";

globalThis.window = globalThis;   // los módulos de la página usan window.__luma…
const { decodeOSC, startAndroidOsc, localAddresses, OSC_PORT } = await import("../web/js/osc-web.js");
const { MidiFramer, createAndroidMidiAccess, installAndroidMidi } = await import("../web/js/midi-android.js");
const { AndroidUsbDmx, proPacket } = await import("../web/js/usbdmx.js");
const { androidAiHttp, localHttp } = await import("../web/js/ai/providers.js");

console.log("== Android: OSC, MIDI, USB-DMX e IA local ==");

const u8 = (b) => new Uint8Array(b.buffer, b.byteOffset, b.length);
const bundle = (...parts) => {
  const head = Buffer.concat([Buffer.from("#bundle\0"), Buffer.alloc(8)]);
  return Buffer.concat([head, ...parts.flatMap(p => { const n = Buffer.alloc(4); n.writeInt32BE(p.length); return [n, p]; })]);
};

await test("OSC: mensaje con i, f, s, T, F (los mismos bytes que el servidor de Windows)", () => {
  const b = encodeOSC("/lumamap/param/global/master", [{ type: "f", value: 0.5 }, { type: "i", value: -3 }, { type: "s", value: "hola" }, { type: "T" }, { type: "F" }]);
  assert.deepEqual(decodeOSC(u8(b)), [{ address: "/lumamap/param/global/master", args: [0.5, -3, "hola", true, false] }]);
  assert.deepEqual(decodeOSC(u8(encodeOSC("/lumamap/go"))), [{ address: "/lumamap/go", args: [] }]);
  // Texto de longitud múltiplo de 4: lleva 4 ceros de relleno.
  assert.deepEqual(decodeOSC(u8(encodeOSC("/abc", [{ type: "s", value: "abcd" }, { type: "i", value: 7 }]))), [{ address: "/abc", args: ["abcd", 7] }]);
});

await test("OSC: bundles (también anidados) se aplanan en orden; basura y mensajes cortados se rechazan", () => {
  const a = encodeOSC("/a", [{ type: "i", value: 1 }]), b = encodeOSC("/b", [{ type: "f", value: 0.25 }]);
  const out = decodeOSC(u8(bundle(a, bundle(b))));
  assert.deepEqual(out, [{ address: "/a", args: [1] }, { address: "/b", args: [0.25] }]);
  assert.throws(() => decodeOSC(new Uint8Array([1, 2, 3, 4])));
  assert.throws(() => decodeOSC(u8(encodeOSC("/x", [{ type: "i", value: 1 }]).subarray(0, 10))));
  const cut = bundle(a); cut.writeInt32BE(999, 16);
  assert.throws(() => decodeOSC(u8(cut)));
});

await test("OSC en Android: escucha en el puerto 9129 con el puente UDP y entrega cada mensaje; se ignora lo que no es OSC", async () => {
  const opened = [];
  const N = { udpOpen: (id, port, addr, mc) => { opened.push({ id, port, addr, mc }); return true; }, udpClose: (id) => opened.push({ closed: id }), udpError: () => "",
    netInterfaces: () => JSON.stringify([{ name: "wlan0", address: "192.168.1.40", netmask: "255.255.255.0", internal: false }, { name: "lo", address: "127.0.0.1", internal: true }]) };
  const got = [];
  const osc = await startAndroidOsc(N, (address, args) => got.push([address, args]));
  assert.equal(OSC_PORT, 9129); assert.equal(opened[0].port, 9129); assert.equal(osc.port, 9129);
  const id = opened[0].id, b64 = (b) => Buffer.from(b).toString("base64");
  window.__lumaUdp(id, "192.168.1.5", 50000, b64(encodeOSC("/lumap/next")));
  window.__lumaUdp(id, "192.168.1.5", 50000, b64(Buffer.from("no soy OSC")));
  window.__lumaUdp(id, "192.168.1.5", 50000, b64(bundle(encodeOSC("/fader", [{ type: "f", value: 1 }]))));
  assert.deepEqual(got, [["/lumap/next", []], ["/fader", [1]]]);
  assert.deepEqual(localAddresses(N).map(i => i.address), ["192.168.1.40"]);
  // Las luces y el OSC comparten el puente: los id de socket no se repiten.
  const { androidAdapter } = await import("../web/js/dmx-android.js");
  await androidAdapter(N).socket({ port: 6454, onMessage() {} });
  assert.notEqual(opened[1].id, id);
  osc.close();
  assert.deepEqual(opened.at(-1), { closed: id });
});

await test("MIDI: el flujo de bytes se separa en mensajes (running status, tiempo real en medio, SysEx fuera)", () => {
  const out = [];
  const f = new MidiFramer((d, t) => out.push([...d, "@" + t]));
  f.push([0x90, 60, 100, 62, 0], 1);                 // nota + running status
  f.push([0xb0, 7], 2); f.push([0xf8], 3); f.push([90], 4);   // CC partido con un tick de reloj en medio
  f.push([0xf0, 1, 2, 3, 0xf7, 0xc1, 5, 0xf1, 0x23], 5);      // SysEx descartado, program change, cuarto de cuadro MTC
  assert.deepEqual(out, [[0x90, 60, 100, "@1"], [0x90, 62, 0, "@1"], [0xf8, "@3"], [0xb0, 7, 90, "@4"], [0xc1, 5, "@5"], [0xf1, 0x23, "@5"]]);
});

function fakeMidi() {
  const N = { ports: [{ id: "3:i0", name: "nanoKONTROL2", manufacturer: "KORG", type: "input" }, { id: "3:o0", name: "nanoKONTROL2", manufacturer: "KORG", type: "output" }], sent: [], started: 0,
    midiStart() { this.started++; return true; }, midiPorts() { return JSON.stringify(this.ports); }, midiSend(id, csv) { this.sent.push([id, csv]); return true; } };
  return N;
}

await test("MIDI en Android: requestMIDIAccess imitado, entradas/salidas, onmidimessage, send y conexión en caliente", async () => {
  const N = fakeMidi(), nav = {}, win = {};
  assert.ok(installAndroidMidi(N, nav, win));
  assert.ok(!installAndroidMidi(N, { requestMIDIAccess() {} }, win), "si hay Web MIDI de verdad no se toca");
  const access = await nav.requestMIDIAccess({ sysex: false });
  assert.equal(await nav.requestMIDIAccess(), access); assert.equal(N.started, 1);
  assert.deepEqual([...access.inputs.values()].map(p => [p.name, p.manufacturer, p.state]), [["nanoKONTROL2", "KORG", "connected"]]);
  const input = access.inputs.get("3:i0"), got = [];
  input.onmidimessage = (e) => got.push([...e.data]);
  win.__lumaMidi([["3:i0", 1000, 0xb0, 0, 64, 0x90], ["3:i0", 1001, 60, 127], ["9:i0", 1002, 0x90, 1, 1]]);
  assert.deepEqual(got, [[0xb0, 0, 64], [0x90, 60, 127]]);
  access.outputs.get("3:o0").send([0xb0, 1, 127]);
  assert.deepEqual(N.sent, [["3:o0", "176,1,127"]]);
  // Se desconecta y llega otro aparato: onstatechange por cada puerto.
  const changes = [];
  access.onstatechange = (e) => changes.push(e.port.id + ":" + e.port.state);
  N.ports = [{ id: "7:i0", name: "APC mini", type: "input" }];
  win.__lumaMidiState();
  assert.deepEqual(changes.sort(), ["3:i0:disconnected", "3:o0:disconnected", "7:i0:connected"]);
  assert.equal(input.state, "disconnected"); assert.deepEqual([...access.inputs.keys()], ["7:i0"]);
});

await test("MIDI en Android: las marcas de tiempo nativas pasan al reloj de la página sin adelantarse", () => {
  const N = fakeMidi(), win = {};
  const access = createAndroidMidiAccess(N, win), ts = [];
  access.inputs.get("3:i0").onmidimessage = (e) => ts.push(e.timeStamp);
  const prev = Object.getOwnPropertyDescriptor(globalThis, "performance");
  let page = 0;
  Object.defineProperty(globalThis, "performance", { value: { now: () => page }, configurable: true, writable: true });
  try {
    // Ticks cada 20 ms en el aparato que llegan a la página con retrasos distintos (25 ms, 16 ms).
    for (const [tNative, arrives] of [[5000, 100], [5020, 125], [5040, 141]]) { page = arrives; win.__lumaMidi([["3:i0", tNative, 0xf8]]); }
    assert.deepEqual(ts, [100, 120, 140], "se conserva el ritmo del aparato");
    page = 150; win.__lumaMidi([["3:i0", 0, 0xf8]]);
    assert.equal(ts[3], 150, "sin marca nativa: la hora de llegada");
  } finally { if (prev) Object.defineProperty(globalThis, "performance", prev); }
});

await test("MIDI en Android con MidiDriver: un CC del controlador llega al motor de parámetros", async () => {
  const N = fakeMidi(), win = globalThis;
  const prev = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true, writable: true });
  try {
    installAndroidMidi(N, globalThis.navigator, win);
    const { MidiDriver } = await import("../web/js/midi.js");
    const inputs = [];
    const d = new MidiDriver({ onInput: (ev) => inputs.push(ev) });
    assert.ok(await d.start());
    win.__lumaMidi([["3:i0", 1, 0xb0, 7, 127]]);
    assert.equal(inputs[0].key, "cc:7"); assert.equal(inputs[0].device, "nanoKONTROL2"); assert.equal(inputs[0].v, 1);
    d.sendFeedback({ device: "nanoKONTROL2", channel: 1, key: "note:36" }, 1);
    assert.deepEqual(N.sent.at(-1), ["3:o0", "144,36,127"]);
  } finally { if (prev) Object.defineProperty(globalThis, "navigator", prev); else delete globalThis.navigator; }
});

await test("USB-DMX en Android: abre con permiso, envía el paquete DMX USB Pro en base64, se salta fotogramas y avisa al quitarla", async () => {
  let open = { ok: false, code: "permission" }, busy = false;
  const N = { asked: [], sent: [], usbDmxWatch() {}, usbDmxOpen(ask) { this.asked.push(ask); return JSON.stringify(open); },
    usbDmxSend(b64) { if (busy) return false; this.sent.push(b64); return true; }, usbDmxClose() {} };
  const u = new AndroidUsbDmx(N);
  let changes = 0; u.onChange = () => changes++;
  assert.ok(u.supported && !u.ready);
  assert.equal(await u.auto(), false); assert.deepEqual(N.asked, [false], "al arrancar no se pide permiso");
  open = { ok: false, code: "asked" };
  await u.request(); assert.match(u.error, /permiso/i);
  open = { ok: true, code: "ok", name: "DMX USB PRO" };
  window.__lumaUsbDmx({ state: "permission", ok: true });
  assert.ok(u.ready); assert.equal(u.info.name, "DMX USB PRO");
  const data = new Uint8Array(512); data[0] = 255; data[511] = 7;
  u.send(data);
  assert.deepEqual([...Buffer.from(N.sent[0], "base64")], [...proPacket(data)]);
  busy = true; u.send(data); assert.equal(u.frames, 1, "fotograma saltado: no cuenta");
  window.__lumaUsbDmx({ state: "detached" });
  assert.ok(!u.ready); assert.match(u.error, /desconect/); assert.ok(changes >= 3);
});

await test("IA local en Android: la petición va por el puente nativo y la respuesta vuelve por su número", async () => {
  const calls = [];
  const N = { aiHttp: (id, url, method, body, timeout) => calls.push({ id, url, method, body, timeout }) };
  const http = androidAiHttp(N);
  const p1 = http({ url: "http://192.168.1.10:11434/api/tags", method: "GET", timeout: 4000 });
  const p2 = http({ url: "http://192.168.1.10:11434/api/chat", method: "POST", body: { a: 1 }, timeout: 180000 });
  assert.deepEqual(calls.map(c => [c.method, c.body, c.timeout]), [["GET", "", 4000], ["POST", '{"a":1}', 180000]]);
  window.__lumaAiHttp(calls[1].id, { ok: true, status: 200, text: "{}" });
  window.__lumaAiHttp(calls[0].id, { ok: false, error: "timeout" });
  assert.deepEqual(await p2, { ok: true, status: 200, text: "{}" });
  assert.deepEqual(await p1, { ok: false, error: "timeout" });
  // localHttp lo usa solo cuando existe la app de Android, y traduce los errores igual que en Windows.
  globalThis.LumaNative = { aiHttp: (id) => setTimeout(() => window.__lumaAiHttp(id, { ok: false, error: "not-local" }), 0) };
  try { await assert.rejects(localHttp("http://8.8.8.8:11434", "/api/tags"), (e) => e.code === "notLocal"); }
  finally { delete globalThis.LumaNative; }
});

report();
