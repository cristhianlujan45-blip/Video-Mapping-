// web/js/project.js
// Modelo de datos del proyecto: superficies, escenas, capas, máscaras, efectos,
// serialización y presets. Funciona en navegador y en Node (tests).

let uidCounter = 1;
export function uid(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${(uidCounter++).toString(36)}${Math.floor(Math.random()*1e6).toString(36)}`;
}

export const DEFAULT_FX = () => ({
  brightness: 1, contrast: 1, saturation: 1, hue: 0, rgbShift: 0,
  noise: 0, pixelate: 1, blur: 0, threshold: 0, colorizeAmt: 0,
  colorize: [1, 0, 1], invert: false,
});

export function createSurface(opts = {}) {
  const { x = 100, y = 100, w = 320, h = 240, type = "quad", mediaId = null } = opts;
  return {
    id: uid("surf"),
    name: opts.name || "Superficie",
    type,                              // "quad" | "poly"
    points: type === "quad"
      ? [{x, y}, {x: x+w, y}, {x: x+w, y: y+h}, {x, y: y+h}]
      : [{x, y}, {x: x+w, y}, {x: x+w, y: y+h}, {x, y: y+h}],
    mediaId,
    opacity: 1,
    tint: [1, 1, 1],
    blend: "normal",                   // normal | add | multiply
    hidden: false,
    locked: false,
    volume: 1,
    mask: { enabled: false, invert: false, feather: 0, points: [] }, // puntos en UV 0..1
    fx: DEFAULT_FX(),
  };
}

export function createScene(name = "Escena") {
  return { id: uid("scene"), name, layers: [], autoplayNext: false };
}

export function createProject(name = "Proyecto sin título", width = 1920, height = 1080) {
  const scene = createScene("Escena 1");
  scene.layers.push({ id: uid("layer"), surfaceId: null }); // capa fondo sin superficie aún? No: capa vacía se ignora.
  scene.layers = [];
  return {
    version: 1,
    name, width, height, fps: 60,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    surfaces: [createSurface({ name: "Superficie 1", x: width*0.3, y: height*0.25, w: width*0.4, h: height*0.5 })],
    scenes: [scene],
    currentSceneId: scene.id,
    settings: { mode: "pro", transition: "fade", transitionMs: 500, outputFullscreen: false },
  };
}

/** Efectos por defecto con reset previo (los presets son combinaciones reales de uniforms). */
export const FX_PRESETS = {
  "Normal":        () => ({ ...DEFAULT_FX() }),
  "B&W":           () => ({ ...DEFAULT_FX(), saturation: 0 }),
  "Negative":      () => ({ ...DEFAULT_FX(), invert: true }),
  "Glitch":        () => ({ ...DEFAULT_FX(), rgbShift: 0.012, noise: 0.35, hue: 0.05, pixelate: 3 }),
  "VHS":           () => ({ ...DEFAULT_FX(), blur: 2.5, saturation: 0.75, noise: 0.22, rgbShift: 0.004, contrast: 0.92 }),
  "Neon":          () => ({ ...DEFAULT_FX(), saturation: 2.2, contrast: 1.35, colorizeAmt: 0.35, colorize: [1, 0.1, 0.9] }),
  "Cyberpunk":     () => ({ ...DEFAULT_FX(), colorizeAmt: 0.55, colorize: [0.1, 0.9, 1], contrast: 1.3, saturation: 1.5, hue: 0.55 }),
  "RGB Split":     () => ({ ...DEFAULT_FX(), rgbShift: 0.01 }),
  "Posterize":     () => ({ ...DEFAULT_FX(), threshold: 0.5 }),
  "Pixelado":      () => ({ ...DEFAULT_FX(), pixelate: 24 }),
  "Glow suave":    () => ({ ...DEFAULT_FX(), blur: 1.5, brightness: 1.25, contrast: 1.1 }),
};

export function applyPreset(surface, presetName) {
  const gen = FX_PRESETS[presetName];
  if (!gen) return false;
  surface.fx = gen();
  return true;
}

/** Serializa proyecto; incluye medios como dataURL si se pasa mediaList con blobs. */
export async function serializeProject(project, mediaList = []) {
  const media = [];
  for (const m of mediaList) {
    media.push({
      id: m.id, name: m.name, kind: m.kind,
      duration: m.duration || 0, width: m.width || 0, height: m.height || 0,
      size: m.size || 0, mime: m.mime || "", dataUrl: m.dataUrl || null,
    });
  }
  return { ...project, media, updatedAt: new Date().toISOString() };
}

/** Reconstruye estado mínimo desde JSON importado. */
export function validateProject(json) {
  if (!json || typeof json !== "object") throw new Error("Archivo no es un JSON válido");
  if (json.version !== 1) throw new Error("Versión de proyecto no soportada: " + json.version);
  if (!Array.isArray(json.surfaces) || !Array.isArray(json.scenes)) throw new Error("El proyecto no contiene superficies/escenas");
  if (!json.scenes.length) json.scenes = [createScene("Escena 1")];
  if (!json.scenes.some(s => s.id === json.currentSceneId)) json.currentSceneId = json.scenes[0].id;
  json.width = json.width || 1920; json.height = json.height || 1080;
  return json;
}

export function cloneSurface(s) {
  const c = JSON.parse(JSON.stringify(s));
  c.id = uid("surf");
  c.name = s.name + " copia";
  return c;
}

export function cloneScene(sc, surfaces) {
  const c = JSON.parse(JSON.stringify(sc));
  c.id = uid("scene");
  c.name = sc.name + " copia";
  // Duplica también las superficies referenciadas para que la escena sea independiente
  const idMap = new Map();
  for (const layer of c.layers) {
    const orig = surfaces.find(s => s.id === layer.surfaceId);
    if (orig) {
      if (!idMap.has(orig.id)) { const cl = cloneSurface(orig); surfaces.push(cl); idMap.set(orig.id, cl.id); }
      layer.surfaceId = idMap.get(orig.id);
    }
  }
  return c;
}
