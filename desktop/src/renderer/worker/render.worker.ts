/// <reference lib="webworker" />
/**
 * RENDER THREAD. Owns the only WebGL2 context: every composition, effect, 2D/3D mapping,
 * output, preview, pixel map and export is rendered here, away from the UI thread.
 * Outputs (projector/monitor windows) and UI previews are OffscreenCanvases transferred
 * to this worker; each gets a GPU blit of its final texture every frame.
 */
import * as THREE from 'three';
import type { Composition, Layer, Output, PixelMap, Project, SourceRef, Surface } from '../../shared/project/model';
import type { ToDmx } from '../../shared/dmx/messages';
import { FullscreenPass, rawMaterial, rtRef, TargetCache, type TexRef } from './gl';
import { SourceManager, type FrameContext } from './sources';
import { EffectEngine } from './effects';
import { MaskCache } from './masks';
import { Compositor } from './compositor';
import { OutputRenderer } from './outputs';
import { Stage } from './stage';
import { PixelSampler } from './pixelSampler';
import { DrawingEngine } from './drawing';
import { TrackingFx } from './trackingFx';
import { Exporter } from './exporter';
import type { CalibrationPattern, FromRender, QualitySettings, RenderStats, ToRender, ViewSpec } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

interface View {
  spec: ViewSpec;
  canvas: OffscreenCanvas;
  ctx: OffscreenCanvasRenderingContext2D;
  frameCount: number;
}

const post = (m: FromRender, transfer: Transferable[] = []) => self.postMessage(m, transfer);

let renderer: THREE.WebGLRenderer;
let glCanvas: OffscreenCanvas;
let sources: SourceManager;
let effects: EffectEngine;
let masks: MaskCache;
let compositor: Compositor;
let outputsR: OutputRenderer;
let stage: Stage;
let pixels: PixelSampler;
let drawing: DrawingEngine;
let trackingFx: TrackingFx;
let exporter: Exporter;
let presentPass: FullscreenPass;
const viewTargets = new TargetCache();
let dmxPort: MessagePort | null = null;

let project: Project | null = null;
let projectDirty = true;
const params = new Map<string, number>();
const views = new Map<string, View>();
const calibration = new Map<string, CalibrationPattern>();
let quality: QualitySettings = { previewScale: 0.5, previewFps: 30, particleQuality: 0.6, maxFps: 60 };
let selectedObject: string | null = null;
let transitionProgress: number | null = null;
let transitionKind: import('../../shared/project/model').TransitionKind | null = null;
const ctx: FrameContext = { time: 0, beatPhase: 0, audio: { rms: 0, bass: 0, mid: 0, treble: 0, beat: 0, spectrum: new Float32Array(16) }, particleQuality: 0.6 };
const t0 = performance.now();

// stats
let frames = 0;
let dropped = 0;
let frameMsAcc = 0;
let lastFrameT = 0;
let lastStatsT = performance.now();
let gpuMs: number | null = null;
let timerExt: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null = null;
let pendingQuery: WebGLQuery | null = null;
const sectionAcc: Record<string, number> = {};

const param = (id: string) => params.get(id);

function section<T>(name: string, fn: () => T): T {
  const s = performance.now();
  try {
    return fn();
  } finally {
    sectionAcc[name] = (sectionAcc[name] ?? 0) + performance.now() - s;
  }
}

// ------------------------------------------------------------------ init

function init(msg: Extract<ToRender, { type: 'init' }>) {
  glCanvas = new OffscreenCanvas(64, 64);
  renderer = new THREE.WebGLRenderer({
    canvas: glCanvas as unknown as HTMLCanvasElement,
    antialias: false,
    alpha: false,
    depth: true,
    stencil: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
    premultipliedAlpha: false,
  });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.autoClear = false;
  const gl = renderer.getContext() as WebGL2RenderingContext;
  timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  glCanvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    post({ type: 'error', message: 'Se perdió el contexto de GPU (driver reiniciado o GPU sobrecargada). Recreando el motor de render…', fatal: true });
  });
  quality = msg.quality;
  dmxPort = msg.dmxPort;
  dmxPort?.start();
  sources = new SourceManager(renderer);
  effects = new EffectEngine(renderer);
  masks = new MaskCache();
  compositor = new Compositor(renderer, sources, effects, masks);
  outputsR = new OutputRenderer(renderer, effects, masks);
  stage = new Stage(renderer, post);
  pixels = new PixelSampler(renderer, (m: ToDmx) => dmxPort?.postMessage(m), (mapId, colors) => post({ type: 'pixelSample', mapId, colors }, [colors.buffer]));
  drawing = new DrawingEngine(renderer);
  trackingFx = new TrackingFx(renderer);
  exporter = new Exporter(post);
  presentPass = new FullscreenPass(rawMaterial(`in vec2 vUv; out vec4 outColor; uniform sampler2D uTex; uniform float uFlip; void main(){ outColor = vec4(samp(uTex, uFlip, vUv).rgb, 1.0); }`, { uTex: { value: null }, uFlip: { value: 0 } }));
  sources.external = resolveExternal;
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  post({
    type: 'ready',
    renderer: dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER)),
    vendor: dbg ? String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)) : String(gl.getParameter(gl.VENDOR)),
    maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    webgl2: true,
  });
  scheduleFrame();
}

// ------------------------------------------------------------------ source resolution

function compById(id: string): Composition | undefined {
  return project?.compositions.find((c) => c.id === id);
}

const layerVisible = (l: Layer) => (param(`layer.${l.id}.visible`) ?? (l.visible ? 1 : 0)) >= 0.5;

let programTex: TexRef | null = null;

function renderComp(id: string | null | undefined): TexRef | null {
  const c = id ? compById(id) : undefined;
  return c ? compositor.render(c, param, ctx, layerVisible) : null;
}

function program(): TexRef | null {
  if (programTex) return programTex;
  const p = project;
  if (!p) return null;
  const a = renderComp(p.mixer.deckA);
  const b = p.mixer.deckB ? renderComp(p.mixer.deckB) : null;
  const xf = transitionProgress ?? param('mixer.crossfade') ?? 0;
  if (!b || xf <= 0.0001) programTex = a;
  else if (xf >= 0.9999) programTex = b;
  else {
    const ca = compById(p.mixer.deckA ?? '');
    const cb = compById(p.mixer.deckB ?? '');
    const w = Math.max(ca?.width ?? 1920, cb?.width ?? 0);
    const h = Math.max(ca?.height ?? 1080, cb?.height ?? 0);
    programTex = compositor.transition(a, b, xf, transitionKind ?? p.mixer.transition.kind, w, h, ctx.time);
  }
  return programTex;
}

function resolveExternal(ref: SourceRef, w: number, h: number): TexRef | null {
  switch (ref.type) {
    case 'composition':
      if (ref.compId === 'program') return program();
      if (ref.compId === 'preview') return renderComp(project?.mixer.deckB ?? project?.mixer.deckA);
      return renderComp(ref.compId);
    case 'drawing': {
      const d = project?.drawings.find((x) => x.id === ref.drawingId);
      if (d) drawing.ensure(d.id, d.width, d.height);
      return drawing.texture(ref.drawingId);
    }
    case 'tracking':
      return trackingFx.render(ref.style, ref.cameraId, Math.min(w, 1920), Math.min(h, 1080), project?.tracking.mirror ?? true);
    default:
      return null;
  }
}

function resolve(ref: SourceRef, w: number, h: number) {
  return sources.resolve(ref, w, h, ctx);
}

// ------------------------------------------------------------------ frame

let rafHandle = 0;
let usingRaf = typeof self.requestAnimationFrame === 'function';
let lastScheduled = 0;

function scheduleFrame() {
  if (usingRaf) {
    rafHandle = self.requestAnimationFrame(frame);
    // Watchdog: if rAF stalls (no visible canvas), fall back to a timer.
    const id = rafHandle;
    setTimeout(() => {
      if (rafHandle === id && performance.now() - lastScheduled > 100) {
        self.cancelAnimationFrame(id);
        usingRaf = false;
        scheduleFrame();
      }
    }, 120);
  } else {
    setTimeout(() => frame(performance.now()), Math.max(1, 1000 / quality.maxFps - 1));
  }
}

function frame(now: number) {
  lastScheduled = performance.now();
  if (!usingRaf && views.size > 0 && Math.random() < 0.01) usingRaf = typeof self.requestAnimationFrame === 'function';
  const minInterval = 1000 / quality.maxFps;
  if (lastFrameT && now - lastFrameT < minInterval - 2) {
    scheduleFrame();
    return;
  }
  const interval = lastFrameT ? now - lastFrameT : minInterval;
  if (lastFrameT && interval > minInterval * 1.6) dropped += Math.floor(interval / minInterval) - 1;
  lastFrameT = now;
  const start = performance.now();
  try {
    if (project) renderFrame();
  } catch (e) {
    post({ type: 'error', message: `Error de render: ${(e as Error).message}` });
  }
  frameMsAcc += performance.now() - start;
  frames++;
  if (performance.now() - lastStatsT >= 1000) publishStats();
  scheduleFrame();
}

/** GPU frame time via EXT_disjoint_timer_query_webgl2 when the driver exposes it. */
function gpuTimerStart(): boolean {
  if (!timerExt) return false;
  const gl = renderer.getContext() as WebGL2RenderingContext;
  if (pendingQuery) {
    if (!gl.getQueryParameter(pendingQuery, gl.QUERY_RESULT_AVAILABLE)) return false;
    if (!gl.getParameter(timerExt.GPU_DISJOINT_EXT)) gpuMs = (gl.getQueryParameter(pendingQuery, gl.QUERY_RESULT) as number) / 1e6;
    gl.deleteQuery(pendingQuery);
    pendingQuery = null;
  }
  pendingQuery = gl.createQuery();
  if (!pendingQuery) return false;
  gl.beginQuery(timerExt.TIME_ELAPSED_EXT, pendingQuery);
  return true;
}

function gpuTimerEnd(started: boolean) {
  if (!started || !timerExt) return;
  (renderer.getContext() as WebGL2RenderingContext).endQuery(timerExt.TIME_ELAPSED_EXT);
}

function renderFrame() {
  const p = project!;
  ctx.time = (performance.now() - t0) / 1000 * (param('master.speed') ?? 1);
  ctx.particleQuality = quality.particleQuality;
  programTex = null;
  const timerStarted = gpuTimerStart();
  section('sources', () => sources.uploadPending());
  compositor.beginFrame();
  effects.lastMs = 0;
  if (projectDirty) {
    stage.sync(p.stage, selectedObject);
    projectDirty = false;
  }
  section('3d', () => stage.update(param, resolve, p.stage.projectors, p.outputs));

  // OUTPUTS: full quality, every frame
  const blackout = (param('show.blackout') ?? 0) >= 0.5;
  const master = param('master.brightness') ?? 1;
  const finals = new Map<string, TexRef>();
  section('outputs', () => {
    p.outputs.forEach((o, i) => {
      const enabled = (param(`output.${o.id}.enabled`) ?? (o.enabled ? 1 : 0)) >= 0.5;
      if (!enabled) return;
      const hasView = [...views.values()].some((v) => v.spec.target === o.id);
      const usedByPixels = p.dmx.pixelMaps.some((m) => m.enabled && m.source.type === 'composition' && m.source.compId === `output:${o.id}`);
      if (!hasView && !usedByPixels && !exporterTargets(o.id)) return;
      finals.set(
        o.id,
        outputsR.render(o, i, {
          param,
          time: ctx.time,
          master,
          blackout,
          resolveSurfaceSource: (s: Surface, w: number, h: number) => resolve(s.source, w, h),
          render3d: (out: Output, rt: THREE.WebGLRenderTarget) => (out.projectorId ? stage.renderProjector(out.projectorId, rt) : false),
          overlay: (out: Output, idx: number) => (out.identify || out.showTestPattern ? sources.label(out.showTestPattern ? `${idx + 1}` : `${idx + 1}\n${out.name}\n${out.width}×${out.height}`, out.width, out.height, '#ffcc00') : null),
          calibration: (out: Output) => calibration.get(out.id) ?? null,
        }),
      );
    });
  });

  // VIDEO → LIGHTS
  section('pixelmaps', () => {
    if (p.dmx.pixelMaps.some((m) => m.enabled)) {
      pixels.update(p.dmx, (m: PixelMap) => {
        if (m.source.type === 'composition' && typeof m.source.compId === 'string' && m.source.compId.startsWith('output:')) return finals.get(m.source.compId.slice(7)) ?? null;
        return resolve(m.source, 960, 540);
      }, (m: PixelMap) => {
        const masterGain = (param('pixel.master') ?? 1) * (param('dmx.master') ?? 1) * (blackout ? 0 : 1);
        const b = param(`pmap.${m.id}.brightness`) ?? m.brightness;
        return masterGain * (m.brightness > 0 ? b / m.brightness : 0);
      });
    }
  });

  // VIEWS (outputs every frame; previews at preview FPS)
  section('views', () => {
    for (const v of views.values()) {
      v.frameCount++;
      if (v.spec.kind !== 'output' && v.spec.everyNth && v.frameCount % v.spec.everyNth !== 0) continue;
      const tex = viewTexture(v, finals);
      present(v, tex);
    }
  });

  // EXPORT
  const job = exporter.active;
  if (job) {
    const tex = job.target.kind === 'output' ? finals.get(job.target.id ?? '') : job.target.kind === 'composition' ? renderComp(job.target.id) : program();
    if (tex) {
      ensureGlSize(job.width, job.height);
      drawToScreen(tex, job.width, job.height);
      exporter.capture(glCanvas, { x: 0, y: glCanvas.height - job.height, width: job.width, height: job.height });
    }
  }
  sectionAcc.effects = (sectionAcc.effects ?? 0) + effects.lastMs;
  gpuTimerEnd(timerStarted);

  sources.endFrame();
  effects.endFrame();
  outputsR.endFrame();
  trackingFx.endFrame();
  viewTargets.frame++;
  if (viewTargets.frame % 300 === 0) viewTargets.gc(300);
}

function exporterTargets(outputId: string) {
  const j = exporter.active;
  return !!j && j.target.kind === 'output' && j.target.id === outputId;
}

function viewTexture(v: View, finals: Map<string, TexRef>): TexRef | null {
  const s = v.spec;
  const w = v.canvas.width;
  const h = v.canvas.height;
  switch (s.kind) {
    case 'output':
    case 'outputPreview':
      return finals.get(s.target ?? '') ?? null;
    case 'program':
      return program();
    case 'preview':
      return renderComp(project?.mixer.deckB ?? null);
    case 'composition':
      return renderComp(s.target);
    case 'source': {
      const [type, id] = (s.target ?? '').split(':');
      if (type === 'media') return resolve({ type: 'media', mediaId: id }, w, h);
      if (type === 'camera') return resolve({ type: 'camera', cameraId: id }, w, h);
      if (type === 'drawing') return resolve({ type: 'drawing', drawingId: id }, w, h);
      return null;
    }
    case 'projectorView': {
      const rt = viewTargets.get(`pv:${s.id}`, w, h, { depth: true });
      if (!stage.renderProjector(s.target ?? '', rt)) return null;
      return rtRef(rt, true);
    }
    case 'viewport3d': {
      stage.applyViewParams(s.id, param);
      const rt = viewTargets.get(`vp:${s.id}`, w, h, { depth: true, samples: 4 });
      stage.renderViewport(s.id, s.viewMode ?? 'projection', s.showGrid ?? true, w, h, rt);
      return rtRef(rt, true);
    }
  }
}

function ensureGlSize(w: number, h: number) {
  if (glCanvas.width < w || glCanvas.height < h) {
    renderer.setSize(Math.max(glCanvas.width, w), Math.max(glCanvas.height, h), false);
  }
}

function drawToScreen(tex: TexRef, w: number, h: number) {
  const u = presentPass.material.uniforms;
  u.uTex.value = tex.tex;
  u.uFlip.value = tex.flip ? 1 : 0;
  presentPass.render(renderer, null, { x: 0, y: 0, w, h });
}

function present(v: View, tex: TexRef | null) {
  const W = v.canvas.width;
  const H = v.canvas.height;
  if (!tex) {
    v.ctx.fillStyle = '#000';
    v.ctx.fillRect(0, 0, W, H);
    return;
  }
  // Previews keep the source aspect (letterbox); outputs are exact size.
  let dw = W;
  let dh = H;
  let dx = 0;
  let dy = 0;
  if (v.spec.kind !== 'output' && v.spec.kind !== 'viewport3d' && v.spec.kind !== 'outputPreview' && tex.width > 1) {
    const a = tex.width / tex.height;
    if (W / H > a) {
      dw = Math.round(H * a);
      dx = Math.round((W - dw) / 2);
    } else {
      dh = Math.round(W / a);
      dy = Math.round((H - dh) / 2);
    }
  }
  ensureGlSize(dw, dh);
  drawToScreen(tex, dw, dh);
  if (dx || dy) {
    v.ctx.fillStyle = '#000';
    v.ctx.fillRect(0, 0, W, H);
  }
  v.ctx.drawImage(glCanvas, 0, glCanvas.height - dh, dw, dh, dx, dy, dw, dh);
}

function publishStats() {
  const now = performance.now();
  const secs = (now - lastStatsT) / 1000;
  const info = renderer.info;
  const sections: Record<string, number> = {};
  for (const [k, v] of Object.entries(sectionAcc)) {
    sections[k] = Math.round((v / Math.max(1, frames)) * 100) / 100;
    sectionAcc[k] = 0;
  }
  const texBytes = sources.targets.bytes() + effects.targets.bytes() + compositor.targets.bytes() + outputsR.targets.bytes() + viewTargets.bytes() + trackingFx.targets.bytes();
  const stats: RenderStats = {
    fps: Math.round((frames / secs) * 10) / 10,
    frameMs: Math.round((frameMsAcc / Math.max(1, frames)) * 100) / 100,
    gpuMs: gpuMs !== null ? Math.round(gpuMs * 100) / 100 : null,
    dropped,
    drawCalls: info.render.calls,
    triangles: info.render.triangles,
    textures: info.memory.textures,
    geometries: info.memory.geometries,
    textureMB: Math.round(texBytes / 1024 / 1024),
    views: views.size,
    sources: sources.sourceCount,
    videoFramesPerSec: Math.round(sources.videoFramesThisSecond / secs),
    pixelMapsMs: Math.round(pixels.lastMs * 100) / 100,
    effectsMs: sections.effects ?? 0,
    sections,
  };
  sources.videoFramesThisSecond = 0;
  frames = 0;
  dropped = 0;
  frameMsAcc = 0;
  lastStatsT = now;
  post({ type: 'stats', stats });
}

// ------------------------------------------------------------------ messages

self.onmessage = (e: MessageEvent<ToRender>) => {
  const m = e.data;
  try {
    switch (m.type) {
      case 'init':
        init(m);
        break;
      case 'project':
        project = m.project;
        projectDirty = true;
        for (const d of project.drawings) drawing.ensure(d.id, d.width, d.height);
        break;
      case 'params':
        for (const [id, v] of m.changes) params.set(id, v);
        break;
      case 'time':
        ctx.beatPhase = m.beatPhase;
        break;
      case 'audio':
        ctx.audio = { rms: m.rms, bass: m.bass, mid: m.mid, treble: m.treble, beat: m.beat, spectrum: m.spectrum };
        break;
      case 'addView': {
        const c = m.canvas.getContext('2d', { alpha: false, desynchronized: m.spec.kind === 'output' }) as OffscreenCanvasRenderingContext2D;
        views.set(m.spec.id, { spec: m.spec, canvas: m.canvas, ctx: c, frameCount: 0 });
        break;
      }
      case 'updateView': {
        const v = views.get(m.spec.id);
        if (v) v.spec = m.spec;
        break;
      }
      case 'resizeView': {
        const v = views.get(m.id);
        if (v && m.width > 0 && m.height > 0 && (v.canvas.width !== m.width || v.canvas.height !== m.height)) {
          v.canvas.width = Math.round(m.width);
          v.canvas.height = Math.round(m.height);
        }
        break;
      }
      case 'removeView':
        views.delete(m.id);
        viewTargets.dispose(`vp:${m.id}`);
        viewTargets.dispose(`pv:${m.id}`);
        break;
      case 'stream':
        sources.attachStream(m.key, m.stream);
        break;
      case 'frame':
        sources.pushFrame(m.key, m.frame);
        break;
      case 'image':
        sources.setImage(m.key, m.bitmap);
        break;
      case 'dropSource':
        sources.drop(m.key);
        break;
      case 'sourceStatus':
        sources.setStatus(m.key, m.status, m.message);
        break;
      case 'model':
        stage.loadModel(m.key, m.url, m.ext);
        projectDirty = true;
        break;
      case 'tracking':
        trackingFx.setData(m.cameraId, m.people, m.mask);
        break;
      case 'pointer':
        stage.pointer(m.viewId, m.event);
        break;
      case 'key':
        if (m.down) stage.key(m.viewId, m.key, m.code, { shift: m.shift, ctrl: m.ctrl, alt: m.alt });
        break;
      case 'stroke':
        drawing.stroke(m.stroke);
        break;
      case 'drawingCommand':
        if (m.command === 'clear') drawing.clear(m.layerId);
        else if (m.command === 'rebuild') drawing.rebuild(m.layerId, m.strokes ?? []);
        break;
      case 'exportStart':
        void exporter.start(m).catch((err: Error) => post({ type: 'exportProgress', id: m.id, frames: 0, seconds: 0, bytes: 0, fps: 0, done: true, error: err.message }));
        break;
      case 'exportStop':
        void exporter.stop();
        break;
      case 'quality':
        quality = m.quality;
        break;
      case 'uiState':
        selectedObject = m.selectedObject;
        transitionProgress = m.transitionProgress;
        transitionKind = m.transitionKind;
        projectDirty = true;
        break;
      case 'trackingPort':
        m.port.onmessage = (ev: MessageEvent<{ type: 'tracking'; cameraId: string; people: import('../../shared/tracking/pose').TrackedPerson[]; mask: ImageBitmap | null }>) => {
          trackingFx.setData(ev.data.cameraId, ev.data.people, ev.data.mask);
        };
        m.port.start();
        break;
      case 'dmxPort':
        dmxPort?.close();
        dmxPort = m.port;
        dmxPort.start();
        break;
      case 'calibrationPattern':
        if (m.pattern) calibration.set(m.outputId, m.pattern);
        else calibration.delete(m.outputId);
        break;
      case 'loseContext':
        (renderer.getContext().getExtension('WEBGL_lose_context') as { loseContext(): void } | null)?.loseContext();
        renderer.dispose();
        break;
    }
  } catch (err) {
    post({ type: 'error', message: `${m.type}: ${(err as Error).message}` });
  }
};

