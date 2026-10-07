# ◩ LumaMap — Plataforma profesional de Video Mapping

Editor + media server + control remoto de projection mapping, inspirado
funcionalmente en Resolume Arena, MadMapper, HeavyM y Millumin, con código y
diseño propios. **100 % offline**: el funcionamiento básico no requiere internet.

---

## 1. Instalación y ejecución

Requisito único: **Node.js ≥ 18** (sin `npm install`, el backend es cero-dependencias).

```bash
npm start          # backend + estáticos en el puerto 8080
npm test           # suite de pruebas (19 pruebas)
```

Al arrancar, el backend imprime las IPs locales, p. ej.:

```
[LumaMap] backend en http://0.0.0.0:8080
[LumaMap] red local -> http://192.168.1.50:8080  (wlan0)
```

### URLs
| URL | Función |
|---|---|
| `http://IP:8080/` | Editor principal |
| `http://IP:8080/output.html` | **Modo presentación** (arrastra al proyector, pulsa F) |
| `http://IP:8080/controller.html` | Mando remoto (teléfono/tablet) |

---

## 2. Guía rápida de uso

### Crear un mapping (5 pasos)
1. **Importar medios** → botón *Importar medios* (PNG, JPG, WEBP, SVG, GIF, MP4, WebM).
2. Arrastra un medio de la biblioteca **sobre una superficie** del canvas
   (o selecciónalo en Propiedades → Medio).
3. **Ajusta las esquinas**: arrastra los vértices (corner pin / perspective warp
   real, por homografía, en GPU).
4. Pulsa **▶** y abre **⧉ OUTPUT**: la ventana de salida muestra solo la
   composición, nunca la interfaz del editor.
5. Arrastra la ventana OUTPUT al monitor/proyector y pulsa **F**.

### Escenas y transiciones
- Panel **Escenas**: crear, duplicar, renombrar (doble clic), reordenar
  (arrastrar), eliminar, autoplay (⏭ avanza al terminar los videos).
- Transporte: corte o fade configurable.

### Efectos (GPU, tiempo real)
Brillo, contraste, saturación, hue, RGB shift, ruido, pixelate, blur, threshold,
colorize, invertir + presets: Glitch, VHS, Neon, Cyberpunk, B&W, Negative,
RGB Split, Posterize, Pixelado, Glow suave.

### Máscaras
Propiedades → Máscara → *Dibujar máscara*: clics en el canvas definen el
polígono; invertir y feather ajustables.

### Modo Simple / Pro
Botón **Modo** en la barra superior. Simple oculta capas, escenas, timeline y
propiedades avanzadas: importar → ajustar esquinas → reproducir → proyectar.

---

## 3. Proyectores y pantallas externas (web)

Los navegadores **no permiten elegir pantalla programáticamente** (limitación de
seguridad real, no de LumaMap). La solución implementada:

1. `output.html` se abre como ventana independiente (EDITOR → OUTPUT).
2. Arrastra esa ventana al monitor/proyector (Windows/Linux/macOS la muestran
   como ventana normal en cualquier pantalla detectada por el SO).
3. Pulsa **F** → pantalla completa en ese monitor.

Esto funciona con HDMI, DisplayPort, USB-C con alt-mode, etc. — cualquier
pantalla que el sistema operativo vea. Detección automática de pantallas:
Window Management API (Chrome/Edge), pendiente (ver ROADMAP).

### Patrones de calibración
Barra de transporte: cuadrícula, blanco, rojo, verde, azul, B/N. Se muestran
**solo en la salida** (output.html), nunca en el editor.

---

## 4. Control remoto (teléfono → PC → proyector)

Cadena real por WebSocket en WiFi local:

```
TELÉFONO (controller.html) → WiFi → backend LumaMap (:8080) → ventana OUTPUT → PROYECTOR
```

1. PC y teléfono en la **misma red WiFi**.
2. En el teléfono abre `http://IP-DEL-PC:8080/controller.html`.
3. El mando muestra: proyecto, escena actual (nº/nombre), estado (play/pause),
   FPS reales, resolución. Botones: play, pause, stop, next, prev, brillo master.
4. El backend hace de relé con reconexión automática; si el teléfono pierde
   cobertura, se reconecta solo (retroceso exponencial, máx. 15 s).

---

## 5. Proyectos: guardar, cargar, exportar

- **Guardar** → IndexedDB (autosave cada 10 s + recuperación al reabrir la app).
- **Guardar y sincronizar** → además POST al backend (`data/*.json`).
  Sincronización opcional: si el backend no responde, queda el guardado local.
- **Exportar** → `.lumap.json` autocontenido (medios incrustados en base64).
- **Importar** → reconstruye superficies, escenas, máscaras, efectos y medios.
- **Abrir** → lista proyectos guardados localmente.

Formato conceptual (en un único JSON autocontenido):

```
project.lumap.json
├── version, name, width, height, fps
├── surfaces[]      (puntos, media, opacidad, blend, máscara, fx)
├── scenes[]        (layers[], autoplayNext)
├── settings        (modo, transición)
└── media[]         (metadatos + dataUrl)
```

---

## 6. Arquitectura (resumen)

- **Frontend**: ES modules nativos, sin build step. Editor (`index.html` +
  `js/app.js` + `js/ui.js`), output (`output.html` + `js/output.js`), mando
  (`controller.html`).
- **Motor de render**: WebGL2 (`js/renderer.js`). Corner pin y perspective
  warp por **homografía 3×3** (`shared/homography.js`): el shader interpola
  UVs homogéneos (`uvh`) y divide por `w` en el fragment shader → warp
  proyectivo correcto en GPU, sin pasadas extra. Polígonos libres por
  triangulación ear-clipping (CPU, solo al editar).
- **Máscaras**: polígono de hasta 32 puntos evaluado por ray-casting en el
  fragment shader; feather por distancia a aristas; invertible.
- **Efectos**: un único fragment shader con uniforms (cero render targets →
  máximo rendimiento). Añadir un efecto = 1 uniform + 1 slider.
- **Backend** (`server/index.js`): Node cero-dependencias. HTTP estáticos +
  API `/api/projects` + WebSocket **RFC 6455 implementado a mano** (handshake
  SHA-1, frames con/sin máscara, ping/pong, close) con relé controller↔display.
- **Comunicación OUTPUT**: BroadcastChannel entre editor y ventana de salida
  (mismo navegador); WebSocket para control remoto entre dispositivos.
- **Persistencia**: IndexedDB con fallback a localStorage. 100 % offline.

Ver **ARCHITECTURE.md** para el detalle completo.

---

## 7. Android

Módulo `android/`: aplicación estándar que envuelve la app web (editor o mando)
en un WebView con hardware acelerado. Compilación de la APK con Android Studio:
`Build > Generate Signed APK`. Detalles y limitaciones en `android/README.md`.

**Limitación honesta**: este entorno no incluye Android SDK → la APK no pudo
compilarse aquí; el código es un proyecto Android estándar. Salida física
HDMI/DisplayPort y cámara de calibración requieren el motor nativo (ROADMAP
fase 10.2); en dispositivos con soporte, el WebView puede enviarse a la
pantalla externa mediante la función de pantalla duplicada del sistema.

---

## 8. Rendimiento y estabilidad

- FPS real medido por frame-time (barra de estado).
- Las texturas de video se suben a GPU solo cuando cambia el frame.
- `renderer.releaseMedia()` libera texturas al eliminar medios (sin memory leaks).
- Autosave + recuperación ante cierre inesperado.
- Validación de formatos al importar con mensajes claros (nada de cierres
  silenciosos: errores → alerta descriptiva).

---

## 9. Compatibilidad

| Plataforma | Estado |
|---|---|
| Chrome / Edge (desktop) | ✅ pleno |
| Firefox | ✅ (WebGL2) |
| Safari 16+ | ✅ (WebGL2; verificar autoplay de video con sonido) |
| Android (Chrome/WebView) | ✅ editor + mando |
| iOS Safari | mando ✅; editor limitado por gestión de archivos |
| Resoluciones | 1080p/2K/4K según GPU (el lienzo es configurable 320×240…7680×4320) |

---

## 10. Troubleshooting

| Síntoma | Solución |
|---|---|
| "WebGL2 no disponible" | Activa aceleración de hardware en el navegador |
| Video no importa | Códec no soportado por el navegador → convierte a MP4 (H.264) o WebM (VP9) |
| El mando no conecta | Mismo WiFi, firewall del puerto 8080, usa la IP local que imprime `npm start` |
| OUTPUT no muestra nada | Pulsa ⧉ OUTPUT de nuevo; la sincronización tarda ~1-2 s en la primera carga |
| Pantalla completa no funciona | El navegador exige un gesto del usuario: pulsa F dentro de la ventana OUTPUT |
| Pérdida de rendimiento | Reduce resolución del lienzo (Archivo → Resolución) y número de superficies con video 4K |

---

## 11. Licencia

MIT. Código y diseño propios. Las referencias funcionales (Resolume, MadMapper,
HeavyM…) son solo inspiración conceptual: no se ha copiado código ni interfaz
propietarios.
