// web/js/ai/knowledge.js
// Base de conocimiento ligera del asistente: qué hace cada herramienta de
// LumaMap y cómo se usa. Se busca por palabras (sin servidor ni base de datos)
// y solo se envían al modelo los 2-3 artículos que vienen al caso, nunca el
// código de la app.

export const ARTICLES = [
  { id: "primer-mapping", title: "Primer mapping (paso a paso)", tab: "add", lesson: 1,
    keys: "empezar primer mapping superficie pared crear proyectar inicio",
    text: "1) Añadir → elige una forma (rectángulo, círculo…) o una plantilla. 2) Arrastra sus 4 esquinas hasta que coincidan con el objeto real (mira la pared con el proyector encendido). 3) Animaciones o Contenido → elige qué se ve dentro (animación, video, imagen, cámara, texto). 4) Proyectar: abre la salida en el proyector a pantalla completa." },
  { id: "esquinas", title: "Calibrar las esquinas (corner pin)", tab: "shape", lesson: 1,
    keys: "esquinas calibrar corner pin perspectiva ajustar puntos keystone deformar",
    text: "Cada superficie tiene 4 esquinas: arrástralas sobre la imagen proyectada hasta que cuadren con el objeto. La perspectiva se corrige sola (homografía en la GPU). Flechas = mover 1 px, Mayús+flechas = 10 px, Tab = siguiente punto. Con la salida abierta ves el cambio al instante en el proyector." },
  { id: "malla", title: "Malla de deformación (warp)", tab: "shape", lesson: 3,
    keys: "malla warp deformar curva columna irregular bezier mesh",
    text: "Forma → Malla: hasta 10×10 puntos con curvas suaves para columnas, esquinas redondeadas o superficies irregulares. Mueve cualquier punto interior para curvar la imagen." },
  { id: "mascaras", title: "Máscaras", tab: "shape", lesson: 2,
    keys: "mascara mascaras recortar ocultar puerta ventana mueble tapar borde suave",
    text: "Forma → Máscara: dibuja un polígono para esconder partes (puertas, ventanas, muebles). Tiene borde suave e inversión. Haz las máscaras antes de poner contenido definitivo." },
  { id: "bordes", title: "Bordes suaves y varios proyectores (edge blending)", tab: "output", lesson: 5,
    keys: "edge blending bordes suaves solape varios proyectores unir blend",
    text: "Salida → Bordes suaves: oscurece el solape entre dos proyectores para que la unión no se note (izquierda, derecha, arriba, abajo y curva). Usa la resolución suma de ambos (por ejemplo 3840×1080 para dos Full HD)." },
  { id: "salidas", title: "Salidas, pantallas y proyectores", tab: "output", lesson: 5,
    keys: "salida proyector pantalla p1 p2 output monitor proyectar segunda pantalla ventana fullscreen",
    text: "Proyectar abre la salida. En Windows cada pantalla de salida (P1-P4) puede ir a un proyector distinto; cada superficie elige por qué pantalla sale (En vivo). Todas comparten el mismo video decodificado y el mismo reloj." },
  { id: "resolucion", title: "Resolución de la composición", tab: "output",
    keys: "resolucion 1080p 4k nitidez pixeles tamaño lienzo",
    text: "Usa la resolución nativa del proyector (o la suma de varios). Cambiarla reescala las superficies. Videos mucho más grandes que la salida gastan GPU sin ganar nitidez: optimízalos." },
  { id: "contenido", title: "Contenido: videos, imágenes, animaciones, cámara, texto", tab: "content",
    keys: "video imagen contenido animacion cargar importar texto camara foto media",
    text: "Contenido → elige la fuente de cada superficie. Animaciones tiene 184 animaciones en GPU. Los videos se importan desde Añadir o Contenido; en Windows se optimizan solos si hace falta (códec y tamaño)." },
  { id: "optimizar", title: "Optimizar videos y rendimiento", tab: "perf",
    keys: "lento lag fps rendimiento optimizar fluido tirones baja velocidad cpu gpu memoria",
    text: "Si va lento: 1) usa videos del tamaño de la salida (no 4K para 1080p); 2) Rendimiento → baja solo la vista previa del editor (75 % o 50 %, la salida no cambia); 3) menos efectos pesados (desenfoque, partículas); 4) cierra salidas que no uses. El panel Rendimiento muestra FPS, fotogramas perdidos, CPU, GPU y VRAM." },
  { id: "efectos", title: "Efectos de video", tab: "fx",
    keys: "efecto efectos brillo glow rgb glitch kaleidoscopio espejo blur color neon",
    text: "Efectos: biblioteca con categorías (brillo, color, glitch, espejo, neón, bordes…) en la GPU sobre cualquier contenido. Se combinan; clic derecho en un control → Aprender para moverlo con MIDI." },
  { id: "vj", title: "En vivo (VJ): A/B, fader, GO", tab: "live", lesson: 6,
    keys: "vj en vivo directo crossfader fader ab go mezcla cambiar transicion",
    text: "En vivo: cada superficie tiene AHORA y SIGUIENTE. Prepara lo siguiente, mézclalo con el fader A⟷B o pulsa GO para fundir. Enter = GO todas. Mezcla automática al ritmo cada 4/8/16 golpes." },
  { id: "escenas", title: "Escenas, cues y transiciones", tab: "scenes", lesson: 10,
    keys: "escena escenas cue cues transicion fundido corte siguiente show orden",
    text: "Escenas: cada escena guarda qué muestra cada superficie. Transiciones: corte, fundido, disolver, cortinillas, iris, destello, glitch. Pueden avanzar solas por tiempo. Cada escena puede llevar un efecto de luces." },
  { id: "show", title: "Show control: timecode, automatización, modo actuación", tab: "show", lesson: 10,
    keys: "show timecode ltc mtc midi clock automatizacion actuacion emergencia cue lista",
    text: "Show: GO/BACK, timecode (interno, MTC, LTC, OSC) que dispara las cues, grabación de automatizaciones y modo actuación (sin paneles, sin cambios accidentales). EMERGENCIA pone una salida segura al instante." },
  { id: "audio", title: "Audio reactivo", tab: "audio", lesson: 7,
    keys: "audio musica ritmo beat bpm microfono reaccionar graves bass reactivo sonido",
    text: "Audio: activa el micrófono (o la entrada de audio). Graves, medios, agudos, golpe y BPM mueven el brillo, la escala, el color o las luces. Cada superficie tiene «Reaccionar al audio»; también TAP para el tempo." },
  { id: "midi", title: "MIDI: controladores y MIDI LEARN", tab: "control", lesson: 6,
    keys: "midi controlador knob fader pad learn aprender apc launchpad controladora",
    text: "Control: conecta el controlador (se detecta solo). Clic derecho en cualquier control → Aprender → mueve el knob. Soporta 14 bits, encoders, soft takeover, feedback de LED, bancos y modificadores." },
  { id: "osc", title: "OSC y mando remoto", tab: "control",
    keys: "osc touchosc remoto movil tablet mando red pin",
    text: "El mando remoto se abre en el móvil con la dirección y el PIN de Control. OSC por UDP (puerto 9129): /lumamap/param/<id> mueve cualquier parámetro; OSC LEARN asigna direcciones." },
  { id: "dmx-conectar", title: "Luces: conectar Art-Net / sACN", tab: "lights", lesson: 8,
    keys: "dmx artnet art-net sacn luces nodo conectar red ip universo iluminacion",
    text: "Luces → 1 · Conectar: conecta el nodo Art-Net por cable de red y pulsa «Buscar mis luces» → Conectar. Si no aparece, «Enviar a toda la red». Sin equipo, todo se prepara en modo práctica (se ve en el escenario)." },
  { id: "pixelmap", title: "Luces: tiras, matrices, focos (pixel map)", tab: "lights", lesson: 8,
    keys: "pixel map tira led matriz foco par cabeza movil fixture canales",
    text: "Luces → 2 · Mis luces: añade tira LED, matriz, aro, barra, foco PAR o cabeza móvil. Los canales DMX se asignan solos (AUTO SPAN, sin partir píxeles). Arrástralas en el escenario: con «Video de la proyección» toman el color de esa zona." },
  { id: "efectos-luces", title: "Efectos de luces", tab: "lights", lesson: 8,
    keys: "efectos luces persecucion arcoiris estrobo fuego disco chase rainbow strobe luz",
    text: "Luces → 3 · Efectos: 75 efectos (persecuciones, arcoíris, estrobo, fiesta, naturaleza, matriz, música). Colores, velocidad, tamaño y «al ritmo de la música». Las cabezas móviles tienen movimientos (círculo, ocho, barrido…)." },
  { id: "interactivo", title: "Proyección interactiva con cámara", tab: "interactive", lesson: 9,
    keys: "interactivo interactiva camara sensor persona cuerpo silueta tocar pared suelo calibrar alinear",
    text: "Interactivo: 1) elige la cámara (cualquiera) apuntando a la zona proyectada; 2) Alinear automáticamente (el proyector muestra negro y blanco y la cámara encuentra la proyección) o ajusta las 4 esquinas a mano; 3) elige el efecto (silueta, ondas, burbujas, partículas…); 4) reacciones: al entrar alguien, cambiar escena o luces." },
  { id: "tracking", title: "Tracking: zonas y reglas", tab: "tracking", lesson: 9,
    keys: "tracking zona zonas regla reglas mano levantada personas distancia velocidad gesto",
    text: "Tracking (modo profesional): cuerpo y manos de hasta 4 personas con IA en la GPU. Señales (mano levantada, cercanía, velocidad…) mueven parámetros; zonas dibujadas sobre la cámara; reglas «cuando … entonces …»." },
  { id: "3d", title: "Mapping 3D y proyectores virtuales", tab: "3d",
    keys: "3d cubo objeto modelo obj fbx gltf proyector virtual frustum blender vista",
    text: "3D (modo profesional): objetos (cubo, esfera, cilindro…) o modelos importados; cada cara con su contenido. Proyectores virtuales con FOV y resolución; «ver desde el proyector» y su salida a P1-P4. Teclado numérico como Blender." },
  { id: "guardar", title: "Guardar, copias y recuperación", tab: "menu",
    keys: "guardar proyecto copia backup recuperar autosave abrir exportar perder",
    text: "Se guarda solo (autoguardado) y hay copias de seguridad. Menú → Guardar / Abrir / Exportar. Si la app se cierra de golpe, al abrirla recupera el último estado." },
  { id: "ia-local", title: "IA local gratis (Ollama)", tab: "assistant",
    keys: "ia local ollama qwen modelo gratis offline instalar inteligencia artificial",
    text: "La IA es opcional. Para IA local gratis y sin internet: instala Ollama (ollama.com). LumaMap lo detecta y en Windows lo abre solo; después, en el Asistente, pulsa «Descargar la IA» (una sola vez, elige el modelo según tu equipo). Sin terminal. Sin IA, el asistente sigue funcionando con reglas y esta guía." },
];

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ñ\s-]/g, " ");
const STOP = new Set("el la los las un una de del y o a en con por para que como mi tu se es mas muy esto este esta al lo le me quiero hacer puedo".split(" "));
const tokens = (s) => norm(s).split(/\s+/).filter(w => w.length > 2 && !STOP.has(w));

/** Los artículos que mejor responden a la consulta (búsqueda por palabras, con raíces simples). */
export function searchKnowledge(query, k = 3) {
  const q = tokens(query);
  if (!q.length) return [];
  const scored = ARTICLES.map(a => {
    const keys = tokens(a.keys + " " + a.title), body = tokens(a.text);
    let s = 0;
    for (const w of q) {
      const stem = w.slice(0, Math.max(4, w.length - 2));
      if (keys.some(x => x === w)) s += 3; else if (keys.some(x => x.startsWith(stem))) s += 2;
      if (body.some(x => x.startsWith(stem))) s += 0.5;
    }
    return { a, s };
  }).filter(x => x.s >= 2).sort((x, y) => y.s - x.s);
  return scored.slice(0, k).map(x => x.a);
}
export const articleById = (id) => ARTICLES.find(a => a.id === id) || null;
