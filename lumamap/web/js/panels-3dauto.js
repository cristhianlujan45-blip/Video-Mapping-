// web/js/panels-3dauto.js
// «📷 Objeto real con la cámara (automático)» del panel 3D: pones el objeto de verdad (una caja,
// un cartel, la pared…), la cámara lo mira mientras el proyector muestra franjas, y LumaMap:
//   · reconoce qué es (caja con 2-3 caras a la vista, superficie plana, pared u objeto irregular);
//   · si es una caja, la crea en el 3D con sus proporciones y coloca el proyector virtual donde
//     está el de verdad (con la lente del paso 3), con la malla encima para comprobarlo; desde ahí
//     se mueve, se mira desde el proyector y se ajusta lo que haga falta;
//   · si es plano, crea superficies ya alineadas encima de cada cara.
// La parte de reconocer y calcular está en objscan.js (probada con una escena sintética).
import { h, section, row, btn, hint, toast } from "./ui.js";
import { analyzeAndSolve } from "./objscan.js";
import { scanCamera, cameraSelect } from "./panels-3dcalib.js";
import { fovFromThrow } from "./calib3d.js";
import * as M from "./model.js";

const KIND_LABEL = { box: "📦 Caja", plane: "▭ Superficie plana", planes: "▭ Varias superficies planas", wall: "🧱 Pared", irregular: "🗿 Objeto irregular", none: "—" };
const FACE_COLORS = ["#ffd60a", "#00e5ff", "#ff4fd8", "#7cff6b"];
const ui = { dims: ["", "", ""] };

/** La foto de la cámara con las caras encontradas encima. */
function resultPhoto(res) {
  const { photo, ana } = res, W = photo.width, H = photo.height;
  const cv = h("canvas", { class: "calibcam", width: W, height: H });
  const g = cv.getContext("2d");
  const base = document.createElement("canvas"); base.width = W; base.height = H; base.getContext("2d").putImageData(photo, 0, 0);
  g.drawImage(base, 0, 0);
  ana.faces.forEach((f, i) => {
    const q = f.camQuad; if (!q) return;
    g.strokeStyle = FACE_COLORS[i % 4]; g.lineWidth = Math.max(2, W / 240); g.fillStyle = FACE_COLORS[i % 4] + "33";
    g.beginPath(); q.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill(); g.stroke();
    const c = q.reduce((s, p) => [s[0] + p[0] / 4, s[1] + p[1] / 4], [0, 0]);
    g.fillStyle = "#000a"; g.fillRect(c[0] - W / 40, c[1] - W / 50, W / 20, W / 25);
    g.fillStyle = FACE_COLORS[i % 4]; g.font = `bold ${Math.round(W / 32)}px system-ui`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(i + 1), c[0], c[1]);
  });
  return cv;
}

/** Superficies 2D ya alineadas encima de cada cara (en la imagen del proyector = la composición). */
function facesToSurfaces(app, faces, name) {
  const P = app.S.project;
  app.edit(() => faces.forEach((f, i) => {
    const s = M.createQuad({ name: `${name} · cara ${i + 1}`, corners: f.quad.map(([u, v]) => [u * P.width, v * P.height]) });
    M.addSurface(P, s, { type: "gen", gen: "calib" });
  }));
  toast(`${faces.length} superficie(s) alineada(s) encima del objeto: elige su contenido en Contenido.`);
}

/** Caja → objeto 3D con sus medidas y el proyector virtual donde está el real. */
function applyBox(app, st, res) {
  const d = st.data, sol = res.sol, [w, hgt, dep] = sol.dims;
  let p = (st.sel?.type === "projector" && d.projectors.find(x => x.id === st.sel.id)) || d.projectors[0];
  app.edit(() => {
    let o = st.sel?.type === "object" && d.objects.find(x => x.id === st.sel.id && x.kind === "cube");
    if (!o) { o = st.addObject("cube"); o.name = "Caja detectada"; }
    o.scale = [+w.toFixed(4), +hgt.toFixed(4), +dep.toFixed(4)]; o.pos = [0, +(hgt / 2).toFixed(4), 0]; o.rot = [0, 0, 0];
    if (!p) p = st.addProjector();
    Object.assign(p, { pos: sol.proj.pos.map(v => +v.toFixed(5)), rot: sol.proj.rot.map(v => +v.toFixed(4)), fov: +sol.proj.fov.toFixed(4), shift: sol.proj.shift.map(v => +v.toFixed(5)), wire: true });
  });
  app.actions.projectorToScreen(p.id, p.screen);
  st.select("projector", p.id);
  st.frameSelection?.();
  app.changed({ panel: true }); app.commit();
  toast(`Caja de ${(w * 100).toFixed(0)} × ${(hgt * 100).toFixed(0)} × ${(dep * 100).toFixed(0)} cm en el 3D, y ${p.name} donde está el real (error ${sol.rms.toFixed(1)} px). La malla se ve en el objeto: comprueba que cae en sus bordes.`);
}

async function run(app, st, status) {
  if (st.autoBusy) return;
  st.autoBusy = true; st.autoRes = null; app.renderPanel();
  const say = (t) => { const el = document.querySelector("#panelBody .autostatus"); if (el) el.textContent = t; };
  try {
    const scan = await scanCamera(app, st, (i, n) => say(`Escaneando… ${i}/${n} (no muevas la cámara ni el objeto)`));
    if (scan.map.coverage < 0.01) throw new Error(scan.map.contrast < 25 ? "La cámara no ve cambiar la proyección: apúntala al objeto y comprueba que el proyector sale por su pantalla (Proyectar)." : "La cámara casi no distingue las franjas: menos luz en la sala o la cámara más cerca.");
    say("Reconociendo el objeto…");
    // Reconocer y calcular en un hilo aparte (la app sigue fluida y el cálculo va a toda velocidad).
    const p = st.data.projectors[0];
    const proj = { fov: p?.fov || fovFromThrow(1.5, [app.S.project.width, app.S.project.height]), res: p?.res || [app.S.project.width, app.S.project.height], shift: p?.shift || [0, 0] };
    const dims = ui.dims.map(v => +v / 100);
    const known = dims.every(v => v > 0) ? dims : null;
    const { ana, sol } = await analyzeAndSolve(scan.map, proj, { width: dims[0] > 0 ? dims[0] : 0.5, dims: known }, (f) => say(`Calculando la caja y el proyector… ${Math.round(f * 100)} %`));
    const res = { ana, photo: scan.photo, at: Date.now() };
    if (ana.kind === "box" && sol) {
      res.sol = sol;
      if (!res.sol.ok) res.note = res.sol.why;
    }
    st.autoRes = res;
  } catch (e) { toast("No se pudo: " + (e.message || e), "err"); }
  finally { st.autoBusy = false; app.renderPanel(); }
}

export function autoSection(app, st) {
  const res = st.autoRes;
  const dimIn = (i, ph) => {
    const el = h("input", { class: "text-in small num", type: "number", min: 1, step: 1, placeholder: ph, value: ui.dims[i], style: { width: "74px" } });
    el.addEventListener("change", () => { ui.dims[i] = el.value; });
    return el;
  };
  const status = h("small", { class: "dim autostatus" }, st.autoBusy ? "Trabajando…" : "");
  const body = [
    hint("Pon el objeto de verdad (una caja, un cartel, la pared…) delante del proyector y una cámara (o el móvil como cámara) que lo vea, un poco a un lado del proyector. Saca la proyección por el proyector real (Proyectar) y pulsa el botón: unos 30 s."),
    row(cameraSelect(app, st), btn({ label: st.autoBusy ? "Trabajando…" : "📷 Detectar el objeto y calibrar", kind: "wide primary", disabled: !!st.autoBusy, onClick: () => run(app, st, status) })),
    h("div", { class: "lbl" }, "Medidas de la caja si las conoces (cm): sale más exacto. Si no, solo el ancho para la escala, o nada."),
    row(dimIn(0, "ancho"), dimIn(1, "alto"), dimIn(2, "fondo")),
    status,
  ];
  if (res) {
    const a = res.ana;
    body.push(h("p", { class: "autokind" }, h("b", {}, KIND_LABEL[a.kind] || a.kind), " · ", a.message));
    if (res.photo && a.faces.length) body.push(resultPhoto(res));
    if (a.kind === "box" && res.sol?.ok) {
      const [w, hgt, dep] = res.sol.dims;
      body.push(hint(`Medidas calculadas: ${(w * 100).toFixed(0)} × ${(hgt * 100).toFixed(0)} × ${(dep * 100).toFixed(0)} cm (ancho × alto × fondo)${ui.dims.every(v => +v > 0) ? " (las tuyas)" : ""} · error ${res.sol.rms.toFixed(1)} px${res.sol.rms > 6 ? " — revisa la malla y ajusta en el paso 4" : ""}.`),
        row(btn({ label: "📦 Poner la caja en el 3D, calibrada", kind: "wide primary", onClick: () => applyBox(app, st, res) }),
          btn({ label: "Solo superficies 2D", kind: "wide", onClick: () => facesToSurfaces(app, a.faces, "Caja") })));
    } else if (a.kind === "box") body.push(hint(res.note || "No se pudo calcular la caja: usa la calibración por puntos (paso 4)."), btn({ label: "Superficies 2D en cada cara", kind: "block", onClick: () => facesToSurfaces(app, a.faces, "Caja") }));
    else if (a.faces.length) body.push(btn({ label: a.kind === "wall" ? "Mapear la pared" : "Crear superficies alineadas encima", kind: "block primary", onClick: () => facesToSurfaces(app, a.faces, a.kind === "wall" ? "Pared" : "Objeto") }));
    if (a.kind === "irregular") body.push(hint("Objetos curvos o irregulares (cabezas, esculturas…): escanear su forma en 3D está EN DESARROLLO. Hoy: importa su modelo 3D y calíbralo por puntos (paso 4)."));
  }
  return section("📷 Objeto real con la cámara (automático)", ...body);
}
