/**
 * Entry point of the DMX utility process (Electron utilityProcess).
 * Main hands over MessagePorts (one for the control UI, one for the render worker);
 * every port can send ToDmx messages and receives FromDmx broadcasts.
 */
import type { MessagePortMain } from 'electron';
import type { FromDmx, ToDmx } from '../shared/dmx/messages';
import { DmxEngine } from './dmxEngine';

const ports = new Set<MessagePortMain>();

const engine = new DmxEngine((m: FromDmx) => {
  for (const p of ports) {
    try {
      p.postMessage(m);
    } catch {
      ports.delete(p);
    }
  }
});

process.parentPort.on('message', (e) => {
  const data = e.data as { type: string };
  if (data?.type === 'port') {
    for (const port of e.ports) {
      ports.add(port);
      port.on('message', (ev) => engine.handle(ev.data as ToDmx));
      port.on('close', () => ports.delete(port));
      port.start();
    }
  } else if (data?.type === 'shutdown') {
    void engine.dispose().then(() => {
      process.parentPort.postMessage({ type: 'shutdown-done' });
      process.exit(0);
    });
  } else if (data?.type) {
    engine.handle(data as ToDmx);
  }
});

process.on('uncaughtException', (err) => {
  process.parentPort.postMessage({ type: 'fatal', message: String(err?.stack ?? err) });
});
