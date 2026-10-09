// web/js/ai/commands.js
// Intérprete de órdenes SIN IA: convierte frases en español en acciones
// propuestas (las mismas de actions.js) o en una intención (plan de show,
// diagnóstico, lección, auto map). Nada se ejecuta aquí: solo se propone.
import * as M from "../model.js";
import { LIGHT_FX } from "../lightfx.js";
import { findExperience } from "../experiences.js";
import { parseRequest as parse3D } from "../gen3d.js";

export const HELP = "Puedo hacer cosas por ti. Prueba: «pon fuego en todas», «busca un gif de confeti», «hazme un show con mi canción», «escribe Feliz cumpleaños», «sube el brillo», «estilo ASCII», «luces rojas», «pon un lago interactivo», «asigna el botón A del mando al apagón», «apaga la pantalla 2», «cuando alguien entre pon mi video». Siempre te enseño qué voy a hacer y tú pulsas «Aplicar».";
/** Función de la app que nombra una frase («al apagón», «a la escena 2», «al brillo»…). */
function controlTarget(t) {
  const sc = t.match(/escena\s+(\w+)/);
  if (sc && num(sc[1])) return `scene/${num(sc[1]) - 1}`;
  if (/apag[oó]n|negro/.test(t)) return "global/blackout";
  if (/emergencia/.test(t)) return "global/emergency";
  if (/anterior|atr[aá]s/.test(t)) return "global/prev";
  if (/\bgo\b|siguiente|avanzar|pr[oó]xim/.test(t)) return "global/next";
  if (/play|pausa|reproduc/.test(t)) return "global/play";
  if (/brillo|intensidad/.test(t)) return "global/master";
  if (/azar|aleatori/.test(t)) return "global/randomAll";
  if (/\btap\b|tempo/.test(t)) return "global/tap";
  return null;
}
const STYLE_WORDS = [[/ascii/, "ascii"], [/matrix|matriz verde/, "matrix"], [/game ?boy/, "gameboy"], [/t[eé]rmica rosa/, "termicarosa"], [/t[eé]rmica|calor/, "termica"],
  [/semitono|halftone|dorad/, "oro"], [/dither/, "dither"], [/\briso\b/, "riso"], [/glifo/, "glifos"], [/n[uú]meros/, "numeros"], [/p[ií]xel/, "pixeldither"], [/polvo de estrellas/, "polvo"], [/trazo|neon trace/, "trazo"]];
const FX_WORDS = [[/glitch|fallo digital/, "glitch", 0.5], [/caleidoscopio/, "kaleido", 6], [/desenfoc|borros/, "blur", 0.4], [/pixelad/, "pixelate", 0.5], [/separaci[oó]n rgb|rgb/, "rgbShift", 0.3], [/estrobo|parpade/, "strobe", 6], [/ruido|interferencia/, "noise", 0.4], [/(que )?gire|giro|rotaci[oó]n/, "spin", 0.3], [/arco[ií]ris|cambie de color solo/, "hueCycle", 0.5]];

const COLORS = { rojo: "#ff0000", verde: "#00ff00", azul: "#0000ff", amarillo: "#ffff00", blanco: "#ffffff", negro: "#000000",
  morado: "#8000ff", violeta: "#8000ff", naranja: "#ff8000", rosa: "#ff00aa", cian: "#00e5ff", celeste: "#00e5ff", dorado: "#ffcc00" };
const NUMS = { una: 1, uno: 1, un: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };
const SHAPE_WORDS = { "rectángulo": "rect", rectangulo: "rect", "círculo": "circle", circulo: "circle", "triángulo": "triangle", triangulo: "triangle",
  "hexágono": "hexagon", hexagono: "hexagon", estrella: "star", rombo: "diamond", malla: "mesh", superficie: "rect", pantalla: "rect" };
const SHAPE3D_WORDS = { cubo: "cube", plano: "plane", esfera: "sphere", cilindro: "cylinder", cono: "cone", "pirámide": "pyramid", piramide: "pyramid", prisma: "prism" };
const LIGHT_WORDS = { "tira": "strip", "matriz": "matrix", "aro": "ring", "barra": "bar", "foco": "par", "par": "par", "cabeza": "moving", "móvil": "moving", "movil": "moving" };
const num = (w) => NUMS[w] ?? (Number(w) || 0);

function condition(t) {
  if (/mano izquierda/.test(t) && /(levant|sub|alz)/.test(t)) return { signal: "left_hand_up", op: "above", value: 0.5 };
  if (/mano derecha/.test(t) && /(levant|sub|alz)/.test(t)) return { signal: "right_hand_up", op: "above", value: 0.5 };
  if (/(levant|sub|alz)\w* (la |una |las )?mano/.test(t)) return { signal: "hands_up", op: "above", value: 0.5 };
  if (/abr\w* (los )?brazos/.test(t)) return { signal: "spread", op: "above", value: 0.6 };
  const p = t.match(/(?:haya|hay|entren|est[eé]n)\s+(\w+)\s+personas/);
  if (p && num(p[1])) return { signal: "people", op: "above", value: Math.max(0, num(p[1]) * 0.25 - 0.125) };
  if (/(se acerque|est[eé] cerca)/.test(t)) return { signal: "distance", op: "above", value: 0.6 };
  if (/(salte|corra|se mueva r[aá]pido|bail)/.test(t)) return { signal: "speed", op: "above", value: 0.5 };
  if (/(no haya nadie|se vaya|salga)/.test(t)) return { signal: "presence", op: "below", value: 0.5 };
  if (/(alguien|una persona|entre|aparezca)/.test(t)) return { signal: "presence", op: "above", value: 0.5 };
  return null;
}
/** «pantalla 2», «todas las pantallas» → destino de tiempos. */
function screenTarget(t) {
  if (/todas las pantallas|las pantallas/.test(t)) return "screens";
  const m = t.match(/pantalla\s+(\w+)/);
  const n = m && num(m[1]);
  return n >= 1 && n <= 4 ? `screen:${n}` : null;
}
function ruleAction(t) {
  const st = screenTarget(t);
  if (st && /(enciend|prend|activa|muestra)/.test(t)) return { type: "screen", target: st, on: true };
  if (st && /(apag|desactiva|oculta)/.test(t)) return { type: "screen", target: st, on: false };
  if (/(video|v[ií]deo)/.test(t) && /(pon|empie|reproduc|arranc|lanza|sale)/.test(t)) {
    const v = (globalThis.__lumaApp?.S.project.media || []).find(m => m.kind === "video" && t.includes(m.name.toLowerCase().replace(/\.[a-z0-9]+$/, ""))) || (globalThis.__lumaApp?.S.project.media || []).find(m => m.kind === "video");
    if (v) return { type: "video", mediaId: v.id, surface: "all" };
  }
  const lf = LIGHT_FX.slice().sort((a, b) => b.name.length - a.name.length).find(f => t.includes(f.name.toLowerCase()));
  if (/luz|luces/.test(t) && lf) return { type: "lightfx", fx: lf.id };
  if (/(siguiente|pr[oó]xima) escena/.test(t)) return { type: "scene", index: "next" };
  const sc = t.match(/escena\s+(\w+)/);
  if (sc && num(sc[1])) return { type: "scene", index: num(sc[1]) - 1 };
  if (/apag[oó]n|apaga todo/.test(t)) return { type: "blackout", value: true };
  const anim = M.ANIM_LIBRARY.slice().sort((a, b) => b.name.length - a.name.length).find(a => t.includes(a.name.toLowerCase()));
  if (anim) return { type: "anim", name: anim.name, surface: "all" };
  const cw = Object.keys(COLORS).find(c => new RegExp(`\\b${c}\\b`).test(t));
  if (cw) return { type: "color", color: COLORS[cw], surface: "all" };
  return null;
}

/**
 * Interpreta una orden. Devuelve { reply, actions: [{action, parameters}], intent? }.
 * intent: "show" (plan de show), "diagnose", "optimize", "automap", "lesson", "explain".
 */
export function parseCommand(app, text) {
  const raw = String(text || "").trim();
  const t = raw.toLowerCase().replace(/[¡!¿?.,]/g, " ").replace(/\s+/g, " ").trim();
  const A = (action, parameters = {}) => ({ action, parameters });

  if ((/(canci[oó]n|tema musical|mp3)/.test(t) && /(show|proyecto|autom[aá]tic|haz|hazme|crea|monta|arma)/.test(t)) || (/con (la|mi) m[uú]sica/.test(t) && /(show|proyecto|autom[aá]tic)/.test(t))) return { intent: "songshow", reply: "¡Hecho! Elige la canción y monto el show solo: escucho el tempo y sus partes (intro, subida, drop…).", actions: [] };
  if (/\bshow\b/.test(t) && /(crea|crear|haz|hacer|quiero|arma|prepara|genera)/.test(t)) return { intent: "show", reply: "Preparo un plan de show por secciones. No cambia nada hasta que lo apliques.", actions: [] };
  if (/(por qu[eé]|(va|est[aá]|anda|funciona|se ve) (muy )?lent|lentitud|baja velocidad|tirones|\blag\b|se traba|va mal|no va fluido|\bfps\b)/.test(t) && !/\bfps a\b|a \d+ fps/.test(t)) return { intent: "diagnose", reply: "Reviso el rendimiento del proyecto.", actions: [] };
  if (/optimiza/.test(t)) return { intent: "optimize", reply: "Busco qué se puede optimizar.", actions: [] };
  if (/(problema|revisa|analiza|diagn[oó]stico|detecta)/.test(t) && !/superficie|pared|foto|imagen/.test(t)) return { intent: "diagnose", reply: "Analizo el proyecto.", actions: [] };
  if (/(proyectar sobre|detecta|analiza|reconoce).*(pared|superficie|fachada|foto|imagen|objeto)|auto ?map|(mapping|mapear|mapeo|proyectar|proyecta) (de |en |sobre )?(una |la |el |mi )?(fachada|edificio|casa|iglesia)/.test(t)) return { intent: "automap", reply: "Perfecto. Primero vamos a detectar la superficie: elige una foto de la pared (o activa la cámara).", actions: [] };
  if (/holograma|\bholo\b|tupac|pepper|persona flotando/.test(t)) {
    const pn = t.match(/\b(1|2|3|4|un|uno|dos|tres|cuatro)\s+proyector/);
    return { reply: "Te abro el asistente de holograma: eliges qué aparece y cuántos proyectores, y lo monto solo (quito el fondo de la persona, uno los proyectores y te digo cómo colocarlo).",
      actions: [A("hologram_setup", { type: /pir[aá]mide/.test(t) ? "piramide" : /\b(tul|tela|gasa)\b/.test(t) ? "tul" : "escenario", n: pn ? num(pn[1]) : 1 })] };
  }
  if (/(c[oó]mo|ens[eé][ñn]ame|mu[eé]strame|aprender|tutorial|explica)/.test(t)) {
    const lesson = /m[aá]scara/.test(t) ? 2 : /malla|warp|curv/.test(t) ? 3 : /varias superficies/.test(t) ? 4 : /proyectores|blending|bordes/.test(t) ? 5 : /vj|en vivo/.test(t) ? 6 : /audio|m[uú]sica/.test(t) ? 7 : /luz|luces|dmx/.test(t) ? 8 : /interactiv|tracking|c[aá]mara/.test(t) ? 9 : /show|escena|cue/.test(t) ? 10 : /calibr|esquina|mapping|empez/.test(t) ? 1 : 0;
    return { intent: "explain", reply: lesson ? "Te lo enseño paso a paso." : "", actions: lesson ? [A("start_lesson", { level: lesson })] : [] };
  }

  // Reglas interactivas: «cuando … entonces …»
  if (/^(cuando|si)\b/.test(t)) {
    const [condPart, ...rest] = t.split(/,|\s+(?=cambia|pon|ve |pasa|haz|apaga|quita|ejecuta|lanza|siguiente|las luces|luces|enciende|prende|empieza|reproduce|arranca)/);
    const cond = condition(condPart), then = ruleAction(rest.join(" ") || t);
    if (cond && then) return { reply: "Creo esta regla interactiva:", actions: [A("create_tracking_rule", { ...cond, then })] };
    return { reply: !cond ? "No reconozco la condición. Ejemplos: «cuando levante la mano…», «cuando haya dos personas…», «cuando alguien entre…»." : "No reconozco qué hacer. Ejemplos: «…cambia el color a rojo», «…ve a la escena 2», «…luces Fuego».", actions: [] };
  }
  // Conversación: saludo, gracias y ayuda (respuesta clara, nunca «no sé»).
  const words = t.split(" ").length;
  if (/^(hola|buenas|buenos d[ií]as|hey|qu[eé] tal)\b/.test(t) && words <= 4) return { reply: "¡Hola! Dime qué quieres proyectar. " + HELP, actions: [] };
  if (/^(gracias|genial|perfecto|ok|vale|listo|muy bien)\b/.test(t) && words <= 4) return { reply: "¡Con gusto! Pídeme lo siguiente cuando quieras.", actions: [] };
  if (/^(ayuda|help|men[uú])$|qu[eé] (puedes|puedo|sabes) hacer|qu[eé] haces|para qu[eé] sirves/.test(t)) return { reply: HELP, actions: [] };
  // GIF animados de internet.
  if (/\bgifs?\b/.test(t)) {
    const q = (t.match(/gifs?\s+(?:animados?\s+)?(?:de|del|con|sobre)?\s*(?:un|una|unos|unas|el|la|los|las)?\s*(.+?)(?:\s+(?:en|para|sobre)\s+(?:la|el|las|los|todas?|todo)\b.*)?$/) || [])[1] || "";
    return { reply: "Busco GIF animados; tú eliges cuál entra en la proyección:", actions: [A("search_gif", { query: q.trim() })] };
  }
  // Mandos, teclado y MIDI: «asigna el botón A del mando al apagón».
  if (/\b(bot[oó]n|tecla|mando|joystick|gatillo|knob|fader|pad|controlador|control de (xbox|play))\b|\b(xbox|playstation|play ?station|ps4|ps5|dualsense|gamepad)\b/.test(t) && !/^(cuando|si)\b/.test(t)) {
    const tg = /(asign|map|vincul|configur|que (haga|sea|controle)|para (el|la|que)|\bal\b|\ba la\b)/.test(t) ? controlTarget(t.replace(/bot[oó]n\s+\w+/, "")) : null;
    if (tg) return { reply: "Asigno un botón: después de «Aplicar» pulsa el botón del mando, la tecla o el control MIDI que quieras.", actions: [A("assign_control", { target: tg })] };
    if (/(mando|xbox|playstation|play ?station|ps4|ps5|gamepad|joystick|control de)/.test(t)) return { reply: "Te dejo el mando listo (puedes cambiar cada botón en En vivo → «Mandos, teclado y MIDI»). Puedes usar varios mandos y el teclado a la vez.", actions: [A("gamepad_map", {}), A("open_panel", { tab: "live" })] };
  }
  // Varios proyectores y hologramas: se hacen en el espacio 3D.
  // Objetos 3D: «hazme un carro», «crea un cohete 3D», «diseña un dragón en 3D».
  if (/\b(hazme|haz|crea|creame|créame|genera|diseña|disena|modela|construye|quiero|dibuja)\b/.test(t) && !/\b(cubo|esfera|cilindro|cono|plano|prisma|show|escena|superficie|regla)\b/.test(t)
    && (parse3D(t) || /\b(3d|tridimensional)\b/.test(t))) {
    const prompt = raw.replace(/^\s*(hazme|haz|crea|créame|creame|genera|diseña|disena|modela|construye|quiero|dibuja)\s+(?:(?:unos|unas|una|un|el|la)\s+)?/i, "").replace(/\s*(en\s+)?3d\b/i, "").trim() || raw;
    return { reply: "Lo creo en 3D: lo verás girar y eliges cómo proyectarlo (superficie, holograma o espacio 3D).", actions: [A("create_3d_object", { prompt })] };
  }
  if (/varios proyectores|\b(2|3|4|dos|tres|cuatro) proyectores/.test(t)) return { reply: "Para un objeto (cubo, caja…) con varios proyectores: 3D → «3 · Proyectores» → elige 2, 3 o 4 y pon las animaciones en las caras. Para una persona flotando, pide «holograma».", actions: [A("open_panel", { tab: "3d" })] };
  // Reproducción.
  if (/^(reproduce|reproducir|play|dale( al)? play|arranca|empieza|inicia|reanuda|contin[uú]a)\b/.test(t)) return { reply: "Propongo esto:", actions: [A("transport", { do: "play" })] };
  if (/^(pausa|pausar|pon pausa|det[eé]n|detener|para|parar|stop)\b/.test(t) && !/luces/.test(t)) return { reply: "Propongo esto:", actions: [A("transport", { do: "pause" })] };
  if (/(reinicia|desde el principio|vuelve a empezar)/.test(t) && /(video|todo|show|principio)/.test(t)) return { reply: "Propongo esto:", actions: [A("transport", { do: "restart" })] };
  if (/mezcla autom[aá]tica|cambie sol[oa] al ritmo|cambia sol[oa]/.test(t)) return { reply: "Propongo esto:", actions: [A("transport", { do: /(quita|sin|para|det[eé]n|apaga)/.test(t) ? "automix_off" : "automix_on" })] };
  if (/^tap\b|marca(r)? el tempo/.test(t)) return { reply: "Propongo esto:", actions: [A("transport", { do: "tap" })] };
  if (/^(siguiente|avanza|pr[oó]xim[oa])$/.test(t)) return { reply: "Propongo esto:", actions: [A("go_scene", { index: "next" })] };
  if (/(escena anterior|^anterior$|vuelve atr[aá]s|^atr[aá]s$)/.test(t)) return { reply: "Propongo esto:", actions: [A("go_scene", { index: "prev" })] };
  // Brillo general.
  if (/\bbrillo\b/.test(t) && !/luces/.test(t)) {
    const cur = app.S.master ?? 1, pc = t.match(/(\d{1,3})\s*(%|por ciento)?/);
    const v = pc ? +pc[1] / 100 : /mitad|medio/.test(t) ? 0.5 : /(m[aá]ximo|todo|completo|full|100)/.test(t) ? 1 : /(m[ií]nimo|cero|nada)/.test(t) ? 0 : /(sub|m[aá]s|aument)/.test(t) ? Math.min(1, cur + 0.2) : /(baj|menos|reduc|bajit)/.test(t) ? Math.max(0, cur - 0.2) : null;
    if (v !== null) return { reply: "Propongo esto:", actions: [A("set_brightness", { value: Math.round(Math.max(0, Math.min(1, v)) * 100) / 100 })] };
  }
  const where = /(todas|todo|todos|cada)/.test(t) || !app.S.sel ? "all" : app.S.sel;
  // Texto: «escribe Feliz cumpleaños», «pon el texto HOLA».
  const tx = raw.match(/(?:escribe|escribir|pon(?:er)? (?:el |un )?texto|texto que diga|que diga|pon que diga)\s*[:«"']?\s*(.+?)\s*[»"']?\s*$/i);
  if (tx && tx[1]) return { reply: "Propongo esto:", actions: [A("set_text", { surface: where, text: tx[1] })] };
  // Estilos (ASCII, Matrix…) y efectos visuales.
  if (/(quita|quitar|sin|borra|elimina|limpia) (el |los |todos los )?(efecto|filtro|estilo)s?/.test(t)) return { reply: "Propongo esto:", actions: [A("reset_fx", { surface: where })] };
  const sw = STYLE_WORDS.find(([re]) => re.test(t));
  if (sw && (/(estilo|efecto|filtro|look|modo|como|tipo|pon|aplica)/.test(t) || ["ascii", "gameboy", "termica", "termicarosa", "dither"].includes(sw[1])) && !/luces/.test(t)) return { reply: "Propongo esto:", actions: [A("set_style", { surface: where, style: sw[1] })] };
  const fw = FX_WORDS.find(([re]) => re.test(t));
  if (fw && /(efecto|pon|aplica|a[ñn]ade|haz|que|con)/.test(t) && !/luces|luz/.test(t) && !(fw[1] === "hueCycle" && M.ANIM_LIBRARY.some(a => t.includes(a.name.toLowerCase())))) return { reply: "Propongo esto:", actions: [A("set_fx", { surface: where, key: fw[1], value: fw[2] })] };
  // Velocidad.
  if (/(m[aá]s r[aá]pid|acelera|m[aá]s veloz)/.test(t)) return { reply: "Propongo esto:", actions: [A("set_speed", { surface: where, factor: 1.5 })] };
  if (/(m[aá]s lent|m[aá]s despacio|frena|desacelera)/.test(t)) return { reply: "Propongo esto:", actions: [A("set_speed", { surface: where, factor: 0.66 })] };
  // Cámara en vivo.
  if (/(webcam|c[aá]mara)/.test(t) && /(pon|muestra|usa|activa|ver|proyecta)/.test(t) && !/interactiv|sensor|detecta|personas/.test(t)) return { reply: "Propongo esto:", actions: [A("set_camera", { surface: where, kind: "camera" })] };
  // Grabar y patrón de calibración.
  if (/\b(graba|grabar|grabaci[oó]n|record)\b/.test(t)) return { reply: "Propongo esto:", actions: [A("record_video", {})] };
  if (/(cuadr[ií]cula|patr[oó]n|carta de ajuste|^calibra)/.test(t)) return { reply: "Propongo esto (el patrón se quita con el mismo botón):", actions: [A("test_pattern", { pattern: /(quita|sin)/.test(t) ? "none" : /blanco/.test(t) ? "white" : /barras/.test(t) ? "bars" : "grid" })] };
  // Tempo.
  const bpm = t.match(/(?:tempo|bpm|velocidad del ritmo)\D{0,6}(\d{2,3})|(\d{2,3})\s*bpm/);
  if (bpm) return { reply: "Propongo esto:", actions: [A("set_bpm", { bpm: +(bpm[1] || bpm[2]) })] };
  // Luces: encender, apagar, color y fiesta.
  if (/\b(luces|luz|focos|leds?)\b/.test(t)) {
    if (/(apaga|det[eé]n|para|quita)/.test(t)) return { reply: "Propongo esto:", actions: [A("lights_play", { on: false })] };
    const lc = Object.keys(COLORS).find(c => new RegExp(`\\b${c.replace(/o$/, "[oa]")}(es|s)?\\b`).test(t));
    if (lc && !LIGHT_FX.some(f => t.includes(f.name.toLowerCase()))) return { reply: "Propongo esto:", actions: [A("light_color", { color: COLORS[lc] }), A("lights_play", { on: true })] };
    if (/fiesta|discoteca|party/.test(t)) return { reply: "Propongo esto:", actions: [A("light_effect", { effect: "Mezcla de fiesta (cambia con el tempo)" }), A("lights_play", { on: true })] };
    if (/estrobo/.test(t)) return { reply: "Propongo esto:", actions: [A("light_effect", { effect: "Estrobo blanco" }), A("lights_play", { on: true })] };
    if (/(enciende|prende|activa)/.test(t) && !LIGHT_FX.some(f => t.includes(f.name.toLowerCase()))) return { reply: "Propongo esto:", actions: [A("lights_play", { on: true })] };
  }
  if (/modo fiesta|ambiente de fiesta|algo de fiesta|que sea una fiesta/.test(t)) return { reply: "¡Fiesta! Propongo esto:", actions: [A("transport", { do: "automix_on" }), A("light_effect", { effect: "Mezcla de fiesta (cambia con el tempo)" }), A("transport", { do: "play" })] };
  if (/(animaci[oó]n|animaciones|algo|cosas?) (al azar|aleatori|diferente|distint|nuev)|sorpr[eé]ndeme|^al azar$/.test(t)) return { reply: "Propongo esto:", actions: [A("random_animation", { surface: where })] };
  if (/(duplica|copia|clona)\w* (la |esta |una |esa )?(superficie|forma|pantalla)/.test(t)) return { reply: "Propongo esto:", actions: [A("duplicate_surface", { surface: app.S.sel || undefined })] };
  if (/proyecta (en|sobre) (un|el) (cubo|caja)/.test(t)) return { reply: "Propongo esto:", actions: [A("add_3d_object", { kind: "cube" })] };

  const actions = [];
  // Experiencias interactivas: «pon un lago interactivo», «fútbol en el suelo», «polvo de estrellas»…
  if (/(interactiv|experiencia|suelo|que reaccione|que la gente|juego)/.test(t) || /(lago|estanque|peces|pista de baile|f[uú]tbol|pelota|burbujas|polvo de estrellas|niebla|hojas|p[eé]talos|nieve|arena|l[aá]ser)/.test(t)) {
    const ex = findExperience(t);
    if (ex) return { reply: "Te monto esta experiencia interactiva (con la IA que ve a la gente):", actions: [A("interactive_experience", { name: ex.name })] };
  }
  // Pantallas por tiempos: «pantallas una tras otra cada 5 segundos», «sincroniza las pantallas»…
  if (/(pantallas|superficies)/.test(t) && /(una tras otra|en cascada|en orden|sincroniz|a la vez|al mismo tiempo|altern|turn|persecuci|tiempos)/.test(t)) {
    const ev = t.match(/cada\s+(\w+)\s*(segundos?|seg|s|minutos?|min)\b/);
    const every = ev ? (num(ev[1]) || 1) * (/^min/.test(ev[2]) ? 60 : 1) : 5;
    const template = /una tras otra|cascada|en orden/.test(t) ? "cascade" : /altern|turn/.test(t) ? "alternate" : /persecuci/.test(t) ? "chase" : "together";
    return { reply: "Preparo los tiempos (luego puedes cambiar cada paso en En vivo):", actions: [A("screen_timer", { template, every, who: /superficies/.test(t) ? "surfaces" : "screens" })] };
  }
  const stg = screenTarget(t);
  if (stg && /(enciend|prend|activa)/.test(t)) actions.push(A("screen_power", { screen: stg === "screens" ? "all" : stg.split(":")[1], on: true }));
  else if (stg && /(apag|desactiva)/.test(t)) actions.push(A("screen_power", { screen: stg === "screens" ? "all" : stg.split(":")[1], on: false }));
  if (actions.length) return { reply: "Propongo esto:", actions };
  // Música
  if (/(reaccion|al ritmo|con la m[uú]sica|con el beat|con el bajo)/.test(t)) {
    if (/luz|luces/.test(t)) actions.push(A("light_effect", { effect: /beat|golpe/.test(t) ? "Estrobo al tempo" : "Pulso de graves" }), A("lights_play", { on: true }));
    else actions.push(A("enable_audio_reactive", { surface: /todo|todas/.test(t) || !app.S.sel ? "all" : app.S.sel, band: /agudo/.test(t) ? "high" : "bass", target: /color/.test(t) ? "hue" : /tamaño|escala|zoom/.test(t) ? "scale" : "brightness" }));
  }
  // Luces
  const lf = LIGHT_FX.slice().sort((a, b) => b.name.length - a.name.length).find(f => t.includes(f.name.toLowerCase()));
  if (/luz|luces/.test(t) && lf && !actions.length) actions.push(A("light_effect", { effect: lf.name }));
  const add = t.match(/\b(?:añade|agrega|crea|pon|a[ñn]adir|agregar|crear)\s+(?:(?:una|uno|un|otra|otro|el|la)\s+)?(\S+)(?:\s+(\S+))?/);
  if (add) {
    const w = add[1], w2 = add[2] || "";
    const cnt = t.match(/(\d+)\s*(led|leds|p[ií]xeles)/);
    if (LIGHT_WORDS[w] && (/led|luz|foco|movil|móvil|par/.test(t))) actions.push(A("add_light", { kind: LIGHT_WORDS[w], ...(cnt ? { count: +cnt[1] } : {}) }));
    else if (SHAPE3D_WORDS[w] && (/3d/.test(t) || !SHAPE_WORDS[w])) actions.push(A("add_3d_object", { kind: SHAPE3D_WORDS[w] }));
    else if (SHAPE_WORDS[w]) actions.push(A("create_surface", { shape: SHAPE_WORDS[w] }));
    else if (w === "escena") actions.push(A("create_scene", {}));
    else if (w === "máscara" || w === "mascara") actions.push(A("create_mask", { surface: app.S.sel || undefined }));
    else if (w === "proyector" || w2 === "proyector" || w === "salida") actions.push(A("open_output", { screen: 1 }));
    else if (w === "video" || w === "imagen" || w === "foto") actions.push(A("load_media", {}));
  }
  if (/(carga|cargar|importa|abre)\s+(un|el|una)?\s*(video|imagen|foto)/.test(t)) actions.push(A("load_media", { surface: app.S.sel || undefined }));
  if (/(quita|fin del|sin) apag[oó]n|enciende todo/.test(t)) actions.push(A("blackout", { on: false }));
  else if (/apag[oó]n|apaga todo|todo a negro|fundido a negro|funde a negro/.test(t)) actions.push(A("blackout", { on: true }));
  if (/(siguiente|pr[oó]xima) escena/.test(t)) actions.push(A("go_scene", { index: "next" }));
  const sc = t.match(/(?:ve|ir|pasa|cambia)\s+a\s+la\s+escena\s+(\w+)/);
  if (sc && num(sc[1])) actions.push(A("go_scene", { index: num(sc[1]) - 1 }));
  const res = t.match(/(\d{3,5})\s*[x×]\s*(\d{3,5})/);
  if (res && /resoluci/.test(t)) actions.push(A("set_resolution", { width: +res[1], height: +res[2] }));
  const fps = t.match(/(\d{2})\s*fps/);
  if (fps && /salida|output|fps a|a \d+ fps/.test(t)) actions.push(A("set_fps", { fps: +fps[1] }));
  if (!actions.some(a => a.action === "light_effect" || a.action === "set_animation")) {
    const anim = M.ANIM_LIBRARY.slice().sort((a, b) => b.name.length - a.name.length).find(a => t.includes(a.name.toLowerCase()));
    if (anim && !/luz|luces/.test(t)) actions.push(A("set_animation", { surface: /todas|todo/.test(t) || !app.S.sel ? "all" : app.S.sel, name: anim.name }));
  }
  const cw = Object.keys(COLORS).find(c => new RegExp(`\\b${c}\\b`).test(t));
  if (cw && /(color|pon|cambia|pinta)/.test(t) && !/luz|luces/.test(t) && !actions.length) actions.push(A("set_color", { surface: /todas|todo/.test(t) || !app.S.sel ? "all" : app.S.sel, color: COLORS[cw] }));
  const del = /\b(?:borrar?|eliminar?|quitar?)\s+(?:la\s+)?superficie\s*(.*)$/.exec(t);
  if (del) actions.push(A("delete_surface", { surface: del[1]?.trim() || app.S.sel || undefined }));
  if (/proyector/.test(t) && /(agrega|añade|conecta|configura|abre)/.test(t) && !actions.length) actions.push(A("open_output", { screen: 1 }));

  if (actions.length) return { reply: actions.length === 1 ? "Propongo esto:" : `Propongo ${actions.length} cambios:`, actions };
  return { intent: "explain", reply: "", actions: [] };
}
