![Producer Player app screenshot (live app capture)](docs/assets/readme/app-hero.png)

Producer Player is a desktop app for producers who keep exporting new passes and need one clear place to track versions, compare mixes, and keep album order locked.

The screenshot above is a real capture from the current app UI on `main`.

## What ships on `main` right now

- Version grouping by song (`Track v1`, `Track v2`, etc.) with archive-aware handling for older exports.
- Stable drag-and-drop album order that persists through rescans, restarts, and relink flows.
- Playback queue controls (play/pause, next/previous, repeat, scrub, volume) with per-song playhead continuity.
- Mastering + reference workspace (inline and full-screen) with measured loudness/peak stats, tonal balance, and sample-rate visibility.
- Quick A/B between current mix and reference track, including mix playhead restore after reference auditioning.
- Platform normalization preview presets (Spotify, Apple Music, YouTube, TIDAL) with headroom-aware gain limits.
- Playlist order JSON export/import (selection + ordering metadata included).
- Ordered latest-version export utility (`Export Latest`) for numbered, album-sequenced handoff folders.
- Per-song checklist workflow and persisted 1–10 rating slider.
- Built-in support links for bug reports and feature requests via GitHub issue templates.

## Public links

- Live page: <https://ethansk.github.io/producer-player/>
- Repository: <https://github.com/EthanSK/producer-player>
- Releases: <https://github.com/EthanSK/producer-player/releases>
- Desktop workflow: <https://github.com/EthanSK/producer-player/actions/workflows/release-desktop.yml>
- Pages workflow: <https://github.com/EthanSK/producer-player/actions/workflows/pages.yml>
- Security policy: [`SECURITY.md`](SECURITY.md)

## Release + download guidance

Current release model:

- `v0.1.0` exists as the baseline tagged release.
- Pushes to `main`/`master` publish rolling pre-release snapshots (`desktop-snapshot-*`) and mark them **Latest**.
- Snapshot assets include macOS, Linux, and Windows ZIP builds plus SHA-256 checksum files.

Still not claimed:

- Signed/notarized polished macOS distribution for general users.
- Mac App Store submission/approval.

Treat current downloads as preview builds while signing/notarization is still pending.

## Local development

```bash
npm install
npm run dev
```

## Build and test

```bash
npm run build
npm run typecheck
npm run e2e
npm run e2e:ci
```

## Desktop packaging

```bash
npm run build:mac
npm run build:mac:dir
npm run build:mac:mas-dev
npm run build:mac:mas
npm run release:desktop:linux
npm run release:desktop:win
```

- Release process notes: [`docs/RELEASING.md`](docs/RELEASING.md)
- Mac App Store packaging notes: [`docs/MAC_APP_STORE.md`](docs/MAC_APP_STORE.md)

## Repo layout

- `apps/electron` — Electron main process and preload bridge
- `apps/renderer` — React renderer UI
- `packages/contracts` — shared IPC/types
- `packages/domain` — folder scanning/grouping/order logic
- `apps/e2e` — Playwright desktop tests
- `site/` — GitHub Pages landing page

## License

This project is open source under the **MIT License**.
See [`LICENSE`](LICENSE) and [`docs/LICENSE_STATUS.md`](docs/LICENSE_STATUS.md).
