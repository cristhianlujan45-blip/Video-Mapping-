// web/js/mypanel.js
// «Mi panel» (como los Panel COMP de TouchDesigner): los controles que tú elijas, grandes y juntos,
// para el directo (también en el móvil). Aquí solo los datos; la vista está en panels-mypanel.js.
export const MYPANEL_MAX = 24;
/** Lista guardada en project.settings.panel: [{ param, label }]. */
export function normalizePanel(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list.filter(x => x && typeof x.param === "string" && x.param && !seen.has(x.param) && seen.add(x.param))
    .slice(0, MYPANEL_MAX).map(x => ({ param: x.param.slice(0, 200), label: String(x.label ?? "").slice(0, 40) }));
}
/** Lo que necesita un mando (en la app o en el móvil) para dibujar cada control. */
export function panelState(list, describe) {
  return list.map(it => {
    const d = describe(it.param);
    return d ? { id: d.id, name: it.label || d.name, kind: d.kind, min: d.min, max: d.max, value: d.kind === "trigger" ? 0 : +d.get() } : null;
  }).filter(Boolean);
}
