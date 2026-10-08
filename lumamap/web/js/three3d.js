// web/js/three3d.js
// Projection mapping 3D real (three.js): un espacio X/Y/Z con objetos, cámaras
// y proyectores virtuales. Se carga solo cuando se usa (modo profesional).
//
//   OBJETO 3D → CARA (superficie virtual con su contenido) → PROYECTOR (cámara)
//   → SALIDA (una superficie a pantalla completa en P1-P4 con lo que ve el proyector)
//
// · El contenido de cada cara usa todo lo de LumaMap (animaciones, efectos, video,
//   cámara, texto, dibujo, mezcla en vivo) y se dibuja en un atlas con las
//   fuentes ya decodificadas del editor.
// · Cada proyector se renderiza a su resolución en su propio contexto y llega a
//   las salidas como imagen (ImageBitmap, sin copia en la CPU).
// · Navegación tipo Blender: botón central orbita, Mayús+central desplaza, rueda
//   acerca; Numpad 1/3/7 (Ctrl = vista opuesta), Numpad 5 perspectiva/orto,
//   Numpad 0 ver desde el proyector. Todos los atajos se pueden cambiar.
import * as THREE from "../vendor/three/three.module.min.js";
import { OrbitControls } from "../vendor/three/addons/controls/OrbitControls.js";
import { TransformControls } from "../vendor/three/addons/controls/TransformControls.js";
import { Renderer } from "./renderer.js";
import { Compositor } from "./compose.js";
import * as M from "./model.js";
import * as Store from "./store.js";

export const KINDS_3D = [["cube", "Cubo"], ["plane", "Plano"], ["sphere", "Esfera"], ["cylinder", "Cilindro"], ["cone", "Cono"], ["pyramid", "Pirámide"], ["prism", "Prisma"]];
export const VIEW_MODES = [["wireframe", "Alambre"], ["solid", "Sólido"], ["material", "Material"], ["texture", "Textura"], ["projection", "Proyección"], ["projwire", "Proyección + alambre"], ["projgrid", "Proyección + rejilla"], ["xray", "Rayos X"]];
export const DEFAULT_KEYS_3D = {
  front: "Numpad1", back: "Ctrl+Numpad1", right: "Numpad3", left: "Ctrl+Numpad3", top: "Numpad7", bottom: "Ctrl+Numpad7",
  ortho: "Numpad5", projector: "Numpad0", frame: "NumpadDecimal", move: "G", rotate: "R", scale: "S",
  duplicate: "Shift+D", delete: "Delete", hide: "H", snap: "Shift+Tab", cycleView: "Z",
};
export const KEY_LABELS_3D = {
  front: "Vista frontal", back: "Vista trasera", right: "Vista derecha", left: "Vista izquierda", top: "Vista superior", bottom: "Vista inferior",
  ortho: "Perspectiva / ortográfica", projector: "Ver desde el proyector", frame: "Encuadrar selección", move: "Mover", rotate: "Rotar", scale: "Escalar",
  duplicate: "Duplicar", delete: "Eliminar", hide: "Ocultar / mostrar", snap: "Snap sí / no", cycleView: "Cambiar modo de vista",
};
export function keys3d() {
  try { return { ...DEFAULT_KEYS_3D, ...JSON.parse(localStorage.getItem("lumamap:keys3d") || "{}") }; } catch { return { ...DEFAULT_KEYS_3D }; }
}
export function saveKeys3d(k) { try { localStorage.setItem("lumamap:keys3d", JSON.stringify(k)); } catch {} }
/** Nombre de una tecla (con Numpad por código físico). */
export function key3dOf(e) {
  const mods = (e.ctrlKey || e.metaKey ? "Ctrl+" : "") + (e.altKey ? "Alt+" : "") + (e.shiftKey ? "Shift+" : "");
  let k = e.code?.startsWith("Numpad") ? e.code : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  return mods + k;
}

const D2R = Math.PI / 180;
const UNITS = { m: ["m", 1], cm: ["cm", 100], mm: ["mm", 1000], ft: ["ft", 3.28084] };

/* ======================================================================
   Geometría de cada tipo
   ====================================================================== */
function geometryOf(kind) {
  switch (kind) {
    case "cube": return new THREE.BoxGeometry(1, 1, 1);
    case "plane": return new THREE.PlaneGeometry(1.6, 0.9);
    case "sphere": return new THREE.SphereGeometry(0.5, 64, 32);
    case "cylinder": return new THREE.CylinderGeometry(0.5, 0.5, 1, 64);
    case "cone": return new THREE.ConeGeometry(0.5, 1, 64);
    case "pyramid": return new THREE.ConeGeometry(0.6, 1, 4);
    case "prism": return new THREE.CylinderGeometry(0.6, 0.6, 1, 3);
    default: return new THREE.BoxGeometry(1, 1, 1);
  }
}
/** Proporción del contenido de cada cara (para textos y dibujos). */
function faceAspect(kind, slot) {
  if (kind === "plane") return [1600, 900];
  if (kind === "sphere") return [2000, 1000];
  if (slot === "side" && (kind === "cylinder" || kind === "cone" || kind === "prism" || kind === "pyramid")) return [2000, 1000];
  return [1000, 1000];
}

/* ======================================================================
   Proyección (ver qué ilumina cada proyector, con sombras)
   ====================================================================== */
const PROJ_VS = `
varying vec3 vW; varying vec3 vN;
void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`;
const PROJ_FS = `
uniform int uN; uniform int uGrid;
uniform mat4 uPV0, uPV1, uPV2, uPV3;
uniform vec3 uPos0, uPos1, uPos2, uPos3;
uniform sampler2D uMap0, uMap1, uMap2, uMap3;
uniform sampler2D uDep0, uDep1, uDep2, uDep3;
varying vec3 vW; varying vec3 vN;
vec3 proj(mat4 pv, vec3 pos, sampler2D map, sampler2D dep){
  vec4 c = pv * vec4(vW, 1.0);
  if (c.w <= 0.0) return vec3(0.0);
  vec3 n = c.xyz / c.w;
  if (any(greaterThan(abs(n.xy), vec2(1.0))) || n.z > 1.0 || n.z < -1.0) return vec3(0.0);
  vec2 uv = n.xy * 0.5 + 0.5;
  float z = n.z * 0.5 + 0.5;
  if (z > texture2D(dep, uv).r + 0.0015) return vec3(0.0);            // tapado (sombra)
  if (dot(vN, normalize(pos - vW)) <= 0.0) return vec3(0.0);           // cara de espaldas al proyector
  if (uGrid == 1) { vec2 g = abs(fract(uv * 16.0 + 0.5) - 0.5) / fwidth(uv * 16.0); float l = 1.0 - min(min(g.x, g.y), 1.0); return mix(vec3(0.05), vec3(0.0, 0.9, 1.0), l); }
  return texture2D(map, uv).rgb;
}
void main(){
  vec3 c = vec3(0.06);
  if (uN > 0) c += proj(uPV0, uPos0, uMap0, uDep0);
  if (uN > 1) c += proj(uPV1, uPos1, uMap1, uDep1);
  if (uN > 2) c += proj(uPV2, uPos2, uMap2, uDep2);
  if (uN > 3) c += proj(uPV3, uPos3, uMap3, uDep3);
  gl_FragColor = vec4(c, 1.0);
}`;

/* ======================================================================
   Motor
   ====================================================================== */
export class Stage3D {
  constructor(app) {
    this.app = app;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0d12);
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x333344, 1.6));
    const dl = new THREE.DirectionalLight(0xffffff, 1.4); dl.position.set(3, 6, 4); this.scene.add(dl);
    this.grid = new THREE.GridHelper(20, 40, 0x2a5f6f, 0x1c2433);
    this.axes = new THREE.AxesHelper(1.2);
    this.scene.add(this.grid, this.axes);
    this.nodes = new Map();       // id -> { obj: Object3D, data, mesh, sig, mats }
    this.pnodes = new Map();      // projector id -> { cam, body, helper, sig }
    this.faceTex = new Map();     // faceId -> THREE.Texture (comparten el atlas)
    this.atlas = null;            // { canvas, r, comp, tex, tiles }
    this.models = new Map();      // mediaId -> Promise<Object3D>
    this.pviews = new Map();      // projector id -> { el: ImageBitmap, key, old: [] , renderer }
    this.frame = 0;
    this.vp = null;               // ventana 3D visible (attach)
    this.sel = null;              // { type: "object"|"projector", id }
    this.usedProjectors = new Set();
    globalThis.__lumaProjectorView = (id) => this.projectorView(id);
  }
  get data() { return this.app.S.project.stage3d; }
  units() { return UNITS[this.data.units] || UNITS.m; }

  /* ---------------- Altas ---------------- */
  addObject(kind) {
    const d = this.data, P = this.app.S.project;
    const n = d.objects.filter(o => o.kind === kind).length + 1;
    const label = (KINDS_3D.find(k => k[0] === kind) || [, kind])[1];
    const o = { id: M.uid("obj"), name: `${label} ${n}`, kind, parent: "", pos: [0, kind === "plane" ? 0.45 : 0.5, 0], rot: [0, 0, 0], scale: [1, 1, 1], hidden: false, locked: false, color: "#8a93a6", faces: {} };
    this.makeFaces(o);
    d.objects.push(o);
    this.select("object", o.id);
    return o;
  }
  makeFaces(o) {
    const scene = M.currentScene(this.app.S.project);
    for (const slot of M.SLOTS_3D[o.kind] || []) {
      const [w, h] = faceAspect(o.kind, slot);
      const f = M.createFace(`${o.name} · ${M.SLOT_NAMES[slot] || slot}`, w, h);
      this.data.faces.push(f);
      o.faces[slot] = f.id;
      // Cada cara empieza con el patrón de calibración (se ve la orientación) en todas las escenas.
      for (const sc of this.app.S.project.scenes) sc.looks[f.id] = M.createLook({ type: "gen", gen: "calib" });
      void scene;
    }
  }
  async importModel(file) {
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (!["obj", "fbx", "gltf", "glb", "stl", "ply"].includes(ext)) throw new Error("Formato no soportado: ." + ext + " (OBJ, FBX, GLTF, GLB, STL, PLY)");
    const id = M.uid("media");
    await Store.putMedia({ id, name: file.name, kind: "model", mime: file.type || "model/" + ext, blob: file, size: file.size });
    this.app.S.project.media.push({ id, name: file.name, kind: "model", size: file.size });
    const node = await this.loadModel(id);   // valida que se puede leer antes de añadirlo
    const box = new THREE.Box3().setFromObject(node), size = box.getSize(new THREE.Vector3());
    const k = size.length() > 0 ? 1.5 / Math.max(size.x, size.y, size.z) : 1;   // tamaño inicial razonable (1,5 m)
    const o = { id: M.uid("obj"), name: file.name.replace(/\.[^.]+$/, ""), kind: "model", mediaId: id, ext, parent: "", pos: [0, -box.min.y * k, 0], rot: [0, 0, 0], scale: [k, k, k], hidden: false, locked: false, color: "#8a93a6", faces: {} };
    this.makeFaces(o);
    this.data.objects.push(o);
    this.select("object", o.id);
    return o;
  }
  loadModel(mediaId) {
    if (this.models.has(mediaId)) return this.models.get(mediaId);
    const p = (async () => {
      const rec = await Store.getMedia(mediaId);
      if (!rec) throw new Error("Falta el archivo del modelo");
      const ext = (rec.name.split(".").pop() || "").toLowerCase();
      const buf = await rec.blob.arrayBuffer();
      let obj;
      if (ext === "obj") { const { OBJLoader } = await import("../vendor/three/addons/loaders/OBJLoader.js"); obj = new OBJLoader().parse(new TextDecoder().decode(buf)); }
      else if (ext === "gltf" || ext === "glb") { const { GLTFLoader } = await import("../vendor/three/addons/loaders/GLTFLoader.js"); obj = (await new GLTFLoader().parseAsync(buf, "")).scene; }
      else if (ext === "fbx") { const { FBXLoader } = await import("../vendor/three/addons/loaders/FBXLoader.js"); obj = new FBXLoader().parse(buf, ""); }
      else if (ext === "stl") { const { STLLoader } = await import("../vendor/three/addons/loaders/STLLoader.js"); obj = new THREE.Mesh(new STLLoader().parse(buf)); }
      else if (ext === "ply") { const { PLYLoader } = await import("../vendor/three/addons/loaders/PLYLoader.js"); const g = new PLYLoader().parse(buf); g.computeVertexNormals(); obj = new THREE.Mesh(g); }
      else throw new Error("Formato no soportado");
      obj.traverse(c => { if (c.isMesh && !c.geometry.attributes.normal) c.geometry.computeVertexNormals(); });
      return obj;
    })();
    this.models.set(mediaId, p);
    p.catch(() => this.models.delete(mediaId));
    return p;
  }
  addProjector() {
    const d = this.data, P = this.app.S.project;
    const pr = { id: M.uid("proj"), name: `Proyector ${d.projectors.length + 1}`, pos: [0, 1.2, 4], rot: [-8, 0, 0], fov: 32, res: [P.width, P.height], near: 0.1, far: 60, shift: [0, 0], screen: Math.min(4, d.projectors.length + 1) };
    d.projectors.push(pr);
    this.select("projector", pr.id);
    return pr;
  }
  duplicate(id) {
    const d = this.data, o = d.objects.find(x => x.id === id);
    if (!o) return null;
    const c = JSON.parse(JSON.stringify(o));
    c.id = M.uid("obj"); c.name = o.name + " copia"; c.pos = [o.pos[0] + 0.3, o.pos[1], o.pos[2] + 0.3]; c.faces = {};
    for (const [slot, fid] of Object.entries(o.faces)) {
      const f = d.faces.find(x => x.id === fid);
      const nf = { ...JSON.parse(JSON.stringify(f)), id: M.uid("face"), name: f.name.replace(o.name, c.name) };
      d.faces.push(nf); c.faces[slot] = nf.id;
      for (const sc of this.app.S.project.scenes) if (sc.looks[fid]) sc.looks[nf.id] = JSON.parse(JSON.stringify(sc.looks[fid]));
    }
    d.objects.push(c);
    this.select("object", c.id);
    return c;
  }
  remove(sel = this.sel) {
    const d = this.data;
    if (!sel) return;
    if (sel.type === "projector") { d.projectors = d.projectors.filter(p => p.id !== sel.id); }
    else {
      const kill = new Set([sel.id]);
      let grew = true;
      while (grew) { grew = false; for (const o of d.objects) if (kill.has(o.parent) && !kill.has(o.id)) { kill.add(o.id); grew = true; } }
      for (const o of d.objects.filter(x => kill.has(x.id))) for (const fid of Object.values(o.faces)) {
        d.faces = d.faces.filter(f => f.id !== fid);
        for (const sc of this.app.S.project.scenes) delete sc.looks[fid];
      }
      d.objects = d.objects.filter(o => !kill.has(o.id));
    }
    this.sel = null;
  }
  /** Agrupa los objetos indicados bajo un grupo nuevo (se mueven juntos). */
  group(ids) {
    const d = this.data;
    const g = { id: M.uid("obj"), name: `Grupo ${d.objects.filter(o => o.kind === "group").length + 1}`, kind: "group", parent: "", pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1], hidden: false, locked: false, faces: {} };
    d.objects.push(g);
    for (const o of d.objects) if (ids.includes(o.id)) o.parent = g.id;
    return g;
  }
  ungroup(gid) {
    const d = this.data;
    for (const o of d.objects) if (o.parent === gid) o.parent = "";
    d.objects = d.objects.filter(o => o.id !== gid);
  }
  select(type, id) { this.sel = id ? { type, id } : null; this.attachGizmo(); }

  /* ---------------- Escena three.js a partir de los datos ---------------- */
  sync() {
    const d = this.data, seen = new Set();
    for (const o of d.objects) {
      seen.add(o.id);
      let n = this.nodes.get(o.id);
      const sig = o.kind + "|" + (o.mediaId || "") + "|" + Object.values(o.faces).join(",");
      if (!n || n.sig !== sig) {
        if (n) n.obj.removeFromParent();
        n = { obj: new THREE.Group(), sig, meshes: [], data: o };
        n.obj.userData.lumaId = o.id;
        if (o.kind === "model") {
          this.loadModel(o.mediaId).then(src => {
            const m = src.clone(true);
            m.traverse(c => { if (c.isMesh) { c.userData.lumaId = o.id; c.userData.slots = ["model"]; n.meshes.push(c); } });
            n.obj.add(m); n.mats = null;
          }).catch(e => { n.error = e.message; });
        } else if (o.kind !== "group") {
          const mesh = new THREE.Mesh(geometryOf(o.kind));
          mesh.userData.lumaId = o.id; mesh.userData.slots = M.SLOTS_3D[o.kind];
          n.obj.add(mesh); n.meshes.push(mesh);
        }
        this.nodes.set(o.id, n);
      }
      n.data = o;
      if (!n.dragging) {
        n.obj.position.fromArray(o.pos);
        n.obj.rotation.set(o.rot[0] * D2R, o.rot[1] * D2R, o.rot[2] * D2R, "YXZ");
        n.obj.scale.fromArray(o.scale);
      }
      n.obj.visible = !o.hidden;
      const parent = o.parent ? this.nodes.get(o.parent)?.obj : this.root;
      if (parent && n.obj.parent !== parent) parent.add(n.obj);
      else if (!parent && n.obj.parent !== this.root) this.root.add(n.obj);
    }
    for (const [id, n] of this.nodes) if (!seen.has(id)) { n.obj.removeFromParent(); this.nodes.delete(id); }
    // Proyectores
    const pseen = new Set();
    for (const p of d.projectors) {
      pseen.add(p.id);
      let n = this.pnodes.get(p.id);
      if (!n) {
        const cam = new THREE.PerspectiveCamera(p.fov, p.res[0] / p.res[1], p.near, p.far);
        cam.userData.lumaProj = p.id;
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.24), new THREE.MeshStandardMaterial({ color: 0xff2d8a, emissive: 0x330011 }));
        body.userData.lumaProj = p.id;
        const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 24), new THREE.MeshStandardMaterial({ color: 0x111111 }));
        lens.rotation.x = Math.PI / 2; lens.position.z = -0.14; body.add(lens);
        cam.add(body);
        const helper = new THREE.CameraHelper(cam);
        this.scene.add(cam, helper);
        n = { cam, body, helper };
        this.pnodes.set(p.id, n);
      }
      const c = n.cam;
      if (!n.dragging) {
        c.position.fromArray(p.pos);
        c.rotation.set(p.rot[0] * D2R, p.rot[1] * D2R, p.rot[2] * D2R, "YXZ");
      }
      c.fov = p.fov; c.aspect = p.res[0] / p.res[1]; c.near = p.near; c.far = p.far;
      // Desplazamiento de lente (lens shift) como en los proyectores reales.
      if (p.shift[0] || p.shift[1]) c.setViewOffset(p.res[0], p.res[1], -p.shift[0] * p.res[0], p.shift[1] * p.res[1], p.res[0], p.res[1]);
      else c.clearViewOffset();
      c.updateProjectionMatrix(); c.updateMatrixWorld();
      n.helper.update();
      n.helper.visible = this.showHelpers !== false;
      n.body.material.color.set(this.sel?.id === p.id ? 0xffd60a : 0xff2d8a);
    }
    for (const [id, n] of this.pnodes) if (!pseen.has(id)) { n.cam.removeFromParent(); n.helper.removeFromParent(); this.pnodes.delete(id); this.dropProjectorView(id); }
    this.grid.visible = this.showGrid !== false;
  }

  /* ---------------- Atlas con el contenido de las caras ---------------- */
  renderAtlas(frame) {
    const d = this.data;
    const faces = [];
    for (const o of d.objects) if (!o.hidden) for (const fid of Object.values(o.faces)) { const f = d.faces.find(x => x.id === fid); if (f) faces.push(f); }
    if (!faces.length) return;
    if (!this.atlas) {
      const canvas = new OffscreenCanvas(1024, 1024);
      const r = new Renderer(canvas);
      this.atlas = { canvas, r, comp: new Compositor(r, null, this.app.sharedComp()), tex: null, sig: "" };
    }
    const A = this.atlas, cols = Math.ceil(Math.sqrt(faces.length)), rows = Math.ceil(faces.length / cols);
    const tile = Math.max(128, Math.min(d.faceRes || 512, Math.floor(4096 / Math.max(cols, rows))));
    const W = cols * tile, H = rows * tile;
    A.r.resize(W, H);
    const tiles = faces.map((face, i) => ({ face, x: (i % cols) * tile, y: Math.floor(i / cols) * tile, w: tile, h: tile }));
    A.comp.drawFaces(frame.project, frame, tiles);
    if (!A.tex) { A.tex = new THREE.CanvasTexture(A.canvas); A.tex.colorSpace = THREE.SRGBColorSpace; A.tex.generateMipmaps = false; A.tex.minFilter = THREE.LinearFilter; }
    A.tex.needsUpdate = true;
    const sig = tiles.map(t => t.face.id + "@" + t.x + "," + t.y).join("|") + `|${W}x${H}`;
    if (sig !== A.sig) {
      A.sig = sig;
      for (const t of tiles) {
        let ft = this.faceTex.get(t.face.id);
        if (!ft) { ft = A.tex.clone(); this.faceTex.set(t.face.id, ft); }
        ft.source = A.tex.source;
        ft.offset.set(t.x / W, 1 - (t.y + t.h) / H);
        ft.repeat.set(t.w / W, t.h / H);
        ft.needsUpdate = true;
      }
    }
  }

  /** Materiales de un modo de vista para todos los objetos. */
  applyMaterials(mode) {
    for (const n of this.nodes.values()) {
      const o = n.data;
      if (!n.mats) n.mats = {};
      if (!n.mats[mode]) {
        const slots = o.kind === "model" ? ["model"] : M.SLOTS_3D[o.kind] || [];
        n.mats[mode] = slots.map((slot) => {
          const map = this.faceTex.get(o.faces[slot]) || null;
          switch (mode) {
            case "wireframe": return new THREE.MeshBasicMaterial({ color: 0x00e5ff, wireframe: true });
            case "solid": return new THREE.MeshStandardMaterial({ color: o.color || "#8a93a6", flatShading: true, roughness: 0.8 });
            case "material": return new THREE.MeshStandardMaterial({ color: 0xffffff, map, roughness: 0.6 });
            case "xray": return new THREE.MeshBasicMaterial({ map, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
            case "proj": return this.projMaterial();
            default: return new THREE.MeshBasicMaterial({ map, side: o.kind === "plane" ? THREE.DoubleSide : THREE.FrontSide });
          }
        });
      }
      for (const mesh of n.meshes) {
        const mats = n.mats[mode];
        if (o.kind === "model") mesh.material = mats[0];
        else mesh.material = mats.length === 1 ? mats[0] : mats;
      }
    }
  }
  /** Al cambiar las caras (atlas nuevo, cara nueva) los materiales se regeneran. */
  invalidateMaterials() { for (const n of this.nodes.values()) { if (n.mats) for (const arr of Object.values(n.mats)) for (const m of arr) if (m !== this._projMat) m.dispose(); n.mats = null; } }
  projMaterial() {
    if (!this._projMat) {
      const u = { uN: { value: 0 }, uGrid: { value: 0 } };
      for (let i = 0; i < 4; i++) { u["uPV" + i] = { value: new THREE.Matrix4() }; u["uPos" + i] = { value: new THREE.Vector3() }; u["uMap" + i] = { value: null }; u["uDep" + i] = { value: null }; }
      this._projMat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: PROJ_VS, fragmentShader: PROJ_FS });
    }
    return this._projMat;
  }

  /* ---------------- Proyectores → salidas ---------------- */
  /** Imagen actual de un proyector (la usan las superficies «Proyector 3D»). */
  projectorView(id) {
    this.usedProjectors.add(id);
    const v = this.pviews.get(id);
    return v && v.el ? { el: v.el, key: v.key } : null;
  }
  dropProjectorView(id) {
    const v = this.pviews.get(id);
    if (!v) return;
    try { v.el?.close?.(); for (const b of v.old) b.close?.(); v.renderer?.dispose(); } catch {}
    this.pviews.delete(id);
  }
  renderProjectors() {
    const used = new Set(this.usedProjectors);
    this.usedProjectors.clear();
    if (this.previewProjector) used.add(this.previewProjector);
    for (const [id] of this.pviews) if (!used.has(id) && !this.pnodes.has(id)) this.dropProjectorView(id);
    if (!used.size) return;
    this.applyMaterials("texture");
    const helpersWere = [this.grid.visible, this.axes.visible];
    this.grid.visible = this.axes.visible = false;
    for (const n of this.pnodes.values()) { n.helper.visible = false; n.body.visible = false; }
    if (this.gizmo) this.gizmo.getHelper().visible = false;
    for (const id of used) {
      const n = this.pnodes.get(id), p = this.data.projectors.find(x => x.id === id);
      if (!n || !p) continue;
      let v = this.pviews.get(id);
      if (!v) {
        const canvas = new OffscreenCanvas(p.res[0], p.res[1]);
        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        v = { canvas, renderer, el: null, key: 0, old: [] };
        this.pviews.set(id, v);
      }
      if (v.canvas.width !== p.res[0] || v.canvas.height !== p.res[1]) v.renderer.setSize(p.res[0], p.res[1], false);
      const bg = this.scene.background; this.scene.background = new THREE.Color(0);
      v.renderer.render(this.scene, n.cam);
      this.scene.background = bg;
      const bmp = v.canvas.transferToImageBitmap();
      if (v.el) v.old.push(v.el);
      while (v.old.length > 3) v.old.shift().close();   // las salidas pueden estar subiendo la anterior
      v.el = bmp; v.key = ++this.frame;
    }
    this.grid.visible = helpersWere[0]; this.axes.visible = helpersWere[1];
    for (const n of this.pnodes.values()) { n.helper.visible = this.showHelpers !== false; n.body.visible = true; }
    if (this.gizmo) this.gizmo.getHelper().visible = true;
  }

  /** Cada fotograma del editor. */
  tick(frame) {
    const d = this.data;
    if (!d.objects.length && !d.projectors.length) return;
    this.sync();
    const before = this.atlas?.sig;
    this.renderAtlas(frame);
    if (this.atlas && this.atlas.sig !== before) this.invalidateMaterials();
    this.renderProjectors();
    if (this.vp) this.renderViewport();
  }

  /* ======================================================================
     Ventana 3D (visor)
     ====================================================================== */
  attach(container) {
    if (this.vp) return;
    const canvas = document.createElement("canvas");
    canvas.className = "ws3d-canvas";
    container.append(canvas);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    const persp = new THREE.PerspectiveCamera(45, 1, 0.01, 500);
    persp.position.set(4, 3, 6);
    const ortho = new THREE.OrthographicCamera(-5, 5, 5, -5, -500, 500);
    const orbit = new OrbitControls(persp, canvas);
    orbit.target.set(0, 0.5, 0);
    orbit.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
    orbit.enableDamping = false;
    orbit.update();
    const gizmo = new TransformControls(persp, canvas);
    this.scene.add(gizmo.getHelper());
    this.gizmo = gizmo;
    gizmo.addEventListener("dragging-changed", (e) => {
      orbit.enabled = !e.value;
      const n = this.selNode();
      if (n) n.dragging = e.value;
      if (!e.value) { this.afterDrag(); this.app.changed(); this.app.commit(); this.app.renderPanel(); }
    });
    gizmo.addEventListener("objectChange", () => this.writeBack());
    this.vp = { canvas, renderer, persp, ortho, cam: persp, orbit, container, split: "none", viewFrom: null, size: [0, 0] };
    // Seleccionar con clic izquierdo; Alt + izquierdo orbita (portátiles sin botón central).
    let down = null;
    canvas.addEventListener("pointerdown", (e) => {
      down = { x: e.clientX, y: e.clientY, button: e.button };
      if (e.button === 0 && e.altKey) { orbit.mouseButtons.LEFT = THREE.MOUSE.ROTATE; this.vp.viewFrom = null; }
      if (e.button === 1 || e.button === 2) this.vp.viewFrom = null;
    }, true);
    canvas.addEventListener("pointerup", (e) => {
      orbit.mouseButtons.LEFT = null;
      if (!down || e.button !== 0 || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4 || gizmo.dragging || e.altKey) return;
      this.pick(e);
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("wheel", () => { this.vp.viewFrom = null; }, { passive: true });
    this.applySnap();
    this.attachGizmo();
  }
  detach() {
    if (!this.vp) return;
    this.gizmo.detach(); this.gizmo.getHelper().removeFromParent(); this.gizmo.dispose(); this.gizmo = null;
    this.vp.orbit.dispose(); this.vp.renderer.dispose(); this.vp.canvas.remove();
    this.vp = null;
    this.invalidateMaterials();
  }
  selNode() {
    if (!this.sel) return null;
    return this.sel.type === "projector" ? this.pnodes.get(this.sel.id) : this.nodes.get(this.sel.id);
  }
  attachGizmo() {
    if (!this.gizmo) return;
    this.sync();
    const n = this.selNode();
    const locked = this.sel?.type === "object" && this.data.objects.find(o => o.id === this.sel.id)?.locked;
    if (n && !locked) this.gizmo.attach(this.sel.type === "projector" ? n.cam : n.obj);
    else this.gizmo.detach();
  }
  setGizmoMode(m) { this.gizmo?.setMode(m); }
  applySnap() {
    const s = this.data.snap, g = this.gizmo;
    if (!g) return;
    const on = s.enabled && (s.mode === "grid" || s.mode === "increment");
    g.setTranslationSnap(on ? s.move : null);
    g.setRotationSnap(s.enabled ? s.rot * D2R : null);
    g.setScaleSnap(s.enabled ? s.scale : null);
  }
  /** Copia la transformación del gizmo a los datos del proyecto. */
  writeBack() {
    const sel = this.sel;
    if (!sel) return;
    const r3 = (v) => Math.round(v * 10000) / 10000;
    if (sel.type === "projector") {
      const p = this.data.projectors.find(x => x.id === sel.id), c = this.pnodes.get(sel.id)?.cam;
      if (!p || !c) return;
      const e = new THREE.Euler().setFromQuaternion(c.quaternion, "YXZ");
      p.pos = c.position.toArray().map(r3); p.rot = [e.x / D2R, e.y / D2R, e.z / D2R].map(r3);
    } else {
      const o = this.data.objects.find(x => x.id === sel.id), n = this.nodes.get(sel.id);
      if (!o || !n) return;
      const e = new THREE.Euler().setFromQuaternion(n.obj.quaternion, "YXZ");
      o.pos = n.obj.position.toArray().map(r3); o.rot = [e.x / D2R, e.y / D2R, e.z / D2R].map(r3); o.scale = n.obj.scale.toArray().map(r3);
    }
    this.app.S.dirty = true;
  }
  /** Snap a vértice, arista o cara al soltar el gizmo. */
  afterDrag() {
    const s = this.data.snap;
    if (!s.enabled || !["vertex", "edge", "face"].includes(s.mode) || this.sel?.type !== "object") return;
    const n = this.nodes.get(this.sel.id);
    if (!n) return;
    const mine = worldVertices(n.obj), others = [];
    for (const [id, o] of this.nodes) if (id !== this.sel.id && o.obj.visible) others.push(o.obj);
    if (!mine.length || !others.length) return;
    let best = null;
    const tol = Math.max(0.25, this.data.gridStep);
    if (s.mode === "vertex") {
      for (const o of others) for (const v of worldVertices(o)) for (const m of mine) {
        const dd = v.distanceTo(m);
        if (dd < tol && (!best || dd < best.d)) best = { d: dd, delta: v.clone().sub(m) };
      }
    } else if (s.mode === "edge") {
      for (const o of others) for (const [a, b] of worldEdges(o)) for (const m of mine) {
        const q = new THREE.Line3(a, b).closestPointToPoint(m, true, new THREE.Vector3()), dd = q.distanceTo(m);
        if (dd < tol && (!best || dd < best.d)) best = { d: dd, delta: q.sub(m) };
      }
    } else {
      // Cara: se apoya sobre la superficie que tiene debajo (rayo hacia abajo desde el punto más bajo).
      const box = new THREE.Box3().setFromObject(n.obj), c = box.getCenter(new THREE.Vector3());
      const ray = new THREE.Raycaster(new THREE.Vector3(c.x, box.min.y + 1e-3, c.z), new THREE.Vector3(0, -1, 0));
      const hit = ray.intersectObjects(others, true)[0];
      const floor = hit ? hit.point.y : 0;
      best = { d: 0, delta: new THREE.Vector3(0, floor - box.min.y, 0) };
    }
    if (best) {
      const parentInv = new THREE.Matrix4().copy(n.obj.parent.matrixWorld).invert();
      const wp = n.obj.getWorldPosition(new THREE.Vector3()).add(best.delta).applyMatrix4(parentInv);
      n.obj.position.copy(wp);
      this.writeBack();
    }
  }
  pick(e) {
    const vp = this.vp, rect = vp.canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1, y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    if (vp.split !== "none" && x > 0) return;   // en vista dividida solo se elige en la mitad izquierda
    const ray = new THREE.Raycaster();
    const cam = this.viewCamera();
    ray.setFromCamera(new THREE.Vector2(vp.split !== "none" ? x * 2 + 1 : x, y), cam);
    const targets = [...this.root.children, ...[...this.pnodes.values()].map(n => n.body)];
    const hit = ray.intersectObjects(targets, true).find(h => h.object.visible);
    if (!hit) { this.select(null); this.app.renderPanel(); return; }
    let o = hit.object;
    while (o && !o.userData.lumaId && !o.userData.lumaProj) o = o.parent;
    if (o?.userData.lumaProj) this.select("projector", o.userData.lumaProj);
    else if (o?.userData.lumaId) {
      // Si pertenece a un grupo, el primer clic elige el grupo.
      let id = o.userData.lumaId, data = this.data.objects.find(x => x.id === id);
      while (data?.parent && this.sel?.id !== data.parent && this.sel?.id !== id) { id = data.parent; data = this.data.objects.find(x => x.id === id); }
      this.select("object", id);
    }
    this.app.renderPanel();
  }
  viewCamera() {
    const vp = this.vp;
    if (vp.viewFrom) { const n = this.pnodes.get(vp.viewFrom); if (n) return n.cam; vp.viewFrom = null; }
    return vp.cam;
  }
  /** Vistas estándar (Numpad). */
  view(dir) {
    const vp = this.vp;
    if (!vp) return;
    vp.viewFrom = null;
    const t = vp.orbit.target, dist = Math.max(2, vp.persp.position.distanceTo(t));
    const v = { front: [0, 0, 1], back: [0, 0, -1], right: [1, 0, 0], left: [-1, 0, 0], top: [0, 1, 0], bottom: [0, -1, 0] }[dir];
    if (!v) return;
    for (const cam of [vp.persp, vp.ortho]) {
      cam.position.set(t.x + v[0] * dist, t.y + v[1] * dist, t.z + v[2] * dist);
      cam.up.set(0, dir === "top" ? 0 : dir === "bottom" ? 0 : 1, dir === "top" ? -1 : dir === "bottom" ? 1 : 0);
      cam.lookAt(t);
    }
    vp.orbit.update();
  }
  toggleOrtho() {
    const vp = this.vp;
    if (!vp) return;
    const from = vp.cam, to = vp.cam === vp.persp ? vp.ortho : vp.persp;
    to.position.copy(from.position); to.up.copy(from.up); to.quaternion.copy(from.quaternion);
    if (to === vp.ortho) { const d = from.position.distanceTo(vp.orbit.target); vp.ortho.userData.size = d * Math.tan(vp.persp.fov * D2R / 2); }
    vp.cam = to; vp.orbit.object = to; this.gizmo.camera = to; vp.orbit.update();
  }
  viewFromProjector(id) {
    const vp = this.vp;
    if (!vp) return;
    vp.viewFrom = id || this.data.projectors[0]?.id || null;
  }
  frameSelection() {
    const vp = this.vp, n = this.selNode();
    if (!vp) return;
    const obj = n ? (n.obj || n.cam) : this.root;
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3()), r = Math.max(0.5, box.getSize(new THREE.Vector3()).length());
    const dir = vp.cam.position.clone().sub(vp.orbit.target).normalize();
    vp.orbit.target.copy(c); vp.cam.position.copy(c.clone().add(dir.multiplyScalar(r * 1.6))); vp.orbit.update();
  }

  renderViewport() {
    const vp = this.vp, r = vp.renderer, W = vp.container.clientWidth, H = vp.container.clientHeight;
    if (!W || !H) return;
    if (vp.size[0] !== W || vp.size[1] !== H) { r.setSize(W, H, false); vp.canvas.style.width = W + "px"; vp.canvas.style.height = H + "px"; vp.size = [W, H]; }
    const mode = this.data.viewMode || "texture";
    const split = vp.split !== "none" && vp.split !== "mapping";
    const mainW = split ? Math.floor(W / 2) : W;
    // Cámara principal
    const cam = this.viewCamera();
    if (cam === vp.persp) { vp.persp.aspect = mainW / H; vp.persp.updateProjectionMatrix(); }
    else if (cam === vp.ortho) {
      const s = vp.ortho.userData.size || 3, a = mainW / H;
      Object.assign(vp.ortho, { left: -s * a, right: s * a, top: s, bottom: -s }); vp.ortho.updateProjectionMatrix();
    }
    r.setScissorTest(true);
    // Proyección: primero cada proyector pinta su imagen y su profundidad (para sombras).
    if (mode.startsWith("proj")) this.prepareProjection(r, mode === "projgrid");
    this.applyMaterials(mode.startsWith("proj") ? "proj" : mode);
    r.setViewport(0, 0, mainW, H); r.setScissor(0, 0, mainW, H);
    r.render(this.scene, cam);
    if (mode === "projwire") {
      this.applyMaterials("wireframe");
      const bg = this.scene.background; this.scene.background = null; r.autoClear = false;
      r.render(this.scene, cam);
      r.autoClear = true; this.scene.background = bg;
    }
    // Vista dividida: lo que ve el proyector elegido.
    if (split) {
      const id = (this.sel?.type === "projector" && this.sel.id) || this.data.projectors[0]?.id;
      const n = id && this.pnodes.get(id);
      r.setViewport(mainW, 0, W - mainW, H); r.setScissor(mainW, 0, W - mainW, H);
      if (n) {
        this.applyMaterials("texture");
        const helpers = [this.grid.visible, this.axes.visible]; this.grid.visible = this.axes.visible = false;
        for (const q of this.pnodes.values()) q.helper.visible = false;
        if (this.gizmo) this.gizmo.getHelper().visible = false;
        const bg = this.scene.background; this.scene.background = new THREE.Color(0);
        const a = n.cam.aspect;
        const vw = W - mainW, vh = H, fitW = Math.min(vw, vh * a), fitH = fitW / a;
        r.setViewport(mainW + (vw - fitW) / 2, (vh - fitH) / 2, fitW, fitH); r.setScissor(mainW, 0, vw, vh);
        r.setClearColor(0x05060a); r.clear();
        r.render(this.scene, n.cam);
        this.scene.background = bg; this.grid.visible = helpers[0]; this.axes.visible = helpers[1];
        for (const q of this.pnodes.values()) q.helper.visible = this.showHelpers !== false;
        if (this.gizmo) this.gizmo.getHelper().visible = true;
      } else { r.setClearColor(0x05060a); r.clear(); }
    }
    r.setScissorTest(false);
  }

  prepareProjection(r, grid) {
    const mat = this.projMaterial(), u = mat.uniforms;
    const projs = this.data.projectors.slice(0, 4);
    if (!this.projRT) this.projRT = new Map();
    this.applyMaterials("texture");
    const helpers = [this.grid.visible, this.axes.visible]; this.grid.visible = this.axes.visible = false;
    for (const q of this.pnodes.values()) { q.helper.visible = false; q.body.visible = false; }
    if (this.gizmo) this.gizmo.getHelper().visible = false;
    const bg = this.scene.background; this.scene.background = new THREE.Color(0);
    r.setScissorTest(false);
    projs.forEach((p, i) => {
      const n = this.pnodes.get(p.id);
      let rt = this.projRT.get(p.id);
      const w = Math.min(1024, p.res[0]), h = Math.round(w * p.res[1] / p.res[0]);
      if (!rt || rt.width !== w || rt.height !== h) {
        rt?.dispose();
        rt = new THREE.WebGLRenderTarget(w, h, { depthTexture: new THREE.DepthTexture(w, h) });
        rt.texture.colorSpace = THREE.SRGBColorSpace;
        this.projRT.set(p.id, rt);
      }
      r.setRenderTarget(rt); r.render(this.scene, n.cam);
      u["uPV" + i].value.multiplyMatrices(n.cam.projectionMatrix, n.cam.matrixWorldInverse);
      u["uPos" + i].value.copy(n.cam.getWorldPosition(new THREE.Vector3()));
      u["uMap" + i].value = rt.texture; u["uDep" + i].value = rt.depthTexture;
    });
    r.setRenderTarget(null);
    r.setScissorTest(true);
    u.uN.value = projs.length; u.uGrid.value = grid ? 1 : 0;
    this.scene.background = bg; this.grid.visible = helpers[0]; this.axes.visible = helpers[1];
    for (const q of this.pnodes.values()) { q.helper.visible = this.showHelpers !== false; q.body.visible = true; }
    if (this.gizmo) this.gizmo.getHelper().visible = true;
  }
}

function worldVertices(obj) {
  const out = [];
  obj.updateMatrixWorld(true);
  obj.traverse(c => {
    if (!c.isMesh) return;
    const pos = c.geometry.attributes.position, step = Math.max(1, Math.floor(pos.count / 400));
    for (let i = 0; i < pos.count; i += step) out.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(c.matrixWorld));
  });
  return out;
}
function worldEdges(obj) {
  const out = [];
  obj.updateMatrixWorld(true);
  obj.traverse(c => {
    if (!c.isMesh) return;
    const e = new THREE.EdgesGeometry(c.geometry, 30), p = e.attributes.position;
    for (let i = 0; i < p.count; i += 2) out.push([new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(c.matrixWorld), new THREE.Vector3().fromBufferAttribute(p, i + 1).applyMatrix4(c.matrixWorld)]);
    e.dispose();
  });
  return out;
}
