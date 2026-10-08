import type { HardwareReport } from '../../shared/ipc';
import type { QualitySettings } from '../worker/protocol';
import type { TrackingQuality } from '../../shared/project/model';
import { lujan } from '../api';

export interface CodecSupport {
  name: string;
  decode: 'hardware' | 'software' | 'no';
  encode: 'hardware' | 'software' | 'no';
}

export type Preset = 'low' | 'balanced' | 'high' | 'ultra';

export interface Profile {
  report: HardwareReport;
  codecs: CodecSupport[];
  recommended: Preset;
  reasons: string[];
  warnings: string[];
}

const CODECS: { name: string; mime: string; codec: string }[] = [
  { name: 'H.264 1080p', mime: 'video/mp4; codecs="avc1.640028"', codec: 'avc1.640028' },
  { name: 'H.264 4K', mime: 'video/mp4; codecs="avc1.640033"', codec: 'avc1.640033' },
  { name: 'H.265/HEVC 4K', mime: 'video/mp4; codecs="hvc1.1.6.L153.B0"', codec: 'hvc1.1.6.L153.B0' },
  { name: 'VP9 4K', mime: 'video/webm; codecs="vp09.00.51.08"', codec: 'vp09.00.51.08' },
  { name: 'AV1 4K', mime: 'video/mp4; codecs="av01.0.12M.08"', codec: 'av01.0.12M.08' },
];

async function codecSupport(): Promise<CodecSupport[]> {
  const out: CodecSupport[] = [];
  for (const c of CODECS) {
    const four = c.name.includes('4K');
    const w = four ? 3840 : 1920;
    const h = four ? 2160 : 1080;
    let decode: CodecSupport['decode'] = 'no';
    try {
      const info = await navigator.mediaCapabilities.decodingInfo({ type: 'file', video: { contentType: c.mime, width: w, height: h, bitrate: four ? 40e6 : 10e6, framerate: 60 } });
      decode = info.supported ? (info.powerEfficient ? 'hardware' : 'software') : 'no';
    } catch {
      decode = 'no';
    }
    let encode: CodecSupport['encode'] = 'no';
    try {
      const hw = await VideoEncoder.isConfigSupported({ codec: c.codec, width: w, height: h, bitrate: 20e6, framerate: 30, hardwareAcceleration: 'prefer-hardware' });
      if (hw.supported) encode = 'hardware';
      else {
        const sw = await VideoEncoder.isConfigSupported({ codec: c.codec, width: w, height: h, bitrate: 20e6, framerate: 30 });
        encode = sw.supported ? 'software' : 'no';
      }
    } catch {
      encode = 'no';
    }
    out.push({ name: c.name, decode, encode });
  }
  return out;
}

const DISCRETE = /nvidia|geforce|quadro|rtx|gtx|radeon (rx|pro)|rx \d|arc a\d|firepro/i;

export async function profileHardware(): Promise<Profile> {
  const report = (await lujan!.invoke<HardwareReport>('app:hardware'))!;
  // Chromium sometimes has no device strings (remote sessions, some drivers): use the
  // renderer string reported by the GPU context itself.
  const gl = (await import('./show')).show.render.info;
  if (gl && (!report.gpu.renderer || report.gpu.renderer === 'desconocido')) {
    report.gpu.renderer = gl.renderer;
    report.gpu.vendor = gl.vendor;
  }
  const codecs = await codecSupport();
  const reasons: string[] = [];
  const warnings: string[] = [];
  const vram = report.gpu.dedicatedVramMB ?? 0;
  const discrete = DISCRETE.test(report.gpu.renderer) || report.gpu.devices.some((d) => d.active && (d.vendorId === 0x10de || (d.vendorId === 0x1002 && vram >= 2048)));
  const hevcHw = codecs.find((c) => c.name.startsWith('H.265'))?.decode === 'hardware';
  let preset: Preset = 'low';
  if (discrete && vram >= 8000 && report.ramGB >= 31 && report.cpu.threads >= 12) preset = 'ultra';
  else if (discrete && vram >= 4000 && report.ramGB >= 15) preset = 'high';
  else if ((discrete || vram >= 1500) && report.ramGB >= 8) preset = 'balanced';
  else if (report.ramGB >= 8 && report.cpu.threads >= 8) preset = 'balanced';
  reasons.push(`GPU ${discrete ? 'dedicada' : 'integrada'}: ${report.gpu.renderer}${vram ? ` (${(vram / 1024).toFixed(1)} GB VRAM)` : ''}`);
  reasons.push(`CPU ${report.cpu.model} · ${report.cpu.threads} hilos · RAM ${report.ramGB} GB`);
  reasons.push(`Decodificación por hardware: ${codecs.filter((c) => c.decode === 'hardware').map((c) => c.name).join(', ') || 'no detectada'}`);
  if (!hevcHw) warnings.push('Sin decodificación HEVC por hardware: usa H.264 para material 4K.');
  const integratedActive = report.gpu.devices.length > 1 && report.gpu.devices.some((d) => d.active && d.vendorId === 0x8086) && report.gpu.devices.some((d) => !d.active && (d.vendorId === 0x10de || d.vendorId === 0x1002));
  if (integratedActive) warnings.push('Hay una GPU dedicada pero Windows está usando la integrada: Configuración → Sistema → Pantalla → Gráficos → LUJAN MAPPING Studio → «Alto rendimiento».');
  if (report.gpuFeatureStatus?.webgl2 && !String(report.gpuFeatureStatus.webgl2).startsWith('enabled')) warnings.push(`WebGL2 no acelerado (${report.gpuFeatureStatus.webgl2}): actualiza el driver de la GPU.`);
  return { report, codecs, recommended: preset, reasons, warnings };
}

export const PRESET_QUALITY: Record<Preset, QualitySettings & { tracking: TrackingQuality }> = {
  low: { previewScale: 0.35, previewFps: 15, particleQuality: 0.15, maxFps: 30, tracking: 'low' },
  balanced: { previewScale: 0.5, previewFps: 30, particleQuality: 0.4, maxFps: 60, tracking: 'medium' },
  high: { previewScale: 0.75, previewFps: 30, particleQuality: 0.7, maxFps: 60, tracking: 'high' },
  ultra: { previewScale: 1, previewFps: 60, particleQuality: 1, maxFps: 60, tracking: 'ultra' },
};

export const PRESET_LABEL: Record<Preset, string> = { low: 'LOW', balanced: 'BALANCED', high: 'HIGH', ultra: 'ULTRA' };
