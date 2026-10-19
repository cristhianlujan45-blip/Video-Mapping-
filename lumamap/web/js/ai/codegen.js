// web/js/ai/codegen.js
// La IA que escribe código para LumaMap (Python de los nodos de script y GLSL de los shaders):
//   · codePrompt(): lo que se le explica al modelo para cada tipo de nodo (qué hay, qué devolver);
//   · cleanCode(): quita lo que sobra de la respuesta (``` , explicaciones pegadas…);
//   · templateFor(): sin IA, la plantilla más parecida a lo que pides (honesto: no inventa).
// La prueba y la reparación (aplicar, mirar el error, pedir que lo arregle) las hace el editor.

const PY_COMMON = `Es el «Python de LumaMap»: Python 3 sin clases propias, sin import de otras librerías (solo math, random, time, colorsys), sin archivos ni red.
Variables globales que existen: op('nombre') (un nodo de la red: op('x').par.parametro = valor para cambiarlo; op('lfo1')['chan1'] es un canal y se usa como número; op('tabla1')[fila, col]), ops('patron*'), me (este nodo), absTime.seconds (tiempo en segundos), absTime.frame, print(...) (a la consola).
Módulo lumamap (ya importado): lumamap.next_scene(), lumamap.prev_scene(), lumamap.scene('NOMBRE' o número), lumamap.blackout(True/False), lumamap.set_bpm(n), lumamap.bpm(), lumamap.level('bass'|'mid'|'high'|'level') (audio de 0 a 1), lumamap.set_param('global/master', 0..1), lumamap.toast('texto').`;

const KINDS = {
  "py:chop": `${PY_COMMON}
Es un Script CHOP: define def onCook(scriptOp): que crea los canales que salen del nodo.
scriptOp.clear() borra los canales; c = scriptOp.appendChan('nombre') crea uno; c[0] = valor pone la primera muestra; scriptOp.numSamples = N para tener N muestras (c[i] = …); scriptOp.inputs[0]['canal'] lee un CHOP conectado.
Ejemplo:
import math
def onCook(scriptOp):
    scriptOp.clear()
    c = scriptOp.appendChan('onda')
    c[0] = 0.5 + 0.5 * math.sin(absTime.seconds)`,
  "py:execute": `${PY_COMMON}
Es un «Ejecutar» DAT (como el Execute DAT de TouchDesigner): define las funciones que LumaMap llama solo:
def onStart(): al empezar · def onFrameStart(frame): en cada fotograma · def onValueChange(channel, val, prev): cuando cambia un canal del CHOP vigilado · def onOffToOn(channel): cuando un canal pasa de 0 a 1 (el golpe, un botón) · def onOnToOff(channel).
Para guardar algo entre fotogramas usa variables globales con «global».`,
  "py:top": `${PY_COMMON}
Es un «Dibujo con Python» (Script TOP): define def onCook(scriptOp): y dibuja en c = scriptOp.canvas, con coordenadas de 0 a 1 ((0,0) abajo a la izquierda, (1,1) arriba a la derecha) y tamaños relativos al alto:
c.clear('#000000') · c.circle(x, y, radio, color, fill=True) · c.rect(x, y, ancho, alto, color) · c.line(x1, y1, x2, y2, color, grosor) · c.poly([(x, y), …], color) · c.text('hola', x, y, tamaño, color) · c.glow(cantidad, color) · c.blend('add'|'normal') · c.alpha(0..1).
Los colores son '#rrggbb' o (r, g, b) de 0 a 1.`,
  "glsl:top": `Es un GLSL TOP de LumaMap (GLSL ES 3.0). Escribe SOLO el cuerpo de la función vec4 cook() (sin «vec4 cook() {» ni main), que devuelve el color del píxel con return vec4(...).
Tienes: vec2 uv (0..1), vec2 res (resolución en píxeles), float time (segundos), vec4 tex0(uv) y tex1(uv) (imágenes conectadas), float has0/has1 (1 si hay imagen), float u1, u2, u3, u4 (deslizadores 0..1), y las funciones luma(vec3), rot2(angulo) (mat2), hsv2rgb(vec3), rgb2hsv(vec3), snoise(vec3) (ruido -1..1), fbm(vec3, int octavas).
Usa números con punto (1.0, no 1).`,
  "glsl:mat": `Es el color de un GLSL MAT de LumaMap (material 3D, GLSL ES 3.0). Escribe SOLO el cuerpo de una función que devuelve vec4 con return.
Tienes: vec2 vUv, vec3 vNormal, vec3 vPos (posición en el mundo), float time, float u1..u4, vec4 tex(vUv) (la textura elegida), float light() (luz difusa 0..1), snoise(vec3), hsv2rgb(vec3). Usa números con punto (1.0).`,
  "glsl:vert": `Es la deformación de vértices de un GLSL MAT de LumaMap (GLSL ES 3.0). Escribe SOLO el cuerpo de una función que devuelve la posición nueva como vec3 con return.
Tienes: vec3 position, vec3 normal, vec2 uv, float time, float u1..u4, snoise(vec3). Usa números con punto (1.0).`,
};
/** Qué tipo de código es un parámetro de un nodo («py:chop», «glsl:top»…). */
export function codeKind(node, paramKey) {
  if (node.fam === "CHOP" && node.type === "script") return "py:chop";
  if (node.fam === "DAT" && node.type === "execute") return "py:execute";
  if (node.fam === "TOP" && node.type === "script") return "py:top";
  if (node.fam === "MAT") return paramKey === "vcode" ? "glsl:vert" : "glsl:mat";
  return "glsl:top";
}
export function codeSystem(kind) {
  return `Eres el asistente de programación de LumaMap (programa de video mapping parecido a TouchDesigner). Respondes en español.
${KINDS[kind] || KINDS["glsl:top"]}
Responde SOLO con JSON: {"code": "el código completo", "explanation": "una o dos frases de qué hace y qué controles puedes tocar"}.`;
}
/** El mensaje para el modelo: escribir de cero, cambiar el código de ahora o arreglar un error. */
export function codeUser({ request = "", code = "", error = "", context = "" }) {
  if (error) return `Este código da un error. Arréglalo sin cambiar lo que hace.\nError:\n${error}\nCódigo:\n${code}${request ? `\nLo que se quería: ${request}` : ""}`;
  return `${request}${code && code.trim() ? `\nEl código que hay ahora (cámbialo o rehazlo si hace falta):\n${code}` : ""}${context ? `\nLa red tiene estos nodos: ${context}` : ""}`;
}
/** Quita lo que sobra de la respuesta del modelo. */
export function cleanCode(text, kind) {
  let c = String(text || "").replace(/\r\n?/g, "\n");
  const fence = /```[a-zA-Z0-9]*\n([\s\S]*?)```/.exec(c);
  if (fence) c = fence[1];
  c = c.replace(/^\s*```[a-zA-Z0-9]*\s*$/gm, "").replace(/\t/g, "    ");
  if (kind?.startsWith("glsl")) {
    // Si escribió la función entera, quedarse con el cuerpo.
    const m = /(?:vec4|vec3)\s+(?:cook|main|color|deform|mainImage)\s*\([^)]*\)\s*\{([\s\S]*)\}\s*$/.exec(c.trim());
    if (m && !/void\s+main/.test(c)) c = m[1];
    c = c.replace(/^\s*#version.*$/gm, "").replace(/^\s*precision .*;$/gm, "");
  }
  return c.replace(/^\n+|\s+$/g, "") + "\n";
}

/* ---------------- Sin IA: plantillas ---------------- */
const T = (keys, label, code) => ({ keys, label, code });
const TEMPLATES = {
  "py:top": [
    T("reloj hora tiempo segundero", "Reloj", `import math

def onCook(scriptOp):
    c = scriptOp.canvas
    c.clear('#05060a')
    s = absTime.seconds
    for i in range(60):
        a = math.tau * i / 60
        r1 = 0.42 if i % 5 else 0.38
        c.line(0.5 + r1 * 0.5625 * math.sin(a), 0.5 + r1 * math.cos(a), 0.5 + 0.45 * 0.5625 * math.sin(a), 0.5 + 0.45 * math.cos(a), '#ffffff', 0.004)
    a = math.tau * (s % 60) / 60
    c.line(0.5, 0.5, 0.5 + 0.4 * 0.5625 * math.sin(a), 0.5 + 0.4 * math.cos(a), '#ff2d55', 0.008)
`),
    T("estrellas cielo espacio puntos", "Estrellas", `import math, random

random.seed(3)
estrellas = [(random.random(), random.random(), random.random()) for _ in range(250)]

def onCook(scriptOp):
    c = scriptOp.canvas
    c.clear('#000008')
    c.blend('add')
    for x, y, z in estrellas:
        brillo = 0.5 + 0.5 * math.sin(absTime.seconds * (1 + z * 3) + z * 50)
        c.circle(x, y, 0.002 + z * 0.004, (brillo, brillo, 1.0))
`),
    T("barras audio musica sonido ecualizador", "Barras del sonido", `import math

def onCook(scriptOp):
    c = scriptOp.canvas
    c.clear('#020308')
    bandas = [lumamap.level('bass'), lumamap.level('mid'), lumamap.level('high')]
    for i in range(24):
        v = bandas[i * 3 // 24] * (0.6 + 0.4 * math.sin(absTime.seconds * 3 + i))
        c.rect(0.05 + i * 0.0375, 0.1, 0.03, 0.05 + v * 0.8, (i / 24, 0.4, 1.0 - i / 24))
`),
    T("texto letras palabra titulo", "Texto que late", `import math

def onCook(scriptOp):
    c = scriptOp.canvas
    c.clear('#000000')
    c.glow(0.03, '#00e5ff')
    t = 0.12 + 0.02 * math.sin(absTime.seconds * 4)
    c.text('LUMAMAP', 0.5, 0.5, t, '#ffffff')
`),
    T("circulos circulo ondas anillos", "Círculos que giran", `import math

def onCook(scriptOp):
    c = scriptOp.canvas
    c.clear('#05060a')
    for i in range(12):
        a = absTime.seconds + i * math.tau / 12
        c.circle(0.5 + 0.3 * 0.5625 * math.cos(a), 0.5 + 0.3 * math.sin(a), 0.03, '#00e5ff')
`),
  ],
  "py:chop": [
    T("azar aleatorio random", "Azar suave", `import random

valor = 0.5

def onCook(scriptOp):
    global valor
    valor += (random.random() - valor) * 0.05
    scriptOp.clear()
    c = scriptOp.appendChan('azar')
    c[0] = valor
`),
    T("rampa diente sierra", "Rampa", `def onCook(scriptOp):
    scriptOp.clear()
    c = scriptOp.appendChan('rampa')
    c[0] = absTime.seconds % 2 / 2
`),
    T("muestras instancias lista posiciones", "100 posiciones en círculo", `import math

def onCook(scriptOp):
    scriptOp.clear()
    scriptOp.numSamples = 100
    tx = scriptOp.appendChan('tx')
    ty = scriptOp.appendChan('ty')
    for i in range(100):
        a = math.tau * i / 100 + absTime.seconds * 0.3
        tx[i] = 2 * math.cos(a)
        ty[i] = 2 * math.sin(a)
`),
    T("onda seno lfo", "Onda", `import math

def onCook(scriptOp):
    scriptOp.clear()
    c = scriptOp.appendChan('onda')
    c[0] = 0.5 + 0.5 * math.sin(absTime.seconds * 2)
`),
  ],
  "py:execute": [
    T("escena golpe beat siguiente cambiar", "Siguiente escena en cada golpe", `golpes = 0

def onOffToOn(channel):
    # Elige en «CHOP que vigila» un Audio o Ritmo CHOP (canal beat) o un Botón.
    global golpes
    golpes += 1
    if golpes % 8 == 0:
        lumamap.next_scene()
`),
    T("parpadeo apagon blackout", "Parpadeo cada segundo", `def onFrameStart(frame):
    lumamap.blackout(int(absTime.seconds * 2) % 2 == 0)
`),
    T("brillo latido mover parametro", "Mover un parámetro", `import math

def onFrameStart(frame):
    # Cambia «level1» por el nombre de tu nodo.
    op('level1').par.brightness = 1 + 0.5 * math.sin(absTime.seconds * 2)
`),
  ],
  "glsl:top": [
    T("tunel tunnel", "Túnel", `vec2 p = (uv - 0.5) * vec2(res.x / res.y, 1.0);
float r = length(p), a = atan(p.y, p.x);
float v = sin(10.0 / max(r, 0.01) - time * 4.0) * 0.5 + 0.5;
vec3 col = hsv2rgb(vec3(fract(a / 6.2831 + time * 0.05), 0.8, v)) * smoothstep(0.0, 0.3, r);
return vec4(col, 1.0);`),
    T("caleidoscopio kaleido espejo", "Caleidoscopio", `vec2 p = (uv - 0.5) * vec2(res.x / res.y, 1.0);
float a = atan(p.y, p.x), r = length(p);
float seg = 6.2831 / 8.0;
a = abs(mod(a + time * 0.2, seg) - seg * 0.5);
vec2 q = vec2(cos(a), sin(a)) * r;
float v = fbm(vec3(q * 4.0, time * 0.3), 4);
return vec4(hsv2rgb(vec3(v + time * 0.05, 0.7, 0.6 + v * 0.4)), 1.0);`),
    T("ondas agua ripple", "Ondas", `vec2 p = (uv - 0.5) * vec2(res.x / res.y, 1.0);
float v = sin(length(p) * 40.0 - time * 5.0) * 0.5 + 0.5;
return vec4(mix(vec3(0.0, 0.1, 0.3), vec3(0.2, 0.9, 1.0), v), 1.0);`),
    T("ruido humo nubes niebla", "Humo", `float v = fbm(vec3(uv * 3.0, time * 0.15), 5) * 0.5 + 0.5;
return vec4(vec3(v) * vec3(0.9, 0.95, 1.0), 1.0);`),
    T("plasma colores psicodelico", "Plasma", `vec2 p = (uv - 0.5) * vec2(res.x / res.y, 1.0) * 4.0;
float v = sin(p.x * 3.0 + time) + sin(p.y * 4.0 - time * 1.3) + sin(length(p) * 5.0 - time * 2.0);
return vec4(0.5 + 0.5 * cos(v + vec3(0.0, 2.1, 4.2)), 1.0);`),
  ],
  "glsl:mat": [
    T("arcoiris colores", "Arcoíris por altura", `vec3 col = hsv2rgb(vec3(fract(vPos.y * 0.3 + time * 0.1), 0.8, 1.0));
return vec4(col * light(), 1.0);`),
    T("neon borde brillo fresnel", "Neón en los bordes", `float f = pow(1.0 - abs(vNormal.z), 2.0);
return vec4(vec3(0.0, 0.9, 1.0) * (0.2 + f * 2.0), 1.0);`),
  ],
  "glsl:vert": [
    T("ondas olas onda", "Olas", `return position + normal * sin(position.x * 4.0 + time * 2.0) * 0.1 * (0.5 + u1);`),
    T("ruido deformar respirar", "Ruido que respira", `return position + normal * snoise(position * 2.0 + time * 0.5) * 0.15 * (0.3 + u1);`),
  ],
};
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
/** La plantilla más parecida a lo pedido (o la primera de ese tipo). */
export function templateFor(kind, request) {
  const list = TEMPLATES[kind] || TEMPLATES["glsl:top"];
  const words = norm(request).split(/[^a-z0-9]+/).filter(w => w.length > 2);
  let best = list.at(-1), score = 0;
  for (const t of list) {
    const ks = t.keys.split(" ");
    const sc = words.filter(w => ks.some(k => k.startsWith(w.slice(0, 5)) || w.startsWith(k.slice(0, 5)))).length;
    if (sc > score) { score = sc; best = t; }
  }
  return { code: best.code.replace(/\s+$/, "") + "\n", explanation: `Sin IA: te pongo la plantilla «${best.label}»${score ? "" : " (no encontré una más parecida a lo que pides)"}. Para que la escriba a tu medida, activa la IA (Asistente → IA local con Ollama).`, template: best.label, matched: score > 0 };
}
export const TEMPLATE_KINDS = Object.keys(TEMPLATES);
export const templatesOf = (kind) => (TEMPLATES[kind] || []).map(t => t.label);
