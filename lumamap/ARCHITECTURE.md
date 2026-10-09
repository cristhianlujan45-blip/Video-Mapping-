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
- UDP para las luces (`UdpHub.kt`): un hilo de recepción por socket, datos en
  base64 por el puente y «multicast lock» de Wi-Fi mientras hay sockets abiertos.
- Velocidad: las miniaturas (animaciones, generadores, mezclador) se crean al verse
  y en tandas de ≈10 ms (`lazyThumb` en ui.js); la primera vez se mide el equipo
  (`A.speedTest`) y, si va justo, se baja la calidad de la vista previa.
  `tests/perf.test.js` mide cada versión como un móvil (412×915, CPU ×4) con
  límites de arranque, pestañas, fotograma, luces, interactivo y memoria.

## Límites conocidos

- Dos WebView no pueden usar la cámara a la vez en todos los dispositivos: el
  contenido de cámara puede verse en la salida o en el editor, según el equipo.
- El audio de los videos suena desde la salida cuando está activa (el editor se
  silencia para no duplicarlo).
- La detección de superficies en foto es una ayuda: siempre requiere ajuste manual.

## Plataforma profesional (modo profesional)

```
ENTRADAS ─ MIDI · OSC · DMX · teclado · audio · tracking · timeline · mando remoto
   │            (midi.js · remote-service · dmx-service · audio.js · show.js)
   ▼
MOTOR DE PARÁMETROS (params.js) ─ mapeos, bancos, modificadores, macros, feedback,
   │                               soft takeover, mezclas (sustituir/sumar/multiplicar/máx/mín)
   ▼
MOTOR AV / GPU (renderer.js + compose.js, WebGL2 sobre Direct3D 11 vía ANGLE en Windows)
   │  2D (warp, malla, máscaras, 122 efectos, transiciones) · 3D (three3d.js)
   ▼
SALIDAS ─ ventanas P1-P4 (motor compartido) · Art-Net/sACN (dmx.js → dmx-service)
   ▲
SHOW ─ escenas/cues, transiciones, timecode (MTC, LTC, OSC, interno), automatización,
       modo actuación, apagón, emergencia (show.js)
```

### Motor de parámetros (`params.js`)
- `describe(app, id)` devuelve el descriptor de cualquier parámetro (`global/master`,
  `surf/<id>/fx/brightness`, `surf/sel/opacity`, `screen/2/on`, `scene/3`,
  `macro/<id>`, `dmx/master`, `dmx/fix/<id>/<canal>`…): nombre, tipo, mínimo, máximo,
  defecto, valor actual y `set()`. Los módulos registran sus propios prefijos.
- `input(ev)` recibe cualquier entrada normalizada `{src, device, channel, key, v, on}`
  y aplica los mapeos del proyecto (`settings.control.mappings`). «Sustituir» desde
  MIDI/OSC/DMX/teclado escribe en el proyecto (con deshacer); las fuentes continuas
  (audio, tracking, timeline) y las demás mezclas son modulaciones por fotograma
  (`modList()` → `applyModList()`), que también reciben las salidas.
- MIDI: 14 bits (MSB+LSB y pitch bend), encoders relativos (3 codificaciones),
  soft takeover, feedback a 30 Hz solo de lo que cambia, bancos, modificadores.

### Salidas con motor compartido
Las ventanas `output.html` abiertas por el editor están en el mismo proceso: leen
el proyecto, el reloj y las fuentes del editor (`window.opener.__lumaHost`). Cada
video/cámara se decodifica una vez; cada salida solo sube el fotograma a su propio
contexto WebGL (copia GPU→GPU). Sin editor accesible (Android, otra pestaña) se usa
el canal `Link` de siempre.

### Luces (`dmx.js`, `dmxproto.js`, `desktop/dmx-service.mjs`)
- La composición se dibuja en un lienzo pequeño (contexto propio, fuentes
  compartidas) y un shader calcula el color de cada LED con promedio de área y
  ajustes de color. Solo esos bytes vuelven a la CPU, por PBO + fence asíncronos.
- Parcheo con AUTO SPAN / ALIGN; universos virtuales → Art-Net/sACN sin rehacer
  nada. El servicio de red (proceso aparte) envía a la frecuencia configurada,
  con retardo por universo, ArtPoll, entrada Art-Net/sACN (prioridad sACN) y
  estadísticas. Se ata a la IP de la interfaz elegida: nunca sale por otra.
- El núcleo de red es común (`dmxnet.js`, `DmxNet(adaptador, post)`): en Windows
  el adaptador son los sockets `dgram` de Node (`desktop/dmx-service.mjs`) y en
  Android los sockets UDP nativos (`UdpHub.kt` por el puente, `dmx-android.js`).
- Detección: RDM E1.20 sobre Art-Net (`rdm.js`: ArtTodRequest/TodData/ArtRdm,
  DEVICE_INFO, fabricante, modelo, etiqueta y SLOT_INFO → tipo de luz, canales y
  dirección); USB-DMX con el protocolo DMX USB Pro por Web Serial (`usbdmx.js`);
  anuncios de láseres Ether Dream (UDP 7654). Sin RDM: perfiles por tipo y prueba
  guiada canal a canal.

### Show (`show.js`, `ltc-core.js`)
- Transiciones en el mismo shader (sin pasadas extra): fundido/destello/glitch por
  opacidad; disolver, cortinillas e iris por zonas en coordenadas de la salida.
- Timecode: MTC (midi.js), LTC (AudioWorklet con decodificador bifase), OSC
  `/lumamap/timecode` o interno. Las cues con timecode se disparan solas (también
  al saltar hacia atrás); sin señal el tiempo se detiene, no se inventa.
- Automatización: `ParamEngine.onRecord` graba lo que mueven los controles; las
  líneas se reproducen como modulación `timeline`.

### 3D (`three3d.js`, `panels-3d.js`)
- Objetos, grupos y proyectores en `project.stage3d`. Cada cara es una superficie
  virtual (`face3d`) con su look por escena: todo el sistema de contenido sirve.
- Atlas de caras (contexto propio con fuentes compartidas) → `CanvasTexture` con
  `offset/repeat` por cara (una subida por fotograma).
- Cada proyector se renderiza en su propio `OffscreenCanvas` a su resolución y se
  entrega como `ImageBitmap` a la fuente `projector3d` de una superficie 2D a
  pantalla completa (sobre ella siguen valiendo warp, máscaras y bordes suaves).
- Modo «Proyección»: proyección de textura desde cada proyector con prueba de
  profundidad (sombras) y cara de espaldas; se suman los solapes (zonas de blending).

### Tracking e interactivo (`tracking.js`, `tracking-worker.js`, `rules.js`, `body.js`, `interactive.js`)
- Tracking: MediaPipe Pose/Hands en un Web Worker (GPU con respaldo en CPU) sobre
  fotogramas reducidos; IDs estables por persona; señales al motor de parámetros
  (fuente «tracking»), zonas y reglas que ejecutan acciones de `rules.js`
  (incluida «efecto en las luces»).
- Interactivo: alineación cámara ↔ proyección por homografía (`interactive.js`):
  los puntos del cuerpo se transforman y las máscaras se dibujan con una malla
  de triángulos afines. Calibración automática: diferencia blanco − negro
  proyectados → contorno de 4 lados (`automap.js`). Efectos nuevos con una
  rejilla de presencia/movimiento; mismo código de canales R/G/B que body.js.
- Cámaras: `classifyCamera` (sources.js) reconoce por el nombre del dispositivo
  sensores de profundidad (y si la cámara es la de profundidad, infrarrojos o
  color), cámaras infrarrojas, escáneres 3D, capturadoras y cámaras virtuales.
  `watchCameras` avisa al enchufarlas. Con profundidad o infrarrojos se activa el
  modo sensor del detector (`BodyTracker.updateDepth`): fondo aprendido de la zona
  vacía y diferencia por píxel; vale para cualquier codificación de profundidad.

### Luces (`lightfx.js`)
- 75 efectos como funciones por LED (posición, tiempo, tempo, audio); CPU pura y
  barata, probada en Node. `dmx.js` los aplica a pixel maps (source «effect») y a
  focos; las cabezas móviles tienen movimientos de pan/tilt (16 bits).
- Una escena puede llevar un efecto de luces (`scene.lights`) que se aplica al entrar.

### AI Mapping Assistant (`web/js/ai/`)
```
APLICACIÓN ─ CORE · MAPPING · VJ · 3D · LUCES · INTERACTIVO · SHOW
     │
AI ENGINE (providers.js) ─ NoAIProvider (reglas, siempre) · LocalAIProvider (Ollama)
     │                      · RemoteAIProvider (Claude, opcional) · visión (contornos / modelo VL)
     ├─ ProjectContext (context.js)   estado real y estructurado del proyecto
     ├─ Project Analyzer (analyzer.js) problemas, HEALTH SCORE, siguiente paso
     ├─ AI Action System (actions.js)  lista blanca validada · proponer → Aplicar
     ├─ Base de conocimiento (knowledge.js) búsqueda ligera, solo lo necesario
     ├─ Intérprete sin IA (commands.js) · Show Director (showplan.js)
     ├─ Academia (academy.js) 10 niveles que esperan la acción del usuario
     └─ Hardware (hardware.js) RAM / VRAM / GPU → Qwen3 4B / 8B / 14B
```
- La IA nunca ejecuta código ni comandos: devuelve `{action, parameters}` que se
  validan contra la lista blanca y el usuario aplica. Acciones críticas con
  confirmación aparte.
- Todo asíncrono y fuera del bucle de render; si Ollama no existe, no tiene
  modelo, se queda sin memoria o no responde, el motor vuelve al modo sin IA con
  un mensaje comprensible.
- En escritorio, la IA local va por el proceso principal (`ai:http`), limitada a
  este equipo o la red local y a las rutas de la API de Ollama.
- Ajustes y privacidad en `localStorage` (de la app, no del proyecto); IA remota,
  imágenes y envío de datos del proyecto desactivados por defecto.

### Escritorio
- `remote-service.mjs`: el mismo `server/index.js` (mando + OSC) en un proceso
  aparte, con PIN para los mandos; el editor se conecta como «display» local.
- `updater.ps1`: actualizador independiente (espera, copia, instala, verifica,
  rollback, reabre). `test-install.ps1` lo prueba en el CI de Windows junto con
  reparar, desinstalar conservando datos y reinstalar.
- Registros en `%APPDATA%\LumaMap\logs`; recarga automática si el editor se cae.
