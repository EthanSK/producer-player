# Producer Player — Public vs local-only status

_Last updated: 2026-03-07_

## Public in this repository (ready to expose)

- Swift MVP source (`Sources/ProducerPlayer/**`)
- Electron + TypeScript cross-platform slice (`apps/**`, `packages/**`)
- Architecture and migration docs (`docs/**`)
- Landing page source for GitHub Pages (`site/**`)
- GitHub Actions workflows (`.github/workflows/**`)
- Demo media committed in repo (`site/assets/demo/producer-player-demo.mp4`)

## Local-only / not yet publicly resolved

- Remote repository URL is not configured in this local clone (`git remote -v` is empty)
- Published GitHub Pages URL is unknown until remote + Pages settings are enabled
- Hosted external demo URL (YouTube/Vimeo/etc.) not set yet
- Signed desktop installers for macOS/Windows are not produced yet (workflow scaffold exists only)

## What is needed next to fully publicize

1. Add Git remote for the repo.
2. Enable GitHub Pages with **GitHub Actions** as the source.
3. Push the repository and let `.github/workflows/pages.yml` publish the landing page.
4. Upload/host the demo video externally (optional), then replace:
   - `TODO_DEMO_VIDEO_URL` in `README.md`
   - `TODO_DEMO_VIDEO_URL` in `site/index.html`
5. Configure release signing secrets and packaging config, then upgrade `release-desktop.yml` from scaffold to production installers.
