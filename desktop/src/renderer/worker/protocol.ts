import type { Project } from '../../shared/project/model';
import type { BrushPreset } from '../../shared/brushes';
import type { TrackedPerson } from '../../shared/tracking/pose';

export type ViewKind =
  /** Physical/virtual output: full quality, every frame. */
  | 'output'
  /** Downscaled preview of an output in the UI. */
  | 'outputPreview'
  /** Program (mixer result) preview. */
  | 'program'
  /** Deck B / preview composition. */
  | 'preview'
  /** Any composition. */
  | 'composition'
  /** Interactive 3D viewport. */
  | 'viewport3d'
  /** What a projector sees (render from the projector camera). */
  | 'projectorView'
  /** Single source (media thumbnail / camera monitor). */
  | 'source';

export interface ViewSpec {
  id: string;
  kind: ViewKind;
  /** output id / composition id / projector id / source key depending on kind. */
  target?: string;
  /** Preview views: render every Nth frame (UI preview FPS) */
  everyNth?: number;
  /** 3D viewport options */
  viewMode?: ViewMode3D;
  showGrid?: boolean;
  /** Overlay mapping handles (surfaces) on output previews. */
  overlay?: boolean;
}

export type ViewMode3D = 'wireframe' | 'solid' | 'material' | 'texture' | 'projection' | 'projection+wireframe' | 'projection+grid' | 'xray';


export interface DrawStroke {
  layerId: string;
  brush: StrokeBrush;
  /** x, y (normalized 0..1 in drawing space), pressure, time ms — flat array */
  points: Float32Array;
  /** First chunk of a new stroke. */
  start: boolean;
  end: boolean;
  strokeId: number;
}

export type StrokeBrush = BrushPreset & { color: [number, number, number]; erase: boolean };

export type ToRender =
  | { type: 'init'; dmxPort: MessagePort | null; quality: QualitySettings }
  | { type: 'project'; project: Project }
  | { type: 'params'; changes: [string, number][] }
  | { type: 'time'; showTime: number; timelineTime: number; bpm: number; beatPhase: number; playing: boolean }
  | { type: 'audio'; rms: number; bass: number; mid: number; treble: number; beat: number; spectrum: Float32Array }
  | { type: 'addView'; spec: ViewSpec; canvas: OffscreenCanvas }
  | { type: 'updateView'; spec: ViewSpec }
  | { type: 'resizeView'; id: string; width: number; height: number }
  | { type: 'removeView'; id: string }
  | { type: 'stream'; key: string; stream: ReadableStream<VideoFrame> }
  | { type: 'frame'; key: string; frame: VideoFrame }
  | { type: 'image'; key: string; bitmap: ImageBitmap }
  | { type: 'dropSource'; key: string }
  | { type: 'sourceStatus'; key: string; status: 'ok' | 'offline' | 'error'; message?: string }
  | { type: 'model'; key: string; url: string; ext: string }
  | { type: 'tracking'; cameraId: string; people: TrackedPerson[]; mask: ImageBitmap | null; width: number; height: number }
  | { type: 'pointer'; viewId: string; event: PointerMsg }
  | { type: 'key'; viewId: string; key: string; code: string; shift: boolean; ctrl: boolean; alt: boolean; down: boolean }
  | { type: 'stroke'; stroke: DrawStroke }
  | { type: 'drawingCommand'; layerId: string; command: 'clear' | 'undo' | 'redo' | 'rebuild'; strokes?: DrawStroke[] }
  | { type: 'exportStart'; id: number; target: { kind: 'program' | 'output' | 'composition'; id?: string }; width: number; height: number; fps: number; codec: 'avc' | 'hevc'; bitrate: number; durationSec: number | null }
  | { type: 'exportStop'; id: number }
  | { type: 'quality'; quality: QualitySettings }
  | { type: 'trackingPort'; port: MessagePort }
  | { type: 'dmxPort'; port: MessagePort }
  | { type: 'uiState'; selectedObject: string | null; transitionProgress: number | null; transitionKind: import('../../shared/project/model').TransitionKind | null }
  | { type: 'loseContext' }
  | { type: 'calibrationPattern'; outputId: string; pattern: CalibrationPattern | null };

export type CalibrationPattern = { kind: 'gray'; bit: number; axis: 'x' | 'y'; inverted: boolean } | { kind: 'white' } | { kind: 'black' } | { kind: 'dots'; count: number };

export interface PointerMsg {
  kind: 'down' | 'move' | 'up' | 'wheel' | 'leave';
  /** Normalized position inside the view (0..1, y down). */
  x: number;
  y: number;
  button: number;
  buttons: number;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  deltaY?: number;
  width: number;
  height: number;
}

export interface QualitySettings {
  previewScale: number;
  previewFps: number;
  particleQuality: number;
  maxFps: number;
}

export interface RenderStats {
  fps: number;
  frameMs: number;
  gpuMs: number | null;
  dropped: number;
  drawCalls: number;
  triangles: number;
  textures: number;
  geometries: number;
  textureMB: number;
  views: number;
  sources: number;
  videoFramesPerSec: number;
  pixelMapsMs: number;
  effectsMs: number;
  sections: Record<string, number>;
}

export type FromRender =
  | { type: 'ready'; renderer: string; vendor: string; maxTexture: number; webgl2: boolean }
  | { type: 'stats'; stats: RenderStats }
  | { type: 'error'; message: string; fatal?: boolean }
  | { type: 'pick'; viewId: string; objectId: string | null; face: string | null }
  | { type: 'transformed'; objectId: string; kind: 'object' | 'projector'; position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number] }
  | { type: 'viewChanged'; yaw: number; pitch: number; distance: number; panX: number; panY: number; fov: number; ortho: boolean }
  | { type: 'exportProgress'; id: number; frames: number; seconds: number; bytes: number; fps: number; done: boolean; error?: string }
  | { type: 'exportChunk'; id: number; data: Uint8Array; position: number }
  | { type: 'modelInfo'; key: string; materials: string[]; error?: string }
  | { type: 'pixelSample'; mapId: string; colors: Uint8Array }
  | { type: 'drawingStrokes'; layerId: string; count: number };
