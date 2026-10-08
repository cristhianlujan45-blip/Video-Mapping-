import { useState } from 'react';
import type { EffectInstance, EffectKind, GeneratorKind, Mask, MaskShape, SourceRef, TrackingVisual } from '../../shared/project/model';
import { EFFECTS, EFFECT_LIST, effectParamId } from '../../shared/project/effects';
import { createEffect, createMask } from '../../shared/project/defaults';
import { useShow } from './hooks';
import { Icon } from './icons';
import { Check, ColorInput, ParamSlider, ParamToggle, Section, Select, Slider, TextInput } from './controls';

export const GENERATORS: { value: GeneratorKind; label: string }[] = [
  { value: 'plasma', label: 'Plasma' },
  { value: 'noise', label: 'Ruido fractal' },
  { value: 'tunnel', label: 'Túnel' },
  { value: 'waves', label: 'Ondas' },
  { value: 'rings', label: 'Anillos' },
  { value: 'stripes', label: 'Franjas' },
  { value: 'checker', label: 'Damero' },
  { value: 'gradient', label: 'Degradado' },
  { value: 'particles', label: 'Partículas GPU' },
  { value: 'audioSpectrum', label: 'Espectro de audio' },
];

export const TRACKING_VISUALS: { value: TrackingVisual; label: string }[] = [
  { value: 'skeleton', label: 'Esqueleto' },
  { value: 'silhouette', label: 'Silueta' },
  { value: 'particles', label: 'Partículas' },
  { value: 'fire', label: 'Fuego' },
  { value: 'trails', label: 'Estelas' },
  { value: 'lines', label: 'Líneas entre personas' },
  { value: 'glow', label: 'Brillo' },
];

export function sourceLabel(ref: SourceRef, s: ReturnType<typeof useShow>): string {
  const p = s.project;
  switch (ref.type) {
    case 'none':
      return 'Nada';
    case 'media':
      return p.media.find((m) => m.id === ref.mediaId)?.name ?? 'Medio no encontrado';
    case 'camera':
      return `Cámara: ${p.cameras.find((c) => c.id === ref.cameraId)?.name ?? '?'}`;
    case 'generator':
      return `Generador: ${GENERATORS.find((g) => g.value === ref.generator)?.label}`;
    case 'solid':
      return `Color ${ref.color}`;
    case 'testpattern':
      return 'Patrón de prueba';
    case 'text':
      return `Texto: ${ref.text.slice(0, 20)}`;
    case 'drawing':
      return `Dibujo: ${p.drawings.find((d) => d.id === ref.drawingId)?.name ?? '?'}`;
    case 'composition':
      return ref.compId === 'program' ? 'PROGRAM (mezcla)' : ref.compId === 'preview' ? 'PREVIEW' : `Escena: ${p.compositions.find((c) => c.id === ref.compId)?.name ?? '?'}`;
    case 'tracking':
      return `Tracking: ${TRACKING_VISUALS.find((t) => t.value === ref.style)?.label}`;
  }
}

/** Picks any source: media, camera, generator, color, test pattern, text, drawing, scene, tracking visual. */
export function SourcePicker({ value, onChange, allowComps = true, excludeComp }: { value: SourceRef; onChange: (r: SourceRef) => void; allowComps?: boolean; excludeComp?: string }) {
  const s = useShow();
  const p = s.project;
  const opts: { value: string; label: string; ref: SourceRef }[] = [{ value: 'none', label: '— Nada —', ref: { type: 'none' } }];
  if (allowComps) {
    opts.push({ value: 'comp:program', label: 'PROGRAM (mezcla A/B)', ref: { type: 'composition', compId: 'program' } });
    opts.push({ value: 'comp:preview', label: 'PREVIEW (deck B)', ref: { type: 'composition', compId: 'preview' } });
    for (const c of p.compositions) if (c.id !== excludeComp) opts.push({ value: `comp:${c.id}`, label: `Escena: ${c.name}`, ref: { type: 'composition', compId: c.id } });
  }
  for (const m of p.media) if (m.kind === 'video' || m.kind === 'image') opts.push({ value: `media:${m.id}`, label: `${m.kind === 'video' ? '🎞' : '🖼'} ${m.name}`, ref: { type: 'media', mediaId: m.id } });
  for (const c of p.cameras) opts.push({ value: `camera:${c.id}`, label: `📷 ${c.name}`, ref: { type: 'camera', cameraId: c.id } });
  for (const d of p.drawings) opts.push({ value: `drawing:${d.id}`, label: `✏ ${d.name}`, ref: { type: 'drawing', drawingId: d.id } });
  for (const g of GENERATORS) opts.push({ value: `gen:${g.value}`, label: `◆ ${g.label}`, ref: { type: 'generator', generator: g.value, colorA: '#19c3ff', colorB: '#ff2d95' } });
  for (const t of TRACKING_VISUALS) opts.push({ value: `trk:${t.value}`, label: `🧍 Tracking: ${t.label}`, ref: { type: 'tracking', style: t.value } });
  opts.push({ value: 'test', label: 'Patrón de prueba', ref: { type: 'testpattern' } });
  opts.push({ value: 'solid', label: 'Color sólido', ref: { type: 'solid', color: '#ffffff' } });
  opts.push({ value: 'text', label: 'Texto', ref: { type: 'text', text: 'LUJAN MAPPING', font: 'Segoe UI', size: 120, color: '#ffffff' } });
  const key = refKey(value);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
      <select
        value={key}
        onChange={(e) => {
          const o = opts.find((x) => x.value === e.target.value);
          if (o) onChange(o.ref);
        }}
      >
        {!opts.some((o) => o.value === key) && <option value={key}>{sourceLabel(value, s)}</option>}
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {value.type === 'generator' && (
        <div className="row">
          <span className="lbl">Colores</span>
          <ColorInput value={value.colorA} onChange={(c) => onChange({ ...value, colorA: c })} />
          <ColorInput value={value.colorB} onChange={(c) => onChange({ ...value, colorB: c })} />
        </div>
      )}
      {value.type === 'solid' && (
        <div className="row">
          <span className="lbl">Color</span>
          <ColorInput value={value.color} onChange={(c) => onChange({ ...value, color: c })} />
        </div>
      )}
      {value.type === 'text' && (
        <>
          <TextInput value={value.text} onChange={(t) => onChange({ ...value, text: t })} />
          <div className="row">
            <ColorInput value={value.color} onChange={(c) => onChange({ ...value, color: c })} />
            <Slider value={value.size} min={10} max={600} step={1} label="Tamaño" onChange={(v) => onChange({ ...value, size: v })} />
          </div>
        </>
      )}
      {value.type === 'tracking' && p.cameras.length > 1 && (
        <Select value={value.cameraId ?? ''} options={[{ value: '', label: 'Cámara de tracking' }, ...p.cameras.map((c) => ({ value: c.id, label: c.name }))]} onChange={(v) => onChange({ ...value, cameraId: v || undefined })} />
      )}
    </div>
  );
}

function refKey(r: SourceRef): string {
  switch (r.type) {
    case 'composition':
      return `comp:${r.compId}`;
    case 'media':
      return `media:${r.mediaId}`;
    case 'camera':
      return `camera:${r.cameraId}`;
    case 'drawing':
      return `drawing:${r.drawingId}`;
    case 'generator':
      return `gen:${r.generator}`;
    case 'tracking':
      return `trk:${r.style}`;
    case 'testpattern':
      return 'test';
    default:
      return r.type;
  }
}

/** Effect chain editor: add/remove/reorder; every parameter is a learnable engine param. */
export function EffectsEditor({ effects, onChange }: { effects: EffectInstance[]; onChange: (fx: EffectInstance[]) => void }) {
  const [adding, setAdding] = useState<EffectKind>('glow');
  return (
    <div>
      <div className="row">
        <Select value={adding} options={EFFECT_LIST.map((e) => ({ value: e.kind, label: `${e.label} · ${e.category}` }))} onChange={setAdding} />
        <button className="btn sm" onClick={() => onChange([...effects, createEffect(adding)])}>
          <Icon name="plus" /> Añadir
        </button>
      </div>
      {effects.length === 0 && <div className="hint">Sin efectos. Todos los efectos se procesan en la GPU.</div>}
      {effects.map((fx, i) => (
        <div key={fx.id} style={{ border: '1px solid var(--line)', borderRadius: 6, padding: 6, margin: '6px 0', background: 'var(--bg3)' }}>
          <div className="row">
            <b style={{ flex: 1 }}>{EFFECTS[fx.kind].label}</b>
            <button className="btn icon sm" title="Subir" disabled={i === 0} onClick={() => onChange(swap(effects, i, i - 1))}>
              <Icon name="up" />
            </button>
            <button className="btn icon sm" title="Bajar" disabled={i === effects.length - 1} onClick={() => onChange(swap(effects, i, i + 1))}>
              <Icon name="down" />
            </button>
            <button className="btn icon sm" title="Eliminar" onClick={() => onChange(effects.filter((x) => x.id !== fx.id))}>
              <Icon name="trash" />
            </button>
          </div>
          <ParamToggle id={effectParamId(fx.id, 'enabled')} label="Activo" />
          {EFFECTS[fx.kind].params.map((pd) => (
            <ParamSlider key={pd.name} id={effectParamId(fx.id, pd.name)} label={pd.label} />
          ))}
        </div>
      ))}
    </div>
  );
}

function swap<T>(a: T[], i: number, j: number): T[] {
  const b = [...a];
  [b[i], b[j]] = [b[j], b[i]];
  return b;
}

/** Mask list (shape points are edited on the canvas in the Mapping editor). */
export function MasksEditor({ masks, onChange, onEditPoints, editing }: { masks: Mask[]; onChange: (m: Mask[]) => void; onEditPoints?: (id: string | null) => void; editing?: string | null }) {
  const [shape, setShape] = useState<MaskShape>('rectangle');
  const upd = (id: string, patch: Partial<Mask>) => onChange(masks.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  return (
    <div>
      <div className="row">
        <Select
          value={shape}
          options={[
            { value: 'rectangle', label: 'Rectángulo' },
            { value: 'ellipse', label: 'Círculo / elipse' },
            { value: 'polygon', label: 'Polígono' },
            { value: 'freehand', label: 'Trazo libre' },
          ]}
          onChange={setShape}
        />
        <button className="btn sm" onClick={() => onChange([...masks, createMask(shape)])}>
          <Icon name="plus" /> Máscara
        </button>
      </div>
      {masks.map((m) => (
        <div key={m.id} style={{ border: '1px solid var(--line)', borderRadius: 6, padding: 6, margin: '6px 0' }}>
          <div className="row">
            <Check checked={m.enabled} onChange={(v) => upd(m.id, { enabled: v })} label={m.name} />
            <span className="spacer" />
            {onEditPoints && (
              <button className={`btn sm ${editing === m.id ? 'on' : ''}`} onClick={() => onEditPoints(editing === m.id ? null : m.id)}>
                Editar forma
              </button>
            )}
            <button className="btn icon sm" onClick={() => onChange(masks.filter((x) => x.id !== m.id))}>
              <Icon name="trash" />
            </button>
          </div>
          <div className="row">
            <Check checked={m.inverted} onChange={(v) => upd(m.id, { inverted: v })} label="Invertir" />
          </div>
          <div className="row">
            <Slider value={m.feather} min={0} max={0.2} label="Suavizado" onChange={(v) => upd(m.id, { feather: v })} />
          </div>
          <div className="row">
            <Slider value={m.opacity} min={0} max={1} label="Opacidad" onChange={(v) => upd(m.id, { opacity: v })} />
          </div>
        </div>
      ))}
    </div>
  );
}

export { Section };
