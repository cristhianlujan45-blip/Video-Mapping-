import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { TDSLoader } from 'three/examples/jsm/loaders/TDSLoader.js';
import type { FaceContent, Object3D as ObjDef, Output, Projector, SourceRef, Stage3D } from '../../shared/project/model';
import { FACE_NAMES } from '../../shared/project/faces';
import { hexToRgb, SAMPLE_FN, type TexRef } from './gl';
import type { ParamLookup } from './effects';
import type { FromRender, PointerMsg, ViewMode3D } from './protocol';

const FACE_VERT = /* glsl */ `
out vec2 vUv; out vec3 vWorld; out vec3 vNormal;
void main(){
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FACE_FRAG = /* glsl */ `
${SAMPLE_FN}
in vec2 vUv; in vec3 vWorld; in vec3 vNormal;
out vec4 outColor;
uniform sampler2D uTex; uniform float uFlip; uniform float uHasTex;
uniform float uOpacity; uniform vec3 uTint; uniform int uMode; uniform mat4 uProjVP; uniform vec3 uProjPos;
uniform float uShade;
void main(){
  vec2 uv;
  float vis = 1.0;
  if (uMode == 1) {
    vec4 p = uProjVP * vec4(vWorld, 1.0);
    if (p.w <= 0.0) vis = 0.0;
    vec2 ndc = p.xy / p.w;
    uv = vec2(ndc.x * 0.5 + 0.5, 1.0 - (ndc.y * 0.5 + 0.5));
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) vis = 0.0;
    // surfaces facing away from the projector receive no light
    if (dot(normalize(uProjPos - vWorld), normalize(vNormal)) <= 0.0) vis = 0.0;
  } else {
    uv = vec2(vUv.x, 1.0 - vUv.y);
  }
  vec3 c = uHasTex > 0.5 ? samp(uTex, uFlip, clamp(uv, 0.0, 1.0)).rgb : vec3(1.0);
  c *= uTint * vis;
  if (uShade > 0.5) { float l = 0.35 + 0.65 * max(dot(normalize(vNormal), normalize(vec3(0.4, 0.9, 0.6))), 0.0); c = mix(c, c * l, 0.6); }
  outColor = vec4(c, uOpacity);
}`;

interface Built {
  key: string;
  root: THREE.Object3D;
  /** face name → materials using it */
  faces: Map<string, THREE.ShaderMaterial[]>;
  meshes: THREE.Mesh[];
}

interface ViewState {
  yaw: number;
  pitch: number;
  distance: number;
  panX: number;
  panY: number;
  panZ: number;
  fov: number;
  ortho: boolean;
  fromProjector: string | null;
}

interface Modal {
  kind: 'G' | 'R' | 'S';
  objectId: string;
  isProjector: boolean;
  axis: 'X' | 'Y' | 'Z' | null;
  startX: number;
  startY: number;
  startPos: THREE.Vector3;
  startRot: THREE.Euler;
  startScale: THREE.Vector3;
  viewId: string;
}

function geometryFor(kind: ObjDef['kind']): THREE.BufferGeometry {
  switch (kind) {
    case 'cube':
      return new THREE.BoxGeometry(1, 1, 1);
    case 'plane':
      return new THREE.PlaneGeometry(1.6, 0.9);
    case 'sphere':
      return new THREE.SphereGeometry(0.5, 64, 32);
    case 'cylinder':
      return new THREE.CylinderGeometry(0.5, 0.5, 1, 64);
    case 'cone':
      return new THREE.ConeGeometry(0.5, 1, 64);
    case 'pyramid': {
      const g = new THREE.ConeGeometry(0.6, 1, 4);
      g.rotateY(Math.PI / 4);
      return g;
    }
    case 'prism':
      return new THREE.CylinderGeometry(0.6, 0.6, 1, 3);
    default:
      return new THREE.BoxGeometry(1, 1, 1);
  }
}

const DEG = Math.PI / 180;

/**
 * The real 3D stage: objects with per-face content, imported models, projector cameras
 * (with frustums) and the editor viewport. Outputs in 3D mode are rendered from their
 * projector camera, so what goes to the physical projector is exactly what that virtual
 * projector sees.
 */
export class Stage {
  readonly scene = new THREE.Scene();
  private helpers = new THREE.Group();
  private grid: THREE.GridHelper | null = null;
  private gridKey = '';
  private axes = new THREE.AxesHelper(1);
  private built = new Map<string, Built>();
  private projCams = new Map<string, { cam: THREE.PerspectiveCamera; helper: THREE.CameraHelper; body: THREE.Mesh; key: string }>();
  private models = new Map<string, { group: THREE.Object3D | null; error?: string; loading: boolean }>();
  private wireMat = new THREE.MeshBasicMaterial({ color: 0x66ccff, wireframe: true, transparent: true, opacity: 0.6, depthTest: true });
  private solidMat = new THREE.MeshLambertMaterial({ color: 0x9aa4b0 });
  private selection: THREE.BoxHelper | null = null;
  private selectedId: string | null = null;
  private viewCamPersp = new THREE.PerspectiveCamera(45, 1, 0.05, 500);
  private viewCamOrtho = new THREE.OrthographicCamera(-5, 5, 5, -5, -500, 500);
  private raycaster = new THREE.Raycaster();
  private views = new Map<string, ViewState>();
  private drag: { viewId: string; mode: 'orbit' | 'pan'; x: number; y: number } | null = null;
  private modal: Modal | null = null;
  private stage: Stage3D | null = null;
  private lastParams = new Map<string, number>();
  private mouse = new Map<string, { x: number; y: number; w: number; h: number }>();

  constructor(
    private r: THREE.WebGLRenderer,
    private emit: (m: FromRender) => void,
  ) {
    this.scene.background = new THREE.Color(0x000000);
    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2);
    const dir = new THREE.DirectionalLight(0xffffff, 1.4);
    dir.position.set(3, 6, 4);
    this.helpers.add(hemi, dir, this.axes);
    this.scene.add(this.helpers);
  }

  // ---------------------------------------------------------------- models

  loadModel(key: string, url: string, ext: string) {
    if (this.models.get(key)?.group || this.models.get(key)?.loading) return;
    this.models.set(key, { group: null, loading: true });
    const done = (obj: THREE.Object3D | null, error?: string) => {
      this.models.set(key, { group: obj, loading: false, error });
      const materials = new Set<string>();
      obj?.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        if (!m) return;
        for (const mm of Array.isArray(m) ? m : [m]) materials.add(mm.name || 'material');
      });
      this.emit({ type: 'modelInfo', key, materials: [...materials], error });
      // force rebuild of objects using this model
      for (const [id, b] of this.built) if (b.key.includes(key)) this.dispose(id);
    };
    const fail = (e: unknown) => done(null, (e as Error)?.message ?? String(e));
    const e = ext.toLowerCase();
    try {
      if (e === 'obj') new OBJLoader().load(url, (g) => done(g), undefined, fail);
      else if (e === 'gltf' || e === 'glb') new GLTFLoader().load(url, (g) => done(g.scene), undefined, fail);
      else if (e === 'fbx') new FBXLoader().load(url, (g) => done(g), undefined, fail);
      else if (e === 'stl') new STLLoader().load(url, (g) => done(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ name: 'stl' }))), undefined, fail);
      else if (e === 'ply') new PLYLoader().load(url, (g) => { g.computeVertexNormals(); done(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ name: 'ply' }))); }, undefined, fail);
      else if (e === '3ds') new TDSLoader().load(url, (g) => done(g), undefined, fail);
      else fail(new Error(`Formato .${ext} no soportado en el motor 3D (usa OBJ, FBX, glTF/GLB, STL, PLY o 3DS).`));
    } catch (err) {
      fail(err);
    }
  }

  // ---------------------------------------------------------------- sync

  private faceMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: FACE_VERT,
      fragmentShader: FACE_FRAG,
      uniforms: {
        uTex: { value: null },
        uFlip: { value: 0 },
        uHasTex: { value: 0 },
        uOpacity: { value: 1 },
        uTint: { value: new THREE.Vector3(1, 1, 1) },
        uMode: { value: 0 },
        uProjVP: { value: new THREE.Matrix4() },
        uProjPos: { value: new THREE.Vector3() },
        uShade: { value: 0 },
      },
      side: THREE.FrontSide,
    });
  }

  private dispose(id: string) {
    const b = this.built.get(id);
    if (!b) return;
    this.scene.remove(b.root);
    b.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        if (m.userData.ownGeometry) m.geometry.dispose();
        for (const mm of Array.isArray(m.material) ? m.material : [m.material]) mm.dispose();
      }
    });
    this.built.delete(id);
  }

  private build(def: ObjDef): Built | null {
    const faces = new Map<string, THREE.ShaderMaterial[]>();
    const meshes: THREE.Mesh[] = [];
    const add = (name: string, m: THREE.ShaderMaterial) => {
      if (!faces.has(name)) faces.set(name, []);
      faces.get(name)!.push(m);
    };
    let root: THREE.Object3D;
    if (def.kind === 'model') {
      const model = def.mediaId ? this.models.get(def.mediaId) : undefined;
      if (!model?.group) return null;
      root = model.group.clone(true);
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const orig = Array.isArray(m.material) ? m.material : [m.material];
        const mats = orig.map((om) => {
          const fm = this.faceMaterial();
          fm.name = om.name || 'material';
          add(fm.name, fm);
          return fm;
        });
        m.material = Array.isArray(m.material) ? mats : mats[0];
        if (!m.geometry.attributes.uv) {
          // no UVs: projective mapping still works; give a planar UV for UV mode
          const pos = m.geometry.attributes.position;
          m.geometry.computeBoundingBox();
          const bb = m.geometry.boundingBox!;
          const uv = new Float32Array(pos.count * 2);
          for (let i = 0; i < pos.count; i++) {
            uv[i * 2] = (pos.getX(i) - bb.min.x) / Math.max(1e-6, bb.max.x - bb.min.x);
            uv[i * 2 + 1] = (pos.getY(i) - bb.min.y) / Math.max(1e-6, bb.max.y - bb.min.y);
          }
          m.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        }
        if (!m.geometry.attributes.normal) m.geometry.computeVertexNormals();
        m.userData.objectId = def.id;
        meshes.push(m);
      });
    } else {
      const geom = geometryFor(def.kind);
      const names = FACE_NAMES[def.kind];
      const mats = names.map((n) => {
        const m = this.faceMaterial();
        m.name = n;
        add(n, m);
        return m;
      });
      const mesh = new THREE.Mesh(geom, names.length > 1 ? mats : mats[0]);
      mesh.userData.ownGeometry = true;
      mesh.userData.objectId = def.id;
      if (def.kind === 'plane') (mats[0] as THREE.ShaderMaterial).side = THREE.DoubleSide;
      meshes.push(mesh);
      root = mesh;
    }
    root.userData.objectId = def.id;
    return { key: `${def.kind}:${def.mediaId ?? ''}`, root, faces, meshes };
  }

  sync(stage: Stage3D, selectedId: string | null) {
    this.stage = stage;
    const ids = new Set(stage.objects.map((o) => o.id));
    for (const id of [...this.built.keys()]) if (!ids.has(id)) this.dispose(id);
    for (const def of stage.objects) {
      const key = `${def.kind}:${def.mediaId ?? ''}`;
      const b = this.built.get(def.id);
      if (b && b.key !== key) this.dispose(def.id);
      if (!this.built.has(def.id)) {
        const nb = this.build(def);
        if (nb) {
          this.built.set(def.id, nb);
          this.scene.add(nb.root);
        }
      }
    }
    // projectors
    const pids = new Set(stage.projectors.map((p) => p.id));
    for (const [id, p] of this.projCams) {
      if (!pids.has(id)) {
        this.helpers.remove(p.helper, p.body);
        p.helper.dispose();
        p.body.geometry.dispose();
        this.projCams.delete(id);
      }
    }
    for (const pj of stage.projectors) {
      let pc = this.projCams.get(pj.id);
      if (!pc) {
        const cam = new THREE.PerspectiveCamera(pj.fov, pj.width / pj.height, pj.near, pj.far);
        const helper = new THREE.CameraHelper(cam);
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.25), new THREE.MeshBasicMaterial({ color: new THREE.Color(pj.color) }));
        body.userData.projectorId = pj.id;
        pc = { cam, helper, body, key: '' };
        this.projCams.set(pj.id, pc);
        this.helpers.add(helper, body);
      }
      (pc.body.material as THREE.MeshBasicMaterial).color.set(pj.color);
    }
    // grid
    const gkey = `${stage.grid.size}:${stage.grid.divisions}`;
    if (gkey !== this.gridKey) {
      if (this.grid) {
        this.helpers.remove(this.grid);
        this.grid.dispose();
      }
      this.grid = new THREE.GridHelper(stage.grid.size, stage.grid.divisions, 0x556070, 0x2a3038);
      this.helpers.add(this.grid);
      this.gridKey = gkey;
    }
    if (this.grid) this.grid.visible = stage.grid.visible;
    this.selectedId = selectedId;
  }

  /** Applies transforms (params override project) and content textures. */
  update(param: ParamLookup, resolve: (ref: SourceRef, w: number, h: number) => TexRef | null, projectors: Projector[], outputs: Output[]) {
    const stage = this.stage;
    if (!stage) return;
    for (const def of stage.objects) {
      const b = this.built.get(def.id);
      if (!b) continue;
      const P = (k: string, fb: number) => param(`obj.${def.id}.${k}`) ?? fb;
      if (this.modal?.objectId !== def.id) {
        b.root.position.set(P('posX', def.position[0]), P('posY', def.position[1]), P('posZ', def.position[2]));
        b.root.rotation.set(P('rotX', def.rotation[0]) * DEG, P('rotY', def.rotation[1]) * DEG, P('rotZ', def.rotation[2]) * DEG);
        const s = P('scale', def.scale[0]) / (def.scale[0] || 1);
        b.root.scale.set(def.scale[0] * s, def.scale[1] * s, def.scale[2] * s);
      }
      b.root.visible = (param(`obj.${def.id}.visible`) ?? (def.visible ? 1 : 0)) >= 0.5;
      for (const [name, mats] of b.faces) {
        const fc: FaceContent | undefined = def.faces[name] ?? def.faces.all;
        for (const m of mats) this.applyFace(m, fc, resolve, projectors);
      }
    }
    for (const pj of projectors) {
      const pc = this.projCams.get(pj.id);
      if (!pc) continue;
      const out = outputs.find((o) => o.id === pj.outputId);
      const aspect = out ? out.width / out.height : pj.width / pj.height;
      this.placeProjector(pc.cam, pj, aspect, param);
      pc.body.position.copy(pc.cam.position);
      pc.body.quaternion.copy(pc.cam.quaternion);
      pc.helper.update();
    }
    if (this.selection) {
      this.helpers.remove(this.selection);
      this.selection.dispose();
      this.selection = null;
    }
    const sel = this.selectedId ? this.built.get(this.selectedId) : null;
    if (sel) {
      this.selection = new THREE.BoxHelper(sel.root, 0xffaa00);
      this.helpers.add(this.selection);
      this.axes.position.copy(sel.root.position);
      this.axes.quaternion.copy(sel.root.quaternion);
      this.axes.visible = true;
    } else this.axes.visible = false;
  }

  private placeProjector(cam: THREE.PerspectiveCamera, pj: Projector, aspect: number, param: ParamLookup) {
    const P = (k: string, fb: number) => param(`proj.${pj.id}.${k}`) ?? fb;
    if (this.modal?.objectId !== pj.id) {
      cam.position.set(P('posX', pj.position[0]), P('posY', pj.position[1]), P('posZ', pj.position[2]));
      cam.rotation.order = 'YXZ';
      cam.rotation.set(P('rotX', pj.rotation[0]) * DEG, P('rotY', pj.rotation[1]) * DEG, P('rotZ', pj.rotation[2]) * DEG);
    }
    cam.fov = P('fov', pj.fov);
    cam.aspect = aspect;
    cam.near = pj.near;
    cam.far = pj.far;
    // Lens shift: offset the frustum like a real projector (shift as a fraction of the image).
    const W = 1000 * aspect;
    const H = 1000;
    if (pj.shiftX || pj.shiftY) cam.setViewOffset(W, H, -pj.shiftX * W, pj.shiftY * H, W, H);
    else cam.clearViewOffset();
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }

  private applyFace(m: THREE.ShaderMaterial, fc: FaceContent | undefined, resolve: (ref: SourceRef, w: number, h: number) => TexRef | null, projectors: Projector[]) {
    const u = m.uniforms;
    if (!fc) {
      u.uHasTex.value = 0;
      u.uTint.value.set(0.15, 0.15, 0.15);
      u.uMode.value = 0;
      m.userData.content = { hasTex: 0, tint: [0.15, 0.15, 0.15], opacity: 1 };
      return;
    }
    const tex = resolve(fc.source, 1920, 1080);
    u.uTex.value = tex?.tex ?? null;
    u.uFlip.value = tex?.flip ? 1 : 0;
    u.uHasTex.value = tex ? 1 : 0;
    u.uOpacity.value = fc.opacity;
    u.uTint.value.set(...hexToRgb(fc.tint));
    const pj = fc.projectFrom ? projectors.find((p) => p.id === fc.projectFrom) : undefined;
    const pc = pj ? this.projCams.get(pj.id) : undefined;
    if (pc) {
      u.uMode.value = 1;
      (u.uProjVP.value as THREE.Matrix4).multiplyMatrices(pc.cam.projectionMatrix, pc.cam.matrixWorldInverse);
      (u.uProjPos.value as THREE.Vector3).copy(pc.cam.position);
    } else u.uMode.value = 0;
    m.transparent = fc.opacity < 1;
    m.userData.content = { hasTex: u.uHasTex.value, tint: [u.uTint.value.x, u.uTint.value.y, u.uTint.value.z], opacity: fc.opacity };
  }

  // ---------------------------------------------------------------- rendering

  /** Output in 3D mode: what the physical projector must show. */
  renderProjector(projectorId: string, rt: THREE.WebGLRenderTarget): boolean {
    const pc = this.projCams.get(projectorId);
    if (!pc) return false;
    this.helpers.visible = false;
    this.setMaterialMode('projection');
    rt.viewport.set(0, 0, rt.width, rt.height);
    this.r.setRenderTarget(rt);
    this.r.setClearColor(0x000000, 1);
    this.r.clear(true, true, false);
    this.r.render(this.scene, pc.cam);
    this.helpers.visible = true;
    return true;
  }

  private setMaterialMode(mode: ViewMode3D) {
    const shade = mode === 'solid' || mode === 'material' ? 1 : 0;
    for (const b of this.built.values()) {
      for (const mats of b.faces.values())
        for (const m of mats) {
          const u = m.uniforms;
          const c = m.userData.content as { hasTex: number; tint: [number, number, number]; opacity: number } | undefined;
          // restore the face content, then apply the view mode on top
          if (c) {
            u.uHasTex.value = c.hasTex;
            u.uTint.value.set(...c.tint);
            u.uOpacity.value = c.opacity;
          }
          u.uShade.value = shade;
          m.wireframe = mode === 'wireframe';
          m.depthWrite = mode !== 'xray';
          if (mode === 'xray') u.uOpacity.value = Math.min(u.uOpacity.value, 0.45);
          if (mode === 'solid') {
            u.uHasTex.value = 0;
            u.uTint.value.set(0.62, 0.66, 0.72);
          } else if (mode === 'material') u.uHasTex.value = 0;
          m.transparent = u.uOpacity.value < 1;
        }
    }
  }

  viewState(viewId: string): ViewState {
    let v = this.views.get(viewId);
    if (!v) {
      v = { yaw: 35, pitch: 25, distance: 9, panX: 0, panY: 1, panZ: 0, fov: 45, ortho: false, fromProjector: null };
      this.views.set(viewId, v);
    }
    return v;
  }

  /** MIDI/OSC/automation control of the viewport camera through view.* params. */
  applyViewParams(viewId: string, param: ParamLookup) {
    const v = this.viewState(viewId);
    const map: [keyof ViewState, string][] = [
      ['yaw', 'view.yaw'],
      ['pitch', 'view.pitch'],
      ['distance', 'view.distance'],
      ['fov', 'view.fov'],
      ['panX', 'view.panX'],
      ['panY', 'view.panY'],
    ];
    for (const [k, id] of map) {
      const val = param(id);
      if (val === undefined) continue;
      if (this.lastParams.get(id) === val) continue;
      this.lastParams.set(id, val);
      (v as unknown as Record<string, number>)[k] = val;
    }
  }

  private viewCamera(viewId: string, aspect: number): THREE.Camera {
    const v = this.viewState(viewId);
    if (v.fromProjector) {
      const pc = this.projCams.get(v.fromProjector);
      if (pc) return pc.cam;
      v.fromProjector = null;
    }
    const target = new THREE.Vector3(v.panX, v.panY, v.panZ);
    const dir = new THREE.Vector3(Math.cos(v.pitch * DEG) * Math.sin(v.yaw * DEG), Math.sin(v.pitch * DEG), Math.cos(v.pitch * DEG) * Math.cos(v.yaw * DEG));
    if (v.ortho) {
      const c = this.viewCamOrtho;
      const h = v.distance * 0.5;
      c.left = -h * aspect;
      c.right = h * aspect;
      c.top = h;
      c.bottom = -h;
      c.position.copy(target).addScaledVector(dir, 100);
      c.up.set(0, Math.abs(v.pitch) > 89.5 ? 0 : 1, Math.abs(v.pitch) > 89.5 ? -Math.sign(v.pitch) : 0);
      c.lookAt(target);
      c.updateProjectionMatrix();
      return c;
    }
    const c = this.viewCamPersp;
    c.fov = v.fov;
    c.aspect = aspect;
    c.position.copy(target).addScaledVector(dir, v.distance);
    c.up.set(0, 1, 0);
    c.lookAt(target);
    c.updateProjectionMatrix();
    return c;
  }

  renderViewport(viewId: string, mode: ViewMode3D, showGrid: boolean, w: number, h: number, target: THREE.WebGLRenderTarget) {
    const cam = this.viewCamera(viewId, w / h);
    this.scene.background = new THREE.Color(0x15181d);
    if (this.grid) this.grid.visible = showGrid && (this.stage?.grid.visible ?? true);
    const base: ViewMode3D = mode === 'projection+wireframe' || mode === 'projection+grid' ? 'projection' : mode;
    this.setMaterialMode(base);
    target.viewport.set(0, 0, w, h);
    this.r.setRenderTarget(target);
    this.r.setClearColor(0x15181d, 1);
    this.r.clear(true, true, false);
    this.r.render(this.scene, cam);
    if (mode === 'projection+wireframe') {
      this.helpers.visible = false;
      this.scene.overrideMaterial = this.wireMat;
      this.r.autoClear = false;
      this.r.render(this.scene, cam);
      this.r.autoClear = true;
      this.scene.overrideMaterial = null;
      this.helpers.visible = true;
    }
    this.scene.background = new THREE.Color(0x000000);
    if (this.grid) this.grid.visible = false;
    this.setMaterialMode('projection');
  }

  // ---------------------------------------------------------------- interaction (Blender-like)

  pointer(viewId: string, e: PointerMsg) {
    this.mouse.set(viewId, { x: e.x, y: e.y, w: e.width, h: e.height });
    const v = this.viewState(viewId);
    if (this.modal) {
      if (e.kind === 'move') this.updateModal(e);
      else if (e.kind === 'down') {
        if (e.button === 2) this.cancelModal();
        else this.confirmModal();
      }
      return;
    }
    if (e.kind === 'wheel') {
      v.distance = Math.max(0.3, Math.min(200, v.distance * (1 + Math.sign(e.deltaY ?? 0) * 0.1)));
      this.emitView(v);
      return;
    }
    if (e.kind === 'down') {
      if (e.button === 1 || (e.button === 0 && e.alt)) {
        this.drag = { viewId, mode: e.shift ? 'pan' : 'orbit', x: e.x, y: e.y };
      } else if (e.button === 0) {
        this.pick(viewId, e);
      }
      return;
    }
    if (e.kind === 'move' && this.drag && this.drag.viewId === viewId) {
      const dx = e.x - this.drag.x;
      const dy = e.y - this.drag.y;
      this.drag.x = e.x;
      this.drag.y = e.y;
      v.fromProjector = null;
      if (this.drag.mode === 'orbit') {
        v.yaw -= dx * 220;
        v.pitch = Math.max(-89.9, Math.min(89.9, v.pitch + dy * 160));
      } else {
        const s = v.distance * 0.9;
        const right = new THREE.Vector3(Math.cos(v.yaw * DEG), 0, -Math.sin(v.yaw * DEG));
        v.panX -= right.x * dx * s * (e.width / e.height);
        v.panZ -= right.z * dx * s * (e.width / e.height);
        v.panY += dy * s;
      }
      this.emitView(v);
      return;
    }
    if (e.kind === 'up' || e.kind === 'leave') this.drag = null;
  }

  private emitView(v: ViewState) {
    this.emit({ type: 'viewChanged', yaw: v.yaw, pitch: v.pitch, distance: v.distance, panX: v.panX, panY: v.panY, fov: v.fov, ortho: v.ortho });
  }

  private pick(viewId: string, e: PointerMsg) {
    const cam = this.viewCamera(viewId, e.width / e.height);
    this.raycaster.setFromCamera(new THREE.Vector2(e.x * 2 - 1, -(e.y * 2 - 1)), cam);
    const targets: THREE.Object3D[] = [];
    for (const b of this.built.values()) if (b.root.visible) targets.push(...b.meshes);
    for (const p of this.projCams.values()) targets.push(p.body);
    const hit = this.raycaster.intersectObjects(targets, false)[0];
    if (!hit) {
      this.emit({ type: 'pick', viewId, objectId: null, face: null });
      return;
    }
    const pid = hit.object.userData.projectorId as string | undefined;
    if (pid) {
      this.emit({ type: 'pick', viewId, objectId: pid, face: null });
      return;
    }
    const mesh = hit.object as THREE.Mesh;
    let face: string | null = null;
    if (Array.isArray(mesh.material) && hit.face) face = (mesh.material[hit.face.materialIndex] as THREE.Material).name;
    else if (!Array.isArray(mesh.material)) face = (mesh.material as THREE.Material).name;
    this.emit({ type: 'pick', viewId, objectId: mesh.userData.objectId ?? null, face });
  }

  /** Configurable shortcuts (action → KeyboardEvent.code). Defaults follow Blender. */
  shortcuts: Record<string, string> = { ...DEFAULT_SHORTCUTS };

  key(viewId: string, key: string, rawCode: string, mods: { shift: boolean; ctrl: boolean; alt: boolean }) {
    const v = this.viewState(viewId);
    // translate the pressed key to its action, then to the canonical Blender code used below
    const action = Object.entries(this.shortcuts).find(([, c]) => c === rawCode)?.[0];
    const code = action ? CANONICAL[action] : rawCode in CANONICAL_REVERSE ? '' : rawCode;
    if (action === 'grab' || action === 'rotate' || action === 'scale') key = { grab: 'g', rotate: 'r', scale: 's' }[action];
    else if (!action && rawCode in CANONICAL_REVERSE && this.shortcuts[CANONICAL_REVERSE[rawCode]] !== rawCode) key = '';
    // Numpad navigation (Blender)
    const presets: Record<string, [number, number]> = { Numpad1: [0, 0], Numpad3: [90, 0], Numpad7: [0, 89.99] };
    if (code in presets && !this.modal) {
      let [yaw, pitch] = presets[code];
      if (mods.ctrl) {
        if (code === 'Numpad7') pitch = -89.99;
        else yaw += 180;
      }
      v.yaw = yaw;
      v.pitch = pitch;
      v.fromProjector = null;
      this.emitView(v);
      return;
    }
    if (code === 'Numpad5') {
      v.ortho = !v.ortho;
      this.emitView(v);
      return;
    }
    if (code === 'Numpad0') {
      const ids = [...this.projCams.keys()];
      if (ids.length === 0) return;
      const i = v.fromProjector ? ids.indexOf(v.fromProjector) : -1;
      v.fromProjector = i + 1 < ids.length ? ids[i + 1] : null;
      this.emitView(v);
      return;
    }
    if (code === 'NumpadDecimal' || code === 'Period') {
      const sel = this.selectedId ? this.built.get(this.selectedId) : null;
      if (sel) {
        v.panX = sel.root.position.x;
        v.panY = sel.root.position.y;
        v.panZ = sel.root.position.z;
        this.emitView(v);
      }
      return;
    }
    const k = key.toUpperCase();
    if (this.modal) {
      if (k === 'X' || k === 'Y' || k === 'Z') this.modal.axis = this.modal.axis === k ? null : (k as 'X' | 'Y' | 'Z');
      else if (code === 'Escape') this.cancelModal();
      else if (code === 'Enter' || code === 'NumpadEnter') this.confirmModal();
      const m = this.mouse.get(viewId);
      if (m && this.modal) this.updateModal({ kind: 'move', x: m.x, y: m.y, width: m.w, height: m.h, button: 0, buttons: 0, shift: mods.shift, ctrl: mods.ctrl, alt: mods.alt });
      return;
    }
    if ((k === 'G' || k === 'R' || k === 'S') && this.selectedId && !mods.ctrl) {
      const isProjector = this.projCams.has(this.selectedId);
      const obj = isProjector ? this.projCams.get(this.selectedId)!.cam : this.built.get(this.selectedId)?.root;
      const def = this.stage?.objects.find((o) => o.id === this.selectedId);
      if (!obj || def?.locked) return;
      const m = this.mouse.get(viewId) ?? { x: 0.5, y: 0.5, w: 1, h: 1 };
      this.modal = { kind: k, objectId: this.selectedId, isProjector, axis: null, startX: m.x, startY: m.y, startPos: obj.position.clone(), startRot: obj.rotation.clone(), startScale: obj.scale.clone(), viewId };
    }
  }

  private modalObject(): THREE.Object3D | null {
    if (!this.modal) return null;
    return this.modal.isProjector ? (this.projCams.get(this.modal.objectId)?.cam ?? null) : (this.built.get(this.modal.objectId)?.root ?? null);
  }

  private updateModal(e: PointerMsg) {
    const md = this.modal!;
    const obj = this.modalObject();
    if (!obj) return;
    const v = this.viewState(md.viewId);
    const dx = (e.x - md.startX) * (e.width / e.height);
    const dy = e.y - md.startY;
    const snap = this.stage?.snap;
    const inc = e.ctrl || snap?.grid ? (snap?.increment ?? 0.1) : 0;
    if (md.kind === 'G') {
      const s = v.distance * 0.9;
      const right = new THREE.Vector3(Math.cos(v.yaw * DEG), 0, -Math.sin(v.yaw * DEG));
      const up = new THREE.Vector3(0, 1, 0);
      const delta = right.multiplyScalar(dx * s).add(up.multiplyScalar(-dy * s));
      if (md.axis) {
        const ax = md.axis === 'X' ? new THREE.Vector3(1, 0, 0) : md.axis === 'Y' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
        // project the screen-space drag on the axis
        const amount = delta.dot(ax) + (md.axis === 'Z' ? -dy * s : 0);
        delta.copy(ax.multiplyScalar(amount));
      }
      const p = md.startPos.clone().add(delta);
      if (inc > 0) p.set(Math.round(p.x / inc) * inc, Math.round(p.y / inc) * inc, Math.round(p.z / inc) * inc);
      const snapped = this.snapToGeometry(md, e);
      obj.position.copy(snapped ?? p);
    } else if (md.kind === 'R') {
      let ang = dx * 360;
      const step = e.ctrl || snap?.grid ? (snap?.angle ?? 15) : 0;
      if (step > 0) ang = Math.round(ang / step) * step;
      obj.rotation.copy(md.startRot);
      const axis = md.axis ?? 'Y';
      if (axis === 'X') obj.rotation.x += ang * DEG;
      else if (axis === 'Y') obj.rotation.y += ang * DEG;
      else obj.rotation.z += ang * DEG;
    } else {
      let f = Math.max(0.01, 1 + dx * 2);
      if (inc > 0) f = Math.max(inc, Math.round(f / inc) * inc);
      const sc = md.startScale.clone();
      if (!md.axis) sc.multiplyScalar(f);
      else if (md.axis === 'X') sc.x *= f;
      else if (md.axis === 'Y') sc.y *= f;
      else sc.z *= f;
      if (!md.isProjector) obj.scale.copy(sc);
    }
  }

  /** Vertex / edge / face snapping against other objects under the cursor. */
  private snapToGeometry(md: Modal, e: PointerMsg): THREE.Vector3 | null {
    const s = this.stage?.snap;
    if (!s || !(s.vertex || s.edge || s.face)) return null;
    const cam = this.viewCamera(md.viewId, e.width / e.height);
    this.raycaster.setFromCamera(new THREE.Vector2(e.x * 2 - 1, -(e.y * 2 - 1)), cam);
    const targets: THREE.Object3D[] = [];
    for (const [id, b] of this.built) if (id !== md.objectId && b.root.visible) targets.push(...b.meshes);
    const hit = this.raycaster.intersectObjects(targets, false)[0];
    if (!hit || !hit.face) return null;
    const mesh = hit.object as THREE.Mesh;
    const pos = mesh.geometry.attributes.position;
    const verts = [hit.face.a, hit.face.b, hit.face.c].map((i) => new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld));
    if (s.vertex) {
      let best = verts[0];
      for (const vv of verts) if (vv.distanceTo(hit.point) < best.distanceTo(hit.point)) best = vv;
      return best.clone();
    }
    if (s.edge) {
      let best: THREE.Vector3 | null = null;
      for (let i = 0; i < 3; i++) {
        const line = new THREE.Line3(verts[i], verts[(i + 1) % 3]);
        const c = line.closestPointToPoint(hit.point, true, new THREE.Vector3());
        if (!best || c.distanceTo(hit.point) < best.distanceTo(hit.point)) best = c;
      }
      return best;
    }
    return hit.point.clone();
  }

  private confirmModal() {
    const md = this.modal;
    const obj = this.modalObject();
    this.modal = null;
    if (!md || !obj) return;
    const r = obj.rotation;
    this.emit({
      type: 'transformed',
      objectId: md.objectId,
      kind: md.isProjector ? 'projector' : 'object',
      position: [round(obj.position.x), round(obj.position.y), round(obj.position.z)],
      rotation: [round(r.x / DEG), round(r.y / DEG), round(r.z / DEG)],
      scale: [round(obj.scale.x), round(obj.scale.y), round(obj.scale.z)],
    });
  }

  private cancelModal() {
    const md = this.modal;
    const obj = this.modalObject();
    this.modal = null;
    if (!md || !obj) return;
    obj.position.copy(md.startPos);
    obj.rotation.copy(md.startRot);
    obj.scale.copy(md.startScale);
  }

  get modalActive() {
    return this.modal?.kind ?? null;
  }
}

const round = (v: number) => Math.round(v * 10000) / 10000;

export const DEFAULT_SHORTCUTS: Record<string, string> = {
  front: 'Numpad1',
  right: 'Numpad3',
  top: 'Numpad7',
  persp: 'Numpad5',
  projector: 'Numpad0',
  focus: 'NumpadDecimal',
  grab: 'KeyG',
  rotate: 'KeyR',
  scale: 'KeyS',
};
const CANONICAL: Record<string, string> = { front: 'Numpad1', right: 'Numpad3', top: 'Numpad7', persp: 'Numpad5', projector: 'Numpad0', focus: 'NumpadDecimal', grab: 'KeyG', rotate: 'KeyR', scale: 'KeyS' };
const CANONICAL_REVERSE: Record<string, string> = Object.fromEntries(Object.entries(CANONICAL).map(([a, c]) => [c, a]));
