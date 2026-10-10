// web/js/hologram.js
// Hologramas automáticos con 1 a 4 proyectores:
//  - «escenario»: como el de Tupac en Coachella (técnica «fantasma de Pepper»): el
//    proyector ilumina una pantalla y una lámina transparente inclinada a 45° la refleja;
//    el público ve a la persona «flotando» en el escenario. Todo lo negro es invisible.
//  - «tul»: tela holográfica transparente delante del escenario (proyección frontal).
//  - «piramide»: pirámide transparente de 4 caras sobre una pantalla (o un proyector por cara).
// Lo que hace solo: quita el fondo de la persona (IA, verde o negro), fondo negro puro,
// más brillo y contraste, reparte la imagen entre los proyectores con uniones suaves y
// gira o refleja la imagen según el montaje.
import * as M from "./model.js";

export const HOLO_TYPES = [
  { id: "escenario", emoji: "🎤", name: "Escenario (como Tupac)", desc: "Una lámina transparente a 45° refleja la proyección: la persona aparece en el escenario." },
  { id: "tul", emoji: "🌫", name: "Tela holográfica (tul)", desc: "Tela transparente delante del escenario; el proyector apunta de frente." },
  { id: "piramide", emoji: "🔺", name: "Pirámide (4 caras)", desc: "Pirámide transparente boca abajo sobre una pantalla o mesa: se ve desde los 4 lados." },
];
export const HOLO_CUTS = [["ai", "Quitar el fondo con IA"], ["green", "Fondo verde"], ["black", "Fondo negro"], ["none", "Ya está sin fondo"]];
export const HOLO_SOURCES = [["video", "🎬 Mi video"], ["camera", "🎥 Cámara en vivo"], ["model", "🧊 Objeto 3D"], ["anim", "✨ Animación"], ["text", "🔤 Texto"]];

export function defaultHologram() {
  return { type: "escenario", n: 1, source: "video", mediaId: "", cut: "ai", anim: "Galaxia", text: "HOLA", flipH: false, flipV: false, look: true, overlap: 0.15 };
}

/**
 * Trozos de la imagen para n proyectores en fila con «overlap» de solape entre vecinos
 * (la zona compartida se funde con bordes suaves). Devuelve [{ a, b, left, right }]:
 * a..b = parte de la imagen (0..1); left/right = ancho del borde suave en cada salida.
 */
export function slices(n, overlap = 0.15) {
  n = Math.max(1, Math.min(4, n | 0));
  if (n === 1) return [{ a: 0, b: 1, left: 0, right: 0 }];
  const w = 1 / (n - (n - 1) * overlap);
  return Array.from({ length: n }, (_, i) => {
    const a = i * w * (1 - overlap);
    return { a: round(a), b: round(Math.min(1, a + w)), left: i > 0 ? overlap : 0, right: i < n - 1 ? overlap : 0 };
  });
}
const round = (v) => Math.round(v * 1e6) / 1e6;

/** Contenido según la elección: fuente y efectos. */
function contentLook(P, cfg) {
  const look = M.createLook();
  const fx = look.fx;
  if (cfg.source === "video") {
    const med = P.media.find(m => m.id === cfg.mediaId) || P.media.find(m => m.kind === "video");
    Object.assign(look.source, { type: "media", mediaId: med?.id || null, cutout: cfg.cut === "ai" && med?.kind === "video" });
    look.fit = "contain";
    if (cfg.cut === "green") { fx.chromaKey = 0.42; fx.keyColor = "#00ff00"; fx.keySoft = 0.12; }
    if (cfg.cut === "black") { fx.lumaKey = 0.08; fx.lumaSoft = 0.05; }
    look.volume = 1;
  } else if (cfg.source === "model" && cfg.model?.parts?.length) {
    // Objeto 3D (Crear objeto 3D): gira despacio; en la pirámide cada cara lo ve desde su lado.
    Object.assign(look.source, { type: "model3d", model: cfg.model, spin: cfg.spin ?? 1, view: "front", yaw: 0, finish: "real" });
  } else if (cfg.source === "camera") {
    Object.assign(look.source, { type: "body", bodyMode: "persona", bodyGlow: 0.15 });
    look.fit = "contain";
  } else if (cfg.source === "text") {
    Object.assign(look.source, { type: "text", text: cfg.text || "HOLA", textColor: "#9ff6ff" });
  } else {
    const a = M.ANIM_LIBRARY.find(x => x.name === cfg.anim) || M.ANIM_LIBRARY.find(x => /galaxia/i.test(x.name)) || M.ANIM_LIBRARY[0];
    Object.assign(look.source, { type: "gen", gen: a.gen, color: a.color, color2: a.color2, speed: a.speed, scale: a.scale });
    fx.lumaKey = 0.06;
  }
  // Holograma: negro puro alrededor (invisible en la lámina), más brillo y contraste.
  fx.brightness = 1.15; fx.contrast = 1.25; fx.saturation = 1.1;
  if (cfg.look) { fx.duotone = 0.45; fx.duoA = "#000000"; fx.duoB = "#9ff6ff"; fx.scanlines = 0.18; fx.border = 0; }
  return look;
}

/**
 * Monta (o vuelve a montar) el holograma. Quita el anterior (superficies marcadas
 * «holo») y crea las nuevas. Devuelve un resumen para el usuario.
 */
export function buildHologram(app, cfgIn) {
  const P = app.S.project, cfg = { ...defaultHologram(), ...cfgIn };
  cfg.n = Math.max(1, Math.min(4, cfg.n | 0));
  P.settings.hologram = cfg;
  // Lo anterior del holograma fuera (y los bordes de pantalla que puso).
  for (const s of P.surfaces.filter(x => x.holo)) M.removeSurface(P, s.id);
  for (const n of [1, 2, 3, 4]) if (P.settings.screens[n]) delete P.settings.screens[n].edge;
  const W = P.width, H = P.height, base = contentLook(P, cfg), made = [];
  const add = (name, corners, screen, mod) => {
    const s = M.createQuad({ name, corners });
    s.holo = true; s.screen = screen;
    P.surfaces.push(s);
    for (const sc of P.scenes) {
      const l = JSON.parse(JSON.stringify(base));
      mod?.(l);
      sc.looks[s.id] = l;
    }
    made.push(s);
    return s;
  };
  if (cfg.type === "piramide") {
    if (cfg.n >= 4) {
      // Pirámide grande: un proyector por cara, imagen completa y reflejada.
      ["frente", "derecha", "detrás", "izquierda"].forEach((f, i) => add(`Holograma ${f}`, M.rectCorners(0, 0, W, H), i + 1, (l) => { l.fx.flipX = !cfg.flipH; l.fx.flipY = !!cfg.flipV; if (l.source.type === "model3d") l.source.yaw = i * 90; }));
    } else {
      // Una pantalla: 4 vistas en cruz, cada una con la cabeza hacia fuera.
      const c = Math.min(W, H) / 3, cx = W / 2, cy = H / 2;
      const cells = [[cx - c / 2, cy + c / 2, 180, "frente"], [cx + c / 2, cy - c / 2, -90, "derecha"], [cx - c / 2, cy - 1.5 * c, 0, "detrás"], [cx - 1.5 * c, cy - c / 2, 90, "izquierda"]];
      cells.forEach(([x, y, deg, f], i) => {
        const s = add(`Holograma ${f}`, M.rectCorners(x, y, c, c), 1, (l) => { l.fx.flipX = !cfg.flipH; l.fx.flipY = !!cfg.flipV; if (l.source.type === "model3d") l.source.yaw = i * 90; });
        const r = deg * Math.PI / 180, ox = x + c / 2, oy = y + c / 2;
        for (const p of s.points) { const dx = p.x - ox, dy = p.y - oy; p.x = ox + dx * Math.cos(r) - dy * Math.sin(r); p.y = oy + dx * Math.sin(r) + dy * Math.cos(r); }
      });
    }
  } else {
    // Escenario o tul: la imagen repartida entre n proyectores, en fila, con uniones suaves.
    const parts = slices(cfg.n, cfg.overlap);
    parts.forEach((sl, i) => {
      // Reflejo izquierda↔derecha con varios proyectores: cada salida muestra el trozo simétrico, reflejado.
      const src = cfg.flipH ? parts[parts.length - 1 - i] : sl;
      add(cfg.n > 1 ? `Holograma P${i + 1}` : "Holograma", M.rectCorners(0, 0, W, H), cfg.n > 1 ? i + 1 : 0, (l) => {
        if (cfg.n > 1) l.span = { a: src.a, b: src.b };
        l.fx.flipX = !!cfg.flipH; l.fx.flipY = !!cfg.flipV;
      });
      if (cfg.n > 1) P.settings.screens[i + 1].edge = { left: sl.left, right: sl.right };
    });
  }
  return { surfaces: made, text: summary(cfg) };
}

export function summary(cfg) {
  const t = HOLO_TYPES.find(x => x.id === cfg.type);
  const outs = cfg.type === "piramide" && cfg.n < 4 ? "por P1" : cfg.n > 1 ? `repartido en P1-P${cfg.n} con uniones suaves` : "por P1";
  return `${t.emoji} Holograma «${t.name}» listo ${outs}`;
}

/** Cómo montarlo, paso a paso y sin palabras técnicas. */
export function howTo(cfg) {
  const n = cfg.n;
  if (cfg.type === "escenario") return [
    "Pon una lámina transparente (polietileno o metacrilato, cuanto más fina y lisa mejor) inclinada a 45° entre el público y el escenario.",
    `Pon una pantalla blanca o gris en el suelo (o en el techo) delante de la lámina y apunta ${n > 1 ? `los ${n} proyectores, uno al lado del otro,` : "el proyector"} a esa pantalla.`,
    "El reflejo de esa pantalla en la lámina es la persona «en el escenario». Todo lo negro no se ve.",
    "Escenario oscuro y fondo negro detrás de la lámina: así el holograma brilla más.",
    "Si la persona sale cabeza abajo toca «↕ Girar»; si sale al revés (izquierda/derecha), «↔ Espejo».",
  ];
  if (cfg.type === "tul") return [
    "Cuelga la tela holográfica (tul) tensa delante del escenario, sin arrugas.",
    `Apunta ${n > 1 ? `los ${n} proyectores, uno al lado del otro,` : "el proyector"} de frente a la tela; la zona donde se juntan se funde sola.`,
    "Escenario oscuro detrás de la tela: lo negro no se ve y la persona parece flotar.",
  ];
  return n >= 4 ? [
    "Pirámide grande de 4 caras transparentes boca abajo.",
    "Un proyector por cara (P1 frente, P2 derecha, P3 detrás, P4 izquierda), cada uno apuntando a su cara.",
  ] : [
    "Pon la pirámide transparente boca abajo justo en el centro de la pantalla (o de la mesa proyectada).",
    "Las 4 vistas salen en cruz por P1; la sala, a oscuras.",
    "Si se ve al revés, toca «↔ Espejo».",
  ];
}
