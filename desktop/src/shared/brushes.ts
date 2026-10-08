/**
 * Brush library. Every brush is a procedural GPU dab (no bitmaps): `tip` selects the
 * dab shader, the rest shapes spacing, scatter and dynamics.
 */
export type BrushCategory = 'Lápices' | 'Plumas' | 'Pinceles' | 'Graffiti' | 'Artísticos' | 'Procedurales';

export interface BrushPreset {
  id: string;
  name: string;
  category: BrushCategory;
  /** Dab shader: 0 round, 1 grain (graphite/charcoal/chalk/pastel/crayon), 2 spray, 3 watercolor, 4 bristle (oil/acrylic/dry),
   *  5 flat/chisel (marker/calligraphy), 6 glow (neon/light), 7 smoke, 8 fire, 9 pixel, 10 electric, 11 glitch */
  tip: number;
  size: number;
  hardness: number;
  opacity: number;
  flow: number;
  spacing: number;
  scatter: number;
  /** Grain amount for textured tips. */
  grain: number;
  /** Additive blending (light-like brushes). */
  additive: boolean;
  /** Tip follows the stroke direction. */
  followAngle: boolean;
  /** Fixed tip angle in degrees (calligraphy). */
  angle: number;
  /** Tip aspect (1 round, <1 flat). */
  aspect: number;
  /** Extra dabs per step (spray density / particles). */
  density: number;
  /** Hue cycles along the stroke (rainbow). */
  hueCycle: number;
  /** Drips under the stroke (dripping spray). */
  drips: number;
  pressureSize: boolean;
  pressureOpacity: boolean;
  velocitySize: number;
  smoothing: number;
  glow: number;
}

const b = (id: string, name: string, category: BrushCategory, tip: number, o: Partial<BrushPreset> = {}): BrushPreset => ({
  id,
  name,
  category,
  tip,
  size: 12,
  hardness: 0.8,
  opacity: 1,
  flow: 1,
  spacing: 0.12,
  scatter: 0,
  grain: 0,
  additive: false,
  followAngle: false,
  angle: 0,
  aspect: 1,
  density: 1,
  hueCycle: 0,
  drips: 0,
  pressureSize: true,
  pressureOpacity: false,
  velocitySize: 0,
  smoothing: 0.35,
  glow: 0,
  ...o,
});

export const BRUSHES: BrushPreset[] = [
  // Lápices
  b('pencil', 'Lápiz', 'Lápices', 1, { size: 3, hardness: 0.9, opacity: 0.85, grain: 0.45, spacing: 0.08 }),
  b('graphite', 'Grafito', 'Lápices', 1, { size: 5, hardness: 0.7, opacity: 0.7, grain: 0.65, pressureOpacity: true }),
  b('mechanical', 'Portaminas', 'Lápices', 1, { size: 2, hardness: 1, opacity: 0.9, grain: 0.25, pressureSize: false, pressureOpacity: true }),
  b('soft-pencil', 'Lápiz blando (6B)', 'Lápices', 1, { size: 7, hardness: 0.5, opacity: 0.75, grain: 0.6, pressureOpacity: true }),
  b('hard-pencil', 'Lápiz duro (4H)', 'Lápices', 1, { size: 2.5, hardness: 1, opacity: 0.5, grain: 0.35 }),
  b('charcoal-pencil', 'Carboncillo', 'Lápices', 1, { size: 10, hardness: 0.4, opacity: 0.85, grain: 0.9, pressureOpacity: true }),
  b('colored-pencil', 'Lápiz de color', 'Lápices', 1, { size: 5, hardness: 0.8, opacity: 0.8, grain: 0.55 }),
  // Plumas
  b('ballpoint', 'Bolígrafo', 'Plumas', 0, { size: 2.5, hardness: 0.95, opacity: 0.95, spacing: 0.06, pressureOpacity: true }),
  b('fine-pen', 'Pluma fina', 'Plumas', 0, { size: 1.5, hardness: 1, spacing: 0.05 }),
  b('marker', 'Rotulador', 'Plumas', 5, { size: 18, hardness: 0.95, opacity: 0.7, aspect: 0.55, followAngle: true, pressureSize: false }),
  b('ink-pen', 'Pluma de tinta', 'Plumas', 0, { size: 4, hardness: 1, spacing: 0.05, velocitySize: -0.5 }),
  b('brush-pen', 'Brush pen', 'Plumas', 0, { size: 10, hardness: 0.95, spacing: 0.05, velocitySize: -0.6 }),
  b('calligraphy', 'Caligrafía', 'Plumas', 5, { size: 16, hardness: 1, aspect: 0.18, angle: 40, spacing: 0.04 }),
  b('technical', 'Estilógrafo técnico', 'Plumas', 0, { size: 2, hardness: 1, pressureSize: false, spacing: 0.05, smoothing: 0.6 }),
  // Pinceles
  b('soft-brush', 'Pincel suave', 'Pinceles', 0, { size: 40, hardness: 0.1, opacity: 0.6, flow: 0.4, pressureOpacity: true }),
  b('hard-brush', 'Pincel duro', 'Pinceles', 0, { size: 30, hardness: 0.95, flow: 0.9 }),
  b('round-brush', 'Pincel redondo', 'Pinceles', 0, { size: 24, hardness: 0.7, flow: 0.7 }),
  b('flat-brush', 'Pincel plano', 'Pinceles', 4, { size: 30, hardness: 0.7, aspect: 0.35, followAngle: true, grain: 0.3 }),
  b('dry-brush', 'Pincel seco', 'Pinceles', 4, { size: 36, hardness: 0.6, grain: 0.85, followAngle: true, opacity: 0.8 }),
  b('watercolor', 'Acuarela', 'Pinceles', 3, { size: 50, hardness: 0.2, opacity: 0.35, flow: 0.25, grain: 0.4, scatter: 0.05 }),
  b('oil', 'Óleo', 'Pinceles', 4, { size: 34, hardness: 0.8, grain: 0.5, followAngle: true, spacing: 0.06 }),
  b('acrylic', 'Acrílico', 'Pinceles', 4, { size: 30, hardness: 0.9, grain: 0.3, followAngle: true }),
  b('ink-brush', 'Pincel de tinta', 'Pinceles', 0, { size: 22, hardness: 0.9, velocitySize: -0.7, spacing: 0.05 }),
  // Graffiti
  b('spray', 'Spray', 'Graffiti', 2, { size: 40, hardness: 0.3, opacity: 0.5, density: 3, spacing: 0.05 }),
  b('graffiti-spray', 'Spray graffiti', 'Graffiti', 2, { size: 30, hardness: 0.5, opacity: 0.7, density: 4, spacing: 0.04 }),
  b('paint-can', 'Bote de pintura', 'Graffiti', 2, { size: 90, hardness: 0.2, opacity: 0.4, density: 6, spacing: 0.05 }),
  b('dripping-spray', 'Spray con chorreo', 'Graffiti', 2, { size: 34, hardness: 0.5, opacity: 0.7, density: 4, drips: 0.25 }),
  b('splatter', 'Salpicadura', 'Graffiti', 2, { size: 60, hardness: 0.9, opacity: 0.9, density: 2, scatter: 1.2, spacing: 0.4 }),
  b('street-marker', 'Rotulador urbano', 'Graffiti', 5, { size: 26, hardness: 0.9, aspect: 0.4, followAngle: true, drips: 0.05 }),
  b('wide-spray', 'Spray ancho', 'Graffiti', 2, { size: 120, hardness: 0.15, opacity: 0.35, density: 8 }),
  b('fine-spray', 'Spray fino', 'Graffiti', 2, { size: 14, hardness: 0.6, opacity: 0.7, density: 2 }),
  // Artísticos
  b('chalk', 'Tiza', 'Artísticos', 1, { size: 16, hardness: 0.6, grain: 0.9, opacity: 0.9 }),
  b('pastel', 'Pastel', 'Artísticos', 1, { size: 22, hardness: 0.4, grain: 0.75, opacity: 0.8 }),
  b('charcoal', 'Carbón', 'Artísticos', 1, { size: 26, hardness: 0.35, grain: 0.95, opacity: 0.85 }),
  b('crayon', 'Crayón', 'Artísticos', 1, { size: 12, hardness: 0.8, grain: 0.85, opacity: 0.95 }),
  b('wax', 'Cera', 'Artísticos', 1, { size: 18, hardness: 0.85, grain: 0.7 }),
  b('neon', 'Neón', 'Artísticos', 6, { size: 10, hardness: 0.9, additive: true, glow: 1, spacing: 0.05 }),
  b('glow', 'Brillo', 'Artísticos', 6, { size: 30, hardness: 0.2, additive: true, glow: 0.8, opacity: 0.6 }),
  b('smoke', 'Humo', 'Artísticos', 7, { size: 80, hardness: 0.1, opacity: 0.25, scatter: 0.2, additive: true }),
  b('fire', 'Fuego', 'Artísticos', 8, { size: 40, hardness: 0.3, additive: true, scatter: 0.15, density: 2 }),
  b('light-trail', 'Estela de luz', 'Artísticos', 6, { size: 14, hardness: 0.6, additive: true, glow: 1.4, spacing: 0.03, velocitySize: 0.5 }),
  // Procedurales
  b('particles', 'Partículas', 'Procedurales', 6, { size: 6, hardness: 0.8, additive: true, scatter: 2.5, density: 4, spacing: 0.3, glow: 0.6 }),
  b('proc-splatter', 'Salpicadura procedural', 'Procedurales', 0, { size: 20, hardness: 1, scatter: 3, density: 3, spacing: 0.6 }),
  b('drip', 'Chorreo', 'Procedurales', 0, { size: 14, hardness: 0.95, drips: 0.6 }),
  b('proc-smoke', 'Humo procedural', 'Procedurales', 7, { size: 120, hardness: 0.05, opacity: 0.18, scatter: 0.6, density: 2, additive: true }),
  b('proc-fire', 'Fuego procedural', 'Procedurales', 8, { size: 60, hardness: 0.2, additive: true, scatter: 0.4, density: 3 }),
  b('proc-neon', 'Neón procedural', 'Procedurales', 6, { size: 8, hardness: 0.95, additive: true, glow: 1.6, hueCycle: 0.2 }),
  b('electric', 'Eléctrico', 'Procedurales', 10, { size: 8, hardness: 1, additive: true, scatter: 0.6, spacing: 0.08, glow: 1 }),
  b('trail', 'Estela', 'Procedurales', 6, { size: 18, hardness: 0.5, additive: true, velocitySize: 0.8, glow: 0.8 }),
  b('rainbow', 'Arcoíris', 'Procedurales', 0, { size: 20, hardness: 0.8, hueCycle: 1 }),
  b('glitch', 'Glitch', 'Procedurales', 11, { size: 24, hardness: 1, scatter: 0.8, spacing: 0.3 }),
  b('pixel', 'Píxel', 'Procedurales', 9, { size: 12, hardness: 1, pressureSize: false, spacing: 0.9 }),
];

export const BRUSH_CATEGORIES: BrushCategory[] = ['Lápices', 'Plumas', 'Pinceles', 'Graffiti', 'Artísticos', 'Procedurales'];

export function brushById(id: string): BrushPreset {
  return BRUSHES.find((x) => x.id === id) ?? BRUSHES[0];
}
