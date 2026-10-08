import { useEffect, useRef, useState } from 'react';
import type { CameraDef, TrackingSettings, Zone } from '../../../shared/project/model';
import { uid } from '../../../shared/project/model';
import { FEATURE_LABELS, POSE_CONNECTIONS, POSE_STRIDE } from '../../../shared/tracking/pose';
import { useShow, useTicker } from '../hooks';
import { Icon } from '../icons';
import { Check, Field, NumberInput, Section, Select, TextInput } from '../controls';
import { ViewCanvas } from '../ViewCanvas';
import { FitBox } from '../FitBox';
import { replaceById } from '../../core/store';
import { QUALITY_RES, TRACKING_PROVIDERS } from '../../core/tracking';

export function CamerasWorkspace() {
  const s = useShow();
  const p = s.project;
  const [sel, setSel] = useState<string | null>(p.cameras[0]?.id ?? null);
  const cam = p.cameras.find((c) => c.id === sel) ?? null;
  useEffect(() => {
    void s.cameras.refreshDevices();
  }, [s]);
  const devices = s.cameras.devices.filter((d) => d.kind === 'videoinput');

  return (
    <div className="cols">
      <div className="panel" style={{ width: 300 }}>
        <div className="panel-title">Cámaras</div>
        <div className="panel-body">
          <Section title="Dispositivos de video detectados" right={<button className="btn sm" onClick={() => void s.cameras.refreshDevices()}>Buscar</button>}>
            {devices.length === 0 && <div className="hint">No hay cámaras ni capturadoras visibles para Windows.</div>}
            {devices.map((d) => {
              const used = p.cameras.some((c) => c.deviceId === d.deviceId || c.label === d.label);
              return (
                <div className="row" key={d.deviceId}>
                  <span className="small" style={{ flex: 1 }}>{d.label}</span>
                  <button className="btn sm" disabled={used} onClick={() => addCam(d.deviceId, d.label)}>
                    {used ? 'Añadida' : 'Añadir'}
                  </button>
                </div>
              );
            })}
            <button className="btn sm" onClick={() => addUrl()}>
              + Cámara IP / stream (URL)
            </button>
          </Section>
          <Section title="Fuentes de cámara del proyecto">
            <div className="list">
              {p.cameras.map((c) => {
                const st = s.cameras.state.get(c.id);
                return (
                  <div key={c.id} className={`item ${sel === c.id ? 'sel' : ''}`} onClick={() => setSel(c.id)}>
                    <span className={`status-dot ${st?.status === 'live' ? 'ok' : st?.status === 'offline' || st?.status === 'error' ? 'err' : 'warn'}`} />
                    <span className="name">
                      {c.name}
                      <div className="small muted">{st?.status === 'live' ? `${st.width}×${st.height} @ ${st.fps}` : st?.status === 'offline' ? `OFFLINE · ${st.message ?? ''}` : st?.status ?? ''}</div>
                    </span>
                  </div>
                );
              })}
            </div>
          </Section>
        </div>
      </div>
      <div className="col" style={{ flex: 1, padding: 8, gap: 8 }}>
        {cam ? (
          <>
            <FitBox aspect={(s.cameras.state.get(cam.id)?.width || 16) / (s.cameras.state.get(cam.id)?.height || 9)}>
              <ViewCanvas key={cam.id} spec={{ kind: 'source', target: `camera:${cam.id}` }} label={cam.name} style={{ position: 'absolute', inset: 0 }} />
              {p.tracking.cameraId === cam.id && <TrackingOverlay mirror={p.tracking.mirror} zones={p.tracking.zones} />}
            </FitBox>
          </>
        ) : (
          <div className="hint" style={{ padding: 20 }}>Añade una cámara (webcam, USB, capturadora HDMI/SDI o cámara IP).</div>
        )}
      </div>
      <div className="panel right" style={{ width: 340 }}>
        <div className="panel-title">Cámara y tracking</div>
        <div className="panel-body">
          {cam && <CameraInspector cam={cam} />}
          <TrackingPanel />
        </div>
      </div>
    </div>
  );

  function addCam(deviceId: string, label: string) {
    const c: CameraDef = { id: uid('cam'), name: label.replace(/\(.*?\)/g, '').trim() || 'Cámara', kind: 'local', deviceId, label, width: 1920, height: 1080, fps: 30, enabled: true };
    s.update((pr) => ({ ...pr, cameras: [...pr.cameras, c] }));
    setSel(c.id);
  }

  function addUrl() {
    const c: CameraDef = { id: uid('cam'), name: 'Cámara IP', kind: 'url', deviceId: '', label: '', url: 'http://', width: 1920, height: 1080, fps: 30, enabled: false };
    s.update((pr) => ({ ...pr, cameras: [...pr.cameras, c] }));
    setSel(c.id);
  }
}

function CameraInspector({ cam }: { cam: CameraDef }) {
  const s = useShow();
  const upd = (fn: (c: CameraDef) => CameraDef) => s.update((pr) => ({ ...pr, cameras: replaceById(pr.cameras, cam.id, fn) }));
  const st = s.cameras.state.get(cam.id);
  return (
    <Section title={cam.name}>
      <Field label="Nombre">
        <TextInput value={cam.name} onChange={(v) => upd((c) => ({ ...c, name: v }))} />
      </Field>
      <Check checked={cam.enabled} onChange={(v) => upd((c) => ({ ...c, enabled: v }))} label="Activa" />
      {cam.kind === 'url' ? (
        <Field label="URL">
          <TextInput value={cam.url ?? ''} onChange={(v) => upd((c) => ({ ...c, url: v }))} placeholder="http://192.168.1.50/video.mjpg" />
        </Field>
      ) : (
        <Field label="Dispositivo">
          <Select
            value={cam.deviceId}
            options={s.cameras.devices.filter((d) => d.kind === 'videoinput').map((d) => ({ value: d.deviceId, label: d.label }))}
            onChange={(v) => upd((c) => ({ ...c, deviceId: v, label: s.cameras.devices.find((d) => d.deviceId === v)?.label ?? c.label }))}
          />
        </Field>
      )}
      <Field label="Resolución">
        <Select
          value={`${cam.width}x${cam.height}`}
          options={['640x480', '1280x720', '1920x1080', '2560x1440', '3840x2160'].map((r) => ({ value: r, label: r.replace('x', '×') }))}
          onChange={(v) => {
            const [w, h] = v.split('x').map(Number);
            upd((c) => ({ ...c, width: w, height: h }));
          }}
        />
      </Field>
      <Field label="FPS">
        <Select value={cam.fps} options={[15, 24, 25, 30, 50, 60].map((f) => ({ value: f, label: String(f) }))} onChange={(v) => upd((c) => ({ ...c, fps: v }))} />
      </Field>
      {st && <div className="small muted">Estado: {st.status} {st.message ? `· ${st.message}` : ''} {st.status === 'live' ? `· real ${st.width}×${st.height} @ ${st.fps} fps` : ''}</div>}
      {cam.kind === 'url' && <div className="hint">Admite streams que Chromium reproduce de forma nativa (MJPEG por HTTP, HLS, MP4). RTSP/SRT/NDI: módulo de red EN DESARROLLO.</div>}
      <button className="btn sm danger" onClick={() => s.update((pr) => ({ ...pr, cameras: pr.cameras.filter((c) => c.id !== cam.id), tracking: pr.tracking.cameraId === cam.id ? { ...pr.tracking, cameraId: null, enabled: false } : pr.tracking }))}>
        Quitar cámara
      </button>
    </Section>
  );
}

export function TrackingPanel() {
  const s = useShow();
  const t = s.project.tracking;
  useTicker(500);
  const upd = (patch: Partial<TrackingSettings>) => s.update((pr) => ({ ...pr, tracking: { ...pr.tracking, ...patch } }));
  const [tw, th] = QUALITY_RES[t.quality];
  return (
    <>
      <Section title="Tracking corporal">
        <Check checked={t.enabled} onChange={(v) => upd({ enabled: v })} label="Activar tracking" />
        <Field label="Proveedor">
          <Select value={t.provider} options={TRACKING_PROVIDERS.map((p) => ({ value: p.id, label: `${p.name}${p.available ? '' : ' (EN DESARROLLO)'}` }))} onChange={(v) => upd({ provider: v })} />
        </Field>
        <div className="hint">{TRACKING_PROVIDERS.find((p) => p.id === t.provider)?.note}</div>
        <Field label="Cámara">
          <Select value={t.cameraId ?? ''} options={[{ value: '', label: '— elegir —' }, ...s.project.cameras.map((c) => ({ value: c.id, label: c.name }))]} onChange={(v) => upd({ cameraId: v || null })} />
        </Field>
        <Field label="Calidad">
          <Select value={t.quality} options={[{ value: 'low', label: 'Baja' }, { value: 'medium', label: 'Media' }, { value: 'high', label: 'Alta' }, { value: 'ultra', label: 'Ultra' }]} onChange={(v) => upd({ quality: v })} />
        </Field>
        <div className="small muted">Resolución de tracking: {tw}×{th} (independiente de la cámara y de la salida)</div>
        <Field label="FPS de tracking">
          <Select value={t.fps} options={[15, 24, 30, 60].map((f) => ({ value: f as 15, label: String(f) }))} onChange={(v) => upd({ fps: v })} />
        </Field>
        <Field label="Máx. personas">
          <NumberInput value={t.maxPeople} min={1} max={6} onChange={(v) => upd({ maxPeople: v })} />
        </Field>
        <Check checked={t.hands} onChange={(v) => upd({ hands: v })} label="Manos (21 puntos por mano)" />
        <Check checked={t.segmentation} onChange={(v) => upd({ segmentation: v })} label="Silueta (segmentación)" />
        <Check checked={t.mirror} onChange={(v) => upd({ mirror: v })} label="Espejo" />
        <div className="row">
          <span className={`badge ${s.tracking.status === 'running' ? 'ok' : s.tracking.status === 'error' ? 'err' : ''}`}>{s.tracking.status}</span>
          {s.tracking.delegate && <span className="badge">{s.tracking.delegate === 'GPU' ? 'GPU' : 'CPU'}</span>}
          {s.tracking.status === 'running' && (
            <span className="small muted">
              {s.tracking.people.length} persona(s) · {s.tracking.fps} fps · {s.tracking.inferenceMs} ms
            </span>
          )}
        </div>
        {s.tracking.message && <div className="small" style={{ color: 'var(--err)' }}>{s.tracking.message}</div>}
      </Section>
      <Section title="Zonas interactivas" right={<button className="btn sm" onClick={() => upd({ zones: [...t.zones, { id: uid('zone'), name: `Zona ${t.zones.length + 1}`, rect: { x: 0.35, y: 0.3, w: 0.3, h: 0.5 }, enabled: true }] })}><Icon name="plus" /></button>}>
        {t.zones.map((z) => (
          <ZoneRow key={z.id} z={z} onChange={(nz) => upd({ zones: t.zones.map((x) => (x.id === z.id ? nz : x)) })} onDelete={() => upd({ zones: t.zones.filter((x) => x.id !== z.id) })} />
        ))}
        <div className="hint">Cada zona publica zone.&lt;id&gt;.count / occupied. Crea acciones en Show → Reglas (o pídelo al asistente IA).</div>
      </Section>
      <Section title="Señales en vivo">
        <div className="small mono" style={{ maxHeight: 220, overflow: 'auto' }}>
          {Object.keys(FEATURE_LABELS)
            .filter((k) => k.startsWith('tracking.'))
            .map((k) => (
              <div key={k} className="row" style={{ margin: 0 }}>
                <span style={{ flex: 1 }} className="muted">{FEATURE_LABELS[k]}</span>
                <span>{s.bus.has(k) ? s.bus.get(k).toFixed(2) : '—'}</span>
              </div>
            ))}
        </div>
      </Section>
    </>
  );
}

function ZoneRow({ z, onChange, onDelete }: { z: Zone; onChange: (z: Zone) => void; onDelete: () => void }) {
  const s = useShow();
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 6, padding: 6, margin: '4px 0' }}>
      <div className="row">
        <Check checked={z.enabled} onChange={(v) => onChange({ ...z, enabled: v })} label="" />
        <TextInput value={z.name} onChange={(v) => onChange({ ...z, name: v })} />
        <span className="badge">{s.bus.get(`zone.${z.id}.count`)} pers.</span>
        <button className="btn icon sm" onClick={onDelete}>
          <Icon name="trash" />
        </button>
      </div>
      <div className="row small">
        x <NumberInput width={52} step={0.05} value={z.rect.x} min={0} max={1} onChange={(v) => onChange({ ...z, rect: { ...z.rect, x: v } })} />
        y <NumberInput width={52} step={0.05} value={z.rect.y} min={0} max={1} onChange={(v) => onChange({ ...z, rect: { ...z.rect, y: v } })} />
        w <NumberInput width={52} step={0.05} value={z.rect.w} min={0} max={1} onChange={(v) => onChange({ ...z, rect: { ...z.rect, w: v } })} />
        h <NumberInput width={52} step={0.05} value={z.rect.h} min={0} max={1} onChange={(v) => onChange({ ...z, rect: { ...z.rect, h: v } })} />
      </div>
    </div>
  );
}

/** Skeleton + zones drawn over the camera monitor (UI only, at monitor refresh). */
function TrackingOverlay({ mirror, zones }: { mirror: boolean; zones: Zone[] }) {
  const s = useShow();
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let h = 0;
    const draw = () => {
      h = requestAnimationFrame(draw);
      const c = ref.current;
      if (!c) return;
      const W = (c.width = c.clientWidth);
      const H = (c.height = c.clientHeight);
      const g = c.getContext('2d')!;
      g.clearRect(0, 0, W, H);
      g.lineWidth = 2;
      for (const z of zones) {
        const n = s.bus.get(`zone.${z.id}.count`);
        g.strokeStyle = n ? '#33d17a' : 'rgba(255,255,255,0.5)';
        g.setLineDash([6, 4]);
        g.strokeRect(z.rect.x * W, z.rect.y * H, z.rect.w * W, z.rect.h * H);
        g.setLineDash([]);
        g.fillStyle = g.strokeStyle;
        g.fillText(`${z.name} (${n})`, z.rect.x * W + 4, z.rect.y * H + 12);
      }
      for (const p of s.tracking.people) {
        const lm = p.landmarks;
        const X = (i: number) => (mirror ? 1 - lm[i * POSE_STRIDE] : lm[i * POSE_STRIDE]) * W;
        const Y = (i: number) => lm[i * POSE_STRIDE + 1] * H;
        g.strokeStyle = `hsl(${(p.id * 61) % 360} 90% 60%)`;
        for (const [a, b] of POSE_CONNECTIONS) {
          if (lm[a * POSE_STRIDE + 3] < 0.4 || lm[b * POSE_STRIDE + 3] < 0.4) continue;
          g.beginPath();
          g.moveTo(X(a), Y(a));
          g.lineTo(X(b), Y(b));
          g.stroke();
        }
        g.fillStyle = '#fff';
        g.fillText(`#${p.id}`, X(0) + 6, Y(0));
      }
    };
    draw();
    return () => cancelAnimationFrame(h);
  }, [s, mirror, zones]);
  return <canvas ref={ref} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 3 }} />;
}
