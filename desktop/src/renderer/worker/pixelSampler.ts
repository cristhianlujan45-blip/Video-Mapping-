import * as THREE from 'three';
import type { DmxSettings, PixelMap } from '../../shared/project/model';
import { patchPixels, pixelPositions, writePixelMap, type PixelPatch } from '../../shared/dmx/pixelmap';
import { FullscreenPass, makeTarget, rawMaterial, type TexRef } from './gl';
import type { ToDmx } from '../../shared/dmx/messages';

const SAMPLE_FRAG = /* glsl */ `
in vec2 vUv; out vec4 outColor;
uniform sampler2D uTex; uniform float uFlip; uniform sampler2D uPos; uniform int uCount; uniform int uCols;
uniform int uMode; uniform float uRadius; uniform vec4 uRect;
void main(){
  ivec2 fc = ivec2(gl_FragCoord.xy);
  int idx = fc.y * uCols + fc.x;
  if (idx >= uCount) { outColor = vec4(0.0); return; }
  vec2 p = texelFetch(uPos, ivec2(idx % 1024, idx / 1024), 0).xy;
  vec3 acc = vec3(0.0); float n = 0.0;
  if (uMode == 0) { acc = samp(uTex, uFlip, p).rgb; n = 1.0; }
  else if (uMode == 1) {
    for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) { acc += samp(uTex, uFlip, clamp(p + vec2(i, j) * uRadius * 0.5, 0.0, 1.0)).rgb; n += 1.0; }
  } else if (uMode == 2) {
    for (int j = 0; j < 8; j++) for (int i = 0; i < 8; i++) { acc += samp(uTex, uFlip, uRect.xy + (vec2(i, j) + 0.5) / 8.0 * uRect.zw).rgb; n += 1.0; }
  } else { acc = samp(uTex, uFlip, uRect.xy + uRect.zw * 0.5).rgb; n = 1.0; }
  outColor = vec4(acc / n, 1.0);
}`;

interface MapState {
  key: string;
  count: number;
  cols: number;
  rows: number;
  posTex: THREE.DataTexture;
  rt: THREE.WebGLRenderTarget;
  patch: (PixelPatch | null)[];
  pending: boolean;
  colors: Uint8Array;
  lastRead: number;
}

/**
 * VIDEO → LIGHTS on the GPU: every pixel/fixture position is sampled from the source
 * texture in one tiny pass, read back asynchronously (no pipeline stall), converted to
 * RGB/RGBW bytes and sent straight from this worker to the DMX service process.
 */
export class PixelSampler {
  private pass: FullscreenPass;
  private maps = new Map<string, MapState>();
  private universes = new Map<string, Uint8Array>();
  private lastSend = 0;
  private lastPreview = 0;
  lastMs = 0;
  missingUniverses = new Set<number>();

  constructor(
    private r: THREE.WebGLRenderer,
    private sendDmx: (m: ToDmx) => void,
    private emitPreview: (mapId: string, colors: Uint8Array) => void,
  ) {
    this.pass = new FullscreenPass(
      rawMaterial(SAMPLE_FRAG, {
        uTex: { value: null },
        uFlip: { value: 0 },
        uPos: { value: null },
        uCount: { value: 0 },
        uCols: { value: 1 },
        uMode: { value: 1 },
        uRadius: { value: 0.01 },
        uRect: { value: new THREE.Vector4(0, 0, 1, 1) },
      }),
    );
  }

  private state(m: PixelMap): MapState {
    const key = JSON.stringify([m.layout, m.cols, m.rows, m.x, m.y, m.w, m.h, m.startAngle, m.endAngle, m.custom, m.order, m.reverse, m.startCorner, m.format, m.startChannel, m.autoSpan, m.alignPixels, m.pixelsPerUniverse]);
    let s = this.maps.get(m.id);
    if (s && s.key === key) return s;
    if (s) {
      s.posTex.dispose();
      s.rt.dispose();
    }
    const pos = pixelPositions(m);
    const count = Math.max(1, pos.length);
    const data = new Float32Array(1024 * Math.ceil(count / 1024) * 4);
    pos.forEach((p, i) => {
      data[i * 4] = p.x;
      data[i * 4 + 1] = p.y;
    });
    const posTex = new THREE.DataTexture(data, 1024, Math.ceil(count / 1024), THREE.RGBAFormat, THREE.FloatType);
    posTex.needsUpdate = true;
    const cols = Math.min(count, 1024);
    const rows = Math.ceil(count / cols);
    const rt = makeTarget(cols, rows);
    rt.texture.minFilter = THREE.NearestFilter;
    rt.texture.magFilter = THREE.NearestFilter;
    s = { key, count: pos.length, cols, rows, posTex, rt, patch: patchPixels(pos.length, m.format, m.startChannel, m), pending: false, colors: new Uint8Array(cols * rows * 4), lastRead: 0 };
    this.maps.set(m.id, s);
    return s;
  }

  /**
   * @param resolve source texture of a pixel map (program, composition, output…)
   * @param gain pixel master × dmx master
   */
  update(dmx: DmxSettings, resolve: (m: PixelMap) => TexRef | null, gainFor: (m: PixelMap) => number) {
    const t0 = performance.now();
    const now = t0;
    const interval = 1000 / Math.max(1, Math.min(60, dmx.outputFps));
    const ids = new Set(dmx.pixelMaps.map((m) => m.id));
    for (const [id, s] of this.maps) {
      if (!ids.has(id)) {
        s.posTex.dispose();
        s.rt.dispose();
        this.maps.delete(id);
      }
    }
    for (const m of dmx.pixelMaps) {
      if (!m.enabled) continue;
      const s = this.state(m);
      if (s.pending || now - s.lastRead < interval * 0.9) continue;
      const src = resolve(m);
      if (!src) continue;
      const u = this.pass.material.uniforms;
      u.uTex.value = src.tex;
      u.uFlip.value = src.flip ? 1 : 0;
      u.uPos.value = s.posTex;
      u.uCount.value = s.count;
      u.uCols.value = s.cols;
      u.uMode.value = m.sampling === 'point' ? 0 : m.sampling === 'area' ? 1 : m.sampling === 'average' ? 2 : 3;
      u.uRadius.value = (m.sampleSize * Math.max(m.w, m.h)) / Math.max(2, Math.max(m.cols, m.rows));
      u.uRect.value.set(m.x, m.y, m.w, m.h);
      this.pass.render(this.r, s.rt);
      s.pending = true;
      s.lastRead = now;
      const gain = gainFor(m);
      this.r
        .readRenderTargetPixelsAsync(s.rt, 0, 0, s.cols, s.rows, s.colors)
        .then(() => {
          s.pending = false;
          this.write(m, s, dmx, gain);
        })
        .catch(() => {
          s.pending = false;
        });
    }
    if (now - this.lastSend >= interval && this.universes.size) {
      this.lastSend = now;
      const out: Record<string, Uint8Array> = {};
      for (const [id, d] of this.universes) out[id] = d.slice();
      this.sendDmx({ type: 'frame', layer: 'pixel', universes: out });
    }
    if (now - this.lastPreview > 200) {
      this.lastPreview = now;
      for (const [id, s] of this.maps) this.emitPreview(id, s.colors.slice(0, s.count * 4));
    }
    this.lastMs = performance.now() - t0;
  }

  private write(m: PixelMap, s: MapState, dmx: DmxSettings, gain: number) {
    const base = dmx.universes.find((u) => u.id === m.universeId);
    if (!base) return;
    const span = s.patch.reduce((a, p) => Math.max(a, p ? Math.max(p.universeOffset, p.split?.universeOffset ?? 0) : 0), 0) + 1;
    const bufs: Uint8Array[] = [];
    this.missingUniverses.clear();
    for (let k = 0; k < span; k++) {
      const u = k === 0 ? base : dmx.universes.find((x) => x.protocol === base.protocol && x.number === base.number + k);
      if (!u) {
        this.missingUniverses.add(base.number + k);
        bufs.push(new Uint8Array(512));
        continue;
      }
      let b = this.universes.get(u.id);
      if (!b) this.universes.set(u.id, (b = new Uint8Array(512)));
      bufs.push(b);
    }
    // zero this map's channels first (HTP with other maps happens in the DMX service)
    const shaped = { ...m, brightness: m.brightness * gain };
    writePixelMap(shaped, s.patch, s.colors, bufs);
  }

  /** Stop sending pixel data (pixel output disabled / all maps removed). */
  clear() {
    this.universes.clear();
    this.sendDmx({ type: 'clearLayer', layer: 'pixel' });
  }
}
