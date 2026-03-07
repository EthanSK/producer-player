import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appDirectory = resolve(scriptDirectory, '..');
const outputDirectory = resolve(appDirectory, 'dist');

await build({
  entryPoints: [resolve(appDirectory, 'src/main.ts'), resolve(appDirectory, 'src/preload.ts')],
  outdir: outputDirectory,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: ['node20'],
  sourcemap: true,
  external: ['electron'],
  outExtension: {
    '.js': '.cjs',
  },
  logLevel: 'info',
});
