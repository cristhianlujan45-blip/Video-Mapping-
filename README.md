# LUJAN MAPPING

Projection mapping para Android: colocas videos e imágenes sobre superficies reales
(paredes, fachadas, cajas, escenarios) deformando sus esquinas con el dedo, y envías la
salida limpia a un proyector por HDMI/USB-C mientras el teléfono o la tablet sigue
siendo el controlador.

> Estado: **MVP (fase 1)**. Para el análisis técnico, las decisiones y los límites reales
> de Android, consulta [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md).

## Funciones del MVP

- **Importar** videos (MP4, WebM, MOV con H.264/H.265, MKV…) e imágenes (PNG, JPG,
  WebP, HEIC, BMP; el GIF se carga como imagen fija) desde el dispositivo, sin pedir
  permisos de almacenamiento.
- **Superficies** con **corner pinning** de perspectiva exacta (homografía en la GPU).
  Cada esquina se arrastra por separado y el modo precisión mueve ×0.2. Hay superficies
  de calibración (patrón con esquinas de color) y de color sólido.
- **Transformaciones:** posición X/Y, escala, rotación, perspectiva, opacidad, recorte,
  espejo horizontal y vertical, y borde suave.
- **Máscaras:** rectángulo, círculo/elipse, polígono editable y trazo libre, cada una
  con invertir, opacidad y suavizado. Siguen a la superficie cuando se mueven sus
  esquinas.
- **Capas:** renombrar, ocultar, bloquear, duplicar, eliminar (con confirmación),
  cambiar el orden, opacidad y 8 modos de mezcla (Normal, Add, Screen, Multiply,
  Overlay, Difference, Lighten, Darken).
- **Color por capa (GPU):** brillo, contraste, saturación, tono y negativo.
- **Reproducción simultánea:** un video por superficie. Play, Pausa y Stop globales,
  reinicio sincronizado, línea de tiempo, bucle, velocidad, volumen y silencio.
- **Pantalla externa** detectada automáticamente, con salida limpia (sin interfaz) por
  `Presentation`. Destinos: externa, interna (para Chromecast o duplicación) o ambas.
- **INICIAR / DETENER PROYECCIÓN:** mantiene la pantalla encendida y se reanuda sola si
  se reconecta el cable.
- **Cuadrícula de calibración:** cuadrícula, puntos, cruces, damero y colores de
  referencia. Se puede ajustar el número de divisiones, el grosor, el color y la
  opacidad, y siempre muestra marco, cruz central y círculo de aspecto.
- **Resolución de salida** independiente de la interfaz (720p, 1080p, 1440p, 4K, XGA,
  WXGA o nativa), con 30 o 60 fps y escalado ajustar/estirar.
- **Proyectos `.mapping`:** guardar, guardar como y abrir. Autoguardado continuo con
  restauración al abrir la app. **Buscar archivos perdidos**, uno a uno o en una
  carpeta.
- **Deshacer / rehacer** cualquier edición.
- **Exportar el fotograma actual** a PNG a la resolución de salida.
- **Gestos:** un dedo mueve; dos dedos escalan y rotan; arrastrar una esquina cambia la
  perspectiva; un toque selecciona; el doble toque alterna entre superficies
  superpuestas; mantener pulsado abre el menú contextual.
- **Teclado Bluetooth/USB:** `Espacio` reproduce/pausa · flechas empujan 1 px
  (`Mayús` = 10 px) · `Tab` cambia de esquina · `RePág`/`AvPág` cambian de capa ·
  `Supr` elimina · `Ctrl+Z` deshace · `Ctrl+Y` / `Ctrl+Mayús+Z` rehace · `Ctrl+S`
  guarda · `Ctrl+D` duplica · `G` cuadrícula · `P` proyección · `Esc` deselecciona.
- **Diagnóstico de compatibilidad:** GPU, tamaño máximo de textura, pantallas externas y
  sus modos, decodificadores por hardware y número aproximado de videos simultáneos.

## Compilar

Requisitos: **Android Studio** (Ladybug o posterior) o el SDK de Android con
**platform 35**, **JDK 17**.

```bash
git clone https://github.com/cristhianlujan45-blip/Video-Mapping-.git
cd Video-Mapping-
# Android Studio crea local.properties solo; desde la terminal:
echo "sdk.dir=$HOME/Android/Sdk" > local.properties

./gradlew :core:test :app:testDebugUnitTest   # tests
./gradlew :app:assembleDebug                  # APK de depuración
```

El APK queda en `app/build/outputs/apk/debug/app-debug.apk`.

**Sin instalar nada:** cada push ejecuta el workflow *Android build* de GitHub Actions,
que corre los tests y publica el APK como artefacto (`lujan-mapping-debug-apk`) en la
pestaña **Actions** del repositorio.

### APK de release firmado

1. Crea una clave (una sola vez):
   `keytool -genkey -v -keystore lujan.jks -keyalg RSA -keysize 2048 -validity 10000 -alias lujan`
2. Crea `keystore.properties` en la raíz (está en `.gitignore`):
   ```
   storeFile=lujan.jks
   storePassword=…
   keyAlias=lujan
   keyPassword=…
   ```
3. Ejecuta `./gradlew :app:assembleRelease`. El resultado es
   `app/build/outputs/apk/release/app-release.apk` (minificado con R8).

Sin `keystore.properties`, el release se firma con la clave de depuración: sirve para
probar, no para publicar.

## Probar en un Android real

1. Activa **Opciones de desarrollador → Depuración USB** e instala con
   `adb install -r app/build/outputs/apk/debug/app-debug.apk`, o pulsa *Run* en Android
   Studio.
2. En **Información (ⓘ)**, comprueba que el teléfono detecta la pantalla externa y
   cuántos decodificadores tiene.
3. Prueba básica de mapping:
   1. Pulsa **Añadir → Superficie de calibración** y arrastra las 4 esquinas. El patrón
      se deforma en perspectiva y las esquinas de color (rojo, verde, azul, amarillo)
      indican la orientación.
   2. Pulsa **Añadir → Video / imagen** y elige un MP4. Se reproduce en bucle dentro de
      su superficie.
   3. En **Máscaras**, añade un polígono y arrastra los puntos amarillos.
   4. Pulsa **Deshacer** varias veces y comprueba que todo vuelve atrás.
4. Con proyector o monitor:
   1. Conecta el adaptador **USB-C → HDMI**. El icono de salida se pone cian.
   2. Pulsa **INICIAR PROYECCIÓN**. El proyector muestra solo el contenido y el teléfono
      sigue editando en tiempo real.
   3. Activa la **cuadrícula** para alinear el proyector y ajusta las esquinas mirando
      la pared.
   4. Desconecta y reconecta el cable: la salida vuelve sola.
5. **Chromecast:** inicia la duplicación de pantalla desde Android, elige el destino
   **Pantalla interna** e inicia la proyección. Un toque muestra los controles.
6. **Persistencia:** guarda el proyecto, cierra la app y ábrela de nuevo; se restaura el
   autoguardado. Luego mueve un video de carpeta, abre el `.mapping` y usa **Buscar
   archivos perdidos**.

### Cómo se verificó esta versión

Este entorno de desarrollo no tenía acceso al SDK de Android, así que:

- El módulo `core` (homografía, undo/redo, formato, operaciones) se compiló y sus 18
  tests pasan.
- El código Android que solo usa el SDK (render, EGL, pantallas, medios, repositorio) se
  compiló contra el `android.jar` real de la API 35.
- La interfaz Compose se compiló contra Compose Multiplatform (la misma API), con stubs
  solo para las piezas exclusivas de Android (actividad, ExoPlayer).
- Los 10 shaders se compilaron en un compilador GLSL ES real (WebGL/ANGLE). Una prueba
  de render con un trapecio deformado confirmó que cada esquina del patrón cae
  exactamente en su posición.

- GitHub Actions compila el proyecto completo con el SDK real (AGP, Compose, Media3),
  pasa todos los tests y genera el APK de depuración (`lujan-mapping-debug-apk`).

**Falta probarlo en un dispositivo real:** reproducción de video, salida HDMI y gestos.
Es el siguiente paso (ver más abajo).

## Hoja de ruta (fase 2 y siguientes)

Cuando el MVP esté validado en el dispositivo, se añadirán por orden de estabilidad:

1. Malla de deformación (warp) N×M además de las 4 esquinas, y lupa de precisión.
2. Efectos por capa: blur, glitch, RGB split, aberración cromática, ruido/grano,
   pixelado, caleidoscopio, espejo, ondas, ripple.
3. Generador procedural: ondas, partículas, túneles, ruido, patrones, todo con
   parámetros en vivo.
4. GIF y WebP animados, SVG y secuencias de imágenes.
5. Audio reactivo (micrófono o archivo; audio interno en Android 10+ cuando la app de
   origen lo permita): bajos, medios, agudos, volumen y BPM aplicados a los
   parámetros.
6. Modo cámara (CameraX) con la malla superpuesta para calibrar, captura de fotos desde
   la app y, solo como opción, ARCore en dispositivos compatibles.
7. Exportar la composición a video (MediaCodec con entrada desde Surface).
8. Paquete de proyecto con los medios incluidos (`.mappingz`).

## Cambiar el nombre de la app

En `gradle.properties`:

```properties
lujan.appName=LUJAN MAPPING
lujan.applicationId=com.lujan.mapping
```

La interfaz lee el nombre de `@string/app_name`, que se genera a partir de ese valor.
