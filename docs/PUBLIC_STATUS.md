# Producer Player — Public vs local-only status

_Last updated: 2026-03-07_

## Public now

- Public repo: `https://github.com/EthanSK/producer-player`
- Public GitHub Pages site: `https://ethansk.github.io/producer-player/`
- Public demo URL: `https://ethansk.github.io/producer-player/assets/demo/producer-player-demo.mp4`
- Swift MVP source (`Sources/ProducerPlayer/**`)
- Electron + TypeScript slice (`apps/**`, `packages/**`)
- Docs (`docs/**`) and landing page source (`site/**`)
- GitHub Actions workflows (`.github/workflows/**`)
- Downloadable prebuilt desktop artifacts from `.github/workflows/release-desktop.yml`:
  - macOS zipped app bundle
  - Windows portable `.exe` + zipped bundle
  - Linux `.AppImage` + `.tar.gz`
- Tag-based `v*` runs publish the same artifacts to `https://github.com/EthanSK/producer-player/releases`

## Local-only / still pending

- Developer ID signing + notarization for macOS is not configured.
- Windows code-signing is not configured.
- Any machine-local test artifacts outside this repo remain private.

## Next steps to harden public release

1. Add signing/notarization secrets (see `docs/RELEASING.md`) and enable signed builds when desired.
2. Create first public tag release (`v0.1.0`) to publish release assets from CI.
3. Optionally host the demo video on YouTube/Vimeo as a secondary marketing link.
