// web/js/gen3d.js
// Objetos 3D a partir de una frase («hazme un carro rojo deportivo»).
//  - Sin IA: biblioteca de objetos paramétricos hechos por LumaMap (carro, casa, árbol,
//    cohete, avión, robot, corazón, estrella, planeta, diamante, trofeo, regalo, moto, barco,
//    flor, seta, globo, faro, castillo, taza, cactus, nube y texto 3D),
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
        P("cylinder", [0, 2.47, 0], [3.93, 4.4, 1.87], c2, "matte", [-90, 0, 90], { seg: 3 }),      // tejado (prisma triangular, cumbrera a lo largo)
        P("box", [2.01, 0.6, 0], [0.04, 1.2, 0.7], cab ? "#5a3a22" : "#2b2f38", "matte"),            // puerta
        P("box", [2.01, 1.2, 1], [0.04, 0.6, 0.6], "#ffe7a3", "light"), P("box", [2.01, 1.2, -1], [0.04, 0.6, 0.6], "#ffe7a3", "light"),
        P("box", [0, 1.2, 1.51], [0.8, 0.6, 0.04], "#ffe7a3", "light"),
        P("box", [-1, 2.95, 0.7], [0.4, 1, 0.4], cab ? "#6b4a2f" : "#8a93a6", "matte"),              // chimenea
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
  { id: "moto", name: "Moto", emoji: "🏍", words: /\b(moto|motocicleta|motor|scooter|motorbike|motorcycle)\b/, styles: [["deportiva", "Deportiva"]], colors: ["#e3122b", "#15171c"],
    build(style, c1, c2) {
      const tire = (x) => [P("torus", [x, 0.36, 0], [0.72, 0.72, 0.16], "#16181d", "rubber"), P("cylinder", [x, 0.36, 0], [0.34, 0.12, 0.34], "#c8ced8", "metal", [90, 0, 0])];
      return [...tire(0.78), ...tire(-0.78),
        P("sphere", [0.18, 0.95, 0], [0.78, 0.42, 0.44], c1, "paint"),                              // depósito
        P("box", [0.5, 0.86, 0], [0.32, 0.36, 0.4], c1, "paint", [0, 0, -30]),                       // carenado
        P("box", [-0.72, 0.98, 0], [0.42, 0.12, 0.24], c1, "paint", [0, 0, 14]),                     // colín
        P("box", [-0.42, 0.9, 0], [0.62, 0.1, 0.3], c2, "matte"),                                    // asiento
        P("box", [0.0, 0.52, 0], [0.5, 0.36, 0.3], "#5a5f6b", "metal"),                              // motor
        P("cylinder", [0.66, 0.72, 0.12], [0.06, 0.82, 0.06], "#c8ced8", "metal", [0, 0, -24]),       // horquilla
        P("cylinder", [0.66, 0.72, -0.12], [0.06, 0.82, 0.06], "#c8ced8", "metal", [0, 0, -24]),
        P("cylinder", [0.52, 1.14, 0], [0.05, 0.75, 0.05], "#15171c", "metal", [90, 0, 0]),           // manillar
        P("sphere", [0.74, 0.98, 0], [0.18, 0.18, 0.14], "#fff6d8", "light"),                         // faro
        P("cylinder", [-0.45, 0.4, 0.24], [0.09, 0.7, 0.09], "#c8ced8", "metal", [0, 0, 98]),        // escape
        P("box", [-0.74, 0.74, 0], [0.42, 0.06, 0.2], c1, "paint", [0, 0, 12]),                      // guardabarros
        P("sphere", [-0.93, 0.78, 0], [0.08, 0.06, 0.12], "#ff1a1a", "light")];
    } },
  { id: "barco", name: "Barco", emoji: "⛵", words: /\b(barco|velero|bote|lancha|nave|boat|ship)\b/, styles: [["velero", "Velero"]], colors: ["#1f5fff", "#f2f4f7"],
    build(style, c1, c2) {
      return [P("box", [0, 0.35, 0], [3, 0.6, 1.1], c1, "paint"),                                  // casco
        P("cylinder", [1.5, 0.35, 0], [1.1, 0.6, 1.1], c1, "paint", [0, 0, 0], { seg: 3 }),          // proa
        P("box", [0.1, 0.67, 0], [3.0, 0.04, 1.0], "#8a5a33", "matte"),                              // cubierta
        P("box", [-0.75, 0.92, 0], [0.9, 0.45, 0.75], c2, "paint"),                                  // cabina
        P("box", [-0.75, 0.96, 0.38], [0.7, 0.14, 0.02], "#4fc3ff", "glass"),
        P("cylinder", [0.25, 1.9, 0], [0.08, 2.5, 0.08], "#8a5a33", "matte"),                        // mástil
        P("box", [0.72, 1.85, 0], [0.86, 1.9, 0.03], c2, "matte"),                                   // vela
        P("box", [-0.12, 1.65, 0], [0.62, 1.4, 0.03], c2, "matte"),                                  // foque
        P("box", [0.38, 3.2, 0], [0.28, 0.16, 0.02], "#e3122b", "paint"),                            // bandera
        P("box", [0, 0.2, 0], [3.02, 0.08, 1.12], "#f2f4f7", "paint")];                               // franja
    } },
  { id: "flor", name: "Flor", emoji: "🌸", words: /\b(flor|flores|rosa|tulipan|tulipán|margarita|girasol|flower)\b/, styles: [["maceta", "En maceta"]], colors: ["#ff4fa3", "#ffd23f"],
    build(style, c1, c2) {
      const petals = Array.from({ length: 7 }, (_, i) => { const a = i / 7 * Math.PI * 2; return P("sphere", [Math.cos(a) * 0.32, 2.0 + Math.sin(a) * 0.32, 0], [0.36, 0.36, 0.1], c1, "paint"); });
      return [P("cylinder", [0, 0.25, 0], [0.7, 0.5, 0.7], "#c4673a", "matte"), P("cylinder", [0, 0.49, 0], [0.62, 0.04, 0.62], "#4a2f1e", "matte"),
        P("cylinder", [0, 1.25, 0], [0.07, 1.5, 0.07], "#1e9e4a", "matte"),
        P("sphere", [0.2, 1.05, 0], [0.42, 0.08, 0.2], "#1e9e4a", "matte", [0, 0, 28]), P("sphere", [-0.2, 1.35, 0], [0.42, 0.08, 0.2], "#1e9e4a", "matte", [0, 0, -28]),
        ...petals, P("sphere", [0, 2.0, 0.04], [0.28, 0.28, 0.14], c2, "paint")];
    } },
  { id: "seta", name: "Seta", emoji: "🍄", words: /\b(seta|hongo|champi[nñ]on|mushroom)\b/, styles: [["magica", "Mágica"]], colors: ["#e3122b", "#f2e6d0"],
    build(style, c1, c2) {
      const dot = (x, y, z) => P("sphere", [x, y, z], [0.2, 0.08, 0.2], "#ffffff", "matte");
      return [P("cylinder", [0, 0.5, 0], [0.55, 1, 0.55], c2, "matte"), P("sphere", [0, 1.08, 0], [1.7, 0.95, 1.7], c1, "paint"),
        P("cylinder", [0, 0.82, 0], [1.2, 0.06, 1.2], c2, "matte"),
        dot(0, 1.55, 0), dot(0.48, 1.38, 0.3), dot(-0.42, 1.36, 0.38), dot(0.12, 1.33, -0.58), dot(-0.55, 1.3, -0.28), dot(0.66, 1.2, -0.25), dot(0.05, 1.32, 0.62)];
    } },
  { id: "globo", name: "Globo aerostático", emoji: "🎈", words: /\b(globo|aerostatico|aerostático|balloon)\b/, styles: [["rayas", "A rayas"]], colors: ["#ff7a00", "#ffd23f"],
    build(style, c1, c2) {
      const rope = (x, z) => P("cylinder", [x * 0.55, 0.95, z * 0.55], [0.02, 0.7, 0.02], "#5a3a22", "matte", [z * 14, 0, -x * 14]);
      return [P("sphere", [0, 2.45, 0], [2, 2.3, 2], c1, "paint"), P("cone", [0, 1.22, 0], [1.15, 0.85, 1.15], c1, "paint", [180, 0, 0]),
        P("torus", [0, 2.45, 0], [2.02, 2.02, 0.16], c2, "paint", [90, 0, 0]), P("torus", [0, 2.95, 0], [1.7, 1.7, 0.14], c2, "paint", [90, 0, 0]),
        P("torus", [0, 1.95, 0], [1.75, 1.75, 0.14], c2, "paint", [90, 0, 0]),
        rope(1, 1), rope(-1, 1), rope(1, -1), rope(-1, -1), P("sphere", [0, 0.82, 0], [0.16, 0.16, 0.16], "#ff8a1a", "light"),
        P("box", [0, 0.28, 0], [0.62, 0.5, 0.62], "#8a5a33", "matte")];
    } },
  { id: "faro", name: "Faro", emoji: "🗼", words: /\b(faro|lighthouse)\b/, styles: [["costa", "De costa"]], colors: ["#f2f4f7", "#e3122b"],
    build(style, c1, c2) {
      return [P("cylinder", [0, 0.15, 0], [1.5, 0.3, 1.5], "#8a93a6", "matte"), P("cylinder", [0, 1.8, 0], [0.9, 3, 0.9], c1, "paint"),
        P("cylinder", [0, 1.2, 0], [0.93, 0.42, 0.93], c2, "paint"), P("cylinder", [0, 2.4, 0], [0.93, 0.42, 0.93], c2, "paint"),
        P("cylinder", [0, 3.35, 0], [1.25, 0.1, 1.25], "#2b2f38", "metal"), P("cylinder", [0, 3.66, 0], [0.62, 0.52, 0.62], "#ffe7a3", "light"),
        P("cone", [0, 4.15, 0], [0.85, 0.48, 0.85], c2, "paint"), P("box", [0, 0.75, 0.46], [0.3, 0.55, 0.02], "#2b2f38", "matte")];
    } },
  { id: "castillo", name: "Castillo", emoji: "🏰", words: /\b(castillo|fortaleza|castle|palacio)\b/, styles: [["medieval", "Medieval"]], colors: ["#a9adb5", "#1f5fff"],
    build(style, c1, c2) {
      const tower = (x, z) => [P("cylinder", [x, 1.2, z], [0.8, 2.4, 0.8], c1, "matte"), P("cone", [x, 2.85, z], [0.98, 0.95, 0.98], c2, "paint")];
      const merlons = [-1, -0.5, 0, 0.5, 1].flatMap(x => [P("box", [x, 1.72, 1], [0.24, 0.24, 0.24], c1, "matte"), P("box", [x, 1.72, -1], [0.24, 0.24, 0.24], c1, "matte")]);
      return [P("box", [0, 0.8, 0], [3, 1.6, 2], c1, "matte"), ...tower(1.5, 1), ...tower(-1.5, 1), ...tower(1.5, -1), ...tower(-1.5, -1), ...merlons,
        P("box", [0, 0.5, 1.01], [0.62, 1, 0.04], "#3a2a1c", "matte"), P("box", [0.8, 1.15, 1.01], [0.22, 0.32, 0.04], "#ffe7a3", "light"), P("box", [-0.8, 1.15, 1.01], [0.22, 0.32, 0.04], "#ffe7a3", "light"),
        P("cylinder", [0, 2.5, 0], [0.04, 1.8, 0.04], "#2b2f38", "metal"), P("box", [0.22, 3.2, 0], [0.4, 0.24, 0.02], "#e3122b", "paint")];
    } },
  { id: "taza", name: "Taza", emoji: "☕", words: /\b(taza|cafe|café|mug|cup)\b/, styles: [["cafe", "Con café"]], colors: ["#f2f4f7", "#6b3f22"],
    build(style, c1, c2) {
      return [P("cylinder", [0, 0.03, 0], [1.7, 0.06, 1.7], "#f2f4f7", "paint"), P("cylinder", [0, 0.66, 0], [1, 1.2, 1], c1, "paint"),
        P("cylinder", [0, 1.275, 0], [0.86, 0.03, 0.86], c2, "matte"), P("torus", [0.62, 0.68, 0], [0.62, 0.62, 0.13], c1, "paint"),
        P("capsule", [0.08, 1.62, 0], [0.08, 0.42, 0.08], "#ffffff", "glass", [0, 0, 12]), P("capsule", [-0.12, 1.7, 0], [0.08, 0.5, 0.08], "#ffffff", "glass", [0, 0, -10])];
    } },
  { id: "cactus", name: "Cactus", emoji: "🌵", words: /\b(cactus|nopal|desierto)\b/, styles: [["saguaro", "Saguaro"]], colors: ["#2f9e44", "#c4673a"],
    build(style, c1, c2) {
      return [P("cylinder", [0, 0.25, 0], [0.85, 0.5, 0.85], c2, "matte"), P("cylinder", [0, 0.49, 0], [0.78, 0.04, 0.78], "#d9b77a", "matte"),
        P("capsule", [0, 1.4, 0], [0.52, 1.9, 0.52], c1, "matte"),
        P("capsule", [0.32, 1.12, 0], [0.26, 0.5, 0.26], c1, "matte", [0, 0, 90]), P("capsule", [0.5, 1.48, 0], [0.3, 0.8, 0.3], c1, "matte"),
        P("capsule", [-0.3, 1.5, 0], [0.24, 0.45, 0.24], c1, "matte", [0, 0, 90]), P("capsule", [-0.47, 1.8, 0], [0.28, 0.65, 0.28], c1, "matte"),
        P("sphere", [0, 2.38, 0], [0.22, 0.12, 0.22], "#ff4fa3", "paint")];
    } },
  { id: "nube", name: "Nube", emoji: "☁", words: /\b(nube|nubes|cloud)\b/, styles: [["esponjosa", "Esponjosa"]], colors: ["#f2f4f7", "#c8ced8"],
    build(style, c1, c2) {
      return [P("sphere", [0, 1.4, 0], [1.6, 1.4, 1.3], c1, "matte"), P("sphere", [0.9, 1.2, 0.1], [1.2, 1.0, 1.0], c1, "matte"), P("sphere", [-0.9, 1.2, -0.05], [1.25, 1.0, 1.05], c1, "matte"),
        P("sphere", [0.45, 1.85, -0.1], [1.0, 0.9, 0.9], c1, "matte"), P("sphere", [-0.45, 1.8, 0.1], [0.95, 0.85, 0.85], c1, "matte"), P("sphere", [0, 1.05, 0.2], [2.2, 0.6, 1.0], c2, "matte")];
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
  return fixupRecipe({ name: String(j.name || "Objeto").slice(0, 40), source: "ai", parts });
}

/**
 * Deja bien colocado lo que diseña la IA: quita piezas diminutas, lo centra, lo apoya en
 * el suelo (y = 0) y lo escala a un tamaño cómodo (2-4 m). Así siempre se ve entero.
 */
export function fixupRecipe(rec) {
  let parts = rec.parts.filter(q => Math.max(...q.d) >= 0.02);
  if (!parts.length) parts = rec.parts;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const q of parts) for (let i = 0; i < 3; i++) {
    const half = Math.max(...q.d) / 2;   // caja que contiene la pieza aunque esté girada
    lo[i] = Math.min(lo[i], q.p[i] - (i === 1 ? q.d[1] / 2 : half)); hi[i] = Math.max(hi[i], q.p[i] + (i === 1 ? q.d[1] / 2 : half));
  }
  const size = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
  const k = size < 1.5 ? 2.5 / size : size > 5 ? 3.5 / size : 1;
  const cx = (lo[0] + hi[0]) / 2, cz = (lo[2] + hi[2]) / 2, by = lo[1];
  const r3 = (v) => Math.round(v * 1000) / 1000;
  return { ...rec, parts: parts.map(q => ({ ...q, p: [r3((q.p[0] - cx) * k), r3((q.p[1] - by) * k), r3((q.p[2] - cz) * k)], d: q.d.map(v => r3(v * k)) })) };
}

/** Instrucciones para la IA (receta JSON, nunca código). */
// Ejemplo bien hecho (una lámpara de mesa): enseña a la IA el formato y cómo componer.
const EXAMPLE = { name: "Lámpara", parts: [
  { s: "cylinder", p: [0, 0.05, 0], r: [0, 0, 0], d: [0.9, 0.1, 0.9], c: "#2b2f38", m: "metal" },
  { s: "cylinder", p: [0, 0.8, 0], r: [0, 0, 0], d: [0.08, 1.5, 0.08], c: "#c8ced8", m: "metal" },
  { s: "cone", p: [0, 1.75, 0], r: [0, 0, 0], d: [1.1, 0.6, 1.1], c: "#ffe7a3", m: "matte" },
  { s: "sphere", p: [0, 1.5, 0], r: [0, 0, 0], d: [0.3, 0.3, 0.3], c: "#fff6d8", m: "light" },
] };
const NUM3 = { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 };
export function aiPrompt(text) {
  return {
    system: "Eres un diseñador de objetos 3D: los construyes combinando formas básicas, como un juguete de bloques bien hecho y reconocible a primera vista. Respondes SOLO JSON.",
    user: `Crea un objeto 3D de: «${text}».
Reglas:
- Entre 8 y 35 piezas. Primero las grandes (cuerpo), luego los detalles que lo hacen reconocible.
- Formas (s): ${SHAPES3D.join(", ")}. Materiales (m): ${MATERIALS3D.join(", ")} (light = brilla, glass = cristal).
- Cada pieza: "p" centro [x,y,z] en metros (y hacia arriba, el objeto de pie apoyado en y=0, de 2 a 4 m), "r" giro [x,y,z] en grados, "d" tamaño [ancho,alto,fondo], "c" color "#rrggbb", "m" material.
- cylinder, cone y capsule van verticales (eje Y): gíralos con "r" para tumbarlos. torus: d = [diámetro, diámetro, grosor] y está de pie (mirando al frente).
- Lo que va a pares (ruedas, ojos, brazos, patas) debe ser simétrico en x o en z. Colores realistas.
Ejemplo (una lámpara): ${JSON.stringify(EXAMPLE)}
Responde SOLO el JSON del objeto pedido: {"name": "nombre corto en español", "parts": [...]}`,
    schema: { type: "object", required: ["name", "parts"], properties: {
      name: { type: "string" },
      parts: { type: "array", minItems: 4, maxItems: 40, items: { type: "object", required: ["s", "p", "d", "c", "m"], properties: {
        s: { type: "string", enum: SHAPES3D.filter(x => x !== "text") }, p: NUM3, r: NUM3, d: NUM3, c: { type: "string" }, m: { type: "string", enum: MATERIALS3D } } } } } },
    maxTokens: 3000,
  };
}

/** Ideas para los botones rápidos. */
export const IDEAS3D = OBJECTS3D.map(o => ({ id: o.id, label: `${o.emoji} ${o.name}` }));
