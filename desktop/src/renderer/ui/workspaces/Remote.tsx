import { useShow, useTicker } from '../hooks';
import { Check, Field, InDevelopment, NumberInput, Section, TextInput } from '../controls';
import { MappingTable } from './Midi';
import { lujan } from '../../api';

export function RemoteWorkspace() {
  const s = useShow();
  useTicker(500);
  const p = s.project;
  const st = s.net.status;
  const updR = (patch: Partial<typeof p.remote>) => s.update((pr) => ({ ...pr, remote: { ...pr.remote, ...patch } }));
  const updO = (patch: Partial<typeof p.osc>) => s.update((pr) => ({ ...pr, osc: { ...pr.osc, ...patch } }));
  return (
    <div className="cols">
      <div className="col" style={{ flex: 1, padding: 10, overflow: 'auto' }}>
        <Section title="Control remoto web (teléfono, tablet, otro PC)">
          <Check checked={p.remote.enabled} onChange={(v) => updR({ enabled: v })} label="Activar servidor de control remoto" />
          <Field label="Puerto">
            <NumberInput value={p.remote.port} min={1024} max={65535} onChange={(v) => updR({ port: v })} />
          </Field>
          <Field label="PIN">
            <TextInput value={p.remote.pin} onChange={(v) => updR({ pin: v.replace(/\D/g, '').slice(0, 8) })} style={{ maxWidth: 120, fontFamily: 'var(--mono)', fontSize: 16 }} />
            <button className="btn sm" onClick={() => updR({ pin: String(Math.floor(100000 + Math.random() * 900000)) })}>
              Nuevo PIN
            </button>
          </Field>
          {st?.remote.listening ? (
            <>
              <div className="badge ok">Escuchando · {st.remote.clients} cliente(s)</div>
              <div style={{ marginTop: 8 }}>
                {st.remote.urls.map((u) => (
                  <div key={u} className="row">
                    <span className="mono" style={{ fontSize: 16, userSelect: 'text' }}>{u}</span>
                    <button className="btn sm" onClick={() => void navigator.clipboard.writeText(u)}>
                      Copiar
                    </button>
                    <button className="btn sm" onClick={() => void lujan?.invoke('app:openExternal', u)}>
                      Abrir
                    </button>
                  </div>
                ))}
              </div>
              <div className="hint">Abre la URL en el navegador del teléfono (misma red Wi-Fi). En Android: menú ⋮ → «Instalar aplicación» para usarlo como app (PWA). Windows puede pedir permiso de red privada la primera vez.</div>
            </>
          ) : (
            p.remote.enabled && <div className="badge err">{st?.remote.error ?? 'Iniciando…'}</div>
          )}
          <div className="hint">El remoto solo envía órdenes (play, escenas, cues, crossfader, brillo, luces, blackout…). El render sigue en la GPU de este equipo.</div>
        </Section>
        <Section title="Multi-PC (maestro / esclavo)">
          <InDevelopment>Sincronizar timeline, escenas y salidas distribuidas entre varios PCs. La base ya existe: OSC (/lujan/time, /lujan/scene/n, /lujan/param/…) permite que un equipo maestro dirija a otro hoy mismo.</InDevelopment>
        </Section>
      </div>
      <div className="panel right" style={{ width: 460 }}>
        <div className="panel-title">OSC</div>
        <div className="panel-body">
          <Check checked={p.osc.enabled} onChange={(v) => updO({ enabled: v })} label="Activar OSC" />
          <Field label="Puerto de entrada">
            <NumberInput value={p.osc.inPort} min={1} max={65535} onChange={(v) => updO({ inPort: v })} />
          </Field>
          <Field label="Salida (host:puerto)">
            <TextInput value={p.osc.outHost} onChange={(v) => updO({ outHost: v })} style={{ maxWidth: 160 }} />
            <NumberInput value={p.osc.outPort} min={1} max={65535} onChange={(v) => updO({ outPort: v })} />
          </Field>
          <Check checked={p.osc.feedback} onChange={(v) => updO({ feedback: v })} label="Enviar cambios de parámetros (feedback)" />
          {st && p.osc.enabled && <div className={`badge ${st.osc.listening ? 'ok' : 'err'}`}>{st.osc.listening ? `Escuchando UDP ${st.osc.port} · ${st.osc.messagesPerSec} msg/s` : st.osc.error ?? 'no escucha'}</div>}
          <Section title="Direcciones">
            <div className="small mono" style={{ userSelect: 'text' }}>
              /lujan/param/&lt;id&gt; valor
              <br />
              /lujan/trigger/&lt;id&gt;
              <br />
              /lujan/scene/&lt;n&gt;
              <br />
              /lujan/play · /pause · /stop · /next · /previous · /take
              <br />
              /lujan/blackout 0|1
              <br />
              /lujan/time &lt;segundos&gt; (sincronía OSC)
            </div>
            <div className="hint">Cualquier otra dirección se puede asignar con learn (valor 0..1).</div>
          </Section>
          <Section title="Monitor OSC">
            <div className="small mono" style={{ maxHeight: 200, overflow: 'auto' }}>
              {s.net.log
                .slice(-60)
                .reverse()
                .map((l, i) => (
                  <div key={i}>
                    {l.address} {l.args} <span className="muted">← {l.from}</span>
                  </div>
                ))}
            </div>
          </Section>
          <Section title="Mapeos OSC">
            <MappingTable kinds={['osc']} compact />
          </Section>
        </div>
      </div>
    </div>
  );
}
