# Producer Player MVP Checklist

## Product brief coverage

- [x] macOS app scaffold in Swift + SwiftUI
- [x] AVFoundation playback integration
- [x] SQLite persistence layer
- [x] Watch-folder based library
- [x] Supported formats (`wav`, `aiff`, `flac`, `mp3`, `m4a`)
- [x] Logical songs separate from file versions
- [x] Match pipeline (exact -> regex -> fuzzy -> new)
- [x] Per-song version history with latest active by default
- [x] Gapless-style queue playback
- [x] Instant reload path via folder watcher + rescans
- [x] Keyboard shortcuts for auditioning
- [x] Finder drag-and-drop support
- [x] Re-render notifications
- [x] Left sidebar (watch folders + songs)
- [x] Main list (songs/versions + export info)
- [x] Right panel (version history + waveform)
- [x] Quick fuzzy search
- [x] Toggle logical songs vs versions
- [x] Background indexing + incremental scans
- [x] Uncertain match confirmation dialog + training feedback
- [x] Linked directory behavior with Album grouping
- [x] Stale entry removal on source deletion
- [x] Auto-move old versions toggle (default ON)
- [x] Default archive target `old/` per album root

## Docs & project hygiene

- [x] README with build/run instructions
- [x] docs/ARCHITECTURE.md
- [x] docs/ROADMAP.md
- [x] docs/MVP_CHECKLIST.md
- [x] PLAN.md canonical project log

## Build verification

- [x] `swift build` passes locally
