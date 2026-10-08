import * as THREE from 'three';
import type { TrackingVisual } from '../../shared/project/model';
import { HAND_CONNECTIONS, HAND_STRIDE, POSE, POSE_CONNECTIONS, POSE_STRIDE, type TrackedPerson } from '../../shared/tracking/pose';
import { dummyCamera, FullscreenPass, GLSL_HEADER, rawMaterial, rtRef, TargetCache, type TexRef } from './gl';

const PT_VERT = /* glsl */ `
${GLSL_HEADER}
in vec2 position; in float aSize; in vec4 aColor;
out vec4 vColor;
uniform vec2 uRes;
void main(){ vColor = aColor; gl_Position = vec4(position.x*2.0-1.0, position.y*2.0-1.0, 0.0, 1.0); gl_PointSize = aSize * uRes.y / 1080.0; }`;

const PT_FRAG = /* glsl */ `
${GLSL_HEADER}
in vec4 vColor; out vec4 outColor;
uniform float uSoft;
void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; if (r > 1.0) discard;
  float a = uSoft > 0.5 ? exp(-r*r*3.0) : 1.0 - smoothstep(0.8, 1.0, r);
  outColor = vec4(vColor.rgb * a * vColor.a, a * vColor.a); }`;

const LINE_VERT = /* glsl */ `
${GLSL_HEADER}
in vec2 position; in vec4 aColor; out vec4 vColor;
void main(){ vColor = aColor; gl_Position = vec4(position.x*2.0-1.0, position.y*2.0-1.0, 0.0, 1.0); }`;

const LINE_FRAG = /* glsl */ `
${GLSL_HEADER}
in vec4 vColor; out vec4 outColor;
void main(){ outColor = vec4(vColor.rgb * vColor.a, vColor.a); }`;

const MASK_FRAG = /* glsl */ `
in vec2 vUv; out vec4 outColor;
uniform sampler2D uMask; uniform vec3 uColor; uniform float uMirror; uniform float uTime;
void main(){ vec2 uv = vec2(uMirror > 0.5 ? 1.0 - vUv.x : vUv.x, vUv.y);
  float m = texture(uMask, uv).r;
  float edge = smoothstep(0.3, 0.5, m) - smoothstep(0.5, 0.7, m);
  vec3 c = uColor * smoothstep(0.4, 0.6, m) + vec3(1.0) * edge * 0.6;
  outColor = vec4(c, 1.0); }`;

const FADE_FRAG = /* glsl */ `
in vec2 vUv; out vec4 outColor; uniform sampler2D uTex; uniform float uDecay;
void main(){ outColor = texture(uTex, vUv) * uDecay; }`;

const MAX_P = 8000;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  hue: number;
}

/**
 * Coordinates are normalized camera space with y down (row 0 = top), matching the
 * top-down convention of our render targets.
 *
 * Interactive visuals driven by body tracking. Rendered as a source texture that any
 * layer, surface, 3D face or pixel map can use.
 */
export class TrackingFx {
  private people = new Map<string, { people: TrackedPerson[]; mask: THREE.Texture | null; t: number }>();
  private particles: Particle[] = [];
  private ptsGeom = new THREE.BufferGeometry();
  private lineGeom = new THREE.BufferGeometry();
  private ptsMat: THREE.RawShaderMaterial;
  private lineMat: THREE.RawShaderMaterial;
  private scene = new THREE.Scene();
  private points: THREE.Points;
  private lines: THREE.LineSegments;
  private maskPass: FullscreenPass;
  private fadePass: FullscreenPass;
  readonly targets = new TargetCache();
  private lastT = performance.now();
  private renderedFrame = new Map<string, number>();
  frame = 0;

  constructor(private r: THREE.WebGLRenderer) {
    this.ptsGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_P * 2), 2).setUsage(THREE.DynamicDrawUsage));
    this.ptsGeom.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(MAX_P), 1).setUsage(THREE.DynamicDrawUsage));
    this.ptsGeom.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(MAX_P * 4), 4).setUsage(THREE.DynamicDrawUsage));
    this.lineGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(4096 * 2), 2).setUsage(THREE.DynamicDrawUsage));
    this.lineGeom.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(4096 * 4), 4).setUsage(THREE.DynamicDrawUsage));
    const blend = { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, depthTest: false, depthWrite: false, transparent: true } as const;
    this.ptsMat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: PT_VERT, fragmentShader: PT_FRAG, uniforms: { uRes: { value: new THREE.Vector2(1920, 1080) }, uSoft: { value: 1 } }, ...blend });
    this.lineMat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: LINE_VERT, fragmentShader: LINE_FRAG, ...blend });
    this.points = new THREE.Points(this.ptsGeom, this.ptsMat);
    this.lines = new THREE.LineSegments(this.lineGeom, this.lineMat);
    this.points.frustumCulled = false;
    this.lines.frustumCulled = false;
    this.scene.add(this.lines, this.points);
    this.maskPass = new FullscreenPass(rawMaterial(MASK_FRAG, { uMask: { value: null }, uColor: { value: new THREE.Vector3(0.1, 0.8, 1) }, uMirror: { value: 1 }, uTime: { value: 0 } }));
    this.fadePass = new FullscreenPass(rawMaterial(FADE_FRAG, { uTex: { value: null }, uDecay: { value: 0.9 } }));
  }

  setData(cameraId: string, people: TrackedPerson[], mask: ImageBitmap | null) {
    const prev = this.people.get(cameraId);
    let tex = prev?.mask ?? null;
    if (mask) {
      if (tex) {
        (tex.image as ImageBitmap)?.close?.();
        tex.image = mask;
        tex.needsUpdate = true;
      } else {
        tex = new THREE.Texture(mask);
        tex.flipY = false;
        tex.needsUpdate = true;
      }
    }
    this.people.set(cameraId, { people, mask: tex, t: performance.now() });
  }

  private data(cameraId?: string) {
    if (cameraId) return this.people.get(cameraId);
    return this.people.values().next().value;
  }

  render(style: TrackingVisual, cameraId: string | undefined, w: number, h: number, mirror: boolean): TexRef {
    const key = `trk:${style}:${cameraId ?? '*'}`;
    const rt = this.targets.get(key, w, h);
    if (this.renderedFrame.get(key) === this.frame) return rtRef(rt);
    this.renderedFrame.set(key, this.frame);
    const d = this.data(cameraId);
    const people = d && performance.now() - d.t < 1500 ? d.people : [];
    const mx = (x: number) => (mirror ? 1 - x : x);
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastT) / 1000);
    this.lastT = now;

    if (style === 'silhouette') {
      if (d?.mask) {
        const u = this.maskPass.material.uniforms;
        u.uMask.value = d.mask;
        u.uMirror.value = mirror ? 1 : 0;
        this.maskPass.render(this.r, rt);
      } else this.clear(rt, 1);
      // skeleton on top as a fallback when segmentation is off
      if (!d?.mask) this.drawSkeleton(rt, people, mx, false);
      return rtRef(rt);
    }

    const persistent = style === 'trails' || style === 'fire' || style === 'particles';
    if (persistent) {
      const prev = this.targets.get(`${key}:prev`, w, h);
      const u = this.fadePass.material.uniforms;
      u.uTex.value = rt.texture;
      u.uDecay.value = style === 'trails' ? 0.92 : style === 'fire' ? 0.8 : 0.75;
      this.fadePass.render(this.r, prev);
      // copy back
      u.uTex.value = prev.texture;
      u.uDecay.value = 1;
      this.fadePass.render(this.r, rt);
    } else this.clear(rt, 1);

    if (style === 'skeleton' || style === 'lines' || style === 'trails' || style === 'glow') this.drawSkeleton(rt, people, mx, style === 'glow');
    if (style === 'particles' || style === 'fire') {
      this.emit(people, mx, style, dt);
      this.stepParticles(dt, style === 'fire' ? -0.6 : 0.15);
      this.drawParticles(rt, style);
    }
    if (style === 'lines' && people.length > 1) {
      // connect the same joints of different people
      const verts: number[] = [];
      const cols: number[] = [];
      for (const j of [POSE.leftWrist, POSE.rightWrist, POSE.nose])
        for (let a = 0; a < people.length; a++)
          for (let b = a + 1; b < people.length; b++) {
            const A = people[a].landmarks;
            const B = people[b].landmarks;
            verts.push(mx(A[j * POSE_STRIDE]), A[j * POSE_STRIDE + 1], mx(B[j * POSE_STRIDE]), B[j * POSE_STRIDE + 1]);
            cols.push(1, 0.3, 0.9, 0.8, 0.3, 0.6, 1, 0.8);
          }
      this.drawLines(rt, verts, cols, false);
    }
    return rtRef(rt);
  }

  private clear(rt: THREE.WebGLRenderTarget, alpha: number) {
    this.r.setRenderTarget(rt);
    this.r.setClearColor(0x000000, alpha);
    this.r.clear(true, false, false);
  }

  private drawSkeleton(rt: THREE.WebGLRenderTarget, people: TrackedPerson[], mx: (x: number) => number, glow: boolean) {
    const verts: number[] = [];
    const cols: number[] = [];
    const pts: number[] = [];
    const sizes: number[] = [];
    const pcol: number[] = [];
    people.forEach((p, k) => {
      const hue = (p.id * 0.17) % 1;
      const [r, g, b] = hsl(hue, 0.9, 0.6);
      const lm = p.landmarks;
      for (const [a, c] of POSE_CONNECTIONS) {
        if (lm[a * POSE_STRIDE + 3] < 0.4 || lm[c * POSE_STRIDE + 3] < 0.4) continue;
        verts.push(mx(lm[a * POSE_STRIDE]), lm[a * POSE_STRIDE + 1], mx(lm[c * POSE_STRIDE]), lm[c * POSE_STRIDE + 1]);
        cols.push(r, g, b, 1, r, g, b, 1);
      }
      for (let i = 0; i < 33; i++) {
        if (lm[i * POSE_STRIDE + 3] < 0.4) continue;
        pts.push(mx(lm[i * POSE_STRIDE]), lm[i * POSE_STRIDE + 1]);
        sizes.push(glow ? 90 : 14);
        pcol.push(r, g, b, glow ? 0.5 : 1);
      }
      for (const hand of p.hands) {
        const hl = hand.landmarks;
        for (const [a, c] of HAND_CONNECTIONS) {
          verts.push(mx(hl[a * HAND_STRIDE]), hl[a * HAND_STRIDE + 1], mx(hl[c * HAND_STRIDE]), hl[c * HAND_STRIDE + 1]);
          cols.push(1, 1, 1, 0.9, 1, 1, 1, 0.9);
        }
      }
      void k;
    });
    this.drawLines(rt, verts, cols, false);
    this.drawPoints(rt, pts, sizes, pcol, glow);
  }

  private drawLines(rt: THREE.WebGLRenderTarget, verts: number[], cols: number[], clear: boolean) {
    const n = Math.min(4096, verts.length / 2);
    if (n === 0) return;
    const pos = this.lineGeom.getAttribute('position') as THREE.BufferAttribute;
    const col = this.lineGeom.getAttribute('aColor') as THREE.BufferAttribute;
    (pos.array as Float32Array).set(verts.slice(0, n * 2));
    (col.array as Float32Array).set(cols.slice(0, n * 4));
    pos.needsUpdate = true;
    col.needsUpdate = true;
    this.lineGeom.setDrawRange(0, n);
    this.points.visible = false;
    this.lines.visible = true;
    rt.viewport.set(0, 0, rt.width, rt.height);
    this.r.setRenderTarget(rt);
    if (clear) this.clear(rt, 1);
    this.r.render(this.scene, dummyCamera);
  }

  private drawPoints(rt: THREE.WebGLRenderTarget, pts: number[], sizes: number[], cols: number[], soft: boolean) {
    const n = Math.min(MAX_P, sizes.length);
    if (n === 0) return;
    const pos = this.ptsGeom.getAttribute('position') as THREE.BufferAttribute;
    const sz = this.ptsGeom.getAttribute('aSize') as THREE.BufferAttribute;
    const col = this.ptsGeom.getAttribute('aColor') as THREE.BufferAttribute;
    (pos.array as Float32Array).set(pts.slice(0, n * 2));
    (sz.array as Float32Array).set(sizes.slice(0, n));
    (col.array as Float32Array).set(cols.slice(0, n * 4));
    pos.needsUpdate = sz.needsUpdate = col.needsUpdate = true;
    this.ptsGeom.setDrawRange(0, n);
    this.ptsMat.uniforms.uRes.value.set(rt.width, rt.height);
    this.ptsMat.uniforms.uSoft.value = soft ? 1 : 0;
    this.points.visible = true;
    this.lines.visible = false;
    rt.viewport.set(0, 0, rt.width, rt.height);
    this.r.setRenderTarget(rt);
    this.r.render(this.scene, dummyCamera);
    this.lines.visible = true;
  }

  private emit(people: TrackedPerson[], mx: (x: number) => number, style: TrackingVisual, dt: number) {
    const joints = style === 'fire' ? [POSE.leftWrist, POSE.rightWrist, POSE.leftAnkle, POSE.rightAnkle, POSE.nose] : [POSE.leftWrist, POSE.rightWrist, POSE.leftIndex, POSE.rightIndex];
    for (const p of people) {
      const speed = Math.hypot(p.velocity.x, p.velocity.y);
      const rate = (style === 'fire' ? 220 : 120) * (0.3 + Math.min(2, speed * 3)) * dt;
      for (const j of joints) {
        if (p.landmarks[j * POSE_STRIDE + 3] < 0.5) continue;
        const x = mx(p.landmarks[j * POSE_STRIDE]);
        const y = p.landmarks[j * POSE_STRIDE + 1];
        let n = rate;
        while (n > 0 && this.particles.length < MAX_P) {
          if (n < 1 && Math.random() > n) break;
          n--;
          const a = Math.random() * Math.PI * 2;
          const v = style === 'fire' ? 0.05 : 0.08 + Math.random() * 0.25;
          const max = style === 'fire' ? 0.5 + Math.random() * 0.6 : 0.8 + Math.random() * 1.4;
          this.particles.push({ x, y, vx: Math.cos(a) * v + (mirrorSign(mx) * p.velocity.x) * 0.2, vy: Math.sin(a) * v + p.velocity.y * 0.2, life: 0, max, size: style === 'fire' ? 30 + Math.random() * 40 : 6 + Math.random() * 14, hue: (p.id * 0.17 + Math.random() * 0.1) % 1 });
        }
      }
    }
  }

  private stepParticles(dt: number, gravity: number) {
    const alive: Particle[] = [];
    for (const p of this.particles) {
      p.life += dt;
      if (p.life >= p.max) continue;
      p.vy += gravity * dt;
      p.vx *= 0.98;
      p.vy *= 0.98;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      alive.push(p);
    }
    this.particles = alive;
  }

  private drawParticles(rt: THREE.WebGLRenderTarget, style: TrackingVisual) {
    const pts: number[] = [];
    const sizes: number[] = [];
    const cols: number[] = [];
    for (const p of this.particles) {
      const t = p.life / p.max;
      pts.push(p.x, p.y);
      if (style === 'fire') {
        const heat = 1 - t;
        sizes.push(p.size * (0.4 + heat));
        cols.push(1, 0.3 + heat * 0.6, heat * heat * 0.4, heat * 0.5);
      } else {
        const [r, g, b] = hsl(p.hue, 0.9, 0.6);
        sizes.push(p.size * (1 - t * 0.7));
        cols.push(r, g, b, 1 - t);
      }
    }
    this.drawPoints(rt, pts, sizes, cols, true);
  }

  endFrame() {
    this.frame++;
    this.targets.frame++;
  }
}

function mirrorSign(mx: (x: number) => number) {
  return mx(1) < mx(0) ? -1 : 1;
}

function hsl(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h * 12) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}
