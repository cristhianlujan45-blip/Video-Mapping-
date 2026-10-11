// web/js/lfo.js
// «Animar al ritmo» (como los LFO/envolventes de Resolume): cualquier deslizador o interruptor
// sube y baja solo, sincronizado con el tempo. Se guarda en project.settings.lfos y se aplica
// como modulación en cada fotograma (no toca el valor guardado: al quitarlo, vuelve el tuyo).

export const LFO_SHAPES = [["sine", "〜 Onda"], ["triangle", "△ Triángulo"], ["saw", "⟋ Sierra"], ["square", "⊓ Pulso"], ["random", "⁂ Azar"]];
export const LFO_BEATS = [[0.25, "¼"], [0.5, "½"], [1, "1"], [2, "2"], [4, "4"], [8, "8"], [16, "16"], [32, "32"]];
const SHAPES = new Set(LFO_SHAPES.map(s => s[0]));

let nextId = 1;
/** Un LFO nuevo para un parámetro (rango completo, onda, cada 4 golpes). */
export const newLfo = (param) => ({ id: "lfo" + Date.now().toString(36) + (nextId++), param, shape: "sine", beats: 4, lo: 0, hi: 1, on: true });

export function normalizeLfos(list) {
  if (!Array.isArray(list)) return [];
  const num = (v, d, a, b) => Number.isFinite(+v) ? Math.max(a, Math.min(b, +v)) : d;
  return list.filter(l => l && typeof l.param === "string" && l.param).slice(0, 200).map(l => ({
    id: String(l.id || newLfo("").id), param: l.param.slice(0, 200),
    shape: SHAPES.has(l.shape) ? l.shape : "sine", beats: num(l.beats, 4, 0.0625, 64),
    lo: num(l.lo, 0, 0, 1), hi: num(l.hi, 1, 0, 1), on: l.on !== false,
  }));
}

const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
/** Valor 0..1 de una forma en la fase (golpes / golpes por ciclo). */
export function shapeAt(shape, cycles) {
  const p = cycles - Math.floor(cycles);
  switch (shape) {
    case "triangle": return 1 - Math.abs(p * 2 - 1);
    case "saw": return p;
    case "square": return p < 0.5 ? 1 : 0;
    case "random": {          // un valor al azar por ciclo, con un paso suave
      const i = Math.floor(cycles), a = hash(i), b = hash(i + 1), t = Math.min(1, p * 6);
      return a + (b - a) * t * t * (3 - 2 * t);
    }
    default: return 0.5 - 0.5 * Math.cos(p * Math.PI * 2);
  }
}

/**
 * Reloj de golpes que sigue el tempo (si el tempo cambia, la fase no salta) y aplica los LFO.
 * timeSec es tiempo real (no el reloj de la app, que se frena si van pocos fotogramas): el ritmo
 * no se retrasa en un equipo lento. Con playing = false el reloj se para.
 * apply(lfo, value01) recibe cada uno ya mezclado en su rango.
 */
export function createLfoClock() {
  let beat = 0, last = null;
  return {
    get beat() { return beat; },
    tick(timeSec, bpm, lfos, apply, playing = true) {
      if (playing && last !== null && timeSec >= last) beat += Math.min(2, timeSec - last) * Math.max(20, Math.min(300, bpm || 120)) / 60;
      last = timeSec;
      for (const l of lfos) {
        if (!l.on) continue;
        const w = shapeAt(l.shape, beat / Math.max(0.0625, l.beats));
        apply(l, l.lo + (l.hi - l.lo) * w);
      }
    },
  };
}
