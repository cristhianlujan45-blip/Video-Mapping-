// web/js/panels-create3d.js
// «🧊 Crear objeto 3D»: escribes lo que quieres («un carro rojo deportivo»), lo ves girar,
// cambias color, estilo, acabado y vista, y lo proyectas con un toque: en una superficie,
// como holograma, o lo llevas al espacio 3D para mapearlo con varios proyectores.
import { h, row, btn, segmented, hint, toast, dialog, closeDialog } from "./ui.js";
import { OBJECTS3D, IDEAS3D, FINISHES, VIEWS, parseRequest, libraryRecipe, validateRecipe, aiPrompt } from "./gen3d.js";
import { loadThree, modelView, exportOBJ } from "./render3d.js";
import { aiOf } from "./panels-assistant.js";

const SPINS = [[0, "Quieto"], [0.5, "Lento"], [1, "Normal"], [2, "Rápido"]];
const ui = { text: "", recipe: null, finish: "real", view: "three", spin: 1, fromCache: "" };
// Lo que ya diseñó la IA se guarda: pedir lo mismo otra vez es instantáneo.
const CACHE = "lumamap:3dcache";
const keyOf = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9ñ ]+/g, " ").replace(/\s+/g, " ").trim();
const cacheGet = (t) => { try { return JSON.parse(localStorage.getItem(CACHE) || "{}")[keyOf(t)] || null; } catch { return null; } };
const cachePut = (t, r) => { try { const all = JSON.parse(localStorage.getItem(CACHE) || "{}"); all[keyOf(t)] = r; const keys = Object.keys(all); for (const k of keys.slice(0, Math.max(0, keys.length - 20))) delete all[k]; localStorage.setItem(CACHE, JSON.stringify(all)); } catch {} };

/**
 * opts.prompt: crear directamente con esa frase · opts.onPick(recipe, look): modo «elegir»
 * (p. ej. desde el asistente de holograma): un solo botón «Usar este objeto».
 */
export async function openCreate3D(app, opts = {}) {
  const A = app.actions, S = app.S;
  if (opts.prompt) ui.text = opts.prompt;
  const status = h("p", { class: "hint c3status" });
  const preview = h("canvas", { class: "c3preview", width: 640, height: 400 });
  const controls = h("div", { class: "c3controls" });
  const acts = h("div", { class: "c3acts" });
  const input = h("input", { class: "text-in", type: "text", value: ui.text, placeholder: "¿Qué objeto quieres? Ej.: un carro rojo deportivo" });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") create(); });
  let busy = false, alive = true, t0 = performance.now();

  try { await loadThree(); } catch (e) { toast("No se pudo cargar el motor 3D: " + e.message, "err"); return; }
  // La IA se va cargando en memoria mientras eliges (la primera vez es lo que más tarda).
  aiOf(app).warmup().catch(() => {});

  // Vista previa que gira (se para al cerrar).
  const loop = () => {
    if (!alive) return;
    if (ui.recipe && preview.isConnected) {
      const img = modelView().render(ui.recipe, preview.width, preview.height, { t: (performance.now() - t0) / 1000, spin: ui.spin || 0.3, view: ui.view, finish: ui.finish });
      preview.getContext("2d").drawImage(img, 0, 0);
    }
    requestAnimationFrame(loop);
  };

  async function create(text = input.value) {
    text = String(text || "").trim();
    if (!text || busy) return;
    ui.text = input.value = text;
    const req = parseRequest(text);
    if (req) {
      ui.recipe = libraryRecipe(req.id, req);
      // El texto 3D se lee mejor de frente y quieto; el resto, en 3/4 girando.
      if (req.id === "texto") { ui.view = "front"; ui.spin = 0; } else if (ui.view === "front" && ui.spin === 0) { ui.view = "three"; ui.spin = 1; }
      status.textContent = `${OBJECTS3D.find(o => o.id === req.id).emoji} Hecho con la biblioteca 3D de LumaMap (sin internet).`;
      return draw();
    }
    // Ya diseñado antes: al instante (pulsar «Crear» otra vez con lo mismo = otra versión).
    const cached = cacheGet(text);
    if (cached && ui.fromCache !== keyOf(text)) {
      ui.recipe = cached; ui.fromCache = keyOf(text);
      status.textContent = `🧠 «${cached.name}» (${cached.parts.length} piezas), ya diseñado antes. Pulsa «Crear» otra vez para otra versión.`;
      return draw();
    }
    ui.fromCache = "";
    // Fuera de la biblioteca: la IA (si está activada) diseña la receta de piezas.
    const ai = aiOf(app);
    busy = true; status.textContent = "Comprobando la IA…"; draw();
    let tick = 0;
    try {
      await ai.refresh();
      const p = ai.active;
      if (p === ai.none) {
        status.textContent = `Sin IA puedo crear: ${OBJECTS3D.map(o => o.name.toLowerCase()).join(", ")}. Para «${text}» activa la IA local (Asistente → Configuración) y vuelve a intentarlo.`;
        return;
      }
      const t0 = Date.now();
      const say = () => { const sec = Math.round((Date.now() - t0) / 1000); status.textContent = `La IA (${p.label}) está diseñando «${text}»… ${sec} s${sec > 20 ? " (la primera vez tarda más: está cargando la IA)" : ""}`; };
      say(); tick = setInterval(say, 1000);
      const q = aiPrompt(text);
      const out = await p.ask({ system: q.system, user: q.user, schema: q.schema, maxTokens: q.maxTokens });
      ui.recipe = validateRecipe(out);
      cachePut(text, ui.recipe); ui.fromCache = keyOf(text);
      status.textContent = `🧠 Diseñado por la IA (${p.label}) en ${Math.round((Date.now() - t0) / 1000)} s con ${ui.recipe.parts.length} piezas. Si no te convence, pulsa «Crear» otra vez para otra versión.`;
    } catch (e) {
      status.textContent = "La IA no pudo crearlo: " + (e?.message || e) + ". Prueba con otra frase o con un objeto de la lista.";
    } finally { clearInterval(tick); busy = false; draw(); }
  }

  const rebuildLibrary = (patch) => {
    if (ui.recipe?.source !== "library") return;
    ui.recipe = libraryRecipe(ui.recipe.object, { ...ui.recipe, ...patch });
    draw();
  };
  const look = () => ({ type: "model3d", model: ui.recipe, spin: ui.spin, view: ui.view, finish: ui.finish, yaw: 0, zoom: 1 });

  function draw() {
    controls.replaceChildren(); acts.replaceChildren();
    const r = ui.recipe;
    if (!r) { acts.append(hint("Escribe qué quieres o toca una idea. Con la IA activada puedes pedir cualquier cosa (un dragón, una guitarra…).")); return; }
    const o = r.source === "library" ? OBJECTS3D.find(x => x.id === r.object) : null;
    if (o && o.styles.length > 1) controls.append(h("div", { class: "lbl" }, "Estilo"), segmented({ options: o.styles, value: r.style, small: true, onChange: (v) => rebuildLibrary({ style: v }) }));
    if (o) {
      const c1 = h("input", { type: "color", value: r.color }), c2 = h("input", { type: "color", value: r.color2 });
      c1.addEventListener("input", () => rebuildLibrary({ color: c1.value }));
      c2.addEventListener("input", () => rebuildLibrary({ color2: c2.value }));
      controls.append(h("div", { class: "lbl" }, "Colores"), h("div", { class: "c3colors" }, h("label", {}, c1, " Principal"), h("label", {}, c2, " Detalles")));
      if (o.id === "texto") {
        const ti = h("input", { class: "text-in", value: r.text || "", placeholder: "Texto (máx. 24 letras)" });
        ti.addEventListener("change", () => rebuildLibrary({ text: ti.value.trim().slice(0, 24) || "HOLA" }));
        controls.append(ti);
      }
    }
    controls.append(
      h("div", { class: "lbl" }, "Acabado"), segmented({ options: FINISHES, value: ui.finish, small: true, onChange: (v) => { ui.finish = v; } }),
      h("div", { class: "lbl" }, "Vista"), segmented({ options: VIEWS, value: ui.view, small: true, onChange: (v) => { ui.view = v; } }),
      h("div", { class: "lbl" }, "Girar"), segmented({ options: SPINS, value: ui.spin, small: true, onChange: (v) => { ui.spin = v; } }));
    if (opts.onPick) { acts.append(btn({ label: "Usar este objeto", ic: "check", kind: "block primary", onClick: () => { closeDialog(); opts.onPick(ui.recipe, look()); } })); return; }
    acts.append(...[
      btn({ label: "▶ Proyectar (superficie nueva)", kind: "block primary", onClick: () => { A.add3DObject(look(), "new"); closeDialog(); } }),
      S.sel ? btn({ label: "Poner en la superficie elegida", kind: "block", onClick: () => { A.add3DObject(look(), "sel"); closeDialog(); } }) : null,
      row(btn({ label: "🎤 Holograma", kind: "wide", onClick: () => { closeDialog(); A.hologramWizard({ source: "model", model: ui.recipe, spin: ui.spin || 1 }); } }),
        btn({ label: "🧊 Al espacio 3D", kind: "wide", title: "Para mapearlo con varios proyectores alrededor", onClick: async () => { closeDialog(); await A.add3DObject(look(), "space3d"); } }),
        btn({ label: "⬇ .OBJ", kind: "wide", title: "Descargar el modelo para Blender u otros programas", onClick: () => app.saveBlob(`${(r.name || "objeto").replace(/[^\wáéíóúñ -]+/gi, "").trim() || "objeto"}.obj`, new Blob([exportOBJ(r)], { type: "model/obj" })) }))].filter(Boolean));
  }

  const content = h("div", { class: "create3d" },
    row(input, btn({ label: "✨ Crear", kind: "primary", onClick: () => create() })),
    h("div", { class: "chips" }, ...IDEAS3D.map(i => h("button", { class: "chip", onclick: () => create(i.id === "texto" ? `texto 3D «${(S.project.name || "HOLA").slice(0, 12)}»` : i.label.replace(/^\S+\s/, "")) }, i.label))),
    status, preview, controls, acts);
  draw();
  const done = dialog({ title: "🧊 Crear objeto 3D", content, wide: true, buttons: [] });
  requestAnimationFrame(loop);
  if (ui.text && (opts.prompt || !ui.recipe)) create(ui.text);
  done.then(() => { alive = false; });
  return done;
}
