import type { Show } from './show';
import { lujan } from '../api';

export interface ExportOptions {
  target: { kind: 'program' | 'output' | 'composition'; id?: string };
  width: number;
  height: number;
  fps: number;
  codec: 'avc' | 'hevc';
  bitrate: number;
  durationSec: number | null;
  timelineRange: { start: number; end: number } | null;
}

export interface ExportState {
  active: boolean;
  path: string | null;
  frames: number;
  seconds: number;
  bytes: number;
  fps: number;
  durationSec: number | null;
  error: string | null;
  done: boolean;
}

/**
 * Background export: the render worker encodes on the GPU and streams MP4 chunks here;
 * they are written to disk by the main process at their muxer positions.
 */
export class ExportManager {
  state: ExportState = { active: false, path: null, frames: 0, seconds: 0, bytes: 0, fps: 0, durationSec: null, error: null, done: false };
  private fileId: number | null = null;
  private writes: Promise<unknown> = Promise.resolve();
  private jobId = 0;
  private listeners = new Set<() => void>();

  constructor(private show: Show) {
    show.render.on((m) => {
      if (m.type === 'exportChunk' && m.id === this.jobId && this.fileId !== null) {
        const fid = this.fileId;
        this.writes = this.writes.then(() => lujan!.invoke('export:write', fid, m.data, m.position)).catch((e: Error) => {
          this.state.error = `Error de escritura: ${e.message}`;
          this.stop();
        });
      } else if (m.type === 'exportProgress' && m.id === this.jobId) {
        this.state = { ...this.state, frames: m.frames, seconds: m.seconds, bytes: m.bytes, fps: m.fps, error: m.error ?? this.state.error };
        if (m.done) void this.finish();
        this.changed();
      }
    });
    show.exportStop = () => this.stop();
  }

  onChange(l: () => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private changed() {
    for (const l of this.listeners) l();
    this.show.emit();
  }

  async start(o: ExportOptions): Promise<boolean> {
    if (this.state.active) return false;
    const name = `${this.show.project.name.replace(/[^\w\- ]+/g, '_')}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.mp4`;
    const path = await lujan!.invoke<string | null>('dialog:saveFile', 'Exportar video', name, ['mp4']);
    if (!path) return false;
    this.fileId = await lujan!.invoke<number>('export:open', path);
    this.jobId++;
    let duration = o.durationSec;
    if (o.timelineRange) {
      duration = Math.max(0.1, o.timelineRange.end - o.timelineRange.start);
      this.show.timeline.seek(o.timelineRange.start);
      this.show.timeline.play();
      this.show.media.play();
    }
    this.state = { active: true, path, frames: 0, seconds: 0, bytes: 0, fps: 0, durationSec: duration, error: null, done: false };
    this.show.render.send({ type: 'exportStart', id: this.jobId, target: o.target, width: o.width, height: o.height, fps: o.fps, codec: o.codec, bitrate: o.bitrate, durationSec: duration });
    this.changed();
    return true;
  }

  stop() {
    if (!this.state.active) return;
    this.show.render.send({ type: 'exportStop', id: this.jobId });
  }

  private async finish() {
    await this.writes;
    if (this.fileId !== null) {
      if (this.state.error && this.state.path) await lujan!.invoke('export:abort', this.fileId, this.state.path);
      else await lujan!.invoke('export:close', this.fileId);
    }
    this.fileId = null;
    this.state = { ...this.state, active: false, done: true };
    this.changed();
  }
}
