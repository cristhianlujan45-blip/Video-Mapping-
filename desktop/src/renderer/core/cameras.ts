import type { CameraDef } from '../../shared/project/model';
import type { RenderClient } from './renderClient';
import { logToMain } from '../api';

type TrackProcessorCtor = new (init: { track: MediaStreamTrack }) => { readable: ReadableStream<VideoFrame> };

export interface CameraState {
  id: string;
  status: 'connecting' | 'live' | 'offline' | 'error' | 'disabled';
  message?: string;
  width: number;
  height: number;
  fps: number;
  label: string;
}

export interface DeviceInfo {
  deviceId: string;
  label: string;
  kind: 'videoinput' | 'audioinput' | 'audiooutput';
}

/**
 * Cameras (webcams, USB, HDMI/SDI capture cards — anything Windows exposes as a video
 * device). Each camera is opened once; its track is cloned for tracking/recording.
 * A disconnected camera never blocks: the source shows CAMERA OFFLINE and the manager
 * retries until the device returns (matched by label when Windows changes its id).
 */
export class CameraManager {
  private streams = new Map<string, MediaStream>();
  readonly state = new Map<string, CameraState>();
  private defs = new Map<string, CameraDef>();
  private retry = new Map<string, number>();
  private listeners = new Set<() => void>();
  devices: DeviceInfo[] = [];
  /** Consumers that want a clone of a camera's track (tracking worker). */
  private trackTaps = new Map<string, (track: MediaStreamTrack) => void>();

  constructor(private render: RenderClient) {
    navigator.mediaDevices?.addEventListener('devicechange', () => {
      void this.refreshDevices().then(() => {
        for (const [id, s] of this.state) if (s.status === 'offline' || s.status === 'error') this.scheduleRetry(id, 200);
      });
    });
  }

  onChange(l: () => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private changed() {
    for (const l of this.listeners) l();
  }

  async refreshDevices(): Promise<DeviceInfo[]> {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      this.devices = list
        .filter((d) => d.kind === 'videoinput' || d.kind === 'audioinput' || d.kind === 'audiooutput')
        .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `${d.kind === 'videoinput' ? 'Cámara' : 'Audio'} ${i + 1}`, kind: d.kind as DeviceInfo['kind'] }));
      // Labels are empty until permission has been granted once.
      if (this.devices.some((d) => d.kind === 'videoinput' && !d.label)) {
        try {
          const s = await navigator.mediaDevices.getUserMedia({ video: true });
          s.getTracks().forEach((t) => t.stop());
          return this.refreshDevices();
        } catch {
          /* no permission / no camera */
        }
      }
    } catch (e) {
      logToMain('WARN', 'camera', `enumerateDevices: ${(e as Error).message}`);
    }
    this.changed();
    return this.devices;
  }

  sync(defs: CameraDef[]) {
    const ids = new Set(defs.map((d) => d.id));
    for (const id of [...this.streams.keys()]) if (!ids.has(id)) this.close(id);
    for (const id of [...this.state.keys()]) if (!ids.has(id)) this.state.delete(id);
    for (const d of defs) {
      const prev = this.defs.get(d.id);
      this.defs.set(d.id, d);
      const changed = !prev || prev.deviceId !== d.deviceId || prev.width !== d.width || prev.height !== d.height || prev.fps !== d.fps || prev.url !== d.url || prev.enabled !== d.enabled;
      if (!d.enabled) {
        this.close(d.id);
        this.setState(d.id, { status: 'disabled' });
      } else if (changed || !this.streams.has(d.id)) void this.open(d);
    }
  }

  private setState(id: string, patch: Partial<CameraState>) {
    const prev = this.state.get(id) ?? { id, status: 'connecting', width: 0, height: 0, fps: 0, label: this.defs.get(id)?.label ?? '' };
    this.state.set(id, { ...prev, ...patch });
    this.changed();
  }

  private async open(d: CameraDef) {
    this.close(d.id);
    this.setState(d.id, { status: 'connecting', message: undefined });
    this.render.send({ type: 'sourceStatus', key: `camera:${d.id}`, status: 'offline' });
    try {
      let stream: MediaStream;
      if (d.kind === 'url') {
        stream = await this.openUrl(d);
      } else {
        // Find the device again by label if Windows assigned a new id after replugging.
        let deviceId = d.deviceId;
        if (!this.devices.some((x) => x.deviceId === deviceId)) {
          await this.refreshDevices();
          const byLabel = this.devices.find((x) => x.kind === 'videoinput' && x.label === d.label);
          if (byLabel) deviceId = byLabel.deviceId;
          else if (d.deviceId && !this.devices.some((x) => x.deviceId === d.deviceId)) throw new Error('Dispositivo no conectado');
        }
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { deviceId: deviceId ? { exact: deviceId } : undefined, width: { ideal: d.width }, height: { ideal: d.height }, frameRate: { ideal: d.fps } },
        });
      }
      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error('El dispositivo no entrega video');
      this.streams.set(d.id, stream);
      const st = track.getSettings();
      this.setState(d.id, { status: 'live', width: st.width ?? 0, height: st.height ?? 0, fps: Math.round(st.frameRate ?? 0), label: track.label });
      track.addEventListener('ended', () => {
        if (this.streams.get(d.id) !== stream) return;
        this.setState(d.id, { status: 'offline', message: 'Cámara desconectada' });
        this.render.send({ type: 'sourceStatus', key: `camera:${d.id}`, status: 'offline' });
        this.scheduleRetry(d.id, 1500);
      });
      this.feed(d.id, track);
      for (const [key, tap] of this.trackTaps) if (key.startsWith(`${d.id}|`)) tap(track.clone());
      this.retry.delete(d.id);
    } catch (e) {
      const msg = (e as Error).name === 'NotAllowedError' ? 'Permiso de cámara denegado' : (e as Error).name === 'NotReadableError' ? 'La cámara está en uso por otra aplicación' : (e as Error).message;
      this.setState(d.id, { status: 'offline', message: msg });
      this.render.send({ type: 'sourceStatus', key: `camera:${d.id}`, status: 'offline', message: msg });
      this.scheduleRetry(d.id, 3000);
    }
  }

  /** Network cameras that Chromium can play natively (MJPEG over HTTP, HLS, MP4 streams). */
  private async openUrl(d: CameraDef): Promise<MediaStream> {
    if (!d.url) throw new Error('Falta la URL de la cámara IP');
    if (/^rtsp:|^srt:|^ndi:/i.test(d.url)) throw new Error('RTSP/SRT/NDI requieren el módulo de video en red (EN DESARROLLO)');
    const v = document.createElement('video');
    v.crossOrigin = 'anonymous';
    v.muted = true;
    v.autoplay = true;
    v.playsInline = true;
    v.src = d.url;
    await new Promise<void>((resolve, reject) => {
      v.onloadeddata = () => resolve();
      v.onerror = () => reject(new Error('No se pudo abrir el stream (¿URL/credenciales?)'));
      setTimeout(() => reject(new Error('Tiempo de espera agotado')), 10000);
    });
    await v.play();
    return (v as HTMLVideoElement & { captureStream(): MediaStream }).captureStream();
  }

  private feed(id: string, track: MediaStreamTrack) {
    const key = `camera:${id}`;
    const Proc = (globalThis as unknown as { MediaStreamTrackProcessor?: TrackProcessorCtor }).MediaStreamTrackProcessor;
    if (Proc) {
      const proc = new Proc({ track });
      this.render.send({ type: 'stream', key, stream: proc.readable }, [proc.readable as unknown as Transferable]);
      return;
    }
    // Fallback: a hidden <video> with requestVideoFrameCallback.
    const v = document.createElement('video');
    v.muted = true;
    v.srcObject = new MediaStream([track]);
    void v.play();
    const cb = () => {
      if (track.readyState === 'ended') return;
      try {
        const frame = new VideoFrame(v);
        this.render.send({ type: 'frame', key, frame }, [frame]);
      } catch {
        /* not ready */
      }
      v.requestVideoFrameCallback(cb);
    };
    v.requestVideoFrameCallback(cb);
  }

  private scheduleRetry(id: string, ms: number) {
    if (this.retry.has(id)) return;
    const h = window.setTimeout(() => {
      this.retry.delete(id);
      const d = this.defs.get(id);
      if (d?.enabled && this.state.get(id)?.status !== 'live') void this.open(d);
    }, ms);
    this.retry.set(id, h);
  }

  private close(id: string) {
    const s = this.streams.get(id);
    if (s) s.getTracks().forEach((t) => t.stop());
    this.streams.delete(id);
    const r = this.retry.get(id);
    if (r) clearTimeout(r);
    this.retry.delete(id);
  }

  /** Registers a consumer that receives a cloned track (now and after every reconnect). */
  tap(cameraId: string, consumer: string, cb: (track: MediaStreamTrack) => void) {
    this.trackTaps.set(`${cameraId}|${consumer}`, cb);
    const t = this.streams.get(cameraId)?.getVideoTracks()[0];
    if (t && t.readyState === 'live') cb(t.clone());
    return () => this.trackTaps.delete(`${cameraId}|${consumer}`);
  }

  /** One frame of a camera as RGBA ImageData at the requested size (calibration / AI). */
  async grab(cameraId: string, width: number, height: number): Promise<ImageData | null> {
    const track = this.streams.get(cameraId)?.getVideoTracks()[0];
    if (!track || track.readyState !== 'live') return null;
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.srcObject = new MediaStream([track]);
    await v.play().catch(() => {});
    await new Promise<void>((r) => v.requestVideoFrameCallback(() => r()));
    const c = new OffscreenCanvas(width, height);
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(v, 0, 0, width, height);
    v.pause();
    v.srcObject = null;
    return g.getImageData(0, 0, width, height);
  }

  stopAll() {
    for (const id of [...this.streams.keys()]) this.close(id);
    for (const [id] of this.state) this.setState(id, { status: 'disabled' });
  }
}
