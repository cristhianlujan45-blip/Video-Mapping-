import type { ParamDef } from '../../shared/params/types';
import type { Project, Vec3 } from '../../shared/project/model';
import { EFFECTS, effectParamId } from '../../shared/project/effects';
import { BUILTIN_FIXTURES } from '../../shared/project/defaults';
import { replaceById } from './store';

/**
 * A parameter plus (optionally) where its base value lives in the project, so moving a
 * slider is saved and undoable while MIDI/OSC/DMX/audio/tracking only modulate it live.
 */
export interface Binding {
  def: ParamDef;
  get?: (p: Project) => number;
  set?: (p: Project, v: number) => Project;
}

const f = (id: string, name: string, min: number, max: number, def: number, group: string, owner?: string, unit?: string): ParamDef => ({ id, name, type: 'float', min, max, default: def, group, owner, unit });
const b = (id: string, name: string, def: number, group: string, owner?: string): ParamDef => ({ id, name, type: 'bool', min: 0, max: 1, default: def, group, owner });
const t = (id: string, name: string, group: string, owner?: string): ParamDef => ({ id, name, type: 'trigger', min: 0, max: 1, default: 0, group, owner });

const vec = (v: Vec3, i: number, x: number): Vec3 => v.map((c, k) => (k === i ? x : c)) as Vec3;

/** Global (project-independent) parameters. */
export function globalBindings(): Binding[] {
  return [
    { def: f('master.brightness', 'Brillo maestro', 0, 1, 1, 'Show') },
    { def: f('master.speed', 'Velocidad maestra', 0, 4, 1, 'Show') },
    { def: f('mixer.crossfade', 'Crossfader A/B', 0, 1, 0, 'VJ') },
    { def: b('show.blackout', 'BLACKOUT', 0, 'Show') },
    { def: t('show.play', 'Play', 'Show') },
    { def: t('show.pause', 'Pausa', 'Show') },
    { def: t('show.stop', 'Stop', 'Show') },
    { def: t('show.next', 'Siguiente cue/escena', 'Show') },
    { def: t('show.previous', 'Cue/escena anterior', 'Show') },
    { def: t('show.take', 'TAKE (Preview → Program)', 'VJ') },
    { def: t('show.cut', 'CUT', 'VJ') },
    { def: t('sync.tap', 'Tap tempo', 'Show') },
    { def: f('sync.bpm', 'BPM', 20, 300, 120, 'Show', undefined, 'bpm') },
    { def: t('timeline.play', 'Timeline play/pausa', 'Show') },
    { def: t('timeline.stop', 'Timeline stop', 'Show') },
    { def: t('timeline.record', 'Grabar automatización', 'Show') },
    { def: f('dmx.master', 'Master DMX', 0, 1, 1, 'Iluminación') },
    { def: f('pixel.master', 'Master pixel map', 0, 1, 1, 'Iluminación') },
    { def: f('audio.gain', 'Ganancia audio', 0, 8, 1, 'Audio') },
    { def: f('view.yaw', 'Vista 3D: órbita horizontal', -180, 180, 35, '3D', undefined, '°') },
    { def: f('view.pitch', 'Vista 3D: órbita vertical', -89, 89, 25, '3D', undefined, '°') },
    { def: f('view.distance', 'Vista 3D: distancia', 0.5, 100, 9, '3D', undefined, 'm') },
    { def: f('view.fov', 'Vista 3D: FOV', 10, 120, 45, '3D', undefined, '°') },
    { def: f('view.panX', 'Vista 3D: pan X', -50, 50, 0, '3D', undefined, 'm') },
    { def: f('view.panY', 'Vista 3D: pan Y', -50, 50, 1, '3D', undefined, 'm') },
    { def: f('draw.size', 'Pincel: tamaño', 1, 1000, 24, 'Dibujo', undefined, 'px') },
    { def: f('draw.opacity', 'Pincel: opacidad', 0, 1, 1, 'Dibujo') },
    { def: f('draw.hue', 'Pincel: tono', 0, 360, 190, 'Dibujo', undefined, '°') },
  ];
}

export function projectBindings(p: Project): Binding[] {
  const out: Binding[] = [];

  for (const comp of p.compositions) {
    out.push({ def: t(`comp.${comp.id}.go`, `Escena «${comp.name}» → Program`, 'VJ', comp.id) });
    out.push({ def: t(`comp.${comp.id}.preview`, `Escena «${comp.name}» → Preview`, 'VJ', comp.id) });
    for (const fx of comp.effects) out.push(...effectBindings(p, fx.id, fx.kind, `${comp.name}`, comp.id, (proj, fn) => ({ ...proj, compositions: replaceById(proj.compositions, comp.id, (c) => ({ ...c, effects: replaceById(c.effects, fx.id, fn) })) })));
    for (const layer of comp.layers) {
      const L = layer.id;
      const upd = (proj: Project, fn: (l: typeof layer) => typeof layer) => ({ ...proj, compositions: replaceById(proj.compositions, comp.id, (c) => ({ ...c, layers: replaceById(c.layers, L, fn) })) });
      const find = (proj: Project) => proj.compositions.find((c) => c.id === comp.id)?.layers.find((l) => l.id === L);
      const n = layer.name;
      out.push(
        { def: f(`layer.${L}.opacity`, `${n}: opacidad`, 0, 1, layer.opacity, 'Capas', L), get: (pr) => find(pr)?.opacity ?? 1, set: (pr, v) => upd(pr, (l) => ({ ...l, opacity: v })) },
        { def: b(`layer.${L}.visible`, `${n}: visible`, layer.visible ? 1 : 0, 'Capas', L), get: (pr) => (find(pr)?.visible ? 1 : 0), set: (pr, v) => upd(pr, (l) => ({ ...l, visible: v >= 0.5 })) },
        { def: f(`layer.${L}.x`, `${n}: posición X`, -2, 2, layer.transform.x, 'Capas', L), get: (pr) => find(pr)?.transform.x ?? 0, set: (pr, v) => upd(pr, (l) => ({ ...l, transform: { ...l.transform, x: v } })) },
        { def: f(`layer.${L}.y`, `${n}: posición Y`, -2, 2, layer.transform.y, 'Capas', L), get: (pr) => find(pr)?.transform.y ?? 0, set: (pr, v) => upd(pr, (l) => ({ ...l, transform: { ...l.transform, y: v } })) },
        {
          def: f(`layer.${L}.scale`, `${n}: escala`, 0, 8, layer.transform.scaleX, 'Capas', L),
          get: (pr) => find(pr)?.transform.scaleX ?? 1,
          set: (pr, v) => upd(pr, (l) => ({ ...l, transform: { ...l.transform, scaleX: v, scaleY: v * (l.transform.scaleY / (l.transform.scaleX || 1)) } })),
        },
        { def: f(`layer.${L}.rotation`, `${n}: rotación`, -360, 360, layer.transform.rotation, 'Capas', L, '°'), get: (pr) => find(pr)?.transform.rotation ?? 0, set: (pr, v) => upd(pr, (l) => ({ ...l, transform: { ...l.transform, rotation: v } })) },
        { def: f(`layer.${L}.speed`, `${n}: velocidad`, -4, 4, layer.playback.speed, 'Capas', L, '×'), get: (pr) => find(pr)?.playback.speed ?? 1, set: (pr, v) => upd(pr, (l) => ({ ...l, playback: { ...l.playback, speed: v } })) },
        { def: f(`layer.${L}.volume`, `${n}: volumen`, 0, 1, layer.playback.volume, 'Capas', L), get: (pr) => find(pr)?.playback.volume ?? 1, set: (pr, v) => upd(pr, (l) => ({ ...l, playback: { ...l.playback, volume: v } })) },
      );
      for (const fx of layer.effects) out.push(...effectBindings(p, fx.id, fx.kind, n, L, (proj, fn) => upd(proj, (l) => ({ ...l, effects: replaceById(l.effects, fx.id, fn) }))));
    }
  }

  for (const o of p.outputs) {
    const O = o.id;
    const updO = (pr: Project, fn: (x: typeof o) => typeof o) => ({ ...pr, outputs: replaceById(pr.outputs, O, fn) });
    const findO = (pr: Project) => pr.outputs.find((x) => x.id === O);
    out.push(
      { def: b(`output.${O}.enabled`, `${o.name}: activa`, o.enabled ? 1 : 0, 'Salidas', O), get: (pr) => (findO(pr)?.enabled ? 1 : 0), set: (pr, v) => updO(pr, (x) => ({ ...x, enabled: v >= 0.5 })) },
      { def: f(`output.${O}.brightness`, `${o.name}: brillo`, -1, 1, o.color.brightness, 'Salidas', O), get: (pr) => findO(pr)?.color.brightness ?? 0, set: (pr, v) => updO(pr, (x) => ({ ...x, color: { ...x.color, brightness: v } })) },
      { def: f(`output.${O}.contrast`, `${o.name}: contraste`, 0, 3, o.color.contrast, 'Salidas', O), get: (pr) => findO(pr)?.color.contrast ?? 1, set: (pr, v) => updO(pr, (x) => ({ ...x, color: { ...x.color, contrast: v } })) },
      { def: f(`output.${O}.gamma`, `${o.name}: gamma`, 0.2, 3, o.color.gamma, 'Salidas', O), get: (pr) => findO(pr)?.color.gamma ?? 1, set: (pr, v) => updO(pr, (x) => ({ ...x, color: { ...x.color, gamma: v } })) },
    );
    for (const s of o.surfaces) {
      const S = s.id;
      const updS = (pr: Project, fn: (x: typeof s) => typeof s) => updO(pr, (x) => ({ ...x, surfaces: replaceById(x.surfaces, S, fn) }));
      const findS = (pr: Project) => findO(pr)?.surfaces.find((x) => x.id === S);
      out.push(
        { def: f(`surface.${S}.opacity`, `${o.name} / ${s.name}: opacidad`, 0, 1, s.opacity, 'Mapping', S), get: (pr) => findS(pr)?.opacity ?? 1, set: (pr, v) => updS(pr, (x) => ({ ...x, opacity: v })) },
        { def: b(`surface.${S}.visible`, `${o.name} / ${s.name}: visible`, s.visible ? 1 : 0, 'Mapping', S), get: (pr) => (findS(pr)?.visible ? 1 : 0), set: (pr, v) => updS(pr, (x) => ({ ...x, visible: v >= 0.5 })) },
      );
      for (const fx of s.effects) out.push(...effectBindings(p, fx.id, fx.kind, s.name, S, (pr, fn) => updS(pr, (x) => ({ ...x, effects: replaceById(x.effects, fx.id, fn) }))));
    }
  }

  for (const obj of p.stage.objects) {
    const I = obj.id;
    const upd = (pr: Project, fn: (x: typeof obj) => typeof obj) => ({ ...pr, stage: { ...pr.stage, objects: replaceById(pr.stage.objects, I, fn) } });
    const find = (pr: Project) => pr.stage.objects.find((x) => x.id === I);
    const axes = ['X', 'Y', 'Z'];
    axes.forEach((a, i) => {
      out.push({ def: f(`obj.${I}.pos${a}`, `${obj.name}: posición ${a}`, -100, 100, obj.position[i], '3D', I, 'm'), get: (pr) => find(pr)?.position[i] ?? 0, set: (pr, v) => upd(pr, (x) => ({ ...x, position: vec(x.position, i, v) })) });
      out.push({ def: f(`obj.${I}.rot${a}`, `${obj.name}: rotación ${a}`, -360, 360, obj.rotation[i], '3D', I, '°'), get: (pr) => find(pr)?.rotation[i] ?? 0, set: (pr, v) => upd(pr, (x) => ({ ...x, rotation: vec(x.rotation, i, v) })) });
    });
    out.push({ def: f(`obj.${I}.scale`, `${obj.name}: escala`, 0.01, 50, obj.scale[0], '3D', I), get: (pr) => find(pr)?.scale[0] ?? 1, set: (pr, v) => upd(pr, (x) => ({ ...x, scale: x.scale.map((c) => (c / (x.scale[0] || 1)) * v) as Vec3 })) });
    out.push({ def: b(`obj.${I}.visible`, `${obj.name}: visible`, obj.visible ? 1 : 0, '3D', I), get: (pr) => (find(pr)?.visible ? 1 : 0), set: (pr, v) => upd(pr, (x) => ({ ...x, visible: v >= 0.5 })) });
  }

  for (const pj of p.stage.projectors) {
    const I = pj.id;
    const upd = (pr: Project, fn: (x: typeof pj) => typeof pj) => ({ ...pr, stage: { ...pr.stage, projectors: replaceById(pr.stage.projectors, I, fn) } });
    const find = (pr: Project) => pr.stage.projectors.find((x) => x.id === I);
    out.push({ def: f(`proj.${I}.fov`, `${pj.name}: FOV`, 5, 120, pj.fov, '3D', I, '°'), get: (pr) => find(pr)?.fov ?? 30, set: (pr, v) => upd(pr, (x) => ({ ...x, fov: v })) });
    ['X', 'Y', 'Z'].forEach((a, i) => {
      out.push({ def: f(`proj.${I}.pos${a}`, `${pj.name}: posición ${a}`, -100, 100, pj.position[i], '3D', I, 'm'), get: (pr) => find(pr)?.position[i] ?? 0, set: (pr, v) => upd(pr, (x) => ({ ...x, position: vec(x.position, i, v) })) });
      out.push({ def: f(`proj.${I}.rot${a}`, `${pj.name}: rotación ${a}`, -360, 360, pj.rotation[i], '3D', I, '°'), get: (pr) => find(pr)?.rotation[i] ?? 0, set: (pr, v) => upd(pr, (x) => ({ ...x, rotation: vec(x.rotation, i, v) })) });
    });
  }

  for (const pm of p.dmx.pixelMaps) {
    const I = pm.id;
    out.push({
      def: f(`pmap.${I}.brightness`, `${pm.name}: brillo`, 0, 1, pm.brightness, 'Iluminación', I),
      get: (pr) => pr.dmx.pixelMaps.find((x) => x.id === I)?.brightness ?? 1,
      set: (pr, v) => ({ ...pr, dmx: { ...pr.dmx, pixelMaps: replaceById(pr.dmx.pixelMaps, I, (x) => ({ ...x, brightness: v })) } }),
    });
  }

  const types = [...BUILTIN_FIXTURES, ...p.dmx.fixtureTypes];
  for (const fx of p.dmx.fixtures) {
    const type = types.find((x) => x.id === fx.typeId);
    if (!type) continue;
    type.channels.forEach((ch, i) => {
      out.push({ def: { id: `fixture.${fx.id}.${i}`, name: `${fx.name}: ${ch.name}`, type: 'int', min: 0, max: 255, default: ch.default, group: 'Iluminación', owner: fx.id } });
    });
  }

  for (const c of p.cues) out.push({ def: t(`cue.${c.id}.go`, `Cue «${c.name}»`, 'Show', c.id) });
  for (const m of p.macros) out.push({ def: t(`macro.${m.id}.run`, `Macro «${m.name}»`, 'Show', m.id) });
  for (const s of p.dmx.snapshots) out.push({ def: t(`snapshot.${s.id}.recall`, `Snapshot DMX «${s.name}»`, 'Iluminación', s.id) });

  return out;
}

function effectBindings(_p: Project, fxId: string, kind: keyof typeof EFFECTS, ownerName: string, owner: string, upd: (p: Project, fn: (fx: { id: string; kind: typeof kind; enabled: boolean; params: Record<string, number> }) => { id: string; kind: typeof kind; enabled: boolean; params: Record<string, number> }) => Project): Binding[] {
  const def = EFFECTS[kind];
  const out: Binding[] = [];
  const findFx = (p: Project) => findEffect(p, fxId);
  out.push({
    def: b(effectParamId(fxId, 'enabled'), `${ownerName} / ${def.label}: activo`, 1, 'Efectos', owner),
    get: (p) => (findFx(p)?.enabled ? 1 : 0),
    set: (p, v) => upd(p, (fx) => ({ ...fx, enabled: v >= 0.5 })),
  });
  for (const pd of def.params) {
    out.push({
      def: { id: effectParamId(fxId, pd.name), name: `${ownerName} / ${def.label}: ${pd.label}`, type: pd.type ?? 'float', min: pd.min, max: pd.max, default: pd.default, group: 'Efectos', owner },
      get: (p) => findFx(p)?.params[pd.name] ?? pd.default,
      set: (p, v) => upd(p, (fx) => ({ ...fx, params: { ...fx.params, [pd.name]: v } })),
    });
  }
  return out;
}

export function findEffect(p: Project, fxId: string) {
  for (const c of p.compositions) {
    const a = c.effects.find((x) => x.id === fxId);
    if (a) return a;
    for (const l of c.layers) {
      const e = l.effects.find((x) => x.id === fxId);
      if (e) return e;
    }
  }
  for (const o of p.outputs) for (const s of o.surfaces) {
    const e = s.effects.find((x) => x.id === fxId);
    if (e) return e;
  }
  return undefined;
}
