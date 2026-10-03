# LUJAN MAPPING: arquitectura y limitaciones reales de Android

Este documento recoge el análisis previo a la implementación: qué permite Android de
verdad, qué tecnología se eligió y por qué.

## 1. Salida a proyector: qué existe realmente

| Método | ¿Pantalla independiente para la app? | Cómo lo usa LUJAN MAPPING |
|---|---|---|
| **HDMI / USB-C (DisplayPort Alt Mode)** | **Sí**, *si el teléfono tiene salida de video* (Samsung con DeX, muchas tablets, Pixel 8 y posteriores con Android reciente, Motorola Ready For, etc.). Muchos teléfonos de gama media/baja **no** tienen salida de video por USB-C. | Aparece como pantalla de presentación (`DisplayManager.DISPLAY_CATEGORY_PRESENTATION`). La app la detecta en caliente y muestra en ella la salida limpia con `android.app.Presentation`, mientras el teléfono sigue siendo el controlador. |
| **Adaptador MHL / dock** | Igual que el anterior; depende del hardware. | Igual. |
| **Miracast ("Pantalla inalámbrica")** | Sí, en los dispositivos que todavía lo traen (cada vez menos). | Igual que HDMI. Hay más latencia. |
| **Chromecast / Google Cast** | **No.** La duplicación de pantalla de Cast copia la pantalla del teléfono. La API Cast Remote Display, que daba una segunda pantalla, está obsoleta y retirada. | Destino **"Pantalla interna"**: la salida limpia ocupa toda la pantalla del teléfono y Android la duplica en el Chromecast. Un toque muestra una barra pequeña que se oculta sola, con "Ajustar esquinas" y "Detener". |
| **Varias pantallas externas** | Android admite varias, pero casi ningún teléfono saca más de una. | Se usa la primera pantalla de presentación. |

**Resolución externa:** la elige el sistema (normalmente la nativa del monitor o
proyector). La app la muestra (`Display.Mode`) y ofrece la resolución nativa como
preset de salida. La resolución de composición se configura aparte de la interfaz
(720p, 1080p, 1440p, 4K, XGA, WXGA, nativa). 4K solo se habilita si la GPU admite
texturas de 4096 px o más.

**Detección automática:** `ExternalDisplayMonitor` escucha `DisplayManager.DisplayListener`.
Si se desconecta el cable a mitad de un show, la proyección sigue "activa" y vuelve sola
al reconectar.

## 2. Motor gráfico: OpenGL ES y no Vulkan

Se eligió **OpenGL ES 2.0 como mínimo, con un contexto ES 3 cuando existe**:

- **Video sin copias:** `MediaCodec`/ExoPlayer decodifica directamente en un
  `SurfaceTexture` → `GL_TEXTURE_EXTERNAL_OES`. Es el camino más maduro y estable en
  todos los fabricantes. En Vulkan el equivalente (`AHardwareBuffer` + conversión YCbCr)
  tiene muchas variantes entre drivers y más fallos en gama media y baja.
- **Compatibilidad:** ES 2.0 está en el 100 % de los dispositivos con Android 8 o
  superior. Vulkan 1.1 no está en todos y sus drivers fallan más.
- **Carga de trabajo:** el mapping son pocos quads con shaders sencillos. No hay cuello
  de botella de CPU en las draw calls que justifique Vulkan.

Si en el futuro se necesitara Vulkan (por ejemplo, decenas de capas en 4K), el
`Compositor` está aislado detrás de `RenderEngine` y puede reimplementarse.

### Pipeline por fotograma

```
Choreographer (vsync) ─► ¿algo cambió? ─no─► no se renderiza (ahorra batería y calor)
                              │sí
                              ▼
        updateTexImage() de cada video con fotograma nuevo
                              ▼
   FBO a la resolución de salida (p. ej. 1920x1080), fondo negro
     para cada capa (de abajo arriba):
       · se dibuja el rectángulo envolvente del quad
       · en cada fragmento: uv = H⁻¹·(x,y,1)  (homografía exacta, perspectiva real)
       · antialiasing analítico del borde, borde suave, máscara (textura alfa)
       · recorte, espejo, brillo/contraste/saturación/tono/negativo
       · mezcla: Normal/Add/Screen/Multiply con glBlendFunc;
                 Overlay/Difference/Lighten/Darken en shader (copia del fondo)
     cuadrícula de calibración (procedural)
                              ▼
   presentación del FBO en cada ventana:
     · proyector (Presentation) ─ vsync, todos los fotogramas
     · vista previa del teléfono ─ sin esperar vsync, a media tasa durante un show
     · pantalla interna completa (Chromecast/duplicación)
```

- **Homografía y no dos triángulos:** un quad texturizado normal parte la imagen en
  dos triángulos afines y la dobla visiblemente en la diagonal. La homografía mapea
  rectas en rectas, como un keystone real. El cálculo está en `core` y tiene tests.
- **Un solo contexto EGL** en un hilo dedicado (`HandlerThread`) que renderiza en
  todas las ventanas. Así no hace falta compartir contextos (fuente habitual de fallos
  de driver) y una textura de video sirve para todas las salidas.
- **Salida independiente de la interfaz:** la composición se hace una vez a la
  resolución de salida y luego se escala a cada ventana (encajar o estirar).

## 3. Arquitectura de la aplicación

```
:core  (Kotlin/JVM puro, con tests)          :app  (Android)
 ├─ model/    Project, Layer, Mask…  ◄────── ui/      Jetpack Compose (MVVM)
 ├─ geometry/ Vec2, Quad, Homography           │        EditorViewModel = fuente única de verdad
 ├─ history/  undo/redo por snapshots          ├─ render/  EGL, Compositor, shaders, máscaras
 ├─ io/       formato .mapping (JSON)          ├─ media/   ExoPlayer por capa, imágenes, sondeo
 └─ edit/     operaciones puras                ├─ display/ detección + Presentation
                                               └─ data/    autoguardado + SAF
```

- **MVVM con modelo inmutable:** cada edición crea un `Project` nuevo. El hilo de render
  lee una instantánea `@Volatile` sin locks. Undo/redo guarda instantáneas (con
  compartición estructural), así que **todas** las ediciones se pueden deshacer:
  esquinas, mover, capas, máscaras, efectos, parámetros y salida.
- **Transacciones de edición:** un gesto o el arrastre de un deslizador es **un solo**
  paso de deshacer (`beginEdit` / `updateLive` / `commitEdit`).
- **Sin Room ni Hilt:** los proyectos son documentos pequeños y portables (JSON) y el
  grafo de dependencias es pequeño. Room y Hilt añadirían tiempo de compilación y
  complejidad sin aportar nada aquí.
- **Sin permisos de almacenamiento:** todo pasa por el Storage Access Framework, con
  permisos persistentes por archivo.

## 4. Formato `.mapping`

JSON UTF-8 versionado (`formatVersion`). Ignora claves desconocidas y aplica valores por
defecto, así que funciona hacia adelante y hacia atrás. Guarda la salida (resolución,
fps, escalado, destino), la cuadrícula, las capas, las esquinas, la transformación, las
máscaras, el color, la reproducción y las referencias a los medios (URI, nombre, tamaño,
dimensiones y duración).

Los medios **se referencian, no se copian**. Si se movieron, la app marca la capa con un
patrón rojo (la superficie se puede seguir ajustando) y ofrece **"Buscar archivos
perdidos"**: buscar archivo por archivo, o en una carpeta completa por nombre y tamaño.

## 5. Rendimiento y estabilidad

- Solo se renderiza cuando algo cambia. En reposo la GPU no trabaja.
- Límite de 30 o 60 fps configurable. El proyector va sincronizado a vsync. Durante un
  show, la vista previa del teléfono se actualiza a media tasa con video.
- Cada video se decodifica por hardware directamente a la GPU, sin copias en CPU.
- Las imágenes se decodifican fuera del hilo de UI y se reducen al tamaño máximo de
  textura (como mucho 4096 px).
- Las máscaras se rasterizan solo cuando cambian.
- `surfaceDestroyed` espera a que el hilo GL suelte la ventana, como exige Android, para
  evitar cierres al desconectar el cable.
- Los errores de decodificación (formato no soportado, sin decodificadores libres) se
  muestran en la capa. La app no se cierra.
- La actividad gestiona sus propios cambios de configuración: rotar o conectar un
  teclado no reinicia la salida del proyector.
- Pantalla encendida (`FLAG_KEEP_SCREEN_ON`) mientras se proyecta.

## 6. Límites conocidos (y alternativa elegida)

| Petición | Realidad | Alternativa |
|---|---|---|
| Chromecast como segunda pantalla | No hay API pública vigente | Destino "Pantalla interna" + duplicación |
| Muchos videos simultáneos | Limitado por las instancias de decodificador por hardware (suele haber 4–16) | Diagnóstico en la app con el número aproximado de instancias; error explícito en la capa |
| MOV | Funciona si el códec interno es H.264/H.265 (lo habitual); ProRes no | Mensaje "formato no soportado" |
| SVG | Android no trae decodificador de SVG | Fase 2 con una biblioteca ligera (rasterizado a textura) |
| GIF animado | `ImageDecoder` lo carga como imagen fija en el MVP | Fase 2: `AnimatedImageDrawable` → textura |
| Audio interno para audio reactivo | `AudioPlaybackCapture` (Android 10+) pide consentimiento de captura de pantalla y las apps de origen pueden bloquearlo | Fase 2: micrófono y archivo propio de forma fiable; audio interno donde se permita |
| ARCore para calibrar | Solo funciona en dispositivos certificados y no localiza la imagen del proyector | Calibración manual precisa: esquinas con colores, modo precisión ×0.2, empuje píxel a píxel con teclado y cuadrícula. Fase 2: vista de cámara con la malla superpuesta |
| App en segundo plano durante el show | La `Presentation` pertenece a la actividad | Mantener la app en primer plano. La proyección impide que la pantalla se apague |
