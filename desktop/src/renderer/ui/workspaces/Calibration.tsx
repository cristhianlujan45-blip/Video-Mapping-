import { useRef, useState } from 'react';
import type { Vec2 } from '../../../shared/geometry/homography';
import { bitsFor, camToProj, correspondences, decodeGray, largestContour, quadCorners, ransacHomography, simplifyPolygon, type DecodeResult, type GrayCapture } from '../../../shared/calibration/structuredLight';
import { createSurface } from '../../../shared/project/defaults';
import { useShow } from '../hooks';
import { Field, Section, Select } from '../controls';
import { replaceById } from '../../core/store';
import type { CalibrationPattern } from '../../worker/protocol';

const CW = 640;
const CH = 360;

interface CalibState {
  decode: DecodeResult;
  white: Uint8Array;
  black: Uint8Array;
  frame: ImageData;
  inliers: number;
  total: number;
}

let calib: CalibState | null = null;

/**
 * AUTO CALIBRATION (structured light) + AI-assisted surface creation.
 * Requirements: a live projector output and a camera that sees the projection.
 * The result is an initial configuration that is always editable by hand.
 */
export function CalibrationPanel() {
  const s = useShow();
  const p = s.project;
  const [outId, setOutId] = useState(p.outputs.find((o) => o.kind === 'display')?.id ?? '');
  const [camId, setCamId] = useState(p.cameras[0]?.id ?? '');
  const [progress, setProgress] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<'none' | 'ai' | 'corners'>('none');
  const [corners, setCorners] = useState<Vec2[]>([]);
  const preview = useRef<HTMLCanvasElement>(null);
  const out = p.outputs.find((o) => o.id === outId);

  const run = async () => {
    if (!out) return;
    if (!s.outputs.isOpen(out.id)) {
      s.toast('La salida debe estar EN VIVO (proyectando) para calibrar.', 'warn');
      return;
    }
    setBusy(true);
    try {
      const show = (pattern: CalibrationPattern | null) => s.render.send({ type: 'calibrationPattern', outputId: out.id, pattern });
      const settle = () => new Promise((r) => setTimeout(r, 280));
      const capture = async (pattern: CalibrationPattern): Promise<Uint8Array> => {
        show(pattern);
        await settle();
        const img = await s.cameras.grab(camId, CW, CH);
        if (!img) throw new Error('La cámara no entrega imagen');
        return toGray(img);
      };
      setProgress('Blanco / negro…');
      const white = await capture({ kind: 'white' });
      const black = await capture({ kind: 'black' });
      const xCaps: GrayCapture[] = [];
      const yCaps: GrayCapture[] = [];
      const bx = bitsFor(out.width);
      const by = bitsFor(out.height);
      for (let b = 0; b < bx; b++) {
        setProgress(`Patrón X ${b + 1}/${bx}`);
        xCaps.push({ normal: await capture({ kind: 'gray', axis: 'x', bit: b, inverted: false }), inverted: await capture({ kind: 'gray', axis: 'x', bit: b, inverted: true }) });
      }
      for (let b = 0; b < by; b++) {
        setProgress(`Patrón Y ${b + 1}/${by}`);
        yCaps.push({ normal: await capture({ kind: 'gray', axis: 'y', bit: b, inverted: false }), inverted: await capture({ kind: 'gray', axis: 'y', bit: b, inverted: true }) });
      }
      show(null);
      await settle();
      const frame = (await s.cameras.grab(camId, CW, CH))!;
      setProgress('Decodificando…');
      const decode = decodeGray(CW, CH, white, black, xCaps, yCaps);
      const { cam, proj } = correspondences(decode, 6);
      const r = ransacHomography(cam, proj, 400, 6);
      calib = { decode, white, black, frame, inliers: r?.inliers ?? 0, total: cam.length };
      drawPreview();
      const pct = Math.round((decode.validCount / (CW * CH)) * 100);
      setProgress(decode.validCount < 2000 ? `Calibración fallida: solo ${pct}% de la imagen decodificada. Oscurece la sala, acerca/enfoca la cámara y desactiva el auto-exposición.` : `Listo: ${pct}% de la imagen con correspondencia proyector↔cámara (${calib.inliers}/${calib.total} puntos coherentes con un plano).`);
    } catch (e) {
      s.render.send({ type: 'calibrationPattern', outputId: out.id, pattern: null });
      setProgress(`Error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const drawPreview = () => {
    const c = preview.current;
    if (!c || !calib) return;
    c.width = CW;
    c.height = CH;
    const g = c.getContext('2d')!;
    g.putImageData(calib.frame, 0, 0);
    const d = calib.decode;
    const img = g.getImageData(0, 0, CW, CH);
    for (let i = 0; i < CW * CH; i++) {
      if (!d.valid[i]) continue;
      img.data[i * 4] = img.data[i * 4] * 0.6 + (d.px[i] / (out?.width ?? 1)) * 255 * 0.4;
      img.data[i * 4 + 1] = img.data[i * 4 + 1] * 0.6 + (d.py[i] / (out?.height ?? 1)) * 255 * 0.4;
    }
    g.putImageData(img, 0, 0);
    g.fillStyle = '#ffcc00';
    for (const q of corners) g.fillRect(q.x - 3, q.y - 3, 6, 6);
  };

  const toOutput = (camPts: Vec2[]): Vec2[] | null => {
    if (!calib || !out) return null;
    const res: Vec2[] = [];
    for (const q of camPts) {
      const pp = camToProj(calib.decode, q, 20);
      if (!pp) return null;
      res.push({ x: pp.x / out.width, y: pp.y / out.height });
    }
    return res;
  };

  const addSurface = (poly: Vec2[], name: string) => {
    if (!out) return;
    const quad = quadCorners(poly);
    if (!quad) return;
    const sf = createSurface(name);
    sf.quad = quad;
    if (poly.length > 4) {
      sf.kind = 'polygon';
      sf.polygon = poly;
    }
    s.update((pr) => ({ ...pr, outputs: replaceById(pr.outputs, out.id, (o) => ({ ...o, surfaces: [...o.surfaces, sf] })) }));
    s.ui.selectedOutput = out.id;
    s.ui.selectedSurface = sf.id;
    s.toast(`Superficie «${name}» creada: revísala y ajústala en Mapping`);
  };

  const litArea = () => {
    if (!calib) return;
    const m = new Uint8Array(CW * CH);
    for (let i = 0; i < m.length; i++) m[i] = calib.decode.valid[i];
    const contour = simplifyPolygon(largestContour(m, CW, CH), 3);
    const mapped = toOutput(contour);
    if (!mapped) return s.toast('No se pudo mapear el contorno', 'warn');
    addSurface(mapped, 'Zona detectada');
  };

  const onCanvasClick = async (e: React.MouseEvent) => {
    if (!calib) return;
    const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const q = { x: ((e.clientX - r.left) / r.width) * CW, y: ((e.clientY - r.top) / r.height) * CH };
    if (pick === 'corners') {
      const next = [...corners, q];
      setCorners(next);
      setTimeout(drawPreview);
      if (next.length === 4) {
        const mapped = toOutput(next);
        setCorners([]);
        setPick('none');
        if (mapped) addSurface(mapped, 'Superficie (4 clics)');
        else s.toast('Algún punto cae fuera de la zona calibrada', 'warn');
      }
    } else if (pick === 'ai') {
      setProgress('Segmentando con IA (local)…');
      try {
        const mask = await segmentAt(calib.frame, q.x / CW, q.y / CH);
        const contour = simplifyPolygon(largestContour(mask, CW, CH), 2.5);
        const mapped = toOutput(contour);
        setPick('none');
        if (!mapped || mapped.length < 3) return setProgress('El objeto detectado cae fuera de la zona calibrada.');
        addSurface(mapped, 'Objeto (IA)');
        setProgress(`Objeto segmentado: polígono de ${mapped.length} puntos.`);
      } catch (err) {
        setProgress(`IA no disponible: ${(err as Error).message}`);
      }
    }
  };

  return (
    <Section title="Calibración automática y mapeo con IA">
      <Field label="Proyector">
        <Select value={outId} options={p.outputs.map((o) => ({ value: o.id, label: o.name }))} onChange={setOutId} />
      </Field>
      <Field label="Cámara">
        <Select value={camId} options={p.cameras.map((c) => ({ value: c.id, label: c.name }))} onChange={setCamId} />
      </Field>
      <button className="btn primary" disabled={busy || !out || !camId} onClick={() => void run()}>
        {busy ? 'Calibrando…' : 'AUTO CALIBRATION'}
      </button>
      <div className="small" style={{ margin: '6px 0' }}>{progress}</div>
      <div className="hint">Proyecta códigos Gray y los captura con la cámara para obtener la correspondencia exacta cámara↔proyector. Requiere salida en vivo, cámara fija que vea la proyección y sala oscura. No todos los proyectores/cámaras lo permiten (auto-exposición, latencia): si falla, usa la calibración manual de Mapping.</div>
      {calib && (
        <>
          <canvas ref={preview} style={{ width: '100%', borderRadius: 4, cursor: pick !== 'none' ? 'crosshair' : 'default' }} onClick={(e) => void onCanvasClick(e)} />
          <div className="row">
            <button className="btn sm" onClick={litArea}>
              Superficie = zona iluminada
            </button>
            <button className={`btn sm ${pick === 'corners' ? 'on' : ''}`} onClick={() => { setPick('corners'); setCorners([]); }}>
              4 esquinas (clics)
            </button>
            <button className={`btn sm ${pick === 'ai' ? 'on' : ''}`} onClick={() => setPick('ai')}>
              Detectar objeto con IA (clic)
            </button>
          </div>
          {pick !== 'none' && <div className="hint">{pick === 'ai' ? 'Haz clic sobre el objeto/fachada en la imagen de la cámara.' : `Clic en las esquinas: sup-izq, sup-der, inf-der, inf-izq (${corners.length}/4).`}</div>}
        </>
      )}
    </Section>
  );
}

function toGray(img: ImageData): Uint8Array {
  const g = new Uint8Array(img.width * img.height);
  const d = img.data;
  for (let i = 0; i < g.length; i++) g[i] = (d[i * 4] * 77 + d[i * 4 + 1] * 150 + d[i * 4 + 2] * 29) >> 8;
  return g;
}

let segmenter: { segment: (img: ImageData, roi: { keypoint: { x: number; y: number } }) => { categoryMask?: { getAsUint8Array(): Uint8Array; width: number; height: number; close(): void } } } | null = null;

/** Local AI segmentation (MediaPipe Interactive Segmenter): object under a click → mask. */
async function segmentAt(img: ImageData, x: number, y: number): Promise<Uint8Array> {
  if (!segmenter) {
    const { FilesetResolver, InteractiveSegmenter } = await import('@mediapipe/tasks-vision');
    const fs = await FilesetResolver.forVisionTasks('./mediapipe/wasm');
    segmenter = (await InteractiveSegmenter.createFromOptions(fs, {
      baseOptions: { modelAssetPath: './models/magic_touch.tflite', delegate: 'GPU' },
      outputCategoryMask: true,
      outputConfidenceMasks: false,
    })) as unknown as typeof segmenter;
  }
  const res = segmenter!.segment(img, { keypoint: { x, y } });
  const m = res.categoryMask;
  if (!m) throw new Error('sin máscara');
  const raw = m.getAsUint8Array();
  const w = m.width;
  const h = m.height;
  // the object is whatever class the clicked pixel belongs to
  const fg = raw[Math.min(h - 1, Math.floor(y * h)) * w + Math.min(w - 1, Math.floor(x * w))];
  const out = new Uint8Array(CW * CH);
  for (let yy = 0; yy < CH; yy++)
    for (let xx = 0; xx < CW; xx++) {
      const sx = Math.floor((xx / CW) * w);
      const sy = Math.floor((yy / CH) * h);
      out[yy * CW + xx] = raw[sy * w + sx] === fg ? 1 : 0;
    }
  m.close();
  return out;
}
