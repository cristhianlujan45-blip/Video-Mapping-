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

/**
 * Android: la WebView no trae Web Serial. La app habla con la interfaz FTDI por
 * USB (UsbDmx.kt, cable OTG) y aquí se arma el mismo paquete «DMX USB Pro».
 * Misma forma que UsbDmx, así dmx.js no distingue entre plataformas.
 * Sin probar todavía con hardware real (ver UsbDmx.kt).
 */
const toB64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); };
export class AndroidUsbDmx extends UsbDmx {
  constructor(N = globalThis.LumaNative) {
    super();
    this.N = N; this.android = true; this.isOpen = false;
    // La app avisa al enchufar / quitar la interfaz y con la respuesta al permiso USB.
    globalThis.__lumaUsbDmx = (ev) => {
      if (ev.state === "attached") this.open(true);
      else if (ev.state === "permission") { if (ev.ok) this.open(false); else { this.error = "Permiso USB denegado: vuelve a pulsar «Conectar» y acéptalo."; this.onChange(); } }
      else if (ev.state === "detached" || ev.state === "lost") { this.isOpen = false; this.error = "La interfaz USB-DMX se desconectó."; this.onChange(); }
    };
    try { N.usbDmxWatch?.(); } catch {}
  }
  get supported() { return !!this.N?.usbDmxOpen; }
  get ready() { return this.isOpen; }
  /** Al arrancar: solo abre si Android ya dio permiso (no muestra ventanas). */
  async auto() { return this.isOpen ? false : this.open(false); }
  async request() { return this.open(true); }
  async open(ask) {
    let r;
    try { r = JSON.parse(this.N.usbDmxOpen(!!ask)); } catch (e) { r = { ok: false, code: "error", msg: e.message }; }
    const was = this.isOpen;
    this.isOpen = !!r.ok;
    if (r.ok) { this.info = { name: r.name || "USB-DMX" }; this.error = ""; }
    else if (r.code === "none") this.error = ask ? "No hay ninguna interfaz USB-DMX conectada (chip FTDI, con cable USB-OTG)." : "";
    else if (r.code === "asked") this.error = "Acepta el permiso USB en la pantalla de Android.";
    else if (r.code === "permission") this.error = "";
    else this.error = "No se pudo abrir la interfaz USB-DMX: " + (r.msg || "error");
    if (this.isOpen !== was || this.error || ask) this.onChange();
    return this.isOpen;
  }
  /** Si el envío anterior aún no terminó, la app se salta este fotograma. */
  send(data) {
    if (!this.isOpen) return;
    try { if (this.N.usbDmxSend(toB64(proPacket(data)))) this.frames++; } catch { this.isOpen = false; this.onChange(); }
  }
  async close() { try { this.N.usbDmxClose(); } catch {} this.isOpen = false; this.onChange(); }
}
