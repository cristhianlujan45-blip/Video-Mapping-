// web/js/usbdmx.js
// Interfaces USB-DMX con el protocolo «DMX USB Pro» (Enttec DMX USB Pro y las
// compatibles: DMXking ultraDMX, Eurolite USB-DMX512 PRO y muchas más). Van por
// Web Serial: en la app de Windows se detectan al enchufarlas (chip FTDI o nombre
// del dispositivo) y LumaMap envía el universo por ellas.
// Mensaje: 0x7E, etiqueta 6 (Output Only Send DMX), longitud LSB, MSB, código de
// inicio 0x00 + 512 canales, 0xE7.

export const FTDI_VID = 0x0403;
const LABEL_SEND_DMX = 6;

export function proPacket(data) {
  const n = Math.min(512, data.length) + 1;
  const p = new Uint8Array(n + 4 + 1);
  p[0] = 0x7e; p[1] = LABEL_SEND_DMX; p[2] = n & 0xff; p[3] = n >> 8;
  p[4] = 0x00; p.set(data.subarray(0, n - 1), 5);
  p[p.length - 1] = 0xe7;
  return p;
}
/** ¿Parece una interfaz DMX? (chip FTDI o nombre conocido) */
export const looksLikeDmx = (info) => info?.usbVendorId === FTDI_VID || /dmx|enttec|ultradmx|eurolite|dmxking/i.test(info?.name || "");

export class UsbDmx {
  constructor() { this.port = null; this.writer = null; this.busy = false; this.info = null; this.error = ""; this.frames = 0; this.onChange = () => {}; }
  get supported() { return !!globalThis.navigator?.serial; }
  get ready() { return !!this.writer; }
  /** Abre una interfaz ya autorizada (al arrancar o al enchufarla). */
  async auto() {
    if (!this.supported || this.port) return false;
    try {
      const ports = await navigator.serial.getPorts();
      const p = ports.find(x => looksLikeDmx(x.getInfo())) || null;
      if (p) return this.open(p);
    } catch (e) { this.error = e.message; }
    return false;
  }
  /** Pide una interfaz (necesita un gesto del usuario; en Windows se elige sola). */
  async request() {
    if (!this.supported) { this.error = "Este sistema no permite USB-DMX desde aquí."; return false; }
    try { return this.open(await navigator.serial.requestPort({ filters: [{ usbVendorId: FTDI_VID }] })); }
    catch (e) { this.error = /No port selected|NotFoundError/.test(String(e)) ? "No hay ninguna interfaz USB-DMX conectada." : e.message; this.onChange(); return false; }
  }
  async open(p) {
    try {
      await p.open({ baudRate: 250000, dataBits: 8, stopBits: 2, parity: "none", bufferSize: 1024 });
      this.port = p; this.writer = p.writable.getWriter(); this.info = p.getInfo(); this.error = "";
      p.addEventListener?.("disconnect", () => this.lost());
      this.onChange();
      return true;
    } catch (e) { this.error = "No se pudo abrir la interfaz USB-DMX: " + e.message; this.onChange(); return false; }
  }
  lost() { try { this.writer?.releaseLock(); } catch {} this.writer = null; this.port = null; this.error = "La interfaz USB-DMX se desconectó."; this.onChange(); }
  /** Envía un universo; si el envío anterior no ha terminado se salta (nunca acumula retraso). */
  send(data) {
    if (!this.writer || this.busy) return;
    this.busy = true;
    this.writer.write(proPacket(data)).then(() => { this.frames++; }, () => this.lost()).finally(() => { this.busy = false; });
  }
  async close() { try { await this.writer?.close(); } catch {} try { await this.port?.close(); } catch {} this.writer = null; this.port = null; this.onChange(); }
}
