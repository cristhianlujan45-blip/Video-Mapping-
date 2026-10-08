/** Messages exchanged with the DMX service process. */

export interface UniverseConfig {
  /** Universe id in the project. */
  id: string;
  name: string;
  protocol: 'artnet' | 'sacn' | 'virtual';
  number: number;
  destination: { mode: 'broadcast' | 'unicast' | 'multicast'; ip: string };
  enabled: boolean;
  delayMs: number;
  priority: number;
}

export interface DmxServiceConfig {
  interfaceAddress: string | null;
  interfaceNetmask: string | null;
  fps: number;
  syncMode: 'sync' | 'immediate';
  globalDelayMs: number;
  useArtSync: boolean;
  universes: UniverseConfig[];
  input: { enabled: boolean; protocol: 'artnet' | 'sacn'; universes: number[] };
  manualNodes: string[];
  sourceName: string;
}

export interface DiscoveredNode {
  ip: string;
  shortName: string;
  longName: string;
  manufacturer: string;
  estaCode: number;
  mac: string;
  outputUniverses: number[];
  inputUniverses: number[];
  numPorts: number;
  firmware: number;
  nodeReport: string;
  bindIndex: number;
  lastSeen: number;
  manual: boolean;
  online: boolean;
}

export interface DmxStats {
  fps: number;
  packetsPerSec: number;
  bytesPerSec: number;
  sendErrors: number;
  lastError: string | null;
  universesActive: number;
  inputPacketsPerSec: number;
  /** ms from a frame entering the service to its packets being sent. */
  latencyMs: number;
  bound: boolean;
  blackout: boolean;
}

export type DmxDiagnosticStep = { id: 'interface' | 'socket' | 'artnet' | 'node' | 'universe' | 'output'; ok: boolean; detail: string };

export type ToDmx =
  | { type: 'config'; config: DmxServiceConfig }
  /** `layer` keeps producers separate (pixel maps from the GPU, fixtures from the UI); merged HTP. */
  | { type: 'frame'; layer: string; universes: Record<string, Uint8Array> }
  | { type: 'clearLayer'; layer: string }
  | { type: 'blackout'; on: boolean }
  | { type: 'test'; mode: 'off' | 'red' | 'green' | 'blue' | 'white' | 'full' | 'chase'; universeId?: string }
  | { type: 'discover' }
  | { type: 'diagnose'; universeId: string | null }
  | { type: 'snapshotRequest'; requestId: string };

export type FromDmx =
  | { type: 'nodes'; nodes: DiscoveredNode[] }
  | { type: 'stats'; stats: DmxStats }
  | { type: 'input'; protocol: 'artnet' | 'sacn'; universe: number; data: Uint8Array; source: string }
  | { type: 'diagnostics'; steps: DmxDiagnosticStep[] }
  | { type: 'snapshot'; requestId: string; universes: Record<string, Uint8Array> }
  | { type: 'error'; message: string }
  | { type: 'log'; message: string };
