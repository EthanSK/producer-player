# Producer Player — Public vs local-only status

_Last updated: 2026-03-08_

## Public now

- Repository: <https://github.com/EthanSK/producer-player>
- Source code:
  - Swift MVP (`Sources/ProducerPlayer/**`)
  - Electron + TypeScript slice (`apps/**`, `packages/**`)
- Documentation + landing page source (`README.md`, `docs/**`, `site/**`)
- GitHub workflows (`.github/workflows/**`) for CI, Pages, and desktop prebuilt release
- Downloadable **unsigned desktop ZIP artifacts** from `.github/workflows/release-desktop.yml`
  - `Producer-Player-<version>-mac-<arch>.zip`
  - `Producer-Player-<version>-linux-<arch>.zip`
  - `Producer-Player-<version>-win-<arch>.zip`
  - checksum files: `*.zip.sha256`
- Tagged `v*` runs attach those assets to:
  - <https://github.com/EthanSK/producer-player/releases>

## Public URLs to use

- Release workflow page:
  - <https://github.com/EthanSK/producer-player/actions/workflows/release-desktop.yml>
- Releases page:
  - <https://github.com/EthanSK/producer-player/releases>
- Expected Pages URL:
  - <https://ethansk.github.io/producer-player/>

## Still pending / not yet public

- Developer ID signed + notarized macOS DMG builds
- Signed Windows installer builds
- Linux packages (AppImage/deb)
- Signing credentials/secrets in GitHub

## Honest fallback path

If signing is not configured, keep shipping unsigned desktop ZIP artifacts from CI so users can download and test immediately.
