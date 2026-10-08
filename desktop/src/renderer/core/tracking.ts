import type { TrackingQuality, TrackingSettings } from '../../shared/project/model';
import { extractFeatures, type TrackedPerson } from '../../shared/tracking/pose';
import type { FeatureBus } from '../../shared/show/rules';
import type { CameraManager } from './cameras';
import type { RenderClient } from './renderClient';
import type { FromTracking, ToTracking } from '../tracking/tracking.worker';

type TrackProcessorCtor = new (init: { track: MediaStreamTrack }) => { readable: ReadableStream<VideoFrame> };

export interface TrackingProviderInfo {
  id: TrackingSettings['provider'];
  name: string;
  available: boolean;
  note: string;
}

/**
 * Tracking provider architecture. Kinect is never required: the webcam provider works
 * with any camera (USB, capture card, IP camera opened as a camera source).
 */
export const TRACKING_PROVIDERS: TrackingProviderInfo[] = [
  { id: 'webcam-body', name: 'Cámara + IA (MediaPipe)', available: true, note: 'Cuerpo completo, varias personas, manos y silueta con cualquier cámara.' },
  { id: 'ip', name: 'Cámara IP + IA', available: true, note: 'Usa una cámara de red añadida en Cámaras (HTTP/MJPEG/HLS).' },
  { id: 'kinect', name: 'Kinect v2', available: false, note: 'EN DESARROLLO: requiere el Kinect SDK 2.0 nativo.' },
  { id: 'azure-kinect', name: 'Azure Kinect', available: false, note: 'EN DESARROLLO: requiere el Azure Kinect Body Tracking SDK nativo.' },
  { id: 'depth', name: 'Cámara de profundidad', available: false, note: 'EN DESARROLLO: RealSense/Orbbec requieren su SDK nativo.' },
];

export const QUALITY_RES: Record<TrackingQuality, [number, number]> = { low: [320, 180], medium: [640, 360], high: [960, 540], ultra: [1280, 720] };

export class TrackingManager {
  private worker: Worker | null = null;
  private untap: (() => void) | null = null;
  status: 'off' | 'loading' | 'ready' | 'running' | 'error' | 'stopped' = 'off';
  message = '';
  delegate = '';
  fps = 0;
  inferenceMs = 0;
  people: TrackedPerson[] = [];
  private listeners = new Set<() => void>();
  private settings: TrackingSettings | null = null;
  private lastKey = '';

  constructor(
    private cameras: CameraManager,
    private render: RenderClient,
    private bus: FeatureBus,
  ) {}

  onChange(l: () => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private changed() {
    for (const l of this.listeners) l();
  }

  private ensureWorker() {
    if (this.worker) return this.worker;
    const w = new Worker('./workers/tracking.js', { name: 'tracking' });
    const ch = new MessageChannel();
    // tracking results go directly to the render worker (no UI-thread hop)
    this.render.send({ type: 'trackingPort', port: ch.port2 }, [ch.port2]);
    const base = new URL('./', location.href).toString();
    w.postMessage({ type: 'init', renderPort: ch.port1, base } satisfies ToTracking, [ch.port1]);
    w.onmessage = (e: MessageEvent<FromTracking>) => {
      const m = e.data;
      if (m.type === 'status') {
        this.status = m.status;
        this.message = m.message ?? '';
        if (m.delegate) this.delegate = m.delegate;
        this.changed();
      } else if (m.type === 'result') {
        this.people = m.people;
        this.fps = m.fps;
        this.inferenceMs = Math.round(m.inferenceMs * 10) / 10;
        const f = extractFeatures(m.people, this.settings?.zones.filter((z) => z.enabled) ?? []);
        for (const [k, v] of Object.entries(f)) this.bus.set(k, v);
        if (m.people.length === 0) this.bus.clear('tracking.p');
      }
    };
    w.onerror = (e) => {
      this.status = 'error';
      this.message = e.message;
      this.changed();
    };
    this.worker = w;
    return w;
  }

  sync(s: TrackingSettings) {
    this.settings = s;
    const key = JSON.stringify([s.enabled, s.cameraId, s.provider, s.quality, s.fps, s.maxPeople, s.hands, s.segmentation]);
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.stop();
    const provider = TRACKING_PROVIDERS.find((p) => p.id === s.provider);
    if (!s.enabled || !s.cameraId) return;
    if (!provider?.available) {
      this.status = 'error';
      this.message = provider?.note ?? 'Proveedor no disponible';
      this.changed();
      return;
    }
    const w = this.ensureWorker();
    const [tw, th] = QUALITY_RES[s.quality];
    w.postMessage({ type: 'config', cameraId: s.cameraId, width: tw, height: th, fps: s.fps, maxPeople: s.maxPeople, hands: s.hands, segmentation: s.segmentation, gpu: true } satisfies ToTracking);
    const Proc = (globalThis as unknown as { MediaStreamTrackProcessor?: TrackProcessorCtor }).MediaStreamTrackProcessor;
    if (!Proc) {
      this.status = 'error';
      this.message = 'MediaStreamTrackProcessor no disponible en este runtime';
      this.changed();
      return;
    }
    const camId = s.cameraId;
    // Re-attaches automatically every time the camera reconnects.
    this.untap = this.cameras.tap(camId, 'tracking', (track) => {
      const proc = new Proc({ track });
      w.postMessage({ type: 'stream', cameraId: camId, stream: proc.readable } satisfies ToTracking, [proc.readable as unknown as Transferable]);
    });
  }

  stop() {
    this.untap?.();
    this.untap = null;
    this.worker?.postMessage({ type: 'stop' } satisfies ToTracking);
    this.people = [];
    this.bus.clear('tracking.');
    this.status = 'off';
    this.changed();
  }
}
