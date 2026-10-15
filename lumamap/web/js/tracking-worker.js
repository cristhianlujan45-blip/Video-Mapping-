// web/js/tracking-worker.js — hilo de tracking (Web Worker clásico).
// Recibe fotogramas pequeños (ImageBitmap) de la cámara y devuelve las personas
// (33 puntos del cuerpo) y las manos (21 puntos) con MediaPipe, en la GPU si se
// puede. Va en su propio hilo: el tracking nunca frena la interfaz ni el render.
let pose = null, hands = null, ready = false, busy = false;

self.onmessage = async (e) => {
  const m = e.data;
  if (m.t === "init") {
    try {
      const vision = await import(m.base + "vision_bundle.js");
      const fileset = { wasmLoaderPath: m.base + "wasm/vision_wasm_internal.js", wasmBinaryPath: m.base + "wasm/vision_wasm_internal.wasm" };
      const make = async (Cls, model, extra) => {
        for (const delegate of ["GPU", "CPU"]) {
          try { return { task: await Cls.createFromOptions(fileset, { baseOptions: { modelAssetPath: m.base + model, delegate }, runningMode: "VIDEO", ...extra }), delegate }; }
          catch (err) { if (delegate === "CPU") throw err; }
        }
      };
      const p = await make(vision.PoseLandmarker, "pose_landmarker_lite.task", { numPoses: m.numPoses || 4, minPoseDetectionConfidence: 0.35, minPosePresenceConfidence: 0.35, minTrackingConfidence: 0.35 });
      pose = p.task;
      if (m.hands) hands = (await make(vision.HandLandmarker, "hand_landmarker.task", { numHands: m.numHands || 4, minHandDetectionConfidence: 0.4, minTrackingConfidence: 0.4 })).task;
      ready = true;
      self.postMessage({ t: "ready", delegate: p.delegate });
    } catch (err) { self.postMessage({ t: "error", msg: String(err && err.message || err) }); }
    return;
  }
  if (m.t === "frame") {
    const bmp = m.bitmap;
    if (!ready || busy) { bmp.close(); self.postMessage({ t: "skip" }); return; }
    busy = true;
    const t0 = performance.now();
    try {
      const r = pose.detectForVideo(bmp, m.ts);
      const out = { t: "result", ts: m.ts, w: bmp.width, h: bmp.height, poses: (r.landmarks || []).map((lm, i) => ({ lm: lm.map(p => [p.x, p.y, p.z, p.visibility ?? 1]), world: r.worldLandmarks?.[i]?.map(p => [p.x, p.y, p.z]) || null })), hands: [] };
      if (hands) {
        const h = hands.detectForVideo(bmp, m.ts);
        out.hands = (h.landmarks || []).map((lm, i) => ({ lm: lm.map(p => [p.x, p.y, p.z]), side: h.handednesses?.[i]?.[0]?.categoryName || "", score: h.handednesses?.[i]?.[0]?.score || 0 }));
      }
      out.ms = performance.now() - t0;
      self.postMessage(out);
    } catch (err) { self.postMessage({ t: "error", msg: String(err && err.message || err) }); }
    finally { bmp.close(); busy = false; }
  }
};
