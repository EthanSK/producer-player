# Producer Player — Public vs local-only status

_Last updated: 2026-03-07_

## Public now

- Public repo: `https://github.com/EthanSK/producer-player`
- Public GitHub Pages site: `https://ethansk.github.io/producer-player/`
- Public demo URL: `https://ethansk.github.io/producer-player/assets/demo/producer-player-demo.mp4`
- Swift MVP source (`Sources/ProducerPlayer/**`)
- Electron + TypeScript slice (`apps/**`, `packages/**`)
- Docs (`docs/**`)
- Landing page source (`site/**`)
- GitHub Actions workflows (`.github/workflows/**`)

## Local-only / still pending

- Signed desktop installers for macOS/Windows/Linux are not produced yet (release scaffold exists).
- Any machine-local test artifacts outside repo (workspace artifacts, temp captures) are not public.

## Next steps to harden public release

1. Add release signing/secrets and finalize `release-desktop.yml` for real installers.
2. Create first tagged release (`v0.1.0`) to validate release workflow end-to-end.
3. Optionally host the demo video on YouTube/Vimeo as a secondary marketing link.
