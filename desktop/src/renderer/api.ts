import type { LujanApi } from '../preload/index';

declare global {
  interface Window {
    lujan: LujanApi;
  }
}

/** Typed access to the preload bridge. Undefined when the UI is opened outside Electron. */
export const lujan: LujanApi = (globalThis as unknown as { lujan: LujanApi }).lujan;

export function logToMain(level: 'INFO' | 'WARN' | 'ERROR', scope: string, msg: string) {
  try {
    lujan?.send('app:log', level, scope, msg);
  } catch {
    /* ignore */
  }
}
