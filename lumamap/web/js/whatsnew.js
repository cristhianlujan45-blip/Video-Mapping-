// web/js/whatsnew.js
// «✨ Novedades»: lo nuevo de esta versión, cada cosa con su botón «Abrir» que lleva justo ahí.
// Sale sola una vez después de actualizar (no la primera vez que se usa LumaMap: allí está la
// bienvenida) y siempre desde ☰ → Novedades, la paleta de comandos o el botón «Nodos».
// Así lo nuevo no queda escondido al fondo de una pestaña.
import { h, btn, dialog, closeDialog, hint, toast } from "./ui.js";
import { openExport } from "./panels-export.js";

/** Cambia cuando hay novedades nuevas que enseñar. */
export const NEWS_REV = "2026-10-19";
const SEEN_KEY = "lumamap:newsSeen";
const store = () => { try { return globalThis.localStorage || null; } catch { return null; } };
// ¿Ya se había usado LumaMap en este equipo? Se mira al cargar, antes de que la app guarde nada.
const RETURNING = (() => { try { const s = store(); if (!s) return false; for (let i = 0; i < s.length; i++) if (String(s.key(i)).startsWith("lumamap:")) return true; } catch {} return false; })();

/** Abre una pestaña y lleva a la sección cuyo título contiene `text` (resaltada un momento). */
export function goToSection(app, tab, text) {
  if (app.S.tab !== tab) app.openTab(tab);   // (tocar la pestaña abierta la cerraría)
  let tries = 0;
  const find = () => {
    const el = [...document.querySelectorAll("#panelBody .sec h3, #panelBody details > summary")].find(x => x.textContent.includes(text));
    if (!el) { if (++tries < 60) return setTimeout(find, 100); return toast(`Busca «${text}» en la pestaña`, ""); }
    const box = el.closest(".sec, details") || el;
    if (box.tagName === "DETAILS") box.open = true;
    box.scrollIntoView({ block: "start", behavior: "smooth" });
    box.classList.add("flash"); setTimeout(() => box.classList.remove("flash"), 2200);
  };
  setTimeout(find, 60);
}

/** Lo nuevo, por grupos. open(app) lleva a la función. */
export function newsItems(app) {
  const live = (sub) => () => { app.S.liveSub = sub; app.openTab("live"); app.renderPanel(); };
  return [
    ["🎓 Aprender", [
      ["Tutorial interactivo con Luma", "Una guía con IA te enseña toda la herramienta con actividades: tú lo haces y Luma lo comprueba. Ocultar, saltar, repetir o elegir capítulo cuando quieras; puedes preguntarle lo que sea.", () => app.startTutorial?.()],
    ]],
    ["🔗 Como TouchDesigner", [
      ["Editor de redes de nodos", "Programa como en TouchDesigner: más de 110 operadores (imagen TOP, señales CHOP, geometría SOP, objetos 3D, materiales, texto y tablas), cables, expresiones, feedback, tu propio GLSL, instancias 3D y mover objetos 3D con la mano delante de la cámara. Con ejemplos.", () => app.openNetwork()],
      ["Redes pro: 3D, curvas y subredes", "Visor flotante con gizmo para mover, girar y escalar objetos 3D y la cámara; fotogramas clave ◆ con editor de curvas y línea de tiempo; subredes (Ctrl+G), replicador, panel de control propio, partículas, modelos 3D de archivo, audio de un archivo, MIDI/OSC In, grabar video y ventana a un proyector.", () => app.openNetwork()],
      ["Python y la IA que escribe código", "Script CHOP, Script TOP y DAT Execute en un Python propio y seguro, con editor de código (colores, números de línea, error marcado) y consola (Alt+T). «🤖 Escribir con IA» te hace el código, lo prueba y lo arregla si falla.", () => app.openNetwork()],
      ["Partículas en la GPU y GLSL MAT", "Partículas → «⚡ Calcular en la GPU»: hasta un millón, con los mismos controles. Y el material GLSL: escribe cómo se ve un objeto 3D (y cómo se deforma) con tu propio shader.", () => app.openNetwork()],
      ["Salida por red desde los nodos", "Pon una «Salida por red» detrás de cualquier imagen de la red: sale por su canal MJPEG para OBS, vMix o TouchDesigner («📋 Dirección para OBS»).", () => app.openNetwork()],
      ["Cadena de cada superficie", "La vista simple: fuente → señales → efectos → forma → mezcla → salida. Toca un nodo para abrirlo.", () => app.openNodes()],
      ["Señales en vivo", "Seguir sonido, golpe, ruido, azar y suavizado, con monitor en directo; muévelas a cualquier parámetro.", () => goToSection(app, "audio", "Señales en vivo")],
      ["Mi panel", "Tu propia mesa de control con los mandos que tú elijas.", () => { live("mix")(); goToSection(app, "live", "Mi panel"); }],
      ["Salida por red", "La proyección en OBS, vMix, TouchDesigner (Web Render TOP) o un navegador.", () => goToSection(app, "output", "Salida por red")],
    ]],
    ["🎞 Show", [
      ["Línea de tiempo del show", "Todas las escenas como en un editor de video: duración arrastrando, luces por escena, saltar y reproducir.", () => goToSection(app, "scenes", "Línea de tiempo")],
      ["Exportar el show a video (hasta 4K)", "MP4 fotograma a fotograma, sin saltos, con la canción.", () => openExport(app)],
    ]],
    ["🎛 En vivo", [
      ["Mesa de clips (como Resolume)", "Lanzar clips por columnas, al golpe y con autopiloto.", live("clips")],
      ["VJ automático", "Mezcla solo al ritmo de la música con «Mi set».", live("vj")],
    ]],
    ["🧊 3D y calibración", [
      ["Objeto real con la cámara (automático)", "Pones una caja (o un cartel, la pared…): la cámara reconoce qué es, la crea en el 3D con sus medidas y coloca el proyector donde está el real.", () => goToSection(app, "3d", "Objeto real con la cámara")],
      ["Calibrar el proyector con la cámara", "El proyector muestra franjas, la cámara las ve y tocas cada esquina en la foto: la cruz va sola.", () => goToSection(app, "3d", "Alinear con el proyector real")],
    ]],
    ["🛡 Estabilidad", [
      ["Mallas que no paran el show", "Una superficie con la malla mal formada (de un proyecto viejo o roto) se repara sola al abrirla o al dibujarla, en vez de fallar en cada fotograma.", null],
      ["Protección de la tarjeta gráfica", "Si Windows reinicia el controlador, baja la resolución de los shaders y no se recarga en bucle. En Proyectar → Calidad.", () => goToSection(app, "output", "Calidad y resolución")],
    ]],
  ];
}

export function openNews(app) {
  try { store()?.setItem(SEEN_KEY, NEWS_REV); } catch {}
  const v = app.version?.() || { version: "web" };
  const body = h("div", { class: "news" },
    h("p", {}, h("b", {}, `Tienes LumaMap ${v.version}.`), " Esto es lo nuevo; toca «Abrir» para ir directo."),
    ...newsItems(app).map(([group, items]) => h("div", { class: "newsgrp" }, h("h4", {}, group),
      ...items.map(([title, desc, open]) => h("div", { class: "newsitem" },
        h("div", {}, h("b", {}, title), h("small", {}, desc)),
        open ? btn({ label: "Abrir", kind: "small primary", onClick: () => { closeDialog(); open(); } }) : null)))),
    hint("Si no ves algo de esto, comprueba en ☰ → «Buscar actualizaciones» que tienes la última versión."));
  return dialog({ title: "✨ Novedades", content: body, wide: true });
}

/** Al arrancar: la enseña una vez tras actualizar (espera a que no haya otra ventana abierta). */
export function maybeShowNews(app) {
  const s = store();
  let seen = null;
  try { seen = s?.getItem(SEEN_KEY); } catch {}
  if (seen === NEWS_REV) return false;
  if (!RETURNING) { try { s?.setItem(SEEN_KEY, NEWS_REV); } catch {} return false; }   // primera vez: la bienvenida basta
  let tries = 0;
  const tryOpen = () => {
    if (document.querySelector("#modal.show") || document.body.classList.contains("perfmode")) { if (++tries < 60) setTimeout(tryOpen, 1000); return; }
    openNews(app);
  };
  setTimeout(tryOpen, 2500);
  return true;
}
