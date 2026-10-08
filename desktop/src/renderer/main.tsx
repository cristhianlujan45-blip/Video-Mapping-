import { createRoot } from 'react-dom/client';
import './styles/app.css';
import { App } from './ui/App';
import { show } from './core/show';
import { logToMain, lujan } from './api';

window.addEventListener('error', (e) => logToMain('ERROR', 'ui', `${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => logToMain('ERROR', 'ui', `Promesa rechazada: ${String(e.reason?.stack ?? e.reason)}`));

const root = createRoot(document.getElementById('root')!);
root.render(<App />);

show
  .start()
  .then(async () => {
    const info = show.info;
    if (info?.selfTest) await runSelfTest();
  })
  .catch((e: Error) => {
    show.fatal = `No se pudo iniciar el motor: ${e.message}`;
    show.emit();
    logToMain('ERROR', 'ui', show.fatal);
  });

/** Post-install verification (installer runs the app with --self-test). */
async function runSelfTest() {
  const checks: { name: string; ok: boolean; detail?: string }[] = [];
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 50 && !show.render.info; i++) await wait(100);
  checks.push({ name: 'GPU / WebGL2', ok: !!show.render.info, detail: show.render.info ? `${show.render.info.renderer} (máx. textura ${show.render.info.maxTexture})` : show.render.lastError ?? 'sin respuesta del motor de render' });
  for (let i = 0; i < 30 && !show.render.stats; i++) await wait(100);
  checks.push({ name: 'Bucle de render', ok: !!show.render.stats, detail: show.render.stats ? `${show.render.stats.fps} fps` : 'sin estadísticas' });
  for (let i = 0; i < 30 && !show.dmx.connected; i++) await wait(100);
  checks.push({ name: 'Servicio DMX', ok: show.dmx.connected });
  checks.push({ name: 'Servicio de red', ok: !!show.net });
  checks.push({ name: 'Parameter Engine', ok: show.engine.list().length > 10, detail: `${show.engine.list().length} parámetros` });
  await lujan?.invoke('app:selftest-result', { ok: checks.every((c) => c.ok), checks });
}
