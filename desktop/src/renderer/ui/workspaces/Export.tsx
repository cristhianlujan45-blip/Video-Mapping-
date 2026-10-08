import { useState } from 'react';
import { useInterval, useShow, useTicker } from '../hooks';
import { Field, Modal, NumberInput, Select } from '../controls';
import { lujan } from '../../api';
import type { SystemMetrics } from '../../../shared/ipc';

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const s = useShow();
  useTicker(500);
  const p = s.project;
  const ex = s.exporter;
  const [target, setTarget] = useState<string>('program');
  const [fps, setFps] = useState(30);
  const [codec, setCodec] = useState<'avc' | 'hevc'>('avc');
  const [mbps, setMbps] = useState(20);
  const [mode, setMode] = useState<'manual' | 'seconds' | 'timeline'>('manual');
  const [secs, setSecs] = useState(30);
  const [range, setRange] = useState<[number, number]>([0, p.timeline.durationSec]);
  const [gpu, setGpu] = useState<number | null>(null);
  const [scale, setScale] = useState(1);
  useInterval(() => {
    if (ex.state.active) void lujan?.invoke<SystemMetrics>('app:metrics').then((m) => setGpu(m.gpuPercent));
  }, 1000);

  const [kind, id] = target.split(':');
  const dims = (() => {
    if (kind === 'output') {
      const o = p.outputs.find((x) => x.id === id);
      return o ? [o.width, o.height] : [1920, 1080];
    }
    if (kind === 'comp') {
      const c = p.compositions.find((x) => x.id === id);
      return c ? [c.width, c.height] : [1920, 1080];
    }
    const a = p.compositions.find((x) => x.id === p.mixer.deckA);
    return [a?.width ?? 1920, a?.height ?? 1080];
  })();
  const w = Math.round((dims[0] * scale) / 2) * 2;
  const h = Math.round((dims[1] * scale) / 2) * 2;
  const st = ex.state;
  const eta = st.durationSec && st.fps > 0 ? Math.max(0, (st.durationSec - st.seconds) / Math.max(0.01, st.fps / fps)) : null;

  return (
    <Modal
      title="Exportar video"
      onClose={onClose}
      footer={
        st.active ? (
          <>
            <button className="btn" onClick={onClose}>
              Seguir en segundo plano
            </button>
            <button className="btn danger" onClick={() => ex.stop()}>
              Detener y guardar
            </button>
          </>
        ) : (
          <>
            <button className="btn" onClick={onClose}>
              Cerrar
            </button>
            <button
              className="btn primary"
              onClick={() =>
                void ex.start({
                  target: kind === 'output' ? { kind: 'output', id } : kind === 'comp' ? { kind: 'composition', id } : { kind: 'program' },
                  width: w,
                  height: h,
                  fps,
                  codec,
                  bitrate: mbps * 1e6,
                  durationSec: mode === 'seconds' ? secs : null,
                  timelineRange: mode === 'timeline' ? { start: range[0], end: range[1] } : null,
                })
              }
            >
              Exportar
            </button>
          </>
        )
      }
    >
      {!st.active && (
        <>
          <Field label="Qué exportar">
            <Select
              value={target}
              options={[
                { value: 'program', label: 'Program (escena actual con mezcla)' },
                ...p.compositions.map((c) => ({ value: `comp:${c.id}`, label: `Escena: ${c.name}` })),
                ...p.outputs.map((o) => ({ value: `output:${o.id}`, label: `Salida: ${o.name} (con mapping)` })),
              ]}
              onChange={setTarget}
            />
          </Field>
          <Field label="Resolución">
            <Select value={scale} options={[{ value: 1, label: `${dims[0]}×${dims[1]} (original)` }, { value: 0.5, label: `${dims[0] / 2}×${dims[1] / 2}` }]} onChange={setScale} />
          </Field>
          <Field label="FPS">
            <Select value={fps} options={[24, 25, 30, 50, 60].map((f) => ({ value: f, label: String(f) }))} onChange={setFps} />
          </Field>
          <Field label="Códec">
            <Select value={codec} options={[{ value: 'avc', label: 'H.264 (MP4)' }, { value: 'hevc', label: 'H.265 / HEVC (MP4)' }]} onChange={setCodec} />
          </Field>
          <Field label="Bitrate (Mbps)">
            <NumberInput value={mbps} min={1} max={200} onChange={setMbps} />
          </Field>
          <Field label="Duración">
            <Select value={mode} options={[{ value: 'manual', label: 'Hasta que pulse Detener' }, { value: 'seconds', label: 'Segundos' }, { value: 'timeline', label: 'Rango del timeline (show completo)' }]} onChange={setMode} />
            {mode === 'seconds' && <NumberInput value={secs} min={1} max={36000} onChange={setSecs} />}
          </Field>
          {mode === 'timeline' && (
            <Field label="Desde / hasta (s)">
              <NumberInput value={range[0]} min={0} onChange={(v) => setRange([v, range[1]])} />
              <NumberInput value={range[1]} min={0} onChange={(v) => setRange([range[0], v])} />
            </Field>
          )}
          <div className="hint">La exportación es en tiempo real: se graba lo que el motor está renderizando (con efectos, mapping, tracking y dibujo en vivo), codificado por hardware cuando la GPU lo permite. El audio no se incluye en esta versión.</div>
        </>
      )}
      {(st.active || st.done) && (
        <>
          <div className="kpi">
            <div className="k">
              <div className="v">{st.seconds.toFixed(1)} s</div>
              <div className="t">Grabado</div>
            </div>
            <div className="k">
              <div className="v">{st.fps.toFixed(1)}</div>
              <div className="t">FPS de codificación</div>
            </div>
            <div className="k">
              <div className="v">{(st.bytes / 1024 / 1024).toFixed(1)} MB</div>
              <div className="t">Tamaño</div>
            </div>
            <div className="k">
              <div className="v">{eta !== null ? `${Math.round(eta)} s` : '—'}</div>
              <div className="t">ETA</div>
            </div>
            <div className="k">
              <div className="v">{gpu !== null ? `${Math.round(gpu)} %` : 'N/D'}</div>
              <div className="t">GPU</div>
            </div>
          </div>
          {st.durationSec && (
            <div className="meter" style={{ marginTop: 8 }}>
              <div style={{ width: `${Math.min(100, (st.seconds / st.durationSec) * 100)}%` }} />
            </div>
          )}
          {st.error && <div className="badge err">{st.error}</div>}
          {st.done && !st.error && (
            <div className="row">
              <span className="badge ok">Exportación terminada</span>
              <button className="btn sm" onClick={() => st.path && void lujan?.invoke('app:openPath', st.path)}>
                Mostrar archivo
              </button>
            </div>
          )}
          <div className="small mono muted">{st.path}</div>
        </>
      )}
    </Modal>
  );
}
