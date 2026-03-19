import { build } from 'esbuild';
import ffmpegStatic from 'ffmpeg-static';
import { execFile } from 'node:child_process';
import { chmod, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { gunzipSync } from 'node:zlib';

const execFileAsync = promisify(execFile);
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
const shouldBuildUniversalMacFfmpeg =
  shouldBundleFfmpeg &&
  process.platform === 'darwin' &&
  process.env.PRODUCER_PLAYER_BUILD_MAC_UNIVERSAL === 'true';

if (!shouldBundleFfmpeg) {
  console.info('[producer-player/electron] Skipping bundled ffmpeg binary for this build target.');
} else {
  if (!ffmpegStatic) {
    throw new Error('ffmpeg-static did not resolve to a binary path.');
  }

  await mkdir(binaryOutputDirectory, { recursive: true });

  if (shouldBuildUniversalMacFfmpeg) {
    const hostArch = process.arch;
    if (hostArch !== 'arm64' && hostArch !== 'x64') {
      throw new Error(
        `[producer-player/electron] Universal macOS ffmpeg build requires arm64 or x64 host arch (got ${hostArch}).`
      );
    }

    const ffmpegPackageJsonPath = resolve(
      appDirectory,
      '../../node_modules/ffmpeg-static/package.json'
    );
    const ffmpegPackageJson = JSON.parse(await readFile(ffmpegPackageJsonPath, 'utf8'));
    const ffmpegPackageConfig = ffmpegPackageJson[ffmpegPackageJson.name] ?? {};

    const releaseTagEnvKey = ffmpegPackageConfig['binary-release-tag-env-var'];
    const binariesUrlEnvKey = ffmpegPackageConfig['binaries-url-env-var'];
    const releaseTag =
      (releaseTagEnvKey && process.env[releaseTagEnvKey]) ||
      ffmpegPackageConfig['binary-release-tag'];
    const binariesBaseUrl =
      (binariesUrlEnvKey && process.env[binariesUrlEnvKey]) ||
      'https://github.com/eugeneware/ffmpeg-static/releases/download';
    const executableBaseName = ffmpegPackageConfig['executable-base-name'] || 'ffmpeg';

    if (!releaseTag) {
      throw new Error('[producer-player/electron] ffmpeg-static release tag is missing.');
    }

    const temporaryDirectory = resolve(binaryOutputDirectory, '.ffmpeg-universal-temp');
    await rm(temporaryDirectory, { recursive: true, force: true });
    await mkdir(temporaryDirectory, { recursive: true });

    async function ensureDarwinArchBinary(arch) {
      if (arch === hostArch) {
        return ffmpegStatic;
      }

      const destinationPath = resolve(temporaryDirectory, `${executableBaseName}-${arch}`);
      const downloadUrl = `${binariesBaseUrl}/${releaseTag}/${executableBaseName}-darwin-${arch}.gz`;
      const response = await fetch(downloadUrl);
      if (!response.ok) {
        throw new Error(
          `[producer-player/electron] Failed downloading ${executableBaseName} for ${arch}: ${response.status} ${response.statusText}`
        );
      }

      const compressed = Buffer.from(await response.arrayBuffer());
      const binary = gunzipSync(compressed);
      await writeFile(destinationPath, binary, { mode: 0o755 });
      await chmod(destinationPath, 0o755);
      return destinationPath;
    }

    const arm64Path = await ensureDarwinArchBinary('arm64');
    const x64Path = await ensureDarwinArchBinary('x64');
    const universalPath = resolve(binaryOutputDirectory, basename(ffmpegStatic));

    await execFileAsync('lipo', ['-create', '-output', universalPath, arm64Path, x64Path]);
    await chmod(universalPath, 0o755);
    await rm(temporaryDirectory, { recursive: true, force: true });

    console.info('[producer-player/electron] Bundled universal ffmpeg binary for macOS builds.');
  } else {
    await cp(ffmpegStatic, resolve(binaryOutputDirectory, basename(ffmpegStatic)));
  }
}
