# Releasing Producer Player

This repo now ships downloadable prebuilt desktop artifacts via:

- `.github/workflows/release-desktop.yml`
- GitHub Releases on `v*` tags

## What the workflow currently publishes

Unsigned artifacts for immediate testability:

- macOS: zipped `.app` bundle (`*-mac-*.zip`)
- Windows: portable `.exe` + zipped app bundle (`*-win-*.*`)
- Linux: `.AppImage` + `.tar.gz` (`*-linux-*.*`)

> Current default is intentionally unsigned/not notarized.

## First release (recommended path)

1. Update `CHANGELOG.md`:
   - Move important entries from `Unreleased` into a new `0.1.0` section with a date.
2. Commit and push your changes to `main`.
3. Create and push a release tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

4. Open the release workflow run or Releases page:
   - Actions workflow: `https://github.com/EthanSK/producer-player/actions/workflows/release-desktop.yml`
   - Releases: `https://github.com/EthanSK/producer-player/releases`
5. Verify assets are attached and downloadable.
6. Add/edit release notes using `.github/RELEASE_NOTES_TEMPLATE.md` as needed.

## Manual artifact run (no tag)

Use **Run workflow** on:

- `https://github.com/EthanSK/producer-player/actions/workflows/release-desktop.yml`

Then download artifacts from that run directly.

## Release notes/changelog guidance

- Keep `CHANGELOG.md` human-maintained and user-facing.
- Use `.github/release.yml` to shape auto-generated GitHub release notes.
- Use `.github/RELEASE_NOTES_TEMPLATE.md` when writing/editing custom release notes.

## Optional signing configuration (not required for current unsigned flow)

If you later enable signing/notarization, configure these GitHub repository secrets:

- `CSC_LINK` — macOS code-signing certificate (.p12), base64 or file URL format supported by electron-builder
- `CSC_KEY_PASSWORD` — password for `CSC_LINK`
- `APPLE_ID` — Apple ID email used for notarization
- `APPLE_APP_SPECIFIC_PASSWORD` — app-specific password for notarization
- `APPLE_TEAM_ID` — Apple Developer Team ID
- `WIN_CSC_LINK` — Windows signing certificate
- `WIN_CSC_KEY_PASSWORD` — password for `WIN_CSC_LINK`

Unsigned fallback path (today): keep `CSC_IDENTITY_AUTO_DISCOVERY=false` in CI and run release workflow as-is.
