import { useState } from 'react';
import type { MediaItem, MediaKind } from '../../../shared/project/model';
import { createLayer } from '../../../shared/project/defaults';
import { useShow } from '../hooks';
import { Icon } from '../icons';
import { InDevelopment, Section, Seg } from '../controls';
import { ViewCanvas } from '../ViewCanvas';
import { lujan } from '../../api';
import { replaceById } from '../../core/store';
import { show } from '../../core/show';

const KIND_LABEL: Record<MediaKind, string> = { video: 'Video', image: 'Imagen', audio: 'Audio', model3d: 'Modelo 3D' };

export async function importFromDialog(kinds?: MediaKind[], addToComp?: string | null) {
  const items = (await lujan!.invoke<MediaItem[]>('media:import', kinds)) ?? [];
  await show.importMedia(items, addToComp);
  return items;
}

/** Drag & drop files from Explorer. */
export function useDropImport(addToComp?: string | null) {
  const s = useShow();
  return {
    onDragOver: (e: React.DragEvent) => e.preventDefault(),
    onDrop: async (e: React.DragEvent) => {
      e.preventDefault();
      const paths = [...e.dataTransfer.files].map((f) => lujan!.pathForFile(f)).filter(Boolean);
      const items = (await lujan!.invoke<MediaItem[]>('media:describe', paths)) ?? [];
      await s.importMedia(items, addToComp);
    },
  };
}

export function MediaWorkspace() {
  const s = useShow();
  const p = s.project;
  const [filter, setFilter] = useState<'all' | MediaKind>('all');
  const [sel, setSel] = useState<string | null>(null);
  const drop = useDropImport(null);
  const items = p.media.filter((m) => filter === 'all' || m.kind === filter);
  const selected = p.media.find((m) => m.id === sel) ?? null;

  return (
    <div className="cols" {...drop}>
      <div className="col" style={{ flex: 1 }}>
        <div className="row" style={{ padding: 8, borderBottom: '1px solid var(--line)', background: 'var(--bg2)', margin: 0 }}>
          <button className="btn primary" onClick={() => void importFromDialog()}>
            <Icon name="plus" /> Importar medios
          </button>
          <Seg
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'Todo' },
              { value: 'video', label: 'Video' },
              { value: 'image', label: 'Imagen' },
              { value: 'audio', label: 'Audio' },
              { value: 'model3d', label: '3D' },
            ]}
          />
          <span className="spacer" />
          <button className="btn" onClick={() => void s.relinkMissing()}>
            Buscar archivos perdidos
          </button>
          <button
            className="btn"
            disabled={!s.store.filePath}
            title={s.store.filePath ? 'Copia los medios a la carpeta Media/ del proyecto' : 'Guarda el proyecto primero'}
            onClick={async () => {
              const items2 = await lujan!.invoke<MediaItem[]>('media:collect', s.store.filePath, p.media);
              s.update((pr) => ({ ...pr, media: items2 }));
              s.toast('Medios copiados a la carpeta del proyecto');
            }}
          >
            Recopilar en el proyecto
          </button>
        </div>
        <div className="panel-body">
          {items.length === 0 && <div className="hint">Arrastra archivos aquí o pulsa «Importar medios». Video (MP4, MOV, WebM, MKV…), imagen (PNG, JPG, WebP, GIF…), audio y modelos 3D (OBJ, FBX, glTF/GLB, STL, PLY, 3DS).</div>}
          <div className="media-grid">
            {items.map((m) => {
              const meta = s.media.meta.get(m.id);
              const thumb = s.media.thumbs.get(m.id);
              return (
                <div key={m.id} className={`media-card ${sel === m.id ? 'sel' : ''}`} onClick={() => setSel(m.id)} onDoubleClick={() => addToScene(m)}>
                  <div className="img" style={{ backgroundImage: thumb ? `url(${thumb})` : undefined }}>
                    {!thumb && (meta?.error ? <span style={{ color: 'var(--err)' }}>{meta.error}</span> : KIND_LABEL[m.kind])}
                  </div>
                  <div className="meta" title={m.path}>
                    {m.name}
                    <div className="muted">
                      {KIND_LABEL[m.kind]}
                      {m.width ? ` · ${m.width}×${m.height}` : ''}
                      {m.durationSec ? ` · ${fmtDur(m.durationSec)}` : ''}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="panel right" style={{ width: 340 }}>
        <div className="panel-title">Detalle</div>
        <div className="panel-body">
          {!selected && <div className="hint">Selecciona un medio. Doble clic lo añade como capa a la escena seleccionada.</div>}
          {selected && (
            <>
              {(selected.kind === 'video' || selected.kind === 'image') && <ViewCanvas key={selected.id} spec={{ kind: 'source', target: `media:${selected.id}` }} style={{ aspectRatio: '16/9', marginBottom: 8 }} />}
              <Section title="Archivo">
                <div className="small mono" style={{ wordBreak: 'break-all', userSelect: 'text' }}>
                  {selected.path}
                </div>
                <div className="small muted">{(selected.size / 1024 / 1024).toFixed(1)} MB</div>
                {s.media.meta.get(selected.id)?.error && <div className="badge err">{s.media.meta.get(selected.id)?.error}</div>}
                {s.media.videoState(selected.id) && <div className="small muted">Decodificación por hardware · entrega de frames: {s.media.videoState(selected.id)?.decoding === 'stream' ? 'stream GPU (sin pasar por la interfaz)' : 'requestVideoFrameCallback'}</div>}
              </Section>
              <div className="row">
                {(selected.kind === 'video' || selected.kind === 'image') && (
                  <button className="btn primary" onClick={() => addToScene(selected)}>
                    Añadir a la escena
                  </button>
                )}
                <button
                  className="btn danger"
                  onClick={() => {
                    s.update((pr) => ({ ...pr, media: pr.media.filter((x) => x.id !== selected.id) }));
                    setSel(null);
                  }}
                >
                  Quitar del proyecto
                </button>
              </div>
              <Section title="Proxy">
                <InDevelopment>Generación de proxies 1080p para material 4K/8K. Hoy cada video se decodifica una sola vez por hardware y se comparte entre todas las salidas.</InDevelopment>
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  );

  function addToScene(m: MediaItem) {
    if (m.kind !== 'video' && m.kind !== 'image') return;
    const compId = s.ui.selectedComp ?? p.mixer.deckA ?? p.compositions[0]?.id;
    if (!compId) return;
    const l = createLayer({ type: 'media', mediaId: m.id }, m.name.replace(/\.[^.]+$/, ''));
    s.update((pr) => ({ ...pr, compositions: replaceById(pr.compositions, compId, (c) => ({ ...c, layers: [...c.layers, l] })) }));
    // silent: no "added" popup, the new layer is simply selected
    s.ui.selectedLayer = l.id;
    s.emit();
  }
}

export function fmtDur(s: number) {
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${String(ss).padStart(2, '0')}`;
}
