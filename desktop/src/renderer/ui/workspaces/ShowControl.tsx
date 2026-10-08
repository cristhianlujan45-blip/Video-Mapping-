import { useEffect, useRef, useState } from 'react';
import type { Action, AutomationLane, Condition, ConditionOp, Cue, Macro, Rule } from '../../../shared/project/model';
import { uid } from '../../../shared/project/model';
import { createCue } from '../../../shared/project/defaults';
import { describeAction } from '../../../shared/show/rules';
import { evalLane, setKey } from '../../../shared/show/timeline';
import { FEATURE_LABELS } from '../../../shared/tracking/pose';
import { formatTimecode } from '../../../shared/midi/midi';
import { useShow, useTicker } from '../hooks';
import { Icon } from '../icons';
import { Check, Field, LearnButton, NumberInput, Section, Select, Tabs, TextInput, TriggerButton } from '../controls';
import { replaceById } from '../../core/store';
import { TRANSITIONS } from './Vj';
import { MappingTable } from './Midi';
import { lujan } from '../../api';

type Tab = 'cues' | 'timeline' | 'macros' | 'rules' | 'keys';

export function ShowWorkspace() {
  const [tab, setTab] = useState<Tab>('cues');
  return (
    <div className="col" style={{ flex: 1 }}>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'cues', label: 'Cues' },
          { id: 'timeline', label: 'Timeline y automatización' },
          { id: 'macros', label: 'Macros' },
          { id: 'rules', label: 'Reglas / disparadores' },
          { id: 'keys', label: 'Teclado y atajos' },
        ]}
      />
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 10 }}>
        {tab === 'cues' && <Cues />}
        {tab === 'timeline' && <TimelinePanel />}
        {tab === 'macros' && <Macros />}
        {tab === 'rules' && <Rules />}
        {tab === 'keys' && <Keys />}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ action editor (shared)

export function ActionEditor({ value, onChange }: { value: Action; onChange: (a: Action) => void }) {
  const s = useShow();
  const p = s.project;
  const params = s.engine.list();
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
      <Select
        value={value.type}
        style={{ maxWidth: 140 }}
        options={[
          { value: 'set', label: 'Fijar parámetro' },
          { value: 'ramp', label: 'Rampa a valor' },
          { value: 'trigger', label: 'Disparar trigger' },
          { value: 'scene', label: 'Escena' },
          { value: 'cue', label: 'Cue' },
          { value: 'macro', label: 'Macro' },
          { value: 'dmxSnapshot', label: 'Snapshot DMX' },
          { value: 'blackout', label: 'Blackout' },
          { value: 'transport', label: 'Transporte' },
        ]}
        onChange={(t) => onChange(defaultAction(t, s))}
      />
      {(value.type === 'set' || value.type === 'ramp' || value.type === 'trigger') && (
        <Select value={value.param} style={{ maxWidth: 220 }} options={params.filter((x) => (value.type === 'trigger' ? x.type === 'trigger' : x.type !== 'trigger')).map((x) => ({ value: x.id, label: x.name }))} onChange={(v) => onChange({ ...value, param: v })} />
      )}
      {(value.type === 'set' || value.type === 'ramp') && <NumberInput value={value.value} step={0.01} onChange={(v) => onChange({ ...value, value: v })} />}
      {value.type === 'ramp' && (
        <>
          <NumberInput value={value.durationMs} min={0} step={100} onChange={(v) => onChange({ ...value, durationMs: v })} />
          <span className="small muted">ms</span>
        </>
      )}
      {value.type === 'scene' && <Select value={value.compId} style={{ maxWidth: 180 }} options={p.compositions.map((c) => ({ value: c.id, label: c.name }))} onChange={(v) => onChange({ ...value, compId: v })} />}
      {value.type === 'cue' && <Select value={value.cueId} style={{ maxWidth: 180 }} options={p.cues.map((c) => ({ value: c.id, label: c.name }))} onChange={(v) => onChange({ ...value, cueId: v })} />}
      {value.type === 'macro' && <Select value={value.macroId} style={{ maxWidth: 180 }} options={p.macros.map((c) => ({ value: c.id, label: c.name }))} onChange={(v) => onChange({ ...value, macroId: v })} />}
      {value.type === 'dmxSnapshot' && <Select value={value.snapshotId} style={{ maxWidth: 180 }} options={p.dmx.snapshots.map((c) => ({ value: c.id, label: c.name }))} onChange={(v) => onChange({ ...value, snapshotId: v })} />}
      {value.type === 'blackout' && <Select value={value.on ? '1' : '0'} style={{ maxWidth: 100 }} options={[{ value: '1', label: 'Activar' }, { value: '0', label: 'Quitar' }]} onChange={(v) => onChange({ ...value, on: v === '1' })} />}
      {value.type === 'transport' && (
        <Select
          value={value.command}
          style={{ maxWidth: 120 }}
          options={[
            { value: 'play', label: 'Play' },
            { value: 'pause', label: 'Pausa' },
            { value: 'stop', label: 'Stop' },
            { value: 'next', label: 'Siguiente' },
            { value: 'previous', label: 'Anterior' },
          ]}
          onChange={(v) => onChange({ ...value, command: v })}
        />
      )}
    </span>
  );
}

function defaultAction(t: Action['type'], s: ReturnType<typeof useShow>): Action {
  const p = s.project;
  switch (t) {
    case 'set':
      return { type: 'set', param: 'master.brightness', value: 1 };
    case 'ramp':
      return { type: 'ramp', param: 'master.brightness', value: 0, durationMs: 1000 };
    case 'trigger':
      return { type: 'trigger', param: 'show.next' };
    case 'scene':
      return { type: 'scene', compId: p.compositions[0]?.id ?? '' };
    case 'cue':
      return { type: 'cue', cueId: p.cues[0]?.id ?? '' };
    case 'macro':
      return { type: 'macro', macroId: p.macros[0]?.id ?? '' };
    case 'dmxSnapshot':
      return { type: 'dmxSnapshot', snapshotId: p.dmx.snapshots[0]?.id ?? '' };
    case 'blackout':
      return { type: 'blackout', on: true };
    case 'transport':
      return { type: 'transport', command: 'play' };
  }
}

// ------------------------------------------------------------------ cues

function Cues() {
  const s = useShow();
  const p = s.project;
  const upd = (id: string, fn: (c: Cue) => Cue) => s.update((pr) => ({ ...pr, cues: replaceById(pr.cues, id, fn) }));
  return (
    <>
      <div className="row">
        <button className="btn primary" onClick={() => s.update((pr) => ({ ...pr, cues: [...pr.cues, createCue(`Cue ${pr.cues.length + 1}`, pr.mixer.deckA)] }))}>
          <Icon name="plus" /> Cue
        </button>
        <TriggerButton id="show.previous" label="◀ Anterior" />
        <TriggerButton id="show.next" label="GO ▶" className="primary" />
        <span className="small muted">Cue actual: {s.currentCue?.name ?? '—'}</span>
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>#</th>
            <th>Nombre</th>
            <th>Escena</th>
            <th>Transición</th>
            <th>ms</th>
            <th>Snapshot DMX</th>
            <th>Macro</th>
            <th>Auto-follow (ms)</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {p.cues.map((c, i) => (
            <tr key={c.id} style={{ background: s.currentCue?.id === c.id ? 'rgba(25,195,255,.12)' : undefined }}>
              <td>{i + 1}</td>
              <td>
                <TextInput value={c.name} onChange={(v) => upd(c.id, (x) => ({ ...x, name: v }))} />
              </td>
              <td>
                <Select value={c.compId ?? ''} style={{ maxWidth: 150 }} options={[{ value: '', label: '—' }, ...p.compositions.map((x) => ({ value: x.id, label: x.name }))]} onChange={(v) => upd(c.id, (x) => ({ ...x, compId: v || null }))} />
              </td>
              <td>
                <Select value={c.transition.kind} style={{ maxWidth: 110 }} options={TRANSITIONS} onChange={(v) => upd(c.id, (x) => ({ ...x, transition: { ...x.transition, kind: v } }))} />
              </td>
              <td>
                <NumberInput width={64} value={c.transition.durationMs} min={0} step={100} onChange={(v) => upd(c.id, (x) => ({ ...x, transition: { ...x.transition, durationMs: v } }))} />
              </td>
              <td>
                <Select value={c.dmxSnapshotId ?? ''} style={{ maxWidth: 130 }} options={[{ value: '', label: '—' }, ...p.dmx.snapshots.map((x) => ({ value: x.id, label: x.name }))]} onChange={(v) => upd(c.id, (x) => ({ ...x, dmxSnapshotId: v || null }))} />
              </td>
              <td>
                <Select value={c.macroId ?? ''} style={{ maxWidth: 130 }} options={[{ value: '', label: '—' }, ...p.macros.map((x) => ({ value: x.id, label: x.name }))]} onChange={(v) => upd(c.id, (x) => ({ ...x, macroId: v || null }))} />
              </td>
              <td>
                <NumberInput width={70} value={c.followMs ?? 0} min={0} step={500} onChange={(v) => upd(c.id, (x) => ({ ...x, followMs: v > 0 ? v : null }))} />
              </td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button className="btn sm primary" onClick={() => s.goCue(c.id)}>
                  GO
                </button>
                <LearnButton param={`cue.${c.id}.go`} />
                <button className="btn icon sm" onClick={() => s.update((pr) => ({ ...pr, cues: pr.cues.filter((x) => x.id !== c.id) }))}>
                  <Icon name="trash" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

// ------------------------------------------------------------------ timeline

function TimelinePanel() {
  const s = useShow();
  useTicker(50);
  const p = s.project;
  const tl = p.timeline;
  const [addParam, setAddParam] = useState('master.brightness');
  const setTl = (fn: (t: typeof tl) => typeof tl) => s.update((pr) => ({ ...pr, timeline: fn(pr.timeline) }));
  const audioMedia = p.media.filter((m) => m.kind === 'audio');
  const soundtrack = audioMedia.find((m) => m.id === tl.audioMediaId);

  // soundtrack follows the playhead (resync when drift > 60 ms)
  useEffect(() => {
    if (!soundtrack) return;
    const el = s.media.audioElement(soundtrack);
    const h = setInterval(() => {
      if (s.timeline.playing) {
        if (el.paused) void el.play();
        if (Math.abs(el.currentTime - s.timeline.time) > 0.06) el.currentTime = s.timeline.time;
      } else if (!el.paused) el.pause();
    }, 50);
    return () => {
      clearInterval(h);
      el.pause();
    };
  }, [s, soundtrack]);

  return (
    <>
      <div className="row">
        <button className={`btn ${s.timeline.playing ? 'on' : ''}`} onClick={() => (s.timeline.playing ? s.timeline.pause() : s.timeline.play())}>
          {s.timeline.playing ? '❚❚ Pausa' : '▶ Play'}
        </button>
        <button className="btn" onClick={() => s.timeline.stop()}>
          ■ Stop
        </button>
        <button className={`btn ${s.recorder.armed ? 'danger on' : ''}`} onClick={() => s.toggleRecord()}>
          ● {s.recorder.armed ? 'Detener grabación' : 'Grabar automatización'}
        </button>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 18 }}>{formatTimecode(s.timeline.time, p.sync.timecodeFps)}</span>
        <span className="small muted">fuente: {p.sync.source}</span>
        <span className="spacer" />
        <Field label="Duración (s)">
          <NumberInput value={tl.durationSec} min={1} max={36000} onChange={(v) => setTl((t) => ({ ...t, durationSec: v }))} />
        </Field>
        <Check checked={tl.loop} onChange={(v) => setTl((t) => ({ ...t, loop: v }))} label="Bucle" />
        <Select value={tl.audioMediaId ?? ''} style={{ maxWidth: 200 }} options={[{ value: '', label: 'Sin banda sonora' }, ...audioMedia.map((m) => ({ value: m.id, label: `♪ ${m.name}` }))]} onChange={(v) => setTl((t) => ({ ...t, audioMediaId: v || null }))} />
      </div>
      <Ruler />
      {tl.lanes.map((lane) => (
        <LaneRow key={lane.id} lane={lane} onChange={(l) => setTl((t) => ({ ...t, lanes: replaceById(t.lanes, lane.id, () => l) }))} onDelete={() => setTl((t) => ({ ...t, lanes: t.lanes.filter((x) => x.id !== lane.id) }))} />
      ))}
      <div className="row" style={{ marginTop: 8 }}>
        <Select value={addParam} style={{ maxWidth: 280 }} options={s.engine.list().filter((x) => x.type !== 'trigger').map((x) => ({ value: x.id, label: x.name }))} onChange={setAddParam} />
        <button className="btn sm" onClick={() => setTl((t) => ({ ...t, lanes: [...t.lanes, { id: uid('lane'), param: addParam, enabled: true, keys: [] }] }))}>
          + Carril de automatización
        </button>
        <button className="btn sm" onClick={() => setTl((t) => ({ ...t, markers: [...t.markers, { id: uid('mk'), t: s.timeline.time, name: `Marca ${t.markers.length + 1}`, cueId: p.cues[0]?.id ?? null }] }))}>
          + Marcador (cue) en el playhead
        </button>
      </div>
      <Section title="Marcadores → cues">
        {tl.markers.map((m) => (
          <div className="row" key={m.id}>
            <NumberInput value={m.t} step={0.1} min={0} onChange={(v) => setTl((t) => ({ ...t, markers: replaceById(t.markers, m.id, (x) => ({ ...x, t: v })) }))} />
            <TextInput value={m.name} onChange={(v) => setTl((t) => ({ ...t, markers: replaceById(t.markers, m.id, (x) => ({ ...x, name: v })) }))} />
            <Select value={m.cueId ?? ''} style={{ maxWidth: 180 }} options={[{ value: '', label: '—' }, ...p.cues.map((c) => ({ value: c.id, label: c.name }))]} onChange={(v) => setTl((t) => ({ ...t, markers: replaceById(t.markers, m.id, (x) => ({ ...x, cueId: v || null })) }))} />
            <button className="btn icon sm" onClick={() => setTl((t) => ({ ...t, markers: t.markers.filter((x) => x.id !== m.id) }))}>
              <Icon name="trash" />
            </button>
          </div>
        ))}
      </Section>
      <div className="hint">Clic en un carril = nueva llave en ese tiempo/valor · arrastra llaves · Alt+clic borra · Doble clic cambia la curva (lineal / suave / mantener). La grabación captura los movimientos de MIDI, OSC, DMX, tracking, audio y la interfaz como carriles editables.</div>
    </>
  );
}

function Ruler() {
  const s = useShow();
  const tl = s.project.timeline;
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      style={{ position: 'relative', height: 22, background: 'var(--bg3)', borderRadius: 4, marginLeft: 220, cursor: 'pointer' }}
      onPointerDown={(e) => {
        const r = ref.current!.getBoundingClientRect();
        s.timeline.seek(((e.clientX - r.left) / r.width) * tl.durationSec);
      }}
    >
      {Array.from({ length: 11 }, (_, i) => (
        <span key={i} className="small muted" style={{ position: 'absolute', left: `${i * 10}%`, top: 3, transform: 'translateX(2px)' }}>
          {Math.round((tl.durationSec * i) / 10)}s
        </span>
      ))}
      {tl.markers.map((m) => (
        <div key={m.id} title={m.name} style={{ position: 'absolute', left: `${(m.t / tl.durationSec) * 100}%`, top: 0, bottom: 0, width: 2, background: 'var(--warn)' }} />
      ))}
      <div style={{ position: 'absolute', left: `${(s.timeline.time / tl.durationSec) * 100}%`, top: -2, bottom: -2, width: 2, background: 'var(--live)' }} />
    </div>
  );
}

function LaneRow({ lane, onChange, onDelete }: { lane: AutomationLane; onChange: (l: AutomationLane) => void; onDelete: () => void }) {
  const s = useShow();
  const tl = s.project.timeline;
  const p = s.engine.get(lane.param);
  const ref = useRef<SVGSVGElement>(null);
  const min = p?.min ?? 0;
  const max = p?.max ?? 1;
  const toX = (t: number) => t / tl.durationSec;
  const toY = (v: number) => 1 - (v - min) / (max - min || 1);
  const pts: string[] = [];
  for (let i = 0; i <= 200; i++) {
    const t = (i / 200) * tl.durationSec;
    const v = evalLane(lane.keys, t);
    if (v !== null) pts.push(`${toX(t)},${toY(v)}`);
  }
  const local = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect();
    return { t: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * tl.durationSec, v: min + (1 - Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))) * (max - min) };
  };
  return (
    <div className="row" style={{ alignItems: 'stretch', margin: '4px 0' }}>
      <div style={{ width: 214, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span className="small" title={lane.param}>{p?.name ?? lane.param}</span>
        <span className="row" style={{ margin: 0 }}>
          <Check checked={lane.enabled} onChange={(v) => onChange({ ...lane, enabled: v })} label="On" />
          <span className="small muted">{lane.keys.length} llaves</span>
          <button className="btn icon sm" onClick={onDelete}>
            <Icon name="trash" />
          </button>
        </span>
      </div>
      <svg
        ref={ref}
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        style={{ flex: 1, height: 60, background: 'var(--bg)', borderRadius: 4, border: '1px solid var(--line)', cursor: 'crosshair' }}
        onPointerDown={(e) => {
          if (e.target !== e.currentTarget) return;
          const { t, v } = local(e);
          onChange(setKey(lane, t, v));
        }}
      >
        <polyline points={pts.join(' ')} fill="none" stroke="var(--accent)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        <line x1={toX(s.timeline.time)} x2={toX(s.timeline.time)} y1={0} y2={1} stroke="var(--live)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {lane.keys.map((k, i) => (
          <ellipse
            key={i}
            cx={toX(k.t)}
            cy={toY(k.v)}
            rx={0.004}
            ry={0.08}
            fill={k.ease === 'hold' ? '#ffcc00' : k.ease === 'smooth' ? '#a07cff' : '#fff'}
            style={{ cursor: 'grab' }}
            onDoubleClick={() => onChange({ ...lane, keys: lane.keys.map((x, j) => (j === i ? { ...x, ease: x.ease === 'linear' ? 'smooth' : x.ease === 'smooth' ? 'hold' : 'linear' } : x)) })}
            onPointerDown={(e) => {
              e.stopPropagation();
              if (e.altKey) {
                onChange({ ...lane, keys: lane.keys.filter((_, j) => j !== i) });
                return;
              }
              (e.target as Element).setPointerCapture(e.pointerId);
              s.beginEdit();
              const move = (ev: PointerEvent) => {
                const { t, v } = local(ev);
                const keys = lane.keys.map((x, j) => (j === i ? { ...x, t, v } : x)).sort((a, b) => a.t - b.t);
                onChange({ ...lane, keys });
              };
              const up = () => {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
                s.commitEdit();
              };
              window.addEventListener('pointermove', move);
              window.addEventListener('pointerup', up);
            }}
          />
        ))}
      </svg>
    </div>
  );
}

// ------------------------------------------------------------------ macros

function Macros() {
  const s = useShow();
  const p = s.project;
  const upd = (id: string, fn: (m: Macro) => Macro) => s.update((pr) => ({ ...pr, macros: replaceById(pr.macros, id, fn) }));
  return (
    <>
      <button className="btn primary" onClick={() => s.update((pr) => ({ ...pr, macros: [...pr.macros, { id: uid('macro'), name: `Macro ${pr.macros.length + 1}`, steps: [] }] }))}>
        <Icon name="plus" /> Macro
      </button>
      {p.macros.map((m) => (
        <div key={m.id} style={{ border: '1px solid var(--line)', borderRadius: 6, padding: 8, margin: '8px 0', background: 'var(--bg2)' }}>
          <div className="row">
            <TextInput value={m.name} onChange={(v) => upd(m.id, (x) => ({ ...x, name: v }))} style={{ maxWidth: 240 }} />
            <TriggerButton id={`macro.${m.id}.run`} label="Ejecutar" className="primary" />
            <span className="small muted">Trigger MIDI/OSC/teclado: aprende sobre «Ejecutar»</span>
            <span className="spacer" />
            <button className="btn icon sm" onClick={() => s.update((pr) => ({ ...pr, macros: pr.macros.filter((x) => x.id !== m.id) }))}>
              <Icon name="trash" />
            </button>
          </div>
          {m.steps.map((st, i) => (
            <div className="row" key={i}>
              <span className="small mono">{i + 1}.</span>
              <span className="small muted">espera</span>
              <NumberInput width={64} value={st.delayMs} min={0} step={100} onChange={(v) => upd(m.id, (x) => ({ ...x, steps: x.steps.map((y, j) => (j === i ? { ...y, delayMs: v } : y)) }))} />
              <span className="small muted">ms →</span>
              <ActionEditor value={st.action} onChange={(a) => upd(m.id, (x) => ({ ...x, steps: x.steps.map((y, j) => (j === i ? { ...y, action: a } : y)) }))} />
              <button className="btn icon sm" onClick={() => upd(m.id, (x) => ({ ...x, steps: x.steps.filter((_, j) => j !== i) }))}>
                <Icon name="trash" />
              </button>
            </div>
          ))}
          <button className="btn sm" onClick={() => upd(m.id, (x) => ({ ...x, steps: [...x.steps, { delayMs: 0, action: { type: 'set', param: 'master.brightness', value: 1 } }] }))}>
            + Paso
          </button>
        </div>
      ))}
      <div className="hint">Ejemplo SHOW START: Escena 1 → salida activa → Play → Snapshot DMX → banda sonora. Un solo botón MIDI puede lanzarla.</div>
    </>
  );
}

// ------------------------------------------------------------------ rules

function Rules() {
  const s = useShow();
  useTicker(500);
  const p = s.project;
  const upd = (id: string, fn: (r: Rule) => Rule) => s.update((pr) => ({ ...pr, rules: replaceById(pr.rules, id, fn) }));
  const featureOptions = [
    ...Object.entries(FEATURE_LABELS).map(([k, v]) => ({ value: k, label: v })),
    ...p.tracking.zones.flatMap((z) => [
      { value: `zone.${z.id}.count`, label: `Zona «${z.name}»: personas` },
      { value: `zone.${z.id}.occupied`, label: `Zona «${z.name}»: ocupada` },
    ]),
  ];
  return (
    <>
      <button className="btn primary" onClick={() => s.update((pr) => ({ ...pr, rules: [...pr.rules, { id: uid('rule'), name: `Regla ${pr.rules.length + 1}`, enabled: true, when: [{ feature: 'tracking.hand.any.raised', op: '>=', value: 1 }], then: [], otherwise: [], cooldownMs: 500, origin: 'user' }] }))}>
        <Icon name="plus" /> Regla
      </button>
      {p.rules.map((r) => (
        <div key={r.id} style={{ border: '1px solid var(--line)', borderRadius: 6, padding: 8, margin: '8px 0', background: 'var(--bg2)' }}>
          <div className="row">
            <Check checked={r.enabled} onChange={(v) => upd(r.id, (x) => ({ ...x, enabled: v }))} label="" />
            <TextInput value={r.name} onChange={(v) => upd(r.id, (x) => ({ ...x, name: v }))} style={{ maxWidth: 260 }} />
            {r.origin === 'ai' && <span className="badge">IA</span>}
            <span className={`badge ${s.rules.isActive(r.id) ? 'ok' : ''}`}>{s.rules.isActive(r.id) ? 'ACTIVA' : 'en espera'}</span>
            <span className="small muted">cooldown</span>
            <NumberInput width={64} value={r.cooldownMs} min={0} step={100} onChange={(v) => upd(r.id, (x) => ({ ...x, cooldownMs: v }))} />
            <span className="spacer" />
            <button className="btn icon sm" onClick={() => s.update((pr) => ({ ...pr, rules: pr.rules.filter((x) => x.id !== r.id) }))}>
              <Icon name="trash" />
            </button>
          </div>
          <div className="small muted">CUANDO</div>
          {r.when.map((c, i) => (
            <div className="row" key={i}>
              <Select value={c.feature} style={{ maxWidth: 260 }} options={featureOptions.some((o) => o.value === c.feature) ? featureOptions : [{ value: c.feature, label: c.feature }, ...featureOptions]} onChange={(v) => upd(r.id, (x) => ({ ...x, when: x.when.map((y, j) => (j === i ? { ...y, feature: v } : y)) }))} />
              <Select<ConditionOp> value={c.op} style={{ maxWidth: 110 }} options={(['>', '>=', '<', '<=', '==', '!=', 'rising', 'falling'] as ConditionOp[]).map((o) => ({ value: o, label: o === 'rising' ? 'cruza ↑' : o === 'falling' ? 'cruza ↓' : o }))} onChange={(v) => upd(r.id, (x) => ({ ...x, when: x.when.map((y, j) => (j === i ? { ...y, op: v } : y)) }))} />
              <NumberInput value={c.value} step={0.1} onChange={(v) => upd(r.id, (x) => ({ ...x, when: x.when.map((y, j) => (j === i ? { ...y, value: v } : y)) }))} />
              <span className="small muted">ahora: {s.bus.get(c.feature).toFixed(2)}</span>
              <button className="btn icon sm" onClick={() => upd(r.id, (x) => ({ ...x, when: x.when.filter((_, j) => j !== i) }))}>
                <Icon name="trash" />
              </button>
            </div>
          ))}
          <button className="btn sm" onClick={() => upd(r.id, (x) => ({ ...x, when: [...x.when, { feature: 'tracking.person.count', op: '>=', value: 2 } as Condition] }))}>
            + condición (Y)
          </button>
          <div className="small muted" style={{ marginTop: 6 }}>ENTONCES</div>
          <ActionList actions={r.then} onChange={(a) => upd(r.id, (x) => ({ ...x, then: a }))} />
          <div className="small muted" style={{ marginTop: 6 }}>AL DEJAR DE CUMPLIRSE</div>
          <ActionList actions={r.otherwise} onChange={(a) => upd(r.id, (x) => ({ ...x, otherwise: a }))} />
        </div>
      ))}
    </>
  );
}

function ActionList({ actions, onChange }: { actions: Action[]; onChange: (a: Action[]) => void }) {
  const s = useShow();
  return (
    <>
      {actions.map((a, i) => (
        <div className="row" key={i}>
          <ActionEditor value={a} onChange={(n) => onChange(actions.map((x, j) => (j === i ? n : x)))} />
          <span className="small muted">{describeAction(a, { param: (id) => s.engine.get(id)?.name ?? id, comp: (id) => s.project.compositions.find((c) => c.id === id)?.name ?? id })}</span>
          <button className="btn icon sm" onClick={() => onChange(actions.filter((_, j) => j !== i))}>
            <Icon name="trash" />
          </button>
        </div>
      ))}
      <button className="btn sm" onClick={() => onChange([...actions, { type: 'set', param: 'master.brightness', value: 1 }])}>
        + acción
      </button>
    </>
  );
}

// ------------------------------------------------------------------ keyboard / shortcuts

const SHORTCUT_LABELS: Record<string, string> = {
  front: 'Vista frontal (Ctrl = trasera)',
  right: 'Vista derecha (Ctrl = izquierda)',
  top: 'Vista superior (Ctrl = inferior)',
  persp: 'Perspectiva / ortográfica',
  projector: 'Ver desde proyector',
  focus: 'Centrar selección',
  grab: 'Mover (grab)',
  rotate: 'Rotar',
  scale: 'Escalar',
};

function Keys() {
  const s = useShow();
  const [map, setMap] = useState<Record<string, string>>({});
  const [waiting, setWaiting] = useState<string | null>(null);
  useEffect(() => {
    void lujan?.invoke<{ shortcuts: Record<string, string> }>('settings:get').then((x) => setMap({ front: 'Numpad1', right: 'Numpad3', top: 'Numpad7', persp: 'Numpad5', projector: 'Numpad0', focus: 'NumpadDecimal', grab: 'KeyG', rotate: 'KeyR', scale: 'KeyS', ...(x.shortcuts ?? {}) }));
  }, []);
  useEffect(() => {
    if (!waiting) return;
    const h = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const next = { ...map, [waiting]: e.code };
      setMap(next);
      setWaiting(null);
      void lujan?.invoke('settings:set', { shortcuts: next });
      s.render.send({ type: 'shortcuts', map: next });
    };
    window.addEventListener('keydown', h, { capture: true, once: true });
    return () => window.removeEventListener('keydown', h, { capture: true });
  }, [waiting, map, s]);
  return (
    <>
      <Section title="Atajos de la vista 3D (configurables)">
        <table className="tbl">
          <tbody>
            {Object.entries(SHORTCUT_LABELS).map(([k, label]) => (
              <tr key={k}>
                <td>{label}</td>
                <td className="mono">{map[k]}</td>
                <td>
                  <button className={`btn sm ${waiting === k ? 'learn armed' : ''}`} onClick={() => setWaiting(k)}>
                    {waiting === k ? 'Pulsa una tecla…' : 'Cambiar'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      <Section title="Teclado → parámetros / triggers">
        <div className="hint">Cualquier tecla puede controlar un parámetro o trigger: usa el botón learn del parámetro y pulsa la tecla. Atajos fijos: Espacio play/pausa · Mayús+B blackout · Ctrl+S/O/Z/Y.</div>
        <MappingTable kinds={['keyboard']} compact />
      </Section>
    </>
  );
}
