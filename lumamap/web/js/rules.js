// web/js/rules.js
// Acciones reales que pueden disparar las reglas de tracking, los sensores y el
// asistente: cambiar un parámetro, un color, una escena, una animación o
// ejecutar una macro. Todas pasan por el editor (con guardado y deshacer).
import { describe } from "./params.js";
import { lookOf, currentScene, ANIM_LIBRARY, GENERATORS } from "./model.js";

export const ACTION_TYPES = [
  ["param", "Mover un parámetro"], ["color", "Cambiar el color"], ["scene", "Ir a una escena"],
  ["anim", "Poner una animación"], ["macro", "Ejecutar una macro"], ["go", "GO (siguiente cue)"], ["blackout", "Apagón"],
];

/** Superficies a las que afecta una acción: "all", "sel" o un id. */
function surfacesOf(app, which) {
  const P = app.S.project;
  if (which === "all" || !which) return P.surfaces.map(s => s.id);
  if (which === "sel") return app.S.sel ? [app.S.sel] : P.surfaces.slice(0, 1).map(s => s.id);
  return [which];
}

/** Ejecuta una acción. Devuelve un texto de lo que hizo (o lanza un error claro). */
export function runAction(app, a) {
  if (!a) return "";
  const S = app.S, P = S.project, A = app.actions;
  switch (a.type) {
    case "param": {
      const d = describe(app, a.target);
      if (!d) throw new Error("El parámetro no existe: " + a.target);
      if (d.kind === "trigger") d.set(true);
      else if (d.kind === "bool") d.set(a.value === undefined ? !d.get() : !!a.value);
      else d.set(Math.max(d.min, Math.min(d.max, Number(a.value))));
      app.paramTouched?.(d.id);
      return `${d.name} → ${d.kind === "trigger" ? "disparado" : a.value}`;
    }
    case "color": {
      const ids = surfacesOf(app, a.surface);
      const sc = currentScene(P);
      for (const id of ids) {
        const look = lookOf(sc, id);
        // Si muestra color o animación se cambia su color principal; si no, pasa a color sólido.
        if (look.source.type === "gen" || look.source.type === "text") look.source[look.source.type === "text" ? "textColor" : "color"] = a.color;
        else if (look.source.type === "color") look.source.color = a.color;
        else { look.source.type = "color"; look.source.color = a.color; }
      }
      app.changed({ panel: true }); app.commitSoon();
      return `Color ${a.color} en ${ids.length} superficie(s)`;
    }
    case "scene": {
      if (a.index === "next") { A.stepScene(1); return "Escena siguiente"; }
      if (a.index === "prev") { A.stepScene(-1); return "Escena anterior"; }
      const sc = P.scenes[Number(a.index)];
      if (!sc) throw new Error(`No hay escena ${Number(a.index) + 1}`);
      A.goScene(sc.id);
      return `Escena ${Number(a.index) + 1}: ${sc.name}`;
    }
    case "anim": {
      const item = ANIM_LIBRARY.find(x => x.name.toLowerCase() === String(a.name || "").toLowerCase()) || null;
      const gen = item?.gen || (GENERATORS.find(g => g.id === a.gen || g.name.toLowerCase() === String(a.gen || "").toLowerCase())?.id);
      if (!gen) throw new Error("No existe la animación: " + (a.name || a.gen));
      const sc = currentScene(P);
      for (const id of surfacesOf(app, a.surface)) {
        const look = lookOf(sc, id);
        Object.assign(look.source, { type: "gen", gen, ...(item ? { color: item.color, color2: item.color2, speed: item.speed, scale: item.scale } : {}) });
      }
      app.changed({ panel: true }); app.commitSoon();
      return "Animación: " + (item?.name || gen);
    }
    case "macro": {
      const m = P.settings.control.macros.find(x => x.id === a.id || x.name === a.id);
      if (!m) throw new Error("No existe la macro: " + a.id);
      app.params.runMacro(m.id);
      return "Macro: " + m.name;
    }
    case "go": A.stepScene(1); return "GO";
    case "blackout": if (!!a.value !== S.blackout) A.blackout(); return a.value ? "Apagón" : "Fin del apagón";
    default: throw new Error("Acción desconocida: " + a.type);
  }
}

/** Texto legible de una acción (para listas). */
export function describeAction(app, a) {
  if (!a) return "—";
  switch (a.type) {
    case "param": { const d = describe(app, a.target); return `${d ? d.name : a.target}${d?.kind === "trigger" ? "" : " = " + a.value}`; }
    case "color": return `Color ${a.color} (${a.surface === "all" ? "todas" : a.surface === "sel" ? "seleccionada" : app.surf?.(a.surface)?.name || "superficie"})`;
    case "scene": return a.index === "next" ? "Escena siguiente" : `Escena ${Number(a.index) + 1}`;
    case "anim": return "Animación " + (a.name || a.gen);
    case "macro": return "Macro " + (app.S.project.settings.control.macros.find(m => m.id === a.id)?.name || a.id);
    case "go": return "GO";
    case "blackout": return a.value ? "Apagón" : "Quitar apagón";
  }
  return a.type;
}
