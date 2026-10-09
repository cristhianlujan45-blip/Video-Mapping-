// web/js/gamepad.js
// Mandos de juego (Xbox, PlayStation, Switch Pro, genéricos USB/Bluetooth) como
// fuente del motor de parámetros. Cada mando es un dispositivo propio («Mando 1»,
// «Mando 2»…), así que varios mandos, el teclado y los controladores MIDI pueden
// estar asignados a la vez y controlar cosas distintas.

/** Nombres de los botones del mapeo estándar (Xbox · PlayStation). */
export const PAD_BUTTONS = [
  ["A", "✕"], ["B", "○"], ["X", "□"], ["Y", "△"], ["LB", "L1"], ["RB", "R1"], ["LT", "L2"], ["RT", "R2"],
  ["View", "Share"], ["Menu", "Options"], ["Stick izq.", "L3"], ["Stick der.", "R3"],
  ["Cruceta ↑", "Cruceta ↑"], ["Cruceta ↓", "Cruceta ↓"], ["Cruceta ←", "Cruceta ←"], ["Cruceta →", "Cruceta →"], ["Xbox", "PS"], ["Panel", "Panel táctil"],
];
export const PAD_AXES = ["Stick izq. ↔", "Stick izq. ↕", "Stick der. ↔", "Stick der. ↕"];
const ANALOG = new Set([6, 7]);   // gatillos: valor 0..1, no solo pulsado
const DEAD = 0.12;                // zona muerta de los sticks (sin deriva)

/** Tipo de mando por su nombre. */
export function padKind(id = "") {
  const s = id.toLowerCase();
  if (/xbox|xinput|microsoft|045e/.test(s)) return "xbox";
  if (/playstation|dualshock|dualsense|sony|054c|wireless controller/.test(s)) return "playstation";
  if (/nintendo|switch|pro controller|057e/.test(s)) return "switch";
  return "generic";
}
const KIND_NAMES = { xbox: "Xbox", playstation: "PlayStation", switch: "Switch", generic: "Mando" };

/** Nombre legible de un control del mando («btn:0» → «A / ✕»). */
export function padControlName(key, kind = "generic") {
  const [t, n] = String(key).split(":");
  if (t === "btn") {
    const b = PAD_BUTTONS[+n];
    if (!b) return "Botón " + (+n + 1);
    return kind === "xbox" ? b[0] : kind === "playstation" ? b[1] : b[0] === b[1] ? b[0] : `${b[0]} / ${b[1]}`;
  }
  if (t === "axis") return PAD_AXES[+n] || "Eje " + (+n + 1);
  return key;
}

export const deviceName = (index) => "Mando " + (index + 1);

export class GamepadHub {
  /** onInput(ev) recibe { src:"gamepad", device, key, v, on, button, label }. */
  constructor(onInput, opts = {}) {
    this.onInput = onInput;
    this.learning = opts.learning || (() => false);
    this.prev = new Map();    // índice -> { b: [], a: [] }
    this.supported = typeof navigator !== "undefined" && typeof navigator.getGamepads === "function";
    this.onChange = null;
    if (this.supported && typeof addEventListener === "function") {
      addEventListener("gamepadconnected", () => this.onChange?.());
      addEventListener("gamepaddisconnected", (e) => { this.prev.delete(e.gamepad?.index); this.onChange?.(); });
    }
  }
  pads() {
    if (!this.supported) return [];
    try { return [...navigator.getGamepads()].filter(p => p && p.connected !== false); } catch { return []; }
  }
  /** Mandos conectados: [{ index, device, kind, kindName, id }]. */
  list() {
    return this.pads().map(p => { const kind = padKind(p.id); return { index: p.index, device: deviceName(p.index), kind, kindName: KIND_NAMES[kind], id: p.id }; });
  }
  /** Tipo de mando de un dispositivo («Mando 2» → "playstation"). */
  kindOf(device) { const p = this.list().find(x => x.device === device); return p ? p.kind : "generic"; }
  /** Se llama en cada fotograma: envía solo lo que cambió. */
  poll() {
    for (const p of this.pads()) {
      let st = this.prev.get(p.index);
      const first = !st;
      if (!st) this.prev.set(p.index, st = { b: [], a: [], kind: padKind(p.id) });
      const device = deviceName(p.index), learn = this.learning();
      p.buttons.forEach((b, i) => {
        const v = typeof b === "object" ? (b.value || (b.pressed ? 1 : 0)) : +b || 0;
        const on = typeof b === "object" ? (b.pressed || v > 0.5) : v > 0.5;
        const old = st.b[i];
        st.b[i] = { v, on };
        if (first) return;   // el primer estado no dispara nada
        const label = `${device} ${padControlName("btn:" + i, st.kind)}`;
        if (ANALOG.has(i)) {
          if (learn) { if (on && !old?.on) this.onInput({ src: "gamepad", device, key: "btn:" + i, v, on: true, label }); return; }
          if (!old || Math.abs(v - old.v) > 0.004 || on !== old.on) this.onInput({ src: "gamepad", device, key: "btn:" + i, v, on, label });
        } else if (!old || on !== old.on) {
          this.onInput({ src: "gamepad", device, key: "btn:" + i, v: on ? 1 : 0, on, button: true, label: (on ? "" : "Soltar ") + label });
        }
      });
      p.axes.forEach((raw, i) => {
        const a = Math.abs(raw) < DEAD ? 0 : (raw - Math.sign(raw) * DEAD) / (1 - DEAD);
        const old = st.a[i];
        st.a[i] = a;
        if (first || old === undefined) return;
        const label = `${device} ${padControlName("axis:" + i, st.kind)}`;
        // Al aprender, solo cuenta un movimiento claro (no la deriva del stick).
        if (learn) { if (Math.abs(a) > 0.6 && Math.abs(old) <= 0.6) this.onInput({ src: "gamepad", device, key: "axis:" + i, v: (a + 1) / 2, label }); return; }
        if (Math.abs(a - old) > 0.004) this.onInput({ src: "gamepad", device, key: "axis:" + i, v: (a + 1) / 2, label });
      });
    }
  }
}

/** Mapa básico para un mando: lo típico de un show con un mando en la mano. */
export function basicPadMap(device = "*") {
  const m = (key, target, mode = "trigger", extra = {}) => ({ src: "gamepad", device, key, target, mode, name: "Mapa de mando", ...extra });
  return [
    m("btn:0", "global/go"), m("btn:1", "global/prev"), m("btn:2", "global/play", "toggle"), m("btn:3", "global/blackout", "toggle"),
    m("btn:4", "global/prev"), m("btn:5", "global/next"), m("btn:9", "global/randomAll"), m("btn:8", "global/tap"),
    m("btn:7", "global/master", "absolute", { invert: true }),   // RT: apretar = bajar el brillo; soltar = vuelve
    m("btn:12", "surf/sel/opacity", "absolute", { min: 1, max: 1 }), m("btn:13", "surf/sel/opacity", "absolute", { min: 0, max: 0 }),
    m("btn:14", "global/goAll"), m("btn:15", "surf/sel/random"),
  ];
}
