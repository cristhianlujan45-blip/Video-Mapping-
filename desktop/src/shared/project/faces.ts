import type { PrimitiveKind } from './model';

/** Face names per primitive, in the order of the three.js geometry groups. */
export const FACE_NAMES: Record<PrimitiveKind, string[]> = {
  cube: ['right', 'left', 'top', 'bottom', 'front', 'back'],
  plane: ['front'],
  sphere: ['all'],
  cylinder: ['side', 'top', 'bottom'],
  cone: ['side', 'bottom'],
  pyramid: ['side', 'bottom'],
  prism: ['side', 'top', 'bottom'],
  model: [],
};

export const FACE_LABELS: Record<string, string> = {
  all: 'Todas',
  right: 'Derecha',
  left: 'Izquierda',
  top: 'Arriba',
  bottom: 'Abajo',
  front: 'Frente',
  back: 'Atrás',
  side: 'Lateral',
};

export const PRIMITIVE_LABELS: Record<PrimitiveKind, string> = {
  cube: 'Cubo',
  plane: 'Plano',
  sphere: 'Esfera',
  cylinder: 'Cilindro',
  cone: 'Cono',
  pyramid: 'Pirámide',
  prism: 'Prisma',
  model: 'Modelo importado',
};
