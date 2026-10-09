// web/js/ai/commands.js
// Intérprete de órdenes SIN IA: convierte frases en español en acciones
// propuestas (las mismas de actions.js) o en una intención (plan de show,
// diagnóstico, lección, auto map). Nada se ejecuta aquí: solo se propone.
import * as M from "../model.js";
import { LIGHT_FX } from "../lightfx.js";
import { findExperience } from "../experiences.js";

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

  if (/(canci[oó]n|tema musical|mp3|con (la|mi) m[uú]sica)/.test(t) && /(show|proyecto|autom[aá]tic|haz|hazme|crea|monta|arma)/.test(t)) return { intent: "songshow", reply: "¡Hecho! Elige la canción y monto el show solo: escucho el tempo y sus partes (intro, subida, drop…).", actions: [] };
  if (/\bshow\b/.test(t) && /(crea|crear|haz|hacer|quiero|arma|prepara|genera)/.test(t)) return { intent: "show", reply: "Preparo un plan de show por secciones. No cambia nada hasta que lo apliques.", actions: [] };
  if (/(por qu[eé]|lento|baja velocidad|tirones|lag|va mal|no va fluido|fps)/.test(t)) return { intent: "diagnose", reply: "Reviso el rendimiento del proyecto.", actions: [] };
  if (/optimiza/.test(t)) return { intent: "optimize", reply: "Busco qué se puede optimizar.", actions: [] };
  if (/(problema|revisa|analiza|diagn[oó]stico|detecta)/.test(t) && !/superficie|pared|foto|imagen/.test(t)) return { intent: "diagnose", reply: "Analizo el proyecto.", actions: [] };
  if (/(proyectar sobre|detecta|analiza|reconoce).*(pared|superficie|fachada|foto|imagen|objeto)|auto ?map/.test(t)) return { intent: "automap", reply: "Perfecto. Primero vamos a detectar la superficie: elige una foto de la pared (o activa la cámara).", actions: [] };
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
  else if (/apag[oó]n|apaga todo|todo a negro/.test(t)) actions.push(A("blackout", { on: true }));
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
