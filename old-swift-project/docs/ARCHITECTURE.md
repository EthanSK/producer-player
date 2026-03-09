# Producer Player Architecture (MVP)

## Stack

- **Language/UI:** Swift + SwiftUI
- **Playback:** AVFoundation (`AVQueuePlayer`)
- **Persistence:** SQLite (`SQLite3` C API)
- **Notifications:** UserNotifications

## High-level flow

1. User links a watch directory (Album).
2. `FolderWatcher` triggers scans on file activity.
3. `FileScanner` performs incremental scan against `file_index` table.
4. New/changed files are matched to logical songs via `MatchingEngine`.
5. `LibraryRepository` writes songs/versions and updates active version state.
6. UI refreshes from SQLite-backed view models.

## Core components

### 1) `LibraryRepository` (actor)

Central data layer for:

- Schema bootstrap
- Album CRUD + per-album settings
- Song and version lifecycle
- Active version switching
- File index for incremental scans
- Regex rules and matcher training feedback
- Stale cleanup when source files disappear

### 2) `FileScanner` (actor)

Responsibilities:

- Enumerates supported audio files
- Compares file metadata against `file_index`
- Routes each candidate through `MatchingEngine`
- Creates songs/versions through repository
- Emits uncertain matches for user confirmation
- Triggers re-render callbacks and stale-entry cleanup

### 3) `MatchingEngine`

Deterministic priority chain:

1. trained feedback match
2. exact normalized filename
3. regex extraction/transforms
4. fuzzy similarity (Levenshtein)
5. fallback new song

If confidence is ambiguous, returns `.uncertain(...)` to trigger confirmation UI.

### 4) `FolderWatcher`

- Uses `DispatchSourceFileSystemObject`
- Watches linked album directories
- Debounces rapid event bursts
- Invokes rescans on changes

### 5) `LibraryViewModel`

Main app orchestration:

- Bridges scanner/repository with SwiftUI
- Handles drag/drop and folder picking
- Maintains current filters and selection
- Resolves pending uncertain matches
- Controls playback and waveform loading

### 6) Playback + waveform services

- `AudioPlaybackService` uses `AVQueuePlayer` and pre-enqueued items for gapless-ish auditioning.
- `WaveformService` decodes audio samples and downsamples into display buckets.

## Data model summary

- `albums` — watch-folder groups (Album), auto-move toggle
- `songs` — logical song entities (per album)
- `versions` — render history for each song
- `file_index` — incremental scan state (path, size, mtime)
- `regex_rules` — per-album regex match rules
- `matcher_feedback` — user-confirmed match training

## Linked directory behavior implementation

- Dragging files from a new directory creates a new Album sidebar group.
- Album state is independent by `album_id` in all song/version tables.
- Deletions from source folders are reflected via stale cleanup.
- Auto-archive of prior active versions uses `<album>/old/` by default.
