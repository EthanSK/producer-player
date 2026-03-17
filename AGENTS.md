# AGENTS.md — Producer Player Project Rules

## Screenshots & Video

**After any UI changes:** Always retake screenshots and update the Remotion video with the latest app version before considering the work done.

- Screenshot script: `scripts/take-screenshot.mjs` (uses Playwright Electron API, `enableLargerThanScreen: true` for test mode)
- Window size: use whatever is set in the script (currently ~1440×900, 16:10 ratio)
- Screenshots go to: `site/assets/screenshots/app-hero.png`, `app-hero-checklist.png`, `app-hero-readme.png`
- Remotion project: `/private/tmp/producer-player-remotion-video/projects/producer-player-explainer/`
- Copy latest screenshot to Remotion's `public/images/app-hero.png` before re-rendering
- Video outputs: `site/assets/video/producer-player-explainer.mp4` (full-res) + `producer-player-explainer-web.mp4` (720p web)
- `site/index.html` should reference the web version
- Always extract a poster frame: `site/assets/video/poster.jpg`

## Deploy Validation

- `site/styles.css` must exist (even if empty) for the GitHub Pages deploy workflow

## Feature Flags

- `apps/renderer/src/featureFlags.ts` — contains `SHOW_3000AD_BRANDING` (currently OFF)

## External URL Allowlist

- `apps/electron/src/main.ts` → `TRUSTED_EXTERNAL_URLS` array — add new trusted URLs here

## Data Storage

- Checklists + ratings: `localStorage` in renderer
- App state: `producer-player-electron-state.json` in userData
- iCloud backup: `~/Library/Mobile Documents/com~apple~CloudDocs/Producer Player/` (when enabled)

## Audio Analysis

- FFmpeg ebur128 for static file analysis (LUFS, true peak, dynamics)
- Web Audio API for real-time spectrum, level metering, band soloing
- Platform normalization values must be verified against authoritative sources before changing
