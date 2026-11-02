// web/js/td/viewer3d.js
// Visor 3D del editor de redes (como mirar un Render TOP en TouchDesigner y mover su cámara, pero
// con el gizmo de Blender): elegir un objeto con un clic, moverlo, girarlo o escalarlo con las
// flechas del gizmo (G, R, S), y mover la cámara arrastrando (girar alrededor), con el botón
// derecho o Mayús (desplazar) y con la rueda (acercar).
//   · «Cámara de la red»: lo que mueves es la Cámara 3D de la red (cambia lo que sale proyectado).
//   · «Vista libre»: una cámara solo del editor, con rejilla, ejes y dónde está la cámara de la red.
// Se carga solo al abrir el visor de un Render TOP (three.js no entra en el arranque de la app).
import { THREE } from "./engine.js";
import { TransformControls } from "../../vendor/three/addons/controls/TransformControls.js";
import { nodeById, nodeByName, addNode, isExpr } from "./graph.js";

const R3 = (v) => Math.round(v * 1000) / 1000;
const DEG = 180 / Math.PI;

export class View3D {
  /** o: { app, canvas, netId, nodeId (Render TOP), getSel(): id|null, onSelect(id|null), toast(msg) } */
  constructor(o) {
    Object.assign(this, o);
    this.mode = "cam";              // "cam" (cámara de la red) | "free" (vista libre)
    this.tool = "translate";        // translate | rotate | scale
    this.free = { cam: new THREE.PerspectiveCamera(50, 16 / 9, 0.01, 1000), look: [0, 0, 0], pos: [3.5, 2.5, 5] };
    this.overlay = new THREE.Scene();
    this.helpers = new THREE.Group();
    this.markers = new THREE.Group();
    const grid = new THREE.GridHelper(10, 20, 0x5a6478, 0x2a3040);
    grid.material.transparent = true; grid.material.opacity = 0.6;
    this.helpers.add(grid, new THREE.AxesHelper(0.6));
    this.overlay.add(this.markers);
    this.marks = new Map();          // nodo (luz / emisor) → marcador
    this.gizmo = new TransformControls(this.free.cam, this.canvas);
    this.gizmo.setSize(1.15);
    this.overlay.add(this.gizmo.getHelper());
    this.gizmo.addEventListener("objectChange", () => this.writeBack());
    this.gizmo.addEventListener("dragging-changed", (e) => { if (!e.value) { this.app.changed?.(); this.app.commitSoon?.(); this.onEdited?.(); } });
    this.attachedId = null;
    this.drag = null;
    this.warned = new Set();
    this.bind();
  }
  get eng() { return this.app.td; }
  get net() { return this.app.S.project.networks?.find(n => n.id === this.netId) || null; }
  get node() { return nodeById(this.net, this.nodeId); }
  activeCam() { return this.mode === "free" ? this.free.cam : (this.x?.cam || this.free.cam); }
  setMode(m) {
    this.mode = m;
    (m === "free" ? this.helpers : this.overlay).add(this.markers);
  }
  setTool(t) {
    this.tool = t;
    const n = nodeById(this.net, this.attachedId);
    this.gizmo.setMode(n && n.type !== "geo" ? "translate" : t);
  }

  /* ---------------- Ratón ---------------- */
  bind() {
    const C = this.canvas;
    C.addEventListener("contextmenu", (e) => e.preventDefault());
    C.addEventListener("pointerdown", (e) => {
      C.focus?.({ preventScroll: true });
      if (this.gizmo.dragging || this.gizmo.axis !== null) return;   // el gizmo se lo queda
      this.drag = { x: e.clientX, y: e.clientY, b: e.button, shift: e.shiftKey, moved: false };
      C.setPointerCapture?.(e.pointerId);
      e.stopPropagation();
    });
    C.addEventListener("pointermove", (e) => {
      const d = this.drag;
      if (!d) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < 4) return;
      d.moved = true; d.x = e.clientX; d.y = e.clientY;
      if (d.b === 2 || d.b === 1 || d.shift) this.pan(dx, dy); else this.orbit(dx, dy);
    });
    const up = (e) => {
      const d = this.drag; this.drag = null;
      if (!d) return;
      if (d.moved) { if (this.mode === "cam") { this.app.changed?.(); this.app.commitSoon?.(); this.onEdited?.(); } return; }
      if (d.b === 0) this.pick(e);
    };
    C.addEventListener("pointerup", up);
    C.addEventListener("pointercancel", () => { this.drag = null; });
    C.addEventListener("wheel", (e) => { e.preventDefault(); e.stopPropagation(); this.dolly(Math.exp(e.deltaY * 0.0012)); if (this.mode === "cam") { this.app.changed?.(); this.app.commitSoon?.(); } }, { passive: false });
  }
  pick(e) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = [((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)];
    const net = this.net, rn = this.node;
    if (!net || !rn) return;
    // Primero los marcadores (luces, emisores), luego los objetos.
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(...ndc), this.activeCam());
    const mk = ray.intersectObjects([...this.marks.values()], false)[0];
    const id = mk ? mk.object.userData.nodeId : this.eng.pick3d(net, rn, ndc, this.activeCam());
    this.onSelect?.(id || null);
  }

  /* ---------------- Cámara ---------------- */
  /** Posición y punto al que mira la cámara que se está moviendo: [pos, look, escribir()]. */
  camState() {
    if (this.mode === "free") { const F = this.free; return [F.pos, F.look, () => {}]; }
    const net = this.net, rn = this.node;
    let cn = (rn?.p.camera && nodeByName(net, rn.p.camera)) || net?.nodes.find(n => n.fam === "COMP" && n.type === "camera" && !n.bypass);
    if (!cn) {
      // Sin cámara en la red: se crea una (en la misma posición que la de por defecto).
      this.app.edit(() => { cn = addNode(net, "COMP", "camera", { x: rn.x, y: rn.y + 180, p: { tx: 0, ty: 0.6, tz: 4 } }); });
      this.toast?.(`Se creó ${cn.name}: la cámara de la red que estás moviendo`);
      this.onEdited?.(true);
    }
    const K = ["tx", "ty", "tz", "lookx", "looky", "lookz"];
    if (K.some(k => isExpr(cn.p[k]))) {
      if (!this.warned.has(cn.id)) { this.warned.add(cn.id); this.toast?.(`${cn.name} se mueve con expresiones (ƒx): quítalas para moverla a mano, o usa la «Vista libre»`); }
      return null;
    }
    const pos = [+cn.p.tx || 0, +cn.p.ty || 0, +cn.p.tz || 0], look = [+cn.p.lookx || 0, +cn.p.looky || 0, +cn.p.lookz || 0];
    return [pos, look, () => { [cn.p.tx, cn.p.ty, cn.p.tz] = pos.map(R3); [cn.p.lookx, cn.p.looky, cn.p.lookz] = look.map(R3); }];
  }
  orbit(dx, dy) {
    const st = this.camState(); if (!st) return;
    const [pos, look, write] = st;
    const o = [pos[0] - look[0], pos[1] - look[1], pos[2] - look[2]], r = Math.hypot(...o) || 1;
    let th = Math.atan2(o[0], o[2]), ph = Math.acos(Math.max(-1, Math.min(1, o[1] / r)));
    th -= dx * 0.008; ph = Math.max(0.05, Math.min(Math.PI - 0.05, ph - dy * 0.008));
    pos[0] = look[0] + r * Math.sin(ph) * Math.sin(th); pos[1] = look[1] + r * Math.cos(ph); pos[2] = look[2] + r * Math.sin(ph) * Math.cos(th);
    write();
  }
  pan(dx, dy) {
    const st = this.camState(); if (!st) return;
    const [pos, look, write] = st, cam = this.activeCam();
    cam.updateMatrixWorld();
    const e = cam.matrixWorld.elements, r = Math.hypot(pos[0] - look[0], pos[1] - look[1], pos[2] - look[2]) || 1, k = r * 0.0016;
    for (let a = 0; a < 3; a++) { const m = (-dx * e[a] + dy * e[4 + a]) * k; pos[a] += m; look[a] += m; }
    write();
  }
  dolly(f) {
    const st = this.camState(); if (!st) return;
    const [pos, look, write] = st;
    const o = [pos[0] - look[0], pos[1] - look[1], pos[2] - look[2]], r = Math.hypot(...o) || 1, nr = Math.max(0.05, Math.min(500, r * f));
    for (let a = 0; a < 3; a++) pos[a] = look[a] + o[a] * nr / r;
    write();
  }
  /** Encuadrar lo elegido (o todo). */
  frame() {
    const x = this.x; if (!x) return;
    const box = new THREE.Box3(), sel = x.objs.get(this.attachedId);
    for (const [id, o] of x.objs) if (!sel || id === this.attachedId) { o.updateMatrixWorld(); if (o.geometry) { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld)); } }
    if (box.isEmpty()) box.set(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
    const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()).length() || 2;
    const st = this.camState(); if (!st) return;
    const [pos, look, write] = st;
    const o = [pos[0] - look[0], pos[1] - look[1], pos[2] - look[2]], r = Math.hypot(...o) || 1, nr = size * 1.4;
    look[0] = c.x; look[1] = c.y; look[2] = c.z;
    for (let a = 0; a < 3; a++) pos[a] = look[a] + o[a] * nr / r;
    write();
    if (this.mode === "cam") { this.app.changed?.(); this.app.commitSoon?.(); this.onEdited?.(); }
  }

  /* ---------------- Gizmo ---------------- */
  /** Lo que el gizmo cambió → parámetros del nodo (los que tienen expresión no se tocan). */
  writeBack() {
    const net = this.net, n = nodeById(net, this.attachedId), o = this.gizmo.object;
    if (!n || !o) return;
    const set = (k, v) => {
      if (isExpr(n.p[k])) { if (!this.warned.has(n.id + k)) { this.warned.add(n.id + k); this.toast?.(`${n.name}.${k} tiene una expresión (ƒx): el gizmo no la cambia`); } return; }
      n.p[k] = R3(v);
    };
    if (n.type === "particles") { set("ex", o.position.x); set("ey", o.position.y); set("ez", o.position.z); }
    else if (n.type === "light") { set("tx", o.position.x); set("ty", o.position.y); set("tz", o.position.z); }
    else if (n.type === "geo") {
      const u = +n.p.scale || 1;
      set("tx", o.position.x); set("ty", o.position.y); set("tz", o.position.z);
      set("rx", o.rotation.x * DEG); set("ry", o.rotation.y * DEG); set("rz", o.rotation.z * DEG);
      set("sx", o.scale.x / u); set("sy", o.scale.y / u); set("sz", o.scale.z / u);
    }
    this.app.changed?.();
  }
  /** Marcadores de las luces y los emisores de partículas (se ven y se pueden elegir). */
  updateMarkers(net, x) {
    const want = new Map();
    for (const [id, L] of x.lights) want.set(id, ["light", L.position]);
    for (const [id, P] of x.proxies) want.set(id, ["emit", P.position]);
    for (const [id, m] of this.marks) if (!want.has(id)) { this.markers.remove(m); m.geometry.dispose(); m.material.dispose(); this.marks.delete(id); }
    for (const [id, [kind, p]] of want) {
      let m = this.marks.get(id);
      if (!m) {
        m = new THREE.Mesh(kind === "light" ? new THREE.OctahedronGeometry(0.12) : new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshBasicMaterial({ color: kind === "light" ? 0xffd23f : 0x00e5ff, wireframe: true, depthTest: false, transparent: true }));
        m.userData.nodeId = id; m.renderOrder = 10;
        this.marks.set(id, m); this.markers.add(m);
      }
      m.position.copy(p);
      m.material.opacity = id === this.attachedId ? 1 : 0.7;
    }
    void net;
  }

  /* ---------------- Dibujar ---------------- */
  draw(ctx, w, h) {
    const net = this.net, rn = this.node, eng = this.eng;
    if (!net || !rn || !eng) return false;
    const x = this.x = eng.scene3d(net, rn);
    if (!x) return false;
    this.updateMarkers(net, x);
    // Lo elegido en la red recibe el gizmo (Objeto 3D, luz o emisor de partículas).
    const sel = this.getSel?.();
    const sn = nodeById(net, sel);
    const want = sn && ["geo", "light", "particles"].includes(sn.type) ? sn.id : null;
    const obj = want ? eng.object3d(net, rn, want) : null;
    if (!this.gizmo.dragging) {
      if (!obj) { if (this.gizmo.object) this.gizmo.detach(); this.attachedId = null; }
      else if (this.gizmo.object !== obj) { this.gizmo.attach(obj); this.attachedId = want; this.setTool(this.tool); }
    }
    const cam = this.activeCam();
    this.gizmo.camera = cam;
    if (this.mode === "free") {
      // Dónde está la cámara de la red (con su campo de visión).
      // (una copia corta de la cámara: la de verdad llega a 500 m y taparía la vista)
      if (x.cam) {
        const pc = this.camProxy ||= x.cam.isPerspectiveCamera ? new THREE.PerspectiveCamera() : new THREE.OrthographicCamera();
        if (!!pc.isPerspectiveCamera !== !!x.cam.isPerspectiveCamera) { this.camProxy = null; return this.draw(ctx, w, h); }
        pc.position.copy(x.cam.position); pc.quaternion.copy(x.cam.quaternion);
        if (pc.isPerspectiveCamera) { pc.fov = x.cam.fov; pc.aspect = x.cam.aspect; } else { pc.left = x.cam.left; pc.right = x.cam.right; pc.top = x.cam.top; pc.bottom = x.cam.bottom; }
        pc.near = 0.05; pc.far = 2.5; pc.updateProjectionMatrix(); pc.updateMatrixWorld();
        if (!this.camHelper || this.camHelper.camera !== pc) { if (this.camHelper) { this.helpers.remove(this.camHelper); this.camHelper.dispose?.(); } this.camHelper = new THREE.CameraHelper(pc); this.helpers.add(this.camHelper); }
        this.camHelper.update();
      }
      const F = this.free;
      F.cam.position.set(...F.pos); F.cam.lookAt(...F.look); F.cam.aspect = w / h; F.cam.updateProjectionMatrix();
    }
    return eng.drawView3d(net, rn, ctx, w, h, { cam: this.mode === "free" ? this.free.cam : null, helpers: this.mode === "free" ? this.helpers : null, overlay: this.overlay });
  }
  /** Teclas del visor: G mover, R girar, S escalar, F encuadrar, Esc soltar. Devuelve true si la usó. */
  key(k) {
    const lk = k.toLowerCase();
    if (lk === "g") { this.setTool("translate"); return true; }
    if (lk === "r") { this.setTool("rotate"); return true; }
    if (lk === "s") { this.setTool("scale"); return true; }
    if (lk === "f") { this.frame(); return true; }
    return false;
  }
  /** Aspecto de la imagen que hay que respetar en «Cámara de la red» (null = el que quiera el visor). */
  aspect() { return this.mode === "cam" && this.x ? this.x.w / this.x.h : null; }
  dispose() {
    this.gizmo.detach(); this.gizmo.dispose();
    for (const m of this.marks.values()) { m.geometry.dispose(); m.material.dispose(); }
    this.helpers.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
  }
}
