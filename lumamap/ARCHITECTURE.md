# ARCHITECTURE.md — Arquitectura técnica de LumaMap

## 1. Visión general

```
┌──────────────────────────┐   BroadcastChannel   ┌──────────────────────────┐
│  EDITOR (index.html)     │ ◄──────────────────► │  OUTPUT (output.html)    │
│  app.js · ui.js · store  │   proyecto + estado  │  renderer.js (mismo)     │
│  renderer.js · project   │                      │  patrones de calibración │
└───────────┬──────────────┘                      └──────────▲───────────────┘
            │ WebSocket (rol display)                         │ WebSocket
            ▼                                                ▼
┌───────────────────────────────────────────────────────────────────────────┐
│  BACKEND Node.js (server/index.js) — cero dependencias                    │
│  · HTTP estáticos (web/, shared/)                                         │
│  · API REST /api/projects (JSON en data/)                                 │
│  · WebSocket RFC 6455 propio: relé controller ↔ display                   │
└───────────────────────────────────────────────────────────────────────────┘
            ▲
            │ WebSocket (rol controller)
┌───────────┴──────────────┐
│  MANDO (controller.html) │  Android / tablet / segundo navegador
│  remote.js               │
└──────────────────────────┘
```

## 2. Decisiones tecnológicas y justificación

| Componente | Elección | Por qué |
|---|---|---|
| Frontend web | ES modules nativos, sin bundler | Sin build step = sin cadena de herramientas que romper en producción; se sirve estático tal cual |
| Motor gráfico | **WebGL2** | Estándar, GPU real, disponible en Chrome/Edge/Firefox/Safari 16+; WebGPU queda como evolución cuando su soporte sea universal |
| Backend | Node.js puro (http, crypto, fs) | Cero-dependencias: funciona en cualquier entorno Node ≥ 18, offline, auditable |
| WS | RFC 6455 implementado a mano (~120 líneas) | Evita dependencia `ws`; soporta exactamente lo que el protocolo LumaMap necesita: texto, ping/pong, close, máscara cliente |
| Persistencia | IndexedDB (+fallback localStorage) | Cuotas de GB, asíncrona, disponible offline; autosave sin bloquear UI |
| Sync OUTPUT | BroadcastChannel | Misma máquina, baja latencia, sin servidor |
| Sync dispositivos | WebSocket vía backend | Funciona en LAN sin configuración; reconexión automática |

## 3. Motor de render (web/js/renderer.js)

### Warp proyectivo (corner pin / perspective warp)
Para una superficie quad con esquinas `c0..c3` (píxeles de lienzo):

1. `homography()` (DLT 4 puntos, `shared/homography.js`) calcula H que mapea
   el cuadrado unidad UV → esquinas del lienzo.
2. Cada vértice lleva atributo `a_uvh = H·(u,v,1)` (numerador y w).
3. El vertex shader interpola `v_uvh`; el fragment hace `uv = v_uvh.xy / v_uvh.w`.

La división por `w` interpolada **es** la corrección proyectiva: el warp es
matemáticamente exacto (no una aproximación por malla). Coste: 0 pasadas extra.

### Polígonos libres
Ear clipping en CPU (`triangulatePolygon`, con fallback a abanico para
polígonos no simples). UVs afines sobre el bounding box. Re-triangula solo al
editar puntos.

### Máscaras
Hasta 32 vértices en uniforms. Ray-casting por scanline en el fragment shader;
feather = `clamp(0.5 ± distancia_a_arista / (2·feather))`; invertible. Evaluación
en espacio UV 0..1 local de la superficie.

### Efectos
Un fragment shader, uniforms por superficie: brightness, contrast, saturation,
hue (RGB↔HSV en shader), rgbShift, noise (hash), pixelate, blur (5-tap),
threshold, colorize, invert, tint RGB, opacidad. Blend modes: normal / add /
multiply vía `blendFunc`. **Rendimiento**: un solo draw call por superficie por
frame; texturas de video se re-suben solo cuando cambia `currentTime`.

### Límites del diseño
- Blur es 5-tap (bokeh real requeriría render targets → fase 15).
- Mask feather aproxima la distancia euclídea a aristas (suficiente para uso
  en mapping; máscaras Bézier reales requieren evaluación de curvas en shader).

## 4. Backend (server/index.js)

- `createServer({port})`: http.Server con estáticos, API y upgrade WS.
- WS: `computeAcceptKey` (SHA-1 + GUID del RFC), `encodeFrame`/`decodeFrames`
  (opcode, máscara, longitudes 7/16/64 bits, acumulación de buffer parcial).
- Relé: mensajes `hello` (rol), `control` → displays, `state` → controllers.
  Estado del display enviado 1×/s: escena, índice, playing, FPS, resolución.
- API: GET/POST `/api/projects`, GET `/api/projects/:name` (persistencia en
  `data/*.json`). `safeJoin` evita path traversal.

## 5. Modelo de datos (web/js/project.js)

```ts
Project  { version:1, name, width, height, fps,
           surfaces: Surface[], scenes: Scene[],
           currentSceneId, settings }
Surface  { id, name, type:"quad"|"poly", points:[{x,y}],   // px de lienzo
           mediaId, opacity, tint:[r,g,b], blend, hidden, locked, volume,
           mask:{ enabled, invert, feather, points:[{x,y}] }, // UV 0..1
           fx:{ brightness, contrast, saturation, hue, rgbShift, noise,
                pixelate, blur, threshold, colorizeAmt, colorize, invert } }
Scene    { id, name, layers:[{ id, surfaceId }], autoplayNext }
```

Serialización: `serializeProject()` incrusta medios como dataURL → el archivo
`.lumap.json` es autocontenido y portable. `validateProject()` valida y
repara (garantiza ≥1 escena, currentSceneId válido).

## 6. Sistema de plugins / extensibilidad

- **Efectos**: añadir un efecto = nuevo uniform en `FRAG` + entrada en
  `DEFAULT_FX` + slider en `ui.js`. Los presets son funciones puras sobre el
  objeto fx (`FX_PRESETS`).
- **Fuentes de medios**: la biblioteca acepta cualquier elemento con
  `texImage2D`-compatible; añadir generadores (shader-only, captura de
  pantalla) = crear un runtime media con `element` propio.
- **Comandos remotos**: el `switch` de `onControl` en `app.js` es el punto
  único de extensión (OSC/MIDI llegarán como adaptadores que llaman a las
  mismas funciones `setPlaying/gotoScene/...`).

## 7. Seguridad y robustez

- `safeJoin` contra path traversal; body POST limitado.
- WS: se valida `Sec-WebSocket-Key`; frames con opcode inesperado se ignoran.
- La app **nunca cierra silenciosamente**: errores de importación/guardado →
  alerta descriptiva con causa probable.
- Autosave (10 s) + recuperación al reabrir + export autocontenido.

## 8. Diagrama de datos en reproducción

```
rAF tick (60 Hz)
 └─ renderer.drawScene(scene, surfaces, media)
     └─ por capa: buildMesh (cacheable) → uniforms → drawArrays
 media video: element.currentTime cambió → texImage2D → GPU
 transición fade: drawScene(from, α=1-ease) + drawScene(to, α=ease)
```
