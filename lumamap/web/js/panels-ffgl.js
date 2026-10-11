// web/js/panels-ffgl.js
// Plugins FFGL de Resolume (.dll): la lista del panel Plugins (buscar, carpetas, «Usar en la
// superficie seleccionada») y los controles de la superficie que usa uno (panel Contenido).
// Solo en la app de Windows (window.LumaDesktop.ffgl); en Android y en el navegador se dice claro.
import { h, btn, hint, section, slider, toggle, toast } from "./ui.js";
import { ffglAvailable, ffglStatus, ffglRetry, ffglSize, cleanError } from "./ffgl.js";
import { surfaceAspect } from "./math.js";

const ONLY_WINDOWS = "Plugins FFGL de Resolume (.dll): solo en la app de Windows.";
const TYPE = { source: "Fuente", effect: "Efecto" };
const base = (f) => String(f).split(/[\\/]/).pop();

let lastScan = null;   // la última búsqueda (se repite solo al pulsar «Buscar otra vez» o cambiar carpetas)

/** Sección «Plugins FFGL de Resolume» del panel Plugins. */
export function ffglSection(app) {
  const box = h("section", { class: "sec ffgl" }, h("h3", {}, "🎛 Plugins FFGL de Resolume (.dll)"));
  const F = globalThis.LumaDesktop?.ffgl;
  if (!F) { box.append(hint(ONLY_WINDOWS)); return box; }
  const body = h("div", {}, hint("Buscando plugins…"));
  box.append(body);

  const use = (r) => {
    const look = app.lookSel();
    if (!look) { toast("Elige primero una superficie", "err"); return; }
    app.edit(() => Object.assign(look.source, {
      type: "ffgl", ffglPath: r.file, ffglName: r.info.name, ffglKind: r.info.type,
      ffglParamInfo: r.info.params, ffglParams: {}, ffglInput: null, speed: 1,
    }));
    app.changed({ panel: true });
    toast(`🎛 ${r.info.name} en «${app.surf()?.name || "la superficie"}»${r.info.type === "effect" ? " · elige en Contenido qué imagen procesa" : ""}`);
  };

  const draw = (res, status) => {
    const ok = res.plugins.filter(r => r.ok), bad = res.plugins.filter(r => !r.ok);
    const folder = (d, removable) => h("div", { class: "item plug" },
      h("div", { class: "name" }, `📁 ${base(d)}`, h("small", { class: "desc" }, d)),
      h("div", { class: "acts" }, removable ? btn({ label: "Quitar", kind: "small", onClick: async () => { await F.removeFolder(d); load(true); } }) : h("small", { class: "dim" }, "Resolume")));
    body.replaceChildren(
      hint("Fuentes y efectos FFGL de Resolume (64 bits). Son programas (.dll) que se ejecutan en tu equipo, cada uno en un proceso aparte: si uno falla, LumaMap sigue. Usa solo plugins de autores de confianza."),
      res.auto.length || res.user.length ? null : hint("No hay carpetas de plugins de Resolume en este equipo (Documentos\\Resolume Arena\\Extra Effects). Añade la carpeta donde tengas tus .dll."),
      h("div", { class: "list" }, ...res.auto.map(d => folder(d, false)), ...res.user.map(d => folder(d, true))),
      h("div", { class: "list" }, ...ok.map(r => h("div", { class: "item plug" },
        h("div", { class: "name" }, `${r.info.type === "source" ? "🎬" : "✨"} ${r.info.name}`,
          h("small", {}, `${TYPE[r.info.type]} · FFGL ${r.info.apiMajor}.${r.info.apiMinor} · ${r.info.params.length} parámetro${r.info.params.length === 1 ? "" : "s"} · ${base(r.file)}`),
          r.info.description ? h("small", { class: "desc" }, r.info.description) : null),
        h("div", { class: "acts" }, btn({ label: "Usar en la superficie seleccionada", kind: "small primary", disabled: !app.lookSel(), onClick: () => use(r) }))))),
      bad.length ? h("details", { class: "fold" }, h("summary", {}, `No se pueden usar (${bad.length})`),
        h("div", { class: "list" }, ...bad.map(r => h("div", { class: "item plug" },
          h("div", { class: "name" }, `⚠ ${base(r.file)}`, h("small", { class: "desc" }, r.error)))))) : null,
      res.plugins.length ? null : hint(res.auto.length || res.user.length ? "No hay plugins .dll en estas carpetas." : ""),
      h("div", { class: "row" },
        btn({ label: "Buscar otra vez", ic: "restart", kind: "wide", onClick: () => load(true) }),
        btn({ label: "Añadir carpeta…", ic: "folder", kind: "wide", onClick: async () => { await F.addFolder(); load(true); } })),
      status?.renderer ? hint(`OpenGL: ${status.renderer}`) : null);
  };

  const load = async (force) => {
    try {
      const st = await F.status();
      if (!st.host) {
        body.replaceChildren(hint(st.platform === "win32" ? "Falta el anfitrión de plugins FFGL (ffglhost.exe) en esta instalación: reinstala LumaMap." : ONLY_WINDOWS));
        return;
      }
      if (force || !lastScan) { body.replaceChildren(hint("Buscando y probando plugins…")); lastScan = await F.scan(); }
      draw(lastScan, { renderer: lastScan.plugins.find(r => r.ok)?.info.gl?.renderer });
    } catch (e) { body.replaceChildren(hint("No se pudieron buscar los plugins: " + cleanError(e))); }
  };
  load(false);
  return box;
}

/** Controles de la superficie que usa un plugin FFGL (panel Contenido). */
export function ffglControls(app, src) {
  const name = src.ffglName || base(src.ffglPath || "");
  if (!ffglAvailable()) return section(`🎛 ${name}`, hint(ONLY_WINDOWS + " En este dispositivo esta superficie se queda vacía."));
  const P = (src.ffglParams ||= {});
  const set = (i, v) => app.edit(() => { P[i] = v; });
  const val = (p) => P[p.index] ?? p.default;

  // Estado en vivo: fps, tamaño y errores (el plugin corre aparte y puede fallar).
  const live = h("p", { class: "hint" }, "Abriendo el plugin…");
  const retry = btn({ label: "Reintentar", ic: "restart", kind: "small", onClick: () => { ffglRetry(src.ffglPath); live.textContent = "Abriendo el plugin…"; } });
  retry.style.display = "none";
  const tick = () => {
    if (!live.isConnected) { clearInterval(timer); return; }
    const st = ffglStatus(src.ffglPath);
    const s = app.surf(), { w, h: hh } = ffglSize(s ? surfaceAspect(s).aspect : undefined);
    if (st?.error) { live.textContent = "⚠ " + st.error; retry.style.display = ""; }
    else if (src.ffglKind === "effect" && !src.ffglInput) { live.textContent = "Elige abajo qué imagen procesa el efecto."; retry.style.display = "none"; }
    else if (st?.info) { live.textContent = `${st.fps || 0} fotogramas/s · hasta ${w}×${hh} · ${st.info.gl?.renderer || ""}`; retry.style.display = "none"; }
  };
  const timer = setInterval(tick, 1000);
  setTimeout(tick, 50);

  const ctl = (src.ffglParamInfo || []).filter(p => !p.hidden).map(p => {
    const label = p.name;
    switch (p.type) {
      case "bool": return toggle({ label, value: val(p) >= 0.5, onChange: (v) => set(p.index, v ? 1 : 0) });
      case "event": return btn({ label: `${label} (disparar)`, kind: "block", onClick: () => { set(p.index, 1); setTimeout(() => set(p.index, 0), 120); } });
      case "option": return h("div", {}, h("div", { class: "lbl" }, label),
        h("div", { class: "chips" }, ...(p.options || []).map(o => h("button", { class: `chip ${val(p) === o.value ? "on" : ""}`, onclick: (ev) => {
          ev.currentTarget.parentNode.querySelectorAll(".chip").forEach(c => c.classList.remove("on"));
          ev.currentTarget.classList.add("on");
          set(p.index, o.value);
        } }, o.name))));
      case "text": case "file": {
        const inp = h("input", { type: "text", class: "text-in", value: String(val(p) ?? ""), placeholder: p.type === "file" ? "Ruta del archivo" : "" });
        inp.addEventListener("change", () => set(p.index, inp.value));
        return h("label", {}, h("div", { class: "lbl" }, label), inp);
      }
      case "buffer": return hint(`${label}: datos de audio (FFT) del plugin — EN DESARROLLO (LumaMap aún no se los envía).`);
      case "integer": return slider({ label, min: p.min, max: p.max, step: 1, value: val(p), def: p.default, fmt: (v) => String(Math.round(v)), onInput: (v) => set(p.index, Math.round(v)) });
      default: return slider({ label, min: p.min, max: p.max, step: (p.max - p.min) / 200 || 0.01, value: val(p), def: p.default, fmt: (v) => (+v).toFixed(2), onInput: (v) => set(p.index, v) });
    }
  });

  // Efectos: qué imagen procesan (un video o foto de la biblioteca, o la cámara).
  let input = null;
  if (src.ffglKind === "effect") {
    const media = app.S.project.media.filter(m => (m.kind === "video" || m.kind === "image") && !m.pending);
    const b = src.ffglInput;
    const pick = (v) => app.edit(() => { src.ffglInput = v; app.renderPanel(); });
    input = h("div", {}, h("div", { class: "lbl" }, "Imagen que procesa el efecto"),
      h("div", { class: "chips" },
        h("button", { class: `chip ${b?.kind === "camera" ? "on" : ""}`, onclick: () => pick({ kind: "camera" }) }, "📷 Cámara"),
        ...media.map(m => h("button", { class: `chip ${b?.kind === "media" && b.id === m.id ? "on" : ""}`, onclick: () => pick({ kind: "media", id: m.id }) }, `🎞 ${m.name}`))),
      media.length ? null : hint("Importa un video o una foto para procesarlo con el efecto, o usa la cámara."));
  }

  return section(`🎛 ${name}`,
    hint(`Plugin FFGL de Resolume (${src.ffglKind === "effect" ? "efecto" : "fuente"}) · ${base(src.ffglPath || "")}`),
    h("div", { class: "row" }, live, retry),
    input,
    slider({ label: "Velocidad del tiempo", min: 0, max: 4, step: 0.05, value: src.speed ?? 1, def: 1, fmt: (v) => v.toFixed(2) + "×", onInput: (v) => app.edit(() => { src.speed = v; }) }),
    ...ctl);
}
