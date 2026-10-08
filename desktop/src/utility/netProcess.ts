/** Entry point of the network utility process (OSC + remote web control). */
import type { MessagePortMain } from 'electron';
import type { FromNet, ToNet } from '../shared/net/messages';
import { NetEngine } from './netEngine';

const ports = new Set<MessagePortMain>();
const engine = new NetEngine((m: FromNet) => {
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
      port.on('message', (ev) => engine.handle(ev.data as ToNet));
      port.on('close', () => ports.delete(port));
      port.start();
    }
  } else if (data?.type === 'shutdown') {
    void engine.dispose().then(() => {
      process.parentPort.postMessage({ type: 'shutdown-done' });
      process.exit(0);
    });
  } else if (data?.type) engine.handle(data as ToNet);
});

process.on('uncaughtException', (err) => {
  process.parentPort.postMessage({ type: 'fatal', message: String(err?.stack ?? err) });
});
