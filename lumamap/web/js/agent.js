// web/js/agent.js
// Lo que hace LumaMap cuando un agente de IA (Claude Code, Cursor…) usa sus herramientas por MCP
// (server/mcp.js → servidor local → esta página). Todo pasa por las mismas reglas que la
// interfaz: los planes y parámetros se validan (td/build.js), cada cambio se puede deshacer y,
// si el editor de redes está abierto, se ve al momento.
import { TOOL_NAMES } from "./agent-tools.js";
import { newNetwork, nodeById, nodeByName, addNode, connect as wire, removeNodes, uniqueName } from "./td/graph.js";
import { OP_LIST, opDef, FAMILIES } from "./td/ops.js";
import { MOVERS, moveExpr, mainParam } from "./td/easy.js";
import * as B from "./td/build.js";
import { FX_LIBRARY, FX_CATEGORIES, DEFAULT_FX, ANIM_LIBRARY } from "./model.js";
import { FX_RANGE } from "./params.js";

const strip = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const fail = (msg) => { throw new Error(msg); };
const nets = (app) => app.S.project.networks ||= [];
let lastNetId = null;

/** La red pedida (nombre o id), la última usada o una nueva. */
function netOf(app, ref, { create = true, fresh = false } = {}) {
  if (fresh) { let n; app.edit(() => { n = newNetwork(`Red ${nets(app).length + 1}`); nets(app).push(n); }); lastNetId = n.id; return n; }
  const list = nets(app);
  let n = ref ? list.find(x => x.id === ref) || list.find(x => strip(x.name) === strip(ref)) : null;
  if (ref && !n) fail(`No hay ninguna red «${ref}». Redes: ${list.map(x => x.name).join(", ") || "(ninguna)"}`);
  n ||= list.find(x => x.id === lastNetId) || list.at(-1);
  if (!n && create) return netOf(app, null, { fresh: true });
  if (!n) fail("Todavía no hay redes de nodos");
  lastNetId = n.id;
  return n;
}
function nodeOf(net, ref) {
  const n = nodeById(net, ref) || nodeByName(net, ref) || net.nodes.find(x => strip(x.name) === strip(ref));
  return n || fail(`No hay ningún nodo «${ref}» en «${net.name}». Nodos: ${net.nodes.map(x => x.name).join(", ") || "(ninguno)"}`);
}
function surfOf(app, ref) {
  const list = app.S.project.surfaces;
  if (ref) return list.find(s => s.id === ref) || list.find(s => strip(s.name) === strip(ref)) || fail(`No hay ninguna superficie «${ref}». Superficies: ${list.map(s => s.name).join(", ")}`);
  return list.find(s => s.id === app.S.sel) || list[0] || null;
}
/** Una superficie para mostrar algo: la pedida, la elegida o una nueva. */
function targetSurface(app, ref) {
  let s = surfOf(app, ref);
  if (!s) { app.actions.addShape("rect"); s = surfOf(app, null); }
  if (app.S.sel !== s.id) app.select(s.id);
  return s;
}
async function refresh(app, net) {
  try { (await import("./panels-network.js")).refreshNetworkEditor(net?.id); } catch {}
  app.changed?.({ panel: true });
}
const errorOf = (app, net, n) => { try { return app.td?.info(net, n)?.error || ""; } catch { return ""; } };

/** Un nodo contado para el agente (lo que cambió de sus parámetros, sus entradas). */
function describeNode(app, net, n) {
  const d = opDef(n.fam, n.type), p = {};
  for (const q of d?.params || []) { const v = n.p[q.k]; if (v !== undefined && JSON.stringify(v) !== JSON.stringify(q.def)) p[q.k] = v; }
  const r = { name: n.name, op: `${n.fam}/${n.type}`, label: d?.label, inputs: n.in.map(id => id ? nodeById(net, id)?.name || null : null).filter((x, i, a) => x || a.slice(i).some(Boolean)), params: p };
  if (n.bypass) r.bypass = true;
  const e = errorOf(app, net, n); if (e) r.error = e;
  return r;
}

const HANDLERS = {
  lumamap_status(app) {
    const P = app.S.project, sc = app.scene?.();
    const src = (l) => { const s = l?.source || {}; return s.type === "gen" ? `animación ${s.gen}` : s.type === "net" ? `red ${nets(app).find(n => n.id === s.netId)?.name || "?"}` : s.type || "nada"; };
    let ai = null; try { ai = app.ai?.statusLine?.().text || null; } catch {}
    return {
      project: P.name, size: `${P.width}×${P.height}`, playing: !!app.S.playing,
      surfaces: P.surfaces.map(s => ({ id: s.id, name: s.name, shows: src(sc?.looks[s.id]), selected: s.id === app.S.sel })),
      scenes: P.scenes.map((s, i) => ({ number: i + 1, name: s.name, current: s.id === P.sceneId })),
      networks: nets(app).map(n => ({ id: n.id, name: n.name, nodes: n.nodes.length })),
      ai: ai || "sin IA (el planificador propio entiende frases sencillas)",
      tips: "Construye con build_from_text (una frase) o apply_plan (tu plan JSON), comprueba con get_image y proyecta con project_network.",
    };
  },
  list_operators(app, { family, query }) {
    const q = strip(query);
    const list = OP_LIST.filter(d => (!family || d.fam === String(family).toUpperCase()) && (!q || strip(d.type + " " + d.label + " " + (d.desc || "")).includes(q)));
    return { families: Object.fromEntries(Object.entries(FAMILIES).map(([k, f]) => [k, f.desc])),
      operators: list.map(d => ({ op: `${d.fam}/${d.type}`, label: d.label, desc: d.desc || "", inputs: d.inputs,
        params: d.params.filter(p => !p.hidden && !["code", "py", "media", "cam", "shader", "model", "audiofile", "anim", "learn", "param"].includes(p.type))
          .map(p => ({ k: p.k, label: p.label, type: p.type, ...(p.min != null ? { min: p.min } : {}), ...(p.max != null ? { max: p.max } : {}), def: p.def, ...(p.opts ? { opts: p.opts } : {}) })) })) };
  },
  get_network(app, { network }) {
    const net = netOf(app, network, { create: false });
    return { id: net.id, name: net.name, display: nodeById(net, net.display)?.name || null, nodes: net.nodes.map(n => describeNode(app, net, n)) };
  },
  async build_from_text(app, { text, network, new_network }) {
    if (!String(text || "").trim()) fail("Falta el texto");
    const net = netOf(app, network, { fresh: !!new_network });
    let r;
    try { const { aiOf } = await import("./panels-assistant.js"); r = await aiOf(app).buildNetwork(String(text), B.netSummary(net)); }
    catch { r = { ...B.validatePlan(B.planFromText(String(text))), source: "Sin IA", fallback: true }; }
    const had = new Set(net.nodes.map(n => n.id));
    app.edit(() => { B.applyPlan(net, r.plan, { origin: B.freeOrigin(net), parent: "" }); });
    const created = net.nodes.filter(n => !had.has(n.id)).map(n => n.name);
    await refresh(app, net);
    return { network: net.name, title: r.plan.title, say: r.plan.say, built_by: r.fallback ? "planificador sin IA" : r.source, created, warnings: r.warnings || [] };
  },
  async apply_plan(app, { plan, network, new_network }) {
    const { plan: p, warnings } = B.validatePlan(plan);
    if (!p.nodes.length) fail("El plan no tiene ningún nodo válido: " + warnings.join("; "));
    const net = netOf(app, network, { fresh: !!new_network });
    const had = new Set(net.nodes.map(n => n.id));
    app.edit(() => { B.applyPlan(net, p, { origin: B.freeOrigin(net), parent: "" }); });
    const created = net.nodes.filter(n => !had.has(n.id)).map(n => n.name);
    await refresh(app, net);
    return { network: net.name, created, warnings, nodes: net.nodes.filter(n => created.includes(n.name)).map(n => describeNode(app, net, n)) };
  },
  async create_node(app, { op, name, params, after, network }) {
    const r = B.resolveOp(op) || fail(`No existe el operador «${op}» (mira list_operators)`);
    const net = netOf(app, network);
    const prev = after ? nodeOf(net, after) : null;
    const { p, warnings } = B.cleanParams(r.fam, r.type, params, new Set(net.nodes.map(n => n.name)));
    let n, why = "";
    app.edit(() => {
      const [x, y] = prev ? [prev.x + 210, prev.y] : B.freeOrigin(net);
      n = addNode(net, r.fam, r.type, { x, y, p, name: name && !nodeByName(net, name) ? uniqueName(net, String(name).replace(/[^\w]/g, "")) : "" });
      if (prev) why = wire(net, prev.id, n.id, 0);
      if (r.type === "out") net.display = n.id;
    });
    await refresh(app, net);
    return { created: describeNode(app, net, n), warnings: why ? [...warnings, why] : warnings };
  },
  async connect(app, { from, to, input = 0, network }) {
    const net = netOf(app, network, { create: false }), a = nodeOf(net, from), b = nodeOf(net, to);
    let why = "";
    app.edit(() => { why = wire(net, a.id, b.id, Math.max(0, Math.round(+input || 0))); });
    if (why) fail(why);
    await refresh(app, net);
    return { ok: true, node: describeNode(app, net, b) };
  },
  async set_params(app, { node, params, network }) {
    const net = netOf(app, network, { create: false }), n = nodeOf(net, node);
    const { p, warnings } = B.cleanParams(n.fam, n.type, params, new Set(net.nodes.map(x => x.name)));
    if (!Object.keys(p).length) fail("Ningún parámetro válido: " + warnings.join("; "));
    app.edit(() => { Object.assign(n.p, p); });
    await refresh(app, net);
    return { node: describeNode(app, net, n), warnings };
  },
  async move_with(app, { node, param, with: w, range, network }) {
    const net = netOf(app, network, { create: false }), n = nodeOf(net, node);
    const mv = MOVERS.find(m => m.key === w) || fail("with: music, beat, wave, random, hand o motion");
    const d = opDef(n.fam, n.type), q = param ? d.params.find(x => x.k === param && (x.type === "f" || x.type === "i")) : mainParam(n);
    if (!q) fail(`«${param}» no es un número de ${n.name}: ${d.params.filter(x => x.type === "f" || x.type === "i").map(x => x.k).join(", ")}`);
    let chop;
    app.edit(() => {
      chop = net.nodes.find(x => x.fam === "CHOP" && x.type === mv.type && !x.parent) || addNode(net, "CHOP", mv.type, { x: n.x, y: n.y + 200, p: { ...(mv.p || {}) } });
      const ok = Array.isArray(range) && range.length === 2 && range.every(Number.isFinite);
      const cl = (x) => Math.min(q.max ?? Infinity, Math.max(q.min ?? -Infinity, x));
      n.p[q.k] = { e: ok ? `fit(${chop.name}.${mv.chan}, 0, 1, ${cl(range[0])}, ${cl(range[1])})` : moveExpr(chop.name, mv.chan, q) };
    });
    await refresh(app, net);
    return { node: n.name, param: q.k, expression: n.p[q.k].e, driver: chop.name };
  },
  async delete_nodes(app, { nodes, network }) {
    const net = netOf(app, network, { create: false });
    const ids = (Array.isArray(nodes) ? nodes : [nodes]).map(r => nodeOf(net, r).id);
    app.edit(() => { removeNodes(net, ids); });
    await refresh(app, net);
    return { deleted: ids.length, left: net.nodes.map(n => n.name) };
  },
  async project_network(app, { network, node, surface }) {
    const net = netOf(app, network, { create: false });
    const n = node ? nodeOf(net, node) : net.nodes.find(x => x.type === "out" && x.fam === "TOP") || nodeById(net, net.display) || net.nodes.find(x => x.fam === "TOP");
    if (!n || n.fam !== "TOP") fail("La red no tiene imagen (un TOP o una Salida)");
    const s = targetSurface(app, surface);
    app.actions.setSource({ type: "net", netId: net.id, netNode: n.id });
    return { surface: s.name, shows: `${net.name} · ${n.name}` };
  },
  list_effects(app, { category }) {
    const cat = strip(category);
    const presets = FX_LIBRARY.filter(e => !cat || strip(e.cat).includes(cat));
    return { categories: FX_CATEGORIES, presets: presets.map(e => ({ name: e.name, category: e.cat, effects: e.fx })),
      params: Object.fromEntries(Object.entries(FX_RANGE).map(([k, r]) => [k, { label: r[0], min: r[1], max: r[2], default: r[4] }])),
      options: { mirror: ["none", "h", "v", "quad"], filmStock: ["natural", "warm", "tealorange", "bleach", "bw", "cross", "faded"], phosphorType: ["grille", "shadow", "slot", "lcd", "led"], slitDir: ["down", "up", "right", "left", "center"] } };
  },
  set_effects(app, { surface, preset, effects, reset }) {
    const s = targetSurface(app, surface);
    const look = app.lookSel() || fail("Esa superficie no tiene contenido en esta escena");
    const base = reset ? DEFAULT_FX() : { ...look.fx }, D = DEFAULT_FX(), warnings = [];
    if (preset) {
      const e = FX_LIBRARY.find(x => strip(x.name) === strip(preset)) || FX_LIBRARY.find(x => strip(x.name).includes(strip(preset))) || fail(`No hay ningún preset «${preset}» (mira list_effects)`);
      Object.assign(base, reset === false ? e.fx : { ...D, ...e.fx });
    }
    for (const [k, v] of Object.entries(effects || {})) {
      if (!(k in D)) { warnings.push(`no existe el efecto «${k}»`); continue; }
      const r = FX_RANGE[k];
      if (r && typeof D[k] === "number") { const x = +v; if (!Number.isFinite(x)) { warnings.push(`${k}: no es un número`); continue; } base[k] = Math.min(r[2], Math.max(r[1], x)); }
      else if (typeof D[k] === "boolean") base[k] = !!v;
      else if (typeof D[k] === "string") base[k] = String(v).slice(0, 40);
      else if (typeof D[k] === "number") base[k] = +v || 0;
    }
    app.edit(() => { look.fx = base; });
    const changed = Object.fromEntries(Object.entries(base).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(D[k])));
    return { surface: s.name, effects: changed, warnings };
  },
  list_animations(app, { query }) {
    const q = strip(query);
    return { animations: ANIM_LIBRARY.filter(a => !q || strip(a.name + " " + a.cat).includes(q)).map(a => ({ name: a.name, category: a.cat })) };
  },
  set_animation(app, { name, surface }) {
    const a = ANIM_LIBRARY.find(x => strip(x.name) === strip(name)) || ANIM_LIBRARY.find(x => strip(x.name).includes(strip(name))) || fail(`No hay ninguna animación «${name}» (mira list_animations)`);
    const s = targetSurface(app, surface);
    app.actions.setSource({ type: "gen", gen: a.gen, color: a.color, color2: a.color2, speed: a.speed, scale: a.scale });
    if (a.fx) app.edit(() => { const l = app.lookSel(); if (l) l.fx = { ...DEFAULT_FX(), ...a.fx }; });
    return { surface: s.name, shows: a.name };
  },
  go_scene(app, { scene }) {
    const P = app.S.project, k = +scene;
    const sc = (Number.isInteger(k) && P.scenes[k - 1]) || P.scenes.find(s => strip(s.name) === strip(scene)) || fail(`No hay ninguna escena «${scene}». Escenas: ${P.scenes.map(s => s.name).join(", ")}`);
    app.actions.goScene(sc.id);
    return { scene: sc.name };
  },
  async get_image(app, { network, node, height }) {
    const hgt = Math.max(90, Math.min(1080, Math.round(+height || 360)));
    if (node) {
      const td = await app.ensureTd?.();
      if (!td) fail("El motor de redes no está disponible");
      const net = netOf(app, network, { create: false }), n = nodeOf(net, node);
      if (n.fam !== "TOP") fail(`${n.name} no es una imagen (TOP)`);
      const P = app.S.project, w = Math.round(hgt * P.width / P.height);
      const o = td.output(net.id, n.id, { time: performance.now() / 1000, w, h: hgt });
      if (!o?.el) fail("Ese nodo no tiene imagen todavía");
      const c = document.createElement("canvas"); c.width = w; c.height = hgt; c.getContext("2d").drawImage(o.el, 0, 0, w, hgt);
      return { image: c.toDataURL("image/png"), what: `${net.name} · ${n.name}`, error: errorOf(app, net, n) || undefined };
    }
    return { image: app.grabOutput(hgt), what: "la proyección" };
  },
};

/** Hace una herramienta y devuelve su resultado (objeto). Lanza un error claro si algo falla. */
export async function runTool(app, tool, args = {}) {
  if (!TOOL_NAMES.has(tool) || !HANDLERS[tool]) fail(`Herramienta desconocida: ${tool}`);
  return await HANDLERS[tool](app, args && typeof args === "object" ? args : {});
}
