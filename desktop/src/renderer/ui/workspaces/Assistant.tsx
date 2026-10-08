import { useEffect, useRef, useState } from 'react';
import { useShow } from '../hooks';
import { Section } from '../controls';
import { lujan } from '../../api';
import { CalibrationPanel } from './Calibration';

const EXAMPLES = [
  'Cuando levante la mano cambia el color a rojo.',
  'Cuando haya dos personas activa la escena 2.',
  'Que los graves controlen la escala de la primera capa.',
  'Crea una macro SHOW START que ponga la escena 1, quite el blackout y dé play.',
  'Cuando alguien entre en la zona central, haz un flash de brillo.',
];

export function AssistantWorkspace() {
  const s = useShow();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [key, setKey] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void lujan?.invoke<{ anthropicApiKey: string | null }>('settings:get').then((x) => setHasKey(!!x.anthropicApiKey));
  }, []);
  useEffect(() => end.current?.scrollIntoView({ behavior: 'smooth' }), [s.assistant.turns.length, busy]);

  const ask = async (q: string) => {
    if (!q.trim() || busy) return;
    setBusy(true);
    setText('');
    await s.assistant.ask(q);
    setBusy(false);
    s.emit();
  };

  return (
    <div className="cols">
      <div className="col" style={{ flex: 1, padding: 10, gap: 8 }}>
        <div className="panel-title" style={{ border: 0, padding: 0 }}>Asistente IA de show</div>
        <div className="hint">Describe lo que quieres y el asistente lo configura de verdad (reglas, mapeos de audio, zonas, efectos, macros, escenas). Usa Claude (Anthropic) por Internet con tu clave de API.</div>
        <div style={{ flex: 1, overflow: 'auto', background: 'var(--bg2)', border: '1px solid var(--line)', borderRadius: 8, padding: 10 }} className="chat">
          {s.assistant.turns.length === 0 && (
            <div className="list">
              {EXAMPLES.map((e) => (
                <div key={e} className="item" onClick={() => void ask(e)}>
                  <span className="name">{e}</span>
                </div>
              ))}
            </div>
          )}
          {s.assistant.turns.map((t, i) => (
            <div key={i} className={`msg ${t.role}`}>
              {t.text}
              {t.actions.length > 0 && (
                <div className="small" style={{ marginTop: 6 }}>
                  {t.actions.map((a, j) => (
                    <div key={j}>✓ {a}</div>
                  ))}
                </div>
              )}
              {t.error && <div style={{ color: 'var(--err)' }}>{t.error}</div>}
            </div>
          ))}
          {busy && <div className="msg assistant muted">Configurando…</div>}
          <div ref={end} />
        </div>
        <div className="row">
          <textarea value={text} rows={2} style={{ flex: 1 }} placeholder="Ej.: cuando dos personas levanten la mano, lanza la escena final" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(text); } }} />
          <button className="btn primary lg" disabled={busy || !hasKey} onClick={() => void ask(text)}>
            Enviar
          </button>
        </div>
        {!hasKey && <div className="badge warn">Configura tu clave de API para usar el asistente.</div>}
      </div>
      <div className="panel right" style={{ width: 380 }}>
        <div className="panel-title">IA</div>
        <div className="panel-body">
          <Section title="Clave de API de Anthropic">
            <div className="row">
              <input type="password" value={key} placeholder={hasKey ? '•••••• (guardada, cifrada)' : 'sk-ant-…'} style={{ flex: 1 }} onChange={(e) => setKey(e.target.value)} />
              <button
                className="btn sm"
                disabled={!key}
                onClick={async () => {
                  await lujan?.invoke('settings:set', { anthropicApiKey: key });
                  setKey('');
                  setHasKey(true);
                }}
              >
                Guardar
              </button>
              {hasKey && (
                <button className="btn sm" onClick={async () => { await lujan?.invoke('settings:set', { anthropicApiKey: null }); setHasKey(false); }}>
                  Borrar
                </button>
              )}
            </div>
            <div className="hint">Se guarda cifrada con DPAPI de Windows y solo la usa el proceso principal.</div>
            <button className="btn sm" onClick={() => { s.assistant.reset(); s.emit(); }}>
              Nueva conversación
            </button>
          </Section>
          <Section title="Reglas creadas por la IA">
            {s.project.rules.filter((r) => r.origin === 'ai').map((r) => (
              <div key={r.id} className="row small">
                <span className={`status-dot ${r.enabled ? 'ok' : ''}`} />
                {r.name}
              </div>
            ))}
            <div className="hint">Edítalas o bórralas en Show → Reglas.</div>
          </Section>
          <CalibrationPanel />
        </div>
      </div>
    </div>
  );
}
