import { build } from 'esbuild';
import ffmpegStatic from 'ffmpeg-static';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { access, chmod, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { gunzipSync } from 'node:zlib';

const execFileAsync = promisify(execFile);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appDirectory = resolve(scriptDirectory, '..');
const repositoryDirectory = resolve(appDirectory, '../..');
const outputDirectory = resolve(appDirectory, 'dist');
const binaryOutputDirectory = resolve(outputDirectory, 'bin');
// v3.50 fix (2026-04-20): production v3.46 shipped without `pp-audio-host`,
// so the renderer's "Scan plugins" button always hit `isAvailable()=false`
// and toast-reported "Plugin scan failed". Root cause: this script only
// copied ffmpeg into dist/bin, so electron-builder's
// `asarUnpack: ["apps/electron/dist/bin/**"]` rule had nothing sidecar-
// shaped to capture. We now build (if needed) + copy the JUCE sidecar into
// dist/bin alongside ffmpeg so packaged installs always ship it.
const sidecarDirectory = resolve(repositoryDirectory, 'native/pp-audio-host');
const sidecarBuildScript = resolve(sidecarDirectory, 'scripts/build-sidecar.sh');
const sidecarBinaryName = process.platform === 'win32' ? 'pp-audio-host.exe' : 'pp-audio-host';
const sidecarSourceBinary = resolve(sidecarDirectory, 'build/bin', sidecarBinaryName);
const sidecarBundledBinary = resolve(binaryOutputDirectory, sidecarBinaryName);

function parsePositiveInteger(rawValue) {
  if (typeof rawValue !== 'string') {
    return null;
  }

  const normalized = rawValue.trim();
  if (!/^\d+$/.test(normalized)) {
    return null;
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return Math.trunc(parsed);
}

function resolveBuildNumber() {
  const explicitValue = parsePositiveInteger(process.env.PRODUCER_PLAYER_BUILD_NUMBER);
  if (explicitValue !== null) {
    return String(explicitValue);
  }

  const githubRunNumber = parsePositiveInteger(process.env.GITHUB_RUN_NUMBER);
  if (githubRunNumber !== null) {
    return String(githubRunNumber);
  }

  try {
    const commitCount = execFileSync('git', ['rev-list', '--count', 'HEAD'], {
      cwd: repositoryDirectory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();

    const parsedCount = parsePositiveInteger(commitCount);
    return parsedCount === null ? '' : String(parsedCount);
  } catch {
    return '';
  }
}

function resolveCommitSha() {
  const explicitSha =
    typeof process.env.PRODUCER_PLAYER_COMMIT_SHA === 'string'
      ? process.env.PRODUCER_PLAYER_COMMIT_SHA.trim()
      : '';
  if (/^[0-9a-f]{7,40}$/i.test(explicitSha)) {
    return explicitSha.slice(0, 12).toLowerCase();
  }

  const githubSha =
    typeof process.env.GITHUB_SHA === 'string' ? process.env.GITHUB_SHA.trim() : '';
  if (/^[0-9a-f]{7,40}$/i.test(githubSha)) {
    return githubSha.slice(0, 12).toLowerCase();
  }

  try {
    return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
      cwd: repositoryDirectory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function normalizeSemanticVersion(rawValue) {
  if (typeof rawValue !== 'string') {
    return null;
  }

  const normalized = rawValue.trim().replace(/^v/i, '');
  if (!/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/.test(normalized)) {
    return null;
  }

  return normalized;
}

async function resolveAppSemanticVersion() {
  const explicitSemanticVersion = normalizeSemanticVersion(process.env.PRODUCER_PLAYER_APP_VERSION);
  if (explicitSemanticVersion) {
    return explicitSemanticVersion;
  }

  try {
    const repositoryPackageJsonPath = resolve(repositoryDirectory, 'package.json');
    const repositoryPackageJson = JSON.parse(await readFile(repositoryPackageJsonPath, 'utf8'));
    const repositoryVersion = normalizeSemanticVersion(repositoryPackageJson?.version);
    if (repositoryVersion) {
      return repositoryVersion;
    }
  } catch {
    // Ignore and use runtime fallback in the app.
  }

  return '';
}

const resolvedBuildNumber = resolveBuildNumber();
const resolvedCommitSha = resolveCommitSha();
const resolvedAppSemanticVersion = await resolveAppSemanticVersion();

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
  define: {
    __PRODUCER_PLAYER_APP_VERSION__: JSON.stringify(resolvedAppSemanticVersion),
    __PRODUCER_PLAYER_BUILD_NUMBER__: JSON.stringify(resolvedBuildNumber),
    __PRODUCER_PLAYER_COMMIT_SHA__: JSON.stringify(resolvedCommitSha),
  },
  logLevel: 'info',
});

if (resolvedBuildNumber || resolvedCommitSha || resolvedAppSemanticVersion) {
  console.info('[producer-player/electron] Embedded app build metadata', {
    semanticVersion: resolvedAppSemanticVersion || null,
    buildNumber: resolvedBuildNumber || null,
    commitSha: resolvedCommitSha || null,
  });
}

await rm(binaryOutputDirectory, { recursive: true, force: true });
await mkdir(binaryOutputDirectory, { recursive: true });

const shouldBundleFfmpeg = process.env.PRODUCER_PLAYER_SKIP_BUNDLED_FFMPEG !== 'true';
// The core Electron app is cross-platform, but the optional JUCE
// pp-audio-host sidecar is still bundled only on macOS. Linux/Windows runners
// have historically failed here on native audio/plugin-host dependencies,
// which broke the whole Release Desktop workflow and stranded released users
// (see 2026-04-20 v3.57-v3.59 stuck run). Gate the sidecar step on darwin so
// Linux/Windows still produce valid core Electron bundles. The explicit
// opt-out env var still works for parity.
const shouldBundleSidecar =
  process.platform === 'darwin' &&
  process.env.PRODUCER_PLAYER_SKIP_BUNDLED_SIDECAR !== 'true';
const shouldBuildUniversalMacFfmpeg =
  shouldBundleFfmpeg &&
  process.platform === 'darwin' &&
  process.env.PRODUCER_PLAYER_BUILD_MAC_UNIVERSAL === 'true';

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function runSidecarBuild() {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('bash', [sidecarBuildScript], {
      cwd: sidecarDirectory,
      stdio: 'inherit',
    });
    child.on('error', rejectPromise);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise();
      } else {
        rejectPromise(
          new Error(
            `[producer-player/electron] pp-audio-host sidecar build failed (code=${code}, signal=${signal}).`,
          ),
        );
      }
    });
  });
}

if (!shouldBundleSidecar) {
  if (process.platform !== 'darwin') {
    console.info(
      `[producer-player/electron] Skipping pp-audio-host sidecar build on non-macOS (platform=${process.platform}).`,
    );
  } else {
    console.info('[producer-player/electron] Skipping bundled pp-audio-host sidecar for this build target.');
  }
} else {
  // Build the sidecar if it isn't already on disk. This is the path that
  // was missing in v3.46–v3.49: `npm run build` -> this script -> ffmpeg-only
  // copy, and the JUCE sidecar never made it into the .app bundle. Rebuild-
  // on-demand mirrors how other native deps (ffmpeg universal) are handled.
  if (!(await fileExists(sidecarSourceBinary))) {
    console.info('[producer-player/electron] pp-audio-host sidecar not built yet — building now.');
    await runSidecarBuild();
  }
  if (!(await fileExists(sidecarSourceBinary))) {
    throw new Error(
      `[producer-player/electron] pp-audio-host sidecar build completed but binary is missing at ${sidecarSourceBinary}.`,
    );
  }
  await cp(sidecarSourceBinary, sidecarBundledBinary);
  await chmod(sidecarBundledBinary, 0o755);
  console.info(`[producer-player/electron] Bundled pp-audio-host sidecar binary at ${sidecarBundledBinary}.`);
}

if (!shouldBundleFfmpeg) {
  console.info('[producer-player/electron] Skipping bundled ffmpeg binary for this build target.');
} else {
  if (!ffmpegStatic) {
    throw new Error('ffmpeg-static did not resolve to a binary path.');
  }

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
    const bundledFfmpegPath = resolve(binaryOutputDirectory, basename(ffmpegStatic));
    await cp(ffmpegStatic, bundledFfmpegPath);
    await chmod(bundledFfmpegPath, 0o755);
    console.info(`[producer-player/electron] Bundled ffmpeg binary at ${bundledFfmpegPath}.`);
  }
}
