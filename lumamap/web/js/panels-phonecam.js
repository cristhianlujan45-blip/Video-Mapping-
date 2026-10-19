// web/js/panels-phonecam.js
// «📱 Usar el móvil como cámara»: un código QR para abrir la página de cámara en el
// móvil (Wi-Fi o cable USB con anclaje de red), los pasos en palabras sencillas y el
// estado en directo. En cuanto el móvil manda imagen, se usa para lo interactivo.
import { h, row, btn, hint, toast, dialog, closeDialog } from "./ui.js";
import { qrSvg } from "./qr.js";
import { phoneUrls, netLabel, listPhones, onPhoneChange } from "./phonecam.js";
import { calibOf } from "./interactive.js";
import { usbGuide } from "./phoneusb-ui.js";

/** Pone esta cámara en la proyección interactiva (y en sus superficies). */
export function useCameraForInteractive(app, id, { sensor = false } = {}) {
  const P = app.S.project, cal = calibOf(P);
  cal.camId = id || "";
  cal.depth = !!sensor;
  for (const sc of P.scenes) for (const l of Object.values(sc.looks)) if (l.source.type === "body") l.source.camId = cal.camId;
  app.changed({ panel: true }); app.commitSoon();
}

export async function openPhoneCam(app) {
  const body = h("div", { class: "phonecam" });
  const live = h("div", { class: "pclive" });
  const info = await phoneUrls();
  let pick = 0;

  const paintLive = () => {
    const cal = calibOf(app.S.project), ps = listPhones().filter(p => p.online || p.live);
    live.replaceChildren(ps.length ? h("div", { class: "list" }, ...ps.map(p => h("div", { class: "item" },
      h("span", {}, `${p.live ? "🟢" : "🟡"} ${p.label}`, h("small", {}, p.live ? " · enviando imagen" : ` · ${p.state || "conectando"}`)),
      cal.camId === p.id ? h("b", { class: "ok" }, "En uso") : btn({ label: "Usar este", kind: "small primary", onClick: () => { useCameraForInteractive(app, p.id); toast(`📱 Cámara: ${p.label}`); paintLive(); } }))))
      : hint("Esperando al móvil… (cuando pulses «Empezar» en el móvil aparecerá aquí)"));
  };
  // El primer móvil que llega se usa solo (si la interactiva no tiene ya un móvil elegido).
  const off = onPhoneChange((key) => {
    const p = listPhones().find(x => x.id === key);
    const cal = calibOf(app.S.project);
    if (p?.live && !String(cal.camId).startsWith("phone:")) { useCameraForInteractive(app, p.id); toast(`📱 Ya llega la imagen de «${p.label}»: se usa para lo interactivo`); }
    if (body.isConnected) paintLive();
  });

  const draw = () => {
    body.replaceChildren();
    if (!info.ok) {
      body.append(h("p", {}, info.android
        ? "En la app de Android usa la cámara del propio móvil o tablet: en Interactivo → 1 · Cámara elige «Cámara por defecto» (trasera). Para usar OTRO móvil como cámara de un PC, hazlo desde la app de Windows."
        : info.why));
      return;
    }
    const nets = info.list;
    if (!nets.length) { body.append(h("p", {}, "Este PC no está conectado a ninguna red. Conéctalo al Wi-Fi (o el móvil por cable con «Anclaje de red por USB»).")); return; }
    const cur = nets[Math.min(pick, nets.length - 1)];
    // append() escribiría «null» por las partes que no aplican: se filtran.
    body.append(...[
      h("div", { class: "pcgrid" },
        h("div", { class: "pcqr", html: qrSvg(cur.url, { size: 210 }) }),
        h("ol", { class: "pcsteps" },
          h("li", {}, "Conecta el móvil a la misma red que este PC: el mismo Wi-Fi, o por cable USB activando en el móvil «Anclaje de red por USB»."),
          h("li", {}, "Abre la cámara del móvil y apunta a este código (o escribe la dirección de abajo en su navegador)."),
          h("li", {}, "El móvil dirá «La conexión no es privada»: es normal, el certificado es de este PC. Toca «Configuración avanzada» → «Acceder» (en iPhone: «Mostrar detalles» → «visitar este sitio web»)."),
          h("li", {}, "Pulsa «▶ Empezar» en el móvil y permite la cámara. Ponlo quieto junto al proyector, mirando la zona."))),
      nets.length > 1 ? h("div", { class: "chips" }, ...nets.map((n, i) => h("button", { class: `chip ${i === pick ? "on" : ""}`, onclick: () => { pick = i; draw(); } }, netLabel(n)))) : null,
      h("p", { class: "pcurl" }, h("code", {}, cur.url), info.pin ? h("span", {}, ` · Código (PIN): `, h("b", {}, info.pin)) : null),
      h("h4", { class: "res-group" }, "Móviles conectados"), live,
      h("details", { class: "fold", open: !!globalThis.LumaDesktop?.phoneUsb }, h("summary", {}, "Por cable USB (lo más fácil)"),
        h("ul", {},
          globalThis.LumaDesktop?.phoneUsb ? h("li", {}, h("b", {}, "Android: enchufa el cable y listo. "), "LumaMap abre la cámara en el móvil solo y la usa para lo interactivo. Solo hace falta activar una vez la «Depuración USB» en el móvil. ",
            h("button", { class: "btn small", onclick: () => usbGuide() }, "Cómo activarla")) : null,
          h("li", {}, "Android 14 o más nuevo (si el móvil lo trae): baja la notificación «USB» y elige «Cámara web». El móvil aparece como una cámara más en la lista."),
          h("li", {}, "iPhone: activa «Compartir Internet» por cable y usa el código de arriba eligiendo la red «Cable USB»."))),
      h("details", { class: "fold" }, h("summary", {}, "¿Y la profundidad 3D?"),
        h("p", {}, "Un móvil normal no mide distancias como un sensor 3D (Kinect, RealSense). Para tocar burbujas y los juegos interactivos no hace falta: la IA ve la silueta de cada persona en la imagen del móvil, y el «Modo sensor» aprende la zona vacía y marca lo que entra."),
        h("p", {}, h("b", {}, "Usar el sensor LiDAR del iPhone o el ToF de algunos Android: EN DESARROLLO.")))].filter(Boolean));
    paintLive();
  };
  draw();
  await dialog({ title: "📱 Usar el móvil como cámara", content: body, wide: true, buttons: [{ label: "Listo", kind: "primary", value: null }] });
  off();
}
