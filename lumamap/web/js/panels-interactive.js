// web/js/panels-interactive.js
// Pestaña «Interactivo» (también en el modo simple): proyecciones que reaccionan
// a la gente con cualquier cámara o sensor que dé imagen.
//   1 · Cámara o sensor  →  2 · Alinear con la proyección  →  3 · Efecto  →  4 · Reacciones
import { h, section, row, btn, toggle, slider, hint, toast } from "./ui.js";
import * as M from "./model.js";
import { listCameras, getCamera, cameraIfReady } from "./sources.js";
import { bodyTracker } from "./body.js";
import { INTERACTIVE_FX, calibOf, autoCalibrate } from "./interactive.js";
import { runAction } from "./rules.js";
import { findFx } from "./lightfx.js";

const ui = { editing: false };
const pct = (v) => Math.round(v * 100) + "%";

/** Superficie interactiva: la seleccionada si ya es interactiva; si no, una a pantalla completa. */
function interactiveSurface(app, create = true) {
  const S = app.S, P = S.project, sc = M.currentScene(P);
  const sel = app.surf();
  if (sel && sc.looks[sel.id]?.source.type === "body") return sel;
  const ex = P.surfaces.find(s => sc.looks[s.id]?.source.type === "body");
  if (ex || !create) return ex || null;
  const s = M.createQuad({ name: "Interactivo", corners: M.rectCorners(0, 0, P.width, P.height) });
  M.addSurface(P, s, { type: "body", bodyMode: "silueta", gen: "rainbow", camId: calibOf(P).camId || "" });
  return s;
}

/** Vista de la cámara con las 4 esquinas de la proyección (se arrastran). */
function cameraView(app, cal) {
  const cv = h("canvas", { class: "icam", width: 480, height: 270 });
  let drag = -1;
  const toN = (e) => { const r = cv.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]; };
  cv.addEventListener("pointerdown", (e) => {
    if (!ui.editing) return;
    const p = toN(e), r = cv.getBoundingClientRect();
    drag = cal.quad.findIndex(q => Math.hypot((q[0] - p[0]) * r.width, (q[1] - p[1]) * r.height) < 24);
    if (drag >= 0) { cv.setPointerCapture(e.pointerId); e.preventDefault(); }
  });
  cv.addEventListener("pointermove", (e) => { if (drag >= 0) { cal.quad[drag] = toN(e); cal.enabled = true; } });
  const end = () => { if (drag >= 0) { drag = -1; app.changed(); app.commitSoon(); } };
  cv.addEventListener("pointerup", end); cv.addEventListener("pointercancel", end);
  const draw = () => {
    if (!cv.isConnected) return;
    const ctx = cv.getContext("2d"), W = cv.width, H = cv.height;
    ctx.fillStyle = "#05070b"; ctx.fillRect(0, 0, W, H);
    const cam = cameraIfReady(cal.camId || "default");
    const v = cam?.el;
    if (v && v.videoWidth) {
      if (cv.height !== Math.round(W * v.videoHeight / v.videoWidth)) cv.height = Math.round(W * v.videoHeight / v.videoWidth);
      ctx.drawImage(v, 0, 0, W, cv.height);
      // Lo que detecta (silueta o movimiento) en azul encima.
      const T = bodyTracker(cal.camId || "default");
      ctx.globalAlpha = 0.45; ctx.drawImage(T.source(false), 0, 0, W, cv.height); ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = "#8e9ab0"; ctx.font = "14px system-ui"; ctx.textAlign = "center";
      ctx.fillText(cam ? "Esperando imagen de la cámara…" : "Elige una cámara", W / 2, H / 2); ctx.textAlign = "start";
    }
    const Hh = cv.height, q = cal.quad.map(([x, y]) => [x * W, y * Hh]);
    ctx.lineWidth = 2; ctx.strokeStyle = cal.enabled ? "#34c759" : "rgba(255,214,10,.8)";
    ctx.beginPath(); q.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.stroke();
    if (ui.editing || cal.enabled) q.forEach(([x, y], i) => {
      ctx.beginPath(); ctx.arc(x, y, ui.editing ? 10 : 5, 0, Math.PI * 2);
      ctx.fillStyle = ["#ff2d8a", "#ffd60a", "#00e5ff", "#34c759"][i]; ctx.fill();
      if (ui.editing) { ctx.fillStyle = "#000"; ctx.font = "bold 11px system-ui"; ctx.fillText(String(i + 1), x - 3, y + 4); }
    });
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
  return cv;
}

const QUICK_RULES = [
  { label: "Al entrar alguien → siguiente escena", rule: { signal: "presence", op: "above", value: 0.5, then: { type: "scene", index: "next" } } },
  { label: "Al levantar la mano → color rojo", rule: { signal: "hands_up", op: "above", value: 0.5, then: { type: "color", surface: "all", color: "#ff0000" } } },
  { label: "Al entrar alguien → luces «Fuego»", rule: { signal: "presence", op: "above", value: 0.5, then: { type: "lightfx", fx: findFx("Fuego")?.id }, otherwise: { type: "lightfx", fx: findFx("Respirar")?.id } } },
  { label: "Con dos personas → luces «Disco»", rule: { signal: "people", op: "above", value: 0.375, then: { type: "lightfx", fx: findFx("Disco")?.id } } },
  { label: "Con los brazos abiertos → destello", rule: { signal: "spread", op: "above", value: 0.6, then: { type: "anim", surface: "all", name: M.ANIM_LIBRARY.find(a => a.gen === "beatflash")?.name || M.ANIM_LIBRARY[0].name } } },
];

const interactivePanel = {
  title: () => "Proyección interactiva",
  render(app) {
    const S = app.S, P = S.project, cal = calibOf(P);
    const set = (fn, panel = true) => { fn(); app.changed({ panel }); app.commitSoon(); };
    const wrap = h("div", { class: "interactive" });
    const surf = interactiveSurface(app, false);
    const look = surf ? M.lookOf(M.currentScene(P), surf.id) : null;
    const T = bodyTracker(cal.camId || "default");
    T.onStatus = () => { if (S.tab === "interactive") app.renderPanel(); };
    getCamera(cal.camId || "default").catch((e) => { wrap.querySelector(".istate")?.replaceChildren(h("i"), "No se pudo abrir la cámara: " + (e.message || e)); });

    const stTxt = { off: "esperando la cámara", loading: "cargando la IA que detecta personas…", ai: "IA activa: ve la silueta de las personas", motion: "detecta lo que se mueve (sin IA en este equipo)", error: "no se pudo iniciar la detección" }[T.status] || "";
    wrap.append(h("p", { class: `istate ${T.status === "ai" || T.status === "motion" ? "ok" : ""}` }, h("i"),
      `Cámara: ${stTxt} · Alineación: ${cal.enabled ? "activa" : "sin alinear"}${surf ? " · Efecto en «" + surf.name + "»" : ""}`));

    // ---- 1 · Cámara ----
    const camSel = h("select", { class: "text-in" }, h("option", { value: "" }, "Cámara por defecto"));
    listCameras().then(cs => { for (const c of cs) camSel.append(h("option", { value: c.id, selected: c.id === cal.camId }, c.label)); });
    camSel.addEventListener("change", () => set(() => {
      cal.camId = camSel.value;
      for (const sc of P.scenes) for (const l of Object.values(sc.looks)) if (l.source.type === "body") l.source.camId = cal.camId;
    }));
    wrap.append(section("1 · Cámara o sensor",
      hint("Sirve cualquier cámara: web, USB, capturadora HDMI o un sensor que dé imagen. Colócala viendo toda la zona donde proyectas (pared o suelo)."),
      camSel, cameraView(app, cal)));

    // ---- 2 · Alinear ----
    wrap.append(section("2 · Alinear con la proyección",
      hint("Para que el efecto salga justo donde está la persona, la cámara tiene que saber dónde cae la proyección."),
      row(btn({ label: "Alinear automáticamente", ic: "wand", kind: "primary", onClick: async (e) => {
        const b = e.currentTarget; b.disabled = true; toast("Alineando: el proyector mostrará negro y blanco un momento…");
        const r = await autoCalibrate(cal.camId || "default", (p) => app.actions.showPattern(p));
        b.disabled = false;
        if (r.ok) set(() => { cal.quad = r.quad; cal.enabled = true; ui.editing = false; });
        toast(r.message, r.ok ? "" : "err");
      } }),
        btn({ label: ui.editing ? "Listo" : "Ajustar a mano", ic: "target", onClick: () => { ui.editing = !ui.editing; if (ui.editing) cal.enabled = true; app.changed({ panel: true }); app.commitSoon(); } })),
      ui.editing ? hint("Arrastra los 4 puntos a las esquinas de la imagen proyectada que ves en la cámara: 1 arriba-izquierda, 2 arriba-derecha, 3 abajo-derecha, 4 abajo-izquierda.") : null,
      row(toggle({ label: "Usar la alineación", value: cal.enabled, onChange: (v) => set(() => { cal.enabled = v; }) }),
        btn({ label: "Reiniciar", kind: "small", onClick: () => set(() => { cal.quad = M.defaultInteractive().quad; cal.enabled = false; }) }))));

    // ---- 3 · Efecto ----
    const grid = h("div", { class: "ifxgrid" });
    for (const f of INTERACTIVE_FX) {
      const on = look?.source.bodyMode === f.mode;
      grid.append(h("button", { class: `ifx ${on ? "on" : ""}`, onclick: () => {
        const s = interactiveSurface(app, true);
        const l = M.lookOf(M.currentScene(P), s.id);
        Object.assign(l.source, { type: "body", bodyMode: f.mode, gen: f.gen, camId: cal.camId || "" });
        // Los efectos de esqueleto y partículas usan el tracking del cuerpo: se pone en marcha solo.
        if (["particulas", "fuego", "humo", "esqueleto", "lineas", "geometria"].includes(f.mode)) app.tracking?.ensure(P.settings.tracking.camId || cal.camId || "default");
        app.select(s.id);
        app.changed({ panel: true }); app.commit();
        toast(`${f.name} · proyectando en «${s.name}»`);
      } }, h("b", {}, f.name), h("small", {}, f.desc)));
    }
    wrap.append(section("3 · Efecto interactivo", grid,
      look ? slider({ label: "Sensibilidad", min: 0, max: 1, value: look.source.bodySens ?? 0.5, def: 0.5, fmt: pct, onInput: (v) => app.edit(() => { look.source.bodySens = v; }) }) : null,
      look ? btn({ label: "Cambiar colores y animación del efecto", ic: "content", kind: "block", onClick: () => { app.select(surf.id); app.openTab("content"); } }) : null));

    // ---- 4 · Reacciones ----
    const rules = P.settings.tracking.rules;
    wrap.append(section("4 · Reacciones (opcional)",
      hint("Cuando la cámara vea algo, LumaMap hace algo: cambiar de escena, de color o el efecto de las luces."),
      h("div", { class: "chips" }, ...QUICK_RULES.map(q => h("button", { class: "chip", onclick: () => {
        rules.push({ id: M.uid("rule"), name: q.label, cooldown: 1, enabled: true, otherwise: null, ...JSON.parse(JSON.stringify(q.rule)) });
        app.tracking?.ensure(P.settings.tracking.camId || cal.camId || "default");
        app.changed({ panel: true }); app.commit();
        toast("Reacción creada: " + q.label);
      } }, "+ " + q.label))),
      rules.length ? h("div", { class: "list" }, ...rules.map(r => h("div", { class: "item" }, h("span", {}, r.name || "Regla", h("small", {}, r.fired ? ` · ${r.fired}×` : "")),
        btn({ ic: "play", kind: "icon", title: "Probar ahora", onClick: () => { try { toast(runAction(app, r.then)); } catch (e) { toast(e.message, "err"); } } }),
        btn({ ic: "trash", kind: "icon", title: "Quitar", onClick: () => set(() => { rules.splice(rules.indexOf(r), 1); }) })))) : null,
      btn({ label: "Zonas y reglas avanzadas", ic: "tracking", kind: "block", onClick: () => { app.setPro(true); app.openTab("tracking"); } })));
    return wrap;
  },
};

export const INTERACTIVE_PANELS = { interactive: interactivePanel };
export const INTERACTIVE_TABS = [{ id: "interactive", label: "Interactivo", ic: "body" }];
