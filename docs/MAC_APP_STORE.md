# Producer Player Mac App Store status

_Last updated: 2026-03-10_

## Short status

**Not fully done yet**, but the app is now materially more prepared for macOS / Mac App Store packaging than before.

What is already in place:

- Electron main-process code already detects `process.mas` and switches into Mac App Store-safe behavior where feasible.
- Linked-folder access in sandbox mode uses the native folder picker with `securityScopedBookmarks` enabled.
- Manual path linking is blocked in sandbox builds so the app does not bypass folder-access requirements.
- AIFF transcoding is already disabled in MAS mode, which avoids spawning the bundled ffmpeg helper inside the sandbox path.
- Electron-builder now has explicit `mas` and `mas-dev` targets.
- MAS entitlements files now exist in `build/`.
- New npm scripts now exist for unsigned mac builds and App Store-oriented builds.
- The Electron build step now skips bundling ffmpeg for MAS-targeted builds.

## New npm scripts

From the repo root:

```bash
npm run build:mac
npm run build:mac:dir
npm run build:mac:mas-dev
npm run build:mac:mas
npm run build:mac:app-store
```

### What each script does

- `npm run build:mac`
  - Builds the normal unsigned macOS ZIP artifact.
  - Good for local smoke tests and ordinary unsigned packaging.

- `npm run build:mac:dir`
  - Builds an unpacked macOS app directory.
  - Good for local inspection / quick launch testing.

- `npm run build:mac:mas-dev`
  - Builds a **Mac App Store development** target.
  - Intended for local sandbox testing with an **Apple Development** certificate and provisioning profile.

- `npm run build:mac:mas`
  - Builds a **Mac App Store distribution** target.
  - Intended for the final App Store signing path with an **Apple Distribution** certificate and provisioning profile.

- `npm run build:mac:app-store`
  - Alias for `npm run build:mac:mas`.

## Required environment for App Store builds

For `mas-dev` and `mas` builds, set:

```bash
export PRODUCER_PLAYER_PROVISIONING_PROFILE=/absolute/path/to/ProducerPlayer.provisionprofile
```

If electron-builder cannot automatically pick the right signing identity, also set:

```bash
export CSC_NAME="Apple Development: Your Name (TEAMID)"
# or
export CSC_NAME="Apple Distribution: Your Name (TEAMID)"
```

## What is automated now

Automated in-repo:

- macOS unsigned ZIP build path
- macOS unpacked app-directory build path
- `mas-dev` / `mas` electron-builder target wiring
- MAS entitlements configuration
- sandbox-aware folder linking behavior
- sandbox-aware bookmark restore / access logic already present in app code
- MAS build exclusion of bundled ffmpeg helper

## What still needs manual Apple setup

These parts are **not** automated by the repo alone:

1. Apple Developer Program membership
2. Matching App ID / bundle identifier setup in Apple Developer
3. Installed signing certificates in Keychain
   - `Apple Development` for `mas-dev`
   - `Apple Distribution` for `mas`
4. Provisioning profiles generated in Apple Developer and supplied via `PRODUCER_PLAYER_PROVISIONING_PROFILE`
5. App Store Connect app record / metadata / screenshots / review answers
6. Final submission packaging / upload workflow and App Review

## Important reality check

This repo is now **more buildable and more App Store-prepped**, but that does **not** mean:

- it has been submitted,
- it has passed App Review,
- it is signed and accepted for Mac App Store distribution,
- or that all runtime App Sandbox edge cases have been fully Apple-validated.

It means the codebase and packaging config are now in a much better place for Ethan to do the Apple-account-dependent steps.

## Relevant files

- `package.json`
- `scripts/build-mac.mjs`
- `build/entitlements.mas.plist`
- `build/entitlements.mas.inherit.plist`
- `apps/electron/scripts/build-main.mjs`
