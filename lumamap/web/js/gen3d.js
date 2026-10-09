// web/js/gen3d.js
// Objetos 3D a partir de una frase («hazme un carro rojo deportivo»).
//  - Sin IA: biblioteca de objetos paramétricos hechos por LumaMap (carro, casa, árbol,
//    cohete, avión, robot, corazón, estrella, planeta, diamante, trofeo, regalo y texto 3D),
//    con estilos y colores. Funciona sin internet, en Windows, Android y navegador.
//  - Con IA (local u opcional remota): cualquier objeto. La IA SOLO devuelve una receta de
//    piezas (JSON: formas simples con posición, giro, tamaño y color) que aquí se valida;
//    nunca se ejecuta código.
// Una receta es { name, parts: [{ s, p, r, d, c, m, t? }] }:
//   s forma: box | sphere | cylinder | cone | torus | capsule | star | heart | text
//   p posición [x,y,z] (m) · r giro [x,y,z] (grados) · d tamaño [x,y,z] (m)
//   c color #rrggbb · m material: paint | metal | glass | rubber | light | matte · t texto (forma text)

export const SHAPES3D = ["box", "sphere", "cylinder", "cone", "torus", "capsule", "star", "heart", "text"];
export const MATERIALS3D = ["paint", "metal", "glass", "rubber", "light", "matte"];
export const FINISHES = [["real", "Realista"], ["neon", "Neón (líneas)"], ["holo", "Holograma azul"]];
export const VIEWS = [["front", "Frente"], ["three", "3/4"], ["side", "Lado"], ["top", "Arriba"]];

const COLORS = { rojo: "#e3122b", roja: "#e3122b", azul: "#1f5fff", verde: "#18b34a", amarillo: "#ffcc00", amarilla: "#ffcc00", blanco: "#f2f4f7", blanca: "#f2f4f7",
  negro: "#15171c", negra: "#15171c", gris: "#8a93a6", plateado: "#c8ced8", plateada: "#c8ced8", dorado: "#e8b923", dorada: "#e8b923", naranja: "#ff7a00",
  morado: "#7b2cff", morada: "#7b2cff", violeta: "#7b2cff", rosa: "#ff4fa3", rosado: "#ff4fa3", rosada: "#ff4fa3", cian: "#00d9ff", celeste: "#4fc3ff", turquesa: "#00c8b4" };

const P = (s, p, d, c, m = "paint", r = [0, 0, 0], extra = {}) => ({ s, p, r, d, c, m, ...extra });
const wheel = (x, z, r = 0.36, w = 0.26, rim = "#c8ced8") => [
  P("cylinder", [x, r, z], [r * 2, w, r * 2], "#16181d", "rubber", [90, 0, 0]),
  P("cylinder", [x, r, z + Math.sign(z) * 0.005], [r * 1.25, w + 0.02, r * 1.25], rim, "metal", [90, 0, 0]),
];

/** Biblioteca: id → { name, emoji, words, styles, colors, build(style, c1, c2) } */
export const OBJECTS3D = [
  { id: "carro", name: "Carro", emoji: "🚗", words: /\b(carro|coche|auto|automovil|automóvil|vehiculo|vehículo|camioneta|deportivo|sedan|sedán|car)\b/,
    styles: [["deportivo", "Deportivo"], ["sedan", "Sedán"], ["camioneta", "Camioneta"]], colors: ["#e3122b", "#15171c"],
    build(style, c1, c2) {
      const sport = style === "deportivo", suv = style === "camioneta";
      const L = suv ? 4.6 : 4.4, W = 1.9, bodyH = suv ? 0.75 : sport ? 0.5 : 0.6, base = suv ? 0.42 : 0.3, wr = suv ? 0.42 : 0.36;
      const cabL = sport ? 1.9 : suv ? 2.8 : 2.4, cabH = sport ? 0.42 : suv ? 0.7 : 0.55, cabX = sport ? -0.25 : suv ? -0.3 : -0.2;
      const top = base + bodyH;
      return [
        P("box", [0, base + bodyH / 2, 0], [L, bodyH, W], c1, "paint"),                                      // carrocería
        P("box", [L / 2 - 0.35, base + bodyH * 0.82, 0], [0.7, bodyH * 0.35, W * 0.98], c1, "paint", [0, 0, sport ? -10 : -6]),   // capó inclinado
        P("box", [cabX, top + cabH / 2, 0], [cabL, cabH, W * 0.86], c1, "paint"),                              // cabina
        P("box", [cabX + 0.02, top + cabH / 2, 0], [cabL * 0.9, cabH * 0.72, W * 0.88], c2 || "#0d1117", "glass"), // ventanas
        P("box", [cabX + cabL / 2 + 0.05, top + cabH * 0.42, 0], [0.12, cabH * 0.8, W * 0.82], c2 || "#0d1117", "glass", [0, 0, 35]), // parabrisas
        P("box", [L / 2 + 0.01, base + bodyH * 0.6, W * 0.33], [0.04, 0.12, 0.34], "#fff6d8", "light"),        // faros
        P("box", [L / 2 + 0.01, base + bodyH * 0.6, -W * 0.33], [0.04, 0.12, 0.34], "#fff6d8", "light"),
        P("box", [-L / 2 - 0.01, base + bodyH * 0.65, W * 0.35], [0.04, 0.1, 0.3], "#ff1a1a", "light"),        // luces traseras
        P("box", [-L / 2 - 0.01, base + bodyH * 0.65, -W * 0.35], [0.04, 0.1, 0.3], "#ff1a1a", "light"),
        P("box", [L / 2 + 0.02, base + 0.12, 0], [0.08, 0.16, W * 0.9], "#15171c", "matte"),                  // parachoques
        P("box", [-L / 2 - 0.02, base + 0.12, 0], [0.08, 0.16, W * 0.9], "#15171c", "matte"),
        ...(sport ? [P("box", [-L / 2 + 0.2, top + 0.22, 0], [0.35, 0.05, W * 0.95], c2 || "#15171c", "matte"),     // alerón
          P("box", [-L / 2 + 0.25, top + 0.1, W * 0.35], [0.06, 0.2, 0.06], "#15171c", "matte"), P("box", [-L / 2 + 0.25, top + 0.1, -W * 0.35], [0.06, 0.2, 0.06], "#15171c", "matte")] : []),
        ...(suv ? [P("box", [cabX, top + cabH + 0.05, W * 0.33], [cabL * 0.8, 0.04, 0.05], "#c8ced8", "metal"), P("box", [cabX, top + cabH + 0.05, -W * 0.33], [cabL * 0.8, 0.04, 0.05], "#c8ced8", "metal")] : []),
        ...wheel(L * 0.32, W / 2, wr), ...wheel(L * 0.32, -W / 2, wr), ...wheel(-L * 0.32, W / 2, wr), ...wheel(-L * 0.32, -W / 2, wr),
      ];
    } },
  { id: "casa", name: "Casa", emoji: "🏠", words: /\b(casa|hogar|vivienda|cabaña|cabana|house)\b/, styles: [["moderna", "Moderna"], ["cabana", "Cabaña"]], colors: ["#f2e6d0", "#b23a2a"],
    build(style, c1, c2) {
      const cab = style === "cabana";
      return [
        P("box", [0, 1, 0], [4, 2, 3], c1, cab ? "matte" : "paint"),
        P("cylinder", [0, 2.6, 0], [3.6, 4.4, 2.4], c2, "matte", [90, 0, 90], { seg: 3 }),          // tejado (prisma triangular)
        P("box", [2.01, 0.6, 0], [0.04, 1.2, 0.7], cab ? "#5a3a22" : "#2b2f38", "matte"),            // puerta
        P("box", [2.01, 1.2, 1], [0.04, 0.6, 0.6], "#ffe7a3", "light"), P("box", [2.01, 1.2, -1], [0.04, 0.6, 0.6], "#ffe7a3", "light"),
        P("box", [0, 1.2, 1.51], [0.8, 0.6, 0.04], "#ffe7a3", "light"),
        P("box", [-1, 3.1, 0.6], [0.4, 1, 0.4], cab ? "#6b4a2f" : "#8a93a6", "matte"),               // chimenea
      ];
    } },
  { id: "arbol", name: "Árbol", emoji: "🌲", words: /\b(arbol|árbol|pino|tree|navidad)\b/, styles: [["pino", "Pino"], ["frondoso", "Frondoso"]], colors: ["#1e9e4a", "#7a4a2a"],
    build(style, c1, c2) {
      if (style === "frondoso") return [P("cylinder", [0, 0.9, 0], [0.4, 1.8, 0.4], c2, "matte"), P("sphere", [0, 2.4, 0], [2, 1.8, 2], c1, "matte"),
        P("sphere", [0.6, 2.1, 0.3], [1.3, 1.2, 1.3], c1, "matte"), P("sphere", [-0.6, 2.2, -0.2], [1.3, 1.2, 1.3], c1, "matte")];
      return [P("cylinder", [0, 0.4, 0], [0.35, 0.8, 0.35], c2, "matte"), P("cone", [0, 1.3, 0], [2.4, 1.6, 2.4], c1, "matte"),
        P("cone", [0, 2.1, 0], [1.9, 1.4, 1.9], c1, "matte"), P("cone", [0, 2.8, 0], [1.3, 1.2, 1.3], c1, "matte"), P("star", [0, 3.55, 0], [0.5, 0.5, 0.12], "#ffd23f", "light")];
    } },
  { id: "cohete", name: "Cohete", emoji: "🚀", words: /\b(cohete|nave espacial|rocket)\b/, styles: [["clasico", "Clásico"]], colors: ["#f2f4f7", "#e3122b"],
    build(style, c1, c2) {
      const fin = (a) => P("box", [Math.cos(a) * 0.55, 0.55, Math.sin(a) * 0.55], [0.7, 0.9, 0.06], c2, "paint", [0, -a * 180 / Math.PI, 0]);
      return [P("cylinder", [0, 1.6, 0], [0.9, 2.6, 0.9], c1, "paint"), P("cone", [0, 3.3, 0], [0.9, 0.9, 0.9], c2, "paint"),
        P("cylinder", [0, 2.2, 0.42], [0.4, 0.08, 0.4], "#4fc3ff", "glass", [90, 0, 0]), P("torus", [0, 2.2, 0.43], [0.42, 0.42, 0.2], "#c8ced8", "metal"),
        fin(0), fin(Math.PI * 2 / 3), fin(Math.PI * 4 / 3), P("cylinder", [0, 0.22, 0], [0.6, 0.3, 0.6], "#5a5f6b", "metal"), P("cone", [0, -0.25, 0], [0.55, 0.7, 0.55], "#ff8a1a", "light", [180, 0, 0])];
    } },
  { id: "avion", name: "Avión", emoji: "✈", words: /\b(avion|avión|aeroplano|jet|plane)\b/, styles: [["comercial", "Comercial"]], colors: ["#f2f4f7", "#1f5fff"],
    build(style, c1, c2) {
      return [P("capsule", [0, 1.5, 0], [0.8, 5, 0.8], c1, "paint", [0, 0, 90]), P("box", [0.2, 1.4, 0], [1.2, 0.08, 6], c1, "paint"),
        P("box", [-2.2, 1.6, 0], [0.7, 0.06, 2], c1, "paint"), P("box", [-2.3, 2.1, 0], [0.8, 1, 0.06], c2, "paint", [0, 0, -15]),
        P("cylinder", [0.4, 1.15, 1.5], [0.35, 0.8, 0.35], "#8a93a6", "metal", [0, 0, 90]), P("cylinder", [0.4, 1.15, -1.5], [0.35, 0.8, 0.35], "#8a93a6", "metal", [0, 0, 90]),
        P("box", [2.25, 1.65, 0], [0.3, 0.2, 0.5], "#0d1117", "glass"), P("box", [0, 1.5, 0.41], [3.4, 0.08, 0.02], c2, "paint"), P("box", [0, 1.5, -0.41], [3.4, 0.08, 0.02], c2, "paint")];
    } },
  { id: "robot", name: "Robot", emoji: "🤖", words: /\b(robot|androide|droide)\b/, styles: [["amigable", "Amigable"]], colors: ["#c8ced8", "#00d9ff"],
    build(style, c1, c2) {
      return [P("box", [0, 1.6, 0], [1.2, 1.3, 0.8], c1, "metal"), P("box", [0, 2.65, 0], [0.9, 0.7, 0.7], c1, "metal"),
        P("sphere", [0.2, 2.7, 0.36], [0.16, 0.16, 0.08], c2, "light"), P("sphere", [-0.2, 2.7, 0.36], [0.16, 0.16, 0.08], c2, "light"),
        P("box", [0, 2.45, 0.36], [0.4, 0.06, 0.02], c2, "light"), P("cylinder", [0, 3.1, 0], [0.05, 0.3, 0.05], "#8a93a6", "metal"), P("sphere", [0, 3.28, 0], [0.12, 0.12, 0.12], "#ff4fa3", "light"),
        P("box", [0, 1.7, 0.41], [0.5, 0.5, 0.02], "#15171c", "glass"), P("capsule", [0.8, 1.6, 0], [0.25, 1.1, 0.25], c1, "metal"), P("capsule", [-0.8, 1.6, 0], [0.25, 1.1, 0.25], c1, "metal"),
        P("capsule", [0.3, 0.5, 0], [0.3, 1, 0.3], c1, "metal"), P("capsule", [-0.3, 0.5, 0], [0.3, 1, 0.3], c1, "metal")];
    } },
  { id: "corazon", name: "Corazón", emoji: "❤", words: /\b(corazon|corazón|heart|amor)\b/, styles: [["liso", "Liso"]], colors: ["#ff1f4b", "#ff8fb1"],
    build(style, c1) { return [P("heart", [0, 1.2, 0], [2, 2, 0.6], c1, "paint")]; } },
  { id: "estrella", name: "Estrella", emoji: "⭐", words: /\b(estrella|star)\b/, styles: [["cinco", "5 puntas"]], colors: ["#ffd23f", "#ff8a1a"],
    build(style, c1) { return [P("star", [0, 1.2, 0], [2.2, 2.2, 0.5], c1, "metal")]; } },
  { id: "planeta", name: "Planeta", emoji: "🪐", words: /\b(planeta|saturno|mundo|planet)\b/, styles: [["anillos", "Con anillos"], ["luna", "Con luna"]], colors: ["#e8a65a", "#c8ced8"],
    build(style, c1, c2) {
      const out = [P("sphere", [0, 1.5, 0], [2, 2, 2], c1, "matte")];
      if (style === "luna") out.push(P("sphere", [1.8, 2.2, 0.4], [0.45, 0.45, 0.45], c2, "matte"));
      else out.push(P("torus", [0, 1.5, 0], [3.2, 3.2, 0.25], c2, "matte", [75, 0, 15]));
      return out;
    } },
  { id: "diamante", name: "Diamante", emoji: "💎", words: /\b(diamante|joya|gema|cristal|diamond)\b/, styles: [["brillante", "Brillante"]], colors: ["#7fe9ff", "#ffffff"],
    build(style, c1) { return [P("cone", [0, 1.55, 0], [1.6, 0.5, 1.6], c1, "glass", [0, 0, 0], { seg: 8 }), P("cone", [0, 0.8, 0], [1.6, 1.0, 1.6], c1, "glass", [180, 0, 0], { seg: 8 })]; } },
  { id: "trofeo", name: "Trofeo", emoji: "🏆", words: /\b(trofeo|copa|premio|trophy)\b/, styles: [["oro", "Oro"]], colors: ["#e8b923", "#15171c"],
    build(style, c1, c2) {
      return [P("box", [0, 0.2, 0], [1.1, 0.4, 1.1], c2, "matte"), P("cylinder", [0, 0.7, 0], [0.18, 0.6, 0.18], c1, "metal"),
        P("cone", [0, 1.45, 0], [1.3, 1.0, 1.3], c1, "metal", [180, 0, 0]), P("torus", [0.7, 1.5, 0], [0.5, 0.5, 0.25], c1, "metal", [0, 0, 90]), P("torus", [-0.7, 1.5, 0], [0.5, 0.5, 0.25], c1, "metal", [0, 0, 90])];
    } },
  { id: "regalo", name: "Regalo", emoji: "🎁", words: /\b(regalo|caja de regalo|presente|gift)\b/, styles: [["lazo", "Con lazo"]], colors: ["#e3122b", "#ffd23f"],
    build(style, c1, c2) {
      return [P("box", [0, 0.6, 0], [1.4, 1.2, 1.4], c1, "paint"), P("box", [0, 0.61, 0], [1.42, 1.22, 0.22], c2, "metal"), P("box", [0, 0.61, 0], [0.22, 1.22, 1.42], c2, "metal"),
        P("torus", [0.22, 1.35, 0], [0.5, 0.5, 0.2], c2, "metal", [0, 0, 60]), P("torus", [-0.22, 1.35, 0], [0.5, 0.5, 0.2], c2, "metal", [0, 0, -60])];
    } },
  { id: "texto", name: "Texto 3D", emoji: "🔤", words: /\b(texto|letras|palabra|nombre|logo)\b/, styles: [["bloque", "Bloques"]], colors: ["#00d9ff", "#ff4fa3"],
    build(style, c1, c2, text) { return [P("text", [0, 1, 0], [4, 1, 0.5], c1, "metal", [0, 0, 0], { t: String(text || "HOLA").slice(0, 24) })]; } },
];

const norm = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Lo que pide una frase: { id, style, color, color2, text } o null si no está en la biblioteca. */
export function parseRequest(text) {
  const raw = String(text || ""), t = norm(raw);
  const o = OBJECTS3D.find(x => x.words.test(t) || x.words.test(raw.toLowerCase()));
  if (!o) return null;
  const style = o.styles.find(([id, label]) => t.includes(norm(id)) || t.includes(norm(label)))?.[0]
    || (o.id === "carro" && /\b(suv|pickup|todoterreno|4x4)\b/.test(t) ? "camioneta" : o.styles[0][0]);
  const cw = Object.keys(COLORS).filter(c => new RegExp(`\\b${norm(c)}\\b`).test(t));
  const quoted = raw.match(/[«"“']([^»"”']{1,24})[»"”']/)?.[1] || raw.match(/(?:que diga|con el texto|texto|nombre|palabra)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ0-9 !¡?¿.-]{1,24})$/i)?.[1];
  return { id: o.id, style, color: cw[0] ? COLORS[cw[0]] : o.colors[0], color2: cw[1] ? COLORS[cw[1]] : o.colors[1], text: quoted?.trim() };
}

/** Receta de un objeto de la biblioteca. */
export function libraryRecipe(id, { style, color, color2, text } = {}) {
  const o = OBJECTS3D.find(x => x.id === id);
  if (!o) return null;
  const st = o.styles.some(s => s[0] === style) ? style : o.styles[0][0];
  return { name: o.id === "texto" && text ? text : `${o.name}${o.styles.length > 1 ? " " + o.styles.find(s => s[0] === st)[1].toLowerCase() : ""}`,
    source: "library", object: o.id, style: st, color: color || o.colors[0], color2: color2 || o.colors[1], text,
    parts: o.build(st, color || o.colors[0], color2 || o.colors[1], text) };
}

const num = (v, lo, hi, def) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def; };
const vec = (v, lo, hi, def) => Array.isArray(v) && v.length >= 3 ? v.slice(0, 3).map((x, i) => num(x, lo, hi, def[i])) : def.slice();
const hex = (v, def) => /^#[0-9a-f]{6}$/i.test(String(v || "")) ? String(v).toLowerCase() : def;

/**
 * Receta que llega de la IA → receta segura (solo formas permitidas, números acotados,
 * máximo 80 piezas). Lanza un error si no queda nada dibujable.
 */
export function validateRecipe(j) {
  const parts = (Array.isArray(j?.parts) ? j.parts : []).slice(0, 400).map(q => {
    const s = SHAPES3D.includes(q?.s) ? q.s : SHAPES3D.includes(q?.shape) ? q.shape : null;
    if (!s) return null;
    return { s, p: vec(q.p ?? q.position, -20, 20, [0, 0, 0]), r: vec(q.r ?? q.rotation, -360, 360, [0, 0, 0]), d: vec(q.d ?? q.size, 0.01, 20, [1, 1, 1]),
      c: hex(q.c ?? q.color, "#8a93a6"), m: MATERIALS3D.includes(q.m ?? q.material) ? (q.m ?? q.material) : "paint",
      ...(s === "text" ? { t: String(q.t ?? q.text ?? "").slice(0, 24) || "HOLA" } : {}),
      ...(q.seg ? { seg: Math.round(num(q.seg, 3, 64, 32)) } : {}) };
  }).filter(Boolean).slice(0, 80);
  if (!parts.length) throw new Error("La IA no devolvió piezas válidas");
  return { name: String(j.name || "Objeto").slice(0, 40), source: "ai", parts };
}

/** Instrucciones para la IA (receta JSON, nunca código). */
export function aiPrompt(text) {
  return {
    system: "Diseñas objetos 3D sencillos y reconocibles combinando formas básicas, como un juguete de bloques bien hecho. Respondes SOLO JSON.",
    user: `Crea un objeto 3D de: «${text}».
Usa entre 6 y 60 piezas. Formas permitidas (s): ${SHAPES3D.join(", ")}. Materiales (m): ${MATERIALS3D.join(", ")} (light = brilla).
Cada pieza: {"s": forma, "p": [x,y,z] centro en metros (y hacia arriba, el objeto apoyado en y=0, tamaño total 2-5 m), "r": [x,y,z] giro en grados, "d": [ancho,alto,fondo] en metros, "c": "#rrggbb", "m": material}.
cylinder/cone/capsule van verticales (eje Y); gíralos con r para tumbarlos. torus: d = [diámetro, diámetro, grosor].
Responde JSON: {"name": "nombre corto en español", "parts": [ ... ]}`,
    schema: { type: "object", properties: { name: { type: "string" }, parts: { type: "array", items: { type: "object" } } }, required: ["parts"] },
  };
}

/** Ideas para los botones rápidos. */
export const IDEAS3D = OBJECTS3D.map(o => ({ id: o.id, label: `${o.emoji} ${o.name}` }));
