import { useEffect, useMemo, useRef, useState } from 'react';
import type { FixtureChannel, FixtureInstance, FixtureType, PixelMap, Universe } from '../../../shared/project/model';
import { uid } from '../../../shared/project/model';
import { BUILTIN_FIXTURES, createPixelMap, createUniverse } from '../../../shared/project/defaults';
import { channelsPerPixel, patchPixels, pixelPositions, universesUsed } from '../../../shared/dmx/pixelmap';
import { formatPortAddress, splitPortAddress, portAddress } from '../../../shared/dmx/artnet';
import { useShow, useTicker } from '../hooks';
import { Icon } from '../icons';
import { Check, Field, InDevelopment, NumberInput, ParamSlider, Section, Select, Seg, Slider, Tabs, TextInput } from '../controls';
import { replaceById } from '../../core/store';
import { SourcePicker } from '../shared';
import { MappingTable } from './Midi';
import { lujan } from '../../api';
import type { NetInterfaceInfo } from '../../../shared/ipc';

type Tab = 'network' | 'universes' | 'pixel' | 'fixtures' | 'monitor' | 'test' | 'snapshots' | 'input' | 'sync';

export function DmxWorkspace() {
  const [tab, setTab] = useState<Tab>('network');
  return (
    <div className="col" style={{ flex: 1 }}>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'network', label: 'Red y nodos' },
          { id: 'universes', label: 'Universos' },
          { id: 'pixel', label: 'Pixel mapping' },
          { id: 'fixtures', label: 'Fixtures' },
          { id: 'monitor', label: 'Monitor' },
          { id: 'test', label: 'Test / Diagnóstico' },
          { id: 'snapshots', label: 'Snapshots' },
          { id: 'input', label: 'Entrada DMX' },
          { id: 'sync', label: 'Sincronía' },
        ]}
      />
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 10, display: 'flex', flexDirection: 'column' }}>
        {tab === 'network' && <Network />}
        {tab === 'universes' && <Universes />}
        {tab === 'pixel' && <PixelMaps />}
        {tab === 'fixtures' && <Fixtures />}
        {tab === 'monitor' && <Monitor />}
        {tab === 'test' && <TestDiag />}
        {tab === 'snapshots' && <Snapshots />}
        {tab === 'input' && <Input />}
        {tab === 'sync' && <SyncPanel />}
      </div>
    </div>
  );
}

export function useInterfaces() {
  const s = useShow();
  const [list, setList] = useState<NetInterfaceInfo[]>(s.interfaces);
  const refresh = async () => {
    const l = (await lujan?.invoke<NetInterfaceInfo[]>('app:interfaces')) ?? [];
    s.interfaces = l;
    setList(l);
  };
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { list, refresh };
}

export function InterfacePicker() {
  const s = useShow();
  const d = s.project.dmx;
  const { list, refresh } = useInterfaces();
  const current = list.find((i) => i.name === d.interfaceName && i.address === d.interfaceAddress);
  const TYPE: Record<string, string> = { ethernet: 'Ethernet', wifi: 'Wi-Fi', usb: 'USB Ethernet', virtual: 'Virtual', loopback: 'Loopback', other: 'Otra' };
  return (
    <>
      <div className="row">
        <Select
          value={current ? `${current.name}|${current.address}` : ''}
          options={[{ value: '', label: '— elige la interfaz conectada a los nodos —' }, ...list.map((i) => ({ value: `${i.name}|${i.address}`, label: `${i.name} · ${i.address} (${TYPE[i.type]})` }))]}
          onChange={(v) => {
            const [name, address] = v.split('|');
            s.update((p) => ({ ...p, dmx: { ...p.dmx, interfaceName: name || null, interfaceAddress: address || null } }));
          }}
        />
        <button className="btn sm" onClick={() => void refresh()}>
          Actualizar
        </button>
      </div>
      {current && (
        <div className="small muted">
          IP {current.address} · máscara {current.netmask} · broadcast {current.broadcast} · MAC {current.mac}
        </div>
      )}
      {d.interfaceAddress && !current && <div className="badge err">La interfaz guardada ({d.interfaceName} {d.interfaceAddress}) no está disponible: la salida está detenida.</div>}
      {!d.interfaceAddress && <div className="hint">Sin interfaz elegida no se envía nada: así nunca sale DMX por una red equivocada.</div>}
    </>
  );
}

function Network() {
  const s = useShow();
  useTicker(1000);
  const d = s.project.dmx;
  const [ip, setIp] = useState('');
  return (
    <>
      <Section title="Interfaz de red para Art-Net / sACN">
        <InterfacePicker />
      </Section>
      <Section
        title="Nodos Art-Net"
        right={
          <button className="btn sm" onClick={() => s.dmx.discover()}>
            AUTO DISCOVER
          </button>
        }
      >
        <div className="row">
          <TextInput value={ip} onChange={setIp} placeholder="IP manual del nodo, p. ej. 2.0.0.10" style={{ maxWidth: 220 }} />
          <button className="btn sm" disabled={!/^\d+\.\d+\.\d+\.\d+$/.test(ip)} onClick={() => { s.update((p) => ({ ...p, dmx: { ...p.dmx, manualNodes: [...new Set([...p.dmx.manualNodes, ip])] } })); setIp(''); }}>
            Añadir IP manual
          </button>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>Estado</th>
              <th>Nombre</th>
              <th>IP</th>
              <th>Fabricante</th>
              <th>Universos (salida)</th>
              <th>Entradas</th>
              <th>Puertos</th>
              <th>MAC</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {s.dmx.nodes.map((n) => (
              <tr key={`${n.ip}${n.bindIndex}`}>
                <td>
                  <span className={`badge ${n.online ? 'ok' : 'err'}`}>{n.online ? 'en línea' : 'sin respuesta'}</span>
                </td>
                <td title={n.longName}>{n.shortName || '—'}</td>
                <td className="mono">{n.ip}</td>
                <td>{n.manufacturer}</td>
                <td className="mono">{n.outputUniverses.map(formatPortAddress).join(', ') || '—'}</td>
                <td className="mono">{n.inputUniverses.map(formatPortAddress).join(', ') || '—'}</td>
                <td>{n.numPorts}</td>
                <td className="mono small">{n.mac}</td>
                <td>
                  {n.manual && (
                    <button className="btn icon sm" onClick={() => s.update((p) => ({ ...p, dmx: { ...p.dmx, manualNodes: p.dmx.manualNodes.filter((x) => x !== n.ip) } }))}>
                      <Icon name="trash" />
                    </button>
                  )}
                  {n.online && n.outputUniverses[0] !== undefined && (
                    <button className="btn sm" onClick={() => addUniverseFor(n.ip, n.outputUniverses[0])}>
                      + universo
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {s.dmx.nodes.length === 0 && <div className="hint">Ningún nodo ha respondido todavía. Elige la interfaz, comprueba el cable y la IP del nodo (Art-Net suele usar 2.x.x.x o 10.x.x.x) y pulsa AUTO DISCOVER.</div>}
      </Section>
      <Section title="USB-DMX">
        <InDevelopment>Interfaces USB-DMX (ENTTEC DMX USB Pro y compatibles). Hoy: usa un nodo Art-Net/sACN.</InDevelopment>
      </Section>
      {s.dmx.logs.length > 0 && (
        <Section title="Registro">
          <div className="small mono" style={{ maxHeight: 160, overflow: 'auto', userSelect: 'text' }}>
            {s.dmx.logs.slice(-50).map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        </Section>
      )}
      <div className="small muted">Estado: {d.universes.length} universo(s) · {s.dmx.stats?.bound ? 'socket abierto' : 'sin socket'}</div>
    </>
  );

  function addUniverseFor(ip: string, pa: number) {
    const u = createUniverse(s.project.dmx.universes.length, 'artnet');
    u.number = pa;
    u.destination = { mode: 'unicast', ip };
    s.update((p) => ({ ...p, dmx: { ...p.dmx, universes: [...p.dmx.universes, u] } }));
  }
}

function Universes() {
  const s = useShow();
  const d = s.project.dmx;
  const upd = (id: string, fn: (u: Universe) => Universe) => s.update((p) => ({ ...p, dmx: { ...p.dmx, universes: replaceById(p.dmx.universes, id, fn) } }));
  return (
    <>
      <div className="row">
        <button className="btn sm" onClick={() => s.update((p) => ({ ...p, dmx: { ...p.dmx, universes: [...p.dmx.universes, createUniverse(p.dmx.universes.length, 'artnet')] } }))}>
          + Art-Net
        </button>
        <button className="btn sm" onClick={() => s.update((p) => ({ ...p, dmx: { ...p.dmx, universes: [...p.dmx.universes, createUniverse(p.dmx.universes.length, 'sacn')] } }))}>
          + sACN
        </button>
        <button className="btn sm" onClick={() => s.update((p) => ({ ...p, dmx: { ...p.dmx, universes: [...p.dmx.universes, { ...createUniverse(p.dmx.universes.length, 'virtual'), name: `Virtual ${p.dmx.universes.length + 1}` }] } }))}>
          + Universo virtual
        </button>
        <span className="hint">Un universo virtual permite preparar el proyecto sin hardware; luego cambia su protocolo a Art-Net/sACN sin rehacer el pixel map.</span>
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>On</th>
            <th>Nombre</th>
            <th>Protocolo</th>
            <th>Universo</th>
            <th>Destino</th>
            <th>IP</th>
            <th>Delay ms</th>
            <th>Prioridad</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {d.universes.map((u) => {
            const sp = splitPortAddress(u.number);
            return (
              <tr key={u.id}>
                <td>
                  <input type="checkbox" checked={u.enabled} onChange={(e) => upd(u.id, (x) => ({ ...x, enabled: e.target.checked }))} />
                </td>
                <td>
                  <TextInput value={u.name} onChange={(v) => upd(u.id, (x) => ({ ...x, name: v }))} />
                </td>
                <td>
                  <Select
                    value={u.protocol}
                    options={[
                      { value: 'artnet', label: 'Art-Net' },
                      { value: 'sacn', label: 'sACN (E1.31)' },
                      { value: 'virtual', label: 'Virtual' },
                    ]}
                    onChange={(v) => upd(u.id, (x) => ({ ...x, protocol: v, destination: { ...x.destination, mode: v === 'sacn' ? 'multicast' : x.destination.mode === 'multicast' ? 'broadcast' : x.destination.mode }, number: v === 'sacn' ? Math.max(1, x.number) : x.number }))}
                  />
                </td>
                <td>
                  {u.protocol === 'artnet' ? (
                    <span style={{ display: 'inline-flex', gap: 2, alignItems: 'center' }}>
                      <NumberInput width={44} value={sp.net} min={0} max={127} onChange={(v) => upd(u.id, (x) => ({ ...x, number: portAddress(v, sp.subnet, sp.universe) }))} />:
                      <NumberInput width={40} value={sp.subnet} min={0} max={15} onChange={(v) => upd(u.id, (x) => ({ ...x, number: portAddress(sp.net, v, sp.universe) }))} />:
                      <NumberInput width={40} value={sp.universe} min={0} max={15} onChange={(v) => upd(u.id, (x) => ({ ...x, number: portAddress(sp.net, sp.subnet, v) }))} />
                      <span className="small muted">({u.number})</span>
                    </span>
                  ) : (
                    <NumberInput width={70} value={u.number} min={u.protocol === 'sacn' ? 1 : 0} max={63999} onChange={(v) => upd(u.id, (x) => ({ ...x, number: v }))} />
                  )}
                </td>
                <td>
                  <Select
                    value={u.destination.mode}
                    options={u.protocol === 'sacn' ? [{ value: 'multicast', label: 'Multicast' }, { value: 'unicast', label: 'Unicast' }] : [{ value: 'broadcast', label: 'Broadcast' }, { value: 'unicast', label: 'Unicast' }]}
                    onChange={(v) => upd(u.id, (x) => ({ ...x, destination: { ...x.destination, mode: v } }))}
                  />
                </td>
                <td>{u.destination.mode === 'unicast' ? <TextInput value={u.destination.ip} onChange={(v) => upd(u.id, (x) => ({ ...x, destination: { ...x.destination, ip: v } }))} placeholder="2.0.0.10" style={{ width: 120 }} /> : <span className="muted small">auto</span>}</td>
                <td>
                  <NumberInput width={60} value={u.delayMs} min={0} max={2000} onChange={(v) => upd(u.id, (x) => ({ ...x, delayMs: v }))} />
                </td>
                <td>{u.protocol === 'sacn' ? <NumberInput width={55} value={u.priority} min={0} max={200} onChange={(v) => upd(u.id, (x) => ({ ...x, priority: v }))} /> : '—'}</td>
                <td>
                  <button className="btn icon sm" onClick={() => s.update((p) => ({ ...p, dmx: { ...p.dmx, universes: p.dmx.universes.filter((x) => x.id !== u.id) } }))}>
                    <Icon name="trash" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="hint">512 canales por universo. El número máximo de universos lo limita la red y los nodos, no la aplicación.</div>
    </>
  );
}

// ------------------------------------------------------------------ pixel maps

function PixelMaps() {
  const s = useShow();
  const d = s.project.dmx;
  const [sel, setSel] = useState<string | null>(d.pixelMaps[0]?.id ?? null);
  const pm = d.pixelMaps.find((x) => x.id === sel) ?? null;
  const upd = (fn: (m: PixelMap) => PixelMap) => pm && s.update((p) => ({ ...p, dmx: { ...p.dmx, pixelMaps: replaceById(p.dmx.pixelMaps, pm.id, fn) } }));
  return (
    <div className="cols" style={{ gap: 10 }}>
      <div style={{ width: 240 }}>
        <button
          className="btn sm primary"
          onClick={() => {
            let uni = d.universes[0];
            if (!uni) {
              uni = { ...createUniverse(0, 'virtual'), name: 'Virtual 1' };
              s.update((p) => ({ ...p, dmx: { ...p.dmx, universes: [uni!] } }));
            }
            const m = createPixelMap(uni.id, `Pixel map ${d.pixelMaps.length + 1}`);
            s.update((p) => ({ ...p, dmx: { ...p.dmx, pixelMaps: [...p.dmx.pixelMaps, m] } }));
            setSel(m.id);
          }}
        >
          <Icon name="plus" /> Pixel map
        </button>
        <div className="list" style={{ marginTop: 8 }}>
          {d.pixelMaps.map((m) => (
            <div key={m.id} className={`item ${sel === m.id ? 'sel' : ''}`} onClick={() => setSel(m.id)}>
              <input type="checkbox" checked={m.enabled} onClick={(e) => e.stopPropagation()} onChange={(e) => s.update((p) => ({ ...p, dmx: { ...p.dmx, pixelMaps: replaceById(p.dmx.pixelMaps, m.id, (x) => ({ ...x, enabled: e.target.checked })) } }))} />
              <span className="name">
                {m.name}
                <div className="small muted">{pixelPositions(m).length} px · {m.format}</div>
              </span>
            </div>
          ))}
        </div>
        <Section title="Masters">
          <ParamSlider id="pixel.master" label="Master pixel" />
          <ParamSlider id="dmx.master" label="Master DMX" />
        </Section>
      </div>
      {pm && (
        <>
          <div className="col" style={{ flex: 1, gap: 8 }}>
            <PixelDiagram pm={pm} />
          </div>
          <div style={{ width: 340, overflow: 'auto' }}>
            <PixelMapEditor pm={pm} upd={upd} onDelete={() => { s.update((p) => ({ ...p, dmx: { ...p.dmx, pixelMaps: p.dmx.pixelMaps.filter((x) => x.id !== pm.id) } })); setSel(null); }} />
          </div>
        </>
      )}
    </div>
  );
}

function PixelMapEditor({ pm, upd, onDelete }: { pm: PixelMap; upd: (fn: (m: PixelMap) => PixelMap) => void; onDelete: () => void }) {
  const s = useShow();
  const d = s.project.dmx;
  const count = pixelPositions(pm).length;
  const patch = patchPixels(count, pm.format, pm.startChannel, pm);
  const span = universesUsed(patch);
  const base = d.universes.find((u) => u.id === pm.universeId);
  const missing: number[] = [];
  if (base) for (let k = 1; k < span; k++) if (!d.universes.some((u) => u.protocol === base.protocol && u.number === base.number + k)) missing.push(base.number + k);
  const dropped = patch.filter((x) => !x).length;
  return (
    <>
      <Section title="Pixel map">
        <Field label="Nombre">
          <TextInput value={pm.name} onChange={(v) => upd((m) => ({ ...m, name: v }))} />
        </Field>
        <Field label="Disposición">
          <Select
            value={pm.layout}
            options={[
              { value: 'grid', label: 'Rejilla' },
              { value: 'matrix', label: 'Matriz' },
              { value: 'line', label: 'Línea / tira' },
              { value: 'circle', label: 'Círculo' },
              { value: 'arc', label: 'Arco' },
              { value: 'custom', label: 'Personalizada' },
            ]}
            onChange={(v) => upd((m) => ({ ...m, layout: v, rows: v === 'line' || v === 'circle' || v === 'arc' ? 1 : m.rows }))}
          />
        </Field>
        <Field label={pm.layout === 'grid' || pm.layout === 'matrix' ? 'Columnas × filas' : 'Píxeles'}>
          <NumberInput value={pm.cols} min={1} max={4096} onChange={(v) => upd((m) => ({ ...m, cols: v }))} />
          {(pm.layout === 'grid' || pm.layout === 'matrix') && <NumberInput value={pm.rows} min={1} max={4096} onChange={(v) => upd((m) => ({ ...m, rows: v }))} />}
        </Field>
        {(pm.layout === 'arc' || pm.layout === 'circle') && (
          <Field label="Ángulos">
            <NumberInput value={pm.startAngle} min={-360} max={360} onChange={(v) => upd((m) => ({ ...m, startAngle: v }))} />
            {pm.layout === 'arc' && <NumberInput value={pm.endAngle} min={-360} max={720} onChange={(v) => upd((m) => ({ ...m, endAngle: v }))} />}
          </Field>
        )}
        {(['x', 'y', 'w', 'h'] as const).map((k) => (
          <div className="row" key={k}>
            <Slider value={pm[k]} min={k === 'w' || k === 'h' ? 0.01 : 0} max={1} label={{ x: 'Posición X', y: 'Posición Y', w: 'Ancho', h: 'Alto' }[k]} onChange={(v) => upd((m) => ({ ...m, [k]: v }))} />
          </div>
        ))}
        {pm.layout === 'custom' && <div className="hint">Clic en el diagrama para añadir píxeles; Alt+clic sobre un píxel lo borra.</div>}
      </Section>
      <Section title="Cableado">
        <Field label="Orden">
          <Select
            value={pm.order}
            options={[
              { value: 'serpentine', label: 'Serpentina' },
              { value: 'zigzag', label: 'Zig-zag (raster)' },
              { value: 'ltr', label: 'Izquierda → derecha' },
              { value: 'rtl', label: 'Derecha → izquierda' },
              { value: 'ttb', label: 'Arriba → abajo' },
              { value: 'btt', label: 'Abajo → arriba' },
            ]}
            onChange={(v) => upd((m) => ({ ...m, order: v }))}
          />
        </Field>
        <Field label="Esquina inicial">
          <Seg value={pm.startCorner} options={[{ value: 'tl', label: '↖' }, { value: 'tr', label: '↗' }, { value: 'bl', label: '↙' }, { value: 'br', label: '↘' }]} onChange={(v) => upd((m) => ({ ...m, startCorner: v }))} />
        </Field>
        <Check checked={pm.reverse} onChange={(v) => upd((m) => ({ ...m, reverse: v }))} label="Invertir dirección" />
      </Section>
      <Section title="Patch DMX">
        <Field label="Formato">
          <Select value={pm.format} options={['RGB', 'GRB', 'BRG', 'RBG', 'GBR', 'BGR', 'RGBW', 'RGBWA', 'W'].map((f) => ({ value: f as PixelMap['format'], label: `${f} (${channelsPerPixel(f as PixelMap['format'])} ch)` }))} onChange={(v) => upd((m) => ({ ...m, format: v }))} />
        </Field>
        <Field label="Universo inicial">
          <Select value={pm.universeId} options={d.universes.map((u) => ({ value: u.id, label: `${u.name} (${u.protocol} ${u.number})` }))} onChange={(v) => upd((m) => ({ ...m, universeId: v }))} />
        </Field>
        <Field label="Canal inicial">
          <NumberInput value={pm.startChannel} min={1} max={512} onChange={(v) => upd((m) => ({ ...m, startChannel: v }))} />
        </Field>
        <Check checked={pm.autoSpan} onChange={(v) => upd((m) => ({ ...m, autoSpan: v }))} label="AUTO SPAN (seguir en el siguiente universo)" />
        <Check checked={pm.alignPixels} onChange={(v) => upd((m) => ({ ...m, alignPixels: v }))} label="ALIGN OUTPUT (no partir píxeles entre universos)" />
        <Field label="Píxeles por universo">
          <NumberInput value={pm.pixelsPerUniverse} min={0} max={512} onChange={(v) => upd((m) => ({ ...m, pixelsPerUniverse: v }))} />
          <span className="small muted">0 = máx.</span>
        </Field>
        <div className="small">
          {count} píxeles · {count * channelsPerPixel(pm.format)} canales · {span} universo(s){dropped ? ` · ${dropped} sin patch` : ''}
        </div>
        {missing.length > 0 && (
          <div className="row">
            <span className="badge warn">Faltan universos {missing.join(', ')}</span>
            <button
              className="btn sm"
              onClick={() =>
                s.update((p) => ({
                  ...p,
                  dmx: { ...p.dmx, universes: [...p.dmx.universes, ...missing.map((n, i) => ({ ...createUniverse(p.dmx.universes.length + i, base!.protocol === 'usb-pro' ? 'virtual' : base!.protocol), number: n, name: `${base!.name} +${n - base!.number}`, destination: { ...base!.destination } }))] },
                }))
              }
            >
              Crear universos
            </button>
          </div>
        )}
      </Section>
      <Section title="VIDEO → LIGHTS">
        <div className="hint">Fuente que alimenta las luces:</div>
        <SourcePicker value={pm.source} onChange={(r) => upd((m) => ({ ...m, source: r }))} />
        <Field label="Muestreo">
          <Select
            value={pm.sampling}
            options={[
              { value: 'area', label: 'Área (promedio local)' },
              { value: 'point', label: 'Punto' },
              { value: 'average', label: 'Color medio de la región' },
              { value: 'center', label: 'Centro de la región' },
            ]}
            onChange={(v) => upd((m) => ({ ...m, sampling: v }))}
          />
        </Field>
        <div className="row">
          <Slider value={pm.sampleSize} min={0.05} max={2} label="Tamaño de muestra / blur" onChange={(v) => upd((m) => ({ ...m, sampleSize: v }))} />
        </div>
        <ParamSlider id={`pmap.${pm.id}.brightness`} label="Brillo / intensidad" />
        {(['contrast', 'saturation', 'gamma'] as const).map((k) => (
          <div className="row" key={k}>
            <Slider value={pm[k]} min={k === 'gamma' ? 0.3 : 0} max={k === 'gamma' ? 3.5 : 3} def={1} label={{ contrast: 'Contraste', saturation: 'Saturación', gamma: 'Gamma' }[k]} onChange={(v) => upd((m) => ({ ...m, [k]: v }))} />
          </div>
        ))}
        {pm.format.includes('W') && <Check checked={pm.whiteExtraction} onChange={(v) => upd((m) => ({ ...m, whiteExtraction: v }))} label="Extraer blanco (RGB→W)" />}
      </Section>
      <button className="btn danger sm" onClick={onDelete}>
        Eliminar pixel map
      </button>
    </>
  );
}

/** Pixel positions + wiring path + live colors sampled on the GPU. */
function PixelDiagram({ pm }: { pm: PixelMap }) {
  const s = useShow();
  const ref = useRef<HTMLCanvasElement>(null);
  const colors = useRef<Uint8Array | null>(null);
  const pts = useMemo(() => pixelPositions(pm), [pm]);
  useEffect(() => {
    const off = s.render.on((m) => {
      if (m.type === 'pixelSample' && m.mapId === pm.id) colors.current = m.colors;
    });
    return () => void off();
  }, [s, pm.id]);
  useEffect(() => {
    let h = 0;
    const draw = () => {
      h = requestAnimationFrame(draw);
      const c = ref.current;
      if (!c) return;
      const W = (c.width = c.clientWidth);
      const H = (c.height = c.clientHeight);
      const g = c.getContext('2d')!;
      g.fillStyle = '#0a0b0d';
      g.fillRect(0, 0, W, H);
      g.strokeStyle = 'rgba(255,255,255,0.15)';
      g.strokeRect(pm.x * W, pm.y * H, pm.w * W, pm.h * H);
      g.strokeStyle = 'rgba(25,195,255,0.35)';
      g.beginPath();
      pts.forEach((p, i) => (i ? g.lineTo(p.x * W, p.y * H) : g.moveTo(p.x * W, p.y * H)));
      g.stroke();
      const r = Math.max(2, Math.min(14, (Math.min(W * pm.w, H * pm.h) / Math.max(pm.cols, pm.rows)) * 0.4));
      const col = colors.current;
      pts.forEach((p, i) => {
        g.fillStyle = col && col.length >= (i + 1) * 4 ? `rgb(${col[i * 4]},${col[i * 4 + 1]},${col[i * 4 + 2]})` : '#333';
        g.beginPath();
        g.arc(p.x * W, p.y * H, r, 0, Math.PI * 2);
        g.fill();
      });
      if (pts.length) {
        g.fillStyle = '#ffcc00';
        g.font = '11px Segoe UI';
        g.fillText('INICIO', pts[0].x * W + r + 2, pts[0].y * H - r);
      }
    };
    draw();
    return () => cancelAnimationFrame(h);
  }, [pm, pts]);
  return (
    <canvas
      ref={ref}
      style={{ flex: 1, width: '100%', minHeight: 300, borderRadius: 6, border: '1px solid var(--line)', cursor: pm.layout === 'custom' ? 'crosshair' : 'default' }}
      onClick={(e) => {
        if (pm.layout !== 'custom') return;
        const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        const y = (e.clientY - r.top) / r.height;
        const custom = e.altKey ? pm.custom.filter((p) => Math.hypot(p.x - x, p.y - y) > 0.02) : [...pm.custom, { x, y }];
        s.update((p) => ({ ...p, dmx: { ...p.dmx, pixelMaps: replaceById(p.dmx.pixelMaps, pm.id, (m) => ({ ...m, custom })) } }));
      }}
    />
  );
}

// ------------------------------------------------------------------ fixtures

function Fixtures() {
  const s = useShow();
  const d = s.project.dmx;
  const types = [...BUILTIN_FIXTURES, ...d.fixtureTypes];
  const [typeId, setTypeId] = useState(types[0].id);
  const [editType, setEditType] = useState<FixtureType | null>(null);
  const updF = (id: string, fn: (f: FixtureInstance) => FixtureInstance) => s.update((p) => ({ ...p, dmx: { ...p.dmx, fixtures: replaceById(p.dmx.fixtures, id, fn) } }));
  const nextAddress = (uniId: string, size: number) => {
    let a = 1;
    for (const f of d.fixtures) {
      if (f.universeId !== uniId) continue;
      const t = types.find((x) => x.id === f.typeId);
      a = Math.max(a, f.address + (t?.channels.length ?? 1));
    }
    return a + size - 1 <= 512 ? a : 1;
  };
  return (
    <div className="cols" style={{ gap: 12 }}>
      <div style={{ flex: 1 }}>
        <div className="row">
          <Select value={typeId} options={types.map((t) => ({ value: t.id, label: `${t.manufacturer} · ${t.name} (${t.channels.length} ch)` }))} onChange={setTypeId} style={{ maxWidth: 300 }} />
          <button
            className="btn sm primary"
            disabled={!d.universes.length}
            onClick={() => {
              const t = types.find((x) => x.id === typeId)!;
              const uni = d.universes[0];
              const f: FixtureInstance = { id: uid('fix'), name: `${t.name} ${d.fixtures.length + 1}`, typeId, universeId: uni.id, address: nextAddress(uni.id, t.channels.length), x: 0.5, y: 0.5 };
              s.update((p) => ({ ...p, dmx: { ...p.dmx, fixtures: [...p.dmx.fixtures, f] } }));
            }}
          >
            Añadir fixture
          </button>
          {!d.universes.length && <span className="badge warn">Crea un universo primero</span>}
        </div>
        {d.fixtures.map((f) => {
          const t = types.find((x) => x.id === f.typeId);
          return (
            <div key={f.id} style={{ border: '1px solid var(--line)', borderRadius: 6, padding: 8, margin: '8px 0', background: 'var(--bg2)' }}>
              <div className="row">
                <TextInput value={f.name} onChange={(v) => updF(f.id, (x) => ({ ...x, name: v }))} style={{ maxWidth: 200 }} />
                <span className="small muted">{t?.name}</span>
                <Select value={f.universeId} style={{ maxWidth: 160 }} options={d.universes.map((u) => ({ value: u.id, label: u.name }))} onChange={(v) => updF(f.id, (x) => ({ ...x, universeId: v }))} />
                <span className="small">Dir.</span>
                <NumberInput value={f.address} min={1} max={512} onChange={(v) => updF(f.id, (x) => ({ ...x, address: v }))} />
                <span className="small muted">
                  {f.address}–{f.address + (t?.channels.length ?? 1) - 1}
                </span>
                <span className="spacer" />
                <button className="btn icon sm" onClick={() => s.update((p) => ({ ...p, dmx: { ...p.dmx, fixtures: p.dmx.fixtures.filter((x) => x.id !== f.id) } }))}>
                  <Icon name="trash" />
                </button>
              </div>
              <div className="grid2">
                {t?.channels.map((ch, i) => (
                  <ParamSlider key={i} id={`fixture.${f.id}.${i}`} label={`${f.address + i} · ${ch.name}`} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ width: 360 }}>
        <Section title="Biblioteca de fixtures" right={<button className="btn sm" onClick={() => setEditType({ id: uid('fxt'), name: 'Nuevo fixture', manufacturer: 'Personalizado', channels: [{ name: 'Dimmer', role: 'dimmer', default: 0 }] })}>+ Crear</button>}>
          <div className="list">
            {types.map((t) => (
              <div key={t.id} className="item" onClick={() => !BUILTIN_FIXTURES.includes(t) && setEditType(structuredClone(t))}>
                <span className="name">
                  {t.manufacturer} · {t.name}
                  <div className="small muted">{t.channels.map((c) => c.name).join(', ')}</div>
                </span>
                {BUILTIN_FIXTURES.includes(t) && <span className="badge">incluido</span>}
              </div>
            ))}
          </div>
        </Section>
        {editType && <FixtureTypeEditor t={editType} onCancel={() => setEditType(null)} onSave={(nt) => { s.update((p) => ({ ...p, dmx: { ...p.dmx, fixtureTypes: p.dmx.fixtureTypes.some((x) => x.id === nt.id) ? replaceById(p.dmx.fixtureTypes, nt.id, () => nt) : [...p.dmx.fixtureTypes, nt] } })); setEditType(null); }} />}
      </div>
    </div>
  );
}

const ROLES: FixtureChannel['role'][] = ['dimmer', 'red', 'green', 'blue', 'white', 'amber', 'uv', 'strobe', 'pan', 'panFine', 'tilt', 'tiltFine', 'color', 'gobo', 'zoom', 'focus', 'speed', 'custom'];

function FixtureTypeEditor({ t, onSave, onCancel }: { t: FixtureType; onSave: (t: FixtureType) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(t);
  return (
    <Section title="Editor de fixture">
      <Field label="Fabricante">
        <TextInput value={draft.manufacturer} onChange={(v) => setDraft({ ...draft, manufacturer: v })} />
      </Field>
      <Field label="Modelo">
        <TextInput value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} />
      </Field>
      {draft.channels.map((c, i) => (
        <div className="row" key={i}>
          <span className="small mono">{i + 1}</span>
          <TextInput value={c.name} onChange={(v) => setDraft({ ...draft, channels: draft.channels.map((x, k) => (k === i ? { ...x, name: v } : x)) })} />
          <Select value={c.role} style={{ maxWidth: 100 }} options={ROLES.map((r) => ({ value: r, label: r }))} onChange={(v) => setDraft({ ...draft, channels: draft.channels.map((x, k) => (k === i ? { ...x, role: v } : x)) })} />
          <NumberInput width={52} value={c.default} min={0} max={255} onChange={(v) => setDraft({ ...draft, channels: draft.channels.map((x, k) => (k === i ? { ...x, default: v } : x)) })} />
          <button className="btn icon sm" onClick={() => setDraft({ ...draft, channels: draft.channels.filter((_, k) => k !== i) })}>
            <Icon name="trash" />
          </button>
        </div>
      ))}
      <div className="row">
        <button className="btn sm" onClick={() => setDraft({ ...draft, channels: [...draft.channels, { name: `Canal ${draft.channels.length + 1}`, role: 'custom', default: 0 }] })}>
          + Canal
        </button>
        <span className="spacer" />
        <button className="btn sm" onClick={onCancel}>
          Cancelar
        </button>
        <button className="btn sm primary" onClick={() => onSave(draft)}>
          Guardar preset
        </button>
      </div>
    </Section>
  );
}

// ------------------------------------------------------------------ monitor / test / snapshots / input / sync

function Monitor() {
  const s = useShow();
  useTicker(250);
  const d = s.project.dmx;
  const [uni, setUni] = useState(d.universes[0]?.id ?? '');
  const [pct, setPct] = useState(false);
  const [data, setData] = useState<Uint8Array>(new Uint8Array(512));
  const st = s.dmx.stats;
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const snap = await s.dmx.capture();
      if (alive && snap[uni]) setData(snap[uni]);
    };
    const h = setInterval(() => void poll(), 300);
    return () => {
      alive = false;
      clearInterval(h);
    };
  }, [s, uni]);
  return (
    <>
      <div className="kpi">
        <K t="FPS de salida" v={st?.fps ?? 0} />
        <K t="Paquetes/s" v={st?.packetsPerSec ?? 0} />
        <K t="Tráfico" v={`${(((st?.bytesPerSec ?? 0) * 8) / 1000).toFixed(0)} kb/s`} />
        <K t="Universos activos" v={st?.universesActive ?? 0} />
        <K t="Paquetes perdidos" v={st?.sendErrors ?? 0} />
        <K t="Latencia interna" v={`${st?.latencyMs ?? 0} ms`} />
        <K t="Entrada (paq/s)" v={st?.inputPacketsPerSec ?? 0} />
      </div>
      {st?.lastError && <div className="badge err" style={{ margin: '6px 0' }}>{st.lastError}</div>}
      <div className="row" style={{ marginTop: 10 }}>
        <Select value={uni} style={{ maxWidth: 220 }} options={d.universes.map((u) => ({ value: u.id, label: `${u.name} (${u.protocol} ${u.number})` }))} onChange={setUni} />
        <Seg value={pct ? 'pct' : 'raw'} options={[{ value: 'raw', label: '0–255' }, { value: 'pct', label: '0–100%' }]} onChange={(v) => setPct(v === 'pct')} />
        <span className="small muted">Valores de salida reales (tras merge HTP, delay excluido)</span>
      </div>
      <div className="dmx-grid">
        {Array.from(data).map((v, i) => (
          <div key={i} title={`Canal ${i + 1}: ${v}`}>
            <i style={{ height: `${(v / 255) * 100}%` }} />
            <span>{pct ? Math.round((v / 255) * 100) : v}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function K({ t, v }: { t: string; v: string | number }) {
  return (
    <div className="k">
      <div className="v">{v}</div>
      <div className="t">{t}</div>
    </div>
  );
}

function TestDiag() {
  const s = useShow();
  useTicker(500);
  const d = s.project.dmx;
  const [uni, setUni] = useState('');
  const [mode, setMode] = useState<'off' | 'red' | 'green' | 'blue' | 'white' | 'full' | 'chase'>('off');
  const blackout = s.engine.value('show.blackout') >= 0.5;
  const set = (m: typeof mode) => {
    setMode(m);
    s.dmx.test(m, uni || undefined);
  };
  useEffect(() => () => s.dmx.test('off'), [s]);
  return (
    <>
      <Section title="Test de salida">
        <div className="row">
          <Select value={uni} style={{ maxWidth: 220 }} options={[{ value: '', label: 'Todos los universos' }, ...d.universes.map((u) => ({ value: u.id, label: u.name }))]} onChange={setUni} />
        </div>
        <div className="row">
          {(
            [
              ['red', 'Rojo', '#ff3b3b'],
              ['green', 'Verde', '#33d17a'],
              ['blue', 'Azul', '#3b7bff'],
              ['white', 'Blanco', '#ffffff'],
              ['full', 'Todo al 100%', '#ffcc00'],
              ['chase', 'Chase de canal', '#a07cff'],
            ] as const
          ).map(([m, label, c]) => (
            <button key={m} className={`btn ${mode === m ? 'on' : ''}`} style={{ borderColor: c }} onClick={() => set(mode === m ? 'off' : m)}>
              {label}
            </button>
          ))}
          <button className="btn" onClick={() => set('off')}>
            Test OFF
          </button>
          <button className={`btn blackout ${blackout ? 'on' : ''}`} onClick={() => s.setParam('show.blackout', blackout ? 0 : 1)}>
            BLACKOUT
          </button>
        </div>
      </Section>
      <Section title="Diagnóstico paso a paso" right={<button className="btn sm primary" onClick={() => s.dmx.diagnose(uni || null)}>Ejecutar diagnóstico</button>}>
        {s.dmx.diagnostics === null && <div className="hint">Comprueba interfaz → socket → Art-Net → nodo → universo → salida y dice exactamente dónde falla.</div>}
        {s.dmx.diagnostics?.map((st) => (
          <div key={st.id} className="row">
            <span style={{ color: st.ok ? 'var(--ok)' : 'var(--err)', fontWeight: 700, width: 18 }}>{st.ok ? '✓' : '✗'}</span>
            <b style={{ width: 90 }}>{{ interface: 'Ethernet', socket: 'Socket', artnet: 'Art-Net', node: 'Nodo', universe: 'Universo', output: 'Salida' }[st.id]}</b>
            <span className="small">{st.detail}</span>
          </div>
        ))}
      </Section>
    </>
  );
}

function Snapshots() {
  const s = useShow();
  const d = s.project.dmx;
  const [name, setName] = useState('');
  return (
    <>
      <div className="row">
        <TextInput value={name} onChange={setName} placeholder="Nombre del snapshot" style={{ maxWidth: 240 }} />
        <button className="btn primary" onClick={() => void s.captureSnapshot(name || `Snapshot ${d.snapshots.length + 1}`).then(() => setName(''))}>
          CAPTURE DMX STATE
        </button>
        <button className="btn" onClick={() => s.dmx.sendSnapshotLayer(null)}>
          Liberar snapshot
        </button>
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Universos</th>
            <th>Trigger</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {d.snapshots.map((sn) => (
            <tr key={sn.id}>
              <td>
                <TextInput value={sn.name} onChange={(v) => s.update((p) => ({ ...p, dmx: { ...p.dmx, snapshots: replaceById(p.dmx.snapshots, sn.id, (x) => ({ ...x, name: v })) } }))} />
              </td>
              <td>{Object.keys(sn.data).length}</td>
              <td className="mono small">snapshot.{sn.id}.recall</td>
              <td>
                <button className="btn sm primary" onClick={() => s.recallSnapshot(sn.id)}>
                  RECALL
                </button>
                <button className="btn icon sm" onClick={() => s.update((p) => ({ ...p, dmx: { ...p.dmx, snapshots: p.dmx.snapshots.filter((x) => x.id !== sn.id) } }))}>
                  <Icon name="trash" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="hint">Los snapshots se pueden lanzar desde escenas, cues, timeline, MIDI/OSC/teclado (learn sobre su trigger), reglas de tracking/audio y macros.</div>
    </>
  );
}

function Input() {
  const s = useShow();
  useTicker(500);
  const inp = s.project.dmx.input;
  const upd = (patch: Partial<typeof inp>) => s.update((p) => ({ ...p, dmx: { ...p.dmx, input: { ...p.dmx.input, ...patch } } }));
  return (
    <>
      <Section title="Entrada DMX (consola de iluminación → aplicación)">
        <Check checked={inp.enabled} onChange={(v) => upd({ enabled: v })} label="Recibir DMX" />
        <Field label="Protocolo">
          <Seg value={inp.protocol} options={[{ value: 'artnet', label: 'Art-Net' }, { value: 'sacn', label: 'sACN' }]} onChange={(v) => upd({ protocol: v })} />
        </Field>
        <Field label="Universos">
          <TextInput value={inp.universes.join(',')} onChange={(v) => upd({ universes: v.split(',').map((x) => Number(x.trim())).filter((x) => Number.isFinite(x) && x >= 0) })} placeholder="0,1" />
        </Field>
        <div className="small">
          {[...s.dmx.inputFrames].map(([k, f]) => (
            <div key={k}>
              {k}: desde {f.source} · hace {Math.round((performance.now() - f.t) / 100) / 10}s
            </div>
          ))}
          {s.dmx.inputFrames.size === 0 && <span className="muted">Sin datos recibidos.</span>}
        </div>
        <div className="hint">DMX LEARN: pulsa el botón learn de cualquier parámetro (glow, brillo, escena, blackout…) y mueve un fader de la consola.</div>
      </Section>
      <Section title="Mapeos DMX → parámetros">
        <MappingTable kinds={['dmx']} compact />
      </Section>
    </>
  );
}

function SyncPanel() {
  const s = useShow();
  const d = s.project.dmx;
  const upd = (patch: Partial<typeof d>) => s.update((p) => ({ ...p, dmx: { ...p.dmx, ...patch } }));
  return (
    <Section title="Sincronía luces / proyección">
      <Field label="FPS de salida DMX">
        <Select value={d.outputFps} options={[20, 25, 30, 40, 44, 50, 60].map((f) => ({ value: f, label: `${f} fps` }))} onChange={(v) => upd({ outputFps: v })} />
      </Field>
      <Field label="Modo">
        <Seg value={d.syncMode} options={[{ value: 'immediate', label: 'IMMEDIATE LIGHT OUTPUT' }, { value: 'sync', label: 'SYNC MODE (con delay)' }]} onChange={(v) => upd({ syncMode: v })} />
      </Field>
      <Field label="Delay global (ms)">
        <NumberInput value={d.globalDelayMs} min={0} max={2000} onChange={(v) => upd({ globalDelayMs: v })} />
      </Field>
      <Check checked={d.useArtSync} onChange={(v) => upd({ useArtSync: v })} label="Enviar ArtSync (todos los universos cambian a la vez en nodos compatibles)" />
      <div className="hint">En SYNC MODE las luces se retrasan el tiempo indicado (global + por universo, en la pestaña Universos) para coincidir con la latencia de proyectores y pantallas LED.</div>
    </Section>
  );
}
