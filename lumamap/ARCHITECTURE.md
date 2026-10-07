# Arquitectura de LumaMap 2

## Visión general

```
            ┌─────────────── Android (APK) ───────────────┐
            │  MainActivity: WebView del editor            │
            │  OutputPresentation: WebView en el proyector │
            │  puente LumaNative (archivos, permisos, HDMI)│
            └───────────────┬──────────────────────────────┘
                            │ carga offline desde assets
┌───────────────────────────▼───────────────────────────────────────────┐
│ web/                                                                   │
│  editor (index.html)  ──Link──►  salida (output.html)                  │
│   editor.js + panels.js          output.js                             │
│        └────── compose.js + renderer.js (mismo motor en ambos) ──────┘ │
│  IndexedDB: proyectos + archivos de medios (compartida, mismo origen)  │
└───────────────────────────────────────────────────────────────────────┘
            ▲ opcional: server/ (estáticos, mando remoto WS, OSC UDP)
```

El mismo código corre en el navegador y dentro del APK. El editor y la salida
usan el mismo compositor, así que la vista previa es exactamente lo que se
proyecta.

## Modelo de datos (`model.js`)

```
Project  { version: 2, name, width, height, surfaces[], scenes[], sceneId, media[], settings }
Surface  { id, name, type: "quad" | "poly", cols, rows, points[], hidden, locked, mask }
           quad: rejilla cols×rows (fila mayor). 2×2 = corner pin; más = malla.
           poly: contorno libre (n puntos).
           mask: { enabled, invert, feather, points[] en UV 0..1 }
Scene    { id, name, duration, transition: "fade" | "cut", looks: { [surfaceId]: Look } }
Look     { source, fit, opacity, blend, hidden, volume, rate, fx, audio }
source   { type: none | media | gen | color | text | drawing | camera, … , strokes[] }
```

La geometría es global y el contenido es por escena: se calibra una vez y cada
escena cambia solo lo que se ve. Los archivos (Blob) se guardan en IndexedDB y
el proyecto solo guarda sus metadatos; al exportar se incrustan en base64.
`normalizeProject()` valida, rellena valores nuevos y migra el formato v1.

## Render (`renderer.js`)

- **Corner pin exacto.** Para un quad 2×2 se calcula la homografía H del
  cuadrado unidad a las esquinas. Cada vértice lleva `(u/w, v/w, 1/w)` con
  `w = H₃·(u,v,1)`: esa terna es lineal en pantalla, así que la interpolación del
  rasterizador y la división del fragment shader dan la UV proyectiva exacta en
  cada píxel (prueba en `tests/core.test.js`).
- **Malla.** Con más de 2×2 puntos, la superficie se evalúa con Catmull-Rom
  bicúbico (pasa exactamente por cada punto) y se subdivide 10×10 por celda.
- **Polígonos.** Ear clipping con UV de la caja envolvente.
- **Un shader para todo.** Fuente (textura, color o uno de 16 generadores), luego
  transformación de UV (espejo, caleidoscopio, rotación, zoom, ondas,
  desplazamiento, pixelado), color, ruido, borde animado sobre el contorno (la
  distancia se mide al contorno real en espacio corregido por aspecto), máscara y
  alfa premultiplicado. Un draw call por superficie.
- **Texturas** se suben solo cuando cambia el fotograma (video: `currentTime`;
  GIF: índice de fotograma; dibujo y texto: versión).

## Dibujo (`drawing.js`)

Los trazos se guardan como vectores en UV de su superficie (redondeados a 1e-4)
y se pintan en un canvas 2D por look, que el renderer usa como textura. Si no hay
trazos animados, solo se repinta cuando cambian. El neón son cuatro pasadas
aditivas (halo ancho, halo, color, núcleo blanco).

## Editor (`editor.js`, `panels.js`, `ui.js`)

- Estado único `S`; `changed()` marca el proyecto para enviarlo a la salida y
  programar el autoguardado; `commit()` crea un paso de deshacer (instantánea).
- Gestos con Pointer Events: punto → forma → vacío; dos dedos escalan/giran la
  forma o la vista. Las esquinas que coinciden (tolerancia de 7 px en pantalla) se
  arrastran juntas.
- Controles táctiles de 44-48 px; en tablet el panel va a la derecha y en
  teléfono como hoja inferior.

## Editor ↔ salida (`link.js`)

Mensajes: `project` (proyecto completo, al cambiar), `state` (30 Hz: tiempo,
reproducción, brillo, apagón, patrón, guías, niveles de audio y trazo en curso),
`media` (cargar un archivo nuevo desde IndexedDB), `vsync` (corrección de deriva
de videos cada 2 s) y `hello` (la salida pide el estado al arrancar). En el
navegador viajan por `BroadcastChannel`; en Android, por `LumaNative.toOutput()`,
que los entrega a la WebView del proyector con `evaluateJavascript`.

## Android (`android/`)

- Los assets son `../web`; `WebViewAssetLoader` los sirve en
  `https://appassets.androidplatform.net/`, un origen seguro (IndexedDB, cámara,
  micrófono) y común a ambas WebView.
- `DisplayManager` + `Presentation` para la pantalla externa, con reconexión
  automática si el usuario estaba proyectando.
- Permisos de cámara/micrófono se piden al primer uso desde `onPermissionRequest`.
- Exportación por trozos (`saveBegin/saveChunk/saveEnd`) a un archivo temporal y
  `ACTION_CREATE_DOCUMENT`.

## Límites conocidos

- Dos WebView no pueden usar la cámara a la vez en todos los dispositivos: el
  contenido de cámara puede verse en la salida o en el editor, según el equipo.
- El audio de los videos suena desde la salida cuando está activa (el editor se
  silencia para no duplicarlo).
- La detección de superficies en foto es una ayuda: siempre requiere ajuste manual.
