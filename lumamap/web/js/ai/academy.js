// web/js/ai/academy.js
// ACADEMIA DE VIDEO MAPPING: 12 niveles, un paso cada vez («PASO 2/5»).
// Cada paso dice UNA cosa y espera a que el usuario la haga de verdad en la
// app (se comprueba el estado real del proyecto), luego pasa al siguiente.
// Funciona sin IA. El progreso se guarda en este equipo.
import { currentScene } from "../model.js";
import { getShader } from "../plugins.js";

const sel = (app) => app.S.project.surfaces.find(s => s.id === app.S.sel) || null;
const look = (app) => { const s = sel(app); return s ? currentScene(app.S.project).looks[s.id] : null; };
const sig = (s) => s ? JSON.stringify(s.points) : "";
const nodesOpen = () => typeof document !== "undefined" && !!document.querySelector(".nodes .nodenet");
// Efecto de cámara / filtro puesto: qué imagen le entra ("camera" o "media"), o "".
const camFx = (app) => { const src = look(app)?.source; if (src?.type !== "shader") return ""; const i = getShader(src.shaderId)?.isf.inputs.find(x => x.type === "image"); return i ? ((src.shaderParams || {})[i.name]?.kind === "media" ? "media" : "camera") : ""; };
// Botón de una pestaña en la barra de abajo (o «Más» si en el teléfono no cabe).
const dock = (id) => [`#dock [data-tab="${id}"]`, "#dock .more"];
// «Hazlo por mí» de «abre la pestaña…»: abrirla (sin cerrarla si ya lo estaba).
const openT = (t) => (app) => { if (app.S.tab !== t) app.openTab(t); };
const outputsOpen = (app) => { try { return (app.perf?.().outputs || []).length > 0 || !!app.S.projecting || !!app.S.output; } catch { return false; } };

export const LEVELS = [
  { level: 1, title: "Primer mapping", steps: [
    { text: "Abre la pestaña «Añadir» (en la barra de abajo).", check: (app) => app.S.tab === "add" },
    { text: "Toca «Rectángulo» para crear tu primera superficie.", start: (app) => ({ n: app.S.project.surfaces.length }), check: (app, b) => app.S.project.surfaces.length > b.n },
    { text: "Arrastra una esquina (los puntos de colores) hasta la esquina real de la pared u objeto.", start: (app) => ({ s: sig(sel(app)) }), check: (app, b) => !!sel(app) && sig(sel(app)) !== b.s },
    { text: "Abre «Animaciones» y toca una para ponerla dentro de la superficie.", tab: "anim", start: (app) => ({ g: JSON.stringify(look(app)?.source || {}) }), check: (app, b) => !!look(app) && JSON.stringify(look(app).source) !== b.g && look(app).source.gen !== "calib" },
    { text: "Pulsa «Proyectar» (arriba a la derecha) y lleva la salida al proyector.", check: outputsOpen },
  ] },
  { level: 2, title: "Máscaras", steps: [
    { text: "Selecciona la superficie donde hay algo que tapar (puerta, ventana, mueble).", check: (app) => !!sel(app) },
    { text: "Abre la pestaña «Forma».", check: (app) => app.S.tab === "shape" },
    { text: "Toca «Máscara» para empezar a dibujarla.", check: (app) => app.S.mode === "mask" },
    { text: "Toca al menos 3 puntos alrededor de lo que quieres ocultar.", check: (app) => (sel(app)?.mask.points.length || 0) >= 3 },
    { text: "Termina la máscara (botón «Listo» o Esc). Prueba «Invertir» si quieres lo contrario.", check: (app) => app.S.mode !== "mask" && !!sel(app)?.mask.enabled },
  ] },
  { level: 3, title: "Warping (malla)", steps: [
    { text: "Selecciona una superficie y abre «Forma».", check: (app) => !!sel(app) && app.S.tab === "shape" },
    { text: "Elige una malla de 3×3 o más.", check: (app) => { const s = sel(app); return !!s && s.type === "quad" && (s.cols > 2 || s.rows > 2); } },
    { text: "Mueve un punto del centro para curvar la imagen (ideal para columnas).", start: (app) => ({ s: sig(sel(app)) }), check: (app, b) => sig(sel(app)) !== b.s },
  ] },
  { level: 4, title: "Varias superficies", steps: [
    { text: "Crea una segunda superficie (Añadir → una forma).", check: (app) => app.S.project.surfaces.length >= 2 },
    { text: "Pon un contenido distinto en cada una (Animaciones o Contenido).", check: (app) => { const sc = currentScene(app.S.project); const k = new Set(app.S.project.surfaces.map(s => JSON.stringify([sc.looks[s.id]?.source.type, sc.looks[s.id]?.source.gen, sc.looks[s.id]?.source.mediaId]))); return k.size >= 2; } },
    { text: "Abre «Capas» y cambia el orden (la de arriba tapa a la de abajo).", tab: "layers", start: (app) => ({ o: app.S.project.surfaces.map(s => s.id).join() }), check: (app, b) => app.S.project.surfaces.map(s => s.id).join() !== b.o },
  ] },
  { level: 5, title: "Varios proyectores", steps: [
    { text: "Abre «En vivo»: cada superficie elige por qué pantalla sale (P1-P4).", check: (app) => app.S.tab === "live" },
    { text: "Manda una superficie a la pantalla P2.", check: (app) => app.S.project.surfaces.some(s => s.screen === 2) },
    { text: "Abre la salida P2 y llévala al segundo proyector.", check: (app) => { try { return (app.perf?.().outputs || []).includes(2); } catch { return false; } } },
    { text: "Si los proyectores se solapan, en «Salida» usa Bordes suaves para fundir la unión.", tab: "output", check: (app) => Object.values(app.S.project.settings.output.softEdge || {}).some(v => typeof v === "number" && v > 0 && v < 2) },
  ] },
  { level: 6, title: "VJ en vivo", steps: [
    { text: "Abre la pestaña «En vivo».", check: (app) => app.S.tab === "live" },
    { text: "Elige qué será lo SIGUIENTE en una superficie (sin que se vea todavía).", check: (app) => app.S.project.surfaces.some(s => currentScene(app.S.project).looks[s.id]?.next) },
    { text: "Pulsa GO (o mueve el fader A⟷B) para mezclarlo.", start: (app) => ({ k: JSON.stringify(app.S.project.surfaces.map(s => currentScene(app.S.project).looks[s.id]?.source)) }), check: (app, b) => JSON.stringify(app.S.project.surfaces.map(s => currentScene(app.S.project).looks[s.id]?.source)) !== b.k },
  ] },
  { level: 7, title: "Audio reactivo", steps: [
    { text: "Abre la pestaña «Audio».", check: (app) => app.S.tab === "audio" },
    { text: "Activa el micrófono (o la entrada de audio).", check: (app) => !!app.audio?.()?.active },
    { text: "Selecciona una superficie y activa «Reaccionar al audio» en su contenido.", check: (app) => !!look(app)?.audio?.enabled },
  ] },
  { level: 8, title: "Luces DMX", steps: [
    { text: "Abre la pestaña «Luces».", check: (app) => app.S.tab === "lights" },
    { text: "En «Mis luces» añade una tira LED o un foco.", check: (app) => (app.dmx?.lights() || []).length > 0 },
    { text: "Elige un efecto de la biblioteca (por ejemplo «Arcoíris» o «Fuego»).", check: (app) => (app.dmx?.lights() || []).some(L => L.source === "effect") },
    { text: "Pulsa ▶ PLAY LUCES. Sin nodo conectado lo verás en el escenario (modo práctica).", check: (app) => !!app.dmx?.cfg.enabled },
  ] },
  { level: 9, title: "Proyección interactiva", steps: [
    { text: "Abre la pestaña «Interactivo» y elige la cámara.", check: (app) => app.S.tab === "interactive" },
    { text: "Elige un efecto interactivo (por ejemplo «Ondas al pisar»).", check: (app) => app.S.project.surfaces.some(s => currentScene(app.S.project).looks[s.id]?.source.type === "body") },
    { text: "Pulsa «Alinear automáticamente» (o ajusta las 4 esquinas a mano).", check: (app) => !!app.S.project.settings.interactive?.enabled },
    { text: "Añade una reacción: por ejemplo «Al entrar alguien → luces Fuego».", check: (app) => app.S.project.settings.tracking.rules.length > 0 },
  ] },
  { level: 10, title: "Show control", steps: [
    { text: "Abre «Escenas» y crea una segunda escena.", check: (app) => app.S.project.scenes.length >= 2 },
    { text: "Cambia la transición de una escena (corte, disolver, destello…).", check: (app) => app.S.project.scenes.some(s => s.transition && s.transition !== "fade") },
    { text: "Pasa a la escena siguiente (Enter o GO).", start: (app) => ({ id: app.S.project.sceneId }), check: (app, b) => app.S.project.sceneId !== b.id },
    { text: "Prueba el modo actuación (Escenas → «🎭 Actuación y emergencia», o F10). Sal con Mayús+Esc.", check: (app) => !!app.S.perfMode },
  ] },
  { level: 11, title: "Nodos y señales (como TouchDesigner)", steps: [
    { text: "Crea o selecciona una superficie (Añadir → Rectángulo).", check: (app) => !!sel(app) },
    { text: "Abre la red de nodos: en «Capas» toca «🔗 Ver como red de nodos» (o Ctrl+K y escribe «nodos»).", tab: "layers", check: nodesOpen },
    { text: "La imagen viaja de izquierda a derecha: Fuente → Señales → Efectos → Forma → Mezcla → Salida. Toca el nodo morado «＋» y elige un efecto (por ejemplo «Caleidoscopio 6»).", start: (app) => ({ f: JSON.stringify(look(app)?.fx || {}) }), check: (app, b) => !!look(app) && JSON.stringify(look(app).fx) !== b.f },
    { text: "Toca ⏻ en el nodo de ese efecto: se apaga sin perderse. Tócalo otra vez y vuelve igual.", check: (app, b) => { if (look(app)?.bypass) b.off = true; return !!b.off && !look(app)?.bypass; }, start: () => ({ off: false }) },
    { text: "Toca el nodo del efecto: te lleva a «Efectos» para ajustarlo.", check: (app) => app.S.tab === "fx" && !nodesOpen() },
    { text: "Crea una señal: mantén pulsado (o clic derecho) un deslizador → «〰 Animar al ritmo» → elige una onda o «Seguir los graves».", start: (app) => ({ n: app.S.project.settings.lfos.length }), check: (app, b) => app.S.project.settings.lfos.length > b.n },
    { text: "Mírala moverse: abre «Audio» → «📈 Señales en vivo».", check: (app) => app.S.tab === "audio" },
    { text: "Añade ese control a tu mesa: «En vivo» → «🎚 Mi panel» → «＋ Añadir control».", start: (app) => ({ n: app.S.project.settings.panel.length }), check: (app, b) => app.S.project.settings.panel.length > b.n },
    { text: "Vuelve a la red de nodos: el nodo verde ya dice que se mueve solo. En un nodo de efecto, ⏻ lo apaga sin perderlo y ＋ añade otro.", tab: "layers", check: nodesOpen },
  ] },
  { level: 12, title: "Efectos de cámara y filtros", steps: [
    { text: "Crea o selecciona una superficie (Añadir → Rectángulo).", check: (app) => !!sel(app) },
    { text: "En «Contenido» elige «Cámara» (permite el acceso a la cámara).", tab: "content", check: (app) => look(app)?.source.type === "camera" || camFx(app) === "camera" },
    { text: "Toca un efecto de «📷 Efectos de cámara» (por ejemplo «Cámara térmica»).", check: (app) => camFx(app) === "camera" },
    { text: "Ahora pon una foto o un video tuyo: «Contenido» → «Video o imagen».", check: (app) => look(app)?.source.type === "media" },
    { text: "Ponle un filtro de «🎨 Filtros para esta foto / este video». «Quitar el filtro» la deja como estaba.", check: (app) => camFx(app) === "media" },
  ] },
];


// ---- Capítulos del tutorial interactivo con Luma (el curso completo, en orden) ----
const objs3d = (app) => app.S.project.stage3d?.objects || [];
const sig3d = (app) => JSON.stringify(objs3d(app).map(o => [o.pos, o.rot, o.scale]));
const faceLooks = (app) => { const sc = currentScene(app.S.project); return JSON.stringify((app.S.project.stage3d?.faces || []).map(f => sc.looks[f.id]?.source || null)); };
const modalTitle = () => (typeof document !== "undefined" && document.querySelector("#modal.show h2")?.textContent) || "";
LEVELS.push(
  { level: 13, title: "Conoce LumaMap", steps: [
    { text: "¡Hola! Soy Luma 🤖, tu guía. Te enseño LumaMap con actividades cortas: tú lo haces y yo compruebo que salió. Puedes ocultarme (🙈), volver atrás, repetir o saltar un paso cuando quieras. Pulsa «Siguiente».", info: true },
    { text: "Arriba a la izquierda, ☰ es el menú: proyectos, guardar, ayuda y ajustes. Ábrelo.", target: '#top [data-act="menu"]', check: (app) => app.S.tab === "menu", doIt: openT("menu") },
    { text: "Abajo están las pestañas. Abre «Añadir».", target: dock("add"), check: (app) => app.S.tab === "add", doIt: openT("add") },
    { text: "Toca «Rectángulo»: crea una superficie, la «tela» donde se proyecta.", target: { sel: "#panelBody button, #panelBody .tile", text: "Rectángulo" }, start: (app) => ({ n: app.S.project.surfaces.length }), check: (app, b) => app.S.project.surfaces.length > b.n, doIt: (app) => app.actions.addShape("rect") },
    { text: "Las bolitas de las esquinas se arrastran hasta las esquinas de tu pared u objeto real. Mueve una.", target: "#stage", start: (app) => ({ s: sig(sel(app)) }), check: (app, b) => !!sel(app) && sig(sel(app)) !== b.s },
    { text: "«Proyectar» (arriba a la derecha) manda la imagen al proyector. Ábrelo.", target: "#btnProject", check: (app) => app.S.tab === "output", doIt: openT("output") },
    { text: "Dos salvavidas: ↶ deshace cualquier cosa (Ctrl+Z) y ✨ «¿Qué hago ahora?» te dice el siguiente paso. ¡Listo para el primer mapping!", target: "#btnNext", info: true },
  ] },
  { level: 14, title: "Contenido y efectos", steps: [
    { text: "Toca una superficie en el escenario para elegirla (o crea una: Añadir → Rectángulo).", check: (app) => !!sel(app), doIt: (app) => app.actions.addShape("rect") },
    { text: "Abre la pestaña «Contenido»: qué se ve dentro (animación, video, foto, cámara, texto…).", target: dock("content"), check: (app) => app.S.tab === "content", doIt: openT("content") },
    { text: "Elige «Texto» y escribe tu nombre.", target: { sel: "#panelBody button, #panelBody .tile", text: "Texto" }, check: (app) => look(app)?.source.type === "text", doIt: (app) => app.actions.setSource({ type: "text" }) },
    { text: "Abre «Efectos».", target: dock("fx"), check: (app) => app.S.tab === "fx", doIt: openT("fx") },
    { text: "En «Color», mueve «Brillo» o «Contraste»: los efectos se ajustan en directo.", start: (app) => ({ f: JSON.stringify(look(app)?.fx || {}) }), check: (app, b) => !!look(app) && JSON.stringify(look(app).fx) !== b.f },
    { text: "Toca un efecto de la biblioteca (por ejemplo «Contorno neón»). «Quitar todos los efectos» (al final) lo deja como estaba.", start: (app) => ({ f: JSON.stringify(look(app)?.fx || {}) }), check: (app, b) => !!look(app) && JSON.stringify(look(app).fx) !== b.f },
  ] },
  { level: 15, title: "Línea de tiempo y video", steps: [
    { text: "Abre «Escenas»: cada escena es un momento del show.", target: dock("scenes"), check: (app) => app.S.tab === "scenes", doIt: openT("scenes") },
    { text: "Crea otra escena con «Nueva escena (copia de la actual)».", check: (app) => app.S.project.scenes.length >= 2, doIt: (app) => app.actions.addScene() },
    { text: "En la línea de tiempo, arrastra el borde derecho de una escena para darle duración.", target: "#panelBody .tlgrip", check: (app) => app.S.project.scenes.some(s => s.duration > 0) },
    { text: "Pulsa «▶ Desde el principio»: el show avanza solo, escena tras escena.", target: { sel: "#panelBody button", text: "Desde el principio" }, check: (app) => !!app.S.playing && !!app.S.project.settings.autoAdvance },
    { text: "Abre «🎬 Exportar video»: así sacas el show en MP4 hasta 4K (puedes cerrarlo sin exportar).", target: { sel: "#panelBody button", text: "Exportar video" }, check: () => /Exportar el show/.test(modalTitle()) },
  ] },
  { level: 16, title: "En vivo: mesa de clips y VJ", steps: [
    { text: "Abre «En vivo».", target: dock("live"), check: (app) => app.S.tab === "live", doIt: openT("live") },
    { text: "Toca «Mesa de clips»: como en Resolume, cada fila es una superficie y cada columna un momento.", target: { sel: "#panelBody .livesubs button", text: "Mesa" }, check: (app) => app.S.tab === "live" && app.S.liveSub === "clips" },
    { text: "Toca «VJ automático»: mezcla solo, al ritmo de la música, con «Mi set».", target: { sel: "#panelBody .livesubs button", text: "VJ" }, check: (app) => app.S.tab === "live" && app.S.liveSub === "vj" },
    { text: "Cuando tengas música, pulsa «Empezar» en el VJ automático y mira cómo cambia solo. Por ahora, «Siguiente».", info: true },
  ] },
  { level: 17, title: "3D: mapping sobre objetos", steps: [
    { text: "Abre la pestaña «3D» (si no la ves abajo, está en «Más»).", target: dock("3d"), check: (app) => app.S.tab === "3d", doIt: openT("3d") },
    { text: "Añade un cubo: «1 · Objeto» → «+ Cubo».", target: { sel: "#panelBody .chip", text: "+ Cubo" }, check: (app) => objs3d(app).some(o => o.kind === "cube"), doIt: (app) => { app.stage3d?.addObject("cube"); app.changed({ panel: true }); } },
    { text: "Toca el cubo y muévelo: con las flechas del teclado (Re Pág / Av Pág para subir) o arrastrando las flechas de colores.", start: (app) => ({ s: sig3d(app) }), check: (app, b) => sig3d(app) !== b.s },
    { text: "Toca una cara del cubo y ponle una animación.", start: (app) => ({ s: faceLooks(app) }), check: (app, b) => faceLooks(app) !== b.s },
    { text: "Pon un proyector: «3 · Proyectores» → «1 proyector».", target: { sel: "#panelBody .chip", text: "1 proyector" }, check: (app) => (app.S.project.stage3d?.projectors || []).length > 0 },
    { text: "Toca «Ver desde proyector»: así se verá sobre el objeto real.", target: { sel: "#ws3d button", text: "Ver desde proyector" }, check: (app) => !!app.stage3d?.vp?.viewFrom },
    { text: "Con una caja de verdad, «📷 Objeto real con la cámara» la reconoce y calibra sola. ¡Ya sabes lo básico del 3D!", info: true },
  ] },
  { level: 18, title: "Tu ayudante con IA", steps: [
    { text: "Abre «Asistente» (si no lo ves abajo, está en «Más»): propone qué hacer, revisa tu proyecto y prepara shows.", target: dock("assistant"), check: (app) => app.S.tab === "assistant", doIt: openT("assistant") },
    { text: "Pregúntame algo aquí abajo y pulsa «Preguntar». Por ejemplo: «¿cómo hago una máscara?».", ask: true, check: (app) => (app.academy?.asked || 0) > 0 },
    { text: "La IA es opcional. Con Ollama (gratis, en tu equipo) respondo mejor: Asistente → «Descargar la IA». Sin ella respondo con la guía.", info: true },
  ] },
);
// Redes de nodos (editor como TouchDesigner).
const allNodes = (app) => (app.S.project.networks || []).flatMap(n => n.nodes.map(x => ({ ...x, net: n })));
const netOpen = () => typeof document !== "undefined" && !!document.querySelector("#tdws.show");
const firstNet = (app) => { const P = app.S.project; P.networks ||= []; return P.networks[0] || null; };
async function tdDo(app, fn) {
  if (!netOpen()) await app.openNetwork?.();
  const G = await import("../td/graph.js");
  const net = firstNet(app);
  if (net) app.edit(() => fn(G, net));
}
LEVELS.push(
  { level: 19, title: "Redes como TouchDesigner", steps: [
    { text: "Las redes son como TouchDesigner: conectas operadores (nodos) y la imagen va pasando de uno a otro. Toca «Nodos» arriba para abrir el editor de redes.", target: '#top [data-act="nodes"]', check: () => netOpen(), doIt: (app) => app.openNetwork?.() },
    { text: "Pulsa «＋ Operador» (o la tecla Tab) y crea un «Ruido» de la familia TOP (imágenes).", target: { sel: "#tdws .tdbar button", text: "Operador" }, check: (app) => allNodes(app).some(n => n.fam === "TOP" && n.type === "noise"),
      doIt: (app) => tdDo(app, (G, net) => G.addNode(net, "TOP", "noise", { x: 0, y: 0 })) },
    { text: "Crea un «Nivel» y conéctalo: arrastra desde la salida ● (derecha) del ruido hasta la entrada ○ (izquierda) del nivel. En el móvil: toca la salida y luego el nivel.", check: (app) => allNodes(app).some(n => n.type === "level" && n.in.some(id => n.net.nodes.find(x => x.id === id)?.type === "noise")),
      doIt: (app) => tdDo(app, (G, net) => { const nz = net.nodes.find(n => n.type === "noise") || G.addNode(net, "TOP", "noise"); const lv = net.nodes.find(n => n.type === "level") || G.addNode(net, "TOP", "level", { x: nz.x + 230, y: nz.y }); G.connect(net, nz.id, lv.id, 0); }) },
    { text: "Toca el Nivel y, en sus parámetros, pulsa ƒx al lado de «Brillo». Escribe: 1 + sin(absTime.seconds) — así late solo, como las expresiones de TouchDesigner.", check: (app) => allNodes(app).some(n => n.type === "level" && n.p.brightness && typeof n.p.brightness === "object"),
      doIt: (app) => tdDo(app, (G, net) => { const lv = net.nodes.find(n => n.type === "level"); if (lv) lv.p.brightness = { e: "1 + sin(absTime.seconds)" }; }) },
    { text: "Crea una «Salida» (Out TOP) después del nivel y pulsa «▶ Usar en superficie»: la red se proyecta.", target: { sel: "#tdws .tdbar button", text: "Usar en superficie" }, check: (app) => app.S.project.scenes.some(sc => Object.values(sc.looks).some(l => l.source?.type === "net")) },
    { text: "¡Ya programas como en TouchDesigner! En Archivo → Ejemplos tienes más: mover un objeto 3D con la mano, barras 3D del sonido, túneles de feedback y tu propio GLSL.", info: true },
  ] },
);
LEVELS.push(
  { level: 20, title: "Redes pro: 3D, animación y subredes", steps: [
    { text: "Abre el editor de redes con «Nodos» (arriba).", target: '#top [data-act="nodes"]', check: () => netOpen(), doIt: (app) => app.openNetwork?.() },
    { text: "Crea una «Caja» de la familia SOP (Tab → «caja»): se crean solos su Objeto 3D, una cámara y un Render 3D.", check: (app) => allNodes(app).some(n => n.type === "geo") && allNodes(app).some(n => n.type === "render"),
      doIt: (app) => tdDo(app, (G, net) => { const b = G.addNode(net, "SOP", "box", { x: 0, y: 300 }); const g = G.addNode(net, "COMP", "geo", { x: 230, y: 300 }); G.connect(net, b.id, g.id, 0); if (!net.nodes.some(n => n.type === "camera")) G.addNode(net, "COMP", "camera", { x: 230, y: 470 }); if (!net.nodes.some(n => n.type === "render")) G.addNode(net, "TOP", "render", { x: 460, y: 300 }); }) },
    { text: "Abre el visor 3D: clic derecho en «render1» → «Visor flotante 3D» (o elígelo y pulsa V). Arrastra en el visor para girar la cámara; la rueda acerca.", check: () => typeof document !== "undefined" && !!document.querySelector("#tdws .tdvwin"),
      doIt: async (app) => { if (!netOpen()) await app.openNetwork?.(); const m = await import("../panels-network.js"); const r = firstNet(app)?.nodes.find(n => n.type === "render"); if (r) m.openViewer(r.id); } },
    { text: "Haz clic en el cubo del visor y arrastra una flecha del gizmo para moverlo (G mover, R girar, S escalar).", check: (app) => allNodes(app).some(n => n.type === "geo" && ["tx", "ty", "tz", "rx", "ry", "rz"].some(k => typeof n.p[k] === "number" && Math.abs(n.p[k]) > 0.01)),
      doIt: (app) => tdDo(app, (G, net) => { const g = net.nodes.find(n => n.type === "geo"); if (g) g.p.tx = 0.8; }) },
    { text: "Anímalo: en los parámetros del Objeto 3D pulsa ◆ junto a «Girar Y». Mueve el tiempo de abajo, cambia el valor y se pondrá otra clave ◆. Verás la curva en el editor de curvas (K).", check: (app) => allNodes(app).some(n => n.type === "animation" && (n.p.anim?.chans || []).some(c => (c.keys || []).length >= 2)),
      doIt: (app) => tdDo(app, (G, net) => { const g = net.nodes.find(n => n.type === "geo"); const a = G.addNode(net, "CHOP", "animation", { x: 0, y: 520, p: { anim: { length: 4, chans: [{ name: "giro", keys: [{ t: 0, v: 0, e: "smooth" }, { t: 4, v: 360, e: "smooth" }] }] } } }); if (g) g.p.ry = { e: a.name + ".giro" }; }) },
    { text: "Ordena la red: elige la caja y su Objeto 3D (Mayús + clic) y pulsa Ctrl+G. Quedan dentro de una subred 📦: doble clic para entrar y U para salir.", check: (app) => allNodes(app).some(n => n.type === "base"),
      doIt: (app) => tdDo(app, (G, net) => { const ids = net.nodes.filter(n => n.type === "box" || n.type === "geo").map(n => n.id); if (ids.length) G.groupIntoBase(net, ids); }) },
    { text: "¡Eres pro! Prueba también: Partículas, Modelo 3D (archivo) con tus .glb/.obj, Audio de un archivo, Grabar video, Ventana a un proyector y el Panel de control con deslizadores y botones (Red → Panel de control).", info: true },
  ] },
);
/** El curso completo, en el orden recomendado (cada número es un capítulo de LEVELS). */
export const COURSE = [13, 1, 14, 2, 3, 4, 15, 10, 16, 6, 7, 11, 19, 20, 12, 9, 8, 17, 5, 18];

const KEY = "lumamap:academy", CUR = "lumamap:academyCur";
export class Academy {
  constructor(app) {
    this.app = app; this.cur = null; this.timer = 0; this.onChange = () => {};
    this.hidden = false; this.asked = 0; this.doneFlash = false;
    try { this.done = new Set(JSON.parse(localStorage.getItem(KEY) || "[]")); } catch { this.done = new Set(); }
  }
  get level() { return this.cur ? LEVELS.find(l => l.level === this.cur.level) : null; }
  get step() { return this.level?.steps[this.cur.i] || null; }
  /** Dónde se quedó (para «Continuar»), o null. */
  saved() { try { const c = JSON.parse(localStorage.getItem(CUR) || "null"); return c && LEVELS.some(l => l.level === c.level) ? c : null; } catch { return null; } }
  save() { try { localStorage.setItem(CUR, JSON.stringify(this.cur ? { level: this.cur.level, i: this.cur.i } : null)); } catch {} }
  start(level, i = 0) {
    const L = LEVELS.find(l => l.level === level);
    if (!L) return;
    this.cur = { level, i: Math.max(0, Math.min(L.steps.length - 1, i)), base: null };
    this.finished = 0; this.hidden = false; this.doneFlash = false;
    this.enter();
    clearInterval(this.timer);
    // Comprobación ligera dos veces por segundo (solo mientras hay una lección abierta).
    this.timer = setInterval(() => this.check(), 500);
    this.onChange();
  }
  /** Empieza el curso (o lo continúa donde se quedó). */
  startCourse({ restart = false } = {}) {
    const c = !restart && this.saved();
    if (c) return this.start(c.level, c.i);
    this.start(COURSE.find(n => !this.done.has(n)) ?? COURSE[0]);
  }
  /** El capítulo que va después de este en el curso (o null al final). */
  nextLevel(level = this.cur?.level ?? this.finished) {
    const k = COURSE.indexOf(level);
    return k >= 0 && k + 1 < COURSE.length ? COURSE[k + 1] : null;
  }
  /** back: se volvió a este paso (◀ / ⟲): no se da por hecho solo porque ya estaba así; hay que hacerlo otra vez. */
  enter(back = false) {
    const st = this.step;
    this.doneFlash = false;
    this.cur.armed = !back;
    this.cur.base = st?.start ? st.start(this.app) : null;
    if (st?.tab && this.app.S.tab !== st.tab) this.app.openTab(st.tab);
    this.save();
  }
  check() {
    const st = this.step;
    if (!st) return this.stop();
    if (st.info || !st.check || this.doneFlash) return;
    let ok = false;
    try { ok = !!st.check(this.app, this.cur.base); } catch {}
    if (!ok) this.cur.armed = true;
    else if (this.cur.armed) {
      // «¡Bien!» un momento y al siguiente paso.
      this.doneFlash = true; this.onChange();
      setTimeout(() => { if (this.doneFlash) this.next(); }, 900);
    }
  }
  next() {
    if (!this.cur) return;
    this.cur.i++;
    if (this.cur.i >= this.level.steps.length) {
      this.done.add(this.cur.level);
      try { localStorage.setItem(KEY, JSON.stringify([...this.done])); } catch {}
      const lv = this.cur.level, nx = this.nextLevel(lv);
      this.stop();
      this.finished = lv;
      // Para «Continuar» la próxima vez: el capítulo siguiente del curso.
      try { localStorage.setItem(CUR, JSON.stringify(nx ? { level: nx, i: 0 } : null)); } catch {}
    } else this.enter();
    this.onChange();
  }
  prev() { if (!this.cur || this.cur.i === 0) return; this.cur.i--; this.enter(true); this.onChange(); }
  /** Repetir el paso actual desde cero (vuelve a mirar el estado de partida). */
  repeat() { if (!this.cur) return; this.enter(true); this.onChange(); }
  /** Hacer el paso por el usuario (si el paso lo permite). */
  doIt() { const st = this.step; if (!st?.doIt) return; this.cur.armed = true; try { st.doIt(this.app); } catch (e) { console.warn(e); } if (st.info) this.next(); }
  hide(on = true) { this.hidden = on; this.onChange(); }
  resetProgress() { this.done = new Set(); try { localStorage.removeItem(KEY); localStorage.removeItem(CUR); } catch {} this.onChange(); }
  stop() { clearInterval(this.timer); this.timer = 0; this.cur = null; this.doneFlash = false; this.onChange(); }
}
