import { MessageChannelMain, utilityProcess, type UtilityProcess, type WebContents } from 'electron';
import path from 'node:path';
import { log } from '../log';

/**
 * Supervises a utility process (DMX, network): restarts it if it crashes and re-wires
 * fresh MessagePorts to the renderer, which simply swaps the port it uses.
 */
export class SupervisedUtility {
  private proc: UtilityProcess | null = null;
  private stopping = false;
  private restarts = 0;
  private targets = new Map<string, WebContents>();
  private lastConfig: unknown = null;

  constructor(
    readonly name: 'dmx' | 'net',
    private entry: string,
  ) {}

  start() {
    this.stopping = false;
    const p = utilityProcess.fork(path.join(__dirname, this.entry), [], { serviceName: `LUJAN ${this.name.toUpperCase()}`, stdio: 'pipe' });
    this.proc = p;
    p.stdout?.on('data', (d) => log.info(this.name, d.toString().trim()));
    p.stderr?.on('data', (d) => log.warn(this.name, d.toString().trim()));
    p.on('message', (m: { type: string; message?: string }) => {
      if (m?.type === 'fatal') log.error(this.name, 'Excepción no controlada', m.message);
    });
    p.on('exit', (code) => {
      if (this.proc !== p) return;
      this.proc = null;
      if (this.stopping) return;
      log.error(this.name, `El proceso terminó inesperadamente (código ${code}); reiniciando`);
      this.restarts++;
      setTimeout(() => this.restartAndRewire(), Math.min(5000, 250 * this.restarts));
    });
    log.info(this.name, 'Proceso iniciado');
  }

  private restartAndRewire() {
    this.start();
    for (const [key, wc] of this.targets) if (!wc.isDestroyed()) this.connect(wc, key);
  }

  /** Creates a channel: one end to the process, the other to `wc` as port `<name>:<role>`. */
  connect(wc: WebContents, role: string) {
    if (!this.proc) return;
    const { port1, port2 } = new MessageChannelMain();
    this.proc.postMessage({ type: 'port' }, [port1]);
    wc.postMessage('lujan:port', { name: this.name, role }, [port2]);
    this.targets.set(role, wc);
    if (this.lastConfig) this.proc.postMessage(this.lastConfig);
  }

  /** Remembered so a restarted process gets its configuration back. */
  rememberConfig(msg: unknown) {
    this.lastConfig = msg;
  }

  async stop(timeoutMs = 2000) {
    this.stopping = true;
    const p = this.proc;
    if (!p) return;
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        p.kill();
        resolve();
      }, timeoutMs);
      p.once('exit', () => {
        clearTimeout(t);
        resolve();
      });
      p.postMessage({ type: 'shutdown' });
    });
    this.proc = null;
    log.info(this.name, 'Proceso detenido');
  }

  get running() {
    return !!this.proc;
  }
}
