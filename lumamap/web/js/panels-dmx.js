// web/js/panels-dmx.js
// Panel «Luces» (modo profesional): DMX, Art-Net, sACN, pixel mapping, fixtures.
// Arriba, los cuatro pasos simples: CONECTAR → PIXEL MAP → VIDEO → PLAY.
// Debajo (plegado), universos, fixtures, snapshots, prueba, monitor, entrada y
// diagnóstico.
import { h, section, row, btn, slider, segmented, toggle, swatches, hint, toast, dialog, prompt } from "./ui.js";
import { FIXTURE_TYPES, CHANNEL_TYPES, TEST_COLORS } from "./dmx.js";
import { COLOR_ORDERS, channelsPerPixel, splitPortAddress, portAddress } from "./dmxproto.js";
import { surfaceOutline, bbox } from "./math.js";

const ui = { monUniverse: 1, monPct: false, open: {} };
const pct = (v) => Math.round(v * 100) + "%";

function selectEl(options, value, onChange, cls = "text-in") {
  const sel = h("select", { class: cls });
  for (const [v, label] of options) sel.append(h("option", { value: v, selected: String(v) === String(value) }, label));
  sel.addEventListener("change", () => onChange(sel.value));
  return sel;
}
function num(value, onChange, { min = 0, max = 99999, step = 1, w = 80 } = {}) {
  const i = h("input", { class: "text-in num", type: "number", min, max, step, value, style: { width: w + "px" } });
  i.addEventListener("change", () => onChange(Math.max(min, Math.min(max, +i.value || 0))));
  return i;
}
function field(label, el) { return h("label", { class: "field" }, h("span", { class: "lab" }, label), el); }
function fold(id, title, open, ...children) {
  const d = h("details", { class: "fold" }, h("summary", {}, title), ...children);
  d.open = ui.open[id] ?? open;
  d.addEventListener("toggle", () => { ui.open[id] = d.open; });
  return d;
}

/** Ajusta el pixel map al contorno de la superficie seleccionada. */
function fitToSurface(app, pm) {
  const s = app.surf();
  if (!s) return toast("Selecciona primero una superficie");
  const b = bbox(surfaceOutline(s)), P = app.S.project;
  pm.x = b.x / P.width; pm.y = b.y / P.height; pm.w = b.w / P.width; pm.h = b.h / P.height;
}

async function newPixelMapWizard(app) {
  const D = app.dmx;
  const w = { shape: "line", count: 60, cols: 16, rows: 8, colorOrder: "RGB", universe: D.cfg.universes[0]?.num || 1, channel: 1, serpentine: true };
  const body = h("div", {});
  const draw = () => {
    body.innerHTML = "";
    const perUni = Math.floor(512 / channelsPerPixel(w.colorOrder));
    const n = w.shape === "grid" ? w.cols * w.rows : w.count;
    body.append(
      field("Forma", segmented({ options: [["line", "Tira / línea"], ["grid", "Matriz"], ["circle", "Círculo"], ["arc", "Arco"]], value: w.shape, onChange: (v) => { w.shape = v; draw(); } })),
      w.shape === "grid" ? row(field("Columnas", num(w.cols, (v) => { w.cols = v; draw(); }, { min: 1, max: 512 })), field("Filas", num(w.rows, (v) => { w.rows = v; draw(); }, { min: 1, max: 512 })),
        toggle({ label: "Cableado en zig-zag", value: w.serpentine, onChange: (v) => { w.serpentine = v; } }))
        : field("Número de LED / píxeles", num(w.count, (v) => { w.count = v; draw(); }, { min: 1, max: 20000 })),
      field("Tipo de LED", selectEl(Object.keys(COLOR_ORDERS).map(k => [k, k]), w.colorOrder, (v) => { w.colorOrder = v; draw(); })),
      row(field("Universo inicial", num(w.universe, (v) => { w.universe = v; }, { min: 1, max: 32768 })), field("Canal inicial", num(w.channel, (v) => { w.channel = v; }, { min: 1, max: 512 }))),
      hint(`${n} píxeles × ${channelsPerPixel(w.colorOrder)} canales = ${n * channelsPerPixel(w.colorOrder)} canales · ${perUni} píxeles por universo → ocupa ${Math.ceil(n / perUni)} universo(s). Los universos que falten se crean solos (AUTO SPAN) y ningún píxel queda partido (ALIGN).`));
  };
  draw();
  const ok = await dialog({ title: "Nuevo pixel map", content: body, buttons: [{ label: "Cancelar", value: false }, { label: "Crear", kind: "primary", value: true }] });
  if (!ok) return;
  const pm = D.addPixelMap({ ...w, rows: w.shape === "grid" ? w.rows : 1, cols: w.shape === "grid" ? w.cols : w.count, h: w.shape === "line" ? 0.02 : 0.4, y: w.shape === "line" ? 0.49 : 0.3,
    x: w.shape === "line" ? 0.1 : 0.3, w: w.shape === "line" ? 0.8 : 0.4, sampling: "average" });
  if (app.surf()) fitToSurface(app, pm);
  app.S.dmxSel = pm.id;
  app.changed({ panel: true }); app.commit();
  toast(`Pixel map creado · arrástralo sobre la imagen para elegir qué parte del video lleva`);
}

async function addFixtureDlg(app) {
  const D = app.dmx;
  const w = { type: "drgb", universe: D.cfg.universes[0]?.num || 1, address: 0, count: 1 };
  const body = h("div", {},
    field("Tipo", selectEl(Object.entries(FIXTURE_TYPES).map(([k, t]) => [k, t.label]), w.type, (v) => { w.type = v; })),
    row(field("Universo", num(w.universe, (v) => { w.universe = v; }, { min: 1, max: 32768 })), field("Dirección (0 = siguiente libre)", num(0, (v) => { w.address = v; }, { min: 0, max: 512 }))),
    field("Cantidad", num(1, (v) => { w.count = v; }, { min: 1, max: 64 })));
  if (!(await dialog({ title: "Añadir fixture", content: body, buttons: [{ label: "Cancelar", value: false }, { label: "Añadir", kind: "primary", value: true }] }))) return;
  for (let i = 0; i < w.count; i++) {
    const f = D.addFixture(w.type, { universe: w.universe, ...(w.address && i === 0 ? { address: w.address } : {}) });
    f.x = (i + 1) / (w.count + 1);
  }
  app.changed({ panel: true }); app.commit();
}

function monitorCanvas(app) {
  const cv = h("canvas", { width: 640, height: 320, class: "dmxmon" });
  const draw = () => {
    if (!cv.isConnected) return;
    const D = app.dmx, ctx = cv.getContext("2d"), data = D.out.get(ui.monUniverse) || D.inputs.get(ui.monUniverse);
    ctx.fillStyle = "#05070b"; ctx.fillRect(0, 0, 640, 320);
    ctx.font = "10px ui-monospace,monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (let i = 0; i < 512; i++) {
      const x = (i % 32) * 20, y = Math.floor(i / 32) * 20, v = data ? data[i] : 0;
      ctx.fillStyle = v ? `hsl(190,100%,${10 + v / 255 * 45}%)` : "#11151d";
      ctx.fillRect(x + 1, y + 1, 18, 18);
      ctx.fillStyle = v > 140 ? "#001" : "#8e9ab0";
      ctx.fillText(ui.monPct ? Math.round(v / 2.55) : v, x + 10, y + 10);
    }
    requestAnimationFrame(() => setTimeout(draw, 120));
  };
  setTimeout(draw, 0);
  cv.title = "Canal = fila × 32 + columna + 1";
  return cv;
}

const lights = {
  title: () => "Luces · DMX, Art-Net, sACN",
  render(app) {
    const S = app.S, D = app.dmx, c = D.cfg;
    const set = (fn, panel = true) => { fn(); app.changed({ panel }); app.commitSoon(); };
    D.monitoring = true;
    const wrap = h("div", { class: "lights" });

    // ---------- PLAY ----------
    wrap.append(h("div", { class: "lightbar" },
      btn({ label: c.enabled ? "■ DETENER LUCES" : "▶ PLAY LUCES", kind: c.enabled ? "danger wide" : "primary wide", onClick: () => set(() => { c.enabled = !c.enabled; if (c.enabled) D.connect(); }) }),
      btn({ label: D.blackout ? "Apagón ON" : "Apagón", ic: "blackout", kind: D.blackout ? "on" : "", onClick: () => { D.blackout = !D.blackout; app.renderPanel(); } })),
      slider({ label: "Master de luces", min: 0, max: 1, value: c.master, def: 1, fmt: pct, onInput: (v) => { c.master = v; app.paramTouched?.("dmx/master"); }, param: "dmx/master" }));

    // ---------- 1 · Conectar ----------
    const conn = section("1 · Conectar");
    if (!D.desktop) conn.append(hint("Enviar Art-Net o sACN a la red necesita la app de Windows. Aquí puedes preparar todo con universos virtuales."));
    else {
      const ifs = D.service.interfaces;
      conn.append(field("Interfaz de red de las luces", selectEl([["", "— Elegir —"], ...ifs.map(i => [i.address, `${i.name} · ${i.address}${i.internal ? " (solo este equipo)" : ""}`])], c.iface, (v) => set(() => { c.iface = v; }))),
        row(btn({ label: "Actualizar interfaces", ic: "restart", onClick: () => { D.connect(); D.refreshInterfaces(); setTimeout(() => app.renderPanel(), 300); } }),
          btn({ label: "Buscar nodos Art-Net", ic: "target", onClick: () => { D.connect(); D.discover(); toast("Buscando nodos…"); setTimeout(() => app.renderPanel(), 1500); } })));
      const nodes = h("div", { class: "devlist" });
      for (const n of D.service.nodes) {
        nodes.append(h("div", { class: `dev ${n.online ? "connected" : ""}` }, h("i"), h("b", {}, `${n.shortName || "Nodo"} · ${n.ip}`),
          h("small", {}, `${n.longName || ""} · fabricante ${n.estaCode?.trim() || n.esta} · ${n.outputs.length} salida(s): ${n.outputs.map(a => "Art-Net " + a).join(", ") || "—"}${n.rtt !== null ? " · " + n.rtt + " ms" : ""}`),
          btn({ label: "Usar", kind: "small", onClick: () => set(() => {
            // Un universo por cada salida del nodo, enviado solo a su IP (unicast).
            let next = Math.max(0, ...c.universes.map(u => u.num)) + 1;
            for (const pa of n.outputs.length ? n.outputs : [0]) {
              const ex = c.universes.find(u => u.protocol === "artnet" && u.portAddress === pa) || c.universes.find(u => u.protocol === "virtual" && u.portAddress === pa);
              if (ex) Object.assign(ex, { protocol: "artnet", dest: "unicast", ip: n.ip });
              else c.universes.push({ num: next++, name: n.shortName, protocol: "artnet", portAddress: pa, sacnUniverse: pa + 1, dest: "unicast", ip: n.ip, enabled: true, delayMs: 0, priority: 100 });
            }
            c.universes.sort((a, b) => a.num - b.num);
            toast(`Universos enviados a ${n.ip}`);
          }) })));
      }
      if (!D.service.nodes.length) nodes.append(hint("Sin nodos detectados todavía. Los nodos sACN no responden a la búsqueda: añádelos como universo sACN."));
      conn.append(nodes,
        field("Protocolo de todos los universos", segmented({ options: [["artnet", "Art-Net"], ["sacn", "sACN"], ["virtual", "Virtual"]], value: c.universes[0]?.protocol || "virtual", small: true,
          onChange: (v) => set(() => { for (const u of c.universes) u.protocol = v; }) })));
    }
    wrap.append(conn);

    // ---------- 2 · Pixel map ----------
    const maps = section("2 · Pixel map (LED)");
    const list = h("div", { class: "list" });
    for (const pm of c.pixelMaps) {
      const p = D.patchOf(pm), n = p.pos.length, used = p.patch.filter(Boolean);
      const unis = used.length ? `U${used[0].universe}${p.lastUniverse !== used[0].universe ? "–" + p.lastUniverse : ""}` : "sin canales";
      list.append(h("div", { class: `item ${S.dmxSel === pm.id ? "on" : ""}`, onclick: (e) => { if (e.target.closest("button")) return; S.dmxSel = pm.id; app.renderPanel(); } },
        h("span", {}, pm.name, h("small", {}, ` · ${n} píxeles ${pm.colorOrder} · ${unis} · ${pm.source === "video" ? "video → luces" : pm.source === "color" ? "color fijo" : "apagado"}`)),
        btn({ ic: pm.enabled ? "eye" : "eyeoff", kind: "icon", title: "Activar / desactivar", onClick: () => set(() => { pm.enabled = !pm.enabled; }) }),
        btn({ ic: "trash", kind: "icon", title: "Eliminar", onClick: () => set(() => { c.pixelMaps.splice(c.pixelMaps.indexOf(pm), 1); }) })));
    }
    if (!c.pixelMaps.length) list.append(hint("Crea un pixel map: tira, matriz, círculo o arco. Luego arrástralo sobre la imagen del escenario."));
    maps.append(list, btn({ label: "Nuevo pixel map", ic: "plus", kind: "primary block", onClick: () => newPixelMapWizard(app) }));
    const pm = c.pixelMaps.find(x => x.id === S.dmxSel);
    if (pm) {
      const upd = (k) => (v) => set(() => { pm[k] = v; D.ensureUniverses(); }, false);
      maps.append(h("div", { class: "pmedit" },
        field("Nombre", Object.assign(h("input", { class: "text-in", value: pm.name }), { onchange: (e) => set(() => { pm.name = e.target.value; }) })),
        // 3 · Video → luces
        field("3 · Contenido de las luces", segmented({ options: [["video", "Video → luces"], ["color", "Color fijo"], ["off", "Apagado"]], value: pm.source, onChange: (v) => set(() => { pm.source = v; }) })),
        pm.source === "color" ? swatches({ value: pm.color, onChange: upd("color") }) : null,
        pm.source === "video" ? h("div", {},
          field("Muestreo", segmented({ options: [["average", "Área de cada LED"], ["point", "Centro"], ["avg", "Color medio"]], small: true, value: pm.average ? "avg" : pm.sampling,
            onChange: (v) => set(() => { pm.average = v === "avg"; pm.sampling = v === "avg" ? "average" : v; }, false) })),
          field("Pantalla de origen", selectEl([[1, "P1"], [2, "P2"], [3, "P3"], [4, "P4"]], pm.screen || 1, (v) => set(() => { pm.screen = +v; }, false))),
          slider({ label: "Brillo", min: 0, max: 3, value: pm.brightness, def: 1, fmt: pct, onInput: upd("brightness") }),
          slider({ label: "Contraste", min: 0, max: 3, value: pm.contrast, def: 1, fmt: pct, onInput: upd("contrast") }),
          slider({ label: "Saturación", min: 0, max: 3, value: pm.saturation, def: 1, fmt: pct, onInput: upd("saturation") }),
          slider({ label: "Gamma", min: 0.3, max: 3, value: pm.gamma, def: 1, fmt: (v) => v.toFixed(2), onInput: upd("gamma") })) : null,
        slider({ label: "Intensidad", min: 0, max: 1, value: pm.intensity, def: 1, fmt: pct, onInput: upd("intensity"), param: `dmx/map/${pm.id}/intensity` }),
        fold("pmgeo", "Forma y posición", false,
          field("Forma", segmented({ options: [["line", "Línea"], ["grid", "Matriz"], ["circle", "Círculo"], ["arc", "Arco"]], small: true, value: pm.shape, onChange: (v) => set(() => { pm.shape = v; if (v === "grid") pm.count = pm.cols * pm.rows; D.ensureUniverses(); }) })),
          pm.shape === "grid" ? row(field("Columnas", num(pm.cols, (v) => set(() => { pm.cols = v; pm.count = v * pm.rows; D.ensureUniverses(); }), { min: 1, max: 512 })),
            field("Filas", num(pm.rows, (v) => set(() => { pm.rows = v; pm.count = v * pm.cols; D.ensureUniverses(); }), { min: 1, max: 512 })))
            : field("Píxeles", num(pm.count, (v) => set(() => { pm.count = v; D.ensureUniverses(); }), { min: 1, max: 20000 })),
          pm.shape === "arc" ? row(field("Ángulo inicial", num(pm.startAngle, (v) => set(() => { pm.startAngle = v; }), { min: -360, max: 360 })), field("Apertura", num(pm.arc, (v) => set(() => { pm.arc = v; }), { min: 1, max: 360 }))) : null,
          pm.shape === "grid" ? field("Orden de cableado", segmented({ options: [["ltr", "Izq → der"], ["rtl", "Der → izq"], ["ttb", "Arriba → abajo"], ["btt", "Abajo → arriba"]], small: true, value: pm.order, onChange: (v) => set(() => { pm.order = v; }) })) : null,
          row(pm.shape === "grid" ? toggle({ label: "Zig-zag (serpentina)", value: pm.serpentine, onChange: (v) => set(() => { pm.serpentine = v; }) }) : null,
            toggle({ label: "Invertir orden", value: pm.reverse, onChange: (v) => set(() => { pm.reverse = v; }) })),
          slider({ label: "X", min: -0.5, max: 1.5, value: pm.x, def: 0, fmt: pct, onInput: upd("x") }),
          slider({ label: "Y", min: -0.5, max: 1.5, value: pm.y, def: 0, fmt: pct, onInput: upd("y") }),
          slider({ label: "Ancho", min: 0, max: 2, value: pm.w, def: 1, fmt: pct, onInput: upd("w") }),
          slider({ label: "Alto", min: 0, max: 2, value: pm.h, def: 1, fmt: pct, onInput: upd("h") }),
          btn({ label: "Ajustar a la superficie seleccionada", ic: "fit", kind: "block", onClick: () => set(() => fitToSurface(app, pm)) })),
        fold("pmpatch", "Parcheo DMX", false,
          field("Tipo de LED (orden de color)", selectEl(Object.keys(COLOR_ORDERS).map(k => [k, k]), pm.colorOrder, (v) => set(() => { pm.colorOrder = v; D.ensureUniverses(); }))),
          row(field("Universo", num(pm.universe, (v) => set(() => { pm.universe = v; D.ensureUniverses(); }), { min: 1, max: 32768 })),
            field("Canal", num(pm.channel, (v) => set(() => { pm.channel = v; D.ensureUniverses(); }), { min: 1, max: 512 }))),
          toggle({ label: "AUTO SPAN", hint: "Al llenar 512 canales sigue en el universo siguiente", value: pm.autoSpan, onChange: (v) => set(() => { pm.autoSpan = v; D.ensureUniverses(); }) }),
          toggle({ label: "ALIGN", hint: "Ningún píxel queda partido entre dos universos", value: pm.align, onChange: (v) => set(() => { pm.align = v; D.ensureUniverses(); }) }),
          hint(patchSummary(D, pm)))));
    }
    wrap.append(maps);

    // ---------- Fixtures ----------
    const fx = h("div", {});
    for (const f of c.fixtures) {
      fx.append(h("div", { class: "fixture" },
        h("div", { class: "row" }, h("b", {}, f.name), h("small", {}, ` U${f.universe} · ${f.address}-${f.address + f.channels.length - 1}`), h("span", { class: "grow" }),
          btn({ ic: "trash", kind: "icon", title: "Eliminar", onClick: () => set(() => { c.fixtures.splice(c.fixtures.indexOf(f), 1); }) })),
        row(field("Universo", num(f.universe, (v) => set(() => { f.universe = v; D.ensureUniverses(); }), { min: 1, max: 32768 })),
          field("Dirección", num(f.address, (v) => set(() => { f.address = v; D.ensureUniverses(); }), { min: 1, max: 512 })),
          field("Color", selectEl([["video", "Del video (posición)"], ["manual", "Manual / MIDI"]], f.source, (v) => set(() => { f.source = v; })))),
        ...f.channels.map((ch, i) => h("div", { class: "fixch" },
          selectEl(CHANNEL_TYPES, ch.type, (v) => set(() => { ch.type = v; ch.name = CHANNEL_TYPES.find(x => x[0] === v)[1]; }), "text-in small"),
          slider({ label: `${f.address + i} · ${ch.name || ch.type}`, min: 0, max: 255, step: 1, value: f.values[i] ?? (ch.type === "dimmer" ? 255 : ch.type === "pan" || ch.type === "tilt" ? 128 : 0), fmt: (v) => String(Math.round(v)),
            onInput: (v) => { f.values[i] = Math.round(v); app.paramTouched?.(`dmx/fix/${f.id}/${i}`); }, param: `dmx/fix/${f.id}/${i}` }))),
        row(btn({ label: "+ canal", kind: "small", onClick: () => set(() => { f.channels.push({ type: "custom", name: "Personalizado" }); }) }),
          btn({ label: "− canal", kind: "small", onClick: () => set(() => { f.channels.pop(); }) }),
          btn({ label: "Guardar como tipo", kind: "small", onClick: async () => {
            const name = (await prompt("Nombre del tipo de fixture", f.name))?.trim();
            if (name) { FIXTURE_TYPES["user:" + name] = { label: name, channels: f.channels.map(x => x.type) }; saveUserFixtures(); toast("Tipo guardado"); }
          } }))));
    }
    wrap.append(fold("fix", `Fixtures (${c.fixtures.length})`, c.fixtures.length > 0, fx,
      hint("Los canales de color pueden venir del video (en la posición del fixture, arrástralo en el escenario) o de MIDI/OSC/audio (clic derecho en el canal → Aprender)."),
      btn({ label: "Añadir fixture", ic: "plus", kind: "block", onClick: () => addFixtureDlg(app) })));

    // ---------- Universos ----------
    const ut = h("div", { class: "unitable" }, h("div", { class: "urow head" }, ...["Nº", "Protocolo", "Dirección", "Destino", "IP", "Retardo", ""].map(t => h("span", {}, t))));
    for (const u of c.universes) {
      const pa = splitPortAddress(u.portAddress ?? u.num - 1);
      ut.append(h("div", { class: `urow ${u.enabled === false ? "off" : ""}` },
        h("b", {}, String(u.num)),
        selectEl([["virtual", "Virtual"], ["artnet", "Art-Net"], ["sacn", "sACN"]], u.protocol, (v) => set(() => { u.protocol = v; }), "text-in small"),
        u.protocol === "sacn" ? num(u.sacnUniverse, (v) => set(() => { u.sacnUniverse = v; }), { min: 1, max: 63999, w: 70 })
          : u.protocol === "artnet" ? h("span", { class: "pa" }, num(pa.net, (v) => set(() => { u.portAddress = portAddress(v, pa.sub, pa.uni); }), { min: 0, max: 127, w: 46 }),
            num(pa.sub, (v) => set(() => { u.portAddress = portAddress(pa.net, v, pa.uni); }), { min: 0, max: 15, w: 40 }),
            num(pa.uni, (v) => set(() => { u.portAddress = portAddress(pa.net, pa.sub, v); }), { min: 0, max: 15, w: 40 })) : h("span", { class: "hint" }, "—"),
        u.protocol === "virtual" ? h("span", {}, "—") : selectEl([["broadcast", u.protocol === "sacn" ? "Multicast" : "Broadcast"], ["unicast", "Unicast"]], u.dest, (v) => set(() => { u.dest = v; }), "text-in small"),
        u.dest === "unicast" && u.protocol !== "virtual" ? Object.assign(h("input", { class: "text-in small", value: u.ip, placeholder: "2.0.0.10" }), { onchange: (e) => set(() => { u.ip = e.target.value.trim(); }) }) : h("span", {}, ""),
        num(u.delayMs || 0, (v) => set(() => { u.delayMs = v; }), { min: 0, max: 2000, step: 5, w: 64 }),
        h("span", { class: "acts" },
          btn({ ic: u.enabled === false ? "eyeoff" : "eye", kind: "icon", onClick: () => set(() => { u.enabled = u.enabled === false; }) }),
          btn({ ic: "trash", kind: "icon", onClick: () => set(() => { c.universes.splice(c.universes.indexOf(u), 1); }) }))));
    }
    wrap.append(fold("uni", `Universos (${c.universes.length})`, false, ut,
      hint("Virtual = preparar sin hardware. Al cambiar a Art-Net o sACN el pixel map sigue igual. Retardo en ms para igualar luces con proyectores y pantallas LED."),
      btn({ label: "Añadir universo", ic: "plus", kind: "block", onClick: () => set(() => {
        const n = Math.max(0, ...c.universes.map(u => u.num)) + 1, p = c.universes.at(-1);
        c.universes.push({ num: n, name: "", protocol: p?.protocol || "virtual", dest: p?.dest || "broadcast", ip: p?.ip || "", enabled: true, delayMs: p?.delayMs || 0, priority: 100, portAddress: n - 1, sacnUniverse: n });
      }) })));

    // ---------- Snapshots ----------
    const snaps = h("div", { class: "list" });
    for (const sn of c.snapshots) snaps.append(h("div", { class: `item ${D.snapshot === sn.id ? "on" : ""}` }, h("span", {}, sn.name, h("small", {}, ` · ${Object.keys(sn.data).length} universo(s)`)),
      btn({ ic: "play", kind: "icon", title: "Recuperar", onClick: () => { D.recall(D.snapshot === sn.id ? null : sn.id); app.renderPanel(); } }),
      btn({ ic: "knob", kind: "icon", title: "Asignar a MIDI / tecla / OSC", onClick: () => app.actions.learn("dmx/snapshot/" + sn.id) }),
      btn({ ic: "trash", kind: "icon", onClick: () => set(() => { c.snapshots.splice(c.snapshots.indexOf(sn), 1); if (D.snapshot === sn.id) D.snapshot = null; }) })));
    wrap.append(fold("snap", `Snapshots (${c.snapshots.length})`, false, snaps,
      row(btn({ label: "CAPTURAR estado DMX", ic: "photo", onClick: async () => { const n = await prompt("Nombre", `Snapshot ${c.snapshots.length + 1}`); if (n !== null) set(() => D.capture(n)); } }),
        D.snapshot ? btn({ label: "Soltar snapshot", onClick: () => { D.recall(null); app.renderPanel(); } }) : null)));

    // ---------- Prueba ----------
    const tg = [["", "Todo"], ...c.pixelMaps.map(p => [p.id, p.name]), ...c.fixtures.map(f => [f.id, f.name])];
    wrap.append(fold("test", "Prueba", false,
      h("div", { class: "chips" }, ...Object.keys(TEST_COLORS).filter(k => k !== "full").map(k => h("button", { class: `chip ${D.test?.color === k ? "on" : ""}`, onclick: () => { D.test = k === "off" ? null : { color: k, target: ui.testTarget || "" }; app.renderPanel(); } },
        { red: "Rojo", green: "Verde", blue: "Azul", white: "Blanco", off: "Quitar prueba" }[k]))),
      field("Aplicar a", selectEl(tg, ui.testTarget || "", (v) => { ui.testTarget = v; if (D.test) D.test.target = v; })),
      hint("La prueba se ve en las luces y en el monitor. Apagón = todo a 0 al instante.")));

    // ---------- Monitor ----------
    const st = D.service.stats;
    const stats = h("div", { class: "perf" },
      ...[["Fotogramas DMX", String(D.frames)], ["Paquetes/s", st ? st.pps.toFixed(0) : "—"], ["Tráfico", st ? (st.bps / 1024).toFixed(1) + " KB/s" : "—"],
        ["Universos", String(c.universes.length)], ["Errores", st ? String(st.errors) : "—"], ["Descartados", st ? String(st.dropped) : "—"],
        ["Latencia editor → red", st ? st.latency.toFixed(1) + " ms" : "—"], ["Tiempo DMX por fotograma", D.lastSendMs.toFixed(2) + " ms"]]
        .map(([k, v]) => h("div", { class: "pc" }, h("small", {}, k), h("b", {}, v))));
    wrap.append(fold("mon", "Monitor DMX", false, stats,
      row(field("Universo", selectEl([...new Set([...c.universes.map(u => u.num), ...D.inputs.keys()])].map(n => [n, typeof n === "number" ? "Salida " + n : "Entrada " + n]), ui.monUniverse, (v) => { ui.monUniverse = isNaN(+v) ? v : +v; })),
        toggle({ label: "Mostrar en %", value: ui.monPct, onChange: (v) => { ui.monPct = v; } })),
      monitorCanvas(app), st?.lastError ? hint("Último error: " + st.lastError) : null));

    // ---------- Entrada DMX ----------
    const ins = h("div", { class: "list" });
    for (const i of c.inputs) ins.append(h("div", { class: "item" }, h("span", {}, `${i.protocol === "sacn" ? "sACN" : "Art-Net"} universo ${i.universe}`,
      h("small", {}, D.inputs.has(`${i.protocol}:${i.universe}`) ? " · recibiendo" : " · sin señal")),
      btn({ ic: "trash", kind: "icon", onClick: () => set(() => { c.inputs.splice(c.inputs.indexOf(i), 1); }) })));
    wrap.append(fold("in", "Entrada DMX (consola de luces → LumaMap)", false, ins,
      row(btn({ label: "+ Art-Net", kind: "small", onClick: async () => { const u = await prompt("Universo Art-Net (dirección de puerto 0-32767)", "0"); if (u !== null) set(() => c.inputs.push({ protocol: "artnet", universe: +u || 0 })); } }),
        btn({ label: "+ sACN", kind: "small", onClick: async () => { const u = await prompt("Universo sACN (1-63999)", "1"); if (u !== null) set(() => c.inputs.push({ protocol: "sacn", universe: Math.max(1, +u || 1) })); } })),
      hint("DMX LEARN: clic derecho en cualquier control → Aprender… y mueve el canal en la consola. Cualquier marca de consola sirve.")));

    // ---------- Diagnóstico ----------
    const dg = h("div", { class: "diag" });
    for (const d of D.diagnostics()) dg.append(h("div", { class: d.ok ? "ok" : "bad" }, `${d.ok ? "✓" : "✗"} ${d.label}`, h("small", {}, " · " + d.detail)));
    if (D.samplerError) dg.append(h("div", { class: "bad" }, "✗ Muestreo de video", h("small", {}, " · " + D.samplerError)));
    wrap.append(fold("diag", "Diagnóstico", !c.enabled ? false : D.diagnostics().some(d => !d.ok), dg));

    // ---------- Avanzado ----------
    wrap.append(fold("adv", "Avanzado", false,
      slider({ label: "Frecuencia de envío", min: 1, max: 44, step: 1, value: c.rate, def: 40, fmt: (v) => v + " fps", onInput: (v) => { c.rate = v; app.changed(); } }),
      field("Sincronía", segmented({ options: [["sync", "SYNC MODE (reloj fijo, admite retardo)"], ["immediate", "Salida inmediata"]], small: true, value: c.mode, onChange: (v) => set(() => { c.mode = v; }) })),
      field("Resolución de muestreo del video", segmented({ options: [[160, "160 px"], [320, "320 px"], [640, "640 px"], [1280, "1280 px"]], small: true, value: c.sampleRes, onChange: (v) => set(() => { c.sampleRes = +v; }) })),
      toggle({ label: "El apagón general también apaga las luces", value: c.followBlackout, onChange: (v) => set(() => { c.followBlackout = v; }) }),
      toggle({ label: "Buscar nodos Art-Net automáticamente", value: c.discovery, onChange: (v) => set(() => { c.discovery = v; }) })));

    D.onUpdate = (t) => { if (S.tab === "lights" && (t === "nodes" || t === "ready") && !document.activeElement?.closest?.("#panelBody")) app.renderPanel(); };
    return wrap;
  },
};

function patchSummary(D, pm) {
  const { patch, lastUniverse } = D.patchOf(pm);
  const ok = patch.filter(Boolean), lost = patch.length - ok.length;
  if (!ok.length) return "Sin canales asignados.";
  const last = ok.at(-1), k = channelsPerPixel(pm.colorOrder);
  return `Píxel 1 → universo ${ok[0].universe} canal ${ok[0].channel} · último píxel → universo ${last.universe} canal ${last.channel}-${last.channel + k - 1} · ${lastUniverse - ok[0].universe + 1} universo(s)` + (lost ? ` · ⚠ ${lost} píxeles sin sitio (activa AUTO SPAN)` : "");
}

function saveUserFixtures() {
  try { localStorage.setItem("lumamap:fixtures", JSON.stringify(Object.fromEntries(Object.entries(FIXTURE_TYPES).filter(([k]) => k.startsWith("user:"))))); } catch {}
}
try { Object.assign(FIXTURE_TYPES, JSON.parse(localStorage.getItem("lumamap:fixtures") || "{}")); } catch {}

export const DMX_PANELS = { lights };
export const DMX_TABS = [{ id: "lights", label: "Luces", ic: "light", pro: true }];
