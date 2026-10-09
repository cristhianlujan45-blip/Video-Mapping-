// web/js/render3d.js
// Dibuja las recetas de gen3d.js con three.js: materiales realistas (pintura con barniz,
// metal, cristal, goma, luces que brillan) con un entorno de estudio para los reflejos, o
// acabado «neón» (solo líneas) u «holograma azul». Fondo negro (en un holograma lo negro
// no se ve). Un solo contexto WebGL para todos los objetos; cada superficie copia su imagen.
let THREE = null;
export async function loadThree() {
  THREE = THREE || await import("../vendor/three/three.module.min.js");
  return THREE;
}
export const threeReady = () => !!THREE;

/* ---------------- Geometrías ---------------- */
function starShape(n = 5, outer = 0.5, inner = 0.21) {
  const s = new THREE.Shape();
  for (let i = 0; i <= n * 2; i++) {
    const a = Math.PI / 2 + i * Math.PI / n, r = i % 2 ? inner : outer;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    i ? s.lineTo(x, y) : s.moveTo(x, y);
  }
  return s;
}
function heartShape() {
  const s = new THREE.Shape(), k = 1 / 30;
  s.moveTo(0, -12 * k);
  s.bezierCurveTo(-4 * k, -8 * k, -15 * k, -3 * k, -15 * k, 4 * k);
  s.bezierCurveTo(-15 * k, 11 * k, -8 * k, 15 * k, -3.5 * k, 13 * k);
  s.bezierCurveTo(-1.5 * k, 12 * k, 0, 10 * k, 0, 8 * k);
  s.bezierCurveTo(0, 10 * k, 1.5 * k, 12 * k, 3.5 * k, 13 * k);
  s.bezierCurveTo(8 * k, 15 * k, 15 * k, 11 * k, 15 * k, 4 * k);
  s.bezierCurveTo(15 * k, -3 * k, 4 * k, -8 * k, 0, -12 * k);
  return s;
}
const extrude = (shape) => {
  const g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.03, bevelSegments: 4, curveSegments: 24 });
  g.center();
  const b = new THREE.Box3().setFromBufferAttribute(g.attributes.position), sz = b.getSize(new THREE.Vector3());
  g.scale(1 / sz.x, 1 / sz.y, 1 / sz.z);
  return g;
};
/** Texto 3D hecho de bloques (no necesita fuentes 3D): cada píxel de las letras es un cubo. */
function textVoxels(text, d) {
  const c = document.createElement("canvas"), ctx = c.getContext("2d");
  const font = "900 40px system-ui, Arial, sans-serif";
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 8, h = 52;
  c.width = w; c.height = h;
  ctx.font = font; ctx.fillStyle = "#fff"; ctx.textBaseline = "middle"; ctx.fillText(text, 4, h / 2);
  const data = ctx.getImageData(0, 0, w, h).data, step = 3, cells = [];
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) if (data[(y * w + x) * 4 + 3] > 128) cells.push([x, y]);
  const k = d[0] / w, mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(step * k * 0.92, step * k * 0.92, d[2]), null, Math.max(1, cells.length));
  const m = new THREE.Matrix4();
  cells.forEach(([x, y], i) => mesh.setMatrixAt(i, m.makeTranslation((x - w / 2) * k, (h / 2 - y) * k, 0)));
  mesh.count = cells.length;
  return mesh;
}
function geometry(q) {
  const seg = q.seg || 40;
  switch (q.s) {
    case "box": return new THREE.BoxGeometry(1, 1, 1);
    case "sphere": return new THREE.SphereGeometry(0.5, 40, 24);
    case "cylinder": return new THREE.CylinderGeometry(0.5, 0.5, 1, seg);
    case "cone": return new THREE.ConeGeometry(0.5, 1, seg);
    case "torus": return new THREE.TorusGeometry(0.5, Math.max(0.02, Math.min(0.25, q.d[2] / Math.max(0.01, q.d[0]) / 2)), 20, 56);
    case "capsule": return new THREE.CapsuleGeometry(0.5, 1, 8, 20);
    case "star": return extrude(starShape());
    case "heart": return extrude(heartShape());
    default: return new THREE.BoxGeometry(1, 1, 1);
  }
}
const SCALE = (q) => q.s === "torus" ? [q.d[0], q.d[1], q.d[0]] : q.s === "capsule" ? [q.d[0], q.d[1] / 2, q.d[2]] : q.d;

/* ---------------- Materiales ---------------- */
function material(q, finish) {
  const col = new THREE.Color(q.c);
  if (finish === "holo") return new THREE.MeshBasicMaterial({ color: q.m === "light" ? col : new THREE.Color("#7fe9ff"), transparent: true, opacity: q.m === "light" ? 0.95 : 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  if (finish === "neon") return new THREE.MeshBasicMaterial({ color: q.m === "light" ? col : new THREE.Color("#000000") });
  switch (q.m) {
    case "metal": return new THREE.MeshStandardMaterial({ color: col, metalness: 1, roughness: 0.22 });
    case "glass": return new THREE.MeshPhysicalMaterial({ color: col, metalness: 0, roughness: 0.04, transparent: true, opacity: 0.55, clearcoat: 1, envMapIntensity: 1.6 });
    case "rubber": return new THREE.MeshStandardMaterial({ color: col, metalness: 0, roughness: 0.92 });
    case "light": return new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(1.6), toneMapped: false });
    case "matte": return new THREE.MeshStandardMaterial({ color: col, metalness: 0.05, roughness: 0.75 });
    default: return new THREE.MeshPhysicalMaterial({ color: col, metalness: 0.35, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 });
  }
}

/** Objeto three.js de una receta (centrado en x/z y apoyado en y = 0). */
export function buildGroup(recipe, finish = "real") {
  const g = new THREE.Group();
  for (const q of recipe.parts || []) {
    let obj;
    if (q.s === "text") { obj = textVoxels(q.t || "HOLA", q.d); obj.material = material(q, finish); }
    else {
      obj = new THREE.Mesh(geometry(q), material(q, finish));
      obj.scale.set(...SCALE(q));
    }
    obj.position.set(...q.p);
    obj.rotation.set(...q.r.map(a => a * Math.PI / 180));
    g.add(obj);
    // Neón y holograma: las aristas de cada pieza como líneas de luz.
    if ((finish === "neon" || finish === "holo") && q.s !== "text" && q.m !== "light") {
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(obj.geometry, 25), new THREE.LineBasicMaterial({ color: finish === "holo" ? "#9ff6ff" : q.c, transparent: finish === "holo", opacity: 0.9 }));
      edges.position.copy(obj.position); edges.rotation.copy(obj.rotation); edges.scale.copy(obj.scale);
      g.add(edges);
    }
  }
  const box = new THREE.Box3().setFromObject(g), c = box.getCenter(new THREE.Vector3());
  g.children.forEach(ch => { ch.position.x -= c.x; ch.position.z -= c.z; ch.position.y -= box.min.y; });
  return g;
}

/* ---------------- Vista (un renderizador compartido) ---------------- */
const VIEW_ANGLES = { front: [0, 8], three: [35, 18], side: [90, 6], top: [20, 62] };
export class ModelView {
  constructor() {
    this.canvas = document.createElement("canvas");
    this.r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: "high-performance" });
    this.r.outputColorSpace = THREE.SRGBColorSpace;
    this.r.toneMapping = THREE.ACESFilmicToneMapping;
    this.r.toneMappingExposure = 1.1;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#000000");
    this.scene.environment = this.studio();
    this.scene.add(new THREE.HemisphereLight("#dfe8ff", "#1a1410", 0.55));
    const key = new THREE.DirectionalLight("#ffffff", 2.4); key.position.set(4, 7, 5); this.scene.add(key);
    const rim = new THREE.DirectionalLight("#9fc7ff", 1.4); rim.position.set(-5, 4, -4); this.scene.add(rim);
    this.camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.05, 200);
    this.cache = new Map();   // firma → { group, radius, center }
  }
  /** Estudio fotográfico sencillo para los reflejos (paneles de luz), generado aquí mismo. */
  studio() {
    const env = new THREE.Scene();
    env.add(new THREE.Mesh(new THREE.SphereGeometry(30, 32, 16), new THREE.MeshBasicMaterial({ color: "#20242c", side: THREE.BackSide })));
    const panel = (x, y, z, w, h, c) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 0, 0); env.add(m); };
    panel(0, 14, 0, 20, 20, "#ffffff"); panel(18, 6, 8, 10, 14, "#f4f7ff"); panel(-18, 4, -6, 8, 12, "#bcd4ff"); panel(0, 3, 20, 24, 4, "#ffffff");
    const pm = new THREE.PMREMGenerator(this.r);
    return pm.fromScene(env, 0.02).texture;
  }
  model(recipe, finish) {
    const sig = finish + "|" + JSON.stringify(recipe.parts);
    let e = this.cache.get(sig);
    if (!e) {
      if (this.cache.size > 12) { for (const v of this.cache.values()) v.group.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); }); this.cache.clear(); }
      const group = buildGroup(recipe, finish);
      const sphere = new THREE.Box3().setFromObject(group).getBoundingSphere(new THREE.Sphere());
      e = { group, radius: Math.max(0.1, sphere.radius), center: sphere.center };
      this.cache.set(sig, e);
    }
    return e;
  }
  /**
   * Dibuja el objeto y devuelve el lienzo. o = { t (s), spin (vueltas/10 s), view, yaw (grados), finish, zoom }
   */
  render(recipe, w, h, o = {}) {
    const e = this.model(recipe, o.finish || "real");
    if (this.canvas.width !== w || this.canvas.height !== h) this.r.setSize(w, h, false);
    this.scene.children.filter(c => c.userData.model).forEach(c => this.scene.remove(c));
    e.group.userData.model = true;
    e.group.rotation.y = ((o.yaw || 0) * Math.PI / 180) + (o.t || 0) * (o.spin ?? 1) * Math.PI * 2 / 10;
    this.scene.add(e.group);
    const [az, el] = VIEW_ANGLES[o.view] || VIEW_ANGLES.three;
    const cam = this.camera, aspect = w / h;
    cam.aspect = aspect;
    const fit = e.radius / Math.sin(cam.fov * Math.PI / 360) * (aspect < 1 ? 1 / aspect : 1) * 1.05 / (o.zoom || 1);
    const a = az * Math.PI / 180, b = el * Math.PI / 180;
    cam.position.set(e.center.x + Math.sin(a) * Math.cos(b) * fit, e.center.y + Math.sin(b) * fit, e.center.z + Math.cos(a) * Math.cos(b) * fit);
    cam.lookAt(e.center);
    cam.updateProjectionMatrix();
    this.r.render(this.scene, cam);
    return this.canvas;
  }
}
let shared = null;
export function modelView() { if (!THREE) return null; shared = shared || new ModelView(); return shared; }

/** Imagen de un objeto 3D por superficie (para el compositor): se vuelve a dibujar ~30 veces/s si gira. */
export class Model3DCache {
  constructor() { this.map = new Map(); this.loading = false; }
  get(key, src, aspect, t) {
    if (!THREE) { if (!this.loading) { this.loading = true; loadThree().catch(e => console.warn("3D", e)); } return null; }
    const mv = modelView();
    if (!mv || !src.model?.parts?.length) return null;
    const h = 720, w = Math.round(Math.max(240, Math.min(2048, h * aspect)));
    let e = this.map.get(key);
    if (!e) { e = { canvas: Object.assign(document.createElement("canvas"), { width: w, height: h }), sig: "", at: -1, version: 0 }; this.map.set(key, e); }
    const spin = src.spin ?? 1, sig = [JSON.stringify(src.model.parts), src.view, src.yaw, src.finish, src.zoom, w, h].join("|");
    const now = performance.now();
    if (e.sig === sig && (!spin || now - e.at < 33)) return e;
    if (e.canvas.width !== w || e.canvas.height !== h) { e.canvas.width = w; e.canvas.height = h; }
    const img = mv.render(src.model, w, h, { t, spin, view: src.view, yaw: src.yaw, finish: src.finish, zoom: src.zoom });
    e.canvas.getContext("2d").drawImage(img, 0, 0, w, h);
    e.sig = sig; e.at = now; e.version++;
    return e;
  }
}

/** Exporta el objeto a OBJ (texto) para el espacio 3D u otros programas. */
export function exportOBJ(recipe) {
  const g = buildGroup(recipe, "real");
  g.updateMatrixWorld(true);
  const out = [`# LumaMap · ${recipe.name || "Objeto 3D"}`, `o ${String(recipe.name || "Objeto").replace(/\s+/g, "_")}`];
  let base = 1;
  const v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3(), im = new THREE.Matrix4(), wm = new THREE.Matrix4();
  g.traverse(o => {
    if (!o.isMesh) return;
    const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry, pos = geo.attributes.position, nor = geo.attributes.normal;
    const copies = o.isInstancedMesh ? o.count : 1;
    for (let k = 0; k < copies; k++) {
      if (o.isInstancedMesh) { o.getMatrixAt(k, im); wm.multiplyMatrices(o.matrixWorld, im); } else wm.copy(o.matrixWorld);
      nm.getNormalMatrix(wm);
      for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(wm); out.push(`v ${v.x.toFixed(4)} ${v.y.toFixed(4)} ${v.z.toFixed(4)}`); }
      for (let i = 0; i < pos.count; i++) { n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize(); out.push(`vn ${n.x.toFixed(4)} ${n.y.toFixed(4)} ${n.z.toFixed(4)}`); }
      for (let i = 0; i < pos.count; i += 3) out.push(`f ${base + i}//${base + i} ${base + i + 1}//${base + i + 1} ${base + i + 2}//${base + i + 2}`);
      base += pos.count;
    }
  });
  return out.join("\n") + "\n";
}
