// Build a standalone CJS bundle of state-service.ts for unit tests.
// Skips `electron-log` (electron-only) with a tiny shim so Node can
// require the bundle without needing the Electron runtime.
import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, '..');

await build({
  entryPoints: [resolve(appDir, 'src/state-service.ts')],
  outfile: resolve(appDir, 'dist/state-service.test.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: ['node20'],
  sourcemap: 'inline',
  logLevel: 'warning',
  plugins: [
    {
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
    },
  ],
});

console.info('[producer-player/electron] Built dist/state-service.test.cjs');
