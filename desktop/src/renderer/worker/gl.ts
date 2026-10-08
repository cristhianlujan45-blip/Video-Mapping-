import * as THREE from 'three';

/**
 * A texture plus its row order. Uploaded images/video frames are top-down (row 0 = top
 * of the picture); our own 2D passes also write top-down; three.js 3D renders write
 * bottom-up. Every shader that samples a TexRef gets `flip` so orientation is always right.
 */
export interface TexRef {
  tex: THREE.Texture;
  flip: boolean;
  width: number;
  height: number;
}

export const GLSL_HEADER = /* glsl */ `
precision highp float;
precision highp int;
`;

/** Vertex shader for passes over a [0,1]² quad. uFlipOut=1 → write top-down into a render target. */
export const PASS_VERT = /* glsl */ `
${GLSL_HEADER}
in vec2 position;
out vec2 vUv;
uniform float uFlipOut;
void main() {
  vUv = position;
  float y = uFlipOut > 0.5 ? position.y * 2.0 - 1.0 : 1.0 - position.y * 2.0;
  gl_Position = vec4(position.x * 2.0 - 1.0, y, 0.0, 1.0);
}
`;

export const SAMPLE_FN = /* glsl */ `
vec4 samp(sampler2D t, float flip, vec2 uv) {
  return texture(t, flip > 0.5 ? vec2(uv.x, 1.0 - uv.y) : uv);
}
`;

const quadGeom = (() => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]), 2));
  return g;
})();

export const dummyCamera = new THREE.Camera();

/** Runs a RawShaderMaterial over the whole target. */
export class FullscreenPass {
  readonly scene = new THREE.Scene();
  readonly mesh: THREE.Mesh;

  constructor(public material: THREE.RawShaderMaterial) {
    this.mesh = new THREE.Mesh(quadGeom, material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  render(r: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget | null, viewport?: { x: number; y: number; w: number; h: number }) {
    const u = this.material.uniforms.uFlipOut;
    if (u) u.value = target ? 1 : 0;
    if (target) {
      // three.js reads target.viewport when the target is bound, so set it first.
      if (viewport) target.viewport.set(viewport.x, viewport.y, viewport.w, viewport.h);
      else target.viewport.set(0, 0, target.width, target.height);
      r.setRenderTarget(target);
    } else {
      r.setRenderTarget(null);
      if (viewport) r.setViewport(viewport.x, viewport.y, viewport.w, viewport.h);
    }
    r.render(this.scene, dummyCamera);
  }
}

export function rawMaterial(frag: string, uniforms: Record<string, THREE.IUniform>, opts: Partial<THREE.ShaderMaterialParameters> = {}): THREE.RawShaderMaterial {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: PASS_VERT,
    fragmentShader: `${GLSL_HEADER}\n${SAMPLE_FN}\n${frag}`,
    uniforms: { uFlipOut: { value: 1 }, ...uniforms },
    depthTest: false,
    depthWrite: false,
    transparent: false,
    blending: THREE.NoBlending,
    ...opts,
  });
}

export function makeTarget(w: number, h: number, opts: { depth?: boolean; float?: boolean; samples?: number } = {}): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)), {
    depthBuffer: !!opts.depth,
    stencilBuffer: false,
    type: opts.float ? THREE.HalfFloatType : THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    samples: opts.samples ?? 0,
  });
  rt.texture.colorSpace = THREE.NoColorSpace;
  return rt;
}

/**
 * Keyed render targets that are reused frame after frame and resized only when the
 * requested size changes; unused keys are released after a few frames.
 */
export class TargetCache {
  private map = new Map<string, { rt: THREE.WebGLRenderTarget; lastUsed: number }>();
  frame = 0;

  get(key: string, w: number, h: number, opts: { depth?: boolean; float?: boolean; samples?: number } = {}): THREE.WebGLRenderTarget {
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    let e = this.map.get(key);
    if (e && (e.rt.width !== w || e.rt.height !== h)) {
      e.rt.setSize(w, h);
    }
    if (!e) {
      e = { rt: makeTarget(w, h, opts), lastUsed: this.frame };
      this.map.set(key, e);
    }
    e.lastUsed = this.frame;
    return e.rt;
  }

  has(key: string) {
    return this.map.has(key);
  }

  peek(key: string) {
    return this.map.get(key)?.rt;
  }

  /** Disposes targets unused for `maxAge` frames (GPU memory is released immediately). */
  gc(maxAge = 120) {
    for (const [k, e] of this.map) {
      if (this.frame - e.lastUsed > maxAge) {
        e.rt.dispose();
        this.map.delete(k);
      }
    }
  }

  dispose(key?: string) {
    if (key) {
      this.map.get(key)?.rt.dispose();
      this.map.delete(key);
      return;
    }
    for (const e of this.map.values()) e.rt.dispose();
    this.map.clear();
  }

  bytes(): number {
    let b = 0;
    for (const e of this.map.values()) b += e.rt.width * e.rt.height * (e.rt.texture.type === THREE.HalfFloatType ? 8 : 4);
    return b;
  }
}

export function rtRef(rt: THREE.WebGLRenderTarget, flip = false): TexRef {
  return { tex: rt.texture, flip, width: rt.width, height: rt.height };
}

/** Parses #rrggbb to linear 0..1 RGB (no color management: what you pick is what is output). */
export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!m) return [1, 1, 1];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export const BLEND_INDEX: Record<string, number> = {
  normal: 0,
  add: 1,
  screen: 2,
  multiply: 3,
  overlay: 4,
  difference: 5,
  lighten: 6,
  darken: 7,
  subtract: 8,
  exclusion: 9,
};

/** GLSL blend of a premultiplied-free src over backdrop with mode index. */
export const BLEND_FN = /* glsl */ `
vec3 blendMode(int m, vec3 b, vec3 s) {
  if (m == 1) return b + s;
  if (m == 2) return 1.0 - (1.0 - b) * (1.0 - s);
  if (m == 3) return b * s;
  if (m == 4) return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, b));
  if (m == 5) return abs(b - s);
  if (m == 6) return max(b, s);
  if (m == 7) return min(b, s);
  if (m == 8) return max(b - s, 0.0);
  if (m == 9) return b + s - 2.0 * b * s;
  return s;
}
`;
