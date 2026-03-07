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

- Date: 2026-03-07
- `npm run e2e` → **PASS** (1 passed)
- `npm run e2e:ci` → **PASS** (1 passed)

## Current coverage

### `library-linking.spec.ts`

Happy path validates:

1. launch production-built Electron shell
2. link a folder via direct path input
3. detect initial export file and show one logical song/version
4. add a second version file in watched folder
5. verify watcher-driven auto-refresh updates inspector version count to 2

This test covers the first vertical-slice risk: **folder link + watch + logical grouping refresh loop**.
