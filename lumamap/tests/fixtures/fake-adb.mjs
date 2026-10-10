// tests/fixtures/fake-adb.mjs — adb simulado para las pruebas del móvil por cable.
// Estado en FAKE_ADB_STATE (JSON: { devices: [[serie, estado]], model, failChrome }); cada orden se apunta en FAKE_ADB_LOG.
import fs from "node:fs";
const args = process.argv.slice(2);
const st = JSON.parse(fs.readFileSync(process.env.FAKE_ADB_STATE, "utf8"));
fs.appendFileSync(process.env.FAKE_ADB_LOG, JSON.stringify(args) + "\n");
const a = args[0] === "-s" ? args.slice(2) : args;
if (a[0] === "devices") {
  console.log("List of devices attached");
  for (const [s, state] of st.devices) console.log(`${s}\t${state}${state === "device" ? " product:garnet model:Redmi_Note_15_Pro device:garnet transport_id:1" : " transport_id:1"}`);
  console.log("");
} else if (a[0] === "reverse") { if (a[1] !== "--remove-all") console.log(a[1].replace("tcp:", "")); }
else if (a[0] === "shell" && a[1] === "getprop") console.log(a[2] === "ro.product.marketname" ? st.model || "" : "2312DRA50G");
else if (a[0] === "shell" && a[1] === "am") {
  if (st.failChrome && a.includes("com.android.chrome")) { console.log("Starting: Intent { act=android.intent.action.VIEW }"); console.error("Error: Activity not started, unable to resolve Intent"); }
  else console.log("Starting: Intent { act=android.intent.action.VIEW dat=http://localhost/... }");
}
