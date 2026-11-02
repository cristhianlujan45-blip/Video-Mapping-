// web/js/td/particles.js
// Simulación de partículas (como el Particle SOP / particlesGPU de TouchDesigner), en el
// procesador y sin three.js para poder probarla: nacen de un punto, una caja, una esfera, un
// anillo o los vértices de una geometría; las mueven la velocidad, la gravedad, el viento, la
// turbulencia, un atractor y el rozamiento; mueren al acabar su vida. El motor (engine.js) las
// dibuja como puntos suaves o como copias (instancias) de una geometría.

const EMITTERS = ["point", "box", "sphere", "ring", "geo"];
export const PARTICLE_EMITTERS = EMITTERS;

export class Particles {
  constructor(max = 5000) { this.alloc(max); this.acc = 0; this.burst = null; this.trigWas = false; this.time = 0; }
  alloc(max) {
    this.max = Math.max(1, max | 0);
    this.n = 0;
    this.pos = new Float32Array(this.max * 3);
    this.vel = new Float32Array(this.max * 3);
    this.age = new Float32Array(this.max);
    this.life = new Float32Array(this.max);
    this.col = new Float32Array(this.max * 3);    // color de cada una (para dibujar)
    this.alpha = new Float32Array(this.max);
    this.size = new Float32Array(this.max);
  }
  clear() { this.n = 0; this.acc = 0; }
  /** Una partícula nueva. src = vértices de la geometría de la entrada (x, y, z…) o null. */
  spawn(p, src) {
    if (this.n >= this.max) return;
    const k = this.n++, o = k * 3, R = Math.random;
    const kind = EMITTERS[p.emitter | 0] || "point", s = p.esize ?? 0.5;
    let x = 0, y = 0, z = 0;
    if (kind === "box") { x = (R() - 0.5) * s; y = (R() - 0.5) * s; z = (R() - 0.5) * s; }
    else if (kind === "sphere") { const u = unit(); x = u[0] * s; y = u[1] * s; z = u[2] * s; }
    else if (kind === "ring") { const a = R() * Math.PI * 2; x = Math.cos(a) * s; y = Math.sin(a) * s; }
    else if (kind === "geo" && src && src.length >= 3) { const v = ((R() * (src.length / 3)) | 0) * 3; x = src[v]; y = src[v + 1]; z = src[v + 2]; }
    this.pos[o] = (p.ex || 0) + x; this.pos[o + 1] = (p.ey || 0) + y; this.pos[o + 2] = (p.ez || 0) + z;
    // Dirección: la elegida, abierta hacia todos lados según «Apertura».
    let dx = p.dx ?? 0, dy = p.dy ?? 1, dz = p.dz ?? 0;
    const dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
    const u = unit(), sp = Math.max(0, Math.min(1, p.spread ?? 0.3));
    let vx = dx * (1 - sp) + u[0] * sp, vy = dy * (1 - sp) + u[1] * sp, vz = dz * (1 - sp) + u[2] * sp;
    const vl = Math.hypot(vx, vy, vz) || 1, speed = (p.speed ?? 1) * (1 + ((R() - 0.5) * 2) * (p.speedVar ?? 0.3));
    // Desde una esfera o un anillo también pueden salir hacia fuera.
    if ((kind === "sphere" || kind === "ring") && p.outward) { const l = Math.hypot(x, y, z) || 1; vx = x / l; vy = y / l; vz = z / l; }
    const k2 = (kind === "sphere" || kind === "ring") && p.outward ? 1 : 1 / vl;
    this.vel[o] = vx * k2 * speed; this.vel[o + 1] = vy * k2 * speed; this.vel[o + 2] = vz * k2 * speed;
    this.age[k] = 0;
    this.life[k] = Math.max(0.05, (p.life ?? 2) * (1 + ((R() - 0.5) * 2) * (p.lifeVar ?? 0.3)));
  }
  kill(k) {
    const last = --this.n;
    if (k === last) return;
    for (let a = 0; a < 3; a++) { this.pos[k * 3 + a] = this.pos[last * 3 + a]; this.vel[k * 3 + a] = this.vel[last * 3 + a]; }
    this.age[k] = this.age[last]; this.life[k] = this.life[last];
  }
  /**
   * Avanza dt segundos. p = parámetros del operador (ya calculados). src = vértices de la entrada.
   * c1/c2 = colores lineales [r, g, b] al nacer y al morir.
   */
  step(p, dt, src = null, c1 = [1, 1, 1], c2 = [1, 1, 1]) {
    dt = Math.max(0, Math.min(0.1, dt || 0));
    const want = Math.max(1, Math.min(200000, p.max | 0 || 5000));
    if (want !== this.max) this.alloc(want);
    this.time += dt;
    // Nacer: a ritmo constante + explosiones (botón o al pasar de 0,5 un canal como el golpe).
    if (p.play !== 0) {
      this.acc += Math.max(0, p.rate ?? 0) * dt;
      let born = Math.floor(this.acc);
      this.acc -= born;
      if (this.burst === null) this.burst = p.burst;
      if (p.burst !== this.burst) { this.burst = p.burst; born += Math.max(0, p.burstCount | 0); }
      const trig = (p.trig ?? 0) > 0.5;
      if (trig && !this.trigWas) born += Math.max(0, p.burstCount | 0);
      this.trigWas = trig;
      for (let j = 0; j < born && this.n < this.max; j++) this.spawn(p, src);
    }
    // Mover.
    const g = p.gravity ?? 0, wx = p.windx ?? 0, wy = p.windy ?? 0, wz = p.windz ?? 0, drag = Math.exp(-(p.drag ?? 0) * dt);
    const turb = p.turb ?? 0, ts = Math.max(0.01, p.turbScale ?? 1), att = p.attract ?? 0, ax = p.ax ?? 0, ay = p.ay ?? 0, az = p.az ?? 0;
    const T = this.time, P = this.pos, V = this.vel;
    for (let k = 0; k < this.n; k++) {
      this.age[k] += dt;
      if (this.age[k] >= this.life[k]) { this.kill(k); k--; continue; }
      const o = k * 3;
      let fx = wx, fy = g + wy, fz = wz;
      if (turb) {
        // Remolinos suaves (un campo de senos que se mueve): barato y sin tirones.
        const x = P[o] * ts, y = P[o + 1] * ts, z = P[o + 2] * ts;
        fx += turb * Math.sin(y * 1.7 + T * 0.9) * Math.cos(z * 1.3 - T * 0.6);
        fy += turb * Math.sin(z * 1.9 + T * 0.7) * Math.cos(x * 1.1 + T * 0.5);
        fz += turb * Math.sin(x * 1.5 - T * 0.8) * Math.cos(y * 1.7 + T * 0.4);
      }
      if (att) {
        const dx = ax - P[o], dy = ay - P[o + 1], dz = az - P[o + 2], d = Math.hypot(dx, dy, dz) + 0.05;
        fx += att * dx / d; fy += att * dy / d; fz += att * dz / d;
      }
      V[o] = (V[o] + fx * dt) * drag; V[o + 1] = (V[o + 1] + fy * dt) * drag; V[o + 2] = (V[o + 2] + fz * dt) * drag;
      P[o] += V[o] * dt; P[o + 1] += V[o + 1] * dt; P[o + 2] += V[o + 2] * dt;
      if (p.floor && P[o + 1] < (p.floorY ?? 0)) { P[o + 1] = p.floorY ?? 0; V[o + 1] = -V[o + 1] * (p.bounce ?? 0.5); }
    }
    // Color, opacidad y tamaño según la edad.
    const s0 = p.psize ?? 0.05, s1 = s0 * (p.sizeEnd ?? 0.3), fade = p.fade !== 0;
    for (let k = 0; k < this.n; k++) {
      const a = Math.min(1, this.age[k] / this.life[k]), o = k * 3;
      this.col[o] = c1[0] + (c2[0] - c1[0]) * a; this.col[o + 1] = c1[1] + (c2[1] - c1[1]) * a; this.col[o + 2] = c1[2] + (c2[2] - c1[2]) * a;
      this.alpha[k] = fade ? Math.min(1, this.age[k] * 10) * (1 - a) : 1;
      this.size[k] = s0 + (s1 - s0) * a;
    }
    return this.n;
  }
}

function unit() {
  const z = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - z * z);
  return [r * Math.cos(a), r * Math.sin(a), z];
}
