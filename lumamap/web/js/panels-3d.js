// web/js/panels-3d.js
// Panel «3D» (modo profesional) y ventana 3D sobre el escenario: objetos,
// proyectores virtuales, propiedades, modos de vista, vista dividida, snap,
// unidades y atajos configurables. El motor está en three3d.js (se carga al
// abrir el panel por primera vez).
import { h, section, row, btn, segmented, toggle, hint, toast, dialog, closeDialog } from "./ui.js";
import { icon } from "./icons.js";
import * as M from "./model.js";

let Mod = null;   // módulo three3d.js (carga diferida)

/** Carga el motor 3D (una vez) y lo devuelve. */
export async function ensure3d(app) {
  if (app.stage3d) return app.stage3d;
  Mod = Mod || await import("./three3d.js");
  app.stage3d = new Mod.Stage3D(app);
  return app.stage3d;
}

function num(value, onChange, { step = 0.01, w = 74 } = {}) {
  const i = h("input", { class: "text-in small num", type: "number", step, value: +(+value).toFixed(4), style: { width: w + "px" } });
  i.addEventListener("change", () => onChange(+i.value || 0));
  return i;
}
function vec3(label, arr, k, onChange, step) {
  return h("div", { class: "vec3" }, h("span", { class: "lab" }, label),
    ...[0, 1, 2].map(i => h("label", {}, h("small", {}, "XYZ"[i]), num(arr[i] * k, (v) => { arr[i] = v / k; onChange(); }, { step }))));
}
function selectEl(options, value, onChange) {
  const sel = h("select", { class: "text-in small" });
  for (const [v, label] of options) sel.append(h("option", { value: v, selected: String(v) === String(value) }, label));
  sel.addEventListener("change", () => onChange(sel.value));
  return sel;
}

/* ---------------- Ventana 3D sobre el escenario ---------------- */
export function openWorkspace(app) {
  const ws = document.getElementById("ws3d");
  ws.classList.add("show");
  document.body.classList.toggle("split-mapping", app.stage3d?.vp?.split === "mapping");
  ensure3d(app).then((st) => {
    if (!st.vp) st.attach(ws.querySelector(".ws3d-view"));
    buildToolbar(app, st);
  });
}
export function closeWorkspace(app) {
  document.getElementById("ws3d").classList.remove("show");
  document.body.classList.remove("split-mapping");
  app.stage3d?.detach();
}

function buildToolbar(app, st) {
  const tb = document.querySelector("#ws3d .ws3d-bar");
  tb.innerHTML = "";
  const add = (kind) => { st.addObject(kind); app.changed({ panel: true }); app.commit(); };
  const addMenu = h("select", { class: "text-in small", title: "Añadir" },
    h("option", { value: "" }, "+ Añadir…"), ...Mod.KINDS_3D.map(([k, l]) => h("option", { value: k }, l)),
    h("option", { value: "__model" }, "Importar modelo (OBJ, FBX, GLTF, GLB, STL, PLY)…"), h("option", { value: "__proj" }, "Proyector"));
  addMenu.addEventListener("change", () => {
    const v = addMenu.value; addMenu.value = "";
    if (v === "__proj") { st.addProjector(); app.changed({ panel: true }); app.commit(); }
    else if (v === "__model") importModel(app, st);
    else if (v) add(v);
  });
  const tool = (m, ic, title) => btn({ ic, kind: "icon", title, onClick: () => { st.setGizmoMode(m); } });
  const modes = selectEl(Mod.VIEW_MODES, st.data.viewMode, (v) => { st.data.viewMode = v; app.changed(); });
  const split = selectEl([["none", "Sin dividir"], ["projector", "3D | Proyector"], ["mapping", "3D | Mapping 2D"]], st.vp?.split || "none", (v) => {
    st.vp.split = v; document.body.classList.toggle("split-mapping", v === "mapping");
  });
  tb.append(addMenu,
    tool("translate", "target", "Mover (G)"), tool("rotate", "rotate", "Rotar (R)"), tool("scale", "fit", "Escalar (S)"),
    btn({ label: "Snap", kind: `small ${st.data.snap.enabled ? "on" : ""}`, title: "Snap (Mayús+Tab)", onClick: (e) => { st.data.snap.enabled = !st.data.snap.enabled; st.applySnap(); e.currentTarget.classList.toggle("on", st.data.snap.enabled); app.renderPanel(); } }),
    modes, split,
    btn({ label: "Persp / Orto", kind: "small", title: "Numpad 5", onClick: () => st.toggleOrtho() }),
    btn({ label: "Ver desde proyector", kind: "small", title: "Numpad 0", onClick: () => st.viewFromProjector(st.sel?.type === "projector" ? st.sel.id : null) }),
    h("span", { class: "grow" }),
    btn({ label: "Volver al 2D", ic: "close", kind: "small", onClick: () => { closeWorkspace(app); if (app.S.tab === "3d") app.openTab(null); } }),
    h("small", { class: "ws3d-help" }, "Central: orbitar · Mayús+central: desplazar · Rueda: zoom · Alt+izq: orbitar · Numpad 1/3/7 vistas"));
}

async function importModel(app, st) {
  const input = h("input", { type: "file", accept: ".obj,.fbx,.gltf,.glb,.stl,.ply" });
  input.addEventListener("change", async () => {
    const f = input.files[0];
    if (!f) return;
    try { await st.importModel(f); app.changed({ panel: true }); app.commit(); toast(`Modelo importado: ${f.name}`); }
    catch (e) { toast("No se pudo importar el modelo: " + e.message, "err"); }
  });
  input.click();
}

/** Atajos del 3D: se atienden antes que los del editor 2D mientras la ventana 3D está abierta. */
export function handle3dKey(app, e) {
  const st = app.stage3d;
  if (!st?.vp || !document.getElementById("ws3d").classList.contains("show")) return false;
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return false;
  const k = Mod.key3dOf(e), map = Mod.keys3d();
  const action = Object.keys(map).find(a => map[a] === k);
  if (!action) return false;
  e.preventDefault(); e.stopPropagation();
  const changed = () => { app.changed({ panel: true }); app.commit(); };
  switch (action) {
    case "front": case "back": case "right": case "left": case "top": case "bottom": st.view(action); break;
    case "ortho": st.toggleOrtho(); break;
    case "projector": st.viewFromProjector(st.sel?.type === "projector" ? st.sel.id : null); break;
    case "frame": st.frameSelection(); break;
    case "move": st.setGizmoMode("translate"); break;
    case "rotate": st.setGizmoMode("rotate"); break;
    case "scale": st.setGizmoMode("scale"); break;
    case "duplicate": if (st.sel?.type === "object") { st.duplicate(st.sel.id); changed(); } break;
    case "delete": if (st.sel) { st.remove(); changed(); } break;
    case "hide": if (st.sel?.type === "object") { const o = st.data.objects.find(x => x.id === st.sel.id); o.hidden = !o.hidden; changed(); } break;
    case "snap": st.data.snap.enabled = !st.data.snap.enabled; st.applySnap(); app.renderPanel(); toast(st.data.snap.enabled ? "Snap activado" : "Snap desactivado"); break;
    case "cycleView": { const i = Mod.VIEW_MODES.findIndex(m => m[0] === st.data.viewMode); st.data.viewMode = Mod.VIEW_MODES[(i + 1) % Mod.VIEW_MODES.length][0]; toast("Vista: " + Mod.VIEW_MODES.find(m => m[0] === st.data.viewMode)[1]); break; }
  }
  return true;
}

async function editKeys() {
  const map = Mod.keys3d();
  const list = h("div", { class: "keylist" });
  const draw = () => {
    list.innerHTML = "";
    for (const a of Object.keys(Mod.DEFAULT_KEYS_3D)) {
      const b = h("button", { class: "chip" }, map[a] || "—");
      b.addEventListener("click", () => {
        b.textContent = "Pulsa una tecla…";
        const on = (e) => { e.preventDefault(); e.stopPropagation(); if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return; removeEventListener("keydown", on, true); map[a] = Mod.key3dOf(e); draw(); };
        addEventListener("keydown", on, true);
      });
      list.append(h("div", { class: "item" }, h("span", {}, Mod.KEY_LABELS_3D[a]), b));
    }
  };
  draw();
  const r = await dialog({ title: "Atajos del 3D", content: list, buttons: [{ label: "Restablecer", value: "reset" }, { label: "Cancelar", value: null }, { label: "Guardar", kind: "primary", value: "save" }] });
  if (r === "save") { Mod.saveKeys3d(map); toast("Atajos guardados"); }
  if (r === "reset") { Mod.saveKeys3d({}); toast("Atajos por defecto"); }
}

/* ---------------- Panel ---------------- */
const panel3d = {
  title: () => "3D · objetos y proyectores",
  render(app) {
    const S = app.S, wrap = h("div", { class: "p3d" });
    const st = app.stage3d;
    if (!st || !Mod) {
      ensure3d(app).then(() => { openWorkspace(app); app.renderPanel(); });
      return h("div", {}, hint("Cargando el motor 3D…"));
    }
    openWorkspace(app);
    const d = st.data, [uName, uK] = st.units();
    const changed = (panel = false) => { app.changed({ panel }); app.commitSoon(); };

    // ---- Objetos ----
    const objs = h("div", { class: "list" });
    const rowObj = (o, depth = 0) => {
      const on = st.sel?.type === "object" && st.sel.id === o.id;
      objs.append(h("div", { class: `item ${on ? "on" : ""}`, style: { paddingLeft: 8 + depth * 16 + "px" }, onclick: (e) => { if (e.target.closest("button")) return; st.select("object", o.id); app.renderPanel(); } },
        h("span", {}, o.name, h("small", {}, " · " + (o.kind === "group" ? "grupo" : o.kind === "model" ? "modelo" : (Mod.KINDS_3D.find(k => k[0] === o.kind) || [, o.kind])[1].toLowerCase()))),
        btn({ ic: o.hidden ? "eyeoff" : "eye", kind: "icon", onClick: () => { o.hidden = !o.hidden; changed(true); } }),
        btn({ ic: o.locked ? "lock" : "unlock", kind: "icon", onClick: () => { o.locked = !o.locked; st.attachGizmo(); changed(true); } })));
      for (const c of d.objects.filter(x => x.parent === o.id)) rowObj(c, depth + 1);
    };
    for (const o of d.objects.filter(x => !x.parent)) rowObj(o);
    if (!d.objects.length) objs.append(hint("Añade un cubo, un plano u otra forma, o importa el modelo 3D de tu edificio o escenario."));
    const addRow = h("div", { class: "chips" }, ...Mod.KINDS_3D.map(([k, l]) => h("button", { class: "chip", onclick: () => { st.addObject(k); app.changed({ panel: true }); app.commit(); } }, "+ " + l)),
      h("button", { class: "chip", onclick: () => importModel(app, st) }, "Importar modelo…"));
    wrap.append(section("Objetos", addRow, objs));

    // ---- Propiedades del objeto ----
    const o = st.sel?.type === "object" ? d.objects.find(x => x.id === st.sel.id) : null;
    if (o) {
      const groups = d.objects.filter(x => x.kind === "group" && x.id !== o.id);
      wrap.append(section(o.name,
        h("input", { class: "text-in", value: o.name, onchange: (e) => { o.name = e.target.value; changed(true); } }),
        vec3(`Posición (${uName})`, o.pos, uK, () => changed(), 0.01),
        vec3("Rotación (°)", o.rot, 1, () => changed(), 1),
        vec3("Escala", o.scale, 1, () => changed(), 0.01),
        row(btn({ label: "Duplicar", ic: "copy", onClick: () => { st.duplicate(o.id); app.changed({ panel: true }); app.commit(); } }),
          btn({ label: "Eliminar", ic: "trash", onClick: () => { st.remove(); app.changed({ panel: true }); app.commit(); } })),
        row(o.kind === "group" ? btn({ label: "Desagrupar", onClick: () => { st.ungroup(o.id); app.changed({ panel: true }); app.commit(); } })
          : h("label", { class: "field" }, h("span", { class: "lab" }, "Grupo"), selectEl([["", "Ninguno"], ...groups.map(g => [g.id, g.name])], o.parent, (v) => { o.parent = v; changed(true); })),
          o.kind !== "group" ? btn({ label: "Nuevo grupo con este", onClick: () => { st.group([o.id]); app.changed({ panel: true }); app.commit(); } }) : null),
        o.kind !== "group" ? h("div", {},
          h("h3", { class: "sub" }, "Contenido de cada cara"),
          hint("Cada cara es como una superficie: elige su contenido (video, animación, cámara, texto…) y sus efectos."),
          h("div", { class: "faces" }, ...Object.entries(o.faces).map(([slot, fid]) => btn({ label: M.SLOT_NAMES[slot] || slot, kind: "small", onClick: () => { app.select(fid); app.openTab("content"); } })))) : null));
    }

    // ---- Proyectores ----
    const pl = h("div", { class: "list" });
    for (const p of d.projectors) {
      const on = st.sel?.type === "projector" && st.sel.id === p.id;
      const used = S.project.surfaces.some(s => S.project.scenes.some(sc => sc.looks[s.id]?.source?.type === "projector3d" && sc.looks[s.id].source.projectorId === p.id));
      pl.append(h("div", { class: `item ${on ? "on" : ""}`, onclick: (e) => { if (e.target.closest("button")) return; st.select("projector", p.id); app.renderPanel(); } },
        h("span", {}, p.name, h("small", {}, ` · ${p.res[0]}×${p.res[1]} · P${p.screen}${used ? " · en salida" : ""}`))));
    }
    if (!d.projectors.length) pl.append(hint("Añade un proyector y colócalo donde está el real. Luego sácalo por una pantalla (P1-P4)."));
    wrap.append(section("Proyectores", pl, btn({ label: "Añadir proyector", ic: "plus", kind: "block", onClick: () => { st.addProjector(); app.changed({ panel: true }); app.commit(); } })));
    const p = st.sel?.type === "projector" ? d.projectors.find(x => x.id === st.sel.id) : null;
    if (p) {
      wrap.append(section(p.name,
        h("input", { class: "text-in", value: p.name, onchange: (e) => { p.name = e.target.value; changed(true); } }),
        vec3(`Posición (${uName})`, p.pos, uK, () => changed(), 0.01),
        vec3("Rotación (°)", p.rot, 1, () => changed(), 0.5),
        row(h("label", { class: "field" }, h("span", { class: "lab" }, "FOV vertical (°)"), num(p.fov, (v) => { p.fov = Math.max(1, Math.min(170, v)); changed(); }, { step: 0.1 })),
          h("label", { class: "field" }, h("span", { class: "lab" }, "Resolución"), h("div", { class: "row" }, num(p.res[0], (v) => { p.res[0] = Math.max(16, Math.round(v)); changed(); }, { step: 1, w: 70 }), num(p.res[1], (v) => { p.res[1] = Math.max(16, Math.round(v)); changed(); }, { step: 1, w: 70 })))),
        row(h("label", { class: "field" }, h("span", { class: "lab" }, `Cerca (${uName})`), num(p.near * uK, (v) => { p.near = Math.max(0.001, v / uK); changed(); })),
          h("label", { class: "field" }, h("span", { class: "lab" }, `Lejos (${uName})`), num(p.far * uK, (v) => { p.far = Math.max(p.near + 0.01, v / uK); changed(); })),
          h("label", { class: "field" }, h("span", { class: "lab" }, "Lens shift X/Y"), h("div", { class: "row" }, num(p.shift[0], (v) => { p.shift[0] = v; changed(); }, { w: 60 }), num(p.shift[1], (v) => { p.shift[1] = v; changed(); }, { w: 60 })))),
        hint(`Aspecto ${(p.res[0] / p.res[1]).toFixed(3)} · el frustum (pirámide) muestra lo que ilumina.`),
        row(h("label", { class: "field" }, h("span", { class: "lab" }, "Salida"), selectEl([[1, "P1"], [2, "P2"], [3, "P3"], [4, "P4"]], p.screen, (v) => { p.screen = +v; changed(true); })),
          btn({ label: "Sacar por la salida", ic: "project", kind: "primary", onClick: () => app.actions.projectorToScreen(p.id, p.screen) })),
        row(btn({ label: "Ver desde el proyector", onClick: () => st.viewFromProjector(p.id) }),
          btn({ label: "Eliminar", ic: "trash", onClick: () => { st.remove(); app.changed({ panel: true }); app.commit(); } }))));
    }

    // ---- Ajustes ----
    wrap.append(section("Vista, rejilla y snap",
      h("label", { class: "field" }, h("span", { class: "lab" }, "Modo de vista"), selectEl(Mod.VIEW_MODES, d.viewMode, (v) => { d.viewMode = v; changed(); })),
      row(h("label", { class: "field" }, h("span", { class: "lab" }, "Unidades"), selectEl([["m", "Metros"], ["cm", "Centímetros"], ["mm", "Milímetros"], ["ft", "Pies"]], d.units, (v) => { d.units = v; changed(true); })),
        h("label", { class: "field" }, h("span", { class: "lab" }, `Rejilla (${uName})`), num(d.gridStep * uK, (v) => { d.gridStep = Math.max(0.001, v / uK); changed(); }))),
      toggle({ label: "Snap", value: d.snap.enabled, onChange: (v) => { d.snap.enabled = v; st.applySnap(); changed(); } }),
      segmented({ options: [["grid", "Rejilla"], ["increment", "Incremento"], ["vertex", "Vértice"], ["edge", "Arista"], ["face", "Cara"]], small: true, value: d.snap.mode, onChange: (v) => { d.snap.mode = v; st.applySnap(); changed(); } }),
      row(h("label", { class: "field" }, h("span", { class: "lab" }, `Mover (${uName})`), num(d.snap.move * uK, (v) => { d.snap.move = Math.max(0.0001, v / uK); st.applySnap(); changed(); })),
        h("label", { class: "field" }, h("span", { class: "lab" }, "Rotar (°)"), num(d.snap.rot, (v) => { d.snap.rot = Math.max(0.1, v); st.applySnap(); changed(); }, { step: 1 })),
        h("label", { class: "field" }, h("span", { class: "lab" }, "Escalar"), num(d.snap.scale, (v) => { d.snap.scale = Math.max(0.001, v); st.applySnap(); changed(); }))),
      h("label", { class: "field" }, h("span", { class: "lab" }, "Calidad del contenido de las caras"),
        segmented({ options: [[256, "256 px"], [512, "512 px"], [1024, "1024 px"], [2048, "2048 px"]], small: true, value: d.faceRes || 512, onChange: (v) => { d.faceRes = +v; changed(); } })),
      btn({ label: "Atajos de teclado del 3D…", ic: "knob", kind: "block", onClick: editKeys })));
    return wrap;
  },
};

export const PANELS_3D = { "3d": panel3d };
export const TABS_3D = [{ id: "3d", label: "3D", ic: "cube", pro: true }];
