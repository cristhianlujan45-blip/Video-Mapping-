// web/js/wm.js
// Detección de pantallas vía Window Management API (Chrome/Edge 100+).
// Limitación honesta: requiere permiso del usuario y solo existe en Chromium;
// en otros navegadores se usa el método manual (ventana arrastrable + F).
export async function listScreens() {
  if (!("getScreenDetails" in window)) {
    return { ok: false, reason: "Window Management API no disponible en este navegador. Método alternativo: abre OUTPUT y arrastra la ventana al proyector, luego pulsa F." };
  }
  try {
    const d = await window.getScreenDetails();
    return {
      ok: true,
      current: d.currentScreen.left,
      screens: d.screens.map(s => ({
        left: s.left, top: s.top, width: s.width, height: s.height,
        label: s.label || `${s.width}×${s.height}`, primary: s.isPrimary,
      })),
    };
  } catch (e) {
    return { ok: false, reason: "Permiso de gestión de ventanas denegado: " + e.message };
  }
}

export function openOutputOnScreen(screen) {
  const feat = `left=${screen.left},top=${screen.top},width=${Math.min(screen.width, 1280)},height=${Math.min(screen.height, 720)},popup=yes`;
  const w = window.open("/output.html", "lumapOutput", feat);
  if (!w) return false;
  // Algunos navegadores ignoran left/top en window.open: forzamos después.
  setTimeout(() => {
    try { w.moveTo(screen.left, screen.top); w.resizeTo(screen.width, screen.height); } catch {}
  }, 400);
  return true;
}
