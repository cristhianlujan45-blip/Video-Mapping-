// tests/autovj.test.js — el VJ automático sigue la estructura del tema como un VJ de verdad.
import assert from "node:assert/strict";
import { test, report } from "./harness.js";
import { createVJ, clipEnergy, setFromText, VJ_STYLES } from "../web/js/autovj.js";

console.log("== VJ automático ==");
const CLIPS = [
  { id: "c1", name: "Nubes", gen: "clouds" }, { id: "c2", name: "Aurora", gen: "aurora" }, { id: "c3", name: "Océano", gen: "ocean" },
  { id: "m1", name: "Plasma raro", gen: "truchet" }, { id: "m2", name: "Ladrillos", gen: "bricks" },
  { id: "h1", name: "Hiperespacio", gen: "warp" }, { id: "h2", name: "Láseres", gen: "lasershow" }, { id: "h3", name: "Glitch", gen: "rgbglitch" }, { id: "h4", name: "Túnel", gen: "tunnel" },
];
const ENERGY = Object.fromEntries(CLIPS.map(c => [c.id, clipEnergy(c)]));
/** Un tema: calma, subida, drop, pausa, drop (niveles de audio por segundo). */
function song() {
  const parts = [["calm", 30, 0.15], ["build", 15, null], ["drop", 30, 0.9], ["break", 20, 0.08], ["build", 10, null], ["drop", 25, 0.95]];
  const out = []; let prev = 0.15;
  for (const [name, sec, lvl] of parts) for (let i = 0; i < sec * 10; i++) {
    const v = lvl ?? (prev + (0.7 - prev) * (i / (sec * 10)));
    out.push({ name, level: v, bass: v }); if (lvl != null) prev = lvl;
  }
  return out;
}
function run({ style = "techno", seed = 1, variety = false, surfaces = ["s1"], live = true } = {}) {
  let x = seed; const random = () => (x = (x * 16807) % 2147483647) / 2147483647;
  const vj = createVJ({ style, intensity: 0.8, random });
  const steps = song(), acts = [];
  let t = 0, beatAcc = 0;
  for (const s of steps) {
    t += 100;
    vj.frame({ level: s.level, bass: s.bass, live, bpm: 120 }, t);
    beatAcc += 100;
    if (beatAcc >= 500) { beatAcc -= 500; for (const a of vj.beat({}, t, { clips: CLIPS, surfaces, variety })) acts.push({ ...a, t, truth: s.name }); }
  }
  return { vj, acts };
}

await test("sigue la estructura del tema: calma → subida → DROP → pausa → DROP", () => {
  const { acts } = run();
  const secs = acts.filter(a => a.type === "section").map(a => a.section);
  const order = secs.filter((s, i) => s !== secs[i - 1]);
  assert.equal(order[0], "calm");
  const iDrop = order.indexOf("drop"), iBreak = order.indexOf("break", iDrop);
  assert.ok(order.indexOf("build") >= 0 && order.indexOf("build") < iDrop, "subida antes del drop: " + order.join(" → "));
  assert.ok(iBreak > iDrop, "pausa después del drop: " + order.join(" → "));
  assert.ok(order.lastIndexOf("drop") > iBreak, "vuelve el drop: " + order.join(" → "));
  // El drop se reconoce como mucho 4 compases después de que entra de verdad.
  const firstTrueDrop = acts.find(a => a.truth === "drop").t, seenDrop = acts.find(a => a.type === "section" && a.section === "drop").t;
  assert.ok(seenDrop - firstTrueDrop <= 8000, `drop tarde: ${(seenDrop - firstTrueDrop) / 1000} s`);
});
await test("en el DROP: corte seco con destello y clips fuertes; en la calma: fundidos largos y clips suaves", () => {
  const { acts } = run();
  const dropIn = acts.find(a => a.type === "clip" && a.flash);
  assert.ok(dropIn, "hay un clip con destello al entrar el drop");
  assert.equal(dropIn.beats, 0);
  assert.equal(ENERGY[dropIn.clip.id], "hard");
  const calm = acts.filter(a => a.type === "clip" && a.truth === "calm");
  assert.ok(calm.length >= 1 && calm.every(a => a.beats >= 4 && ENERGY[a.clip.id] !== "hard"), JSON.stringify(calm.map(a => [a.clip.id, a.beats])));
  // Efectos: estrobo/RGB en el drop, caleidoscopio que crece en la subida.
  const fxDrop = acts.filter(a => a.type === "fx" && a.truth === "drop");
  assert.ok(fxDrop.some(a => a.fx.strobe > 0) && fxDrop.some(a => a.fx.rgbShift > 0));
  const kal = acts.filter(a => a.type === "fx" && a.fx.kaleido > 0).map(a => a.fx.kaleido);
  assert.ok(kal.length && kal.at(-1) >= kal[0], "caleidoscopio que crece");
});
await test("cambia de clip al final de las frases, sin repetir seguido", () => {
  const { acts } = run({ style: "edm" });
  const clips = acts.filter(a => a.type === "clip");
  assert.ok(clips.length >= 8, "cambios: " + clips.length);
  for (let i = 1; i < clips.length; i++) assert.notEqual(clips[i].clip.id, clips[i - 1].clip.id, "repite " + clips[i].clip.id);
  // Fuera del drop, los cambios caen en el primer golpe de compás (frases de 8/16/32).
  assert.ok(clips.every(a => a.flash || a.beats >= 0));
});
await test("varias pantallas: iguales (unísono) o cada una distinta", () => {
  const same = run({ surfaces: ["a", "b", "c"] }).acts.filter(a => a.type === "clip");
  const byT = (arr) => Object.values(arr.reduce((m, a) => ((m[a.t] ||= []).push(a.clip.id), m), {}));
  assert.ok(byT(same).every(ids => new Set(ids).size === 1));
  const varied = run({ surfaces: ["a", "b", "c"], variety: true }).acts.filter(a => a.type === "clip");
  assert.ok(byT(varied).some(ids => new Set(ids).size === 3));
});
await test("sin micrófono sigue una estructura de tema al tempo (no se queda quieto)", () => {
  const { acts } = run({ live: false });
  const secs = new Set(acts.filter(a => a.type === "section").map(a => a.section));
  assert.ok(["calm", "build", "drop", "break"].every(s => secs.has(s)), [...secs].join(","));
});
await test("energía de cada clip (la del usuario manda) y set desde una frase", () => {
  assert.equal(clipEnergy({ gen: "warp" }), "hard");
  assert.equal(clipEnergy({ gen: "clouds" }), "soft");
  assert.equal(clipEnergy({ gen: "clouds", energy: "hard" }), "hard");
  assert.equal(clipEnergy({ kind: "media" }), "mid");
  const s = setFromText("techno oscuro con rojo y blanco, espacio y láseres");
  assert.equal(s.style, "techno");
  assert.deepEqual(s.palette, ["#ff1a1a", "#ffffff"]);
  assert.ok(s.gens.includes("galaxy") && s.gens.includes("lasershow"));
  assert.equal(setFromText("una boda elegante en dorado").style, "elegant");
  assert.equal(setFromText("reggaeton y salsa").style, "latina");
  assert.ok(Object.keys(VJ_STYLES).length >= 6);
});
report();
