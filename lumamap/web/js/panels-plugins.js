// web/js/panels-plugins.js
// «🧩 Plugins»: los que vienen con LumaMap y los que instalas (archivo .json de plugin o
// shader ISF .fs). Encender/apagar, quitar e instalar. Ver el formato en plugins.js.
import { h, btn, hint, toggle, dialog, toast, confirmDlg } from "./ui.js";
import { listPlugins, installPlugin, setPluginEnabled, removePlugin } from "./plugins.js";

const EXAMPLE = `{
  "lumamap-plugin": 1,
  "id": "mi-pack",
  "name": "Mi pack",
  "author": "Tu nombre",
  "effects": [ { "name": "Rosa intenso", "fx": { "saturation": 1.8, "hue": 0.9 } } ],
  "animations": [ { "name": "Fuego verde", "gen": "fire", "color": "#39ff14", "color2": "#002200" } ],
  "shaders": [ { "name": "Mi shader", "isf": "/*{ \\"INPUTS\\": [] }*/ void main(){ gl_FragColor = vec4(isf_FragNormCoord, 0.5, 1.0); }" } ]
}`;

const what = (c) => [c.effects && `${c.effects} efecto${c.effects > 1 ? "s" : ""}`, c.animations && `${c.animations} animación${c.animations > 1 ? "es" : ""}`,
  c.shaders && `${c.shaders} shader${c.shaders > 1 ? "s" : ""} ISF`].filter(Boolean).join(" · ");

export async function openPlugins(app) {
  const body = h("div", { class: "plugins" });
  const draw = () => {
    const list = listPlugins();
    body.replaceChildren(
      hint("Los plugins añaden efectos (pestaña Efectos), animaciones y shaders (Contenido → Animación, categoría 🧩). Son solo datos: no ejecutan programas en tu equipo."),
      h("div", { class: "list" }, ...list.map(p => h("div", { class: "item plug" },
        h("div", { class: "name" }, `🧩 ${p.name}`, p.version ? h("small", {}, ` v${p.version}`) : null,
          h("small", {}, [p.author, what(p.counts)].filter(Boolean).join(" · ")),
          p.description ? h("small", { class: "desc" }, p.description) : null),
        h("div", { class: "acts" },
          toggle({ label: p.enabled ? "Activo" : "Apagado", value: p.enabled, onChange: (v) => { setPluginEnabled(p.id, v); app.changed({ panel: true }); draw(); } }),
          p.bundled ? h("small", { class: "dim" }, "Incluido") : btn({ label: "Quitar", kind: "small danger", onClick: async () => {
            if (!(await confirmDlg("Quitar plugin", `¿Quitar «${p.name}»? Las superficies que lo usen se quedarán sin ese contenido.`, "Quitar"))) return;
            removePlugin(p.id); app.changed({ panel: true }); draw();
          } }))))),
      btn({ label: "Instalar plugin (.json) o shader ISF (.fs)", ic: "upload", kind: "block primary", onClick: () => pick() }),
      h("details", { class: "fold" }, h("summary", {}, "Hacer tu propio plugin"),
        h("p", {}, "Un plugin es un archivo .json como este (efectos con los mismos ajustes de la pestaña Efectos, animaciones con su color, y shaders ISF):"),
        h("pre", { class: "code" }, EXAMPLE),
        h("p", {}, "Shaders ISF: sirven los generadores de una pasada (con controles de número, interruptor, lista, color o punto) de editor.isf.video, Resolume o VDMX. Los que usan imágenes de entrada, audio o varias pasadas: EN DESARROLLO.")));
  };
  const pick = () => {
    const input = h("input", { type: "file", accept: ".json,.fs,.frag,.isf,.glsl", multiple: true, style: "display:none" });
    input.addEventListener("change", async () => {
      for (const f of input.files) {
        try {
          if (f.size > 200000) throw new Error("Archivo demasiado grande para un plugin.");
          const p = installPlugin(await f.text(), f.name);
          toast(`🧩 Instalado: ${p.name} (${what({ effects: p.effects.length, animations: p.animations.length, shaders: p.shaders.length })})`);
        } catch (e) { toast(`${f.name}: ${e.message}`, "err"); }
      }
      input.remove(); app.changed({ panel: true }); draw();
    });
    document.body.append(input);
    input.click();
  };
  draw();
  await dialog({ title: "🧩 Plugins", content: body, wide: true, buttons: [{ label: "Cerrar", value: null }] });
}
