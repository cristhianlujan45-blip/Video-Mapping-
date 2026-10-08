import type { FromRender, QualitySettings, RenderStats, ToRender, ViewSpec } from '../worker/protocol';
import { logToMain } from '../api';

type Listener = (m: FromRender) => void;

/**
 * UI-side handle of the render worker. Views are canvases whose control is transferred
 * to the worker (OffscreenCanvas); the UI thread never draws frames itself.
 */
export class RenderClient {
  private worker: Worker;
  private listeners = new Set<Listener>();
  stats: RenderStats | null = null;
  info: { renderer: string; vendor: string; maxTexture: number } | null = null;
  lastError: string | null = null;
  private views = new Map<string, { spec: ViewSpec; canvas: HTMLCanvasElement }>();
  private ro: ResizeObserver;

  constructor(dmxPort: MessagePort | null, quality: QualitySettings) {
    this.worker = new Worker('./workers/render.js', { name: 'render' });
    this.worker.onmessage = (e: MessageEvent<FromRender>) => {
      const m = e.data;
      if (m.type === 'stats') this.stats = m.stats;
      else if (m.type === 'ready') this.info = m;
      else if (m.type === 'error') {
        this.lastError = m.message;
        logToMain('ERROR', 'render', m.message);
      }
      for (const l of this.listeners) l(m);
    };
    this.worker.onerror = (e) => {
      this.lastError = e.message;
      logToMain('ERROR', 'render', `worker: ${e.message}`);
    };
    this.send({ type: 'init', dmxPort, quality }, dmxPort ? [dmxPort] : []);
    this.ro = new ResizeObserver((entries) => {
      for (const en of entries) {
        const c = en.target as HTMLCanvasElement;
        const id = c.dataset.viewId;
        if (!id) continue;
        const v = this.views.get(id);
        if (!v || v.spec.kind === 'output') continue;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const scale = v.spec.kind === 'viewport3d' ? 1 : this.previewScale;
        const w = Math.max(16, Math.round(en.contentRect.width * dpr * scale));
        const h = Math.max(16, Math.round(en.contentRect.height * dpr * scale));
        this.send({ type: 'resizeView', id, width: w, height: h });
      }
    });
  }

  previewScale = 1;

  send(m: ToRender, transfer: Transferable[] = []) {
    this.worker.postMessage(m, transfer);
  }

  on(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** Hands a DOM canvas to the worker. Output canvases keep a fixed resolution. */
  attachCanvas(canvas: HTMLCanvasElement, spec: ViewSpec, fixedSize?: { width: number; height: number }) {
    if (this.views.has(spec.id)) this.detach(spec.id);
    canvas.dataset.viewId = spec.id;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = fixedSize?.width ?? Math.max(16, Math.round(rect.width * dpr * (spec.kind === 'viewport3d' ? 1 : this.previewScale)));
    canvas.height = fixedSize?.height ?? Math.max(16, Math.round(rect.height * dpr * (spec.kind === 'viewport3d' ? 1 : this.previewScale)));
    const off = canvas.transferControlToOffscreen();
    this.send({ type: 'addView', spec, canvas: off }, [off]);
    this.views.set(spec.id, { spec, canvas });
    if (!fixedSize) this.ro.observe(canvas);
  }

  updateView(spec: ViewSpec) {
    const v = this.views.get(spec.id);
    if (v) v.spec = spec;
    this.send({ type: 'updateView', spec });
  }

  resizeFixed(id: string, width: number, height: number) {
    this.send({ type: 'resizeView', id, width, height });
  }

  detach(id: string) {
    const v = this.views.get(id);
    if (!v) return;
    this.ro.unobserve(v.canvas);
    this.views.delete(id);
    this.send({ type: 'removeView', id });
  }

  terminate() {
    this.ro.disconnect();
    this.worker.terminate();
  }
}
