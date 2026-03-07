# Producer Player

Producer Player currently has **two implementations in the same repo**:

1. **Swift MVP (existing, kept intact)** for current macOS testing
2. **Electron + TypeScript vertical slice (new)** for cross-platform direction

The Swift app remains available and untouched for MVP validation while cross-platform packaging is built out.

---

## Demo video

- **Current in-repo demo clip:** [`site/assets/demo/producer-player-demo.mp4`](site/assets/demo/producer-player-demo.mp4)
- **Hosted public demo URL (to add):** `TODO_DEMO_VIDEO_URL`

### Demo link strategy

To avoid inventing URLs, this repo uses a two-step strategy:

1. Keep a working local/in-repo demo asset committed for immediate reference.
2. After upload to a public host (YouTube/Vimeo/GitHub Release), replace `TODO_DEMO_VIDEO_URL` in:
   - this `README.md`
   - `site/index.html` (landing page)

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

> Note: this local clone currently has no remote configured (`git remote -v` is empty), so a real public URL cannot be provided yet.

---

## GitHub Actions workflows

- **CI checks/build:** `.github/workflows/ci.yml`
  - Node workspace install + typecheck + build
  - Swift MVP build on macOS
- **GitHub Pages deploy:** `.github/workflows/pages.yml`
  - Uploads `site/` as Pages artifact and deploys
- **Desktop release scaffold (optional):** `.github/workflows/release-desktop.yml`
  - Builds project and uploads a draft archive scaffold
  - Tag push (`v*`) can create a draft prerelease

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
