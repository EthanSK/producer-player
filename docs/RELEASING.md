# Releasing Producer Player

This repo ships downloadable desktop artifacts via:

- `.github/workflows/release-desktop.yml`
- GitHub Releases (macOS/Linux/Windows ZIPs + SHA-256 checksums)

## Version source of truth

`package.json` remains the source of truth for the **semantic app version** (for example `2.0.0`).

Builds now embed an automatic build identifier so each push can produce a newer in-app version string without hand-editing `package.json`:

- `build.<n>` where `<n>` comes from `PRODUCER_PLAYER_BUILD_NUMBER` (in CI this is `github.run_number`)
- short commit SHA suffix when available

In-app display format: `<semver>+build.<n>.<sha>` (for example `2.0.0+build.412.9d2ab7f4c1a2`).

## What the workflow publishes

Unsigned desktop artifacts for immediate testability:

- `Producer-Player-<version>-mac-<arch>.zip`
- `Producer-Player-<version>-linux-<arch>.zip`
- `Producer-Player-<version>-win-<arch>.zip`
- matching checksum files: `*.zip.sha256`

Release behavior by trigger:

- Push to `main`/`master`:
  - If `v<package-version>` does **not** exist yet, publishes that canonical tag/release.
  - If it already exists, publishes `v<package-version>-build.<run_number>`.
- Push tag `v*`:
  - Builds and publishes that exact tag, as long as the tag version matches `package.json` (directly or with a build suffix).

> Current default is intentionally unsigned/not notarized.

## Recommended release flow

1. Keep `package.json` semver at the current milestone unless you intentionally want a new semantic release.
   - Bump when appropriate (optional on routine pushes):

```bash
npm run version:bump:patch
# or
npm run version:bump:minor
```

2. Run version consistency checks locally:

```bash
npm run version:check
```

3. Commit and push to `main`.
4. Let the workflow publish:
   - First build for that semver → `v<package-version>`
   - Additional builds for the same semver → `v<package-version>-build.<run_number>`

Routine pushes no longer require a manual semver bump just to move the in-app version forward.

Optional explicit tag path:

```bash
git tag v2.0.0
git push origin v2.0.0
```

## Manual artifact run (no release publish)

Use **Run workflow** on:

- <https://github.com/EthanSK/producer-player/actions/workflows/release-desktop.yml>

Workflow runs outside `main`/`master` still build/upload artifacts, but release publish is restricted to `main`/`master` and tags.

## Release notes/changelog guidance

- Keep `CHANGELOG.md` human-maintained and user-facing.
- Use `.github/release.yml` to shape auto-generated GitHub release notes (optional).
- Use `.github/RELEASE_NOTES_TEMPLATE.md` when writing/editing custom release notes.

## Local macOS build scripts

From the repo root:

```bash
npm run build:mac
npm run build:mac:dir
npm run build:mac:mas-dev
npm run build:mac:mas
npm run build:mac:mas:local
npm run mas:preflight
npm run mas:preflight:build
npm run mas:screenshots
npm run mas:upload
```

- `build:mac` → unsigned ZIP
- `build:mac:dir` → unpacked mac app directory
- `build:mac:mas-dev` → Mac App Store development build
- `build:mac:mas` → Mac App Store distribution-oriented build
- `build:mac:mas:local` → runs build-mode preflight, then MAS build
- `mas:preflight` → full submission readiness (includes upload-tool requirement)
- `mas:preflight:build` → build readiness only (upload tool becomes warning-level)
- `mas:screenshots` → generate App Store Connect screenshot pack
- `mas:upload` → upload MAS `.pkg` to App Store Connect via iTMSTransporter

For App Store-oriented builds, set:

```bash
export PRODUCER_PLAYER_PROVISIONING_PROFILE=/absolute/path/to/profile.provisionprofile
```

If electron-builder cannot choose the correct signing identity automatically, also set `CSC_NAME`.

See [`docs/MAC_APP_STORE.md`](./MAC_APP_STORE.md) and [`docs/APP_STORE_CONNECT_CHECKLIST.md`](./APP_STORE_CONNECT_CHECKLIST.md) for current status and Apple-account steps.

## Optional signing configuration (not required for current unsigned flow)

If you later enable signing/notarization for outside-the-store distribution, configure these GitHub repository secrets:

- `CSC_LINK` — macOS code-signing certificate (.p12), base64 or file URL format supported by electron-builder
- `CSC_KEY_PASSWORD` — password for `CSC_LINK`
- `APPLE_ID` — Apple ID email used for notarization
- `APPLE_APP_SPECIFIC_PASSWORD` — app-specific password for notarization
- `APPLE_TEAM_ID` — Apple Developer Team ID

Unsigned fallback path (today): keep `CSC_IDENTITY_AUTO_DISCOVERY=false` in CI and run the existing unsigned release workflow as-is.

## Planned next packaging targets (not yet enabled)

- Signed/notarized macOS DMG outside the App Store
- Signed Windows installer (NSIS/MSIX)
- Linux packages (AppImage/deb)
