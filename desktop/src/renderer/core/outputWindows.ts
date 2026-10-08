import type { DisplayInfo } from '../../shared/ipc';
import type { Output } from '../../shared/project/model';
import type { RenderClient } from './renderClient';
import { lujan, logToMain } from '../api';

interface OpenWindow {
  win: Window;
  displayId: number;
  width: number;
  height: number;
  viewId: string;
  canvas: HTMLCanvasElement;
}

export interface OutputWindowState {
  id: string;
  open: boolean;
  displayId: number | null;
  displayPresent: boolean;
  note: string;
}

/**
 * Physical outputs: one borderless fullscreen window per output on its display. The
 * window's canvas is transferred to the render worker, so the projector is fed directly
 * by the GPU thread. If a display disappears the output waits and reopens by itself
 * when the display comes back.
 */
export class OutputWindows {
  private open = new Map<string, OpenWindow>();
  displays: DisplayInfo[] = [];
  readonly state = new Map<string, OutputWindowState>();
  private listeners = new Set<() => void>();
  live = false;

  constructor(private render: RenderClient) {
    lujan?.on('displays:changed', (d) => {
      this.displays = d as DisplayInfo[];
      this.changed();
      this.reconcileNeeded = true;
    });
    lujan?.on('output:closed', (id) => {
      const o = this.open.get(id as string);
      if (o) {
        this.render.detach(o.viewId);
        this.open.delete(id as string);
      }
      this.changed();
    });
  }

  reconcileNeeded = true;

  async refreshDisplays() {
    this.displays = (await lujan?.invoke<DisplayInfo[]>('app:displays')) ?? [];
    this.changed();
    return this.displays;
  }

  onChange(l: () => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private changed() {
    for (const l of this.listeners) l();
  }

  /** Opens/closes/updates windows so they match the project (only while the show is live). */
  sync(outputs: Output[]) {
    const wanted = new Map<string, Output>();
    if (this.live) for (const o of outputs) if (o.enabled && o.kind === 'display' && o.displayId !== null) wanted.set(o.id, o);
    for (const [id, w] of this.open) {
      const o = wanted.get(id);
      const present = o && this.displays.some((d) => d.id === o.displayId);
      if (!o || !present || o.displayId !== w.displayId || w.win.closed) this.closeOne(id);
      else if (o.width !== w.width || o.height !== w.height) {
        w.width = o.width;
        w.height = o.height;
        this.render.resizeFixed(w.viewId, o.width, o.height);
      }
    }
    for (const o of outputs) {
      const present = o.displayId !== null && this.displays.some((d) => d.id === o.displayId);
      const isOpen = this.open.has(o.id);
      this.state.set(o.id, {
        id: o.id,
        open: isOpen,
        displayId: o.displayId,
        displayPresent: present,
        note: o.kind === 'virtual' ? 'Salida virtual (sin ventana)' : !present ? 'Pantalla no conectada — se abrirá sola al conectarla' : isOpen ? 'En vivo' : this.live ? 'Abriendo…' : 'Lista',
      });
    }
    for (const [id, o] of wanted) {
      if (this.open.has(id)) continue;
      if (!this.displays.some((d) => d.id === o.displayId)) continue;
      this.openOne(o);
    }
    this.changed();
  }

  private openOne(o: Output) {
    const name = `lujan-output:${o.id}:${o.displayId}`;
    const win = window.open('./output.html', name);
    if (!win) {
      logToMain('ERROR', 'outputs', `No se pudo abrir la ventana de salida ${o.name}`);
      return;
    }
    const attach = () => {
      const canvas = win.document.getElementById('out') as HTMLCanvasElement | null;
      if (!canvas) {
        setTimeout(attach, 50);
        return;
      }
      const viewId = `output:${o.id}`;
      this.render.attachCanvas(canvas, { id: viewId, kind: 'output', target: o.id }, { width: o.width, height: o.height });
      this.open.set(o.id, { win, displayId: o.displayId!, width: o.width, height: o.height, viewId, canvas });
      win.document.title = `${o.name} — LUJAN MAPPING`;
      this.changed();
    };
    if (win.document.readyState === 'complete' && win.document.getElementById('out')) attach();
    else win.addEventListener('load', attach, { once: true });
  }

  private closeOne(id: string) {
    const w = this.open.get(id);
    if (!w) return;
    this.render.detach(w.viewId);
    try {
      w.win.close();
    } catch {
      /* already closed */
    }
    this.open.delete(id);
  }

  closeAll() {
    for (const id of [...this.open.keys()]) this.closeOne(id);
    this.changed();
  }

  isOpen(id: string) {
    return this.open.has(id);
  }
}
