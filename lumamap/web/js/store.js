// web/js/store.js
// Persistencia local: IndexedDB para proyectos+medios (autosave) con
// degradación a localStorage si IndexedDB no existe. 100% offline.
const DB_NAME = "lumap", DB_VER = 1, STORE = "projects";

function openDB() {
  return new Promise((resolve, reject) => {
    if (!indexedDB) return reject(new Error("IndexedDB no disponible"));
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "name" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveLocal(doc) {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(doc);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    // Fallback: localStorage (límite ~5MB, avisar si falla)
    try {
      localStorage.setItem("lumap:" + doc.name, JSON.stringify(doc));
      return true;
    } catch (e2) {
      throw new Error("No se pudo guardar (almacenamiento lleno o no disponible): " + e2.message);
    }
  }
}

export async function loadLocal(name) {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(name);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    const raw = localStorage.getItem("lumap:" + name);
    return raw ? JSON.parse(raw) : null;
  }
}

export async function listLocal() {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAllKeys();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return Object.keys(localStorage).filter(k => k.startsWith("lumap:")).map(k => k.slice(6));
  }
}

export async function deleteLocal(name) {
  try {
    const db = await openDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(name);
      tx.oncomplete = () => resolve(true);
    });
  } catch { localStorage.removeItem("lumap:" + name); return true; }
}
