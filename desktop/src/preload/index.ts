import { contextBridge, ipcRenderer, webUtils } from 'electron';

const INVOKE_PREFIXES = ['app:', 'settings:', 'project:', 'media:', 'dialog:', 'export:', 'ports:', 'dmx:', 'net:', 'output:', 'updater:', 'ai:'];
const EVENTS = new Set(['app:prepare-shutdown', 'displays:changed', 'output:closed', 'updater:state']);

const api = {
  invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
    if (!INVOKE_PREFIXES.some((p) => channel.startsWith(p))) return Promise.reject(new Error(`Canal IPC no permitido: ${channel}`));
    return ipcRenderer.invoke(channel, ...args) as Promise<T>;
  },
  send(channel: string, ...args: unknown[]) {
    if (channel === 'app:shutdown-ack' || channel === 'app:log') ipcRenderer.send(channel, ...args);
  },
  on(channel: string, cb: (...args: unknown[]) => void): () => void {
    if (!EVENTS.has(channel)) throw new Error(`Evento no permitido: ${channel}`);
    const h = (_e: unknown, ...args: unknown[]) => cb(...args);
    ipcRenderer.on(channel, h);
    return () => ipcRenderer.removeListener(channel, h);
  },
  /** Absolute path of a dropped/selected File (Electron ≥ 32 removed File.path). */
  pathForFile(file: File): string {
    return webUtils.getPathForFile(file);
  },
};

contextBridge.exposeInMainWorld('lujan', api);

// MessagePorts to utility processes cannot cross contextBridge: forward them to the page.
ipcRenderer.on('lujan:port', (e, info: { name: string; role: string }) => {
  window.postMessage({ __lujanPort: info }, '*', e.ports);
});

export type LujanApi = typeof api;
