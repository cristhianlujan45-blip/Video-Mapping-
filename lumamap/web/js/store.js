// web/js/store.js
// Persistencia local 100 % offline en IndexedDB:
//   projects: documentos de proyecto (JSON) por nombre, más "__autosave__"
//   media:    archivos importados (Blob) por id, compartidos entre el editor y
//             la ventana de salida (mismo origen = misma base de datos).
const DB_NAME = "lumamap", DB_VER = 1;
export const AUTOSAVE = "__autosave__";

let dbPromise = null;
function db() {
  if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB no disponible"));
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains("projects")) d.createObjectStore("projects", { keyPath: "name" });
      if (!d.objectStoreNames.contains("media")) d.createObjectStore("media", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("No se pudo abrir la base de datos"));
  });
  return dbPromise;
}

async function run(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, mode);
    let result;
    const req = fn(tx.objectStore(store));
    if (req) req.onsuccess = () => { result = req.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || new Error("Error de almacenamiento"));
    tx.onabort = () => reject(tx.error || new Error("Almacenamiento lleno o no disponible"));
  });
}

export const saveProject = (name, project) =>
  run("projects", "readwrite", s => s.put({ name, project, savedAt: Date.now() }));
export const loadProject = async (name) => (await run("projects", "readonly", s => s.get(name)))?.project || null;
export const deleteProject = (name) => run("projects", "readwrite", s => s.delete(name));
export async function listProjects() {
  const all = await run("projects", "readonly", s => s.getAll());
  return (all || []).filter(r => r.name !== AUTOSAVE && !r.name.startsWith("__backup__"))
    .map(r => ({ name: r.name, savedAt: r.savedAt, surfaces: r.project?.surfaces?.length || 0, scenes: r.project?.scenes?.length || 0 }))
    .sort((a, b) => b.savedAt - a.savedAt);
}

/** Copias de seguridad automáticas: [{ name, savedAt, surfaces, scenes }]. */
export async function listBackups() {
  const all = await run("projects", "readonly", s => s.getAll());
  return (all || []).filter(r => r.name.startsWith("__backup__"))
    .map(r => ({ name: r.name, savedAt: r.savedAt, surfaces: r.project?.surfaces?.length || 0, scenes: r.project?.scenes?.length || 0 }));
}

/** rec = {id, name, kind, mime, blob, width, height, duration, size, thumb} */
export const putMedia = (rec) => run("media", "readwrite", s => s.put(rec));
export const getMedia = (id) => run("media", "readonly", s => s.get(id));
export const deleteMedia = (id) => run("media", "readwrite", s => s.delete(id));

/* ---------------- Utilidades de archivos ---------------- */

export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export function dataURLToBlob(du) {
  const comma = du.indexOf(",");
  const head = du.slice(0, comma), b64 = du.slice(comma + 1);
  const mime = (head.match(/data:(.*?)[;,]/) || [])[1] || "application/octet-stream";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
