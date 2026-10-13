// web/js/panels-signals.js
// «Señales en vivo» (como los visores de CHOP de TouchDesigner): una gráfica que corre con lo
// que se mueve solo —graves, medios, agudos, el golpe y cada señal que hayas creado con
// «〰 Animar al ritmo»— y la lista de esas señales para pausarlas o quitarlas.
import { h, section, btn, hint } from "./ui.js";
import { describe } from "./params.js";
import { LFO_SHAPES, SOUND_SHAPES } from "./lfo.js";

const BANDS = [["bass", "Graves", "#ff4d6d"], ["mid", "Medios", "#ffd166"], ["high", "Agudos", "#4dd2ff"], ["beat", "Golpe", "#ffffff"]];
const LCOLS = ["#a78bfa", "#34d399", "#f472b6", "#fb923c", "#60a5fa", "#facc15", "#2dd4bf", "#e879f9"];
const SHAPE_NAME = Object.fromEntries([...LFO_SHAPES, ...SOUND_SHAPES]);
const N = 240;   // muestras en pantalla (12 s a 20 por segundo)

export function signalsSection(app) {
  const S = app.S;
  const lfos = () => S.project.settings.lfos;
  const color = (id) => LCOLS[Math.max(0, lfos().findIndex(l => l.id === id)) % LCOLS.length];
  const nameOf = (l) => `${describe(app, l.param)?.name || l.param} · ${SHAPE_NAME[l.shape] || l.shape}`;

  const cv = h("canvas", { class: "sigmon", width: 720, height: 200, style: { width: "100%", height: "150px", background: "#0b0b12", borderRadius: "10px", display: "block" } });
  const legend = h("div", { class: "chips sigleg" });
  const hist = new Map();
  let idx = 0, legendKey = "";
  const push = (k, v) => { let a = hist.get(k); if (!a) hist.set(k, a = new Float32Array(N).fill(NaN)); a[idx % N] = v; };

  function draw() {
    const g = cv.getContext("2d"), W = cv.width, H = cv.height;
    g.clearRect(0, 0, W, H);
    g.strokeStyle = "rgba(255,255,255,0.08)"; g.lineWidth = 1;
    for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(0, H * i / 4); g.lineTo(W, H * i / 4); g.stroke(); }
    for (const [k, a] of hist) {
      g.strokeStyle = k.startsWith("lfo:") ? color(k.slice(4)) : BANDS.find(b => b[0] === k)[2];
      g.lineWidth = k.startsWith("lfo:") ? 2.5 : 1.5;
      g.globalAlpha = k === "beat" ? 0.5 : 1;
      g.beginPath();
      let started = false;
      for (let i = 0; i < N; i++) {
        const v = a[(idx + i) % N];
        if (Number.isNaN(v)) { started = false; continue; }
        const x = (i / (N - 1)) * W, y = H - 4 - v * (H - 8);
        if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y);
      }
      g.stroke();
    }
    g.globalAlpha = 1;
  }
  function paintLegend() {
    const key = [...hist.keys()].join("|");
    if (key === legendKey) return;
    legendKey = key;
    legend.replaceChildren(...[...hist.keys()].map(k => {
      const l = k.startsWith("lfo:") ? lfos().find(x => x.id === k.slice(4)) : null;
      const [label, col] = l ? [nameOf(l), color(l.id)] : (() => { const b = BANDS.find(x => x[0] === k); return [b[1], b[2]]; })();
      return h("span", { class: "chip", style: { borderColor: col, color: col } }, label);
    }));
  }
  const t = setInterval(() => {
    if (!cv.isConnected) return clearInterval(t);
    const L = S.levels || {};
    for (const [k] of BANDS) push(k, Math.max(0, Math.min(1, +L[k] || 0)));
    const vals = app.lfoValues?.() || new Map();
    for (const [id, v] of vals) push("lfo:" + id, v);
    for (const k of [...hist.keys()]) if (k.startsWith("lfo:") && !vals.has(k.slice(4))) hist.delete(k);
    idx++;
    draw(); paintLegend();
  }, 50);

  const list = lfos().length
    ? h("div", { class: "list" }, ...lfos().map((l) => h("div", { class: "item" },
        h("span", { class: "dot", style: { background: color(l.id), width: "12px", height: "12px", borderRadius: "50%", display: "inline-block", flex: "none" } }),
        h("div", { class: "name" }, nameOf(l), h("small", {}, l.on ? "en marcha" : "en pausa")),
        btn({ label: l.on ? "Pausar" : "Seguir", title: l.on ? "Pausar esta señal" : "Volver a moverla", onClick: () => { app.edit(() => { l.on = !l.on; }); app.renderPanel(); } }),
        btn({ label: "Quitar", kind: "danger", onClick: () => { app.edit(() => { S.project.settings.lfos = lfos().filter(x => x !== l); }); app.renderPanel(); } }))))
    : hint("Aún no has creado señales. Mantén pulsado (o clic derecho) cualquier deslizador → «〰 Animar al ritmo» y elige una onda, un golpe, ruido o que siga los graves.");

  return section("📈 Señales en vivo",
    hint("Lo que se mueve solo, en directo (como los visores de CHOP de TouchDesigner): el sonido y cada parámetro animado."),
    cv, legend, list);
}
