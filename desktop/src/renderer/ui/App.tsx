import { useEffect, useState, type ComponentType } from 'react';
import { useShow, useTicker, useParamValue } from './hooks';
import { Icon } from './icons';
import { ViewCanvas } from './ViewCanvas';
import { LearnButton, Modal, Slider } from './controls';
import { show } from '../core/show';
import { lujan } from '../api';
import { MediaWorkspace } from './workspaces/Media';
import { VjWorkspace } from './workspaces/Vj';
import { MappingWorkspace } from './workspaces/Mapping';
import { StageWorkspace } from './workspaces/Stage';
import { CamerasWorkspace } from './workspaces/Cameras';
import { DrawingWorkspace } from './workspaces/Drawing';
import { MidiWorkspace } from './workspaces/Midi';
import { DmxWorkspace } from './workspaces/Dmx';
import { AudioSyncWorkspace } from './workspaces/AudioSync';
import { ShowWorkspace } from './workspaces/ShowControl';
import { RemoteWorkspace } from './workspaces/Remote';
import { AssistantWorkspace } from './workspaces/Assistant';
import { PerformanceWorkspace } from './workspaces/Performance';
import { SystemWorkspace } from './workspaces/System';
import { SimpleHome, SimpleVideo, SimpleMapping, SimpleLed, SimpleMidi, SimpleTracking } from './workspaces/Simple';
import { ExportDialog } from './workspaces/Export';
import { FirstRun } from './workspaces/FirstRun';

interface Ws {
  id: string;
  label: string;
  icon: string;
  C: ComponentType;
}

const SIMPLE: Ws[] = [
  { id: 's-home', label: 'Inicio', icon: 'show', C: SimpleHome },
  { id: 's-video', label: 'Video', icon: 'video', C: SimpleVideo },
  { id: 's-mapping', label: 'Mapping', icon: 'mapping', C: SimpleMapping },
  { id: 's-led', label: 'LED', icon: 'light', C: SimpleLed },
  { id: 's-midi', label: 'MIDI', icon: 'midi', C: SimpleMidi },
  { id: 's-tracking', label: 'Tracking', icon: 'camera', C: SimpleTracking },
];

const PRO: Ws[] = [
  { id: 'media', label: 'Medios', icon: 'media', C: MediaWorkspace },
  { id: 'vj', label: 'VJ', icon: 'layers', C: VjWorkspace },
  { id: 'mapping', label: 'Mapping', icon: 'mapping', C: MappingWorkspace },
  { id: 'stage', label: '3D', icon: 'cube', C: StageWorkspace },
  { id: 'cameras', label: 'Cámaras', icon: 'camera', C: CamerasWorkspace },
  { id: 'drawing', label: 'Dibujo', icon: 'draw', C: DrawingWorkspace },
  { id: 'midi', label: 'MIDI', icon: 'midi', C: MidiWorkspace },
  { id: 'dmx', label: 'Luces', icon: 'light', C: DmxWorkspace },
  { id: 'audio', label: 'Audio', icon: 'audio', C: AudioSyncWorkspace },
  { id: 'show', label: 'Show', icon: 'show', C: ShowWorkspace },
  { id: 'remote', label: 'Remoto', icon: 'remote', C: RemoteWorkspace },
  { id: 'ai', label: 'IA', icon: 'ai', C: AssistantWorkspace },
  { id: 'perf', label: 'Rendim.', icon: 'perf', C: PerformanceWorkspace },
  { id: 'system', label: 'Sistema', icon: 'system', C: SystemWorkspace },
];

export function navigate(id: string) {
  window.dispatchEvent(new CustomEvent('lujan-nav', { detail: id }));
}

export function App() {
  const s = useShow();
  const [ws, setWs] = useState<string>('s-home');
  const [exportOpen, setExportOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const list = s.ui.mode === 'simple' ? SIMPLE : PRO;

  useEffect(() => {
    const h = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id.startsWith('s-')) s.setMode('simple');
      else s.setMode('pro');
      setWs(id);
    };
    window.addEventListener('lujan-nav', h);
    return () => window.removeEventListener('lujan-nav', h);
  }, [s]);

  useEffect(() => {
    if (!list.some((w) => w.id === ws)) setWs(list[0].id);
  }, [s.ui.mode, list, ws]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.target as HTMLElement)?.closest?.('.view[tabindex]')) return;
      if (e.ctrlKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void s.save(e.shiftKey);
      } else if (e.ctrlKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        void s.open();
      } else if (e.ctrlKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        s.store.undo();
      } else if (e.ctrlKey && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        e.preventDefault();
        s.store.redo();
      } else if (e.code === 'Space' && !s.ui.performance) {
        e.preventDefault();
        if (s.media.playing) s.pause();
        else s.play();
      } else if (e.code === 'KeyB' && e.shiftKey) {
        s.setParam('show.blackout', s.engine.value('show.blackout') >= 0.5 ? 0 : 1);
      }
      // keyboard → parameter engine (learnable)
      if (!e.repeat) s.engine.input({ kind: 'keyboard', device: 'teclado', control: e.code }, 1);
      if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt') s.engine.setModifier(e.key.toUpperCase() === 'CONTROL' ? 'CTRL' : e.key.toUpperCase(), true);
    };
    const onUp = (e: KeyboardEvent) => {
      s.engine.input({ kind: 'keyboard', device: 'teclado', control: e.code }, 0);
      if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt') s.engine.setModifier(e.key.toUpperCase() === 'CONTROL' ? 'CTRL' : e.key.toUpperCase(), false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onUp);
    };
  }, [s]);

  const Current = list.find((w) => w.id === ws)?.C ?? list[0].C;
  if (s.fatal) {
    return (
      <div style={{ padding: 30 }}>
        <h2>LUJAN MAPPING Studio</h2>
        <p style={{ color: 'var(--err)' }}>{s.fatal}</p>
        <button className="btn" onClick={() => location.reload()}>
          Reiniciar motor
        </button>
      </div>
    );
  }
  if (!s.ready) return <div style={{ padding: 30, color: 'var(--fg2)' }}>Iniciando motor GPU y servicios…</div>;

  return (
    <div className="app">
      <TopBar onExport={() => setExportOpen(true)} menu={menu} setMenu={setMenu} />
      <div className="body">
        {!s.ui.performance && (
          <nav className="nav">
            {list.map((w) => (
              <button key={w.id} className={ws === w.id ? 'active' : ''} onClick={() => setWs(w.id)} title={w.label}>
                <Icon name={w.icon} />
                {w.label}
              </button>
            ))}
          </nav>
        )}
        {s.ui.performance ? <PerformanceMode /> : <div className="workspace"><Current /></div>}
      </div>
      <StatusBar />
      {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}
      {s.recovery && <RecoveryDialog />}
      <FirstRun />
      <Toast />
    </div>
  );
}

function TopBar({ onExport, menu, setMenu }: { onExport: () => void; menu: boolean; setMenu: (v: boolean) => void }) {
  const s = useShow();
  const blackout = useParamValue('show.blackout') >= 0.5;
  useTicker(1000);
  const stats = s.render.stats;
  return (
    <div className="topbar">
      <div className="brand">
        <Icon name="projector" size={20} />
        LUJAN <b>MAPPING</b> Studio
      </div>
      <div style={{ position: 'relative' }}>
        <button className="btn sm" onClick={() => setMenu(!menu)}>
          <Icon name="folder" /> Archivo
        </button>
        {menu && (
          <div className="panel" style={{ position: 'absolute', top: 30, left: 0, zIndex: 50, width: 240, border: '1px solid var(--line2)', borderRadius: 6, padding: 6 }} onMouseLeave={() => setMenu(false)}>
            {[
              ['Nuevo proyecto', () => void s.newProject()],
              ['Abrir… (Ctrl+O)', () => void s.open()],
              ['Guardar (Ctrl+S)', () => void s.save()],
              ['Guardar como… (Ctrl+Shift+S)', () => void s.save(true)],
              ['Buscar archivos perdidos…', () => void s.relinkMissing()],
              ['Exportar video…', onExport],
            ].map(([label, fn]) => (
              <button key={label as string} className="btn sm" style={{ width: '100%', justifyContent: 'flex-start', marginBottom: 3 }} onClick={() => { (fn as () => void)(); setMenu(false); }}>
                {label as string}
              </button>
            ))}
            <RecentList onPick={() => setMenu(false)} />
          </div>
        )}
      </div>
      <span className={`projname ${s.store.dirty ? 'dirty' : ''}`} title={s.store.filePath ?? 'Sin guardar'}>
        {s.project.name}
      </span>
      <button className="btn icon sm" title="Deshacer (Ctrl+Z)" disabled={!s.store.canUndo} onClick={() => s.store.undo()}>
        <Icon name="undo" />
      </button>
      <button className="btn icon sm" title="Rehacer (Ctrl+Y)" disabled={!s.store.canRedo} onClick={() => s.store.redo()}>
        <Icon name="redo" />
      </button>
      <div className="seg">
        <button className={s.ui.mode === 'simple' ? 'on' : ''} onClick={() => s.setMode('simple')}>
          Simple
        </button>
        <button className={s.ui.mode === 'pro' ? 'on' : ''} onClick={() => s.setMode('pro')}>
          Profesional
        </button>
      </div>
      <span className="spacer" />
      <button className="btn icon" title="Anterior" onClick={() => s.previous()}>
        <Icon name="prev" />
      </button>
      <button className={`btn icon ${s.media.playing ? 'on' : ''}`} title="Play (Espacio)" onClick={() => s.play()}>
        <Icon name="play" />
      </button>
      <button className="btn icon" title="Pausa" onClick={() => s.pause()}>
        <Icon name="pause" />
      </button>
      <button className="btn icon" title="Stop" onClick={() => s.stop()}>
        <Icon name="stop" />
      </button>
      <button className="btn icon" title="Siguiente" onClick={() => s.next()}>
        <Icon name="next" />
      </button>
      {s.ui.mode === 'pro' && <MasterFader />}
      <span className="spacer" />
      <span className="small muted mono" title="FPS del motor de render / tiempo de frame">
        {stats ? `${stats.fps.toFixed(0)} fps · ${stats.frameMs.toFixed(1)} ms` : '— fps'}
      </span>
      <button className={`btn live ${s.outputs.live ? 'on' : ''}`} title="Abre las salidas a pantallas/proyectores" onClick={() => s.setLive(!s.outputs.live)}>
        <Icon name="live" /> {s.outputs.live ? 'EN VIVO' : 'SALIDAS'}
      </button>
      <button className={`btn ${s.ui.performance ? 'on' : ''}`} title="Modo actuación: oculta paneles y bloquea cambios accidentales" onClick={() => { s.ui.performance = !s.ui.performance; s.emit(); }}>
        Actuación
      </button>
      <button className={`btn blackout ${blackout ? 'on' : ''}`} title="BLACKOUT (Shift+B): apaga todas las salidas de video y luces" onClick={() => s.setParam('show.blackout', blackout ? 0 : 1)}>
        BLACKOUT
      </button>
    </div>
  );
}

function MasterFader() {
  const s = useShow();
  const v = useParamValue('master.brightness');
  return (
    <div className="row" style={{ width: 170, margin: 0 }}>
      <Slider value={v} min={0} max={1} def={1} label="Master" onStart={() => s.beginEdit()} onEnd={() => s.commitEdit()} onChange={(x) => s.setParam('master.brightness', x)} />
      <LearnButton param="master.brightness" />
    </div>
  );
}

function RecentList({ onPick }: { onPick: () => void }) {
  const [recent, setRecent] = useState<{ path: string; name: string }[]>([]);
  useEffect(() => {
    void lujan?.invoke<{ recentProjects: { path: string; name: string }[] }>('settings:get').then((x) => setRecent(x.recentProjects ?? []));
  }, []);
  if (!recent.length) return null;
  return (
    <>
      <div className="hint" style={{ marginTop: 6 }}>Recientes</div>
      {recent.slice(0, 8).map((r) => (
        <button key={r.path} className="btn sm" title={r.path} style={{ width: '100%', justifyContent: 'flex-start', marginBottom: 2 }} onClick={() => { void show.open(r.path); onPick(); }}>
          {r.name}
        </button>
      ))}
    </>
  );
}

function StatusBar() {
  const s = useShow();
  useTicker(1000);
  const midiIn = s.midi.inputs().filter((p) => p.state === 'connected');
  const cams = [...s.cameras.state.values()];
  const live = cams.filter((c) => c.status === 'live').length;
  const dmx = s.dmx.stats;
  const outs = s.project.outputs.filter((o) => o.kind === 'display');
  const openOuts = outs.filter((o) => s.outputs.isOpen(o.id)).length;
  return (
    <div className="statusbar">
      <span title={s.render.info ? `${s.render.info.vendor} — ${s.render.info.renderer}` : ''}>
        <span className={`status-dot ${s.render.info ? 'ok' : 'err'}`} />
        GPU {s.render.info?.renderer.replace(/ANGLE \(|\)$/g, '').slice(0, 48) ?? 'no disponible'}
      </span>
      <span>
        <span className={`status-dot ${openOuts ? 'ok' : ''}`} />
        Salidas {openOuts}/{outs.length}
      </span>
      <span title={midiIn.map((p) => p.name).join(', ')}>
        <span className={`status-dot ${midiIn.length ? 'ok' : ''}`} />
        MIDI {s.midi.available ? `${midiIn.length} entrada(s)` : 'no disponible'}
      </span>
      <span>
        <span className={`status-dot ${!s.project.dmx.universes.length ? '' : dmx?.bound && !dmx.lastError ? 'ok' : dmx?.lastError ? 'err' : 'warn'}`} />
        DMX {s.project.dmx.universes.length ? (dmx?.bound ? `${dmx.packetsPerSec} paq/s` : 'sin interfaz') : 'sin universos'}
      </span>
      <span>
        <span className={`status-dot ${cams.length ? (live === cams.length ? 'ok' : 'warn') : ''}`} />
        Cámaras {live}/{cams.length}
      </span>
      <span>
        <span className={`status-dot ${s.tracking.status === 'running' ? 'ok' : s.tracking.status === 'error' ? 'err' : ''}`} />
        Tracking {s.tracking.status === 'running' ? `${s.tracking.people.length} persona(s) · ${s.tracking.fps} fps` : s.tracking.status === 'off' ? 'apagado' : s.tracking.status}
      </span>
      <span>
        <span className={`status-dot ${s.audio.status === 'live' ? 'ok' : s.audio.status === 'error' ? 'err' : ''}`} />
        Audio {s.audio.status === 'live' ? (s.audio.features?.bpm ? `${s.audio.features.bpm} BPM` : 'activo') : 'apagado'}
      </span>
      <span className="spacer" />
      {s.ui.learnTarget && <span className="badge warn">LEARN: mueve un control para {s.engine.get(s.ui.learnTarget)?.name}</span>}
      {s.recorder.armed && <span className="badge err">● GRABANDO AUTOMATIZACIÓN</span>}
      <span className="muted">v{s.info?.version}</span>
    </div>
  );
}

/** PERFORMANCE MODE: only program, scenes, cues and the essentials; no accidental edits. */
function PerformanceMode() {
  const s = useShow();
  const p = s.project;
  return (
    <div className="workspace" style={{ flexDirection: 'column', padding: 10, gap: 10 }}>
      <div className="row">
        <span className="performance-banner">MODO ACTUACIÓN</span>
        <span className="muted small">Edición bloqueada. Render, salidas, MIDI, DMX y tracking tienen prioridad.</span>
        <span className="spacer" />
        <button className="btn" onClick={() => { s.ui.performance = false; s.emit(); }}>Salir del modo actuación</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10, flex: 1, minHeight: 0 }}>
        <PerfProgram />
        <div className="panel" style={{ borderRadius: 6, border: '1px solid var(--line)' }}>
          <div className="panel-title">Cues</div>
          <div className="panel-body list">
            {p.cues.length === 0 && <div className="hint">Sin cues. Usa las escenas.</div>}
            {p.cues.map((c) => (
              <div key={c.id} className={`item ${s.currentCue?.id === c.id ? 'sel' : ''}`} onClick={() => s.goCue(c.id)}>
                <span className="name">{c.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="clip-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
        {p.compositions.map((c) => (
          <div key={c.id} className={`clip ${c.id === p.mixer.deckA ? 'program' : c.id === p.mixer.deckB ? 'preview' : ''}`} style={{ aspectRatio: 'auto', height: 70 }} onClick={() => s.goScene(c.id)}>
            <div className="label">{c.name}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PerfProgram() {
  return <ProgramView />;
}

function ProgramView() {
  return <ViewCanvas spec={{ kind: 'program' }} label="Program" labelClass="program" style={{ height: '100%' }} />;
}

function RecoveryDialog() {
  const s = useShow();
  const r = s.recovery!;
  return (
    <Modal
      title="Recuperación tras cierre inesperado"
      onClose={() => void s.discardRecovery()}
      footer={
        <>
          <button className="btn" onClick={() => void s.discardRecovery()}>
            Descartar
          </button>
          <button className="btn primary" onClick={() => void s.recover()}>
            Recuperar proyecto
          </button>
        </>
      }
    >
      <p>La sesión anterior no se cerró correctamente. Hay un autoguardado de «{r.name}» del {new Date(r.savedAt).toLocaleString()}.</p>
      {r.projectPath && <p className="muted small">{r.projectPath}</p>}
    </Modal>
  );
}

function Toast() {
  const s = useShow();
  const [, force] = useState(0);
  const t = s.ui.toast;
  useEffect(() => {
    if (!t) return;
    const h = setTimeout(() => force((x) => x + 1), 3600);
    return () => clearTimeout(h);
  }, [t]);
  if (!t || Date.now() - t.t > 3500) return null;
  return <div className={`toast ${t.kind}`}>{t.text}</div>;
}
