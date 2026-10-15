// web/js/ai/context.js
// ProjectContext: el estado real del proyecto en un objeto pequeño y estructurado.
// El asistente (con o sin IA) razona SOLO sobre esto: nunca inventa superficies,
// salidas ni dispositivos. Se calcula al vuelo (barato) y nunca dentro del bucle
// de render.
import { currentScene, usedMediaIds, ANIM_LIBRARY, GENERATORS } from "../model.js";

function contentOf(src, P) {
  switch (src?.type) {
    case "media": { const m = P.media.find(x => x.id === src.mediaId); return m ? { kind: m.kind, name: m.name } : { kind: "missing", name: src.mediaId }; }
    case "gen": return { kind: src.gen === "calib" ? "calibration" : "animation", name: ANIM_LIBRARY.find(a => a.gen === src.gen && a.color === src.color)?.name || GENERATORS.find(g => g.id === src.gen)?.name || src.gen };
    case "camera": return { kind: "camera" };
    case "body": return { kind: "interactive", name: src.bodyMode };
    case "text": return { kind: "text", name: src.text };
    case "color": return { kind: "color", name: src.color };
    case "drawing": return { kind: "drawing" };
    default: return { kind: "none" };
  }
}

/** Contexto completo (para el analizador y para la IA). hw = perfil de hardware si ya se conoce. */
export function buildProjectContext(app, { hw = null } = {}) {
  const S = app.S, P = S.project, sc = currentScene(P), set = P.settings;
  let perf = null;
  try { perf = app.perf?.() || null; } catch {}
  const used = usedMediaIds(P);
  const looks = sc.looks || {};
  const D = app.dmx, dmxc = set.dmx;
  const midiPorts = (() => { try { return app.midiDriver?.ports?.() || null; } catch { return null; } })();
  const audio = (() => { try { return app.audio?.() || null; } catch { return null; } })();
  const tr = app.tracking?.main?.();
  const cal = set.interactive || {};
  return {
    project: { name: P.name, width: P.width, height: P.height, mode: S.pro ? "profesional" : "simple" },
    surfaces: P.surfaces.map(s => {
      const l = looks[s.id];
      return {
        id: s.id, name: s.name, type: s.type, screen: s.screen || 1, hidden: !!s.hidden, locked: !!s.locked,
        mask: !!(s.mask?.enabled && s.mask.points?.length >= 3), mesh: s.type === "quad" && (s.cols > 2 || s.rows > 2),
        content: contentOf(l?.source, P), opacity: l?.opacity ?? 1, audioReactive: !!l?.audio?.enabled,
      };
    }),
    selected: S.sel || null,
    media: P.media.map(m => ({ id: m.id, name: m.name, kind: m.kind, width: m.width || 0, height: m.height || 0, duration: Math.round(m.duration || 0), mb: Math.round((m.size || 0) / 1048576), used: used.has(m.id) })),
    scenes: P.scenes.map((s, i) => ({ index: i, name: s.name, current: s.id === P.sceneId, transition: s.transition || "fade", duration: s.duration || 0, lights: s.lights || null })),
    output: {
      fps: set.output?.fps || 60, renderScale: set.output?.renderScale || 1,
      windowsOpen: perf?.outputs || [], projectingHere: !!S.projecting, external: S.output || null,
      screens: Object.entries(set.screens || {}).map(([n, v]) => ({ n: +n, on: v.on !== false })),
      softEdge: Object.values(set.output?.softEdge || {}).some(v => typeof v === "number" && v > 0 && v < 2),
    },
    performance: perf ? { fps: Math.round(perf.fps), refreshHz: Math.round(perf.refreshHz), frameMs: +perf.frameMs.toFixed(1), dropped: perf.dropped, seconds: Math.round(perf.seconds), previewScale: perf.preview?.scale ?? 1,
      videos: (perf.videos || []).map(v => ({ name: v.name, w: v.w, h: v.h, dropped: v.dropped })) } : null,
    audio: { micOn: !!audio?.active, bpm: set.bpm || 120, react: !!set.react?.enabled },
    midi: { supported: !!app.midiDriver?.supported, inputs: midiPorts?.inputs?.map(i => i.name) || [], mappings: set.control?.mappings?.length || 0, macros: set.control?.macros?.length || 0 },
    dmx: {
      enabled: !!dmxc?.enabled, desktop: !!D?.desktop, universes: dmxc?.universes?.length || 0,
      network: (dmxc?.universes || []).filter(u => u.protocol !== "virtual").length,
      nodesOnline: (D?.service?.nodes || []).filter(n => n.online).length,
      lights: (dmxc?.pixelMaps?.length || 0) + (dmxc?.fixtures?.length || 0),
      pixelMaps: (dmxc?.pixelMaps || []).map(pm => ({ name: pm.name, leds: D ? D.patchOf(pm).pos.length : pm.count, source: pm.source, lost: D ? D.patchOf(pm).patch.filter(x => !x).length : 0 })),
      fixtures: (dmxc?.fixtures || []).length, snapshots: (dmxc?.snapshots || []).length,
    },
    interactive: { calibrated: !!cal.enabled, camera: cal.camId || "default", surfaces: P.surfaces.filter(s => looks[s.id]?.source.type === "body").length },
    tracking: { provider: set.tracking?.provider, running: !!tr && tr.status === "running", people: tr ? tr.people.filter(p => !p.ghost).length : 0, zones: set.tracking?.zones?.length || 0, rules: set.tracking?.rules?.length || 0 },
    stage3d: { objects: P.stage3d?.objects?.length || 0, projectors: P.stage3d?.projectors?.length || 0 },
    show: { tcSource: set.show?.tcSource || "internal", autoAdvance: !!set.autoAdvance, emergency: !!S.emergency, blackout: !!S.blackout },
    hardware: hw ? { ramGB: hw.ramGB, vramGB: hw.vramGB, gpu: hw.gpu, cores: hw.cores } : null,
  };
}

/** Versión compacta para el modelo (corta listas largas para no gastar contexto). */
export function contextForPrompt(ctx) {
  const c = JSON.parse(JSON.stringify(ctx));
  if (c.surfaces.length > 24) c.surfaces = [...c.surfaces.slice(0, 24), { more: c.surfaces.length - 24 }];
  if (c.media.length > 20) c.media = [...c.media.slice(0, 20), { more: c.media.length - 20 }];
  if (c.scenes.length > 20) c.scenes = [...c.scenes.slice(0, 20), { more: c.scenes.length - 20 }];
  return JSON.stringify(c);
}
