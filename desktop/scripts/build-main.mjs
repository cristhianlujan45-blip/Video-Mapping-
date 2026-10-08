// Bundles the Electron main process, preload and utility processes (CommonJS for Node).
import { build } from 'esbuild';

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  external: ['electron'],
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': '"production"' },
};

await Promise.all([
  build({ ...common, entryPoints: ['src/main/index.ts'], outfile: 'dist/main/index.js' }),
  build({ ...common, entryPoints: ['src/utility/dmxProcess.ts'], outfile: 'dist/main/dmxProcess.js' }),
  build({ ...common, entryPoints: ['src/utility/netProcess.ts'], outfile: 'dist/main/netProcess.js' }),
  build({ ...common, entryPoints: ['src/preload/index.ts'], outfile: 'dist/preload/index.js' }),
]);
