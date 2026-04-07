# Producer Player — PLAN

## Project

- **Name:** Producer Player
- **Repo:** [github.com/EthanSK/producer-player](https://github.com/EthanSK/producer-player)
- **Version:** 2.58 (two-part versioning: `x.y`)
- **License:** PolyForm Noncommercial 1.0.0 (changed from MIT on 2026-03-26)
- **Stack:** Electron + TypeScript monorepo (renderer: React/Vite, main: esbuild, domain: shared package, e2e: Playwright)
- **Goal:** Desktop app for music producers to manage album track versions, ordering, mastering analysis, and export — all from a single window.
- **Website:** GitHub Pages landing page with explainer video, screenshots, and download links.

---

## Current State (as of 2026-03-31)

The app is fully functional and publicly downloadable. macOS universal builds ship via GitHub Releases with auto-update support (electron-updater). Linux and Windows CI smoke tests run, but primary target is macOS. The app is NOT on the Mac App Store yet (signing/provisioning pending).

### Architecture

```
producer-player/
  apps/
    electron/       — main process (media protocol, IPC, state service, ffmpeg analysis)
    renderer/       — React UI (App.tsx, styles.css, feature flags, agent panel)
    e2e/            — Playwright Electron E2E tests (50+ tests)
  packages/
    domain/         — song model, file library service, matcher logic
    contracts/      — shared TypeScript types + IPC channel definitions
  site/             — GitHub Pages landing page (index.html, screenshots, video)
  scripts/          — build helpers, screenshot capture, icon generation
  assets/           — app icon (Queue Halo), marketing assets
  swift-mvp/        — original Swift prototype (archived, not maintained)
```

### Data Storage

- **Primary:** Unified state file (`producer-player-user-state.json` in appData) containing ALL user data: ratings, checklists, project file paths, album metadata, reference tracks, agent settings, preferences, linked folders, song order.
- **Legacy:** Two older files (`producer-player-electron-state.json`, `producer-player-shared-user-state.json`) still written alongside for backward compatibility.
- **iCloud backup:** `~/Library/Mobile Documents/com~apple~CloudDocs/Producer Player/` — automatic backup of unified state.
- **Per-folder sidecar:** `<linked-folder>/.producer-player/order-state.json` for ordering recovery after app reinstall.
- **Renderer localStorage:** Fast local cache only; all writes also sync to unified state file. See AGENTS.md for critical data storage rules.

---

## Done (features shipped and verified)

### Core Playback & Library (Mar 6-9)
- Folder linking with watch/rescan + top-level-only scan (ignores nested dirs except `old/`)
- Song identity matching via exact filename + v-suffix normalization (`v1`, `v2`, etc., with or without space)
- Real playback transport: play/pause/stop/seek/repeat (Off/One/All), volume slider
- Custom `producer-media://` Electron protocol with MIME mapping + byte-range support
- Drag-and-drop track reordering with insertion preview + persisted order across sessions
- Per-song playhead memory (session-only, resets on near-end/finish)
- Previous/back button: first press restarts current track, second press goes to previous
- Double-click song row to play immediately
- Global Space shortcut for play/pause; macOS media key support (play/pause, next, prev)
- Global left/right arrow keys for 5-second seek
- +5s/-5s and +1s/-1s skip buttons on transport
- Search across tracks and older versions (matches filename + path + extension)
- Multi-watch-folder support with sidebar folder switching
- Raw/unmodified audio playback (no hidden DSP/normalization; AIFF container prep only via ffmpeg)
- Supported formats: WAV, MP3, FLAC, M4A, AAC, OGG, OPUS, AIFF (via ffmpeg prep to WAV)
- Unlink confirmation dialog with data safety warning

### Auto-Organize & Versioning (Mar 7-9)
- Auto-organize toggle (default ON): moves old versions to `old/` subfolder
- "Organize" button for manual trigger
- Version history in inspector showing archived versions from `old/` folder
- `old/`-only files appear in version history but NOT in album list
- Naming guidance under folder picker: "File names must end with v1, v2, v3" with emoji info icon
- Version-suffix enforcement: filenames without `vN` suffix are accepted but naming convention is documented

### UI / UX Polish (Mar 7-11)
- Album header with track count and total duration
- Song-row title/metadata separation: title on left, `vN . FORMAT` pill on right
- Track numbering in album list
- Per-song 1-10 rating slider (persisted)
- Tooltips on all buttons and checkbox controls
- Status card in sidebar with user-facing states (Ready/Updating/Needs attention)
- Sidebar: centered "Add Folder" button as primary control
- Open in Finder using default Electron shell behavior
- Error boundary component for improved error handling

### Mastering & Analysis (Mar 10 - Apr 5)
- **Bottom-left mastering panel** with compact + fullscreen expanded views
- **FFmpeg-measured loudness stats:** integrated LUFS, LRA (dynamics range), true peak, sample peak, max short-term, max momentary, mean volume
- **Real-time spectrum analyzer** with interactive band soloing (click to solo, shift+click to exclude) + freeze on stop
- **Real-time level meter** aligned with mini spectrum
- **Tonal balance** visualization (low/mid/high)
- **Reference track workflow:** choose external file, use current track as reference, clear reference, saved references per song, recent references
- **Quick A/B audition:** Mix vs Reference playback switching with playhead restore
- **Platform normalization preview:** Spotify, Apple Music, YouTube, Tidal — applied dB change, projected LUFS, headroom/limit, preview on/off toggle (defaults OFF)
- **Level match** between mix and reference
- **Draggable/reorderable mastering panels** (persisted layout)
- **Advanced fullscreen visualizations:** spectrum, waveform, stereo correlation, vectorscope, mid/side monitoring, mid/side spectrum, K-metering, crest factor history, loudness histogram, loudness history, spectrogram, pro indicators
- **Interactive crosshair** with axis value display on all charts
- **Axis labels** on all analysis visualizations
- **HelpTooltip components** with click-to-open modals, beginner-friendly explanations, and YouTube tutorial links
- **Mastering checklist summary** in fullscreen
- **Ask AI actions** per mastering panel (sends context to agent)
- **Spectrum hover** showing Hz + dB values

### EQ System (Apr 4-8)
- **Per-band EQ gain sliders** on spectrum analyzer (horizontal sliders)
- **Smooth combined EQ curve** overlay on spectrum
- **EQ on/off toggle**
- **EQ snapshots:** save, load, restore named EQ presets
- **Per-track EQ state** (stored per-song in unified state)
- **Per-source EQ state** for A/B comparison (separate EQ for mix vs reference)
- **EQ'd tonal balance preview** toggle
- **AI-recommended EQ curve** based on track analysis + reference comparison
- **Reference difference EQ overlay** showing EQ delta between mix and reference
- **EQ bypassed for reference playback** (so reference plays unmodified)
- **Platform normalization applied for reference** comparison accuracy
- **EQ snapshots migrated** to unified state file
- **Cmd+R shortcut** for toggling reference playback
- **R key shortcut** for quick reference toggle

### Checklist System (Mar 16-24)
- **Per-song checklist** with multi-line textarea items that auto-grow
- **Playback-position timestamps** captured on checklist items ("Set now" button)
- **Timestamp preview** next to input, clickable to seek
- **Checklist mini-player** with transport controls (play/pause, skip +/-5s, +/-1s)
- **Checklist modal** with keyboard navigation (Shift+Tab focus loop, Escape to close after blur)
- **Checklist items** ordered newest-first, with version numbers captured in history
- **Confirm clearing** completed checklist items
- **Delete All** with Shift+click developer mode
- **Click-outside-close** behavior
- **Checklist button** on transport bar
- **Checklist navigation buttons** in fullscreen mastering
- **Typing capture** does not interfere with playback position
- **Checklist visibility fades** by remaining todos

### Per-Song Project Links (Mar 26)
- Set, open, and clear project file path per song (e.g., link to DAW project file)

### Agent Chat Panel ("Produciboi") (Mar 25 - Apr 8)
- **Full agent chat panel** integrated with Claude CLI
- **Gated behind default-off feature flag** (agent features)
- **Full-access system prompt** for producer-specific assistance
- **Agent notification badge** for new messages
- **Per-track AI recommendations** for EQ and mastering
- **Chat history persistence** (v2 persistence model with autosave)
- **Settings panel** (scrollable, no reset button per Ethan's request)
- **One-time first-launch auto-open** onboarding
- **Streaming handling** with steer-send while streaming
- **AssemblyAI voice transcription** in agent chat
- **Ask AI actions** from mastering panel context

### Album Art & Metadata (Mar 25 - Apr 3)
- **Album art upload** and editable album title in main panel header
- **Album art fullscreen preview** on hover
- **PSD album art support** via Shift+click
- **Album art color profile** fix

### Auto-Update System (Apr 5)
- **electron-updater** integration: checks for updates, downloads, and installs without opening browser
- **Auto-update toggle** in UI with dismissible banner
- **Version comparison** handles two-part format and equal versions
- **SIGKILL escalation** and force-exit timeouts to prevent app freeze on quit

### Unified State & Data Management (Apr 5)
- **Unified user state file** (`producer-player-user-state.json`) with schema versioning
- **Automatic migration** from legacy localStorage + old state files on first launch
- **Full import/export** via save/load dialogs
- **iCloud Drive backup** for checklists, ratings, preferences, and unified state
- **Folder-based export/import** with localStorage dump
- **Show button** to reveal iCloud backup folder in Finder
- **Robust localStorage migration** with logging and retry on failure
- **API key storage** via obfuscated file (replaced safeStorage/keychain approach)

### Playlist Export/Import (Mar 9)
- Compact export/import icon buttons in album header
- Typed `producer-player.playlist-order` v1 JSON contract
- Round-trip export/import with song order, metadata, and selection state
- Ordered latest-version export utility

### Voice Input (Apr 3)
- **Voice input UX overhaul** for agent chat
- **App logging system** for debugging

### Dev Experience & CI (ongoing)
- Hot reload dev workflow with Vite HMR + esbuild watch (disabled by default in dev)
- VS Code settings to disable Swift LSP
- Auto-generated release notes from commits
- Two-part versioning (x.y) with CI-enforced version bumps
- Pre-push and CI version bump checks
- Cross-platform CI: macOS primary, Linux + Windows smoke tests
- CodeQL security scanning
- Dependabot (disabled)
- 50+ Playwright E2E tests covering core flows, edge cases, and break tests
- Screenshot script (`scripts/take-screenshot.mjs`) and Remotion explainer video pipeline

### Website & Marketing (Mar 8 - Apr 3)
- GitHub Pages landing page with SEO metadata, schema.org JSON-LD
- Explainer video (multiple iterations, current: psychedelic purple theme, 60fps)
- Screenshot gallery with lightbox
- Feature cards with producer-focused copy
- Download buttons linked to latest GitHub release
- "by 3000 AD" branding behind feature flag (OFF by default)
- Tutorial video links in help modals

### Icon
- **Queue Halo** icon selected and shipped (from ordering-focused round-2 refinement set)

### Release & Packaging (Mar 7 - Apr 5)
- GitHub Actions release workflow: macOS universal build, ZIP artifact, SHA-256 checksums
- macOS code signing and notarization infrastructure added (not yet active — needs Apple Developer account assets)
- MAS preflight tooling and App Store submission docs
- npm scripts: `build:mac`, `build:mac:dir`, `build:mac:mas-dev`, `build:mac:mas`, `build:mac:app-store`
- Rolling snapshot releases on main pushes
- Auto version bumping on releases

### Security & Repo Hygiene
- `SECURITY.md` added
- GitHub issue templates (bug report, feature request)
- External URL allowlist for trusted links
- Support & Feedback card under inspector
- PolyForm Noncommercial license (changed from MIT 2026-03-26)
- `/artifacts/` in `.gitignore`

---

## Known Issues / Bugs

1. **Drag-and-drop occasional flicker:** Mostly resolved but minor visual jitter can still appear during fast drags (hysteresis + stabilized hover target tracking applied).
2. **Finder open Spaces behavior:** Open in Finder uses default Electron shell behavior; cannot force same-Space Finder window (OS limitation).
3. **Files without version suffix appear in list:** The naming guide says "must end with v1, v2, v3" but the scan does NOT enforce this strictly — files without version suffix still appear as tracks. This may be intentional leniency (documented behavioral gap).
4. **AIFF playback:** Requires ffmpeg container prep to WAV; not direct playback. Codec availability is Chromium-dependent for other formats.
5. **Mastering analysis latency:** FFmpeg-based static analysis can take a few seconds per track; real-time analysis is faster but labeled as "preview estimates."

---

## Deferred / Planned

### Architecture-Sized Items
- **Custom VST/AU monitoring-chain support:** Requires a native plugin-host/audio-engine bridge for real-time third-party plugin hosting. Not a quick patch. (Deferred since Mar 11)
- **Detached/new-window analysis surface:** Currently the mastering overlay is in-window; true multi-window support would be a separate surface.

### Mac App Store Submission
- Repo-level packaging prep is done (entitlements, sandbox support, MAS config).
- **Blocked on:** Apple Developer account provisioning profiles and signing certificates from Ethan.
- MAS preflight checks and documentation are ready.

### Mastering Depth
- **Persisted multi-reference library management** across launches (recents, saved sets, project-scoped defaults) — partially done with recent references.
- **True one-click audition A/B transport** with synced playhead/loop compare and gain-matched reference playback.
- **More mastering-grade timeline/meters** beyond current measured snapshots + estimated live overlays.
- **Platform target presets** and normalization preview surface (current system shows deltas but does not pre-render).

### Agent / AI Features
- The agent chat panel (Produciboi) is behind a default-off feature flag — needs more polish before general availability.
- Per-panel "Ask AI" actions work but depend on Claude CLI being installed.
- AI EQ recommendations are functional but could be more sophisticated.

### Other Planned Items
- **LLM-powered note migration modal:** Exists but could be expanded for bulk migration workflows.
- **Mastering cache:** Persistent per-track mastering analysis cache to avoid re-analysis on every select (discussed but implementation incomplete).
- **Windows/Linux polished builds:** CI runs smoke tests but no dedicated platform testing or signed installers.
- **v3 major feature ideas:** Not yet specified — depends on user feedback after wider distribution.

---

## Key Architectural Decisions

1. **Electron + TypeScript over Swift:** Ethan requested cross-platform after initial Swift MVP; Swift code archived in `swift-mvp/`.
2. **Custom media protocol (`producer-media://`):** Required to serve local files to Chromium renderer securely with proper MIME types and byte-range support.
3. **Unified state file over localStorage:** localStorage is not flushed on hard kill (SIGINT) and is per-Chromium-profile. All user data goes through the main-process state service with atomic JSON writes.
4. **FFmpeg for static analysis + Web Audio API for real-time:** FFmpeg `ebur128` gives mastering-grade LUFS/peak measurements; Web Audio API provides real-time spectrum/level metering.
5. **Per-track EQ state in unified file:** EQ settings, snapshots, and AI recommendations are stored per-song-ID in the unified state file, not just in localStorage.
6. **PolyForm Noncommercial license:** Changed from MIT on 2026-03-26 to protect commercial use rights.
7. **Two-part versioning (x.y):** Simpler than semver for a desktop app; CI enforces version bumps on each push.
8. **Feature flags for experimental features:** Agent panel and 3000 AD branding gated behind flags in `apps/renderer/src/featureFlags.ts`.

---

## Timeline Summary

| Date | Milestone |
|------|-----------|
| Mar 6 | Project conceived; initial Swift MVP built |
| Mar 7 | Pivoted to Electron + TypeScript; first E2E tests |
| Mar 7 | GitHub Actions release pipeline; prebuilt macOS artifacts |
| Mar 8 | Major UX refactor: playback, naming, drag-drop, tooltips |
| Mar 9 | Playback code-4 fix (custom media protocol); break tests; multi-folder fix |
| Mar 10 | Mastering Phase 1+2; platform normalization; icon selection (Queue Halo) |
| Mar 11 | Song-row metadata separation; prev/back behavior; two-hour salvage pass |
| Mar 12 | LUFS analysis hardening; transcript-to-product parity audit |
| Mar 13-15 | Expanded mastering workspace; loading states; export utility |
| Mar 16 | Checklist system; timestamp capture; skip buttons; branding flag |
| Mar 17 | Real-time spectrum analyzer + level meter; iCloud backup; LLM note migration |
| Mar 18-19 | macOS code signing infra; universal builds; MAS preflight; release fixes |
| Mar 20 | In-app update checks; checklist polish |
| Mar 21 | Version 1.0.0 release; version bump enforcement |
| Mar 23-24 | Checklist redesign; mastering pane streamline; error boundaries |
| Mar 25 | Agent chat panel (Produciboi); band isolation; help tooltips |
| Mar 26 | Per-song project file links; PolyForm Noncommercial license |
| Mar 27 | Draggable mastering panels; Ask AI actions; panel polish |
| Apr 1-2 | Evening feedback sweep; v2 release prep; CI fixes; Windows/Linux tests |
| Apr 3 | Voice input UX overhaul; app logging; album art improvements; tutorial links |
| Apr 4 | EQ system: per-band sliders, A/B toggle, song switcher, checklist button |
| Apr 5 | EQ snapshots, AI EQ recommendations, auto-update, unified state, API key storage |
| Apr 7-8 | Per-track EQ state, agent improvements, HMR, EQ snapshot migration, file picker memory |

---

## Session Log Archive

The original verbatim session log (Mar 6-12) that previously occupied this file has been archived. The content above is a distilled summary of all work done across Claude Code sessions and OpenClaw sessions from project inception through 2026-03-31. Verbatim Ethan quotes and per-run implementation details from the original log are available in git history.
