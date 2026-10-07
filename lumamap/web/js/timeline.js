// web/js/timeline.js
// Timeline de reproducción con clips: modelo + matemática de scheduling.
// Compartido navegador/Node (testable). Duraciones en segundos.
let clipCounter = 1;
function uid(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${(clipCounter++).toString(36)}`;
}

export function createClip(opts = {}) {
  return {
    id: uid("clip"),
    surfaceId: opts.surfaceId || null,
    mediaId: opts.mediaId || null,
    start: opts.start ?? 0,           // inicio en la escala de la escena (s)
    duration: opts.duration ?? 5,     // duración en escena (s)
    inPoint: opts.inPoint ?? 0,       // punto de entrada en el medio (s)
    outPoint: opts.outPoint ?? 0,     // 0 = hasta el final del medio
    loop: opts.loop ?? true,
    speed: opts.speed ?? 1,
  };
}

export function createTimeline() {
  return { enabled: false, clips: [] };
}

/** Tiempo de medio correspondiente al playhead t para un clip. */
export function mediaTimeAt(clip, t) {
  const local = (t - clip.start) * clip.speed;
  const content = clip.outPoint > clip.inPoint ? clip.outPoint - clip.inPoint : Infinity;
  if (clip.loop && content > 0 && local > content) {
    return clip.inPoint + (local % content);
  }
  return clip.inPoint + Math.min(Math.max(local, 0), content === Infinity ? local : content);
}

/** Clip activo para una superficie en el instante t (el que empieza más tarde gana). */
export function activeClipAt(scene, surfaceId, t) {
  const clips = (scene.timeline?.clips || []).filter(
    c => c.surfaceId === surfaceId && t >= c.start && t < c.start + c.duration);
  clips.sort((a, b) => b.start - a.start);
  return clips[0] || null;
}

/** Divide un clip en el playhead t (ambos resultados no hacen loop). */
export function splitClip(clip, t) {
  if (t <= clip.start || t >= clip.start + clip.duration) return null;
  const firstDur = t - clip.start;
  const c1 = { ...clip, id: uid("clip"), duration: firstDur, loop: false };
  const c2 = { ...clip, id: uid("clip"), start: t, duration: clip.duration - firstDur,
               inPoint: mediaTimeAt(clip, t), loop: false };
  return [c1, c2];
}

/** Fin de la escena en segundos (0 si no hay clips). */
export function sceneTlEnd(scene) {
  const clips = scene.timeline?.clips || [];
  return clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
}

/** Superficies cubiertas por al menos un clip (para ocultar las demás en modo timeline). */
export function coveredSurfaceIds(scene) {
  return new Set((scene.timeline?.clips || []).map(c => c.surfaceId));
}
