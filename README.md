**Website: https://ethansk.github.io/producer-player/**

---

[![CI](https://github.com/EthanSK/producer-player/actions/workflows/ci.yml/badge.svg)](https://github.com/EthanSK/producer-player/actions/workflows/ci.yml)
[![Release](https://github.com/EthanSK/producer-player/actions/workflows/release-desktop.yml/badge.svg)](https://github.com/EthanSK/producer-player/actions/workflows/release-desktop.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

# Producer Player

A desktop app for music producers who keep exporting new passes and need one clear place to track versions, compare mixes, and keep album order locked.

![Producer Player](docs/assets/readme/app-hero.png)

## Features

- **Version Tracking** — Drag in a folder of bounces and Producer Player groups versions automatically (`Track v1`, `Track v2`, etc.), with archive-aware handling for older exports.
- **A/B Mastering Workspace** — Compare your master against reference tracks with measured loudness, peak stats, tonal balance, and sample-rate visibility. Quick A/B with mix playhead restore after reference auditioning.
- **Platform Normalization** — Hear what Spotify, Apple Music, YouTube, and TIDAL will do to your track with headroom-aware gain limits.
- **Album Ordering** — Drag and reorder songs into your album sequence. Order persists through rescans, restarts, and relink flows.
- **Checklists & Ratings** — Per-song checklist workflow and 1–10 rating slider to annotate and evaluate tracks.
- **Time-Stamped Checklist Notes** — Add a checklist item and it captures the exact playback position. Click the timestamp to jump right back.
- **Export Latest** — Exports the latest version of every song as numbered, album-sequenced files with ordering JSON for handoff.
- **Playback Controls** — Play/pause, next/previous, repeat, scrub, and volume with per-song playhead continuity.

## Tech Stack

| Layer | Tech |
|-------|------|
| Desktop shell | Electron 40 |
| Renderer | React + TypeScript |
| Build tooling | Vite, electron-builder |
| Testing | Playwright (E2E) |
| CI/CD | GitHub Actions |

Monorepo with npm workspaces:

```
apps/electron    — main process + preload bridge
apps/renderer    — React UI
apps/e2e         — Playwright desktop tests
packages/contracts — shared IPC types
packages/domain  — folder scanning, grouping, ordering logic
site/            — GitHub Pages landing page
```

## Getting Started

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev
```

## Build & Test

```bash
npm run build        # full production build
npm run typecheck    # type-check all workspaces
npm run e2e          # build + run Playwright tests
npm run e2e:ci       # CI-optimised E2E run
```

## Desktop Packaging

```bash
npm run build:mac              # macOS ZIP
npm run build:mac:dir          # macOS unpacked
npm run build:mac:mas-dev      # Mac App Store (dev)
npm run build:mac:mas          # Mac App Store (distribution)
npm run build:mac:mas:local    # MAS build with default profile/env override
npm run mas:preflight          # full submission preflight (includes upload tooling)
npm run mas:preflight:build    # build-only preflight (upload tooling is warning-level)
npm run mas:screenshots        # Generate ASC screenshot pack
npm run mas:upload             # Upload latest MAS .pkg via iTMSTransporter
npm run release:desktop:linux  # Linux ZIP
npm run release:desktop:win    # Windows ZIP
```

See [docs/RELEASING.md](docs/RELEASING.md), [docs/MAC_APP_STORE.md](docs/MAC_APP_STORE.md), and [docs/APP_STORE_CONNECT_CHECKLIST.md](docs/APP_STORE_CONNECT_CHECKLIST.md) for packaging/submission details.

## Downloads

Release versioning now uses a single source of truth: `package.json`.

Pushes to `main`/`master` publish macOS, Linux, and Windows ZIP builds plus SHA-256 checksums under:

- `v<package-version>` for the first release of that app version
- `v<package-version>-build.<run_number>` for additional builds of the same app version

> Current builds are unsigned preview releases. Signed/notarized macOS distribution and Mac App Store submission are pending.

**→ [Latest release](https://github.com/EthanSK/producer-player/releases)**

## Links

- [Website](https://ethansk.github.io/producer-player/)
- [Repository](https://github.com/EthanSK/producer-player)
- [Releases](https://github.com/EthanSK/producer-player/releases)
- [Security Policy](SECURITY.md)

## License

MIT — see [LICENSE](LICENSE).
