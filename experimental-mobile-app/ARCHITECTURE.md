# Producer Player Mobile Companion Architecture

Status: planning only. This folder is intentionally experimental and does not
ship with the desktop Electron app.

This report was produced from a repo review on 2026-07-01, plus an independent
Claude Code read-through and a native OpenClaw sub-agent review. The goal is an
iOS-first mobile companion that can browse/import tracks from iCloud Drive and
Google Drive, play bounces reliably, and share Producer Player's state with the
Mac app as closely as possible.

## Recommendation

Build an **iOS-first React Native app with Expo dev-client/bare native modules**.
Reuse `packages/contracts` and `packages/domain`; use native audio and native
file-provider integration where the desktop app currently relies on Electron,
Node, Chromium, Web Audio, or ffmpeg.

The first useful version should be a companion, not a mobile mastering suite:

- Browse the same song/version model as desktop.
- Import or cache tracks from iCloud Drive and Google Drive.
- Play in the background with lock-screen controls.
- Edit ratings, checklist items, notes, timestamped notes, display titles, and
  safe playback/listening preferences.
- Sync against the same `ProducerPlayerUserState` schema.
- Defer LUFS/mastering measurements unless desktop has already computed a
  reusable/precomputed value.

## Stack Decision

### Pick: React Native + Expo Dev Client

Use React Native for the app shell, with an Expo dev-client/bare workflow so the
project can include the native modules needed for real playback and iCloud file
coordination. This gives us the best mix of code reuse and real iOS behavior.

Use:

- `react-native-track-player` for playback queues, background audio, lock-screen
  metadata, Control Center integration, interruptions, and route changes.
- Swift native modules for iCloud Drive/document-container discovery, security
  scoped bookmarks, `NSFileCoordinator`, `NSMetadataQuery`, and conflict
  handling.
- Google Sign-In plus Google Drive REST v3 for Drive browsing and file download.
- Local sandbox/cache copies as the actual playback surface. Cloud providers are
  sources; the app's local storage is what audio playback reads.

### Why not SwiftUI first

SwiftUI and AVFoundation would give the strongest native audio/file-provider
control, but it would throw away most TypeScript reuse and lock the experiment
to iOS. It is a good fallback only if React Native audio or file-provider
constraints become a real blocker.

### Why not Capacitor/Ionic

Capacitor looks tempting because the current renderer is React, but it would put
playback back inside a WebView. Producer Player's hard parts are large local
audio files, background playback, lock-screen controls, file-provider URLs, and
offline caches; those are precisely where the WebView path is weakest.

### Why not Kotlin Multiplatform

The reusable desktop logic is TypeScript, not Kotlin. Kotlin Multiplatform would
still require native iOS audio work while offering little reuse from the current
repo. It only makes sense if Android becomes co-primary and we accept a larger
rewrite.

## What Can Actually Be Reused

Strong reuse:

- `packages/contracts/src/index.ts` for `ProducerPlayerUserState`,
  `SongChecklistItem`, `SongVersion`, and the rest of the shared data model.
- `packages/domain/src/song-model.ts` for version suffix parsing, title
  normalization, song grouping, and stable ID generation.
- `packages/domain/src/file-library-service.ts` concepts for scanning top-level
  files plus `old/`, applying album order, and preserving folder/song identity.
- Pure arithmetic such as platform normalization previews if kept free of
  browser/Electron assumptions.

Limited or no reuse:

- `apps/renderer` UI. It is desktop-density React tied to Electron IPC and Web
  Audio assumptions.
- `apps/electron` playback. It depends on `producer-media://`, Node filesystem
  access, byte-range serving, and bundled ffmpeg transcodes.
- Web Audio analysis workers. Mobile should not whole-file-decode large
  WAV/AIFF files in a WebView or JS runtime.
- Native plugin hosting, AI CLI spawning, mastering overlays, live spectrum,
  vectorscope, K-metering, reference A/B, and EQ/plugin chains.

Useful source anchors:

- `packages/contracts/src/index.ts` defines `SongChecklistItem` around line 427
  and `ProducerPlayerUserState` around line 799.
- `apps/electron/src/state-service.ts` defines `UNIFIED_STATE_FILE_NAME`,
  `PER_TRACK_KEYS`, `parseUserState`, `splitStateForDisk`, `readSplitState`,
  and `writeSplitState`.
- `apps/electron/src/main.ts` defines current iCloud backup/sync around the
  `getICloudDriveBasePath`, `syncDataToICloud`, and `loadDataFromICloud`
  functions.
- `packages/domain/src/song-model.ts` and
  `packages/domain/src/file-library-service.ts` define the current scanner and
  grouping behavior.

## State Sync Strategy

Ethan's preference is correct: the mobile app should use the same state model as
the Mac app. The risky part is two apps writing the exact same monolithic JSON
file without merge discipline.

### Current Desktop State Reality

The desktop app still exposes a monolithic
`producer-player-user-state.json`, but the authoritative app-data layout is now
split:

- `state/global.json`
- `state/tracks/<base64url(songId)>.json`
- `state/.migrated`

The split layout is important because mobile edits are naturally per-track.
Ratings and checklist notes should not force a whole-library last-write-wins
merge.

Current iCloud backup writes legacy files plus the monolithic
`producer-player-user-state.json` into:

```text
~/Library/Mobile Documents/com~apple~CloudDocs/Producer Player/
```

It does not yet mirror the full split `state/` tree into iCloud. That mismatch
is the biggest desktop-side gap to close before a robust companion exists.

### v1 Sync: Literal File, Safe Patch/Rebase

For the experimental mobile app, use the literal
`producer-player-user-state.json` first because it matches Ethan's mental model
and the existing desktop backup.

Mobile write rules:

- Read the freshest JSON from the chosen Producer Player cloud folder.
- Preserve unknown fields verbatim.
- Apply a small allowlist of mobile-owned edits.
- Re-read/rebase just before write.
- Write atomically through the native file coordinator.
- Never replace desktop-owned fields with mobile defaults.

Mobile-owned fields for v1:

- `songRatings`
- `songChecklists`
- `songDisplayTitles`
- `perSongRestoreReferenceEnabled`
- Maybe `songDawOffsets` if the UI exposes it clearly.
- Maybe `playbackVolume` and listening-device choices if those prove useful on
  phone.

Desktop-owned/read-only fields for v1:

- `linkedFolders`
- `songOrder`, unless mobile gets a deliberate reorder UI.
- `autoMoveOld`
- `windowBounds`
- `lastFileDialogDirectory`
- `uiZoomFactor`
- `pluginLibrary`, `pluginScanPaths`, `perTrackPluginChains`
- AI recommendation/provider/model fields.
- Project file paths, unless exposed as read-only labels/links.

### Better End-State: Sync the Split Tree

The more durable architecture is to teach desktop iCloud sync to mirror the
split layout as well:

```text
Producer Player/
  producer-player-user-state.json
  state/
    global.json
    tracks/
      <base64url(songId)>.json
```

Then mobile can write only the track files it actually changed. Conflicts become
localized to a single track instead of the whole library. The desktop app can
continue generating the monolithic file for compatibility/export.

### Conflict Rules

Use track-scoped conflict resolution:

- Different tracks: merge automatically.
- Same track, different checklist item IDs: union.
- Same checklist item ID: newest `updatedAt` wins once checklist items carry an
  item-level timestamp.
- Ratings/display titles: newest per-field write wins.
- Unknown desktop-only fields: passthrough, never parse-and-drop.

The existing schema does not yet have item-level `updatedAt` on checklist items,
so the first desktop-side enabling change should add that. Without item-level
timestamps, same-item conflict resolution can only be coarse.

## Cloud Sources and Import Behavior

### iCloud Drive

Use `UIDocumentPickerViewController` for explicit folder/file selection and a
native iCloud module for Producer Player folder discovery. The likely discovery
path is:

- Search iCloud document scopes for `producer-player-user-state.json`.
- Prefer a folder named `Producer Player`.
- Persist a security-scoped bookmark to the chosen folder.
- Coordinate reads and writes through `NSFileCoordinator`.
- Watch metadata changes with `NSMetadataQuery` while the app is alive.

iOS cannot be treated like macOS folder watching. Files can be evicted/dataless;
the app must request downloads, handle failures, and copy selected audio into a
local cache before reliable playback.

### Google Drive

Use Google Sign-In for auth and Drive REST v3 for browsing/download. Treat Drive
as an import/source provider rather than a live filesystem:

- Browse folders/files through Drive metadata.
- Download chosen audio files into the mobile sandbox/cache.
- Keep provider IDs and modified times so the app can refresh stale files.
- Respect Drive rate limits and App Store privacy review expectations.
- Do not try to play remote Drive URLs as the primary playback surface.

### Folder Identity Risk

Desktop `songId` derives from folder identity plus normalized title. If the
mobile app imports the same file from a different path/provider identity, it can
generate a different song ID and lose linkage to ratings/checklists.

The mobile app needs a folder/source mapping layer:

- Preserve the desktop `linkedFolders` identity when browsing the same iCloud
  folder.
- Store provider metadata for Google Drive folders.
- Map imported cloud folders back to desktop folder IDs where possible.
- Show an explicit "unmatched import" state when identity cannot be proven.

## Playback Plan

Use `react-native-track-player` as the playback engine. Configure:

- iOS `AVAudioSession` playback category.
- Background audio mode.
- Lock-screen and Control Center metadata.
- Audio interruption handling.
- Route-change handling for AirPods, Bluetooth speakers, and car playback.
- Local cache file URLs as track sources.

The mobile app should not reuse:

- `producer-media://`
- Electron IPC playback source resolution
- ffmpeg transcode-on-demand path
- Web Audio `AnalyserNode` live metering as a v1 dependency

If AIFF/WAV edge cases appear, solve them in native iOS playback or cache
normalization, not via a WebView path.

## Feature Scope

### v1: Mobile Companion

The first version should feel like "Producer Player in your pocket" for
listening and notes:

- Select/connect Producer Player iCloud folder.
- Import/cache iCloud Drive audio files.
- Browse library using the same song/version grouping.
- Play tracks in foreground/background.
- See current version, older versions, rating, and checklist status.
- Add timestamped listening notes from the Now Playing screen.
- Tap a note timestamp to seek.
- Add/edit/complete checklist items.
- Rate tracks 1-10.
- Search/filter tracks.
- Read precomputed analysis values if desktop already synced them.
- Show platform-normalization preview if the needed numbers are available.

### v1.5

- Google Drive source/import.
- Reorder album sequence, if mobile editing proves useful.
- Better offline cache controls.
- Conflict UI for rare same-track/same-field conflicts.
- Deep links from a mobile note/checklist item back to the track.
- Device-specific listening labels.

### Deferred

- Full mastering analysis.
- Live LUFS/true peak measurement.
- Live spectrum, vectorscope, K-metering, mid-side views.
- Reference A/B workflow.
- EQ editing and snapshots.
- Plugin chains.
- AI mastering recommendations.
- Export/render workflows.

## LUFS and Mastering Measurements

Defer on-device LUFS for v1. The desktop implementation already treats live
analysis carefully because whole-file decode is memory-heavy. Rebuilding that
properly on iOS means native decode, streaming analysis, battery/thermal
considerations, codec edge cases, and a clear distinction between estimates and
standards-compliant measurements.

Acceptable v1 behavior:

- No mobile analysis.
- Display desktop-precomputed values if they are present in synced state/cache.
- Keep labels honest: "desktop analysis" or "estimate" where appropriate.
- Keep platform-normalization preview as pure arithmetic if the input
  measurements are already available.

Future mobile analysis should be foreground-only and explicit:

- Native AVFoundation/Accelerate pipeline.
- Chunked/streaming analysis, not whole-file JS decode.
- Cancellable jobs.
- Per-file cache keyed by provider ID/path, size, mtime/hash.

## Build Plan

### Phase 0: Experimental Scaffold

- Create `experimental-mobile-app/` as an npm workspace only once it contains
  runnable code.
- Add Expo dev-client/bare setup.
- Configure TypeScript path/workspace imports for `packages/contracts` and
  `packages/domain`.
- Add minimal navigation: Library, Track, Now Playing, Settings.
- Prove the app boots in the local iPhone simulator.

Exit criteria:

- `npm install` remains clean from repo root.
- Mobile app boots in simulator.
- Domain/contracts compile in mobile build.
- No desktop app build/release path changes.

### Phase 1: Import and Playback

- Implement iCloud document picker import.
- Copy selected files into local cache.
- Use domain scanner/grouping logic against cached file metadata.
- Build a minimal library list and track detail screen.
- Wire `react-native-track-player` playback.
- Add background mode and lock-screen metadata.

Exit criteria:

- WAV/AIFF/MP3/M4A samples play on simulator where supported.
- Real device confirms background playback, lock-screen controls, route changes,
  AirPods/Bluetooth, and interruption recovery.

### Phase 2: Settings/State Sync

- Locate/select the Producer Player cloud folder.
- Read `producer-player-user-state.json`.
- Parse through the shared contract layer.
- Round-trip unknown fields without loss.
- Apply mobile-owned field patches.
- Rebase before write.
- Add conflict tests and conflict logging.

Exit criteria:

- Desktop edits appear on mobile.
- Mobile checklist/rating edits appear on desktop.
- Unknown desktop-only fields survive mobile writes byte-for-byte where
  possible, and semantically where field order changes.
- Airplane-mode edit then reconnect resolves without whole-file clobber.

### Phase 3: Checklist-First UX

- Add timestamp capture from Now Playing.
- Add note/todo mode matching desktop semantics.
- Add rating and checklist shortcuts.
- Add track/version switching.
- Add basic search and filter controls.

Exit criteria:

- Ethan can listen through recent bounces on phone and leave useful
  timestamped notes that desktop sees.

### Phase 4: Google Drive and Polish

- Add Google Sign-In.
- Add Drive folder picker/browser.
- Download/cache selected files.
- Keep Drive metadata for refresh.
- Add cache management and stale-file indicators.
- Add privacy strings and App Store review notes.

Exit criteria:

- A Drive-hosted folder can be imported, played offline after cache, and
  refreshed intentionally.

## Testing Plan

### Local Unit Tests

- Golden fixtures for current monolithic `producer-player-user-state.json`.
- Golden fixtures for split `state/global.json` + `state/tracks/*.json`.
- Parser tests for current and older state files.
- Whitelisted mobile patch tests.
- Unknown-field preservation tests.
- Desktop-owned-field preservation tests.
- Per-track conflict merge tests.
- Folder identity mapping tests.

Reuse/extend current desktop coverage around:

- `state-service-migration.test.cjs`
- `state-service-export-import-round-trip.test.cjs`
- `shared-state-persistence.spec.ts`
- DAW/listening-device state tests
- `packages/domain` scanner/model tests

### Simulator Tests

Current local simulator readiness:

- Xcode `26.4.1` is installed.
- iOS `26.4` runtime is installed.
- An `iPhone 17` simulator is available.
- `xcodegen` is installed at `/opt/homebrew/bin/xcodegen`.
- Swift `6.3.1`, Node `v25.6.1`, and npm `11.9.0` are available.

Simulator can cover:

- App boot.
- Navigation.
- State parsing and local fixture import.
- Cached-file playback basics.
- Checklist/rating UI.
- Rebase/merge logic.
- Offline cache UI.

Simulator should not be trusted for final proof of:

- iCloud ubiquity behavior.
- Security-scoped bookmark lifetime.
- Real Drive provider behavior.
- Background audio reliability.
- Lock-screen/Control Center behavior.
- Bluetooth/AirPods route changes.
- Interruption handling.

### Real Device Tests

Required before calling the app usable:

- Sign dev build to Ethan's Apple account/team.
- Install on a real iPhone.
- Select the Producer Player iCloud folder.
- Confirm iCloud file download/eviction behavior.
- Confirm desktop to phone state sync.
- Confirm phone to desktop checklist/rating sync.
- Force an iCloud conflict and inspect resolution.
- Play a long WAV/AIFF in background.
- Lock screen, use Control Center, switch audio routes, receive a call/Siri
  interruption, and resume correctly.
- Test airplane-mode note capture and later reconciliation.
- Test Drive OAuth, folder browse, download, offline playback, token refresh,
  and sign-out/delete-data path.

## Risks

- Whole-file JSON writes can clobber cross-device edits unless mobile uses
  rebase/merge and desktop eventually syncs the split tree.
- iCloud Drive and Google Drive are not POSIX folders on iOS; files may be
  placeholders, evicted, unavailable, stale, or conflict-copied.
- Stable song IDs can diverge if mobile imports the same track under a different
  folder/provider identity.
- Unknown desktop fields can be stripped if mobile uses a lossy parser/writer.
- Background audio entitlement must be justified by actual audio playback.
- Google Drive OAuth and privacy review add product/admin overhead.
- Reuse can be overestimated: the shared model/domain code is valuable, but the
  desktop renderer/mastering/audio host is not portable.

## First Desktop Changes Needed

Before or during the mobile scaffold, make these small desktop-side changes:

1. Mirror the split `state/` tree into the iCloud backup folder.
2. Add item-level `updatedAt` to checklist items for safer conflict merge.
3. Add optional provider/source metadata for linked folders so iCloud/Drive
   identities can be matched across devices.
4. Add a state fixture package or test fixture folder that mobile and desktop
   tests can both consume.
5. Decide whether the shared cloud folder should remain the current general
   CloudDocs `Producer Player/` folder or move to an app ubiquity container.

## External References

- [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/)
- [React Native Track Player](https://rntp.dev/)
- [React Native Track Player background mode](https://rntp.dev/docs/basics/background-mode)
- [Apple iCloud documents](https://developer.apple.com/documentation/foundation/icloud)
- [NSFileCoordinator](https://developer.apple.com/documentation/foundation/nsfilecoordinator)
- [NSMetadataQuery](https://developer.apple.com/documentation/foundation/nsmetadataquery)
- [NSFileVersion](https://developer.apple.com/documentation/foundation/nsfileversion)
- [UIDocumentPickerViewController](https://developer.apple.com/documentation/uikit/uidocumentpickerviewcontroller)
- [AVAudioSession](https://developer.apple.com/documentation/avfaudio/avaudiosession)
- [Configuring media playback](https://developer.apple.com/documentation/avfoundation/configuring-your-app-for-media-playback)
- [App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Google Drive REST API](https://developers.google.com/drive/api/reference/rest/v3)
- [Google Drive files.list](https://developers.google.com/drive/api/reference/rest/v3/files/list)
- [Google Drive downloads](https://developers.google.com/drive/api/guides/manage-downloads)
- [Google Sign-In for iOS](https://developers.google.com/identity/sign-in/ios)
