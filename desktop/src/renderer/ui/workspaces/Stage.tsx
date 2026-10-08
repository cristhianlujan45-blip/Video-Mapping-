import { useState } from 'react';
import type { FaceContent, Object3D, PrimitiveKind, Projector, Vec3 } from '../../../shared/project/model';
import { createObject3D, createProjector } from '../../../shared/project/defaults';
import { FACE_LABELS, FACE_NAMES, PRIMITIVE_LABELS } from '../../../shared/project/faces';
import type { ViewMode3D } from '../../worker/protocol';
import { useShow } from '../hooks';
import { Icon } from '../icons';
import { Check, ColorInput, Field, NumberInput, ParamSlider, ParamToggle, Section, Select, Seg, Slider, TextInput } from '../controls';
import { ViewCanvas } from '../ViewCanvas';
import { SourcePicker } from '../shared';
import { replaceById } from '../../core/store';
import { importFromDialog } from './Media';

export const VIEW_MODES: { value: ViewMode3D; label: string }[] = [
  { value: 'projection', label: 'Proyección' },
  { value: 'projection+wireframe', label: 'Proyección + alambre' },
  { value: 'projection+grid', label: 'Proyección + rejilla' },
  { value: 'texture', label: 'Textura' },
  { value: 'material', label: 'Material' },
  { value: 'solid', label: 'Sólido' },
  { value: 'wireframe', label: 'Alambre' },
  { value: 'xray', label: 'Rayos X' },
];

type Split = 'none' | 'projector' | 'output' | 'mapping';

export function StageWorkspace() {
  const s = useShow();
  const p = s.project;
  const st = p.stage;
  const [viewMode, setViewMode] = useState<ViewMode3D>('projection');
  const [split, setSplit] = useState<Split>('projector');
  const [splitTarget, setSplitTarget] = useState<string>('');
  const selObj = st.objects.find((o) => o.id === s.ui.selectedObject) ?? null;
  const selProj = st.projectors.find((o) => o.id === s.ui.selectedObject) ?? null;
  const projForSplit = splitTarget || st.projectors[0]?.id || '';
  const outForSplit = splitTarget || p.outputs[0]?.id || '';

  const add = (kind: PrimitiveKind) => {
    const o = createObject3D(kind, `${PRIMITIVE_LABELS[kind]} ${st.objects.length + 1}`);
    s.update((pr) => ({ ...pr, stage: { ...pr.stage, objects: [...pr.stage.objects, o] } }));
    select(o.id);
  };
  const select = (id: string | null) => {
    s.ui.selectedObject = id;
    s.ui.selectedFace = null;
    s.sendUiState();
    s.emit();
  };

  return (
    <div className="cols">
      <div className="panel" style={{ width: 250 }}>
        <div className="panel-title">Escena 3D</div>
        <div className="panel-body">
          <Section title="Añadir objeto">
            <div className="grid2">
              {(['cube', 'plane', 'sphere', 'cylinder', 'cone', 'pyramid', 'prism'] as PrimitiveKind[]).map((k) => (
                <button key={k} className="btn sm" onClick={() => add(k)}>
                  {PRIMITIVE_LABELS[k]}
                </button>
              ))}
              <button
                className="btn sm primary"
                onClick={async () => {
                  const items = await importFromDialog(['model3d']);
                  for (const m of items) {
                    const o = createObject3D('model', m.name.replace(/\.[^.]+$/, ''));
                    o.mediaId = m.id;
                    s.update((pr) => ({ ...pr, stage: { ...pr.stage, objects: [...pr.stage.objects, o] } }));
                  }
                }}
              >
                Importar modelo
              </button>
            </div>
            <div className="hint">OBJ, FBX, glTF/GLB, STL, PLY, 3DS.</div>
          </Section>
          <Section title="Objetos">
            <div className="list">
              {st.objects.map((o) => (
                <div key={o.id} className={`item ${s.ui.selectedObject === o.id ? 'sel' : ''}`} onClick={() => select(o.id)}>
                  <button className="btn icon sm" onClick={(e) => { e.stopPropagation(); s.setParam(`obj.${o.id}.visible`, o.visible ? 0 : 1); }}>
                    <Icon name={o.visible ? 'eye' : 'eyeoff'} />
                  </button>
                  <span className="name">{o.name}</span>
                  {o.locked && <Icon name="lock" size={12} />}
                </div>
              ))}
              {st.objects.length === 0 && <div className="hint">Vacío. Añade un cubo o importa un modelo del edificio/escenario.</div>}
            </div>
          </Section>
          <Section
            title="Proyectores"
            right={
              <button
                className="btn sm"
                onClick={() => {
                  const pj = createProjector(st.projectors.length);
                  s.update((pr) => ({ ...pr, stage: { ...pr.stage, projectors: [...pr.stage.projectors, pj] } }));
                  select(pj.id);
                }}
              >
                <Icon name="plus" />
              </button>
            }
          >
            <div className="list">
              {st.projectors.map((pj) => (
                <div key={pj.id} className={`item ${s.ui.selectedObject === pj.id ? 'sel' : ''}`} onClick={() => select(pj.id)}>
                  <span className="status-dot" style={{ background: pj.color }} />
                  <span className="name">
                    {pj.name}
                    <div className="small muted">{p.outputs.find((o) => o.id === pj.outputId)?.name ?? 'sin salida'}</div>
                  </span>
                </div>
              ))}
            </div>
          </Section>
          <Section title="Rejilla y snap">
            <Field label="Unidades">
              <Select value={st.units} options={[{ value: 'm', label: 'metros' }, { value: 'cm', label: 'cm' }, { value: 'custom', label: 'personalizadas' }]} onChange={(v) => s.update((pr) => ({ ...pr, stage: { ...pr.stage, units: v } }))} />
            </Field>
            <Check checked={st.grid.visible} onChange={(v) => s.update((pr) => ({ ...pr, stage: { ...pr.stage, grid: { ...pr.stage.grid, visible: v } } }))} label="Mostrar rejilla" />
            <Field label="Tamaño / div.">
              <NumberInput value={st.grid.size} min={1} max={500} onChange={(v) => s.update((pr) => ({ ...pr, stage: { ...pr.stage, grid: { ...pr.stage.grid, size: v } } }))} />
              <NumberInput value={st.grid.divisions} min={1} max={500} onChange={(v) => s.update((pr) => ({ ...pr, stage: { ...pr.stage, grid: { ...pr.stage.grid, divisions: v } } }))} />
            </Field>
            {(['grid', 'vertex', 'edge', 'face'] as const).map((k) => (
              <Check key={k} checked={st.snap[k]} onChange={(v) => s.update((pr) => ({ ...pr, stage: { ...pr.stage, snap: { ...pr.stage.snap, [k]: v } } }))} label={{ grid: 'Snap a rejilla / incremento', vertex: 'Snap a vértice', edge: 'Snap a arista', face: 'Snap a cara' }[k]} />
            ))}
            <Field label="Incremento">
              <NumberInput value={st.snap.increment} min={0.001} max={10} step={0.01} onChange={(v) => s.update((pr) => ({ ...pr, stage: { ...pr.stage, snap: { ...pr.stage.snap, increment: v } } }))} />
              <span className="small muted">ángulo</span>
              <NumberInput value={st.snap.angle} min={1} max={90} onChange={(v) => s.update((pr) => ({ ...pr, stage: { ...pr.stage, snap: { ...pr.stage.snap, angle: v } } }))} />
            </Field>
          </Section>
        </div>
      </div>
      <div className="col" style={{ flex: 1, padding: 8, gap: 8 }}>
        <div className="row" style={{ margin: 0 }}>
          <Select value={viewMode} options={VIEW_MODES} style={{ maxWidth: 200 }} onChange={setViewMode} />
          <span className="small muted">Rueda/botón central: órbita · Mayús+central: pan · Numpad 1/3/7 (+Ctrl) vistas · 5 persp/orto · 0 proyector · G/R/S + X/Y/Z transformar · Ctrl = snap</span>
          <span className="spacer" />
          <span className="small muted">Vista dividida</span>
          <Seg
            value={split}
            onChange={(v) => { setSplit(v); setSplitTarget(''); }}
            options={[
              { value: 'none', label: 'No' },
              { value: 'projector', label: 'Proyector' },
              { value: 'output', label: 'Salida' },
              { value: 'mapping', label: 'Mapping' },
            ]}
          />
          {split === 'projector' && <Select value={projForSplit} style={{ maxWidth: 160 }} options={st.projectors.map((x) => ({ value: x.id, label: x.name }))} onChange={setSplitTarget} />}
          {(split === 'output' || split === 'mapping') && <Select value={outForSplit} style={{ maxWidth: 160 }} options={p.outputs.map((x) => ({ value: x.id, label: x.name }))} onChange={setSplitTarget} />}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: split === 'none' ? '1fr' : '1.4fr 1fr', gap: 8, flex: 1, minHeight: 0 }}>
          <ViewCanvas spec={{ id: 'viewport-main', kind: 'viewport3d', viewMode, showGrid: viewMode !== 'projection' || true }} interactive label="Vista 3D" />
          {split === 'projector' && projForSplit && <ViewCanvas key={`p${projForSplit}`} spec={{ kind: 'projectorView', target: projForSplit }} label={`Vista desde ${st.projectors.find((x) => x.id === projForSplit)?.name}`} />}
          {split === 'projector' && !projForSplit && <div className="hint">Añade un proyector.</div>}
          {(split === 'output' || split === 'mapping') && outForSplit && <ViewCanvas key={`o${outForSplit}${split}`} spec={{ kind: 'outputPreview', target: outForSplit }} label={`${split === 'mapping' ? 'Mapping' : 'Salida'}: ${p.outputs.find((x) => x.id === outForSplit)?.name}`} />}
        </div>
      </div>
      <div className="panel right" style={{ width: 330 }}>
        <div className="panel-title">{selObj ? selObj.name : selProj ? selProj.name : 'Inspector 3D'}</div>
        <div className="panel-body">
          {selObj && <ObjectInspector o={selObj} />}
          {selProj && <ProjectorInspector pj={selProj} />}
          {!selObj && !selProj && <ViewControls />}
        </div>
      </div>
    </div>
  );
}

function ViewControls() {
  return (
    <Section title="Cámara del viewport (controlable por MIDI)">
      <ParamSlider id="view.yaw" label="Órbita horizontal" />
      <ParamSlider id="view.pitch" label="Órbita vertical" />
      <ParamSlider id="view.distance" label="Distancia (dolly)" />
      <ParamSlider id="view.fov" label="FOV" />
      <ParamSlider id="view.panX" label="Pan X" />
      <ParamSlider id="view.panY" label="Pan Y" />
    </Section>
  );
}

function Vec3Fields({ label, value, onChange }: { label: string; value: Vec3; onChange: (v: Vec3) => void }) {
  return (
    <Field label={label}>
      {[0, 1, 2].map((i) => (
        <NumberInput key={i} width={64} step={0.01} value={value[i]} onChange={(x) => onChange(value.map((c, k) => (k === i ? x : c)) as Vec3)} />
      ))}
    </Field>
  );
}

function ObjectInspector({ o }: { o: Object3D }) {
  const s = useShow();
  const upd = (fn: (x: Object3D) => Object3D) => s.update((pr) => ({ ...pr, stage: { ...pr.stage, objects: replaceById(pr.stage.objects, o.id, fn) } }));
  const model = o.kind === 'model' ? s.project.media.find((m) => m.id === o.mediaId) : null;
  // material names of imported models come from the render worker once the model loads
  const info = o.mediaId ? s.modelInfo.get(o.mediaId) : undefined;
  const modelFaces = info?.materials ?? [];
  const faces = o.kind === 'model' ? ['all', ...modelFaces] : FACE_NAMES[o.kind].length > 1 ? ['all', ...FACE_NAMES[o.kind]] : ['all'];
  const face = s.ui.selectedFace && faces.includes(s.ui.selectedFace) ? s.ui.selectedFace : 'all';
  const fc: FaceContent = o.faces[face] ?? o.faces.all ?? { source: { type: 'none' }, opacity: 1, tint: '#ffffff', projectFrom: null };
  const setFace = (patch: Partial<FaceContent>) => upd((x) => ({ ...x, faces: { ...x.faces, [face]: { ...fc, ...patch } } }));
  return (
    <>
      <Section title="Objeto">
        <Field label="Nombre">
          <TextInput value={o.name} onChange={(v) => upd((x) => ({ ...x, name: v }))} />
        </Field>
        {model && <div className="small muted">{model.name}{info?.error ? '' : info ? ` · ${modelFaces.length} material(es)` : ' · cargando…'}</div>}
        {info?.error && <div className="badge err">{info.error}</div>}
        <div className="row">
          <Check checked={o.locked} onChange={(v) => upd((x) => ({ ...x, locked: v }))} label="Bloquear" />
          <ParamToggle id={`obj.${o.id}.visible`} label="Visible" />
        </div>
        <Vec3Fields label="Posición" value={o.position} onChange={(v) => upd((x) => ({ ...x, position: v }))} />
        <Vec3Fields label="Rotación °" value={o.rotation} onChange={(v) => upd((x) => ({ ...x, rotation: v }))} />
        <Vec3Fields label="Escala" value={o.scale} onChange={(v) => upd((x) => ({ ...x, scale: v }))} />
        <div className="row">
          <button
            className="btn sm"
            onClick={() => {
              const c = { ...structuredClone(o), id: `obj_${Date.now().toString(36)}`, name: `${o.name} copia`, position: [o.position[0] + 1, o.position[1], o.position[2]] as Vec3 };
              s.update((pr) => ({ ...pr, stage: { ...pr.stage, objects: [...pr.stage.objects, c] } }));
            }}
          >
            Duplicar
          </button>
          <Field label="Grupo">
            <TextInput value={o.group ?? ''} placeholder="(sin grupo)" onChange={(v) => upd((x) => ({ ...x, group: v || undefined }))} />
          </Field>
          <button className="btn sm danger" onClick={() => s.update((pr) => ({ ...pr, stage: { ...pr.stage, objects: pr.stage.objects.filter((x) => x.id !== o.id) } }))}>
            Eliminar
          </button>
        </div>
      </Section>
      <Section title="Control en vivo (MIDI/OSC/automatización)">
        <ParamSlider id={`obj.${o.id}.rotY`} label="Rotación Y" />
        <ParamSlider id={`obj.${o.id}.posY`} label="Posición Y" />
        <ParamSlider id={`obj.${o.id}.scale`} label="Escala" />
      </Section>
      <Section title="Contenido por cara">
        <Field label="Cara">
          <Select value={face} options={faces.map((f) => ({ value: f, label: FACE_LABELS[f] ?? f }))} onChange={(f) => { s.ui.selectedFace = f; s.emit(); }} />
        </Field>
        <div className="hint">Clic en una cara en la vista 3D para seleccionarla.</div>
        <SourcePicker value={fc.source} onChange={(r) => setFace({ source: r })} />
        <div className="row">
          <Slider value={fc.opacity} min={0} max={1} def={1} label="Opacidad" onChange={(v) => setFace({ opacity: v })} />
          <ColorInput value={fc.tint} onChange={(c) => setFace({ tint: c })} />
        </div>
        <Field label="Mapeo">
          <Select
            value={fc.projectFrom ?? ''}
            options={[{ value: '', label: 'UV del objeto' }, ...s.project.stage.projectors.map((pj) => ({ value: pj.id, label: `Proyectivo desde ${pj.name}` }))]}
            onChange={(v) => setFace({ projectFrom: v || null })}
          />
        </Field>
        {face !== 'all' && o.faces[face] && (
          <button className="btn sm" onClick={() => upd((x) => { const f = { ...x.faces }; delete f[face]; return { ...x, faces: f }; })}>
            Usar el contenido de «Todas»
          </button>
        )}
      </Section>
    </>
  );
}

function ProjectorInspector({ pj }: { pj: Projector }) {
  const s = useShow();
  const upd = (fn: (x: Projector) => Projector) => s.update((pr) => ({ ...pr, stage: { ...pr.stage, projectors: replaceById(pr.stage.projectors, pj.id, fn) } }));
  return (
    <>
      <Section title="Proyector virtual (cámara)">
        <Field label="Nombre">
          <TextInput value={pj.name} onChange={(v) => upd((x) => ({ ...x, name: v }))} />
        </Field>
        <Field label="Salida física">
          <Select
            value={pj.outputId ?? ''}
            options={[{ value: '', label: '— ninguna —' }, ...s.project.outputs.map((o) => ({ value: o.id, label: o.name }))]}
            onChange={(v) => {
              upd((x) => ({ ...x, outputId: v || null }));
              if (v) s.update((pr) => ({ ...pr, outputs: replaceById(pr.outputs, v, (o) => ({ ...o, mode: '3d', projectorId: pj.id })) }));
            }}
          />
        </Field>
        <Vec3Fields label="Posición" value={pj.position} onChange={(v) => upd((x) => ({ ...x, position: v }))} />
        <Vec3Fields label="Rotación °" value={pj.rotation} onChange={(v) => upd((x) => ({ ...x, rotation: v }))} />
        <ParamSlider id={`proj.${pj.id}.fov`} label="FOV vertical" />
        <div className="row">
          <Slider value={pj.shiftX} min={-1} max={1} def={0} label="Lens shift X" onChange={(v) => upd((x) => ({ ...x, shiftX: v }))} />
        </div>
        <div className="row">
          <Slider value={pj.shiftY} min={-1} max={1} def={0} label="Lens shift Y" onChange={(v) => upd((x) => ({ ...x, shiftY: v }))} />
        </div>
        <Field label="Near / Far">
          <NumberInput value={pj.near} step={0.01} min={0.001} onChange={(v) => upd((x) => ({ ...x, near: v }))} />
          <NumberInput value={pj.far} min={1} onChange={(v) => upd((x) => ({ ...x, far: v }))} />
        </Field>
        <Field label="Resolución">
          <NumberInput value={pj.width} onChange={(v) => upd((x) => ({ ...x, width: v }))} />×
          <NumberInput value={pj.height} onChange={(v) => upd((x) => ({ ...x, height: v }))} />
        </Field>
        <div className="hint">La resolución y el aspecto reales vienen de la salida física asignada. Numpad 0 en la vista 3D = ver desde el proyector.</div>
        <button className="btn sm danger" onClick={() => s.update((pr) => ({ ...pr, stage: { ...pr.stage, projectors: pr.stage.projectors.filter((x) => x.id !== pj.id) } }))}>
          Eliminar proyector
        </button>
      </Section>
    </>
  );
}
