/**
 * Development script for the Electron main process.
 *
 * Uses esbuild in watch mode so that changes to main-process source files
 * trigger an incremental rebuild.  After each successful rebuild the running
 * Electron process is killed and restarted automatically.
 *
 * Environment variables consumed at runtime by the spawned Electron process
 * (ELECTRON_DEV, RENDERER_DEV_URL, etc.) are forwarded automatically.
 */

import { context } from 'esbuild';
import { execFileSync, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appDirectory = resolve(scriptDirectory, '..');
const repositoryDirectory = resolve(appDirectory, '../..');
const outputDirectory = resolve(appDirectory, 'dist');

// ---------------------------------------------------------------------------
// Helpers copied (simplified) from build-main.mjs so we can resolve the same
// compile-time defines without duplicating the full ffmpeg bundling logic.
// ---------------------------------------------------------------------------

function parsePositiveInteger(rawValue) {
  if (typeof rawValue !== 'string') return null;
  const normalized = rawValue.trim();
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.trunc(parsed);
}

function resolveBuildNumber() {
  const explicit = parsePositiveInteger(process.env.PRODUCER_PLAYER_BUILD_NUMBER);
  if (explicit !== null) return String(explicit);
  try {
    const count = execFileSync('git', ['rev-list', '--count', 'HEAD'], {
      cwd: repositoryDirectory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const parsed = parsePositiveInteger(count);
    return parsed === null ? '' : String(parsed);
  } catch {
    return '';
  }
}

function resolveCommitSha() {
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

async function resolveAppSemanticVersion() {
  try {
    const pkg = JSON.parse(
      await readFile(resolve(repositoryDirectory, 'package.json'), 'utf8'),
    );
    const v = pkg?.version;
    if (typeof v === 'string' && /^\d+\.\d+\.\d+/.test(v)) return v;
  } catch {
    // ignore
  }
  return '';
}

// ---------------------------------------------------------------------------
// Electron child-process management
// ---------------------------------------------------------------------------

/** @type {import('node:child_process').ChildProcess | null} */
let electronProcess = null;
/** Tracks whether we intentionally killed the process (restart cycle). */
let intentionalKill = false;

function killElectron() {
  if (!electronProcess) return;
  intentionalKill = true;
  const proc = electronProcess;
  electronProcess = null;
  // Tree-kill: on macOS sending SIGTERM to the group (-pid) ensures child
  // helpers are cleaned up as well.
  try {
    process.kill(-proc.pid, 'SIGTERM');
  } catch {
    try {
      proc.kill('SIGTERM');
    } catch {
      // already exited
    }
  }
}

function startElectron() {
  killElectron();
  intentionalKill = false;

  const electronBin = resolve(
    repositoryDirectory,
    'node_modules/.bin/electron',
  );
  const mainEntry = resolve(outputDirectory, 'main.cjs');

  electronProcess = spawn(electronBin, [mainEntry], {
    stdio: 'inherit',
    env: {
      ...process.env,
      ELECTRON_DEV: 'true',
      RENDERER_DEV_URL: process.env.RENDERER_DEV_URL ?? 'http://127.0.0.1:4207',
    },
    detached: true, // so we can kill the group
  });

  electronProcess.on('exit', (code) => {
    if (intentionalKill) return; // killed for restart, ignore
    // Electron quit on its own (user closed window, crash, etc.)
    // In that case exit the dev script too.
    process.exit(code ?? 0);
  });
}

// ---------------------------------------------------------------------------
// esbuild watch context
// ---------------------------------------------------------------------------

const resolvedBuildNumber = resolveBuildNumber();
const resolvedCommitSha = resolveCommitSha();
const resolvedAppSemanticVersion = await resolveAppSemanticVersion();

const ctx = await context({
  entryPoints: [
    resolve(appDirectory, 'src/main.ts'),
    resolve(appDirectory, 'src/preload.ts'),
  ],
  outdir: outputDirectory,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: ['node20'],
  sourcemap: true,
  external: ['electron'],
  outExtension: { '.js': '.cjs' },
  define: {
    __PRODUCER_PLAYER_APP_VERSION__: JSON.stringify(resolvedAppSemanticVersion),
    __PRODUCER_PLAYER_BUILD_NUMBER__: JSON.stringify(resolvedBuildNumber),
    __PRODUCER_PLAYER_COMMIT_SHA__: JSON.stringify(resolvedCommitSha),
  },
  logLevel: 'info',
  plugins: [
    {
      name: 'electron-restart',
      setup(build) {
        build.onEnd((result) => {
          if (result.errors.length === 0) {
            console.info('[dev-main] Rebuild succeeded – restarting Electron …');
            startElectron();
          } else {
            console.error(
              `[dev-main] Build failed with ${result.errors.length} error(s). Electron NOT restarted.`,
            );
          }
        });
      },
    },
  ],
});

// Start watching (initial build is performed automatically).
await ctx.watch();

// Graceful shutdown
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    killElectron();
    ctx.dispose().finally(() => process.exit(0));
  });
}

console.info('[dev-main] Watching for main-process changes …');
