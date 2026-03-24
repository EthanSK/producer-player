# Electron E2E Validation

## Test framework

- Playwright (`@playwright/test`)
- Electron target via Playwright `_electron` launcher
- Tests live in `apps/e2e/src` (currently 13 spec files / 87 tests)

## Validation ladder (repo root)

The repository now uses a lean-by-default validation split:

```bash
npm run validate:quick   # routine local pass (default recommendation)
npm run validate:core    # broader local confidence pass
npm run validate:full    # full release-confidence pass
```

### What each level runs

- `validate:quick`
  1. `npm run typecheck:app`
  2. `npm run e2e:smoke`

- `validate:core`
  1. `npm run typecheck:app`
  2. `npm run e2e:core`
     - Core spec set: `runtime-smoke`, `checklist-and-export-ux`, `checklist-textarea-ux`, `checklist-timestamps`

- `validate:full`
  1. `npm run typecheck`
  2. `npm run e2e:full`

## E2E command map

From repo root:

```bash
npm run e2e              # lean default (same behavior as e2e:smoke)
npm run e2e:smoke        # build + @smoke tests
npm run e2e:core         # build + core specs (runtime smoke + checklist UX/timestamps)
npm run e2e:full         # build + full E2E suite (all specs)
npm run e2e:ci           # legacy-compatible full-suite entrypoint (same behavior as e2e:full)
```

Direct workspace commands (`apps/e2e`):

```bash
npm run test -w @producer-player/e2e
npm run test:smoke -w @producer-player/e2e
npm run test:core -w @producer-player/e2e

npm run ci -w @producer-player/e2e
npm run ci:smoke -w @producer-player/e2e
npm run ci:core -w @producer-player/e2e
```

Notes:
- Root-level `e2e:*` scripts include a full app build first.
- Workspace `ci*` scripts execute `apps/e2e/scripts/run-ci.mjs`, which:
  - sets `CI=1` by default
  - uses `xvfb-run -a` on Linux if available
  - runs Playwright directly on macOS/Windows

## Fixture notes

- Codec fixtures are generated via `ffmpeg` during test runtime.
- If `ffmpeg` is unavailable, playback-runtime tests are skipped with an explicit reason.
