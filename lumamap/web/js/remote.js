// web/js/remote.js
// Cliente WebSocket del protocolo LumaMap (control remoto + sincronización).
export class Remote {
  constructor({ url, role = "display", name = "display", pin = "", onControl, onState, onDisplays, onStatus, onOsc, onAuth, onMessage, onBinary } = {}) {
    this.url = url || ((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws");
    this.role = role; this.name = name;
    this.onControl = onControl; this.onState = onState;
    this.onDisplays = onDisplays; this.onStatus = onStatus || (() => {});
    this.onOsc = onOsc; this.onAuth = onAuth; this.pin = pin;
    this.onMessage = onMessage;   // el resto (p. ej. cámaras de los móviles)
    this.onBinary = onBinary;     // imágenes de un móvil por cable USB
    this.ws = null; this.retry = 0; this.closed = false;
  }
  connect() {
    if (this.closed) return;
    this.onStatus("conectando...");
    try { this.ws = new WebSocket(this.url); } catch { return this.scheduleRetry(); }
    this.ws.onopen = () => {
      this.retry = 0;
      this.onStatus("conectado");
      this.send({ type: "hello", role: this.role, name: this.name, pin: this.pin });
    };
    this.ws.binaryType = "arraybuffer";
    this.ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") { this.onBinary?.(ev.data); return; }
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === "control" && this.onControl) this.onControl(msg);
      else if (msg.type === "state" && this.onState) this.onState(msg.state);
      else if (msg.type === "displays" && this.onDisplays) this.onDisplays(msg.displays);
      else if (msg.type === "osc" && this.onOsc) this.onOsc(msg);
      else if (msg.type === "auth") { this.authOk = msg.ok; if (!msg.ok) this.closedByAuth = true; this.onAuth?.(msg); }
      else this.onMessage?.(msg);
    };
    this.ws.onclose = () => { this.onStatus("desconectado"); this.scheduleRetry(); };
    this.ws.onerror = () => { try { this.ws.close(); } catch {} };
  }
  scheduleRetry() {
    if (this.closed || this.closedByAuth) return;
    const delay = Math.min(15000, 500 * 2 ** this.retry++);
    setTimeout(() => this.connect(), delay); // recuperación automática
  }
  send(obj) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); }
  sendControl(action, value, id) { this.send({ type: "control", action, value, id }); }
  sendState(state) { this.send({ type: "state", state }); }
  close() { this.closed = true; try { this.ws && this.ws.close(); } catch {} }
}
