# Producer Player Cross-Platform Migration (Electron + TypeScript)

## Goal

Add a cross-platform desktop implementation while preserving the existing Swift MVP for validation and fallback testing.

## Why this structure

The new layout intentionally mirrors patterns from existing Ethan projects:

1. **`ai-find-words-in-videos` desktop shell pattern**
   - Reference: `desktop-shell/src/main.ts`
   - Borrowed ideas:
     - hardened BrowserWindow defaults (`contextIsolation`, `sandbox`, `nodeIntegration: false`)
     - `setWindowOpenHandler` deny policy
     - navigation guard to trusted origin/protocol
     - dev/prod renderer loading split

2. **`ai-music-video-studio` monorepo typing boundaries**
   - Reference: repo structure (`apps/*`, `libs/*`) + `tsconfig.base.json` path discipline
   - Borrowed ideas:
     - explicit package boundaries for shared models/contracts
     - no implicit cross-layer imports from renderer to domain internals
     - central contract package for typed IPC

## Implemented repository structure

```text
producer-player/
  apps/
    electron/        # Electron main + preload (IPC boundary)
    renderer/        # React/Vite UI shell
    e2e/             # Playwright desktop E2E tests
  packages/
    contracts/       # shared app contracts/types/channels
    domain/          # logical song model + folder watch/scan service
  Sources/ProducerPlayer/  # existing Swift MVP (retained)
  docs/
```

## Typed boundaries

- `@producer-player/contracts`
  - Source of truth for:
    - song/folder/version data contracts
    - snapshot payload
    - IPC channels
    - preload bridge interface
- `@producer-player/domain`
  - Depends on contracts only
  - Handles file walking, watch updates, and logical-song grouping skeleton
- `apps/electron`
  - Creates and owns `FileLibraryService`
  - Exposes only typed bridge methods to renderer via preload
- `apps/renderer`
  - Uses bridge + contract types only
  - Never imports Node APIs directly

## First runnable vertical slice implemented

- link watch folder (dialog + path input)
- persist linked folders in Electron user data state
- recursive scan of supported audio extensions (`wav`, `aiff`, `flac`, `mp3`, `m4a`)
- chokidar-based watch refresh on add/change/delete
- logical song grouping skeleton:
  - normalize stems (remove common version tokens)
  - group versions by normalized title
  - mark newest as active version
- tri-panel producer-player UI direction:
  - left watch folders + songs
  - center list w/ search + logical songs / versions toggle
  - right inspector with version history and status

## Migration path from Swift MVP

### Phase A (done)
- cross-platform shell + typed architecture + watch/link/song skeleton
- keep Swift MVP available unchanged

### Phase B (next)
- parity data engine: matching rules chain from Swift (`exact -> regex -> fuzzy -> fallback`)
- conflict/uncertain matching flow + user confirmation
- waveform + basic playback controls in Electron

### Phase C
- persistence layer for Electron implementation (SQLite or equivalent)
- auto-move-old behavior + folder-specific settings parity
- keyboard workflow parity

### Phase D
- packaging/signing lanes for macOS + Windows
- CI matrix + artifact publishing pipeline

## Why this de-risks migration

- Swift app remains the known-good baseline.
- Electron app grows in isolated typed layers.
- Contract-first approach prevents renderer/main drift.
- E2E coverage is added from day one to guard watch/link regressions.
