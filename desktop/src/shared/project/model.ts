/**
 * Project model (plain JSON-serializable data).
 *
 * Logical chain (the same for 2D and 3D):
 *   SOURCE (media, camera, generator, drawing, composition…)
 *     → LAYER (in a COMPOSITION / scene: transform, effects, blend)
 *       → SURFACE (2D mapping on an output)  or  OBJECT 3D face (3D mapping)
 *         → PROJECTOR camera (3D) → OUTPUT (physical display / virtual / LED pixel map)
 *
 * Live, continuously-controllable values are NOT stored here directly while running:
 * they live in the ParameterEngine (`params` holds their base values on save).
 */
import type { Mapping, MergeMode } from '../params/types';
import type { Quad, Vec2 } from '../geometry/homography';
import type { MeshWarp } from '../geometry/warp';

export const PROJECT_FORMAT = 'lujan-studio-project';
export const PROJECT_VERSION = 1;
export const PROJECT_EXTENSION = 'lujanshow';

export type Id = string;

let uidCounter = 0;
export function uid(prefix = 'id'): Id {
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${(uidCounter++).toString(36)}${rnd}`;
}

// ------------------------------------------------------------------ media / sources

export type MediaKind = 'video' | 'image' | 'audio' | 'model3d';

export interface MediaItem {
  id: Id;
  name: string;
  kind: MediaKind;
  /** Absolute path on disk. */
  path: string;
  /** Path relative to the project folder when the file lives inside it (portable projects). */
  rel?: string;
  size: number;
  width?: number;
  height?: number;
  durationSec?: number;
  /** Lower-resolution proxy used for preview/editing when the original is very large. */
  proxyPath?: string;
  thumbnail?: string;
}

export type GeneratorKind =
  | 'gradient'
  | 'plasma'
  | 'noise'
  | 'tunnel'
  | 'waves'
  | 'stripes'
  | 'checker'
  | 'rings'
  | 'particles'
  | 'audioSpectrum';

export type SourceRef =
  | { type: 'none' }
  | { type: 'media'; mediaId: Id }
  | { type: 'camera'; cameraId: Id }
  | { type: 'generator'; generator: GeneratorKind; colorA: string; colorB: string }
  | { type: 'solid'; color: string }
  | { type: 'testpattern' }
  | { type: 'text'; text: string; font: string; size: number; color: string }
  | { type: 'drawing'; drawingId: Id }
  | { type: 'composition'; compId: Id | 'program' | 'preview' }
  | { type: 'tracking'; style: TrackingVisual; cameraId?: Id };

export type TrackingVisual = 'skeleton' | 'silhouette' | 'particles' | 'trails' | 'lines' | 'fire' | 'glow';

// ------------------------------------------------------------------ appearance

export type BlendMode =
  | 'normal'
  | 'add'
  | 'screen'
  | 'multiply'
  | 'overlay'
  | 'difference'
  | 'lighten'
  | 'darken'
  | 'subtract'
  | 'exclusion';

export const BLEND_MODES: BlendMode[] = ['normal', 'add', 'screen', 'multiply', 'overlay', 'difference', 'lighten', 'darken', 'subtract', 'exclusion'];

export type MaskShape = 'rectangle' | 'ellipse' | 'polygon' | 'freehand';

/** Mask in content/surface UV space so it follows its surface. Several masks intersect. */
export interface Mask {
  id: Id;
  name: string;
  shape: MaskShape;
  points: Vec2[];
  inverted: boolean;
  feather: number;
  opacity: number;
  enabled: boolean;
}

export interface Crop {
  l: number;
  t: number;
  r: number;
  b: number;
}

export interface Transform2D {
  /** Offset in normalized composition units. */
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  /** Degrees. */
  rotation: number;
}

export type EffectKind =
  | 'color'
  | 'blur'
  | 'sharpen'
  | 'glow'
  | 'bloom'
  | 'chromatic'
  | 'rgbSplit'
  | 'pixelate'
  | 'noise'
  | 'filmGrain'
  | 'glitch'
  | 'distortion'
  | 'displacement'
  | 'kaleidoscope'
  | 'mirror'
  | 'feedback'
  | 'trails'
  | 'edges'
  | 'threshold'
  | 'posterize'
  | 'colorReplace'
  | 'invert'
  | 'silhouette'
  | 'strobe'
  | 'zoom'
  | 'wave';

export interface EffectInstance {
  id: Id;
  kind: EffectKind;
  enabled: boolean;
  /** Initial parameter values; live values are params `fx.<id>.<name>`. */
  params: Record<string, number>;
}

export type PlaybackMode = 'loop' | 'once' | 'pingpong' | 'hold';

export interface Playback {
  mode: PlaybackMode;
  speed: number;
  volume: number;
  muted: boolean;
  /** Seconds. */
  inPoint: number;
  outPoint: number | null;
}

export interface Layer {
  id: Id;
  name: string;
  visible: boolean;
  locked: boolean;
  source: SourceRef;
  opacity: number;
  blend: BlendMode;
  transform: Transform2D;
  crop: Crop;
  flipH: boolean;
  flipV: boolean;
  masks: Mask[];
  effects: EffectInstance[];
  playback: Playback;
  /** Attach the layer to a tracked point (drawings / graphics following a person). */
  attach?: { cameraId?: Id; feature: string } | null;
}

/** A composition is a scene: a stack of layers rendered at a fixed resolution. */
export interface Composition {
  id: Id;
  name: string;
  width: number;
  height: number;
  background: string;
  /** Bottom-to-top. */
  layers: Layer[];
  /** Effects applied to the whole composition. */
  effects: EffectInstance[];
  /** DMX snapshot recalled when this scene goes to program. */
  dmxSnapshotId?: Id | null;
}

export type TransitionKind = 'cut' | 'fade' | 'dissolve' | 'wipe' | 'flash' | 'glitch' | 'zoom' | 'slide';

export interface TransitionSpec {
  kind: TransitionKind;
  durationMs: number;
}

export interface Mixer {
  /** Composition on deck A (program side). */
  deckA: Id | null;
  /** Composition on deck B (preview side). */
  deckB: Id | null;
  transition: TransitionSpec;
  /** When true, the crossfader is manual; otherwise Take/Auto run the transition. */
  manual: boolean;
}

// ------------------------------------------------------------------ 2D mapping / outputs

export type SurfaceGeometryKind = 'quad' | 'mesh' | 'polygon';

export interface SoftEdge {
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** Blend curve gamma (projector gamma compensation). */
  gamma: number;
}

export interface ColorCorrection {
  brightness: number;
  contrast: number;
  gamma: number;
  red: number;
  green: number;
  blue: number;
}

export interface Surface {
  id: Id;
  name: string;
  visible: boolean;
  locked: boolean;
  /** What the surface shows: usually the program composition, or any other source. */
  source: SourceRef;
  /** Region of the source mapped onto this surface (uv rect). */
  region: { x: number; y: number; w: number; h: number };
  kind: SurfaceGeometryKind;
  quad: Quad;
  mesh: MeshWarp | null;
  /** Polygon outline in output space (kind = 'polygon'; content uses the quad mapping). */
  polygon: Vec2[] | null;
  masks: Mask[];
  softEdge: SoftEdge;
  opacity: number;
  blend: BlendMode;
  color: ColorCorrection;
  effects: EffectInstance[];
}

export type OutputMode = '2d' | '3d';

export interface Output {
  id: Id;
  name: string;
  enabled: boolean;
  kind: 'display' | 'virtual';
  /** Electron display id for physical outputs. */
  displayId: number | null;
  displayLabel?: string;
  fullscreen: boolean;
  width: number;
  height: number;
  fps: number;
  mode: OutputMode;
  surfaces: Surface[];
  /** 3D mode: projector camera that renders this output. */
  projectorId: Id | null;
  /** Final correction warp applied after everything (fine keystone / mesh on any output). */
  finalWarp: MeshWarp | null;
  masks: Mask[];
  softEdge: SoftEdge;
  color: ColorCorrection;
  showTestPattern: boolean;
  /** Identify overlay (big number + name) for setup. */
  identify: boolean;
}

// ------------------------------------------------------------------ 3D

export type Vec3 = [number, number, number];

export type PrimitiveKind = 'cube' | 'plane' | 'sphere' | 'cylinder' | 'cone' | 'pyramid' | 'prism' | 'model';

export interface FaceContent {
  source: SourceRef;
  opacity: number;
  tint: string;
  /** Use projective texturing from this projector instead of UVs (content "thrown" by the projector). */
  projectFrom?: Id | null;
}

export interface Object3D {
  id: Id;
  name: string;
  kind: PrimitiveKind;
  /** model3d media id when kind = 'model'. */
  mediaId?: Id;
  position: Vec3;
  /** Degrees XYZ. */
  rotation: Vec3;
  scale: Vec3;
  visible: boolean;
  locked: boolean;
  group?: string;
  /** Face/material name → content. 'all' applies to every face without its own entry. */
  faces: Record<string, FaceContent>;
}

export interface Projector {
  id: Id;
  name: string;
  position: Vec3;
  rotation: Vec3;
  /** Vertical field of view in degrees. */
  fov: number;
  near: number;
  far: number;
  /** Lens shift as a fraction of the image (projectors usually throw upwards). */
  shiftX: number;
  shiftY: number;
  outputId: Id | null;
  /** Used for the frustum when not bound to an output. */
  width: number;
  height: number;
  color: string;
}

export type Units = 'm' | 'cm' | 'custom';

export interface Stage3D {
  objects: Object3D[];
  projectors: Projector[];
  units: Units;
  /** Meters per custom unit. */
  customUnitMeters: number;
  grid: { size: number; divisions: number; visible: boolean };
  snap: { grid: boolean; vertex: boolean; edge: boolean; face: boolean; increment: number; angle: number };
}

// ------------------------------------------------------------------ cameras / tracking

export interface CameraDef {
  id: Id;
  name: string;
  kind: 'local' | 'url';
  /** MediaDevices deviceId (may change between sessions; label is used to re-find it). */
  deviceId: string;
  label: string;
  /** For 'url' cameras: HTTP(S) MJPEG/HLS/WebRTC-WHEP URL. */
  url?: string;
  width: number;
  height: number;
  fps: number;
  enabled: boolean;
}

export type TrackingQuality = 'low' | 'medium' | 'high' | 'ultra';

export interface TrackingSettings {
  enabled: boolean;
  cameraId: Id | null;
  provider: 'webcam-body' | 'kinect' | 'azure-kinect' | 'depth' | 'ip';
  quality: TrackingQuality;
  fps: 15 | 24 | 30 | 60;
  maxPeople: number;
  hands: boolean;
  segmentation: boolean;
  mirror: boolean;
  zones: Zone[];
}

export interface Zone {
  id: Id;
  name: string;
  /** Normalized camera-space rectangle. */
  rect: { x: number; y: number; w: number; h: number };
  enabled: boolean;
}

// ------------------------------------------------------------------ rules / macros / show

export type ConditionOp = '>' | '>=' | '<' | '<=' | '==' | '!=' | 'rising' | 'falling';

/** `feature` keys come from the feature bus: "tracking.person.count", "audio.beat", "zone.<id>.occupied"… */
export interface Condition {
  feature: string;
  op: ConditionOp;
  value: number;
}

export type Action =
  | { type: 'set'; param: string; value: number }
  | { type: 'ramp'; param: string; value: number; durationMs: number }
  | { type: 'trigger'; param: string }
  | { type: 'scene'; compId: Id; transition?: TransitionSpec }
  | { type: 'cue'; cueId: Id }
  | { type: 'macro'; macroId: Id }
  | { type: 'dmxSnapshot'; snapshotId: Id }
  | { type: 'blackout'; on: boolean }
  | { type: 'transport'; command: 'play' | 'pause' | 'stop' | 'next' | 'previous' };

export interface Rule {
  id: Id;
  name: string;
  enabled: boolean;
  /** All conditions must hold. */
  when: Condition[];
  then: Action[];
  /** Actions when the condition stops holding (e.g. restore color). */
  otherwise: Action[];
  cooldownMs: number;
  /** Who created it: user, ai, zone. */
  origin: 'user' | 'ai' | 'zone';
}

export interface MacroStep {
  action: Action;
  delayMs: number;
}

export interface Macro {
  id: Id;
  name: string;
  steps: MacroStep[];
}

export interface Cue {
  id: Id;
  name: string;
  compId: Id | null;
  transition: TransitionSpec;
  dmxSnapshotId: Id | null;
  macroId: Id | null;
  /** Auto-follow to the next cue after this many ms (null = manual GO). */
  followMs: number | null;
}

export interface Keyframe {
  t: number;
  v: number;
  ease: 'linear' | 'hold' | 'smooth';
}

export interface AutomationLane {
  id: Id;
  param: string;
  keys: Keyframe[];
  enabled: boolean;
}

export interface TimelineMarker {
  id: Id;
  t: number;
  name: string;
  /** Cue fired when the playhead crosses the marker. */
  cueId: Id | null;
}

export interface Timeline {
  durationSec: number;
  fps: number;
  loop: boolean;
  lanes: AutomationLane[];
  markers: TimelineMarker[];
  /** Optional soundtrack (audio media) played in sync with the playhead. */
  audioMediaId: Id | null;
}

export type SyncSource = 'internal' | 'midi-clock' | 'mtc' | 'ltc' | 'osc';

export interface SyncSettings {
  source: SyncSource;
  bpm: number;
  /** Frames per second for MTC/LTC timecode display. */
  timecodeFps: 24 | 25 | 29.97 | 30;
  /** Timeline start offset relative to incoming timecode, seconds. */
  offsetSec: number;
  /** Send MIDI clock / MTC out. */
  sendClock: boolean;
}

// ------------------------------------------------------------------ DMX

export type DmxProtocol = 'artnet' | 'sacn' | 'virtual' | 'usb-pro';

export interface Universe {
  id: Id;
  name: string;
  protocol: DmxProtocol;
  /** Art-Net 15-bit port address (net<<8 | subnet<<4 | universe) or sACN universe 1..63999. */
  number: number;
  destination: { mode: 'broadcast' | 'unicast' | 'multicast'; ip: string };
  enabled: boolean;
  /** Per-universe output delay for sync with projectors (ms). */
  delayMs: number;
  /** sACN priority (0..200). */
  priority: number;
}

export type ChannelRole =
  | 'red'
  | 'green'
  | 'blue'
  | 'white'
  | 'amber'
  | 'uv'
  | 'dimmer'
  | 'strobe'
  | 'pan'
  | 'panFine'
  | 'tilt'
  | 'tiltFine'
  | 'color'
  | 'gobo'
  | 'zoom'
  | 'focus'
  | 'speed'
  | 'custom';

export interface FixtureChannel {
  name: string;
  role: ChannelRole;
  default: number;
}

export interface FixtureType {
  id: Id;
  name: string;
  manufacturer: string;
  channels: FixtureChannel[];
}

export interface FixtureInstance {
  id: Id;
  name: string;
  typeId: Id;
  universeId: Id;
  /** 1-based start address. */
  address: number;
  /** Position on the stage plan (normalized), used for video→light sampling. */
  x: number;
  y: number;
}

export type PixelLayout = 'grid' | 'line' | 'circle' | 'arc' | 'matrix' | 'custom';
export type PixelOrder = 'ltr' | 'rtl' | 'ttb' | 'btt' | 'serpentine' | 'zigzag';
export type PixelFormat = 'RGB' | 'RGBW' | 'GRB' | 'BRG' | 'RBG' | 'GBR' | 'BGR' | 'W' | 'RGBWA';

export interface PixelMap {
  id: Id;
  name: string;
  enabled: boolean;
  layout: PixelLayout;
  /** Grid/matrix: columns × rows. Line/circle/arc: count in `cols`, rows = 1. */
  cols: number;
  rows: number;
  /** Placement in the sampled source (normalized). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Circle/arc: start and end angle in degrees. */
  startAngle: number;
  endAngle: number;
  /** Explicit positions for 'custom' (normalized in source space). */
  custom: Vec2[];
  order: PixelOrder;
  reverse: boolean;
  /** Wiring starts at this corner for grids. */
  startCorner: 'tl' | 'tr' | 'bl' | 'br';
  format: PixelFormat;
  /** First universe id + start channel (1-based). */
  universeId: Id;
  startChannel: number;
  /** Spread over consecutive universes when the map does not fit in one. */
  autoSpan: boolean;
  /** Never split a pixel across two universes. */
  alignPixels: boolean;
  /** Pixels per universe limit (e.g. 170 for RGB) — 0 = as many as fit. */
  pixelsPerUniverse: number;
  source: SourceRef;
  /** Sampling: point, average over a small area, or the source's average color. */
  sampling: 'point' | 'area' | 'average' | 'center';
  sampleSize: number;
  brightness: number;
  gamma: number;
  saturation: number;
  contrast: number;
  /** White channel extraction for RGBW: min(r,g,b) moved to white. */
  whiteExtraction: boolean;
}

export interface DmxSnapshot {
  id: Id;
  name: string;
  /** universe id → 512 bytes, base64. */
  data: Record<Id, string>;
  fadeMs: number;
}

export interface DmxSettings {
  /** Network interface name selected for Art-Net/sACN (null = not chosen yet → no output). */
  interfaceName: string | null;
  interfaceAddress: string | null;
  outputFps: number;
  /** 'sync' delays light output to match projector latency; 'immediate' sends as soon as possible. */
  syncMode: 'sync' | 'immediate';
  globalDelayMs: number;
  useArtSync: boolean;
  universes: Universe[];
  fixtureTypes: FixtureType[];
  fixtures: FixtureInstance[];
  pixelMaps: PixelMap[];
  snapshots: DmxSnapshot[];
  input: { enabled: boolean; protocol: 'artnet' | 'sacn'; universes: number[] };
  /** Known nodes (manual IPs) kept between sessions. */
  manualNodes: string[];
}

// ------------------------------------------------------------------ misc settings

export interface AudioSettings {
  inputDeviceId: string | null;
  gain: number;
  smoothing: number;
  /** Frequency band split points in Hz. */
  bassHz: number;
  trebleHz: number;
  beatSensitivity: number;
}

export interface OscSettings {
  enabled: boolean;
  inPort: number;
  outHost: string;
  outPort: number;
  feedback: boolean;
}

export interface RemoteSettings {
  enabled: boolean;
  port: number;
  /** 4–8 digit PIN required by remote clients. */
  pin: string;
}

export interface MidiSettings {
  /** Device names disabled by the user. */
  disabledInputs: string[];
  disabledOutputs: string[];
  /** Device that receives clock / MTC out. */
  clockOutput: string | null;
  banks: string[];
  /** MIDI thru / routing between devices. */
  routes: { id: Id; from: string; to: string; channels: number[]; enabled: boolean }[];
}

export interface SavedStroke {
  id: number;
  /** Full brush settings used (StrokeBrush). */
  brush: Record<string, unknown>;
  /** Flat x, y, pressure, t samples. */
  points: number[];
}

export interface DrawingLayerDef {
  id: Id;
  name: string;
  width: number;
  height: number;
  /** Non-destructive stroke list (replayed on the GPU when loading / undoing). */
  strokes: SavedStroke[];
}

export interface Project {
  format: typeof PROJECT_FORMAT;
  version: number;
  id: Id;
  name: string;
  createdAt: number;
  modifiedAt: number;
  media: MediaItem[];
  compositions: Composition[];
  mixer: Mixer;
  outputs: Output[];
  stage: Stage3D;
  cameras: CameraDef[];
  tracking: TrackingSettings;
  rules: Rule[];
  macros: Macro[];
  cues: Cue[];
  timeline: Timeline;
  sync: SyncSettings;
  dmx: DmxSettings;
  audio: AudioSettings;
  osc: OscSettings;
  remote: RemoteSettings;
  midi: MidiSettings;
  drawings: DrawingLayerDef[];
  /** All control mappings (MIDI/OSC/DMX/keyboard/audio/tracking). */
  mappings: Mapping[];
  /** Base values of the parameter engine. */
  params: Record<string, number>;
  /** Merge mode overrides per param. */
  mergeModes: Record<string, MergeMode>;
}
