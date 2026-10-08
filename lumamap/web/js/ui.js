// web/js/ui.js
// Controles táctiles reutilizables (deslizadores grandes, botones segmentados,
// interruptores, paletas…) construidos con DOM puro.
import { icon } from "./icons.js";
import { PALETTE } from "./model.js";

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function section(title, ...children) {
  return h("section", { class: "sec" }, title ? h("h3", {}, title) : null, ...children);
}

export function row(...children) { return h("div", { class: "row" }, ...children); }

export function btn({ label = "", ic, onClick, kind = "", title, disabled, active }) {
  const b = h("button", { class: `btn ${kind} ${active ? "on" : ""}`, title: title || label, disabled, onclick: onClick });
  b.innerHTML = (ic ? icon(ic) : "") + (label ? `<span>${esc(label)}</span>` : "");
  return b;
}

/** Deslizador grande con etiqueta y valor. Doble toque en la etiqueta = valor por defecto. */
/**
 * param: id del motor de parámetros (params.js). Con él, clic derecho / mantener
 * pulsado ofrece «Aprender MIDI/OSC/DMX/tecla» y el control se actualiza solo
 * cuando lo mueve un controlador externo.
 */
export function slider({ label, min = 0, max = 1, step = 0.01, value, def, fmt, onInput, onCommit, param }) {
  const out = h("output", {}, fmt ? fmt(value) : value);
  const input = h("input", { type: "range", min, max, step, value });
  const set = (v) => { input.value = v; out.textContent = fmt ? fmt(+v) : v; onInput(+v); onCommit?.(); };
  input.addEventListener("input", () => { out.textContent = fmt ? fmt(+input.value) : input.value; onInput(+input.value); });
  input.addEventListener("change", () => onCommit?.());
  const lab = h("span", { class: "lab" }, label);
  if (def !== undefined) {
    let last = 0;
    lab.addEventListener("click", () => { const now = Date.now(); if (now - last < 400) set(def); last = now; });
    lab.title = "Doble toque: restablecer";
  }
  const root = h("label", { class: "slider", dataset: param ? { param } : undefined }, h("div", { class: "sl-head" }, lab, out), input);
  if (param) root._sync = (v) => { input.value = v; out.textContent = fmt ? fmt(+v) : v; };
  return root;
}

export function segmented({ options, value, onChange, cols, small }) {
  const wrap = h("div", { class: `seg ${small ? "small" : ""}`, style: cols ? { gridTemplateColumns: `repeat(${cols}, 1fr)` } : undefined });
  for (const [v, label, ic] of options) {
    const b = h("button", { class: v === value ? "on" : "", onclick: () => {
      wrap.querySelectorAll("button").forEach(x => x.classList.remove("on"));
      b.classList.add("on");
      onChange(v);
    } });
    b.innerHTML = (ic ? icon(ic) : "") + `<span>${esc(label)}</span>`;
    wrap.append(b);
  }
  return wrap;
}

export function toggle({ label, value, onChange, hint, param }) {
  const input = h("input", { type: "checkbox" });
  input.checked = !!value;
  input.addEventListener("change", () => onChange(input.checked));
  const root = h("label", { class: "toggle", dataset: param ? { param } : undefined }, h("span", { class: "lab" }, label, hint ? h("small", {}, hint) : null), input, h("i"));
  if (param) root._sync = (v) => { input.checked = !!v; };
  return root;
}

export function swatches({ value, onChange, palette = PALETTE, label }) {
  const wrap = h("div", { class: "swatches" });
  const pick = h("input", { type: "color", value: /^#[0-9a-f]{6}$/i.test(value) ? value : "#ffffff", title: "Otro color" });
  const mark = (v) => wrap.querySelectorAll(".sw[data-c]").forEach(x => x.classList.toggle("on", x.dataset.c.toLowerCase() === String(v).toLowerCase()));
  for (const c of palette) {
    wrap.append(h("button", { class: "sw", dataset: { c }, style: { background: c }, title: c, onclick: () => { mark(c); pick.value = c; onChange(c); } }));
  }
  pick.addEventListener("input", () => { mark(pick.value); onChange(pick.value); });
  wrap.append(h("label", { class: "sw custom", title: "Elegir color" }, pick));
  mark(value);
  return label ? h("div", { class: "field" }, h("span", { class: "lab" }, label), wrap) : wrap;
}

export function stepper({ label, value, min, max, onChange }) {
  const out = h("output", {}, value);
  const set = (v) => { v = Math.max(min, Math.min(max, v)); out.textContent = v; onChange(v); };
  return h("div", { class: "stepper" }, h("span", { class: "lab" }, label),
    btn({ ic: "left", onClick: () => set(+out.textContent - 1), kind: "icon" }), out,
    btn({ ic: "right", onClick: () => set(+out.textContent + 1), kind: "icon" }));
}

/** Rejilla de opciones grandes con icono o imagen. */
export function tiles(items, { value, onPick, cols } = {}) {
  const wrap = h("div", { class: "tiles", style: cols ? { gridTemplateColumns: `repeat(${cols}, 1fr)` } : undefined });
  for (const it of items) {
    const b = h("button", { class: `tile ${it.id === value ? "on" : ""}`, title: it.desc || it.label, onclick: () => onPick(it.id, it) });
    b.innerHTML = (it.img ? `<img src="${it.img}" alt="">` : it.ic ? icon(it.ic) : "") + `<span>${esc(it.label)}</span>`;
    wrap.append(b);
  }
  return wrap;
}

export function hint(text) { return h("p", { class: "hint" }, text); }

/* ---------------- Avisos y diálogos ---------------- */

let toastTimer = 0;
export function toast(msg, kind = "") {
  // Modo actuación: sin avisos en pantalla salvo errores.
  if (document.body.classList.contains("perfmode") && kind !== "err") return;
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "show " + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ""; }, kind === "err" ? 5000 : 2600);
}

/** Diálogo modal. content: Node; buttons: [{label, kind, value}] → Promise<value>. */
export function dialog({ title, content, buttons = [{ label: "Cerrar", value: null }], wide }) {
  return new Promise((resolve) => {
    const root = document.getElementById("modal");
    const close = (v) => { root.classList.remove("show"); root.innerHTML = ""; resolve(v); };
    const box = h("div", { class: `dlg ${wide ? "wide" : ""}` },
      h("div", { class: "dlg-head" }, h("h2", {}, title), btn({ ic: "close", kind: "icon", onClick: () => close(null) })),
      h("div", { class: "dlg-body" }, content),
      buttons.length ? h("div", { class: "dlg-foot" }, ...buttons.map(b => btn({ label: b.label, kind: b.kind || "", onClick: () => close(typeof b.value === "function" ? b.value() : b.value) }))) : null);
    root.innerHTML = "";
    root.append(box);
    root.onclick = (e) => { if (e.target === root) close(null); };
    root.classList.add("show");
    root._close = close;
  });
}

export function closeDialog(v = null) {
  const root = document.getElementById("modal");
  if (root._close && root.classList.contains("show")) { root._close(v); return true; }
  return false;
}

export async function prompt(title, value = "", placeholder = "") {
  const input = h("input", { type: "text", value, placeholder, class: "text-in" });
  setTimeout(() => { input.focus(); input.select(); }, 50);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") closeDialog(input.value); });
  return dialog({ title, content: input, buttons: [{ label: "Cancelar", value: null }, { label: "Aceptar", kind: "primary", value: () => input.value }] });
}

export async function confirmDlg(title, text, okLabel = "Aceptar", kind = "danger") {
  return dialog({ title, content: h("p", {}, text), buttons: [{ label: "Cancelar", value: false }, { label: okLabel, kind, value: true }] });
}
