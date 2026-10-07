# LumaMap 2 · Video mapping táctil

Proyecta videos, animaciones, textos y dibujos sobre paredes, fachadas, cajas o
escenarios, ajustándolos con el dedo desde el teléfono o la tablet. Funciona
**sin internet** como app de Android (con salida HDMI/USB-C al proyector) o en
cualquier navegador moderno.

## Cómo se usa (4 pasos)

1. **Añadir** → elige una forma (4 esquinas, malla curva, círculo, triángulo,
   estrella…), trázala a mano o usa un conjunto listo (cubo 3D, fachada, escenario).
2. **Ajusta los puntos amarillos** a las esquinas reales de la pared. Activa
   *Proyectar → Guías en el proyector* para ver los contornos en la pared mientras
   los mueves. Una lupa muestra el detalle bajo el dedo y la cruceta mueve el punto
   píxel a píxel.
3. **Contenido** → video, imagen, GIF animado, animación generada, color, texto,
   cámara en vivo o dibujo. Luego **Efectos** y **Audio** para darle vida.
4. **Proyectar** → pantalla externa (HDMI/USB-C), ventana de salida o pantalla
   completa en el mismo dispositivo (para modo espejo o Chromecast).

## Funciones

**Mapeo**
- Corner pin con perspectiva exacta (homografía en GPU, sin aproximaciones).
- Malla de deformación de hasta 10×10 puntos con curvas suaves (Catmull-Rom) para
  columnas, esquinas redondeadas y superficies irregulares.
- Formas libres: círculo, triángulo, hexágono, estrella, rombo, trazar a mano o
  punto a punto.
- **Esquinas unidas**: al mover una esquina que coincide con la de otra superficie
  (caras de un cubo, ventanas contiguas) se mueven juntas.
- Máscaras poligonales con borde suave e inversión, para esquivar puertas, ventanas
  o muebles.
- Gestos: un dedo mueve; dos dedos sobre la forma escalan y giran; dos dedos fuera
  hacen zoom en la vista; doble toque en vacío encaja la vista. Lupa de precisión,
  cruceta con modo fino (¼ px), espejo, volteo, giro de 90°, enderezar, pantalla
  entera, duplicar, bloquear, ocultar y ordenar capas.
- Detección de superficies en una foto (experimental) y foto o cámara de
  referencia en el editor para trazar las formas.

**Contenido**
- Biblioteca de **144 animaciones** catalogadas (Abstracto, Geométrico, Naturaleza,
  Espacio, Neón y retro, Luces y show, Fiesta, Música ♪, Calibración) con buscador
  y miniaturas, sobre 72 animaciones base en GPU.
- Biblioteca de **122 efectos** (color, retro, glitch, distorsión, caleidoscopio,
  movimiento, luz y cámara: chroma key, luma key, bordes, térmica, visión nocturna…).
- Videos, fotos y **GIF animados** (también WebP/APNG animados).
- **Texto animado**: marquesina, créditos, máquina de escribir, letra a letra, ola,
  rebote, arcoíris, karaoke, pulso con la música, neón, glitch, zoom… con brillo
  y contorno.
- **Conversión automática de video al importar** (como Alley de Resolume): si un
  video es pesado (ProRes, HEVC, 4K en una salida 1080p, bitrate altísimo…) se
  convierte solo a H.264 ligero usando la tarjeta gráfica; si ya es adecuado se
  importa al instante.

**Dibujar en la pared**
- Pinceles **neón** con resplandor, pincel normal, línea, rectángulo, círculo y
  borrador de trazos; relleno opcional; 10 colores y selector libre.
- Trazos **animados**: se dibujan solos, flujo, pulso al ritmo, arcoíris y parpadeo.
- Lo que dibujas aparece en el proyector en tiempo real. Cada lienzo es una
  superficie más: se puede deformar, enmascarar o llevar efectos.

**Contenido**
- Video (MP4, WebM, MOV…), imagen (JPG, PNG, WebP, SVG), **GIF y WebP animados**.
- 16 animaciones generadas en GPU con colores, velocidad y escala en vivo: plasma,
  arcoíris, túnel, ondas, rayas, damero, nubes, fuego, estrellas, espiral, láser,
  neón grid, líneas, degradado, ladrillos y patrón de calibración.
- Texto con fuentes, colores, fondo y marquesina; color sólido; cámara en vivo.
- Encaje estirar / recortar / ajustar; velocidad y volumen por video.

**Efectos** (todos en un único shader, tiempo real)
- 12 efectos rápidos (Neón, Glitch, VHS, Caleidoscopio, Espejo, Ondas, B/N,
  Negativo, Pixel, Contorno, Estroboscopio).
- Borde neón sobre el contorno con animación de persecución, pulso o arcoíris
  (también sin relleno: líneas de luz sobre la arquitectura).
- Brillo, contraste, saturación, tono, negativo, zoom, rotación, giro continuo,
  desplazamiento, ondas, caleidoscopio, espejos, pixelado, separación RGB,
  desenfoque, ruido y estroboscopio. Opacidad y 4 modos de mezcla.

**Audio y ritmo**
- El micrófono analiza graves, medios, agudos y volumen con ganancia automática,
  detecta cada **golpe (beat)** y calcula el **BPM** de la música (probado con
  pistas de 95 y 128 BPM: detecta 94,7 y 128,1).
- **Al compás:** con el tempo detectado, los efectos caen sobre una rejilla exacta
  enganchada al bombo (no a la caja ni a los platos) que se corrige sola con cada
  golpe. Botones ½× / 2× / ±1 / «1» (primer tiempo) y ajuste de **sincronía** en ms
  por si el proyector o el altavoz añaden retardo.
- **Modo ritmo** (se activa solo al encender el micrófono): todo el mapping late
  con cada golpe: destello de luz, golpe de zoom, cambio de color, aceleración de
  las animaciones y parpadeo, con intensidad regulable. Puede **cambiar de escena
  cada N golpes**.
- Sin micrófono, el pulso sigue el BPM marcado con el botón **TAP**.
- Además, cada superficie puede reaccionar por su cuenta a una banda concreta.

**Show**
- Escenas: mismo mapeo con distinto contenido; fundido o corte, duración, avance
  automático y bucle. Teclas 1-9, MIDI, mando remoto u OSC para cambiarlas.
- Brillo general, apagón, patrones de prueba (cuadrícula, blanco, barras, RGB) y
  guías de alineación en el proyector.

**Proyectos**
- Autoguardado continuo y restauración al abrir. Guardar, abrir, guardar como.
- Exportar/importar `.lumamap` con los medios incluidos. Abre proyectos de
  LumaMap v1. Deshacer/rehacer ilimitado (80 pasos). Resolución de salida
  configurable (incluida la del proyector conectado).

## Android

El módulo `android/` empaqueta la app web en el APK (sin servidor ni internet) y
añade lo nativo:

- **Salida al proyector** por HDMI, USB-C (DisplayPort) o pantalla inalámbrica con
  `Presentation`: el proyector muestra solo la imagen y el teléfono sigue siendo el
  editor. Se detecta al conectar y, si se desconecta el cable, vuelve sola.
- Selector de archivos del sistema, permisos de cámara y micrófono, exportar con el
  selector de documentos, pantalla siempre encendida, modo inmersivo, vibración al
  agarrar puntos y botón Atrás (doble pulsación para salir, así el show no se
  cierra por accidente).
- **Recuperación automática:** si el motor de la WebView se cae (poca memoria,
  GPU), la app lo recrea y restaura el proyecto en lugar de cerrarse.
- APK *release* optimizado (≈300 KB) firmado siempre con la misma clave
  (`android/lumamap-test.jks`, solo para pruebas; para Google Play usa tu clave con
  `keystore.properties`).

Compilar desde la raíz del repositorio:

```bash
./gradlew :lumamap:assembleRelease
# APK: lumamap/android/build/outputs/apk/release/lumamap-release.apk
```

Requiere Android 8.0+ y Android System WebView / Chrome actualizado (WebGL2).

## Descargas

La última versión se publica sola en la página **Releases** del repositorio
(versión preliminar «LumaMap (última versión)»):

- **Windows:** `LumaMap-Setup.exe` → doble clic, instala y crea
  accesos directos en el escritorio y el menú Inicio. Requiere Windows 10 u 11 de
  64 bits. Si aparece «Windows protegió su PC»: *Más información → Ejecutar de
  todas formas* (el instalador no lleva certificado de pago).
- **Android:** `LumaMap-Android.apk`. Todas las versiones se firman con la misma
  clave, así que cada APK nuevo se instala **encima** del anterior sin perder tus
  proyectos (solo hay que desinstalar una vez las versiones 2.0 y 2.1).

**Actualizar sin reinstalar:** la app consulta `version.json` al abrirse; si hay
una versión nueva aparece el aviso con el botón **Actualizar** (también en
☰ → *Buscar actualizaciones*). En Windows se descarga y se reinstala sola; en
Android se descarga y se abre la pantalla de instalación (la primera vez hay que
permitir «Instalar apps desconocidas» para LumaMap).

## Windows (PC)

`desktop/` empaqueta la misma app con Electron y añade:

- **Menú de la ventana** con todas las acciones y sus atajos (Archivo, Editar,
  Añadir, Ver, Proyección, Escenas, Audio, Ayuda).
- **Salida al proyector** a pantalla completa en la segunda pantalla (Win + P →
  Extender), con selector de pantalla en *Proyección → Pantalla de salida* y
  recolocación automática al reconectar.
- Micrófono, cámara y MIDI sin pedir permisos cada vez.

```bash
cd lumamap/desktop
npm install
npm start               # probar en tu PC
npm run installer:win   # dist/LumaMap-Setup-<versión>.exe (en Linux necesita Wine)
npm run dist:win        # alternativa portable: dist/LumaMap-<versión>-Windows-x64.zip
```

## Comandos y atajos

- **Ctrl+K** abre la paleta de comandos: escribe lo que quieres hacer («estrella»,
  «grabar», «apagón»…) y pulsa Enter. Hay más de 70 comandos.
- **Clic derecho** (o mantener pulsado en táctil) sobre una superficie: duplicar,
  copiar/pegar, copiar/pegar estilo, traer al frente, centrar, máscara, bloquear…
- **Grabar video** de la salida (Ctrl+R) con la música del micrófono, y **capturar
  imagen** PNG (Ctrl+Mayús+P).
- **F1** muestra todos los atajos. Algunos: Espacio reproducir · B apagón · G guías ·
  M micrófono · R modo ritmo · T tap · D dibujar · Mayús+R/M/C rectángulo/malla/círculo ·
  C centrar · L bloquear · H ocultar · Ctrl+C/V/D copiar/pegar/duplicar · 1-9 escenas.

## Navegador (PC, tablet, PWA)

```bash
cd lumamap
npm start            # http://localhost:8080 (y la IP de tu red local)
```

- `/` editor · `/output.html` salida (llévala al proyector y pulsa *Pantalla
  completa*) · `/controller.html` mando remoto para otro teléfono en la misma WiFi.
- OSC por UDP en el puerto 9129: `/lumap/play`, `/lumap/pause`, `/lumap/stop`,
  `/lumap/next`, `/lumap/prev`, `/lumap/scene <i>`, `/lumap/brightness <0-1>`,
  `/lumap/opacity <0-1>`, `/lumap/blackout`.
- MIDI (Chrome/Edge): notas 36-51 = escenas 1-16, 60 play, 61 pausa, 62 stop,
  63/64 siguiente/anterior, CC1 brillo general, CC21 opacidad.

## Pruebas

```bash
cd lumamap
npm test                 # geometría, modelo, historial, dibujo, servidor, WebSocket y OSC
npm run test:browser     # extremo a extremo en Chromium (necesita Playwright)
```

## Estructura

```
lumamap/
├── web/                 app (HTML + ES modules, sin compilación)
│   ├── index.html       editor táctil
│   ├── output.html      salida limpia para el proyector
│   ├── controller.html  mando remoto
│   └── js/
│       ├── editor.js    estado, gestos, proyección, archivos
│       ├── panels.js    paneles (Añadir, Dibujar, Contenido, Efectos…)
│       ├── renderer.js  motor WebGL2: warp, malla, generadores, efectos
│       ├── compose.js   resuelve el contenido de cada superficie
│       ├── math.js      homografías, malla, triangulación
│       ├── model.js     proyecto, escenas, plantillas, migración v1
│       ├── drawing.js   pinceles y animaciones del dibujo
│       ├── sources.js   videos, GIF, cámara, texto
│       ├── audio.js     análisis del micrófono y tempo
│       └── link.js      canal editor ↔ salida (BroadcastChannel / Android)
├── android/             app Android (WebView + Presentation)
├── desktop/             app de escritorio (Electron: Windows, macOS, Linux)
├── server/              servidor opcional: estáticos, mando remoto, OSC
└── tests/
```

Detalles técnicos en [ARCHITECTURE.md](ARCHITECTURE.md).

## Licencia

MIT.
