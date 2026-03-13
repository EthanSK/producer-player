# Releasing Producer Player

This repo now ships downloadable prebuilt desktop artifacts via:

- `.github/workflows/release-desktop.yml`
- Rolling pre-release snapshots on pushes to `main` / `master`
- Versioned GitHub Releases on `v*` tags

## What the workflow currently publishes

Unsigned desktop artifacts for immediate testability:

- `Producer-Player-<version>-mac-<arch>.zip`
- `Producer-Player-<version>-linux-<arch>.zip`
- `Producer-Player-<version>-win-<arch>.zip`
- matching checksum files: `*.zip.sha256`

Release behavior by trigger:

- Push to `main`/`master` → builds all desktop targets, uploads run artifacts, and updates a rolling prerelease tag (`desktop-main-latest` or `desktop-master-latest`).
- Push tag `v*` → builds all desktop targets and publishes a versioned GitHub Release for that tag.

> Current default is intentionally unsigned/not notarized.

## First release (recommended path)

1. Update `CHANGELOG.md`:
   - Move important entries from `Unreleased` into a versioned section with a date.
2. Commit and push your changes to `main`.
3. Create and push a release tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

4. Open the release workflow run or Releases page:
   - Actions workflow: <https://github.com/EthanSK/producer-player/actions/workflows/release-desktop.yml>
   - Releases: <https://github.com/EthanSK/producer-player/releases>
5. Verify assets are attached and downloadable.
6. Edit release notes using `.github/RELEASE_NOTES_TEMPLATE.md` as the baseline.

## Manual artifact run (no tag)

Use **Run workflow** on:

- <https://github.com/EthanSK/producer-player/actions/workflows/release-desktop.yml>

If run on `main`/`master`, it also refreshes the rolling snapshot prerelease. On other branches, download artifacts from that run directly.

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
```

- `build:mac` → unsigned ZIP
- `build:mac:dir` → unpacked mac app directory
- `build:mac:mas-dev` → Mac App Store development build
- `build:mac:mas` → Mac App Store distribution-oriented build

For App Store-oriented builds, set:

```bash
export PRODUCER_PLAYER_PROVISIONING_PROFILE=/absolute/path/to/profile.provisionprofile
```

If electron-builder cannot choose the correct signing identity automatically, also set `CSC_NAME`.

See [`docs/MAC_APP_STORE.md`](./MAC_APP_STORE.md) for the exact current status and manual Apple-account work that still remains.

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
