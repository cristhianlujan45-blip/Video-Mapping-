import type { Layer, MediaItem, Project, SourceRef } from '../../shared/project/model';
import { mediaUrl } from '../../shared/media';
import type { RenderClient } from './renderClient';
import { logToMain } from '../api';

interface VideoEntry {
  video: HTMLVideoElement;
  lastActive: number;
  feeding: boolean;
  usesProcessor: boolean;
  rvfc: number | null;
  error: string | null;
}

type TrackProcessorCtor = new (init: { track: MediaStreamTrack }) => { readable: ReadableStream<VideoFrame> };

/**
 * Media host: one <video> per media item (hardware-decoded by Chromium), however many
 * layers/outputs use it. Frames go to the render worker as GPU VideoFrames — through a
 * MediaStreamTrackProcessor stream when available (no per-frame work on this thread),
 * otherwise via requestVideoFrameCallback. Inactive media is paused and released.
 */
export class MediaHost {
  private videos = new Map<string, VideoEntry>();
  private images = new Map<string, 'loading' | 'ready' | 'error'>();
  private audio = new Map<string, HTMLAudioElement>();
  readonly thumbs = new Map<string, string>();
  readonly meta = new Map<string, { width: number; height: number; duration: number; error?: string }>();
  playing = true;
  private listeners = new Set<() => void>();

  constructor(private render: RenderClient) {}

  onChange(l: () => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private changed() {
    for (const l of this.listeners) l();
  }

  /** Media ids that must be live right now (program/preview decks, surfaces, 3D faces, pixel maps). */
  static activeMedia(p: Project): Map<string, Layer | null> {
    const out = new Map<string, Layer | null>();
    const visit = (ref: SourceRef, layer: Layer | null, seen: Set<string>) => {
      if (ref.type === 'media') {
        if (!out.has(ref.mediaId) || layer) out.set(ref.mediaId, layer ?? out.get(ref.mediaId) ?? null);
      } else if (ref.type === 'composition') {
        const id = ref.compId === 'program' ? p.mixer.deckA : ref.compId === 'preview' ? p.mixer.deckB : ref.compId;
        if (id) visitComp(id, seen);
        if (ref.compId === 'program' && p.mixer.deckB) visitComp(p.mixer.deckB, seen);
      }
    };
    const visitComp = (id: string, seen: Set<string>) => {
      if (seen.has(id)) return;
      seen.add(id);
      const c = p.compositions.find((x) => x.id === id);
      if (!c) return;
      for (const l of c.layers) if (l.visible) visit(l.source, l, seen);
    };
    if (p.mixer.deckA) visitComp(p.mixer.deckA, new Set());
    if (p.mixer.deckB) visitComp(p.mixer.deckB, new Set());
    for (const o of p.outputs) for (const s of o.surfaces) visit(s.source, null, new Set());
    for (const ob of p.stage.objects) for (const f of Object.values(ob.faces)) visit(f.source, null, new Set());
    for (const pm of p.dmx.pixelMaps) visit(pm.source, null, new Set());
    return out;
  }

  /** Makes the set of live media match the project. Called on project changes. */
  sync(p: Project, extraVisible: Set<string> = new Set()) {
    const active = MediaHost.activeMedia(p);
    for (const id of extraVisible) if (!active.has(id)) active.set(id, null);
    const now = performance.now();
    for (const m of p.media) {
      if (m.kind === 'video') {
        if (active.has(m.id)) this.ensureVideo(m, active.get(m.id) ?? null).lastActive = now;
      } else if (m.kind === 'image' && active.has(m.id)) this.ensureImage(m);
    }
    for (const [id, e] of this.videos) {
      if (!active.has(id)) {
        e.video.pause();
        // release decoder resources after a while
        if (now - e.lastActive > 15000 || !p.media.some((m) => m.id === id)) this.releaseVideo(id);
      } else if (this.playing && e.video.paused && !e.error) void e.video.play().catch(() => {});
    }
    for (const id of [...this.images.keys()]) {
      if (!p.media.some((m) => m.id === id)) {
        this.images.delete(id);
        this.render.send({ type: 'dropSource', key: `media:${id}` });
      }
    }
  }

  private ensureVideo(m: MediaItem, layer: Layer | null): VideoEntry {
    let e = this.videos.get(m.id);
    if (!e) {
      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.preload = 'auto';
      video.playsInline = true;
      video.muted = true;
      video.loop = true;
      video.src = mediaUrl(m.path);
      e = { video, lastActive: performance.now(), feeding: false, usesProcessor: false, rvfc: null, error: null };
      const entry = e;
      this.videos.set(m.id, e);
      video.addEventListener('loadedmetadata', () => {
        this.meta.set(m.id, { width: video.videoWidth, height: video.videoHeight, duration: video.duration });
        this.startFeeding(m.id, entry);
        this.changed();
      });
      video.addEventListener('error', () => {
        const code = video.error?.code;
        entry.error = code === 4 ? 'Formato o códec no soportado' : code === 2 ? 'Error de red/lectura' : code === 3 ? 'Error de decodificación' : 'No se pudo abrir el archivo';
        this.meta.set(m.id, { width: 0, height: 0, duration: 0, error: entry.error });
        this.render.send({ type: 'sourceStatus', key: `media:${m.id}`, status: 'error', message: entry.error });
        logToMain('WARN', 'media', `${m.name}: ${entry.error}`);
        this.changed();
      });
      video.addEventListener('ended', () => {
        if (layer?.playback.mode === 'pingpong') {
          video.currentTime = Math.max(0, video.duration - 0.05);
        }
      });
      if (this.playing) void video.play().catch(() => {});
    }
    this.applyPlayback(e, layer);
    return e;
  }

  private applyPlayback(e: VideoEntry, layer: Layer | null) {
    const pb = layer?.playback;
    const v = e.video;
    if (!pb) return;
    v.loop = pb.mode === 'loop';
    const rate = Math.max(0.0625, Math.min(16, Math.abs(pb.speed)));
    if (v.playbackRate !== rate) v.playbackRate = rate;
    v.muted = pb.muted;
    v.volume = Math.max(0, Math.min(1, pb.volume));
    if (pb.mode === 'hold') v.pause();
  }

  /** Live speed/volume from the parameter engine (MIDI fader on layer speed, etc.). */
  applyLive(mediaId: string, speed: number | undefined, volume: number | undefined) {
    const e = this.videos.get(mediaId);
    if (!e) return;
    if (speed !== undefined) {
      const rate = Math.max(0.0625, Math.min(16, Math.abs(speed)));
      if (Math.abs(e.video.playbackRate - rate) > 1e-3) e.video.playbackRate = rate;
      if (speed === 0 && !e.video.paused) e.video.pause();
    }
    if (volume !== undefined) e.video.volume = Math.max(0, Math.min(1, volume));
  }

  private startFeeding(id: string, e: VideoEntry) {
    if (e.feeding) return;
    e.feeding = true;
    const key = `media:${id}`;
    const Proc = (globalThis as unknown as { MediaStreamTrackProcessor?: TrackProcessorCtor }).MediaStreamTrackProcessor;
    const cap = (e.video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream;
    if (Proc && cap) {
      try {
        const stream = cap.call(e.video);
        const track = stream.getVideoTracks()[0];
        if (track) {
          const proc = new Proc({ track });
          this.render.send({ type: 'stream', key, stream: proc.readable }, [proc.readable as unknown as Transferable]);
          e.usesProcessor = true;
          return;
        }
      } catch (err) {
        logToMain('WARN', 'media', `captureStream no disponible, usando requestVideoFrameCallback: ${(err as Error).message}`);
      }
    }
    const v = e.video;
    const cb = () => {
      if (!this.videos.has(id)) return;
      try {
        const frame = new VideoFrame(v);
        this.render.send({ type: 'frame', key, frame }, [frame]);
      } catch {
        /* frame not ready */
      }
      e.rvfc = v.requestVideoFrameCallback(cb);
    };
    e.rvfc = v.requestVideoFrameCallback(cb);
  }

  private releaseVideo(id: string) {
    const e = this.videos.get(id);
    if (!e) return;
    if (e.rvfc !== null) e.video.cancelVideoFrameCallback(e.rvfc);
    e.video.pause();
    e.video.removeAttribute('src');
    e.video.load();
    this.videos.delete(id);
    this.render.send({ type: 'dropSource', key: `media:${id}` });
  }

  private ensureImage(m: MediaItem) {
    if (this.images.has(m.id)) return;
    this.images.set(m.id, 'loading');
    void (async () => {
      try {
        const res = await fetch(mediaUrl(m.path));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        let bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
        const max = 8192;
        if (bitmap.width > max || bitmap.height > max) {
          const s = max / Math.max(bitmap.width, bitmap.height);
          const b2 = await createImageBitmap(bitmap, { resizeWidth: Math.round(bitmap.width * s), resizeHeight: Math.round(bitmap.height * s), resizeQuality: 'high' });
          bitmap.close();
          bitmap = b2;
        }
        this.meta.set(m.id, { width: bitmap.width, height: bitmap.height, duration: 0 });
        this.render.send({ type: 'image', key: `media:${m.id}`, bitmap }, [bitmap]);
        this.images.set(m.id, 'ready');
      } catch (err) {
        this.images.set(m.id, 'error');
        this.meta.set(m.id, { width: 0, height: 0, duration: 0, error: (err as Error).message });
        this.render.send({ type: 'sourceStatus', key: `media:${m.id}`, status: 'error', message: 'No se pudo abrir la imagen' });
      }
      this.changed();
    })();
  }

  // ---------------------------------------------------------------- transport

  play() {
    this.playing = true;
    for (const e of this.videos.values()) if (!e.error) void e.video.play().catch(() => {});
  }

  pause() {
    this.playing = false;
    for (const e of this.videos.values()) e.video.pause();
  }

  stop() {
    this.pause();
    for (const e of this.videos.values()) e.video.currentTime = 0;
  }

  restart(mediaIds?: string[]) {
    for (const [id, e] of this.videos) if (!mediaIds || mediaIds.includes(id)) e.video.currentTime = 0;
  }

  seek(mediaId: string, t: number) {
    const e = this.videos.get(mediaId);
    if (e) e.video.currentTime = t;
  }

  videoState(mediaId: string) {
    const e = this.videos.get(mediaId);
    if (!e) return null;
    return { time: e.video.currentTime, duration: e.video.duration, paused: e.video.paused, error: e.error, decoding: e.usesProcessor ? 'stream' : 'rvfc' };
  }

  get liveVideos() {
    return this.videos.size;
  }

  // ---------------------------------------------------------------- audio files

  audioElement(m: MediaItem): HTMLAudioElement {
    let a = this.audio.get(m.id);
    if (!a) {
      a = new Audio(mediaUrl(m.path));
      a.crossOrigin = 'anonymous';
      a.preload = 'auto';
      this.audio.set(m.id, a);
    }
    return a;
  }

  // ---------------------------------------------------------------- background import work

  /** Metadata + thumbnail in the background; never blocks and never pops dialogs. */
  async analyze(m: MediaItem): Promise<Partial<MediaItem>> {
    try {
      if (m.kind === 'image') {
        const res = await fetch(mediaUrl(m.path));
        const bm = await createImageBitmap(await res.blob(), { resizeWidth: 320, resizeQuality: 'medium' });
        const full = await createImageBitmap(await (await fetch(mediaUrl(m.path))).blob());
        const dims = { width: full.width, height: full.height };
        full.close();
        this.thumbs.set(m.id, await bitmapToUrl(bm));
        this.changed();
        return dims;
      }
      if (m.kind === 'video') {
        const v = document.createElement('video');
        v.crossOrigin = 'anonymous';
        v.muted = true;
        v.preload = 'auto';
        v.src = mediaUrl(m.path);
        await new Promise<void>((resolve, reject) => {
          v.onloadedmetadata = () => resolve();
          v.onerror = () => reject(new Error(v.error?.code === 4 ? 'Formato o códec no soportado' : 'No se pudo leer el video'));
        });
        const info = { width: v.videoWidth, height: v.videoHeight, durationSec: v.duration };
        v.currentTime = Math.min(v.duration * 0.1, 5);
        await new Promise<void>((resolve) => {
          v.onseeked = () => resolve();
          setTimeout(resolve, 3000);
        });
        const bm = await createImageBitmap(v, { resizeWidth: 320, resizeQuality: 'medium' });
        this.thumbs.set(m.id, await bitmapToUrl(bm));
        v.removeAttribute('src');
        v.load();
        this.changed();
        return info;
      }
      if (m.kind === 'audio') {
        const a = new Audio(mediaUrl(m.path));
        await new Promise<void>((resolve, reject) => {
          a.onloadedmetadata = () => resolve();
          a.onerror = () => reject(new Error('No se pudo leer el audio'));
        });
        return { durationSec: a.duration };
      }
    } catch (err) {
      this.meta.set(m.id, { width: 0, height: 0, duration: 0, error: (err as Error).message });
      this.changed();
    }
    return {};
  }
}

async function bitmapToUrl(bm: ImageBitmap): Promise<string> {
  const c = new OffscreenCanvas(bm.width, bm.height);
  c.getContext('2d')!.drawImage(bm, 0, 0);
  bm.close();
  const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
  return URL.createObjectURL(blob);
}
