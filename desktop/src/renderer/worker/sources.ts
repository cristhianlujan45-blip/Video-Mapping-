import * as THREE from 'three';
import type { GeneratorKind, SourceRef } from '../../shared/project/model';
import { dummyCamera, FullscreenPass, hexToRgb, rawMaterial, TargetCache, rtRef, type TexRef } from './gl';

export interface FrameContext {
  time: number;
  beatPhase: number;
  audio: { rms: number; bass: number; mid: number; treble: number; beat: number; spectrum: Float32Array };
  particleQuality: number;
}

interface FrameSource {
  tex: THREE.Texture;
  pending: VideoFrame | null;
  width: number;
  height: number;
  lastFrame: number;
  frames: number;
  status: 'ok' | 'offline' | 'error' | 'waiting';
  message?: string;
  reader?: ReadableStreamDefaultReader<VideoFrame>;
}

const GENERATOR_FRAG: Record<GeneratorKind, string> = {
  gradient: `vec3 gen(vec2 uv){ float t = uv.x + 0.15*sin(uTime*0.5 + uv.y*3.0); return mix(uA, uB, clamp(t,0.0,1.0)); }`,
  plasma: `vec3 gen(vec2 uv){ vec2 p = (uv-0.5)*vec2(uRes.x/uRes.y,1.0)*6.0; float t=uTime*0.6;
    float v = sin(p.x+t)+sin((p.y+t)*0.7)+sin((p.x+p.y+t)*0.5)+sin(length(p+vec2(sin(t*0.3),cos(t*0.4))*3.0)+t);
    v = v*0.25+0.5 + uAudio.y*0.3; return mix(uA, uB, 0.5+0.5*sin(v*6.2831)); }`,
  noise: `float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
    vec3 gen(vec2 uv){ vec2 p=uv*vec2(uRes.x/uRes.y,1.0)*4.0; float v=0.0,a=0.5; for(int i=0;i<5;i++){v+=a*n(p+uTime*0.2*float(i+1));p*=2.0;a*=0.5;} return mix(uA,uB,v); }`,
  tunnel: `vec3 gen(vec2 uv){ vec2 p=(uv-0.5)*vec2(uRes.x/uRes.y,1.0); float r=length(p); float a=atan(p.y,p.x);
    float v = 0.5+0.5*sin(10.0/(r+0.05) - uTime*3.0 - uAudio.y*4.0) * cos(a*6.0 + uTime);
    return mix(uB, uA, v) * smoothstep(0.0, 0.2, r); }`,
  waves: `vec3 gen(vec2 uv){ float v=0.0; for(int i=0;i<4;i++){ float fi=float(i); v+=sin(uv.x*(6.0+fi*3.0)+uTime*(1.0+fi*0.3)+sin(uv.y*3.0+uTime)*1.5)*0.25; }
    float l = smoothstep(0.02,0.0,abs(uv.y-0.5-v*0.25*(0.5+uAudio.x))); return mix(uB*0.1, uA, l) + uB*0.2*v; }`,
  stripes: `vec3 gen(vec2 uv){ float s=step(0.5,fract(uv.x*12.0 - uTime*0.5 + uAudio.y)); return mix(uA,uB,s); }`,
  checker: `vec3 gen(vec2 uv){ vec2 g=floor(uv*vec2(16.0,9.0)+vec2(uTime*0.5,0.0)); return mix(uA,uB,mod(g.x+g.y,2.0)); }`,
  rings: `vec3 gen(vec2 uv){ vec2 p=(uv-0.5)*vec2(uRes.x/uRes.y,1.0); float r=length(p);
    float v=0.5+0.5*sin(r*40.0-uTime*4.0-uAudio.y*6.0); return mix(uB,uA,smoothstep(0.3,0.7,v)); }`,
  particles: `vec3 gen(vec2 uv){ return vec3(0.0); }`,
  audioSpectrum: `vec3 gen(vec2 uv){ int b = int(clamp(floor(uv.x*16.0),0.0,15.0)); float h = uSpec[b];
    float bar = step(1.0-uv.y, h) * step(0.08, fract(uv.x*16.0)); return mix(uB*0.15, mix(uA,uB,uv.y), bar); }`,
};

const PARTICLE_VERT = /* glsl */ `
precision highp float;
in float seed;
uniform float uTime; uniform float uSize; uniform vec4 uAudio; uniform vec2 uRes; uniform float uFlipOut;
out float vLife; out float vSeed;
float h(float n){ return fract(sin(n*12.9898)*43758.5453); }
void main(){
  float life = fract(uTime*(0.08+0.12*h(seed*3.1)) + h(seed));
  vec2 origin = vec2(h(seed*7.3), 1.05);
  vec2 vel = vec2((h(seed*1.7)-0.5)*0.4, -(0.4+h(seed*5.9)*0.8));
  vec2 p = origin + vel*life + vec2(sin(uTime+seed)*0.03, 0.0);
  p.y = 1.0 - fract(1.0 - p.y);
  vLife = life; vSeed = seed;
  float y = uFlipOut > 0.5 ? p.y*2.0-1.0 : 1.0-p.y*2.0;
  gl_Position = vec4(p.x*2.0-1.0, y, 0.0, 1.0);
  gl_PointSize = uSize * (1.0 - life) * (0.5 + uAudio.y) * uRes.y/1080.0 + 1.0;
}`;

const PARTICLE_FRAG = /* glsl */ `
precision highp float;
in float vLife; in float vSeed;
uniform vec3 uA; uniform vec3 uB;
out vec4 outColor;
void main(){
  vec2 d = gl_PointCoord-0.5; float a = smoothstep(0.5,0.0,length(d));
  outColor = vec4(mix(uA,uB,vLife)*a*(1.0-vLife), 1.0);
}`;

/**
 * GPU textures for every SourceRef. Video/camera frames arrive as VideoFrames (GPU
 * backed) and are uploaded once per new frame; one decoded frame feeds every layer,
 * surface, 3D face and output that uses it.
 */
export class SourceManager {
  private frames = new Map<string, FrameSource>();
  private images = new Map<string, THREE.Texture>();
  private solids = new Map<string, THREE.DataTexture>();
  private canvases = new Map<string, { tex: THREE.CanvasTexture; key: string }>();
  private genPasses = new Map<GeneratorKind, FullscreenPass>();
  private testPass: FullscreenPass;
  private particles: { points: THREE.Points; scene: THREE.Scene; mat: THREE.RawShaderMaterial; count: number } | null = null;
  readonly targets = new TargetCache();
  videoFramesThisSecond = 0;
  /** Resolver for compositions/drawings/tracking, set by the engine. */
  external: (ref: SourceRef, w: number, h: number) => TexRef | null = () => null;

  constructor(private r: THREE.WebGLRenderer) {
    this.testPass = new FullscreenPass(
      rawMaterial(
        /* glsl */ `
in vec2 vUv; out vec4 outColor; uniform vec2 uRes; uniform float uTime;
void main(){
  vec2 c = vUv;
  vec2 g = floor(c*vec2(16.0, 16.0*uRes.y/uRes.x));
  vec3 col = mix(vec3(0.10), vec3(0.22), mod(g.x+g.y,2.0));
  vec2 px = c*uRes;
  vec2 cell = uRes/16.0;
  vec2 f = abs(mod(px+cell*0.5, cell)-cell*0.5);
  col = mix(col, vec3(0.65), (1.0-smoothstep(0.0,1.5,min(f.x,f.y)))*0.7);
  float diag = 1.0-smoothstep(0.0,1.5*1.0/uRes.y*uRes.y*0.002, min(abs(c.x-c.y), abs(c.x-(1.0-c.y))));
  col = mix(col, vec3(0.9), diag*0.5);
  vec2 cc = abs(c-0.5);
  float r = length((c-0.5)*vec2(uRes.x/uRes.y,1.0));
  col = mix(col, vec3(1.0), (1.0-smoothstep(0.0,0.004,abs(r-0.35))));
  float m = 0.08;
  if (c.x<m && c.y<m) col=vec3(1.0,0.15,0.15);
  else if (c.x>1.0-m && c.y<m) col=vec3(0.15,1.0,0.25);
  else if (c.x>1.0-m && c.y>1.0-m) col=vec3(0.2,0.4,1.0);
  else if (c.x<m && c.y>1.0-m) col=vec3(1.0,0.9,0.1);
  float border = 1.0-step(2.0, min(min(px.x,uRes.x-px.x),min(px.y,uRes.y-px.y)));
  col = mix(col, vec3(1.0), border);
  float crossv = step(cc.x, 1.0/uRes.x) + step(cc.y, 1.0/uRes.y);
  col = mix(col, vec3(1.0), clamp(crossv,0.0,1.0)*step(max(cc.x,cc.y),0.1));
  outColor = vec4(col,1.0);
}`,
        { uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 } },
      ),
    );
  }

  // ---------------------------------------------------------------- video frames / streams

  private frameSource(key: string): FrameSource {
    let s = this.frames.get(key);
    if (!s) {
      const tex = new THREE.Texture();
      tex.flipY = false;
      tex.generateMipmaps = false;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.colorSpace = THREE.NoColorSpace;
      s = { tex, pending: null, width: 0, height: 0, lastFrame: 0, frames: 0, status: 'waiting' };
      this.frames.set(key, s);
    }
    return s;
  }

  pushFrame(key: string, frame: VideoFrame) {
    const s = this.frameSource(key);
    // Keep only the newest frame: if rendering is slower than the source, drop, never queue.
    s.pending?.close();
    s.pending = frame;
    s.status = 'ok';
  }

  attachStream(key: string, stream: ReadableStream<VideoFrame>) {
    const s = this.frameSource(key);
    void s.reader?.cancel().catch(() => {});
    const reader = stream.getReader();
    s.reader = reader;
    s.status = 'waiting';
    const pump = async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (s.reader !== reader) {
            value.close();
            break;
          }
          this.pushFrame(key, value);
        }
        if (s.reader === reader) s.status = 'offline';
      } catch (e) {
        if (s.reader === reader) {
          s.status = 'offline';
          s.message = (e as Error).message;
        }
      }
    };
    void pump();
  }

  setStatus(key: string, status: FrameSource['status'], message?: string) {
    const s = this.frameSource(key);
    s.status = status;
    s.message = message;
  }

  setImage(key: string, bitmap: ImageBitmap) {
    const old = this.images.get(key);
    old?.dispose();
    (old?.image as ImageBitmap | undefined)?.close?.();
    const tex = new THREE.Texture(bitmap);
    tex.flipY = false;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    this.images.set(key, tex);
  }

  drop(key: string) {
    const f = this.frames.get(key);
    if (f) {
      void f.reader?.cancel().catch(() => {});
      f.pending?.close();
      f.tex.dispose();
      this.frames.delete(key);
    }
    const i = this.images.get(key);
    if (i) {
      i.dispose();
      (i.image as ImageBitmap | undefined)?.close?.();
      this.images.delete(key);
    }
  }

  /** Uploads pending frames (once per new frame, shared by every consumer). */
  uploadPending() {
    for (const s of this.frames.values()) {
      const f = s.pending;
      if (!f) continue;
      s.pending = null;
      try {
        s.tex.image = f;
        s.tex.needsUpdate = true;
        this.r.initTexture(s.tex);
        s.width = f.displayWidth;
        s.height = f.displayHeight;
        s.lastFrame = performance.now();
        s.frames++;
        this.videoFramesThisSecond++;
      } catch (e) {
        s.status = 'error';
        s.message = (e as Error).message;
      } finally {
        // The GPU copy is done: release the decoder surface right away.
        f.close();
      }
    }
  }

  get sourceCount() {
    return this.frames.size + this.images.size;
  }

  status(key: string) {
    return this.frames.get(key)?.status;
  }

  // ---------------------------------------------------------------- resolve

  resolve(ref: SourceRef, w: number, h: number, ctx: FrameContext): TexRef | null {
    switch (ref.type) {
      case 'none':
        return null;
      case 'media':
        return this.keyed(`media:${ref.mediaId}`, w, h, 'ARCHIVO NO DISPONIBLE');
      case 'camera':
        return this.keyed(`camera:${ref.cameraId}`, w, h, 'CAMERA OFFLINE');
      case 'solid':
        return this.solid(ref.color);
      case 'testpattern':
        return this.testPattern(w, h, ctx);
      case 'generator':
        return this.generator(ref.generator, ref.colorA, ref.colorB, w, h, ctx);
      case 'text':
        return this.text(ref.text, ref.font, ref.size, ref.color, w, h);
      default:
        return this.external(ref, w, h);
    }
  }

  private keyed(key: string, w: number, h: number, offlineLabel: string): TexRef | null {
    const img = this.images.get(key);
    if (img) {
      const bm = img.image as ImageBitmap;
      return { tex: img, flip: false, width: bm.width, height: bm.height };
    }
    const f = this.frames.get(key);
    if (f && f.width > 0 && f.status !== 'offline' && f.status !== 'error') return { tex: f.tex, flip: false, width: f.width, height: f.height };
    if (f && f.width > 0 && f.status === 'offline') {
      // Keep showing the last frame with the warning on top in the UI; outputs get the label.
      return this.label(`${offlineLabel}`, w, h, '#ff4040');
    }
    if (!f || f.status === 'waiting') return this.label(key.startsWith('camera') ? 'CONECTANDO CÁMARA…' : 'CARGANDO…', w, h, '#808080');
    return this.label(f.status === 'error' ? `${offlineLabel}\n${f.message ?? ''}` : offlineLabel, w, h, '#ff4040');
  }

  private solid(color: string): TexRef {
    let t = this.solids.get(color);
    if (!t) {
      const [r, g, b] = hexToRgb(color);
      t = new THREE.DataTexture(new Uint8Array([r * 255, g * 255, b * 255, 255]), 1, 1);
      t.needsUpdate = true;
      this.solids.set(color, t);
    }
    return { tex: t, flip: false, width: 1, height: 1 };
  }

  private testPattern(w: number, h: number, ctx: FrameContext): TexRef {
    const key = `test:${w}x${h}`;
    const fresh = !this.targets.has(key);
    const rt = this.targets.get(key, w, h);
    if (fresh) {
      const m = this.testPass.material;
      m.uniforms.uRes.value.set(rt.width, rt.height);
      m.uniforms.uTime.value = ctx.time;
      this.testPass.render(this.r, rt);
    }
    return rtRef(rt);
  }

  private generator(kind: GeneratorKind, a: string, b: string, w: number, h: number, ctx: FrameContext): TexRef {
    const key = `gen:${kind}:${a}:${b}`;
    const rt = this.targets.get(key, w, h);
    if (this.targets.frame === (rt as unknown as { __rendered?: number }).__rendered) return rtRef(rt);
    (rt as unknown as { __rendered?: number }).__rendered = this.targets.frame;
    if (kind === 'particles') {
      this.renderParticles(rt, a, b, ctx);
      return rtRef(rt);
    }
    let pass = this.genPasses.get(kind);
    if (!pass) {
      pass = new FullscreenPass(
        rawMaterial(
          `in vec2 vUv; out vec4 outColor; uniform float uTime; uniform vec2 uRes; uniform vec3 uA; uniform vec3 uB; uniform vec4 uAudio; uniform float uSpec[16];
           ${GENERATOR_FRAG[kind]}
           void main(){ outColor = vec4(gen(vUv), 1.0); }`,
          { uTime: { value: 0 }, uRes: { value: new THREE.Vector2() }, uA: { value: new THREE.Vector3() }, uB: { value: new THREE.Vector3() }, uAudio: { value: new THREE.Vector4() }, uSpec: { value: new Float32Array(16) } },
        ),
      );
      this.genPasses.set(kind, pass);
    }
    const u = pass.material.uniforms;
    u.uTime.value = ctx.time;
    u.uRes.value.set(rt.width, rt.height);
    u.uA.value.set(...hexToRgb(a));
    u.uB.value.set(...hexToRgb(b));
    u.uAudio.value.set(ctx.audio.rms, ctx.audio.bass, ctx.audio.mid, ctx.audio.treble);
    u.uSpec.value = ctx.audio.spectrum;
    pass.render(this.r, rt);
    return rtRef(rt);
  }

  private renderParticles(rt: THREE.WebGLRenderTarget, a: string, b: string, ctx: FrameContext) {
    const count = Math.round(2000 + 18000 * Math.max(0, Math.min(1, ctx.particleQuality)));
    if (!this.particles || this.particles.count !== count) {
      if (this.particles) {
        this.particles.points.geometry.dispose();
      }
      const g = new THREE.BufferGeometry();
      const seeds = new Float32Array(count);
      for (let i = 0; i < count; i++) seeds[i] = i * 0.618 + 0.1;
      g.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
      const mat =
        this.particles?.mat ??
        new THREE.RawShaderMaterial({
          glslVersion: THREE.GLSL3,
          vertexShader: PARTICLE_VERT,
          fragmentShader: PARTICLE_FRAG,
          uniforms: { uTime: { value: 0 }, uSize: { value: 10 }, uAudio: { value: new THREE.Vector4() }, uRes: { value: new THREE.Vector2() }, uFlipOut: { value: 1 }, uA: { value: new THREE.Vector3() }, uB: { value: new THREE.Vector3() } },
          blending: THREE.AdditiveBlending,
          depthTest: false,
          depthWrite: false,
          transparent: true,
        });
      const points = new THREE.Points(g, mat);
      points.frustumCulled = false;
      const scene = new THREE.Scene();
      scene.add(points);
      this.particles = { points, scene, mat, count };
    }
    const u = this.particles.mat.uniforms;
    u.uTime.value = ctx.time;
    u.uAudio.value.set(ctx.audio.rms, ctx.audio.bass, ctx.audio.mid, ctx.audio.treble);
    u.uRes.value.set(rt.width, rt.height);
    u.uA.value.set(...hexToRgb(a));
    u.uB.value.set(...hexToRgb(b));
    this.r.setRenderTarget(rt);
    this.r.setClearColor(0x000000, 1);
    this.r.clear(true, false, false);
    this.r.render(this.particles.scene, dummyCamera);
  }

  // ---------------------------------------------------------------- canvas-based (text / labels)

  private canvasTex(key: string, contentKey: string, w: number, h: number, draw: (c: OffscreenCanvasRenderingContext2D, w: number, h: number) => void): TexRef {
    let e = this.canvases.get(key);
    if (!e || e.key !== contentKey) {
      const cw = Math.max(16, Math.min(4096, Math.round(w)));
      const ch = Math.max(16, Math.min(4096, Math.round(h)));
      const canvas = new OffscreenCanvas(cw, ch);
      const c = canvas.getContext('2d')!;
      draw(c, cw, ch);
      e?.tex.dispose();
      const tex = new THREE.CanvasTexture(canvas as unknown as HTMLCanvasElement);
      tex.flipY = false;
      tex.colorSpace = THREE.NoColorSpace;
      tex.generateMipmaps = false;
      tex.minFilter = THREE.LinearFilter;
      e = { tex, key: contentKey };
      this.canvases.set(key, e);
    }
    const img = e.tex.image as OffscreenCanvas;
    return { tex: e.tex, flip: false, width: img.width, height: img.height };
  }

  label(text: string, w: number, h: number, color: string): TexRef {
    const cw = Math.min(1280, Math.max(320, w / 2));
    const ch = Math.max(180, (cw * h) / Math.max(1, w));
    return this.canvasTex(`label:${text}:${color}`, `${cw}x${ch}`, cw, ch, (c, W, H) => {
      c.fillStyle = '#000';
      c.fillRect(0, 0, W, H);
      c.strokeStyle = color;
      c.lineWidth = Math.max(2, W / 200);
      c.strokeRect(c.lineWidth, c.lineWidth, W - 2 * c.lineWidth, H - 2 * c.lineWidth);
      c.fillStyle = color;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      const lines = text.split('\n');
      const size = Math.round(Math.min(W / 14, H / (lines.length * 2.5)));
      c.font = `bold ${size}px Segoe UI, Arial, sans-serif`;
      lines.forEach((l, i) => c.fillText(l, W / 2, H / 2 + (i - (lines.length - 1) / 2) * size * 1.3, W * 0.9));
    });
  }

  private text(text: string, font: string, size: number, color: string, w: number, h: number): TexRef {
    return this.canvasTex(`text:${text}:${font}:${size}:${color}`, `${w}x${h}`, w, h, (c, W, H) => {
      c.clearRect(0, 0, W, H);
      c.fillStyle = color;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      const px = Math.round((size / 1080) * H);
      c.font = `${px}px ${font || 'Segoe UI'}, Arial, sans-serif`;
      const lines = text.split('\n');
      lines.forEach((l, i) => c.fillText(l, W / 2, H / 2 + (i - (lines.length - 1) / 2) * px * 1.2, W * 0.95));
    });
  }

  endFrame() {
    this.targets.frame++;
    if (this.targets.frame % 300 === 0) this.targets.gc(300);
  }
}
