// web/js/ai/analyzer.js
// AI PROJECT ANALYZER: revisa el proyecto con reglas (funciona SIN IA) y da
// problemas, recomendaciones, una puntuación por área (HEALTH SCORE) y el
// «siguiente paso más importante». Cada problema puede traer un arreglo
// propuesto (una acción de la lista blanca, que el usuario aplica o no).
//
// issue = { id, area, level: "error"|"warn"|"info", title, text, fix?, priority }
// fix   = { action, parameters, label } | { tab, label } | { lesson, label }

export const AREAS = [
  ["mapping", "Mapping"], ["performance", "Rendimiento"], ["media", "Medios"], ["output", "Salida"],
  ["lighting", "Luces"], ["interactive", "Interactivo"],
];
const PENALTY = { error: 35, warn: 15, info: 5 };

export function analyzeProject(ctx) {
  const out = [];
  const add = (o) => out.push({ priority: 50, ...o });
  const S = ctx.surfaces, visible = S.filter(s => !s.hidden);

  // ---------------- Mapping ----------------
  if (!S.length) add({ id: "no-surfaces", area: "mapping", level: "error", priority: 100, title: "Aún no hay superficies",
    text: "Crea la primera superficie (la zona donde se proyecta) y ajusta sus esquinas a la pared u objeto.", fix: { action: "create_surface", parameters: { shape: "rect" }, label: "Crear una superficie" } });
  const calibOnly = visible.filter(s => s.content.kind === "calibration");
  if (calibOnly.length) add({ id: "calib-content", area: "mapping", level: "info", priority: 70, title: `${calibOnly.length === 1 ? "Una superficie muestra" : calibOnly.length + " superficies muestran"} solo el patrón de calibración`,
    text: "El patrón sirve para ajustar las esquinas. Cuando estén bien, ponle contenido (animación, video, imagen…).",
    fix: { action: "set_animation", parameters: { surface: calibOnly[0].id, name: "Plasma eléctrico" }, label: `Poner una animación en «${calibOnly[0].name}»` }, surface: calibOnly[0].id });
  const empty = visible.filter(s => s.content.kind === "none");
  if (empty.length) add({ id: "empty-surface", area: "mapping", level: "warn", priority: 75, title: `Hay ${empty.length} superficie(s) sin contenido`, text: `«${empty[0].name}» no muestra nada.`, fix: { tab: "content", label: "Elegir contenido", surface: empty[0].id } });
  if (S.length && !visible.length) add({ id: "all-hidden", area: "mapping", level: "error", priority: 95, title: "Todas las superficies están ocultas", text: "No se proyecta nada: muestra al menos una superficie (Capas).", fix: { tab: "layers", label: "Abrir Capas" } });
  if (S.length >= 3 && !S.some(s => s.mask)) add({ id: "no-masks", area: "mapping", level: "info", priority: 30, title: `Tu proyecto tiene ${S.length} superficies y ninguna máscara`,
    text: "Si hay puertas, ventanas o muebles dentro de la zona proyectada, crea máscaras antes de poner el contenido definitivo.", fix: { lesson: 2, label: "Aprender a hacer máscaras" } });

  // ---------------- Medios ----------------
  const missing = S.filter(s => s.content.kind === "missing");
  if (missing.length) add({ id: "missing-media", area: "media", level: "error", priority: 90, title: "Una escena usa un recurso que no existe",
    text: `«${missing[0].name}» apunta a un archivo que ya no está en el proyecto. Vuelve a cargarlo o elige otro contenido.`, fix: { action: "load_media", parameters: { surface: missing[0].id }, label: "Elegir otro archivo" } });
  const W = ctx.project.width, H = ctx.project.height;
  const big = ctx.media.filter(m => m.kind === "video" && m.used && m.width * m.height > W * H * 2.2);
  if (big.length) add({ id: "big-video", area: "media", level: "warn", priority: 55, title: `Video más grande que la salida: «${big[0].name}»`,
    text: `El video es ${big[0].width}×${big[0].height} y la salida ${W}×${H}: gasta GPU y memoria sin ganar nitidez. Recomendación: usar una versión optimizada (en Windows, al importarlo de nuevo se optimiza solo).`, fix: { tab: "content", label: "Ver contenido" } });
  const unused = ctx.media.filter(m => !m.used);
  if (unused.length >= 3) add({ id: "unused-media", area: "media", level: "info", priority: 10, title: `${unused.length} archivos sin usar`, text: "Ocupan espacio en el proyecto. Puedes quitarlos desde la biblioteca de medios." });

  // ---------------- Rendimiento ----------------
  const pf = ctx.performance;
  if (pf && pf.seconds >= 3) {
    if (pf.fps < pf.refreshHz * 0.6) add({ id: "low-fps", area: "performance", level: "warn", priority: 60, title: `Va lento: ${pf.fps} fps en el editor (pantalla a ${pf.refreshHz} Hz)`,
      text: "Baja la calidad de la vista previa del editor (la salida al proyector no cambia), usa videos del tamaño de la salida y quita efectos pesados.",
      fix: pf.previewScale > 0.5 ? { action: "set_preview", parameters: { scale: pf.previewScale > 0.75 ? 0.75 : 0.5 }, label: "Bajar la vista previa" } : { tab: "perf", label: "Ver rendimiento" } });
    const dropped = pf.videos.filter(v => v.dropped > 30);
    if (dropped.length) add({ id: "dropped-video", area: "performance", level: "warn", priority: 58, title: `El video «${dropped[0].name}» pierde fotogramas`, text: "Suele ser un video demasiado grande o con un códec pesado. Optimízalo o baja su resolución.", fix: { tab: "perf", label: "Ver rendimiento" } });
  }

  // ---------------- Salida ----------------
  const outOpen = ctx.output.windowsOpen.length || ctx.output.projectingHere || ctx.output.external;
  if (visible.length && !outOpen) add({ id: "no-output", area: "output", level: "warn", priority: 80, title: "Hay superficies pero ninguna salida abierta",
    text: "Abre la salida y llévala al proyector a pantalla completa para ver el mapping en la pared.", fix: { action: "open_output", parameters: { screen: 1 }, label: "Abrir la salida" } });
  const offScreens = ctx.output.screens.filter(s => !s.on && visible.some(v => v.screen === s.n));
  if (offScreens.length) add({ id: "screen-off", area: "output", level: "warn", priority: 65, title: `La pantalla P${offScreens[0].n} está apagada`, text: "Tiene superficies asignadas pero no se ve nada por ella.", fix: { action: "set_output", parameters: { screen: offScreens[0].n, on: true }, label: `Encender P${offScreens[0].n}` } });
  if (ctx.show.blackout) add({ id: "blackout-on", area: "output", level: "warn", priority: 85, title: "El apagón está activo", text: "Todo sale en negro.", fix: { action: "blackout", parameters: { on: false }, label: "Quitar el apagón" } });

  // ---------------- Luces ----------------
  const L = ctx.dmx;
  if (L.lights) {
    if (L.enabled && L.desktop && !L.network) add({ id: "dmx-virtual", area: "lighting", level: "warn", priority: 50, title: "Las luces están en modo práctica",
      text: "PLAY está activo pero ningún universo va a la red: solo se ven en el escenario. Conecta el nodo en Luces → 1 · Conectar.", fix: { tab: "lights", label: "Conectar luces" } });
    if (L.network && L.desktop && !L.nodesOnline) add({ id: "dmx-no-node", area: "lighting", level: "info", priority: 35, title: "Ningún nodo Art-Net ha respondido",
      text: "Si tus nodos son sACN o no responden a la búsqueda es normal. Si no encienden, revisa el cable de red y la IP del nodo.", fix: { tab: "lights", label: "Ver luces" } });
    const lost = L.pixelMaps.filter(p => p.lost > 0);
    if (lost.length) add({ id: "dmx-lost", area: "lighting", level: "error", priority: 60, title: `«${lost[0].name}»: ${lost[0].lost} LED sin canal DMX`, text: "No caben en el universo: activa AUTO SPAN para que sigan en el siguiente.", fix: { tab: "lights", label: "Revisar el parcheo" } });
    if (!L.enabled) add({ id: "dmx-stopped", area: "lighting", level: "info", priority: 25, title: "Tienes luces pero la salida de luces está detenida", text: "Pulsa PLAY LUCES cuando quieras que se enciendan.", fix: { action: "lights_play", parameters: { on: true }, label: "PLAY luces" } });
  }

  // ---------------- Interactivo / tracking ----------------
  const I = ctx.interactive;
  if (I.surfaces && !I.calibrated) add({ id: "interactive-uncalibrated", area: "interactive", level: "warn", priority: 55, title: "La cámara interactiva no está alineada con la proyección",
    text: "Sin alinear, el efecto no sale justo donde está la persona. Usa «Alinear automáticamente» en Interactivo.", fix: { tab: "interactive", label: "Alinear la cámara" } });
  if (ctx.tracking.rules && !ctx.tracking.running) add({ id: "rules-idle", area: "interactive", level: "warn", priority: 45, title: `Hay ${ctx.tracking.rules} regla(s) interactiva(s) pero la detección está apagada`,
    text: "Las reglas solo se disparan con la detección de personas en marcha.", fix: { action: "start_tracking", parameters: {}, label: "Activar la detección" } });

  // ---------------- Audio ----------------
  if ((ctx.audio.react || S.some(s => s.audioReactive)) && !ctx.audio.micOn) add({ id: "audio-off", area: "performance", level: "info", priority: 40, title: "El audio reactivo está activado pero el micrófono no",
    text: "Sin micrófono, el ritmo sigue al BPM fijo. Actívalo en Audio para que reaccione a la música real.", fix: { tab: "audio", label: "Abrir Audio" } });

  out.sort((a, b) => b.priority - a.priority);
  return { issues: out, scores: scoresOf(ctx, out) };
}

/** HEALTH SCORE por área (0-100) y total. Las áreas que no se usan no cuentan para el total. */
export function scoresOf(ctx, issues) {
  const used = {
    mapping: true, performance: !!ctx.performance, media: ctx.media.length > 0, output: ctx.surfaces.length > 0,
    lighting: ctx.dmx.lights > 0, interactive: ctx.interactive.surfaces > 0 || ctx.tracking.rules > 0,
  };
  const sc = {};
  for (const [k] of AREAS) {
    const pen = issues.filter(i => i.area === k).reduce((a, i) => a + PENALTY[i.level], 0);
    sc[k] = used[k] ? Math.max(0, 100 - pen) : null;
  }
  const vals = Object.values(sc).filter(v => v !== null);
  sc.total = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 100;
  return sc;
}

/**
 * EL siguiente paso más importante (uno solo). Si no hay problemas, una
 * sugerencia útil según el estado (no inventa nada).
 */
export function nextStep(ctx, analysis = analyzeProject(ctx)) {
  const top = analysis.issues.find(i => i.level !== "info") || analysis.issues[0];
  if (top) return { title: top.title, text: top.text, fix: top.fix || null, issue: top.id };
  if (ctx.scenes.length < 2) return { title: "Tu mapping está listo", text: "Siguiente paso: crea una segunda escena para preparar cambios durante el show.", fix: { action: "create_scene", parameters: {}, label: "Crear escena" } };
  if (!ctx.dmx.lights) return { title: "Todo en orden", text: "¿Quieres sumar luces? Añade una tira LED o un foco y elige un efecto.", fix: { tab: "lights", label: "Abrir Luces" } };
  return { title: "Todo en orden", text: "El proyecto no tiene problemas. Puedes pasar al modo actuación para el show.", fix: null };
}
