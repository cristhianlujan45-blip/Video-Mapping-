// tests/phoneusb.test.js — móvil Android por cable USB: se reconoce al enchufarlo (pnputil),
// se pide aceptar la depuración en el móvil si hace falta y se abre la cámara sola (adb).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test, report } from "./harness.js";
const { parsePnp, parseAdbDevices, parseRepository, findAdb, createPhoneUsb } = createRequire(import.meta.url)("../desktop/phoneusb.js");
const here = path.dirname(fileURLToPath(import.meta.url));

console.log("== Móvil por cable USB ==");
await test("reconoce un Xiaomi enchufado (Windows en inglés y en español) y no confunde una impresora Samsung", () => {
  const en = `Microsoft PnP Utility

Instance ID:                USB\\VID_2717&PID_FF48\\8d1c2f3a
Device Description:         Redmi Note 15 Pro
Class Name:                 WPD
Status:                     Started

Instance ID:                USB\\VID_2717&PID_FF48&MI_01\\6&2a3b&0&0001
Device Description:         ADB Interface
Class Name:                 AndroidUsbDeviceClass

Instance ID:                USB\\VID_046D&PID_0825\\ABCD
Device Description:         USB Video Device

Instance ID:                USB\\VID_04E8&PID_3301\\X1
Device Description:         Samsung M2020 Series
Class Name:                 Printer
`;
  assert.deepEqual(parsePnp(en).map(d => [d.brand, d.name]), [["Xiaomi", "Redmi Note 15 Pro"]]);
  const es = `Id. de instancia:                USB\\VID_04E8&PID_6860\\R58M
Descripción del dispositivo:     Galaxy A54
Nombre de clase:                 WPD
`;
  assert.deepEqual(parsePnp(es).map(d => [d.brand, d.name]), [["Samsung", "Galaxy A54"]]);
  assert.deepEqual(parsePnp(""), []);
});

await test("lee «adb devices -l»: autorizado, sin autorizar y modelo", () => {
  const d = parseAdbDevices("List of devices attached\n8d1c2f3a\tdevice usb:1-1 product:garnet model:Redmi_Note_15_Pro device:garnet transport_id:2\nZY22\tunauthorized usb:1-2 transport_id:3\n\n");
  assert.deepEqual(d, [{ serial: "8d1c2f3a", state: "device", model: "Redmi Note 15 Pro" }, { serial: "ZY22", state: "unauthorized", model: "" }]);
  assert.deepEqual(parseAdbDevices("* daemon not running; starting now at tcp:5037\n* daemon started successfully\nList of devices attached\n\n"), []);
});

await test("manifiesto oficial de Google: zip de Windows con su huella SHA-1 (formato nuevo y antiguo)", () => {
  const xml = `<sdk:sdk-repository><remotePackage path="build-tools;35.0.0"><archives><archive><complete><size>1</size><checksum type="sha1">${"a".repeat(40)}</checksum><url>bt-win.zip</url></complete><host-os>windows</host-os></archive></archives></remotePackage>
<remotePackage path="platform-tools"><channelRef ref="channel-3"/><archives><archive><complete><size>9</size><checksum type="sha1">${"c".repeat(40)}</checksum><url>platform-tools_r36-preview-win.zip</url></complete><host-os>windows</host-os></archive></archives></remotePackage>
<remotePackage path="platform-tools"><revision><major>35</major></revision><channelRef ref="channel-0"/><archives>
<archive><complete><size>7000</size><checksum type="sha1">${"d".repeat(40)}</checksum><url>platform-tools_r35.0.2-darwin.zip</url></complete><host-os>macosx</host-os></archive>
<archive><complete><size>6900</size><checksum type="sha1">${"B".repeat(40)}</checksum><url>platform-tools_r35.0.2-win.zip</url></complete><host-os>windows</host-os></archive>
</archives></remotePackage></sdk:sdk-repository>`;
  assert.deepEqual(parseRepository(xml), { url: "https://dl.google.com/android/repository/platform-tools_r35.0.2-win.zip", sha1: "b".repeat(40), size: 6900 });
  const old = `<sdk:remotePackage path="platform-tools"><archives><archive><complete><size>5</size><checksum>${"e".repeat(40)}</checksum><url>platform-tools_r30-windows.zip</url></complete><host-os>windows</host-os></archive></archives></sdk:remotePackage>`;
  assert.equal(parseRepository(old.replace("<sdk:remotePackage", "<remotePackage"))?.sha1, "e".repeat(40));
  assert.equal(parseRepository("<html>error</html>"), null);
});

await test("encuentra un adb ya instalado (LumaMap, Android Studio o PATH)", () => {
  const has = (f) => f === path.join("/sdk", "platform-tools", "adb");
  assert.equal(findAdb({ dataDir: "/data", env: { ANDROID_HOME: "/sdk" }, platform: "linux", exists: has }), path.join("/sdk", "platform-tools", "adb"));
  assert.equal(findAdb({ dataDir: "/data", env: { LUMAMAP_ADB: "/x/adb" }, platform: "linux", exists: () => false }), "/x/adb");
  assert.equal(findAdb({ dataDir: "/data", env: {}, platform: "linux", exists: () => false }), null);
});

await test("al enchufarlo: pide aceptar en el móvil, luego abre la cámara sola por el cable (y otra vez al reenchufar)", async () => {
  if (process.platform === "win32") return;   // el adb simulado es un script de shell
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lumamap-adb-"));
  const stateFile = path.join(dir, "state.json"), logFile = path.join(dir, "log.txt"), adb = path.join(dir, "adb");
  fs.writeFileSync(adb, `#!/bin/sh\nexec "${process.execPath}" "${path.join(here, "fixtures", "fake-adb.mjs")}" "$@"\n`, { mode: 0o755 });
  const setState = (o) => fs.writeFileSync(stateFile, JSON.stringify({ model: "Redmi Note 15 Pro", ...o }));
  fs.writeFileSync(logFile, "");
  process.env.FAKE_ADB_STATE = stateFile; process.env.FAKE_ADB_LOG = logFile;
  const calls = () => fs.readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l));
  const sent = [];
  let plugged = [{ brand: "Xiaomi", name: "Redmi Note 15 Pro" }];
  const U = createPhoneUsb({ dataDir: dir, adbPath: adb, getPort: () => 8080, getPin: () => "1234", send: (s) => sent.push(s), scanUsb: async () => plugged });

  setState({ devices: [["8d1c2f3a", "unauthorized"]] });
  await U.tick();
  assert.equal(sent.at(-1).phones[0].state, "unauthorized");
  assert.deepEqual(sent.at(-1).plugged, plugged);
  assert.ok(!calls().some(c => c.includes("reverse")), "sin aceptar no se toca el móvil");

  // Acepta en el móvil (el navegador por defecto no es Chrome: se abre con el que tenga).
  setState({ devices: [["8d1c2f3a", "device"]], failChrome: true });
  await U.tick();
  const st = sent.at(-1).phones[0];
  assert.deepEqual([st.state, st.model], ["open", "Redmi Note 15 Pro"]);
  const c = calls();
  assert.ok(c.some(x => x.join(" ") === "-s 8d1c2f3a reverse tcp:8080 tcp:8080"), "puerto del PC por el cable");
  const opens = c.filter(x => x.includes("am"));
  assert.equal(opens.length, 2, "prueba Chrome y luego el navegador del móvil");
  const url = opens[1][opens[1].indexOf("-d") + 1];
  assert.equal(url, "'http://localhost:8080/phonecam.html?auto=1&usb=1&pin=1234&name=Redmi%20Note%2015%20Pro'");
  assert.ok(!opens[1].includes("-p"));

  // Sigue enchufado: no se vuelve a abrir en cada vuelta.
  const n = calls().length;
  await U.tick();
  assert.equal(calls().filter(x => x.includes("am")).length, 2);
  assert.ok(calls().length - n <= 1);

  // Se desenchufa y se vuelve a enchufar: se abre otra vez.
  setState({ devices: [] }); plugged = [];
  await U.tick();
  assert.deepEqual(sent.at(-1).phones, []);
  setState({ devices: [["8d1c2f3a", "device"]] }); plugged = [{ brand: "Xiaomi", name: "Redmi Note 15 Pro" }];
  await U.tick();
  assert.equal(sent.at(-1).phones[0].state, "open");
  assert.equal(calls().filter(x => x.includes("am")).length, 3, "con Chrome a la primera");
  U.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

await test("enchufado sin la depuración USB activada: lo ve Windows pero no adb (para enseñar los pasos)", async () => {
  if (process.platform === "win32") return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lumamap-adb-"));
  const stateFile = path.join(dir, "state.json"), logFile = path.join(dir, "log.txt"), adb = path.join(dir, "adb");
  fs.writeFileSync(adb, `#!/bin/sh\nexec "${process.execPath}" "${path.join(here, "fixtures", "fake-adb.mjs")}" "$@"\n`, { mode: 0o755 });
  fs.writeFileSync(stateFile, JSON.stringify({ devices: [] })); fs.writeFileSync(logFile, "");
  process.env.FAKE_ADB_STATE = stateFile; process.env.FAKE_ADB_LOG = logFile;
  const sent = [];
  const U = createPhoneUsb({ dataDir: dir, adbPath: adb, getPort: () => 8080, send: (s) => sent.push(s), scanUsb: async () => [{ brand: "Xiaomi", name: "Redmi Note 15 Pro" }] });
  await U.tick();
  assert.deepEqual([sent.at(-1).adb, sent.at(-1).plugged.length, sent.at(-1).phones.length], ["ok", 1, 0]);
  fs.rmSync(dir, { recursive: true, force: true });
});

await test("sin adb en el PC: se descarga solo al enchufar un móvil (y avisa del progreso)", async () => {
  const sent = [];
  let resolve;
  const U = createPhoneUsb({ dataDir: path.join(os.tmpdir(), "no-such-lumamap-dir"), getPort: () => 8080, send: (s) => sent.push(s),
    scanUsb: async () => [{ brand: "Xiaomi", name: "Redmi" }],
    download: ({ onProgress }) => { onProgress({ completed: 50, total: 100 }); return new Promise(r => { resolve = r; }); } });
  const saved = { ...process.env }; process.env.PATH = ""; delete process.env.ANDROID_HOME; delete process.env.ANDROID_SDK_ROOT; delete process.env.LUMAMAP_ADB;
  try {
    await U.tick();
    assert.ok(sent.some(s => s.adb === "downloading" && s.progress?.completed === 50));
    resolve({ ok: false, error: "HTTP 500" });
    await new Promise(r => setTimeout(r, 20));
    assert.equal(sent.at(-1).adb, "error");
  } finally { Object.assign(process.env, saved); }
});

report();
