import { build } from 'esbuild';
import ffmpegStatic from 'ffmpeg-static';
import { cp, mkdir, rm } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appDirectory = resolve(scriptDirectory, '..');
const outputDirectory = resolve(appDirectory, 'dist');
const binaryOutputDirectory = resolve(outputDirectory, 'bin');

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

await rm(binaryOutputDirectory, { recursive: true, force: true });

const shouldBundleFfmpeg = process.env.PRODUCER_PLAYER_SKIP_BUNDLED_FFMPEG !== 'true';

if (!shouldBundleFfmpeg) {
  console.info('[producer-player/electron] Skipping bundled ffmpeg binary for this build target.');
} else {
  if (!ffmpegStatic) {
    throw new Error('ffmpeg-static did not resolve to a binary path.');
  }

  await mkdir(binaryOutputDirectory, { recursive: true });
  await cp(ffmpegStatic, resolve(binaryOutputDirectory, basename(ffmpegStatic)));
}
