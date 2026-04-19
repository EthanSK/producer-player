// Build a standalone CJS bundle of state-service.ts for unit tests.
// Skips `electron-log` (electron-only) with a tiny shim so Node can
// require the bundle without needing the Electron runtime.
import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, '..');

const shimElectronLog = {
  name: 'shim-electron-log',
  setup(b) {
    b.onResolve({ filter: /^electron-log(\/main)?$/ }, (args) => ({
      path: args.path,
      namespace: 'electron-log-shim',
    }));
    b.onLoad({ filter: /.*/, namespace: 'electron-log-shim' }, () => ({
      contents: `module.exports = { default: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }, info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };`,
      loader: 'js',
    }));
  },
};

await build({
  entryPoints: [resolve(appDir, 'src/state-service.ts')],
  outfile: resolve(appDir, 'dist/state-service.test.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: ['node20'],
  sourcemap: 'inline',
  logLevel: 'warning',
  plugins: [shimElectronLog],
});

// v3.39 Phase 1a — bundle plugin-host-service for unit tests as well. Shares
// the same electron-log shim so Node can require the bundle headlessly.
await build({
  entryPoints: [resolve(appDir, 'src/plugin-host-service.ts')],
  outfile: resolve(appDir, 'dist/plugin-host-service.test.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: ['node20'],
  sourcemap: 'inline',
  logLevel: 'warning',
  external: ['node:child_process', 'node:fs', 'node:path'],
  plugins: [shimElectronLog],
});

console.info('[producer-player/electron] Built dist/state-service.test.cjs + dist/plugin-host-service.test.cjs');
