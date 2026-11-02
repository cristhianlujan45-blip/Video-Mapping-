// web/js/phonecam-enc.js — codifica las fotos JPEG del móvil en un hilo aparte (Worker):
// así no espera a que la página esté libre y la cámara por cable va fluida.
let cv = null, ctx = null;
self.onmessage = async (e) => {
  const { bitmap, quality } = e.data;
  try {
    if (!cv || cv.width !== bitmap.width || cv.height !== bitmap.height) { cv = new OffscreenCanvas(bitmap.width, bitmap.height); ctx = cv.getContext("2d", { willReadFrequently: true }); }   // en la CPU: el JPEG se lee al momento
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const buf = await (await cv.convertToBlob({ type: "image/jpeg", quality })).arrayBuffer();
    self.postMessage(buf, [buf]);
  } catch (err) { self.postMessage({ error: String(err?.message || err) }); }
};
