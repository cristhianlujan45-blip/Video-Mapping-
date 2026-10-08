import * as THREE from 'three';
import type { Output, Surface } from '../../shared/project/model';
import { invert3, squareToQuad, toGlMat3, type Quad } from '../../shared/geometry/homography';
import { tessellate, type MeshWarp } from '../../shared/geometry/warp';
import { BLEND_INDEX, dummyCamera, FullscreenPass, GLSL_HEADER, rawMaterial, rtRef, SAMPLE_FN, TargetCache, type TexRef } from './gl';
import type { EffectEngine, ParamLookup } from './effects';
import type { MaskCache } from './masks';
import type { CalibrationPattern } from './protocol';

const SURF_VERT = /* glsl */ `
${GLSL_HEADER}
in vec2 position; in vec2 uv;
out vec2 vPos; out vec2 vUv;
uniform float uFlipOut;
void main(){
  vPos = position; vUv = uv;
  float y = uFlipOut > 0.5 ? position.y*2.0-1.0 : 1.0-position.y*2.0;
  gl_Position = vec4(position.x*2.0-1.0, y, 0.0, 1.0);
}`;

const SURF_FRAG = /* glsl */ `
${GLSL_HEADER}
${SAMPLE_FN}
in vec2 vPos; in vec2 vUv; out vec4 outColor;
uniform sampler2D uTex; uniform float uFlip; uniform sampler2D uMask;
uniform mat3 uHinv; uniform float uUseH; uniform vec4 uRegion;
uniform vec4 uSoft; uniform float uSoftGamma; uniform float uOpacity;
uniform vec3 uGain; uniform vec3 uBCG; // brightness, contrast, gamma
uniform vec2 uTargetSize;
void main(){
  vec2 uv;
  float aa = 1.0;
  if (uUseH > 0.5) {
    vec3 q = uHinv * vec3(vPos, 1.0);
    uv = q.xy / q.z;
    // analytic antialiasing of the quad border, in output pixels
    vec2 fw = max(fwidth(uv), vec2(1e-6));
    vec2 d = min(uv, 1.0 - uv) / fw;
    aa = clamp(min(d.x, d.y) + 0.5, 0.0, 1.0);
    if (q.z <= 0.0) discard;
  } else {
    uv = vUv;
  }
  if (aa <= 0.0) discard;
  vec2 suv = uRegion.xy + clamp(uv, 0.0, 1.0) * uRegion.zw;
  vec4 c = samp(uTex, uFlip, suv);
  // soft edge (edge blending): ramp from the border inwards, gamma corrected
  float s = 1.0;
  if (uSoft.x > 0.0) s *= clamp(uv.x / uSoft.x, 0.0, 1.0);
  if (uSoft.y > 0.0) s *= clamp((1.0 - uv.x) / uSoft.y, 0.0, 1.0);
  if (uSoft.z > 0.0) s *= clamp(uv.y / uSoft.z, 0.0, 1.0);
  if (uSoft.w > 0.0) s *= clamp((1.0 - uv.y) / uSoft.w, 0.0, 1.0);
  s = pow(s, 1.0 / max(uSoftGamma, 0.01));
  vec3 col = c.rgb + uBCG.x;
  col = (col - 0.5) * uBCG.y + 0.5;
  col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / max(uBCG.z, 0.01))) * uGain;
  float a = c.a * uOpacity * texture(uMask, uv).a * aa * s;
  outColor = vec4(col * a, a);
}`;

const FINAL_FRAG = /* glsl */ `
in vec2 vUv; out vec4 outColor;
uniform sampler2D uTex; uniform float uFlip; uniform sampler2D uMask; uniform sampler2D uOverlay; uniform float uOverlayOn;
uniform vec4 uSoft; uniform float uSoftGamma; uniform vec3 uBCG; uniform vec3 uGain; uniform float uMaster;
uniform int uCal; uniform int uCalBit; uniform int uCalAxis; uniform int uCalInv; uniform vec2 uRes;
void main(){
  vec2 uv = vUv;
  if (uCal > 0) {
    vec2 px = floor(uv * uRes);
    float v;
    if (uCal == 1) { int n = int(uCalAxis == 0 ? px.x : px.y); int g = n ^ (n >> 1); v = float((g >> uCalBit) & 1); }
    else if (uCal == 2) v = 1.0;
    else if (uCal == 3) v = 0.0;
    else { vec2 cell = uRes / float(uCalBit); vec2 f = mod(px, cell) - cell*0.5; v = step(length(f), min(cell.x, cell.y)*0.08); }
    if (uCalInv > 0) v = 1.0 - v;
    outColor = vec4(vec3(v), 1.0);
    return;
  }
  vec4 c = samp(uTex, uFlip, uv);
  vec3 col = c.rgb + uBCG.x;
  col = (col - 0.5) * uBCG.y + 0.5;
  col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / max(uBCG.z, 0.01))) * uGain;
  float s = 1.0;
  if (uSoft.x > 0.0) s *= clamp(uv.x / uSoft.x, 0.0, 1.0);
  if (uSoft.y > 0.0) s *= clamp((1.0 - uv.x) / uSoft.y, 0.0, 1.0);
  if (uSoft.z > 0.0) s *= clamp(uv.y / uSoft.z, 0.0, 1.0);
  if (uSoft.w > 0.0) s *= clamp((1.0 - uv.y) / uSoft.w, 0.0, 1.0);
  s = pow(s, 1.0 / max(uSoftGamma, 0.01));
  col *= s * texture(uMask, uv).a * uMaster;
  if (uOverlayOn > 0.5) { vec4 o = texture(uOverlay, uv); col = mix(col, o.rgb, o.a * 0.85); }
  outColor = vec4(col, 1.0);
}`;

/** Draws a texture into a mesh-warped grid (final keystone/mesh correction). */
const WARP_FRAG = /* glsl */ `
${GLSL_HEADER}
${SAMPLE_FN}
in vec2 vPos; in vec2 vUv; out vec4 outColor;
uniform sampler2D uTex; uniform float uFlip;
void main(){ outColor = vec4(samp(uTex, uFlip, vUv).rgb, 1.0); }`;

interface GeomCache {
  key: string;
  geom: THREE.BufferGeometry;
}

export interface OutputContext {
  param: ParamLookup;
  time: number;
  master: number;
  blackout: boolean;
  resolveSurfaceSource: (s: Surface, w: number, h: number) => TexRef | null;
  render3d: (o: Output, rt: THREE.WebGLRenderTarget) => boolean;
  overlay: (o: Output, index: number) => TexRef | null;
  calibration: (o: Output) => CalibrationPattern | null;
}

export class OutputRenderer {
  private surfScene = new THREE.Scene();
  private surfMesh: THREE.Mesh;
  private surfMat: THREE.RawShaderMaterial;
  private warpMat: THREE.RawShaderMaterial;
  private geoms = new Map<string, GeomCache>();
  private finalPass: FullscreenPass;
  readonly targets = new TargetCache();
  private hinv = new Float32Array(9);
  private black = (() => {
    const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    t.needsUpdate = true;
    return t;
  })();

  constructor(
    private r: THREE.WebGLRenderer,
    private effects: EffectEngine,
    private masks: MaskCache,
  ) {
    this.surfMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: SURF_VERT,
      fragmentShader: SURF_FRAG,
      uniforms: {
        uFlipOut: { value: 1 },
        uTex: { value: null },
        uFlip: { value: 0 },
        uMask: { value: null },
        uHinv: { value: new THREE.Matrix3() },
        uUseH: { value: 1 },
        uRegion: { value: new THREE.Vector4(0, 0, 1, 1) },
        uSoft: { value: new THREE.Vector4() },
        uSoftGamma: { value: 2.2 },
        uOpacity: { value: 1 },
        uGain: { value: new THREE.Vector3(1, 1, 1) },
        uBCG: { value: new THREE.Vector3(0, 1, 1) },
        uTargetSize: { value: new THREE.Vector2() },
      },
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.surfMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.surfMat);
    this.surfMesh.frustumCulled = false;
    this.surfScene.add(this.surfMesh);
    this.warpMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: SURF_VERT,
      fragmentShader: WARP_FRAG,
      uniforms: { uFlipOut: { value: 1 }, uTex: { value: null }, uFlip: { value: 0 } },
      depthTest: false,
      depthWrite: false,
    });
    this.finalPass = new FullscreenPass(
      rawMaterial(FINAL_FRAG, {
        uTex: { value: null },
        uFlip: { value: 0 },
        uMask: { value: null },
        uOverlay: { value: null },
        uOverlayOn: { value: 0 },
        uSoft: { value: new THREE.Vector4() },
        uSoftGamma: { value: 2.2 },
        uBCG: { value: new THREE.Vector3(0, 1, 1) },
        uGain: { value: new THREE.Vector3(1, 1, 1) },
        uMaster: { value: 1 },
        uCal: { value: 0 },
        uCalBit: { value: 0 },
        uCalAxis: { value: 0 },
        uCalInv: { value: 0 },
        uRes: { value: new THREE.Vector2() },
      }),
    );
  }

  private geometryFor(key: string, contentKey: string, build: () => THREE.BufferGeometry): THREE.BufferGeometry {
    const g = this.geoms.get(key);
    if (g && g.key === contentKey) return g.geom;
    g?.geom.dispose();
    const geom = build();
    this.geoms.set(key, { key: contentKey, geom });
    return geom;
  }

  private quadGeometry(id: string, pts: { x: number; y: number }[]) {
    return this.geometryFor(`s:${id}`, JSON.stringify(pts), () => {
      const g = new THREE.BufferGeometry();
      const flat = new Float32Array(pts.length * 2);
      pts.forEach((p, i) => {
        flat[i * 2] = p.x;
        flat[i * 2 + 1] = p.y;
      });
      g.setAttribute('position', new THREE.BufferAttribute(flat, 2));
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(pts.length * 2), 2));
      const tri = THREE.ShapeUtils.triangulateShape(
        pts.map((p) => new THREE.Vector2(p.x, p.y)),
        [],
      );
      g.setIndex(tri.flat());
      return g;
    });
  }

  private meshGeometry(id: string, mesh: MeshWarp) {
    return this.geometryFor(`m:${id}`, JSON.stringify(mesh), () => {
      const t = tessellate(mesh, mesh.interpolation === 'bezier' ? 12 : mesh.interpolation === 'perspective' ? 10 : 6);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(t.positions, 2));
      g.setAttribute('uv', new THREE.BufferAttribute(t.uvs, 2));
      g.setIndex(new THREE.BufferAttribute(t.indices, 1));
      return g;
    });
  }

  /** Renders the output content (before final correction). */
  private renderContent(o: Output, ctx: OutputContext): { rt: THREE.WebGLRenderTarget; flip: boolean } {
    const rt = this.targets.get(`content:${o.id}`, o.width, o.height, { depth: o.mode === '3d' });
    // three.js 3D renders are bottom-up.
    if (o.mode === '3d' && ctx.render3d(o, rt)) return { rt, flip: true };
    this.r.setRenderTarget(rt);
    this.r.setClearColor(0x000000, 1);
    this.r.clear(true, true, false);
    for (const s of o.surfaces) {
      const visible = (ctx.param(`surface.${s.id}.visible`) ?? (s.visible ? 1 : 0)) >= 0.5;
      if (!visible) continue;
      const opacity = ctx.param(`surface.${s.id}.opacity`) ?? s.opacity;
      if (opacity <= 0.001) continue;
      const srcW = Math.round(o.width);
      const srcH = Math.round(o.height);
      let src = ctx.resolveSurfaceSource(s, srcW, srcH);
      if (!src) continue;
      if (s.effects.length) src = this.effects.apply(`s:${s.id}`, src, s.effects, ctx.param, ctx.time, Math.min(src.width, o.width), Math.min(src.height, o.height));
      this.drawSurface(rt, s, src, opacity);
    }
    return { rt, flip: false };
  }

  private drawSurface(rt: THREE.WebGLRenderTarget, s: Surface, src: TexRef, opacity: number) {
    const u = this.surfMat.uniforms;
    let geom: THREE.BufferGeometry;
    const quad: Quad = s.quad;
    if (s.kind === 'mesh' && s.mesh) {
      geom = this.meshGeometry(s.id, s.mesh);
      u.uUseH.value = 0;
    } else {
      const h = squareToQuad(quad);
      const inv = h ? invert3(h) : null;
      if (!inv) return; // degenerate quad: nothing sensible to draw
      toGlMat3(inv, this.hinv);
      (u.uHinv.value as THREE.Matrix3).fromArray(this.hinv);
      u.uUseH.value = 1;
      geom = this.quadGeometry(s.id, s.kind === 'polygon' && s.polygon && s.polygon.length >= 3 ? s.polygon : quad);
    }
    this.surfMesh.geometry = geom;
    u.uTex.value = src.tex;
    u.uFlip.value = src.flip ? 1 : 0;
    const aspect = (rt.width / rt.height) * (Math.hypot(quad[1].x - quad[0].x, quad[1].y - quad[0].y) / Math.max(1e-6, Math.hypot(quad[3].x - quad[0].x, quad[3].y - quad[0].y)));
    u.uMask.value = this.masks.get(`surface:${s.id}`, s.masks, aspect);
    u.uRegion.value.set(s.region.x, s.region.y, s.region.w, s.region.h);
    u.uSoft.value.set(s.softEdge.left, s.softEdge.right, s.softEdge.top, s.softEdge.bottom);
    u.uSoftGamma.value = s.softEdge.gamma;
    u.uOpacity.value = opacity;
    u.uGain.value.set(s.color.red, s.color.green, s.color.blue);
    u.uBCG.value.set(s.color.brightness, s.color.contrast, s.color.gamma);
    u.uTargetSize.value.set(rt.width, rt.height);
    const blend = BLEND_INDEX[s.blend] ?? 0;
    this.surfMat.blendSrc = THREE.OneFactor;
    this.surfMat.blendDst = blend === 1 ? THREE.OneFactor : blend === 2 ? THREE.OneMinusSrcColorFactor : THREE.OneMinusSrcAlphaFactor;
    if (blend === 3) {
      this.surfMat.blendSrc = THREE.DstColorFactor;
      this.surfMat.blendDst = THREE.OneMinusSrcAlphaFactor;
    }
    rt.viewport.set(0, 0, rt.width, rt.height);
    this.r.setRenderTarget(rt);
    this.r.render(this.surfScene, dummyCamera);
  }

  /** Full output: content → final warp → masks/soft edge/color → master/blackout. Returns the final texture. */
  render(o: Output, index: number, ctx: OutputContext): TexRef {
    const finalRt = this.targets.get(`final:${o.id}`, o.width, o.height);
    const cal = ctx.calibration(o);
    let content: TexRef;
    if (cal) {
      // Calibration patterns are generated in the final shader; never sample the target itself.
      content = { tex: this.black, flip: false, width: 1, height: 1 };
    } else {
      const { rt, flip } = this.renderContent(o, ctx);
      content = rtRef(rt, flip);
      if (o.finalWarp) {
        const warped = this.targets.get(`warp:${o.id}`, o.width, o.height);
        this.r.setRenderTarget(warped);
        this.r.setClearColor(0, 1);
        this.r.clear(true, false, false);
        this.surfMesh.geometry = this.meshGeometry(`final:${o.id}`, o.finalWarp);
        this.surfMesh.material = this.warpMat;
        this.warpMat.uniforms.uTex.value = content.tex;
        this.warpMat.uniforms.uFlip.value = content.flip ? 1 : 0;
        warped.viewport.set(0, 0, o.width, o.height);
        this.r.setRenderTarget(warped);
        this.r.render(this.surfScene, dummyCamera);
        this.surfMesh.material = this.surfMat;
        content = rtRef(warped);
      }
    }
    const u = this.finalPass.material.uniforms;
    u.uTex.value = content.tex;
    u.uFlip.value = content.flip ? 1 : 0;
    u.uMask.value = this.masks.get(`output:${o.id}`, o.masks, o.width / o.height);
    u.uSoft.value.set(o.softEdge.left, o.softEdge.right, o.softEdge.top, o.softEdge.bottom);
    u.uSoftGamma.value = o.softEdge.gamma;
    const bright = ctx.param(`output.${o.id}.brightness`) ?? o.color.brightness;
    const contrast = ctx.param(`output.${o.id}.contrast`) ?? o.color.contrast;
    const gamma = ctx.param(`output.${o.id}.gamma`) ?? o.color.gamma;
    u.uBCG.value.set(bright, contrast, gamma);
    u.uGain.value.set(o.color.red, o.color.green, o.color.blue);
    u.uMaster.value = ctx.blackout ? 0 : ctx.master;
    const ov = ctx.overlay(o, index);
    u.uOverlay.value = ov?.tex ?? null;
    u.uOverlayOn.value = ov ? 1 : 0;
    u.uRes.value.set(o.width, o.height);
    if (cal) {
      u.uCal.value = cal.kind === 'gray' ? 1 : cal.kind === 'white' ? 2 : cal.kind === 'black' ? 3 : 4;
      u.uCalBit.value = cal.kind === 'gray' ? cal.bit : cal.kind === 'dots' ? cal.count : 0;
      u.uCalAxis.value = cal.kind === 'gray' && cal.axis === 'y' ? 1 : 0;
      u.uCalInv.value = cal.kind === 'gray' && cal.inverted ? 1 : 0;
    } else u.uCal.value = 0;
    this.finalPass.render(this.r, finalRt);
    return rtRef(finalRt);
  }

  last(o: Output): TexRef | null {
    const rt = this.targets.peek(`final:${o.id}`);
    return rt ? rtRef(rt) : null;
  }

  endFrame() {
    this.targets.frame++;
    if (this.targets.frame % 300 === 0) this.targets.gc(600);
  }
}
