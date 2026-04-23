# AGENTS.md — Producer Player Project Rules

## Always push after making changes

**Rule:** every agent (subagent or otherwise) that lands a commit in this
repo MUST push to `origin/main` before declaring the work done. Local
commits that never reach the remote are effectively invisible to other
machines and to future sessions — Ethan specifically called this out as
a recurring frustration. Sequence is: stage → commit → push → verify with
`git log origin/main..HEAD --oneline` returning empty.

If the pre-push hook demands a version bump, bump (via the repo's own
`bump-version.mjs` + `version:sync` scripts), commit that as a separate
`chore: bump version to X.Y.Z` commit, then push both commits in one go.
This is REPO POLICY, not a voluntary release workflow trigger.

If the push fails (non-fast-forward from concurrent work), rebase on
origin and re-push — don't leave work stranded on a local branch.

## Updater / release pipeline

The in-app "Check for Updates" flow is electron-updater pointed at GitHub
Releases (see `apps/electron/src/main.ts` → `configureAutoUpdater`). It
fetches `latest-mac.yml` from the newest release of `EthanSK/producer-player`
and compares versions. **It does NOT read `site/version.json`** — that file is
only used by the marketing site for the displayed download version.

Therefore: if existing installs report "you're up to date" on a stale
version even though `package.json` (and the repo) is newer, the cause is
almost always that the **Release Desktop workflow has been failing**, not
the updater itself. The most common trigger is a macOS notarization 403:

> "A required agreement is missing or has expired."

Fix: log into https://developer.apple.com/account/ and accept the updated
Program License Agreement, then re-run the latest failed workflow run
(`gh run rerun <run-id> --repo EthanSK/producer-player`) or push a fresh
commit. Until that's done, NO new mac release exists for users to update
to, regardless of how many times anyone hits "Check for Updates".

The workflow now (a) emits a loud `::error` annotation when mac
notarization fails, and (b) lets `publish-release` ship whatever
platforms DID build, so a single-platform failure no longer blocks the
others.

## Screenshots

**After visible marketing-surface UI changes:** Retake screenshots before considering the work done.

- Screenshot script: `scripts/take-screenshot.mjs` (uses Playwright Electron API, `enableLargerThanScreen: true` for test mode)
- Window size: use whatever is set in the script (currently ~1440×900, 16:10 ratio)
- Screenshots go to: `site/assets/screenshots/app-hero.png`, `app-hero-checklist.png`, `app-hero-readme.png`

## Deploy Validation

- `site/styles.css` must exist (even if empty) for the GitHub Pages deploy workflow

## Feature Flags

- `apps/renderer/src/featureFlags.ts` — contains `SHOW_3000AD_BRANDING` (currently OFF)

## External URL Allowlist

- `apps/electron/src/main.ts` → `TRUSTED_EXTERNAL_URLS` array — add new trusted URLs here

## Data Storage

### Unified state (primary — introduced v2.45)

- **Single source of truth**: `producer-player-user-state.json` in appData (`~/Library/Application Support/Producer Player/` on macOS)
- Contains ALL user-authored data: ratings, checklists, project file paths, album metadata, reference tracks, agent settings, preferences, linked folders, song order
- Managed by `apps/electron/src/state-service.ts` (`UserStateService`)
- Schema defined in `packages/contracts/src/index.ts` as `ProducerPlayerUserState` (schemaVersion: 1)
- IPC channels: `GET_USER_STATE`, `SET_USER_STATE`, `EXPORT_USER_STATE`, `IMPORT_USER_STATE`, `USER_STATE_CHANGED`

### Legacy files (kept for backward compatibility)

- `producer-player-electron-state.json` — linked folders, order, autoMoveOld (still written alongside unified state)
- `producer-player-shared-user-state.json` — ratings, checklists, project paths (still written alongside unified state)
- renderer `localStorage` — still used as a fast local cache; synced to/from unified state on startup

### Migration

On first launch after the update, if `producer-player-user-state.json` doesn't exist but old files do, the app automatically migrates data from the old files into the unified format. Old files are NOT deleted.

### iCloud backup

- Directory: `~/Library/Mobile Documents/com~apple~CloudDocs/Producer Player/`
- Now backs up the unified state file alongside the legacy per-file backups
- On restore, if the iCloud unified state is newer, it replaces the local copy

### Import / Export

- "Export State" button in sidebar exports the entire `ProducerPlayerUserState` as JSON via a save dialog
- "Import State" button reads a JSON file, validates the schema, and applies the full state

### Critical: User Data Storage Rule

ALL user-authored data MUST be persisted to the unified state file
(producer-player-user-state.json), NOT localStorage alone.

localStorage can be used as a FAST CACHE for immediate reads, but every
write must also sync to the unified state file via the debounced IPC sync.

Reason: localStorage is not flushed to disk on Ctrl+C/SIGINT. Only the
unified state file (written via fs.writeFileSync in the main process)
survives hard kills. Additionally, localStorage is per-Chromium-profile
(LevelDB keyed by executable path) and does NOT transfer between dev and
production builds.

When adding new persisted state:
1. Add the field to `ProducerPlayerUserState` in `packages/contracts/src/index.ts`
2. Add a parser for the field in `apps/electron/src/state-service.ts` (`parseUserState`)
3. Add the field to `createDefaultUserState()` in the same file
4. Include it in the debounced state sync in `App.tsx` (the `setTimeout(() => { ... }, 500)` block)
5. Load it from unified state on startup (the `getUserState()` `.then(...)` block in `App.tsx`)
6. Sync it back to localStorage in `onUserStateChanged` listener (for import support)
7. Add a migration path in the one-time migration block if the data previously lived in localStorage
8. localStorage is optional (cache only)

Only UI layout preferences (panel order, expanded/collapsed states, onboarding-seen
flags) should remain localStorage-only.

**OK in localStorage (UI-only, no user data):**
- `producer-player.more-metrics-expanded.v1` — metrics panel expanded state
- `producer-player.mastering-layout.compact.v1` / `fullscreen.v1` — panel layout order
- `producer-player.agent-panel-seen` — onboarding seen flag
- `producer-player.agent-panel-onboarding-armed` — onboarding armed flag

## Audio Analysis

- FFmpeg ebur128 for static file analysis (LUFS, true peak, dynamics)
- Web Audio API for real-time spectrum, level metering, band soloing
- Platform normalization values must be verified against authoritative sources before changing

## Validation Ladder (Lean Default)

- For routine local iteration, run `npm run validate:quick`.
- For broader pre-PR confidence, run `npm run validate:core`.
- For release confidence, run `npm run validate:full` (full suite; prefer CI for this level).
- `npm run e2e` is intentionally lean (same behavior as `e2e:smoke`).
- Explicit E2E levels:
  - `npm run e2e:smoke`
  - `npm run e2e:core`
  - `npm run e2e:full` (same coverage as legacy `e2e:ci`)

## CI & Testing

### Post-push CI monitoring

After pushing a commit that cuts a release or runs the test suite, monitor
the CI workflows (use `gh run list --limit 3` or watch the release workflow)
for up to 10-15 minutes. If a test-job fails:
- Inspect the failure log (`gh run view <run-id> --log-failed`)
- Fix the underlying bug (don't just skip or delete the test)
- Pre-commit-codex-review the fix
- Push a fresh commit (bump version if the project uses auto-release-on-push)

Do not declare shipping success without seeing the CI green. "Pushed" is
not the same as "released" or "passed" — the workflow gives us the real
signal.

### What runs on every push (ubuntu)

1. `node-build` — version-bump policy, typecheck, build all workspaces.
2. `unit-tests` — domain (`npm test -w packages/domain`), renderer
   (`npm test -w @producer-player/renderer`, vitest), electron
   state-service (`npm test -w @producer-player/electron`).
3. `runtime-smoke` — `npm run e2e:smoke` (Playwright @smoke-tagged specs).
4. `windows-ci` — typecheck + build + domain tests + `ci:smoke`.

Renderer vitest + electron state-service tests were added to CI in v3.34
after the test-coverage audit (2026-04-19) exposed them as "exist but
never run in CI".

## Release Versioning

- **Version format is ALWAYS x.y (display) / x.y.0 (internal). Never x.y.z where z > 0.**
- Do NOT manually edit the `version` field in `package.json`. Always use the bump scripts.
- Every meaningful Producer Player code/content change that is intended to ship should advance the app version before it lands on `main`.
- `package.json` is the single source of truth for the app version.
- Default bump level: **patch** (which increments the minor/y part: 2.59 -> 2.60).
- Use a **minor** bump for clearly meaningful user-facing feature work or noticeably broader UX/product changes (which increments the major/x part: 2.60 -> 3.0).
- Commit messages should make that intent legible:
  - `feat:` (or `feat(...)`) → minor bump
  - `fix:`, `chore:`, `refactor:`, `docs:`, `test:` → patch bump by default
  - `[minor]` in the commit subject/body can force a minor bump when needed
- Before shipping a meaningful change, run one of:
  - `npm run version:bump:patch`  (bumps y: 2.59 -> 2.60)
  - `npm run version:bump:minor`  (bumps x: 2.59 -> 3.0)
- Then run:
  - `npm run version:check`
  - `npm run version:bump:check`
- CI now enforces that release-relevant file changes cannot land without a version bump in `package.json`.
- CI and scripts also enforce that the patch component is always 0. A non-zero patch (e.g. 2.59.1) will fail validation.
