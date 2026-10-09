// web/js/panels-tracking.js
// Panel «Tracking» (modo profesional): proveedor y cámara, calidad, vista en
// vivo con esqueletos, manos y zonas (se dibujan arrastrando), señales en vivo y
// reglas «cuando … entonces …» que hacen cosas reales.
import { h, section, row, btn, segmented, toggle, hint, toast, dialog, swatches, slider } from "./ui.js";
import { PROVIDERS, SIGNALS, BONES } from "./tracking.js";
import { ACTION_TYPES, describeAction } from "./rules.js";
import { listCameras, cameraIfReady } from "./sources.js";
import { catalog } from "./params.js";
import { uid, ANIM_LIBRARY } from "./model.js";
import { LIGHT_FX } from "./lightfx.js";

const ui = { drawZone: false };

function selectEl(options, value, onChange, cls = "text-in small") {
  const sel = h("select", { class: cls });
  for (const [v, label, dis] of options) sel.append(h("option", { value: v, selected: String(v) === String(value), disabled: !!dis }, label));
  sel.addEventListener("change", () => onChange(sel.value));
  return sel;
}
function field(label, el) { return h("label", { class: "field" }, h("span", { class: "lab" }, label), el); }
function signalOptions(cfg) {
  return [...SIGNALS, ...cfg.zones.flatMap(z => [["zone:" + z.id, `Zona «${z.name}»: hay alguien`], ["zonehand:" + z.id, `Zona «${z.name}»: una mano dentro`]])];
}

/** Editor de una acción (lo que hace una regla). */
function actionEditor(app, a, onChange) {
  const box = h("div", { class: "actionedit" });
  const draw = () => {
    box.innerHTML = "";
    box.append(field("Acción", selectEl(ACTION_TYPES, a.type, (v) => { a.type = v; onChange(); draw(); })));
    const S = app.S, P = S.project;
    const surfOpts = [["sel", "La seleccionada"], ["all", "Todas"], ...P.surfaces.map(s => [s.id, s.name])];
    if (a.type === "param") {
      const sel = h("select", { class: "text-in small" });
      for (const g of catalog(app)) { const og = h("optgroup", { label: g.group }); for (const it of g.items) og.append(h("option", { value: it.id, selected: it.id === a.target }, it.name)); sel.append(og); }
      if (!a.target) a.target = sel.value;
      sel.addEventListener("change", () => { a.target = sel.value; onChange(); });
      box.append(field("Parámetro", sel), field("Valor", Object.assign(h("input", { class: "text-in small", type: "number", step: "any", value: a.value ?? 1 }), { onchange: (e) => { a.value = +e.target.value; onChange(); } })));
    } else if (a.type === "color") {
      a.surface = a.surface || "sel"; a.color = a.color || "#ff0000";
      box.append(field("Superficie", selectEl(surfOpts, a.surface, (v) => { a.surface = v; onChange(); })), swatches({ value: a.color, onChange: (c) => { a.color = c; onChange(); } }));
    } else if (a.type === "scene") {
      a.index = a.index ?? 0;
      box.append(field("Escena", selectEl([["next", "Siguiente"], ["prev", "Anterior"], ...P.scenes.map((s, i) => [i, `${i + 1}. ${s.name}`])], a.index, (v) => { a.index = isNaN(+v) ? v : +v; onChange(); })));
    } else if (a.type === "anim") {
      a.surface = a.surface || "sel"; a.name = a.name || ANIM_LIBRARY[0].name;
      box.append(field("Superficie", selectEl(surfOpts, a.surface, (v) => { a.surface = v; onChange(); })),
        field("Animación", selectEl(ANIM_LIBRARY.map(x => [x.name, `${x.cat} · ${x.name}`]), a.name, (v) => { a.name = v; onChange(); })));
    } else if (a.type === "lightfx") {
      a.fx = a.fx || LIGHT_FX[0].id;
      box.append(field("Efecto de luces", selectEl(LIGHT_FX.map(x => [x.id, `${x.cat} · ${x.name}`]), a.fx, (v) => { a.fx = v; onChange(); })));
    } else if (a.type === "macro") {
      const ms = P.settings.control.macros;
      a.id = a.id || ms[0]?.id || "";
      box.append(ms.length ? field("Macro", selectEl(ms.map(m => [m.id, m.name]), a.id, (v) => { a.id = v; onChange(); })) : hint("Crea primero una macro en el panel Control."));
    } else if (a.type === "blackout") {
      box.append(toggle({ label: "Encender el apagón (apagado = quitarlo)", value: a.value !== false, onChange: (v) => { a.value = v; onChange(); } }));
    }
  };
  draw();
  return box;
}

async function editRule(app, rule) {
  const cfg = app.S.project.settings.tracking;
  const w = JSON.parse(JSON.stringify(rule));
  const content = h("div", {},
    field("Nombre", Object.assign(h("input", { class: "text-in", value: w.name || "" }), { oninput: (e) => { w.name = e.target.value; } })),
    h("h3", { class: "sub" }, "Cuando"),
    field("Señal", selectEl(signalOptions(cfg), w.signal, (v) => { w.signal = v; })),
    row(field("Condición", selectEl([["above", "supera"], ["below", "baja de"]], w.op, (v) => { w.op = v; })),
      field("Valor (0-1)", Object.assign(h("input", { class: "text-in small", type: "number", min: 0, max: 1, step: 0.05, value: w.value }), { onchange: (e) => { w.value = +e.target.value; } }))),
    hint("Las señales de sí/no (mano levantada, hay alguien…) valen 0 o 1: usa «supera 0,5». «Personas» vale 0,25 por persona (2 personas = 0,5)."),
    h("h3", { class: "sub" }, "Entonces"),
    actionEditor(app, w.then, () => {}),
    toggle({ label: "Hacer otra cosa al dejar de cumplirse", value: !!w.otherwise, onChange: (v) => { w.otherwise = v ? { type: "param", target: "global/blackout", value: 0 } : null; dialogRefresh(); } }),
    h("div", { class: "otherwise" }),
    field("Espera mínima entre disparos (s)", Object.assign(h("input", { class: "text-in small", type: "number", min: 0, step: 0.1, value: w.cooldown ?? 1 }), { onchange: (e) => { w.cooldown = +e.target.value; } })));
  const dialogRefresh = () => { const o = content.querySelector(".otherwise"); o.innerHTML = ""; if (w.otherwise) o.append(actionEditor(app, w.otherwise, () => {})); };
  dialogRefresh();
  const r = await dialog({ title: "Regla de tracking", content, wide: true, buttons: [{ label: "Cancelar", value: null }, { label: "Guardar", kind: "primary", value: "save" }] });
  if (r !== "save") return;
  const i = cfg.rules.findIndex(x => x.id === rule.id);
  if (i >= 0) cfg.rules[i] = w; else cfg.rules.push(w);
  app.changed({ panel: true }); app.commit();
}

function preview(app) {
  const cv = h("canvas", { class: "trkprev", width: 640, height: 360 });
  let drag = null;
  const pos = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
  cv.addEventListener("pointerdown", (e) => { if (!ui.drawZone) return; drag = { a: pos(e), b: pos(e) }; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener("pointermove", (e) => { if (drag) drag.b = pos(e); });
  cv.addEventListener("pointerup", () => {
    if (!drag) return;
    const [x0, y0] = drag.a, [x1, y1] = drag.b;
    if (Math.abs(x1 - x0) > 0.03 && Math.abs(y1 - y0) > 0.03) {
      const cfg = app.S.project.settings.tracking;
      cfg.zones.push({ id: uid("zone"), name: `Zona ${cfg.zones.length + 1}`, x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) });
      ui.drawZone = false; app.changed({ panel: true }); app.commit();
    }
    drag = null;
  });
  const draw = () => {
    if (!cv.isConnected) return;
    const ctx = cv.getContext("2d"), W = cv.width, H = cv.height, T = app.tracking, cfg = app.S.project.settings.tracking;
    const t = T.main();
    ctx.fillStyle = "#05070b"; ctx.fillRect(0, 0, W, H);
    const cam = cameraIfReady(cfg.camId || "default");
    if (cam && cam.el.readyState >= 2) {
      ctx.save();
      if (cfg.mirror) { ctx.translate(W, 0); ctx.scale(-1, 1); }
      ctx.globalAlpha = 0.6; ctx.drawImage(cam.el, 0, 0, W, H); ctx.restore(); ctx.globalAlpha = 1;
    } else { ctx.fillStyle = "#8e9ab0"; ctx.font = "16px system-ui"; ctx.fillText(t?.offline ? "CÁMARA DESCONECTADA · reconectando…" : "Sin cámara", 20, 30); }
    for (const z of cfg.zones) {
      const on = (t?.lastSignals?.["zone:" + z.id] || 0) > 0 || (t?.lastSignals?.["zonehand:" + z.id] || 0) > 0;
      ctx.strokeStyle = on ? "#ffd60a" : "#ffd60a88"; ctx.lineWidth = on ? 3 : 1.5; ctx.setLineDash(on ? [] : [6, 4]);
      ctx.strokeRect(z.x * W, z.y * H, z.w * W, z.h * H); ctx.setLineDash([]);
      ctx.fillStyle = "#ffd60a"; ctx.font = "12px system-ui"; ctx.fillText(z.name, z.x * W + 4, z.y * H + 14);
    }
    if (drag) { ctx.strokeStyle = "#ffd60a"; ctx.strokeRect(drag.a[0] * W, drag.a[1] * H, (drag.b[0] - drag.a[0]) * W, (drag.b[1] - drag.a[1]) * H); }
    for (const p of t?.people || []) {
      const col = `hsl(${(p.id * 67) % 360},100%,60%)`;
      if (p.lm) {
        ctx.strokeStyle = col; ctx.lineWidth = p.ghost ? 1 : 3; ctx.globalAlpha = p.ghost ? 0.4 : 1;
        for (const [a, b] of BONES) { const A = p.lm[a], B = p.lm[b]; if (A[3] < 0.4 || B[3] < 0.4) continue; ctx.beginPath(); ctx.moveTo(A[0] * W, A[1] * H); ctx.lineTo(B[0] * W, B[1] * H); ctx.stroke(); }
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = col; ctx.font = "bold 14px system-ui";
      ctx.fillText(`#${p.id}${p.leftUp || p.rightUp ? " ✋" : ""}`, p.center[0] * W + 6, p.center[1] * H);
    }
    for (const hd of t?.hands || []) { ctx.fillStyle = "#00e5ff"; for (const q of hd.lm) { ctx.beginPath(); ctx.arc(q[0] * W, q[1] * H, 2.5, 0, Math.PI * 2); ctx.fill(); } }
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
  return cv;
}

const trackingPanel = {
  title: () => "Tracking · personas, manos y zonas",
  render(app) {
    const S = app.S, cfg = S.project.settings.tracking, T = app.tracking;
    const set = (fn, panel = true, restart = false) => { fn(); app.changed({ panel }); app.commitSoon(); if (restart) T.restart(); };
    const t = T.main();
    const wrap = h("div", { class: "trk" });

    // ---- Fuente ----
    const camSel = h("select", { class: "text-in small" }, h("option", { value: "" }, "Cámara por defecto"));
    listCameras().then(cs => { for (const c of cs) camSel.append(h("option", { value: c.id, selected: c.id === cfg.camId }, c.label)); });
    camSel.addEventListener("change", () => set(() => { T.stop(); cfg.camId = camSel.value; }, true));
    wrap.append(section("Fuente",
      field("Proveedor", selectEl(PROVIDERS.map(p => [p.id, p.available ? p.name : `${p.name} — ${p.note}`, !p.available]), cfg.provider, (v) => set(() => { cfg.provider = v; }, true, true))),
      field("Cámara", camSel),
      row(field("Calidad del tracking", selectEl([["low", "Baja (256 px)"], ["medium", "Media (384 px)"], ["high", "Alta (512 px)"], ["ultra", "Ultra (640 px)"]], cfg.quality, (v) => set(() => { cfg.quality = v; }, false, true))),
        field("FPS", selectEl([[15, "15"], [24, "24"], [30, "30"], [60, "60"]], cfg.fps, (v) => set(() => { cfg.fps = +v; }, false, true)))),
      hint("El tracking usa una copia pequeña de la imagen: la cámara puede seguir saliendo en 1080p o 4K por el proyector."),
      row(toggle({ label: "Manos (21 puntos por mano)", value: cfg.hands, onChange: (v) => set(() => { cfg.hands = v; }, false, true) }),
        toggle({ label: "Espejo", value: cfg.mirror, onChange: (v) => set(() => { cfg.mirror = v; }, false, true) })),
      field("Personas a la vez", selectEl([[1, "1"], [2, "2"], [3, "3"], [4, "4"], [6, "6"]], cfg.maxPeople, (v) => set(() => { cfg.maxPeople = +v; }, false, true))),
      toggle({ label: "Activar al abrir el proyecto", value: cfg.autoStart, onChange: (v) => set(() => { cfg.autoStart = v; }, false) }),
      btn({ label: t ? "■ Detener tracking" : "▶ Iniciar tracking", kind: t ? "danger block" : "primary block", onClick: () => { if (t) T.stop(); else T.ensure(cfg.camId || "default"); app.renderPanel(); } }),
      h("p", { class: "hint", id: "trkStatus" }, statusText(t))));

    // ---- Vista en vivo y zonas ----
    wrap.append(section("Vista en vivo", preview(app),
      row(btn({ label: ui.drawZone ? "Arrastra sobre la imagen…" : "Dibujar zona", ic: "rect", kind: ui.drawZone ? "on" : "", onClick: () => { ui.drawZone = !ui.drawZone; app.renderPanel(); } })),
      h("div", { class: "list" }, ...cfg.zones.map(z => h("div", { class: "item" },
        Object.assign(h("input", { class: "text-in small", value: z.name }), { onchange: (e) => set(() => { z.name = e.target.value; }) }),
        btn({ ic: "trash", kind: "icon", onClick: () => set(() => { cfg.zones.splice(cfg.zones.indexOf(z), 1); }) }))))));

    // ---- Señales ----
    const meters = h("div", { class: "meters" });
    for (const [k, label] of signalOptions(cfg)) meters.append(h("div", { class: "meter", dataset: { sig: k } }, h("span", {}, label), h("i")));
    const upd = () => {
      if (!meters.isConnected) return;
      const sg = app.tracking.main()?.lastSignals || {};
      for (const m of meters.children) m.querySelector("i").style.width = Math.round((sg[m.dataset.sig] || 0) * 100) + "%";
      const st = document.getElementById("trkStatus"); if (st) st.textContent = statusText(app.tracking.main());
      setTimeout(upd, 100);
    };
    setTimeout(upd, 100);
    wrap.append(section("Señales en vivo", meters,
      hint("Para mover algo de forma continua (cercanía → brillo, velocidad → glitch, brazos → partículas) usa Control → Añadir mapeo con fuente «Tracking». Para gestos que disparan algo, usa las reglas.")));

    // ---- Reglas ----
    const rules = h("div", { class: "list" });
    for (const r of cfg.rules) rules.append(h("div", { class: `item ${r.enabled === false ? "off" : ""}` },
      h("span", {}, h("b", {}, r.name || "Regla"), h("small", {}, ` · si ${(signalOptions(cfg).find(x => x[0] === r.signal) || [, r.signal])[1].toLowerCase()} ${r.op === "below" ? "<" : ">"} ${r.value} → ${describeAction(app, r.then)}${r.fired ? " · disparada " + r.fired + "×" : ""}`)),
      btn({ ic: r.enabled === false ? "eyeoff" : "eye", kind: "icon", onClick: () => set(() => { r.enabled = r.enabled === false; }) }),
      btn({ ic: "pen", kind: "icon", onClick: () => editRule(app, r) }),
      btn({ ic: "trash", kind: "icon", onClick: () => set(() => { cfg.rules.splice(cfg.rules.indexOf(r), 1); }) })));
    if (!cfg.rules.length) rules.append(hint("Ejemplos: «mano levantada → color rojo», «2 personas → escena 3», «alguien entra en la zona → animación»."));
    wrap.append(section("Reglas (cuando … entonces …)", rules,
      btn({ label: "Nueva regla", ic: "plus", kind: "block", onClick: () => editRule(app, { id: uid("rule"), name: "", signal: "hands_up", op: "above", value: 0.5, cooldown: 1, then: { type: "color", surface: "sel", color: "#ff0000" }, otherwise: null, enabled: true }) })));
    return wrap;
  },
};

function statusText(t) {
  if (!t) return "Tracking detenido.";
  if (t.offline) return "CÁMARA DESCONECTADA · se reconecta sola al volver.";
  if (t.status === "loading") return "Cargando la IA…";
  if (t.status === "error") return "Error: " + t.error;
  const n = t.people.filter(p => !p.ghost).length;
  return `En marcha${t.delegate ? " (IA en " + t.delegate + ")" : ""} · ${n} persona(s) · ${t.fps.toFixed(0)} fps · ${t.ms ? t.ms.toFixed(0) + " ms por fotograma" : ""}`;
}

export const TRACKING_PANELS = { tracking: trackingPanel };
export const TRACKING_TABS = [{ id: "tracking", label: "Tracking", ic: "tracking", pro: true }];
