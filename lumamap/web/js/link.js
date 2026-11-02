// web/js/link.js
// Canal editor ↔ salida.
//  · Navegador: BroadcastChannel (misma máquina, ventana de salida aparte).
//  · App Android: puente nativo LumaNative, que reenvía los mensajes a la
//    WebView que se muestra en el proyector (HDMI / USB-C / pantalla externa).
const CHANNEL = "lumamap-link-v2";

export function nativeBridge() {
  return typeof window !== "undefined" && window.LumaNative ? window.LumaNative : null;
}

export class Link {
  /** role: "editor" | "output" */
  constructor(role, onMessage) {
    this.role = role;
    this.onMessage = onMessage;
    this.native = nativeBridge();
    this.bc = null;
    if (typeof BroadcastChannel !== "undefined") {
      this.bc = new BroadcastChannel(CHANNEL);
      this.bc.onmessage = (e) => this.onMessage(e.data);
    }
    // El puente nativo entrega los mensajes llamando a esta función global.
    window.__lumaIn = (msg) => {
      try { this.onMessage(typeof msg === "string" ? JSON.parse(msg) : msg); } catch (e) { console.warn(e); }
    };
  }
  send(msg) {
    if (this.native) {
      const s = JSON.stringify(msg);
      try {
        if (this.role === "editor") this.native.toOutput(s); else this.native.toEditor(s);
      } catch { /* la salida nativa no está activa */ }
      return;
    }
    if (this.bc) this.bc.postMessage(msg);
  }
}
