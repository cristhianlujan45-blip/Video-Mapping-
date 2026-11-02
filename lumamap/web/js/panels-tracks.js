// web/js/panels-tracks.js
// Audio → «🎚 Pistas de audio (multipista)»: cada parte de la música (bombo, bajo, voz… o tus
// stems del DAW, o los canales de una tarjeta de sonido) con su medidor en vivo, su envolvente
// ADSR dibujada y lo que mueve. Lo que mueve son Señales («track:<id>», lfo.js): cualquier control
// de LumaMap (efectos, opacidad, brillo, nodos…), con su rango.
import { h, section, btn, hint, slider, segmented, toast, dialog, closeDialog } from "./ui.js";
import { BANDS, MAX_TRACKS, newTrack, adsrShape, chanName } from "./tracks.js";
import { newLfo } from "./lfo.js";
import { catalog, describe } from "./params.js";
import * as Store from "./store.js";
import { uid } from "./model.js";

const pct = (v) => Math.round(v * 100) + " %";
const secs = (v) => (v < 1 ? Math.round(v * 1000) + " ms" : v.toFixed(2) + " s");
const fmtT = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
// Nombres que suelen tener los stems → parte del sonido y nombre bonito.
const GUESS = [[/kick|bombo|bd\b/i, "kick", "Bombo"], [/snare|caja|clap|palma/i, "snare", "Caja"], [/hat|hihat|plat|cymb|crash|ride/i, "hats", "Platillos"],
  [/bass|bajo|sub/i, "bass", "Bajo"], [/voc|voz|vox|sing/i, "voice", "Voz"], [/lead|synth|melod|piano|keys|guitar|guitarra/i, "voice", "Melodía"], [/drum|bater|perc/i, "kick", "Batería"]];

export function tracksSection(app) {
  const S = app.S, T = app.tracks;
  const cfg = () => S.project.settings.tracks;
  const list = () => cfg().list;
  const changed = () => { T.sync(); app.renderPanel(); };
  const edit = (fn, re = true) => { app.edit(fn); if (re) changed(); else T.sync(); };

  const wrap = h("div", { class: "tracks" });
  const meters = new Map();   // id → { raw, out, cv }
  const lfosOf = (t) => S.project.settings.lfos.filter(l => l.shape === "track:" + t.id);

  // ---- Transporte de los stems ----
  const pos = h("input", { type: "range", min: 0, max: 1, step: 0.001, value: 0, "aria-label": "Posición de las pistas" });
  const time = h("small", {}, "0:00");
  pos.addEventListener("input", () => T.seek(+pos.value * (T.duration || 0)));
  const playBtn = btn({ label: T.playing ? "⏸ Pausa" : "▶ Reproducir las pistas", kind: "primary", onClick: () => { T.playing ? T.pause() : T.play(); app.renderPanel(); } });
  const transport = T.hasFiles() ? h("div", { class: "trk-transport" }, playBtn, btn({ label: "■", kind: "small", title: "Parar y volver al principio", onClick: () => { T.stop(); app.renderPanel(); } }), pos, time) : null;

  // ---- Añadir pistas ----
  const addRow = h("div", { class: "row trk-add" },
    btn({ label: "＋ Partes de mi música", kind: "small primary", title: "Bombo, bajo, caja, voz y platillos de lo que suena (micrófono o tu canción)", onClick: () => addParts() }),
    btn({ label: "📂 Cargar stems (varios archivos)", kind: "small", title: "Los archivos de cada pista exportados de tu DAW: suenan juntos y cada uno mueve lo suyo", onClick: () => loadStems() }),
    btn({ label: "🎤 Entrada de audio", kind: "small", title: "Un canal de tu tarjeta de sonido (o un cable virtual desde el DAW)", onClick: () => addInput() }));

  function addParts() {
    const have = new Set(list().filter(t => t.kind === "master").map(t => t.band));
    const bands = ["kick", "bass", "snare", "voice", "hats"].filter(b => !have.has(b)).slice(0, MAX_TRACKS - list().length);
    if (!bands.length) return toast("Ya están todas las partes (o no caben más pistas)", "warn");
    edit(() => { for (const b of bands) list().push(newTrack("master", { band: b, color: undefined })); fixColors(); });
    if (!app.audio().active) toast("Pistas creadas. Para que se muevan, escucha la música: «Micrófono» arriba, o pon tu canción.");
  }
  function fixColors() { list().forEach((t, k) => { if (!t.color) t.color = ["#ff4d6d", "#ffd166", "#4dd2ff", "#a78bfa", "#34d399", "#fb923c", "#f472b6", "#60a5fa"][k % 8]; }); }
  function loadStems() {
    const inp = h("input", { type: "file", accept: "audio/*,.wav,.mp3,.ogg,.flac,.m4a,.aiff", multiple: true });
    inp.onchange = async () => {
      const files = [...(inp.files || [])].slice(0, MAX_TRACKS - list().length);
      if (!files.length) return;
      const added = [];
      for (const f of files) {
        const id = uid("media");
        try { await Store.putMedia({ id, name: f.name, kind: "audio", mime: f.type || "audio/wav", blob: f, size: f.size }); } catch (e) { toast("No se pudo guardar " + f.name + ": " + e.message, "err"); continue; }
        const g = GUESS.find(([re]) => re.test(f.name));
        added.push({ id, name: f.name, size: f.size, band: "all", tname: g ? g[2] : f.name.replace(/\.[^.]+$/, "").slice(0, 30) });
      }
      edit(() => {
        for (const a of added) { S.project.media.push({ id: a.id, name: a.name, kind: "audio", size: a.size }); list().push(newTrack("file", { media: a.id, name: a.tname, band: a.band })); }
        list().forEach((t, k) => { t.color ||= ["#ff4d6d", "#ffd166", "#4dd2ff", "#a78bfa", "#34d399", "#fb923c", "#f472b6", "#60a5fa"][k % 8]; });
      });
      toast(`${added.length} pista${added.length === 1 ? "" : "s"} cargada${added.length === 1 ? "" : "s"}: pulsa «▶ Reproducir las pistas»`);
    };
    inp.click();
  }
  async function addInput() {
    if (list().length >= MAX_TRACKS) return toast("Caben " + MAX_TRACKS + " pistas", "warn");
    edit(() => list().push(newTrack("input", { name: "Entrada " + (list().filter(t => t.kind === "input").length + 1) })));
  }

  // ---- Una tarjeta por pista ----
  async function inputDevices() {
    try { const d = await navigator.mediaDevices.enumerateDevices(); return d.filter(x => x.kind === "audioinput"); } catch { return []; }
  }
  function card(t, k) {
    const set = (key, re = false) => (v) => edit(() => { t[key] = v; }, re);
    const raw = h("i", { class: "trk-raw" }), out = h("i", { class: "trk-out" }), cv = h("canvas", { class: "trk-adsr", width: 220, height: 56 });
    meters.set(t.id, { raw, out, cv, t });
    const name = h("input", { class: "text-in small trk-name", value: t.name, "aria-label": "Nombre de la pista", maxlength: 40 });
    name.addEventListener("change", () => edit(() => { t.name = name.value.trim().slice(0, 40) || t.name; }));
    const color = h("input", { type: "color", value: t.color, "aria-label": "Color", class: "trk-color" });
    color.addEventListener("change", () => edit(() => { t.color = color.value; }));
    // De dónde viene
    let src;
    if (t.kind === "master") {
      src = h("select", { class: "sel small", "aria-label": "Parte del sonido" }, ...Object.entries(BANDS).map(([b, B]) => h("option", { value: b, selected: b === t.band }, B.label)));
      src.onchange = () => edit(() => { t.band = src.value; });
    } else if (t.kind === "file") {
      const audios = S.project.media.filter(m => m.kind === "audio");
      src = h("select", { class: "sel small", "aria-label": "Archivo de la pista" }, h("option", { value: "" }, "— elige un archivo —"), ...audios.map(m => h("option", { value: m.id, selected: m.id === t.media }, m.name)));
      src.onchange = () => edit(() => { t.media = src.value; }, true);
    } else {
      src = h("span", { class: "row" });
      const dev = h("select", { class: "sel small", "aria-label": "Entrada de audio" }, h("option", { value: "" }, "Entrada predeterminada"));
      inputDevices().then(ds => { for (const d of ds) if (d.deviceId && d.deviceId !== "default") dev.append(h("option", { value: d.deviceId, selected: d.deviceId === t.device }, d.label || "Entrada " + (dev.options.length))); });
      dev.onchange = () => edit(() => { t.device = dev.value; }, true);
      const ch = h("select", { class: "sel small", "aria-label": "Canal" }, h("option", { value: -1, selected: t.channel < 0 }, "Todos los canales"),
        ...Array.from({ length: 8 }, (_, c) => h("option", { value: c, selected: t.channel === c }, "Canal " + (c + 1))));
      ch.onchange = () => edit(() => { t.channel = +ch.value; }, true);
      src.append(dev, ch);
    }
    const band = t.kind !== "master" ? h("select", { class: "sel small", "aria-label": "Qué parte del sonido escucha" }, ...Object.entries(BANDS).map(([b, B]) => h("option", { value: b, selected: b === t.band }, B.label))) : null;
    if (band) band.onchange = () => edit(() => { t.band = band.value; });
    const kindLabel = { master: "🎚 De la mezcla", file: "📂 Stem", input: "🎤 Entrada" }[t.kind];
    const moves = lfosOf(t);
    const body = h("div", { class: "trk-body" },
      h("div", { class: "row" }, src, band),
      h("div", { class: "trk-meter", title: "Izquierda: lo que suena · derecha: la señal con su envolvente" }, h("div", {}, raw), h("div", {}, out)),
      h("div", { class: "trk-env" },
        cv,
        segmented({ small: true, value: t.mode, options: [["gate", "💥 En cada golpe (ADSR)"], ["follow", "〰 Sigue el volumen"]], onChange: (v) => { edit(() => { t.mode = v; }); } })),
      slider({ label: "Umbral (desde cuánto cuenta un golpe)", min: 0.02, max: 1, step: 0.01, value: t.threshold, def: 0.35, fmt: pct, onInput: set("threshold") }),
      slider({ label: "Ganancia", min: 0.1, max: 6, step: 0.05, value: t.gain, def: 1, fmt: (v) => v.toFixed(2) + "×", onInput: set("gain") }),
      slider({ label: "Ataque (A)", min: 0, max: 2, step: 0.005, value: t.attack, def: 0.01, fmt: secs, onInput: set("attack") }),
      t.mode === "gate" ? slider({ label: "Caída (D)", min: 0, max: 2, step: 0.01, value: t.decay, def: 0.25, fmt: secs, onInput: set("decay") }) : null,
      t.mode === "gate" ? slider({ label: "Sostén (S)", min: 0, max: 1, step: 0.01, value: t.sustain, def: 0.3, fmt: pct, onInput: set("sustain") }) : null,
      slider({ label: "Liberación (R)", min: 0, max: 4, step: 0.01, value: t.release, def: 0.35, fmt: secs, onInput: set("release") }),
      t.kind === "file" ? slider({ label: "Volumen", min: 0, max: 1.5, step: 0.01, value: t.vol, def: 1, fmt: pct, onInput: set("vol") }) : null,
      h("div", { class: "trk-moves" }, h("b", {}, "Qué mueve"),
        moves.length ? h("div", { class: "chips" }, ...moves.map(l => h("span", { class: "chip on" }, (describe(app, l.param)?.name || l.param) + ` (${Math.round(l.lo * 100)}–${Math.round(l.hi * 100)} %)`,
          h("button", { class: "chipx", "aria-label": "Quitar", title: "Quitar", onclick: () => edit(() => { S.project.settings.lfos = S.project.settings.lfos.filter(x => x.id !== l.id); }) }, "✕")))) : h("small", {}, "Todavía nada."),
        btn({ label: "＋ Que mueva…", kind: "small primary", onClick: () => pickTarget(t) })),
      app.tracks.err[t.id] ? h("p", { class: "warnline" }, "⚠ " + app.tracks.err[t.id]) : null);
    const det = h("details", { class: "trk", open: k === 0 && list().length === 1 ? true : undefined },
      h("summary", {}, h("span", { class: "trk-dot", style: { background: t.color } }), h("b", {}, t.name), h("small", {}, ` · ${kindLabel} · ${chanName(t.name)}`),
        h("span", { class: "grow" }),
        t.kind === "file" ? h("button", { class: `chip ${t.mute ? "on" : ""}`, title: "Silenciar (sigue moviendo cosas)", onclick: (e) => { e.preventDefault(); edit(() => { t.mute = !t.mute; }); } }, "M") : null,
        t.kind === "file" ? h("button", { class: `chip ${t.solo ? "on" : ""}`, title: "Solo esta", onclick: (e) => { e.preventDefault(); edit(() => { t.solo = !t.solo; }); } }, "S") : null,
        h("button", { class: "chip", title: "Quitar la pista", "aria-label": "Quitar la pista " + t.name, onclick: (e) => { e.preventDefault(); edit(() => { const id = t.id; cfg().list = list().filter(x => x.id !== id); S.project.settings.lfos = S.project.settings.lfos.filter(l => l.shape !== "track:" + id); }); } }, "✕")),
      h("div", { class: "row" }, name, color), body);
    return det;
  }
  // ¿Qué mueve? Cualquier control de LumaMap (efectos, opacidad, brillo, pantallas, nodos…).
  function pickTarget(t) {
    const groups = catalog(app).map(g => ({ group: g.group, items: g.items.filter(it => it.kind !== "trigger") })).filter(g => g.items.length);
    const q = h("input", { class: "text-in", placeholder: "Buscar (brillo, zoom, caleidoscopio, opacidad…)", "aria-label": "Buscar un control" });
    const lo = h("input", { type: "number", class: "text-in small", value: 0, min: 0, max: 100, step: 5, "aria-label": "Desde (%)" });
    const hi = h("input", { type: "number", class: "text-in small", value: 100, min: 0, max: 100, step: 5, "aria-label": "Hasta (%)" });
    const listEl = h("div", { class: "trk-targets" });
    const norm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const draw = () => {
      const w = norm(q.value);
      listEl.replaceChildren(...groups.map(g => {
        const its = g.items.filter(it => !w || norm(it.name + " " + g.group).includes(w)).slice(0, 60);
        return its.length ? h("div", {}, h("h4", {}, g.group), h("div", { class: "chips" }, ...its.map(it => h("button", { class: "chip", onclick: () => choose(it) }, it.name)))) : null;
      }).filter(Boolean));
      if (!listEl.children.length) listEl.append(hint("Nada con ese nombre."));
    };
    const choose = (it) => {
      closeDialog();
      edit(() => { const l = newLfo(it.id); l.shape = "track:" + t.id; l.lo = Math.max(0, Math.min(1, +lo.value / 100)); l.hi = Math.max(0, Math.min(1, +hi.value / 100)); S.project.settings.lfos.push(l); });
      toast(`🎚 ${t.name} mueve «${describe(app, it.id)?.name || it.name}»`);
    };
    q.addEventListener("input", draw);
    draw();
    dialog({ title: `🎚 ¿Qué mueve «${t.name}»?`, wide: true, content: h("div", {},
      hint("Cuando suena esta pista, el control va de «desde» a «hasta» (en % de su recorrido), con la envolvente de la pista."),
      h("div", { class: "row" }, h("span", {}, "Desde"), lo, h("span", {}, "% hasta"), hi, h("span", {}, "%")), q, listEl) });
  }

  // ---- Dibujo en vivo: medidores, la envolvente y la posición ----
  function paint() {
    if (!wrap.isConnected) return;
    for (const [id, m] of meters) {
      m.raw.style.width = Math.round((T.raw[id] || 0) * 100) + "%";
      m.out.style.width = Math.round((T.values[id] || 0) * 100) + "%";
      drawAdsr(m.cv, m.t, T.values[id] || 0);
    }
    if (transport && T.duration) { pos.value = T.position / T.duration; time.textContent = `${fmtT(T.position)} / ${fmtT(T.duration)}`; }
    requestAnimationFrame(paint);
  }
  function drawAdsr(cv, t, v) {
    const g = cv.getContext("2d"), W = cv.width, H = cv.height;
    g.clearRect(0, 0, W, H);
    const pts = t.mode === "gate" ? adsrShape(t) : [[0, 0], [t.attack, 1], [t.attack + 0.4, 1], [t.attack + 0.4 + t.release, 0]];
    const total = Math.max(0.5, pts.at(-1)[0]);
    g.strokeStyle = t.color; g.lineWidth = 2; g.beginPath();
    pts.forEach(([x, y], i) => { const px = 4 + (x / total) * (W - 8), py = H - 4 - y * (H - 8); i ? g.lineTo(px, py) : g.moveTo(px, py); });
    g.stroke();
    g.fillStyle = t.color + "55"; g.fillRect(W - 10, H - 4 - v * (H - 8), 6, v * (H - 8));
    g.fillStyle = "#fff4"; g.fillRect(0, H - 4 - t.threshold * (H - 8), 6, 2);
  }

  wrap.append(
    hint("Como un visualizador de estudio: cada parte de la música mueve una cosa distinta. El bombo hace latir el brillo, el bajo el zoom, la voz el color…"),
    addRow, transport || "",
    ...list().map(card),
    list().length ? null : hint("Empieza con «＋ Partes de mi música» (separa lo que suena en bombo, bajo, caja, voz y platillos) o carga los stems de tu canción."),
    h("small", { class: "dim" }, "En los nodos: CHOP «Pistas de audio» (un canal por pista). En «Señales» aparecen como 🎚."));
  requestAnimationFrame(paint);
  return section("🎚 Pistas de audio (multipista)", wrap);
}
