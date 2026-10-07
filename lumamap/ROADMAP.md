# ROADMAP.md — Plan de desarrollo por fases

Estado actual: **Fases 1–9 y 11 en v0.1** (editor, warping, máscaras, media
library, reproductor, escenas/capas, render GPU+efectos, output, web, backend,
sincronización, mando remoto). Las fases marcadas ◻ están especificadas pero no
implementadas. No hay funciones simuladas: lo que no existe, no aparece como
botón (regla 26).

## FASE 1 — Arquitectura + proyecto base ✅
## FASE 2 — Editor de superficies ✅ (quad + polígono, drag de vértices, mover, escala, rotación)
## FASE 3 — Warping y máscaras ✅ (corner pin/perspective warp por homografía; máscara poligonal + feather + invert)
## FASE 4 — Media Library ✅ (import, miniaturas reales, metadatos, buscar/filtrar por tipo implícito, reutilización)
## FASE 5 — Reproductor ✅ (play/pause/stop, loops, volumen por superficie, autoplay de escena)
## FASE 6 — Escenas y capas ✅ (crear/duplicar/renombrar/reordenar/eliminar; transiciones corte y fade)
## FASE 7 — Timeline ◻ (v0.1: timeline de reproducción por escenas con duración; cortes de clips en v0.3)
## FASE 8 — Render GPU y efectos ✅ (11 efectos + 10 presets, blend modes, WebGL2, máscaras en shader)
## FASE 9 — Output hacia pantalla/proyector ✅ (ventana OUTPUT independiente, fullscreen, patrones de calibración)
## FASE 10 — Android ◻ parcial
  - 10.1 ✅ envoltorio WebView (editor/mando) — código entregado, APK requiere Android Studio
  - 10.2 ◻ motor nativo: OpenGL ES + homografía en GPU, DisplayManager para
    HDMI/DisplayPort/USB-C, Presentation API para segunda pantalla, cámara
    (CameraX) para referencia de calibración
## FASE 11 — Web / PWA ✅ (manifest + service worker offline) · ◻ detección de
  pantallas con Window Management API + permiso explícito
## FASE 12 — Sincronización entre dispositivos ✅ (relé WS controller↔display,
  reconexión automática) · ◻ sync de proyectos por código/cuenta cuando haya
  backend remoto
## FASE 13 — OSC / MIDI ◻ (arquitectura preparada: adaptadores que llaman a
  setPlaying/gotoScene/…; OSC vía UDP node:dgram en backend, MIDI vía Web MIDI
  en navegador). Prioridad v0.2.
## FASE 14 — Calibración avanzada ◻ (asistente paso a paso; auto-mapping
  experimental con OpenCV.js: detección de planos/rectángulos desde foto,
  siempre con corrección manual — sin promesas de detección perfecta)
## FASE 15 — Pruebas y optimización ✅ parcial (19 pruebas automatizadas;
  pendiente: pruebas E2E de browser con Playwright, perfiles de memoria,
  caché de mallas, blur multipasada, edge blending para proyectores múltiples)

## Hitos sugeridos
- **v0.2**: OSC/MIDI, Window Management API, timeline con cortes, sync ntp-lite
  de videos entre OUTPUT y editor.
- **v0.3**: motor nativo Android 10.2, auto-mapping asistido, máscaras Bézier.
- **v0.4**: WebGPU (compute para efectos), shaders custom del usuario,
  generadores de medios (ruido, gradientes, shaders reactivos a audio).

## Criterios de calidad por fase
1. Funcionalidad real verificable (prueba automatizada o checklist manual).
2. Sin regresiones: `npm test` en verde antes de merge.
3. Documentación de limitaciones técnicas honestas en README/ARCHITECTURE.
