// web/js/panels-vj.js
// «🤖 VJ automático» (pestaña En vivo): encender/parar, estilo, intensidad, estado en directo
// (parte del tema, energía, tempo, clip) y «Mi set»: qué animaciones, videos y shaders puede
// usar y con qué energía. «Crear set con una frase» usa la IA si está activada (solo devuelve
// datos que se validan) o reglas sin IA.
import { h, section, row, btn, slider, toggle, hint, toast, dialog, swatches, tiles, lazyThumb } from "./ui.js";
import { VJ_STYLES, SECTIONS, clipEnergy, setFromText } from "./autovj.js";
import { ANIM_LIBRARY, ANIM_CATEGORIES } from "./model.js";
import { animThumb } from "./thumbs.js";
import { aiOf } from "./panels-assistant.js";
import { getShader } from "./plugins.js";

const EN = { soft: "🌙 Suave", mid: "⚡ Media", hard: "🔥 Fuerte" };
const SEC_IC = { calm: "🌙", build: "📈", drop: "💥", high: "🔥", break: "🌫" };
const V = (app) => app.S.project.settings.vj;

/** Clip del set a partir de una animación del catálogo o de un archivo de la biblioteca. */
export const clipOfAnim = (a) => a.shader ? { id: a.id, name: a.name, kind: "shader", shaderId: a.shader }
  : { id: a.id, name: a.name, kind: "anim", gen: a.gen, color: a.color, color2: a.color2, speed: a.speed, scale: a.scale, fx: a.fx || null };
export const clipOfMedia = (m) => ({ id: "m:" + m.id, name: m.name, kind: "media", mediaId: m.id, thumb: m.thumb || "" });

export function vjSection(app) {
  const A = app.actions, v = V(app), on = !!app.S.vjOn;
  const status = h("div", { class: "vjstatus" });
  const paint = () => {
    const st = app.vjStatus?.();
    if (!st) { status.replaceChildren(h("span", {}, "Parado")); return; }
    status.replaceChildren(
      h("b", { class: `vjsec ${st.section}` }, `${SEC_IC[st.section] || ""} ${st.sectionName}`),
      h("span", { class: "vjbar" }, h("i", { style: `width:${Math.round(st.energy * 100)}%` })),
      h("small", {}, `${Math.round(st.bpm)} BPM${st.live ? " · 🎤 escuchando" : " · al tempo"}${st.clip ? ` · ${st.clip}` : ""}${st.nextIn ? ` · cambia en ${st.nextIn}` : ""}`));
  };
  paint();
  const t = setInterval(() => { if (!status.isConnected) return clearInterval(t); paint(); }, 400);
  const n = v.clips.filter(c => c.on !== false).length;
  return section("🤖 VJ automático",
    hint("Mezcla solo como un VJ: escucha la música, reconoce la calma, la subida, el DROP y la pausa, cambia de clip al final de cada frase con la transición que toca y mueve los efectos al ritmo."),
    btn({ label: on ? "■ Parar el VJ automático" : "▶ Empezar el VJ automático", kind: `block ${on ? "danger" : "primary"}`, onClick: () => { on ? A.vjStop() : A.vjStart(); app.renderPanel(); } }),
    on ? status : null,
    on ? btn({ label: "⏭ Clip siguiente ya", kind: "block", onClick: () => A.vjSkip() }) : null,
    h("div", { class: "lbl" }, "Estilo"),
    h("div", { class: "chips" }, ...Object.entries(VJ_STYLES).map(([id, s]) => h("button", { class: `chip ${v.style === id ? "on" : ""}`, onclick: () => { A.vjSet({ style: id }); app.renderPanel(); } }, s.name))),
    slider({ label: "Intensidad de efectos", min: 0, max: 1, value: v.intensity, def: 0.7, fmt: (x) => Math.round(x * 100) + "%", onInput: (x) => A.vjSet({ intensity: x }) }),
    toggle({ label: "Cada pantalla con un clip distinto", value: v.variety, onChange: (x) => A.vjSet({ variety: x }) }),
    toggle({ label: "Colores del estilo en las animaciones", hint: "Cada parte del tema con su paleta (rojo y negro en el drop del techno…).", value: v.recolor, onChange: (x) => A.vjSet({ recolor: x }) }),
    btn({ label: n ? `🎛 Mi set (${n} clips)` : "🎛 Mi set: elige qué animaciones y videos usa", kind: "block", onClick: () => openVjSet(app) }),
    !n ? hint("Sin set, el VJ usa todo el catálogo de animaciones.") : null,
    !app.audioActive?.() ? btn({ label: "🎤 Que escuche la música (micrófono o entrada de línea)", kind: "block", onClick: () => A.toggleMic() }) : null);
}

/** «Mi set»: lo que hay, con su energía, y lo que se puede añadir. */
export async function openVjSet(app) {
  const body = h("div", { class: "vjset" });
  const ui = { cat: "Todas", ask: "" };
  const v = V(app);
  const save = () => { app.changed(); app.commitSoon(); };
  const has = (id) => v.clips.some(c => c.id === id);
  const toggleClip = (clip) => { if (has(clip.id)) v.clips = v.clips.filter(c => c.id !== clip.id); else v.clips.push(clip); save(); draw(); };
  const thumbOf = (c) => c.kind === "media" ? (app.S.project.media.find(m => m.id === c.mediaId)?.thumb || "") : () => animThumb(ANIM_LIBRARY.find(a => a.id === c.id) || { id: c.id, gen: c.gen, color: c.color, color2: c.color2, speed: c.speed, scale: c.scale, fx: c.fx, shader: c.shaderId });

  async function fromPhrase(text) {
    if (!text.trim()) return toast("Escribe cómo quieres el show (p. ej. «techno oscuro rojo con láseres»)");
    let r = setFromText(text), by = "reglas (sin IA)";
    // Con la IA activada: elige estilo, colores y clips del catálogo (solo datos; se validan).
    try {
      const ai = aiOf(app); await ai.refresh();
      const p = ai.active;
      if (p && p !== ai.none) {
        const names = ANIM_LIBRARY.filter(a => a.cat !== "Calibración").map(a => a.name);
        const out = await p.ask({
          system: "Eres un VJ profesional. Eliges el estilo, dos colores y entre 10 y 20 animaciones de la lista para un show. Responde SOLO con el JSON pedido.",
          user: `Show: «${text}». Estilos: ${Object.keys(VJ_STYLES).join(", ")}. Animaciones disponibles: ${names.join(" | ")}`,
          schema: { type: "object", properties: { style: { type: "string", enum: Object.keys(VJ_STYLES) }, colors: { type: "array", items: { type: "string" }, maxItems: 2 }, clips: { type: "array", items: { type: "string" }, maxItems: 24 } }, required: ["style", "clips"] },
          maxTokens: 700,
        });
        const valid = (out?.clips || []).map(n => ANIM_LIBRARY.find(a => a.name.toLowerCase() === String(n).toLowerCase())).filter(Boolean);
        if (VJ_STYLES[out?.style] && valid.length >= 4) {
          const cols = (out.colors || []).filter(c => /^#[0-9a-f]{6}$/i.test(c));
          r = { style: out.style, palette: cols.length ? [cols[0], cols[1] || "#000000"] : r.palette, anims: valid };
          by = `IA (${p.label})`;
        }
      }
    } catch {}
    // Sin IA (o si la IA no dio una lista válida): las del tema y una mezcla de energías del estilo.
    let anims = r.anims;
    if (!anims) {
      const pool = ANIM_LIBRARY.filter(a => a.cat !== "Calibración" && !(a.shader && getShader(a.shader)?.isf?.usesCamera));
      const themed = pool.filter(a => r.gens.includes(a.gen));
      const by3 = (e, k) => pool.filter(a => clipEnergy(a) === e && !themed.includes(a)).sort(() => Math.random() - 0.5).slice(0, k);
      anims = [...themed.slice(0, 10), ...by3("soft", 4), ...by3("mid", 4), ...by3("hard", 6)];
    }
    v.clips = [...v.clips.filter(c => c.kind === "media"), ...anims.map(clipOfAnim)];
    v.style = r.style;
    if (r.palette) v.palette = r.palette;
    save();
    app.actions.vjSet({ style: r.style });
    toast(`🤖 Set listo (${by}): ${VJ_STYLES[r.style].name}, ${anims.length} animaciones${r.palette ? " y tus colores" : ""}`);
    draw();
  }

  function draw() {
    const inSet = v.clips;
    const askIn = h("input", { type: "text", class: "text-in", value: ui.ask, placeholder: "Ej.: techno oscuro rojo y blanco con láseres", oninput: (e) => { ui.ask = e.target.value; } });
    const catalog = ANIM_LIBRARY.filter(a => a.cat !== "Calibración" && (ui.cat === "Todas" || a.cat === ui.cat));
    const media = app.S.project.media.filter(m => (m.kind === "video" || m.kind === "image" || m.kind === "anim") && !m.pending);
    body.replaceChildren(
      section("✨ Crear el set con una frase",
        row(askIn, btn({ label: "Crear", kind: "primary", onClick: () => fromPhrase(askIn.value) })),
        hint("Con la IA activada la elige la IA; si no, se eligen por el tema y los colores que escribas.")),
      section(`En tu set (${inSet.length})`,
        inSet.length ? h("div", { class: "vjclips" }, ...inSet.map(c => {
          const img = h("img", { alt: "" }), th = thumbOf(c);
          if (typeof th === "function") lazyThumb(img, th); else img.src = th;
          return h("div", { class: `vjclip ${c.on === false ? "off" : ""}` }, img,
            h("div", { class: "nm" }, c.name, h("small", {}, c.kind === "media" ? "video/foto" : c.kind === "shader" ? "shader" : "animación")),
            h("div", { class: "chips" }, ...["soft", "mid", "hard"].map(e => h("button", { class: `chip ${clipEnergy(c) === e ? "on" : ""}`, onclick: () => { c.energy = e; save(); draw(); } }, EN[e]))),
            h("button", { class: "btn small", title: c.on === false ? "Usar" : "No usar por ahora", onclick: () => { c.on = c.on === false; save(); draw(); } }, c.on === false ? "○" : "●"),
            h("button", { class: "btn small danger", title: "Quitar del set", onclick: () => toggleClip(c) }, "✕"));
        })) : hint("Vacío: el VJ usa todo el catálogo. Toca animaciones o videos de abajo para añadirlos."),
        inSet.length ? btn({ label: "Vaciar el set", kind: "block", onClick: () => { v.clips = []; save(); draw(); } }) : null),
      media.length ? section("Tus videos y fotos", tiles(media.map(m => ({ id: m.id, label: (has("m:" + m.id) ? "✓ " : "") + m.name, img: m.thumb || "" })),
        { cols: 4, value: null, onPick: (id) => toggleClip(clipOfMedia(app.S.project.media.find(m => m.id === id))) })) : null,
      section("Animaciones y shaders",
        h("div", { class: "chips" }, ...["Todas", ...ANIM_CATEGORIES.filter(c => c !== "Calibración")].map(c => h("button", { class: `chip ${ui.cat === c ? "on" : ""}`, onclick: () => { ui.cat = c; draw(); } }, c))),
        btn({ label: `Añadir las ${catalog.length} de «${ui.cat}»`, kind: "block", onClick: () => { for (const a of catalog) if (!has(a.id)) v.clips.push(clipOfAnim(a)); save(); draw(); } }),
        tiles(catalog.map(a => ({ id: a.id, label: (has(a.id) ? "✓ " : "") + a.name, img: () => animThumb(a) })), { cols: 4, value: null, onPick: (id) => toggleClip(clipOfAnim(ANIM_LIBRARY.find(a => a.id === id))) })),
      v.palette ? section("Colores propios", row(swatches({ label: "Color 1", value: v.palette[0], onChange: (c) => { v.palette = [c, v.palette[1]]; save(); } }),
        swatches({ label: "Color 2", value: v.palette[1], onChange: (c) => { v.palette = [v.palette[0], c]; save(); } })),
        btn({ label: "Usar los colores del estilo", kind: "block", onClick: () => { v.palette = null; save(); draw(); } })) : null,
    );
  }
  draw();
  await dialog({ title: "🎛 Mi set de VJ", content: body, wide: true, buttons: [{ label: "Listo", kind: "primary", value: null }] });
  app.renderPanel();
}
