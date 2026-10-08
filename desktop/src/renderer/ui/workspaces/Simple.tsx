import { useEffect, useState, type ReactNode } from 'react';
import type { EffectKind, Layer, Output, PixelMap } from '../../../shared/project/model';
import { uid } from '../../../shared/project/model';
import { createEffect, createLayer, createObject3D, createOutput, createPixelMap, createProjector, createUniverse } from '../../../shared/project/defaults';
import { effectParamId } from '../../../shared/project/effects';
import { meshFromQuad } from '../../../shared/geometry/warp';
import type { DisplayInfo } from '../../../shared/ipc';
import { useShow, useTicker, useParamValue } from '../hooks';
import { Icon } from '../icons';
import { NumberInput, ParamSlider, Select } from '../controls';
import { ViewCanvas } from '../ViewCanvas';
import { FitBox } from '../FitBox';
import { replaceById } from '../../core/store';
import { importFromDialog, useDropImport } from './Media';
import { MappingOverlay } from './Mapping';
import { InterfacePicker } from './Dmx';
import { TrackingPanel } from './Cameras';
import { CalibrationPanel } from './Calibration';
import { navigate } from '../App';

// ------------------------------------------------------------------ helpers shared by the flows

function Steps({ steps, current, children, title }: { steps: { title: string; done: boolean; body: ReactNode }[]; current: number; children: ReactNode; title: string }) {
  return (
    <div className="wizard">
      <div className="steps">
        <div className="panel-title" style={{ border: 0, padding: '0 0 4px' }}>{title}</div>
        {steps.map((s, i) => (
          <div key={i} className={`step ${s.done ? 'done' : ''} ${i === current ? 'current' : ''}`}>
            <h5>
              <span className="num">{s.done ? '✓' : i + 1}</span>
              {s.title}
            </h5>
            {(i === current || s.done) && <div>{s.body}</div>}
          </div>
        ))}
      </div>
      <div className="stage-area">{children}</div>
    </div>
  );
}

function firstIncomplete(done: boolean[]) {
  const i = done.findIndex((d) => !d);
  return i < 0 ? done.length - 1 : i;
}

/** Program composition (creates one if needed). */
function useProgramComp() {
  const s = useShow();
  return s.project.compositions.find((c) => c.id === s.project.mixer.deckA) ?? s.project.compositions[0];
}

function DisplayPicker({ onPick, selected }: { onPick: (d: DisplayInfo | null) => void; selected: string | null }) {
  const s = useShow();
  useEffect(() => {
    void s.outputs.refreshDisplays();
  }, [s]);
  return (
    <div className="list">
      {s.outputs.displays.map((d, i) => {
        const o = s.project.outputs.find((x) => x.displayId === d.id);
        return (
          <div key={d.id} className={`item ${o && o.id === selected ? 'sel' : ''}`} onClick={() => onPick(d)}>
            <Icon name={d.primary ? 'output' : 'projector'} />
            <span className="name">
              {d.primary ? 'Esta pantalla (principal)' : `Pantalla / proyector ${i + 1}`}
              <div className="small muted">
                {d.label} · {d.size.width}×{d.size.height} · {Math.round(d.refreshRate)} Hz
              </div>
            </span>
          </div>
        );
      })}
      <div className={`item ${s.project.outputs.some((x) => x.kind === 'virtual' && x.id === selected) ? 'sel' : ''}`} onClick={() => onPick(null)}>
        <Icon name="output" />
        <span className="name">
          Solo vista previa (sin pantalla)
          <div className="small muted">Para preparar el show sin proyector conectado</div>
        </span>
      </div>
    </div>
  );
}

/** Creates (or reuses) the output for a display. Never covers the control screen unless asked. */
function useEnsureOutput() {
  const s = useShow();
  return (d: DisplayInfo | null): string => {
    const existing = d ? s.project.outputs.find((o) => o.displayId === d.id) : s.project.outputs.find((o) => o.kind === 'virtual');
    if (existing) {
      s.ui.selectedOutput = existing.id;
      return existing.id;
    }
    const o: Output = d ? createOutput(d.primary ? 'Pantalla principal' : `Proyector ${s.project.outputs.length + 1}`, d.size.width, d.size.height, d.id) : createOutput('Vista previa');
    if (d) o.fps = Math.round(d.refreshRate) || 60;
    s.update((p) => ({ ...p, outputs: [...p.outputs, o] }));
    s.ui.selectedOutput = o.id;
    return o.id;
  };
}

function BigPlay() {
  const s = useShow();
  return (
    <div className="row">
      <button className="btn primary lg" onClick={() => { s.play(); s.setLive(true); }}>
        <Icon name="play" /> PLAY
      </button>
      <button className="btn lg" onClick={() => s.pause()}>
        <Icon name="pause" />
      </button>
      <button className="btn lg" onClick={() => { s.stop(); s.setLive(false); }}>
        <Icon name="stop" /> Parar
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ home

export function SimpleHome() {
  const s = useShow();
  const cards = [
    { id: 's-video', icon: 'video', title: 'Proyectar un video', text: 'Importar → pantalla → ajustar → efecto → PLAY' },
    { id: 's-mapping', icon: 'mapping', title: 'Projection mapping', text: 'Superficie o modelo 3D → proyector → calibrar → warp → salida' },
    { id: 's-led', icon: 'light', title: 'LED / luces Art-Net', text: 'Conectar nodo → pixel map → video → VIDEO→LUCES → PLAY' },
    { id: 's-midi', icon: 'midi', title: 'Controlador MIDI', text: 'Conectar → learn → mover un control → asignado' },
    { id: 's-tracking', icon: 'camera', title: 'Tracking interactivo', text: 'Cámara → tracking → zona → acción → PLAY' },
  ];
  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 30 }}>
      <h2 style={{ marginTop: 0 }}>¿Qué quieres hacer?</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
        {cards.map((c) => (
          <div key={c.id} className="item" style={{ flexDirection: 'column', alignItems: 'flex-start', padding: 18, gap: 10 }} onClick={() => navigate(c.id)}>
            <Icon name={c.icon} size={30} />
            <b style={{ fontSize: 16 }}>{c.title}</b>
            <span className="muted">{c.text}</span>
          </div>
        ))}
      </div>
      <div className="row" style={{ marginTop: 24 }}>
        <button className="btn" onClick={() => void s.open()}>
          <Icon name="folder" /> Abrir proyecto
        </button>
        <button className="btn" onClick={() => void s.save()}>
          <Icon name="save" /> Guardar
        </button>
        <button className="btn" onClick={() => navigate('vj')}>
          Ir al modo profesional
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ video

const QUICK_FX: { kind: EffectKind | null; label: string }[] = [
  { kind: null, label: 'Sin efecto' },
  { kind: 'glow', label: 'Brillo' },
  { kind: 'kaleidoscope', label: 'Caleidoscopio' },
  { kind: 'rgbSplit', label: 'RGB split' },
  { kind: 'glitch', label: 'Glitch' },
  { kind: 'mirror', label: 'Espejo' },
  { kind: 'pixelate', label: 'Pixelado' },
  { kind: 'trails', label: 'Estelas' },
  { kind: 'wave', label: 'Ondas' },
  { kind: 'color', label: 'Color' },
];

export function SimpleVideo() {
  const s = useShow();
  const p = s.project;
  const comp = useProgramComp();
  const drop = useDropImport(comp?.id);
  const ensureOutput = useEnsureOutput();
  const layer = comp?.layers.find((l) => l.source.type === 'media') ?? null;
  const out = p.outputs.find((o) => o.id === s.ui.selectedOutput) ?? null;
  const [mapped, setMapped] = useState(false);
  const [fxDone, setFxDone] = useState(false);
  const surface = out?.surfaces[0] ?? null;
  const done = [!!layer, !!out, mapped, fxDone, s.outputs.live && s.media.playing];
  const cur = firstIncomplete(done);

  const setFx = (kind: EffectKind | null) => {
    if (!layer || !comp) return;
    const fx = kind ? [createEffect(kind)] : [];
    s.update((pr) => ({ ...pr, compositions: replaceById(pr.compositions, comp.id, (c) => ({ ...c, layers: replaceById(c.layers, layer.id, (l) => ({ ...l, effects: fx })) })) }));
    setFxDone(true);
  };

  return (
    <Steps
      title="Proyectar un video"
      current={cur}
      steps={[
        {
          title: 'Importar video',
          done: done[0],
          body: (
            <>
              <button className="btn primary" onClick={() => void importFromDialog(['video', 'image'], comp?.id)}>
                <Icon name="plus" /> Elegir video o imagen
              </button>
              <div className="hint">También puedes arrastrar el archivo a la ventana.</div>
              {layer && <div className="small">✓ {layer.name}</div>}
            </>
          ),
        },
        { title: 'Seleccionar pantalla / proyector / LED', done: done[1], body: <DisplayPicker selected={out?.id ?? null} onPick={(d) => ensureOutput(d)} /> },
        {
          title: 'Mapear (ajustar las 4 esquinas)',
          done: done[2],
          body: (
            <>
              <div className="hint">Arrastra los puntos de color sobre la vista hasta que coincidan con la pared/pantalla. Mira el proyector mientras lo haces.</div>
              <button className="btn sm" onClick={() => s.setLive(true)}>
                Mostrar en la pantalla ahora
              </button>
              <button className="btn primary sm" onClick={() => setMapped(true)}>
                Listo
              </button>
            </>
          ),
        },
        {
          title: 'Aplicar efecto',
          done: done[3],
          body: (
            <>
              <div className="grid2">
                {QUICK_FX.map((f) => (
                  <button key={f.label} className={`btn sm ${(layer?.effects[0]?.kind ?? null) === f.kind && fxDone ? 'on' : ''}`} onClick={() => setFx(f.kind)}>
                    {f.label}
                  </button>
                ))}
              </div>
              {layer?.effects[0] && <ParamSlider id={effectParamId(layer.effects[0].id, 'mix')} label="Intensidad" />}
            </>
          ),
        },
        { title: 'PLAY', done: done[4], body: <BigPlay /> },
      ]}
    >
      <div {...drop} style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {out && surface ? (
          <FitBox aspect={out.width / out.height}>
            <ViewCanvas key={out.id} spec={{ kind: 'outputPreview', target: out.id }} label={`${out.name} · ${out.width}×${out.height}`} style={{ position: 'absolute', inset: 0 }}>
              <MappingOverlay output={out} surface={surface} mode="surface" maskId={null} />
            </ViewCanvas>
          </FitBox>
        ) : (
          <ViewCanvas spec={{ kind: 'program' }} label="Vista previa" style={{ flex: 1 }} />
        )}
      </div>
    </Steps>
  );
}

// ------------------------------------------------------------------ mapping

export function SimpleMapping() {
  const s = useShow();
  const p = s.project;
  const comp = useProgramComp();
  const ensureOutput = useEnsureOutput();
  const [kind, setKind] = useState<'wall' | '3d' | null>(null);
  const out = p.outputs.find((o) => o.id === s.ui.selectedOutput) ?? null;
  const [calibrated, setCalibrated] = useState(false);
  const [warped, setWarped] = useState(false);
  const surface = out?.surfaces[0] ?? null;
  const done = [kind !== null, !!out, calibrated, warped, s.outputs.live];
  const cur = firstIncomplete(done);

  const chooseKind = async (k: 'wall' | '3d') => {
    setKind(k);
    if (comp && !comp.layers.length) {
      const l = createLayer({ type: 'testpattern' }, 'Patrón de prueba');
      s.update((pr) => ({ ...pr, compositions: replaceById(pr.compositions, comp.id, (c) => ({ ...c, layers: [...c.layers, l] })) }));
    }
    if (k === '3d') {
      const items = await importFromDialog(['model3d']);
      if (items.length) {
        const o = createObject3D('model', items[0].name);
        o.mediaId = items[0].id;
        o.faces = { all: { source: { type: 'composition', compId: 'program' }, opacity: 1, tint: '#ffffff', projectFrom: null } };
        s.update((pr) => ({ ...pr, stage: { ...pr.stage, objects: [...pr.stage.objects, o] } }));
      } else {
        const o = createObject3D('cube', 'Cubo');
        o.faces = { all: { source: { type: 'composition', compId: 'program' }, opacity: 1, tint: '#ffffff', projectFrom: null } };
        s.update((pr) => ({ ...pr, stage: { ...pr.stage, objects: [...pr.stage.objects, o] } }));
      }
    }
  };

  const pickDisplay = (d: DisplayInfo | null) => {
    const id = ensureOutput(d);
    if (kind === '3d') {
      const pj = s.project.stage.projectors.find((x) => x.outputId === id) ?? createProjector(s.project.stage.projectors.length, id);
      s.update((pr) => ({
        ...pr,
        stage: pr.stage.projectors.some((x) => x.id === pj.id) ? pr.stage : { ...pr.stage, projectors: [...pr.stage.projectors, pj] },
        outputs: replaceById(pr.outputs, id, (o) => ({ ...o, mode: '3d', projectorId: pj.id })),
      }));
    }
  };

  return (
    <Steps
      title="Projection mapping"
      current={cur}
      steps={[
        {
          title: 'Importar modelo / superficie',
          done: done[0],
          body: (
            <div className="row">
              <button className={`btn ${kind === 'wall' ? 'on' : ''}`} onClick={() => void chooseKind('wall')}>
                Pared / superficie plana
              </button>
              <button className={`btn ${kind === '3d' ? 'on' : ''}`} onClick={() => void chooseKind('3d')}>
                Objeto 3D (importar modelo)
              </button>
            </div>
          ),
        },
        { title: 'Seleccionar proyector', done: done[1], body: <DisplayPicker selected={out?.id ?? null} onPick={pickDisplay} /> },
        {
          title: 'Calibrar',
          done: done[2],
          body: (
            <>
              <div className="hint">{kind === '3d' ? 'Coloca el proyector virtual como el real (posición, rotación, FOV) en el modo 3D, o ajusta las esquinas.' : 'Muestra el patrón en el proyector y arrastra las esquinas sobre la pared.'}</div>
              <button className="btn sm" onClick={() => s.setLive(true)}>
                Proyectar patrón ahora
              </button>
              {p.cameras.length > 0 && <CalibrationPanel />}
              {kind === '3d' && (
                <button className="btn sm" onClick={() => navigate('stage')}>
                  Abrir el editor 3D
                </button>
              )}
              <button className="btn primary sm" onClick={() => setCalibrated(true)}>
                Calibrado
              </button>
            </>
          ),
        },
        {
          title: 'Warp (curvas y ajustes finos)',
          done: done[3],
          body: (
            <>
              <button
                className="btn sm"
                disabled={!out || !surface}
                onClick={() => {
                  if (!out || !surface) return;
                  s.update((pr) => ({ ...pr, outputs: replaceById(pr.outputs, out.id, (o) => ({ ...o, surfaces: replaceById(o.surfaces, surface.id, (x) => ({ ...x, kind: 'mesh', mesh: x.mesh ?? meshFromQuad(x.quad, 4, 4, 'bezier') })) })) }));
                }}
              >
                Activar malla de deformación
              </button>
              <button className="btn primary sm" onClick={() => setWarped(true)}>
                Listo
              </button>
            </>
          ),
        },
        { title: 'Salida', done: done[4], body: <BigPlay /> },
      ]}
    >
      {out ? (
        <FitBox aspect={out.width / out.height}>
          <ViewCanvas key={out.id} spec={{ kind: 'outputPreview', target: out.id }} label={out.name} style={{ position: 'absolute', inset: 0 }}>
            {out.mode === '2d' && surface && <MappingOverlay output={out} surface={surface} mode="surface" maskId={null} />}
          </ViewCanvas>
        </FitBox>
      ) : kind === '3d' ? (
        <ViewCanvas spec={{ id: 'viewport-simple', kind: 'viewport3d', viewMode: 'projection+wireframe', showGrid: true }} interactive label="3D" style={{ flex: 1 }} />
      ) : (
        <ViewCanvas spec={{ kind: 'program' }} label="Contenido" style={{ flex: 1 }} />
      )}
    </Steps>
  );
}

// ------------------------------------------------------------------ LED / Art-Net

export function SimpleLed() {
  const s = useShow();
  useTicker(1000);
  const p = s.project;
  const d = p.dmx;
  const comp = useProgramComp();
  const pm: PixelMap | undefined = d.pixelMaps[0];
  const hasVideo = !!comp?.layers.length;
  const done = [!!d.interfaceAddress && d.universes.some((u) => u.protocol !== 'virtual'), !!pm, hasVideo, !!pm?.enabled && d.pixelMaps.length > 0 && s.dmx.stats?.packetsPerSec !== undefined, s.media.playing];
  const cur = firstIncomplete(done);
  const [cols, setCols] = useState(16);
  const [rows, setRows] = useState(8);
  const [format, setFormat] = useState<PixelMap['format']>('RGB');

  const addUniverseFor = (ip: string | null, pa = 0) => {
    const u = createUniverse(d.universes.length, 'artnet');
    u.number = pa;
    u.destination = ip ? { mode: 'unicast', ip } : { mode: 'broadcast', ip: '' };
    s.update((pr) => ({ ...pr, dmx: { ...pr.dmx, universes: [...pr.dmx.universes, u] } }));
  };

  return (
    <Steps
      title="LED / luces por Art-Net"
      current={cur}
      steps={[
        {
          title: 'Conectar Art-Net',
          done: done[0],
          body: (
            <>
              <InterfacePicker />
              <button className="btn sm" onClick={() => s.dmx.discover()}>
                Buscar nodos
              </button>
              <div className="list">
                {s.dmx.nodes.map((n) => (
                  <div key={n.ip} className="item" onClick={() => addUniverseFor(n.ip, n.outputUniverses[0] ?? 0)}>
                    <span className={`status-dot ${n.online ? 'ok' : 'err'}`} />
                    <span className="name">
                      {n.shortName || n.ip} <span className="muted small">{n.ip}</span>
                    </span>
                    <span className="small">usar</span>
                  </div>
                ))}
              </div>
              {!d.universes.length && (
                <button className="btn sm" disabled={!d.interfaceAddress} onClick={() => addUniverseFor(null)}>
                  Usar broadcast (sin elegir nodo)
                </button>
              )}
            </>
          ),
        },
        {
          title: 'Crear pixel map',
          done: done[1],
          body: (
            <>
              <div className="row">
                <span className="lbl">Columnas × filas</span>
                <NumberInput value={cols} min={1} max={1024} onChange={setCols} />
                <NumberInput value={rows} min={1} max={1024} onChange={setRows} />
              </div>
              <div className="row">
                <span className="lbl">Tipo de LED</span>
                <Select value={format} options={[{ value: 'RGB', label: 'RGB' }, { value: 'GRB', label: 'GRB (WS2812)' }, { value: 'RGBW', label: 'RGBW' }]} onChange={setFormat} />
              </div>
              <button
                className="btn primary sm"
                disabled={!d.universes.length}
                onClick={() => {
                  const m = { ...createPixelMap(d.universes[0].id, 'LEDs'), cols, rows, format };
                  s.update((pr) => ({ ...pr, dmx: { ...pr.dmx, pixelMaps: [...pr.dmx.pixelMaps, m] } }));
                }}
              >
                Crear
              </button>
              <div className="hint">Si no caben en un universo se reparten solos (AUTO SPAN) sin partir LEDs.</div>
            </>
          ),
        },
        {
          title: 'Seleccionar video',
          done: done[2],
          body: (
            <button className="btn primary" onClick={() => void importFromDialog(['video', 'image'], comp?.id)}>
              <Icon name="plus" /> Elegir video
            </button>
          ),
        },
        {
          title: 'VIDEO → LUCES',
          done: done[3],
          body: pm ? (
            <>
              <div className="row">
                <button className={`btn ${pm.enabled ? 'on' : ''}`} onClick={() => s.update((pr) => ({ ...pr, dmx: { ...pr.dmx, pixelMaps: replaceById(pr.dmx.pixelMaps, pm.id, (x) => ({ ...x, enabled: !x.enabled })) } }))}>
                  {pm.enabled ? 'Activado' : 'Activar'}
                </button>
              </div>
              <ParamSlider id={`pmap.${pm.id}.brightness`} label="Brillo de las luces" />
            </>
          ) : null,
        },
        { title: 'PLAY', done: done[4], body: <BigPlay /> },
      ]}
    >
      <div style={{ display: 'grid', gridTemplateRows: '1fr auto', gap: 8, flex: 1, minHeight: 0 }}>
        <ViewCanvas spec={{ kind: 'program' }} label="Video" />
        <div className="small muted">
          DMX: {s.dmx.stats ? `${s.dmx.stats.packetsPerSec} paquetes/s · ${s.dmx.stats.universesActive} universo(s)` : '—'} {s.dmx.stats?.lastError ? `· ${s.dmx.stats.lastError}` : ''}
        </div>
      </div>
    </Steps>
  );
}

// ------------------------------------------------------------------ MIDI

const MIDI_TARGETS = [
  { id: 'master.brightness', label: 'Brillo general' },
  { id: 'mixer.crossfade', label: 'Crossfader' },
  { id: 'show.next', label: 'Siguiente escena' },
  { id: 'show.blackout', label: 'Blackout' },
  { id: 'master.speed', label: 'Velocidad' },
];

export function SimpleMidi() {
  const s = useShow();
  useTicker(500);
  const [target, setTarget] = useState('master.brightness');
  const ins = s.midi.inputs().filter((p) => p.state === 'connected');
  const maps = s.engine.mappingsFor(target).filter((m) => m.source.kind === 'midi');
  const value = useParamValue(target);
  const done = [ins.length > 0, !!target, s.ui.learnTarget === target || maps.length > 0, maps.length > 0, maps.length > 0];
  const cur = firstIncomplete(done);
  const comp = useProgramComp();
  const layer: Layer | undefined = comp?.layers[0];
  const targets = [...MIDI_TARGETS, ...(layer ? [{ id: `layer.${layer.id}.opacity`, label: `Opacidad de «${layer.name}»` }] : [])];
  return (
    <Steps
      title="Controlador MIDI"
      current={cur}
      steps={[
        {
          title: 'Conectar controlador',
          done: done[0],
          body: ins.length ? (
            ins.map((p) => (
              <div key={p.id} className="small">
                ✓ {p.name}
              </div>
            ))
          ) : (
            <div className="hint">{s.midi.available ? 'Conecta un controlador USB: aparecerá aquí al instante.' : s.midi.error}</div>
          ),
        },
        {
          title: 'Elegir qué controlar',
          done: done[1],
          body: <Select value={target} options={targets.map((t) => ({ value: t.id, label: t.label }))} onChange={setTarget} />,
        },
        {
          title: 'MIDI LEARN: mueve un knob o pulsa un botón',
          done: done[2],
          body: (
            <div className="row">
              <button className={`btn ${s.ui.learnTarget === target ? 'learn armed' : 'primary'}`} onClick={() => s.learn(s.ui.learnTarget === target ? null : target)}>
                {s.ui.learnTarget === target ? 'Esperando… mueve el control' : 'Aprender'}
              </button>
            </div>
          ),
        },
        {
          title: 'Asignado',
          done: done[3],
          body: maps.map((m) => (
            <div key={m.id} className="small">
              ✓ {m.source.device} · {m.source.control}
            </div>
          )),
        },
        {
          title: 'Controlar',
          done: done[4],
          body: (
            <>
              <div className="meter">
                <div style={{ width: `${s.engine.normalized(target) * 100}%` }} />
              </div>
              <div className="small muted">Valor: {value.toFixed(2)} — muévelo desde el controlador.</div>
            </>
          ),
        },
      ]}
    >
      <ViewCanvas spec={{ kind: 'program' }} label="Program" style={{ flex: 1 }} />
    </Steps>
  );
}

// ------------------------------------------------------------------ tracking

const TRACK_ACTIONS = [
  { id: 'color', label: 'Mano arriba → cambiar color' },
  { id: 'next', label: 'Persona entra en la zona → siguiente escena' },
  { id: 'flash', label: 'Persona en la zona → flash de brillo' },
  { id: 'particles', label: 'Partículas que siguen las manos' },
];

export function SimpleTracking() {
  const s = useShow();
  useTicker(500);
  const p = s.project;
  const t = p.tracking;
  const comp = useProgramComp();
  const [action, setAction] = useState<string | null>(null);
  const zone = t.zones[0];
  const done = [p.cameras.length > 0, t.enabled && !!t.cameraId, !!zone, !!action, s.outputs.live || s.media.playing];
  const cur = firstIncomplete(done);
  const addCam = async () => {
    const devs = await s.cameras.refreshDevices();
    const d = devs.find((x) => x.kind === 'videoinput');
    if (!d) return s.toast('No se encontró ninguna cámara', 'warn');
    const c = { id: uid('cam'), name: d.label || 'Cámara', kind: 'local' as const, deviceId: d.deviceId, label: d.label, width: 1280, height: 720, fps: 30, enabled: true };
    s.update((pr) => ({ ...pr, cameras: [...pr.cameras, c], tracking: { ...pr.tracking, cameraId: c.id } }));
  };
  const apply = (id: string) => {
    setAction(id);
    if (!comp) return;
    const z = zone?.id;
    if (id === 'particles') {
      const l = createLayer({ type: 'tracking', style: 'particles' }, 'Partículas (tracking)');
      l.blend = 'add';
      s.update((pr) => ({ ...pr, compositions: replaceById(pr.compositions, comp.id, (c) => ({ ...c, layers: [...c.layers, l] })) }));
      return;
    }
    if (id === 'color') {
      let fx = comp.effects.find((e) => e.kind === 'color');
      if (!fx) {
        fx = createEffect('color');
        const f = fx;
        s.update((pr) => ({ ...pr, compositions: replaceById(pr.compositions, comp.id, (c) => ({ ...c, effects: [...c.effects, f] })) }));
      }
      s.update((pr) => ({ ...pr, rules: [...pr.rules, { id: uid('rule'), name: 'Mano arriba → color', enabled: true, when: [{ feature: 'tracking.hand.any.raised', op: '>=', value: 1 }], then: [{ type: 'set', param: effectParamId(fx!.id, 'hue'), value: 150 }], otherwise: [{ type: 'set', param: effectParamId(fx!.id, 'hue'), value: 0 }], cooldownMs: 300, origin: 'user' }] }));
      return;
    }
    if (!z) return;
    if (id === 'next') s.update((pr) => ({ ...pr, rules: [...pr.rules, { id: uid('rule'), name: 'Zona → siguiente escena', enabled: true, when: [{ feature: `zone.${z}.occupied`, op: 'rising', value: 1 }], then: [{ type: 'transport', command: 'next' }], otherwise: [], cooldownMs: 2000, origin: 'user' }] }));
    if (id === 'flash') s.update((pr) => ({ ...pr, rules: [...pr.rules, { id: uid('rule'), name: 'Zona → flash', enabled: true, when: [{ feature: `zone.${z}.occupied`, op: '>=', value: 1 }], then: [{ type: 'ramp', param: 'master.brightness', value: 1, durationMs: 100 }], otherwise: [{ type: 'ramp', param: 'master.brightness', value: 0.4, durationMs: 600 }], cooldownMs: 0, origin: 'user' }] }));
  };
  return (
    <Steps
      title="Tracking interactivo"
      current={cur}
      steps={[
        {
          title: 'Conectar cámara',
          done: done[0],
          body: p.cameras.length ? (
            <div className="small">✓ {p.cameras[0].name}</div>
          ) : (
            <button className="btn primary" onClick={() => void addCam()}>
              Detectar cámara
            </button>
          ),
        },
        {
          title: 'Activar tracking',
          done: done[1],
          body: (
            <button className={`btn ${t.enabled ? 'on' : 'primary'}`} onClick={() => s.update((pr) => ({ ...pr, tracking: { ...pr.tracking, enabled: !pr.tracking.enabled, cameraId: pr.tracking.cameraId ?? pr.cameras[0]?.id ?? null } }))}>
              {t.enabled ? `Tracking activo (${s.tracking.people.length} persona/s)` : 'Activar tracking del cuerpo'}
            </button>
          ),
        },
        {
          title: 'Crear zona',
          done: done[2],
          body: (
            <>
              {!zone && (
                <button className="btn sm" onClick={() => s.update((pr) => ({ ...pr, tracking: { ...pr.tracking, zones: [{ id: uid('zone'), name: 'Zona central', rect: { x: 0.3, y: 0.2, w: 0.4, h: 0.7 }, enabled: true }] } }))}>
                  Crear zona central
                </button>
              )}
              {zone && <div className="small">✓ {zone.name} · ahora: {s.bus.get(`zone.${zone.id}.count`)} persona(s)</div>}
            </>
          ),
        },
        {
          title: 'Asignar acción',
          done: done[3],
          body: (
            <div className="list">
              {TRACK_ACTIONS.map((a) => (
                <div key={a.id} className={`item ${action === a.id ? 'sel' : ''}`} onClick={() => apply(a.id)}>
                  <span className="name">{a.label}</span>
                </div>
              ))}
            </div>
          ),
        },
        { title: 'PLAY', done: done[4], body: <BigPlay /> },
      ]}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 8, flex: 1, minHeight: 0 }}>
        <div style={{ display: 'grid', gridTemplateRows: '1fr 1fr', gap: 8, minHeight: 0 }}>
          {p.cameras[0] ? <ViewCanvas spec={{ kind: 'source', target: `camera:${p.cameras[0].id}` }} label="Cámara" /> : <div className="hint">Sin cámara</div>}
          <ViewCanvas spec={{ kind: 'program' }} label="Resultado" />
        </div>
        <div style={{ overflow: 'auto' }}>
          <TrackingPanel />
        </div>
      </div>
    </Steps>
  );
}
