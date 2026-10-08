/**
 * Body landmark layout (MediaPipe BlazePose, 33 points) and hand layout (21 points),
 * plus the gesture/feature extraction used by rules and tracking effects.
 */

export const POSE = {
  nose: 0,
  leftEyeInner: 1,
  leftEye: 2,
  leftEyeOuter: 3,
  rightEyeInner: 4,
  rightEye: 5,
  rightEyeOuter: 6,
  leftEar: 7,
  rightEar: 8,
  mouthLeft: 9,
  mouthRight: 10,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftPinky: 17,
  rightPinky: 18,
  leftIndex: 19,
  rightIndex: 20,
  leftThumb: 21,
  rightThumb: 22,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFootIndex: 31,
  rightFootIndex: 32,
} as const;

export const POSE_CONNECTIONS: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28], [27, 29], [29, 31], [28, 30], [30, 32], [27, 31], [28, 32],
  [15, 17], [15, 19], [15, 21], [16, 18], [16, 20], [16, 22], [0, 2], [0, 5], [2, 7], [5, 8], [9, 10],
];

export const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

/** Stride of the pose landmark array: x, y, z, visibility. */
export const POSE_STRIDE = 4;
export const HAND_STRIDE = 3;

export interface TrackedPerson {
  /** Stable id across frames (nearest-centroid matching). */
  id: number;
  landmarks: Float32Array;
  hands: { side: 'left' | 'right'; landmarks: Float32Array }[];
  /** Normalized camera units per second. */
  velocity: { x: number; y: number };
  confidence: number;
  center: { x: number; y: number };
}

const get = (lm: Float32Array, i: number) => ({ x: lm[i * POSE_STRIDE], y: lm[i * POSE_STRIDE + 1], z: lm[i * POSE_STRIDE + 2], v: lm[i * POSE_STRIDE + 3] });

export function personCenter(lm: Float32Array) {
  const a = get(lm, POSE.leftHip);
  const b = get(lm, POSE.rightHip);
  const c = get(lm, POSE.leftShoulder);
  const d = get(lm, POSE.rightShoulder);
  return { x: (a.x + b.x + c.x + d.x) / 4, y: (a.y + b.y + c.y + d.y) / 4 };
}

/** Wrist above the head (y grows downwards). */
export function handRaised(lm: Float32Array, side: 'left' | 'right'): boolean {
  const wrist = get(lm, side === 'left' ? POSE.leftWrist : POSE.rightWrist);
  const shoulder = get(lm, side === 'left' ? POSE.leftShoulder : POSE.rightShoulder);
  const nose = get(lm, POSE.nose);
  if (wrist.v < 0.5 || shoulder.v < 0.5) return false;
  return wrist.y < Math.min(nose.y, shoulder.y - 0.05);
}

/** Assigns stable ids by greedy nearest-centroid matching with the previous frame. */
export class PersonTracker {
  private prev: { id: number; c: { x: number; y: number }; t: number }[] = [];
  private nextId = 1;

  assign(centers: { x: number; y: number }[], t: number): { id: number; velocity: { x: number; y: number } }[] {
    const used = new Set<number>();
    const out = centers.map((c) => {
      let best = -1;
      let bestD = 0.25 * 0.25;
      this.prev.forEach((p, i) => {
        if (used.has(i)) return;
        const d = (p.c.x - c.x) ** 2 + (p.c.y - c.y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      if (best >= 0) {
        used.add(best);
        const p = this.prev[best];
        const dt = Math.max(1e-3, (t - p.t) / 1000);
        return { id: p.id, velocity: { x: (c.x - p.c.x) / dt, y: (c.y - p.c.y) / dt } };
      }
      return { id: this.nextId++, velocity: { x: 0, y: 0 } };
    });
    this.prev = out.map((o, i) => ({ id: o.id, c: centers[i], t }));
    return out;
  }
}

/**
 * Feature bus values from a tracking frame. Keys:
 *  tracking.person.count, tracking.hand.any.raised, tracking.hand.left.raised, tracking.hand.right.raised,
 *  tracking.speed (max body speed), tracking.distance (0 far … 1 near, from shoulder width),
 *  tracking.p<id>.x/y, tracking.head.x/y, tracking.hand.left.x/y, tracking.hand.right.x/y,
 *  tracking.feet.y, zone.<id>.count
 */
export function extractFeatures(people: TrackedPerson[], zones: { id: string; rect: { x: number; y: number; w: number; h: number } }[]): Record<string, number> {
  const f: Record<string, number> = {};
  f['tracking.person.count'] = people.length;
  let left = 0;
  let right = 0;
  let speed = 0;
  let near = 0;
  for (const p of people) {
    if (handRaised(p.landmarks, 'left')) left = 1;
    if (handRaised(p.landmarks, 'right')) right = 1;
    speed = Math.max(speed, Math.hypot(p.velocity.x, p.velocity.y));
    const ls = get(p.landmarks, POSE.leftShoulder);
    const rs = get(p.landmarks, POSE.rightShoulder);
    near = Math.max(near, Math.min(1, Math.hypot(ls.x - rs.x, ls.y - rs.y) * 3));
  }
  f['tracking.hand.left.raised'] = left;
  f['tracking.hand.right.raised'] = right;
  f['tracking.hand.any.raised'] = left || right ? 1 : 0;
  f['tracking.hand.count.raised'] = left + right;
  f['tracking.speed'] = Math.min(1, speed);
  f['tracking.distance'] = near;
  const first = people[0];
  if (first) {
    const head = get(first.landmarks, POSE.nose);
    const lw = get(first.landmarks, POSE.leftWrist);
    const rw = get(first.landmarks, POSE.rightWrist);
    const la = get(first.landmarks, POSE.leftAnkle);
    const ra = get(first.landmarks, POSE.rightAnkle);
    f['tracking.head.x'] = head.x;
    f['tracking.head.y'] = head.y;
    f['tracking.hand.left.x'] = lw.x;
    f['tracking.hand.left.y'] = lw.y;
    f['tracking.hand.right.x'] = rw.x;
    f['tracking.hand.right.y'] = rw.y;
    f['tracking.feet.y'] = Math.max(la.y, ra.y);
    f['tracking.center.x'] = first.center.x;
    f['tracking.center.y'] = first.center.y;
  }
  for (const z of zones) {
    let n = 0;
    for (const p of people) if (p.center.x >= z.rect.x && p.center.x <= z.rect.x + z.rect.w && p.center.y >= z.rect.y && p.center.y <= z.rect.y + z.rect.h) n++;
    f[`zone.${z.id}.count`] = n;
    f[`zone.${z.id}.occupied`] = n > 0 ? 1 : 0;
  }
  return f;
}

/** Feature keys offered in rule/zone UIs. */
export const FEATURE_LABELS: Record<string, string> = {
  'tracking.person.count': 'Número de personas',
  'tracking.hand.any.raised': 'Alguna mano levantada',
  'tracking.hand.left.raised': 'Mano izquierda levantada',
  'tracking.hand.right.raised': 'Mano derecha levantada',
  'tracking.hand.count.raised': 'Manos levantadas (0–2)',
  'tracking.speed': 'Velocidad del cuerpo',
  'tracking.distance': 'Cercanía a la cámara',
  'tracking.head.x': 'Cabeza X',
  'tracking.head.y': 'Cabeza Y',
  'tracking.hand.left.x': 'Mano izq. X',
  'tracking.hand.left.y': 'Mano izq. Y',
  'tracking.hand.right.x': 'Mano der. X',
  'tracking.hand.right.y': 'Mano der. Y',
  'tracking.feet.y': 'Pies (altura)',
  'audio.rms': 'Audio: volumen',
  'audio.bass': 'Audio: graves',
  'audio.mid': 'Audio: medios',
  'audio.treble': 'Audio: agudos',
  'audio.beat': 'Audio: beat',
  'audio.onset': 'Audio: ataque',
  'audio.bpm': 'Audio: BPM',
};
