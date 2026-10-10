// web/js/ai/hardware.js
// AI → Diagnóstico del equipo: RAM, VRAM, GPU, CPU y sistema, y qué modelo de
// IA local conviene. Nunca bloquea nada: si el modelo recomendado no puede
// ejecutarse, el asistente sigue funcionando sin IA.

export const MODEL_TIERS = [
  { id: "none", label: "Sin IA local", model: null, note: "Equipo muy justo: el asistente funciona con reglas y la guía (sin modelo)." },
  { id: "basic", label: "Equipo básico", model: "qwen3:4b", size: "2,5 GB", note: "Modelo pequeño: rápido en casi cualquier PC con 8 GB de RAM." },
  { id: "medium", label: "Equipo medio", model: "qwen3:8b", size: "5,2 GB", note: "Buen equilibrio: necesita ~6 GB de VRAM o 16 GB de RAM." },
  { id: "high", label: "Equipo potente", model: "qwen3:14b", size: "9,3 GB", note: "Más listo y más lento: GPU con 12 GB o más, o 32 GB de RAM." },
];
/** Opción avanzada (no se recomienda para el uso normal de la app). */
export const ADVANCED_MODELS = [
  { model: "qwen3-coder:30b", note: "Solo para desarrolladores con hardware potente (24 GB de VRAM o más). No hace falta para usar LumaMap." },
];
/** Modelos que pueden ver imágenes (análisis de superficies). */
export const VISION_HINTS = ["vl", "vision", "llava", "gemma3", "minicpm-v", "moondream", "bakllava"];
export const isVisionModel = (name) => VISION_HINTS.some(h => String(name).toLowerCase().includes(h));

const GB = 1073741824;

/** Perfil de hardware normalizado. En Windows lo da la app de escritorio; en el navegador lo que se pueda saber. */
export async function detectHardware(app) {
  const hw = { os: "", cpu: "", cores: 0, ramGB: 0, gpu: "", vramGB: 0, source: "navegador", exact: false };
  try {
    const p = await globalThis.LumaDesktop?.hardwareProfile?.();
    if (p) {
      hw.source = "escritorio"; hw.exact = true;
      hw.os = { win32: "Windows", darwin: "macOS", linux: "Linux" }[p.platform] || p.platform;
      hw.cpu = p.cpu; hw.cores = p.cores; hw.ramGB = Math.round(p.ram / GB * 10) / 10; hw.gpu = p.gpu || p.gpuDevices?.find(d => d.active)?.name || "";
      const vram = Math.max(0, ...(p.wmi?.gpus || []).map(g => +g.vram || +g.AdapterRAM || 0));
      hw.vramGB = Math.round(vram / GB * 10) / 10;
      return hw;
    }
  } catch {}
  const nav = globalThis.navigator || {};
  hw.os = /Windows/.test(nav.userAgent) ? "Windows" : /Mac/.test(nav.userAgent) ? "macOS" : /Android/.test(nav.userAgent) ? "Android" : /Linux/.test(nav.userAgent) ? "Linux" : "";
  hw.cores = nav.hardwareConcurrency || 0;
  hw.ramGB = nav.deviceMemory || 0;          // el navegador lo limita a 8 como máximo
  try {
    const gl = app?.renderer?.gl || document.createElement("canvas").getContext("webgl2");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    hw.gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "";
  } catch {}
  return hw;
}

/** Nivel recomendado según RAM y VRAM (si no se conocen, se elige el básico). */
export function recommendTier(hw) {
  const ram = hw?.ramGB || 0, vram = hw?.vramGB || 0;
  const dedicated = vram >= 2 && !/intel\(r\) (uhd|hd|iris)|microsoft basic|swiftshader|llvmpipe/i.test(hw?.gpu || "");
  if ((dedicated && vram >= 12) || ram >= 32) return MODEL_TIERS[3];
  if ((dedicated && vram >= 6) || ram >= 16) return MODEL_TIERS[2];
  if (ram >= 8 || (dedicated && vram >= 4) || !ram) return MODEL_TIERS[1];
  return MODEL_TIERS[0];
}

/**
 * Elige el modelo a usar entre los instalados en Ollama: el recomendado si está;
 * si no, el Qwen3 más grande que quepa; si no, el primero que haya.
 */
export function pickModel(installed, hw, preferred = "") {
  const names = (installed || []).map(m => typeof m === "string" ? m : m.name);
  if (preferred && names.includes(preferred)) return preferred;
  const tier = recommendTier(hw);
  if (tier.model && names.includes(tier.model)) return tier.model;
  const order = ["qwen3:14b", "qwen3:8b", "qwen3:4b", "qwen3:1.7b", "qwen3:0.6b"];
  const maxIdx = Math.max(0, order.indexOf(tier.model || "qwen3:1.7b"));
  for (const m of order.slice(maxIdx)) if (names.includes(m)) return m;
  const chat = names.filter(n => !/embed|nomic|bge|minilm/i.test(n));
  return chat.find(n => /qwen/i.test(n)) || chat[0] || "";
}
