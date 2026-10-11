// tests/harness.js — mini corredor de pruebas sin dependencias.
let pass = 0, fail = 0, onFail = null;
/** Se llama con el nombre de cada prueba que falla (p. ej. para guardar una captura). */
export function setOnFail(fn) { onFail = fn; }
// ONLY=texto (expresión regular) ejecuta solo las pruebas cuyo nombre coincide.
const only = process.env.ONLY ? new RegExp(process.env.ONLY, "i") : null;
export async function test(name, fn) {
  if (only && !only.test(name)) return;
  try { await fn(); pass++; console.log("  ✓ " + name); }
  catch (e) {
    // El mensaje entero (las diferencias de deepEqual ocupan varias líneas) y dónde falló.
    const at = String(e.stack || "").split("\n").find(l => /^\s+at /.test(l)) || "";
    fail++; console.error("  ✗ " + name + "\n    " + (String(e.message || e).split("\n").slice(0, 14).join("\n    ") + (at ? "\n    " + at.trim() : "")));
    try { await onFail?.(name, e); } catch {}
  }
}
export function report() {
  console.log(`\nResultado: ${pass} pasaron, ${fail} fallaron`);
  if (fail) process.exitCode = 1;
}
