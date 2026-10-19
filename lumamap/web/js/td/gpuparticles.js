// web/js/td/gpuparticles.js
// Partículas calculadas en la tarjeta gráfica (como el particlesGPU de TouchDesigner): cada
// partícula es un píxel de dos imágenes de números con decimales (posición + edad, velocidad +
// vida) que se recalculan en cada fotograma con un shader, sin pasar por el procesador. Así caben
// cientos de miles (hasta 1 048 576 en el PC) a 60 fps. Mismos parámetros que las del procesador
// (particles.js): emisores, gravedad, viento, remolinos, imán, rozamiento, suelo, colores y tamaño.
//
// Cómo nacen: un anillo que avanza. Cada fotograma nacen las `rate·dt` partículas siguientes (más
// las de una explosión); la que nace reusa el sitio de la más vieja. El procesador solo lleva la
// cuenta (por dónde va el anillo), nunca lee la GPU.
import * as THREE from "../../vendor/three/three.module.min.js";

/** Lados de la imagen de partículas que se ofrecen (lado² partículas). */
export const GPU_SIZES = [128, 256, 512, 1024];
const MOBILE = typeof navigator !== "undefined" && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent || "");
export const gpuSizeFor = (want) => Math.min(MOBILE ? 256 : 1024, GPU_SIZES.includes(+want) ? +want : 256);

/** ¿Esta tarjeta puede guardar números con decimales en una imagen? (WebGL2 + EXT_color_buffer_float) */
export function gpuParticlesSupported(renderer) {
  try { return !!renderer.capabilities.isWebGL2 && renderer.extensions.has("EXT_color_buffer_float"); } catch { return false; }
}

// Funciones comunes a las dos pasadas: azar por partícula y dónde/cómo nace.
const COMMON = `
uniform sampler2D tGeo; uniform float uGeoN; uniform float uGeoW;
uniform float uStart; uniform float uCount; uniform float uN; uniform float uSeed; uniform float uDt;
uniform float uEmitter; uniform vec3 uE; uniform float uESize; uniform vec3 uDir; uniform float uSpread; uniform float uOutward;
uniform float uSpeed; uniform float uSpeedVar; uniform float uLife; uniform float uLifeVar;
uint hashU(uint x) { x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u; return x; }
float rnd(float idx, float k) { return float(hashU(uint(idx) * 1664525u + uint(uSeed) * 22695477u + uint(k) * 2654435761u)) / 4294967295.0; }
vec3 unitR(float idx, float k) { float z = rnd(idx, k) * 2.0 - 1.0, a = rnd(idx, k + 1.0) * 6.2831853, r = sqrt(max(0.0, 1.0 - z * z)); return vec3(r * cos(a), r * sin(a), z); }
float pIndex() { return floor(gl_FragCoord.y) * res.x + floor(gl_FragCoord.x); }
bool born(float idx) { return mod(idx - uStart + uN, uN) < uCount; }
// Posición relativa al emisor al nacer.
vec3 spawnOff(float idx) {
  int kind = int(uEmitter + 0.5); float s = uESize;
  if (kind == 1) return (vec3(rnd(idx, 1.0), rnd(idx, 2.0), rnd(idx, 3.0)) - 0.5) * s;
  if (kind == 2) return unitR(idx, 4.0) * s;
  if (kind == 3) { float a = rnd(idx, 6.0) * 6.2831853; return vec3(cos(a), sin(a), 0.0) * s; }
  if (kind == 4 && uGeoN > 0.5) { float v = floor(rnd(idx, 7.0) * uGeoN); vec2 q = (vec2(mod(v, uGeoW), floor(v / uGeoW)) + 0.5) / vec2(uGeoW, ceil(uGeoN / uGeoW)); return texture(tGeo, q).xyz - uE; }
  return vec3(0.0);
}
`;
// Velocidad (xyz) y vida (w).
const VEL = `${COMMON}
uniform float uGravity; uniform vec3 uWind; uniform float uDrag; uniform float uTurb; uniform float uTurbScale; uniform float uAttract; uniform vec3 uA;
uniform float uFloor; uniform float uFloorY; uniform float uBounce;
void main() {
  float idx = pIndex();
  vec4 P = texture(s0, vUv), V = texture(s1, vUv);
  if (born(idx)) {
    vec3 off = spawnOff(idx);
    vec3 d = length(uDir) > 0.0 ? normalize(uDir) : vec3(0.0, 1.0, 0.0);
    vec3 v = d * (1.0 - uSpread) + unitR(idx, 9.0) * uSpread;
    int kind = int(uEmitter + 0.5);
    if ((kind == 2 || kind == 3) && uOutward > 0.5 && length(off) > 0.0) v = normalize(off); else v = normalize(v + 1e-6);
    float sp = uSpeed * (1.0 + (rnd(idx, 11.0) * 2.0 - 1.0) * uSpeedVar);
    float life = max(0.05, uLife * (1.0 + (rnd(idx, 12.0) * 2.0 - 1.0) * uLifeVar));
    fragColor = vec4(v * sp, life); return;
  }
  if (P.w >= V.w) { fragColor = V; return; }      // muerta: espera su turno
  vec3 p = P.xyz, f = uWind + vec3(0.0, uGravity, 0.0);
  if (uTurb != 0.0) {
    // Remolinos suaves (los mismos que en el procesador).
    vec3 q = p * uTurbScale; float T = time;
    f += uTurb * vec3(sin(q.y * 1.7 + T * 0.9) * cos(q.z * 1.3 - T * 0.6), sin(q.z * 1.9 + T * 0.7) * cos(q.x * 1.1 + T * 0.5), sin(q.x * 1.5 - T * 0.8) * cos(q.y * 1.7 + T * 0.4));
  }
  if (uAttract != 0.0) { vec3 d = uA - p; f += uAttract * d / (length(d) + 0.05); }
  vec3 v = (V.xyz + f * uDt) * exp(-uDrag * uDt);
  if (uFloor > 0.5 && p.y + v.y * uDt < uFloorY && v.y < 0.0) v.y = -v.y * uBounce;
  fragColor = vec4(v, V.w);
}`;
// Posición (xyz) y edad (w).
const POS = `${COMMON}
uniform float uFloor; uniform float uFloorY;
void main() {
  float idx = pIndex();
  vec4 P = texture(s0, vUv), V = texture(s1, vUv);
  if (born(idx)) { fragColor = vec4(uE + spawnOff(idx), 0.0); return; }
  if (P.w >= V.w) { fragColor = P; return; }
  vec3 p = P.xyz + V.xyz * uDt;
  if (uFloor > 0.5) p.y = max(p.y, uFloorY);
  fragColor = vec4(p, P.w + uDt);
}`;

/** Una nube de partículas en la GPU de un nodo. */
export class GpuParticles {
  /** eng = el motor de la red (NetEngine): sus pasadas de shader y su renderer. */
  constructor(eng, size) {
    this.eng = eng; this.size = size; this.N = size * size;
    const mk = () => {
      const rt = new THREE.WebGLRenderTarget(size, size, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, stencilBuffer: false, generateMipmaps: false });
      rt.texture.wrapS = rt.texture.wrapT = THREE.ClampToEdgeWrapping;
      return rt;
    };
    this.pos = [mk(), mk()]; this.vel = [mk(), mk()]; this.cur = 0;
    // Empiezan todas muertas (edad 0 = vida 0).
    for (const rt of [...this.pos, ...this.vel]) { eng.r.setRenderTarget(rt); eng.r.setClearColor(0x000000, 0); eng.r.clear(true, false, false); }
    eng.r.setClearColor(0x000000, 1);
    this.cursor = 0; this.acc = 0; this.burst = null; this.trigWas = false; this.alive = 0; this.seed = 1;
    this.geoTex = null; this.geoSig = "";
    this.points = this.makePoints();
  }
  makePoints() {
    const S = this.size, ref = new Float32Array(this.N * 2);
    for (let k = 0; k < this.N; k++) { ref[k * 2] = ((k % S) + 0.5) / S; ref[k * 2 + 1] = (Math.floor(k / S) + 0.5) / S; }
    const G = new THREE.BufferGeometry();
    G.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.N * 3), 3));   // no se usa: la posición sale de la imagen
    G.setAttribute("ref", new THREE.BufferAttribute(ref, 2));
    const M = new THREE.ShaderMaterial({
      uniforms: { tPos: { value: null }, tVel: { value: null }, uScale: { value: 360 }, uSoft: { value: 1 }, uS0: { value: 0.05 }, uS1: { value: 0.015 },
        uC1: { value: new THREE.Color() }, uC2: { value: new THREE.Color() }, uFade: { value: 1 } },
      vertexShader: `attribute vec2 ref; uniform sampler2D tPos; uniform sampler2D tVel; uniform float uScale; uniform float uS0; uniform float uS1; uniform vec3 uC1; uniform vec3 uC2; uniform float uFade;
        varying vec3 vC; varying float vA;
        void main() {
          vec4 P = texture2D(tPos, ref), V = texture2D(tVel, ref);
          if (P.w >= V.w) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vA = 0.0; vC = vec3(0.0); return; }
          float a = clamp(P.w / max(V.w, 1e-4), 0.0, 1.0);
          vC = mix(uC1, uC2, a); vA = uFade > 0.5 ? min(1.0, P.w * 10.0) * (1.0 - a) : 1.0;
          vec4 mv = modelViewMatrix * vec4(P.xyz, 1.0); gl_Position = projectionMatrix * mv;
          float k = projectionMatrix[3][3] > 0.5 ? projectionMatrix[1][1] : projectionMatrix[1][1] / max(0.001, -mv.z);
          gl_PointSize = clamp(mix(uS0, uS1, a) * k * uScale, 1.0, 256.0);
        }`,
      fragmentShader: `uniform float uSoft; varying vec3 vC; varying float vA;
        void main() { vec2 q = gl_PointCoord * 2.0 - 1.0; float d = dot(q, q); if (d > 1.0 || vA <= 0.0) discard;
          float a = uSoft > 0.5 ? exp(-d * 3.5) : 1.0 - smoothstep(0.8, 1.0, d); gl_FragColor = vec4(vC, a * vA); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const o = new THREE.Points(G, M);
    o.frustumCulled = false;
    return o;
  }
  /** Vértices de la geometría conectada en una imagen (para «Nacen de la geometría»). */
  setGeometry(posArray) {
    const n = posArray ? Math.floor(posArray.length / 3) : 0;
    const sig = n ? n + ":" + posArray[0] + ":" + posArray[posArray.length - 1] : "";
    if (sig === this.geoSig) return;
    this.geoSig = sig;
    this.geoTex?.dispose(); this.geoTex = null; this.geoN = 0;
    if (!n) return;
    const W = Math.min(4096, n), H = Math.ceil(n / W), d = new Float32Array(W * H * 4);
    for (let k = 0; k < n; k++) { d[k * 4] = posArray[k * 3]; d[k * 4 + 1] = posArray[k * 3 + 1]; d[k * 4 + 2] = posArray[k * 3 + 2]; d[k * 4 + 3] = 1; }
    this.geoTex = new THREE.DataTexture(d, W, H, THREE.RGBAFormat, THREE.FloatType);
    this.geoTex.minFilter = this.geoTex.magFilter = THREE.NearestFilter; this.geoTex.needsUpdate = true;
    this.geoN = n; this.geoW = W;
  }
  /** Avanza dt segundos (p = parámetros del operador ya calculados; c1/c2 colores lineales). */
  step(p, dt, time, c1, c2) {
    dt = Math.max(0, Math.min(0.1, dt || 0));
    // Cuántas nacen: a ritmo constante + explosiones (botón o al pasar de 0,5 un canal).
    let born = 0;
    if (p.play !== 0) {
      this.acc += Math.max(0, p.rate ?? 0) * dt;
      born = Math.floor(this.acc); this.acc -= born;
      if (this.burst === null) this.burst = p.burst;
      if (p.burst !== this.burst) { this.burst = p.burst; born += Math.max(0, p.burstCount | 0); }
      const trig = (p.trig ?? 0) > 0.5;
      if (trig && !this.trigWas) born += Math.max(0, p.burstCount | 0);
      this.trigWas = trig;
    }
    born = Math.min(born, this.N);
    const eng = this.eng, a = this.cur, b = 1 - a;
    this.seed = (this.seed * 1103515245 + 12345) % 2147483647;
    const common = {
      tGeo: this.geoTex || eng.black, uGeoN: this.geoN || 0, uGeoW: this.geoW || 1,
      uStart: this.cursor, uCount: born, uN: this.N, uSeed: this.seed % 1000003, uDt: dt,
      uEmitter: p.emitter | 0, uE: new THREE.Vector3(p.ex || 0, p.ey || 0, p.ez || 0), uESize: p.esize ?? 0.5,
      uDir: new THREE.Vector3(p.dx ?? 0, p.dy ?? 1, p.dz ?? 0), uSpread: Math.max(0, Math.min(1, p.spread ?? 0.3)), uOutward: p.outward ? 1 : 0,
      uSpeed: p.speed ?? 1, uSpeedVar: p.speedVar ?? 0.3, uLife: p.life ?? 2, uLifeVar: p.lifeVar ?? 0.3,
      uFloor: p.floor ? 1 : 0, uFloorY: p.floorY ?? 0,
    };
    eng.pass(eng.mat("gpuparticles:vel", `${eng.HEAD_SRC}${VEL}`), this.vel[b], { ...common, s0: this.pos[a].texture, s1: this.vel[a].texture,
      uGravity: p.gravity ?? 0, uWind: new THREE.Vector3(p.windx ?? 0, p.windy ?? 0, p.windz ?? 0), uDrag: p.drag ?? 0,
      uTurb: p.turb ?? 0, uTurbScale: Math.max(0.01, p.turbScale ?? 1), uAttract: p.attract ?? 0, uA: new THREE.Vector3(p.ax ?? 0, p.ay ?? 0, p.az ?? 0), uBounce: p.bounce ?? 0.5 });
    eng.pass(eng.mat("gpuparticles:pos", `${eng.HEAD_SRC}${POS}`), this.pos[b], { ...common, s0: this.pos[a].texture, s1: this.vel[b].texture });
    this.cur = b;
    this.cursor = (this.cursor + born) % this.N;
    // Cuántas viven (aproximado, sin leer la GPU): las nacidas en la última «vida».
    const life = Math.max(0.05, p.life ?? 2);
    this.alive = Math.min(this.N, Math.round(this.alive * Math.exp(-dt / life) + born));
    // Dibujo
    const U = this.points.material.uniforms;
    U.tPos.value = this.pos[b].texture; U.tVel.value = this.vel[b].texture;
    U.uS0.value = p.psize ?? 0.05; U.uS1.value = (p.psize ?? 0.05) * (p.sizeEnd ?? 0.3);
    U.uC1.value.setRGB(c1[0], c1[1], c1[2]); U.uC2.value.setRGB(c2[0], c2[1], c2[2]); U.uFade.value = p.fade !== 0 ? 1 : 0;
    void time;
    return this.alive;
  }
  dispose() {
    for (const rt of [...this.pos, ...this.vel]) rt.dispose();
    this.geoTex?.dispose();
    this.points.geometry.dispose(); this.points.material.dispose();
  }
}
