import { lujan } from '../api';

type PortHandler = (port: MessagePort) => void;

const handlers = new Map<string, PortHandler>();
const received = new Map<string, MessagePort>();

/**
 * MessagePorts to the DMX/network processes arrive through window.postMessage from the
 * preload. A service restart delivers a fresh port with the same name.
 */
window.addEventListener('message', (e) => {
  const info = (e.data as { __lujanPort?: { name: string; role: string } })?.__lujanPort;
  if (!info || e.source !== window || !e.ports[0]) return;
  const key = `${info.name}:${info.role}`;
  received.set(key, e.ports[0]);
  handlers.get(key)?.(e.ports[0]);
});

export function onPort(key: string, h: PortHandler) {
  handlers.set(key, h);
  const p = received.get(key);
  if (p) h(p);
}

/** Resolves with the first port for a key (waits for it if needed). */
export function waitPort(key: string, timeoutMs = 5000): Promise<MessagePort | null> {
  const p = received.get(key);
  if (p) return Promise.resolve(p);
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), timeoutMs);
    const prev = handlers.get(key);
    handlers.set(key, (port) => {
      clearTimeout(t);
      if (prev) handlers.set(key, prev);
      resolve(port);
    });
  });
}

export async function requestPorts() {
  if (!lujan) return;
  await lujan.invoke('ports:request');
}
