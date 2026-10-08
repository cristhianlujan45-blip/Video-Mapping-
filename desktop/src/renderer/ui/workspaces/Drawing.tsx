import { useEffect, useMemo, useRef, useState } from 'react';
import { BRUSHES, BRUSH_CATEGORIES, brushById, type BrushPreset } from '../../../shared/brushes';
import type { Composition, DrawingLayerDef, Layer } from '../../../shared/project/model';
import { uid } from '../../../shared/project/model';
import { createLayer } from '../../../shared/project/defaults';
import type { DrawStroke, StrokeBrush } from '../../worker/protocol';
import { useShow } from '../hooks';
import { Icon } from '../icons';
import { Check, ColorInput, Field, ParamSlider, Section, Select, Slider, TextInput } from '../controls';
import { ViewCanvas } from '../ViewCanvas';
import { FitBox } from '../FitBox';
import { moveItem, replaceById } from '../../core/store';
import { LayerInspector } from './Vj';

const FAV_KEY = 'lujan.brushFavorites';
const CUSTOM_KEY = 'lujan.customBrushes';

function loadJson<T>(k: string, fb: T): T {
  try {
    return JSON.parse(localStorage.getItem(k) ?? '') as T;
  } catch {
    return fb;
  }
}

export function DrawingWorkspace() {
  const s = useShow();
  const p = s.project;
  const comp = p.compositions.find((c) => c.id === s.ui.selectedComp) ?? p.compositions.find((c) => c.id === p.mixer.deckA) ?? p.compositions[0];
  const drawLayers = comp ? comp.layers.filter((l) => l.source.type === 'drawing') : [];
  const [active, setActive] = useState<string | null>(null);
  const activeLayer = drawLayers.find((l) => l.id === active) ?? drawLayers[drawLayers.length - 1] ?? null;
  const drawingId = activeLayer?.source.type === 'drawing' ? activeLayer.source.drawingId : null;
  const def = p.drawings.find((d) => d.id === drawingId) ?? null;

  const [brushId, setBrushId] = useState('pencil');
  const [custom, setCustom] = useState<BrushPreset[]>(() => loadJson(CUSTOM_KEY, []));
  const [favs, setFavs] = useState<string[]>(() => loadJson(FAV_KEY, ['pencil', 'marker', 'graffiti-spray', 'neon', 'watercolor']));
  const [cat, setCat] = useState<string>('Favoritos');
  const base = custom.find((b) => b.id === brushId) ?? brushById(brushId);
  const [over, setOver] = useState<Partial<BrushPreset>>({});
  const [color, setColor] = useState('#19c3ff');
  const [erase, setErase] = useState(false);
  const [zoom, setZoom] = useState(1);
  const brush: StrokeBrush = { ...base, ...over, size: s.engine.value('draw.size', base.size), opacity: s.engine.value('draw.opacity', base.opacity), color: hex(color), erase };

  useEffect(() => {
    // sizes/opacity of the new brush become the live (MIDI-learnable) draw params
    s.setParam('draw.size', base.size);
    s.setParam('draw.opacity', base.opacity);
    setOver({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brushId]);

  const all = [...BRUSHES, ...custom];
  const shown = cat === 'Favoritos' ? all.filter((b) => favs.includes(b.id)) : cat === 'Personalizados' ? custom : all.filter((b) => b.category === cat);

  return (
    <div className="cols">
      <div className="panel" style={{ width: 300 }}>
        <div className="panel-title">Pinceles</div>
        <div className="panel-body">
          <select value={cat} onChange={(e) => setCat(e.target.value)} style={{ width: '100%', marginBottom: 6 }}>
            {['Favoritos', ...BRUSH_CATEGORIES, 'Personalizados'].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <div className="brush-grid">
            {shown.map((b) => (
              <div key={b.id} className={`brush ${brushId === b.id ? 'sel' : ''}`} onClick={() => { setBrushId(b.id); setErase(false); }} onDoubleClick={() => toggleFav(b.id)} title="Doble clic: favorito">
                <BrushPreview brush={b} color={color} />
                {favs.includes(b.id) ? '★ ' : ''}
                {b.name}
              </div>
            ))}
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn sm" onClick={() => saveCustom()}>Guardar pincel actual</button>
            <label className="btn sm">
              Importar paquete
              <input type="file" accept=".json" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && void importPack(e.target.files[0])} />
            </label>
            <button className="btn sm" disabled={!custom.length} onClick={() => exportPack()}>
              Exportar
            </button>
          </div>
          <Section title="Parámetros">
            <div className="row">
              <ColorInput value={color} onChange={setColor} />
              <button className={`btn sm ${erase ? 'on' : ''}`} onClick={() => setErase(!erase)}>
                Goma
              </button>
            </div>
            <ParamSlider id="draw.size" label="Tamaño (px)" />
            <ParamSlider id="draw.opacity" label="Opacidad" />
            {(
              [
                ['flow', 'Flujo', 0, 1],
                ['density', 'Densidad', 1, 10],
                ['hardness', 'Dureza', 0, 1],
                ['spacing', 'Espaciado', 0.01, 2],
                ['smoothing', 'Suavizado', 0, 0.95],
                ['scatter', 'Dispersión', 0, 4],
                ['angle', 'Rotación', 0, 360],
                ['glow', 'Brillo', 0, 2],
              ] as [keyof BrushPreset, string, number, number][]
            ).map(([k, label, min, max]) => (
              <div className="row" key={k}>
                <Slider value={(brush[k] as number) ?? 0} min={min} max={max} label={label} def={base[k] as number} onChange={(v) => setOver((o) => ({ ...o, [k]: v }))} />
              </div>
            ))}
            <Check checked={brush.pressureSize} onChange={(v) => setOver((o) => ({ ...o, pressureSize: v }))} label="Presión → tamaño" />
            <Check checked={brush.pressureOpacity} onChange={(v) => setOver((o) => ({ ...o, pressureOpacity: v }))} label="Presión → opacidad" />
            <div className="row">
              <Slider value={brush.velocitySize} min={-1} max={1} def={base.velocitySize} label="Velocidad → tamaño" onChange={(v) => setOver((o) => ({ ...o, velocitySize: v }))} />
            </div>
          </Section>
        </div>
      </div>
      <div className="col" style={{ flex: 1, padding: 8, gap: 8 }}>
        <div className="row" style={{ margin: 0 }}>
          <span className="small muted">Dibujas sobre la escena «{comp?.name}» (video, cámara, generadores…). Ctrl+rueda: zoom del lienzo · Ctrl+Z deshacer.</span>
          <span className="spacer" />
          <button className="btn sm" onClick={() => setZoom(1)}>Zoom {Math.round(zoom * 100)}%</button>
        </div>
        {comp && def ? (
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex' }} onWheel={(e) => { if (e.ctrlKey) setZoom((z) => Math.max(0.25, Math.min(8, z * (e.deltaY < 0 ? 1.1 : 0.9)))); }}>
            <div style={{ flex: 1, minHeight: 0, display: 'flex', transform: `scale(${zoom})`, transformOrigin: 'top left' }}>
              <FitBox aspect={comp.width / comp.height}>
                <ViewCanvas spec={{ kind: 'composition', target: comp.id, everyNth: 1 }} style={{ position: 'absolute', inset: 0 }} />
                <DrawSurface drawing={def} brush={brush} locked={activeLayer?.locked ?? false} />
              </FitBox>
            </div>
          </div>
        ) : (
          <div className="hint" style={{ padding: 20 }}>
            Crea una capa de dibujo para empezar.{' '}
            <button className="btn primary" onClick={() => newDrawing()}>
              Nueva capa de dibujo
            </button>
          </div>
        )}
      </div>
      <div className="panel right" style={{ width: 320 }}>
        <div className="panel-title">
          Capas de dibujo
          <span className="spacer" />
          <button className="btn sm" onClick={() => newDrawing()}>
            <Icon name="plus" />
          </button>
        </div>
        <div className="panel-body">
          <div className="list">
            {[...drawLayers].reverse().map((l) => {
              const idx = comp!.layers.indexOf(l);
              const d = p.drawings.find((x) => l.source.type === 'drawing' && x.id === l.source.drawingId);
              return (
                <div key={l.id} className={`item ${activeLayer?.id === l.id ? 'sel' : ''}`} onClick={() => setActive(l.id)}>
                  <button className="btn icon sm" onClick={(e) => { e.stopPropagation(); s.setParam(`layer.${l.id}.visible`, l.visible ? 0 : 1); }}>
                    <Icon name={l.visible ? 'eye' : 'eyeoff'} />
                  </button>
                  <span className="name">
                    {l.name}
                    <div className="small muted">{d?.strokes.length ?? 0} trazos</div>
                  </span>
                  <button className="btn icon sm" title={l.locked ? 'Desbloquear' : 'Bloquear'} onClick={(e) => { e.stopPropagation(); updLayer(l.id, (x) => ({ ...x, locked: !x.locked })); }}>
                    <Icon name={l.locked ? 'lock' : 'unlock'} />
                  </button>
                  <button className="btn icon sm" title="Subir" onClick={(e) => { e.stopPropagation(); updComp((c) => ({ ...c, layers: moveItem(c.layers, idx, idx + 1) })); }}>
                    <Icon name="up" />
                  </button>
                  <button className="btn icon sm" title="Bajar" onClick={(e) => { e.stopPropagation(); updComp((c) => ({ ...c, layers: moveItem(c.layers, idx, idx - 1) })); }}>
                    <Icon name="down" />
                  </button>
                  <button className="btn icon sm" title="Duplicar" onClick={(e) => { e.stopPropagation(); if (d) duplicate(l, d); }}>
                    <Icon name="copy" />
                  </button>
                  <button className="btn icon sm" title="Eliminar" onClick={(e) => { e.stopPropagation(); remove(l); }}>
                    <Icon name="trash" />
                  </button>
                </div>
              );
            })}
          </div>
          {def && (
            <>
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn sm" disabled={!def.strokes.length} onClick={() => s.update((pr) => ({ ...pr, drawings: replaceById(pr.drawings, def.id, (d) => ({ ...d, strokes: d.strokes.slice(0, -1) })) }))}>
                  <Icon name="undo" /> Deshacer trazo
                </button>
                <button className="btn sm danger" disabled={!def.strokes.length} onClick={() => s.update((pr) => ({ ...pr, drawings: replaceById(pr.drawings, def.id, (d) => ({ ...d, strokes: [] })) }))}>
                  Borrar todo
                </button>
              </div>
              <Field label="Nombre">
                <TextInput value={def.name} onChange={(v) => s.update((pr) => ({ ...pr, drawings: replaceById(pr.drawings, def.id, (d) => ({ ...d, name: v })) }))} />
              </Field>
            </>
          )}
          {activeLayer && comp && <LayerInspector comp={comp} layer={activeLayer} />}
        </div>
      </div>
    </div>
  );

  function updComp(fn: (c: Composition) => Composition) {
    if (!comp) return;
    s.update((pr) => ({ ...pr, compositions: replaceById(pr.compositions, comp.id, fn) }));
  }
  function updLayer(id: string, fn: (l: Layer) => Layer) {
    updComp((c) => ({ ...c, layers: replaceById(c.layers, id, fn) }));
  }
  function newDrawing() {
    if (!comp) return;
    const d: DrawingLayerDef = { id: uid('draw'), name: `Dibujo ${p.drawings.length + 1}`, width: comp.width, height: comp.height, strokes: [] };
    const l = createLayer({ type: 'drawing', drawingId: d.id }, d.name);
    s.update((pr) => ({ ...pr, drawings: [...pr.drawings, d], compositions: replaceById(pr.compositions, comp.id, (c) => ({ ...c, layers: [...c.layers, l] })) }));
    setActive(l.id);
  }
  function duplicate(l: Layer, d: DrawingLayerDef) {
    const nd: DrawingLayerDef = { ...structuredClone(d), id: uid('draw'), name: `${d.name} copia` };
    const nl = { ...createLayer({ type: 'drawing', drawingId: nd.id }, nd.name), opacity: l.opacity, blend: l.blend };
    s.update((pr) => ({ ...pr, drawings: [...pr.drawings, nd], compositions: replaceById(pr.compositions, comp!.id, (c) => ({ ...c, layers: [...c.layers, nl] })) }));
  }
  function remove(l: Layer) {
    const did = l.source.type === 'drawing' ? l.source.drawingId : null;
    s.update((pr) => ({
      ...pr,
      drawings: pr.drawings.filter((x) => x.id !== did || pr.compositions.some((c) => c.layers.some((y) => y.id !== l.id && y.source.type === 'drawing' && y.source.drawingId === did))),
      compositions: replaceById(pr.compositions, comp!.id, (c) => ({ ...c, layers: c.layers.filter((x) => x.id !== l.id) })),
    }));
  }
  function toggleFav(id: string) {
    const next = favs.includes(id) ? favs.filter((x) => x !== id) : [...favs, id];
    setFavs(next);
    localStorage.setItem(FAV_KEY, JSON.stringify(next));
  }
  function saveCustom() {
    const name = `${base.name} (mío ${custom.length + 1})`;
    const b: BrushPreset = { ...base, ...over, id: uid('brush'), name, size: brush.size, opacity: brush.opacity };
    const next = [...custom, b];
    setCustom(next);
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(next));
    setBrushId(b.id);
  }
  async function importPack(f: File) {
    try {
      const data = JSON.parse(await f.text()) as BrushPreset[] | { brushes: BrushPreset[] };
      const list = (Array.isArray(data) ? data : data.brushes).filter((b) => typeof b.tip === 'number' && typeof b.name === 'string');
      const next = [...custom, ...list.map((b) => ({ ...brushById('round-brush'), ...b, id: uid('brush'), category: b.category ?? 'Pinceles' }))];
      setCustom(next);
      localStorage.setItem(CUSTOM_KEY, JSON.stringify(next));
      s.toast(`${list.length} pincel(es) importados`);
    } catch (e) {
      s.toast(`Paquete de pinceles inválido: ${(e as Error).message}`, 'error');
    }
  }
  function exportPack() {
    const blob = new Blob([JSON.stringify({ format: 'lujan-brushes', brushes: custom }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'pinceles-lujan.json';
    a.click();
  }
}

function hex(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * Pointer capture surface. Coalesced pointer events (full digitizer rate) with pen
 * pressure are streamed to the GPU brush engine once per frame. No loupe/magnifier.
 */
function DrawSurface({ drawing, brush, locked }: { drawing: DrawingLayerDef; brush: StrokeBrush; locked: boolean }) {
  const s = useShow();
  const ref = useRef<HTMLDivElement>(null);
  const stroke = useRef<{ id: number; pending: number[]; all: number[]; started: boolean; brush: StrokeBrush } | null>(null);
  const raf = useRef(0);
  const brushRef = useRef(brush);
  brushRef.current = brush;

  const flush = (end: boolean) => {
    const st = stroke.current;
    if (!st || (!st.pending.length && !end)) return;
    const msg: DrawStroke = { layerId: drawing.id, brush: st.brush, points: new Float32Array(st.pending), start: !st.started, end, strokeId: st.id };
    st.started = true;
    st.pending = [];
    s.render.send({ type: 'stroke', stroke: msg });
  };

  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  const cursor = useMemo(() => {
    const size = Math.max(4, Math.min(128, brush.size / 2));
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size + 2}' height='${size + 2}'><circle cx='${size / 2 + 1}' cy='${size / 2 + 1}' r='${size / 2}' fill='none' stroke='white' stroke-opacity='0.7'/></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${size / 2 + 1} ${size / 2 + 1}, crosshair`;
  }, [brush.size]);

  const sample = (e: PointerEvent, out: number[]) => {
    const r = ref.current!.getBoundingClientRect();
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
    for (const ev of events.length ? events : [e]) {
      const pressure = ev.pointerType === 'pen' ? ev.pressure : ev.pointerType === 'touch' ? 0.6 : 0.5;
      out.push((ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height, pressure, ev.timeStamp);
    }
  };

  return (
    <div
      ref={ref}
      style={{ position: 'absolute', inset: 0, zIndex: 4, cursor: locked ? 'not-allowed' : cursor, touchAction: 'none' }}
      onPointerDown={(e) => {
        if (locked || e.button !== 0) return;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        stroke.current = { id: Date.now() % 2147483646, pending: [], all: [], started: false, brush: { ...brushRef.current } };
        const pts: number[] = [];
        sample(e.nativeEvent, pts);
        stroke.current.pending.push(...pts);
        stroke.current.all.push(...pts);
        flush(false);
        const loop = () => {
          flush(false);
          raf.current = requestAnimationFrame(loop);
        };
        raf.current = requestAnimationFrame(loop);
      }}
      onPointerMove={(e) => {
        const st = stroke.current;
        if (!st) return;
        const pts: number[] = [];
        sample(e.nativeEvent, pts);
        st.pending.push(...pts);
        st.all.push(...pts);
      }}
      onPointerUp={() => {
        const st = stroke.current;
        if (!st) return;
        cancelAnimationFrame(raf.current);
        flush(true);
        stroke.current = null;
        // commit to the project (undoable); it is already drawn on the GPU
        s.liveStroke = drawing.id;
        s.update((pr) => ({ ...pr, drawings: replaceById(pr.drawings, drawing.id, (d) => ({ ...d, strokes: [...d.strokes, { id: st.id, brush: st.brush as unknown as Record<string, unknown>, points: st.all.map((v, i) => (i % 4 === 3 ? Math.round(v) : Math.round(v * 10000) / 10000)) }] })) }));
      }}
    />
  );
}

/** Lightweight 2D preview of a brush in the gallery (the real stroke is drawn on the GPU). */
function BrushPreview({ brush, color }: { brush: BrushPreset; color: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    c.width = 120;
    c.height = 34;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, 120, 34);
    const n = 40;
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = 8 + t * 104;
      const y = 17 + Math.sin(t * Math.PI * 2) * 8;
      const size = Math.max(1, Math.min(14, brush.size * 0.25)) * (brush.pressureSize ? 0.4 + 0.6 * Math.sin(t * Math.PI) : 1);
      g.globalAlpha = brush.opacity * (brush.tip === 2 ? 0.3 : 0.6);
      g.globalCompositeOperation = brush.additive ? 'lighter' : 'source-over';
      g.fillStyle = brush.tip === 8 ? `hsl(${30 - t * 20} 100% 55%)` : brush.hueCycle ? `hsl(${t * 360} 90% 60%)` : color;
      if (brush.tip === 2) {
        for (let k = 0; k < 8; k++) g.fillRect(x + (rnd() - 0.5) * size * 2, y + (rnd() - 0.5) * size * 2, 1, 1);
      } else if (brush.tip === 9) g.fillRect(Math.round(x / 4) * 4, Math.round(y / 4) * 4, 4, 4);
      else {
        if (brush.tip === 6) {
          g.shadowColor = color;
          g.shadowBlur = 6;
        }
        g.beginPath();
        g.ellipse(x, y, size / 2, (size / 2) * brush.aspect, (brush.angle * Math.PI) / 180, 0, Math.PI * 2);
        g.fill();
        g.shadowBlur = 0;
      }
    }
  }, [brush, color]);
  return <canvas ref={ref} />;
}
