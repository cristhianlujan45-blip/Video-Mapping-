// Bundles the renderer (UI, render worker, tracking worker, remote web app) with esbuild
// and copies static assets (HTML, worklets, MediaPipe WASM, tracking models).
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, 'src/renderer');
const out = resolve(root, 'dist/renderer');
const prod = !process.argv.includes('--dev');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const common = {
  bundle: true,
  minify: prod,
  sourcemap: 'linked',
  target: ['chrome130'],
  logLevel: 'warning',
  define: { 'process.env.NODE_ENV': prod ? '"production"' : '"development"' },
  legalComments: 'none',
};

await Promise.all([
  build({ ...common, entryPoints: { main: resolve(src, 'main.tsx') }, outdir: out, format: 'esm', jsx: 'automatic', loader: { '.css': 'css' } }),
  build({ ...common, entryPoints: { render: resolve(src, 'worker/render.worker.ts') }, outdir: resolve(out, 'workers'), format: 'iife' }),
  build({ ...common, entryPoints: { tracking: resolve(src, 'tracking/tracking.worker.ts') }, outdir: resolve(out, 'workers'), format: 'iife' }),
  build({ ...common, entryPoints: { remote: resolve(src, 'remote/remote.ts') }, outdir: resolve(out, 'remote'), format: 'iife' }),
]);

for (const f of ['index.html', 'output.html']) cpSync(resolve(src, f), resolve(out, f));
cpSync(resolve(src, 'remote/index.html'), resolve(out, 'remote/index.html'));
if (existsSync(resolve(src, 'remote/manifest.webmanifest'))) cpSync(resolve(src, 'remote/manifest.webmanifest'), resolve(out, 'remote/manifest.webmanifest'));
cpSync(resolve(src, 'public'), out, { recursive: true });
cpSync(resolve(root, 'node_modules/@mediapipe/tasks-vision/wasm'), resolve(out, 'mediapipe/wasm'), { recursive: true });
const models = resolve(root, 'resources/models');
if (existsSync(models)) cpSync(models, resolve(out, 'models'), { recursive: true });
else console.warn('AVISO: resources/models no existe; ejecuta "npm run fetch-models" para el tracking.');
console.log('renderer listo en', out);
