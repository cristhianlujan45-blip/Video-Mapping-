import dgram from 'node:dgram';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { decodePacket, encodeMessage, type OscArg, type OscBundle, type OscMessage } from '../shared/osc/osc';
import type { FromNet, NetConfig, RemoteCommand, RemoteState, ToNet } from '../shared/net/messages';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/**
 * OSC server/client and the remote-control web server. The remote page is only a
 * controller: it sends commands and shows state; rendering stays on the Windows GPU.
 */
export class NetEngine {
  private cfg: NetConfig | null = null;
  private osc: dgram.Socket | null = null;
  private oscOut: dgram.Socket | null = null;
  private oscError: string | null = null;
  private oscCount = 0;
  private oscRate = 0;
  private http: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private clients = new Set<WebSocket>();
  private authed = new WeakSet<WebSocket>();
  private failures = new Map<string, { n: number; until: number }>();
  private remoteError: string | null = null;
  private state: RemoteState | null = null;
  private statusTimer: NodeJS.Timeout;

  constructor(private emit: (m: FromNet) => void) {
    this.statusTimer = setInterval(() => {
      this.oscRate = this.oscCount;
      this.oscCount = 0;
      this.publishStatus();
    }, 1000);
  }

  handle(msg: ToNet) {
    switch (msg.type) {
      case 'config':
        void this.configure(msg.config);
        break;
      case 'oscSend':
        this.oscSend(msg.address, msg.args);
        break;
      case 'remoteState':
        this.state = msg.state;
        this.broadcast({ type: 'state', state: msg.state });
        break;
      case 'remoteParam':
        this.broadcast({ type: 'param', id: msg.id, value: msg.value });
        break;
    }
  }

  async configure(cfg: NetConfig) {
    const prev = this.cfg;
    this.cfg = cfg;
    if (!prev || JSON.stringify(prev.osc) !== JSON.stringify(cfg.osc)) await this.setupOsc();
    if (!prev || JSON.stringify(prev.remote) !== JSON.stringify(cfg.remote) || prev.remoteRoot !== cfg.remoteRoot) await this.setupRemote();
    this.publishStatus();
  }

  // ---------------------------------------------------------------- OSC

  private async setupOsc() {
    this.osc?.close();
    this.osc = null;
    this.oscError = null;
    const c = this.cfg!.osc;
    if (!c.enabled) return;
    const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    s.on('message', (b, rinfo) => {
      try {
        const pkt = decodePacket(new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
        this.dispatchOsc(pkt, `${rinfo.address}:${rinfo.port}`);
      } catch {
        /* malformed packet: ignore */
      }
    });
    s.on('error', (e) => {
      this.oscError = e.message;
      this.publishStatus();
    });
    await new Promise<void>((resolve) => {
      s.once('listening', () => resolve());
      s.once('error', () => resolve());
      s.bind(c.inPort, '0.0.0.0');
    });
    this.osc = s;
    if (!this.oscOut) this.oscOut = dgram.createSocket('udp4');
  }

  private dispatchOsc(pkt: OscMessage | OscBundle, from: string) {
    if ('elements' in pkt) {
      for (const e of pkt.elements) this.dispatchOsc(e, from);
      return;
    }
    this.oscCount++;
    this.emit({
      type: 'osc',
      address: pkt.address,
      args: pkt.args.map((a) => (a.type === 'h' || a.type === 't' ? Number(a.value) : a.type === 'b' ? null : (a.value as number | string | boolean | null))),
      from,
    });
  }

  private oscSend(address: string, args: (number | string | boolean)[]) {
    const c = this.cfg?.osc;
    if (!c?.enabled || !this.oscOut || !c.outHost) return;
    const oscArgs: OscArg[] = args.map((a) => (typeof a === 'number' ? (Number.isInteger(a) ? { type: 'i', value: a } : { type: 'f', value: a }) : typeof a === 'boolean' ? { type: a ? 'T' : 'F', value: a } : { type: 's', value: a }));
    const buf = encodeMessage({ address, args: oscArgs });
    this.oscOut.send(buf, c.outPort, c.outHost, (err) => {
      if (err) this.oscError = `Envío OSC: ${err.message}`;
    });
  }

  // ---------------------------------------------------------------- remote web control

  private async setupRemote() {
    for (const ws of this.clients) ws.close();
    this.clients.clear();
    this.wss?.close();
    this.wss = null;
    await new Promise<void>((r) => (this.http ? this.http.close(() => r()) : r()));
    this.http = null;
    this.remoteError = null;
    const c = this.cfg!.remote;
    if (!c.enabled) return;
    const root = this.cfg!.remoteRoot;
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://x');
      let rel = decodeURIComponent(url.pathname);
      if (rel === '/' || rel === '') rel = '/index.html';
      const file = path.normalize(path.join(root, rel));
      if (!file.startsWith(path.normalize(root))) {
        res.writeHead(403).end();
        return;
      }
      fs.readFile(file, (err, data) => {
        if (err) {
          res.writeHead(404).end('Not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
        res.end(data);
      });
    });
    const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
    wss.on('connection', (ws, req) => {
      const ip = req.socket.remoteAddress ?? '?';
      this.clients.add(ws);
      ws.on('message', (raw) => this.onRemoteMessage(ws, ip, raw.toString()));
      ws.on('close', () => {
        this.clients.delete(ws);
        this.publishStatus();
      });
      this.publishStatus();
    });
    await new Promise<void>((resolve) => {
      server.once('error', (e) => {
        this.remoteError = (e as Error).message;
        resolve();
      });
      server.listen(c.port, '0.0.0.0', () => resolve());
    });
    if (!this.remoteError) {
      this.http = server;
      this.wss = wss;
    }
  }

  private onRemoteMessage(ws: WebSocket, ip: string, text: string) {
    let msg: { type: string; pin?: string; command?: RemoteCommand };
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg.type === 'auth') {
      const f = this.failures.get(ip);
      if (f && f.until > Date.now()) {
        ws.send(JSON.stringify({ type: 'auth', ok: false, error: 'Demasiados intentos. Espera un minuto.' }));
        return;
      }
      if (msg.pin === this.cfg?.remote.pin) {
        this.authed.add(ws);
        this.failures.delete(ip);
        ws.send(JSON.stringify({ type: 'auth', ok: true }));
        if (this.state) ws.send(JSON.stringify({ type: 'state', state: this.state }));
      } else {
        const n = (f?.n ?? 0) + 1;
        this.failures.set(ip, { n, until: n >= 5 ? Date.now() + 60_000 : 0 });
        ws.send(JSON.stringify({ type: 'auth', ok: false, error: 'PIN incorrecto' }));
      }
      return;
    }
    if (!this.authed.has(ws)) return;
    if (msg.type === 'command' && msg.command) this.emit({ type: 'remote', command: msg.command, client: ip });
  }

  private broadcast(obj: unknown) {
    const s = JSON.stringify(obj);
    for (const ws of this.clients) if (this.authed.has(ws) && ws.readyState === ws.OPEN) ws.send(s);
  }

  private publishStatus() {
    const port = this.cfg?.remote.port ?? 0;
    const urls = this.http ? lanAddresses().map((ip) => `http://${ip}:${port}/`) : [];
    this.emit({
      type: 'status',
      osc: { listening: !!this.osc && !this.oscError, port: this.cfg?.osc.inPort ?? 0, error: this.oscError, messagesPerSec: this.oscRate },
      remote: { listening: !!this.http, urls, clients: this.clients.size, error: this.remoteError },
    });
  }

  async dispose() {
    clearInterval(this.statusTimer);
    this.osc?.close();
    this.oscOut?.close();
    for (const ws of this.clients) ws.close();
    this.wss?.close();
    await new Promise<void>((r) => (this.http ? this.http.close(() => r()) : r()));
  }
}

export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const addrs of Object.values(os.networkInterfaces())) for (const a of addrs ?? []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  return out;
}
