import * as THREE from 'three';
import { dummyCamera, GLSL_HEADER, makeTarget, rtRef, type TexRef } from './gl';
import type { DrawStroke, StrokeBrush } from './protocol';

const DAB_VERT = /* glsl */ `
${GLSL_HEADER}
in vec2 position;
in vec2 iPos; in float iSize; in float iAngle; in float iAlpha; in float iSeed; in vec3 iColor;
uniform vec2 uRes; uniform float uAspect;
out vec2 vLocal; out float vAlpha; out float vSeed; out vec3 vColor; out vec2 vCanvas;
void main(){
  vec2 c = position * 2.0 - 1.0; // -1..1
  vLocal = c; vAlpha = iAlpha; vSeed = iSeed; vColor = iColor;
  vec2 o = vec2(c.x, c.y * uAspect) * iSize * 0.5;
  float ca = cos(iAngle), sa = sin(iAngle);
  o = vec2(o.x * ca - o.y * sa, o.x * sa + o.y * ca);
  vec2 p = iPos + o;
  vCanvas = p;
  gl_Position = vec4(p.x / uRes.x * 2.0 - 1.0, p.y / uRes.y * 2.0 - 1.0, 0.0, 1.0);
}`;

const DAB_FRAG = /* glsl */ `
${GLSL_HEADER}
in vec2 vLocal; in float vAlpha; in float vSeed; in vec3 vColor; in vec2 vCanvas;
out vec4 outColor;
uniform int uTip; uniform float uHardness; uniform float uGrain; uniform float uGlow; uniform float uErase; uniform float uAspect;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float v=0.0,a=0.5; for(int i=0;i<4;i++){ v+=a*n(p); p*=2.0; a*=0.5; } return v; }
void main(){
  float r = length(vLocal);
  if (r > 1.0) discard;
  float edge = mix(0.02, 1.0, 1.0 - uHardness);
  float a = 1.0 - smoothstep(1.0 - edge, 1.0, r);
  vec3 col = vColor;
  if (uTip == 1) {           // grain: paper texture in canvas space
    float g = fbm(vCanvas * 0.35);
    a *= mix(1.0, smoothstep(0.25, 0.75, g + (1.0 - uGrain) * 0.45), uGrain);
  } else if (uTip == 2) {    // spray: random micro dots
    float d = h(floor(vCanvas) + vSeed * 13.0);
    a *= step(1.0 - (0.15 + 0.6 * (1.0 - r)), d);
  } else if (uTip == 3) {    // watercolor: darker rim + pigment noise
    float rim = smoothstep(0.6, 0.95, r) * (1.0 - smoothstep(0.95, 1.0, r));
    a = (a * 0.55 + rim * 0.5) * (0.7 + 0.3 * fbm(vCanvas * 0.05 + vSeed));
  } else if (uTip == 4) {    // bristles along the stroke
    float bristle = n(vec2(vLocal.y * 18.0 + vSeed * 7.0, vSeed));
    a *= mix(1.0, smoothstep(0.2, 0.6, bristle), uGrain);
  } else if (uTip == 5) {    // flat / chisel: hard
    a = 1.0 - smoothstep(0.92, 1.0, max(abs(vLocal.x), abs(vLocal.y)));
  } else if (uTip == 6) {    // glow: hot core + halo
    float core = 1.0 - smoothstep(0.0, 0.35 * uHardness + 0.05, r);
    float halo = exp(-r * r * 4.0) * uGlow;
    col = mix(col, vec3(1.0), core * 0.8);
    a = clamp(core + halo, 0.0, 1.0);
  } else if (uTip == 7) {    // smoke
    a *= fbm(vLocal * 2.0 + vSeed * 5.0) * (1.0 - r);
  } else if (uTip == 8) {    // fire: colour ramp by radius and noise
    float f = fbm(vLocal * 2.5 + vec2(0.0, vSeed * 3.0));
    float heat = clamp((1.0 - r) * 1.4 * f + 0.1, 0.0, 1.0);
    col = mix(vec3(0.6, 0.05, 0.0), mix(vec3(1.0, 0.45, 0.0), vec3(1.0, 0.95, 0.6), smoothstep(0.5, 0.9, heat)), smoothstep(0.1, 0.5, heat));
    a *= heat;
  } else if (uTip == 9) {    // pixel: square
    a = 1.0;
  } else if (uTip == 10) {   // electric: thin jagged core
    float line = abs(vLocal.y + (n(vec2(vLocal.x * 6.0, vSeed * 9.0)) - 0.5) * 0.8);
    a = (1.0 - smoothstep(0.0, 0.12, line)) + exp(-line * line * 20.0) * uGlow * 0.5;
    col = mix(col, vec3(1.0), 1.0 - smoothstep(0.0, 0.05, line));
  } else if (uTip == 11) {   // glitch: block with channel offset
    a = step(0.3, h(floor(vLocal * 3.0) + vSeed));
    col = vec3(col.r * step(0.5, h(vec2(vSeed, 1.0))), col.g, col.b * step(0.5, h(vec2(vSeed, 2.0))));
  }
  a *= vAlpha;
  if (a <= 0.001) discard;
  outColor = uErase > 0.5 ? vec4(0.0, 0.0, 0.0, a) : vec4(col * a, a);
}`;

const MAX_DABS = 4096;

interface StrokeState {
  last: { x: number; y: number; p: number; t: number } | null;
  smooth: { x: number; y: number } | null;
  carry: number;
  length: number;
  velocity: number;
  angle: number;
}

interface Layer {
  rt: THREE.WebGLRenderTarget;
  strokes: Map<number, StrokeState>;
}

/**
 * GPU brush engine. Strokes arrive as pointer samples (with pen pressure) straight from
 * the UI; dabs are interpolated with spacing and rendered instanced into the drawing
 * layer. No magnifier/loupe — zoom is a separate canvas transform in the UI.
 */
export class DrawingEngine {
  private layers = new Map<string, Layer>();
  private geom: THREE.InstancedBufferGeometry;
  private mat: THREE.RawShaderMaterial;
  private mesh: THREE.Mesh;
  private scene = new THREE.Scene();
  private attrs: Record<string, THREE.InstancedBufferAttribute>;
  private count = 0;
  private rnd = 1;

  constructor(private r: THREE.WebGLRenderer) {
    this.geom = new THREE.InstancedBufferGeometry();
    this.geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    this.geom.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = (n: number) => new THREE.InstancedBufferAttribute(new Float32Array(MAX_DABS * n), n).setUsage(THREE.DynamicDrawUsage);
    this.attrs = { iPos: mk(2), iSize: mk(1), iAngle: mk(1), iAlpha: mk(1), iSeed: mk(1), iColor: mk(3) };
    for (const [k, a] of Object.entries(this.attrs)) this.geom.setAttribute(k, a);
    this.mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: DAB_VERT,
      fragmentShader: DAB_FRAG,
      uniforms: { uRes: { value: new THREE.Vector2() }, uAspect: { value: 1 }, uTip: { value: 0 }, uHardness: { value: 0.8 }, uGrain: { value: 0 }, uGlow: { value: 0 }, uErase: { value: 0 } },
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    this.mesh = new THREE.Mesh(this.geom, this.mat);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  private layer(id: string, w = 1920, h = 1080): Layer {
    let l = this.layers.get(id);
    if (!l) {
      const rt = makeTarget(w, h);
      this.r.setRenderTarget(rt);
      this.r.setClearColor(0x000000, 0);
      this.r.clear(true, false, false);
      l = { rt, strokes: new Map() };
      this.layers.set(id, l);
    }
    return l;
  }

  ensure(id: string, w: number, h: number) {
    const l = this.layer(id, w, h);
    if (l.rt.width !== w || l.rt.height !== h) {
      l.rt.setSize(w, h);
      this.clear(id);
    }
  }

  texture(id: string): TexRef | null {
    const l = this.layers.get(id);
    return l ? rtRef(l.rt) : null;
  }

  clear(id: string) {
    const l = this.layers.get(id);
    if (!l) return;
    this.r.setRenderTarget(l.rt);
    this.r.setClearColor(0x000000, 0);
    this.r.clear(true, false, false);
    l.strokes.clear();
  }

  /** Non-destructive rebuild (undo/redo): clears and replays the remaining strokes. */
  rebuild(id: string, strokes: DrawStroke[]) {
    this.clear(id);
    for (const s of strokes) this.stroke(s);
  }

  private random() {
    // deterministic per replay so undo/redo reproduces identical strokes
    this.rnd = (this.rnd * 16807) % 2147483647;
    return (this.rnd - 1) / 2147483646;
  }

  stroke(s: DrawStroke) {
    const l = this.layer(s.layerId);
    const W = l.rt.width;
    const H = l.rt.height;
    let st = l.strokes.get(s.strokeId);
    if (s.start || !st) {
      st = { last: null, smooth: null, carry: 0, length: 0, velocity: 0, angle: 0 };
      l.strokes.set(s.strokeId, st);
      this.rnd = (s.strokeId % 2147483646) + 1;
    }
    const br = s.brush;
    this.count = 0;
    const pts = s.points;
    for (let i = 0; i + 3 < pts.length; i += 4) {
      let x = pts[i] * W;
      let y = pts[i + 1] * H;
      const p = pts[i + 2] || 0.5;
      const t = pts[i + 3];
      // exponential smoothing of the pointer path
      if (st.smooth && br.smoothing > 0) {
        const k = 1 - Math.min(0.95, br.smoothing);
        x = st.smooth.x + (x - st.smooth.x) * k;
        y = st.smooth.y + (y - st.smooth.y) * k;
      }
      st.smooth = { x, y };
      if (!st.last) {
        st.last = { x, y, p, t };
        this.emitDab(br, st, x, y, p, W);
        continue;
      }
      const dx = x - st.last.x;
      const dy = y - st.last.y;
      const dist = Math.hypot(dx, dy);
      const dt = Math.max(1, t - st.last.t);
      st.velocity = st.velocity * 0.7 + (dist / dt) * 0.3;
      if (dist > 0.01) st.angle = Math.atan2(dy, dx);
      const step = Math.max(0.5, br.size * br.spacing);
      let d = st.carry;
      while (d <= dist) {
        const f = dist === 0 ? 1 : d / dist;
        const px = st.last.x + dx * f;
        const py = st.last.y + dy * f;
        const pp = st.last.p + (p - st.last.p) * f;
        this.emitDab(br, st, px, py, pp, W);
        st.length += step;
        d += step;
      }
      st.carry = d - dist;
      st.last = { x, y, p, t };
    }
    this.flush(l, br);
    if (s.end) l.strokes.delete(s.strokeId);
  }

  private emitDab(br: StrokeBrush, st: StrokeState, x: number, y: number, pressure: number, W: number) {
    let size = br.size;
    if (br.pressureSize) size *= 0.25 + 0.75 * pressure;
    if (br.velocitySize) size *= Math.max(0.15, 1 + br.velocitySize * Math.min(2, st.velocity) * 0.5);
    let alpha = br.opacity * br.flow;
    if (br.pressureOpacity) alpha *= 0.2 + 0.8 * pressure;
    const angle = br.followAngle ? st.angle : (br.angle * Math.PI) / 180;
    let color = br.color;
    if (br.hueCycle > 0) color = hueShift(color, (st.length / Math.max(50, W * 0.5)) * br.hueCycle);
    const n = Math.max(1, Math.round(br.density));
    for (let k = 0; k < n; k++) {
      const sc = br.scatter * size;
      const ox = sc ? (this.random() - 0.5) * 2 * sc : 0;
      const oy = sc ? (this.random() - 0.5) * 2 * sc : 0;
      const s = br.scatter > 1 ? size * (0.2 + this.random() * 0.8) : size;
      this.push(x + ox, y + oy, s, angle, alpha / Math.sqrt(n), this.random(), color);
    }
    if (br.drips > 0 && this.random() < br.drips * 0.08) {
      // a drip: a run of small dabs falling under the stroke
      const len = size * (1 + this.random() * 4);
      for (let j = 0; j < len; j += Math.max(1, size * 0.08)) this.push(x + (this.random() - 0.5) * 0.5, y + size * 0.3 + j, size * 0.18 * (1 - (j / len) * 0.4), 0, alpha, this.random(), color);
    }
  }

  private push(x: number, y: number, size: number, angle: number, alpha: number, seed: number, color: [number, number, number]) {
    if (this.count >= MAX_DABS) return;
    const i = this.count++;
    this.attrs.iPos.setXY(i, x, y);
    this.attrs.iSize.setX(i, size);
    this.attrs.iAngle.setX(i, angle);
    this.attrs.iAlpha.setX(i, alpha);
    this.attrs.iSeed.setX(i, seed);
    this.attrs.iColor.setXYZ(i, color[0], color[1], color[2]);
  }

  private flush(l: Layer, br: StrokeBrush) {
    if (this.count === 0) return;
    for (const a of Object.values(this.attrs)) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.count * a.itemSize);
      a.needsUpdate = true;
    }
    this.geom.instanceCount = this.count;
    const u = this.mat.uniforms;
    u.uRes.value.set(l.rt.width, l.rt.height);
    u.uAspect.value = br.aspect;
    u.uTip.value = br.tip;
    u.uHardness.value = br.hardness;
    u.uGrain.value = br.grain;
    u.uGlow.value = br.glow;
    u.uErase.value = br.erase ? 1 : 0;
    this.mat.blending = THREE.CustomBlending;
    this.mat.blendEquation = THREE.AddEquation;
    if (br.erase) {
      this.mat.blendSrc = THREE.ZeroFactor;
      this.mat.blendDst = THREE.OneMinusSrcAlphaFactor;
      this.mat.blendSrcAlpha = THREE.ZeroFactor;
      this.mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    } else if (br.additive) {
      this.mat.blendSrc = THREE.OneFactor;
      this.mat.blendDst = THREE.OneFactor;
      this.mat.blendSrcAlpha = THREE.OneFactor;
      this.mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    } else {
      this.mat.blendSrc = THREE.OneFactor;
      this.mat.blendDst = THREE.OneMinusSrcAlphaFactor;
      this.mat.blendSrcAlpha = THREE.OneFactor;
      this.mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    }
    l.rt.viewport.set(0, 0, l.rt.width, l.rt.height);
    this.r.setRenderTarget(l.rt);
    this.r.render(this.scene, dummyCamera);
    this.count = 0;
  }

  drop(id: string) {
    this.layers.get(id)?.rt.dispose();
    this.layers.delete(id);
  }
}

function hueShift(c: [number, number, number], turns: number): [number, number, number] {
  const a = turns * Math.PI * 2;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const k = 1 / 3;
  const sq = Math.sqrt(k);
  const m = [
    cos + (1 - cos) * k, k * (1 - cos) - sq * sin, k * (1 - cos) + sq * sin,
    k * (1 - cos) + sq * sin, cos + k * (1 - cos), k * (1 - cos) - sq * sin,
    k * (1 - cos) - sq * sin, k * (1 - cos) + sq * sin, cos + k * (1 - cos),
  ];
  // vivid base so the rainbow is visible even from a dark pick
  const base: [number, number, number] = c[0] + c[1] + c[2] < 0.3 ? [1, 0.2, 0.2] : c;
  return [
    Math.max(0, Math.min(1, base[0] * m[0] + base[1] * m[1] + base[2] * m[2])),
    Math.max(0, Math.min(1, base[0] * m[3] + base[1] * m[4] + base[2] * m[5])),
    Math.max(0, Math.min(1, base[0] * m[6] + base[1] * m[7] + base[2] * m[8])),
  ];
}
