/// <reference lib="webworker" />
/**
 * TRACKING THREAD. MediaPipe Pose (multi-person) + Hands + segmentation on camera frames,
 * at a tracking resolution/FPS independent of the camera and of the outputs (a 4K camera
 * can be tracked at 640×360 while it is shown in 4K). Results go straight to the render
 * worker through a MessagePort and a compact feature summary goes to the UI.
 */
import { FilesetResolver, HandLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';
import { PersonTracker, personCenter, POSE_STRIDE, HAND_STRIDE, type TrackedPerson } from '../../shared/tracking/pose';

declare const self: DedicatedWorkerGlobalScope;

export type ToTracking =
  | { type: 'init'; renderPort: MessagePort; base: string }
  | { type: 'config'; cameraId: string; width: number; height: number; fps: number; maxPeople: number; hands: boolean; segmentation: boolean; gpu: boolean }
  | { type: 'stream'; cameraId: string; stream: ReadableStream<VideoFrame> }
  | { type: 'stop' };

export type FromTracking =
  | { type: 'status'; status: 'loading' | 'ready' | 'running' | 'error' | 'stopped'; message?: string; delegate?: string }
  | { type: 'result'; cameraId: string; people: TrackedPerson[]; fps: number; inferenceMs: number };

let renderPort: MessagePort | null = null;
let base = './';
let pose: PoseLandmarker | null = null;
let hands: HandLandmarker | null = null;
let cfg: Extract<ToTracking, { type: 'config' }> | null = null;
let reader: ReadableStreamDefaultReader<VideoFrame> | null = null;
let busy = false;
let lastRun = 0;
let delegate = 'GPU';
const tracker = new PersonTracker();
let count = 0;
let fpsT = performance.now();
let fps = 0;

const post = (m: FromTracking) => self.postMessage(m);

async function load() {
  if (!cfg) return;
  post({ type: 'status', status: 'loading' });
  const fileset = await FilesetResolver.forVisionTasks(`${base}mediapipe/wasm`);
  const make = async (useGpu: boolean) => {
    const d = useGpu ? 'GPU' : 'CPU';
    pose?.close();
    hands?.close();
    pose = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: `${base}models/pose_landmarker_lite.task`, delegate: d },
      runningMode: 'VIDEO',
      numPoses: Math.max(1, Math.min(6, cfg!.maxPeople)),
      outputSegmentationMasks: cfg!.segmentation,
      minPoseDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    hands = cfg!.hands
      ? await HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: `${base}models/hand_landmarker.task`, delegate: d },
          runningMode: 'VIDEO',
          numHands: Math.max(2, Math.min(8, cfg!.maxPeople * 2)),
        })
      : null;
    delegate = d;
  };
  try {
    await make(cfg.gpu);
  } catch (e) {
    if (!cfg.gpu) throw e;
    await make(false);
  }
  post({ type: 'status', status: 'ready', delegate });
}

async function run(stream: ReadableStream<VideoFrame>, cameraId: string) {
  await reader?.cancel().catch(() => {});
  const r = stream.getReader();
  reader = r;
  post({ type: 'status', status: 'running', delegate });
  for (;;) {
    let res: ReadableStreamReadResult<VideoFrame>;
    try {
      res = await r.read();
    } catch {
      break;
    }
    if (res.done || reader !== r) {
      res.value?.close();
      break;
    }
    const frame = res.value;
    const now = performance.now();
    const interval = 1000 / (cfg?.fps ?? 30);
    if (busy || !pose || now - lastRun < interval * 0.95) {
      frame.close();
      continue;
    }
    busy = true;
    lastRun = now;
    try {
      await process(frame, cameraId, now);
    } catch (e) {
      post({ type: 'status', status: 'error', message: (e as Error).message });
    } finally {
      frame.close();
      busy = false;
    }
  }
  if (reader === r) post({ type: 'status', status: 'stopped', message: 'La cámara de tracking se detuvo' });
}

async function process(frame: VideoFrame, cameraId: string, now: number) {
  const c = cfg!;
  // Downscale on the GPU to the tracking resolution.
  const bmp = await createImageBitmap(frame, { resizeWidth: c.width, resizeHeight: c.height, resizeQuality: 'low' });
  const t0 = performance.now();
  const pr = pose!.detectForVideo(bmp, now);
  const hr = hands ? hands.detectForVideo(bmp, now) : null;
  const inferenceMs = performance.now() - t0;
  bmp.close();

  const centers: { x: number; y: number }[] = [];
  const lms: Float32Array[] = [];
  for (const lmList of pr.landmarks) {
    const arr = new Float32Array(33 * POSE_STRIDE);
    lmList.forEach((p, i) => {
      arr[i * POSE_STRIDE] = p.x;
      arr[i * POSE_STRIDE + 1] = p.y;
      arr[i * POSE_STRIDE + 2] = p.z;
      arr[i * POSE_STRIDE + 3] = p.visibility ?? 1;
    });
    lms.push(arr);
    centers.push(personCenter(arr));
  }
  const ids = tracker.assign(centers, now);
  const people: TrackedPerson[] = lms.map((lm, i) => ({ id: ids[i].id, landmarks: lm, hands: [], velocity: ids[i].velocity, confidence: 1, center: centers[i] }));
  // attach hands to the nearest wrist
  if (hr) {
    hr.landmarks.forEach((hl, k) => {
      const arr = new Float32Array(21 * HAND_STRIDE);
      hl.forEach((p, i) => {
        arr[i * HAND_STRIDE] = p.x;
        arr[i * HAND_STRIDE + 1] = p.y;
        arr[i * HAND_STRIDE + 2] = p.z;
      });
      const side = (hr.handedness[k]?.[0]?.categoryName ?? 'Right').toLowerCase() === 'left' ? 'left' : 'right';
      let best: TrackedPerson | null = null;
      let bestD = Infinity;
      for (const p of people) {
        for (const w of [15, 16]) {
          const d = (p.landmarks[w * POSE_STRIDE] - arr[0]) ** 2 + (p.landmarks[w * POSE_STRIDE + 1] - arr[1]) ** 2;
          if (d < bestD) {
            bestD = d;
            best = p;
          }
        }
      }
      if (best) best.hands.push({ side, landmarks: arr });
    });
  }
  let mask: ImageBitmap | null = null;
  if (c.segmentation && pr.segmentationMasks && pr.segmentationMasks.length) {
    // union of all person masks
    const m0 = pr.segmentationMasks[0];
    const w = m0.width;
    const h = m0.height;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (const m of pr.segmentationMasks) {
      const f = m.getAsFloat32Array();
      for (let i = 0; i < f.length; i++) {
        const v = Math.max(rgba[i * 4], Math.round(f[i] * 255));
        rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = v;
        rgba[i * 4 + 3] = 255;
      }
      m.close();
    }
    mask = await createImageBitmap(new ImageData(rgba, w, h));
  }
  count++;
  if (now - fpsT >= 1000) {
    fps = Math.round((count * 1000) / (now - fpsT));
    count = 0;
    fpsT = now;
  }
  renderPort?.postMessage({ type: 'tracking', cameraId, people, mask, width: c.width, height: c.height }, mask ? [mask] : []);
  post({ type: 'result', cameraId, people, fps, inferenceMs });
}

self.onmessage = (e: MessageEvent<ToTracking>) => {
  const m = e.data;
  switch (m.type) {
    case 'init':
      renderPort = m.renderPort;
      base = m.base;
      break;
    case 'config': {
      const reload = !cfg || cfg.maxPeople !== m.maxPeople || cfg.hands !== m.hands || cfg.segmentation !== m.segmentation || cfg.gpu !== m.gpu;
      cfg = m;
      if (reload) load().catch((err: Error) => post({ type: 'status', status: 'error', message: `No se pudo cargar el modelo de tracking: ${err.message}` }));
      break;
    }
    case 'stream':
      void run(m.stream, m.cameraId);
      break;
    case 'stop':
      void reader?.cancel().catch(() => {});
      reader = null;
      post({ type: 'status', status: 'stopped' });
      break;
  }
};
