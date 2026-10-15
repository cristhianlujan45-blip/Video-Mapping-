// web/js/ltc-worklet.js — AudioWorklet: decodifica LTC en el hilo de audio.
import { LtcDecoder } from "./ltc-core.js";

class LtcProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.dec = new LtcDecoder(sampleRate);
    this.dec.onFrame = (tc) => this.port.postMessage(tc);
  }
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (ch) this.dec.process(ch);
    return true;
  }
}
registerProcessor("lumamap-ltc", LtcProcessor);
