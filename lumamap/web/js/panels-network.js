// web/js/panels-network.js
// Editor de redes de nodos, como TouchDesigner, a pantalla completa:
//   · menús Archivo / Editar / Añadir / Ver / Red / Ayuda y barra de herramientas;
//   · crear operadores (Tab o clic derecho) por familias TOP, CHOP, SOP, COMP, MAT y DAT, con buscador;
//   · cables arrastrando de la salida (derecha) a una entrada (izquierda); soltar en el vacío crea un
//     nodo ya conectado; en el móvil, toca la salida y luego el nodo de destino;
//   · cada nodo con su visor en vivo (imagen o canales), sus banderas (⏻ bypass, 👁 de fondo) y su
//     tiempo de cálculo; la imagen elegida se ve de fondo detrás de la red;
//   · panel de parámetros con expresiones (ƒx), enlazar a un canal (🔗), páginas, aprender MIDI/OSC…;
//   · copiar/pegar/duplicar, deshacer, encuadrar (H, F), mover con el teclado, caja de selección,
//     zoom con la rueda o pellizcando;
//   · ejemplos listos y «Usar en una superficie» para proyectarlo.
import { h, btn, dialog, closeDialog, toast, hint, prompt, confirmDlg } from "./ui.js";
import { FAMILIES, OP_LIST, opDef, defOf, searchOps, acceptsInput } from "./td/ops.js";
import { newNetwork, addNode, connect, disconnect, removeNodes, removeKeepWires, copyNodes, pasteNodes, renameNode, nodeById, nodeByName, freeInput, isExpr, outputsOf } from "./td/graph.js";
import { compileExpr, EXPR_FUNCS } from "./td/expr.js";
import { EXAMPLES, buildExample } from "./td/examples.js";
import { exportTargets } from "./td/params-net.js";
import { catalog, describe } from "./params.js";
import { listCameras, cameraName } from "./sources.js";
import { listShaders } from "./plugins.js";
import { openNodes } from "./panels-nodes.js";

const NW = 160, VIEW_H = 90, IN_Y0 = 36, IN_DY = 20, GRID = 10;
const FAM_SHORT = { TOP: "TOP", CHOP: "CHOP", SOP: "SOP", COMP: "COMP", MAT: "MAT", DAT: "DAT" };
const MOBILE = typeof navigator !== "undefined" && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent || "");
const ed = { open: false, netId: null, sel: new Set(), selWire: null, project: null, grid: true, viewers: true, bg: true, params: true, pinParams: false, clip: null, pendingFrom: null, raf: 0, lastViewers: 0, lastInfo: 0, perform: false, famFilter: "" };
let app = null;

/* ======================================================================
   Abrir / cerrar
   ====================================================================== */
const nets = () => (app.S.project.networks ||= []);
const curNet = () => nets().find(n => n.id === ed.netId) || null;
export const networkEditorOpen = () => ed.open;

export async function openNetworkEditor(a, { netId = null, nodeId = null } = {}) {
  app = a;
  await app.ensureTd?.();
  closeDialog();
  if (!nets().length) app.edit(() => { const n = newNetwork("Red 1"); nets().push(n); });
  ed.netId = (netId && nets().some(n => n.id === netId)) ? netId : (nets().some(n => n.id === ed.netId) ? ed.netId : nets()[0].id);
  ed.sel = new Set(nodeId ? [nodeId] : []);
  ed.open = true;
  ed.project = app.S.project;
  let root = document.getElementById("tdws");
  if (!root) { root = h("div", { id: "tdws", class: "tdws" }); document.body.append(root); }
  root.classList.add("show");
  document.body.classList.add("tdopen");
  buildUI(root);
  cancelAnimationFrame(ed.raf);
  ed.raf = requestAnimationFrame(loop);
}
export function closeNetworkEditor() {
  ed.open = false; ed.perform = false;
  cancelAnimationFrame(ed.raf);
  document.getElementById("tdws")?.classList.remove("show");
  document.body.classList.remove("tdopen");
  if (app) { app.commit?.(); app.changed?.({ panel: true }); }
}

/* ======================================================================
   Construcción de la interfaz
   ====================================================================== */
let R = {};   // referencias a los elementos
function buildUI(root) {
  root.innerHTML = "";
  const bar = h("div", { class: "tdbar" });
  const pane = h("div", { class: "tdpane", tabindex: "0" });
  const bg = h("canvas", { class: "tdbg" });
  const world = h("div", { class: "tdworld" });
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "tdwires");
  const nodesEl = h("div", { class: "tdnodes" });
  world.append(svg, nodesEl);
  const box = h("div", { class: "tdbox" });
  pane.append(bg, world, box, h("div", { class: "tdhelp" }, MOBILE ? "Arrastra para moverte · pellizca para zoom · mantén pulsado para crear · toca la salida ● y luego otro nodo para conectar" : "Tab o clic derecho: crear · arrastra de la salida ● a la entrada ○ · rueda: zoom · espacio/botón central: moverse · H: ver todo"));
  const params = h("div", { class: "tdparams" });
  const body = h("div", { class: "tdbody" }, pane, params);
  root.append(bar, body);
  R = { root, bar, pane, bg, bgx: bg.getContext("2d"), world, svg, nodesEl, box, params, body };
  buildBar();
  bindPane();
  renderAll();
  setTimeout(() => { if (!curNet()?.nodes.length) toast("Red vacía: pulsa «＋ Operador» (o Tab) o abre un ejemplo en Archivo → Ejemplos"); else frameAll(); }, 30);
}

/* ---------------- Barra con menús ---------------- */
function menu(label, items) {
  const b = h("button", { class: "tdmenu" }, label);
  b.onclick = (e) => { e.stopPropagation(); popMenu(b, items()); };
  return b;
}
function popMenu(anchor, items, at = null) {
  closePop();
  const m = h("div", { class: "tdpop tdmenulist", role: "menu" }, ...items.filter(Boolean).map(it => it === "-" ? h("hr") :
    h("button", { class: `tdmi ${it.on ? "on" : ""}`, disabled: it.disabled, role: "menuitem", onclick: (e) => { e.stopPropagation(); closePop(); it.run(); } }, h("span", {}, it.label), it.keys ? h("kbd", {}, it.keys) : null)));
  R.root.append(m);
  const r = at || anchor.getBoundingClientRect(), W = window.innerWidth, H = window.innerHeight;
  const x = at ? at.x : r.left, y = at ? at.y : r.bottom + 2;
  m.style.left = Math.max(4, Math.min(W - 250, x)) + "px";
  m.style.top = Math.max(4, Math.min(H - Math.min(H * 0.8, items.length * 34 + 16), y)) + "px";
  setTimeout(() => document.addEventListener("pointerdown", closePopOutside, true), 0);
}
function closePopOutside(e) { if (!e.target.closest?.(".tdpop")) closePop(); }
function closePop() { document.querySelectorAll("#tdws .tdpop").forEach(x => x.remove()); document.removeEventListener("pointerdown", closePopOutside, true); }

function buildBar() {
  const net = curNet();
  const sel = h("select", { class: "tdnetsel", title: "Red que estás editando" }, ...nets().map(n => h("option", { value: n.id, selected: n.id === ed.netId }, n.name)));
  sel.onchange = () => { ed.netId = sel.value; ed.sel.clear(); renderAll(); frameAll(); };
  R.bar.replaceChildren(
    h("b", { class: "tdlogo" }, "🔗 Redes"),
    sel,
    menu("Archivo", () => [
      { label: "Nueva red vacía", run: () => newNet() },
      { label: "Ejemplos…", run: () => openExamples() },
      "-",
      { label: "Renombrar la red", run: () => renameNet() },
      { label: "Duplicar la red", run: () => dupNet() },
      { label: "Guardar la red en un archivo (.json)", run: () => exportNet() },
      { label: "Abrir una red de un archivo…", run: () => importNet() },
      "-",
      { label: "Borrar la red", run: () => deleteNet(), disabled: !net },
      "-",
      { label: "Volver a LumaMap", keys: "Esc", run: () => closeNetworkEditor() },
    ]),
    menu("Editar", () => [
      { label: "Deshacer", keys: "Ctrl+Z", run: () => undo() },
      { label: "Rehacer", keys: "Ctrl+Y", run: () => redo() },
      "-",
      { label: "Cortar", keys: "Ctrl+X", run: () => { copySel(); deleteSel(); }, disabled: !ed.sel.size },
      { label: "Copiar", keys: "Ctrl+C", run: () => copySel(), disabled: !ed.sel.size },
      { label: "Pegar", keys: "Ctrl+V", run: () => pasteClip(), disabled: !ed.clip },
      { label: "Duplicar", keys: "Ctrl+D", run: () => duplicateSel(), disabled: !ed.sel.size },
      { label: "Borrar", keys: "Supr", run: () => deleteSel(), disabled: !ed.sel.size && !ed.selWire },
      { label: "Borrar dejando pasar los cables", run: () => deleteSel(true), disabled: ed.sel.size !== 1 },
      { label: "Seleccionar todo", keys: "Ctrl+A", run: () => { ed.sel = new Set(curNet().nodes.map(n => n.id)); renderAll(); } },
      "-",
      { label: "Apagar / encender (bypass)", keys: "B", run: () => toggleBypassSel(), disabled: !ed.sel.size },
      { label: "Ver de fondo (display)", keys: "D", run: () => setDisplaySel(), disabled: ed.sel.size !== 1 },
      { label: "Comentario…", run: () => commentSel(), disabled: ed.sel.size !== 1 },
      { label: "Ordenar los nodos", run: () => autoLayout() },
    ]),
    menu("Añadir", () => [
      ...Object.entries(FAMILIES).map(([k, f]) => ({ label: `${f.name} (${OP_LIST.filter(o => o.fam === k).length})`, run: () => openCreate({ fam: k }) })),
      "-",
      { label: "Buscar un operador…", keys: "Tab", run: () => openCreate({}) },
    ]),
    menu("Ver", () => [
      { label: "Encuadrar todo", keys: "H", run: () => frameAll() },
      { label: "Encuadrar lo elegido", keys: "F", run: () => frameSel(), disabled: !ed.sel.size },
      "-",
      { label: "Visores en los nodos", on: ed.viewers, run: () => { ed.viewers = !ed.viewers; renderAll(); } },
      { label: "Imagen de fondo", on: ed.bg, run: () => { ed.bg = !ed.bg; } },
      { label: "Rejilla (imán)", on: ed.grid, run: () => { ed.grid = !ed.grid; R.pane.classList.toggle("nogrid", !ed.grid); } },
      { label: "Panel de parámetros", keys: "P", on: ed.params, run: () => toggleParams() },
      "-",
      { label: "Cadena de cada superficie (vista simple)", run: () => openNodes(app) },
    ]),
    menu("Red", () => [
      { label: "▶ Usar en una superficie (proyectar)", run: () => useOnSurface() },
      { label: "Pantalla completa del fondo (actuar)", keys: "F11", run: () => togglePerform() },
      "-",
      { label: "Resolución de la red…", run: () => netResolution() },
      { label: "Rendimiento (lo que más tarda)", run: () => perfDialog() },
    ]),
    menu("Ayuda", () => [
      { label: "Atajos de teclado", run: () => helpKeys() },
      { label: "Expresiones (ƒx)", run: () => helpExpr() },
      { label: "Qué es cada familia (TOP, CHOP…)", run: () => helpFamilies() },
      { label: "🎓 Aprender con Luma (capítulo de redes)", run: () => { closeNetworkEditor(); app.academy ? app.academy.start(19) : app.startTutorial?.(); } },
    ]),
    h("span", { class: "grow" }),
    btn({ label: "＋ Operador", kind: "small primary", title: "Crear un operador (Tab)", onClick: () => openCreate({}) }),
    btn({ label: "▶ Usar en superficie", kind: "small", title: "Proyectar la salida de esta red en una superficie", onClick: () => useOnSurface() }),
    btn({ label: "⚙", kind: "small", title: "Panel de parámetros (P)", onClick: () => toggleParams() }),
    h("button", { class: "tdclose", title: "Volver a LumaMap (Esc)", "aria-label": "Cerrar el editor de redes", onclick: () => closeNetworkEditor() }, "✕"));
}

/* ======================================================================
   Dibujar la red
   ====================================================================== */
const view = () => curNet()?.view || { x: 0, y: 0, z: 1 };
function applyView() {
  const v = view();
  R.world.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.z})`;
  R.pane.style.setProperty("--gz", v.z);
  R.pane.style.backgroundPosition = `${v.x}px ${v.y}px`;
  R.pane.style.backgroundSize = `${20 * v.z}px ${20 * v.z}px`;
}
function renderAll() {
  if (!ed.open) return;
  const net = curNet();
  if (!net) return;
  for (const id of [...ed.sel]) if (!nodeById(net, id)) ed.sel.delete(id);
  R.nodesEl.replaceChildren(...net.nodes.map(nodeEl));
  applyView();
  drawWires();
  renderParams();
  R.pane.classList.toggle("nogrid", !ed.grid);
}
function nodeHeight(n) { const def = defOf(n); return 30 + (ed.viewers && n.viewer !== false ? (n.fam === "TOP" ? VIEW_H : n.fam === "CHOP" ? 56 : 38) : 8) + Math.max(0, def.inputs[1] - 2) * 6; }
function nodeEl(n) {
  const def = defOf(n), fam = FAMILIES[n.fam], net = curNet();
  const el = h("div", { class: `tdnode ${ed.sel.has(n.id) ? "sel" : ""} ${n.bypass ? "bypass" : ""} ${net.display === n.id ? "display" : ""}`, "data-id": n.id, "data-fam": n.fam, "data-type": n.type, title: `${def.label} (${n.fam}) — ${def.desc}${n.comment ? "\n💬 " + n.comment : ""}` });
  el.style.left = n.x + "px"; el.style.top = n.y + "px"; el.style.width = NW + "px";
  el.style.setProperty("--fam", fam.color);
  const flags = h("span", { class: "tdflags" },
    h("button", { class: `tdflag ${n.bypass ? "on" : ""}`, title: n.bypass ? "Encender (quitar bypass)" : "Apagar sin borrar (bypass)", "aria-label": "Bypass", "data-flag": "bypass" }, "⏻"),
    n.fam === "TOP" ? h("button", { class: `tdflag ${net.display === n.id ? "on" : ""}`, title: "Ver esta imagen de fondo (display)", "aria-label": "Ver de fondo", "data-flag": "display" }, "👁") : null,
    h("button", { class: `tdflag ${n.viewer !== false ? "on" : ""}`, title: "Visor del nodo", "aria-label": "Visor", "data-flag": "viewer" }, "▣"));
  const head = h("div", { class: "tdnhead" }, h("i", { class: "tdfam" }, FAM_SHORT[n.fam]), h("b", { class: "tdname" }, n.name), flags);
  let viewer = null;
  if (ed.viewers && n.viewer !== false) {
    if (n.fam === "TOP") { viewer = h("canvas", { class: "tdview", width: NW - 8, height: VIEW_H - 6 }); }
    else if (n.fam === "CHOP") viewer = h("canvas", { class: "tdview chop", width: NW - 8, height: 50 });
    else viewer = h("div", { class: "tdsum" }, summary(n));
  }
  const ins = [];
  for (let k = 0; k < def.inputs[1]; k++) {
    const d = h("span", { class: `tdin ${n.in[k] ? "on" : ""} ${k < def.inputs[0] ? "need" : ""}`, "data-in": k, title: `Entrada ${k + 1}${k < def.inputs[0] ? " (necesaria)" : ""}` });
    d.style.top = (IN_Y0 + k * IN_DY - 7) + "px";
    ins.push(d);
  }
  const out = n.fam === "MAT" || n.fam === "DAT" || (n.fam === "COMP") ? null : h("span", { class: "tdout", "data-out": "1", title: "Salida: arrástrala a la entrada de otro nodo" });
  if (out) out.style.top = (IN_Y0 - 7) + "px";
  const foot = h("small", { class: "tdinfo" }, n.comment ? "💬 " + n.comment.slice(0, 26) : def.label);
  el.append(head, viewer || h("div", { class: "tdsp" }), foot, ...ins, out || "");
  return el;
}
function summary(n) {
  const p = n.p, def = defOf(n);
  const val = (k) => { const v = p[k]; return isExpr(v) ? "ƒx" : v; };
  switch (n.fam) {
    case "SOP": return def.label + (p.radius !== undefined ? ` · r ${val("radius")}` : "");
    case "COMP": return n.type === "geo" ? (p.instancing ? `Instancias de ${p.instanceop || "?"}` : `Material: ${p.material || "—"}`) : n.type === "camera" ? `Fov ${val("fov")}°` : "Luz " + ["puntual", "sol", "foco", "ambiente"][p.kind | 0];
    case "MAT": { const sw = h("i", { class: "tdswatch" }); sw.style.background = p.color || "#888"; return h("span", {}, sw, " ", p.map ? "Textura: " + p.map : def.label); }
    case "DAT": return String(p.text || "").split("\n")[0].slice(0, 30) || "(vacío)";
  }
  return def.label;
}
/** Posición (en el mundo) de una entrada o salida. */
function portPos(n, kind, k = 0) { return kind === "out" ? [n.x + NW, n.y + IN_Y0] : [n.x, n.y + IN_Y0 + k * IN_DY]; }
function wirePath(a, b) {
  const dx = Math.max(40, Math.abs(b[0] - a[0]) * 0.5);
  return `M${a[0]},${a[1]} C${a[0] + dx},${a[1]} ${b[0] - dx},${b[1]} ${b[0]},${b[1]}`;
}
function drawWires(temp = null) {
  const net = curNet(), svg = R.svg;
  const parts = [];
  for (const n of net.nodes) n.in.forEach((src, k) => {
    const a = nodeById(net, src);
    if (!a) return;
    const sel = ed.selWire && ed.selWire.dst === n.id && ed.selWire.idx === k;
    const d = wirePath(portPos(a, "out"), portPos(n, "in", k));
    parts.push(`<path class="tdhit" data-dst="${n.id}" data-idx="${k}" d="${d}"/><path class="tdwire ${sel ? "sel" : ""} ${a.bypass ? "dim" : ""}" style="stroke:${FAMILIES[a.fam].color}" d="${d}"/>`);
  });
  // Referencias por parámetro (material, textura, CHOP de instancias, feedback…): línea punteada como en TouchDesigner.
  for (const n of net.nodes) for (const q of defOf(n).params) if (q.type === "op" && n.p[q.k]) {
    const a = nodeByName(net, n.p[q.k]);
    if (!a || a === n) continue;
    parts.push(`<path class="tdref" d="${wirePath([a.x + NW / 2, a.y + nodeHeight(a)], [n.x + NW / 2, n.y])}"/>`);
  }
  if (temp) parts.push(`<path class="tdwire temp" d="${wirePath(temp.a, temp.b)}"/>`);
  svg.innerHTML = parts.join("");
}

/* ======================================================================
   Ratón, toque y teclado sobre la red
   ====================================================================== */
const toWorld = (cx, cy) => { const r = R.pane.getBoundingClientRect(), v = view(); return [(cx - r.left - v.x) / v.z, (cy - r.top - v.y) / v.z]; };
const snap = (v) => ed.grid ? Math.round(v / GRID) * GRID : v;
let drag = null, spaceDown = false;
const pointers = new Map();
function bindPane() {
  const P = R.pane;
  P.addEventListener("contextmenu", (e) => { e.preventDefault(); const nodeE = e.target.closest(".tdnode"); if (nodeE) nodeMenu(nodeE.dataset.id, e.clientX, e.clientY); else openCreate({ at: toWorld(e.clientX, e.clientY), screen: { x: e.clientX, y: e.clientY } }); });
  P.addEventListener("wheel", (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  P.addEventListener("dblclick", (e) => {
    const nodeE = e.target.closest(".tdnode");
    if (nodeE && e.target.closest(".tdname")) { renameDialog(nodeE.dataset.id); return; }
    if (nodeE) { const n = nodeById(curNet(), nodeE.dataset.id); if (n?.fam === "TOP") { app.edit(() => { curNet().display = n.id; }); renderAll(); } else { ed.params = true; renderAll(); } return; }
    openCreate({ at: toWorld(e.clientX, e.clientY), screen: { x: e.clientX, y: e.clientY } });
  });
  P.addEventListener("pointerdown", onDown);
  P.addEventListener("pointermove", onMove);
  P.addEventListener("pointerup", onUp);
  P.addEventListener("pointercancel", onUp);
  // Ratón sobre el fondo: alimenta el «Toque / ratón» CHOP.
  P.addEventListener("pointermove", (e) => { const r = P.getBoundingClientRect(); if (app.td) Object.assign(app.td.pointer, { x: (e.clientX - r.left) / r.width, y: 1 - (e.clientY - r.top) / r.height }); });
}
function onDown(e) {
  if (e.target.closest(".tdpop,.tdcreate")) return;
  R.pane.focus({ preventScroll: true });
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (app.td) app.td.pointer.down = 1;
  // Dos dedos: pellizcar para zoom.
  if (pointers.size === 2) { const [a, b] = [...pointers.values()]; drag = { kind: "pinch", d0: Math.hypot(a.x - b.x, a.y - b.y), z0: view().z, mid: [(a.x + b.x) / 2, (a.y + b.y) / 2], v0: { ...view() } }; clearTimeout(longT); return; }
  const net = curNet(), t = e.target;
  const flag = t.closest(".tdflag");
  if (flag) { e.stopPropagation(); const id = t.closest(".tdnode").dataset.id; flagClick(id, flag.dataset.flag); return; }
  const nodeE = t.closest(".tdnode");
  if (t.dataset.out) {
    // Desde una salida: arrastrar un cable (o tocar para conectar en dos pasos).
    const n = nodeById(net, nodeE.dataset.id);
    drag = { kind: "wire", from: n.id, a: portPos(n, "out"), sx: e.clientX, sy: e.clientY, moved: false };
    P().setPointerCapture?.(e.pointerId);
    return;
  }
  if (t.dataset.in !== undefined) {
    const n = nodeById(net, nodeE.dataset.id), k = +t.dataset.in;
    if (ed.pendingFrom) { tryConnect(ed.pendingFrom, n.id, k); ed.pendingFrom = null; R.root.classList.remove("connecting"); return; }
    if (n.in[k]) {   // tirar de un cable conectado lo suelta y se puede llevar a otra entrada
      const src = nodeById(net, n.in[k]);
      app.edit(() => disconnect(net, n.id, k));
      drag = { kind: "wire", from: src.id, a: portPos(src, "out"), sx: e.clientX, sy: e.clientY, moved: true };
      renderAll();
    }
    return;
  }
  if (nodeE) {
    const id = nodeE.dataset.id;
    if (ed.pendingFrom) { const n = nodeById(net, id); tryConnect(ed.pendingFrom, id, freeInput(n)); ed.pendingFrom = null; R.root.classList.remove("connecting"); return; }
    if (e.shiftKey || e.ctrlKey || e.metaKey) { ed.sel.has(id) ? ed.sel.delete(id) : ed.sel.add(id); }
    else if (!ed.sel.has(id)) ed.sel = new Set([id]);
    ed.selWire = null;
    const start = toWorld(e.clientX, e.clientY);
    drag = { kind: "nodes", start, orig: [...ed.sel].map(i => { const n = nodeById(net, i); return [n, n.x, n.y]; }), moved: false };
    markSelection(); renderParams();
    longPress(e, () => nodeMenu(id, e.clientX, e.clientY));
    return;
  }
  const hit = t.closest?.(".tdhit");
  if (hit) { ed.selWire = { dst: hit.dataset.dst, idx: +hit.dataset.idx }; ed.sel.clear(); markSelection(); drawWires(); renderParams(); return; }
  // Fondo
  if (ed.pendingFrom) { ed.pendingFrom = null; R.root.classList.remove("connecting"); }
  const pan = e.button === 1 || e.button === 2 || spaceDown || e.pointerType === "touch";
  if (pan) {
    drag = { kind: "pan", sx: e.clientX, sy: e.clientY, v0: { ...view() }, moved: false };
    if (e.pointerType === "touch") longPress(e, () => { drag = null; openCreate({ at: toWorld(e.clientX, e.clientY), screen: { x: e.clientX, y: e.clientY } }); });
  } else {
    if (!e.shiftKey) ed.sel.clear();
    ed.selWire = null;
    drag = { kind: "box", sx: e.clientX, sy: e.clientY, base: new Set(ed.sel) };
    markSelection(); renderParams(); drawWires();
  }
  function P() { return R.pane; }
}
let longT = 0;
function longPress(e, fn) { clearTimeout(longT); const x = e.clientX, y = e.clientY; longT = setTimeout(() => { const p = pointers.get(e.pointerId); if (p && Math.hypot(p.x - x, p.y - y) < 8) fn(); }, 600); }
function onMove(e) {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (!drag) return;
  if (drag.kind === "pinch") {
    if (pointers.size < 2) return;
    const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
    const z = Math.max(0.2, Math.min(3, drag.z0 * d / Math.max(1, drag.d0)));
    const r = R.pane.getBoundingClientRect(), mx = drag.mid[0] - r.left, my = drag.mid[1] - r.top, v = view(), v0 = drag.v0;
    v.z = z; v.x = mx - (mx - v0.x) * z / v0.z; v.y = my - (my - v0.y) * z / v0.z;
    applyView(); return;
  }
  const dist = Math.hypot(e.clientX - (drag.sx ?? e.clientX), e.clientY - (drag.sy ?? e.clientY));
  if (drag.kind === "pan") {
    if (dist > 4) { drag.moved = true; clearTimeout(longT); }
    const v = view(); v.x = drag.v0.x + e.clientX - drag.sx; v.y = drag.v0.y + e.clientY - drag.sy; applyView();
  } else if (drag.kind === "nodes") {
    const p = toWorld(e.clientX, e.clientY), dx = p[0] - drag.start[0], dy = p[1] - drag.start[1];
    if (!drag.moved && Math.hypot(dx, dy) * view().z < 4) return;
    drag.moved = true; clearTimeout(longT);
    for (const [n, x0, y0] of drag.orig) { n.x = snap(x0 + dx); n.y = snap(y0 + dy); const el = R.nodesEl.querySelector(`[data-id="${n.id}"]`); if (el) { el.style.left = n.x + "px"; el.style.top = n.y + "px"; } }
    drawWires();
  } else if (drag.kind === "wire") {
    if (dist > 6) drag.moved = true;
    drawWires({ a: drag.a, b: toWorld(e.clientX, e.clientY) });
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(".tdnode");
    R.nodesEl.querySelectorAll(".tdnode.drop").forEach(x => x.classList.remove("drop"));
    if (over && over.dataset.id !== drag.from) over.classList.add("drop");
  } else if (drag.kind === "box") {
    const x = Math.min(e.clientX, drag.sx), y = Math.min(e.clientY, drag.sy), w = Math.abs(e.clientX - drag.sx), hh = Math.abs(e.clientY - drag.sy);
    const r = R.pane.getBoundingClientRect();
    Object.assign(R.box.style, { display: w + hh > 6 ? "block" : "none", left: (x - r.left) + "px", top: (y - r.top) + "px", width: w + "px", height: hh + "px" });
    const [ax, ay] = toWorld(x, y), [bx, by] = toWorld(x + w, y + hh);
    ed.sel = new Set(drag.base);
    for (const n of curNet().nodes) if (n.x + NW > ax && n.x < bx && n.y + nodeHeight(n) > ay && n.y < by) ed.sel.add(n.id);
    markSelection();
  }
}
function onUp(e) {
  pointers.delete(e.pointerId);
  clearTimeout(longT);
  if (app.td && !pointers.size) app.td.pointer.down = 0;
  if (!drag) return;
  const d = drag; drag = null;
  if (d.kind === "pinch") { app.S.dirty = true; return; }
  if (d.kind === "pan") { app.S.dirty = true; if (!d.moved && e.pointerType === "touch") { ed.sel.clear(); ed.selWire = null; markSelection(); renderParams(); } return; }
  if (d.kind === "nodes") { if (d.moved) { app.changed(); app.commitSoon(); } return; }
  if (d.kind === "box") { R.box.style.display = "none"; renderParams(); return; }
  if (d.kind === "wire") {
    R.nodesEl.querySelectorAll(".tdnode.drop").forEach(x => x.classList.remove("drop"));
    drawWires();
    if (!d.moved) {   // tocar la salida: conectar en dos pasos (móvil)
      ed.pendingFrom = d.from; R.root.classList.add("connecting");
      toast("Ahora toca el nodo (o la entrada) al que quieres conectarlo");
      return;
    }
    const t = document.elementFromPoint(e.clientX, e.clientY);
    const nodeE = t?.closest?.(".tdnode");
    if (t?.dataset?.in !== undefined && nodeE) { tryConnect(d.from, nodeE.dataset.id, +t.dataset.in); return; }
    if (nodeE && nodeE.dataset.id !== d.from) { const n = nodeById(curNet(), nodeE.dataset.id); tryConnect(d.from, n.id, freeInput(n)); return; }
    if (!nodeE && t?.closest?.(".tdpane")) openCreate({ at: toWorld(e.clientX, e.clientY), screen: { x: e.clientX, y: e.clientY }, from: d.from });
  }
}
function tryConnect(from, to, idx) {
  const net = curNet();
  let why = "";
  app.edit(() => { why = connect(net, from, to, idx); });
  if (why) toast(why, "warn");
  renderAll();
}
function zoomAt(cx, cy, k) {
  const v = view(), r = R.pane.getBoundingClientRect(), mx = cx - r.left, my = cy - r.top;
  const z = Math.max(0.2, Math.min(3, v.z * k));
  v.x = mx - (mx - v.x) * z / v.z; v.y = my - (my - v.y) * z / v.z; v.z = z;
  applyView();
}
function markSelection() {
  for (const el of R.nodesEl.children) el.classList.toggle("sel", ed.sel.has(el.dataset.id));
}
function flagClick(id, flag) {
  const net = curNet(), n = nodeById(net, id);
  if (!n) return;
  app.edit(() => {
    if (flag === "bypass") n.bypass = !n.bypass;
    else if (flag === "display") net.display = n.id;
    else if (flag === "viewer") n.viewer = n.viewer === false;
  });
  renderAll();
}

/* ---------------- Encuadre ---------------- */
function frameNodes(list) {
  if (!list.length) { Object.assign(view(), { x: 40, y: 40, z: 1 }); applyView(); return; }
  const r = R.pane.getBoundingClientRect();
  const x0 = Math.min(...list.map(n => n.x)) - 40, y0 = Math.min(...list.map(n => n.y)) - 40;
  const x1 = Math.max(...list.map(n => n.x + NW)) + 40, y1 = Math.max(...list.map(n => n.y + nodeHeight(n))) + 40;
  const z = Math.max(0.25, Math.min(1.5, Math.min(r.width / (x1 - x0), r.height / (y1 - y0))));
  Object.assign(view(), { z, x: (r.width - (x1 - x0) * z) / 2 - x0 * z, y: (r.height - (y1 - y0) * z) / 2 - y0 * z });
  applyView();
}
const frameAll = () => frameNodes(curNet()?.nodes || []);
const frameSel = () => frameNodes((curNet()?.nodes || []).filter(n => ed.sel.has(n.id)));

/* ======================================================================
   Crear operadores (Tab)
   ====================================================================== */
function openCreate({ fam = "", at = null, screen = null, from = null } = {}) {
  closePop();
  R.root.querySelector(".tdcreate")?.remove();
  const net = curNet(), src = from ? nodeById(net, from) : (ed.sel.size === 1 ? nodeById(net, [...ed.sel][0]) : null);
  ed.famFilter = fam || (from && src ? src.fam : ed.famFilter || "");
  const q = h("input", { class: "text-in tdsearch", placeholder: "Buscar (ruido, cámara, 3D, feedback, lfo…)", "aria-label": "Buscar operador" });
  const famRow = h("div", { class: "tdfams" });
  const list = h("div", { class: "tdoplist" });
  const box = h("div", { class: "tdcreate tdpop", role: "dialog", "aria-label": "Crear operador" },
    h("div", { class: "tdcreatehead" }, h("b", {}, "Crear operador"), h("small", {}, src ? `Se conectará después de ${src.name}` : "Elige familia y operador"), h("button", { class: "tdx", "aria-label": "Cerrar", onclick: () => box.remove() }, "✕")),
    famRow, q, list);
  const draw = () => {
    famRow.replaceChildren(h("button", { class: `tdfamb ${!ed.famFilter ? "on" : ""}`, onclick: () => { ed.famFilter = ""; draw(); } }, "Todas"),
      ...Object.entries(FAMILIES).map(([k, f]) => { const b = h("button", { class: `tdfamb ${ed.famFilter === k ? "on" : ""}`, title: f.desc, onclick: () => { ed.famFilter = k; draw(); } }, k); b.style.setProperty("--fam", f.color); return b; }));
    const res = searchOps(q.value, ed.famFilter);
    list.replaceChildren(...res.map(o => {
      const b = h("button", { class: "tdop", title: o.desc, onclick: () => create(o) }, h("i", {}, o.fam), h("b", {}, o.label), h("small", {}, o.desc));
      b.style.setProperty("--fam", FAMILIES[o.fam].color);
      return b;
    }));
    if (!res.length) list.append(hint("No hay operadores con ese nombre."));
  };
  const create = (o) => {
    box.remove();
    let node = null;
    const pos = at || (src ? freeSpot(src.x + NW + 60, src.y) : centerWorld());
    app.edit(() => {
      node = addNode(net, o.fam, o.type, { x: snap(pos[0]), y: snap(pos[1]) });
      // Conectado solo: después del nodo elegido (o del cable que se soltó en el vacío).
      if (src && o.inputs[1] > 0 && acceptsInput(o.fam, o.type, src.fam)) connect(net, src.id, node.id, 0);
      // Un MAT nuevo con un Objeto 3D elegido: se le pone; un SOP nuevo: se crea su Objeto 3D y un Render si no hay.
      if (o.fam === "MAT" && src?.type === "geo") src.p.material = node.name;
      if (o.fam === "SOP" && !src && !net.nodes.some(n => n.type === "geo")) {
        const g = addNode(net, "COMP", "geo", { x: node.x + NW + 60, y: node.y });
        connect(net, node.id, g.id, 0);
        if (!net.nodes.some(n => n.type === "camera")) addNode(net, "COMP", "camera", { x: g.x, y: g.y + 160 });
        if (!net.nodes.some(n => n.type === "render")) addNode(net, "TOP", "render", { x: g.x + NW + 60, y: g.y });
      }
    });
    ed.sel = new Set([node.id]);
    renderAll();
    toast(`＋ ${node.name} (${o.label})`);
  };
  q.addEventListener("input", draw);
  q.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") { const first = searchOps(q.value, ed.famFilter)[0]; if (first) create(first); }
    if (e.key === "Escape") box.remove();
  });
  draw();
  R.root.append(box);
  const W = window.innerWidth, H = window.innerHeight;
  if (screen && !MOBILE) { box.style.left = Math.max(8, Math.min(W - 440, screen.x)) + "px"; box.style.top = Math.max(50, Math.min(H - 470, screen.y)) + "px"; }
  else box.classList.add("center");
  if (!MOBILE) q.focus();
}
/** Un sitio libre cerca del centro de la vista (los nodos nuevos nunca caen encima de otro). */
function centerWorld() {
  const r = R.pane.getBoundingClientRect(), c = toWorld(r.left + r.width / 2 - NW / 2, r.top + r.height / 2 - 60);
  return freeSpot(c[0], c[1]);
}
function freeSpot(x, y) {
  const nodes = curNet()?.nodes || [];
  const busy = (px, py) => nodes.some(n => px < n.x + NW + 30 && px + NW + 30 > n.x && py < n.y + nodeHeight(n) + 20 && py + 150 > n.y);
  for (let ring = 0; ring < 12; ring++) for (const [dx, dy] of [[0, 0], [0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const px = snap(x + dx * ring * (NW + 40)), py = snap(y + dy * ring * 170);
    if (!busy(px, py)) return [px, py];
  }
  return [snap(x), snap(y)];
}

/* ======================================================================
   Menú de un nodo (clic derecho / mantener pulsado)
   ====================================================================== */
function nodeMenu(id, x, y) {
  const net = curNet(), n = nodeById(net, id);
  if (!n) return;
  if (!ed.sel.has(id)) { ed.sel = new Set([id]); markSelection(); renderParams(); }
  popMenu(null, [
    { label: `${n.name} · ${defOf(n).label}`, disabled: true, run: () => {} },
    "-",
    { label: "Parámetros", keys: "P", run: () => { ed.params = true; renderAll(); } },
    n.fam === "TOP" ? { label: "Ver de fondo (display)", keys: "D", run: () => setDisplaySel() } : null,
    { label: n.bypass ? "Encender (quitar bypass)" : "Apagar sin borrar (bypass)", keys: "B", run: () => toggleBypassSel() },
    { label: "Renombrar…", run: () => renameDialog(id) },
    { label: "Comentario…", run: () => commentSel() },
    "-",
    ["TOP", "SOP", "CHOP"].includes(n.fam) ? { label: "Añadir después…", run: () => openCreate({ from: n.id, at: [n.x + NW + 60, n.y] }) } : null,
    n.fam === "TOP" ? { label: "▶ Usar en una superficie", run: () => useOnSurface(n.id) } : null,
    { label: "Duplicar", keys: "Ctrl+D", run: () => duplicateSel() },
    { label: "Copiar", keys: "Ctrl+C", run: () => copySel() },
    { label: "Borrar", keys: "Supr", run: () => deleteSel() },
    { label: "Borrar dejando pasar los cables", run: () => deleteSel(true) },
  ], { x, y });
}

/* ======================================================================
   Acciones de edición
   ====================================================================== */
function deleteSel(keepWires = false) {
  const net = curNet();
  if (ed.selWire) { const w = ed.selWire; app.edit(() => disconnect(net, w.dst, w.idx)); ed.selWire = null; renderAll(); return; }
  if (!ed.sel.size) return;
  const ids = [...ed.sel];
  app.edit(() => { if (keepWires && ids.length === 1) removeKeepWires(net, ids[0]); else removeNodes(net, ids); });
  ed.sel.clear();
  renderAll();
  app.td?.gc();
}
function copySel() {
  if (!ed.sel.size) return;
  ed.clip = copyNodes(curNet(), [...ed.sel]);
  try { localStorage.setItem("lumamap:tdclip", JSON.stringify(ed.clip)); } catch {}
  toast(`Copiado${ed.sel.size > 1 ? "s" : ""} ${ed.sel.size} nodo${ed.sel.size > 1 ? "s" : ""}`);
}
function pasteClip() {
  if (!ed.clip) { try { ed.clip = JSON.parse(localStorage.getItem("lumamap:tdclip") || "null"); } catch {} }
  if (!ed.clip) return;
  let out = [];
  app.edit(() => { out = pasteNodes(curNet(), JSON.parse(JSON.stringify(ed.clip)), 40, 40); });
  ed.sel = new Set(out.map(n => n.id));
  ed.clip = copyNodes(curNet(), [...ed.sel]);   // pegar otra vez: un poco más allá
  renderAll();
}
function duplicateSel() { if (!ed.sel.size) return; const keep = ed.clip; copySel(); pasteClip(); ed.clip = keep; }
function toggleBypassSel() { const net = curNet(); app.edit(() => { for (const id of ed.sel) { const n = nodeById(net, id); if (n) n.bypass = !n.bypass; } }); renderAll(); }
function setDisplaySel() { const net = curNet(), n = nodeById(net, [...ed.sel][0]); if (n?.fam === "TOP") { app.edit(() => { net.display = n.id; }); renderAll(); } }
async function renameDialog(id) {
  const net = curNet(), n = nodeById(net, id);
  const v = await prompt("Nombre del nodo (letras, números y _)", n.name);
  if (v === null) return;
  let why = "";
  app.edit(() => { why = renameNode(net, id, v); });
  if (why) toast(why, "warn");
  renderAll();
}
async function commentSel() {
  const n = nodeById(curNet(), [...ed.sel][0]);
  if (!n) return;
  const v = await prompt("Comentario (una nota para ti)", n.comment || "");
  if (v === null) return;
  app.edit(() => { n.comment = v; });
  renderAll();
}
function undo() { app.actions.undo(); afterHistory(); }
function redo() { app.actions.redo(); afterHistory(); }
function afterHistory() { ed.project = app.S.project; if (!curNet()) ed.netId = nets()[0]?.id || null; if (!curNet()) { app.edit(() => nets().push(newNetwork("Red 1"))); ed.netId = nets()[0].id; } buildBar(); renderAll(); }
/** Ordena los nodos por columnas según los cables (de izquierda a derecha). */
function autoLayout() {
  const net = curNet(), depth = new Map();
  const d = (n, seen = new Set()) => { if (depth.has(n.id)) return depth.get(n.id); if (seen.has(n.id)) return 0; seen.add(n.id); const v = Math.max(-1, ...n.in.map(id => { const m = nodeById(net, id); return m ? d(m, seen) : -1; })) + 1; depth.set(n.id, v); return v; };
  for (const n of net.nodes) d(n);
  const BAND = { TOP: 0, CHOP: 1, SOP: 2, COMP: 3, MAT: 4, DAT: 5 };
  const cols = new Map();
  for (const n of net.nodes) { const c = depth.get(n.id); if (!cols.has(c)) cols.set(c, []); cols.get(c).push(n); }
  app.edit(() => {
    for (const [c, list] of cols) {
      list.sort((a, b) => BAND[a.fam] - BAND[b.fam] || a.y - b.y);
      list.forEach((n, r) => { n.x = c * (NW + 70); n.y = r * 170; });
    }
  });
  renderAll(); frameAll();
}

/* ---------------- Redes ---------------- */
function newNet() { let n; app.edit(() => { n = newNetwork(`Red ${nets().length + 1}`); nets().push(n); }); ed.netId = n.id; ed.sel.clear(); buildBar(); renderAll(); frameAll(); }
async function renameNet() { const net = curNet(); const v = await prompt("Nombre de la red", net.name); if (v) { app.edit(() => { net.name = v.slice(0, 40); }); buildBar(); } }
function dupNet() { const net = curNet(); const c = JSON.parse(JSON.stringify(net)); c.id = newNetwork().id; c.name = net.name + " (copia)"; app.edit(() => nets().push(c)); ed.netId = c.id; buildBar(); renderAll(); }
async function deleteNet() {
  const net = curNet();
  if (!(await confirmDlg("Borrar la red", `¿Borrar «${net.name}» y sus ${net.nodes.length} nodos? Las superficies que la usan se quedan sin imagen (se puede deshacer).`, "Borrar"))) return;
  app.edit(() => { app.S.project.networks = nets().filter(n => n.id !== net.id); });
  if (!nets().length) app.edit(() => nets().push(newNetwork("Red 1")));
  ed.netId = nets()[0].id; buildBar(); renderAll(); app.td?.gc();
}
function exportNet() {
  const net = curNet();
  const blob = new Blob([JSON.stringify({ "lumamap-network": 1, network: net }, null, 1)], { type: "application/json" });
  const a = h("a", { href: URL.createObjectURL(blob), download: (net.name.replace(/[^\w-]+/g, "_") || "red") + ".lumanet.json" });
  document.body.append(a); a.click(); a.remove();
  toast("Red guardada en un archivo");
}
function importNet() {
  const inp = h("input", { type: "file", accept: ".json,application/json" });
  inp.onchange = async () => {
    const f = inp.files?.[0]; if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      const { normalizeNetworks } = await import("./td/graph.js");
      const [net] = normalizeNetworks([j.network || j]);
      if (!net) throw new Error("no es una red");
      net.id = newNetwork().id;
      app.edit(() => nets().push(net));
      ed.netId = net.id; buildBar(); renderAll(); frameAll();
      toast(`Red «${net.name}» abierta (${net.nodes.length} nodos)`);
    } catch (e) { toast("Ese archivo no es una red de LumaMap: " + e.message, "warn"); }
  };
  inp.click();
}
function openExamples() {
  const list = h("div", { class: "tdexamples" }, ...EXAMPLES.map(ex => h("button", { class: "tdex", onclick: () => { closeDialog(); loadExample(ex.id); } }, h("b", {}, ex.name), h("small", {}, ex.desc))));
  dialog({ title: "Ejemplos de redes", content: h("div", {}, hint("Cada ejemplo se abre como una red nueva: mírala, cambia sus parámetros y úsala en una superficie."), list), wide: true });
}
export function loadExample(id) {
  const r = buildExample(id, app.S.project);
  if (!r) return null;
  app.edit(() => nets().push(r.net));
  ed.netId = r.net.id; ed.sel = new Set(r.out ? [r.out.id] : []);
  if (ed.open) { buildBar(); renderAll(); frameAll(); }
  toast(`Ejemplo «${r.net.name}» abierto`);
  return r.net;
}

/* ---------------- Proyectar ---------------- */
/** Pone la salida de la red en la superficie elegida (o en una nueva a pantalla completa). */
function useOnSurface(nodeId = null) {
  const net = curNet();
  const node = nodeId ? nodeById(net, nodeId) : net.nodes.find(n => n.type === "out" && n.fam === "TOP") || nodeById(net, net.display) || net.nodes.find(n => n.fam === "TOP");
  if (!node) return toast("Esta red aún no tiene imagen: crea un TOP (y una «Salida»)", "warn");
  const A = app.actions;
  if (!app.S.sel || !app.S.project.surfaces.some(s => s.id === app.S.sel)) A.addShape("rect");
  A.setSource({ type: "net", netId: net.id, netNode: node.id });
  toast(`«${app.surf()?.name}» muestra ${net.name} · ${node.name}`);
}
function togglePerform() {
  ed.perform = !ed.perform;
  R.root.classList.toggle("perform", ed.perform);
  if (ed.perform) toast("Pantalla completa: Esc o F11 para volver");
}

/* ---------------- Ajustes de la red ---------------- */
async function netResolution() {
  const net = curNet();
  const sel = h("select", { class: "sel" }, ...[[640, 360], [1280, 720], [1920, 1080], [2560, 1440], [3840, 2160], [1080, 1920], [1024, 1024]].map(([w, hh]) => h("option", { value: w + "x" + hh, selected: net.res[0] === w && net.res[1] === hh }, `${w}×${hh}${w === 1920 ? " (Full HD)" : w === 3840 ? " (4K)" : hh > w ? " (vertical)" : ""}`)));
  const v = await dialog({ title: "Resolución de la red", content: h("div", {}, hint("Tamaño de las imágenes que se generan (los filtros usan el de su entrada). Más grande = más nítido y más trabajo para la tarjeta."), sel), buttons: [{ label: "Cancelar", value: null }, { label: "Aplicar", kind: "primary", value: () => sel.value }] });
  if (!v) return;
  const [w, hh] = v.split("x").map(Number);
  app.edit(() => { net.res = [w, hh]; });
  renderParams();
}
function perfDialog() {
  const net = curNet();
  const rows = net.nodes.map(n => ({ n, i: app.td?.info(net, n) || { ms: 0, w: 0, h: 0 } })).sort((a, b) => b.i.ms - a.i.ms);
  const total = rows.reduce((s, r) => s + r.i.ms, 0);
  dialog({ title: "Rendimiento de la red", wide: true, content: h("div", {},
    hint(`Tiempo de cálculo de cada nodo en el último fotograma (en el procesador; la tarjeta trabaja en paralelo). Total: ${total.toFixed(2)} ms. Para ir más rápido: baja la resolución de la red o apaga (⏻) lo que no uses.`),
    h("div", { class: "tdperf" }, ...rows.map(({ n, i }) => h("div", { class: "tdperfrow" }, h("b", {}, n.name), h("small", {}, defOf(n).label), h("span", {}, i.w ? `${i.w}×${i.h}` : ""), h("span", {}, i.ms.toFixed(2) + " ms"), h("i", { style: { width: Math.min(100, i.ms * 20) + "%" } }))))) });
}

/* ---------------- Ayuda ---------------- */
function helpKeys() {
  const K = [["Tab", "Crear operador (buscador)"], ["Clic derecho", "Crear aquí / menú del nodo"], ["Arrastrar ● → ○", "Conectar; soltar en el vacío crea un nodo ya conectado"], ["Supr / Retroceso", "Borrar lo elegido (nodos o cable)"],
    ["Ctrl+C / X / V / D", "Copiar / cortar / pegar / duplicar"], ["Ctrl+Z / Ctrl+Y", "Deshacer / rehacer"], ["Ctrl+A", "Elegir todo"], ["B", "Bypass (apagar sin borrar)"], ["D", "Ver de fondo (display)"],
    ["H / F", "Encuadrar todo / lo elegido"], ["P", "Panel de parámetros"], ["Flechas", "Mover lo elegido (Mayús: más)"], ["Rueda / pellizcar", "Zoom"], ["Espacio + arrastrar, botón central", "Moverse por la red"],
    ["Doble clic en el nombre", "Renombrar"], ["Doble clic en el fondo", "Crear operador"], ["F11", "Pantalla completa del fondo (actuar)"], ["Esc", "Cerrar menús / volver a LumaMap"]];
  dialog({ title: "Atajos del editor de redes", content: h("div", { class: "tdkeys" }, ...K.map(([k, d]) => h("div", {}, h("kbd", {}, k), h("span", {}, d)))) });
}
function helpExpr() {
  dialog({ title: "Expresiones (ƒx)", wide: true, content: h("div", { class: "tdhelptext" },
    h("p", {}, "Toca ", h("b", {}, "ƒx"), " al lado de un parámetro para escribir una expresión en lugar de un número. Se calcula en cada fotograma, como en TouchDesigner."),
    h("pre", {}, "absTime.seconds * 0.5          → el tiempo (s)\nlfo1.chan1 * 2                 → un canal de un CHOP\nop('noise1')['tx'][3]          → la muestra 3 de un canal\nfit(audio1.bass, 0, 1, 1, 3)   → de 0…1 a 1…3\nop('level1').par.brightness    → el parámetro de otro nodo\ntab('tabla1', 2, 1)            → un número de una tabla DAT\n1 if beat > 0.5 else 0         → condiciones (también a ? b : c)\nme.digits                      → el número del nombre (noise3 → 3)"),
    h("p", {}, "Variables: t, time, frame, bpm, beat, bass, mid, high, level, me.i (copia de una instancia)."),
    h("p", {}, "Funciones: " + EXPR_FUNCS.join(", ") + "."),
    h("p", {}, "🔗 enlaza el parámetro a un canal sin escribir: elige el CHOP y el canal (o crea un LFO, el audio o la mano de la cámara al momento).")) });
}
function helpFamilies() {
  dialog({ title: "Las familias de operadores", wide: true, content: h("div", { class: "tdhelptext" }, ...Object.entries(FAMILIES).map(([k, f]) => { const d = h("div", { class: "tdfamhelp" }, h("b", {}, f.name), h("p", {}, f.desc), h("small", {}, OP_LIST.filter(o => o.fam === k).map(o => o.label).join(" · "))); d.style.setProperty("--fam", f.color); return d; }),
    h("p", {}, "Cables: TOP con TOP, CHOP con CHOP, SOP con SOP, y una geometría (SOP) a un Objeto 3D (COMP). Materiales, texturas, cámara y CHOP de instancias se eligen en los parámetros (línea punteada)."),
    h("p", {}, "Para proyectar: termina en una «Salida» (Out TOP) y pulsa «▶ Usar en superficie», o elige la red en Contenido → Red de nodos.")) });
}

/* ======================================================================
   Panel de parámetros
   ====================================================================== */
function toggleParams() {
  if (narrow()) { const open = !R.body.classList.contains("noparams"); ed.params = true; ed.pinParams = !open; if (open) ed.sel.clear(); renderAll(); return; }
  ed.params = !ed.params; renderAll();
}
// En el teléfono el panel va abajo: solo se abre al tocar un nodo (o con ⚙), para que se vea la red.
const narrow = () => typeof matchMedia !== "undefined" && matchMedia("(max-width:700px), (max-height:520px) and (orientation:landscape)").matches;
function renderParams() {
  if (!R.params) return;
  const net = curNet();
  const show = ed.params && (!narrow() || ed.sel.size > 0 || ed.pinParams);
  R.body.classList.toggle("noparams", !show);
  if (!show || !net) { R.params.replaceChildren(); return; }
  if (ed.sel.size !== 1) { R.params.replaceChildren(netPanel(net)); return; }
  const n = nodeById(net, [...ed.sel][0]);
  if (!n) { R.params.replaceChildren(netPanel(net)); return; }
  R.params.replaceChildren(nodePanel(net, n));
}
function netPanel(net) {
  const multi = ed.sel.size > 1;
  return h("div", { class: "tdpp" },
    h("div", { class: "tdpphead" }, h("b", {}, multi ? `${ed.sel.size} nodos elegidos` : net.name), h("button", { class: "tdx", "aria-label": "Cerrar panel", onclick: () => toggleParams() }, "✕")),
    multi ? h("div", { class: "row" }, btn({ label: "⏻ Bypass", kind: "small", onClick: () => toggleBypassSel() }), btn({ label: "Duplicar", kind: "small", onClick: () => duplicateSel() }), btn({ label: "Borrar", kind: "small danger", onClick: () => deleteSel() })) :
      h("div", {},
        h("p", { class: "tdppdesc" }, `${net.nodes.length} nodos · ${net.res[0]}×${net.res[1]}`),
        h("div", { class: "row" }, btn({ label: "Resolución…", kind: "small", onClick: () => netResolution() }), btn({ label: "Renombrar", kind: "small", onClick: () => renameNet() })),
        hint("Toca un nodo para ver sus parámetros. Arrastra el fondo para moverte; Tab o «＋ Operador» para crear."),
        h("h4", {}, "Empieza con un ejemplo"),
        h("div", { class: "tdexamples small" }, ...EXAMPLES.map(ex => h("button", { class: "tdex", onclick: () => loadExample(ex.id) }, h("b", {}, ex.name), h("small", {}, ex.desc))))));
}
function nodePanel(net, n) {
  const def = defOf(n), fam = FAMILIES[n.fam];
  const info = h("pre", { class: "tdppinfo" });
  const pages = [...new Set(def.params.filter(q => !q.hidden).map(q => q.page || "Parámetros"))];
  const box = h("div", { class: "tdpp" });
  box.style.setProperty("--fam", fam.color);
  const head = h("div", { class: "tdpphead" },
    h("i", { class: "tdfam" }, n.fam), h("b", { class: "tdppname", title: "Renombrar", onclick: () => renameDialog(n.id) }, n.name),
    h("button", { class: "tdx", "aria-label": "Cerrar panel", onclick: () => toggleParams() }, "✕"));
  const acts = h("div", { class: "row tdppacts" },
    btn({ label: n.bypass ? "⏻ Encender" : "⏻ Bypass", kind: `small ${n.bypass ? "on" : ""}`, onClick: () => { ed.sel = new Set([n.id]); toggleBypassSel(); } }),
    n.fam === "TOP" ? btn({ label: "👁 De fondo", kind: `small ${net.display === n.id ? "on" : ""}`, onClick: () => { ed.sel = new Set([n.id]); setDisplaySel(); } }) : null,
    n.fam === "TOP" ? btn({ label: "▶ Usar en superficie", kind: "small", onClick: () => useOnSurface(n.id) }) : null,
    btn({ label: "Borrar", kind: "small danger", onClick: () => { ed.sel = new Set([n.id]); deleteSel(); } }));
  box.append(head, h("p", { class: "tdppdesc" }, h("b", {}, def.label), " — ", def.desc), acts);
  const ins = def.inputs[1] ? h("p", { class: "tdppins" }, `Entradas: ${n.in.filter(Boolean).map(id => nodeById(net, id)?.name).join(", ") || "ninguna"}${def.inputs[0] ? ` (necesita ${def.inputs[0]})` : ""}`) : null;
  const outs = outputsOf(net, n.id);
  box.append(ins || "", outs.length ? h("p", { class: "tdppins" }, "Sale a: " + outs.map(o => o.name).join(", ")) : "");
  for (const pg of pages) {
    const qs = def.params.filter(q => !q.hidden && (q.page || "Parámetros") === pg);
    const sec = h("details", { class: "tdpage", open: pg === "Parámetros" || pages.length === 1 || undefined }, h("summary", {}, pg));
    for (const q of qs) sec.append(paramRow(net, n, q));
    box.append(sec);
  }
  if (!def.params.filter(q => !q.hidden).length) box.append(hint("Este operador no tiene parámetros: deja pasar lo que le entra (sirve para nombrar un punto de la red)."));
  if (n.fam === "CHOP") box.append(h("div", { class: "tdchans" }));
  box.append(info);
  box._info = info;
  return box;
}

/** Una fila de parámetro: control normal o expresión (ƒx), con 🔗 para enlazar a un canal. */
function paramRow(net, n, q) {
  const v = n.p[q.k], expr = isExpr(v);
  const set = (val, { live = false } = {}) => { app.edit(() => { n.p[q.k] = val; }); if (!live) { drawWires(); refreshNode(n); } };
  const numeric = ["f", "i", "t", "m"].includes(q.type);
  const lab = h("span", { class: "tdplab", title: q.label + " (" + q.k + ")" + (q.type === "f" || q.type === "i" ? " · doble clic: valor por defecto" : "") }, q.label);
  lab.ondblclick = () => { set(q.def); renderParams(); };
  const rowEl = h("div", { class: `tdprow ${expr ? "expr" : ""}`, "data-k": q.k });
  let ctl;
  if (expr) {
    const inp = h("input", { class: "text-in small tdexpr", value: v.e, spellcheck: "false", "aria-label": q.label + " (expresión)" });
    const valOut = h("output", { class: "tdeval" });
    inp.addEventListener("change", () => set({ e: inp.value }));
    inp.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") inp.blur(); });
    ctl = h("div", { class: "tdexprwrap" }, inp, valOut);
    rowEl._eval = () => { const c = compileExpr(inp.value); const ck = app.td?.cookers.get(net.id); const val = ck ? ck.param(n, q.k) : 0; valOut.textContent = c.error ? "⚠ " + c.error : (typeof val === "number" ? +val.toFixed(4) : val); valOut.classList.toggle("err", !!c.error || !!ck?.errors.get(n.id + "/" + q.k)); if (!c.error && ck?.errors.get(n.id + "/" + q.k)) valOut.textContent += " ⚠ " + ck.errors.get(n.id + "/" + q.k); };
  } else switch (q.type) {
    case "f": case "i": {
      const step = q.type === "i" ? 1 : Math.max(0.001, (q.max - q.min) / 200);
      const num = h("input", { type: "number", class: "text-in small tdnum", value: +v, step, "aria-label": q.label });
      const rng = h("input", { type: "range", min: q.min, max: q.max, step, value: Math.max(q.min, Math.min(q.max, +v)), "aria-label": q.label + " (deslizador)" });
      rng.addEventListener("input", () => { num.value = rng.value; set(+rng.value, { live: true }); });
      num.addEventListener("change", () => { const x = q.type === "i" ? Math.round(+num.value) : +num.value; if (Number.isFinite(x)) { rng.value = Math.max(q.min, Math.min(q.max, x)); set(x); } });
      num.addEventListener("keydown", (e) => e.stopPropagation());
      ctl = h("div", { class: "tdnumwrap" }, rng, num);
      break;
    }
    case "t": { const c = h("input", { type: "checkbox", checked: !!+v, "aria-label": q.label }); c.onchange = () => set(c.checked ? 1 : 0); ctl = h("label", { class: "tdswitch" }, c, h("span", {})); break; }
    case "m": { const s = h("select", { class: "sel small", "aria-label": q.label }, ...q.opts.map(([val, l]) => h("option", { value: val, selected: +v === +val }, l))); s.onchange = () => set(+s.value); ctl = s; break; }
    case "c": { const c = h("input", { type: "color", value: /^#[0-9a-f]{6}$/i.test(v) ? v : "#ffffff", "aria-label": q.label }); c.oninput = () => set(c.value, { live: true }); c.onchange = () => set(c.value); ctl = c; break; }
    case "s": { const s = h("input", { class: "text-in small", value: v ?? "", "aria-label": q.label }); s.addEventListener("change", () => set(s.value)); s.addEventListener("keydown", (e) => e.stopPropagation()); ctl = s; break; }
    case "txt": { const t = h("textarea", { class: "text-in small tdtxt", rows: 4, "aria-label": q.label }); t.value = v ?? ""; t.addEventListener("input", () => set(t.value, { live: true })); t.addEventListener("keydown", (e) => e.stopPropagation()); ctl = t; break; }
    case "code": {
      const t = h("textarea", { class: "text-in tdcode", rows: 10, spellcheck: "false", "aria-label": q.label });
      t.value = v ?? "";
      const apply = () => { set(t.value); setTimeout(() => updateInfo(true), 120); };
      t.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); apply(); } if (e.key === "Tab") { e.preventDefault(); const p = t.selectionStart; t.value = t.value.slice(0, p) + "  " + t.value.slice(t.selectionEnd); t.selectionStart = t.selectionEnd = p + 2; } });
      ctl = h("div", {}, t, h("div", { class: "row" }, btn({ label: "Aplicar (Ctrl+Enter)", kind: "small primary", onClick: apply }), h("small", {}, "Tienes uv, time, res, tex0(uv), tex1(uv), u1…u4. Devuelve un vec4.")));
      break;
    }
    case "op": {
      const opts = net.nodes.filter(x => x.fam === q.fam && x.id !== n.id && (!q.kinds || q.kinds.includes(x.type)));
      const s = h("select", { class: "sel small", "aria-label": q.label }, h("option", { value: "" }, "— ninguno —"), ...opts.map(x => h("option", { value: x.name, selected: x.name === v }, `${x.name} (${defOf(x).label})`)));
      s.onchange = () => set(s.value);
      ctl = h("div", { class: "row" }, s, opts.length ? null : btn({ label: "＋ Crear", kind: "small", onClick: () => createRef(net, n, q) }));
      break;
    }
    case "media": {
      const media = app.S.project.media.filter(m => ["video", "image", "anim"].includes(m.kind) || !m.kind);
      const s = h("select", { class: "sel small", "aria-label": q.label }, h("option", { value: "" }, media.length ? "— elige un archivo —" : "— la biblioteca está vacía —"), ...media.map(m => h("option", { value: m.id, selected: m.id === v }, m.name)));
      s.onchange = () => set(s.value);
      ctl = h("div", {}, s, btn({ label: "Importar video o foto…", kind: "small", onClick: async () => { await app.actions.importMedia("library"); setTimeout(renderParams, 400); } }));
      break;
    }
    case "cam": {
      const s = h("select", { class: "sel small", "aria-label": q.label }, h("option", { value: "" }, "La cámara de LumaMap (por defecto)"));
      listCameras().then(list => { for (const c of list) s.append(h("option", { value: c.id, selected: c.id === v }, cameraName(c))); }).catch(() => {});
      s.onchange = () => set(s.value);
      ctl = s; break;
    }
    case "shader": {
      const list = listShaders();
      const s = h("select", { class: "sel small", "aria-label": q.label }, h("option", { value: "" }, "— elige un shader —"), ...list.map(x => h("option", { value: x.id, selected: x.id === v }, x.name)));
      s.onchange = () => set(s.value);
      ctl = s; break;
    }
    case "pulse": ctl = btn({ label: q.label, kind: "small", onClick: () => set((+v || 0) + 1) }); break;
    case "learn": ctl = btn({ label: "🎚 Aprender: mueve el control…", kind: "small", onClick: () => {
      toast("Mueve ahora un control MIDI, OSC, del mando o una tecla asignada…");
      app.td?.learn((ev) => { app.edit(() => { n.p.src = ev.src; n.p.key = ev.key; }); toast(`Aprendido: ${ev.src} · ${ev.key}`); renderParams(); });
    } }); break;
    case "param": {
      const groups = exportTargets(catalog(app));
      const s = h("select", { class: "sel small", "aria-label": q.label }, h("option", { value: "" }, "— elige qué mover —"),
        ...groups.map(g => h("optgroup", { label: g.group }, ...g.items.map(it => h("option", { value: it.id, selected: it.id === v }, it.name)))));
      s.onchange = () => set(s.value);
      ctl = h("div", {}, s, v ? h("small", {}, describe(app, v)?.name || v) : null);
      break;
    }
    default: ctl = h("small", {}, String(v));
  }
  const fx = numeric ? h("button", { class: `tdfx ${expr ? "on" : ""}`, title: expr ? "Volver a un valor fijo" : "Usar una expresión (ƒx)", "aria-label": "Expresión " + q.label, onclick: () => {
    if (expr) { const ck = app.td?.cookers.get(net.id); set(ck ? +ck.param(n, q.k) || 0 : q.def); }
    else set({ e: String(typeof v === "number" ? v : q.def) });
    renderParams();
  } }, "ƒx") : null;
  const link = numeric ? h("button", { class: "tdfx", title: "Enlazar a un canal (CHOP): audio, LFO, la mano en la cámara…", "aria-label": "Enlazar " + q.label, onclick: () => bindDialog(net, n, q) }, "🔗") : null;
  rowEl.append(lab, h("div", { class: "tdpctl" }, ctl, fx, link));
  return rowEl;
}
/** Crea el nodo que falta para un parámetro de referencia (material, cámara, CHOP…). */
function createRef(net, n, q) {
  const type = { MAT: "pbr", COMP: q.kinds?.[0] || "camera", CHOP: "noise", TOP: "noise", DAT: "text" }[q.fam];
  let m;
  app.edit(() => { m = addNode(net, q.fam, type, { x: n.x, y: n.y + 180 }); n.p[q.k] = m.name; });
  renderAll();
}
/** 🔗 Enlazar un parámetro a un canal de un CHOP (o crear uno al momento). */
function bindDialog(net, n, q) {
  const chops = net.nodes.filter(x => x.fam === "CHOP" && x.type !== "export");
  const lo = h("input", { type: "number", class: "text-in small", value: q.type === "t" ? 0 : q.min ?? 0, step: "any", "aria-label": "Mínimo" });
  const hi = h("input", { type: "number", class: "text-in small", value: q.type === "t" ? 1 : q.max ?? 1, step: "any", "aria-label": "Máximo" });
  const apply = (name, chan) => { closeDialog(); const a = +lo.value, b = +hi.value; const e = a === 0 && b === 1 ? `${name}.${chan}` : `fit(${name}.${chan}, 0, 1, ${a}, ${b})`; app.edit(() => { n.p[q.k] = { e }; }); renderAll(); toast(`${n.name}.${q.k} ← ${e}`); };
  const quick = (type, chan, p = {}) => { let c; app.edit(() => { c = addNode(net, "CHOP", type, { x: n.x - NW - 60, y: n.y + 120, p }); }); apply(c.name, chan); };
  const listEl = h("div", { class: "tdbind" }, ...chops.map(c => {
    const out = app.td?.cookers.get(net.id)?.chop(c);
    return h("div", { class: "tdbindop" }, h("b", {}, c.name), h("div", { class: "chips" }, ...(out?.names || ["chan1"]).slice(0, 24).map(ch => h("button", { class: "chip", onclick: () => apply(c.name, ch) }, ch))));
  }));
  dialog({ title: `🔗 ${n.name} · ${q.label}`, wide: true, content: h("div", {},
    hint("El canal va de 0 a 1 (casi siempre); aquí dices a qué valores del parámetro corresponde."),
    h("div", { class: "row" }, h("span", {}, "0 →"), lo, h("span", {}, "1 →"), hi),
    h("h4", {}, "Crear y enlazar al momento"),
    h("div", { class: "chips" },
      h("button", { class: "chip", onclick: () => quick("lfo", "chan1", { amp: 0.5, offset: 0.5, rate: 0.3 }) }, "〜 Onda lenta (LFO)"),
      h("button", { class: "chip", onclick: () => quick("audio", "bass") }, "🔊 Graves de la música"),
      h("button", { class: "chip", onclick: () => quick("beat", "beat") }, "🥁 Golpe"),
      h("button", { class: "chip", onclick: () => quick("noise", "chan1", { amp: 0.5, offset: 0.5, rate: 0.4 }) }, "⁂ Ruido suave"),
      h("button", { class: "chip", onclick: () => quick("tracking", "right_hand_x") }, "✋ Mano derecha X (cámara)"),
      h("button", { class: "chip", onclick: () => quick("tracking", "right_hand_y") }, "✋ Mano derecha Y (cámara)"),
      h("button", { class: "chip", onclick: () => quick("motion", "amount") }, "🌀 Movimiento en cámara"),
      h("button", { class: "chip", onclick: () => quick("mouse", "tx") }, "🖱 Ratón X")),
    chops.length ? h("h4", {}, "O un canal de un CHOP de la red") : null, listEl) });
}

/* ======================================================================
   Bucle: visores, fondo, información
   ====================================================================== */
function refreshNode(n) {
  const el = R.nodesEl.querySelector(`[data-id="${n.id}"]`);
  if (!el) return;
  const fresh = nodeEl(n);
  el.replaceWith(fresh);
}
function updateInfo(force = false) {
  const net = curNet(), eng = app.td;
  if (!net || !eng) return;
  for (const el of R.nodesEl.children) {
    const n = nodeById(net, el.dataset.id);
    if (!n) continue;
    const i = eng.info(net, n);
    el.classList.toggle("err", !!i.error);
    const f = el.querySelector(".tdinfo");
    if (f && !n.comment) f.textContent = i.error ? "⚠ " + i.error.split("\n")[0].slice(0, 40) : (n.fam === "TOP" && i.w ? `${i.w}×${i.h} · ${i.ms.toFixed(1)} ms` : `${defOf(n).label}${i.ms > 0.05 ? " · " + i.ms.toFixed(1) + " ms" : ""}`);
    if (i.error) el.title = i.error;
  }
  const pp = R.params.firstElementChild;
  if (pp?._info && ed.sel.size === 1) {
    const n = nodeById(net, [...ed.sel][0]);
    if (n) {
      const i = eng.info(net, n);
      pp._info.textContent = (n.fam === "TOP" && i.w ? `Imagen ${i.w}×${i.h} · ` : "") + `cálculo ${i.ms.toFixed(2)} ms` + (i.error ? `\n⚠ ${i.error}` : "");
      pp._info.classList.toggle("err", !!i.error);
      const ch = pp.querySelector(".tdchans");
      if (ch) { const c = eng.cookers.get(net.id)?.chop(n); ch.replaceChildren(...(c?.names || []).slice(0, 16).map(nm => h("div", { class: "tdchan" }, h("b", {}, nm), h("span", {}, c.len > 1 ? `${c.len} muestras · [0] ${(+c.data[nm][0]).toFixed(3)}` : (+c.data[nm][0]).toFixed(3))))); }
    }
  }
  for (const r of R.params.querySelectorAll(".tdprow.expr")) r._eval?.();
  void force;
}
function drawChop(canvas, data) {
  const g = canvas.getContext("2d"), W = canvas.width, H = canvas.height;
  g.fillStyle = "#0a0f0c"; g.fillRect(0, 0, W, H);
  if (!data || !data.names.length) return;
  const cols = ["#22c55e", "#00e5ff", "#ff2d8a", "#ffd23f", "#a78bfa", "#fb923c"];
  if (data.len > 1) {
    // Muchas muestras (instancias, espectro): barras.
    const ch = data.data[data.names[0]], n = ch.length, mx = Math.max(1e-6, ...ch.map(Math.abs));
    g.fillStyle = cols[0];
    for (let k = 0; k < n; k++) { const v = ch[k] / mx; const x = k / n * W, w = Math.max(1, W / n - 1); g.fillRect(x, v >= 0 ? H / 2 - v * H / 2 + 0.5 : H / 2, w, Math.abs(v) * H / 2); }
  } else {
    const rows = data.hist || [];
    if (!rows.length) return;
    let lo = Infinity, hi = -Infinity;
    for (const r of rows) for (const v of r) { if (v < lo) lo = v; if (v > hi) hi = v; }
    if (hi - lo < 1e-6) { hi += 0.5; lo -= 0.5; }
    const nch = rows[0].length;
    for (let c = 0; c < nch; c++) {
      g.strokeStyle = cols[c % cols.length]; g.lineWidth = 1.5; g.beginPath();
      rows.forEach((r, k) => { const x = k / 179 * W, y = H - 3 - (r[c] - lo) / (hi - lo) * (H - 6); k ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.stroke();
    }
  }
  g.fillStyle = "#cfe"; g.font = "10px system-ui"; g.fillText(data.names.slice(0, 3).join(" ") + (data.names.length > 3 ? "…" : ""), 3, 10);
}
function loop() {
  if (!ed.open) return;
  ed.raf = requestAnimationFrame(loop);
  if (app.S.project !== ed.project) { ed.project = app.S.project; if (!curNet()) ed.netId = nets()[0]?.id; if (curNet()) { buildBar(); renderAll(); } }
  const net = curNet(), eng = app.td;
  if (!net || !eng) return;
  const now = performance.now();
  const time = now / 1000, lv = app.S.levels;
  // Imagen de fondo (display): a la mitad de resolución, ~30 fps (en pantalla completa, entera).
  const disp = nodeById(net, net.display);
  const bgOn = (ed.bg || ed.perform) && disp;
  R.bg.style.display = bgOn ? "block" : "none";
  if (bgOn && now - (ed.lastBg || 0) > (MOBILE ? 60 : 30)) {
    ed.lastBg = now;
    const r = R.pane.getBoundingClientRect(), k = ed.perform ? 1 : 0.5;
    const w = Math.max(16, Math.round(r.width * k)), hh = Math.max(16, Math.round(r.height * k));
    if (R.bg.width !== w || R.bg.height !== hh) { R.bg.width = w; R.bg.height = hh; }
    try { eng.viewers([{ net, node: disp, ctx: R.bgx, w, h: hh, fit: 2 }], time, lv); } catch (e) { console.warn(e); }
  }
  // Visores de los nodos (los que se ven en pantalla).
  if (ed.viewers && !ed.perform && now - ed.lastViewers > (MOBILE ? 120 : 66)) {
    ed.lastViewers = now;
    const pr = R.pane.getBoundingClientRect(), list = [];
    for (const el of R.nodesEl.children) {
      const cv = el.querySelector("canvas.tdview");
      if (!cv) continue;
      const r = el.getBoundingClientRect();
      if (r.right < pr.left || r.left > pr.right || r.bottom < pr.top || r.top > pr.bottom) continue;
      const n = nodeById(net, el.dataset.id);
      if (!n) continue;
      if (n.fam === "TOP") list.push({ net, node: n, ctx: cv.getContext("2d"), w: cv.width, h: cv.height });
      else if (n.fam === "CHOP") { eng.follow(time, lv); try { drawChop(cv, eng.chop(net, n)); } catch {} }
    }
    if (list.length) eng.viewers(list, time, lv);
  }
  if (now - ed.lastInfo > 400) { ed.lastInfo = now; updateInfo(); }
}

/* ======================================================================
   Teclado (solo con el editor abierto)
   ====================================================================== */
export function handleNetKey(a, e) {
  if (!ed.open) return false;
  app = a;
  const tag = document.activeElement?.tagName;
  if (/INPUT|TEXTAREA|SELECT/.test(tag) && document.activeElement.type !== "range" && document.activeElement.type !== "checkbox") return false;
  if (document.getElementById("modal")?.classList.contains("show")) return false;
  const k = e.key, ctrl = e.ctrlKey || e.metaKey, lk = k.toLowerCase();
  const eat = () => { e.preventDefault(); e.stopImmediatePropagation(); return true; };
  // El «Teclado» CHOP sigue viendo las teclas aunque el editor se las quede.
  if (e.type === "keydown" && app.td) app.td.keys.add(lk);
  if (e.type === "keyup") { if (k === " ") spaceDown = false; return false; }
  if (k === " ") { spaceDown = true; return eat(); }
  if (k === "Escape") { if (R.root.querySelector(".tdpop")) { closePop(); return eat(); } if (ed.perform) { togglePerform(); return eat(); } if (ed.pendingFrom) { ed.pendingFrom = null; R.root.classList.remove("connecting"); return eat(); } if (ed.sel.size) { ed.sel.clear(); ed.selWire = null; markSelection(); renderParams(); drawWires(); return eat(); } closeNetworkEditor(); return eat(); }
  if (k === "F11") { togglePerform(); return eat(); }
  if (k === "Tab") { openCreate({}); return eat(); }
  if (ctrl && lk === "z") { e.shiftKey ? redo() : undo(); return eat(); }
  if (ctrl && lk === "y") { redo(); return eat(); }
  if (ctrl && lk === "c") { copySel(); return eat(); }
  if (ctrl && lk === "x") { copySel(); deleteSel(); return eat(); }
  if (ctrl && lk === "v") { pasteClip(); return eat(); }
  if (ctrl && lk === "d") { duplicateSel(); return eat(); }
  if (ctrl && lk === "a") { ed.sel = new Set(curNet().nodes.map(n => n.id)); markSelection(); renderParams(); return eat(); }
  if (ctrl && lk === "s") return false;   // guardar: lo hace LumaMap
  if (ctrl) return eat();
  if (k === "Delete" || k === "Backspace") { deleteSel(); return eat(); }
  if (lk === "h") { frameAll(); return eat(); }
  if (lk === "f") { frameSel(); return eat(); }
  if (lk === "b") { toggleBypassSel(); return eat(); }
  if (lk === "d") { setDisplaySel(); return eat(); }
  if (lk === "p") { toggleParams(); return eat(); }
  if (k.startsWith("Arrow") && ed.sel.size) {
    const s = e.shiftKey ? 50 : GRID, dx = k === "ArrowLeft" ? -s : k === "ArrowRight" ? s : 0, dy = k === "ArrowUp" ? -s : k === "ArrowDown" ? s : 0;
    for (const id of ed.sel) { const n = nodeById(curNet(), id); if (n) { n.x += dx; n.y += dy; } }
    app.changed(); app.commitSoon(); renderAll();
    return eat();
  }
  // Las teclas de letras no llegan al escenario mientras se edita la red (el «Teclado» CHOP las lee igual);
  // F5, F12 y demás siguen funcionando.
  return k.length === 1 && !e.altKey ? eat() : false;
}
export { loop as _loopForTests, ed as _edForTests };
