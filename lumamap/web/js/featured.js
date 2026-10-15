// web/js/featured.js
// «⭐ Destacadas»: lo mejor de cada biblioteca, lo primero que se ve (hay cientos de
// animaciones y efectos; el resto sigue en «Todas» y en sus categorías, y el buscador busca
// en todo). Se eligen por categoría y nombre porque hay nombres repetidos entre categorías.
export const FEATURED_TAB = "⭐ Destacadas";

const ANIMS = [
  ["Virales 🔥", "Hiperespacio"], ["Virales 🔥", "Agujero de gusano"], ["Virales 🔥", "Metal líquido"], ["Virales 🔥", "Caleidoscopio psicodélico"],
  ["Virales 🔥", "Show de láseres"], ["Virales 🔥", "Visualizador circular"],
  ["🧩 Loops 3D techno", "Catedral de láseres"], ["🧩 Loops 3D techno", "Cromo líquido"], ["🧩 Loops 3D techno", "Monolito"],
  ["🧩 Pro 50: mapping de fachadas", "Ventanas que se encienden"], ["🧩 Pro 50: mapping de fachadas", "Muro que se construye"], ["🧩 Pro 50: mapping de fachadas", "Grietas con lava"],
  ["🧩 Pro 50: generativos", "Flor de la vida"], ["🧩 Pro 50: generativos", "Galaxia espiral"],
  ["Abstracto", "Plasma eléctrico"], ["Abstracto", "Fluido"], ["Abstracto", "Aurora boreal"],
  ["Geométrico", "Espiral hipnótica"], ["Geométrico", "Mandala"], ["Geométrico", "Suelo 3D cian"],
  ["Naturaleza", "Fuego"], ["Naturaleza", "Océano"], ["Naturaleza", "Tormenta"], ["Naturaleza", "Humo de colores"],
  ["Espacio", "Galaxia"], ["Espacio", "Túnel del tiempo"], ["Espacio", "Estrellas fugaces"],
  ["Neón y retro", "Synthwave"], ["Neón y retro", "Matrix"],
  ["Luces y show", "Láseres cruzados"], ["Luces y show", "Rayos de colores"], ["Luces y show", "Barrido de color"],
  ["Fiesta", "Fuegos artificiales"], ["Fiesta", "Confeti"], ["Música ♪", "Ecualizador"], ["Música ♪", "Anillos al ritmo"],
  ["🧩 Anime", "Sakura"], ["🧩 Caricaturas sci-fi", "Portal verde"],
];
const FX = [
  ["Color", "Limpio"], ["Color", "Blanco y negro"], ["Color", "Vintage"], ["Color", "Neón"], ["Color", "Arcoíris en movimiento"], ["Color", "Duotono rosa/cian"], ["Color", "Pop art"], ["Color", "Térmica"],
  ["Retro", "VHS"], ["Retro", "Monitor CRT"], ["Retro", "Película antigua"],
  ["Glitch", "Glitch"], ["Glitch", "Separación RGB"], ["Glitch", "Datos corruptos"],
  ["Distorsión", "Ondas"], ["Distorsión", "Túnel giratorio"], ["Distorsión", "Espejo cuádruple"], ["Distorsión", "Pixel"],
  ["Caleidoscopio", "Caleidoscopio 6"], ["Caleidoscopio", "Caleidoscopio giratorio"], ["Caleidoscopio", "Mandala psicodélico"],
  ["Movimiento", "Giro lento"], ["Movimiento", "Cinta infinita"],
  ["Luz", "Contorno persecución"], ["Luz", "Contorno arcoíris"], ["Luz", "Estroboscopio"],
  ["Cámara, fotos y videos", "Contorno neón"], ["Cámara, fotos y videos", "Quitar fondo verde"], ["Cámara, fotos y videos", "Holograma"],
  ["Estilos", "Retro Matrix"], ["Estilos", "ASCII a color"], ["Estilos", "Dither con brillo"], ["Estilos", "Polvo de estrellas"],
];
const pick = (lib, list) => { const by = new Map(lib.map(x => [x.cat + "|" + x.name, x])); return list.map(([c, n]) => by.get(c + "|" + n)).filter(Boolean); };
/** Las animaciones destacadas que existen (si un plugin está apagado, las suyas no salen). */
export const featuredAnims = (lib) => pick(lib, ANIMS);
export const featuredFx = (lib) => pick(lib, FX);
export const FEATURED_COUNTS = { anims: ANIMS.length, fx: FX.length };
