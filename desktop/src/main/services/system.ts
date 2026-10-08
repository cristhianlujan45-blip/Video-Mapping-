import { app, screen } from 'electron';
import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import os from 'node:os';
import type { DisplayInfo, HardwareReport, NetInterfaceInfo, SystemMetrics } from '../../shared/ipc';
import { log } from '../log';

export function listDisplays(): DisplayInfo[] {
  const primary = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    label: d.label || `Pantalla ${i + 1}`,
    bounds: d.bounds,
    size: { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) },
    scaleFactor: d.scaleFactor,
    refreshRate: d.displayFrequency,
    primary: d.id === primary,
    internal: d.internal,
  }));
}

export function listInterfaces(): NetInterfaceInfo[] {
  const out: NetInterfaceInfo[] = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4') continue;
      out.push({ name, address: a.address, netmask: a.netmask, broadcast: broadcastAddress(a.address, a.netmask), mac: a.mac, internal: a.internal, type: classify(name, a.internal) });
    }
  }
  return out;
}

export function broadcastAddress(ip: string, mask: string): string {
  const i = ip.split('.').map(Number);
  const m = mask.split('.').map(Number);
  return i.map((o, k) => (o | (~m[k] & 0xff)) & 0xff).join('.');
}

function classify(name: string, internal: boolean): NetInterfaceInfo['type'] {
  const n = name.toLowerCase();
  if (internal || n.startsWith('lo')) return 'loopback';
  if (/wi-?fi|wlan|wireless|inalámbrica/.test(n)) return 'wifi';
  if (/vethernet|virtual|vmware|virtualbox|hyper-v|docker|vpn|tap|tun|zerotier|tailscale|hamachi|wsl/.test(n)) return 'virtual';
  if (/usb/.test(n)) return 'usb';
  if (/ethernet|eth|en\d|local area|conexión de área local/.test(n)) return 'ethernet';
  return 'other';
}

function ps(command: string, timeoutMs = 8000): Promise<string> {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], { timeout: timeoutMs, windowsHide: true }, (err, stdout) => {
      resolve(err ? '' : stdout.toString().trim());
    });
  });
}

export async function hardwareReport(): Promise<HardwareReport> {
  const cpus = os.cpus();
  const info = (await app.getGPUInfo('complete').catch(() => ({}))) as {
    gpuDevice?: { vendorId: number; deviceId: number; active: boolean; vendorString?: string; deviceString?: string; driverVersion?: string }[];
    auxAttributes?: { glRenderer?: string; glVendor?: string; glVersion?: string };
  };
  const devices = (info.gpuDevice ?? []).map((d) => ({
    vendorId: d.vendorId,
    deviceId: d.deviceId,
    active: d.active,
    description: d.deviceString || `${vendorName(d.vendorId)} 0x${d.deviceId.toString(16)}`,
  }));
  const active = info.gpuDevice?.find((d) => d.active) ?? info.gpuDevice?.[0];
  let dedicatedVramMB: number | null = null;
  let isLaptop: boolean | null = null;
  if (process.platform === 'win32') {
    const vram = await ps(
      "(Get-ItemProperty 'HKLM:\\SYSTEM\\ControlSet001\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0*' -ErrorAction SilentlyContinue | Where-Object { $_.'HardwareInformation.qwMemorySize' } | ForEach-Object { $_.'HardwareInformation.qwMemorySize' } | Measure-Object -Maximum).Maximum",
    );
    const v = Number(vram);
    if (v > 0) dedicatedVramMB = Math.round(v / 1024 / 1024);
    const chassis = await ps('(Get-CimInstance Win32_SystemEnclosure).ChassisTypes -join ","');
    if (chassis) isLaptop = chassis.split(',').some((c) => ['8', '9', '10', '11', '14', '30', '31', '32'].includes(c.trim()));
  }
  return {
    os: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    cpu: { model: cpus[0]?.model ?? 'desconocido', cores: Math.max(1, Math.round(cpus.length / 2)), threads: cpus.length, speedMHz: cpus[0]?.speed ?? 0 },
    ramGB: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    gpu: {
      vendor: active ? vendorName(active.vendorId) : info.auxAttributes?.glVendor ?? 'desconocido',
      renderer: active?.deviceString || info.auxAttributes?.glRenderer || 'desconocido',
      driver: active?.driverVersion ?? '',
      devices,
      dedicatedVramMB,
    },
    displays: listDisplays(),
    gpuFeatureStatus: app.getGPUFeatureStatus() as unknown as Record<string, string>,
    isLaptop,
  };
}

export function vendorName(id: number) {
  return ({ 0x10de: 'NVIDIA', 0x1002: 'AMD', 0x1022: 'AMD', 0x8086: 'Intel', 0x1414: 'Microsoft (software)', 0x5143: 'Qualcomm' } as Record<number, string>)[id] ?? `0x${id.toString(16)}`;
}

/**
 * Live GPU usage / VRAM on Windows through the GPU performance counters exposed by WMI
 * (class names are not localized, unlike PDH counter paths). One PowerShell process is
 * kept alive and prints a sample every 2 s; elsewhere these values stay null (shown as N/D).
 */
export class GpuCounters {
  private proc: ChildProcessWithoutNullStreams | null = null;
  gpuPercent: number | null = null;
  vramUsedMB: number | null = null;

  start() {
    if (process.platform !== 'win32' || this.proc) return;
    const script = [
      '$ErrorActionPreference="SilentlyContinue"',
      'while($true){',
      ' $e = Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine | Where-Object { $_.Name -like "*engtype_3D" };',
      ' $g = ($e | Measure-Object -Property UtilizationPercentage -Sum).Sum;',
      ' $m = (Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory | Measure-Object -Property DedicatedUsage -Sum).Sum;',
      ' [Console]::Out.WriteLine("$g|$m"); [Console]::Out.Flush();',
      ' Start-Sleep -Seconds 2 }',
    ].join('\n');
    try {
      this.proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true });
      let buf = '';
      this.proc.stdout.on('data', (d: Buffer) => {
        buf += d.toString();
        let i: number;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          const [g, m] = line.split('|');
          const gn = Number(g);
          const mn = Number(m);
          this.gpuPercent = g !== '' && Number.isFinite(gn) ? Math.min(100, gn) : null;
          this.vramUsedMB = m !== '' && Number.isFinite(mn) && mn > 0 ? Math.round(mn / 1024 / 1024) : null;
        }
      });
      this.proc.on('exit', () => (this.proc = null));
    } catch (e) {
      log.warn('system', 'No se pudieron leer los contadores de GPU', e);
    }
  }

  stop() {
    this.proc?.kill();
    this.proc = null;
  }
}

export const gpuCounters = new GpuCounters();

let lastCpu = process.cpuUsage();
let lastT = process.hrtime.bigint();

export function systemMetrics(): SystemMetrics {
  const metrics = app.getAppMetrics();
  const cpuPercent = metrics.reduce((a, m) => a + m.cpu.percentCPUUsage, 0) / Math.max(1, os.cpus().length);
  const appMemoryMB = Math.round(metrics.reduce((a, m) => a + m.memory.workingSetSize, 0) / 1024);
  lastCpu = process.cpuUsage(lastCpu);
  lastT = process.hrtime.bigint();
  return {
    cpuPercent: Math.round(cpuPercent * 10) / 10,
    appMemoryMB,
    systemFreeMB: Math.round(os.freemem() / 1024 / 1024),
    systemTotalMB: Math.round(os.totalmem() / 1024 / 1024),
    gpuPercent: gpuCounters.gpuPercent,
    vramUsedMB: gpuCounters.vramUsedMB,
    processes: metrics.map((m) => ({ type: m.type, name: m.name ?? m.serviceName, cpu: Math.round(m.cpu.percentCPUUsage * 10) / 10, memMB: Math.round(m.memory.workingSetSize / 1024) })),
  };
}
