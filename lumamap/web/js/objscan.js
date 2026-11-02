// web/js/objscan.js
// Reconocer un objeto real con la cámara y calibrar la proyección encima, sola.
// Parte del escaneo con luz estructurada (graycode.js): cada punto de la foto sabe qué punto del
// proyector lo ilumina. Cada cara plana del objeto (y la pared o el suelo de detrás) hace que esa
// relación sea una homografía: se buscan esos planos (RANSAC), se descartan los del fondo (los
// que llegan al borde de la imagen del proyector), y con las caras que quedan:
//   · 1 cara → una superficie plana (cartel, tabla, pantalla…);
//   · 2-3 caras que comparten aristas → una caja: sus esquinas en la imagen del proyector, sus
//     proporciones y dónde está el proyector (con calib3d), para ponerla en el 3D ya calibrada;
//   · si mucho de lo iluminado no es plano → un objeto irregular (se dice; no se inventa).
// Matemática pura (sin página): se prueba con una escena sintética.
import { calibrate, projectPoint } from "./calib3d.js";

/* ---------------- Homografías ---------------- */
function solve(A, b) {   // Gauss con pivote (n pequeño)
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
function normT(pts) {
  let cx = 0, cy = 0; for (const [x, y] of pts) { cx += x; cy += y; } cx /= pts.length; cy /= pts.length;
  let d = 0; for (const [x, y] of pts) d += Math.hypot(x - cx, y - cy); d = d / pts.length || 1;
  const s = Math.SQRT2 / d;
  return { s, cx, cy, f: ([x, y]) => [(x - cx) * s, (y - cy) * s] };
}
/** Homografía (9 números, h8 = 1) que lleva src → dst, por mínimos cuadrados normalizados. */
export function fitH(src, dst) {
  if (src.length < 4) return null;
  const a = normT(src), b = normT(dst);
  const AtA = Array.from({ length: 8 }, () => new Array(8).fill(0)), Atb = new Array(8).fill(0);
  const add = (row, v) => { for (let i = 0; i < 8; i++) { Atb[i] += row[i] * v; for (let j = 0; j < 8; j++) AtA[i][j] += row[i] * row[j]; } };
  for (let i = 0; i < src.length; i++) {
    const [x, y] = a.f(src[i]), [u, v] = b.f(dst[i]);
    add([x, y, 1, 0, 0, 0, -x * u, -y * u], u);
    add([0, 0, 0, x, y, 1, -x * v, -y * v], v);
  }
  const h = solve(AtA, Atb);
  if (!h) return null;
  // H = Tb⁻¹ · Hn · Ta
  const Hn = [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1]];
  const Ta = [[a.s, 0, -a.s * a.cx], [0, a.s, -a.s * a.cy], [0, 0, 1]];
  const Tbi = [[1 / b.s, 0, b.cx], [0, 1 / b.s, b.cy], [0, 0, 1]];
  const mul = (P, Q) => P.map(r => Q[0].map((_, j) => r[0] * Q[0][j] + r[1] * Q[1][j] + r[2] * Q[2][j]));
  const H = mul(Tbi, mul(Hn, Ta)), k = H[2][2];
  if (!Number.isFinite(k) || Math.abs(k) < 1e-12) return null;
  return H.flat().map(v => v / k);
}
export function applyH(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

/* ---------------- Puntos del escaneo ---------------- */
/** Pares cámara (px) ↔ proyector (0..1), como mucho maxN, repartidos por la imagen. */
export function samplePairs(map, maxN = 30000) {
  const valid = Math.max(1, map.coverage * map.w * map.h);
  const step = Math.max(1, Math.floor(Math.sqrt(valid / maxN)));
  const cam = [], proj = [];
  for (let y = 0; y < map.h; y += step) for (let x = 0; x < map.w; x += step) {
    const i = y * map.w + x;
    if (!Number.isNaN(map.u[i])) { cam.push([x, y]); proj.push([map.u[i], map.v[i]]); }
  }
  return { cam, proj, step };
}

/** Generador pseudoaleatorio con semilla (resultados repetibles). */
export function rng(seed = 1) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

/**
 * Planos por RANSAC: cada uno { H (cámara→proyector), idx (índices de sus puntos) }, de más a
 * menos puntos. Las 4 muestras salen de una zona pequeña de la foto (así caen en la misma cara).
 */
export function findPlanes(cam, proj, { tol = 0.002, iters = 260, minFrac = 0.04, minPts = 60, maxPlanes = 7, radius = 0, rand = rng(7), score = 3000 } = {}) {
  const N = cam.length, alive = new Uint8Array(N).fill(1), planes = [];
  let W = 0, H = 0; for (const [x, y] of cam) { if (x > W) W = x; if (y > H) H = y; }
  const R = radius || Math.max(W, H) * 0.06, R2 = R * R;
  const err = (Hm, i) => { const [u, v] = applyH(Hm, cam[i][0], cam[i][1]); return Math.hypot(u - proj[i][0], v - proj[i][1]); };
  const inliersOf = (Hm) => { const out = []; for (let i = 0; i < N; i++) if (alive[i] && err(Hm, i) < tol) out.push(i); return out; };
  for (let p = 0; p < maxPlanes; p++) {
    const live = []; for (let i = 0; i < N; i++) if (alive[i]) live.push(i);
    // Mínimo: tantos puntos o una parte de lo que queda (las caras de un objeto pequeño también cuentan).
    const need = Math.max(minPts, minFrac * live.length);
    if (live.length < need) break;
    // Las hipótesis se puntúan con una muestra (rápido); la buena se afina con todos.
    const sc = live.length <= score ? live : Array.from({ length: score }, () => live[(rand() * live.length) | 0]);
    let best = null;
    for (let it = 0; it < iters; it++) {
      const s = live[(rand() * live.length) | 0], pick = [s];
      for (let k = 0; k < 60 && pick.length < 4; k++) {
        const j = live[(rand() * live.length) | 0];
        if (pick.includes(j)) continue;
        const dx = cam[j][0] - cam[s][0], dy = cam[j][1] - cam[s][1];
        if (dx * dx + dy * dy <= R2) pick.push(j);
      }
      if (pick.length < 4) continue;
      let Hm = fitH(pick.map(i => cam[i]), pick.map(i => proj[i]));
      if (!Hm) continue;
      let n = 0; for (const i of sc) if (err(Hm, i) < tol) n++;
      if (best && n <= best.n * 0.5) continue;
      // Optimización local: 4 puntos juntos dan una homografía poco exacta (franjas de 1/1024);
      // reajustada con sus puntos buenos, se ve si de verdad es un plano grande.
      let H2 = Hm;
      for (let k = 0; k < 2; k++) {
        const inl = sc.filter(i => err(H2, i) < tol * 2);
        if (inl.length < 8) break;
        const f = fitH(inl.map(i => cam[i]), inl.map(i => proj[i]));
        if (!f) break; H2 = f;
      }
      let n2 = 0; for (const i of sc) if (err(H2, i) < tol) n2++;
      if (n2 > n) { Hm = H2; n = n2; }
      if (!best || n > best.n) best = { Hm, n };
    }
    if (!best) break;
    // Afinar con todos sus puntos (dos vueltas).
    let Hm = best.Hm, idx = inliersOf(Hm);
    for (let k = 0; k < 2; k++) { const f = fitH(idx.map(i => cam[i]), idx.map(i => proj[i])); if (!f) break; Hm = f; idx = inliersOf(Hm); }
    if (idx.length < need) break;
    for (const i of idx) alive[i] = 0;
    planes.push({ H: Hm, idx });
  }
  // Cada punto, al plano donde mejor encaja. Si además encaja en un plano de fondo (suelo o
  // pared: ocupan mucho), se queda en el fondo: cerca de la arista con el suelo, y de su
  // prolongación, encajan los dos, y si no una cara pequeña se «estiraría» con trocitos de suelo.
  const big = planes.map(p => p.idx.length > 0.2 * N);
  const own = new Int16Array(N).fill(-1);
  for (let i = 0; i < N; i++) {
    let bi = -1, be = tol, bg = -1;
    for (let k = 0; k < planes.length; k++) { const e = err(planes[k].H, i); if (e < tol && big[k] && bg < 0) bg = k; if (e < be) { be = e; bi = k; } }
    own[i] = bg >= 0 ? bg : bi;
  }
  for (let k = 0; k < planes.length; k++) planes[k].idx = largestPart(cam, [...Array(N).keys()].filter(i => own[i] === k));
  return planes.filter(p => p.idx.length >= minPts).sort((a, b) => b.idx.length - a.idx.length);
}

/** La zona más grande de puntos juntos en la foto (quita trocitos sueltos que encajan por casualidad). */
function largestPart(cam, idx) {
  if (idx.length < 3) return idx;
  // Paso de la rejilla: la distancia típica entre puntos vecinos.
  const key = (x, y) => x * 100003 + y, at = new Map();
  let step = Infinity;
  for (let k = 1; k < Math.min(idx.length, 200); k++) { const d = Math.abs(cam[idx[k]][0] - cam[idx[k - 1]][0]); if (d > 0 && d < step) step = d; }
  if (!Number.isFinite(step)) step = 1;
  for (const i of idx) at.set(key(Math.round(cam[i][0] / step), Math.round(cam[i][1] / step)), i);
  const seen = new Set(); let best = [];
  for (const i of idx) {
    if (seen.has(i)) continue;
    const comp = [], st = [i]; seen.add(i);
    while (st.length) {
      const j = st.pop(); comp.push(j);
      const gx = Math.round(cam[j][0] / step), gy = Math.round(cam[j][1] / step);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const n = at.get(key(gx + dx, gy + dy));
        if (n != null && !seen.has(n)) { seen.add(n); st.push(n); }
      }
    }
    if (comp.length > best.length) best = comp;
  }
  return best;
}

/* ---------------- Caras y esquinas ---------------- */
function hull(pts) {   // cadena monótona (sentido antihorario en ejes x→, y↑; aquí v crece hacia abajo)
  const P = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (P.length < 3) return P;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
const triA = (a, b, c) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
export const polyArea = (q) => { let s = 0; for (let i = 0; i < q.length; i++) { const a = q[i], b = q[(i + 1) % q.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; };
/** Las 4 esquinas de una cara: el contorno convexo de sus puntos reducido a un cuadrilátero. */
export function quadOf(pts) {
  let h = hull(pts);
  while (h.length > 4) {
    let k = 0, best = Infinity;
    for (let i = 0; i < h.length; i++) { const a = triA(h[(i - 1 + h.length) % h.length], h[i], h[(i + 1) % h.length]); if (a < best) { best = a; k = i; } }
    h.splice(k, 1);
  }
  return h.length === 4 ? orderTLcw(h) : null;
}
/** Orden: arriba-izquierda, arriba-derecha, abajo-derecha, abajo-izquierda (v hacia abajo). */
export function orderTLcw(q) {
  const c = q.reduce((s, p) => [s[0] + p[0] / q.length, s[1] + p[1] / q.length], [0, 0]);
  const s = [...q].sort((a, b) => Math.atan2(a[1] - c[1], a[0] - c[0]) - Math.atan2(b[1] - c[1], b[0] - c[0]));
  const tl = s.reduce((bi, p, i) => (p[0] + p[1] < s[bi][0] + s[bi][1] ? i : bi), 0);
  return [0, 1, 2, 3].map(k => s[(tl + k) % 4]);
}
const touchesBorder = (pts, m = 0.015) => {
  let l = 0, r = 0, t = 0, b = 0;
  for (const [u, v] of pts) { if (u < m) l = 1; if (u > 1 - m) r = 1; if (v < m) t = 1; if (v > 1 - m) b = 1; }
  return l + r + t + b;
};

/** Junta las esquinas de caras distintas que son la misma esquina del objeto (y las promedia). */
function clusterCorners(faces, tol) {
  const all = []; faces.forEach((f, fi) => f.quad.forEach((p, ci) => all.push({ p, fi, ci })));
  const cl = [];
  for (const c of all) {
    const g = cl.find(g => Math.hypot(g.p[0] - c.p[0], g.p[1] - c.p[1]) < tol && !g.m.some(m => m.fi === c.fi));
    if (g) { g.m.push(c); g.p = [g.m.reduce((s, m) => s + m.p[0], 0) / g.m.length, g.m.reduce((s, m) => s + m.p[1], 0) / g.m.length]; }
    else cl.push({ p: c.p, m: [c] });
  }
  faces.forEach(f => { f.cl = [0, 0, 0, 0]; });
  cl.forEach((g, gi) => g.m.forEach(m => { faces[m.fi].cl[m.ci] = gi; faces[m.fi].quad[m.ci] = g.p; }));
  return cl;
}

/**
 * Analiza el escaneo: { kind: "box"|"plane"|"planes"|"wall"|"irregular"|"none", faces: [{quad, n}],
 * box?: { topo, corners: {etiqueta → [u,v]} }, message }.
 */
export function analyzeObject(map, opts = {}) {
  const { cam, proj } = samplePairs(map, opts.maxN || 30000);
  if (cam.length < 50) return { kind: "none", faces: [], message: "La cámara casi no ve la proyección: vuelve a escanear con el objeto bien iluminado por el proyector." };
  const planes = findPlanes(cam, proj, opts);
  const explained = planes.reduce((s, p) => s + p.idx.length, 0) / cam.length;
  const faces = [], background = [];
  for (const p of planes) {
    const pts = p.idx.map(i => proj[i]);
    const q = quadOf(pts);
    if (!q || polyArea(q) < 0.002) continue;
    // Lo que llega a 2 bordes de la imagen del proyector es la pared o el suelo de detrás.
    const camQuad = quadOf(p.idx.map(i => cam[i]));   // la misma cara en la foto (para enseñarla)
    if (touchesBorder(pts) >= 2 || polyArea(q) > 0.6) background.push({ quad: q, camQuad, n: p.idx.length });
    else faces.push({ quad: q, camQuad, n: p.idx.length, H: p.H });
  }
  const objPts = cam.length - background.reduce((s, b) => s + b.n, 0);
  const objExplained = faces.reduce((s, f) => s + f.n, 0) / Math.max(1, objPts);
  if (!faces.length) {
    if (background.length && explained > 0.6) return { kind: "wall", faces: background.slice(0, 1), message: "Es una pared o superficie plana: la imagen del proyector cae entera encima." };
    return { kind: "irregular", faces: [], message: "No se ven caras planas: es un objeto irregular (o curvo). Usa la calibración por puntos o una malla a mano." };
  }
  const tol = opts.cornerTol || 0.035;
  clusterCorners(faces, tol);
  if (faces.length >= 2) {
    const box = boxTopology(faces);
    if (box) return { kind: "box", faces, box, explained: objExplained, message: `Es una caja: se ven ${box.topo === 3 ? "3 caras" : "2 caras"}.${objExplained < 0.6 ? " Hay partes que no son planas: revisa el resultado." : ""}` };
    return { kind: "planes", faces, message: `Hay ${faces.length} superficies planas separadas: cada una queda mapeada por su lado.` };
  }
  if (objExplained < 0.5) return { kind: "irregular", faces, message: "Una parte es plana pero el resto no: es un objeto irregular. Se mapeó la parte plana." };
  return { kind: "plane", faces, message: "Es una superficie plana (cartel, tabla, pantalla…): queda mapeada encima." };
}

/** Caras que comparten aristas → etiquetas de las esquinas de una caja (o null). */
function boxTopology(faces) {
  const shared = (a, b) => a.cl.filter(c => b.cl.includes(c));
  const F = [...faces].sort((a, b) => b.n - a.n).slice(0, 3);
  if (F.length === 3) {
    const [a, b, c] = F, ab = shared(a, b), bc = shared(b, c), ac = shared(a, c);
    const common = ab.find(x => bc.includes(x) && ac.includes(x));
    if (common != null && ab.length >= 2 && bc.length >= 2 && ac.length >= 2) {
      const other = (s) => s.find(x => x !== common);
      return { topo: 3, faces: F, c0: common, eab: other(ab), ebc: other(bc), eac: other(ac) };
    }
  }
  // Dos caras con una arista en común.
  for (let i = 0; i < F.length; i++) for (let j = i + 1; j < F.length; j++) {
    const s = shared(F[i], F[j]);
    if (s.length >= 2) return { topo: 2, faces: [F[i], F[j]], edge: s.slice(0, 2) };
  }
  return null;
}

/**
 * Hipótesis de esquinas 3D ↔ imagen del proyector para una caja de medidas w×h×d (centrada en
 * x y z, apoyada en y = 0). Devuelve listas de { w:[x,y,z], uv } (una por forma de encajarla).
 */
export function boxHypotheses(ana) {
  const b = ana.box, faces = b.faces;
  const cl = (gi) => { for (const f of faces) { const k = f.cl.indexOf(gi); if (k >= 0) return f.quad[k]; } return null; };
  const far = (f, used) => { const k = f.cl.findIndex(c => !used.includes(c)); return k >= 0 ? f.quad[k] : null; };
  // Esquina «0» = (w/2, h, d/2); recorrer la arista x cambia de lado en x, la y baja al suelo, la z cambia de lado en z.
  const world = (axes) => [axes.includes("x") ? -1 : 1, axes.includes("y") ? 0 : 1, axes.includes("z") ? -1 : 1];
  const PERMS = [["x", "y", "z"], ["x", "z", "y"], ["y", "x", "z"], ["y", "z", "x"], ["z", "x", "y"], ["z", "y", "x"]];
  const out = [];
  const push = (pairs) => { if (pairs.every(([, uv]) => uv)) out.push(pairs.map(([axes, uv]) => ({ k: axes || "0", s: world(axes), uv }))); };
  if (b.topo === 3) {
    // Tres caras en la esquina c0; cada arista que sale de c0 es un eje (todas las formas de asignarlos).
    const [A, B, C] = faces, eAB = b.eab, eBC = b.ebc, eAC = b.eac;
    for (const [ab, bc, ac] of PERMS)
      push([["", cl(b.c0)], [ab, cl(eAB)], [bc, cl(eBC)], [ac, cl(eAC)],
        [ab + ac, far(A, [b.c0, eAB, eAC])], [ab + bc, far(B, [b.c0, eAB, eBC])], [bc + ac, far(C, [b.c0, eBC, eAC])]]);
  } else {
    // Dos caras con una arista común (vertical u horizontal: se prueban todas).
    const [A, B] = faces, [p, q] = b.edge;
    const nb = (f, c) => { const k = f.cl.indexOf(c); return [f.cl[(k + 1) % 4], f.cl[(k + 3) % 4]]; };
    for (const [c0, e] of [[p, q], [q, p]]) {
      const ea = nb(A, c0).find(c => c !== e), eb = nb(B, c0).find(c => c !== e);
      for (const [se, sa, sb] of PERMS)
        push([["", cl(c0)], [se, cl(e)], [sa, cl(ea)], [sb, cl(eb)], [se + sa, far(A, [c0, e, ea])], [se + sb, far(B, [c0, e, eb])]]);
    }
  }
  return out;
}
const pointsFor = (hyp, w, h, d) => hyp.map(({ k, s, uv }) => ({ k, uv, w: [s[0] * w / 2, s[1] * h, s[2] * d / 2] }));

/**
 * Medidas y proyector de la caja. width = ancho real (m) para la escala; dims = [w,h,d] si se
 * conocen. Devuelve { ok, dims, proj, rms, points } o { ok:false, why }.
 */
export function solveBox(ana, projector, opts = {}) {
  const it = solveSteps(ana, projector, opts);
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}
/** Igual, sin congelar la página: cede el paso cada pocos cálculos y dice cuánto lleva (0..1). */
export async function solveBoxAsync(ana, projector, opts = {}, onProgress = () => {}) {
  const it = solveSteps(ana, projector, opts);
  let r = it.next(), t = performance.now();
  while (!r.done) {
    if (performance.now() - t > 30) { onProgress(r.value); await new Promise(res => setTimeout(res, 0)); t = performance.now(); }
    r = it.next();
  }
  onProgress(1);
  return r.value;
}
/**
 * Reconocer y (si es una caja) calcular, en un hilo aparte si se puede (objscan-worker.js); si el
 * equipo no admite hilos de módulos, aquí mismo cediendo el paso. Devuelve { ana, sol }.
 * proj: lente del proyector (o null para solo reconocer) · onProgress(0..1) del cálculo.
 */
export function analyzeAndSolve(map, proj, opts = {}, onProgress = () => {}) {
  const inPage = async () => {
    analyzeAndSolve.lastPath = "page";
    const ana = analyzeObject(map);
    const sol = ana.kind === "box" && proj ? await solveBoxAsync(ana, proj, opts, onProgress) : null;
    return { ana, sol };
  };
  if (typeof Worker === "undefined") return inPage();
  return new Promise((resolve) => {
    let w;
    try { w = new Worker(new URL("./objscan-worker.js", import.meta.url), { type: "module" }); }
    catch { resolve(inPage()); return; }
    const done = (v) => { try { w.terminate(); } catch {} resolve(v); };
    w.onmessage = (e) => {
      const m = e.data || {};
      if (m.progress !== undefined) return onProgress(m.progress);
      if (m.error) return done(inPage());
      onProgress(1);
      analyzeAndSolve.lastPath = "worker";
      done({ ana: m.ana, sol: m.sol });
    };
    w.onerror = (e) => { e.preventDefault?.(); done(inPage()); };
    w.postMessage({ id: 1, map, proj, opts });
  });
}
export const solveBoxSteps = (ana, projector, opts) => solveSteps(ana, projector, opts);
function* solveSteps(ana, projector, { width = 0.5, dims = null, fixLens = true } = {}) {
  const hyps = boxHypotheses(ana);
  if (!hyps.length) return { ok: false, why: "No se pudieron ordenar las esquinas de la caja." };
  const fov = projector.fov || 30, shift = projector.shift || [0, 0];
  const start = { pos: [0, 1.2, 3], rot: [-10, 0, 0], fov, res: projector.res, shift };
  let best = null;
  // Con la lente conocida (la relación de proyección del paso 3) las proporciones salen bien;
  // el cálculo libre (DLT) solo da el punto de partida de la posición y el giro.
  const tryOne = (hyp, w, h, d) => {
    const pts = pointsFor(hyp, w, h, d);
    const free = calibrate(pts, start);
    if (!free.ok) return;
    const r = fixLens ? calibrate(pts, { ...start, pos: free.proj.pos, rot: free.proj.rot }, { fixLens: true }) : free;
    if (r.ok && Number.isFinite(r.rms) && (!best || r.rms < best.rms)) best = { rms: r.rms, proj: r.proj, dims: [w, h, d], points: pts, hyp };
  };
  if (dims) { for (const hyp of hyps) { tryOne(hyp, dims[0], dims[1], dims[2]); yield 0.5; } }
  else {
    const R = [0.25, 0.35, 0.5, 0.7, 1, 1.4, 2, 2.8, 4], total = hyps.length * R.length * R.length + 75;
    let n = 0;
    for (const hyp of hyps) for (const rh of R) for (const rd of R) { tryOne(hyp, width, width * rh, width * rd); yield ++n / total; }
    // Afinar alrededor de lo mejor.
    if (best) for (let k = 0; k < 3; k++) {
      const [w0, h0, d0] = best.dims, f = [0.8, 0.9, 1, 1.1, 1.25];
      for (const a of f) for (const c of f) { tryOne(best.hyp, w0, h0 * a, d0 * c); yield ++n / total; }
    }
  }
  if (!best) return { ok: false, why: "No se pudo calcular la caja." };
  return { ok: true, dims: best.dims, proj: best.proj, rms: best.rms, points: best.points };
}

/** Comprobación: dónde caen las esquinas de la caja con el proyector calculado (para dibujar o probar). */
export function reproject(sol, res) {
  return sol.points.map(p => ({ k: p.k, uv: p.uv, got: projectPoint({ ...sol.proj, res }, p.w) }));
}
