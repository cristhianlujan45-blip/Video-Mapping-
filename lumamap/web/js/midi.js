// web/js/midi.js
// Control MIDI vía Web MIDI API (Chrome/Edge/Opera; requiere HTTPS o localhost).
// Mapeo fijo y documentado:
//   Nota ON 36..51  -> ir a escena 0..15
//   Nota 60 play · 61 pause · 62 stop · 63 next · 64 prev
//   CC 1  -> brillo master · CC 21 -> opacidad de la superficie seleccionada
export const MIDI_MAP = {
  firstSceneNote: 36, maxScenes: 16,
  play: 60, pause: 61, stop: 62, next: 63, prev: 64,
  brightnessCC: 1, opacityCC: 21,
};

export async function initMIDI({ onAction, onStatus }) {
  if (!navigator.requestMIDIAccess) {
    onStatus("MIDI: Web MIDI no disponible en este navegador (usa Chrome/Edge y https o localhost)");
    return false;
  }
  try {
    const access = await navigator.requestMIDIAccess({ sysex: false });
    const bind = () => {
      for (const input of access.inputs.values()) {
        input.onmidimessage = (e) => {
          const [statusByte, d1, d2] = e.data;
          const type = statusByte & 0xf0;
          if (type === 0x90 && d2 > 0) {          // Note ON
            const M = MIDI_MAP;
            if (d1 >= M.firstSceneNote && d1 < M.firstSceneNote + M.maxScenes)
              onAction("goto", d1 - M.firstSceneNote);
            else if (d1 === M.play) onAction("play");
            else if (d1 === M.pause) onAction("pause");
            else if (d1 === M.stop) onAction("stop");
            else if (d1 === M.next) onAction("next");
            else if (d1 === M.prev) onAction("prev");
          } else if (type === 0xb0) {             // Control Change
            const v = d2 / 127;
            if (d1 === MIDI_MAP.brightnessCC) onAction("brightness", v);
            if (d1 === MIDI_MAP.opacityCC) onAction("opacity", v);
          }
        };
      }
      onStatus(`MIDI: ${access.inputs.size} dispositivo(s) conectado(s)`);
    };
    bind();
    access.onstatechange = bind;
    return true;
  } catch (err) {
    onStatus("MIDI: permiso denegado (" + err.message + ")");
    return false;
  }
}
