import type { BlendMode, Composition, Layer, TransitionKind } from '../../../shared/project/model';
import { BLEND_MODES } from '../../../shared/project/model';
import { createLayer } from '../../../shared/project/defaults';
import { useShow } from '../hooks';
import { Icon } from '../icons';
import { Check, Field, LearnButton, NumberInput, ParamSlider, ParamToggle, Section, Select, Slider, TextInput, TriggerButton } from '../controls';
import { ViewCanvas } from '../ViewCanvas';
import { EffectsEditor, MasksEditor, SourcePicker } from '../shared';
import { moveItem, replaceById } from '../../core/store';
import { importFromDialog, useDropImport } from './Media';

export const TRANSITIONS: { value: TransitionKind; label: string }[] = [
  { value: 'cut', label: 'Corte' },
  { value: 'fade', label: 'Fundido' },
  { value: 'dissolve', label: 'Disolución' },
  { value: 'wipe', label: 'Barrido' },
  { value: 'flash', label: 'Flash' },
  { value: 'glitch', label: 'Glitch' },
  { value: 'zoom', label: 'Zoom' },
  { value: 'slide', label: 'Deslizar' },
];

const BLEND_LABEL: Record<BlendMode, string> = {
  normal: 'Normal',
  add: 'Sumar',
  screen: 'Trama',
  multiply: 'Multiplicar',
  overlay: 'Superponer',
  difference: 'Diferencia',
  lighten: 'Aclarar',
  darken: 'Oscurecer',
  subtract: 'Restar',
  exclusion: 'Exclusión',
};

export function MixerBar() {
  const s = useShow();
  const p = s.project;
  return (
    <div className="mixerbar">
      <Select value={p.mixer.transition.kind} options={TRANSITIONS} style={{ maxWidth: 130 }} onChange={(k) => s.update((pr) => ({ ...pr, mixer: { ...pr.mixer, transition: { ...pr.mixer.transition, kind: k } } }))} />
      <span className="small muted">ms</span>
      <NumberInput value={p.mixer.transition.durationMs} min={0} max={20000} step={100} onChange={(v) => s.update((pr) => ({ ...pr, mixer: { ...pr.mixer, transition: { ...pr.mixer.transition, durationMs: v } } }))} />
      <TriggerButton id="show.cut" label="CUT" />
      <TriggerButton id="show.take" label="TAKE / AUTO" className="primary" />
      <div className="xfader">
        <ParamSlider id="mixer.crossfade" label="Crossfader A ⇄ B" />
      </div>
      {s.ui.transition && <span className="badge warn">Transición {Math.round((s.transitionProgress() ?? 0) * 100)}%</span>}
    </div>
  );
}

export function VjWorkspace() {
  const s = useShow();
  const p = s.project;
  const comp = p.compositions.find((c) => c.id === s.ui.selectedComp) ?? p.compositions[0];
  const layer = comp?.layers.find((l) => l.id === s.ui.selectedLayer) ?? null;
  const drop = useDropImport(comp?.id);

  return (
    <div className="cols">
      <div className="vj" {...drop}>
        <div className="monitors">
          <ViewCanvas spec={{ kind: 'preview' }} label={`Preview · ${p.compositions.find((c) => c.id === p.mixer.deckB)?.name ?? '—'}`} labelClass="preview" />
          <ViewCanvas spec={{ kind: 'program' }} label={`Program · ${p.compositions.find((c) => c.id === p.mixer.deckA)?.name ?? '—'}`} labelClass="program" />
        </div>
        <MixerBar />
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) minmax(260px, 340px)', gap: 8, minHeight: 0 }}>
          <div className="panel" style={{ border: '1px solid var(--line)', borderRadius: 6 }}>
            <div className="panel-title">
              Escenas
              <span className="spacer" />
              <button className="btn sm" onClick={() => s.newScene()}>
                <Icon name="plus" /> Escena
              </button>
            </div>
            <div className="panel-body">
              <div className="clip-grid">
                {p.compositions.map((c) => (
                  <SceneClip key={c.id} comp={c} />
                ))}
              </div>
              <div className="hint">Clic: llevar a Program con la transición · Clic derecho: cargar en Preview · Doble clic: editar capas</div>
            </div>
          </div>
          {comp && <LayersPanel comp={comp} />}
        </div>
      </div>
      <div className="panel right" style={{ width: 340 }}>
        <div className="panel-title">{layer ? `Capa: ${layer.name}` : comp ? `Escena: ${comp.name}` : 'Inspector'}</div>
        <div className="panel-body">{layer && comp ? <LayerInspector comp={comp} layer={layer} /> : comp ? <CompInspector comp={comp} /> : null}</div>
      </div>
    </div>
  );
}

function SceneClip({ comp }: { comp: Composition }) {
  const s = useShow();
  const p = s.project;
  const cls = comp.id === p.mixer.deckA ? 'program' : comp.id === p.mixer.deckB ? 'preview' : '';
  return (
    <div
      className={`clip ${cls}`}
      onClick={() => {
        s.ui.selectedComp = comp.id;
        s.goScene(comp.id);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        s.ui.selectedComp = comp.id;
        s.toPreview(comp.id);
      }}
      onDoubleClick={() => {
        s.ui.selectedComp = comp.id;
        s.ui.selectedLayer = null;
        s.emit();
      }}
      style={{ outline: s.ui.selectedComp === comp.id ? '1px dashed var(--fg3)' : undefined }}
    >
      <ViewCanvas spec={{ kind: 'composition', target: comp.id, everyNth: 6 }} style={{ position: 'absolute', inset: 0, border: 0 }} />
      <div className="label">
        {comp.name} <span className="muted small">· {comp.layers.length} capas</span>
      </div>
    </div>
  );
}

function LayersPanel({ comp }: { comp: Composition }) {
  const s = useShow();
  const upd = (fn: (c: Composition) => Composition) => s.update((pr) => ({ ...pr, compositions: replaceById(pr.compositions, comp.id, fn) }));
  return (
    <div className="panel" style={{ border: '1px solid var(--line)', borderRadius: 6 }}>
      <div className="panel-title">
        Capas · {comp.name}
        <span className="spacer" />
        <button className="btn sm" title="Importar medios a esta escena" onClick={() => void importFromDialog(['video', 'image'], comp.id)}>
          <Icon name="plus" /> Medio
        </button>
        <button
          className="btn sm"
          title="Capa generada (shader, color, texto, cámara…)"
          onClick={() => {
            const l = createLayer({ type: 'generator', generator: 'plasma', colorA: '#19c3ff', colorB: '#ff2d95' }, 'Generador');
            upd((c) => ({ ...c, layers: [...c.layers, l] }));
            s.ui.selectedLayer = l.id;
          }}
        >
          <Icon name="plus" /> Capa
        </button>
      </div>
      <div className="panel-body list">
        {comp.layers.length === 0 && <div className="hint">Sin capas. Importa un video o crea una capa generada.</div>}
        {[...comp.layers].reverse().map((l) => {
          const idx = comp.layers.indexOf(l);
          return (
            <div key={l.id} className={`item ${s.ui.selectedLayer === l.id ? 'sel' : ''}`} onClick={() => { s.ui.selectedLayer = l.id; s.ui.selectedComp = comp.id; s.emit(); }}>
              <button className="btn icon sm" title={l.visible ? 'Ocultar' : 'Mostrar'} onClick={(e) => { e.stopPropagation(); s.setParam(`layer.${l.id}.visible`, l.visible ? 0 : 1); }}>
                <Icon name={l.visible ? 'eye' : 'eyeoff'} />
              </button>
              <span className="name">{l.name}</span>
              <span className="acts">
                <button className="btn icon sm" title="Subir" onClick={(e) => { e.stopPropagation(); upd((c) => ({ ...c, layers: moveItem(c.layers, idx, idx + 1) })); }}>
                  <Icon name="up" />
                </button>
                <button className="btn icon sm" title="Bajar" onClick={(e) => { e.stopPropagation(); upd((c) => ({ ...c, layers: moveItem(c.layers, idx, idx - 1) })); }}>
                  <Icon name="down" />
                </button>
                <button className="btn icon sm" title="Duplicar" onClick={(e) => { e.stopPropagation(); upd((c) => ({ ...c, layers: [...c.layers.slice(0, idx + 1), { ...structuredClone(l), id: `${l.id}_c${Date.now().toString(36)}`, name: `${l.name} copia`, effects: l.effects.map((fx) => ({ ...fx, id: `${fx.id}_c${Date.now().toString(36)}` })) }, ...c.layers.slice(idx + 1)] })); }}>
                  <Icon name="copy" />
                </button>
                <button className="btn icon sm" title="Eliminar" onClick={(e) => { e.stopPropagation(); upd((c) => ({ ...c, layers: c.layers.filter((x) => x.id !== l.id) })); }}>
                  <Icon name="trash" />
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function CompInspector({ comp }: { comp: Composition }) {
  const s = useShow();
  const upd = (fn: (c: Composition) => Composition) => s.update((pr) => ({ ...pr, compositions: replaceById(pr.compositions, comp.id, fn) }));
  return (
    <>
      <Section title="Escena">
        <Field label="Nombre">
          <TextInput value={comp.name} onChange={(v) => upd((c) => ({ ...c, name: v }))} />
        </Field>
        <Field label="Resolución">
          <NumberInput value={comp.width} min={16} max={16384} onChange={(v) => upd((c) => ({ ...c, width: v }))} />
          ×
          <NumberInput value={comp.height} min={16} max={16384} onChange={(v) => upd((c) => ({ ...c, height: v }))} />
        </Field>
        <Field label="Fondo">
          <input type="color" value={comp.background} onChange={(e) => upd((c) => ({ ...c, background: e.target.value }))} />
        </Field>
        <Field label="Snapshot DMX">
          <Select value={comp.dmxSnapshotId ?? ''} options={[{ value: '', label: '—' }, ...s.project.dmx.snapshots.map((x) => ({ value: x.id, label: x.name }))]} onChange={(v) => upd((c) => ({ ...c, dmxSnapshotId: v || null }))} />
        </Field>
        <div className="row">
          <TriggerButton id={`comp.${comp.id}.go`} label="→ Program" />
          <TriggerButton id={`comp.${comp.id}.preview`} label="→ Preview" />
          <span className="spacer" />
          <button
            className="btn danger sm"
            disabled={s.project.compositions.length <= 1}
            onClick={() =>
              s.update((pr) => {
                const rest = pr.compositions.filter((c) => c.id !== comp.id);
                return { ...pr, compositions: rest, mixer: { ...pr.mixer, deckA: pr.mixer.deckA === comp.id ? rest[0]?.id ?? null : pr.mixer.deckA, deckB: pr.mixer.deckB === comp.id ? null : pr.mixer.deckB } };
              })
            }
          >
            Eliminar escena
          </button>
        </div>
      </Section>
      <Section title="Efectos de escena (GPU)">
        <EffectsEditor effects={comp.effects} onChange={(fx) => upd((c) => ({ ...c, effects: fx }))} />
      </Section>
    </>
  );
}

export function LayerInspector({ comp, layer }: { comp: Composition; layer: Layer }) {
  const s = useShow();
  const upd = (fn: (l: Layer) => Layer) => s.update((pr) => ({ ...pr, compositions: replaceById(pr.compositions, comp.id, (c) => ({ ...c, layers: replaceById(c.layers, layer.id, fn) })) }));
  const L = layer.id;
  const isVideo = layer.source.type === 'media' && s.project.media.find((m) => m.id === (layer.source as { mediaId: string }).mediaId)?.kind === 'video';
  return (
    <>
      <Section title="Contenido">
        <Field label="Nombre">
          <TextInput value={layer.name} onChange={(v) => upd((l) => ({ ...l, name: v }))} />
        </Field>
        <SourcePicker value={layer.source} excludeComp={comp.id} onChange={(r) => upd((l) => ({ ...l, source: r }))} />
        <div className="row">
          <Check checked={layer.locked} onChange={(v) => upd((l) => ({ ...l, locked: v }))} label="Bloquear" />
          <span className="spacer" />
          <button className="btn sm" onClick={() => { s.ui.selectedLayer = null; s.emit(); }}>
            Ver escena
          </button>
        </div>
      </Section>
      <Section title="Mezcla">
        <ParamSlider id={`layer.${L}.opacity`} label="Opacidad" />
        <ParamToggle id={`layer.${L}.visible`} label="Visible" />
        <Field label="Modo de fusión">
          <Select value={layer.blend} options={BLEND_MODES.map((b) => ({ value: b, label: BLEND_LABEL[b] }))} onChange={(v) => upd((l) => ({ ...l, blend: v }))} />
        </Field>
      </Section>
      <Section title="Transformación">
        <ParamSlider id={`layer.${L}.x`} label="Posición X" />
        <ParamSlider id={`layer.${L}.y`} label="Posición Y" />
        <ParamSlider id={`layer.${L}.scale`} label="Escala" />
        <ParamSlider id={`layer.${L}.rotation`} label="Rotación" />
        <div className="row">
          <Check checked={layer.flipH} onChange={(v) => upd((l) => ({ ...l, flipH: v }))} label="Espejo H" />
          <Check checked={layer.flipV} onChange={(v) => upd((l) => ({ ...l, flipV: v }))} label="Espejo V" />
        </div>
      </Section>
      <Section title="Recorte">
        {(['l', 't', 'r', 'b'] as const).map((k) => (
          <div className="row" key={k}>
            <Slider value={layer.crop[k]} min={0} max={1} def={k === 'l' || k === 't' ? 0 : 1} label={{ l: 'Izquierda', t: 'Arriba', r: 'Derecha', b: 'Abajo' }[k]} onStart={() => s.beginEdit()} onEnd={() => s.commitEdit()} onChange={(v) => upd((l) => ({ ...l, crop: { ...l.crop, [k]: v } }))} />
          </div>
        ))}
      </Section>
      {isVideo && (
        <Section title="Reproducción">
          <Field label="Modo">
            <Select
              value={layer.playback.mode}
              options={[
                { value: 'loop', label: 'Bucle' },
                { value: 'once', label: 'Una vez' },
                { value: 'pingpong', label: 'Ping-pong' },
                { value: 'hold', label: 'Pausado (frame fijo)' },
              ]}
              onChange={(v) => upd((l) => ({ ...l, playback: { ...l.playback, mode: v } }))}
            />
          </Field>
          <ParamSlider id={`layer.${L}.speed`} label="Velocidad" />
          <ParamSlider id={`layer.${L}.volume`} label="Volumen" />
          <Check checked={!layer.playback.muted} onChange={(v) => upd((l) => ({ ...l, playback: { ...l.playback, muted: !v } }))} label="Reproducir audio del video" />
        </Section>
      )}
      <Section title="Máscaras">
        <MasksEditor masks={layer.masks} onChange={(m) => upd((l) => ({ ...l, masks: m }))} />
        <div className="hint">Las formas de máscara se editan con el ratón en Mapping (máscaras de superficie) o con estos controles.</div>
      </Section>
      <Section title="Efectos (GPU)">
        <EffectsEditor effects={layer.effects} onChange={(fx) => upd((l) => ({ ...l, effects: fx }))} />
      </Section>
      <Section title="Ligar a tracking">
        <Field label="Seguir">
          <Select
            value={layer.attach?.feature ?? ''}
            options={[
              { value: '', label: 'No (fijo)' },
              { value: 'hand.right', label: 'Mano derecha' },
              { value: 'hand.left', label: 'Mano izquierda' },
              { value: 'head', label: 'Cabeza' },
              { value: 'center', label: 'Cuerpo' },
            ]}
            onChange={(v) => {
              upd((l) => ({ ...l, attach: v ? { feature: v } : null }));
              if (v) {
                // live binding through the parameter engine: tracking position → layer X/Y
                const fx = v === 'center' ? 'tracking.center' : `tracking.${v}`;
                s.addMapping({ kind: 'tracking', device: 'tracking', control: `${fx}.x` }, `layer.${L}.x`, { min: -0.5, max: 0.5, invert: s.project.tracking.mirror });
                s.addMapping({ kind: 'tracking', device: 'tracking', control: `${fx}.y` }, `layer.${L}.y`, { min: -0.5, max: 0.5 });
              } else {
                for (const m of s.engine.getMappings()) if (m.source.kind === 'tracking' && (m.target === `layer.${L}.x` || m.target === `layer.${L}.y`)) s.engine.removeMapping(m.id);
                s.persistMappings();
              }
            }}
          />
          <LearnButton param={`layer.${L}.x`} />
        </Field>
      </Section>
    </>
  );
}
