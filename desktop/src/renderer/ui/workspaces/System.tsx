import { useEffect, useState } from 'react';
import type { UpdateState } from '../../../shared/ipc';
import { useShow } from '../hooks';
import { Section } from '../controls';
import { lujan } from '../../api';
import { PRESET_LABEL, PRESET_QUALITY, profileHardware, type Preset, type Profile } from '../../core/hardware';

export function ProfileView({ profile }: { profile: Profile }) {
  const r = profile.report;
  return (
    <>
      <div className="kpi">
        <div className="k">
          <div className="v" style={{ fontSize: 14 }}>{r.gpu.renderer}</div>
          <div className="t">GPU ({r.gpu.vendor}) {r.gpu.driver && `· driver ${r.gpu.driver}`}</div>
        </div>
        <div className="k">
          <div className="v">{r.gpu.dedicatedVramMB ? `${(r.gpu.dedicatedVramMB / 1024).toFixed(1)} GB` : 'N/D'}</div>
          <div className="t">VRAM dedicada</div>
        </div>
        <div className="k">
          <div className="v" style={{ fontSize: 14 }}>{r.cpu.model}</div>
          <div className="t">{r.cpu.cores} núcleos · {r.cpu.threads} hilos</div>
        </div>
        <div className="k">
          <div className="v">{r.ramGB} GB</div>
          <div className="t">RAM</div>
        </div>
        <div className="k">
          <div className="v">{r.displays.length}</div>
          <div className="t">Pantallas / proyectores</div>
        </div>
        <div className="k">
          <div className="v">{r.isLaptop === null ? 'N/D' : r.isLaptop ? 'Portátil' : 'Sobremesa'}</div>
          <div className="t">Equipo</div>
        </div>
      </div>
      {r.gpu.devices.length > 1 && (
        <div className="small" style={{ marginTop: 6 }}>
          GPUs: {r.gpu.devices.map((d) => `${d.description}${d.active ? ' (activa)' : ''}`).join(' · ')}
        </div>
      )}
      <table className="tbl" style={{ marginTop: 8 }}>
        <thead>
          <tr>
            <th>Pantalla</th>
            <th>Resolución</th>
            <th>Hz</th>
            <th>Escala</th>
          </tr>
        </thead>
        <tbody>
          {r.displays.map((d) => (
            <tr key={d.id}>
              <td>
                {d.label}
                {d.primary ? ' (principal)' : ''}
              </td>
              <td>
                {d.size.width}×{d.size.height}
              </td>
              <td>{Math.round(d.refreshRate)}</td>
              <td>{Math.round(d.scaleFactor * 100)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="tbl" style={{ marginTop: 8 }}>
        <thead>
          <tr>
            <th>Códec</th>
            <th>Decodificación</th>
            <th>Codificación (export)</th>
          </tr>
        </thead>
        <tbody>
          {profile.codecs.map((c) => (
            <tr key={c.name}>
              <td>{c.name}</td>
              <td>
                <span className={`badge ${c.decode === 'hardware' ? 'ok' : c.decode === 'software' ? 'warn' : 'err'}`}>{c.decode === 'hardware' ? 'hardware' : c.decode === 'software' ? 'software' : 'no'}</span>
              </td>
              <td>
                <span className={`badge ${c.encode === 'hardware' ? 'ok' : c.encode === 'software' ? 'warn' : 'err'}`}>{c.encode === 'hardware' ? 'hardware' : c.encode === 'software' ? 'software' : 'no'}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="small">
        {profile.reasons.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
      {profile.warnings.map((w) => (
        <div key={w} className="badge warn" style={{ display: 'block', whiteSpace: 'normal', margin: '4px 0', padding: 6 }}>
          {w}
        </div>
      ))}
      <div style={{ marginTop: 6 }}>
        Recomendado: <b>{PRESET_LABEL[profile.recommended]}</b>
      </div>
    </>
  );
}

export function SystemWorkspace() {
  const s = useShow();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [upd, setUpd] = useState<UpdateState>({ state: 'idle' });
  useEffect(() => lujan?.on('updater:state', (st) => setUpd(st as UpdateState)), []);
  const apply = (p: Preset) => {
    const q = PRESET_QUALITY[p];
    s.setQuality({ previewScale: q.previewScale, previewFps: q.previewFps, particleQuality: q.particleQuality, maxFps: q.maxFps });
    s.update((pr) => ({ ...pr, tracking: { ...pr.tracking, quality: q.tracking } }));
    void lujan?.invoke('settings:set', { qualityPreset: p });
  };
  return (
    <div className="col" style={{ flex: 1, padding: 10, overflow: 'auto' }}>
      <Section title="Perfil de hardware" right={<button className="btn sm" onClick={async () => setProfile(await profileHardware())}>Analizar</button>}>
        {profile ? (
          <>
            <ProfileView profile={profile} />
            <div className="row">
              {(['low', 'balanced', 'high', 'ultra'] as Preset[]).map((p) => (
                <button key={p} className={`btn ${p === profile.recommended ? 'primary' : ''}`} onClick={() => apply(p)}>
                  {PRESET_LABEL[p]}
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="hint">Pulsa «Analizar».</div>
        )}
      </Section>
      <Section title="Actualizaciones">
        <div className="row">
          <button className="btn" onClick={() => void lujan?.invoke('updater:check')}>
            Buscar actualizaciones
          </button>
          {upd.state === 'available' && (
            <button className="btn primary" onClick={() => void lujan?.invoke('updater:download')}>
              Descargar {upd.version}
            </button>
          )}
          {upd.state === 'ready' && (
            <button className="btn primary" onClick={() => void lujan?.invoke('updater:install')}>
              Instalar {upd.version} (cierre seguro)
            </button>
          )}
        </div>
        <div className="small">
          {upd.state === 'idle' && 'Versión instalada ' + (s.info?.version ?? '')}
          {upd.state === 'checking' && 'Buscando…'}
          {upd.state === 'none' && `Ya tienes la última versión (${upd.version}).`}
          {upd.state === 'available' && `Disponible ${upd.version}.`}
          {upd.state === 'downloading' && `Descargando ${upd.percent}%…`}
          {upd.state === 'ready' && `Lista para instalar ${upd.version}.`}
          {upd.state === 'error' && <span style={{ color: 'var(--err)' }}>Error: {upd.message}</span>}
          {upd.state === 'unconfigured' && <span className="muted">{upd.message}</span>}
        </div>
        <div className="hint">Antes de instalar: autoguardado → cámaras, tracking, render y export detenidos → GPU, MIDI y DMX liberados → copia de seguridad del proyecto. El instalador es un proceso independiente; si la nueva versión no supera su autoprueba, se restaura la anterior.</div>
      </Section>
      <Section title="Diagnóstico">
        <div className="row">
          <button className="btn" onClick={() => void lujan?.invoke('app:openLogs')}>
            Abrir carpeta de logs
          </button>
          <span className="small muted mono">{s.info?.logsDir}</span>
        </div>
        <div className="small muted">Datos de usuario: {s.info?.userData}</div>
        <div className="small muted">Motor de render: {s.render.info ? `${s.render.info.vendor} · ${s.render.info.renderer} · textura máx. ${s.render.info.maxTexture}px` : '—'}</div>
      </Section>
    </div>
  );
}
