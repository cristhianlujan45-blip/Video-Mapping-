// web/js/commands.js
// Todos los comandos de LumaMap en un solo registro: atajos de teclado, paleta
// de comandos (Ctrl+K), menú contextual (clic derecho / pulsación larga) y menú
// nativo de la versión de escritorio usan esta misma lista.
import { h, dialog, closeDialog } from "./ui.js";
import { icon } from "./icons.js";
import { PATTERNS } from "./overlay.js";

/** Lista de comandos: {id, label, group, keys?, ic?, run, needsSel?} */
export function buildCommands(app) {
  const A = app.actions, S = app.S;
  const C = [];
  const add = (group, id, label, run, extra = {}) => C.push({ group, id, label, run, ...extra });

  add("Archivo", "new", "Nuevo proyecto", A.newProject, { keys: "Ctrl+N", ic: "plus" });
  add("Archivo", "open", "Abrir proyecto", A.open, { keys: "Ctrl+O", ic: "folder" });
  add("Archivo", "save", "Guardar", () => A.save(false), { keys: "Ctrl+S", ic: "save" });
  add("Archivo", "saveAs", "Guardar como…", () => A.save(true), { keys: "Ctrl+Shift+S", ic: "copy" });
  add("Archivo", "export", "Exportar proyecto .lumamap", A.exportProject, { keys: "Ctrl+E", ic: "download" });
  add("Archivo", "importProject", "Importar proyecto", A.importProject, { keys: "Ctrl+Shift+O", ic: "upload" });
  add("Archivo", "importMedia", "Importar video, imagen o GIF", () => A.importMedia(), { keys: "Ctrl+I", ic: "upload" });
  add("Archivo", "searchGifs", "Buscar GIF animado en internet", () => A.searchGifs(), { ic: "gif" });
  add("Archivo", "record", "Grabar video de la salida (iniciar / detener)", A.record, { keys: "Ctrl+R", ic: "camera" });
  add("Archivo", "snapshot", "Capturar imagen de la salida (PNG)", A.snapshot, { keys: "Ctrl+Shift+P", ic: "photo" });
  add("Archivo", "resolution", "Resolución de salida…", A.setResolution, { ic: "screen" });

  add("Editar", "undo", "Deshacer", A.undo, { keys: "Ctrl+Z", ic: "undo" });
  add("Editar", "redo", "Rehacer", A.redo, { keys: "Ctrl+Y", ic: "redo" });
  add("Editar", "copy", "Copiar superficie", A.copy, { keys: "Ctrl+C", ic: "copy", needsSel: true });
  add("Editar", "paste", "Pegar superficie", A.paste, { keys: "Ctrl+V", ic: "copy" });
  add("Editar", "duplicate", "Duplicar", A.duplicate, { keys: "Ctrl+D", ic: "copy", needsSel: true });
  add("Editar", "copyStyle", "Copiar estilo (efectos y audio)", A.copyStyle, { keys: "Ctrl+Shift+C", ic: "fx", needsSel: true });
  add("Editar", "pasteStyle", "Pegar estilo", A.pasteStyle, { keys: "Ctrl+Shift+V", ic: "fx", needsSel: true });
  add("Editar", "delete", "Eliminar superficie", () => A.remove(), { keys: "Delete", ic: "trash", needsSel: true });
  add("Editar", "rename", "Renombrar superficie", () => A.rename(), { keys: "F2", ic: "pen", needsSel: true });
  add("Editar", "lock", "Bloquear / desbloquear", () => A.toggleLock(), { keys: "L", ic: "lock", needsSel: true });
  add("Editar", "hide", "Ocultar / mostrar", () => A.toggleHide(), { keys: "H", ic: "eye", needsSel: true });
  add("Editar", "front", "Traer al frente", A.toFront, { keys: "Ctrl+]", ic: "up", needsSel: true });
  add("Editar", "back", "Enviar al fondo", A.toBack, { keys: "Ctrl+[", ic: "down", needsSel: true });
  add("Editar", "nextSurf", "Seleccionar la siguiente superficie", () => A.selectNext(1), { keys: "N", ic: "right" });
  add("Editar", "center", "Centrar en la salida", () => A.center("both"), { keys: "C", ic: "target", needsSel: true });
  add("Editar", "fill", "Pantalla completa (ocupar toda la salida)", A.fillFrame, { keys: "Shift+G", ic: "fit", needsSel: true });
  add("Editar", "rotR15", "Girar 15° a la derecha", () => A.rotateBy(15), { keys: "E", ic: "rotate", needsSel: true });
  add("Editar", "rotL15", "Girar 15° a la izquierda", () => A.rotateBy(-15), { keys: "Q", ic: "rotate", needsSel: true });
  add("Editar", "rotImg", "Girar la imagen 90°", () => A.rotateContent(90), { keys: "Shift+E", ic: "rotate", needsSel: true });
  add("Editar", "straighten", "Enderezar (rectángulo)", A.straighten, { ic: "straight", needsSel: true });
  add("Editar", "flipH", "Espejo horizontal", () => A.flip("h"), { ic: "flipH", needsSel: true });
  add("Editar", "flipV", "Voltear vertical", () => A.flip("v"), { ic: "flipV", needsSel: true });
  add("Editar", "rotate", "Girar 90°", A.rotate90, { ic: "rotate", needsSel: true });
  add("Editar", "mask", "Dibujar máscara", A.editMask, { ic: "mask", needsSel: true });
  add("Editar", "mesh", "Malla de deformación 4×3", () => A.setMesh(4, 3), { ic: "mesh", needsSel: true });

  add("Añadir", "addRect", "Añadir rectángulo (4 esquinas)", () => A.addShape("rect"), { keys: "Shift+R", ic: "rect" });
  add("Añadir", "addMesh", "Añadir malla curva", A.addMesh, { keys: "Shift+M", ic: "mesh" });
  add("Añadir", "addCircle", "Añadir círculo", () => A.addShape("circle"), { keys: "Shift+C", ic: "circle" });
  add("Añadir", "addTriangle", "Añadir triángulo", () => A.addShape("triangle"), { ic: "triangle" });
  add("Añadir", "addHex", "Añadir hexágono", () => A.addShape("hexagon"), { ic: "hexagon" });
  add("Añadir", "addStar", "Añadir estrella", () => A.addShape("star"), { ic: "star" });
  add("Añadir", "addTrace", "Trazar forma a mano", () => A.startShape("trace"), { keys: "Shift+F", ic: "freehand" });
  add("Añadir", "addPoints", "Forma por puntos", () => A.startShape("points"), { keys: "Shift+P", ic: "points" });
  add("Añadir", "draw", "Dibujar en la pared", () => app.openTab("draw"), { keys: "D", ic: "pen" });
  add("Añadir", "addText", "Añadir texto", () => { A.addShape("rect"); A.setSource({ type: "text" }); app.openTab("content"); }, { keys: "Shift+T", ic: "text" });
  add("Añadir", "addCube", "Añadir cubo 3D", () => A.addTemplate("cube"), { ic: "cube" });
  add("Añadir", "addFacade", "Añadir fachada", () => A.addTemplate("facade"), { ic: "building" });
  add("Añadir", "addStage", "Añadir escenario", () => A.addTemplate("stage"), { ic: "stage" });

  add("Ver", "fit", "Encajar vista", A.fitView, { keys: "Home", ic: "fit" });
  add("Ver", "zoomIn", "Acercar vista", () => A.zoom(1.25), { keys: "+", ic: "plus" });
  add("Ver", "zoomOut", "Alejar vista", () => A.zoom(0.8), { keys: "-", ic: "fit" });
  add("Ver", "preview", "Vista previa sin guías", () => app.setMode(S.mode === "preview" ? "edit" : "preview"), { keys: "V", ic: "eye" });
  for (const [id, label, ic] of [["add", "Panel Añadir", "plus"], ["anim", "Panel Animaciones", "wand"], ["live", "Panel En vivo (mezcla)", "live"], ["content", "Panel Contenido", "content"], ["fx", "Panel Efectos", "fx"], ["shape", "Panel Forma", "shape"], ["layers", "Panel Capas", "layers"], ["scenes", "Panel Escenas", "scenes"], ["audio", "Panel Audio y ritmo", "audio"]])
    add("Ver", "tab-" + id, label, () => app.openTab(id), { ic });

  add("Proyección", "output", "Proyectar (panel)", () => app.openTab("output"), { keys: "F", ic: "project" });
  add("Proyección", "outWindow", "Abrir ventana de salida", () => A.openWindow(1), { keys: "Ctrl+Shift+F", ic: "screen" });
  for (const n of [2, 3, 4]) add("Proyección", "outWindow" + n, `Abrir pantalla ${n}`, () => A.openWindow(n), { ic: "screen" });
  add("En vivo", "goAll", "GO: fundir todas las pantallas a lo siguiente", () => A.goAll(), { keys: "Enter", ic: "play" });
  add("En vivo", "randomAll", "Todas las pantallas al azar", () => A.randomAll(), { keys: "Shift+Enter", ic: "shuffle" });
  add("En vivo", "randomSel", "Siguiente al azar en la superficie", () => S.sel && A.randomNext(S.sel), { keys: "Z", ic: "shuffle", needsSel: true });
  add("En vivo", "goSel", "GO en la superficie seleccionada", () => S.sel && A.go(S.sel), { keys: "X", ic: "play", needsSel: true });
  add("Proyección", "here", "Pantalla completa aquí", () => A.projectHere(!S.projecting), { keys: "P", ic: "fit" });
  add("Proyección", "guides", "Guías en el proyector", A.toggleGuides, { keys: "G", ic: "grid" });
  add("Proyección", "blackout", "Apagón", A.blackout, { keys: "B", ic: "blackout" });
  add("Proyección", "mute", "Sonido de los videos", A.toggleMute, { keys: "Ctrl+M", ic: "volume" });
  for (const [id, label] of PATTERNS) add("Proyección", "pattern-" + id, "Patrón de prueba: " + label, () => A.setPattern(id), { ic: "grid" });

  add("Escenas", "play", "Reproducir / pausa", A.togglePlay, { keys: "Space", ic: "play" });
  add("Escenas", "restart", "Reiniciar videos", A.restart, { keys: "Ctrl+0", ic: "restart" });
  add("Escenas", "nextScene", "Escena siguiente", () => A.stepScene(1), { keys: "PageDown", ic: "right" });
  add("Escenas", "prevScene", "Escena anterior", () => A.stepScene(-1), { keys: "PageUp", ic: "left" });
  add("Escenas", "newScene", "Nueva escena (copia de la actual)", A.addScene, { keys: "Ctrl+Shift+N", ic: "plus" });
  add("Escenas", "allScenes", "Usar este contenido en todas las escenas", A.applyToAllScenes, { ic: "copy", needsSel: true });

  add("Audio", "mic", "Micrófono: escuchar la música", A.toggleMic, { keys: "M", ic: "mic" });
  add("Audio", "react", "Modo ritmo (todo late con la música)", A.toggleReact, { keys: "R", ic: "audio" });
  add("Audio", "tap", "TAP: marcar el tempo", A.tap, { keys: "T", ic: "tap" });
  add("Audio", "downbeat", "Marcar el primer tiempo (1)", () => app.audio().downbeat(), { keys: "Ctrl+1", ic: "target" });
  add("Audio", "half", "Tempo a la mitad (½×)", () => A.scaleTempo(0.5), { ic: "down" });
  add("Audio", "double", "Tempo al doble (2×)", () => A.scaleTempo(2), { ic: "up" });

  add("Ayuda", "palette", "Todos los comandos", () => openPalette(app), { keys: "Ctrl+K", ic: "menu" });
  add("Ayuda", "help", "Ayuda y atajos", () => A.help(), { keys: "F1", ic: "help" });
  add("Ayuda", "midi", "Conectar controlador MIDI", () => A.midi(), { ic: "midi" });
  add("Ayuda", "remote", "Mando remoto (teléfono) y OSC", () => A.remoteInfo(), { ic: "live" });
  add("Show", "emergency", "EMERGENCIA: salida segura inmediata", A.emergency, { keys: "Ctrl+Shift+E", ic: "blackout" });
  add("Show", "perfMode", "Modo actuación (pantalla limpia, sin ediciones)", () => A.togglePerfMode(), { keys: "F10", ic: "live" });
  add("Ver", "pro", "Modo profesional (activar / desactivar)", A.togglePro, { ic: "knob" });
  add("Ver", "tab-control", "Panel Control (MIDI, macros, monitor)", () => { app.setPro(true); app.openTab("control"); }, { ic: "knob" });
  add("Ver", "tab-perf", "Panel Rendimiento", () => { app.setPro(true); app.openTab("perf"); }, { ic: "gauge" });
  add("Ayuda", "update", "Buscar actualizaciones", () => A.checkUpdates(false), { ic: "download" });
  return C;
}

/* ---------------- Teclado ---------------- */

/** Convierte un evento de teclado en la forma de los atajos ("Ctrl+Shift+S"). */
export function keyOf(e) {
  let k = e.key;
  if (k === " ") k = "Space";
  else if (k === "Del") k = "Delete";
  else if (k.length === 1) k = k.toUpperCase();
  if (k === "=") k = "+";
  const mods = [];
  if (e.ctrlKey || e.metaKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  // Mayús solo cuenta como modificador con letras (en "+" o "[" forma parte de la tecla).
  if (e.shiftKey && /^[A-Z]$|^F\d+$|^Page|^Home$/.test(k)) mods.push("Shift");
  return [...mods, k].join("+");
}

export function normalizeKeys(keys) {
  // La tecla «+» se escribe "+" o "Ctrl++": se separa antes de partir por "+".
  const plus = keys === "+" || keys.endsWith("++");
  const parts = (plus ? keys.slice(0, -1) : keys).split("+").filter(Boolean);
  const key = plus ? "+" : parts.pop();
  const order = ["Ctrl", "Alt", "Shift"].filter(m => parts.includes(m));
  return [...order, key.length === 1 ? key.toUpperCase() : key].join("+");
}

/** Índice atajo → comando. */
export function keymap(commands) {
  const map = new Map();
  for (const c of commands) if (c.keys) map.set(normalizeKeys(c.keys), c);
  return map;
}

/* ---------------- Paleta de comandos ---------------- */

const norm = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function openPalette(app) {
  const all = app.commands.filter(c => c.id !== "palette");
  const input = h("input", { type: "text", class: "text-in", placeholder: "Escribe qué quieres hacer… (p. ej. «estrella», «grabar», «apagón»)" });
  const list = h("div", { class: "palette" });
  let shown = [], idx = 0;
  const render = () => {
    const q = norm(input.value.trim());
    shown = all.filter(c => !q || q.split(/\s+/).every(w => norm(c.label + " " + c.group).includes(w)))
      .filter(c => !c.needsSel || app.S.sel);
    idx = Math.min(idx, Math.max(0, shown.length - 1));
    list.innerHTML = "";
    shown.slice(0, 60).forEach((c, i) => {
      const row = h("button", { class: `pal-item ${i === idx ? "on" : ""}`, onclick: () => run(c) });
      row.innerHTML = `${icon(c.ic || "info")}<span class="pal-label">${c.label}</span><small>${c.group}</small>${c.keys ? `<kbd>${c.keys.replace("Ctrl", navigator.platform?.startsWith("Mac") ? "⌘" : "Ctrl")}</kbd>` : ""}`;
      list.append(row);
    });
    if (!shown.length) list.append(h("p", { class: "hint" }, "Ningún comando coincide."));
  };
  const run = (c) => { closeDialog(); setTimeout(() => c.run(), 0); };
  input.addEventListener("input", () => { idx = 0; render(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { idx = Math.min(shown.length - 1, idx + 1); render(); e.preventDefault(); list.querySelector(".on")?.scrollIntoView({ block: "nearest" }); }
    else if (e.key === "ArrowUp") { idx = Math.max(0, idx - 1); render(); e.preventDefault(); list.querySelector(".on")?.scrollIntoView({ block: "nearest" }); }
    else if (e.key === "Enter" && shown[idx]) { e.preventDefault(); run(shown[idx]); }
  });
  render();
  const done = dialog({ title: "Comandos", content: h("div", {}, input, list), buttons: [], wide: true });
  input.focus(); // el diálogo ya está en la página: se puede escribir al instante
  return done;
}

/* ---------------- Menú contextual ---------------- */

let ctxEl = null;
export function closeContextMenu() { ctxEl?.remove(); ctxEl = null; }

export function openContextMenu(app, x, y) {
  closeContextMenu();
  const byId = Object.fromEntries(app.commands.map(c => [c.id, c]));
  const s = app.surf();
  const ids = s
    ? ["duplicate", "copy", "paste", "copyStyle", "pasteStyle", "-", "tab-content", "tab-fx", "mask", "-", "front", "back", "center", "fill", "-", "lock", "hide", "rename", "delete"]
    : ["paste", "addRect", "addMesh", "addCircle", "addTrace", "draw", "-", "fit", "palette"];
  const menu = h("div", { class: "ctxmenu", role: "menu" });
  for (const id of ids) {
    if (id === "-") { menu.append(h("hr")); continue; }
    const c = byId[id];
    if (!c) continue;
    const b = h("button", { onclick: () => { closeContextMenu(); c.run(); } });
    b.innerHTML = `${icon(c.ic || "info")}<span>${c.label}</span>${c.keys ? `<kbd>${c.keys}</kbd>` : ""}`;
    menu.append(b);
  }
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.max(6, Math.min(x, innerWidth - r.width - 6)) + "px";
  menu.style.top = Math.max(6, Math.min(y, innerHeight - r.height - 6)) + "px";
  ctxEl = menu;
  setTimeout(() => addEventListener("pointerdown", (e) => { if (!menu.contains(e.target)) closeContextMenu(); }, { once: true, capture: true }), 0);
}
