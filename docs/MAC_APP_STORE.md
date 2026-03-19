# Producer Player Mac App Store status

_Last updated: 2026-03-19_

## Short status

Producer Player is **code-prepared** for Mac App Store packaging, but **not yet fully submitted**.

What is already in place:

- Electron main process handles `process.mas` sandbox behavior.
- Folder linking uses native picker + `securityScopedBookmarks` in MAS builds.
- Manual path linking is blocked in sandbox mode.
- MAS entitlements are wired in electron-builder config.
- `mas` / `mas-dev` build targets are available.
- MAS-targeted builds skip bundled ffmpeg packaging where needed.

## Local automation added

From repo root:

```bash
npm run mas:preflight
npm run mas:screenshots
./scripts/build-mas-local.sh
./scripts/upload-mas-build.sh
```

### What each does

- `npm run mas:preflight`
  - Checks keychain identities, provisioning profile, upload tooling, screenshot pack, and MAS artifacts.
  - Fails fast with explicit blockers.

- `npm run mas:screenshots`
  - Generates ASC-ready screenshot sizes in `artifacts/app-store-connect/screenshots/`.

- `./scripts/build-mas-local.sh`
  - Runs preflight, then builds `npm run build:mac:mas`.

- `./scripts/upload-mas-build.sh`
  - Uploads MAS `.pkg` via iTMSTransporter (requires `APPLE_ID` + app-specific password).

## Required environment for MAS builds

```bash
export PRODUCER_PLAYER_PROVISIONING_PROFILE=/absolute/path/to/ProducerPlayer.provisionprofile
```

If electron-builder cannot auto-pick identity:

```bash
export CSC_NAME="Apple Distribution: Your Name (TEAMID)"
# or for mas-dev:
export CSC_NAME="Apple Development: Your Name (TEAMID)"
```

## Required manual Apple-side setup

These still require Apple account access and cannot be completed by repo scripts alone:

1. Apple Developer cert/profile setup
   - Apple Distribution cert installed in keychain
   - MAS provisioning profile for `com.ethansk.producerplayer`
2. App Store Connect app record + metadata
3. Privacy / compliance / export compliance answers
4. Pricing + availability
5. Final App Review submission

## Current reality check

Code and packaging are in good shape for MAS, but this does **not** mean the app is already reviewed/approved in App Store Connect.

Use `npm run mas:preflight` for the current machine truth before each submission attempt.

## Related docs

- `docs/APP_STORE_CONNECT_CHECKLIST.md`
- `docs/APP_STORE_CONNECT_METADATA_TEMPLATE.md`
- `docs/RELEASING.md`
- `docs/CODE_SIGNING.md`

## Relevant files

- `package.json`
- `scripts/build-mac.mjs`
- `scripts/mas-preflight.sh`
- `scripts/build-mas-local.sh`
- `scripts/upload-mas-build.sh`
- `build/entitlements.mas.plist`
- `build/entitlements.mas.inherit.plist`
- `apps/electron/src/main.ts`
