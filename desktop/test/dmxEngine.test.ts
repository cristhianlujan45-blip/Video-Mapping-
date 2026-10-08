import dgram from 'node:dgram';
import { afterEach, describe, expect, it } from 'vitest';
import { DmxEngine } from '../src/utility/dmxEngine';
import { decodeArtDmx, encodeArtPollReply, isArtNet, opcode, OP_DMX, OP_POLL } from '../src/shared/dmx/artnet';
import type { DmxServiceConfig, FromDmx } from '../src/shared/dmx/messages';

/** Real UDP on loopback: a fake Art-Net node answers ArtPoll and records ArtDmx. */
function fakeNode(port: number) {
  const sock = dgram.createSocket('udp4');
  const dmx: { universe: number; data: Uint8Array }[] = [];
  sock.on('message', (b, rinfo) => {
    const buf = new Uint8Array(b);
    if (!isArtNet(buf)) return;
    if (opcode(buf) === OP_POLL) {
      sock.send(encodeArtPollReply({ ip: '127.0.0.1', shortName: 'FakeNode', longName: 'Nodo de prueba', outputs: [0, 1] }), rinfo.port, rinfo.address);
    } else if (opcode(buf) === OP_DMX) {
      const d = decodeArtDmx(buf)!;
      dmx.push({ universe: d.portAddress, data: d.data });
    }
  });
  return new Promise<{ sock: dgram.Socket; dmx: typeof dmx }>((r) => sock.bind(port, '127.0.0.1', () => r({ sock, dmx })));
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('DmxEngine over real UDP', () => {
  let engine: DmxEngine | null = null;
  let node: dgram.Socket | null = null;
  afterEach(async () => {
    await engine?.dispose();
    node?.close();
  });

  it('discovers the node, sends merged frames, applies blackout immediately', async () => {
    const port = 20000 + Math.floor(Math.random() * 20000);
    const n = await fakeNode(port);
    node = n.sock;
    const events: FromDmx[] = [];
    engine = new DmxEngine((m) => events.push(m), { artnetPort: port, receive: false });
    const cfg: DmxServiceConfig = {
      interfaceAddress: '127.0.0.1',
      interfaceNetmask: '255.0.0.0',
      fps: 30,
      syncMode: 'immediate',
      globalDelayMs: 0,
      useArtSync: false,
      universes: [{ id: 'u0', name: 'U0', protocol: 'artnet', number: 1, destination: { mode: 'unicast', ip: '127.0.0.1' }, enabled: true, delayMs: 0, priority: 100 }],
      input: { enabled: false, protocol: 'artnet', universes: [] },
      manualNodes: ['127.0.0.1'],
      sourceName: 'test',
    };
    await engine.configure(cfg);
    const a = new Uint8Array(512);
    a[0] = 100;
    const b = new Uint8Array(512);
    b[0] = 50;
    b[1] = 200;
    engine.handle({ type: 'frame', layer: 'pixel', universes: { u0: a } });
    engine.handle({ type: 'frame', layer: 'ui', universes: { u0: b } });
    await wait(300);
    const nodes = events.filter((e) => e.type === 'nodes').pop();
    expect(nodes && nodes.type === 'nodes' && nodes.nodes.some((x) => x.shortName === 'FakeNode' && x.online)).toBe(true);
    const last = n.dmx[n.dmx.length - 1];
    expect(last.universe).toBe(1);
    expect(last.data[0]).toBe(100); // HTP
    expect(last.data[1]).toBe(200);
    const count = n.dmx.length;
    engine.handle({ type: 'blackout', on: true });
    await wait(30);
    expect(n.dmx.length).toBeGreaterThan(count);
    expect(n.dmx[n.dmx.length - 1].data[1]).toBe(0);
  });

  it('delays output in sync mode', async () => {
    const port = 20000 + Math.floor(Math.random() * 20000);
    const n = await fakeNode(port);
    node = n.sock;
    engine = new DmxEngine(() => {}, { artnetPort: port, receive: false });
    await engine.configure({
      interfaceAddress: '127.0.0.1',
      interfaceNetmask: '255.0.0.0',
      fps: 50,
      syncMode: 'sync',
      globalDelayMs: 250,
      useArtSync: false,
      universes: [{ id: 'u0', name: 'U0', protocol: 'artnet', number: 0, destination: { mode: 'unicast', ip: '127.0.0.1' }, enabled: true, delayMs: 0, priority: 100 }],
      input: { enabled: false, protocol: 'artnet', universes: [] },
      manualNodes: [],
      sourceName: 'test',
    });
    engine.handle({ type: 'frame', layer: 'x', universes: { u0: new Uint8Array(512) } });
    await wait(100);
    const lit = new Uint8Array(512).fill(255);
    engine.handle({ type: 'frame', layer: 'x', universes: { u0: lit } });
    await wait(120);
    expect(n.dmx[n.dmx.length - 1].data[0]).toBe(0); // still the old frame
    await wait(250);
    expect(n.dmx[n.dmx.length - 1].data[0]).toBe(255);
  });
});
