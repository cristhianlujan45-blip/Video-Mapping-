// web/js/calib3d.js
// Calibrar un proyector virtual con el proyector REAL por puntos (como CamSchnappr de
// TouchDesigner): se eligen esquinas del objeto 3D y se dice dónde caen en la imagen del
// proyector real; de ahí sale dónde está el proyector, hacia dónde mira, su lente (FOV) y
// su desplazamiento de lente. Matemática pura (sin three.js) para poder probarla.
//
//  · Con 6 puntos o más: DLT (transformación lineal directa) para un primer cálculo sin
//    pistas, y luego mínimos cuadrados (Levenberg-Marquardt) con el modelo exacto de
//    cámara que usa el visor (mismo FOV, aspecto y lens shift que three.js).
//  · Con 4-5 puntos y la lente conocida (por la relación de proyección): solo posición y giro.
//
// Coordenadas de imagen: u, v de 0 a 1 (u a la derecha, v hacia abajo) sobre la imagen del proyector.

const D2R = Math.PI / 180, R2D = 180 / Math.PI;

/** Matriz de giro (filas) de los ángulos en grados con el orden «YXZ» de three.js. */
export function eulerToMat(rot) {
  const [x, y, z] = rot.map(v => v * D2R);
  const a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z);
  const ce = c * e, cf = c * f, de = d * e, df = d * f;
  return [
    [ce + df * b, de * b - cf, a * d],
    [a * f, a * e, -b],
    [cf * b - de, df + ce * b, a * c],
  ];
}
/** Ángulos «YXZ» (grados) de una matriz de giro (filas), como Euler.setFromRotationMatrix de three.js. */
export function matToEuler(m) {
  const x = Math.asin(-Math.max(-1, Math.min(1, m[1][2])));
  let y, z;
  if (Math.abs(m[1][2]) < 0.9999999) { y = Math.atan2(m[0][2], m[2][2]); z = Math.atan2(m[1][0], m[1][1]); }
  else { y = Math.atan2(-m[2][0], m[0][0]); z = 0; }
  return [x * R2D, y * R2D, z * R2D];
}

/**
 * Dónde cae un punto 3D en la imagen del proyector: [u, v] (0..1) o null si está detrás.
 * proj: { pos[3], rot[3] (grados, YXZ), fov (vertical, grados), res[2], shift[2] }.
 */
export function projectPoint(proj, X) {
  const R = eulerToMat(proj.rot), d = [X[0] - proj.pos[0], X[1] - proj.pos[1], X[2] - proj.pos[2]];
  // Coordenadas de la cámara (three.js: x derecha, y arriba, mira hacia -z) = Rᵀ · d.
  const xc = R[0][0] * d[0] + R[1][0] * d[1] + R[2][0] * d[2];
  const yc = R[0][1] * d[0] + R[1][1] * d[1] + R[2][1] * d[2];
  const zc = R[0][2] * d[0] + R[1][2] * d[1] + R[2][2] * d[2];
  if (zc > -1e-6) return null;
  const t = Math.tan(proj.fov * D2R / 2), aspect = proj.res[0] / proj.res[1];
  const sx = proj.shift?.[0] || 0, sy = proj.shift?.[1] || 0;
  return [0.5 + sx + (xc / -zc) / (2 * aspect * t), 0.5 - sy - (yc / -zc) / (2 * t)];
}

/** FOV vertical (grados) de la relación de proyección (distancia ÷ ancho de la imagen). */
export function fovFromThrow(ratio, res) {
  const hf = 2 * Math.atan(1 / (2 * Math.max(0.05, ratio)));
  return 2 * Math.atan(Math.tan(hf / 2) * res[1] / res[0]) * R2D;
}
/** Relación de proyección de un FOV vertical. */
export function throwFromFov(fov, res) {
  const hf = 2 * Math.atan(Math.tan(fov * D2R / 2) * res[0] / res[1]);
  return 1 / (2 * Math.tan(hf / 2));
}

/* ---------------- Álgebra pequeña ---------------- */
/** Autovalores/autovectores de una matriz simétrica (Jacobi). Devuelve { values, vectors (columnas) }. */
function jacobiEigen(A) {
  const n = A.length, a = A.map(r => r.slice()), V = a.map((_, i) => a.map((_, j) => +(i === j)));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] * a[p][q];
    if (off < 1e-22) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(a[p][q]) < 1e-300) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
      for (let k = 0; k < n; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
      for (let k = 0; k < n; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; }
    }
  }
  return { values: a.map((r, i) => r[i]), vectors: V };
}
/** Resuelve A·x = b (eliminación de Gauss con pivote). null si es singular. */
function solveLinear(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-14) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = s / M[r][r]; }
  return x;
}
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const norm3 = (a) => Math.hypot(a[0], a[1], a[2]);
function det3(m) { return m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]); }

/**
 * Primer cálculo sin pistas (DLT, ≥ 6 puntos que no estén todos en un plano):
 * la matriz de proyección y de ella posición, giro, FOV y lens shift.
 */
export function dlt(points, res) {
  if (points.length < 6) return null;
  const W = res[0], H = res[1];
  const P3 = points.map(p => p.w), P2 = points.map(p => [p.uv[0] * W, p.uv[1] * H]);
  // Normalización de Hartley (estabilidad numérica).
  const c3 = [0, 1, 2].map(i => P3.reduce((s, p) => s + p[i], 0) / P3.length);
  const s3 = Math.sqrt(3) / (P3.reduce((s, p) => s + norm3(sub3(p, c3)), 0) / P3.length || 1);
  const c2 = [0, 1].map(i => P2.reduce((s, p) => s + p[i], 0) / P2.length);
  const s2 = Math.SQRT2 / (P2.reduce((s, p) => s + Math.hypot(p[0] - c2[0], p[1] - c2[1]), 0) / P2.length || 1);
  const rows = [];
  points.forEach((_, i) => {
    const [X, Y, Z] = sub3(P3[i], c3).map(v => v * s3), u = (P2[i][0] - c2[0]) * s2, v = (P2[i][1] - c2[1]) * s2;
    rows.push([X, Y, Z, 1, 0, 0, 0, 0, -u * X, -u * Y, -u * Z, -u], [0, 0, 0, 0, X, Y, Z, 1, -v * X, -v * Y, -v * Z, -v]);
  });
  const AtA = Array.from({ length: 12 }, (_, i) => Array.from({ length: 12 }, (_, j) => rows.reduce((s, r) => s + r[i] * r[j], 0)));
  const { values, vectors } = jacobiEigen(AtA);
  const k = values.indexOf(Math.min(...values));
  const pn = vectors.map(r => r[k]);
  let Pn = [pn.slice(0, 4), pn.slice(4, 8), pn.slice(8, 12)];
  // Deshacer la normalización: P = T2⁻¹ · Pn · T3.
  const T3 = [[s3, 0, 0, -s3 * c3[0]], [0, s3, 0, -s3 * c3[1]], [0, 0, s3, -s3 * c3[2]], [0, 0, 0, 1]];
  const T2i = [[1 / s2, 0, c2[0]], [0, 1 / s2, c2[1]], [0, 0, 1]];
  const PT = Pn.map(r => [0, 1, 2, 3].map(j => r.reduce((s, v, k2) => s + v * T3[k2][j], 0)));
  let P = T2i.map(r => [0, 1, 2, 3].map(j => r.reduce((s, v, k2) => s + v * PT[k2][j], 0)));
  let Mx = P.map(r => r.slice(0, 3));
  if (det3(Mx) < 0) { P = P.map(r => r.map(v => -v)); Mx = P.map(r => r.slice(0, 3)); }
  // Centro del proyector: C = -M⁻¹ · p4.
  const C = solveLinear(Mx, P.map(r => -r[3]));
  if (!C) return null;
  // M = K · R (descomposición RQ por filas): R con x a la derecha, y hacia abajo, z hacia delante.
  const m1 = Mx[0], m2 = Mx[1], m3 = Mx[2];
  const k33 = norm3(m3), r3 = scale3(m3, 1 / k33);
  const cy = dot3(m2, r3), m2p = sub3(m2, scale3(r3, cy)), fy = norm3(m2p), r2 = scale3(m2p, 1 / fy);
  const cx = dot3(m1, r3), sk = dot3(m1, r2), m1p = sub3(sub3(m1, scale3(r2, sk)), scale3(r3, cx)), fx = norm3(m1p), r1 = scale3(m1p, 1 / fx);
  const f = (fx + fy) / 2 / k33, px = cx / k33, py = cy / k33;
  // Giro de la cámara de three.js al mundo: (D · R)ᵀ con D = diag(1, -1, -1).
  const Rcv = [r1, r2, r3], Rw = [0, 1, 2].map(i => [Rcv[0][i], -Rcv[1][i], -Rcv[2][i]]);
  return { pos: C, rot: matToEuler(Rw), fov: 2 * Math.atan(H / 2 / (fy / k33)) * R2D, shift: [px / W - 0.5, 0.5 - py / H], fxfy: f };
}

/* ---------------- Ajuste fino (Levenberg-Marquardt) ---------------- */
const pack = (p, fixLens) => fixLens ? [...p.pos, ...p.rot] : [...p.pos, ...p.rot, p.fov, p.shift[0], p.shift[1]];
const unpack = (x, base, fixLens) => ({ ...base, pos: x.slice(0, 3), rot: x.slice(3, 6), fov: fixLens ? base.fov : Math.max(1, Math.min(170, x[6])), shift: fixLens ? base.shift : [x[7], x[8]] });
function residuals(proj, points) {
  const W = proj.res[0], H = proj.res[1], out = [];
  for (const p of points) {
    const uv = projectPoint(proj, p.w);
    if (!uv) { out.push(W, H); continue; }   // detrás del proyector: castigo grande
    out.push((uv[0] - p.uv[0]) * W, (uv[1] - p.uv[1]) * H);
  }
  return out;
}
const sq = (r) => r.reduce((s, v) => s + v * v, 0);

function refine(start, points, fixLens) {
  let x = pack(start, fixLens), r = residuals(unpack(x, start, fixLens), points), cost = sq(r), lambda = 1e-3;
  const span = Math.max(1e-3, ...points.map(p => norm3(sub3(p.w, start.pos))));
  const steps = [span * 1e-5, span * 1e-5, span * 1e-5, 1e-4, 1e-4, 1e-4, 1e-4, 1e-6, 1e-6];
  for (let it = 0; it < 300 && cost > 1e-12; it++) {
    const m = x.length, n = r.length;
    const J = Array.from({ length: n }, () => new Array(m).fill(0));
    for (let j = 0; j < m; j++) {
      const xj = x.slice(); xj[j] += steps[j];
      const rj = residuals(unpack(xj, start, fixLens), points);
      for (let i = 0; i < n; i++) J[i][j] = (rj[i] - r[i]) / steps[j];
    }
    const JtJ = Array.from({ length: m }, (_, a) => Array.from({ length: m }, (_, b) => J.reduce((s, row) => s + row[a] * row[b], 0)));
    const g = Array.from({ length: m }, (_, a) => J.reduce((s, row, i) => s + row[a] * r[i], 0));
    let improved = false;
    for (let tries = 0; tries < 12 && !improved; tries++) {
      const A = JtJ.map((row, a) => row.map((v, b) => a === b ? v * (1 + lambda) + 1e-12 : v));
      const dx = solveLinear(A, g.map(v => -v));
      if (!dx) { lambda *= 10; continue; }
      const xn = x.map((v, i) => v + dx[i]), rn = residuals(unpack(xn, start, fixLens), points), cn = sq(rn);
      if (cn < cost) {
        const done = cost - cn < 1e-10 * cost;
        x = xn; r = rn; cost = cn; lambda = Math.max(1e-9, lambda / 3); improved = true;
        if (done) it = 1e9;
      } else lambda *= 4;
    }
    if (!improved) break;
  }
  return { proj: unpack(x, start, fixLens), cost };
}

/**
 * Calibra: { ok, proj, rms (px), errors[] (px por punto), used: "dlt"|"actual" } o { ok:false, why }.
 * current: el proyector como está ahora (punto de partida). fixLens: no tocar FOV ni lens shift.
 */
export function calibrate(points, current, { fixLens = false } = {}) {
  const pts = points.filter(p => p && Array.isArray(p.w) && Array.isArray(p.uv));
  const need = fixLens ? 4 : 6;
  if (pts.length < need) return { ok: false, why: `Faltan puntos: hacen falta ${need}${fixLens ? " (con la lente fija)" : " (o 4 si fijas la lente)"} y hay ${pts.length}.` };
  const base = { pos: [...current.pos], rot: [...current.rot], fov: current.fov, res: [...current.res], shift: [...(current.shift || [0, 0])] };
  const tries = [{ start: base, used: "actual" }];
  if (!fixLens) { const d = dlt(pts, base.res); if (d && d.pos.every(Number.isFinite) && d.rot.every(Number.isFinite) && Number.isFinite(d.fov)) tries.push({ start: { ...base, ...d, res: base.res }, used: "dlt" }); }
  let best = null;
  for (const t of tries) { const r = refine(t.start, pts, fixLens); if (!best || r.cost < best.cost) best = { ...r, used: t.used }; }
  const errs = [];
  const rr = residuals(best.proj, pts);
  for (let i = 0; i < rr.length; i += 2) errs.push(Math.hypot(rr[i], rr[i + 1]));
  const rms = Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / errs.length);
  const p = best.proj;
  return { ok: true, proj: { pos: p.pos, rot: p.rot, fov: p.fov, shift: p.shift }, rms, errors: errs, used: best.used };
}
