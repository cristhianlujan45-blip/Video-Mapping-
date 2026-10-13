// web/js/lfo.js
// «Animar al ritmo» (como los LFO/envolventes de Resolume): cualquier deslizador o interruptor
// sube y baja solo, sincronizado con el tempo. Se guarda en project.settings.lfos y se aplica
// como modulación en cada fotograma (no toca el valor guardado: al quitarlo, vuelve el tuyo).

// Señales (como los CHOP de TouchDesigner, pero en un toque): al tempo o siguiendo el sonido.
export const LFO_SHAPES = [["sine", "〜 Onda"], ["triangle", "△ Triángulo"], ["saw", "⟋ Sierra"], ["square", "⊓ Pulso"], ["random", "⁂ Azar"],
  ["noise", "≈ Ruido suave"], ["hit", "💥 Golpe que se apaga"], ["randbeat", "🎲 Azar en cada golpe"]];
export const SOUND_SHAPES = [["bass", "🔊 Graves"], ["mid", "🎸 Medios"], ["high", "✨ Agudos"], ["level", "🎚 Volumen"]];
export const isSoundShape = (s) => SOUND_SHAPES.some(x => x[0] === s);
export const LFO_BEATS = [[0.25, "¼"], [0.5, "½"], [1, "1"], [2, "2"], [4, "4"], [8, "8"], [16, "16"], [32, "32"]];
const SHAPES = new Set([...LFO_SHAPES, ...SOUND_SHAPES].map(s => s[0]));

let nextId = 1;
/** Un LFO nuevo para un parámetro (rango completo, onda, cada 4 golpes). */
export const newLfo = (param) => ({ id: "lfo" + Date.now().toString(36) + (nextId++), param, shape: "sine", beats: 4, lo: 0, hi: 1, on: true, smooth: 0, gain: 1 });

export function normalizeLfos(list) {
  if (!Array.isArray(list)) return [];
  const num = (v, d, a, b) => Number.isFinite(+v) ? Math.max(a, Math.min(b, +v)) : d;
  return list.filter(l => l && typeof l.param === "string" && l.param).slice(0, 200).map(l => ({
    id: String(l.id || newLfo("").id), param: l.param.slice(0, 200),
    shape: SHAPES.has(l.shape) ? l.shape : "sine", beats: num(l.beats, 4, 0.0625, 64),
    lo: num(l.lo, 0, 0, 1), hi: num(l.hi, 1, 0, 1), on: l.on !== false,
    smooth: num(l.smooth, 0, 0, 1), gain: num(l.gain, 1, 0.25, 4),
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
    case "noise": {          // ruido suave: valores al azar unidos con curvas (nunca salta)
      const i = Math.floor(cycles), a = hash(i * 1.7 + 3), b = hash((i + 1) * 1.7 + 3), t = p * p * p * (p * (p * 6 - 15) + 10);
      return a + (b - a) * t;
    }
    case "hit": return Math.exp(-p * 5);                      // sube de golpe y se apaga
    case "randbeat": return hash(Math.floor(cycles) * 3.1 + 7);   // un valor nuevo en cada ciclo, sin transición
    default: return 0.5 - 0.5 * Math.cos(p * Math.PI * 2);
  }
}

/** Valor 0..1 de una señal que sigue el sonido (graves, medios, agudos o volumen). */
export function soundAt(shape, levels = {}, gain = 1) {
  const v = shape === "bass" ? levels.bass : shape === "mid" ? levels.mid : shape === "high" ? levels.high : (levels.level ?? Math.max(levels.bass || 0, levels.mid || 0, levels.high || 0));
  return Math.max(0, Math.min(1, (+v || 0) * gain));
}

/**
 * Reloj de golpes que sigue el tempo (si el tempo cambia, la fase no salta) y aplica los LFO.
 * timeSec es tiempo real (no el reloj de la app, que se frena si van pocos fotogramas): el ritmo
 * no se retrasa en un equipo lento. Con playing = false el reloj se para.
 * apply(lfo, value01) recibe cada uno ya mezclado en su rango.
 */
export function createLfoClock() {
  let beat = 0, last = null;
  const values = new Map();   // id → último valor 0..1 (para el monitor de señales)
  return {
    get beat() { return beat; },
    values,
    tick(timeSec, bpm, lfos, apply, playing = true, levels = null) {
      const dt = last !== null && timeSec >= last ? Math.min(2, timeSec - last) : 0;
      if (playing) beat += dt * Math.max(20, Math.min(300, bpm || 120)) / 60;
      last = timeSec;
      for (const l of lfos) {
        if (!l.on) continue;
        let w = isSoundShape(l.shape) ? soundAt(l.shape, levels || {}, l.gain || 1) : shapeAt(l.shape, beat / Math.max(0.0625, l.beats));
        // Suavizado (lag): 0 = al instante; 1 = tarda ~0.6 s en llegar.
        const prev = values.get(l.id);
        if (l.smooth > 0 && prev !== undefined) w = prev + (w - prev) * (1 - Math.exp(-dt / (l.smooth * 0.6)));
        values.set(l.id, w);
        apply(l, l.lo + (l.hi - l.lo) * w);
      }
      for (const id of values.keys()) if (!lfos.some(l => l.id === id && l.on)) values.delete(id);
    },
  };
}
