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

// Release asset naming/resolution is pure logic and covers Linux AppImage
// update targeting without loading Electron.
await build({
  entryPoints: [resolve(appDir, 'src/release-assets.ts')],
  outfile: resolve(appDir, 'dist/release-assets.test.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: ['node20'],
  sourcemap: 'inline',
  logLevel: 'warning',
});

// Detached OS file-open command construction stays pure/injectable so the
// Ableton/DAW handoff isolation can be locked without launching real apps.
await build({
  entryPoints: [resolve(appDir, 'src/file-open.ts')],
  outfile: resolve(appDir, 'dist/file-open.test.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: ['node20'],
  sourcemap: 'inline',
  logLevel: 'warning',
  external: ['node:child_process'],
});

// v3.189.0 — Save-copy of song project files. Pure filename + collision
// logic kept in its own module so it can be tested without Electron.
await build({
  entryPoints: [resolve(appDir, 'src/song-project-copy.ts')],
  outfile: resolve(appDir, 'dist/song-project-copy.test.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: ['node20'],
  sourcemap: 'inline',
  logLevel: 'warning',
  external: ['node:fs', 'node:path'],
});

// v3.90 — agent UI control primitives. Pure logic (no electron runtime
// needed) once electron-log and `electron` types are stripped at build time.
await build({
  entryPoints: [resolve(appDir, 'src/agent-ui-control.ts')],
  outfile: resolve(appDir, 'dist/agent-ui-control.test.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: ['node20'],
  sourcemap: 'inline',
  logLevel: 'warning',
  external: ['electron'],
  plugins: [shimElectronLog],
});

// v3.110 — agent-service prompt/history bundling for hermetic Node tests.
// Used by:
//   - agent-service-attachments.test.cjs (v3.110): verifies that
//     attachments from prior turns are replayed into every subsequent
//     turn's prompt (issue: model previously couldn't recall images
//     attached on past turns).
//   - agent-service-bypass-permissions.test.cjs (v3.113, Item #13):
//     locks OFF/ON parity for the `--dangerously-skip-permissions`
//     (Claude) and `--dangerously-bypass-approvals-and-sandbox` (Codex)
//     flags via `__testing__.getSpawnArgs`.
// External the node:* shims that agent-service uses at runtime so
// esbuild leaves them alone for the host Node runtime to resolve.
await build({
  entryPoints: [resolve(appDir, 'src/agent-service.ts')],
  outfile: resolve(appDir, 'dist/agent-service.test.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: ['node20'],
  sourcemap: 'inline',
  logLevel: 'warning',
  external: ['electron', 'node:child_process', 'node:fs', 'node:readline'],
  plugins: [shimElectronLog],
});

// v3.200 — Structured action log. Pure serialization, normalization, and
// rotation logic — testable without an Electron runtime. We keep node:fs
// and node:path external so the writer's real filesystem usage stays
// available to the (hermetic) test that drives it via an in-memory
// dependency-injected handler set instead of touching real disk.
await build({
  entryPoints: [resolve(appDir, 'src/actionLog.ts')],
  outfile: resolve(appDir, 'dist/actionLog.test.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: ['node20'],
  sourcemap: 'inline',
  logLevel: 'warning',
  external: ['node:fs', 'node:path'],
  plugins: [shimElectronLog],
});

console.info('[producer-player/electron] Built dist/state-service.test.cjs + dist/plugin-host-service.test.cjs + dist/plugin-preset-library.test.cjs + dist/ui-zoom.test.cjs + dist/auto-update-signature.test.cjs + dist/release-assets.test.cjs + dist/file-open.test.cjs + dist/agent-ui-control.test.cjs + dist/agent-service.test.cjs + dist/actionLog.test.cjs');
