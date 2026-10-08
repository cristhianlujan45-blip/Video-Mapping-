import { Muxer, StreamTarget } from 'mp4-muxer';
import type { FromRender } from './protocol';

export interface ExportJob {
  id: number;
  target: { kind: 'program' | 'output' | 'composition'; id?: string };
  width: number;
  height: number;
  fps: number;
  codec: 'avc' | 'hevc';
  bitrate: number;
  durationSec: number | null;
}

/**
 * Real-time hardware video export: rendered frames → WebCodecs VideoEncoder (on Windows
 * Chromium uses Media Foundation, i.e. NVENC / Quick Sync / AMF when present) → MP4
 * muxer → chunks streamed to disk through the main process. The file is never held in RAM.
 */
export class Exporter {
  private job: ExportJob | null = null;
  private encoder: VideoEncoder | null = null;
  private muxer: Muxer<StreamTarget> | null = null;
  private frames = 0;
  private dropped = 0;
  private bytes = 0;
  private startT = 0;
  private nextFrameT = 0;
  private lastProgress = 0;
  hardware: string = 'desconocido';

  constructor(private emit: (m: FromRender, transfer?: Transferable[]) => void) {}

  get active() {
    return this.job;
  }

  async start(job: ExportJob) {
    if (this.job) throw new Error('Ya hay una exportación en curso');
    const codecString = job.codec === 'hevc' ? 'hvc1.1.6.L153.B0' : job.width * job.height > 2048 * 1088 ? 'avc1.640034' : 'avc1.640028';
    let config: VideoEncoderConfig = {
      codec: codecString,
      width: job.width,
      height: job.height,
      bitrate: job.bitrate,
      framerate: job.fps,
      hardwareAcceleration: 'prefer-hardware',
      latencyMode: 'quality',
      ...(job.codec === 'avc' ? { avc: { format: 'avc' } } : {}),
    } as VideoEncoderConfig;
    let support = await VideoEncoder.isConfigSupported(config);
    this.hardware = 'GPU (hardware)';
    if (!support.supported) {
      config = { ...config, hardwareAcceleration: 'no-preference' };
      support = await VideoEncoder.isConfigSupported(config);
      this.hardware = 'software';
    }
    if (!support.supported) throw new Error(job.codec === 'hevc' ? 'Este equipo no puede codificar H.265/HEVC. Usa H.264.' : 'Este equipo no puede codificar H.264 a esta resolución.');
    this.muxer = new Muxer({
      target: new StreamTarget({
        onData: (data, position) => {
          this.bytes = Math.max(this.bytes, position + data.length);
          this.emit({ type: 'exportChunk', id: job.id, data, position }, [data.buffer]);
        },
        chunked: true,
        chunkSize: 4 * 1024 * 1024,
      }),
      video: { codec: job.codec, width: job.width, height: job.height, frameRate: job.fps },
      fastStart: false,
      firstTimestampBehavior: 'offset',
    });
    this.encoder = new VideoEncoder({
      output: (chunk, meta) => this.muxer?.addVideoChunk(chunk, meta),
      error: (e) => void this.stop(e.message),
    });
    this.encoder.configure(config);
    this.job = job;
    this.frames = 0;
    this.dropped = 0;
    this.bytes = 0;
    this.startT = performance.now();
    this.nextFrameT = this.startT;
  }

  /** Called every rendered frame with the canvas holding the export target. */
  capture(source: OffscreenCanvas, visible: { x: number; y: number; width: number; height: number }) {
    const job = this.job;
    const enc = this.encoder;
    if (!job || !enc) return;
    const now = performance.now();
    if (now < this.nextFrameT) return;
    this.nextFrameT += 1000 / job.fps;
    // Rendering fell behind: keep timestamps constant-rate, skip the missed slots.
    while (this.nextFrameT < now - 1000 / job.fps) {
      this.nextFrameT += 1000 / job.fps;
      this.dropped++;
    }
    if (enc.encodeQueueSize > 6) {
      this.dropped++;
      return;
    }
    const ts = Math.round((this.frames * 1e6) / job.fps);
    const frame = new VideoFrame(source, { timestamp: ts, duration: Math.round(1e6 / job.fps), visibleRect: visible });
    enc.encode(frame, { keyFrame: this.frames % (job.fps * 2) === 0 });
    frame.close();
    this.frames++;
    if (job.durationSec !== null && this.frames / job.fps >= job.durationSec) void this.stop();
    if (now - this.lastProgress > 500) {
      this.lastProgress = now;
      this.emit({ type: 'exportProgress', id: job.id, frames: this.frames, seconds: this.frames / job.fps, bytes: this.bytes, fps: this.frames / ((now - this.startT) / 1000), done: false });
    }
  }

  async stop(error?: string) {
    const job = this.job;
    if (!job) return;
    this.job = null;
    try {
      if (this.encoder && this.encoder.state === 'configured') await this.encoder.flush();
      this.encoder?.close();
      this.muxer?.finalize();
    } catch (e) {
      error = error ?? (e as Error).message;
    }
    this.encoder = null;
    this.muxer = null;
    this.emit({ type: 'exportProgress', id: job.id, frames: this.frames, seconds: this.frames / job.fps, bytes: this.bytes, fps: 0, done: true, error });
  }
}
