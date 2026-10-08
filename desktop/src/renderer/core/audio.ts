import { AudioAnalyzer, type AudioFeatures } from '../../shared/audio/analysis';
import { LtcDecoder } from '../../shared/timecode/ltc';
import type { AudioSettings } from '../../shared/project/model';
import { logToMain } from '../api';

/**
 * Audio input analysis (microphone, audio interface, line in, or the soundtrack being
 * played) on the Web Audio thread; features feed the parameter engine at UI tick rate.
 * Optional LTC timecode decoding on the same input.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private source: AudioNode | null = null;
  private analyzer: AudioAnalyzer | null = null;
  private mag: Float32Array<ArrayBuffer> = new Float32Array(1024);
  private time: Float32Array<ArrayBuffer> = new Float32Array(2048);
  private ltc: LtcDecoder | null = null;
  private ltcNode: AudioWorkletNode | null = null;
  private fileSources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();
  features: AudioFeatures | null = null;
  status: 'off' | 'live' | 'error' = 'off';
  error: string | null = null;
  inputLabel = '';
  ltcSeconds: number | null = null;
  ltcLastAt = 0;
  onLtc: ((seconds: number) => void) | null = null;
  private settings: AudioSettings | null = null;

  private ensureCtx() {
    if (!this.ctx) this.ctx = new AudioContext({ latencyHint: 'interactive' });
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private ensureAnalyser() {
    const ctx = this.ensureCtx();
    if (!this.analyser) {
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0;
      this.mag = new Float32Array(this.analyser.frequencyBinCount);
      this.time = new Float32Array(this.analyser.fftSize);
    }
    if (!this.analyzer && this.settings) {
      this.analyzer = new AudioAnalyzer({ sampleRate: ctx.sampleRate, fftSize: 2048, bassHz: this.settings.bassHz, trebleHz: this.settings.trebleHz, smoothing: this.settings.smoothing, beatSensitivity: this.settings.beatSensitivity, gain: this.settings.gain });
    }
    return this.analyser;
  }

  configure(s: AudioSettings) {
    this.settings = s;
    this.analyzer?.setOptions({ bassHz: s.bassHz, trebleHz: s.trebleHz, smoothing: s.smoothing, beatSensitivity: s.beatSensitivity, gain: s.gain });
  }

  /** Opens an input device (null = default). */
  async startInput(deviceId: string | null) {
    this.stopInput();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        video: false,
      });
      const ctx = this.ensureCtx();
      const an = this.ensureAnalyser();
      const src = ctx.createMediaStreamSource(this.stream);
      src.connect(an);
      this.source = src;
      this.inputLabel = this.stream.getAudioTracks()[0]?.label ?? '';
      this.stream.getAudioTracks()[0]?.addEventListener('ended', () => {
        this.status = 'error';
        this.error = 'La entrada de audio se desconectó';
      });
      this.status = 'live';
      this.error = null;
      await this.attachLtc(src);
    } catch (e) {
      this.status = 'error';
      this.error = (e as Error).name === 'NotAllowedError' ? 'Permiso de micrófono denegado' : (e as Error).message;
      logToMain('WARN', 'audio', this.error);
    }
  }

  /** Analyse a media element (soundtrack / audio file) instead of an input. */
  analyseElement(el: HTMLMediaElement) {
    const ctx = this.ensureCtx();
    const an = this.ensureAnalyser();
    let node = this.fileSources.get(el);
    if (!node) {
      node = ctx.createMediaElementSource(el);
      this.fileSources.set(el, node);
      node.connect(ctx.destination);
    }
    node.connect(an);
    this.status = 'live';
    this.inputLabel = 'Archivo de audio';
  }

  private async attachLtc(src: AudioNode) {
    const ctx = this.ensureCtx();
    try {
      if (!this.ltcNode) {
        await ctx.audioWorklet.addModule('./worklets/sample-tap.js');
        this.ltcNode = new AudioWorkletNode(ctx, 'sample-tap');
        this.ltc = new LtcDecoder(ctx.sampleRate, 30);
        this.ltc.onFrame = (f) => {
          this.ltcSeconds = f.hours * 3600 + f.minutes * 60 + f.seconds + f.frames / 30;
          this.ltcLastAt = performance.now();
          this.onLtc?.(this.ltcSeconds);
        };
        this.ltcNode.port.onmessage = (e: MessageEvent<Float32Array>) => this.ltc?.process(e.data);
      }
      src.connect(this.ltcNode);
    } catch (e) {
      logToMain('WARN', 'audio', `Decodificador LTC no disponible: ${(e as Error).message}`);
    }
  }

  stopInput() {
    this.source?.disconnect();
    this.source = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.status === 'live') this.status = 'off';
  }

  /** Call once per UI tick. */
  tick(): AudioFeatures | null {
    if (!this.analyser || !this.analyzer || this.status !== 'live') return null;
    this.analyser.getFloatFrequencyData(this.mag);
    for (let i = 0; i < this.mag.length; i++) this.mag[i] = Math.pow(10, this.mag[i] / 20) * 8;
    this.analyser.getFloatTimeDomainData(this.time);
    this.features = this.analyzer.process(this.mag, this.time, performance.now() / 1000);
    return this.features;
  }

  async listInputs() {
    const list = await navigator.mediaDevices.enumerateDevices();
    return list.filter((d) => d.kind === 'audioinput').map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Entrada ${i + 1}` }));
  }

  async release() {
    this.stopInput();
    await this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.analyser = null;
    this.ltcNode = null;
  }
}
