# LumaMap Android

Este módulo es la aplicación Android v0.1: un contenedor `WebView` que carga la
aplicación web servida por el backend de LumaMap (modo editor o mando remoto).

## Compilar la APK
1. Instala Android Studio (SDK 34, Gradle 8+).
2. Abre esta carpeta `android/` como proyecto.
3. Sync Gradle (descargará AGP 8.5 + Kotlin 1.9.24).
4. Build > Generate Signed Bundle/APK > APK.
5. Instala en el dispositivo: `adb install app-release.apk`

## Uso
1. En el PC: `npm start` (anota la IP local, p. ej. 192.168.1.50).
2. En el teléfono abre LumaMap. Por defecto apunta a 10.0.2.2 (emulador).
   Para un dispositivo real: adb shell am start -n com.lumap.app/.MainActivity      --es server http://192.168.1.50:8080

## Limitación honesta (regla 26)
Este entorno de desarrollo no incluye Android SDK, por lo que la APK **no pudo
compilarse aquí**. El código es un proyecto Android estándar y verificado
sintácticamente; la compilación requiere Android Studio. El motor de mapping
nativo (OpenGL ES, corner pin en GPU, salida HDMI/DisplayPort por
`DisplayManager`, cámara para asistencia de calibración) está especificado en
ROADMAP.md FASE 10.2.
