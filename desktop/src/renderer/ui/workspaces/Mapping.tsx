import { useRef, useState } from 'react';
import type { Mask, Output, Surface, SurfaceGeometryKind } from '../../../shared/project/model';
import { createMask, createOutput, createSurface, defaultSoftEdge } from '../../../shared/project/defaults';
import { invert3, mapPoint, rectQuad, squareToQuad, type Quad, type Vec2 } from '../../../shared/geometry/homography';
import { evalMesh, meshFromQuad, resampleMesh, type WarpInterpolation } from '../../../shared/geometry/warp';
import type { DisplayInfo } from '../../../shared/ipc';
import { useShow } from '../hooks';
import { Icon } from '../icons';
import { Check, Field, NumberInput, ParamSlider, ParamToggle, Section, Select, Seg, Slider, TextInput } from '../controls';
import { ViewCanvas } from '../ViewCanvas';
import { FitBox } from '../FitBox';
import { EffectsEditor, MasksEditor, SourcePicker } from '../shared';
import { replaceById } from '../../core/store';

export const RES_PRESETS = [
  [1280, 720],
  [1920, 1080],
  [2560, 1440],
  [3840, 2160],
  [1024, 768],
  [1280, 800],
  [1920, 1200],
  [4096, 2160],
];

type EditMode = 'surface' | 'mask' | 'warp';

export function MappingWorkspace() {
  const s = useShow();
  const p = s.project;
  const out = p.outputs.find((o) => o.id === s.ui.selectedOutput) ?? p.outputs[0] ?? null;
  const surf = out?.surfaces.find((x) => x.id === s.ui.selectedSurface) ?? null;
  const [maskEdit, setMaskEdit] = useState<string | null>(null);
  const [mode, setMode] = useState<EditMode>('surface');

  return (
    <div className="cols">
      <div className="panel" style={{ width: 280 }}>
        <div className="panel-title">
          Salidas
          <span className="spacer" />
          <AddOutputButton />
        </div>
        <div className="panel-body">
          <div className="list">
            {p.outputs.length === 0 && <div className="hint">Añade una salida: un proyector, monitor o pantalla LED conectado a Windows, o una salida virtual.</div>}
            {p.outputs.map((o, i) => {
              const st = s.outputs.state.get(o.id);
              return (
                <div key={o.id} className={`item ${out?.id === o.id ? 'sel' : ''}`} onClick={() => { s.ui.selectedOutput = o.id; s.ui.selectedSurface = null; s.emit(); }}>
                  <Icon name={o.mode === '3d' ? 'projector' : 'output'} />
                  <span className="name">
                    {i + 1}. {o.name}
                    <div className="small muted">
                      {o.width}×{o.height} · {o.mode.toUpperCase()} · {st?.note ?? ''}
                    </div>
                  </span>
                  <span className={`status-dot ${st?.open ? 'ok' : st?.displayPresent ? '' : o.kind === 'display' ? 'warn' : ''}`} />
                </div>
              );
            })}
          </div>
          {out && (
            <Section
              title="Superficies"
              right={
                <span style={{ display: 'flex', gap: 3 }}>
                  {(['quad', 'mesh', 'polygon'] as SurfaceGeometryKind[]).map((k) => (
                    <button key={k} className="btn sm" title={`Añadir ${k}`} onClick={() => addSurface(k)}>
                      + {k === 'quad' ? 'Quad' : k === 'mesh' ? 'Malla' : 'Polígono'}
                    </button>
                  ))}
                </span>
              }
            >
              <div className="list">
                {[...out.surfaces].reverse().map((sf) => (
                  <div key={sf.id} className={`item ${surf?.id === sf.id ? 'sel' : ''}`} onClick={() => { s.ui.selectedSurface = sf.id; s.emit(); }}>
                    <button className="btn icon sm" onClick={(e) => { e.stopPropagation(); s.setParam(`surface.${sf.id}.visible`, sf.visible ? 0 : 1); }}>
                      <Icon name={sf.visible ? 'eye' : 'eyeoff'} />
                    </button>
                    <span className="name">{sf.name}</span>
                    <button className="btn icon sm" title={sf.locked ? 'Desbloquear' : 'Bloquear'} onClick={(e) => { e.stopPropagation(); updSurface(sf.id, (x) => ({ ...x, locked: !x.locked })); }}>
                      <Icon name={sf.locked ? 'lock' : 'unlock'} />
                    </button>
                    <button className="btn icon sm" onClick={(e) => { e.stopPropagation(); s.update((pr) => ({ ...pr, outputs: replaceById(pr.outputs, out.id, (o) => ({ ...o, surfaces: o.surfaces.filter((x) => x.id !== sf.id) })) })); }}>
                      <Icon name="trash" />
                    </button>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      </div>
      <div className="col" style={{ flex: 1, padding: 8, gap: 8 }}>
        {out ? (
          <>
            <div className="row" style={{ margin: 0 }}>
              <Seg
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'surface', label: 'Superficies' },
                  { value: 'mask', label: 'Máscaras' },
                  { value: 'warp', label: 'Warp final' },
                ]}
              />
              <span className="small muted">Arrastra los puntos · Arrastra dentro para mover · Flechas = 1 px (Mayús 10 px) · Doble clic en un borde de polígono = nuevo punto · Alt+clic = borrar punto</span>
              <span className="spacer" />
              <button className={`btn sm ${out.showTestPattern ? 'on' : ''}`} onClick={() => updOutput((o) => ({ ...o, showTestPattern: !o.showTestPattern }))}>
                Identificar nº
              </button>
              <button className={`btn sm ${out.identify ? 'on' : ''}`} onClick={() => updOutput((o) => ({ ...o, identify: !o.identify }))}>
                Identificar salida
              </button>
            </div>
            <FitBox aspect={out.width / out.height}>
              <ViewCanvas key={out.id} spec={{ kind: 'outputPreview', target: out.id }} style={{ position: 'absolute', inset: 0 }} label={`${out.name} · ${out.width}×${out.height}`}>
                <MappingOverlay output={out} surface={surf} mode={mode} maskId={maskEdit} />
              </ViewCanvas>
            </FitBox>
          </>
        ) : (
          <div className="hint" style={{ padding: 20 }}>
            Crea una salida para empezar a mapear.
          </div>
        )}
      </div>
      <div className="panel right" style={{ width: 340 }}>
        <div className="panel-title">{surf ? `Superficie: ${surf.name}` : out ? `Salida: ${out.name}` : 'Inspector'}</div>
        <div className="panel-body">
          {surf && out ? <SurfaceInspector output={out} surface={surf} maskEdit={maskEdit} setMaskEdit={(id) => { setMaskEdit(id); if (id) setMode('mask'); }} /> : out ? <OutputInspector output={out} /> : null}
        </div>
      </div>
    </div>
  );

  function updOutput(fn: (o: Output) => Output) {
    if (!out) return;
    s.update((pr) => ({ ...pr, outputs: replaceById(pr.outputs, out.id, fn) }));
  }

  function updSurface(id: string, fn: (x: Surface) => Surface) {
    updOutput((o) => ({ ...o, surfaces: replaceById(o.surfaces, id, fn) }));
  }

  function addSurface(kind: SurfaceGeometryKind) {
    const sf = createSurface(`${kind === 'quad' ? 'Quad' : kind === 'mesh' ? 'Malla' : 'Polígono'} ${(out?.surfaces.length ?? 0) + 1}`);
    sf.kind = kind;
    if (kind === 'mesh') sf.mesh = meshFromQuad(sf.quad, 4, 4, 'bezier');
    if (kind === 'polygon') sf.polygon = [
      { x: 0.3, y: 0.25 },
      { x: 0.7, y: 0.2 },
      { x: 0.8, y: 0.6 },
      { x: 0.55, y: 0.8 },
      { x: 0.25, y: 0.7 },
    ];
    updOutput((o) => ({ ...o, surfaces: [...o.surfaces, sf] }));
    s.ui.selectedSurface = sf.id;
  }
}

function AddOutputButton() {
  const s = useShow();
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <button className="btn sm" onClick={() => { void s.outputs.refreshDisplays(); setOpen(!open); }}>
        <Icon name="plus" /> Salida
      </button>
      {open && (
        <div className="panel" style={{ position: 'absolute', right: 0, top: 26, zIndex: 40, width: 280, border: '1px solid var(--line2)', borderRadius: 6, padding: 6 }} onMouseLeave={() => setOpen(false)}>
          <div className="hint">Pantallas detectadas por Windows</div>
          {s.outputs.displays.map((d: DisplayInfo, i) => (
            <button key={d.id} className="btn sm" style={{ width: '100%', justifyContent: 'flex-start', marginBottom: 3 }} onClick={() => { addOutputFor(d, i); setOpen(false); }}>
              {d.primary ? '★ ' : ''}
              {d.label} · {d.size.width}×{d.size.height} @{Math.round(d.refreshRate)}Hz
            </button>
          ))}
          <button className="btn sm" style={{ width: '100%', justifyContent: 'flex-start' }} onClick={() => { addVirtual(); setOpen(false); }}>
            Salida virtual (sin ventana: export, pixel map…)
          </button>
        </div>
      )}
    </div>
  );

  function addOutputFor(d: DisplayInfo, i: number) {
    const o = createOutput(`${d.primary ? 'Monitor' : 'Proyector'} ${i + 1}`, d.size.width, d.size.height, d.id);
    o.fps = Math.round(d.refreshRate) || 60;
    o.displayLabel = d.label;
    if (d.primary) o.enabled = false; // never cover the control screen by accident
    s.update((p) => ({ ...p, outputs: [...p.outputs, o] }));
    s.ui.selectedOutput = o.id;
  }

  function addVirtual() {
    const o = createOutput(`Virtual ${s.project.outputs.length + 1}`);
    s.update((p) => ({ ...p, outputs: [...p.outputs, o] }));
    s.ui.selectedOutput = o.id;
  }
}

export function OutputInspector({ output: o }: { output: Output }) {
  const s = useShow();
  const upd = (fn: (o: Output) => Output) => s.update((pr) => ({ ...pr, outputs: replaceById(pr.outputs, o.id, fn) }));
  const displays = s.outputs.displays;
  return (
    <>
      <Section title="Salida">
        <Field label="Nombre">
          <TextInput value={o.name} onChange={(v) => upd((x) => ({ ...x, name: v }))} />
        </Field>
        <ParamToggle id={`output.${o.id}.enabled`} label="Salida activa" />
        <Field label="Dispositivo">
          <Select
            value={o.kind === 'virtual' ? 'virtual' : String(o.displayId)}
            options={[{ value: 'virtual', label: 'Virtual (sin ventana)' }, ...displays.map((d) => ({ value: String(d.id), label: `${d.label} ${d.size.width}×${d.size.height}${d.primary ? ' (principal)' : ''}` }))]}
            onChange={(v) => upd((x) => (v === 'virtual' ? { ...x, kind: 'virtual', displayId: null } : { ...x, kind: 'display', displayId: Number(v) }))}
          />
        </Field>
        <Field label="Resolución">
          <Select
            value={`${o.width}x${o.height}`}
            options={[
              ...(RES_PRESETS.some(([w, h]) => w === o.width && h === o.height) ? [] : [{ value: `${o.width}x${o.height}`, label: `${o.width}×${o.height}` }]),
              ...RES_PRESETS.map(([w, h]) => ({ value: `${w}x${h}`, label: `${w}×${h}` })),
            ]}
            onChange={(v) => {
              const [w, h] = v.split('x').map(Number);
              upd((x) => ({ ...x, width: w, height: h }));
            }}
          />
        </Field>
        <Field label="Personalizada">
          <NumberInput value={o.width} min={16} max={16384} onChange={(v) => upd((x) => ({ ...x, width: v }))} />×
          <NumberInput value={o.height} min={16} max={16384} onChange={(v) => upd((x) => ({ ...x, height: v }))} />
        </Field>
        <Field label="FPS">
          <Select value={o.fps} options={[24, 25, 30, 50, 60, 120].map((f) => ({ value: f, label: `${f}` }))} onChange={(v) => upd((x) => ({ ...x, fps: v }))} />
        </Field>
        <Field label="Modo">
          <Seg value={o.mode} options={[{ value: '2d', label: '2D (superficies)' }, { value: '3d', label: '3D (proyector)' }]} onChange={(v) => upd((x) => ({ ...x, mode: v }))} />
        </Field>
        {o.mode === '3d' && (
          <Field label="Proyector 3D">
            <Select value={o.projectorId ?? ''} options={[{ value: '', label: '— elegir —' }, ...s.project.stage.projectors.map((pj) => ({ value: pj.id, label: pj.name }))]} onChange={(v) => upd((x) => ({ ...x, projectorId: v || null }))} />
          </Field>
        )}
        <button className="btn danger sm" onClick={() => s.update((pr) => ({ ...pr, outputs: pr.outputs.filter((x) => x.id !== o.id) }))}>
          Eliminar salida
        </button>
      </Section>
      <Section title="Color de la salida">
        <ParamSlider id={`output.${o.id}.brightness`} label="Brillo" />
        <ParamSlider id={`output.${o.id}.contrast`} label="Contraste" />
        <ParamSlider id={`output.${o.id}.gamma`} label="Gamma" />
        {(['red', 'green', 'blue'] as const).map((c) => (
          <div className="row" key={c}>
            <Slider value={o.color[c]} min={0} max={2} def={1} label={{ red: 'Rojo', green: 'Verde', blue: 'Azul' }[c]} onChange={(v) => upd((x) => ({ ...x, color: { ...x.color, [c]: v } }))} />
          </div>
        ))}
      </Section>
      <Section title="Edge blending (multiproyector)">
        <SoftEdgeControls value={o.softEdge} onChange={(se) => upd((x) => ({ ...x, softEdge: se }))} />
      </Section>
      <Section title="Warp final / keystone">
        {!o.finalWarp ? (
          <button className="btn sm" onClick={() => upd((x) => ({ ...x, finalWarp: meshFromQuad(rectQuad(0.5, 0.5, 0.5, 0.5), 2, 2, 'perspective') }))}>
            Activar warp final
          </button>
        ) : (
          <WarpGridControls value={o.finalWarp} onChange={(w) => upd((x) => ({ ...x, finalWarp: w }))} onRemove={() => upd((x) => ({ ...x, finalWarp: null }))} />
        )}
      </Section>
      <Section title="Máscaras de salida">
        <MasksEditor masks={o.masks} onChange={(m) => upd((x) => ({ ...x, masks: m }))} />
      </Section>
    </>
  );
}

function SoftEdgeControls({ value, onChange }: { value: Surface['softEdge']; onChange: (v: Surface['softEdge']) => void }) {
  return (
    <>
      {(['left', 'right', 'top', 'bottom'] as const).map((k) => (
        <div className="row" key={k}>
          <Slider value={value[k]} min={0} max={0.5} def={0} label={{ left: 'Izquierda', right: 'Derecha', top: 'Arriba', bottom: 'Abajo' }[k]} onChange={(v) => onChange({ ...value, [k]: v })} />
        </div>
      ))}
      <div className="row">
        <Slider value={value.gamma} min={0.5} max={3} def={2.2} label="Gamma de mezcla" onChange={(v) => onChange({ ...value, gamma: v })} />
      </div>
      <button className="btn sm" onClick={() => onChange(defaultSoftEdge())}>
        Reiniciar
      </button>
    </>
  );
}

function WarpGridControls({ value, onChange, onRemove }: { value: NonNullable<Surface['mesh']>; onChange: (m: NonNullable<Surface['mesh']>) => void; onRemove?: () => void }) {
  return (
    <>
      <Field label="Interpolación">
        <Select<WarpInterpolation>
          value={value.interpolation}
          options={[
            { value: 'perspective', label: 'Perspectiva (keystone)' },
            { value: 'bilinear', label: 'Bilineal' },
            { value: 'bezier', label: 'Bezier / curva suave' },
          ]}
          onChange={(v) => onChange({ ...value, interpolation: v })}
        />
      </Field>
      <Field label="Puntos">
        <NumberInput value={value.cols} min={1} max={32} onChange={(v) => onChange(resampleMesh(value, v, value.rows))} />×
        <NumberInput value={value.rows} min={1} max={32} onChange={(v) => onChange(resampleMesh(value, value.cols, v))} />
      </Field>
      {onRemove && (
        <button className="btn sm" onClick={onRemove}>
          Quitar warp
        </button>
      )}
    </>
  );
}

function SurfaceInspector({ output, surface: sf, maskEdit, setMaskEdit }: { output: Output; surface: Surface; maskEdit: string | null; setMaskEdit: (id: string | null) => void }) {
  const s = useShow();
  const upd = (fn: (x: Surface) => Surface) => s.update((pr) => ({ ...pr, outputs: replaceById(pr.outputs, output.id, (o) => ({ ...o, surfaces: replaceById(o.surfaces, sf.id, fn) })) }));
  return (
    <>
      <Section title="Superficie">
        <Field label="Nombre">
          <TextInput value={sf.name} onChange={(v) => upd((x) => ({ ...x, name: v }))} />
        </Field>
        <Field label="Geometría">
          <Seg
            value={sf.kind}
            options={[
              { value: 'quad', label: 'Corner pin' },
              { value: 'mesh', label: 'Malla' },
              { value: 'polygon', label: 'Polígono' },
            ]}
            onChange={(k) =>
              upd((x) => ({
                ...x,
                kind: k,
                mesh: k === 'mesh' ? x.mesh ?? meshFromQuad(x.quad, 4, 4, 'bezier') : x.mesh,
                polygon: k === 'polygon' ? x.polygon ?? [...x.quad] : x.polygon,
              }))
            }
          />
        </Field>
        {sf.kind === 'mesh' && sf.mesh && <WarpGridControls value={sf.mesh} onChange={(m) => upd((x) => ({ ...x, mesh: m }))} />}
        <button className="btn sm" onClick={() => upd((x) => ({ ...x, quad: rectQuad(0.5, 0.5, 0.5, 0.5), mesh: x.mesh ? meshFromQuad(rectQuad(0.5, 0.5, 0.5, 0.5), x.mesh.cols, x.mesh.rows, x.mesh.interpolation) : null }))}>
          Pantalla completa
        </button>
      </Section>
      <Section title="Contenido">
        <SourcePicker value={sf.source} onChange={(r) => upd((x) => ({ ...x, source: r }))} />
        <div className="hint">Región del contenido (para repartir una imagen entre varias superficies):</div>
        {(['x', 'y', 'w', 'h'] as const).map((k) => (
          <div className="row" key={k}>
            <Slider value={sf.region[k]} min={0} max={1} def={k === 'w' || k === 'h' ? 1 : 0} label={{ x: 'X', y: 'Y', w: 'Ancho', h: 'Alto' }[k]} onChange={(v) => upd((x) => ({ ...x, region: { ...x.region, [k]: v } }))} />
          </div>
        ))}
      </Section>
      <Section title="Mezcla y color">
        <ParamSlider id={`surface.${sf.id}.opacity`} label="Opacidad" />
        <Field label="Fusión">
          <Select value={sf.blend} options={[{ value: 'normal', label: 'Normal' }, { value: 'add', label: 'Sumar' }, { value: 'screen', label: 'Trama' }, { value: 'multiply', label: 'Multiplicar' }]} onChange={(v) => upd((x) => ({ ...x, blend: v }))} />
        </Field>
        {(['brightness', 'contrast', 'gamma'] as const).map((k) => (
          <div className="row" key={k}>
            <Slider value={sf.color[k]} min={k === 'brightness' ? -1 : 0.1} max={k === 'brightness' ? 1 : 3} def={k === 'brightness' ? 0 : 1} label={{ brightness: 'Brillo', contrast: 'Contraste', gamma: 'Gamma' }[k]} onChange={(v) => upd((x) => ({ ...x, color: { ...x.color, [k]: v } }))} />
          </div>
        ))}
      </Section>
      <Section title="Borde suave (soft edge)">
        <SoftEdgeControls value={sf.softEdge} onChange={(v) => upd((x) => ({ ...x, softEdge: v }))} />
      </Section>
      <Section title="Máscaras">
        <MasksEditor masks={sf.masks} onChange={(m) => upd((x) => ({ ...x, masks: m }))} onEditPoints={setMaskEdit} editing={maskEdit} />
      </Section>
      <Section title="Efectos (GPU)">
        <EffectsEditor effects={sf.effects} onChange={(fx) => upd((x) => ({ ...x, effects: fx }))} />
      </Section>
    </>
  );
}

// ------------------------------------------------------------------ canvas overlay with handles

function MappingOverlay({ output, surface, mode, maskId }: { output: Output; surface: Surface | null; mode: EditMode; maskId: string | null }) {
  const s = useShow();
  const svg = useRef<SVGSVGElement>(null);
  const [selPoint, setSelPoint] = useState<number>(-1);
  const aspect = output.width / output.height;
  const r = 0.012;

  const toLocal = (e: { clientX: number; clientY: number }): Vec2 => {
    const b = svg.current!.getBoundingClientRect();
    return { x: (e.clientX - b.left) / b.width, y: (e.clientY - b.top) / b.height };
  };

  const updSurface = (fn: (x: Surface) => Surface) => surface && s.update((pr) => ({ ...pr, outputs: replaceById(pr.outputs, output.id, (o) => ({ ...o, surfaces: replaceById(o.surfaces, surface.id, fn) })) }));
  const updOutput = (fn: (o: Output) => Output) => s.update((pr) => ({ ...pr, outputs: replaceById(pr.outputs, output.id, fn) }));

  // points being edited in output space
  let points: Vec2[] = [];
  let setPoints: ((pts: Vec2[]) => void) | null = null;
  let closed = true;
  let toOut = (p: Vec2) => p;
  let fromOut = (p: Vec2) => p;
  const mask: Mask | undefined = surface?.masks.find((m) => m.id === maskId);
  if (mode === 'warp' && output.finalWarp) {
    const w = output.finalWarp;
    points = w.points;
    setPoints = (pts) => updOutput((o) => ({ ...o, finalWarp: o.finalWarp ? { ...o.finalWarp, points: pts } : null }));
  } else if (surface && mode === 'mask' && mask) {
    const h = squareToQuad(surface.quad);
    toOut = (p) => (surface.kind === 'mesh' && surface.mesh ? evalMesh(surface.mesh, p.x, p.y) : (h && mapPoint(h, p.x, p.y)) || p);
    fromOut = (p) => invertSurface(surface, p);
    points = mask.points.map(toOut);
    setPoints = (pts) => updSurface((x) => ({ ...x, masks: x.masks.map((m) => (m.id === mask.id ? { ...m, points: pts.map(fromOut) } : m)) }));
  } else if (surface && mode === 'surface' && !surface.locked) {
    if (surface.kind === 'mesh' && surface.mesh) {
      points = surface.mesh.points;
      setPoints = (pts) => updSurface((x) => (x.mesh ? { ...x, mesh: { ...x.mesh, points: pts }, quad: [pts[0], pts[x.mesh.cols], pts[pts.length - 1], pts[pts.length - 1 - x.mesh.cols]] as Quad } : x));
    } else if (surface.kind === 'polygon' && surface.polygon) {
      points = surface.polygon;
      setPoints = (pts) => updSurface((x) => ({ ...x, polygon: pts }));
    } else {
      points = surface.quad;
      setPoints = (pts) => updSurface((x) => ({ ...x, quad: pts as Quad }));
    }
  }
  if (mode === 'surface' && surface?.kind === 'mesh') closed = false;

  const startDrag = (e: React.PointerEvent, index: number) => {
    if (!setPoints) return;
    e.stopPropagation();
    if (e.altKey && index >= 0 && (surface?.kind === 'polygon' || mask?.shape === 'polygon' || mask?.shape === 'freehand') && points.length > 3) {
      setPoints(points.filter((_, i) => i !== index));
      return;
    }
    (e.target as Element).setPointerCapture(e.pointerId);
    s.beginEdit();
    setSelPoint(index);
    const start = toLocal(e);
    const orig = points.map((p) => ({ ...p }));
    const fine = e.shiftKey;
    const move = (ev: PointerEvent) => {
      const cur = toLocal(ev);
      let dx = cur.x - start.x;
      let dy = cur.y - start.y;
      if (ev.ctrlKey || fine) {
        dx *= 0.2;
        dy *= 0.2;
      }
      const next = orig.map((p, i) => (index < 0 || i === index ? { x: p.x + dx, y: p.y + dy } : p));
      setPoints!(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      s.commitEdit();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const nudge = (e: React.KeyboardEvent) => {
    if (!setPoints || selPoint < -1) return;
    const step = (e.shiftKey ? 10 : 1) / output.width;
    const stepY = (e.shiftKey ? 10 : 1) / output.height;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -stepY], ArrowDown: [0, stepY] }[e.key];
    if (e.key === 'Tab') {
      e.preventDefault();
      setSelPoint((selPoint + 1) % Math.max(1, points.length));
      return;
    }
    if (!d) return;
    e.preventDefault();
    setPoints(points.map((p, i) => (selPoint < 0 || i === selPoint ? { x: p.x + d[0], y: p.y + d[1] } : p)));
  };

  const poly = points.length ? (mode === 'surface' && surface?.kind === 'mesh' ? null : points.map((p) => `${p.x},${p.y}`).join(' ')) : null;
  return (
    <div className="handles" tabIndex={0} onKeyDown={nudge} style={{ outline: 'none' }}>
      <svg ref={svg} viewBox="0 0 1 1" preserveAspectRatio="none">
        {/* outlines of all surfaces */}
        {mode === 'surface' &&
          output.surfaces.map((sf) => {
            const outline = sf.kind === 'polygon' && sf.polygon ? sf.polygon : sf.kind === 'mesh' && sf.mesh ? meshOutline(sf.mesh) : sf.quad;
            return (
              <polygon
                key={sf.id}
                points={outline.map((p) => `${p.x},${p.y}`).join(' ')}
                fill={sf.id === surface?.id ? 'rgba(25,195,255,0.08)' : 'transparent'}
                stroke={sf.id === surface?.id ? '#19c3ff' : 'rgba(255,255,255,0.35)'}
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
                style={{ cursor: sf.locked ? 'not-allowed' : 'move' }}
                onPointerDown={(e) => {
                  if (sf.id !== surface?.id) {
                    s.ui.selectedSurface = sf.id;
                    s.emit();
                    return;
                  }
                  startDrag(e, -1);
                }}
              />
            );
          })}
        {mode === 'surface' && surface?.kind === 'mesh' && surface.mesh && <MeshLines mesh={surface.mesh} />}
        {mode === 'warp' && output.finalWarp && <MeshLines mesh={output.finalWarp} />}
        {poly && mode !== 'surface' && <polygon points={poly} fill="rgba(255,200,0,0.06)" stroke="#ffcc00" strokeWidth={1.5} vectorEffect="non-scaling-stroke" onPointerDown={(e) => startDrag(e, -1)} style={{ cursor: 'move' }} />}
        {/* add point on polygon edge */}
        {setPoints && closed && (surface?.kind === 'polygon' || mask?.shape === 'polygon' || mask?.shape === 'freehand') &&
          points.map((p, i) => {
            const q = points[(i + 1) % points.length];
            return (
              <line
                key={`e${i}`}
                x1={p.x}
                y1={p.y}
                x2={q.x}
                y2={q.y}
                stroke="transparent"
                strokeWidth={10}
                vectorEffect="non-scaling-stroke"
                onDoubleClick={(e) => {
                  const m = toLocal(e);
                  const next = [...points];
                  next.splice(i + 1, 0, m);
                  setPoints!(next);
                }}
              />
            );
          })}
        {points.map((p, i) => (
          <ellipse
            key={i}
            cx={p.x}
            cy={p.y}
            rx={r / aspect}
            ry={r}
            fill={i === selPoint ? '#ffcc00' : mode === 'surface' && surface?.kind === 'quad' ? ['#ff4d4d', '#4dff6a', '#4d7dff', '#ffe14d'][i] : '#ffffff'}
            stroke="#000"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            style={{ cursor: 'grab' }}
            onPointerDown={(e) => startDrag(e, i)}
          />
        ))}
      </svg>
      {mode === 'mask' && !mask && <div className="view-label" style={{ top: 26 }}>Elige «Editar forma» en una máscara de la superficie</div>}
      {mode === 'warp' && !output.finalWarp && <div className="view-label" style={{ top: 26 }}>Activa el warp final en el inspector de la salida</div>}
      {mode === 'surface' && surface?.locked && <div className="view-label" style={{ top: 26 }}>Superficie bloqueada</div>}
      {mode === 'mask' && mask && (
        <div className="view-tools">
          <button className="btn sm" onClick={() => updSurface((x) => ({ ...x, masks: x.masks.map((m) => (m.id === mask.id ? createMaskLike(m) : m)) }))}>
            Reiniciar forma
          </button>
        </div>
      )}
    </div>
  );
}

function createMaskLike(m: Mask): Mask {
  return { ...createMask(m.shape), id: m.id, name: m.name, inverted: m.inverted, feather: m.feather, opacity: m.opacity };
}

function MeshLines({ mesh }: { mesh: NonNullable<Surface['mesh']> }) {
  const lines: string[] = [];
  const S = 12;
  for (let r = 0; r <= mesh.rows; r++) {
    const pts: string[] = [];
    for (let k = 0; k <= mesh.cols * S; k++) {
      const p = evalMesh(mesh, k / (mesh.cols * S), r / mesh.rows);
      pts.push(`${p.x},${p.y}`);
    }
    lines.push(pts.join(' '));
  }
  for (let c = 0; c <= mesh.cols; c++) {
    const pts: string[] = [];
    for (let k = 0; k <= mesh.rows * S; k++) {
      const p = evalMesh(mesh, c / mesh.cols, k / (mesh.rows * S));
      pts.push(`${p.x},${p.y}`);
    }
    lines.push(pts.join(' '));
  }
  return (
    <>
      {lines.map((l, i) => (
        <polyline key={i} points={l} fill="none" stroke="rgba(25,195,255,0.6)" strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none" />
      ))}
    </>
  );
}

function meshOutline(m: NonNullable<Surface['mesh']>): Vec2[] {
  const out: Vec2[] = [];
  const S = 8;
  for (let k = 0; k <= m.cols * S; k++) out.push(evalMesh(m, k / (m.cols * S), 0));
  for (let k = 0; k <= m.rows * S; k++) out.push(evalMesh(m, 1, k / (m.rows * S)));
  for (let k = m.cols * S; k >= 0; k--) out.push(evalMesh(m, k / (m.cols * S), 1));
  for (let k = m.rows * S; k >= 0; k--) out.push(evalMesh(m, 0, k / (m.rows * S)));
  return out;
}

/** Output-space point → surface UV (exact inverse homography for quads, Newton iteration for meshes). */
function invertSurface(sf: Surface, p: Vec2): Vec2 {
  if (sf.kind !== 'mesh' || !sf.mesh) {
    const h = squareToQuad(sf.quad);
    const inv = h ? invert3(h) : null;
    return (inv && mapPoint(inv, p.x, p.y)) || p;
  }
  let u = 0.5;
  let v = 0.5;
  for (let it = 0; it < 20; it++) {
    const f = evalMesh(sf.mesh, u, v);
    const e = 1e-4;
    const fu = evalMesh(sf.mesh, u + e, v);
    const fv = evalMesh(sf.mesh, u, v + e);
    const j = [(fu.x - f.x) / e, (fv.x - f.x) / e, (fu.y - f.y) / e, (fv.y - f.y) / e];
    const det = j[0] * j[3] - j[1] * j[2];
    if (Math.abs(det) < 1e-12) break;
    const rx = p.x - f.x;
    const ry = p.y - f.y;
    u += (j[3] * rx - j[1] * ry) / det;
    v += (-j[2] * rx + j[0] * ry) / det;
  }
  return { x: u, y: v };
}
