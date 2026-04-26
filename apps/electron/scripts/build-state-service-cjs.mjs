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

// v3.43 Phase 4 — bundle the plugin preset library for hermetic Node tests.
await build({
  entryPoints: [resolve(appDir, 'src/plugin-preset-library.ts')],
  outfile: resolve(appDir, 'dist/plugin-preset-library.test.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: ['node20'],
  sourcemap: 'inline',
  logLevel: 'warning',
  external: ['node:fs/promises', 'node:path'],
  plugins: [shimElectronLog],
});

// App UI zoom helpers are pure and can be unit-tested outside Electron.
await build({
  entryPoints: [resolve(appDir, 'src/ui-zoom.ts')],
  outfile: resolve(appDir, 'dist/ui-zoom.test.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: ['node20'],
  sourcemap: 'inline',
  logLevel: 'warning',
});

// Auto-update signature gate: tiny pure helper; bundle for hermetic Node tests.
await build({
  entryPoints: [resolve(appDir, 'src/auto-update-signature.ts')],
  outfile: resolve(appDir, 'dist/auto-update-signature.test.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: ['node20'],
  sourcemap: 'inline',
  logLevel: 'warning',
});

console.info('[producer-player/electron] Built dist/state-service.test.cjs + dist/plugin-host-service.test.cjs + dist/plugin-preset-library.test.cjs + dist/ui-zoom.test.cjs + dist/auto-update-signature.test.cjs');
