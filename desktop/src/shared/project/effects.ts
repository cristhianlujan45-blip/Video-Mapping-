import type { EffectKind } from './model';

export interface EffectParamDef {
  name: string;
  label: string;
  min: number;
  max: number;
  default: number;
  type?: 'float' | 'int' | 'bool';
}

export interface EffectDef {
  kind: EffectKind;
  label: string;
  category: 'Color' | 'Desenfoque' | 'Distorsión' | 'Estilo' | 'Tiempo' | 'Luz';
  params: EffectParamDef[];
}

const p = (name: string, label: string, min: number, max: number, def: number, type?: EffectParamDef['type']): EffectParamDef => ({
  name,
  label,
  min,
  max,
  default: def,
  type,
});

/** Every effect is a GPU shader pass (see renderer/engine/effects). `mix` is the dry/wet of every effect. */
export const EFFECTS: Record<EffectKind, EffectDef> = {
  color: {
    kind: 'color',
    label: 'Color',
    category: 'Color',
    params: [
      p('brightness', 'Brillo', -1, 1, 0),
      p('contrast', 'Contraste', 0, 3, 1),
      p('saturation', 'Saturación', 0, 3, 1),
      p('hue', 'Tono', -180, 180, 0),
      p('gamma', 'Gamma', 0.2, 3, 1),
      p('mix', 'Mezcla', 0, 1, 1),
    ],
  },
  blur: { kind: 'blur', label: 'Blur', category: 'Desenfoque', params: [p('radius', 'Radio', 0, 64, 8), p('mix', 'Mezcla', 0, 1, 1)] },
  sharpen: { kind: 'sharpen', label: 'Sharpen', category: 'Desenfoque', params: [p('amount', 'Cantidad', 0, 4, 1), p('mix', 'Mezcla', 0, 1, 1)] },
  glow: {
    kind: 'glow',
    label: 'Glow',
    category: 'Luz',
    params: [p('intensity', 'Intensidad', 0, 4, 1), p('radius', 'Radio', 0, 64, 16), p('threshold', 'Umbral', 0, 1, 0.5), p('mix', 'Mezcla', 0, 1, 1)],
  },
  bloom: {
    kind: 'bloom',
    label: 'Bloom',
    category: 'Luz',
    params: [p('intensity', 'Intensidad', 0, 4, 1.2), p('radius', 'Radio', 0, 64, 32), p('threshold', 'Umbral', 0, 1, 0.7), p('mix', 'Mezcla', 0, 1, 1)],
  },
  chromatic: { kind: 'chromatic', label: 'Aberración cromática', category: 'Distorsión', params: [p('amount', 'Cantidad', 0, 0.05, 0.008), p('mix', 'Mezcla', 0, 1, 1)] },
  rgbSplit: {
    kind: 'rgbSplit',
    label: 'RGB Split',
    category: 'Distorsión',
    params: [p('amount', 'Cantidad', 0, 0.1, 0.01), p('angle', 'Ángulo', 0, 360, 0), p('mix', 'Mezcla', 0, 1, 1)],
  },
  pixelate: { kind: 'pixelate', label: 'Pixelado', category: 'Estilo', params: [p('size', 'Tamaño', 1, 128, 16), p('mix', 'Mezcla', 0, 1, 1)] },
  noise: { kind: 'noise', label: 'Ruido', category: 'Estilo', params: [p('amount', 'Cantidad', 0, 1, 0.2), p('mix', 'Mezcla', 0, 1, 1)] },
  filmGrain: { kind: 'filmGrain', label: 'Grano de película', category: 'Estilo', params: [p('amount', 'Cantidad', 0, 1, 0.15), p('size', 'Tamaño', 0.5, 4, 1.5), p('mix', 'Mezcla', 0, 1, 1)] },
  glitch: {
    kind: 'glitch',
    label: 'Glitch',
    category: 'Distorsión',
    params: [p('amount', 'Cantidad', 0, 1, 0.4), p('blocks', 'Bloques', 1, 64, 16), p('speed', 'Velocidad', 0, 20, 6), p('mix', 'Mezcla', 0, 1, 1)],
  },
  distortion: {
    kind: 'distortion',
    label: 'Distorsión (barril)',
    category: 'Distorsión',
    params: [p('amount', 'Cantidad', -1, 1, 0.3), p('mix', 'Mezcla', 0, 1, 1)],
  },
  displacement: {
    kind: 'displacement',
    label: 'Displacement',
    category: 'Distorsión',
    params: [p('amount', 'Cantidad', 0, 0.2, 0.03), p('scale', 'Escala', 0.5, 40, 6), p('speed', 'Velocidad', 0, 5, 1), p('mix', 'Mezcla', 0, 1, 1)],
  },
  wave: {
    kind: 'wave',
    label: 'Ondas',
    category: 'Distorsión',
    params: [p('amount', 'Amplitud', 0, 0.1, 0.02), p('frequency', 'Frecuencia', 0, 60, 12), p('speed', 'Velocidad', 0, 10, 2), p('mix', 'Mezcla', 0, 1, 1)],
  },
  kaleidoscope: {
    kind: 'kaleidoscope',
    label: 'Caleidoscopio',
    category: 'Estilo',
    params: [p('segments', 'Segmentos', 2, 24, 6, 'int'), p('rotation', 'Rotación', 0, 360, 0), p('zoom', 'Zoom', 0.2, 4, 1), p('mix', 'Mezcla', 0, 1, 1)],
  },
  mirror: {
    kind: 'mirror',
    label: 'Espejo',
    category: 'Estilo',
    params: [p('mode', 'Modo (0 H,1 V,2 4x)', 0, 2, 0, 'int'), p('mix', 'Mezcla', 0, 1, 1)],
  },
  feedback: {
    kind: 'feedback',
    label: 'Feedback',
    category: 'Tiempo',
    params: [p('amount', 'Cantidad', 0, 0.99, 0.85), p('zoom', 'Zoom', 0.9, 1.1, 1.01), p('rotation', 'Rotación', -5, 5, 0.5), p('hueShift', 'Desplaz. tono', 0, 30, 2), p('mix', 'Mezcla', 0, 1, 1)],
  },
  trails: { kind: 'trails', label: 'Trails', category: 'Tiempo', params: [p('decay', 'Persistencia', 0, 0.99, 0.9), p('mix', 'Mezcla', 0, 1, 1)] },
  edges: { kind: 'edges', label: 'Detección de bordes', category: 'Estilo', params: [p('strength', 'Fuerza', 0, 8, 2), p('mix', 'Mezcla', 0, 1, 1)] },
  threshold: { kind: 'threshold', label: 'Umbral', category: 'Color', params: [p('level', 'Nivel', 0, 1, 0.5), p('softness', 'Suavidad', 0, 0.5, 0.02), p('mix', 'Mezcla', 0, 1, 1)] },
  posterize: { kind: 'posterize', label: 'Posterizar', category: 'Color', params: [p('levels', 'Niveles', 2, 32, 5, 'int'), p('mix', 'Mezcla', 0, 1, 1)] },
  colorReplace: {
    kind: 'colorReplace',
    label: 'Reemplazar color',
    category: 'Color',
    params: [
      p('fromHue', 'Tono origen', 0, 360, 0),
      p('toHue', 'Tono destino', 0, 360, 200),
      p('tolerance', 'Tolerancia', 0, 180, 30),
      p('mix', 'Mezcla', 0, 1, 1),
    ],
  },
  invert: { kind: 'invert', label: 'Invertir', category: 'Color', params: [p('mix', 'Mezcla', 0, 1, 1)] },
  silhouette: {
    kind: 'silhouette',
    label: 'Silueta',
    category: 'Estilo',
    params: [p('threshold', 'Umbral', 0, 1, 0.4), p('hue', 'Tono', 0, 360, 190), p('mix', 'Mezcla', 0, 1, 1)],
  },
  strobe: { kind: 'strobe', label: 'Strobe', category: 'Luz', params: [p('rate', 'Hz', 0.5, 30, 8), p('duty', 'Ciclo', 0.05, 0.95, 0.5), p('mix', 'Mezcla', 0, 1, 1)] },
  zoom: { kind: 'zoom', label: 'Zoom', category: 'Distorsión', params: [p('zoom', 'Zoom', 0.1, 8, 1), p('centerX', 'Centro X', 0, 1, 0.5), p('centerY', 'Centro Y', 0, 1, 0.5), p('mix', 'Mezcla', 0, 1, 1)] },
};

export const EFFECT_LIST = Object.values(EFFECTS);

export function effectParamId(fxId: string, name: string) {
  return `fx.${fxId}.${name}`;
}
