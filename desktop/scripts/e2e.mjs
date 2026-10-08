// End-to-end smoke test: launches the real Electron app (under xvfb on Linux CI),
// checks the GPU worker renders, creates scenes/outputs and saves a screenshot.
import { _electron as electron } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'test-results');
mkdirSync(outDir, { recursive: true });
const userData = resolve(os.tmpdir(), `lujan-e2e-${Date.now()}`);

const app = await electron.launch({
  args: [root, `--user-data-dir=${userData}`, '--enable-unsafe-swiftshader', '--no-sandbox'],
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
  timeout: 60000,
});
const logs = [];
const win = await app.firstWindow();
win.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
win.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const results = {};
try {
  await win.waitForFunction(() => document.querySelector('.topbar'), null, { timeout: 30000 });
  // wait for stats from the render worker
  await win.waitForFunction(() => document.querySelector('.statusbar')?.textContent?.includes('GPU'), null, { timeout: 20000 });
  results.title = await win.title();
  const script = process.argv[2];
  if (script) {
    const mod = await import(resolve(script));
    Object.assign(results, await mod.default({ app, win, outDir }));
  }
  await win.waitForTimeout(1500);
  await win.screenshot({ path: resolve(outDir, 'main.png') });
  results.status = await win.evaluate(() => document.querySelector('.statusbar')?.textContent);
  results.topbar = await win.evaluate(() => document.querySelector('.topbar')?.textContent);
} catch (e) {
  results.error = String(e?.stack ?? e);
  await win.screenshot({ path: resolve(outDir, 'error.png') }).catch(() => {});
} finally {
  writeFileSync(resolve(outDir, 'logs.txt'), logs.join('\n'));
  writeFileSync(resolve(outDir, 'results.json'), JSON.stringify(results, null, 1));
  console.log(JSON.stringify(results, null, 1));
  await app.close().catch(() => {});
}
process.exit(results.error ? 1 : 0);
