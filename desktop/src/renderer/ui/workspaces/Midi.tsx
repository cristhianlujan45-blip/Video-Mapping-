import { useMemo, useState } from 'react';
import type { ControlMode, Mapping, RelativeEncoding } from '../../../shared/params/types';
import { describeControl } from '../../../shared/midi/midi';
import { uid } from '../../../shared/project/model';
import { useShow, useTicker } from '../hooks';
import { Icon } from '../icons';
import { Check, NumberInput, Section, Select, Tabs, TextInput } from '../controls';

type Tab = 'devices' | 'mappings' | 'surface' | 'monitor' | 'routing' | 'diag';

export function MidiWorkspace() {
  const [tab, setTab] = useState<Tab>('mappings');
  return (
    <div className="col" style={{ flex: 1 }}>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'devices', label: 'Dispositivos' },
          { id: 'mappings', label: 'Mapeos' },
          { id: 'surface', label: 'Superficie de control' },
          { id: 'monitor', label: 'Monitor' },
          { id: 'routing', label: 'Enrutado / Thru' },
          { id: 'diag', label: 'Diagnóstico' },
        ]}
      />
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 10 }}>
        {tab === 'devices' && <Devices />}
        {tab === 'mappings' && <MappingTable kinds={['midi', 'osc', 'dmx', 'keyboard', 'audio', 'tracking', 'gamepad']} />}
        {tab === 'surface' && <ControlSurface />}
        {tab === 'monitor' && <Monitor />}
        {tab === 'routing' && <Routing />}
        {tab === 'diag' && <Diagnostics />}
      </div>
    </div>
  );
}

function Devices() {
  const s = useShow();
  useTicker(1000);
  const p = s.project;
  if (!s.midi.available) return <div className="badge err">{s.midi.error ?? 'MIDI no disponible'}</div>;
  const setDisabled = (name: string, type: 'input' | 'output', enabled: boolean) => {
    s.midi.setEnabled(name, type, enabled);
    s.update((pr) => ({ ...pr, midi: { ...pr.midi, disabledInputs: [...s.midi.disabledInputs], disabledOutputs: [...s.midi.disabledOutputs] } }));
  };
  return (
    <>
      <Section title="Entradas MIDI (detección automática, hot-plug)">
        <PortTable ports={s.midi.inputs()} onToggle={(n, v) => setDisabled(n, 'input', v)} />
      </Section>
      <Section title="Salidas MIDI (feedback: LEDs, pads RGB, displays, faders motorizados)">
        <PortTable ports={s.midi.outputs()} onToggle={(n, v) => setDisabled(n, 'output', v)} />
      </Section>
      <Section title="Reloj y timecode">
        <div className="small">
          MIDI Clock: {s.midi.clock.running ? `▶ ${s.midi.clock.bpm.toFixed(1)} BPM · beat ${s.midi.clock.beats.toFixed(1)}` : s.midi.clock.bpm ? `parado (${s.midi.clock.bpm.toFixed(1)} BPM)` : 'sin señal'} · MTC: {s.midi.mtc.lastSeconds !== null ? `${s.midi.mtc.lastSeconds.toFixed(2)} s @ ${s.midi.mtc.rate} fps` : 'sin señal'}
        </div>
        <div className="row">
          <span className="lbl">Enviar clock/MTC a</span>
          <Select value={p.midi.clockOutput ?? ''} options={[{ value: '', label: '— no enviar —' }, ...s.midi.outputs().map((o) => ({ value: o.name, label: o.name }))]} onChange={(v) => s.update((pr) => ({ ...pr, midi: { ...pr.midi, clockOutput: v || null } }))} />
        </div>
      </Section>
      <div className="hint">
        USB MIDI, MIDI por Bluetooth (emparejado en Windows) y MIDI de red (rtpMIDI) aparecen aquí como puertos. Los mensajes MIDI 2.0 se reciben en modo de protocolo MIDI 1.0 (Web MIDI); la alta resolución se aprovecha con CC de 14 bits, NRPN y pitch bend. La app nunca instala ni cambia drivers.
      </div>
    </>
  );
}

function PortTable({ ports, onToggle }: { ports: ReturnType<ReturnType<typeof useShow>['midi']['inputs']>; onToggle: (name: string, enabled: boolean) => void }) {
  if (!ports.length) return <div className="hint">Ninguno detectado. Conecta un controlador: aparecerá aquí sin reiniciar.</div>;
  return (
    <table className="tbl">
      <thead>
        <tr>
          <th>Activo</th>
          <th>Dispositivo</th>
          <th>Fabricante</th>
          <th>Estado</th>
          <th>Mensajes</th>
        </tr>
      </thead>
      <tbody>
        {ports.map((p) => (
          <tr key={p.id}>
            <td>
              <input type="checkbox" checked={p.enabled} onChange={(e) => onToggle(p.name, e.target.checked)} />
            </td>
            <td>{p.name}</td>
            <td>{p.manufacturer || '—'}</td>
            <td>
              <span className={`badge ${p.state === 'connected' ? 'ok' : 'err'}`}>{p.state === 'connected' ? 'conectado' : 'desconectado'}</span>
            </td>
            <td className="mono">{p.messages}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const MODES: { value: ControlMode; label: string }[] = [
  { value: 'absolute', label: 'Absoluto' },
  { value: 'relative', label: 'Relativo (encoder)' },
  { value: 'toggle', label: 'Toggle' },
  { value: 'momentary', label: 'Momentáneo' },
];

/** Mapping editor shared by MIDI, OSC, DMX, keyboard, audio and tracking sources. */
export function MappingTable({ kinds, compact }: { kinds: Mapping['source']['kind'][]; compact?: boolean }) {
  const s = useShow();
  const p = s.project;
  const [filter, setFilter] = useState('');
  const [learnFor, setLearnFor] = useState<string | null>(null);
  const maps = s.engine.getMappings().filter((m) => kinds.includes(m.source.kind) && (!filter || JSON.stringify(m).toLowerCase().includes(filter.toLowerCase())));
  const params = useMemo(() => s.engine.list().filter((x) => !x.id.startsWith('view.') || true), [s.store.version]);
  const upd = (id: string, patch: Partial<Mapping>) => {
    s.engine.updateMapping(id, patch);
    s.persistMappings();
  };
  return (
    <div>
      <div className="row">
        <TextInput value={filter} onChange={setFilter} placeholder="Filtrar…" style={{ maxWidth: 220 }} />
        <span className="small muted">Banco activo</span>
        <Select value={s.engine.activeBank} options={[{ value: '', label: '(todos)' }, ...p.midi.banks.map((b) => ({ value: b, label: b }))]} style={{ maxWidth: 160 }} onChange={(v) => { s.engine.activeBank = v; s.emit(); }} />
        <span className="spacer" />
        <span className="small muted">Para crear un mapeo pulsa el botón de learn (onda) junto a cualquier parámetro y mueve el control.</span>
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>On</th>
            <th>Dispositivo</th>
            <th>Tipo</th>
            <th>Canal</th>
            <th>Control</th>
            <th>Destino</th>
            <th>Mín</th>
            <th>Máx</th>
            <th>Modo</th>
            {!compact && <th>Opciones</th>}
            <th />
          </tr>
        </thead>
        <tbody>
          {maps.map((m) => {
            const [type, ch, num] = m.source.control.split(':');
            const target = s.engine.get(m.target);
            return (
              <tr key={m.id} style={{ opacity: m.enabled ? 1 : 0.5 }}>
                <td>
                  <input type="checkbox" checked={m.enabled} onChange={(e) => upd(m.id, { enabled: e.target.checked })} />
                </td>
                <td title={m.source.device}>
                  <Select value={m.source.device} style={{ maxWidth: 150 }} options={[{ value: '*', label: 'Cualquiera' }, ...uniq([m.source.device, ...s.midi.inputs().map((x) => x.name)]).map((d) => ({ value: d, label: d === '*' ? 'Cualquiera' : d }))]} onChange={(v) => upd(m.id, { source: { ...m.source, device: v } })} />
                </td>
                <td>{m.source.kind === 'midi' ? type.toUpperCase() : m.source.kind}</td>
                <td>{m.source.kind === 'midi' ? ch : '—'}</td>
                <td className="mono" title={m.source.control}>
                  {m.source.kind === 'midi' ? num ?? '' : m.source.control}
                </td>
                <td>
                  <Select value={m.target} style={{ maxWidth: 220 }} options={params.map((x) => ({ value: x.id, label: x.name }))} onChange={(v) => upd(m.id, { target: v })} />
                  {!target && <span className="badge err">no existe</span>}
                </td>
                <td>
                  <NumberInput width={60} step={0.01} value={m.min} onChange={(v) => upd(m.id, { min: v })} />
                </td>
                <td>
                  <NumberInput width={60} step={0.01} value={m.max} onChange={(v) => upd(m.id, { max: v })} />
                </td>
                <td>
                  <Select value={m.mode} style={{ maxWidth: 120 }} options={MODES} onChange={(v) => upd(m.id, { mode: v })} />
                  {m.mode === 'relative' && (
                    <Select<RelativeEncoding>
                      value={m.relativeEncoding ?? 'twos-complement'}
                      style={{ maxWidth: 120 }}
                      options={[
                        { value: 'twos-complement', label: 'Comp. a 2 (1/127)' },
                        { value: 'binary-offset', label: 'Offset 64' },
                        { value: 'signed-bit', label: 'Bit de signo' },
                      ]}
                      onChange={(v) => upd(m.id, { relativeEncoding: v })}
                    />
                  )}
                </td>
                {!compact && (
                  <td>
                    <Check checked={m.invert} onChange={(v) => upd(m.id, { invert: v })} label="Inv." />
                    <Check checked={m.softTakeover} onChange={(v) => upd(m.id, { softTakeover: v })} label="Soft takeover" />
                    <Check checked={m.feedback} onChange={(v) => upd(m.id, { feedback: v })} label="Feedback" />
                    <Select value={m.modifier ?? ''} style={{ maxWidth: 90 }} options={[{ value: '', label: 'Sin mod.' }, { value: 'SHIFT', label: 'SHIFT' }, { value: 'ALT', label: 'ALT' }, { value: 'CTRL', label: 'CTRL' }]} onChange={(v) => upd(m.id, { modifier: v || undefined })} />
                    <Select value={m.bank ?? ''} style={{ maxWidth: 110 }} options={[{ value: '', label: 'Todos los bancos' }, ...p.midi.banks.map((b) => ({ value: b, label: b }))]} onChange={(v) => upd(m.id, { bank: v || undefined })} />
                    <span className="small muted">curva</span>
                    <NumberInput width={50} step={0.1} value={m.curve} min={0.1} max={5} onChange={(v) => upd(m.id, { curve: v })} />
                  </td>
                )}
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className={`btn icon sm ${learnFor === m.id ? 'learn armed' : ''}`} title="Re-aprender control" onClick={() => relearn(m)}>
                    <Icon name="learn" size={13} />
                  </button>
                  <button className="btn icon sm" title="Duplicar" onClick={() => { s.engine.addMapping({ ...m, id: uid('map') }); s.persistMappings(); }}>
                    <Icon name="copy" size={13} />
                  </button>
                  <button className="btn icon sm" title="Restablecer rango" onClick={() => upd(m.id, { min: target?.min ?? 0, max: target?.max ?? 1, curve: 1, invert: false })}>
                    ↺
                  </button>
                  <button className="btn icon sm" title="Eliminar" onClick={() => { s.engine.removeMapping(m.id); s.persistMappings(); }}>
                    <Icon name="trash" size={13} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {maps.length === 0 && <div className="hint">Sin mapeos.</div>}
      {!compact && (
        <Section title="Bancos / páginas">
          <div className="row">
            {p.midi.banks.map((b) => (
              <button key={b} className={`btn sm ${s.engine.activeBank === b ? 'on' : ''}`} onClick={() => { s.engine.activeBank = s.engine.activeBank === b ? '' : b; s.emit(); }}>
                {b}
              </button>
            ))}
          </div>
          <div className="hint">Un mapeo con banco solo responde cuando ese banco está activo; así un mismo knob controla cosas distintas por página. Los modificadores SHIFT/ALT/CTRL (teclado o un botón MIDI mapeado a modificador) multiplican los controles.</div>
        </Section>
      )}
    </div>
  );

  function relearn(m: Mapping) {
    setLearnFor(m.id);
    s.engine.startLearn(m.target, (r) => {
      // keep the new mapping, carry over the settings of the old one
      s.engine.updateMapping(r.mapping.id, { min: m.min, max: m.max, mode: m.mode, invert: m.invert, softTakeover: m.softTakeover, feedback: m.feedback, modifier: m.modifier, bank: m.bank, curve: m.curve });
      s.engine.removeMapping(m.id);
      s.persistMappings();
      setLearnFor(null);
    });
  }
}

const uniq = <T,>(a: T[]) => [...new Set(a)];

/** Which physical control drives which parameter, with live values. */
function ControlSurface() {
  const s = useShow();
  useTicker(100);
  const byDevice = new Map<string, Mapping[]>();
  for (const m of s.engine.getMappings()) {
    if (m.source.kind !== 'midi') continue;
    const list = byDevice.get(m.source.device) ?? [];
    list.push(m);
    byDevice.set(m.source.device, list);
  }
  if (!byDevice.size) return <div className="hint">Aún no hay controles MIDI mapeados.</div>;
  return (
    <>
      {[...byDevice].map(([dev, maps]) => (
        <Section key={dev} title={dev === '*' ? 'Cualquier dispositivo' : dev}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
            {maps
              .sort((a, b) => a.source.control.localeCompare(b.source.control, undefined, { numeric: true }))
              .map((m) => {
                const p = s.engine.get(m.target);
                const n = s.engine.normalized(m.target);
                const isButton = m.source.control.startsWith('note:');
                return (
                  <div key={m.id} style={{ background: 'var(--bg3)', border: '1px solid var(--line)', borderRadius: 8, padding: 8, opacity: m.enabled ? 1 : 0.5 }}>
                    <div className="small muted">{describeControl(m.source.control)}{m.modifier ? ` + ${m.modifier}` : ''}{m.bank ? ` · ${m.bank}` : ''}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0' }}>
                      {isButton ? (
                        <div style={{ width: 26, height: 26, borderRadius: 5, background: n >= 0.5 ? 'var(--accent)' : 'var(--bg)', border: '1px solid var(--line2)' }} />
                      ) : (
                        <svg width="30" height="30" viewBox="-1 -1 2 2">
                          <circle r="0.9" fill="none" stroke="var(--line2)" strokeWidth="0.15" />
                          <path d={arc(n)} fill="none" stroke="var(--accent)" strokeWidth="0.18" />
                        </svg>
                      )}
                      <div className="small" style={{ flex: 1 }}>{p?.name ?? m.target}</div>
                    </div>
                    <div className="meter">
                      <div style={{ width: `${n * 100}%` }} />
                    </div>
                  </div>
                );
              })}
          </div>
        </Section>
      ))}
    </>
  );
}

function arc(n: number) {
  const a0 = Math.PI * 0.75;
  const a1 = a0 + Math.PI * 1.5 * Math.max(0, Math.min(1, n));
  const p = (a: number) => `${Math.cos(a) * 0.9} ${Math.sin(a) * 0.9}`;
  return `M ${p(a0)} A 0.9 0.9 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p(a1)}`;
}

function Monitor() {
  const s = useShow();
  useTicker(200);
  const [dev, setDev] = useState('');
  const [type, setType] = useState('');
  const log = s.midi.log.filter((e) => (!dev || e.device === dev) && (!type || e.type === type)).slice(-300).reverse();
  return (
    <>
      <div className="row">
        <button className={`btn sm ${s.midi.logPaused ? 'on' : ''}`} onClick={() => { s.midi.logPaused = !s.midi.logPaused; s.emit(); }}>
          {s.midi.logPaused ? 'Reanudar' : 'Pausar'}
        </button>
        <button className="btn sm" onClick={() => { s.midi.log.length = 0; s.emit(); }}>
          Limpiar
        </button>
        <Select value={dev} style={{ maxWidth: 200 }} options={[{ value: '', label: 'Todos los dispositivos' }, ...uniq(s.midi.log.map((e) => e.device)).map((d) => ({ value: d, label: d }))]} onChange={setDev} />
        <Select value={type} style={{ maxWidth: 160 }} options={[{ value: '', label: 'Todos los tipos' }, ...['note', 'cc', 'nrpn', 'pitchbend', 'aftertouch', 'program', 'SysEx', 'MTC', 'out'].map((t) => ({ value: t, label: t }))]} onChange={setType} />
      </div>
      <table className="tbl mono">
        <thead>
          <tr>
            <th>Tiempo</th>
            <th>Dir</th>
            <th>Dispositivo</th>
            <th>Canal</th>
            <th>Tipo</th>
            <th>Control</th>
            <th>Valor</th>
            <th>Bytes</th>
          </tr>
        </thead>
        <tbody>
          {log.map((e, i) => (
            <tr key={i}>
              <td>{(e.t / 1000).toFixed(3)}</td>
              <td>{e.dir === 'in' ? '→' : '←'}</td>
              <td>{e.device}</td>
              <td>{e.channel ?? ''}</td>
              <td>{e.type}</td>
              <td>{e.control ?? ''}</td>
              <td>{e.value ?? ''}</td>
              <td>{e.data}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {log.length === 0 && <div className="hint">Mueve cualquier control de un dispositivo conectado.</div>}
    </>
  );
}

function Routing() {
  const s = useShow();
  const ins = s.midi.inputs();
  const outs = s.midi.outputs();
  // routes live in the project (saved); mutate a copy and commit
  const force = () => s.update((pr) => ({ ...pr, midi: { ...pr.midi, routes: s.midi.routes.map((r) => ({ ...r })) } }));
  return (
    <>
      <div className="row">
        <button
          className="btn sm"
          disabled={!ins.length || !outs.length}
          onClick={() => {
            s.midi.routes.push({ id: uid('route'), from: ins[0].name, to: outs[0].name, channels: [], enabled: true });
            force();
          }}
        >
          <Icon name="plus" /> Ruta
        </button>
        <span className="small muted">Controlador → aplicación → otro dispositivo (MIDI thru filtrado por canal).</span>
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>On</th>
            <th>Desde</th>
            <th>Hacia</th>
            <th>Canales (vacío = todos)</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {s.midi.routes.map((r) => (
            <tr key={r.id}>
              <td>
                <input type="checkbox" checked={r.enabled} onChange={(e) => { r.enabled = e.target.checked; force(); }} />
              </td>
              <td>
                <Select value={r.from} options={ins.map((p) => ({ value: p.name, label: p.name }))} onChange={(v) => { r.from = v; force(); }} />
              </td>
              <td>
                <Select value={r.to} options={outs.map((p) => ({ value: p.name, label: p.name }))} onChange={(v) => { r.to = v; force(); }} />
              </td>
              <td>
                <TextInput value={r.channels.join(',')} onChange={(v) => { r.channels = v.split(',').map((x) => Number(x.trim())).filter((x) => x >= 1 && x <= 16); force(); }} placeholder="1,2,10" />
              </td>
              <td>
                <button className="btn icon sm" onClick={() => { s.midi.routes = s.midi.routes.filter((x) => x.id !== r.id); force(); }}>
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

function Diagnostics() {
  const s = useShow();
  useTicker(1000);
  const ports = [...s.midi.ports.values()];
  return (
    <>
      <Section title="Estado del subsistema MIDI">
        <div className="small">{s.midi.available ? 'Web MIDI activo (SysEx permitido para MTC y feedback avanzado).' : `No disponible: ${s.midi.error}`}</div>
      </Section>
      <table className="tbl">
        <thead>
          <tr>
            <th>Puerto</th>
            <th>Tipo</th>
            <th>Fabricante</th>
            <th>Versión driver</th>
            <th>Estado</th>
            <th>Conexión</th>
            <th>Mensajes</th>
            <th>ID</th>
          </tr>
        </thead>
        <tbody>
          {ports.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td>{p.type === 'input' ? 'Entrada' : 'Salida'}</td>
              <td>{p.manufacturer || '—'}</td>
              <td>{p.version || '—'}</td>
              <td>{p.state}</td>
              <td>{p.connection}</td>
              <td className="mono">{p.messages}</td>
              <td className="mono small">{p.id.slice(0, 18)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="hint">Si un dispositivo no aparece: comprueba en el Administrador de dispositivos de Windows que el driver está instalado y que ninguna otra aplicación lo tiene abierto en modo exclusivo. Esta aplicación no instala ni modifica drivers.</div>
    </>
  );
}
