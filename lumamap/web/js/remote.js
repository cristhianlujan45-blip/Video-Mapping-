// web/js/remote.js
// Cliente WebSocket del protocolo LumaMap (control remoto + sincronización).
export class Remote {
  constructor({ url, role = "display", name = "display", onControl, onState, onDisplays, onStatus } = {}) {
    this.url = url || ((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws");
    this.role = role; this.name = name;
    this.onControl = onControl; this.onState = onState;
    this.onDisplays = onDisplays; this.onStatus = onStatus || (() => {});
    this.ws = null; this.retry = 0; this.closed = false;
  }
  connect() {
    if (this.closed) return;
    this.onStatus("conectando...");
    try { this.ws = new WebSocket(this.url); } catch { return this.scheduleRetry(); }
    this.ws.onopen = () => {
      this.retry = 0;
      this.onStatus("conectado");
      this.send({ type: "hello", role: this.role, name: this.name });
    };
    this.ws.onmessage = (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === "control" && this.onControl) this.onControl(msg);
      else if (msg.type === "state" && this.onState) this.onState(msg.state);
      else if (msg.type === "displays" && this.onDisplays) this.onDisplays(msg.displays);
    };
    this.ws.onclose = () => { this.onStatus("desconectado"); this.scheduleRetry(); };
    this.ws.onerror = () => { try { this.ws.close(); } catch {} };
  }
  scheduleRetry() {
    if (this.closed) return;
    const delay = Math.min(15000, 500 * 2 ** this.retry++);
    setTimeout(() => this.connect(), delay); // recuperación automática
  }
  send(obj) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); }
  sendControl(action, value) { this.send({ type: "control", action, value }); }
  sendState(state) { this.send({ type: "state", state }); }
  close() { this.closed = true; try { this.ws && this.ws.close(); } catch {} }
}
