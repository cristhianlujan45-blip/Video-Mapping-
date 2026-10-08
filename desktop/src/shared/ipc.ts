/**
 * IPC channel names and payload types shared by main, preload and renderer.
 */
import type { MediaItem } from './project/model';

export interface DisplayInfo {
  id: number;
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  size: { width: number; height: number };
  scaleFactor: number;
  refreshRate: number;
  primary: boolean;
  internal: boolean;
}

export interface NetInterfaceInfo {
  name: string;
  address: string;
  netmask: string;
  broadcast: string;
  mac: string;
  internal: boolean;
  /** Heuristic from the adapter name (Windows names it "Ethernet", "Wi-Fi"…). */
  type: 'ethernet' | 'wifi' | 'usb' | 'virtual' | 'loopback' | 'other';
}

export interface HardwareReport {
  os: string;
  arch: string;
  cpu: { model: string; cores: number; threads: number; speedMHz: number };
  ramGB: number;
  gpu: { vendor: string; renderer: string; driver: string; devices: { vendorId: number; deviceId: number; active: boolean; description: string }[]; dedicatedVramMB: number | null };
  displays: DisplayInfo[];
  gpuFeatureStatus: Record<string, string>;
  isLaptop: boolean | null;
}

export interface SystemMetrics {
  cpuPercent: number;
  appMemoryMB: number;
  systemFreeMB: number;
  systemTotalMB: number;
  gpuPercent: number | null;
  vramUsedMB: number | null;
  processes: { type: string; name?: string; cpu: number; memMB: number }[];
}

export interface ProjectFileResult {
  path: string;
  text: string;
}

export interface RecoveryInfo {
  autosavePath: string;
  projectPath: string | null;
  savedAt: number;
  name: string;
}

export interface ImportedMedia extends MediaItem {}

export interface AppInfo {
  version: string;
  platform: string;
  userData: string;
  documents: string;
  logsDir: string;
  isPackaged: boolean;
  selfTest: boolean;
}

export type UpdateState =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'none'; version: string }
  | { state: 'available'; version: string; notes?: string }
  | { state: 'downloading'; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string }
  | { state: 'unconfigured'; message: string };

/** Ports handed from main to the renderer. */
export type PortName = 'dmx' | 'net';
