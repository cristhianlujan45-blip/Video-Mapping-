import * as THREE from 'three';
import type { Composition, Layer, TransitionKind } from '../../shared/project/model';
import { BLEND_FN, BLEND_INDEX, dummyCamera, FullscreenPass, GLSL_HEADER, hexToRgb, rawMaterial, rtRef, SAMPLE_FN, TargetCache, type TexRef } from './gl';
import type { EffectEngine, ParamLookup } from './effects';
import type { MaskCache } from './masks';
import type { FrameContext, SourceManager } from './sources';

const LAYER_VERT = /* glsl */ `
${GLSL_HEADER}
in vec2 position; in vec2 uv;
out vec2 vUv;
uniform float uFlipOut;
void main(){
  vUv = uv;
  float y = uFlipOut > 0.5 ? position.y*2.0-1.0 : 1.0-position.y*2.0;
  gl_Position = vec4(position.x*2.0-1.0, y, 0.0, 1.0);
}`;

const LAYER_FRAG = /* glsl */ `
${GLSL_HEADER}
${SAMPLE_FN}
${BLEND_FN}
in vec2 vUv; out vec4 outColor;
uniform sampler2D uTex; uniform float uFlip; uniform sampler2D uMask;
uniform vec4 uCrop; uniform vec2 uMirror; uniform float uOpacity; uniform int uBlend; uniform float uAdvanced;
uniform sampler2D uBackdrop; uniform vec2 uTargetSize;
void main(){
  vec2 uv = vUv;
  if (uMirror.x > 0.5) uv.x = 1.0 - uv.x;
  if (uMirror.y > 0.5) uv.y = 1.0 - uv.y;
  vec2 cuv = mix(uCrop.xy, uCrop.zw, uv);
  vec4 c = samp(uTex, uFlip, cuv);
  float a = c.a * uOpacity * texture(uMask, vUv).a;
  if (uAdvanced > 0.5) {
    vec3 b = texture(uBackdrop, gl_FragCoord.xy / uTargetSize).rgb;
    outColor = vec4(mix(b, clamp(blendMode(uBlend, b, c.rgb), 0.0, 1.0), a), 1.0);
  } else {
    outColor = vec4(c.rgb * a, a);
  }
}`;

const TRANSITION_FRAG = /* glsl */ `
in vec2 vUv; out vec4 outColor;
uniform sampler2D uA; uniform float uFlipA; uniform sampler2D uB; uniform float uFlipB;
uniform float uP; uniform int uKind; uniform float uTime;
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
void main(){
  vec2 uv = vUv; float p = clamp(uP, 0.0, 1.0);
  vec4 a = samp(uA, uFlipA, uv); vec4 b = samp(uB, uFlipB, uv);
  vec4 o;
  if (uKind == 0) { o = p < 0.5 ? a : b; }                                   // cut
  else if (uKind == 1) { o = mix(a, b, p); }                                  // fade
  else if (uKind == 2) { float n = hash(floor(uv*vec2(320.0,180.0))); o = n < p ? b : a; } // dissolve
  else if (uKind == 3) { float e = smoothstep(p-0.02, p+0.02, uv.x*1.04-0.02); o = mix(b, a, e); } // wipe
  else if (uKind == 4) { float f = 1.0 - abs(p*2.0-1.0); o = mix(p < 0.5 ? a : b, vec4(1.0), pow(f, 2.0)); } // flash
  else if (uKind == 5) { float g = 1.0 - abs(p*2.0-1.0); float row = floor(uv.y*24.0);
     float sh = (hash(vec2(row, floor(uTime*20.0)))-0.5)*0.3*g; vec2 u2 = vec2(fract(uv.x+sh), uv.y);
     vec4 a2 = samp(uA, uFlipA, u2); vec4 b2 = samp(uB, uFlipB, u2);
     o = hash(vec2(row, floor(uTime*30.0))) < p ? b2 : a2; o.r = mix(o.r, samp(uB,uFlipB,u2+vec2(0.01*g,0.0)).r, g); }
  else if (uKind == 6) { vec2 za = (uv-0.5)/(1.0+p*2.0)+0.5; vec2 zb = (uv-0.5)*(3.0-p*2.0)+0.5;
     vec4 aa = samp(uA,uFlipA,za); vec4 bb = (zb.x<0.0||zb.y<0.0||zb.x>1.0||zb.y>1.0) ? vec4(0.0) : samp(uB,uFlipB,zb); o = mix(aa, bb, smoothstep(0.3,0.7,p)); }
  else { vec2 ua = uv + vec2(p, 0.0); vec2 ub = uv - vec2(1.0-p, 0.0); o = ua.x < 1.0 ? samp(uA,uFlipA,ua) : samp(uB,uFlipB,ub); } // slide
  outColor = vec4(o.rgb, 1.0);
}`;

export const TRANSITION_INDEX: Record<TransitionKind, number> = { cut: 0, fade: 1, dissolve: 2, wipe: 3, flash: 4, glitch: 5, zoom: 6, slide: 7 };

/**
 * Renders compositions (scenes) into render targets. Each layer: source → its effect
 * chain → placed with transform/crop/mask → blended. Results are cached per frame, so a
 * composition used by many outputs/surfaces/faces is rendered once.
 */
export class Compositor {
  private scene = new THREE.Scene();
  private mesh: THREE.Mesh;
  private mat: THREE.RawShaderMaterial;
  private geom: THREE.BufferGeometry;
  private transitionPass: FullscreenPass;
  readonly targets = new TargetCache();
  private renderedThisFrame = new Map<string, TexRef>();
  private stack = new Set<string>();

  constructor(
    private r: THREE.WebGLRenderer,
    private sources: SourceManager,
    private effects: EffectEngine,
    private masks: MaskCache,
  ) {
    this.geom = new THREE.BufferGeometry();
    this.geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(8), 2));
    this.geom.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    this.geom.setIndex([0, 1, 2, 0, 2, 3]);
    this.mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: LAYER_VERT,
      fragmentShader: LAYER_FRAG,
      uniforms: {
        uFlipOut: { value: 1 },
        uTex: { value: null },
        uFlip: { value: 0 },
        uMask: { value: null },
        uCrop: { value: new THREE.Vector4(0, 0, 1, 1) },
        uMirror: { value: new THREE.Vector2() },
        uOpacity: { value: 1 },
        uBlend: { value: 0 },
        uAdvanced: { value: 0 },
        uBackdrop: { value: null },
        uTargetSize: { value: new THREE.Vector2(1, 1) },
      },
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    this.mesh = new THREE.Mesh(this.geom, this.mat);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.transitionPass = new FullscreenPass(
      rawMaterial(TRANSITION_FRAG, { uA: { value: null }, uFlipA: { value: 0 }, uB: { value: null }, uFlipB: { value: 0 }, uP: { value: 0 }, uKind: { value: 1 }, uTime: { value: 0 } }),
    );
  }

  beginFrame() {
    this.renderedThisFrame.clear();
    this.targets.frame++;
    if (this.targets.frame % 300 === 0) this.targets.gc(300);
  }

  /** Renders (or returns the cached) composition texture. */
  render(comp: Composition, param: ParamLookup, ctx: FrameContext, layerVisible: (l: Layer) => boolean): TexRef {
    const cached = this.renderedThisFrame.get(comp.id);
    if (cached) return cached;
    const w = comp.width;
    const h = comp.height;
    const rt = this.targets.get(`comp:${comp.id}`, w, h);
    if (this.stack.has(comp.id)) return rtRef(rt); // cycle: use last frame
    this.stack.add(comp.id);
    try {
      const [br, bg, bb] = hexToRgb(comp.background);
      this.r.setRenderTarget(rt);
      this.r.setClearColor(new THREE.Color(br, bg, bb), 1);
      this.r.clear(true, false, false);
      for (const layer of comp.layers) {
        if (!layerVisible(layer)) continue;
        const opacity = param(`layer.${layer.id}.opacity`) ?? layer.opacity;
        if (opacity <= 0.001) continue;
        const src = this.sources.resolve(layer.source, w, h, ctx);
        if (!src) continue;
        const processed = this.effects.apply(`l:${layer.id}`, src, layer.effects, param, ctx.time, Math.min(w, Math.max(src.width, 2)), Math.min(h, Math.max(src.height, 2)));
        this.drawLayer(rt, layer, processed, opacity, param, `comp:${comp.id}`);
      }
      let out: TexRef = rtRef(rt);
      if (comp.effects.length) out = this.effects.apply(`c:${comp.id}`, out, comp.effects, param, ctx.time, w, h);
      this.renderedThisFrame.set(comp.id, out);
      return out;
    } finally {
      this.stack.delete(comp.id);
    }
  }

  private drawLayer(rt: THREE.WebGLRenderTarget, layer: Layer, src: TexRef, opacity: number, param: ParamLookup, compKey: string) {
    const W = rt.width;
    const H = rt.height;
    const compAspect = W / H;
    const crop = layer.crop;
    const cw = Math.max(1e-6, crop.r - crop.l) * src.width;
    const ch = Math.max(1e-6, crop.b - crop.t) * src.height;
    const contentAspect = src.width <= 1 && src.height <= 1 ? compAspect : cw / ch;
    const x = param(`layer.${layer.id}.x`) ?? layer.transform.x;
    const y = param(`layer.${layer.id}.y`) ?? layer.transform.y;
    const sUniform = param(`layer.${layer.id}.scale`) ?? layer.transform.scaleX;
    const ratio = layer.transform.scaleY / (layer.transform.scaleX || 1);
    const sx = sUniform;
    const sy = sUniform * ratio;
    const rot = ((param(`layer.${layer.id}.rotation`) ?? layer.transform.rotation) * Math.PI) / 180;
    // contain-fit in pixel space
    let hw: number;
    let hh: number;
    if (contentAspect > compAspect) {
      hw = (W / 2) * sx;
      hh = ((W / contentAspect) / 2) * sy;
    } else {
      hh = (H / 2) * sy;
      hw = ((H * contentAspect) / 2) * sx;
    }
    const cx = (0.5 + x) * W;
    const cy = (0.5 + y) * H;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const pos = this.geom.getAttribute('position') as THREE.BufferAttribute;
    const corners = [
      [-hw, -hh],
      [hw, -hh],
      [hw, hh],
      [-hw, hh],
    ];
    corners.forEach(([px, py], i) => {
      pos.setXY(i, (cx + px * cos - py * sin) / W, (cy + px * sin + py * cos) / H);
    });
    pos.needsUpdate = true;

    const u = this.mat.uniforms;
    u.uTex.value = src.tex;
    u.uFlip.value = src.flip ? 1 : 0;
    u.uMask.value = this.masks.get(`layer:${layer.id}`, layer.masks, contentAspect);
    u.uCrop.value.set(crop.l, crop.t, crop.r, crop.b);
    u.uMirror.value.set(layer.flipH ? 1 : 0, layer.flipV ? 1 : 0);
    u.uOpacity.value = opacity;
    const blend = BLEND_INDEX[layer.blend] ?? 0;
    u.uBlend.value = blend;
    const advanced = blend >= 4;
    u.uAdvanced.value = advanced ? 1 : 0;
    u.uFlipOut.value = 1;
    if (advanced) {
      const back = this.targets.get(`${compKey}:backdrop`, W, H);
      this.effects.copy(rtRef(rt), back);
      u.uBackdrop.value = back.texture;
      u.uTargetSize.value.set(W, H);
      this.mat.blending = THREE.NoBlending;
    } else {
      this.mat.blending = THREE.CustomBlending;
      this.mat.blendEquation = THREE.AddEquation;
      switch (blend) {
        case 1:
          this.mat.blendSrc = THREE.OneFactor;
          this.mat.blendDst = THREE.OneFactor;
          break;
        case 2:
          this.mat.blendSrc = THREE.OneFactor;
          this.mat.blendDst = THREE.OneMinusSrcColorFactor;
          break;
        case 3:
          this.mat.blendSrc = THREE.DstColorFactor;
          this.mat.blendDst = THREE.OneMinusSrcAlphaFactor;
          break;
        default:
          this.mat.blendSrc = THREE.OneFactor;
          this.mat.blendDst = THREE.OneMinusSrcAlphaFactor;
      }
      this.mat.blendSrcAlpha = THREE.OneFactor;
      this.mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    }
    this.mat.needsUpdate = false;
    rt.viewport.set(0, 0, W, H);
    this.r.setRenderTarget(rt);
    this.r.render(this.scene, dummyCamera);
  }

  /** A/B mix with a transition into a program target. */
  transition(a: TexRef | null, b: TexRef | null, progress: number, kind: TransitionKind, w: number, h: number, time: number): TexRef {
    const rt = this.targets.get('program', w, h);
    const black = this.sources.resolve({ type: 'solid', color: '#000000' }, 1, 1, { time, beatPhase: 0, audio: { rms: 0, bass: 0, mid: 0, treble: 0, beat: 0, spectrum: new Float32Array(16) }, particleQuality: 0 })!;
    const A = a ?? black;
    const B = b ?? black;
    const u = this.transitionPass.material.uniforms;
    u.uA.value = A.tex;
    u.uFlipA.value = A.flip ? 1 : 0;
    u.uB.value = B.tex;
    u.uFlipB.value = B.flip ? 1 : 0;
    u.uP.value = progress;
    u.uKind.value = TRANSITION_INDEX[kind] ?? 1;
    u.uTime.value = time;
    this.transitionPass.render(this.r, rt);
    return rtRef(rt);
  }
}
