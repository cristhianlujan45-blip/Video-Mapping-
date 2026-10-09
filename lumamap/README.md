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
   los mueves. Al mover un punto, una lupa muestra el detalle bajo el dedo (al
   dibujar no aparece: el trazo es directo) y la cruceta mueve el punto píxel a píxel.
3. **Contenido** → video, imagen, GIF animado, animación generada, color, texto,
   cámara en vivo o dibujo. Luego **Efectos** y **Audio** para darle vida.
4. **Proyectar** → pantalla externa (HDMI/USB-C), ventana de salida o pantalla
   completa en el mismo dispositivo (para modo espejo o Chromecast).

## Modo simple y modo profesional

Por defecto LumaMap se usa como siempre (modo simple). En **☰ → Modo
profesional** aparecen pestañas nuevas sin cambiar nada de lo anterior:

| Pestaña | Para qué |
|---|---|
| **Show** | Cues (escenas) con 8 transiciones (corte, fundido, disolver, cortinillas, iris, destello, glitch), GO/BACK/STOP, timecode (interno, MIDI Time Code, LTC por audio, OSC) que dispara las cues, automatización (grabar movimientos de MIDI/OSC/DMX/audio y repetirlos), **modo actuación** y **EMERGENCIA**. |
| **3D** (también en modo simple) | **Fácil:** 1 · objeto (cubo, esfera, pirámide… o tu modelo), 2 · clic en una cara → su animación (o «una distinta en cada cara»), 3 · proyectores colocados solos alrededor: 1, 2 (esquina), 3, 4 (360°) o **holograma de pirámide** (4 vistas en cruz). Navegación como Blender: arrastrar = girar alrededor, clic derecho = desplazar, rueda / dos dedos = acercar, y botones en pantalla (girar, acercar, frente, lado, arriba). Avanzado: Espacio 3D real: cubos, planos, esferas, cilindros, conos, pirámides, prismas y modelos importados (OBJ, FBX, GLTF/GLB, STL, PLY); proyectores virtuales con FOV, resolución, lens shift y frustum; gizmos, rejilla, snap (rejilla, vértice, arista, cara), unidades, navegación tipo Blender y 8 modos de vista. Cada cara tiene su propio contenido y cada proyector sale por P1-P4. |
| **Control** | MIDI profesional: detección y conexión en caliente, MIDI LEARN (clic derecho en cualquier control → *Aprender*), 14 bits, encoders relativos, soft takeover, feedback (LED, motores), bancos, modificadores SHIFT/ALT/CTRL, macros, MIDI Clock/MTC, monitor y diagnóstico. También teclas, OSC y audio. |
| **Luces** (también en modo simple) | Vista fácil: **1 · Conectar** (buscar el nodo Art-Net y conectar con un toque, o enviar a toda la red; sin equipo, modo práctica en pantalla) → **2 · Mis luces**: **«Detectar mis luces automáticamente»** (las luces con RDM dicen solas qué son —tipo, fabricante, modelo, canales y dirección— a través del nodo Art-Net; las interfaces USB-DMX tipo Enttec DMX USB Pro se detectan al enchufarlas; los láseres Ether Dream se ven en la red) o, para luces sin RDM, un toque en su tipo (tira LED, matriz, aro, barra, PAR, cabeza móvil, wash, beam, láser DMX, estrobo, humo, UV, blinder…) o «No sé qué luz es» (prueba guiada canal a canal) → **3 · Efectos**: **75 efectos de luz** en 9 categorías (persecuciones, arcoíris, estrobo, fiesta, naturaleza, especiales, matriz LED, música) con vista previa animada, dos colores, velocidad, tamaño y «al ritmo de la música»; movimientos para cabezas móviles (círculo, ocho, barrido, abanico, al azar, al tempo) → **PLAY**. En modo profesional: pixel mapping completo, video → luces en la GPU, fixtures, universos, snapshots, monitor, diagnóstico y entrada DMX. |
| **Interactivo** (también en modo simple) | Proyecciones que reaccionan a la gente con **cualquier cámara o sensor** (web, USB, capturadora HDMI, móvil, cámara infrarroja, **sensor de profundidad 3D**). Cada cámara se reconoce por su nombre al enchufarla (sensor 3D, infrarroja, escáner 3D, capturadora, móvil/OBS) y con un sensor de profundidad o infrarrojo se activa solo el **modo sensor**: aprende la zona vacía y ve a la gente aunque esté quieta o a oscuras, sin que le afecte la luz del proyector. Escáner 3D: se indica cómo exportar el escaneo (OBJ/GLB/PLY) para mapear encima en la pestaña 3D; escanear desde LumaMap está **EN DESARROLLO**. **Alineación cámara ↔ proyección**: automática (el proyector muestra negro y blanco y la cámara encuentra la zona proyectada) o con 4 esquinas a mano, para que el efecto salga justo donde está la persona. 24 efectos: silueta, contorno neón, estela, sombra, **ondas al pisar, pintar con el cuerpo, burbujas que explotan, partículas que se apartan, huellas de luz, chispas al tocar, baldosas de discoteca, silueta de píxeles, luciérnagas que te siguen, lluvia que te esquiva, fuegos artificiales, estela de estrellas, rayos láser a las personas, revelar una imagen**, partículas y fuego de manos y pies, humo, esqueleto, líneas entre personas, geometría. **⭐ 18 experiencias listas** (lago mágico, estanque koi, pista de baile, fuegos al saltar, pinta con tu cuerpo, polvo de estrellas, niebla mágica, bosque de otoño, fútbol gigante, revienta burbujas, playa, nieve, láser, sombra de neón, «al entrar alguien empieza tu video», «levanta la mano: siguiente video», bienvenida que enciende la Pantalla 2) que montan efecto + reacciones + luces con un toque; **efectos profesionales en la GPU** (agua real con ondas que rebotan, fluido de colores, humo, arena y nieve con huellas, niebla que se aparta, hojas, pétalos, pelota con física, polvo de estrellas); grabar video o foto de la experiencia. Silueta de **cuerpo entero** (hasta 4 personas a varios metros) con corrección de luz para salas oscuras y paso automático a la CPU si la tarjeta no deja leer la silueta. Reacciones con un toque (al entrar alguien → escena siguiente o luces «Fuego»…). |
| **✨ Estilos** (Efectos, también en modo simple) | 18 estilos de imagen tipo Ladybug sobre cualquier contenido (video, cámara, animación o interactivo): ASCII a color y blanco, Retro Matrix, campo de números, texto dither, código de píxeles, semitonos dorados, RISO, píldoras con texto, rejilla de glifos, dither 1 bit y con brillo, píxel dither, Game Boy, térmica, térmica rosa, trazo neón y polvo de estrellas; tamaño, brillo y color. Calculados en la GPU. |
| **⏱ Pantallas por tiempos** (En vivo) | Encender y apagar pantallas (P1-P4) y superficies a tiempos: plantillas de un toque (todas a la vez/sincronizadas, una tras otra, alternar, persecución) o pasos a mano («a los 0:05 → Pantalla 2 ON»), en bucle, al abrir el proyecto o a una hora del día. También desde reglas interactivas y la IA. |
| **Tracking** | Cuerpo (33 puntos) y manos de hasta 4 personas con IA en la GPU (MediaPipe, en un hilo aparte) desde cualquier cámara; zonas interactivas dibujadas sobre la imagen; señales (mano levantada, cercanía, velocidad, brazos abiertos…) que mueven parámetros, y reglas «cuando … entonces …». Esqueleto 3D desde sensores de profundidad y cámaras IP/NDI: **EN DESARROLLO** (se muestran desactivados; los sensores de profundidad ya funcionan en «Interactivo»). |
| **🧠 AI Mapping Assistant** (también en modo simple) | Botón permanente **«¿Qué hago ahora?»** (recomienda solo el siguiente paso y «Hacerlo conmigo»). Panel con «¿Qué quieres hacer?»: Crear Mapping, Configurar Proyector, **Analizar Superficie (Auto Map)**, **Detectar Problemas** (salud del proyecto 0-100 por área con arreglos), **Academia** (10 niveles paso a paso que esperan tu acción), Optimizar, **Show Director** (plan INTRO/BUILD/DROP/BREAK/CLIMAX/OUTRO aplicable como escenas con luces) y preguntas en lenguaje natural. La IA **solo propone** acciones de una lista blanca validada: tú pulsas Aplicar o Cancelar. **IA local gratis con Ollama + Qwen3** (detecta tu hardware y recomienda 4B / 8B / 14B; nada que descargar si no quieres), IA remota opcional (Claude, desactivada por defecto) y **todo funciona sin IA**. **🎵 Show con mi canción**: eliges un mp3/wav, la IA detecta el tempo y las partes (intro, subida, drop, pausa, clímax, final), crea las escenas con su duración real, animaciones según la energía, luces y reacción al ritmo, y lo reproduce sincronizado. Entiende frases de todos los días: «sube el brillo», «pausa», «estilo ASCII», «escribe Feliz cumpleaños», «luces rojas», «busca un gif de confeti», «asigna el botón A del mando al apagón», «haz un holograma con 2 proyectores», «apaga la pantalla 2», «pon un lago interactivo». Las órdenes claras se resuelven al instante sin esperar al modelo, y si el modelo no aporta nada responde con ejemplos (nunca «no sé»). Privacidad configurable. |
| **🧊 Crear objeto 3D** (Añadir, Contenido, 3D, ☰ o pidiéndoselo a la IA: «hazme un carro») | Escribes qué quieres y LumaMap lo crea en 3D. **Sin internet:** biblioteca propia de objetos paramétricos (carro deportivo/sedán/camioneta, casa, árbol, cohete, avión, robot, corazón, estrella, planeta, diamante, trofeo, regalo y texto 3D) con estilos y colores. **Con la IA local o Claude:** cualquier objeto («un dragón»), que la IA describe como piezas (JSON validado, nunca código). Vista previa girando; acabado realista (pintura con barniz, metal, cristal, luces), neón u holograma azul; vista frente, 3/4, lado o arriba. Un toque: **proyectar** en una superficie (girando), **holograma** (en la pirámide cada cara lo ve desde su lado), **al espacio 3D** para mapearlo con 1-4 proyectores, o **descargar .OBJ** (Blender y otros). |
| **🎤 Holograma** (☰, Añadir → Conjuntos, plantilla de inicio, 3D o pidiéndoselo a la IA) | Asistente de 4 preguntas con dibujo del montaje: **escenario como Tupac** (técnica «fantasma de Pepper»: lámina transparente a 45° que refleja la proyección), **tela holográfica (tul)** o **pirámide**. Qué aparece: tu video (con el fondo quitado por **IA fotograma a fotograma**, o fondo verde / negro), la **cámara en vivo** sin fondo, una animación o un texto. **1 a 4 proyectores**: la imagen se reparte sola entre P1-P4 y donde se solapan se funde con bordes suaves. Hace solo: fondo negro puro (invisible en la lámina), más brillo y contraste, aspecto holograma opcional (azul con líneas). Luego dice cómo colocarlo paso a paso, y si se ve al revés: «↕ Girar», «↔ Espejo» y «Probar orientación» (flecha y letra R). |
| **🎮 Mandos, teclado y MIDI** (En vivo) | Mandos de **Xbox, PlayStation**, Switch o genéricos (USB o Bluetooth), el teclado y controladores MIDI a la vez: **cada dispositivo tiene sus propias asignaciones** (el botón A del Mando 1 y el del Mando 2 pueden hacer cosas distintas). «Qué quieres que haga» → «Asignar un botón» → pulsas el botón. Mapa listo para mando (A = GO, B = anterior, X = play, Y = apagón, LB/RB = escenas, RT = bajar brillo). Sticks y gatillos analógicos con zona muerta. Con varios teclados, el sistema los ve como uno solo. |
| **🔍 Buscar GIF animado** (En vivo, Contenido, Siguiente) | Busca GIF en **Openverse** (gratis, sin cuenta, licencias libres: muestra autor y licencia) o **GIPHY** (con una clave gratuita), o pega un enlace. Un toque y entra **en vivo con fundido**, como **capa encima**, como siguiente o a la biblioteca. En Windows y Android la descarga la hace la app (solo https y solo internet). Sin internet lo dice claramente. |
| **Rendimiento** | FPS, tiempo de fotograma, fotogramas perdidos, CPU, RAM, GPU y VRAM reales (Windows), videos decodificados y perdidos; calidad de la vista previa independiente de la salida. |

Todo lo que se puede mover (brillo, opacidad, efectos, crossfader, luces, 3D…) pasa
por un **motor de parámetros** único: MIDI, OSC, DMX, teclado, audio, tracking,
timeline y mando remoto pueden controlar el mismo parámetro a la vez (sustituir,
sumar, multiplicar, máximo, mínimo).

**Lo que no se simula:** si algo no está conectado, se dice. El panel Luces muestra
«✗ Nodo» si ningún nodo responde; el MIDI solo lista dispositivos reales; el uso de
GPU muestra «no disponible» si Windows no lo expone.

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
- Pestaña **Animaciones** con **184 animaciones** catalogadas (Virales 🔥, Nuevas ✨,
  Abstracto, Geométrico, Naturaleza, Espacio, Neón y retro, Luces y show, Fiesta,
  Música ♪, Calibración) con buscador y miniaturas, sobre 92 animaciones base en GPU:
  hipnosis, hiperespacio, agujero negro, portal, lámpara de lava, metal líquido,
  fractal, logo DVD rebotando, zoom infinito, carretera arcoíris, show de láseres,
  visualizador circular… Sin superficie seleccionada, tocar una animación la pone
  a pantalla completa.
- **Girar**: asa circular encima de la superficie para girarla a cualquier ángulo
  (se engancha a 0°, 45°, 90°…), botones ±1°/±15°/±90° y atajos Q / E; la imagen
  se gira aparte dentro de la superficie (deslizador y ⟲/⟳ 90°).
- **Mezcla en vivo (pestaña En vivo)**: cada superficie o pantalla tiene AHORA y
  SIGUIENTE; eliges lo siguiente (animación, video, cámara o cuerpo), lo mezclas
  con el fader A⟷B o pulsas GO para fundir (corte, ½ s … 8 s). GO todas, todas al
  azar y mezcla automática al ritmo cada 4/8/16/32 golpes. Atajos: Enter = GO
  todas, Shift+Enter = todas al azar, Z = siguiente al azar, X = GO.
- **Varias pantallas (P1-P4)**: cada superficie elige por qué salida sale; cada
  pantalla se enciende/apaga por separado y tiene su brillo, estrobo y efecto
  (blanco y negro, invertir, sepia, colores vivos, arcoíris, desenfoque…). En
  Windows cada pantalla se abre sola en el siguiente monitor/proyector libre.
- **Proyección interactiva (cualquier cámara o sensor)**: una cámara apuntando a la persona o al
  artista convierte su silueta en animación en tiempo real con IA (MediaPipe,
  incluida en la app, funciona sin internet): silueta animada, contorno neón,
  estela de movimiento, sombra, persona sin fondo o solo movimiento. Sin IA usa
  la detección de movimiento.
- **Varias cámaras**: cada fuente elige su cámara (USB, capturadora, la del móvil,
  trasera o frontal); unas para proyectar con efectos, otras como cuerpo y otras
  como **sensores**: cuando alguien se mueve en una zona (izquierda, centro,
  derecha, arriba, abajo) cambia la animación, hace un golpe de luz, cambia de
  escena o enciende/apaga superficies.
- **Pantalla completa en un toque** (barra de la superficie, Contenido o Shift+G).
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

**Proyector que se desconectaba:** Windows apagaba la pantalla por inactividad
durante los shows (nadie toca el ratón): LumaMap ahora lo impide mientras está
abierto. La ventana de salida se recupera sola si su proceso o la GPU se reinician,
espera 3 s ante un parpadeo del HDMI antes de moverse y se recoloca si el
proyector cambia de resolución. En Android, si el sistema cierra la salida
(pantalla bloqueada, parpadeo del cable) se vuelve a abrir sola.

El módulo `android/` empaqueta la app web en el APK (sin servidor ni internet) y
añade lo nativo:

- **Salida al proyector** por HDMI, USB-C (DisplayPort) o pantalla inalámbrica con
  `Presentation`: el proyector muestra solo la imagen y el teléfono sigue siendo el
  editor. Se detecta al conectar y, si se desconecta el cable, vuelve sola.
- Selector de archivos del sistema, permisos de cámara y micrófono, exportar con el
  selector de documentos, pantalla siempre encendida, modo inmersivo, vibración al
  agarrar puntos y botón Atrás (doble pulsación para salir, así el show no se
  cierra por accidente).
- **Luces por Wi-Fi o cable de red** (Art-Net, sACN, búsqueda de nodos y detección
  RDM) con los sockets UDP nativos de Android: el mismo motor que en Windows.
- **MIDI** (controladores USB y los Bluetooth ya conectados al teléfono) con el MIDI
  de Android, **OSC** en el puerto UDP 9129, **IA local** con Ollama en un PC de tu
  red e **interfaz USB-DMX** con cable OTG (ver la tabla de abajo).
- **Rápida en cualquier móvil:** la primera vez mide la velocidad del teléfono y, si
  va justo, baja la calidad de la vista previa (la salida al proyector no cambia).
  ☰ → «Prueba de velocidad» la repite cuando quieras. Las pruebas automáticas
  miden cada versión en un móvil simulado con la CPU 4 veces más lenta.
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
- **Motor compartido:** las ventanas de salida (P1-P4) usan los videos y cámaras
  ya decodificados por el editor: cada video se decodifica una sola vez aunque
  salga por cuatro proyectores, y todas las salidas van con el mismo reloj.
- **Servicios en procesos aparte:** la red DMX (Art-Net/sACN) y el mando remoto/OSC
  corren en su propio proceso; si se caen, se reinician solos sin parar el show.
  Si el editor se minimiza, el show sigue (reloj, salidas, luces, MIDI).
- **Mando remoto:** ☰ → *Mando remoto y OSC* muestra la dirección para abrir en el
  teléfono y el PIN. OSC en el puerto UDP 9129 (`/lumamap/param/<parámetro>`,
  `/lumamap/timecode`, `/lumamap/go` y cualquier dirección con *Aprender*).
- **Actualizar con seguridad:** al pulsar *Actualizar* se guarda el proyecto, se
  liberan cámaras/MIDI/DMX, se descarga el instalador y se comprueba su SHA-256;
  un actualizador independiente espera a que LumaMap se cierre, hace copia de la
  versión instalada, instala, verifica y, si algo falla, **vuelve sola a la versión
  anterior**. ☰ → *Volver a la versión anterior* y *Reparar instalación*.
- **Desinstalar** conserva proyectos, medios y ajustes (pregunta si quieres
  borrarlos). Registros en ☰ → *Abrir registros*.

```bash
cd lumamap/desktop
npm install
npm start               # probar en tu PC
npm run installer:win   # dist/LumaMap-Setup-<versión>.exe (en Linux necesita Wine)
npm run dist:win        # alternativa portable: dist/LumaMap-<versión>-Windows-x64.zip
```

## Windows y Android: lo mismo en los dos

El editor, el motor de mapping, los efectos, el show, el 3D, el tracking, el
asistente y las luces son **el mismo código** en las dos apps. Solo cambia lo que
toca el sistema (lo que en Windows hace `window.LumaDesktop` y en Android
`window.LumaNative`). Estado real de cada cosa:

| Función | Windows | Android |
|---|---|---|
| Salida al proyector (P1) | Ventana a pantalla completa | **Igual** (HDMI / USB-C / inalámbrica con `Presentation`) |
| Salidas P2-P4 | Ventanas en otros monitores | **No aplica:** un teléfono solo tiene una pantalla externa. P2-P4 se usan desde Windows o el navegador |
| Detectar proyector al enchufarlo | Sí | **Igual** |
| Luces Art-Net / sACN / RDM | Servicio en proceso aparte | **Igual** (mismo motor, sockets UDP nativos) |
| Interfaz USB-DMX (DMX USB Pro, FTDI) | Web Serial | **Adaptado:** USB host con cable OTG (`UsbDmx.kt`). **Sin probar todavía con hardware real**; si no responde, usa Art-Net por Wi-Fi |
| MIDI (notas, CC, clock, MTC, feedback) | Web MIDI | **Adaptado:** MIDI de Android (`MidiHub.kt`) con la misma interfaz que Web MIDI. Bluetooth: solo aparatos que el sistema ya tenga conectados (LumaMap no los busca) |
| OSC de entrada (puerto 9129) | Servicio de mando remoto | **Adaptado:** UDP nativo y lector OSC en la página (`osc-web.js`); ☰ → *Mando remoto y OSC* muestra la IP del teléfono |
| Mando remoto desde el navegador de otro teléfono (PIN) | Sí | **No disponible:** necesita el servidor de la app de Windows. En Android se controla por OSC |
| IA local (Ollama) | Sí | **Adaptado:** la app hace la petición (`LocalAi.kt`), solo a este teléfono o a la red local. Ollama va en un PC de la red (`OLLAMA_HOST=0.0.0.0`) |
| IA remota (Claude) | Sí (clave cifrada) | **No disponible:** solo en Windows; la app lo dice en Ajustes de IA |
| Optimizar videos al importarlos | Sí | **Igual** (transcodificación por hardware de Android) |
| Actualizar la app | Instalador con copia de seguridad | **Adaptado:** descarga el APK nuevo y abre el instalador de Android |
| Volver a la versión anterior / Reparar instalación | Sí | **No aplica:** es del instalador de Windows. En Android se instala el APK anterior encima |
| Menú de la ventana | Sí | **No aplica:** en Android están ☰ y la paleta de comandos |
| Mandos de Xbox / PlayStation | Gamepad API | **Igual** (el botón B/○ del mando ya no hace «Atrás») |
| Buscar GIF animados | Descarga el proceso principal | **Igual** (descarga la app, `NetGet.kt`) |
| Holograma con 2-4 proyectores | Sí (P1-P4) | **Adaptado:** el holograma funciona igual, pero por P1 (una salida HDMI); para 2-4 proyectores, Windows |
| Registros (☰ → Abrir registros) y métricas de CPU/GPU del sistema | Sí | **No disponible:** en Android los mensajes van a `logcat`; el panel de rendimiento muestra lo que mide la página |
| Diagnóstico de hardware para la IA | Medido por Windows | **Adaptado:** lo que dice la WebView (núcleos, memoria aproximada) |

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
npm test                 # geometría, modelo, historial, dibujo, motor de parámetros, MIDI,
                         # Art-Net/sACN, pixel mapping, timecode LTC, show, servidor y OSC,
                         # y las piezas de Android (OSC, MIDI, USB-DMX, IA) con puentes falsos
npm run test:browser     # extremo a extremo en Chromium (necesita Playwright)
npm run test:perf        # velocidad como en un móvil (412×915, CPU ×4) con límites:
                         # arranque, pestañas, fotograma, luces, interactivo, memoria
xvfb-run -a node tests/desktop.e2e.mjs   # app de escritorio real con red de verdad
                                         # (Art-Net, sACN, nodos, entrada DMX, OSC, mando)
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
│       ├── link.js      canal editor ↔ salida (BroadcastChannel / Android)
│       ├── params.js    motor de parámetros (MIDI, OSC, DMX, audio, tracking…)
│       ├── midi.js      controladores MIDI, clock y time code
│       ├── dmx.js       pixel mapping, fixtures, universos (muestreo en GPU)
│       ├── dmxproto.js  Art-Net, sACN y parcheo de píxeles
│       ├── show.js      timecode, cues, automatización
│       ├── ltc-core.js  decodificador LTC (AudioWorklet)
│       ├── three3d.js   espacio 3D y proyectores virtuales (three.js)
│       └── panels-*.js  paneles del modo profesional
├── android/             app Android (WebView + Presentation)
├── desktop/             app de escritorio (Electron: Windows, macOS, Linux)
│   ├── dmx-service.mjs  red DMX (proceso aparte)
│   ├── remote-service.mjs mando remoto y OSC (proceso aparte)
│   └── updater.ps1      actualizador independiente con copia y rollback
├── server/              servidor opcional: estáticos, mando remoto, OSC
└── tests/
```

Detalles técnicos en [ARCHITECTURE.md](ARCHITECTURE.md).

## Licencia

MIT.
