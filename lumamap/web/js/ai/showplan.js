// web/js/ai/showplan.js
// AI SHOW DIRECTOR: de «Quiero un show de 5 minutos que reaccione a la música
// con cambios de luces» a un plan por secciones (INTRO, BUILD, DROP, BREAK,
// CLIMAX, OUTRO) con duración, tempo, animación, transición, luces y audio.
// Sin IA el plan sale de reglas y de las bibliotecas reales de la app; con IA se
// pide al modelo y se valida contra esas mismas bibliotecas (nada inventado).
// Primero solo se MUESTRA el plan; aplicarlo crea escenas nuevas (no borra nada).
import * as M from "../model.js";
import { findFx } from "../lightfx.js";

export const SECTIONS = [
  { id: "INTRO", share: 0.12, energy: 0.2, cats: ["Espacio", "Abstracto"], tr: "fade", lights: "Respirar", fx: "calmo" },
  { id: "BUILD", share: 0.18, energy: 0.55, cats: ["Neón y retro", "Geométrico"], tr: "dissolve", lights: "Ola", fx: "sube" },
  { id: "DROP", share: 0.2, energy: 1, cats: ["Música ♪", "Fiesta"], tr: "flash", lights: "Estrobo al tempo", fx: "golpe" },
  { id: "BREAK", share: 0.12, energy: 0.35, cats: ["Naturaleza", "Abstracto"], tr: "fade", lights: "Océano", fx: "respiro" },
  { id: "CLIMAX", share: 0.25, energy: 1, cats: ["Virales 🔥", "Luces y show"], tr: "glitch", lights: "Mezcla de fiesta (cambia con el tempo)", fx: "máximo" },
  { id: "OUTRO", share: 0.13, energy: 0.15, cats: ["Espacio", "Naturaleza"], tr: "fade", lights: "Amanecer", fx: "final" },
];
const TRANSITIONS = ["cut", "fade", "dissolve", "wipe", "wipeV", "iris", "flash", "glitch"];

/** Lee duración (s), BPM y si pide música / luces del texto del usuario. */
export function parseBrief(text, defBpm = 120) {
  const t = String(text || "").toLowerCase();
  let secs = 180;
  const m = t.match(/(\d+(?:[.,]\d+)?)\s*(minutos?|min\b|m\b)/), s = t.match(/(\d+)\s*(segundos?|seg\b|s\b)/);
  if (m) secs = Math.round(parseFloat(m[1].replace(",", ".")) * 60);
  else if (s) secs = +s[1];
  const words = { un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, diez: 10, quince: 15, veinte: 20 };
  const w = t.match(/\b(un|una|dos|tres|cuatro|cinco|seis|siete|ocho|diez|quince|veinte)\s+minutos?/);
  if (!m && !s && w) secs = words[w[1]] * 60;
  const b = t.match(/(\d{2,3})\s*bpm/);
  return {
    seconds: Math.max(30, Math.min(3600, secs)), bpm: b ? Math.max(40, Math.min(240, +b[1])) : defBpm,
    music: /m[uú]sica|ritmo|beat|bpm|bajo|graves|audio|reaccion/.test(t), lights: /luz|luces|ilumin|dmx|led/.test(t),
  };
}

/** Plan sin IA (reglas + bibliotecas reales). */
export function planFromRules(text, ctx) {
  const b = parseBrief(text, ctx?.audio?.bpm || 120);
  const lib = M.ANIM_LIBRARY;
  let used = new Set(), t0 = 0;
  const sections = SECTIONS.map((sec, i) => {
    const seconds = i === SECTIONS.length - 1 ? b.seconds - t0 : Math.round(b.seconds * sec.share);
    t0 += seconds;
    const pool = lib.filter(a => sec.cats.includes(a.cat) && !used.has(a.name));
    const anim = (pool[(i * 3) % Math.max(1, pool.length)] || lib[i]).name;
    used.add(anim);
    return {
      name: sec.id, seconds, bars: Math.max(1, Math.round(seconds * b.bpm / 60 / 4)),
      animation: anim, transition: sec.tr, lights: b.lights || ctx?.dmx?.lights ? sec.lights : null,
      audio: b.music && sec.energy >= 0.5, effect: sec.fx, energy: sec.energy,
    };
  });
  return { title: `Show de ${Math.round(b.seconds / 60 * 10) / 10} min a ${b.bpm} BPM`, bpm: b.bpm, seconds: b.seconds, sections, source: "reglas" };
}

/** Normaliza un plan (del modelo o de reglas) contra las bibliotecas reales. */
export function normalizePlan(raw, ctx) {
  const base = planFromRules(raw?.brief || "", ctx);
  if (!raw || !Array.isArray(raw.sections) || !raw.sections.length) return base;
  const bpm = Math.max(40, Math.min(240, Math.round(+raw.bpm || base.bpm)));
  const sections = raw.sections.slice(0, 12).map((s, i) => {
    const anim = M.ANIM_LIBRARY.find(a => a.name.toLowerCase() === String(s.animation || "").toLowerCase())?.name || base.sections[i % base.sections.length].animation;
    const lf = s.lights ? findFx(s.lights)?.name || null : null;
    const seconds = Math.max(5, Math.min(1800, Math.round(+s.seconds || 30)));
    return {
      name: String(s.name || SECTIONS[i % SECTIONS.length].id).toUpperCase().slice(0, 24), seconds, bars: Math.max(1, Math.round(seconds * bpm / 60 / 4)),
      animation: anim, transition: TRANSITIONS.includes(s.transition) ? s.transition : "fade",
      lights: lf, audio: !!s.audio, effect: String(s.effect || "").slice(0, 60), energy: Math.max(0, Math.min(1, +s.energy || 0.5)),
    };
  });
  const seconds = sections.reduce((a, s) => a + s.seconds, 0);
  return { title: String(raw.title || `Show de ${Math.round(seconds / 6) / 10} min`).slice(0, 80), bpm, seconds, sections, source: raw.source || "IA" };
}

/** Lo que hará «Aplicar» (para que el usuario lo vea antes). */
export function planChanges(plan) {
  return [
    `Crear ${plan.sections.length} escenas nuevas (${plan.sections.map(s => s.name).join(", ")}) al final; las tuyas no se tocan`,
    `Cada escena dura lo que dice el plan y pasa sola a la siguiente (avance automático)`,
    `Tempo a ${plan.bpm} BPM`,
    plan.sections.some(s => s.lights) ? "Cada escena cambia el efecto de las luces al empezar" : null,
    plan.sections.some(s => s.audio) ? "Las secciones intensas reaccionan a la música" : null,
  ].filter(Boolean);
}

/** Aplica el plan: escenas nuevas con animación, transición, duración, luces y audio. */
export function applyPlan(app, plan) {
  const P = app.S.project, A = app.actions;
  const first = P.scenes.length;
  for (const sec of plan.sections) {
    const sc = M.createScene(sec.name);
    sc.duration = sec.seconds; sc.transition = sec.transition; sc.trMs = sec.transition === "cut" ? 0 : 900;
    if (sec.lights) sc.lights = findFx(sec.lights)?.id || null;
    const item = M.ANIM_LIBRARY.find(a => a.name === sec.animation);
    for (const s of P.surfaces) {
      const look = M.createLook(item ? { type: "gen", gen: item.gen, color: item.color, color2: item.color2, speed: item.speed ?? 1, scale: item.scale ?? 1 } : { type: "gen", gen: "plasma" });
      if (sec.audio) look.audio = { enabled: true, band: "bass", target: "brightness", amount: 1 };
      sc.looks[s.id] = look;
    }
    P.scenes.push(sc);
  }
  P.settings.autoAdvance = true;
  P.settings.bpm = plan.bpm;
  try { A.setBpm?.(plan.bpm); } catch {}
  app.changed({ panel: true }); app.commit();
  A.goScene(P.scenes[first].id);
  return `${plan.sections.length} escenas creadas · el show empieza en «${plan.sections[0].name}»`;
}

/** Esquema JSON que se pide al modelo (salida estructurada). */
export const PLAN_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" }, bpm: { type: "number" },
    sections: { type: "array", items: { type: "object", properties: {
      name: { type: "string" }, seconds: { type: "number" }, animation: { type: "string" }, transition: { type: "string", enum: TRANSITIONS },
      lights: { type: "string" }, audio: { type: "boolean" }, effect: { type: "string" }, energy: { type: "number" },
    }, required: ["name", "seconds", "animation", "transition"] } },
  },
  required: ["title", "bpm", "sections"],
};
