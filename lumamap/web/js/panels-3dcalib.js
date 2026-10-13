// web/js/panels-3dcalib.js
// «4 · Alinear con el proyector real» del panel 3D: lo que hace falta para que lo que se ve en
// el 3D caiga exacto sobre el objeto de verdad.
//   · Lente: la relación de proyección («throw ratio» de la ficha del proyector) → su FOV.
//   · Malla en el proyector real: las aristas del objeto encima de la imagen, para ver si cuadra.
//   · Ajuste fino con botones (mover, acercar, girar, inclinar, zoom, lens shift), en directo.
//   · Calibrar por puntos (como CamSchnappr de TouchDesigner): tocas esquinas del objeto en el
//     3D, llevas cada cruz a esa esquina en el objeto real y LumaMap calcula el proyector.
import { h, section, row, btn, segmented, toggle, hint, toast } from "./ui.js";
import { calibrate, projectPoint, fovFromThrow, throwFromFov, eulerToMat } from "./calib3d.js";
import * as M from "./model.js";

const STEPS = { fino: [0.005, 0.1], normal: [0.02, 0.5], grueso: [0.1, 2] };   // [metros, grados]
const ui = { step: "normal" };
const LENSES = [[0.5, "Corto alcance 0.5"], [0.8, "Corto 0.8"], [1.2, "1.2"], [1.5, "Estándar 1.5"], [2, "Largo 2.0"]];
const clamp01 = (v) => Math.max(0.02, Math.min(0.98, v));
/** Cambio con deshacer y el panel al día. */
const editP = (app, fn) => { app.edit(fn); app.renderPanel(); };

/** El proyector que se está calibrando (o null). */
const calibrating = (st) => st.data.projectors.find(p => p.calib?.on && Array.isArray(p.calib.points)) || null;

/** Activa el clic en el 3D para elegir esquinas mientras se calibra (se llama en cada dibujo del panel). */
function armPick(app, st) {
  const p = calibrating(st);
  st.calibPick = p ? (w) => {
    const cal = p.calib;
    const ex = cal.points.find(q => Math.hypot(q.w[0] - w[0], q.w[1] - w[1], q.w[2] - w[2]) < 1e-5);
    if (ex) cal.sel = ex.id;
    else {
      // La cruz empieza donde el proyector virtual cree que está esa esquina: solo hay que corregirla.
      const uv = projectPoint(p, w) || [0.5, 0.5];
      const id = M.uid("cp");
      cal.points.push({ id, w, uv: [clamp01(uv[0]), clamp01(uv[1])] });
      cal.sel = id;
      delete cal.rms;
    }
    app.changed({ panel: true }); app.commitSoon();
  } : null;
  st.previewProjector = p ? p.id : null;   // que se dibuje aunque aún no salga por ninguna pantalla
}

/** Recuadro con lo que ve el proyector real: las cruces se arrastran (o se mueven con las flechas). */
function calibPad(app, st, p) {
  const cal = p.calib, [W, H] = p.res;
  const cv = h("canvas", { class: "calibpad", tabindex: "0", width: 640, height: Math.round(640 * H / W), title: "Arrastra la cruz elegida hasta su esquina en el objeto real · flechas: 1 px (Mayús: 10 px)" });
  const g = cv.getContext("2d");
  const draw = () => {
    if (!cv.isConnected) return;
    const cw = cv.width, ch = cv.height;
    g.fillStyle = "#000"; g.fillRect(0, 0, cw, ch);
    const view = st.projectorView(p.id);
    if (view?.el) { try { g.drawImage(view.el, 0, 0, cw, ch); } catch {} }
    cal.points.forEach((q, i) => {
      if (q.id !== cal.sel) return;
      const x = q.uv[0] * cw, y = q.uv[1] * ch;
      g.strokeStyle = "#ffd60a"; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 14, 0, Math.PI * 2); g.stroke();
      g.fillStyle = "#ffd60a"; g.font = "bold 13px system-ui"; g.fillText(`${i + 1}`, x + 16, y - 10);
    });
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
  const toUV = (e) => { const r = cv.getBoundingClientRect(); return [clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height)]; };
  let drag = null;
  cv.addEventListener("pointerdown", (e) => {
    const [u, v] = toUV(e), r = cv.getBoundingClientRect();
    let best = null, bd = 26;
    for (const q of cal.points) { const dd = Math.hypot((q.uv[0] - u) * r.width, (q.uv[1] - v) * r.height); if (dd < bd) { bd = dd; best = q; } }
    if (best) cal.sel = best.id;
    const q = cal.points.find(x => x.id === cal.sel);
    if (!q) return;
    q.uv = [u, v]; drag = q; cv.setPointerCapture(e.pointerId); delete cal.rms;
    app.changed();
  });
  cv.addEventListener("pointermove", (e) => { if (!drag) return; drag.uv = toUV(e); app.changed(); });
  const end = () => { if (drag) { drag = null; app.changed({ panel: true }); app.commitSoon(); } };
  cv.addEventListener("pointerup", end); cv.addEventListener("pointercancel", end);
  cv.addEventListener("keydown", (e) => {
    const k = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!k) return;
    e.preventDefault(); e.stopPropagation();
    nudge(app, cal, k[0] * (e.shiftKey ? 10 : 1), k[1] * (e.shiftKey ? 10 : 1), W, H);
  });
  return cv;
}
function nudge(app, cal, dx, dy, W, H) {
  const q = cal.points.find(x => x.id === cal.sel);
  if (!q) return toast("Elige primero una cruz (toca una esquina del objeto en el 3D)", "err");
  q.uv = [clamp01(q.uv[0] + dx / W), clamp01(q.uv[1] + dy / H)];
  delete cal.rms;
  app.changed(); app.commitSoon();
}

/** Mover el proyector en SUS ejes (derecha, arriba, hacia atrás) o girarlo, con el paso elegido. */
function adjust(app, p, what, sign) {
  const [dm, dg] = STEPS[ui.step], R = eulerToMat(p.rot);
  const axis = (c) => [R[0][c], R[1][c], R[2][c]];
  const move = (c, k) => { const a = axis(c); p.pos = p.pos.map((v, i) => +(v + a[i] * k).toFixed(5)); };
  editP(app, () => {
    if (what === "x") move(0, sign * dm);
    if (what === "y") move(1, sign * dm);
    if (what === "z") move(2, sign * dm);
    if (what === "yaw") p.rot[1] = +(p.rot[1] + sign * dg).toFixed(3);
    if (what === "pitch") p.rot[0] = +(p.rot[0] + sign * dg).toFixed(3);
    if (what === "roll") p.rot[2] = +(p.rot[2] + sign * dg).toFixed(3);
    if (what === "fov") p.fov = Math.max(1, Math.min(170, +(p.fov + sign * dg * 0.5).toFixed(3)));
    if (what === "shift") p.shift = [p.shift[0], +(p.shift[1] + sign * dg * 0.01).toFixed(4)];
  });
}

export function alignSection(app, st) {
  const d = st.data;
  armPick(app, st);
  if (!d.projectors.length) return section("4 · Alinear con el proyector real", hint("Primero pon un proyector (paso 3) en el sitio donde está el de verdad."));
  const cur = calibrating(st);
  const p = cur || (st.sel?.type === "projector" && d.projectors.find(x => x.id === st.sel.id)) || d.projectors[0];
  const [W, H] = p.res;
  const pick = d.projectors.length > 1 ? h("div", { class: "chips" }, ...d.projectors.map(x => h("button", { class: `chip ${x.id === p.id ? "on" : ""}`, disabled: !!cur && x.id !== cur.id, onclick: () => { st.select("projector", x.id); app.renderPanel(); } }, x.name))) : null;

  // Salida y malla
  const out = h("div", {},
    row(btn({ label: `Sacar ${p.name} por P${p.screen}`, ic: "project", kind: "wide primary", onClick: () => { app.actions.projectorToScreen(p.id, p.screen); toast(`${p.name} sale por P${p.screen}: abre esa salida en el proyector real (Proyectar)`); } }),
      btn({ label: "Ver desde él", kind: "wide", onClick: () => st.viewFromProjector(p.id) })),
    toggle({ label: "Malla del objeto en el proyector real", hint: "Dibuja las aristas del objeto encima de la imagen: si caen justo en los bordes del objeto de verdad, está alineado.", value: !!p.wire,
      onChange: (v) => { p.wire = v; app.changed(); app.commitSoon(); } }));

  // Lente
  const tr = throwFromFov(p.fov, p.res);
  const trIn = h("input", { class: "text-in small num", type: "number", step: 0.01, min: 0.1, max: 10, value: tr.toFixed(2), style: { width: "80px" } });
  trIn.addEventListener("change", () => { const v = +trIn.value; if (v > 0.05) editP(app, () => { p.fov = +fovFromThrow(v, p.res).toFixed(3); }); });
  const lens = h("div", {},
    h("div", { class: "lbl" }, "Lente: relación de proyección (distancia ÷ ancho de la imagen)"),
    row(trIn, h("small", {}, `FOV vertical ${p.fov.toFixed(1)}°`)),
    h("div", { class: "chips" }, ...LENSES.map(([v, l]) => h("button", { class: `chip ${Math.abs(tr - v) < 0.005 ? "on" : ""}`, onclick: () => editP(app, () => { p.fov = +fovFromThrow(v, p.res).toFixed(3); }) }, l))),
    hint("Está en la ficha del proyector como «throw ratio» (p. ej. 1.39–2.09: usa el valor del zoom que tengas)."));

  // Ajuste fino
  const b = (label, what, sign, title) => btn({ label, kind: "small", title, onClick: () => adjust(app, p, what, sign) });
  const fine = h("div", { class: "calibfine" },
    segmented({ options: [["fino", "Fino"], ["normal", "Normal"], ["grueso", "Grueso"]], value: ui.step, small: true, onChange: (v) => { ui.step = v; } }),
    h("div", { class: "calibgrid" },
      h("span", {}, "Mover"), b("←", "x", -1, "A la izquierda"), b("→", "x", 1, "A la derecha"), b("↑", "y", 1, "Arriba"), b("↓", "y", -1, "Abajo"),
      h("span", {}, "Distancia"), b("Acercar", "z", -1, "Hacia el objeto"), b("Alejar", "z", 1, "Lejos del objeto"), h("i"), h("i"),
      h("span", {}, "Girar"), b("⟲", "yaw", 1, "Girar a la izquierda"), b("⟳", "yaw", -1, "Girar a la derecha"), b("Inclinar ↑", "pitch", 1, "Mirar más arriba"), b("Inclinar ↓", "pitch", -1, "Mirar más abajo"),
      h("span", {}, "Imagen"), b("Zoom −", "fov", 1, "Imagen más grande (más ángulo)"), b("Zoom +", "fov", -1, "Imagen más pequeña"), b("↺", "roll", -1, "Rodar a la izquierda"), b("↻", "roll", 1, "Rodar a la derecha"),
      h("span", {}, "Lens shift"), b("Subir", "shift", 1, "Subir la imagen sin mover el proyector"), b("Bajar", "shift", -1, "Bajar la imagen sin mover el proyector"), h("i"), h("i")));

  // Calibrar por puntos
  let calib;
  if (!cur) {
    calib = h("div", {},
      btn({ label: "🎯 Calibrar por puntos (como CamSchnappr)", kind: "block primary", onClick: () => {
        editP(app, () => {
          for (const x of d.projectors) if (x.calib) x.calib.on = false;
          p.calib = { on: true, points: Array.isArray(p.calib?.points) ? p.calib.points : [], sel: null, fixLens: !!p.calib?.fixLens };
        });
        st.select("projector", p.id);
      } }),
      hint("Lo más exacto: tocas esquinas del objeto en el 3D y llevas cada cruz a esa esquina en el objeto real. LumaMap calcula dónde está el proyector, su lente y su lens shift."));
  } else {
    const cal = cur.calib, need = cal.fixLens ? 4 : 6;
    const list = h("div", { class: "list calibpts" }, ...cal.points.map((q, i) => h("div", { class: `item ${q.id === cal.sel ? "on" : ""}`, onclick: (e) => { if (e.target.closest("button")) return; cal.sel = q.id; app.changed({ panel: true }); } },
      h("span", {}, `Punto ${i + 1}`, h("small", {}, ` · ${q.w.map(v => v.toFixed(2)).join(", ")}${cal.errors?.[q.id] != null && cal.rms != null ? ` · error ${cal.errors[q.id]} px` : ""}`)),
      btn({ ic: "trash", kind: "icon", title: "Quitar este punto", onClick: () => { editP(app, () => { cal.points = cal.points.filter(x => x.id !== q.id); if (cal.sel === q.id) cal.sel = null; delete cal.rms; }); } }))));
    const n = cal.points.length;
    calib = h("div", { class: "calibbox" },
      h("ol", { class: "calibsteps" },
        h("li", {}, `Saca ${cur.name} por P${cur.screen} y lleva esa salida al proyector real (botón de arriba y «Proyectar»).`),
        h("li", {}, "En la vista 3D toca una esquina del objeto: se marca el vértice más cercano y sale una cruz en el proyector real."),
        h("li", {}, "Arrastra la cruz en este recuadro (o con las flechas) hasta que caiga justo en esa esquina del objeto real."),
        h("li", {}, `Repite con ${need} esquinas o más, repartidas y no todas en la misma cara. Luego «Calcular».`)),
      calibPad(app, st, cur),
      row(btn({ label: "←", kind: "small", onClick: () => nudge(app, cal, -1, 0, W, H) }), btn({ label: "→", kind: "small", onClick: () => nudge(app, cal, 1, 0, W, H) }),
        btn({ label: "↑", kind: "small", onClick: () => nudge(app, cal, 0, -1, W, H) }), btn({ label: "↓", kind: "small", onClick: () => nudge(app, cal, 0, 1, W, H) }),
        h("small", {}, "1 px · con el teclado, Mayús = 10 px")),
      toggle({ label: "Conozco la lente (solo calcular posición y giro: bastan 4 puntos)", value: !!cal.fixLens, onChange: (v) => { cal.fixLens = v; app.changed({ panel: true }); app.commitSoon(); } }),
      n ? list : hint("Aún no hay puntos: toca una esquina del objeto en la vista 3D."),
      cal.rms != null ? h("p", { class: `calibres ${cal.rms <= 3 ? "ok" : "warn"}` }, cal.rms <= 3 ? `✓ Calibrado · error medio ${cal.rms} px` : `Error medio ${cal.rms} px: revisa los puntos con más error (o añade más)`) : null,
      row(btn({ label: `Calcular (${n}/${need})`, kind: "wide primary", disabled: n < need, onClick: () => {
        const r = calibrate(cal.points, cur, { fixLens: cal.fixLens });
        if (!r.ok) return toast(r.why, "err");
        editP(app, () => {
          Object.assign(cur, { pos: r.proj.pos.map(v => +v.toFixed(5)), rot: r.proj.rot.map(v => +v.toFixed(4)), fov: +r.proj.fov.toFixed(4), shift: r.proj.shift.map(v => +v.toFixed(5)) });
          cal.errors = Object.fromEntries(cal.points.map((q, i) => [q.id, +r.errors[i].toFixed(1)]));
          cal.rms = +r.rms.toFixed(2);
        });
        toast(`Proyector calibrado · error medio ${r.rms.toFixed(1)} px${r.rms > 3 ? " (revisa los puntos con más error)" : ""}`);
      } }),
        btn({ label: "Borrar puntos", kind: "wide", disabled: !n, onClick: () => { editP(app, () => { cal.points = []; cal.sel = null; delete cal.rms; }); } }),
        btn({ label: "Terminar", kind: "wide", onClick: () => { editP(app, () => { cal.on = false; }); st.calibPick = null; st.previewProjector = null; } })));
  }

  return section("4 · Alinear con el proyector real",
    hint("Para que lo del 3D caiga exacto sobre el objeto de verdad. Mide dónde está el proyector o, mejor, calíbralo por puntos."),
    pick, out, calib,
    h("details", { class: "fold" }, h("summary", {}, "Lente y ajuste fino a mano"), lens, fine));
}
