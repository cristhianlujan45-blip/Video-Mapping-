// web/js/midi-android.js
// MIDI en Android: la WebView no trae Web MIDI, así que la app abre los
// controladores USB / Bluetooth con el MIDI de Android (MidiHub.kt) y aquí se
// imita la parte de Web MIDI que usa midi.js: inputs/outputs (Map), onmidimessage,
// onstatechange y send(). midi.js no distingue entre plataformas.
// · Android entrega bytes sueltos (varios mensajes juntos o uno a medias, con
//   «running status»): MidiFramer los separa en mensajes completos.
// · Las marcas de tiempo nativas (System.nanoTime) se pasan al reloj de la
//   página (performance.now) para que el BPM del MIDI Clock no tiemble.

const now = () => (globalThis.performance?.now ? performance.now() : Date.now());

/** Separa un flujo de bytes MIDI en mensajes completos. Los SysEx se descartan (midi.js no los usa). */
export class MidiFramer {
  constructor(onMessage) { this.onMessage = onMessage; this.status = 0; this.need = 0; this.buf = []; this.sysex = false; }
  push(bytes, t) {
    for (const b of bytes) {
      if (b >= 0xf8) { this.onMessage(Uint8Array.of(b), t); continue; }     // tiempo real: en medio de cualquier cosa
      if (b === 0xf0) { this.sysex = true; this.status = 0; this.buf = []; continue; }
      if (b === 0xf7) { this.sysex = false; continue; }
      if (b >= 0x80) {
        this.sysex = false; this.buf = [b];
        if (b < 0xf0) { this.status = b; this.need = (b & 0xf0) === 0xc0 || (b & 0xf0) === 0xd0 ? 1 : 2; }
        else { this.status = 0; this.need = b === 0xf2 ? 2 : b === 0xf1 || b === 0xf3 ? 1 : 0; }
        if (!this.need) { this.onMessage(Uint8Array.of(b), t); this.buf = []; }
        continue;
      }
      if (this.sysex) continue;
      if (!this.buf.length) { if (!this.status) continue; this.buf = [this.status]; }   // running status
      this.buf.push(b);
      if (this.buf.length - 1 >= this.need) { this.onMessage(Uint8Array.from(this.buf), t); this.buf = []; }
    }
  }
}

/** Crea un objeto tipo MIDIAccess sobre el puente nativo N (window.LumaNative). */
export function createAndroidMidiAccess(N, win = globalThis) {
  const access = { inputs: new Map(), outputs: new Map(), sysexEnabled: false, onstatechange: null };
  const framers = new Map();
  let offset = null;   // performance.now() − reloj nativo (el menor visto = el retraso mínimo)
  const toPage = (tNative) => {
    const n = now();
    if (!(tNative > 0)) return n;
    const d = n - tNative;
    if (offset === null || d < offset || d - offset > 2000) offset = d;   // > 2 s: el reloj cambió, se vuelve a medir
    return Math.min(n, tNative + offset);
  };
  const makePort = (p) => {
    const port = { id: p.id, name: p.name || "MIDI", manufacturer: p.manufacturer || "", version: "", type: p.type, state: "connected", connection: "open", onmidimessage: null,
      open: () => Promise.resolve(port), close: () => Promise.resolve(port) };
    if (p.type === "output") {
      port.send = (data, ts) => {
        const bytes = Array.from(data, (v) => v & 0xff);
        const go = () => { if (port.state === "connected") N.midiSend(port.id, bytes.join(",")); };
        const wait = ts ? ts - now() : 0;
        if (wait > 1) setTimeout(go, wait); else go();   // MIDI Clock de salida: se envía a su hora
      };
      port.clear = () => {};
    } else framers.set(p.id, new MidiFramer((data, t) => port.onmidimessage?.({ data, timeStamp: t, target: port })));
    return port;
  };
  const refresh = () => {
    let list = [];
    try { list = JSON.parse(N.midiPorts() || "[]"); } catch {}
    const seen = new Set(list.map(p => p.id)), changed = [];
    for (const map of [access.inputs, access.outputs]) for (const [id, port] of map) if (!seen.has(id)) {
      port.state = "disconnected"; port.connection = "closed"; map.delete(id); framers.delete(id); changed.push(port);
    }
    for (const p of list) {
      const map = p.type === "output" ? access.outputs : access.inputs;
      if (!map.has(p.id)) { const port = makePort(p); map.set(p.id, port); changed.push(port); }
    }
    for (const port of changed) { try { access.onstatechange?.({ port }); } catch (e) { console.warn(e); } }
  };
  // La app llama aquí: lotes [[id, t_ms_nativo, b0, b1, …], …] y cambios de dispositivos.
  win.__lumaMidi = (batch) => {
    for (const [id, t, ...bytes] of batch) {
      const f = framers.get(id);
      if (f) { try { f.push(bytes, toPage(t)); } catch (e) { console.warn(e); } }
    }
  };
  win.__lumaMidiState = refresh;
  refresh();
  return access;
}

/** Instala navigator.requestMIDIAccess si la app trae el puente MIDI y la WebView no tiene Web MIDI. */
export function installAndroidMidi(N = globalThis.LumaNative, nav = globalThis.navigator, win = globalThis) {
  if (!N?.midiStart || !nav || nav.requestMIDIAccess) return false;
  let access = null;
  nav.requestMIDIAccess = async () => {
    if (access) return access;
    if (!N.midiStart()) throw Object.assign(new Error("este teléfono no tiene MIDI de Android"), { name: "NotSupportedError" });
    return (access = createAndroidMidiAccess(N, win));
  };
  return true;
}
