import { rectQuad } from '../geometry/homography';
import {
  PROJECT_FORMAT,
  PROJECT_VERSION,
  uid,
  type ColorCorrection,
  type Composition,
  type Cue,
  type DmxSettings,
  type EffectInstance,
  type EffectKind,
  type FixtureType,
  type Layer,
  type Mask,
  type MaskShape,
  type Object3D,
  type Output,
  type PixelMap,
  type PrimitiveKind,
  type Project,
  type Projector,
  type SoftEdge,
  type SourceRef,
  type Surface,
  type Universe,
} from './model';
import { EFFECTS } from './effects';

export const defaultColor = (): ColorCorrection => ({ brightness: 0, contrast: 1, gamma: 1, red: 1, green: 1, blue: 1 });
export const defaultSoftEdge = (): SoftEdge => ({ left: 0, right: 0, top: 0, bottom: 0, gamma: 2.2 });

export function createLayer(source: SourceRef, name = 'Capa'): Layer {
  return {
    id: uid('layer'),
    name,
    visible: true,
    locked: false,
    source,
    opacity: 1,
    blend: 'normal',
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    crop: { l: 0, t: 0, r: 1, b: 1 },
    flipH: false,
    flipV: false,
    masks: [],
    effects: [],
    playback: { mode: 'loop', speed: 1, volume: 1, muted: true, inPoint: 0, outPoint: null },
    attach: null,
  };
}

export function createComposition(name = 'Escena 1', width = 1920, height = 1080): Composition {
  return { id: uid('comp'), name, width, height, background: '#000000', layers: [], effects: [], dmxSnapshotId: null };
}

export function createEffect(kind: EffectKind): EffectInstance {
  const def = EFFECTS[kind];
  const params: Record<string, number> = {};
  for (const p of def.params) params[p.name] = p.default;
  return { id: uid('fx'), kind, enabled: true, params };
}

export function createMask(shape: MaskShape): Mask {
  const points =
    shape === 'rectangle' || shape === 'ellipse'
      ? [
          { x: 0.25, y: 0.25 },
          { x: 0.75, y: 0.75 },
        ]
      : [
          { x: 0.3, y: 0.2 },
          { x: 0.7, y: 0.2 },
          { x: 0.8, y: 0.7 },
          { x: 0.5, y: 0.85 },
          { x: 0.2, y: 0.7 },
        ];
  return { id: uid('mask'), name: shape, shape, points, inverted: false, feather: 0.01, opacity: 1, enabled: true };
}

export function createSurface(name = 'Superficie', source: SourceRef = { type: 'composition', compId: 'program' }): Surface {
  return {
    id: uid('surf'),
    name,
    visible: true,
    locked: false,
    source,
    region: { x: 0, y: 0, w: 1, h: 1 },
    kind: 'quad',
    quad: rectQuad(0.5, 0.5, 0.35, 0.35),
    mesh: null,
    polygon: null,
    masks: [],
    softEdge: defaultSoftEdge(),
    opacity: 1,
    blend: 'normal',
    color: defaultColor(),
    effects: [],
  };
}

export function createOutput(name: string, width = 1920, height = 1080, displayId: number | null = null): Output {
  const full = createSurface('Pantalla completa');
  full.quad = rectQuad(0.5, 0.5, 0.5, 0.5);
  return {
    id: uid('out'),
    name,
    enabled: true,
    kind: displayId === null ? 'virtual' : 'display',
    displayId,
    fullscreen: true,
    width,
    height,
    fps: 60,
    mode: '2d',
    surfaces: [full],
    projectorId: null,
    finalWarp: null,
    masks: [],
    softEdge: defaultSoftEdge(),
    color: defaultColor(),
    showTestPattern: false,
    identify: false,
  };
}

export function createObject3D(kind: PrimitiveKind, name?: string): Object3D {
  return {
    id: uid('obj'),
    name: name ?? kind,
    kind,
    position: [0, kind === 'plane' ? 1 : 0.5, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    visible: true,
    locked: false,
    faces: { all: { source: { type: 'testpattern' }, opacity: 1, tint: '#ffffff', projectFrom: null } },
  };
}

const PROJECTOR_COLORS = ['#ffcc33', '#33ccff', '#ff5599', '#66ff88', '#bb88ff', '#ff8844'];

export function createProjector(index: number, outputId: string | null = null): Projector {
  const angle = (index * Math.PI) / 3;
  return {
    id: uid('proj'),
    name: `Proyector ${index + 1}`,
    position: [Math.sin(angle) * 4, 1.6, Math.cos(angle) * 4],
    rotation: [-8, (angle * 180) / Math.PI, 0],
    fov: 30,
    near: 0.1,
    far: 50,
    shiftX: 0,
    shiftY: 0,
    outputId,
    width: 1920,
    height: 1080,
    color: PROJECTOR_COLORS[index % PROJECTOR_COLORS.length],
  };
}

export function createUniverse(index: number, protocol: Universe['protocol'] = 'artnet'): Universe {
  return {
    id: uid('uni'),
    name: `Universo ${index + 1}`,
    protocol,
    number: protocol === 'sacn' ? index + 1 : index,
    destination: { mode: protocol === 'sacn' ? 'multicast' : 'broadcast', ip: '' },
    enabled: true,
    delayMs: 0,
    priority: 100,
  };
}

export const BUILTIN_FIXTURES: FixtureType[] = [
  { id: 'fx_rgb', name: 'RGB', manufacturer: 'Genérico', channels: [ch('Rojo', 'red'), ch('Verde', 'green'), ch('Azul', 'blue')] },
  { id: 'fx_rgbw', name: 'RGBW', manufacturer: 'Genérico', channels: [ch('Rojo', 'red'), ch('Verde', 'green'), ch('Azul', 'blue'), ch('Blanco', 'white')] },
  { id: 'fx_dim', name: 'Dimmer', manufacturer: 'Genérico', channels: [ch('Dimmer', 'dimmer')] },
  {
    id: 'fx_par_drgbs',
    name: 'PAR LED D+RGB+Strobe',
    manufacturer: 'Genérico',
    channels: [ch('Dimmer', 'dimmer', 255), ch('Rojo', 'red'), ch('Verde', 'green'), ch('Azul', 'blue'), ch('Strobe', 'strobe')],
  },
  {
    id: 'fx_moving_spot',
    name: 'Cabeza móvil (16 bit)',
    manufacturer: 'Genérico',
    channels: [
      ch('Pan', 'pan', 128),
      ch('Pan fino', 'panFine'),
      ch('Tilt', 'tilt', 128),
      ch('Tilt fino', 'tiltFine'),
      ch('Velocidad', 'speed'),
      ch('Dimmer', 'dimmer', 255),
      ch('Strobe', 'strobe'),
      ch('Color', 'color'),
      ch('Gobo', 'gobo'),
    ],
  },
];

function ch(name: string, role: FixtureType['channels'][number]['role'], def = 0) {
  return { name, role, default: def };
}

export function createPixelMap(universeId: string, name = 'Pixel map'): PixelMap {
  return {
    id: uid('pmap'),
    name,
    enabled: true,
    layout: 'grid',
    cols: 16,
    rows: 8,
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    startAngle: 0,
    endAngle: 360,
    custom: [],
    order: 'serpentine',
    reverse: false,
    startCorner: 'tl',
    format: 'RGB',
    universeId,
    startChannel: 1,
    autoSpan: true,
    alignPixels: true,
    pixelsPerUniverse: 0,
    source: { type: 'composition', compId: 'program' },
    sampling: 'area',
    sampleSize: 0.5,
    brightness: 1,
    gamma: 1,
    saturation: 1,
    contrast: 1,
    whiteExtraction: true,
  };
}

export function defaultDmx(): DmxSettings {
  return {
    interfaceName: null,
    interfaceAddress: null,
    outputFps: 40,
    syncMode: 'immediate',
    globalDelayMs: 0,
    useArtSync: false,
    universes: [],
    fixtureTypes: [],
    fixtures: [],
    pixelMaps: [],
    snapshots: [],
    input: { enabled: false, protocol: 'artnet', universes: [0] },
    manualNodes: [],
  };
}

export function createCue(name: string, compId: string | null): Cue {
  return { id: uid('cue'), name, compId, transition: { kind: 'fade', durationMs: 1000 }, dmxSnapshotId: null, macroId: null, followMs: null };
}

export function createProject(name = 'Proyecto sin título'): Project {
  const comp = createComposition('Escena 1');
  const now = Date.now();
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    id: uid('proj'),
    name,
    createdAt: now,
    modifiedAt: now,
    media: [],
    compositions: [comp],
    mixer: { deckA: comp.id, deckB: null, transition: { kind: 'fade', durationMs: 1000 }, manual: false },
    outputs: [],
    stage: {
      objects: [],
      projectors: [],
      units: 'm',
      customUnitMeters: 1,
      grid: { size: 20, divisions: 20, visible: true },
      snap: { grid: false, vertex: false, edge: false, face: false, increment: 0.1, angle: 15 },
    },
    cameras: [],
    tracking: {
      enabled: false,
      cameraId: null,
      provider: 'webcam-body',
      quality: 'medium',
      fps: 30,
      maxPeople: 2,
      hands: true,
      segmentation: false,
      mirror: true,
      zones: [],
    },
    rules: [],
    macros: [],
    cues: [],
    timeline: { durationSec: 120, fps: 30, loop: false, lanes: [], markers: [], audioMediaId: null },
    sync: { source: 'internal', bpm: 120, timecodeFps: 30, offsetSec: 0, sendClock: false },
    dmx: defaultDmx(),
    audio: { inputDeviceId: null, gain: 1, smoothing: 0.6, bassHz: 250, trebleHz: 4000, beatSensitivity: 1.4 },
    osc: { enabled: false, inPort: 8000, outHost: '127.0.0.1', outPort: 9000, feedback: false },
    remote: { enabled: false, port: 8787, pin: String(Math.floor(100000 + Math.random() * 900000)) },
    midi: { disabledInputs: [], disabledOutputs: [], clockOutput: null, banks: ['VJ', 'Efectos', 'Mapping', 'Cámaras', 'Iluminación', 'Show', '3D'] },
    drawings: [],
    mappings: [],
    params: {},
    mergeModes: {},
  };
}
