import { useEffect, useState } from 'react';
import type { SyncSource } from '../../../shared/project/model';
import { formatTimecode } from '../../../shared/midi/midi';
import { useShow, useTicker } from '../hooks';
import { Field, NumberInput, ParamSlider, Section, Select, Slider, TriggerButton } from '../controls';
import { MappingTable } from './Midi';

const FEATURES = [
  ['rms', 'Volumen (RMS)'],
  ['bass', 'Graves'],
  ['mid', 'Medios'],
  ['treble', 'Agudos'],
  ['beat', 'Beat'],
  ['onset', 'Ataque (onset)'],
] as const;

export function AudioSyncWorkspace() {
  const s = useShow();
  useTicker(66);
  const p = s.project;
  const [inputs, setInputs] = useState<{ deviceId: string; label: string }[]>([]);
  const [feature, setFeature] = useState<(typeof FEATURES)[number][0]>('bass');
  const [target, setTarget] = useState('master.brightness');
  const [range, setRange] = useState<[number, number]>([0, 1]);
  useEffect(() => {
    void s.audio.listInputs().then(setInputs);
  }, [s]);
  const f = s.audio.features;
  const upd = (patch: Partial<typeof p.audio>) => s.update((pr) => ({ ...pr, audio: { ...pr.audio, ...patch } }));
  const params = s.engine.list().filter((x) => x.type !== 'trigger');
  const audioMedia = p.media.filter((m) => m.kind === 'audio');

  return (
    <div className="cols">
      <div className="col" style={{ flex: 1, padding: 10, overflow: 'auto' }}>
        <Section title="Entrada de audio">
          <div className="row">
            <Select value={p.audio.inputDeviceId ?? ''} options={[{ value: '', label: 'Entrada por defecto de Windows' }, ...inputs.map((i) => ({ value: i.deviceId, label: i.label }))]} onChange={(v) => upd({ inputDeviceId: v || null })} />
            <button className={`btn ${s.audio.status === 'live' ? 'on' : 'primary'}`} onClick={() => (s.audio.status === 'live' ? s.audio.stopInput() : void s.audio.startInput(p.audio.inputDeviceId))}>
              {s.audio.status === 'live' ? 'Detener' : 'Escuchar'}
            </button>
          </div>
          {s.audio.status === 'live' && <div className="small muted">Activo: {s.audio.inputLabel}</div>}
          {s.audio.error && <div className="badge err">{s.audio.error}</div>}
          {audioMedia.length > 0 && (
            <div className="row">
              <span className="lbl">Analizar archivo</span>
              {audioMedia.map((m) => (
                <button
                  key={m.id}
                  className="btn sm"
                  onClick={() => {
                    const el = s.media.audioElement(m);
                    s.audio.analyseElement(el);
                    if (el.paused) void el.play();
                    else el.pause();
                  }}
                >
                  ▶/❚❚ {m.name}
                </button>
              ))}
            </div>
          )}
          <div className="hint">El audio del sistema (loopback) está disponible si Windows expone un dispositivo de captura «Mezcla estéreo»/loopback o mediante una interfaz de audio virtual.</div>
        </Section>
        <Section title="Análisis en vivo">
          <div className="kpi">
            {FEATURES.map(([k, label]) => (
              <div className="k" key={k}>
                <div className="t">{label}</div>
                <div className="meter" style={{ marginTop: 6 }}>
                  <div style={{ width: `${Math.round((f?.[k] ?? 0) * 100)}%`, background: k === 'beat' && f?.beat ? 'var(--live)' : undefined }} />
                </div>
              </div>
            ))}
            <div className="k">
              <div className="v">{f?.bpm ? f.bpm.toFixed(1) : '—'}</div>
              <div className="t">BPM detectado</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 80, marginTop: 8, background: 'var(--bg)', padding: 4, borderRadius: 4 }}>
            {Array.from(f?.spectrum ?? new Float32Array(16)).map((v, i) => (
              <div key={i} style={{ flex: 1, height: `${Math.round(v * 100)}%`, background: `hsl(${190 + i * 8} 90% 55%)`, borderRadius: 2 }} />
            ))}
          </div>
          <ParamSlider id="audio.gain" label="Ganancia" />
          <div className="row">
            <Slider value={p.audio.smoothing} min={0} max={0.95} def={0.6} label="Suavizado" onChange={(v) => upd({ smoothing: v })} />
          </div>
          <div className="row">
            <Slider value={p.audio.beatSensitivity} min={1.05} max={3} def={1.4} label="Sensibilidad de beat" onChange={(v) => upd({ beatSensitivity: v })} />
          </div>
          <Field label="Corte graves / agudos (Hz)">
            <NumberInput value={p.audio.bassHz} min={40} max={800} onChange={(v) => upd({ bassHz: v })} />
            <NumberInput value={p.audio.trebleHz} min={1000} max={16000} onChange={(v) => upd({ trebleHz: v })} />
          </Field>
        </Section>
        <Section title="Audio → parámetro">
          <div className="row">
            <Select value={feature} options={FEATURES.map(([k, l]) => ({ value: k, label: l }))} onChange={setFeature} style={{ maxWidth: 160 }} />
            →
            <Select
              value={target}
              options={params.map((x) => ({ value: x.id, label: x.name }))}
              onChange={(v) => {
                setTarget(v);
                const pp = s.engine.get(v);
                if (pp) setRange([pp.min, pp.max]);
              }}
            />
          </div>
          <Field label="Rango">
            <NumberInput value={range[0]} step={0.01} onChange={(v) => setRange([v, range[1]])} />
            <NumberInput value={range[1]} step={0.01} onChange={(v) => setRange([range[0], v])} />
            <button className="btn sm primary" onClick={() => s.addMapping({ kind: 'audio', device: 'audio', control: feature }, target, { min: range[0], max: range[1] })}>
              Crear
            </button>
          </Field>
          <div className="hint">Ejemplos: Graves → escala · Beat → flash (strobe/brillo) · Agudos → partículas · Volumen → brillo · Graves → master DMX. Usa modo de mezcla «Sumar/Multiplicar» en el parámetro para modular sin anular el control manual.</div>
          <MappingTable kinds={['audio']} compact />
        </Section>
      </div>
      <div className="panel right" style={{ width: 360 }}>
        <div className="panel-title">Sincronía / Timecode</div>
        <div className="panel-body">
          <SyncPanel />
        </div>
      </div>
    </div>
  );
}

export function SyncPanel() {
  const s = useShow();
  useTicker(100);
  const p = s.project;
  const upd = (patch: Partial<typeof p.sync>) => s.update((pr) => ({ ...pr, sync: { ...pr.sync, ...patch } }));
  return (
    <>
      <div style={{ fontSize: 30, fontFamily: 'var(--mono)', textAlign: 'center', margin: '6px 0' }}>{formatTimecode(s.timeline.time, p.sync.timecodeFps)}</div>
      <div style={{ textAlign: 'center' }}>
        <span className={`badge ${s.timeline.locked ? 'ok' : 'warn'}`}>{s.timeline.locked ? (s.timeline.playing ? 'EN SINCRONÍA' : 'LISTO') : 'SIN SEÑAL'}</span>
      </div>
      <Field label="Fuente de reloj">
        <Select<SyncSource>
          value={p.sync.source}
          options={[
            { value: 'internal', label: 'Interno' },
            { value: 'midi-clock', label: 'MIDI Clock' },
            { value: 'mtc', label: 'MIDI Time Code (MTC)' },
            { value: 'ltc', label: 'LTC (audio)' },
            { value: 'osc', label: 'OSC (/lujan/time)' },
          ]}
          onChange={(v) => upd({ source: v })}
        />
      </Field>
      <Field label="FPS timecode">
        <Select value={p.sync.timecodeFps} options={[24, 25, 29.97, 30].map((x) => ({ value: x as 24, label: String(x) }))} onChange={(v) => upd({ timecodeFps: v })} />
      </Field>
      <Field label="Offset (s)">
        <NumberInput value={p.sync.offsetSec} step={0.04} onChange={(v) => upd({ offsetSec: v })} />
      </Field>
      <ParamSlider id="sync.bpm" label="BPM" />
      <div className="row">
        <TriggerButton id="sync.tap" label="TAP" />
      </div>
      <div className="small muted">
        MIDI Clock: {s.midi.clock.bpm ? `${s.midi.clock.bpm.toFixed(1)} BPM ${s.midi.clock.running ? '▶' : '■'}` : '—'}
        <br />
        MTC: {s.midi.mtc.lastSeconds !== null ? formatTimecode(s.midi.mtc.lastSeconds, s.midi.mtc.rate) : '—'}
        <br />
        LTC: {s.audio.ltcSeconds !== null && performance.now() - s.audio.ltcLastAt < 1000 ? formatTimecode(s.audio.ltcSeconds, 30) : '— (requiere entrada de audio activa)'}
      </div>
      <div className="hint">Todas las salidas, luces y parámetros siguen el mismo reloj (playhead común). Con fuentes externas el playhead persigue el timecode y se interpola entre mensajes.</div>
    </>
  );
}
