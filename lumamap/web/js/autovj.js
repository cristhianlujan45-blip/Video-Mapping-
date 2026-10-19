// web/js/autovj.js
// VJ automático: escucha la música (o el tempo interno si no hay micrófono) y actúa como un
// VJ profesional:
//  - mide la ENERGÍA (adaptándose al volumen de la sala) y reconoce la parte del tema:
//    calma · subida · DROP · arriba · pausa;
//  - cambia de clip al final de cada FRASE musical (16/32 golpes según el estilo y la energía),
//    con la transición que pide el momento (fundido largo en calma, corte con destello en el drop);
//  - elige clips de TU SET según su energía (suave / media / fuerte) sin repetirse;
//  - mueve los efectos al ritmo: zoom con el bombo, estrobo y glitch en el drop, caleidoscopio
//    que crece en la subida, color que gira en la calma, oscuro y lento en la pausa;
//  - mantiene una PALETA de color por sección (estilos: techno, festival, chill, rock…).
// Sin DOM: el editor aplica las acciones (editor.js) y aquí solo se decide (se prueba en Node).

export const SECTIONS = { calm: "Calma", build: "Subida", drop: "DROP", high: "Arriba", break: "Pausa" };

/** Estilos: frases (golpes por clip), transiciones (en golpes), paletas y cuánto efecto. */
export const VJ_STYLES = {
  techno: { name: "Techno / club", phrase: { calm: 32, build: 16, drop: 16, high: 16, break: 32 }, fade: { calm: 8, build: 4, high: 2, break: 8 },
    palettes: [["#ff1a1a", "#000000"], ["#ffffff", "#000000"], ["#00e5ff", "#000814"], ["#ff3b00", "#1a0000"], ["#b000ff", "#000000"]], fxk: 1, mono: true },
  edm: { name: "Festival EDM", phrase: { calm: 16, build: 8, drop: 8, high: 8, break: 16 }, fade: { calm: 4, build: 2, high: 1, break: 4 },
    palettes: [["#ff2d95", "#00e5ff"], ["#7a00ff", "#ffd400"], ["#00ff88", "#ff00aa"], ["#ff6a00", "#00b3ff"], ["#ffffff", "#ff2d95"]], fxk: 1.2 },
  house: { name: "House / disco", phrase: { calm: 32, build: 16, drop: 16, high: 16, break: 16 }, fade: { calm: 8, build: 4, high: 2, break: 8 },
    palettes: [["#ffcc00", "#ff2d95"], ["#00e5ff", "#ff7a00"], ["#ff4f9a", "#6a00ff"], ["#3dff8f", "#0055ff"]], fxk: 0.8 },
  chill: { name: "Chill / ambient", phrase: { calm: 64, build: 32, drop: 32, high: 32, break: 64 }, fade: { calm: 16, build: 8, high: 8, break: 16 },
    palettes: [["#4dd0e1", "#1a237e"], ["#ffab91", "#4a148c"], ["#a5d6a7", "#004d40"], ["#ffe082", "#bf360c"]], fxk: 0.35 },
  rock: { name: "Rock / concierto", phrase: { calm: 16, build: 8, drop: 8, high: 8, break: 16 }, fade: { calm: 4, build: 2, high: 1, break: 4 },
    palettes: [["#ff3b00", "#1a0000"], ["#ffffff", "#ff2200"], ["#ffb300", "#000000"], ["#00b0ff", "#000000"]], fxk: 1 },
  latina: { name: "Fiesta latina", phrase: { calm: 16, build: 8, drop: 8, high: 8, break: 16 }, fade: { calm: 4, build: 2, high: 2, break: 4 },
    palettes: [["#ffd400", "#ff0080"], ["#ff6a00", "#00c853"], ["#00e5ff", "#ff1744"], ["#ffea00", "#7c4dff"]], fxk: 0.9 },
  elegant: { name: "Elegante / evento", phrase: { calm: 64, build: 32, drop: 32, high: 32, break: 64 }, fade: { calm: 16, build: 8, high: 8, break: 16 },
    palettes: [["#d4af37", "#000000"], ["#ffffff", "#0a1a3a"], ["#c0c0c0", "#1a1a1a"], ["#f8bbd0", "#2a0a1a"]], fxk: 0.25 },
};

/* ---------------- Energía de cada clip ---------------- */
const SOFT = new Set(["clouds", "aurora", "gradient", "ocean", "sunset", "water", "smoke", "colorfog", "bubbles", "snow", "rain", "lava", "metaballs",
  "fluid", "galaxy", "stars", "mandala", "phyllo", "conic", "chrome", "rings", "waves", "cells", "voronoi", "dna", "particles", "plasma", "hearts", "scales"]);
const STRONG = new Set(["warp", "tunnel", "boxtunnel", "beatflash", "glitchblocks", "rgbglitch", "static", "lasershow", "crosslasers", "sweep", "sweepbars",
  "lightning", "electric", "ledcurtain", "discoball", "fireworks", "hypno", "infzoom", "rainbowroad", "kaleidolive", "pixeleq", "eq", "audiorings",
  "circleviz", "strobe", "fallblocks", "blackhole", "portal", "vortex", "synthwave", "chevrons", "rays", "diagsweep", "heartbeat"]);
/** Energía de un clip: "soft" | "mid" | "hard" (la del usuario manda). */
export function clipEnergy(c) {
  if (c.energy === "soft" || c.energy === "mid" || c.energy === "hard") return c.energy;
  if (c.fx?.strobe > 0 || c.fx?.glitch > 0.3) return "hard";
  if (c.gen && STRONG.has(c.gen)) return "hard";
  if (c.gen && SOFT.has(c.gen)) return "soft";
  return "mid";
}
const WANT = { calm: ["soft", "mid"], break: ["soft"], build: ["mid", "hard"], drop: ["hard"], high: ["hard", "mid"] };

/* ---------------- Motor ---------------- */
/**
 * createVJ({ style, intensity, random }) → { frame(levels, now), beat(levels, now, ctx) → acciones[], status() }
 * ctx = { clips: [{ id, name, energy, gen?, … }], surfaces: [id…], variety: bool }
 * Acciones:
 *  { type: "clip", surface, clip, beats (fundido en golpes; 0 = corte), palette }
 *  { type: "fx", surface, fx: {…} }      (se suma al efecto propio del clip)
 *  { type: "audio", surface, audio: {…} } (el zoom con el bombo, etc.)
 *  { type: "section", section }
 */
export function createVJ({ style = "techno", intensity = 0.7, random = Math.random } = {}) {
  const st = { style, intensity, section: "calm", energy: 0, beat: 0, bar: 0, beatsInSection: 0, phraseLeft: 0,
    palette: 0, recent: [], current: new Map(), lastTrend: 0, bpm: 120, live: false, clipName: "" };
  // Volumen: rápido (~1 s), lento (~8 s) y suelo/techo que se adaptan a la sala.
  let fast = 0, slow = 0, lo = 0, hi = 0, lastNow = 0, simT = 0, started = false;
  const S = () => VJ_STYLES[st.style] || VJ_STYLES.techno;

  function frame(levels = {}, now = 0) {
    const dt = lastNow ? Math.min(0.2, Math.max(0, (now - lastNow) / 1000)) : 0;
    lastNow = now;
    st.live = !!levels.live;
    if (levels.bpm) st.bpm = levels.bpm;
    if (!st.live) return;               // sin micrófono: la estructura la da el reloj (en beat())
    const v = Math.max(0, Math.min(1, (levels.level ?? 0) * 0.6 + (levels.bass ?? 0) * 0.4));
    if (!started) { fast = slow = lo = hi = v; started = true; }
    fast += (v - fast) * Math.min(1, dt / 0.8);
    slow += (v - slow) * Math.min(1, dt / 8);
    // Suelo y techo con memoria (~30 s): la energía es relativa a ESTA sala y ESTA música,
    // mezclada con la absoluta (el audio ya llega normalizado por el pico).
    lo = Math.min(lo + dt / 30 * 0.2, fast); hi = Math.max(hi - dt / 30 * 0.2, fast);
    const rel = (fast - lo) / Math.max(0.3, hi - lo);
    const abs = (fast - 0.1) / 0.6;
    st.energy = Math.max(0, Math.min(1, 0.6 * abs + 0.4 * rel));
    st.lastTrend = fast - slow;
  }

  /** Sección del tema según la energía (con audio) o una estructura de tema simulada (sin audio). */
  function classify() {
    if (!st.live) {
      // Sin micrófono: calma 32 · subida 16 · drop 32 · pausa 16 (como un tema de club).
      const plan = [["calm", 32], ["build", 16], ["drop", 32], ["break", 16]];
      const total = plan.reduce((s, p) => s + p[1], 0);
      let t = simT % total;
      for (const [sec, n] of plan) { if (t < n) { st.energy = { calm: 0.3, build: 0.55, drop: 0.95, break: 0.15 }[sec]; return sec; } t -= n; }
      return "calm";
    }
    const e = st.energy, trend = st.lastTrend, prev = st.section;
    if ((prev === "build" || prev === "break") && e > 0.72) return "drop";
    if (e > 0.8 && trend > 0.12) return "drop";
    if (e > 0.62) return prev === "drop" && st.beatsInSection < 32 ? "drop" : "high";
    if (trend > 0.05 && e > 0.3) return "build";
    if (e < 0.28 && (prev === "drop" || prev === "high" || prev === "break")) return "break";
    return "calm";
  }

  function pick(clips, section, avoid) {
    if (!clips.length) return null;
    const want = WANT[section] || ["mid"];
    let pool = clips.filter(c => want.includes(clipEnergy(c)) && !avoid.has(c.id));
    if (!pool.length) pool = clips.filter(c => !avoid.has(c.id));
    if (!pool.length) pool = clips;
    // El tipo de energía que más pide la sección pesa el doble.
    const w = pool.map(c => clipEnergy(c) === want[0] ? 2 : 1);
    let r = random() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < pool.length; i++) { r -= w[i]; if (r <= 0) return pool[i]; }
    return pool[pool.length - 1];
  }

  /** Efecto que se suma al clip según la sección (cuánto, según intensidad y estilo). */
  function fxFor(section, beatInBar) {
    const k = st.intensity * S().fxk;
    switch (section) {
      case "calm": return { hueCycle: 0.15 * k, wave: 0.15 * k };
      case "build": {
        const grow = Math.min(1, st.beatsInSection / 16);
        return { kaleido: k > 0.5 ? Math.round(2 + grow * 4) : 0, zoom: 1 + grow * 0.15 * k, saturation: 1 + grow * 0.4, strobe: grow > 0.85 && k > 0.6 ? 8 : 0 };
      }
      case "drop": return { strobe: st.beatsInSection < 4 && k > 0.5 ? 6 : 0, rgbShift: 0.008 * k, shake: 0.6 * k, contrast: 1.2, saturation: 1.3,
        glitch: beatInBar === 3 && k > 0.6 ? 0.5 : 0 };
      case "high": return { rgbShift: 0.004 * k, contrast: 1.15, saturation: 1.2, glitch: st.bar % 8 === 7 && beatInBar === 3 && k > 0.5 ? 0.4 : 0 };
      case "break": return { saturation: 0.6, vignette: 0.6, brightness: 0.75, zoom: 1.05 };
      default: return {};
    }
  }
  const audioFor = (section) => {
    const k = st.intensity * S().fxk;
    if (section === "drop" || section === "high") return { enabled: true, band: "bass", target: "scale", amount: 0.5 * k };
    if (section === "build") return { enabled: true, band: "bass", target: "brightness", amount: 0.4 * k };
    return { enabled: false, band: "bass", target: "brightness", amount: 0 };
  };

  function beat(levels = {}, now = 0, ctx = {}) {
    const out = [];
    const clips = ctx.clips || [], surfaces = ctx.surfaces || [];
    st.beat++; simT++;
    const beatInBar = (st.beat - 1) % 4;
    if (beatInBar === 0) st.bar++;
    st.beatsInSection++;
    st.phraseLeft--;
    // La sección se decide en el primer golpe de cada compás (como cuenta un VJ).
    let changedSection = false;
    if (beatInBar === 0 || st.beat === 1) {
      const sec = classify();
      if (sec !== st.section || st.beat === 1) {
        const from = st.section;
        st.section = sec; st.beatsInSection = 1; changedSection = true;
        out.push({ type: "section", section: sec, from });
        // Paleta nueva al llegar al drop o al volver de la pausa.
        if (sec === "drop" || (from === "break" && sec !== "break") || st.beat === 1) st.palette = Math.floor(random() * S().palettes.length);
      }
    }
    const sec = st.section;
    const P = S().palettes[st.palette % S().palettes.length];
    // ¿Toca clip nuevo? Al acabar la frase, al entrar el drop (en el golpe) o al empezar.
    const newClip = st.beat === 1 || (changedSection && (sec === "drop" || sec === "break")) || (st.phraseLeft <= 0 && beatInBar === 0);
    if (newClip && clips.length && surfaces.length) {
      st.phraseLeft = S().phrase[sec] || 16;
      const fade = sec === "drop" ? 0 : (S().fade[sec] ?? 4);
      const avoid = new Set(st.recent);
      const variety = !!ctx.variety && surfaces.length > 1;
      let shared = null;
      for (const sid of surfaces) {
        const cur = st.current.get(sid);
        if (cur) avoid.add(cur);
        const c = variety ? pick(clips, sec, avoid) : (shared ||= pick(clips, sec, avoid));
        if (!c) continue;
        if (variety) avoid.add(c.id);
        st.current.set(sid, c.id);
        out.push({ type: "clip", surface: sid, clip: c, beats: fade, palette: S().mono && sec === "drop" ? [P[0], "#000000"] : P, flash: sec === "drop" && changedSection });
      }
      const used = [...new Set(surfaces.map(s => st.current.get(s)).filter(Boolean))];
      st.recent = [...used, ...st.recent.filter(id => !used.includes(id))].slice(0, Math.min(4, Math.max(1, clips.length - 1)));
      st.clipName = clips.find(c => c.id === st.current.get(surfaces[0]))?.name || "";
    }
    // Efectos al ritmo: en cada golpe (con el clip ya puesto).
    const fx = fxFor(sec, beatInBar);
    const audio = audioFor(sec);
    for (const sid of surfaces) {
      out.push({ type: "fx", surface: sid, fx });
      if (changedSection || st.beat === 1) out.push({ type: "audio", surface: sid, audio });
    }
    return out;
  }

  return {
    frame, beat,
    setStyle(s) { if (VJ_STYLES[s]) st.style = s; },
    setIntensity(v) { st.intensity = Math.max(0, Math.min(1, +v || 0)); },
    /** Fuerza clip nuevo en el próximo golpe. */
    skip() { st.phraseLeft = 0; st.beat = Math.ceil(st.beat / 4) * 4; },
    status: () => ({ style: st.style, styleName: S().name, section: st.section, sectionName: SECTIONS[st.section], energy: st.energy, bpm: st.bpm, live: st.live,
      clip: st.clipName, nextIn: Math.max(0, st.phraseLeft), palette: S().palettes[st.palette % S().palettes.length] }),
  };
}

/* ---------------- Set desde una frase (sin IA) ---------------- */
const STYLE_WORDS = [
  ["techno", /techno|tecno|minimal|industrial|oscuro|dark|underground|club/i], ["edm", /edm|festival|electr[oó]nica|dubstep|trance|big ?room|rave/i],
  ["house", /house|disco|funk|groove/i], ["chill", /chill|ambient|relaj|lounge|tranquil|suave|lofi|lo-fi/i],
  ["rock", /rock|metal|punk|concierto|banda/i], ["latina", /latin|reggaet|salsa|cumbia|bachata|merengue|perreo|fiesta/i],
  ["elegant", /elegante|boda|corporativ|gala|evento|empresa|lujo/i],
];
const COLOR_WORDS = { rojo: "#ff1a1a", roja: "#ff1a1a", azul: "#0066ff", verde: "#00e676", amarillo: "#ffd400", naranja: "#ff6a00", morado: "#8e24ff", violeta: "#8e24ff",
  rosa: "#ff2d95", cian: "#00e5ff", blanco: "#ffffff", dorado: "#d4af37", oro: "#d4af37", fucsia: "#ff00aa", turquesa: "#1de9b6", plateado: "#c0c0c0" };
const THEME_WORDS = [
  [/espacio|galax|estrell|cosm/i, ["galaxy", "stars", "warp", "blackhole", "shooting", "portal"]],
  [/fuego|llama|caliente|infierno/i, ["fire", "lava", "electric", "rays"]],
  [/agua|mar|oc[eé]ano|playa/i, ["ocean", "water", "bubbles", "aurora"]],
  [/l[aá]ser|laser/i, ["lasershow", "crosslasers", "sweep", "sweepbars"]],
  [/ne[oó]n|retro|80|synth/i, ["synthwave", "neonwaves", "grid", "rainbowroad"]],
  [/psicod|hipn|trip|fractal/i, ["hypno", "julia", "kaleidolive", "infzoom", "mandala"]],
  [/glitch|digital|hacker|matrix/i, ["glitchblocks", "rgbglitch", "matrix", "static", "circuit"]],
  [/geom|minimal|l[ií]neas/i, ["squares", "triangles", "chevrons", "argyle", "opart", "moire"]],
];
/** Frase → { style, palette?, gens: [ids de animaciones base que pegan] } (para «Crear set»). */
export function setFromText(text = "") {
  const t = String(text);
  const style = STYLE_WORDS.find(([, re]) => re.test(t))?.[0] || "techno";
  const cols = [];
  for (const [w, hex] of Object.entries(COLOR_WORDS)) if (new RegExp(`\\b${w}s?\\b`, "i").test(t) && !cols.includes(hex)) cols.push(hex);
  const gens = [...new Set(THEME_WORDS.filter(([re]) => re.test(t)).flatMap(([, g]) => g))];
  return { style, palette: cols.length ? [cols[0], cols[1] || (style === "techno" ? "#000000" : "#000814")] : null, gens };
}
