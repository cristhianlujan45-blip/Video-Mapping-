import { useEffect, useRef, useState } from 'react';
import type { SystemMetrics } from '../../../shared/ipc';
import { useShow, useInterval } from '../hooks';
import { Section, Select, Slider } from '../controls';
import { lujan } from '../../api';

interface Sample {
  t: number;
  fps: number;
  frameMs: number;
  gpu: number | null;
}

const history: Sample[] = [];

export function PerformanceWorkspace() {
  const s = useShow();
  const [m, setM] = useState<SystemMetrics | null>(null);
  const [, tick] = useState(0);
  useInterval(async () => {
    const met = (await lujan?.invoke<SystemMetrics>('app:metrics')) ?? null;
    setM(met);
    const st = s.render.stats;
    if (st) {
      history.push({ t: Date.now(), fps: st.fps, frameMs: st.frameMs, gpu: met?.gpuPercent ?? null });
      if (history.length > 120) history.shift();
    }
    tick((x) => x + 1);
  }, 1000);
  const st = s.render.stats;
  const q = s.qualitySettings;
  const sections = st?.sections ?? {};
  const maxSec = Math.max(1, ...Object.values(sections));
  const dmx = s.dmx.stats;

  return (
    <div className="col" style={{ flex: 1, padding: 10, overflow: 'auto' }}>
      <Section title="Performance Monitor (valores medidos)">
        <div className="kpi">
          <K t="FPS render" v={st ? st.fps.toFixed(1) : '—'} warn={!!st && st.fps < 50} />
          <K t="Frame time CPU" v={st ? `${st.frameMs.toFixed(2)} ms` : '—'} />
          <K t="Frame time GPU" v={st?.gpuMs != null ? `${st.gpuMs.toFixed(2)} ms` : 'N/D'} />
          <K t="Frames perdidos/s" v={st?.dropped ?? '—'} warn={!!st && st.dropped > 0} />
          <K t="Uso de GPU" v={m?.gpuPercent != null ? `${m.gpuPercent.toFixed(0)} %` : 'N/D'} />
          <K t="VRAM usada" v={m?.vramUsedMB != null ? `${m.vramUsedMB} MB` : 'N/D'} />
          <K t="Texturas del motor" v={st ? `${st.textureMB} MB` : '—'} />
          <K t="CPU de la app" v={m ? `${m.cpuPercent.toFixed(1)} %` : '—'} />
          <K t="RAM de la app" v={m ? `${m.appMemoryMB} MB` : '—'} />
          <K t="RAM libre" v={m ? `${(m.systemFreeMB / 1024).toFixed(1)} GB` : '—'} />
          <K t="Frames de video/s" v={st?.videoFramesPerSec ?? '—'} />
          <K t="Draw calls" v={st?.drawCalls ?? '—'} />
          <K t="Tracking" v={s.tracking.status === 'running' ? `${s.tracking.fps} fps · ${s.tracking.inferenceMs} ms` : 'apagado'} />
          <K t="MIDI (msg)" v={[...s.midi.ports.values()].reduce((a, p) => a + p.messages, 0)} />
          <K t="DMX" v={dmx ? `${dmx.fps} fps · ${dmx.packetsPerSec} paq/s` : '—'} />
          <K t="Latencia DMX" v={dmx ? `${dmx.latencyMs} ms` : '—'} />
          <K t="Audio" v={s.audio.status === 'live' ? 'activo' : 'apagado'} />
        </div>
        <Graph />
        <div className="hint">GPU % y VRAM se leen de los contadores de rendimiento de la GPU de Windows. «N/D» = el sistema no expone ese dato (nunca se inventa). El tiempo GPU por frame requiere la extensión de timer queries del driver.</div>
      </Section>
      <Section title="Performance Profiler (coste por sección del frame, ms CPU)">
        {Object.entries(sections)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => (
            <div className="row" key={k}>
              <span className="lbl">{({ sources: 'Subida de video/cámaras', outputs: 'Salidas (composición + mapping)', '3d': 'Escena 3D', views: 'Vistas / previews', pixelmaps: 'Pixel maps', effects: 'Efectos' } as Record<string, string>)[k] ?? k}</span>
              <div className="meter" style={{ flex: 1 }}>
                <div style={{ width: `${(v / maxSec) * 100}%`, background: v > 8 ? 'var(--err)' : v > 4 ? 'var(--warn)' : undefined }} />
              </div>
              <span className="mono small" style={{ width: 70, textAlign: 'right' }}>{v.toFixed(2)} ms</span>
            </div>
          ))}
        {m && (
          <table className="tbl" style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>Proceso</th>
                <th>CPU %</th>
                <th>RAM MB</th>
              </tr>
            </thead>
            <tbody>
              {m.processes.map((p, i) => (
                <tr key={i}>
                  <td>{p.name ?? p.type}</td>
                  <td>{p.cpu}</td>
                  <td>{p.memMB}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="hint">El render, el tracking, el DMX y la red corren en hilos/procesos separados: un nodo Art-Net caído o una cámara desconectada no congelan la interfaz ni el render.</div>
      </Section>
      <Section title="Calidad de interfaz (la salida final nunca se reduce)">
        <div className="row">
          <span className="lbl">Escala de previews</span>
          <Slider value={q.previewScale} min={0.25} max={1} def={0.5} onChange={(v) => s.setQuality({ previewScale: v })} />
        </div>
        <div className="row">
          <span className="lbl">FPS de previews</span>
          <Select value={q.previewFps} options={[15, 20, 30, 60].map((f) => ({ value: f, label: `${f} fps` }))} onChange={(v) => s.setQuality({ previewFps: v })} />
        </div>
        <div className="row">
          <span className="lbl">FPS objetivo del motor</span>
          <Select value={q.maxFps} options={[24, 30, 50, 60, 120].map((f) => ({ value: f, label: `${f} fps` }))} onChange={(v) => s.setQuality({ maxFps: v })} />
        </div>
        <div className="row">
          <span className="lbl">Calidad de partículas</span>
          <Slider value={q.particleQuality} min={0} max={1} def={0.6} onChange={(v) => s.setQuality({ particleQuality: v })} />
        </div>
        <div className="hint">Se pueden reducir previews, FPS de previews, resolución de tracking y partículas. La resolución y el FPS configurados en cada salida se respetan siempre.</div>
      </Section>
    </div>
  );
}

function K({ t, v, warn }: { t: string; v: string | number; warn?: boolean }) {
  return (
    <div className="k" style={{ borderColor: warn ? 'var(--warn)' : undefined }}>
      <div className="v" style={{ fontSize: 16 }}>{v}</div>
      <div className="t">{t}</div>
    </div>
  );
}

function Graph() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const W = (c.width = c.clientWidth);
    const H = (c.height = 110);
    const g = c.getContext('2d')!;
    g.fillStyle = '#0a0b0d';
    g.fillRect(0, 0, W, H);
    const line = (key: 'fps' | 'frameMs' | 'gpu', max: number, color: string) => {
      g.strokeStyle = color;
      g.beginPath();
      history.forEach((sm, i) => {
        const v = sm[key] ?? 0;
        const x = (i / 119) * W;
        const y = H - (Math.min(max, v) / max) * (H - 10) - 5;
        if (i) g.lineTo(x, y);
        else g.moveTo(x, y);
      });
      g.stroke();
    };
    line('fps', 70, '#19c3ff');
    line('frameMs', 33, '#ffb020');
    line('gpu', 100, '#a07cff');
    g.fillStyle = '#aab2bf';
    g.font = '10px Segoe UI';
    g.fillText('FPS (azul) · frame ms (ámbar) · GPU % (violeta) — 2 min', 6, 12);
  });
  return <canvas ref={ref} style={{ width: '100%', height: 110, marginTop: 8, borderRadius: 4 }} />;
}
