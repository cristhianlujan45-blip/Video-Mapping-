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
  detecta cada **golpe (beat)** y calcula el **BPM** de la música.
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
  agarrar puntos y botón Atrás.

Compilar desde la raíz del repositorio:

```bash
./gradlew :lumamap:assembleDebug
# APK: lumamap/android/build/outputs/apk/debug/lumamap-debug.apk
```

GitHub Actions lo compila en cada push y lo publica como artefacto
**`lumamap-debug-apk`** (pestaña *Actions*). Requiere Android 8.0+ y Android
System WebView / Chrome actualizado (WebGL2).

## Windows (PC)

`desktop/` empaqueta la misma app con Electron. Descarga
`LumaMap-<versión>-Windows-x64.zip` (artefacto **`lumamap-windows-x64`** de
GitHub Actions), descomprímelo y abre **`LumaMap.exe`**; no requiere instalación.
Conecta el proyector como pantalla extendida (**Win + P → Extender**) y pulsa
*Proyectar → Abrir ventana de salida*: se abre sola a pantalla completa en el
proyector y se recoloca si lo reconectas.

```bash
cd lumamap/desktop
npm install
npm start            # probar en tu PC
npm run dist:win     # dist/LumaMap-<versión>-Windows-x64.zip
```

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
