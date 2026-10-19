// web/js/experiences.js
// Biblioteca de EXPERIENCIAS interactivas listas: cada una junta el efecto (que
// reacciona a la silueta de la gente que ve la IA), las reacciones (reglas de
// tracking: alguien entra, levanta la mano, salta…), las luces y, si hace falta,
// tus videos. Un toque y está montada; luego todo se puede cambiar a mano.
import * as M from "./model.js";
import { findFx, defaultLightFx } from "./lightfx.js";
import { calibOf } from "./interactive.js";

const rule = (name, signal, op, value, then, otherwise = null, cooldown = 1) => ({ name, signal, op, value, then, otherwise, cooldown });
const lights = (name) => ({ type: "lightfx", fx: findFx(name)?.id || findFx("Arcoíris")?.id });

export const EXPERIENCES = [
  { id: "lago", emoji: "🌊", name: "Lago mágico", cat: "Suelo", desc: "Agua de verdad: cada paso hace ondas que rebotan", mode: "agua", color: "#1a8cf0", color2: "#06203f",
    lights: "Océano", rules: [rule("Al entrar alguien → luces de olas", "presence", "above", 0.5, lights("Ondas en el agua"), lights("Océano"))] },
  { id: "koi", emoji: "🐟", name: "Estanque de peces koi", cat: "Suelo", desc: "Peces que nadan y huyen de tus pies", mode: "koi", lights: "Océano" },
  { id: "pista", emoji: "💃", name: "Pista de baile", cat: "Fiesta", desc: "Baldosas que se encienden al pisar; con 2 personas, fiesta", mode: "baldosas", gen: "rainbow", lights: "Disco",
    rules: [rule("Con dos personas → luces de fiesta", "people", "above", 0.375, lights("Mezcla de fiesta (cambia con el tempo)"), lights("Disco"))] },
  { id: "fuegos", emoji: "🎆", name: "Fuegos artificiales al saltar", cat: "Fiesta", desc: "Al moverte rápido salen fuegos y destellan las luces", mode: "fuegos", gen: "rainbow",
    rules: [rule("Al saltar o correr → destello", "speed", "above", 0.5, lights("Destellos al azar"), lights("Centelleo de colores"))] },
  { id: "pintar", emoji: "🌈", name: "Pinta con tu cuerpo", cat: "Pared", desc: "Tinta de colores que tu cuerpo arremolina", mode: "fluido", lights: "Arcoíris lento" },
  { id: "estrellas", emoji: "✨", name: "Eres polvo de estrellas", cat: "Pared", desc: "Tu silueta hecha de chispas con estela", mode: "polvo", lights: "Estrellas" },
  { id: "niebla", emoji: "🌫", name: "Niebla mágica", cat: "Pared", desc: "La niebla se aparta y deja ver el cielo", mode: "niebla", color: "#7a2cff", lights: "Aurora boreal" },
  { id: "otono", emoji: "🍂", name: "Bosque de otoño", cat: "Suelo", desc: "Las hojas salen volando al pasar", mode: "hojas", lights: "Atardecer" },
  { id: "jardin", emoji: "🌸", name: "Jardín de pétalos", cat: "Suelo", desc: "Pétalos que se apartan a tu paso", mode: "petalos", lights: "Bosque" },
  { id: "futbol", emoji: "⚽", name: "Fútbol gigante", cat: "Juegos", desc: "Patea la pelota proyectada", mode: "pelota" },
  { id: "burbujas", emoji: "🫧", name: "Revienta las burbujas", cat: "Juegos", desc: "Burbujas de jabón: tócalas con la mano o el cuerpo y revientan (suena «pop» y cuenta)", mode: "burbujas_pro", color: "#4fc3ff", color2: "#06203f",
    rules: [rule("Al entrar alguien → luces de colores", "presence", "above", 0.5, lights("Centelleo de colores"), lights("Océano"))] },
  { id: "playa", emoji: "🏖", name: "Huellas en la playa", cat: "Suelo", desc: "Arena donde se marcan tus pasos", mode: "arena", lights: "Atardecer" },
  { id: "nieve", emoji: "❄", name: "Paseo por la nieve", cat: "Suelo", desc: "Pisadas en la nieve que brilla", mode: "nieve", lights: "Hielo" },
  { id: "laser", emoji: "⚡", name: "Rayos láser a las personas", cat: "Fiesta", desc: "Rayos que te siguen y luces de estrobo", mode: "laser", gen: "plasma",
    rules: [rule("Con los brazos abiertos → estrobo", "spread", "above", 0.6, lights("Estrobo al tempo"), lights("Neón rosa y azul"))] },
  { id: "neon", emoji: "👻", name: "Sombra de neón", cat: "Pared", desc: "Un contorno de luz alrededor del cuerpo", mode: "contorno", gen: "plasma" },
  // Con tus videos
  { id: "video-entrar", emoji: "🎬", name: "Al entrar alguien, empieza tu video", cat: "Con tus videos", desc: "Sin gente: animación tranquila; al llegar alguien: tu video desde el principio", mode: "silueta", gen: "aurora", video: true,
    rules: [rule("Al entrar alguien → tu video", "presence", "above", 0.5, { type: "video", mediaId: "$video", surface: "$surface" }, { type: "anim", surface: "$surface", name: "$calm" }, 2)] },
  { id: "video-mano", emoji: "🙋", name: "Levanta la mano: siguiente video", cat: "Con tus videos", desc: "Cada vez que alguien levanta la mano cambia al siguiente de tus videos", mode: "silueta", gen: "rainbow", video: true,
    rules: [rule("Mano levantada → siguiente video", "hands_up", "above", 0.5, { type: "video", mediaId: "next", surface: "$surface" }, null, 2)] },
  { id: "bienvenida", emoji: "🚪", name: "Bienvenida: se enciende al llegar", cat: "Con tus videos", desc: "La Pantalla 2 se enciende cuando alguien se acerca y se apaga al irse", mode: "estela", gen: "aurora",
    rules: [rule("Al acercarse → Pantalla 2 ON", "presence", "above", 0.5, { type: "screen", target: "screen:2", on: true }, { type: "screen", target: "screen:2", on: false }, 1)] },
];
export const EXPERIENCE_CATS = [...new Set(EXPERIENCES.map(e => e.cat))];

/**
 * Monta una experiencia. opts.surface: superficie donde va (si no, una a pantalla
 * completa llamada «Interactivo»). Devuelve un texto de lo que hizo.
 */
export function applyExperience(app, exp, opts = {}) {
  const P = app.S.project, sc = M.currentScene(P), cal = calibOf(P);
  let s = opts.surface || P.surfaces.find(x => sc.looks[x.id]?.source.type === "body");
  if (!s) { s = M.createQuad({ name: "Interactivo", corners: M.rectCorners(0, 0, P.width, P.height) }); M.addSurface(P, s, { type: "body" }); }
  const look = M.lookOf(sc, s.id);
  look.source = { ...look.source, type: "body", bodyMode: exp.mode, gen: exp.gen || look.source.gen || "rainbow", camId: cal.camId || "", ...(exp.color ? { color: exp.color } : {}), ...(exp.color2 ? { color2: exp.color2 } : {}) };
  look.hidden = false;
  // Reacciones: las de esta experiencia sustituyen a las de otra experiencia anterior.
  const T = P.settings.tracking;
  T.rules = T.rules.filter(r => !r.experience);
  const video = P.media.find(m => m.kind === "video");
  const calm = M.ANIM_LIBRARY.find(a => a.gen === (exp.gen || "aurora"))?.name || M.ANIM_LIBRARY[0].name;
  const fill = (a) => a && JSON.parse(JSON.stringify(a).replaceAll('"$surface"', JSON.stringify(s.id)).replaceAll('"$video"', JSON.stringify(video?.id || "")).replaceAll('"$calm"', JSON.stringify(calm)));
  for (const r of exp.rules || []) T.rules.push({ id: M.uid("rule"), enabled: true, experience: exp.id, ...r, then: fill(r.then), otherwise: fill(r.otherwise) });
  if ((exp.rules || []).length) app.tracking?.ensure(T.camId || cal.camId || "default");
  // Luces: si hay luces, se ponen con el efecto de la experiencia.
  const lf = exp.lights && findFx(exp.lights);
  const L = app.dmx?.lights?.() || [];
  if (lf && L.length) for (const l of L) { l.source = "effect"; l.fx = defaultLightFx(lf.id); }
  app.select?.(s.id);
  app.changed?.({ panel: true }); app.commit?.();
  const notes = [];
  if (exp.video && !video) notes.push("importa un video (Contenido → Video) para que lo use");
  if (lf && !L.length) notes.push("si añades luces, harán «" + lf.name + "»");
  return `${exp.emoji} ${exp.name} lista en «${s.name}»${notes.length ? " · " + notes.join(" · ") : ""}`;
}

/** Busca una experiencia por texto («suelo de agua», «fútbol», «polvo de estrellas»…). */
export function findExperience(text) {
  const t = String(text || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const keys = { lago: /agua|lago|ondas|charco|piscina/, koi: /pez|peces|koi|estanque/, pista: /pista|baile|bailar|discoteca|baldosa/, fuegos: /fuegos|artificial/,
    pintar: /pintar|pinta|fluido|tinta/, estrellas: /polvo|estrella|chispa/, niebla: /niebla|humo/, otono: /hoja|otono/, jardin: /petalo|flor|jardin/,
    futbol: /futbol|pelota|balon/, burbujas: /burbuja/, playa: /arena|playa/, nieve: /nieve/, laser: /laser|rayo/, neon: /sombra|neon|contorno/,
    "video-entrar": /(entr|lleg).*video|video.*(entr|lleg)/, "video-mano": /mano.*video|video.*mano/, bienvenida: /bienvenida|recepcion/ };
  for (const [id, re] of Object.entries(keys)) if (re.test(t)) return EXPERIENCES.find(e => e.id === id);
  return null;
}
