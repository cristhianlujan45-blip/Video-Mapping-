import { ParameterEngine } from '../../shared/params/ParameterEngine';
import type { InputAddress, Mapping } from '../../shared/params/types';
import { FeatureBus, MacroRunner, RuleEngine } from '../../shared/show/rules';
import { AutomationRecorder } from '../../shared/show/timeline';
import { parseProject, serializeProject } from '../../shared/project/codec';
import { createComposition, createEffect, createLayer, createProject } from '../../shared/project/defaults';
import { uid, type Action, type EffectKind, type MediaItem, type Project, type Rule, type TransitionSpec } from '../../shared/project/model';
import { mediaUrl } from '../../shared/media';
import type { AppInfo, NetInterfaceInfo, RecoveryInfo } from '../../shared/ipc';
import type { RemoteState } from '../../shared/net/messages';
import { formatTimecode } from '../../shared/midi/midi';
import { ProjectStore, replaceById } from './store';
import { globalBindings, projectBindings, type Binding } from './bindings';
import { RenderClient } from './renderClient';
import { MediaHost } from './media';
import { CameraManager } from './cameras';
import { MidiManager } from './midi';
import { AudioManager } from './audio';
import { DmxClient } from './dmx';
import { NetClient } from './net';
import { TrackingManager } from './tracking';
import { OutputWindows } from './outputWindows';
import { TimelinePlayer } from './timeline';
import { Assistant } from './assistant';
import { requestPorts, waitPort } from './ports';
import { lujan, logToMain } from '../api';
import type { QualitySettings } from '../worker/protocol';

export interface UiState {
  mode: 'simple' | 'pro';
  selectedComp: string | null;
  selectedLayer: string | null;
  selectedOutput: string | null;
  selectedSurface: string | null;
  selectedObject: string | null;
  selectedFace: string | null;
  selectedPixelMap: string | null;
  transition: { from: number; durationMs: number; kind: TransitionSpec['kind'] } | null;
  performance: boolean;
  learnTarget: string | null;
  lastLearn: string | null;
  toast: { text: string; kind: 'info' | 'warn' | 'error'; t: number } | null;
}

type Listener = () => void;

/**
 * The show runtime: the single place where the project, the parameter engine, the GPU
 * renderer and every device meet. UI components only call methods on it.
 */
export class Show {
  readonly engine = new ParameterEngine();
  readonly bus = new FeatureBus();
  readonly store: ProjectStore;
  render!: RenderClient;
  media!: MediaHost;
  cameras!: CameraManager;
  midi!: MidiManager;
  audio = new AudioManager();
  dmx!: DmxClient;
  net!: NetClient;
  tracking!: TrackingManager;
  outputs!: OutputWindows;
  timeline!: TimelinePlayer;
  rules: RuleEngine;
  macros: MacroRunner;
  recorder = new AutomationRecorder();
  assistant: Assistant;
  info: AppInfo | null = null;
  interfaces: NetInterfaceInfo[] = [];
  ui: UiState = {
    mode: 'simple',
    selectedComp: null,
    selectedLayer: null,
    selectedOutput: null,
    selectedSurface: null,
    selectedObject: null,
    selectedFace: null,
    selectedPixelMap: null,
    transition: null,
    performance: false,
    learnTarget: null,
    lastLearn: null,
    toast: null,
  };
  private bindings = new Map<string, Binding>();
  private listeners = new Set<Listener>();
  private tickHandle = 0;
  private autosaveTimer = 0;
  private lastSentProject: Project | null = null;
  private tapTimes: number[] = [];
  private quality: QualitySettings = { previewScale: 0.5, previewFps: 30, particleQuality: 0.6, maxFps: 60 };
  private cueIndex = -1;
  private followTimer = 0;
  private ramps = new Map<string, { from: number; to: number; t0: number; ms: number }>();
  ready = false;
  readonly modelInfo = new Map<string, { materials: string[]; error?: string }>();
  fatal: string | null = null;
  recovery: RecoveryInfo | null = null;

  constructor() {
    this.store = new ProjectStore(createProject());
    this.rules = new RuleEngine(this.bus, (a) => this.exec(a));
    this.macros = new MacroRunner((a) => this.exec(a));
    this.assistant = new Assistant({
      project: () => this.store.project,
      params: () => this.engine.list(),
      addRule: (r) => this.update((p) => ({ ...p, rules: [...p.rules, r] })),
      setParam: (id, v) => this.setParam(id, v),
      goScene: (id) => this.goScene(id),
      addAudioMapping: (feature, param, min, max) => this.addMapping({ kind: 'audio', device: 'audio', control: feature }, param, { min, max }).id,
      addZone: (name, rect) => {
        const id = uid('zone');
        this.update((p) => ({ ...p, tracking: { ...p.tracking, zones: [...p.tracking.zones, { id, name, rect, enabled: true }] } }));
        return id;
      },
      addEffect: (target, targetId, kind) => this.addEffect(target, targetId, kind as EffectKind),
      blackout: (on) => this.setParam('show.blackout', on ? 1 : 0),
      createMacro: (name, actions, delays) => {
        const id = uid('macro');
        this.update((p) => ({ ...p, macros: [...p.macros, { id, name, steps: actions.map((action, i) => ({ action, delayMs: delays[i] ?? 0 })) }] }));
        return id;
      },
    });
  }

  // ---------------------------------------------------------------- lifecycle

  async start() {
    this.info = (await lujan?.invoke<AppInfo>('app:info')) ?? null;
    const settings = (await lujan?.invoke<{ uiMode: 'simple' | 'pro'; previewScale: number; previewFps: number }>('settings:get')) ?? null;
    if (settings) {
      this.ui.mode = settings.uiMode;
      this.quality.previewScale = settings.previewScale;
      this.quality.previewFps = settings.previewFps;
    }
    await requestPorts();
    const dmxRender = await waitPort('dmx:render', 4000);
    this.render = new RenderClient(dmxRender, this.quality);
    this.render.previewScale = this.quality.previewScale;
    this.render.on((m) => {
      if (m.type === 'pick') {
        this.ui.selectedObject = m.objectId;
        this.ui.selectedFace = m.face;
        this.sendUiState();
        this.emit();
      } else if (m.type === 'transformed') this.commitTransform(m);
      else if (m.type === 'modelInfo') {
        this.modelInfo.set(m.key, { materials: m.materials, error: m.error });
        this.emit();
      }
      else if (m.type === 'viewChanged') {
        for (const [k, v] of Object.entries({ 'view.yaw': m.yaw, 'view.pitch': m.pitch, 'view.distance': m.distance, 'view.panX': m.panX, 'view.panY': m.panY, 'view.fov': m.fov }))
          this.engine.set(k, v, 'ui');
      } else if (m.type === 'error' && m.fatal) {
        this.fatal = m.message;
        this.emit();
      }
    });
    this.media = new MediaHost(this.render);
    this.cameras = new CameraManager(this.render);
    this.midi = new MidiManager(this.engine);
    this.dmx = new DmxClient(this.engine);
    this.net = new NetClient(this.engine);
    this.tracking = new TrackingManager(this.cameras, this.render, this.bus);
    this.outputs = new OutputWindows(this.render);
    this.timeline = new TimelinePlayer(this.engine);
    this.timeline.onMarker = (cueId) => this.goCue(cueId);
    for (const s of [this.media, this.cameras, this.midi, this.dmx, this.net, this.tracking, this.outputs]) s.onChange(() => this.emit());

    this.midi.onTimecode = (s) => this.store.project.sync.source === 'mtc' && this.timeline.external(s);
    this.audio.onLtc = (s) => this.store.project.sync.source === 'ltc' && this.timeline.external(s);
    this.net.onOscTime = (s) => this.store.project.sync.source === 'osc' && this.timeline.external(s);
    this.net.onRemote = (c) => this.onRemote(c);
    this.net.onOscCommand = (addr, v) => this.onOscCommand(addr, v);
    this.engine.onTrigger((id) => this.onTrigger(id));
    // tracking/zone features → parameter mappings (only when they change)
    this.bus.onChange((keys) => {
      for (const key of keys) if (key.startsWith('tracking.') || key.startsWith('zone.')) this.engine.input({ kind: 'tracking', device: 'tracking', control: key }, Math.max(0, Math.min(1, this.bus.get(key))));
    });
    this.engine.onContribution((id, v, src) => this.recorder.record(id, v, src, performance.now() / 1000));

    for (const b of globalBindings()) this.registerBinding(b);
    this.store.subscribe((p, prev) => this.onProject(p, prev));
    this.onProject(this.store.project, this.store.project);

    await Promise.all([this.midi.init(), this.outputs.refreshDisplays(), this.cameras.refreshDevices().catch(() => [])]);
    this.interfaces = (await lujan?.invoke<NetInterfaceInfo[]>('app:interfaces')) ?? [];

    lujan?.on('app:prepare-shutdown', (reason) => void this.prepareShutdown(reason as string));
    this.recovery = (await lujan?.invoke<RecoveryInfo | null>('project:recovery')) ?? null;
    this.loop();
    this.autosaveTimer = window.setInterval(() => void this.autosave(), 30_000);
    this.ready = true;
    this.emit();
  }

  subscribe(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private emitScheduled = false;
  emit() {
    if (this.emitScheduled) return;
    this.emitScheduled = true;
    queueMicrotask(() => {
      this.emitScheduled = false;
      for (const l of this.listeners) l();
    });
  }

  get project() {
    return this.store.project;
  }

  update(fn: (p: Project) => Project, opts?: { undoable?: boolean }) {
    this.store.update(fn, opts);
  }

  toast(text: string, kind: 'info' | 'warn' | 'error' = 'info') {
    this.ui.toast = { text, kind, t: Date.now() };
    this.emit();
  }

  // ---------------------------------------------------------------- project ↔ engine

  private registerBinding(b: Binding) {
    this.bindings.set(b.def.id, b);
    this.engine.register(b.def);
  }

  private onProject(p: Project, prev: Project) {
    // parameters for every object in the project
    const next = projectBindings(p);
    const ids = new Set(next.map((b) => b.def.id));
    for (const [id, b] of this.bindings) {
      if (b.def.owner && !ids.has(id)) {
        this.engine.unregister(id);
        this.bindings.delete(id);
      }
    }
    for (const b of next) {
      const existed = this.engine.has(b.def.id);
      this.registerBinding(b);
      if (b.get) {
        const v = b.get(p);
        const cur = this.engine.get(b.def.id);
        if (!existed || (cur && Math.abs(this.uiValue(b.def.id) - v) > 1e-9)) this.engine.set(b.def.id, v, 'ui');
      }
    }
    if (p !== prev && p.id !== prev.id) {
      // new project: mappings, merge modes and saved base values
      this.engine.setMappings(p.mappings);
      for (const [id, mode] of Object.entries(p.mergeModes)) this.engine.setMergeMode(id, mode);
      this.engine.restoreValues(Object.fromEntries(Object.entries(p.params).filter(([id]) => !this.bindings.get(id)?.get)));
    }
    if (this.ui.selectedComp === null || !p.compositions.some((c) => c.id === this.ui.selectedComp)) this.ui.selectedComp = p.mixer.deckA ?? p.compositions[0]?.id ?? null;
    if (this.render) {
      this.render.send({ type: 'project', project: p });
      this.lastSentProject = p;
      this.media.sync(p);
      this.cameras.sync(p.cameras);
      this.tracking.sync(p.tracking);
      this.outputs.sync(p.outputs);
      this.rules.setRules(p.rules);
      this.audio.configure(p.audio);
      this.timeline.source = p.sync.source;
      this.midi.disabledInputs = new Set(p.midi.disabledInputs);
      this.midi.disabledOutputs = new Set(p.midi.disabledOutputs);
      const iface = this.interfaces.find((i) => i.name === p.dmx.interfaceName && i.address === p.dmx.interfaceAddress) ?? null;
      this.dmx.sync(p, iface);
      void this.net.sync(p);
      for (const m of p.media) if (m.kind === 'model3d') this.render.send({ type: 'model', key: m.id, url: mediaUrl(m.path), ext: m.path.split('.').pop() ?? '' });
    }
    this.emit();
  }

  private uiValue(id: string): number {
    return this.engine.baseValue(id) ?? this.engine.value(id);
  }

  /** UI write: live value + persisted (undoable) base value. Use begin/commit for drags. */
  setParam(id: string, v: number) {
    this.engine.set(id, v, 'ui');
    const b = this.bindings.get(id);
    if (b?.set) this.store.update((p) => b.set!(p, this.engine.value(id)));
  }

  beginEdit() {
    this.store.begin();
  }

  commitEdit() {
    this.store.commit();
  }

  // ---------------------------------------------------------------- main loop (UI thread, ~60 Hz)

  private loop = () => {
    this.tickHandle = requestAnimationFrame(this.loop);
    try {
      this.tick();
    } catch (e) {
      logToMain('ERROR', 'show', `tick: ${(e as Error).message}`);
    }
  };

  private lastRemote = 0;

  private tick() {
    const p = this.store.project;
    // audio → features + mappings
    const af = this.audio.tick();
    if (af) {
      for (const k of ['rms', 'bass', 'mid', 'treble', 'beat', 'onset'] as const) {
        this.bus.set(`audio.${k}`, af[k]);
        this.engine.input({ kind: 'audio', device: 'audio', control: k }, af[k]);
      }
      this.bus.set('audio.bpm', af.bpm);
      this.render.send({ type: 'audio', rms: af.rms, bass: af.bass, mid: af.mid, treble: af.treble, beat: af.beat, spectrum: af.spectrum.slice() });
    }
    // rules
    this.bus.flush();
    this.rules.evaluate();
    // ramps (macro/AI "ramp" actions)
    const now = performance.now();
    for (const [id, r] of this.ramps) {
      const k = Math.min(1, (now - r.t0) / r.ms);
      this.engine.set(id, r.from + (r.to - r.from) * k, 'macro');
      if (k >= 1) this.ramps.delete(id);
    }
    // timeline / sync
    this.timeline.tick(p.timeline, p.sync.offsetSec, this.midi.clock.bpm || null, this.midi.clock.running, this.midi.clock.beats);
    // transitions (TAKE)
    const tp = this.transitionProgress();
    if (this.ui.transition && tp !== null && tp >= 1) this.finishTransition();
    // parameter changes → GPU worker, DMX, feedback
    const changes = this.engine.flush();
    if (changes.length) {
      this.render.send({ type: 'params', changes: changes.map((c) => [c.id, c.value]) });
      for (const c of changes) this.onParamChanged(c.id, c.value);
    }
    if (this.ui.transition) this.sendUiState();
    this.dmx.pushFixtures(p.dmx, this.engine.value('dmx.master', 1) * (this.engine.value('show.blackout') >= 0.5 ? 0 : 1));
    if (this.outputs.reconcileNeeded) {
      this.outputs.reconcileNeeded = false;
      this.outputs.sync(p.outputs);
    }
    if (now - this.lastRemote > 300) {
      this.lastRemote = now;
      this.net.publishRemote(this.remoteState());
    }
  }

  private onParamChanged(id: string, v: number) {
    if (id === 'show.blackout') {
      this.dmx.blackout(v >= 0.5);
      this.emit();
    } else if (id.startsWith('layer.') && (id.endsWith('.speed') || id.endsWith('.volume'))) {
      const layerId = id.split('.')[1];
      for (const c of this.project.compositions) {
        const l = c.layers.find((x) => x.id === layerId);
        if (l?.source.type === 'media') this.media.applyLive(l.source.mediaId, id.endsWith('.speed') ? v * this.engine.value('master.speed', 1) : undefined, id.endsWith('.volume') ? v : undefined);
      }
    } else if (id === 'master.speed') {
      for (const c of this.project.compositions)
        for (const l of c.layers) if (l.source.type === 'media') this.media.applyLive(l.source.mediaId, this.engine.value(`layer.${l.id}.speed`, 1) * v, undefined);
    } else if (id === 'audio.gain') this.audio.configure({ ...this.project.audio, gain: v });
    if (this.project.osc.enabled && this.project.osc.feedback) this.net.oscSend(`/lujan/param/${id}`, [v]);
  }

  // ---------------------------------------------------------------- triggers / actions

  private onTrigger(id: string) {
    const parts = id.split('.');
    switch (id) {
      case 'show.play':
        return this.play();
      case 'show.pause':
        return this.pause();
      case 'show.stop':
        return this.stop();
      case 'show.next':
        return this.next();
      case 'show.previous':
        return this.previous();
      case 'show.take':
        return this.take();
      case 'show.cut':
        return this.cut();
      case 'sync.tap':
        return this.tap();
      case 'timeline.play':
        return this.timeline.playing ? this.timeline.pause() : this.timeline.play();
      case 'timeline.stop':
        return this.timeline.stop();
      case 'timeline.record':
        return this.toggleRecord();
    }
    if (parts[0] === 'comp' && parts[2] === 'go') return this.goScene(parts[1]);
    if (parts[0] === 'comp' && parts[2] === 'preview') return this.toPreview(parts[1]);
    if (parts[0] === 'cue' && parts[2] === 'go') return this.goCue(parts[1]);
    if (parts[0] === 'macro' && parts[2] === 'run') {
      const m = this.project.macros.find((x) => x.id === parts[1]);
      if (m) this.macros.run(m);
      return;
    }
    if (parts[0] === 'snapshot' && parts[2] === 'recall') return this.recallSnapshot(parts[1]);
  }

  exec(a: Action) {
    switch (a.type) {
      case 'set':
        this.engine.set(a.param, a.value, 'macro');
        break;
      case 'ramp':
        this.ramps.set(a.param, { from: this.engine.value(a.param), to: a.value, t0: performance.now(), ms: Math.max(1, a.durationMs) });
        break;
      case 'trigger':
        this.engine.fireTrigger(a.param, 'macro');
        break;
      case 'scene':
        this.goScene(a.compId, a.transition);
        break;
      case 'cue':
        this.goCue(a.cueId);
        break;
      case 'macro': {
        const m = this.project.macros.find((x) => x.id === a.macroId);
        if (m) this.macros.run(m);
        break;
      }
      case 'dmxSnapshot':
        this.recallSnapshot(a.snapshotId);
        break;
      case 'blackout':
        this.engine.set('show.blackout', a.on ? 1 : 0, 'macro');
        break;
      case 'transport':
        ({ play: () => this.play(), pause: () => this.pause(), stop: () => this.stop(), next: () => this.next(), previous: () => this.previous() })[a.command]();
        break;
    }
  }

  play() {
    this.media.play();
    if (this.project.timeline.lanes.length || this.project.timeline.markers.length) this.timeline.play();
    this.emit();
  }

  pause() {
    this.media.pause();
    this.timeline.pause();
    this.emit();
  }

  stop() {
    this.media.stop();
    this.timeline.stop();
    this.emit();
  }

  /** Scene → Program with a transition (default: the mixer's). */
  goScene(compId: string, transition?: TransitionSpec) {
    const p = this.project;
    if (!p.compositions.some((c) => c.id === compId)) return;
    if (p.mixer.deckA === compId && !p.mixer.deckB) return;
    const tr = transition ?? p.mixer.transition;
    if (tr.kind === 'cut' || tr.durationMs <= 0 || !p.mixer.deckA) {
      this.update((pr) => ({ ...pr, mixer: { ...pr.mixer, deckA: compId, deckB: null } }), { undoable: false });
      this.afterSceneChange(compId);
      return;
    }
    this.update((pr) => ({ ...pr, mixer: { ...pr.mixer, deckB: compId } }), { undoable: false });
    this.ui.transition = { from: performance.now(), durationMs: tr.durationMs, kind: tr.kind };
    this.emit();
  }

  toPreview(compId: string) {
    this.update((pr) => ({ ...pr, mixer: { ...pr.mixer, deckB: compId } }), { undoable: false });
  }

  take() {
    const b = this.project.mixer.deckB;
    if (b) this.goScene(b);
  }

  cut() {
    const b = this.project.mixer.deckB;
    if (b) this.goScene(b, { kind: 'cut', durationMs: 0 });
  }

  transitionProgress(): number | null {
    const t = this.ui.transition;
    if (!t) return null;
    return Math.min(1, (performance.now() - t.from) / t.durationMs);
  }

  private finishTransition() {
    const b = this.project.mixer.deckB;
    this.ui.transition = null;
    if (b) {
      this.update((pr) => ({ ...pr, mixer: { ...pr.mixer, deckA: b, deckB: null } }), { undoable: false });
      this.afterSceneChange(b);
    }
    this.sendUiState();
    this.emit();
  }

  sendUiState() {
    this.render.send({ type: 'uiState', selectedObject: this.ui.selectedObject, transitionProgress: this.transitionProgress(), transitionKind: this.ui.transition?.kind ?? null });
  }

  private afterSceneChange(compId: string) {
    const comp = this.project.compositions.find((c) => c.id === compId);
    if (comp?.dmxSnapshotId) this.recallSnapshot(comp.dmxSnapshotId);
    // restart clips that are configured to play once
    const once = comp?.layers.filter((l) => l.source.type === 'media' && l.playback.mode === 'once').map((l) => (l.source as { mediaId: string }).mediaId);
    if (once?.length) this.media.restart(once);
  }

  next() {
    const p = this.project;
    if (p.cues.length) {
      const i = Math.min(p.cues.length - 1, this.cueIndex + 1);
      this.goCue(p.cues[i].id);
      return;
    }
    const idx = p.compositions.findIndex((c) => c.id === p.mixer.deckA);
    const n = p.compositions[(idx + 1) % p.compositions.length];
    if (n) this.goScene(n.id);
  }

  previous() {
    const p = this.project;
    if (p.cues.length) {
      const i = Math.max(0, this.cueIndex - 1);
      this.goCue(p.cues[i].id);
      return;
    }
    const idx = p.compositions.findIndex((c) => c.id === p.mixer.deckA);
    const n = p.compositions[(idx - 1 + p.compositions.length) % p.compositions.length];
    if (n) this.goScene(n.id);
  }

  goCue(cueId: string) {
    const p = this.project;
    const i = p.cues.findIndex((c) => c.id === cueId);
    if (i < 0) return;
    const cue = p.cues[i];
    this.cueIndex = i;
    if (cue.compId) this.goScene(cue.compId, cue.transition);
    if (cue.dmxSnapshotId) this.recallSnapshot(cue.dmxSnapshotId);
    if (cue.macroId) {
      const m = p.macros.find((x) => x.id === cue.macroId);
      if (m) this.macros.run(m);
    }
    clearTimeout(this.followTimer);
    if (cue.followMs !== null && i + 1 < p.cues.length) this.followTimer = window.setTimeout(() => this.goCue(p.cues[i + 1].id), cue.followMs);
    this.emit();
  }

  get currentCue() {
    return this.cueIndex >= 0 ? this.project.cues[this.cueIndex] ?? null : null;
  }

  private tap() {
    const now = performance.now();
    this.tapTimes = this.tapTimes.filter((t) => now - t < 3000);
    this.tapTimes.push(now);
    if (this.tapTimes.length >= 2) {
      const iv = (this.tapTimes[this.tapTimes.length - 1] - this.tapTimes[0]) / (this.tapTimes.length - 1);
      const bpm = Math.round(60000 / iv);
      this.engine.set('sync.bpm', bpm, 'ui');
      this.update((p) => ({ ...p, sync: { ...p.sync, bpm } }), { undoable: false });
    }
  }

  toggleRecord() {
    if (this.recorder.armed) {
      const lanes = this.recorder.stop();
      this.update((p) => {
        const tl = { ...p.timeline, lanes: [...p.timeline.lanes] };
        for (const [param, keys] of lanes) {
          if (keys.length < 2) continue;
          const existing = tl.lanes.findIndex((l) => l.param === param);
          const lane = { id: existing >= 0 ? tl.lanes[existing].id : uid('lane'), param, keys, enabled: true };
          if (existing >= 0) tl.lanes[existing] = lane;
          else tl.lanes.push(lane);
        }
        return { ...p, timeline: tl };
      });
      this.toast(`Automatización grabada: ${lanes.size} parámetro(s)`);
    } else {
      this.recorder.start(this.timeline.time, performance.now() / 1000);
      this.timeline.play();
      this.toast('Grabando automatización: mueve controles MIDI/OSC/DMX o la interfaz');
    }
    this.emit();
  }

  // ---------------------------------------------------------------- DMX snapshots

  async captureSnapshot(name: string) {
    const data = await this.dmx.capture();
    const enc: Record<string, string> = {};
    for (const [id, d] of Object.entries(data)) enc[id] = btoa(String.fromCharCode(...d));
    const id = uid('snap');
    this.update((p) => ({ ...p, dmx: { ...p.dmx, snapshots: [...p.dmx.snapshots, { id, name, data: enc, fadeMs: 0 }] } }));
    return id;
  }

  recallSnapshot(id: string) {
    const s = this.project.dmx.snapshots.find((x) => x.id === id);
    if (!s) return;
    const out: Record<string, Uint8Array> = {};
    for (const [u, b64] of Object.entries(s.data)) out[u] = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    this.dmx.sendSnapshotLayer(out);
  }

  // ---------------------------------------------------------------- mappings

  addMapping(source: InputAddress, target: string, patch: Partial<Mapping> = {}): Mapping {
    const m = this.engine.addMapping({ source, target, ...patch });
    this.persistMappings();
    return m;
  }

  persistMappings() {
    this.update((p) => ({ ...p, mappings: this.engine.getMappings().map((m) => ({ ...m })) }));
  }

  learn(paramId: string | null, kinds?: InputAddress['kind'][]) {
    if (!paramId) {
      this.engine.cancelLearn();
      this.ui.learnTarget = null;
      this.emit();
      return;
    }
    this.ui.learnTarget = paramId;
    this.engine.startLearn(paramId, (r) => {
      this.ui.learnTarget = null;
      this.ui.lastLearn = r.mapping.id;
      this.persistMappings();
      this.toast(`Asignado: ${r.address.device} · ${r.address.control} → ${this.engine.get(paramId)?.name ?? paramId}`);
    }, kinds);
    this.emit();
  }

  // ---------------------------------------------------------------- editing helpers

  addEffect(target: 'layer' | 'composition', targetId: string, kind: EffectKind): string | null {
    const fx = createEffect(kind);
    let found = false;
    this.update((p) => ({
      ...p,
      compositions: p.compositions.map((c) => {
        if (target === 'composition' && c.id === targetId) {
          found = true;
          return { ...c, effects: [...c.effects, fx] };
        }
        if (target === 'layer' && c.layers.some((l) => l.id === targetId)) {
          found = true;
          return { ...c, layers: replaceById(c.layers, targetId, (l) => ({ ...l, effects: [...l.effects, fx] })) };
        }
        return c;
      }),
    }));
    return found ? fx.id : null;
  }

  /** Silent import: thumbnails/metadata in the background, no popups. */
  async importMedia(items: MediaItem[], addToComp?: string | null) {
    if (!items.length) return;
    this.update((p) => ({ ...p, media: [...p.media, ...items] }));
    if (addToComp) {
      const layers = items.filter((m) => m.kind === 'video' || m.kind === 'image').map((m) => createLayer({ type: 'media', mediaId: m.id }, m.name.replace(/\.[^.]+$/, '')));
      if (layers.length) this.update((p) => ({ ...p, compositions: replaceById(p.compositions, addToComp, (c) => ({ ...c, layers: [...c.layers, ...layers] })) }));
      if (layers.length) this.ui.selectedLayer = layers[layers.length - 1].id;
    }
    for (const m of items) {
      void this.media.analyze(m).then((meta) => {
        if (Object.keys(meta).length) this.update((p) => ({ ...p, media: replaceById(p.media, m.id, (x) => ({ ...x, ...meta })) }), { undoable: false });
      });
    }
  }

  newScene(name?: string) {
    const c = createComposition(name ?? `Escena ${this.project.compositions.length + 1}`);
    this.update((p) => ({ ...p, compositions: [...p.compositions, c] }));
    this.ui.selectedComp = c.id;
    return c.id;
  }

  private commitTransform(m: { objectId: string; kind: 'object' | 'projector'; position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number] }) {
    if (m.kind === 'object') this.update((p) => ({ ...p, stage: { ...p.stage, objects: replaceById(p.stage.objects, m.objectId, (o) => ({ ...o, position: m.position, rotation: m.rotation, scale: m.scale })) } }));
    else this.update((p) => ({ ...p, stage: { ...p.stage, projectors: replaceById(p.stage.projectors, m.objectId, (o) => ({ ...o, position: m.position, rotation: m.rotation })) } }));
  }

  // ---------------------------------------------------------------- remote / OSC commands

  private onRemote(c: import('../../shared/net/messages').RemoteCommand) {
    switch (c.cmd) {
      case 'transport':
        this.exec({ type: 'transport', command: c.action });
        break;
      case 'scene':
        this.goScene(c.id);
        break;
      case 'cue':
        this.goCue(c.id);
        break;
      case 'param':
        this.engine.set(c.id, c.value, 'remote');
        break;
      case 'blackout':
        this.engine.set('show.blackout', c.on ? 1 : 0, 'remote');
        break;
      case 'take':
        this.take();
        break;
    }
  }

  private onOscCommand(addr: string, v: number | null): boolean {
    const cmd = addr.slice('/lujan/'.length);
    if (cmd === 'blackout') this.engine.set('show.blackout', v === null ? 1 - this.engine.value('show.blackout') : v, 'osc');
    else if (['play', 'pause', 'stop', 'next', 'previous'].includes(cmd)) this.exec({ type: 'transport', command: cmd as 'play' });
    else if (cmd === 'take') this.take();
    else if (cmd.startsWith('scene/')) {
      const n = Number(cmd.slice(6));
      const c = this.project.compositions[n - 1];
      if (c) this.goScene(c.id);
    } else return false;
    return true;
  }

  private remoteState(): RemoteState {
    const p = this.project;
    const exposed = ['master.brightness', 'mixer.crossfade', 'master.speed', 'dmx.master', 'pixel.master', 'audio.gain'];
    return {
      showName: p.name,
      playing: this.media.playing,
      blackout: this.engine.value('show.blackout') >= 0.5,
      scenes: p.compositions.map((c) => ({ id: c.id, name: c.name, active: c.id === p.mixer.deckA, preview: c.id === p.mixer.deckB })),
      cues: p.cues.map((c, i) => ({ id: c.id, name: c.name, active: i === this.cueIndex })),
      params: exposed.map((id) => this.engine.get(id)).filter((x): x is NonNullable<typeof x> => !!x).map((x) => ({ id: x.id, name: x.name, value: x.value, min: x.min, max: x.max, type: x.type })),
      timecode: formatTimecode(this.timeline.time, p.sync.timecodeFps),
      fps: this.render.stats?.fps ?? 0,
      dmxOk: !!this.dmx.stats?.bound,
    };
  }

  // ---------------------------------------------------------------- files

  async newProject() {
    this.store.load(createProject(), null);
    this.cueIndex = -1;
  }

  async save(as = false): Promise<boolean> {
    const p = this.snapshotProject();
    const text = serializeProject(p);
    const path = as ? await lujan!.invoke<string | null>('project:saveAs', p.name, text) : await lujan!.invoke<string | null>('project:save', this.store.filePath, p.name, text);
    if (!path) return false;
    this.store.markSaved(path);
    this.toast('Proyecto guardado');
    return true;
  }

  /** Project with the live base values and mappings folded in. */
  snapshotProject(): Project {
    const p = this.project;
    const params = this.engine.snapshotValues((x) => !this.bindings.get(x.id)?.get && !x.id.startsWith('view.'));
    const mergeModes: Project['mergeModes'] = {};
    for (const x of this.engine.list()) if (x.merge !== 'override') mergeModes[x.id] = x.merge;
    return { ...p, params, mergeModes, mappings: this.engine.getMappings() };
  }

  async open(path?: string) {
    const r = await lujan!.invoke<{ path: string; text: string } | null>('project:open', path);
    if (!r) return;
    try {
      const p = parseProject(r.text);
      const relinked = await lujan!.invoke<{ items: MediaItem[]; missing: string[] } | null>('media:relink', r.path, p.media, false);
      if (relinked) p.media = relinked.items;
      this.store.load(p, r.path);
      void lujan!.invoke('project:opened', r.path, p.name);
      for (const m of p.media) void this.media.analyze(m);
      if (relinked?.missing.length) this.toast(`${relinked.missing.length} archivo(s) no encontrado(s). Usa «Buscar archivos perdidos».`, 'warn');
    } catch (e) {
      this.toast((e as Error).message, 'error');
    }
  }

  async relinkMissing() {
    const r = await lujan!.invoke<{ items: MediaItem[]; missing: string[] } | null>('media:relink', this.store.filePath, this.project.media, true);
    if (!r) return;
    this.update((p) => ({ ...p, media: r.items }));
    this.media.sync(this.project);
    this.toast(r.missing.length ? `Aún faltan ${r.missing.length} archivo(s)` : 'Todos los archivos encontrados');
  }

  async recover() {
    const text = await lujan!.invoke<string | null>('project:readRecovery');
    if (text) {
      const p = parseProject(text);
      this.store.load(p, this.recovery?.projectPath ?? null);
      this.store.update((x) => x, { undoable: false });
      this.toast('Proyecto recuperado del autoguardado');
    }
    await lujan!.invoke('project:discardRecovery');
    this.recovery = null;
    this.emit();
  }

  async discardRecovery() {
    await lujan!.invoke('project:discardRecovery');
    this.recovery = null;
    this.emit();
  }

  private async autosave() {
    if (!this.store.dirty) return;
    try {
      await lujan?.invoke('project:autosave', serializeProject(this.snapshotProject()), this.store.filePath, this.project.name);
    } catch (e) {
      logToMain('WARN', 'autosave', (e as Error).message);
    }
  }

  // ---------------------------------------------------------------- live / performance

  setLive(on: boolean) {
    this.outputs.live = on;
    this.outputs.sync(this.project.outputs);
    this.emit();
  }

  setQuality(q: Partial<QualitySettings>) {
    this.quality = { ...this.quality, ...q };
    this.render.previewScale = this.quality.previewScale;
    this.render.send({ type: 'quality', quality: this.quality });
    void lujan?.invoke('settings:set', { previewScale: this.quality.previewScale, previewFps: this.quality.previewFps });
  }

  get qualitySettings() {
    return this.quality;
  }

  setMode(mode: 'simple' | 'pro') {
    this.ui.mode = mode;
    void lujan?.invoke('settings:set', { uiMode: mode });
    this.emit();
  }

  // ---------------------------------------------------------------- safe shutdown (update / quit)

  /** AUTOSAVE → STOP CAMERAS → STOP TRACKING → STOP RENDER → STOP EXPORT → RELEASE GPU → RELEASE MIDI → RELEASE DMX. */
  private async prepareShutdown(reason: string) {
    const steps: { step: string; ok: boolean; detail?: string }[] = [];
    const run = async (step: string, fn: () => unknown) => {
      try {
        await fn();
        steps.push({ step, ok: true });
      } catch (e) {
        steps.push({ step, ok: false, detail: (e as Error).message });
      }
    };
    let projectText: string | undefined;
    await run('autosave', () => {
      projectText = serializeProject(this.snapshotProject());
    });
    await run('cameras', () => this.cameras.stopAll());
    await run('tracking', () => this.tracking.stop());
    await run('render', () => cancelAnimationFrame(this.tickHandle));
    await run('export', () => this.exportStop?.());
    await run('outputs', () => this.outputs.closeAll());
    await run('gpu', () => {
      this.render.send({ type: 'loseContext' });
      setTimeout(() => this.render.terminate(), 100);
    });
    await run('audio', () => this.audio.release());
    await run('midi', () => this.midi.release());
    await run('dmx', () => this.dmx.blackout(reason === 'update'));
    clearInterval(this.autosaveTimer);
    lujan?.send('app:shutdown-ack', { steps, projectText, projectPath: this.store.filePath, name: this.project.name });
  }

  exportStop: (() => void) | null = null;
}

export const show = new Show();
