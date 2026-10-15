// web/js/tutorial.js
// «Tutorial guiado»: la primera vez que abres algo nuevo (red de nodos, señales, Mi panel, efectos
// de cámara) sale un consejo corto con «Hacer la lección». Se activa o desactiva en ☰ → Ayuda y
// sistema (o en Asistente → Aprender). Apagado: ni consejos ni tarjeta de lección en marcha.
// Las lecciones se pueden empezar igual a mano. Se guarda en este equipo.
import { h, btn } from "./ui.js";

const KEY = "lumamap:tutorial", SEEN = "lumamap:tutorialSeen";
const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
const seen = () => { try { return new Set(JSON.parse(ls.get(SEEN) || "[]")); } catch { return new Set(); } };

export const tutorialOn = () => ls.get(KEY) !== "off";
export function setTutorial(on, app = null) {
  ls.set(KEY, on ? "on" : "off");
  if (!on) app?.academy?.stop();   // apagado: fuera también la lección que estuviera en marcha
}
/** Vuelve a enseñar todos los consejos (como la primera vez). */
export function resetTips() { ls.set(SEEN, "[]"); }
const markSeen = (key) => { const s = seen(); s.add(key); ls.set(SEEN, JSON.stringify([...s])); };

export const TIPS = {
  nodes: { title: "🔗 Así se lee una red de nodos", lesson: 11,
    text: "Como en TouchDesigner: la imagen viaja de izquierda a derecha. Fuente (qué se ve) → Señales (lo que lo mueve solo) → Efectos → Forma → Mezcla → Salida. Toca un nodo para cambiarlo; ⏻ apaga un efecto sin perderlo y ＋ añade uno nuevo." },
  signals: { title: "📈 Señales en vivo", lesson: 11,
    text: "Cada línea es algo que se mueve solo: el sonido (graves, medios, agudos, golpe) y las señales que creas. Para crear una: mantén pulsado (o clic derecho) cualquier deslizador → «〰 Animar al ritmo»." },
  mypanel: { title: "🎚 Mi panel", lesson: 11,
    text: "Tu mesa de control: junta aquí solo los controles que usas en directo (de cualquier superficie). Se ve también en el móvil y en grande (⛶)." },
  camfx: { title: "📷 Efectos de cámara y filtros", lesson: 12,
    text: "Con la cámara salen todos los efectos de cámara. Con una foto o un video salen solo los que sirven como filtro (tu archivo queda igual, el filtro va encima). «Quitar» vuelve a la imagen tal cual." },
};

async function startLesson(app, n) {
  const m = await import("./panels-assistant.js");   // la academia vive con el asistente (se carga al usarla)
  m.aiOf(app);
  app.academy.start(n);
}

/** Consejo de la primera vez (o null si el tutorial está apagado o ya se vio). */
export function tipCard(app, key) {
  const t = TIPS[key];
  if (!t || !tutorialOn() || seen().has(key)) return null;
  const card = h("div", { class: "tutip", "data-tip": key });
  const close = () => { markSeen(key); card.remove(); };
  card.append(h("b", {}, t.title), h("p", {}, t.text),
    h("div", { class: "row" },
      t.lesson ? btn({ label: "🎓 Hacer la lección (2 min)", kind: "small primary", onClick: () => { close(); startLesson(app, t.lesson); } }) : null,
      btn({ label: "Entendido", kind: "small", onClick: close }),
      btn({ label: "Desactivar el tutorial", kind: "small", title: "Se vuelve a activar en ☰ → Ayuda y sistema", onClick: () => { setTutorial(false, app); card.remove(); } })));
  return card;
}
