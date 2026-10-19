// web/js/phoneusb-ui.js
// Avisos al enchufar cámaras y móviles (app de Windows):
//  - móvil Android por cable: qué pasa en cada momento (preparando, «acepta en el móvil»,
//    abriendo la cámara) y, cuando llega la imagen, se usa sola para lo interactivo;
//  - si el móvil no tiene activada la «Depuración USB», los pasos para activarla (una vez);
//  - cualquier cámara o sensor nuevo: aviso con «Usar para lo interactivo».
import { h, notice, closeNotice, dialog, toast } from "./ui.js";
import { useCameraForInteractive as useCamera, openPhoneCam } from "./panels-phonecam.js";
import { onPhoneChange, listPhones, isPhoneKey } from "./phonecam.js";
import { calibOf } from "./interactive.js";
import { cameraName } from "./sources.js";

const pct = (p) => p?.total ? ` · ${Math.round(100 * p.completed / p.total)} %` : "";

/** Pasos para activar la depuración USB (una sola vez), con los nombres de Xiaomi/HyperOS. */
export function usbGuide(brand = "") {
  const xiaomi = /xiaomi|redmi|poco/i.test(brand);
  return dialog({ title: "📱 Activar la cámara del móvil por cable (una sola vez)", wide: true, content: h("div", { class: "usbguide" },
    h("ol", {},
      h("li", {}, xiaomi ? "En el móvil: Ajustes → Sobre el teléfono." : "En el móvil: Ajustes → Acerca del teléfono (en algunos: Información del software)."),
      h("li", {}, xiaomi ? "Toca 7 veces seguidas «Versión de HyperOS» (o «Versión de MIUI») hasta que diga «Ya eres desarrollador»." : "Toca 7 veces seguidas «Número de compilación» hasta que diga «Ya eres desarrollador»."),
      h("li", {}, xiaomi ? "Vuelve a Ajustes → Ajustes adicionales → Opciones de desarrollador." : "Vuelve a Ajustes → Sistema → Opciones de desarrollador."),
      h("li", {}, "Activa «Depuración USB»."),
      h("li", {}, "Desenchufa y vuelve a enchufar el cable. En el móvil sale «¿Permitir depuración USB?»: marca «Permitir siempre desde este ordenador» y toca «Permitir»."),
      h("li", {}, "Listo: LumaMap abre la cámara en el móvil solo. La primera vez el móvil pregunta por la cámara: toca «Permitir».")),
    h("p", { class: "hint" }, "Desde entonces basta con enchufar el cable. Si no aparece nada, prueba otro cable (algunos solo cargan) y elige «Transferencia de archivos» en la notificación USB del móvil."),
    h("p", { class: "hint" }, "¿Sin cable? También funciona por Wi-Fi: Interactivo → «📱 Usar el móvil como cámara».")),
    buttons: [{ label: "Entendido", kind: "primary", value: null }] });
}

export function startDeviceNotices(app) {
  const D = globalThis.LumaDesktop;
  const announced = new Set();
  // Un móvil manda imagen: aviso y, si viene por cable (o la interactiva no tiene cámara), se usa ya.
  onPhoneChange((key) => {
    const p = listPhones().find(x => x.id === key);
    if (!p?.live) { if (p && !p.online) { announced.delete(key); announced.delete(key + ":usb"); } return; }
    const tag = key + (p.usb ? ":usb" : "");
    if (announced.has(tag)) return;
    announced.add(tag);
    closeNotice("usb-phone");   // el aviso de «abriendo…» ya no hace falta
    const cal = calibOf(app.S.project), cur = cal.camId;
    const otherPhoneLive = isPhoneKey(cur) && cur !== key && listPhones().some(x => x.id === cur && x.live);
    if (cur === key) return;
    if ((p.usb && !otherPhoneLive) || !cur) {
      useCamera(app, key);
      notice({ id: "cam-" + key, text: `✓ Cámara del ${p.label} lista${p.usb ? " (cable USB)" : ""}`, sub: "Ya se usa para lo interactivo.", timeout: 12000,
        actions: [{ label: "Ir a Interactivo", kind: "primary", onClick: () => app.openTab("interactive") }] });
    } else notice({ id: "cam-" + key, text: `📱 Llega la imagen del ${p.label}`, timeout: 15000,
      actions: [{ label: "Usar para lo interactivo", kind: "primary", onClick: () => { useCamera(app, key); toast(`Cámara: ${p.label}`); } }] });
  });

  if (!D?.phoneUsb) return;
  let guideTimer = 0, guided = new Set();
  const show = (st) => {
    if (!st) return;
    if (st.adb === "downloading") notice({ id: "usb-adb", text: "📱 Preparando la conexión por cable con el móvil…", sub: "Descargando la herramienta oficial de Google para Android (solo esta vez)" + pct(st.progress) });
    else if (st.adb === "error") notice({ id: "usb-adb", kind: "err", text: "No se pudo preparar la conexión por cable con el móvil", sub: "Comprueba internet; se reintentará al volver a enchufarlo. Mientras, puedes usar el Wi-Fi.",
      actions: [{ label: "Usar por Wi-Fi", onClick: () => openPhoneCam(app) }] });
    else closeNotice("usb-adb");
    const ph = st.phones?.[0];
    clearTimeout(guideTimer);
    if (ph?.state === "unauthorized") notice({ id: "usb-phone", text: "📱 Mira el móvil: toca «Permitir» en «¿Permitir depuración USB?»", sub: "Marca «Permitir siempre desde este ordenador» y no volverá a preguntar." });
    else if (ph?.state === "opening") notice({ id: "usb-phone", text: `📱 Abriendo la cámara en el ${ph.model || "móvil"}…`, sub: "Si el móvil está bloqueado, desbloquéalo." });
    else if (ph?.state === "open") {
      if (!listPhones().some(p => p.usb && p.live)) notice({ id: "usb-phone", text: `📱 Cámara abierta en el ${ph.model || "móvil"}`, sub: "Si el móvil pregunta por la cámara, toca «Permitir» (solo la primera vez).",
        actions: [{ label: "Reintentar", onClick: () => D.phoneUsb.retry() }] });
    } else if (ph?.state === "error") notice({ id: "usb-phone", kind: "err", text: "📱 No se pudo abrir la cámara en el móvil", sub: ph.error || "",
      actions: [{ label: "Reintentar", kind: "primary", onClick: () => D.phoneUsb.retry() }] });
    else if (st.plugged?.length && st.adb === "ok") {
      // Enchufado pero adb no lo ve: le falta la «Depuración USB». Se espera un poco (adb tarda en verlo).
      const b = st.plugged[0].brand;
      guideTimer = setTimeout(() => {
        if (guided.has(b)) return;
        guided.add(b);
        notice({ id: "usb-phone", text: `📱 Móvil ${b} conectado por cable`, sub: "Para usarlo como cámara, activa una vez la «Depuración USB» en el móvil.",
          actions: [{ label: "Cómo activarla", kind: "primary", onClick: () => usbGuide(b) }, { label: "Usar por Wi-Fi", onClick: () => openPhoneCam(app) }] });
      }, 6000);
    } else if (!st.plugged?.length) { closeNotice("usb-phone"); guided.clear(); }
  };
  D.phoneUsb.onChange(show);
  D.phoneUsb.status().then(show).catch(() => {});
}

/** Cámara o sensor recién enchufado (no móviles: esos avisan arriba). */
export function cameraPlugged(app, fresh) {
  const list = fresh.filter(c => !isPhoneKey(c.id));
  const c = list.find(x => x.sensor) || list.find(x => x.is3d) || list[0];
  if (!c) return;
  const cal = calibOf(app.S.project);
  notice({ id: "cam-new", text: `🎥 Conectado: ${cameraName(c)}`, sub: c.sensor ? "Sensor que ve a la gente aunque esté quieta y a oscuras." : "", timeout: 15000,
    actions: cal.camId === c.id ? [] : [{ label: "Usar para lo interactivo", kind: "primary", onClick: () => { useCamera(app, c.id, { sensor: c.sensor }); toast(`Cámara: ${cameraName(c)}`); } }] });
}
