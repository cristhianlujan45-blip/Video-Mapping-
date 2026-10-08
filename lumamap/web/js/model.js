// web/js/model.js
// Modelo de datos de LumaMap v2.
//
//   Proyecto ─┬─ surfaces[]  geometría (dónde se proyecta): quad/malla o polígono
//             └─ scenes[]    contenido (qué se proyecta): un "look" por superficie
//
// El mapeo se ajusta una sola vez y cada escena cambia solo el contenido,
// como en los media servers profesionales. Funciona en navegador y en Node.
import { gridFromCorners, regularPolygon, starPolygon } from "./math.js";

export const VERSION = 2;

let uidCounter = 1;
export function uid(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}${(uidCounter++).toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/* ---------------- Catálogos ---------------- */

/** Generadores procedurales (shader en GPU, parámetros en vivo). */
export const GENERATORS = [
  { id: "plasma",   name: "Plasma" },
  { id: "rainbow",  name: "Arcoíris" },
  { id: "tunnel",   name: "Túnel" },
  { id: "rings",    name: "Ondas" },
  { id: "stripes",  name: "Rayas" },
  { id: "checker",  name: "Damero" },
  { id: "clouds",   name: "Nubes" },
  { id: "fire",     name: "Fuego" },
  { id: "stars",    name: "Estrellas" },
  { id: "spiral",   name: "Espiral" },
  { id: "sweep",    name: "Láser" },
  { id: "grid",     name: "Neón grid" },
  { id: "waves",    name: "Líneas" },
  { id: "gradient", name: "Degradado" },
  { id: "bricks",   name: "Ladrillos" },
  { id: "calib",    name: "Calibrar" },
  { id: "matrix",   name: "Matrix" },
  { id: "vortex",   name: "Vórtice" },
  { id: "hexgrid",  name: "Hexágonos" },
  { id: "cells",    name: "Celdas" },
  { id: "aurora",   name: "Aurora" },
  { id: "lava",     name: "Lava" },
  { id: "water",    name: "Agua" },
  { id: "eq",       name: "Ecualizador ♪" },
  { id: "audiorings", name: "Anillos ♪" },
  { id: "rays",     name: "Rayos de luz" },
  { id: "confetti", name: "Confeti" },
  { id: "snow",     name: "Nieve" },
  { id: "rain",     name: "Lluvia" },
  { id: "lightning", name: "Relámpago" },
  { id: "galaxy",   name: "Galaxia" },
  { id: "mandala",  name: "Mandala" },
  { id: "truchet",  name: "Laberinto" },
  { id: "opart",    name: "Op-art" },
  { id: "moire",    name: "Moiré" },
  { id: "hearts",   name: "Corazones" },
  { id: "fireworks", name: "Fuegos artificiales" },
  { id: "synthwave", name: "Synthwave" },
  { id: "glitchblocks", name: "Bloques glitch" },
  { id: "static",   name: "Estática TV" },
  { id: "sweepbars", name: "Barrido" },
  { id: "beatflash", name: "Destello ♪" },
  { id: "squares",  name: "Cuadrados" },
  { id: "chevrons", name: "Flechas" },
  { id: "dots",     name: "Puntos" },
  { id: "fluid",    name: "Fluido" },
  { id: "boxtunnel", name: "Túnel cuadrado" },
  { id: "circuit",  name: "Circuito" },
  { id: "bubbles",  name: "Burbujas" },
  { id: "smoke",    name: "Humo" },
  { id: "ocean",    name: "Océano" },
  { id: "sunset",   name: "Atardecer" },
  { id: "neonwaves", name: "Ondas neón" },
  { id: "floor3d",  name: "Suelo 3D" },
  { id: "spheres",  name: "Esferas" },
  { id: "triangles", name: "Triángulos" },
  { id: "scales",   name: "Escamas" },
  { id: "ledcurtain", name: "Cortina LED ♪" },
  { id: "blinds",   name: "Persiana" },
  { id: "diagsweep", name: "Barrido diagonal" },
  { id: "radar",    name: "Radar" },
  { id: "heartbeat", name: "Pulso cardíaco" },
  { id: "crosslasers", name: "Láseres cruzados" },
  { id: "phyllo",   name: "Espiral de puntos" },
  { id: "interference", name: "Interferencia" },
  { id: "conic",    name: "Arcoíris circular" },
  { id: "argyle",   name: "Rombos" },
  { id: "colorfog", name: "Neblina de color" },
  { id: "fallblocks", name: "Bloques que caen" },
  { id: "shooting", name: "Estrellas fugaces" },
  { id: "electric", name: "Electricidad" },
  { id: "windows",  name: "Ventanas" },
  { id: "hypno",    name: "Hipnosis" },
  { id: "warp",     name: "Hiperespacio" },
  { id: "blackhole", name: "Agujero negro" },
  { id: "dna",      name: "ADN" },
  { id: "julia",    name: "Fractal" },
  { id: "metaballs", name: "Lámpara de lava" },
  { id: "chrome",   name: "Metal líquido" },
  { id: "discoball", name: "Bola disco" },
  { id: "portal",   name: "Portal" },
  { id: "voronoi",  name: "Células neón" },
  { id: "dvd",      name: "Logo rebotando" },
  { id: "lissajous", name: "Osciloscopio" },
  { id: "pixeleq",  name: "Ecualizador pixel ♪" },
  { id: "rgbglitch", name: "Glitch RGB" },
  { id: "kaleidolive", name: "Caleidoscopio vivo" },
  { id: "rainbowroad", name: "Carretera arcoíris" },
  { id: "infzoom",  name: "Zoom infinito" },
  { id: "lasershow", name: "Show de láseres ♪" },
  { id: "circleviz", name: "Visualizador circular ♪" },
  { id: "particles", name: "Flujo de partículas" },
];
/**
 * Catálogo de animaciones: cada una combina una animación base con su paleta,
 * velocidad, escala y, a veces, un efecto. Organizado por categorías para
 * encontrarlo rápido (más de 180).
 */
const AL = [];
const ani = (cat, name, gen, color, color2, speed = 1, scale = 1, fx = null) =>
  AL.push({ id: "a" + AL.length, cat, name, gen, color, color2, speed, scale, fx });
// Virales 🔥 (lo que más se ve en redes y en shows)
ani("Virales 🔥", "Hipnosis", "hypno", "#ffffff", "#000000");
ani("Virales 🔥", "Hipnosis neón", "hypno", "#ff00aa", "#00e5ff", 1.3);
ani("Virales 🔥", "Hiperespacio", "warp", "#9fd8ff", "#000000");
ani("Virales 🔥", "Salto a la velocidad luz", "warp", "#ffffff", "#1a0033", 2);
ani("Virales 🔥", "Agujero negro", "blackhole", "#ffb000", "#ff3c00");
ani("Virales 🔥", "Agujero de gusano", "blackhole", "#00e5ff", "#7a00ff", 1.4);
ani("Virales 🔥", "Portal", "portal", "#00ff9c", "#003a2a");
ani("Virales 🔥", "Portal de fuego", "portal", "#ffcc00", "#ff2d00", 1.3);
ani("Virales 🔥", "Lámpara de lava", "metaballs", "#ff6a00", "#3a0010");
ani("Virales 🔥", "Lámpara de lava azul", "metaballs", "#00e5ff", "#000a40");
ani("Virales 🔥", "Metal líquido", "chrome", "#c8d6ff", "#20203a");
ani("Virales 🔥", "Oro líquido", "chrome", "#ffcc33", "#3a2000");
ani("Virales 🔥", "Logo DVD rebotando", "dvd", "#ffffff", "#000000");
ani("Virales 🔥", "Zoom infinito", "infzoom", "#ffffff", "#000000");
ani("Virales 🔥", "Zoom infinito color", "infzoom", "#ff00aa", "#00e5ff", 1.4, 1, { hueCycle: 0.6 });
ani("Virales 🔥", "Carretera arcoíris", "rainbowroad", "#ffffff", "#14002a");
ani("Virales 🔥", "Glitch RGB", "rgbglitch", "#ffffff", "#000000");
ani("Virales 🔥", "Glitch vaporwave", "rgbglitch", "#ff71ce", "#01cdfe", 1, 1, { scanlines: 0.6 });
ani("Virales 🔥", "Fractal infinito", "julia", "#00e5ff", "#ff00aa");
ani("Virales 🔥", "Fractal dorado", "julia", "#ffcc00", "#3a1000", 0.7);
ani("Virales 🔥", "Caleidoscopio vivo", "kaleidolive", "#ff3cac", "#2b86c5");
ani("Virales 🔥", "Caleidoscopio psicodélico", "kaleidolive", "#b6ff00", "#7a00ff", 1.5, 1, { hueCycle: 0.8 });
ani("Virales 🔥", "Visualizador circular", "circleviz", "#00e5ff", "#000000");
ani("Virales 🔥", "Show de láseres", "lasershow", "#00ff3c", "#000000");
// Nuevas ✨
ani("Nuevas ✨", "ADN", "dna", "#00e5ff", "#ff00aa");
ani("Nuevas ✨", "ADN verde", "dna", "#00ff66", "#ffffff", 0.7);
ani("Nuevas ✨", "Bola disco", "discoball", "#ffffff", "#0a0014");
ani("Nuevas ✨", "Bola disco de colores", "discoball", "#ff00aa", "#000000", 1.5);
ani("Nuevas ✨", "Células neón", "voronoi", "#00e5ff", "#7a00ff");
ani("Nuevas ✨", "Células de lava", "voronoi", "#ffcc00", "#ff2d00", 0.7, 0.7);
ani("Nuevas ✨", "Osciloscopio", "lissajous", "#00ff66", "#000000");
ani("Nuevas ✨", "Osciloscopio retro", "lissajous", "#ffb000", "#100800", 1, 1, { crt: 0.6, scanlines: 0.5 });
ani("Nuevas ✨", "Ecualizador pixel", "pixeleq", "#00ff66", "#ff2d55");
ani("Nuevas ✨", "Ecualizador pixel azul", "pixeleq", "#00e5ff", "#bf5af2", 1.3);
ani("Nuevas ✨", "Flujo de partículas", "particles", "#00e5ff", "#ff00aa");
ani("Nuevas ✨", "Luciérnagas", "particles", "#ffee66", "#0a1a00", 0.5, 0.7);
ani("Nuevas ✨", "Láseres azules", "lasershow", "#00a2ff", "#ff00aa", 1.3);
ani("Nuevas ✨", "Visualizador arcoíris", "circleviz", "#ffffff", "#000000", 1.5, 1.2, { hueCycle: 1 });
ani("Nuevas ✨", "Túnel hipnótico", "hypno", "#00ff9c", "#000000", 0.6, 2);
ani("Nuevas ✨", "Galaxia de lava", "metaballs", "#ff00aa", "#000000", 0.6, 0.7);
// Abstracto
ani("Abstracto", "Plasma eléctrico", "plasma", "#00e5ff", "#ff00aa");
ani("Abstracto", "Plasma fuego", "plasma", "#ffcc00", "#ff2d55", 1.3);
ani("Abstracto", "Plasma océano", "plasma", "#00ffd0", "#002a6a", 0.7);
ani("Abstracto", "Plasma ácido", "plasma", "#b6ff00", "#7a00ff", 1.6, 1.5);
ani("Abstracto", "Fluido", "fluid", "#ff3cac", "#2b86c5");
ani("Abstracto", "Fluido tropical", "fluid", "#ffcc00", "#00e5a0", 1.4);
ani("Abstracto", "Fluido nocturno", "fluid", "#5b2cff", "#000a2a", 0.6);
ani("Abstracto", "Lava", "lava", "#ffcc00", "#ff2d00");
ani("Abstracto", "Lava fría", "lava", "#00e5ff", "#1a0066", 0.8);
ani("Abstracto", "Nubes", "clouds", "#ffffff", "#0a84ff", 0.6);
ani("Abstracto", "Nubes rosas", "clouds", "#ff9ad5", "#3a0d5c", 0.8);
ani("Abstracto", "Degradado vivo", "gradient", "#ff2d55", "#0a84ff");
ani("Abstracto", "Degradado suave", "gradient", "#ffd6a5", "#a0c4ff", 0.4);
ani("Abstracto", "Neblina de color", "colorfog", "#ffffff", "#000000");
ani("Abstracto", "Neblina lenta", "colorfog", "#ffffff", "#000000", 0.4, 1.5);
ani("Abstracto", "Aurora boreal", "aurora", "#00ff9c", "#7a00ff");
ani("Abstracto", "Aurora rosa", "aurora", "#ff3cac", "#00e5ff", 1.4);
ani("Abstracto", "Celdas vivas", "cells", "#ff00aa", "#00e5ff");
ani("Abstracto", "Vitral", "cells", "#ffcc00", "#bf5af2", 0.6, 1.8);
ani("Abstracto", "Interferencia", "interference", "#00e5ff", "#000000");
ani("Abstracto", "Moiré", "moire", "#ffffff", "#000000");
ani("Abstracto", "Moiré de color", "moire", "#ff2d8a", "#00e5ff", 1.5, 0.7);
// Geométrico
ani("Geométrico", "Rayas", "stripes", "#ff00aa", "#220033");
ani("Geométrico", "Rayas de caramelo", "stripes", "#ffffff", "#ff2d55", 1.5, 1.5);
ani("Geométrico", "Damero", "checker", "#00e5ff", "#ff00aa");
ani("Geométrico", "Damero B/N", "checker", "#ffffff", "#000000", 0.5);
ani("Geométrico", "Hexágonos", "hexgrid", "#00e5ff", "#000a2a");
ani("Geométrico", "Panal dorado", "hexgrid", "#ffcc00", "#2a1400", 0.7, 1.5);
ani("Geométrico", "Triángulos", "triangles", "#ff2d8a", "#00e5ff");
ani("Geométrico", "Triángulos pastel", "triangles", "#ffd6a5", "#a0c4ff", 0.6, 1.4);
ani("Geométrico", "Escamas", "scales", "#00e5a0", "#0a3a5a");
ani("Geométrico", "Escamas de sirena", "scales", "#ff7ae0", "#5b2cff", 1.4, 0.8);
ani("Geométrico", "Rombos", "argyle", "#ff2d55", "#1a0033");
ani("Geométrico", "Cuadrados concéntricos", "squares", "#00e5ff", "#000000");
ani("Geométrico", "Cuadrados de fuego", "squares", "#ffcc00", "#ff2d00", 1.5);
ani("Geométrico", "Flechas", "chevrons", "#ffcc00", "#000000");
ani("Geométrico", "Flechas neón", "chevrons", "#00e5ff", "#ff00aa", 1.6, 0.7);
ani("Geométrico", "Puntos", "dots", "#00e5ff", "#000000");
ani("Geométrico", "Puntos pop", "dots", "#ff2d55", "#ffcc00", 1.3, 0.7);
ani("Geométrico", "Laberinto", "truchet", "#00e5ff", "#000000");
ani("Geométrico", "Laberinto dorado", "truchet", "#ffcc00", "#1a0a00", 0.7, 1.4);
ani("Geométrico", "Op-art", "opart", "#ffffff", "#000000");
ani("Geométrico", "Op-art de color", "opart", "#ff00aa", "#00e5ff", 1.3);
ani("Geométrico", "Ondas", "rings", "#00e5ff", "#ff00aa");
ani("Geométrico", "Ondas hipnóticas", "rings", "#ffffff", "#000000", 1.6, 1.5);
ani("Geométrico", "Espiral", "spiral", "#ff00aa", "#00e5ff");
ani("Geométrico", "Espiral hipnótica", "spiral", "#ffffff", "#000000", 1.8, 1.5);
ani("Geométrico", "Mandala", "mandala", "#ffcc00", "#7a00ff");
ani("Geométrico", "Mandala de hielo", "mandala", "#ffffff", "#0a84ff", 0.7);
ani("Geométrico", "Esferas", "spheres", "#ff2d55", "#00e5ff");
ani("Geométrico", "Perlas", "spheres", "#ffffff", "#ffd6a5", 0.6, 1.5);
ani("Geométrico", "Espiral de puntos", "phyllo", "#ffffff", "#000000");
ani("Geométrico", "Arcoíris circular", "conic", "#ffffff", "#000000");
ani("Geométrico", "Suelo 3D", "floor3d", "#ff00aa", "#000000");
ani("Geométrico", "Suelo 3D cian", "floor3d", "#00e5ff", "#0a0014", 1.6, 0.7);
// Naturaleza
ani("Naturaleza", "Fuego", "fire", "#ffcc00", "#ff2d55");
ani("Naturaleza", "Fuego azul", "fire", "#66e0ff", "#1a33ff", 1.2);
ani("Naturaleza", "Fuego verde", "fire", "#ccff66", "#00a83a", 1.2);
ani("Naturaleza", "Agua", "water", "#bff6ff", "#0a5a8a");
ani("Naturaleza", "Piscina", "water", "#ffffff", "#00b4d8", 0.7, 0.8);
ani("Naturaleza", "Océano", "ocean", "#ffb347", "#004e92");
ani("Naturaleza", "Mar nocturno", "ocean", "#c3d9ff", "#000c2a", 0.6);
ani("Naturaleza", "Atardecer", "sunset", "#ff5e3a", "#2a0845");
ani("Naturaleza", "Amanecer", "sunset", "#ffd166", "#5d9cec", 0.5);
ani("Naturaleza", "Humo", "smoke", "#d0d0d0", "#000000");
ani("Naturaleza", "Humo de colores", "smoke", "#ff3cac", "#120020", 1.3);
ani("Naturaleza", "Nieve", "snow", "#ffffff", "#0a2a4a");
ani("Naturaleza", "Ventisca", "snow", "#ffffff", "#334455", 2.2, 1.4);
ani("Naturaleza", "Lluvia", "rain", "#9ad1ff", "#05101f");
ani("Naturaleza", "Tormenta", "lightning", "#e0e8ff", "#1a1a3a");
ani("Naturaleza", "Relámpagos violetas", "lightning", "#e2b6ff", "#14002a", 1.6);
ani("Naturaleza", "Burbujas", "bubbles", "#bff6ff", "#002a4a");
ani("Naturaleza", "Burbujas de jabón", "bubbles", "#ff9ad5", "#1a0033", 0.7, 0.8);
ani("Naturaleza", "Electricidad", "electric", "#66e0ff", "#000010");
ani("Naturaleza", "Rayo de plasma", "electric", "#ff66ff", "#0a0014", 1.5);
// Espacio
ani("Espacio", "Estrellas", "stars", "#ffffff", "#0a84ff");
ani("Espacio", "Cielo dorado", "stars", "#ffd166", "#2a1a00", 0.6, 1.4);
ani("Espacio", "Estrellas fugaces", "shooting", "#ffffff", "#020617");
ani("Espacio", "Lluvia de meteoros", "shooting", "#ffcc66", "#0a0014", 2.2);
ani("Espacio", "Galaxia", "galaxy", "#bfa8ff", "#00e5ff");
ani("Espacio", "Galaxia de fuego", "galaxy", "#ffcc00", "#ff2d55", 1.3);
ani("Espacio", "Túnel", "tunnel", "#00e5ff", "#ff00aa");
ani("Espacio", "Túnel del tiempo", "tunnel", "#ffffff", "#5b2cff", 2, 1.4);
ani("Espacio", "Túnel cuadrado", "boxtunnel", "#ff00aa", "#00e5ff");
ani("Espacio", "Hiperespacio", "boxtunnel", "#ffffff", "#000000", 2.5, 1.5);
ani("Espacio", "Vórtice", "vortex", "#00e5ff", "#000000");
ani("Espacio", "Agujero negro", "vortex", "#ff7a00", "#000000", 1.5, 0.7);
// Neón y retro
ani("Neón y retro", "Neón grid", "grid", "#00e5ff", "#000000");
ani("Neón y retro", "Grid rosa", "grid", "#ff00aa", "#0a0014", 1.4, 0.7);
ani("Neón y retro", "Synthwave", "synthwave", "#ff00aa", "#3a0066");
ani("Neón y retro", "Outrun", "synthwave", "#00e5ff", "#14002a", 1.6);
ani("Neón y retro", "Líneas", "waves", "#00e5ff", "#000000");
ani("Neón y retro", "Ondas neón", "neonwaves", "#ffffff", "#000000");
ani("Neón y retro", "Matrix", "matrix", "#00ff66", "#000000");
ani("Neón y retro", "Matrix azul", "matrix", "#00e5ff", "#000000", 1.4);
ani("Neón y retro", "Circuito", "circuit", "#00e5ff", "#000000");
ani("Neón y retro", "Circuito dorado", "circuit", "#ffcc00", "#100800", 1.5);
ani("Neón y retro", "Estática de TV", "static", "#ffffff", "#000000");
ani("Neón y retro", "Bloques glitch", "glitchblocks", "#ff00aa", "#00e5ff");
ani("Neón y retro", "Bloques que caen", "fallblocks", "#00e5ff", "#ff00aa");
ani("Neón y retro", "Ladrillos", "bricks", "#ff9500", "#1a0a00");
ani("Neón y retro", "Ladrillos neón", "bricks", "#00e5ff", "#000a14", 1.5);
ani("Neón y retro", "Arcoíris", "rainbow", "#ffffff", "#000000");
ani("Neón y retro", "Arcoíris rápido", "rainbow", "#ffffff", "#000000", 3, 2);
// Luces y show
ani("Luces y show", "Láser", "sweep", "#00ff66", "#000000");
ani("Luces y show", "Láser rojo", "sweep", "#ff2d55", "#000000", 1.8, 0.6);
ani("Luces y show", "Láseres cruzados", "crosslasers", "#00ff66", "#ff00aa");
ani("Luces y show", "Láseres azules", "crosslasers", "#00e5ff", "#0a84ff", 1.6);
ani("Luces y show", "Rayos de luz", "rays", "#ffd166", "#000000");
ani("Luces y show", "Rayos de colores", "rays", "#ff00aa", "#00e5ff", 1.6, 1.5);
ani("Luces y show", "Barrido", "sweepbars", "#ffffff", "#000000");
ani("Luces y show", "Barrido de color", "sweepbars", "#ff00aa", "#000000", 1.5);
ani("Luces y show", "Barrido diagonal", "diagsweep", "#00e5ff", "#000000");
ani("Luces y show", "Persiana", "blinds", "#ffffff", "#000000");
ani("Luces y show", "Persiana de color", "blinds", "#ff2d55", "#0a84ff", 2);
ani("Luces y show", "Cortina LED", "ledcurtain", "#00e5ff", "#ff00aa");
ani("Luces y show", "Cortina dorada", "ledcurtain", "#ffcc00", "#ff7a00", 1.4);
ani("Luces y show", "Radar", "radar", "#00ff66", "#001a08");
ani("Luces y show", "Pulso cardíaco", "heartbeat", "#ff2d55", "#200006");
ani("Luces y show", "Ventanas encendidas", "windows", "#ffd166", "#101820");
ani("Luces y show", "Edificio de neón", "windows", "#00e5ff", "#0a0014", 2);
ani("Luces y show", "Estroboscopio blanco", "beatflash", "#ffffff", "#ffffff", 1, 1, { strobe: 8 });
ani("Luces y show", "Estroboscopio de color", "rainbow", "#ffffff", "#000000", 2, 1, { strobe: 6 });
// Fiesta
ani("Fiesta", "Confeti", "confetti", "#ffffff", "#000000");
ani("Fiesta", "Confeti dorado", "confetti", "#ffcc00", "#100800", 1.5, 1.3, { hue: 0.1 });
ani("Fiesta", "Fuegos artificiales", "fireworks", "#ffffff", "#000000");
ani("Fiesta", "Fuegos rápidos", "fireworks", "#ffffff", "#0a0014", 2);
ani("Fiesta", "Corazones", "hearts", "#ff2d55", "#200010");
ani("Fiesta", "Corazones pastel", "hearts", "#ff9ad5", "#ffe4f1", 0.7, 0.8);
ani("Fiesta", "Disco", "checker", "#ff00aa", "#00e5ff", 2, 1.5, { hueCycle: 2 });
ani("Fiesta", "Bola de espejos", "dots", "#ffffff", "#0a0a0a", 2, 0.6, { hueCycle: 1, kaleido: 8 });
// Música ♪ (reaccionan al micrófono o al tempo)
ani("Música ♪", "Ecualizador", "eq", "#00e5ff", "#ff00aa");
ani("Música ♪", "Ecualizador fuego", "eq", "#ffcc00", "#ff2d00");
ani("Música ♪", "Anillos al ritmo", "audiorings", "#00e5ff", "#000000");
ani("Música ♪", "Anillos rosas", "audiorings", "#ff00aa", "#14002a", 1.5);
ani("Música ♪", "Destello al golpe", "beatflash", "#ffffff", "#00e5ff");
ani("Música ♪", "Destello de colores", "beatflash", "#ff00aa", "#ffcc00");
ani("Música ♪", "Cortina al ritmo", "ledcurtain", "#00ff66", "#00e5ff", 1.5);
ani("Música ♪", "Cuadrados al golpe", "squares", "#ffffff", "#000000", 1.2);
ani("Música ♪", "Corazón al ritmo", "hearts", "#ff2d55", "#000000", 1, 0.4);
// Calibración y pruebas
ani("Calibración", "Calibrar", "calib", "#00e5ff", "#000000");
ani("Calibración", "Calibrar blanco", "calib", "#ffffff", "#000000");
ani("Calibración", "Damero de ajuste", "checker", "#ffffff", "#000000", 0, 2);
ani("Calibración", "Rejilla blanca", "grid", "#ffffff", "#000000", 0, 1.5);

export const ANIM_LIBRARY = AL;
export const ANIM_CATEGORIES = [...new Set(AL.map(x => x.cat))];

export const GEN_INDEX = Object.fromEntries(GENERATORS.map((g, i) => [g.id, i]));

export const BLEND_MODES = [
  ["normal", "Normal"], ["add", "Sumar"], ["screen", "Trama"], ["multiply", "Multiplicar"],
];

export const BORDER_ANIMS = [
  ["none", "Fijo"], ["chase", "Persecución"], ["pulse", "Pulso"], ["rainbow", "Arcoíris"],
];

export const AUDIO_TARGETS = [
  ["brightness", "Brillo"], ["opacity", "Opacidad"], ["scale", "Zoom"],
  ["hue", "Color"], ["border", "Borde"], ["strobe", "Destello"],
];
export const AUDIO_BANDS = [["bass", "Graves"], ["mid", "Medios"], ["high", "Agudos"], ["level", "Volumen"]];

export const PALETTE = [
  "#ffffff", "#ff2d55", "#ff9500", "#ffcc00", "#34c759", "#00e5ff",
  "#0a84ff", "#bf5af2", "#ff00aa", "#000000",
];

export const DRAW_TOOLS = [
  ["neon", "Neón"], ["pen", "Pincel"], ["line", "Línea"], ["rect", "Rectángulo"],
  ["ellipse", "Círculo"], ["eraser", "Borrar"],
];
export const DRAW_ANIMS = [
  ["none", "Fijo"], ["draw", "Trazar"], ["flow", "Flujo"], ["pulse", "Pulso"],
  ["rainbow", "Arcoíris"], ["blink", "Parpadeo"],
];

/* ---------------- Contenido (look) ---------------- */

export const DEFAULT_FX = () => ({
  brightness: 1, contrast: 1, saturation: 1, hue: 0, invert: false,
  rgbShift: 0, pixelate: 0, blur: 0, noise: 0,
  kaleido: 0, mirror: "none", wave: 0,
  zoom: 1, rotate: 0, spin: 0, scrollX: 0, scrollY: 0,
  strobe: 0,
  border: 0, borderColor: "#00e5ff", borderAnim: "none", borderGlow: 0.5,
  // Distorsión
  twirl: 0, bulge: 0, ripple: 0, tile: 1, polar: false, glitch: 0, chroma: 0, crt: 0, shake: 0,
  // Color y estilo
  gamma: 1, posterize: 0, sepia: 0, threshold: 0, hueCycle: 0, colormap: "none",
  duotone: 0, duoA: "#1a0033", duoB: "#00e5ff",
  vignette: 0, scanlines: 0, halftone: 0, edges: 0, sharpen: 0, emboss: 0,
  // Cámara y recortes
  flipX: false, flipY: false, chromaKey: 0, keyColor: "#00ff00", keySoft: 0.1, lumaKey: 0, lumaSoft: 0.05,
});

export const COLORMAPS = [
  ["none", "Normal"], ["thermal", "Térmica"], ["night", "Visión nocturna"], ["xray", "Rayos X"],
  ["gold", "Oro"], ["rainbow", "Arcoíris"], ["ice", "Hielo"],
];

export const DEFAULT_SOURCE = () => ({
  type: "none",          // none | media | gen | color | text | drawing | camera
  mediaId: null,
  gen: "plasma", color: "#00e5ff", color2: "#ff00aa", speed: 1, scale: 1,
  text: "LUMAMAP", font: "Impact, 'Arial Black', sans-serif", textColor: "#ffffff", textBg: "#00000000",
  textAnim: "none", textSpeed: 1, textGlow: 0, textOutline: 0, textOutlineColor: "#000000", textColor2: "#ffcc00",
  bodyMode: "silueta", bodyGlow: 0, bodyTrail: 0, bodyMirror: false, bodySens: 0.5, camId: "",
  strokes: [],
});

export function createLook(source = {}) {
  return {
    source: { ...DEFAULT_SOURCE(), ...source },
    fit: "stretch",       // stretch | cover | contain
    opacity: 1, blend: "normal", hidden: false,
    volume: 0, rate: 1,
    fx: DEFAULT_FX(),
    audio: { enabled: false, band: "bass", target: "brightness", amount: 1 },
  };
}

/**
 * Biblioteca de efectos: combinaciones listas de los parámetros del shader,
 * por categorías. Todo en GPU y en tiempo real, sobre cualquier contenido
 * (video, imagen, cámara, animación, texto o dibujo).
 */
const L = [];
const P = (cat, name, fx) => L.push({ cat, name, fx });
// Color
P("Color", "Limpio", {});
P("Color", "Blanco y negro", { saturation: 0, contrast: 1.15 });
P("Color", "Negativo", { invert: true });
P("Color", "Sepia", { sepia: 1 });
P("Color", "Vintage", { sepia: 0.6, contrast: 0.9, vignette: 0.6, noise: 0.08 });
P("Color", "Cálido", { hue: 0.97, saturation: 1.25, brightness: 1.05, duotone: 0.15, duoA: "#3a0a00", duoB: "#ffcc66" });
P("Color", "Frío", { duotone: 0.3, duoA: "#000022", duoB: "#66ccff", saturation: 0.8 });
P("Color", "Pastel", { saturation: 0.55, brightness: 1.15, contrast: 0.8, gamma: 1.2 });
P("Color", "Saturado", { saturation: 2.2, contrast: 1.2 });
P("Color", "Alto contraste", { contrast: 1.8, saturation: 1.2 });
P("Color", "Neón", { saturation: 1.8, contrast: 1.3, border: 0.02, borderAnim: "pulse", borderGlow: 1 });
P("Color", "Arcoíris en movimiento", { hueCycle: 1.5, saturation: 1.6 });
P("Color", "Ciclo de color lento", { hueCycle: 0.4 });
P("Color", "Duotono rosa/cian", { duotone: 1, duoA: "#2b0040", duoB: "#00f0ff" });
P("Color", "Duotono oro", { duotone: 1, duoA: "#120800", duoB: "#ffd060" });
P("Color", "Duotono ácido", { duotone: 1, duoA: "#001a00", duoB: "#b6ff00" });
P("Color", "Duotono fuego", { duotone: 1, duoA: "#200000", duoB: "#ff7a00" });
P("Color", "Duotono océano", { duotone: 1, duoA: "#000a2a", duoB: "#00ffd0" });
P("Color", "Duotono púrpura", { duotone: 1, duoA: "#0a0014", duoB: "#c37bff" });
P("Color", "Posterizar", { posterize: 4 });
P("Color", "Pop art", { posterize: 3, saturation: 2.2, contrast: 1.3 });
P("Color", "Umbral B/N", { threshold: 0.5 });
P("Color", "Silueta", { threshold: 0.35, invert: true });
P("Color", "Térmica", { colormap: "thermal" });
P("Color", "Visión nocturna", { colormap: "night", vignette: 0.8, noise: 0.1 });
P("Color", "Rayos X", { colormap: "xray", contrast: 1.3 });
P("Color", "Oro", { colormap: "gold", contrast: 1.2 });
P("Color", "Mapa arcoíris", { colormap: "rainbow" });
P("Color", "Hielo", { colormap: "ice" });
P("Color", "Brillante", { brightness: 1.4, gamma: 1.2 });
P("Color", "Oscuro dramático", { brightness: 0.75, contrast: 1.5, vignette: 1 });
// Retro
P("Retro", "VHS", { blur: 0.4, saturation: 0.7, noise: 0.18, rgbShift: 0.004, contrast: 0.92, wave: 0.15, scanlines: 0.4 });
P("Retro", "TV antigua", { crt: 0.6, scanlines: 0.8, vignette: 0.8, noise: 0.12, saturation: 0.6 });
P("Retro", "Monitor CRT", { crt: 0.4, scanlines: 0.5, chroma: 0.006, vignette: 0.5 });
P("Retro", "Película antigua", { sepia: 0.8, noise: 0.22, vignette: 0.9, contrast: 1.1, shake: 0.3 });
P("Retro", "Polaroid", { sepia: 0.25, brightness: 1.1, contrast: 0.85, vignette: 0.4, saturation: 0.8 });
P("Retro", "Periódico", { halftone: 1, saturation: 0 });
P("Retro", "Cómic semitono", { halftone: 0.8, posterize: 4, saturation: 1.6 });
P("Retro", "Arcade 8 bits", { pixelate: 0.75, posterize: 4, saturation: 1.5 });
P("Retro", "Game Boy", { pixelate: 0.7, duotone: 1, duoA: "#0f380f", duoB: "#9bbc0f", posterize: 4 });
P("Retro", "Cine mudo", { saturation: 0, contrast: 1.4, noise: 0.25, vignette: 1, shake: 0.4 });
P("Retro", "Synthwave", { duotone: 0.6, duoA: "#2a0050", duoB: "#ff3cac", scanlines: 0.3, border: 0.01, borderColor: "#ff3cac", borderGlow: 1 });
// Glitch
P("Glitch", "Glitch", { rgbShift: 0.012, noise: 0.25, glitch: 0.4 });
P("Glitch", "Glitch fuerte", { rgbShift: 0.02, glitch: 1, noise: 0.35, pixelate: 0.2 });
P("Glitch", "Separación RGB", { rgbShift: 0.01 });
P("Glitch", "Aberración cromática", { chroma: 0.02 });
P("Glitch", "Interferencia", { glitch: 0.6, scanlines: 0.6, noise: 0.2 });
P("Glitch", "Señal perdida", { noise: 0.5, glitch: 0.8, saturation: 0.3, scanlines: 0.9 });
P("Glitch", "Temblor", { shake: 1 });
P("Glitch", "Terremoto", { shake: 3, rgbShift: 0.006 });
P("Glitch", "Datos corruptos", { pixelate: 0.5, glitch: 0.7, posterize: 3, hueCycle: 2 });
P("Glitch", "Digital", { pixelate: 0.35, chroma: 0.012, scanlines: 0.4 });
// Distorsión
P("Distorsión", "Ondas", { wave: 0.6 });
P("Distorsión", "Ondas fuertes", { wave: 1.8 });
P("Distorsión", "Remolino", { twirl: 1 });
P("Distorsión", "Remolino fuerte", { twirl: 2.5 });
P("Distorsión", "Ojo de pez", { bulge: 0.8 });
P("Distorsión", "Pellizco", { bulge: -0.8 });
P("Distorsión", "Gota de agua", { ripple: 1 });
P("Distorsión", "Estanque", { ripple: 2, wave: 0.3 });
P("Distorsión", "Túnel polar", { polar: true });
P("Distorsión", "Túnel giratorio", { polar: true, scrollY: 0.3, spin: 0.5 });
P("Distorsión", "Mosaico 2×2", { tile: 2 });
P("Distorsión", "Mosaico 3×3", { tile: 3 });
P("Distorsión", "Mosaico 4×4", { tile: 4 });
P("Distorsión", "Mosaico 8×8", { tile: 8 });
P("Distorsión", "Pixel", { pixelate: 0.6 });
P("Distorsión", "Pixel grande", { pixelate: 0.9 });
P("Distorsión", "Espejo ↔", { mirror: "h" });
P("Distorsión", "Espejo ↕", { mirror: "v" });
P("Distorsión", "Espejo cuádruple", { mirror: "quad" });
P("Distorsión", "Desenfoque", { blur: 1 });
P("Distorsión", "Sueño", { blur: 0.8, brightness: 1.2, saturation: 1.3, vignette: 0.5 });
// Caleidoscopio
for (const n of [3, 4, 5, 6, 8, 10, 12, 16]) P("Caleidoscopio", `Caleidoscopio ${n}`, { kaleido: n });
P("Caleidoscopio", "Caleidoscopio giratorio", { kaleido: 6, spin: 0.3 });
P("Caleidoscopio", "Flor", { kaleido: 8, twirl: 0.6, spin: 0.15, saturation: 1.5 });
P("Caleidoscopio", "Cristal", { kaleido: 6, mirror: "quad", chroma: 0.01 });
P("Caleidoscopio", "Mandala psicodélico", { kaleido: 12, hueCycle: 1, twirl: 1, saturation: 1.8 });
// Movimiento
P("Movimiento", "Giro lento", { spin: 0.2 });
P("Movimiento", "Giro rápido", { spin: 1.5 });
P("Movimiento", "Zoom acercado", { zoom: 1.8 });
P("Movimiento", "Zoom alejado (repetir)", { zoom: 0.5 });
P("Movimiento", "Deslizar ←", { scrollX: 0.15 });
P("Movimiento", "Deslizar →", { scrollX: -0.15 });
P("Movimiento", "Deslizar ↑", { scrollY: 0.15 });
P("Movimiento", "Deslizar ↓", { scrollY: -0.15 });
P("Movimiento", "Marquesina", { scrollX: -0.25 });
P("Movimiento", "Cinta infinita", { tile: 2, scrollX: 0.2 });
// Luz
P("Luz", "Borde neón", { border: 0.02, borderAnim: "none", borderGlow: 1 });
P("Luz", "Contorno persecución", { border: 0.03, borderAnim: "chase", borderGlow: 1 });
P("Luz", "Contorno pulso", { border: 0.025, borderAnim: "pulse", borderGlow: 1 });
P("Luz", "Contorno arcoíris", { border: 0.025, borderAnim: "rainbow", borderGlow: 1 });
P("Luz", "Viñeta", { vignette: 1 });
P("Luz", "Brillo suave", { blur: 0.5, brightness: 1.25, contrast: 1.1 });
P("Luz", "Estroboscopio lento", { strobe: 3 });
P("Luz", "Estroboscopio", { strobe: 6 });
P("Luz", "Estroboscopio rápido", { strobe: 12 });
// Cámara (también para video e imagen)
P("Cámara", "Espejo selfie", { flipX: true });
P("Cámara", "Contorno neón", { edges: 1, saturation: 1.5 });
P("Cámara", "Contorno sobre imagen", { edges: 0.5 });
P("Cámara", "Dibujo a lápiz", { edges: 1, saturation: 0, invert: true, contrast: 1.3 });
P("Cámara", "Cómic", { edges: 0.5, posterize: 4, saturation: 1.6 });
P("Cámara", "Relieve", { emboss: 1 });
P("Cámara", "Nitidez", { sharpen: 1 });
P("Cámara", "Quitar fondo verde", { chromaKey: 0.35, keyColor: "#00ff00", keySoft: 0.12 });
P("Cámara", "Quitar fondo azul", { chromaKey: 0.35, keyColor: "#0044ff", keySoft: 0.12 });
P("Cámara", "Quitar el negro", { lumaKey: 0.12, lumaSoft: 0.08 });
P("Cámara", "Solo lo brillante", { lumaKey: 0.5, lumaSoft: 0.15 });
P("Cámara", "Silueta neón", { threshold: 0.4, edges: 1, duotone: 1, duoA: "#000000", duoB: "#00e5ff" });
P("Cámara", "Térmica", { colormap: "thermal", blur: 0.3 });
P("Cámara", "Visión nocturna", { colormap: "night", vignette: 0.9, noise: 0.12 });
P("Cámara", "Pixel art", { pixelate: 0.7, posterize: 5, saturation: 1.4 });
P("Cámara", "Caleidoscopio", { kaleido: 6 });
P("Cámara", "Fantasma", { invert: true, saturation: 0, lumaKey: 0.3, lumaSoft: 0.2 });
P("Cámara", "Holograma", { duotone: 1, duoA: "#000814", duoB: "#00e5ff", scanlines: 0.7, glitch: 0.2, chroma: 0.008 });

export const FX_LIBRARY = L;
export const FX_CATEGORIES = [...new Set(L.map(x => x.cat))];
/** Compatibilidad: nombre → función que devuelve el cambio. */
export const FX_PRESETS = Object.fromEntries(L.map(x => [x.name, () => ({ ...x.fx })]));

/** Aplica un efecto de la biblioteca. combine = sumarlo a lo que ya tiene. */
export function applyFxPreset(look, name, combine = false) {
  const gen = FX_PRESETS[name];
  if (!gen) return false;
  look.fx = combine ? { ...look.fx, ...gen() } : { ...DEFAULT_FX(), ...gen() };
  return true;
}

/* ---------------- Superficies ---------------- */

export function createQuad({ name = "Superficie", corners, cols = 2, rows = 2 } = {}) {
  return {
    id: uid("surf"), name, type: "quad", cols, rows,
    points: gridFromCorners(corners, cols, rows),
    hidden: false, locked: false,
    mask: { enabled: false, invert: false, feather: 0.01, points: [] },
  };
}

export function createPoly({ name = "Forma", points }) {
  return {
    id: uid("surf"), name, type: "poly", cols: 0, rows: 0,
    points: points.map(p => ({ x: p.x, y: p.y })),
    hidden: false, locked: false,
    mask: { enabled: false, invert: false, feather: 0.01, points: [] },
  };
}

export function rectCorners(x, y, w, h) {
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}

/** Formas que se pueden añadir con un toque (centradas en cx, cy con radio r). */
export const SHAPES = {
  rect:     { name: "Rectángulo", make: (cx, cy, r) => createQuad({ name: "Rectángulo", corners: rectCorners(cx - r * 1.33, cy - r, r * 2.66, r * 2) }) },
  circle:   { name: "Círculo",    make: (cx, cy, r) => createPoly({ name: "Círculo", points: regularPolygon(cx, cy, r, 48) }) },
  triangle: { name: "Triángulo",  make: (cx, cy, r) => createPoly({ name: "Triángulo", points: regularPolygon(cx, cy, r, 3) }) },
  hexagon:  { name: "Hexágono",   make: (cx, cy, r) => createPoly({ name: "Hexágono", points: regularPolygon(cx, cy, r, 6, 0) }) },
  star:     { name: "Estrella",   make: (cx, cy, r) => createPoly({ name: "Estrella", points: starPolygon(cx, cy, r) }) },
  diamond:  { name: "Rombo",      make: (cx, cy, r) => createPoly({ name: "Rombo", points: regularPolygon(cx, cy, r, 4) }) },
};

/* ---------------- Escenas y proyecto ---------------- */

export function createScene(name = "Escena 1") {
  return { id: uid("scene"), name, duration: 0, transition: "fade", looks: {} };
}

/* ---------------- Control externo (motor de parámetros, ver params.js) ---------------- */
export const DEFAULT_BANKS = ["VJ", "Efectos", "Mapping", "Cámaras", "Luces", "Show", "3D"];
export function defaultControl() {
  return {
    mappings: [], macros: [], banks: [...DEFAULT_BANKS], bank: "",
    // Sincronía externa: MIDI Clock (tempo), start/stop y MIDI Clock de salida (nombre del dispositivo).
    sync: { clockIn: false, transportIn: false, clockOut: "" },
  };
}
export function normalizeControl(c) {
  const d = defaultControl();
  c = { ...d, ...(c || {}) };
  c.mappings = Array.isArray(c.mappings) ? c.mappings.map(normalizeMapping).filter(Boolean) : [];
  c.macros = Array.isArray(c.macros) ? c.macros.filter(m => m && m.id).map(m => ({ name: "Macro", steps: [], ...m, steps: Array.isArray(m.steps) ? m.steps : [] })) : [];
  c.banks = Array.isArray(c.banks) && c.banks.length ? c.banks : d.banks;
  c.sync = { ...d.sync, ...(c.sync || {}) };
  if (c.bank && !c.banks.includes(c.bank)) c.bank = "";
  return c;
}
export function normalizeMapping(m) {
  if (!m || !m.src || !m.target) return null;
  return {
    id: m.id || uid("map"), name: "", src: m.src, device: "*", channel: 0, key: "", target: m.target,
    min: 0, max: 1, mode: "absolute", merge: "override", rel: "twos", sens: 1, bank: "", mod: "",
    invert: false, feedback: true, takeover: true, enabled: true, ...m,
  };
}

/* ---------------- Iluminación: DMX / Art-Net / sACN / pixel mapping (dmx.js) ---------------- */
export function defaultDmx() {
  return {
    enabled: false,          // salida activa (PLAY de luces)
    iface: "",               // IP local de la interfaz de red elegida
    rate: 40, mode: "sync",  // fps de envío · sync (reloj fijo) | immediate (al instante)
    discovery: true, master: 1, followBlackout: true, sampleRes: 320,
    universes: [], pixelMaps: [], fixtures: [], snapshots: [], inputs: [],
  };
}
export function normalizeDmx(d) {
  const D = defaultDmx();
  d = { ...D, ...(d || {}) };
  for (const k of ["universes", "pixelMaps", "fixtures", "snapshots", "inputs"]) d[k] = Array.isArray(d[k]) ? d[k] : [];
  d.universes = d.universes.filter(u => u && u.num > 0).map(u => ({ name: "", protocol: "virtual", dest: "broadcast", ip: "", enabled: true, delayMs: 0, priority: 100, portAddress: u.num - 1, sacnUniverse: u.num, ...u }));
  d.pixelMaps = d.pixelMaps.filter(Boolean).map(pm => ({ ...defaultPixelMap(), ...pm }));
  d.fixtures = d.fixtures.filter(Boolean).map(f => ({ x: 0.5, y: 0.5, source: "video", values: [], screen: 1, enabled: true, ...f, channels: Array.isArray(f.channels) ? f.channels : [] }));
  return d;
}
export function defaultPixelMap() {
  return {
    id: uid("pm"), name: "Pixel map", enabled: true, shape: "line", x: 0.1, y: 0.45, w: 0.8, h: 0.1,
    cols: 30, rows: 1, count: 30, order: "ltr", serpentine: false, reverse: false, startAngle: 0, arc: 180, points: [],
    colorOrder: "RGB", universe: 1, channel: 1, autoSpan: true, align: true,
    source: "video", color: "#ffffff", screen: 1, sampling: "average", average: false,
    brightness: 1, contrast: 1, saturation: 1, gamma: 1, intensity: 1,
  };
}

/* ---------------- Show: timecode, cues, automatización, emergencia (show.js) ---------------- */
export function defaultShow() {
  return {
    tcSource: "internal",     // internal | mtc | ltc | osc
    chase: false,             // las escenas con timecode se disparan solas al pasar por él
    ltcDevice: "",            // entrada de audio del LTC
    lanes: [],                // automatización: [{ id, sceneId, target, points: [[t, v]], enabled }]
    emergency: { sceneId: "", snapshot: "" },
  };
}
export function normalizeShow(sh) {
  const D = defaultShow();
  sh = { ...D, ...(sh || {}) };
  sh.lanes = Array.isArray(sh.lanes) ? sh.lanes.filter(l => l && l.target && Array.isArray(l.points)) : [];
  sh.emergency = { ...D.emergency, ...(sh.emergency || {}) };
  return sh;
}

/* ---------------- Espacio 3D (three3d.js) ---------------- */
/** Caras con contenido propio de cada tipo de objeto 3D (en el orden de los grupos de la geometría). */
export const SLOTS_3D = {
  cube: ["right", "left", "top", "bottom", "front", "back"],
  plane: ["front"], sphere: ["body"], cylinder: ["side", "top", "bottom"], cone: ["side", "bottom"],
  pyramid: ["side", "bottom"], prism: ["side", "top", "bottom"], model: ["model"], group: [],
};
export const SLOT_NAMES = { right: "Derecha", left: "Izquierda", top: "Arriba", bottom: "Abajo", front: "Frente", back: "Detrás", body: "Superficie", side: "Lateral", model: "Modelo" };
export function defaultStage3d() {
  return {
    objects: [],      // { id, name, kind, mediaId?, parent, pos[3], rot[3] (grados), scale[3], hidden, locked, color, faces: { slot: faceId } }
    projectors: [],   // { id, name, pos[3], rot[3], fov, res[2], near, far, shift[2], screen }
    faces: [],        // superficies virtuales (una por cara) con su contenido por escena
    units: "m", unitScale: 1, gridStep: 0.5,
    snap: { enabled: false, move: 0.1, rot: 15, scale: 0.1, mode: "grid" },
    viewMode: "texture",
    faceRes: 512,     // resolución del contenido de cada cara (px)
  };
}
/** Superficie virtual de una cara 3D: misma estructura que una superficie, no se dibuja en el escenario 2D. */
export function createFace(name, w = 1000, h = 1000) {
  const f = createQuad({ name, corners: rectCorners(0, 0, w, h) });
  f.id = uid("face"); f.face3d = true; f.locked = true;
  return f;
}
export function normalizeStage3d(d) {
  const D = defaultStage3d();
  d = { ...D, ...(d || {}) };
  d.objects = Array.isArray(d.objects) ? d.objects.filter(o => o && o.id) : [];
  d.projectors = Array.isArray(d.projectors) ? d.projectors.filter(p => p && p.id) : [];
  d.faces = Array.isArray(d.faces) ? d.faces.filter(f => f && f.id).map(f => ({ ...f, face3d: true, locked: true, mask: { enabled: false, invert: false, feather: 0.01, points: [], ...(f.mask || {}) } })) : [];
  d.snap = { ...D.snap, ...(d.snap || {}) };
  return d;
}

/* ---------------- Tracking (tracking.js) ---------------- */
export function defaultTracking() {
  return { provider: "webcam", camId: "", quality: "medium", fps: 24, hands: true, maxPeople: 4, mirror: true, autoStart: false, zones: [], rules: [] };
}
export function normalizeTracking(t) {
  const D = defaultTracking();
  t = { ...D, ...(t || {}) };
  t.zones = Array.isArray(t.zones) ? t.zones.filter(z => z && z.id) : [];
  t.rules = Array.isArray(t.rules) ? t.rules.filter(r => r && r.id && r.then) : [];
  return t;
}

/** Ajustes del proyecto. react = modo ritmo global (todo late con la música). */
export function defaultSettings() {
  return {
    transitionMs: 800, autoAdvance: false, loopScenes: true, bpm: 120,
    react: { enabled: false, amount: 1, pulse: true, zoom: true, color: true, motion: true, flash: false, sceneBeats: 0 },
    // Salida (como el «Advanced Output» de los media servers): calidad, color,
    // orientación del proyector y bordes suaves para unir varios proyectores.
    output: {
      fps: 60, renderScale: 1,
      brightness: 1, contrast: 1, saturation: 1,
      flipH: false, flipV: false, rotate: 0,
      softEdge: { left: 0, right: 0, top: 0, bottom: 0, curve: 2.2 },
    },
    // Grabación / transmisión
    record: { height: 1080, fps: 30, mbps: 12 },
    // Pantallas de salida 1-4: encendida, brillo y efecto propio de cada una.
    screens: Object.fromEntries([1, 2, 3, 4].map(n => [n, defaultScreen()])),
    // Sensores de cámara (interacción): [{ id, camId, zone, sens, action, target, cooldown }]
    sensors: [],
    // Mapeos MIDI / OSC / DMX / teclado / audio, macros y bancos (params.js)
    control: defaultControl(),
    // Iluminación (DMX, Art-Net, sACN, pixel mapping, fixtures)
    dmx: defaultDmx(),
    // Show: timecode, cues, automatización y emergencia
    show: defaultShow(),
    // Tracking de personas: proveedor, calidad, zonas y reglas
    tracking: defaultTracking(),
  };
}

export const defaultScreen = () => ({ on: true, master: 1, fx: "none", strobe: 0 });

/** Efectos por pantalla (se aplican a toda la imagen de esa salida). */
export const SCREEN_FX = [
  ["none", "Normal"], ["bw", "Blanco y negro"], ["invert", "Invertir"], ["sepia", "Sepia"],
  ["vivid", "Colores vivos"], ["hue", "Arcoíris"], ["blur", "Desenfoque"], ["dark", "Oscuro"], ["contrast", "Contraste"],
];

/** Filtro CSS de un efecto de pantalla (t = segundos, para los animados). */
export function screenFilter(fx, t = 0) {
  switch (fx) {
    case "bw": return "grayscale(1)";
    case "invert": return "invert(1)";
    case "sepia": return "sepia(1)";
    case "vivid": return "saturate(2.2) contrast(1.1)";
    case "hue": return `hue-rotate(${Math.round((t * 60) % 360)}deg)`;
    case "blur": return "blur(6px)";
    case "dark": return "brightness(0.45)";
    case "contrast": return "contrast(1.8)";
    default: return "";
  }
}

/** Umbral de disparo de un sensor según su sensibilidad (más sensible = basta menos movimiento). */
export const sensorThreshold = (r) => 0.04 + (1 - (r.sens ?? 0.5)) * 0.5;

export const SENSOR_ACTIONS = [
  ["next", "Animación nueva"], ["go", "GO (fundir a lo siguiente)"], ["beat", "Golpe de luz"], ["scene", "Siguiente escena"], ["black", "Encender / apagar"],
];

/** Resoluciones de composición (las de los media servers profesionales). */
export const RESOLUTIONS = [
  { group: "Estándar", list: [[640, 480, "VGA"], [800, 600, "SVGA"], [1024, 768, "XGA (proyector)"], [1280, 720, "HD 720p"], [1280, 800, "WXGA (proyector)"], [1366, 768, "HD portátil"]] },
  { group: "Full HD y 2K", list: [[1920, 1080, "Full HD 1080p"], [1920, 1200, "WUXGA (proyector)"], [2048, 1080, "2K DCI (cine)"], [2560, 1440, "QHD / 1440p"], [2560, 1600, "WQXGA"]] },
  { group: "4K y más", list: [[3840, 2160, "4K UHD"], [4096, 2160, "4K DCI (cine)"], [5120, 2880, "5K"], [7680, 4320, "8K UHD"]] },
  { group: "Vertical y especiales", list: [[1080, 1920, "Vertical 9:16"], [2160, 3840, "Vertical 4K"], [1080, 1080, "Cuadrado"], [2560, 1080, "Ultrapanorámica 21:9"], [3440, 1440, "Ultrapanorámica QHD"]] },
  { group: "Varios proyectores", list: [[3840, 1080, "2 × Full HD"], [5760, 1080, "3 × Full HD"], [7680, 1080, "4 × Full HD"], [3840, 1200, "2 × WUXGA"], [2048, 768, "2 × XGA"], [1920, 2160, "2 × Full HD apilados"]] },
];

/** Calidades de grabación y transmisión. */
export const RECORD_QUALITIES = [
  { id: "stream", label: "Transmisión (6 Mbps)", mbps: 6 },
  { id: "high", label: "Alta (12 Mbps)", mbps: 12 },
  { id: "veryhigh", label: "Muy alta (25 Mbps)", mbps: 25 },
  { id: "max", label: "Máxima (50 Mbps)", mbps: 50 },
];

export function createProject(name = "Mi mapping", width = 1920, height = 1080) {
  const scene = createScene("Escena 1");
  return {
    version: VERSION, name, width, height,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    surfaces: [], scenes: [scene], sceneId: scene.id,
    media: [],   // metadatos; los archivos viven en IndexedDB (store.js)
    settings: defaultSettings(),
    stage3d: defaultStage3d(),
  };
}

export function currentScene(project) {
  return project.scenes.find(s => s.id === project.sceneId) || project.scenes[0];
}

/** Look de una superficie en una escena (lo crea si no existe). */
export function lookOf(scene, surfaceId) {
  if (!scene.looks[surfaceId]) scene.looks[surfaceId] = createLook();
  return scene.looks[surfaceId];
}

/** Añade una superficie al proyecto con su contenido en la escena actual. */
export function addSurface(project, surface, source = { type: "gen", gen: "calib" }) {
  project.surfaces.push(surface);
  for (const sc of project.scenes) sc.looks[surface.id] = createLook(JSON.parse(JSON.stringify(source)));
  return surface;
}

export function removeSurface(project, id) {
  project.surfaces = project.surfaces.filter(s => s.id !== id);
  for (const sc of project.scenes) delete sc.looks[id];
}

export function duplicateSurface(project, id, offset = 40) {
  const s = project.surfaces.find(x => x.id === id);
  if (!s) return null;
  const c = JSON.parse(JSON.stringify(s));
  c.id = uid("surf");
  c.name = s.name + " copia";
  c.points = c.points.map(p => ({ x: p.x + offset, y: p.y + offset }));
  project.surfaces.splice(project.surfaces.indexOf(s) + 1, 0, c);
  for (const sc of project.scenes)
    if (sc.looks[id]) sc.looks[c.id] = JSON.parse(JSON.stringify(sc.looks[id]));
  return c;
}

/** Nueva escena que copia el contenido de la actual (para variar a partir de ella). */
export function duplicateScene(project, sceneId) {
  const src = project.scenes.find(s => s.id === sceneId);
  if (!src) return null;
  const c = JSON.parse(JSON.stringify(src));
  c.id = uid("scene");
  c.name = nextSceneName(project);
  project.scenes.splice(project.scenes.indexOf(src) + 1, 0, c);
  return c;
}

export function nextSceneName(project) {
  let n = project.scenes.length + 1;
  while (project.scenes.some(s => s.name === "Escena " + n)) n++;
  return "Escena " + n;
}

export function moveItem(arr, from, to) {
  if (to < 0 || to >= arr.length || from === to) return false;
  const [it] = arr.splice(from, 1);
  arr.splice(to, 0, it);
  return true;
}

/** IDs de medios usados en cualquier escena (para empaquetar y limpiar). */
export function usedMediaIds(project) {
  const ids = new Set();
  for (const sc of project.scenes)
    for (const look of Object.values(sc.looks))
      if (look.source?.type === "media" && look.source.mediaId) ids.add(look.source.mediaId);
  return ids;
}

/* ---------------- Plantillas ---------------- */

export const TEMPLATES = {
  blank: {
    name: "Vacío", desc: "Empieza desde cero",
    build: () => createProject("Mi mapping"),
  },
  screen: {
    name: "Pantalla", desc: "Una superficie para ajustar con 4 esquinas",
    build: () => {
      const p = createProject("Pantalla");
      addSurface(p, createQuad({ name: "Pantalla", corners: rectCorners(360, 180, 1200, 720) }), { type: "gen", gen: "calib" });
      return p;
    },
  },
  draw: {
    name: "Dibujar en la pared", desc: "Lienzo a pantalla completa con pinceles de neón",
    build: () => {
      const p = createProject("Dibujo en la pared");
      addSurface(p, createQuad({ name: "Dibujo", corners: rectCorners(0, 0, 1920, 1080) }), { type: "drawing" });
      return p;
    },
  },
  cube: {
    name: "Cubo 3D", desc: "Tres caras de una caja (arriba, izquierda, derecha)",
    build: () => {
      const p = createProject("Cubo 3D");
      const cx = 960, top = 220, s = 300, h = 170;
      const T = [cx, top], R = [cx + s, top + h], B = [cx, top + 2 * h], L = [cx - s, top + h];
      const L2 = [cx - s, top + h + 340], B2 = [cx, top + 2 * h + 340], R2 = [cx + s, top + h + 340];
      addSurface(p, createQuad({ name: "Cara superior", corners: [T, R, B, L] }), { type: "gen", gen: "rings", color: "#00e5ff", color2: "#0a84ff" });
      addSurface(p, createQuad({ name: "Cara izquierda", corners: [L, B, B2, L2] }), { type: "gen", gen: "stripes", color: "#ff00aa", color2: "#220033" });
      addSurface(p, createQuad({ name: "Cara derecha", corners: [B, R, R2, B2] }), { type: "gen", gen: "plasma", color: "#ffcc00", color2: "#ff2d55" });
      return p;
    },
  },
  facade: {
    name: "Fachada", desc: "Pared con 6 ventanas para iluminar",
    build: () => {
      const p = createProject("Fachada");
      addSurface(p, createQuad({ name: "Pared", corners: rectCorners(160, 90, 1600, 900) }), { type: "gen", gen: "bricks", color: "#ff9500", color2: "#1a0a00" });
      let n = 1;
      for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
        addSurface(p, createQuad({ name: "Ventana " + n++, corners: rectCorners(330 + c * 470, 220 + r * 400, 300, 250) }),
          { type: "gen", gen: ["fire", "stars", "rainbow"][c], color: "#ffcc00", color2: "#ff2d55" });
      }
      return p;
    },
  },
  stage: {
    name: "Escenario", desc: "Tres paneles verticales para un show",
    build: () => {
      const p = createProject("Escenario");
      const gens = ["tunnel", "sweep", "tunnel"];
      for (let i = 0; i < 3; i++)
        addSurface(p, createQuad({ name: "Panel " + (i + 1), corners: rectCorners(180 + i * 560, 140, 440, 800) }),
          { type: "gen", gen: gens[i], color: "#bf5af2", color2: "#00e5ff" });
      return p;
    },
  },
};

/* ---------------- Validación y migración ---------------- */

/** Valida y repara un proyecto importado. Acepta el formato v1 de LumaMap. */
export function normalizeProject(json) {
  if (!json || typeof json !== "object") throw new Error("El archivo no es un proyecto válido");
  if (json.version === 1) json = migrateV1(json);
  if (json.version !== VERSION) throw new Error("Versión de proyecto no soportada: " + json.version);
  if (!Array.isArray(json.surfaces) || !Array.isArray(json.scenes))
    throw new Error("El proyecto no contiene superficies o escenas");
  json.width = json.width || 1920; json.height = json.height || 1080;
  json.media = Array.isArray(json.media) ? json.media : [];
  const st = json.settings || {};
  const D = defaultSettings();
  json.settings = {
    ...D, ...st,
    react: { ...D.react, ...(st.react || {}) },
    output: { ...D.output, ...(st.output || {}), softEdge: { ...D.output.softEdge, ...(st.output?.softEdge || {}) } },
    record: { ...D.record, ...(st.record || {}) },
    screens: Object.fromEntries([1, 2, 3, 4].map(n => [n, { ...defaultScreen(), ...(st.screens?.[n] || {}) }])),
    sensors: Array.isArray(st.sensors) ? st.sensors : [],
    control: normalizeControl(st.control),
    dmx: normalizeDmx(st.dmx),
    show: normalizeShow(st.show),
    tracking: normalizeTracking(st.tracking),
  };
  json.stage3d = normalizeStage3d(json.stage3d);
  if (!json.scenes.length) json.scenes.push(createScene());
  if (!json.scenes.some(s => s.id === json.sceneId)) json.sceneId = json.scenes[0].id;
  for (const s of json.surfaces) {
    s.mask = { enabled: false, invert: false, feather: 0.01, points: [], ...(s.mask || {}) };
    if (s.type === "quad" && (!s.cols || !s.rows || s.points.length !== s.cols * s.rows)) {
      s.cols = 2; s.rows = 2;
    }
  }
  for (const sc of json.scenes) {
    sc.looks = sc.looks || {};
    sc.duration = sc.duration || 0;
    sc.transition = sc.transition || "fade";
    for (const id of Object.keys(sc.looks)) {
      const l = sc.looks[id];
      const base = createLook();
      sc.looks[id] = { ...base, ...l, source: { ...base.source, ...(l.source || {}) },
        fx: { ...base.fx, ...(l.fx || {}) }, audio: { ...base.audio, ...(l.audio || {}) } };
      const n = sc.looks[id].next;
      sc.looks[id].next = n && n.source ? { source: { ...base.source, ...n.source }, fx: n.fx ? { ...base.fx, ...n.fx } : null, fit: n.fit || null } : null;
    }
  }
  return json;
}

function migrateV1(old) {
  const p = createProject(old.name || "Proyecto importado", old.width || 1920, old.height || 1080);
  p.scenes = [];
  const surfaces = new Map();
  for (const s of old.surfaces || []) {
    const pts = (s.points || []).map(q => ({ x: q.x, y: q.y }));
    let ns;
    if (s.type === "quad" && pts.length === 4) {
      ns = createQuad({ name: s.name, corners: pts.map(q => [q.x, q.y]) });
    } else if (pts.length >= 3) {
      ns = createPoly({ name: s.name, points: pts });
    } else continue;
    ns.id = s.id; ns.hidden = !!s.hidden; ns.locked = !!s.locked;
    if (s.mask) ns.mask = { ...ns.mask, ...s.mask };
    surfaces.set(s.id, { ns, old: s });
    p.surfaces.push(ns);
  }
  const lookFromOld = (s) => {
    const look = createLook(s.mediaId ? { type: "media", mediaId: s.mediaId } : { type: "color", color: "#ffffff" });
    look.opacity = s.opacity ?? 1;
    look.blend = ["add", "multiply"].includes(s.blend) ? s.blend : "normal";
    const f = s.fx || {};
    Object.assign(look.fx, {
      brightness: f.brightness ?? 1, contrast: f.contrast ?? 1, saturation: f.saturation ?? 1,
      hue: f.hue ?? 0, invert: !!f.invert, rgbShift: f.rgbShift ?? 0, noise: f.noise ?? 0,
    });
    return look;
  };
  for (const sc of old.scenes || []) {
    const ns = createScene(sc.name || "Escena");
    ns.id = sc.id;
    for (const layer of sc.layers || []) {
      const e = surfaces.get(layer.surfaceId);
      if (e) ns.looks[e.ns.id] = lookFromOld(e.old);
    }
    p.scenes.push(ns);
  }
  if (!p.scenes.length) p.scenes.push(createScene());
  // Superficies sin escena: se les da contenido en todas para que no desaparezcan.
  for (const { ns, old: o } of surfaces.values())
    for (const sc of p.scenes) if (!sc.looks[ns.id]) sc.looks[ns.id] = lookFromOld(o);
  p.sceneId = old.currentSceneId && p.scenes.some(s => s.id === old.currentSceneId) ? old.currentSceneId : p.scenes[0].id;
  p.media = (old.media || []).map(m => ({ id: m.id, name: m.name, kind: m.kind, mime: m.mime,
    width: m.width, height: m.height, duration: m.duration, size: m.size, dataUrl: m.dataUrl }));
  return p;
}
