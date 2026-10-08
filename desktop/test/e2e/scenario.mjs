// Full end-to-end scenario against the real built app (Electron + GPU worker + utility processes).
import dgram from 'node:dgram';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function scenario({ app, win, outDir }) {
  const R = {};
  const ev = (fn, arg) => win.evaluate(fn, arg);

  // dismiss first-run modal
  await win.locator('.modal .btn').first().click({ timeout: 15000 }).catch(() => {});

  // average color of a DOM element region, captured by the compositor in the main process
  const regionColor = async (selector, inset = 0.15) => {
    const rect = await win.evaluate(([sel, ins]) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x + r.width * ins), y: Math.round(r.y + r.height * ins), width: Math.round(r.width * (1 - 2 * ins)), height: Math.round(r.height * (1 - 2 * ins)) };
    }, [selector, inset]);
    if (!rect) return null;
    return app.evaluate(async ({ BrowserWindow }, rc) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.getTitle().includes('LUJAN MAPPING Studio')) ?? BrowserWindow.getAllWindows()[0];
      const img = await w.webContents.capturePage(rc);
      const bmp = img.toBitmap();
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < bmp.length; i += 16) { b += bmp[i]; g += bmp[i + 1]; r += bmp[i + 2]; n++; }
      return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
    }, rect);
  };

  // ---------------------------------------------------------- VJ: layers, effects, transition
  await ev(() => { window.__show.setMode('pro'); });
  await win.locator('.nav button', { hasText: 'VJ' }).click();
  await ev(() => {
    const s = window.__show;
    const comp = s.project.compositions[0];
    s.update((p) => ({ ...p, compositions: p.compositions.map((c) => c.id !== comp.id ? c : { ...c, layers: [
      { ...structuredClone(c.layers[0] ?? {}), id: 'l_test', name: 'Test', visible: true, locked: false, source: { type: 'testpattern' }, opacity: 1, blend: 'normal', transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 }, crop: { l: 0, t: 0, r: 1, b: 1 }, flipH: false, flipV: false, masks: [], effects: [], playback: { mode: 'loop', speed: 1, volume: 1, muted: true, inPoint: 0, outPoint: null }, attach: null },
    ] }) }));
  });
  await sleep(1500);
  R.programTestPattern = await regionColor('.view-label.program');
  // second scene: solid red, then a 600 ms fade
  await ev(() => {
    const s = window.__show;
    const id = s.newScene('Rojo');
    s.update((p) => ({ ...p, compositions: p.compositions.map((c) => c.id !== id ? c : { ...c, layers: [{ id: 'l_red', name: 'Rojo', visible: true, locked: false, source: { type: 'solid', color: '#ff0000' }, opacity: 1, blend: 'normal', transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 }, crop: { l: 0, t: 0, r: 1, b: 1 }, flipH: false, flipV: false, masks: [], effects: [], playback: { mode: 'loop', speed: 1, volume: 1, muted: true, inPoint: 0, outPoint: null }, attach: null }] }) }));
    s.goScene(id, { kind: 'fade', durationMs: 600 });
  });
  await sleep(1500);
  R.programAfterFadeToRed = await regionColor('.view-label.program');
  // effects chain on the red layer
  await ev(() => {
    const s = window.__show;
    for (const k of ['glow', 'blur', 'feedback', 'glitch', 'kaleidoscope', 'rgbSplit', 'pixelate', 'trails', 'color']) s.addEffect('layer', 'l_red', k);
  });
  await sleep(1500);
  R.effectsFps = await ev(() => window.__show.render.stats?.fps);
  R.renderErrors = await ev(() => window.__show.render.lastError);
  await win.screenshot({ path: path.join(outDir, 'vj.png') });

  // ---------------------------------------------------------- outputs + 2D mapping
  const displays = await ev(() => window.__show.outputs.displays);
  R.displays = displays.length;
  await ev((d) => {
    const s = window.__show;
    s.update((p) => ({ ...p, outputs: [...p.outputs, { id: 'out1', name: 'Proyector test', enabled: true, kind: 'display', displayId: d.id, fullscreen: true, width: 1280, height: 720, fps: 60, mode: '2d',
      surfaces: [{ id: 'surf1', name: 'Quad', visible: true, locked: false, source: { type: 'composition', compId: 'program' }, region: { x: 0, y: 0, w: 1, h: 1 }, kind: 'quad',
        quad: [{ x: 0.25, y: 0.25 }, { x: 0.75, y: 0.2 }, { x: 0.7, y: 0.8 }, { x: 0.3, y: 0.75 }], mesh: null, polygon: null, masks: [], softEdge: { left: 0, right: 0, top: 0, bottom: 0, gamma: 2.2 }, opacity: 1, blend: 'normal', color: { brightness: 0, contrast: 1, gamma: 1, red: 1, green: 1, blue: 1 }, effects: [] }],
      projectorId: null, finalWarp: null, masks: [], softEdge: { left: 0, right: 0, top: 0, bottom: 0, gamma: 2.2 }, color: { brightness: 0, contrast: 1, gamma: 1, red: 1, green: 1, blue: 1 }, showTestPattern: false, identify: false }] }));
    s.setLive(true);
  }, displays[0]);
  await sleep(2500);
  const outWin = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.getTitle().startsWith('Proyector test') || x.getTitle().startsWith('Salida'));
    if (!w) return { open: false, titles: BrowserWindow.getAllWindows().map((x) => x.getTitle()) };
    const img = await w.webContents.capturePage();
    const size = img.getSize();
    const bmp = img.toBitmap();
    const px = (fx, fy) => { const x = Math.floor(fx * size.width), y = Math.floor(fy * size.height); const i = (y * size.width + x) * 4; return [bmp[i + 2], bmp[i + 1], bmp[i]]; };
    return { open: true, size, center: px(0.5, 0.5), corner: px(0.05, 0.05), insideQuad: px(0.5, 0.3) };
  });
  R.outputWindow = outWin;
  await win.locator('.nav button', { hasText: 'Mapping' }).click();
  await sleep(800);
  await win.screenshot({ path: path.join(outDir, 'mapping.png') });

  // ---------------------------------------------------------- 3D: cube + projector → virtual output in 3D mode
  await ev(() => {
    const s = window.__show;
    s.update((p) => ({ ...p,
      stage: { ...p.stage, objects: [{ id: 'cube1', name: 'Cubo', kind: 'cube', position: [0, 0.5, 0], rotation: [0, 30, 0], scale: [1, 1, 1], visible: true, locked: false, faces: { all: { source: { type: 'testpattern' }, opacity: 1, tint: '#ffffff', projectFrom: null }, front: { source: { type: 'solid', color: '#00ff00' }, opacity: 1, tint: '#ffffff', projectFrom: null } } }],
        projectors: [{ id: 'pj1', name: 'Proyector 1', position: [0, 1, 4], rotation: [-5, 0, 0], fov: 35, near: 0.1, far: 50, shiftX: 0, shiftY: 0, outputId: 'out3d', width: 1280, height: 720, color: '#ffcc33' }] },
      outputs: [...p.outputs, { ...structuredClone(p.outputs[0]), id: 'out3d', name: 'Virtual 3D', kind: 'virtual', displayId: null, mode: '3d', projectorId: 'pj1', surfaces: [] }] }));
    s.ui.selectedObject = 'cube1';
  });
  await win.locator('.nav button', { hasText: '3D' }).click();
  await sleep(2000);
  await win.screenshot({ path: path.join(outDir, 'stage3d.png') });
  R.projectorViewColor = await regionColor('.view:nth-of-type(2)', 0.3);

  // ---------------------------------------------------------- DMX / Art-Net to a fake node on loopback
  const node = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  const packets = [];
  node.on('message', (b) => { if (b.toString('latin1', 0, 7) === 'Art-Net' && b[9] === 0x50) packets.push({ uni: b[14] | (b[15] << 8), data: b.subarray(18) }); });
  await new Promise((r) => node.bind(6454, '127.0.0.1', r));
  await ev(async () => {
    const s = window.__show;
    s.interfaces = await window.lujan.invoke('app:interfaces');
    const lo = s.interfaces.find((i) => i.address === '127.0.0.1');
    s.update((p) => ({ ...p, dmx: { ...p.dmx, interfaceName: lo.name, interfaceAddress: lo.address,
      universes: [{ id: 'u1', name: 'U1', protocol: 'artnet', number: 0, destination: { mode: 'unicast', ip: '127.0.0.1' }, enabled: true, delayMs: 0, priority: 100 }],
      pixelMaps: [{ id: 'pm1', name: 'LED', enabled: true, layout: 'grid', cols: 4, rows: 2, x: 0, y: 0, w: 1, h: 1, startAngle: 0, endAngle: 360, custom: [], order: 'serpentine', reverse: false, startCorner: 'tl', format: 'RGB', universeId: 'u1', startChannel: 1, autoSpan: true, alignPixels: true, pixelsPerUniverse: 0, source: { type: 'composition', compId: 'program' }, sampling: 'area', sampleSize: 0.5, brightness: 1, gamma: 1, saturation: 1, contrast: 1, whiteExtraction: false }] } }));
    // remove effects so the program is pure red again
    s.update((p) => ({ ...p, compositions: p.compositions.map((c) => ({ ...c, layers: c.layers.map((l) => ({ ...l, effects: [] })) })) }));
  });
  await sleep(2500);
  const last = packets[packets.length - 1];
  R.artnet = { packets: packets.length, firstPixel: last ? [...last.data.subarray(0, 6)] : null };
  await ev(() => window.__show.setParam('show.blackout', 1));
  await sleep(700);
  const lastBo = packets[packets.length - 1];
  R.artnetBlackout = lastBo ? [...lastBo.data.subarray(0, 6)] : null;
  R.outputDuringBlackout = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.getTitle().startsWith('Proyector test'));
    if (!w) return null;
    const img = await w.webContents.capturePage();
    const bmp = img.toBitmap();
    let m = 0;
    for (let i = 0; i < bmp.length; i += 4) m = Math.max(m, bmp[i], bmp[i + 1], bmp[i + 2]);
    return { maxChannel: m };
  });
  await ev(() => window.__show.setParam('show.blackout', 0));
  node.close();

  // ---------------------------------------------------------- OSC in
  await ev(() => window.__show.update((p) => ({ ...p, osc: { ...p.osc, enabled: true, inPort: 9123 } })));
  await sleep(800);
  const osc = dgram.createSocket('udp4');
  const pad = (b) => Buffer.concat([b, Buffer.alloc(4 - (b.length % 4))]);
  const msg = Buffer.concat([pad(Buffer.from('/lujan/param/master.brightness')), pad(Buffer.from(',f')), (() => { const f = Buffer.alloc(4); f.writeFloatBE(0.42); return f; })()]);
  await new Promise((r) => osc.send(msg, 9123, '127.0.0.1', r));
  osc.close();
  await sleep(500);
  R.oscMasterBrightness = await ev(() => window.__show.engine.value('master.brightness'));

  // ---------------------------------------------------------- remote web control
  await ev(() => window.__show.update((p) => ({ ...p, remote: { ...p.remote, enabled: true, port: 8799, pin: '246810' } })));
  await sleep(1000);
  const html = await fetch('http://127.0.0.1:8799/').then((r) => r.text()).catch((e) => String(e));
  R.remotePageServed = html.includes('LUJAN Remote');
  R.remote = await new Promise((resolve) => {
    const ws = new WebSocket('ws://127.0.0.1:8799/ws');
    const out = { auth: null, scenes: 0 };
    ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', pin: '246810' })));
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === 'auth') { out.auth = m.ok; ws.send(JSON.stringify({ type: 'command', command: { cmd: 'blackout', on: true } })); }
      if (m.type === 'state') out.scenes = m.state.scenes.length;
    });
    setTimeout(() => { ws.close(); resolve(out); }, 1500);
  });
  R.blackoutFromRemote = await ev(() => window.__show.engine.value('show.blackout'));
  await ev(() => window.__show.setParam('show.blackout', 0));

  // ---------------------------------------------------------- drawing stroke on the GPU
  await ev(() => {
    const s = window.__show;
    const comp = s.project.compositions.find((c) => c.id === s.project.mixer.deckA);
    s.update((p) => ({ ...p, drawings: [{ id: 'd1', name: 'Dibujo', width: 1920, height: 1080, strokes: [] }], compositions: p.compositions.map((c) => c.id !== comp.id ? c : { ...c, layers: [...c.layers, { ...c.layers[0], id: 'l_draw', name: 'Dibujo', source: { type: 'drawing', drawingId: 'd1' }, effects: [] }] }) }));
    const pts = [];
    for (let i = 0; i <= 50; i++) pts.push(0.2 + i * 0.012, 0.5, 1, i * 16);
    s.render.send({ type: 'stroke', stroke: { layerId: 'd1', brush: { id: 'marker', name: 'm', category: 'Plumas', tip: 0, size: 120, hardness: 1, opacity: 1, flow: 1, spacing: 0.1, scatter: 0, grain: 0, additive: false, followAngle: false, angle: 0, aspect: 1, density: 1, hueCycle: 0, drips: 0, pressureSize: false, pressureOpacity: false, velocitySize: 0, smoothing: 0, glow: 0, color: [0, 0, 1], erase: false }, points: new Float32Array(pts), start: true, end: true, strokeId: 7 } });
  });
  await win.locator('.nav button', { hasText: 'VJ' }).click();
  await sleep(1200);
  R.programWithBlueStroke = await regionColor('.view-label.program', 0.45);

  // ---------------------------------------------------------- export (WebCodecs → MP4 on disk)
  const exportPath = path.join(os.tmpdir(), `lujan-export-${Date.now()}.mp4`);
  R.export = await ev(async (file) => {
    const s = window.__show;
    const id = await window.lujan.invoke('export:open', file);
    let error = null, frames = 0, done = false;
    let chain = Promise.resolve();
    const off = s.render.on((m) => {
      if (m.type === 'exportChunk' && m.id === 999) chain = chain.then(() => window.lujan.invoke('export:write', id, m.data, m.position));
      if (m.type === 'exportProgress' && m.id === 999) { frames = m.frames; error = m.error ?? null; done = m.done; }
    });
    s.render.send({ type: 'exportStart', id: 999, target: { kind: 'program' }, width: 640, height: 360, fps: 30, codec: 'avc', bitrate: 4e6, durationSec: 2 });
    for (let i = 0; i < 100 && !done; i++) await new Promise((r) => setTimeout(r, 100));
    await chain;
    await window.lujan.invoke('export:close', id);
    off();
    return { frames, error, done };
  }, exportPath);
  if (fs.existsSync(exportPath)) {
    const buf = fs.readFileSync(exportPath);
    R.export.bytes = buf.length;
    R.export.ftyp = buf.toString('latin1', 4, 8);
    fs.copyFileSync(exportPath, path.join(outDir, 'export.mp4'));
  }

  // ---------------------------------------------------------- save / reopen
  const projFile = path.join(os.tmpdir(), `lujan-e2e-${Date.now()}`, 'Show', 'Show.lujanshow');
  R.saved = await ev(async (file) => {
    const s = window.__show;
    const { serializeProject } = { serializeProject: (p) => JSON.stringify({ ...p, format: 'lujan-studio-project', version: 1 }) };
    return window.lujan.invoke('project:save', file, 'Show', serializeProject(s.snapshotProject()));
  }, projFile);
  R.savedStructure = fs.existsSync(path.join(path.dirname(projFile), 'Media', 'Videos')) && fs.existsSync(path.join(path.dirname(projFile), 'Backups'));
  await ev(async (file) => { await window.__show.open(file); }, projFile);
  await sleep(800);
  R.reopened = await ev(() => ({ comps: window.__show.project.compositions.length, outputs: window.__show.project.outputs.length, objects: window.__show.project.stage.objects.length, pixelMaps: window.__show.project.dmx.pixelMaps.length }));

  // ---------------------------------------------------------- stress: layers + effects + outputs
  await ev(() => {
    const s = window.__show;
    const comp = s.project.compositions.find((c) => c.id === s.project.mixer.deckA);
    const gens = ['plasma', 'tunnel', 'noise', 'particles'];
    s.update((p) => ({ ...p, compositions: p.compositions.map((c) => c.id !== comp.id ? c : { ...c, layers: [...c.layers, ...gens.map((g, i) => ({ ...c.layers[0], id: `gen${i}`, name: g, source: { type: 'generator', generator: g, colorA: '#19c3ff', colorB: '#ff2d95' }, opacity: 0.6, blend: 'add', effects: [] }))] }) }));
    for (let i = 0; i < 4; i++) for (const k of ['glow', 'blur', 'feedback', 'glitch']) s.addEffect('layer', `gen${i}`, k);
    s.update((p) => ({ ...p, outputs: [...p.outputs, ...[2, 3].map((n) => ({ ...structuredClone(p.outputs[0]), id: `vout${n}`, name: `Virtual ${n}`, kind: 'virtual', displayId: null }))] }));
  });
  await win.locator('.nav button', { hasText: 'Mapping' }).click();
  await sleep(4000);
  R.stress = await ev(() => window.__show.render.stats);
  await win.locator('.nav button', { hasText: 'Rendim' }).click();
  await sleep(2500);
  await win.screenshot({ path: path.join(outDir, 'performance.png') });
  await ev(() => window.__show.setLive(false));
  return R;
}
