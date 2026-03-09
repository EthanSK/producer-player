# Electron E2E Test Setup

## Test framework

- Playwright (`@playwright/test`)
- Electron test target via `@playwright/test` `_electron` launcher
- Tests located in: `apps/e2e/src`

## Commands

From repo root:

```bash
npm run e2e
npm run e2e:ci
```

Direct workspace commands:

```bash
npm run test -w @producer-player/e2e
npm run ci -w @producer-player/e2e
```

## CI-friendly command behavior

`npm run e2e:ci` runs:

1. full build (`contracts`, `domain`, `renderer`, `electron`)
2. `apps/e2e/scripts/run-ci.mjs`
   - on Linux: uses `xvfb-run -a` if available
   - on macOS/Windows: runs Playwright directly

## Current status (latest run)

- Date: 2026-03-09
- `npm run test -w @producer-player/e2e` → **PASS** (9 passed)

## Current coverage

### `library-linking.spec.ts`

- folder link + watcher refresh loop
- top-level + `old/` scanning behavior
- naming guidance visibility
- state persistence in user data (linked folders + song order)
- reinstall-like recovery via sidecar ordering restoration
- baseline transport controls with valid WAV fixtures

### `folder-structure-hardening.spec.ts`

- ignores nested junk folders
- stable grouping across `v` suffix variants
- deterministic archive naming under `old/`
- custom ordering preservation through organize/rescan + unlink/relink (sidecar path)

### `playback-runtime.spec.ts`

- real fixture matrix (wav/mp3/m4a/flac/aiff)
- validates `producer-media://` source resolution + MIME metadata
- asserts either real playback or actionable fallback error guidance
- stress flow: play/pause, rapid next/prev switching, rescan, relink, archived-old selection
- dev-mode regression: no `file://` local-resource block when renderer is hosted at `http://127.0.0.1:4207`

## Fixture notes

- Codec fixtures are generated via `ffmpeg` in test runtime.
- If `ffmpeg` is unavailable, playback-runtime tests are skipped with an explicit reason.
