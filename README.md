# Producer Player

Producer Player currently has **two implementations in the same repo**:

1. **Swift MVP (existing, kept intact)** for current macOS testing
2. **Electron + TypeScript vertical slice (new)** for cross-platform direction

The Swift app remains available and untouched for MVP validation while cross-platform packaging is built out.

---

## Download prebuilt desktop artifacts (no local build required)

You can now download CI-built desktop artifacts directly from GitHub.

### GitHub Actions artifacts (manual + tag runs)

- Workflow file: [`.github/workflows/release-desktop.yml`](.github/workflows/release-desktop.yml)
- Workflow page: `https://github.com/EthanSK/producer-player/actions/workflows/release-desktop.yml`

Each workflow run uploads prebuilt artifacts:

- **macOS:** `Producer Player-<version>-mac-<arch>.zip`
- **Windows:** `Producer Player-<version>-win-<arch>.exe` and `.zip`
- **Linux:** `Producer Player-<version>-linux-<arch>.AppImage` and `.tar.gz`

### GitHub Releases assets (tag pushes)

Push a tag that matches `v*` (for example `v0.1.0`) and the same artifacts are attached to a GitHub Release.

- Releases page: `https://github.com/EthanSK/producer-player/releases`

> Current artifacts are built for immediate testability and are **not Developer ID signed/notarized**.
> See [`docs/RELEASING.md`](docs/RELEASING.md) for optional signing secret names and rollout steps.

---

## Demo video

- **Current in-repo demo clip:** [`site/assets/demo/producer-player-demo.mp4`](site/assets/demo/producer-player-demo.mp4)
- **Hosted public demo URL:** `https://ethansk.github.io/producer-player/assets/demo/producer-player-demo.mp4`

### Demo link strategy

This repo keeps both:

1. an in-repo demo asset (`site/assets/demo/producer-player-demo.mp4`), and
2. a hosted GitHub Pages URL for easy sharing:
   - `https://ethansk.github.io/producer-player/assets/demo/producer-player-demo.mp4`

---

## Public packaging status

For an explicit breakdown of what is public now vs still local-only, see:

- [`docs/PUBLIC_STATUS.md`](docs/PUBLIC_STATUS.md)

---

## GitHub Pages landing page

A polished static landing page is included in:

- `site/index.html`
- `site/styles.css`
- `site/assets/**`

### Deploying the landing page

Workflow included:

- `.github/workflows/pages.yml`

This workflow deploys `site/` to GitHub Pages using the official Pages actions.

> Live Pages URL: `https://ethansk.github.io/producer-player/`

---

## GitHub Actions workflows

- **CI checks/build:** `.github/workflows/ci.yml`
  - Node workspace install + typecheck + build
  - Swift MVP build on macOS
- **GitHub Pages deploy:** `.github/workflows/pages.yml`
  - Uploads `site/` as Pages artifact and deploys
- **Desktop prebuilt releases:** `.github/workflows/release-desktop.yml`
  - Builds downloadable desktop artifacts on macOS/Windows/Linux
  - Uploads artifacts for every workflow run
  - On `v*` tags, attaches artifacts to GitHub Releases

---

## Release notes + changelog process

- Release automation categories: [`.github/release.yml`](.github/release.yml)
- Release notes template + first release checklist: [`docs/RELEASING.md`](docs/RELEASING.md)
- Changelog file: [`CHANGELOG.md`](CHANGELOG.md)

---

## 1) Swift MVP (existing)

SwiftUI + AVFoundation + SQLite implementation for producer re-render workflows.

### Run

```bash
cd /Users/ethansk/Projects/producer-player
swift build
swift run ProducerPlayer
```

---

## 2) Electron + TypeScript (cross-platform workstream)

Monorepo-ish workspace with typed boundaries:

- `apps/electron` → Electron main + preload process
- `apps/renderer` → React + Vite desktop UI
- `packages/contracts` → shared types + IPC contracts
- `packages/domain` → folder scan/watch + logical song model skeleton
- `apps/e2e` → Playwright E2E tests for desktop shell happy path

### What the current vertical slice includes

- Folder linking (dialog + direct path input)
- Folder watch + auto refresh on export changes
- Logical song grouping skeleton (normalization + versions)
- Tri-panel UI direction:
  - left: watch folders + song shortcuts
  - middle: library list with search and songs/versions toggle
  - right: inspector with version history + status
- Typed IPC bridge and shared contracts package

### Run (Electron dev)

```bash
cd /Users/ethansk/Projects/producer-player
npm install
npm run dev
```

This starts renderer + Electron together.

### Build

```bash
npm run build
```

### Typecheck

```bash
npm run typecheck
```

### E2E

```bash
npm run e2e
npm run e2e:ci
```

---

## Architecture + migration docs

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/CROSS_PLATFORM_MIGRATION.md`](docs/CROSS_PLATFORM_MIGRATION.md)
- [`docs/E2E.md`](docs/E2E.md)
- [`docs/PUBLIC_STATUS.md`](docs/PUBLIC_STATUS.md)
