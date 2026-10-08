/**
 * Remote control web app (phone / tablet / another PC, installable as a PWA on Android).
 * It only sends commands and shows state; rendering stays on the Windows machine.
 */
import type { RemoteCommand, RemoteState } from '../../shared/net/messages';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let ws: WebSocket | null = null;
let pin = localStorage.getItem('lujan.pin') ?? '';
let state: RemoteState | null = null;
let retry = 0;
const dragging = new Set<string>();

function connect() {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  ws = new WebSocket(url);
  ws.onopen = () => {
    retry = 0;
    $('conn').textContent = 'Conectado';
    if (pin) ws!.send(JSON.stringify({ type: 'auth', pin }));
  };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data as string);
    if (m.type === 'auth') {
      if (m.ok) {
        localStorage.setItem('lujan.pin', pin);
        $('login').hidden = true;
        $('app').hidden = false;
      } else {
        $('err').textContent = m.error;
        $('login').hidden = false;
        $('app').hidden = true;
      }
    } else if (m.type === 'state') {
      state = m.state;
      render();
    } else if (m.type === 'param' && state) {
      const p = state.params.find((x) => x.id === m.id);
      if (p) p.value = m.value;
      render();
    }
  };
  ws.onclose = () => {
    $('conn').textContent = 'Desconectado — reintentando…';
    setTimeout(connect, Math.min(5000, 500 * ++retry));
  };
}

function send(command: RemoteCommand) {
  if (navigator.vibrate) navigator.vibrate(10);
  ws?.send(JSON.stringify({ type: 'command', command }));
}

function render() {
  if (!state) return;
  $('show').textContent = `· ${state.showName} · ${Math.round(state.fps)} fps ${state.dmxOk ? '· DMX' : ''}`;
  $('tc').textContent = state.timecode;
  const sc = $('scenes');
  sc.innerHTML = '';
  for (const s of state.scenes) {
    const b = document.createElement('button');
    b.textContent = s.name;
    if (s.active) b.className = 'active';
    else if (s.preview) b.className = 'preview';
    b.onclick = () => send({ cmd: 'scene', id: s.id });
    sc.appendChild(b);
  }
  $('cuesec').hidden = state.cues.length === 0;
  const cu = $('cues');
  cu.innerHTML = '';
  for (const c of state.cues) {
    const b = document.createElement('button');
    b.textContent = c.name;
    if (c.active) b.className = 'active';
    b.onclick = () => send({ cmd: 'cue', id: c.id });
    cu.appendChild(b);
  }
  const fd = $('faders');
  for (const p of state.params) {
    let el = fd.querySelector<HTMLDivElement>(`[data-id="${p.id}"]`);
    if (!el) {
      el = document.createElement('div');
      el.className = 'fader';
      el.dataset.id = p.id;
      el.innerHTML = '<div class="fill"></div><span></span><em></em>';
      const set = (ev: PointerEvent) => {
        const r = el!.getBoundingClientRect();
        const n = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
        const cur = state!.params.find((x) => x.id === p.id)!;
        cur.value = cur.min + n * (cur.max - cur.min);
        send({ cmd: 'param', id: p.id, value: cur.value });
        render();
      };
      el.onpointerdown = (ev) => {
        el!.setPointerCapture(ev.pointerId);
        dragging.add(p.id);
        set(ev);
      };
      el.onpointermove = (ev) => dragging.has(p.id) && set(ev);
      el.onpointerup = () => dragging.delete(p.id);
      fd.appendChild(el);
    }
    const n = (p.value - p.min) / (p.max - p.min || 1);
    (el.querySelector('.fill') as HTMLElement).style.width = `${n * 100}%`;
    el.querySelector('span')!.textContent = p.name;
    el.querySelector('em')!.textContent = p.value.toFixed(2);
  }
  $('blackout').className = `blackout ${state.blackout ? 'on' : ''}`;
}

for (const b of document.querySelectorAll<HTMLButtonElement>('[data-t]')) b.onclick = () => send({ cmd: 'transport', action: b.dataset.t as 'play' });
$('take').onclick = () => send({ cmd: 'take' });
$('blackout').onclick = () => send({ cmd: 'blackout', on: !state?.blackout });
$('go').onclick = () => {
  pin = ($('pin') as HTMLInputElement).value.trim();
  ws?.send(JSON.stringify({ type: 'auth', pin }));
};
($('pin') as HTMLInputElement).value = pin;
connect();
