// web/js/td/animeditor.js
// Editor de curvas (fotogramas clave) de un Animation CHOP, abajo en el editor de redes, como el
// «Animation Editor» de TouchDesigner o el editor de gráficas de After Effects:
//   · los canales a la izquierda (ver/ocultar, renombrar, añadir, borrar);
//   · las curvas con sus claves ◆: arrastrar una clave la mueve en el tiempo y en valor, doble clic
//     en el vacío pone una clave, Supr la borra, la forma de cada tramo se elige arriba;
//   · la regla de arriba mueve el cursor de tiempo (el de la red) y la rueda acerca.
import { h, btn, toast, prompt } from "../ui.js";
import { EASES, evalChan, setKey, removeKey, valueRange, uniqueChan, normalizeAnim } from "./anim.js";
import { nodeById } from "./graph.js";

const COLS = ["#22c55e", "#00e5ff", "#ff2d8a", "#ffd23f", "#a78bfa", "#fb923c", "#38bdf8", "#f472b6"];
const RULER = 20;

export class AnimEditor {
  /** o: { app, netId, nodeId, chan?, getTime(): s, seek(s), onClose(), onChange() } */
  constructor(o) {
    Object.assign(this, o);
    this.hidden = new Set();
    this.sel = null;              // { ch, key }
    this.view = null;             // [t0, t1, v0, v1]
    this.drag = null;
    this.dpr = 1;
    this.el = h("div", { class: "tdanim", tabindex: "0", role: "region", "aria-label": "Editor de curvas" });
    this.canvas = h("canvas", { class: "tdanimcv" });
    this.ctx = this.canvas.getContext("2d");
    this.list = h("div", { class: "tdanimchans" });
    this.bar = h("div", { class: "tdanimbar" });
    this.el.append(this.bar, h("div", { class: "tdanimbody" }, this.list, h("div", { class: "tdanimwrap" }, this.canvas)));
    this.bindCanvas();
    this.el.addEventListener("keydown", (e) => this.onKey(e));
    this.rebuild();
  }
  get net() { return this.app.S.project.networks?.find(n => n.id === this.netId) || null; }
  get node() { return nodeById(this.net, this.nodeId); }
  get anim() {
    const n = this.node;
    if (!n) return null;
    if (!n.p.anim || !Array.isArray(n.p.anim.chans)) n.p.anim = normalizeAnim(n.p.anim);
    return n.p.anim;
  }
  edited(commit = true) { this.app.changed?.(); if (commit) this.app.commitSoon?.(); this.onChange?.(); }
  setNode(nodeId, chan = null) { this.nodeId = nodeId; this.view = null; this.sel = null; if (chan) { this.hidden.clear(); this.focusChan = chan; } this.rebuild(); }

  /* ---------------- Barra y canales ---------------- */
  rebuild() {
    const A = this.anim, n = this.node;
    if (!A || !n) { this.bar.replaceChildren(h("b", {}, "Sin animación"), h("span", { class: "grow" }), h("button", { class: "tdx", "aria-label": "Cerrar curvas", onclick: () => this.onClose?.() }, "✕")); this.list.replaceChildren(); return; }
    const ease = h("select", { class: "sel small", title: "Forma del tramo que sale de la clave elegida", "aria-label": "Forma del tramo", disabled: !this.sel || undefined },
      ...EASES.map(([v, l]) => h("option", { value: v, selected: this.sel?.key.e === v }, l)));
    ease.onchange = () => { if (this.sel) { this.sel.key.e = ease.value; this.edited(); } };
    const len = h("input", { type: "number", class: "text-in small tdanimlen", min: 0.1, step: 0.1, value: A.length, title: "Duración de la animación (s)", "aria-label": "Duración (s)" });
    len.addEventListener("change", () => { const v = +len.value; if (v > 0) { A.length = Math.min(3600, v); this.view = null; this.edited(); } });
    len.addEventListener("keydown", (e) => e.stopPropagation());
    const valIn = h("input", { type: "number", class: "text-in small tdanimval", step: "any", value: this.sel ? +this.sel.key.v.toFixed(4) : "", disabled: !this.sel || undefined, title: "Valor de la clave elegida", "aria-label": "Valor de la clave" });
    valIn.addEventListener("change", () => { if (this.sel && Number.isFinite(+valIn.value)) { this.sel.key.v = +valIn.value; this.edited(); } });
    valIn.addEventListener("keydown", (e) => e.stopPropagation());
    const timeIn = h("input", { type: "number", class: "text-in small tdanimval", step: 0.01, min: 0, value: this.sel ? +this.sel.key.t.toFixed(3) : "", disabled: !this.sel || undefined, title: "Instante de la clave elegida (s)", "aria-label": "Instante de la clave" });
    timeIn.addEventListener("change", () => { if (this.sel && Number.isFinite(+timeIn.value)) { this.sel.key.t = Math.max(0, +timeIn.value); this.sel.ch.keys.sort((a, b) => a.t - b.t); this.edited(); } });
    timeIn.addEventListener("keydown", (e) => e.stopPropagation());
    this.bar.replaceChildren(
      h("b", { class: "tdanimtitle" }, `◆ Curvas · ${n.name}`),
      btn({ label: "◆ Clave en el cursor", kind: "small primary", title: "Pone una clave en el instante del cursor en los canales que se ven (con su valor de ahora)", onClick: () => this.keyAtCursor() }),
      btn({ label: "＋ Canal", kind: "small", onClick: () => this.addChan() }),
      h("label", { class: "tdanimlab" }, "Clave:", timeIn, "s", valIn),
      ease,
      btn({ label: "Borrar clave", kind: "small", disabled: !this.sel, onClick: () => this.deleteKey() }),
      h("label", { class: "tdanimlab" }, "Dura", len, "s"),
      btn({ label: "⌖ Encuadrar", kind: "small", onClick: () => { this.view = null; } }),
      h("span", { class: "grow" }),
      h("button", { class: "tdx", title: "Cerrar las curvas", "aria-label": "Cerrar curvas", onclick: () => this.onClose?.() }, "✕"));
    this.list.replaceChildren(...A.chans.map((c, k) => {
      const on = !this.hidden.has(c.name);
      const row = h("div", { class: `tdanimch ${on ? "" : "off"} ${this.sel?.ch === c ? "sel" : ""}` },
        h("button", { class: "tdanimeye", title: on ? "Ocultar la curva" : "Ver la curva", "aria-label": (on ? "Ocultar " : "Ver ") + c.name, onclick: () => { on ? this.hidden.add(c.name) : this.hidden.delete(c.name); this.rebuild(); } }, on ? "●" : "○"),
        h("b", { title: "Doble clic: renombrar", ondblclick: () => this.renameChan(c) }, c.name),
        h("small", {}, `${c.keys.length} ◆`),
        h("button", { class: "tdanimdel", title: "Borrar el canal", "aria-label": "Borrar " + c.name, onclick: () => this.deleteChan(c) }, "✕"));
      row.style.setProperty("--c", COLS[k % COLS.length]);
      return row;
    }), h("small", { class: "tdanimhelp" }, "Doble clic en las curvas: nueva clave · arrastra una ◆ · Supr: borrar · rueda: zoom · arriba: mover el tiempo"));
    if (this.focusChan) { for (const c of A.chans) if (c.name !== this.focusChan) this.hidden.add(c.name); this.focusChan = null; this.rebuild(); }
  }
  visibleChans() { const A = this.anim; return A ? A.chans.filter(c => !this.hidden.has(c.name)) : []; }
  async addChan() {
    const A = this.anim; if (!A) return;
    const name = await prompt("Nombre del canal nuevo (letras, números y _)", uniqueChan(A, "chan"));
    if (!name) return;
    const nm = uniqueChan(A, name);
    const v = 0;
    A.chans.push({ name: nm, keys: [{ t: 0, v, e: "smooth" }] });
    this.edited(); this.rebuild();
  }
  async renameChan(c) {
    const A = this.anim;
    const name = await prompt("Nombre del canal", c.name);
    if (!name || name === c.name) return;
    const nm = uniqueChan(A, name), old = c.name;
    c.name = nm;
    // Las expresiones que lo usaban (anim1.viejo) siguen funcionando.
    const node = this.node;
    for (const o of this.net.nodes) for (const [k, v] of Object.entries(o.p)) if (v && typeof v === "object" && typeof v.e === "string") v.e = v.e.replace(new RegExp(`\\b${node.name}\\.${old}\\b`, "g"), `${node.name}.${nm}`);
    this.edited(); this.rebuild();
  }
  deleteChan(c) { const A = this.anim; A.chans = A.chans.filter(x => x !== c); if (this.sel?.ch === c) this.sel = null; this.edited(); this.rebuild(); }
  deleteKey() { if (!this.sel) return; removeKey(this.sel.ch, this.sel.key); this.sel = null; this.edited(); this.rebuild(); }
  keyAtCursor() {
    const t = this.getTime?.() ?? 0, list = this.visibleChans();
    if (!list.length) { toast("No hay canales a la vista: pulsa «＋ Canal»", "warn"); return; }
    let last = null;
    for (const c of list) last = { ch: c, key: setKey(c, t, evalChan(c, t)) };
    this.sel = last; this.edited(); this.rebuild();
  }
  onKey(e) {
    if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) return;
    if ((e.key === "Delete" || e.key === "Backspace") && this.sel) { e.preventDefault(); e.stopPropagation(); this.deleteKey(); }
  }

  /* ---------------- Curvas ---------------- */
  range() {
    const A = this.anim;
    if (!this.view) { const [v0, v1] = valueRange(this.visibleChans()); this.view = [0, A ? A.length : 4, v0, v1]; }
    return this.view;
  }
  toPx(t, v) { const [t0, t1, v0, v1] = this.range(), W = this.canvas.width / this.dpr, H = this.canvas.height / this.dpr; return [(t - t0) / (t1 - t0) * W, RULER + (1 - (v - v0) / (v1 - v0)) * (H - RULER - 6)]; }
  fromPx(x, y) { const [t0, t1, v0, v1] = this.range(), W = this.canvas.width / this.dpr, H = this.canvas.height / this.dpr; return [t0 + x / W * (t1 - t0), v0 + (1 - (y - RULER) / (H - RULER - 6)) * (v1 - v0)]; }
  hitKey(x, y) {
    let best = null, bd = 9;
    for (const c of this.visibleChans()) for (const k of c.keys) { const [px, py] = this.toPx(k.t, k.v); const d = Math.hypot(px - x, py - y); if (d < bd) { bd = d; best = { ch: c, key: k }; } }
    return best;
  }
  bindCanvas() {
    const C = this.canvas;
    const pos = (e) => { const r = C.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    C.addEventListener("pointerdown", (e) => {
      this.el.focus({ preventScroll: true });
      const [x, y] = pos(e);
      if (y < RULER) { this.drag = { kind: "time" }; this.seek?.(Math.max(0, this.fromPx(x, y)[0])); C.setPointerCapture?.(e.pointerId); return; }
      const hit = this.hitKey(x, y);
      if (hit) { this.sel = hit; this.drag = { kind: "key", moved: false, x, y, t0: hit.key.t, v0: hit.key.v }; C.setPointerCapture?.(e.pointerId); this.rebuild(); return; }
      if (e.button === 1 || e.button === 2 || e.shiftKey) { this.drag = { kind: "pan", x, y, view: [...this.range()] }; C.setPointerCapture?.(e.pointerId); return; }
      if (this.sel) { this.sel = null; this.rebuild(); }
    });
    C.addEventListener("pointermove", (e) => {
      const d = this.drag; if (!d) return;
      const [x, y] = pos(e);
      if (d.kind === "time") { this.seek?.(Math.max(0, this.fromPx(x, y)[0])); return; }
      if (d.kind === "pan") {
        const [t0, t1, v0, v1] = d.view, W = C.width / this.dpr, H = C.height / this.dpr;
        const dt = (x - d.x) / W * (t1 - t0), dv = (y - d.y) / (H - RULER) * (v1 - v0);
        this.view = [t0 - dt, t1 - dt, v0 + dv, v1 + dv]; return;
      }
      if (d.kind === "key" && this.sel) {
        if (!d.moved && Math.hypot(x - d.x, y - d.y) < 3) return;
        d.moved = true;
        let [t, v] = this.fromPx(x, y);
        if (e.shiftKey) { if (Math.abs(x - d.x) > Math.abs(y - d.y)) v = d.v0; else t = d.t0; }   // Mayús: solo en un eje
        const fps = 30;
        this.sel.key.t = Math.max(0, Math.round(t * fps) / fps);
        this.sel.key.v = Math.round(v * 1000) / 1000;
        this.sel.ch.keys.sort((a, b) => a.t - b.t);
        this.edited(false);
      }
    });
    const up = () => { const d = this.drag; this.drag = null; if (d?.kind === "key" && d.moved) { this.edited(); this.rebuild(); } };
    C.addEventListener("pointerup", up);
    C.addEventListener("pointercancel", up);
    C.addEventListener("dblclick", (e) => {
      const [x, y] = pos(e);
      if (y < RULER || this.hitKey(x, y)) return;
      const list = this.visibleChans();
      if (!list.length) return;
      const [t, v] = this.fromPx(x, y);
      // En el canal cuya curva pasa más cerca.
      let best = list[0], bd = Infinity;
      for (const c of list) { const d = Math.abs(this.toPx(t, evalChan(c, t))[1] - y); if (d < bd) { bd = d; best = c; } }
      this.sel = { ch: best, key: setKey(best, Math.round(t * 30) / 30, Math.round(v * 1000) / 1000) };
      this.edited(); this.rebuild();
    });
    C.addEventListener("wheel", (e) => {
      e.preventDefault();
      const [x, y] = pos(e), [t, v] = this.fromPx(x, y), k = Math.exp(e.deltaY * 0.0015), V = this.range();
      if (e.shiftKey) this.view = [V[0], V[1], v - (v - V[2]) * k, v + (V[3] - v) * k];
      else this.view = [Math.max(-1, t - (t - V[0]) * k), t + (V[1] - t) * k, V[2], V[3]];
    }, { passive: false });
    C.addEventListener("contextmenu", (e) => e.preventDefault());
  }
  draw() {
    const C = this.canvas, wrap = C.parentElement;
    if (!wrap || !this.anim) return;
    const dpr = this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.max(50, wrap.clientWidth), H = Math.max(60, wrap.clientHeight);
    if (C.width !== Math.round(W * dpr) || C.height !== Math.round(H * dpr)) { C.width = Math.round(W * dpr); C.height = Math.round(H * dpr); C.style.width = W + "px"; C.style.height = H + "px"; }
    const g = this.ctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = "#0b0f15"; g.fillRect(0, 0, W, H);
    const [t0, t1, v0, v1] = this.range(), A = this.anim;
    // Zona fuera de la duración.
    const [xe] = this.toPx(A.length, 0), [xs] = this.toPx(0, 0);
    g.fillStyle = "#0006"; if (xe < W) g.fillRect(xe, RULER, W - xe, H); if (xs > 0) g.fillRect(0, RULER, xs, H);
    // Rejilla y regla.
    g.font = "10px system-ui"; g.textBaseline = "middle";
    const step = niceStep((t1 - t0) / Math.max(2, W / 80));
    g.fillStyle = "#141a24"; g.fillRect(0, 0, W, RULER);
    for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) {
      const [x] = this.toPx(t, 0);
      g.strokeStyle = "#1c2433"; g.beginPath(); g.moveTo(x, RULER); g.lineTo(x, H); g.stroke();
      g.fillStyle = "#8a96ab"; g.fillText(fmt(t) + "s", x + 3, RULER / 2);
    }
    const vstep = niceStep((v1 - v0) / Math.max(2, (H - RULER) / 40));
    for (let v = Math.ceil(v0 / vstep) * vstep; v <= v1; v += vstep) {
      const [, y] = this.toPx(0, v);
      g.strokeStyle = Math.abs(v) < vstep / 2 ? "#2f3b52" : "#161d29"; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
      g.fillStyle = "#6b778c"; g.fillText(fmt(v), 3, y - 6);
    }
    // Curvas y claves.
    A.chans.forEach((c, k) => {
      if (this.hidden.has(c.name)) return;
      const col = COLS[k % COLS.length];
      g.strokeStyle = col; g.lineWidth = 2; g.beginPath();
      for (let x = 0; x <= W; x += 2) { const t = t0 + x / W * (t1 - t0), [, y] = this.toPx(t, evalChan(c, t)); x ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke();
      for (const key of c.keys) {
        const [x, y] = this.toPx(key.t, key.v), on = this.sel?.key === key;
        g.save(); g.translate(x, y); g.rotate(Math.PI / 4);
        g.fillStyle = on ? "#fff" : col; g.fillRect(-4.5, -4.5, 9, 9);
        g.strokeStyle = "#000"; g.lineWidth = 1; g.strokeRect(-4.5, -4.5, 9, 9);
        g.restore();
      }
    });
    // Cursor de tiempo.
    const T = this.getTime?.() ?? 0, [xt] = this.toPx(T, 0);
    g.strokeStyle = "#ff3b5c"; g.lineWidth = 1.5; g.beginPath(); g.moveTo(xt, 0); g.lineTo(xt, H); g.stroke();
    g.fillStyle = "#ff3b5c"; g.fillRect(xt - 18, 2, 36, RULER - 4); g.fillStyle = "#fff"; g.textAlign = "center"; g.fillText(fmt(T), xt, RULER / 2); g.textAlign = "left";
  }
}
function niceStep(x) { const p = Math.pow(10, Math.floor(Math.log10(Math.max(1e-6, x)))), m = x / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p; }
function fmt(v) { return Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : +v.toFixed(2) + ""; }
