import * as THREE from 'three';
import type { EffectInstance, EffectKind } from '../../shared/project/model';
import { EFFECTS, effectParamId } from '../../shared/project/effects';
import { FullscreenPass, rawMaterial, rtRef, TargetCache, type TexRef } from './gl';

const COMMON = /* glsl */ `
in vec2 vUv; out vec4 outColor;
uniform sampler2D uTex; uniform float uFlip; uniform vec2 uRes; uniform float uTime; uniform float uMix;
vec4 src(vec2 uv){ return samp(uTex, uFlip, clamp(uv, 0.0, 1.0)); }
vec3 rgb2hsv(vec3 c){ vec4 K=vec4(0.,-1./3.,2./3.,-1.); vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g)); vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r)); float d=q.x-min(q.w,q.y); float e=1e-10; return vec3(abs(q.z+(q.w-q.y)/(6.*d+e)),d/(q.x+e),q.x); }
vec3 hsv2rgb(vec3 c){ vec3 p=abs(fract(c.xxx+vec3(1.,2./3.,1./3.))*6.-3.); return c.z*mix(vec3(1.),clamp(p-1.,0.,1.),c.y); }
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
`;

/** Single-pass effects: body defines vec4 fx(vec2 uv). Param uniforms are uP_<name>. */
const SINGLE: Partial<Record<EffectKind, string>> = {
  color: `vec4 fx(vec2 uv){ vec4 c=src(uv); vec3 x=c.rgb+uP_brightness; x=(x-0.5)*uP_contrast+0.5;
    float l=dot(x,vec3(0.2126,0.7152,0.0722)); x=mix(vec3(l),x,uP_saturation);
    vec3 h=rgb2hsv(clamp(x,0.,1.)); h.x=fract(h.x+uP_hue/360.); x=hsv2rgb(h);
    x=pow(clamp(x,0.,1.),vec3(1.0/max(uP_gamma,0.01))); return vec4(x,c.a); }`,
  sharpen: `vec4 fx(vec2 uv){ vec2 px=1./uRes; vec4 c=src(uv); vec4 n=src(uv+vec2(px.x,0.))+src(uv-vec2(px.x,0.))+src(uv+vec2(0.,px.y))+src(uv-vec2(0.,px.y));
    return vec4(c.rgb+(c.rgb*4.-n.rgb)*uP_amount*0.25, c.a); }`,
  chromatic: `vec4 fx(vec2 uv){ vec2 d=(uv-0.5)*uP_amount*2.; return vec4(src(uv+d).r, src(uv).g, src(uv-d).b, src(uv).a); }`,
  rgbSplit: `vec4 fx(vec2 uv){ float a=radians(uP_angle); vec2 d=vec2(cos(a),sin(a))*uP_amount; return vec4(src(uv+d).r, src(uv).g, src(uv-d).b, 1.0); }`,
  pixelate: `vec4 fx(vec2 uv){ vec2 cell=vec2(max(uP_size,1.0))/uRes; return src((floor(uv/cell)+0.5)*cell); }`,
  noise: `vec4 fx(vec2 uv){ vec4 c=src(uv); float n=hash(uv*uRes+fract(uTime)*100.)-0.5; return vec4(c.rgb+n*uP_amount, c.a); }`,
  filmGrain: `vec4 fx(vec2 uv){ vec4 c=src(uv); vec2 g=floor(uv*uRes/uP_size); float n=hash(g+floor(uTime*24.))-0.5; float l=dot(c.rgb,vec3(0.299,0.587,0.114));
    return vec4(c.rgb+n*uP_amount*(1.0-l*0.6), c.a); }`,
  glitch: `vec4 fx(vec2 uv){ float t=floor(uTime*uP_speed); float row=floor(uv.y*uP_blocks); float r=hash(vec2(row,t));
    float shift=(r>1.0-uP_amount*0.6)?(hash(vec2(t,row*1.7))-0.5)*0.25*uP_amount:0.0;
    vec2 u2=vec2(fract(uv.x+shift),uv.y); vec4 c=src(u2);
    if(hash(vec2(t*3.1,row))>1.0-uP_amount*0.3){ c.rgb=vec3(src(u2+vec2(0.01*uP_amount,0.)).r, c.g, src(u2-vec2(0.01*uP_amount,0.)).b); }
    float blk=hash(floor(uv*vec2(uP_blocks,uP_blocks*0.5))+t); if(blk>1.0-uP_amount*0.08) c.rgb=1.0-c.rgb; return c; }`,
  distortion: `vec4 fx(vec2 uv){ vec2 p=uv-0.5; float r2=dot(p,p); vec2 d=p*(1.0+uP_amount*r2*2.0); return src(d+0.5); }`,
  displacement: `float n2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
    vec4 fx(vec2 uv){ vec2 o=vec2(n2(uv*uP_scale+uTime*uP_speed), n2(uv*uP_scale+17.0-uTime*uP_speed))-0.5; return src(uv+o*uP_amount*2.0); }`,
  wave: `vec4 fx(vec2 uv){ vec2 o=vec2(sin(uv.y*uP_frequency+uTime*uP_speed), cos(uv.x*uP_frequency+uTime*uP_speed))*uP_amount; return src(uv+o); }`,
  kaleidoscope: `vec4 fx(vec2 uv){ vec2 p=(uv-0.5)*vec2(uRes.x/uRes.y,1.0)/uP_zoom; float r=length(p); float a=atan(p.y,p.x)+radians(uP_rotation);
    float seg=6.2831853/max(uP_segments,2.0); a=mod(a,seg); a=abs(a-seg*0.5);
    vec2 q=vec2(cos(a),sin(a))*r; q.x/= (uRes.x/uRes.y); return src(q+0.5); }`,
  mirror: `vec4 fx(vec2 uv){ vec2 u=uv; if(uP_mode<0.5){ u.x=u.x>0.5?1.0-u.x:u.x; } else if(uP_mode<1.5){ u.y=u.y>0.5?1.0-u.y:u.y; } else { u=abs(fract(u*2.0)-0.5)*2.0*0.5; u=vec2(u.x,u.y); }
    return src(u); }`,
  edges: `vec4 fx(vec2 uv){ vec2 px=1./uRes; float tl=dot(src(uv+px*vec2(-1,-1)).rgb,vec3(.333)),t=dot(src(uv+px*vec2(0,-1)).rgb,vec3(.333)),tr=dot(src(uv+px*vec2(1,-1)).rgb,vec3(.333));
    float l=dot(src(uv+px*vec2(-1,0)).rgb,vec3(.333)),r=dot(src(uv+px*vec2(1,0)).rgb,vec3(.333));
    float bl=dot(src(uv+px*vec2(-1,1)).rgb,vec3(.333)),b=dot(src(uv+px*vec2(0,1)).rgb,vec3(.333)),br=dot(src(uv+px*vec2(1,1)).rgb,vec3(.333));
    float gx=-tl-2.*l-bl+tr+2.*r+br; float gy=-tl-2.*t-tr+bl+2.*b+br; float e=length(vec2(gx,gy))*uP_strength; return vec4(vec3(e),1.0); }`,
  threshold: `vec4 fx(vec2 uv){ vec4 c=src(uv); float l=dot(c.rgb,vec3(0.2126,0.7152,0.0722)); return vec4(vec3(smoothstep(uP_level-uP_softness,uP_level+uP_softness,l)),c.a); }`,
  posterize: `vec4 fx(vec2 uv){ vec4 c=src(uv); float n=max(uP_levels,2.0)-1.0; return vec4(floor(c.rgb*n+0.5)/n,c.a); }`,
  colorReplace: `vec4 fx(vec2 uv){ vec4 c=src(uv); vec3 h=rgb2hsv(c.rgb); float d=abs(mod(h.x*360.-uP_fromHue+540.,360.)-180.);
    float w=(1.0-smoothstep(uP_tolerance*0.7,uP_tolerance,d))*step(0.15,h.y); h.x=mix(h.x,uP_toHue/360.,w); return vec4(hsv2rgb(h),c.a); }`,
  invert: `vec4 fx(vec2 uv){ vec4 c=src(uv); return vec4(1.0-c.rgb,c.a); }`,
  silhouette: `vec4 fx(vec2 uv){ vec4 c=src(uv); float l=dot(c.rgb,vec3(0.2126,0.7152,0.0722)); float m=step(uP_threshold,l); return vec4(hsv2rgb(vec3(uP_hue/360.,0.85,1.0))*m,1.0); }`,
  strobe: `vec4 fx(vec2 uv){ vec4 c=src(uv); float on=step(fract(uTime*uP_rate),uP_duty); return vec4(c.rgb*on,c.a); }`,
  zoom: `vec4 fx(vec2 uv){ vec2 cc=vec2(uP_centerX,uP_centerY); return src((uv-cc)/max(uP_zoom,0.01)+cc); }`,
};

const MIX_MAIN = `void main(){ vec4 o=fx(vUv); vec4 dry=src(vUv); outColor=mix(dry,o,uMix); }`;

const BLUR_FRAG = /* glsl */ `
${COMMON}
uniform vec2 uDir; uniform float uRadius;
void main(){
  float sigma=max(uRadius*0.5,0.001); vec4 acc=vec4(0.); float wsum=0.;
  for(int i=-12;i<=12;i++){ float x=float(i)*uRadius/12.0; float w=exp(-0.5*x*x/(sigma*sigma)); acc+=src(vUv+uDir*x/uRes)*w; wsum+=w; }
  outColor=acc/wsum;
}`;

const THRESH_FRAG = /* glsl */ `
${COMMON}
uniform float uThreshold;
void main(){ vec4 c=src(vUv); float l=max(c.r,max(c.g,c.b)); outColor=vec4(c.rgb*smoothstep(uThreshold,uThreshold+0.1,l),1.0); }`;

const ADD_FRAG = /* glsl */ `
${COMMON}
uniform sampler2D uGlow; uniform float uIntensity;
void main(){ vec4 c=src(vUv); vec3 g=texture(uGlow,vUv).rgb; outColor=vec4(mix(c.rgb, c.rgb+g*uIntensity, uMix), c.a); }`;

const FEEDBACK_FRAG = /* glsl */ `
${COMMON}
uniform sampler2D uPrev; uniform float uAmount; uniform float uZoom; uniform float uRot; uniform float uHue; uniform float uMode;
void main(){
  vec4 c=src(vUv);
  vec2 p=vUv-0.5; float a=radians(uRot); p=mat2(cos(a),-sin(a),sin(a),cos(a))*p/max(uZoom,0.01);
  vec3 prev=texture(uPrev,p+0.5).rgb;
  if(uMode<0.5){ vec3 h=rgb2hsv(prev); h.x=fract(h.x+uHue/360.); prev=hsv2rgb(h); }
  vec3 o=max(c.rgb, prev*uAmount);
  outColor=vec4(mix(c.rgb,o,uMix),1.0);
}`;

const MIX_FRAG = /* glsl */ `
${COMMON}
uniform sampler2D uWet;
void main(){ outColor = mix(src(vUv), texture(uWet, vUv), uMix); }`;

const COPY_FRAG = /* glsl */ `
in vec2 vUv; out vec4 outColor; uniform sampler2D uTex; uniform float uFlip;
void main(){ outColor = samp(uTex, uFlip, vUv); }`;

export type ParamLookup = (id: string) => number | undefined;

/**
 * Runs an effect chain on the GPU. Every pass reads a texture and writes a pooled render
 * target; nothing goes back to the CPU.
 */
export class EffectEngine {
  private single = new Map<EffectKind, FullscreenPass>();
  private blurPass: FullscreenPass;
  private threshPass: FullscreenPass;
  private addPass: FullscreenPass;
  private feedbackPass: FullscreenPass;
  private mixPass: FullscreenPass;
  readonly copyPass: FullscreenPass;
  readonly targets = new TargetCache();
  /** ms spent in effects in the last frame (CPU-side submission time). */
  lastMs = 0;

  constructor(private r: THREE.WebGLRenderer) {
    const base = () => ({ uTex: { value: null }, uFlip: { value: 0 }, uRes: { value: new THREE.Vector2() }, uTime: { value: 0 }, uMix: { value: 1 } });
    this.blurPass = new FullscreenPass(rawMaterial(BLUR_FRAG, { ...base(), uDir: { value: new THREE.Vector2(1, 0) }, uRadius: { value: 4 } }));
    this.threshPass = new FullscreenPass(rawMaterial(THRESH_FRAG, { ...base(), uThreshold: { value: 0.5 } }));
    this.addPass = new FullscreenPass(rawMaterial(ADD_FRAG, { ...base(), uGlow: { value: null }, uIntensity: { value: 1 } }));
    this.feedbackPass = new FullscreenPass(rawMaterial(FEEDBACK_FRAG, { ...base(), uPrev: { value: null }, uAmount: { value: 0.9 }, uZoom: { value: 1 }, uRot: { value: 0 }, uHue: { value: 0 }, uMode: { value: 0 } }));
    this.mixPass = new FullscreenPass(rawMaterial(MIX_FRAG, { ...base(), uWet: { value: null } }));
    this.copyPass = new FullscreenPass(rawMaterial(COPY_FRAG, { uTex: { value: null }, uFlip: { value: 0 } }));
  }

  private singlePass(kind: EffectKind): FullscreenPass {
    let p = this.single.get(kind);
    if (!p) {
      const def = EFFECTS[kind];
      const uniforms: Record<string, THREE.IUniform> = { uTex: { value: null }, uFlip: { value: 0 }, uRes: { value: new THREE.Vector2() }, uTime: { value: 0 }, uMix: { value: 1 } };
      const decl = def.params.filter((x) => x.name !== 'mix').map((x) => `uniform float uP_${x.name};`).join('\n');
      for (const x of def.params) if (x.name !== 'mix') uniforms[`uP_${x.name}`] = { value: x.default };
      p = new FullscreenPass(rawMaterial(`${COMMON}\n${decl}\n${SINGLE[kind]}\n${MIX_MAIN}`, uniforms));
      this.single.set(kind, p);
    }
    return p;
  }

  copy(input: TexRef, target: THREE.WebGLRenderTarget) {
    const u = this.copyPass.material.uniforms;
    u.uTex.value = input.tex;
    u.uFlip.value = input.flip ? 1 : 0;
    this.copyPass.render(this.r, target);
  }

  /**
   * @param ownerKey stable key of the chain owner (layer / surface / composition id)
   * @param maxW/maxH cap of the working resolution (never more than the consumer needs)
   */
  apply(ownerKey: string, input: TexRef, effects: EffectInstance[], param: ParamLookup, time: number, maxW: number, maxH: number): TexRef {
    const active = effects.filter((fx) => (param(effectParamId(fx.id, 'enabled')) ?? (fx.enabled ? 1 : 0)) >= 0.5);
    if (active.length === 0) return input;
    const t0 = performance.now();
    const w = Math.max(1, Math.round(Math.min(maxW, input.width > 1 ? input.width : maxW)));
    const h = Math.max(1, Math.round(Math.min(maxH, input.height > 1 ? input.height : maxH)));
    let cur = input;
    let ping = 0;
    const next = () => this.targets.get(`${ownerKey}:pp${ping++ % 2}`, w, h);
    for (const fx of active) {
      const val = (name: string) => param(effectParamId(fx.id, name)) ?? fx.params[name] ?? EFFECTS[fx.kind].params.find((p) => p.name === name)?.default ?? 0;
      const mix = val('mix');
      if (mix <= 0) continue;
      switch (fx.kind) {
        case 'blur': {
          cur = this.blur(`${ownerKey}:${fx.id}`, cur, val('radius'), w, h, mix);
          break;
        }
        case 'glow':
        case 'bloom': {
          const half = fx.kind === 'bloom' ? 4 : 2;
          const bw = Math.max(1, Math.round(w / half));
          const bh = Math.max(1, Math.round(h / half));
          const th = this.targets.get(`${ownerKey}:${fx.id}:th`, bw, bh);
          this.setBase(this.threshPass, cur, w, h, time, 1);
          this.threshPass.material.uniforms.uThreshold.value = val('threshold');
          this.threshPass.render(this.r, th);
          const blurred = this.blur(`${ownerKey}:${fx.id}:b`, rtRef(th), val('radius') / half, bw, bh, 1);
          const out = next();
          this.setBase(this.addPass, cur, w, h, time, mix);
          this.addPass.material.uniforms.uGlow.value = blurred.tex;
          this.addPass.material.uniforms.uIntensity.value = val('intensity');
          this.addPass.render(this.r, out);
          cur = rtRef(out);
          break;
        }
        case 'feedback':
        case 'trails': {
          const stateKey = `${ownerKey}:${fx.id}:state`;
          const fresh = !this.targets.has(stateKey);
          const state = this.targets.get(stateKey, w, h);
          if (fresh) {
            this.r.setRenderTarget(state);
            this.r.setClearColor(0, 1);
            this.r.clear(true, false, false);
          }
          const out = next();
          this.setBase(this.feedbackPass, cur, w, h, time, mix);
          const u = this.feedbackPass.material.uniforms;
          u.uPrev.value = state.texture;
          if (fx.kind === 'feedback') {
            u.uAmount.value = val('amount');
            u.uZoom.value = val('zoom');
            u.uRot.value = val('rotation');
            u.uHue.value = val('hueShift');
            u.uMode.value = 0;
          } else {
            u.uAmount.value = val('decay');
            u.uZoom.value = 1;
            u.uRot.value = 0;
            u.uHue.value = 0;
            u.uMode.value = 1;
          }
          this.feedbackPass.render(this.r, out);
          this.copy(rtRef(out), state);
          cur = rtRef(out);
          break;
        }
        default: {
          const pass = this.singlePass(fx.kind);
          this.setBase(pass, cur, w, h, time, mix);
          for (const pd of EFFECTS[fx.kind].params) if (pd.name !== 'mix') pass.material.uniforms[`uP_${pd.name}`].value = val(pd.name);
          const out = next();
          pass.render(this.r, out);
          cur = rtRef(out);
        }
      }
    }
    this.lastMs += performance.now() - t0;
    return cur;
  }

  private setBase(p: FullscreenPass, input: TexRef, w: number, h: number, time: number, mix: number) {
    const u = p.material.uniforms;
    u.uTex.value = input.tex;
    u.uFlip.value = input.flip ? 1 : 0;
    u.uRes.value.set(w, h);
    u.uTime.value = time;
    u.uMix.value = mix;
  }

  blur(key: string, input: TexRef, radius: number, w: number, h: number, mix: number): TexRef {
    if (radius < 0.5) return input;
    const a = this.targets.get(`${key}:bh`, w, h);
    const b = this.targets.get(`${key}:bv`, w, h);
    const u = this.blurPass.material.uniforms;
    this.setBase(this.blurPass, input, w, h, 0, 1);
    u.uDir.value.set(1, 0);
    u.uRadius.value = radius;
    this.blurPass.render(this.r, a);
    this.setBase(this.blurPass, rtRef(a), w, h, 0, 1);
    u.uDir.value.set(0, 1);
    this.blurPass.render(this.r, b);
    if (mix >= 1) return rtRef(b);
    const out = this.targets.get(`${key}:bm`, w, h);
    this.setBase(this.mixPass, input, w, h, 0, mix);
    this.mixPass.material.uniforms.uWet.value = b.texture;
    this.mixPass.render(this.r, out);
    return rtRef(out);
  }

  endFrame() {
    this.targets.frame++;
    if (this.targets.frame % 300 === 0) this.targets.gc(300);
  }
}
