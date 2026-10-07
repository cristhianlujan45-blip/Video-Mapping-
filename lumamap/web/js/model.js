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
];
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
});

export const DEFAULT_SOURCE = () => ({
  type: "none",          // none | media | gen | color | text | drawing | camera
  mediaId: null,
  gen: "plasma", color: "#00e5ff", color2: "#ff00aa", speed: 1, scale: 1,
  text: "LUMAMAP", font: "Impact, 'Arial Black', sans-serif", textColor: "#ffffff", textBg: "#00000000",
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

/** Efectos rápidos: combinaciones listas de uniforms (sin efecto simulado). */
export const FX_PRESETS = {
  "Limpio":      () => ({}),
  "Neón":        () => ({ saturation: 1.8, contrast: 1.3, border: 0.02, borderAnim: "pulse", borderGlow: 1 }),
  "Glitch":      () => ({ rgbShift: 0.012, noise: 0.25, pixelate: 0.15, strobe: 0 }),
  "VHS":         () => ({ blur: 0.4, saturation: 0.7, noise: 0.18, rgbShift: 0.004, contrast: 0.92, wave: 0.15 }),
  "Caleidoscopio": () => ({ kaleido: 6, spin: 0.1 }),
  "Espejo":      () => ({ mirror: "quad" }),
  "Ondas":       () => ({ wave: 0.6 }),
  "B/N":         () => ({ saturation: 0, contrast: 1.2 }),
  "Negativo":    () => ({ invert: true }),
  "Pixel":       () => ({ pixelate: 0.6 }),
  "Contorno":    () => ({ border: 0.03, borderAnim: "chase", borderGlow: 1 }),
  "Estroboscopio": () => ({ strobe: 6 }),
};

export function applyFxPreset(look, name) {
  const gen = FX_PRESETS[name];
  if (!gen) return false;
  look.fx = { ...DEFAULT_FX(), ...gen() };
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

export function createProject(name = "Mi mapping", width = 1920, height = 1080) {
  const scene = createScene("Escena 1");
  return {
    version: VERSION, name, width, height,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    surfaces: [], scenes: [scene], sceneId: scene.id,
    media: [],   // metadatos; los archivos viven en IndexedDB (store.js)
    settings: { transitionMs: 800, autoAdvance: false, loopScenes: true, bpm: 120 },
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
  json.settings = { transitionMs: 800, autoAdvance: false, loopScenes: true, bpm: 120, ...(json.settings || {}) };
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
