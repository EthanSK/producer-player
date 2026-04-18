# AI Recommendations + Per-Track State Split — Design Plan

Status: **Design phase — not approved for build.**
Author: Claude (Opus 4.7) via subagent, 2026-04-18.
Target version: `producer-player` 3.22+ (current: 3.21+).

This doc covers three interrelated features that must be designed as one pass because feature 3 depends on feature 2, and feature 1 UI depends on 2 and 3 having data to display.

- **Feature 1** — AI auto-recommendations on Mastering Full Screen panels.
- **Feature 2** — Per-file app state migration (one-way, rollback-capable, loss-free).
- **Feature 3** — AI recommendation data storage inside the per-track files.

---

## Background: current state-persistence model

Single source of truth: `~/Library/Application Support/Producer Player/producer-player-user-state.json`.

Shape defined in `packages/contracts/src/index.ts` as `ProducerPlayerUserState` (schemaVersion 1). Managed by `apps/electron/src/state-service.ts` (`UserStateService`). Writes are atomic (temp + rename). Renderer mirrors hot data into `localStorage` as a fast cache; the canonical truth is on disk.

Per-track (songId-keyed) fields currently intermixed in the monolithic file:

| Field | Shape | Per-track? |
|---|---|---|
| `songRatings` | `Record<songId, number>` | yes |
| `songChecklists` | `Record<songId, SongChecklistItem[]>` | yes |
| `songProjectFilePaths` | `Record<songId, string>` | yes |
| `perSongReferenceTracks` | `Record<songId, string>` | yes |
| `perSongRestoreReferenceEnabled` | `Record<songId, boolean>` | yes |
| `eqSnapshots` | `Record<songId, EqSnapshot[]>` | yes |
| `eqLiveStates` | `Record<songId, PersistedEqLiveState>` | yes |
| `aiEqRecommendations` | `Record<songId, number[]>` | yes |
| `songDawOffsets` | `Record<songId, { seconds, enabled }>` | yes |
| `albumChecklists` | `Record<albumKey, AlbumChecklistItem[]>` | per-album (not per-track, leave in global) |
| `savedReferenceTracks` | `SavedReferenceTrack[]` | global palette |
| `linkedFolders`, `songOrder`, `autoMoveOld`, `albumTitle`, `albumArtDataUrl`, `agent*`, `listeningDevices`, preferences, `windowBounds`, etc. | globals | no |

The current dev file is small (~2.7 KB), but every rating, checklist item, EQ snapshot, AI EQ vector, and DAW offset for every song ever opened lives in that one file. The file grows unboundedly with library size. Under the new features (AI recommendations per metric per track), each track gets ~10–20 additional fields with reasoning text and timestamps — that is the driver for the split.

Agent architecture note (load-bearing for feature 1): the agent is a CLI pass-through (`claude` / `codex` spawned from `agent-service.ts`). There is **no custom tool registry on the app side**. The "tool" pattern in the current AI EQ feature (see `handleRequestAiEq` in `App.tsx` around line 5446) is a renderer-driven flow:
1. Renderer builds a structured prompt.
2. Renderer subscribes to agent text-delta events.
3. On `turn-complete`, renderer parses the assistant's structured JSON output (`parseAiEqResponse`).
4. Renderer persists the parsed result keyed by `songId`.

The same pattern applies to `rerun_mastering_recommendations` — it is conceptually a "tool" exposed in chat, but the implementation is a renderer-side orchestration that injects a prompt and parses the response.

---

## Feature 1 — AI auto-recommendations on Mastering Full Screen

### Goals

When a new track/version opens in Mastering Full Screen, kick off the agent once to produce recommended values for every metric across all panels. Render them as light-blue "AI recommendation: …" text directly under each metric. Expose a global show/hide toggle, a per-track "already done" flag, and a manual re-run entry point. Honor a chat-settings master kill switch.

Spectrum Analyzer's existing AI EQ recommendation (cyan dashed curve + "AI EQ" button) is out of scope — keep it as-is.

### Scope of metrics (per panel)

**`loudness-peaks` panel** (`.analysis-stat-card` grid at ~line 13520):
- Integrated LUFS
- Loudness range (LRA)
- True Peak
- Sample peak
- Peak short-term
- Peak momentary
- Mean volume
- Crest Factor
- Clip Count
- DC Offset

**`normalization` panel** (~line 13595 onward): per-platform row — one recommendation per platform (Spotify, Apple Music, YouTube, Tidal, Amazon) on target LUFS / true-peak ceiling fit.

**`tonal-balance` / `visualizations` spectral bands**: one recommendation per band (Sub, Low, Low-Mid, Mid, High-Mid, High) — **but distinct from** the Spectrum Analyzer's AI EQ curve. This is a textual "your sub is +2 dB hot relative to the reference".

**`stereo-correlation`, `vectorscope`, `mid-side-spectrum`, `mid-side-monitoring`, `crest-factor-history`, `waveform`, `loudness-history`, `loudness-histogram`, `k-metering`, `pro-indicators`, `spectrogram`, `mastering-checklist`**: one "panel-level" recommendation (short verdict) rendered in the panel header area. These don't have per-metric rows.

### UI spec

Render each recommendation as a new DOM fragment below the `<strong>{metricValue}</strong>` inside `.analysis-stat-card`:

```tsx
<span
  className="analysis-stat-ai-recommendation"
  data-testid={`ai-recommendation-${metricId}`}
  title={recommendation.reason}
>
  AI recommendation: <strong>{formatted(recommendation.recommended_value)}</strong>
</span>
```

Copy tone (to mirror the existing "AI EQ" button language):
- Label prefix: `AI recommendation:` (always this exact casing).
- Value formatting: match the metric's own unit (e.g. `-14.0 LUFS`, `-1.0 dBTP`, `-3 dB on sub band`).
- Hover reveals the `reason` in the native `title` tooltip (consistent with the existing help-tooltip hover affordance on metric cards).

CSS (add to `apps/renderer/src/styles.css`):

```css
.analysis-stat-ai-recommendation {
  display: block;
  margin-top: 0.25rem;
  font-size: 0.72rem;
  color: var(--color-ai-recommendation, #8ecbff); /* light blue */
  line-height: 1.3;
  letter-spacing: 0.01em;
}
.analysis-stat-ai-recommendation strong { color: inherit; font-weight: 600; }
.analysis-stat-ai-recommendation--loading { opacity: 0.6; font-style: italic; }
.analysis-stat-ai-recommendation--error { color: var(--color-warning); }
```

Pick a color token that is visually distinct from the cyan `AI EQ` curve in the Spectrum Analyzer (cyan → existing EQ feature; light blue #8ecbff → new text recommendations) so the two don't blur together.

### Toggle (top of Mastering Full Screen)

Add a new toggle at the top of the fullscreen overlay (next to the existing panel-reorder/drag-handle area):

```tsx
<label className="analysis-overlay-ai-toggle">
  <input
    type="checkbox"
    checked={showAiRecommendations}
    onChange={(e) => setShowAiRecommendations(e.target.checked)}
    data-testid="toggle-ai-recommendations"
  />
  Show AI recommendations
</label>
```

Persistence: `ProducerPlayerUserState.showAiRecommendationsEnabled: boolean` (new **global** field, default `true`). Toggling updates the global state and renders/hides all per-metric recommendation text. **Visibility toggle does NOT cancel or clear generated data** — flipping off only hides.

### Auto-run trigger gates (all must be true)

Auto-run fires when:

1. The Mastering Full Screen overlay becomes visible **for a particular track/version**.
2. Global chat-settings toggle `aiAutoRecommendEnabled` is `true` (default `true`, new agent-settings field).
3. `ENABLE_AGENT_FEATURES === true` and an agent provider is configured.
4. The per-track record has `ai_recommended === false` (i.e. no completed auto-run for the current `recommendation_schema_version`).
5. No in-flight recommendation request exists for the same `track_id` + `version_id`.
6. The audio has been analyzed (`analysis` + `measuredAnalysis` ready for the selected track). Fall back to "waiting for analysis" state if not.

Failed runs do **not** flip `ai_recommended` to `true`. They store an error entry so the UI can render "AI recommendation failed — tap to retry".

### Manual re-run entry

- **Button** in the fullscreen toolbar: "Regenerate AI recommendations" (small, secondary button next to the toggle). Fires the same flow as auto-run but with `source: 'manual'` and clears the existing per-track recommendations first.
- **Agent chat "tool"**: `rerun_mastering_recommendations` — implemented as a chat system-prompt instruction that recognizes phrases like "re-run mastering recommendations" (renderer-side pattern matching is already used for AI EQ; reuse the same pattern). Params: `{ track_id?: string }` — defaults to the currently active track.

When the re-run runs:
1. Mark the per-track record's `ai_recommended: false` and `ai_recommendations_last_cleared_at: now`.
2. Clear all existing metric entries for that track.
3. Kick off the new run.
4. On completion, write fresh entries and flip `ai_recommended: true`.

### Chat settings toggle (disable auto-run)

New field on `ProducerPlayerUserState` (agent section):

```ts
agentAutoRecommendEnabled: boolean; // default true
```

Surfaced in `AgentSettings.tsx` as a checkbox "Auto-run AI mastering recommendations on new tracks". When `false`, no auto-runs fire; manual re-run still works.

### Auto-run implementation sketch

New function near `handleRequestAiEq`:

```ts
const handleAutoRecommend = useCallback(
  async (track: SongVersion, reason: 'auto' | 'manual') => {
    if (!track || aiRecommendLoadingByTrack.has(track.id)) return;
    if (reason === 'auto') {
      const flag = readAiRecommendedFlagForTrack(track.songId);
      if (flag?.completed && flag.schemaVersion === AI_REC_SCHEMA_VERSION) return;
      if (!agentAutoRecommendEnabled) return;
    }
    // ... build prompt with ALL metric context + list of bands + platforms
    // ... subscribe to agent events
    // ... parse structured JSON response
    // ... persist per-metric entries keyed by songId + trigger UI refresh
  },
  [aiRecommendLoadingByTrack, agentAutoRecommendEnabled, /* ... */]
);
```

The auto-run fires from a `useEffect` gated on Mastering Full Screen visibility + `selectedSongId` + `analysisReady`:

```ts
useEffect(() => {
  if (!isMasteringFullScreenOpen) return;
  if (!selectedPlaybackVersion) return;
  if (!analysisReady) return;
  handleAutoRecommend(selectedPlaybackVersion, 'auto');
}, [isMasteringFullScreenOpen, selectedPlaybackVersion?.id, analysisReady]);
```

The prompt asks the agent for ONE JSON object containing all metric recommendations at once (not per-metric calls) — cheaper, more consistent, and aligns with how `handleRequestAiEq` already does it.

---

## Feature 2 — Per-file app state migration

### Current schema

Single file: `producer-player-user-state.json` with all per-track maps intermixed with globals (see background section).

### Target schema

Three-layer model:

```
<appData>/Producer Player/
  producer-player-user-state.json                      # global settings + manifest reference
  producer-player-user-state.backup.<ISO>.json         # pre-migration backup (timestamped)
  tracks/
    manifest.json                                       # track_id -> state_file mapping
    <track_id>.json                                     # one per track
  migrations/
    <ISO>-state-split-v2-report.json                   # per-migration human-readable report
```

#### Global file (`producer-player-user-state.json`) after migration

```jsonc
{
  "schemaVersion": 2,
  "updatedAt": "2026-04-18T12:00:00.000Z",

  // Migration status lives in the global file
  "migration": {
    "stateSplitStatus": "completed",      // "pending" | "in-progress" | "completed" | "failed"
    "fromSchemaVersion": 1,
    "toSchemaVersion": 2,
    "completedAt": "2026-04-18T12:00:00.000Z",
    "backupFilePath": "producer-player-user-state.backup.2026-04-18T120000Z.json",
    "tracksDirectory": "tracks"
  },

  // UNCHANGED globals
  "linkedFolders": [...],
  "songOrder": [...],
  "autoMoveOld": true,
  "albumTitle": "...",
  "albumArtDataUrl": "...",
  "albumChecklists": {...},
  "savedReferenceTracks": [...],
  "globalReferenceFilePath": "...",
  "agentProvider": "...",
  "agentModels": {...},
  "agentThinking": {...},
  "agentSystemPrompt": "...",
  "agentSttProvider": "...",
  "listeningDevices": [...],
  "activeListeningDeviceId": null,
  "referenceLevelMatchEnabled": true,
  "iCloudBackupEnabled": false,
  "autoUpdateEnabled": true,
  "checklistDawOffsetDefaultSeconds": 0,
  "checklistDawOffsetDefaultEnabled": false,
  "lastFileDialogDirectory": "...",
  "windowBounds": {...},

  // NEW globals for feature 1
  "showAiRecommendationsEnabled": true,
  "agentAutoRecommendEnabled": true
}
```

#### Track manifest (`tracks/manifest.json`)

```jsonc
{
  "schemaVersion": 1,
  "tracks": {
    "<songId>": {
      "trackId": "<songId>",
      "stateFile": "tracks/<songId>.json",
      "audio": {
        "originalFilename": "mix-final.wav",
        "lastKnownPath": "/Users/name/Music/mix-final.wav",
        "contentHash": null
      },
      "createdFromLegacySongId": true,
      "updatedAt": "2026-04-18T12:00:00.000Z"
    }
  }
}
```

#### Per-track file (`tracks/<songId>.json`)

```jsonc
{
  "schemaVersion": 1,
  "trackId": "<songId>",
  "updatedAt": "2026-04-18T12:00:00.000Z",
  "audio": {
    "originalFilename": "mix-final.wav",
    "lastKnownPath": "/Users/name/Music/mix-final.wav",
    "contentHash": null
  },

  // legacy per-track fields migrated 1:1
  "rating": 8,                           // was songRatings[songId]
  "checklist": [...SongChecklistItem],   // was songChecklists[songId]
  "projectFilePath": "...",              // was songProjectFilePaths[songId]
  "referenceTrackFilePath": "...",       // was perSongReferenceTracks[songId]
  "restoreReferenceEnabled": false,      // was perSongRestoreReferenceEnabled[songId]
  "eqSnapshots": [...],                  // was eqSnapshots[songId]
  "eqLiveState": {...},                  // was eqLiveStates[songId]
  "aiEqRecommendation": [...],           // was aiEqRecommendations[songId]
  "dawOffset": { "seconds": 42, "enabled": true },  // was songDawOffsets[songId]

  // NEW — Feature 3 payload
  "aiRecommendations": {
    "schemaVersion": 1,
    "aiRecommended": false,
    "lastGeneratedAt": null,
    "lastClearedAt": null,
    "versionId": null,                   // opaque string, bumped when mastering-rec schema changes
    "metrics": {
      "integrated_lufs": { "recommended_value": -14.0, "unit": "LUFS", "reason": "...", "timestamp": "...", "model": "claude-opus-4-6", "versionId": "mastering-rec-v1" },
      "true_peak":       { "recommended_value": -1.0,  "unit": "dBTP", "reason": "...", "timestamp": "...", "model": "...", "versionId": "..." },
      // ... more metrics
      "spectral_balance__sub":     { ... },
      "spectral_balance__low":     { ... },
      "spectral_balance__low_mid": { ... },
      "spectral_balance__mid":     { ... },
      "spectral_balance__high_mid":{ ... },
      "spectral_balance__high":    { ... },
      "platform__spotify":   { ... },
      "platform__apple":     { ... },
      "platform__youtube":   { ... },
      "platform__tidal":     { ... },
      "platform__amazon":    { ... }
    },
    "errors": []                          // [{ metricId?, timestamp, message }]
  }
}
```

### File naming convention (per-track file)

**Recommendation: `tracks/<songId>.json` keyed by the existing internal `songId`.**

Rationale:
- `songId` is already the stable identifier across the app (Electron builds it from normalized title + folder id — see `packages/contracts/src/index.ts` `LogicalSong`).
- The audio filename can change (re-export, rename), but `songId` is stable across exports of the same logical song.
- `songId` strings in this codebase are already URL-safe (no spaces/quotes) because they are normalized titles.

Open question for Ethan: should we key by `songId` (recommended) or audio filename (as he suggested)? Filename-keyed risks collisions across folders with identical filenames ("mix.wav" appears in multiple albums) and breaks on filename characters that aren't filesystem-safe everywhere.

### Loading logic (read fallback)

`UserStateService.readUserState()` becomes:

```ts
async readUserState(): Promise<ProducerPlayerUserState> {
  if (this.cachedState) return this.cachedState;

  const globalRaw = await this.readGlobalFile();
  const migrationStatus = globalRaw?.migration?.stateSplitStatus ?? 'not-started';

  if (migrationStatus === 'completed') {
    // Post-migration path: load global, then hydrate per-track fields from manifest + per-track files
    const global = parseGlobalState(globalRaw);
    const tracks = await this.readAllTrackFiles();
    this.cachedState = mergeGlobalAndTracks(global, tracks);
    return this.cachedState;
  }

  if (migrationStatus === 'in-progress' || migrationStatus === 'failed') {
    // Rollback path: use the backup file
    const backupPath = globalRaw?.migration?.backupFilePath;
    if (backupPath && existsSync(backupPath)) {
      this.cachedState = parseUserState(JSON.parse(await fs.readFile(backupPath, 'utf8')));
      return this.cachedState;
    }
  }

  // Fallback: monolithic format (not migrated, or no backup available)
  this.cachedState = parseUserState(globalRaw);
  return this.cachedState;
}
```

The existing `parseUserState` continues to work on pre-migration files, so rollback is just "stop writing per-track files and trust the monolithic file."

### Migration algorithm

Triggered at app startup **once**, gated by `global.migration.stateSplitStatus !== 'completed'` and `schemaVersion === 1`.

1. **Acquire migration lock.** Atomic create of `migration.lock` file in appData (like a PID file). Fail loudly if already held by a different process.
2. **Read the monolithic file.** Parse using existing `parseUserState`. Never delete the source.
3. **Write timestamped backup.** Copy byte-for-byte to `producer-player-user-state.backup.<ISO>.json`. Confirm backup size + sha256 equal source.
4. **Mark migration in-progress.** Write a minimal global file with `migration.stateSplitStatus: "in-progress"` + backup path. Atomic temp + rename.
5. **Compute track list.** Union of all songIds appearing in any of the per-track maps (`songRatings`, `songChecklists`, `songProjectFilePaths`, `perSongReferenceTracks`, `perSongRestoreReferenceEnabled`, `eqSnapshots`, `eqLiveStates`, `aiEqRecommendations`, `songDawOffsets`). Record total count in the migration report.
6. **Write per-track files.** For each songId, build the per-track payload from the monolithic maps and write atomically. Write to `tracks/<songId>.json.tmp-<pid>-<ts>` then rename.
7. **Write manifest.** Atomic temp + rename.
8. **Write final global file.** Strip the per-track maps, preserve all globals, set `migration.stateSplitStatus: "completed"`, bump `schemaVersion: 2`.
9. **Write migration report.** `migrations/<ISO>-state-split-v2-report.json` — `{ trackCount, totalBytesBefore, totalBytesAfter, durationMs, skippedEntries: [...], warnings: [...] }`.
10. **Release migration lock.**

If **any** step 3–8 fails:
- Do not delete the backup.
- Do not flip status to "completed".
- Leave the monolithic file untouched.
- Log the failure to the migration report.
- Next startup re-reads the monolithic file via the fallback path.

### Rollback plan

**Manual rollback (ops support):**
1. Restore the monolithic file from `producer-player-user-state.backup.<ISO>.json`.
2. Delete the `tracks/` directory.
3. Delete or rewrite the global file with `schemaVersion: 1` and no `migration` block.
4. Next launch the app will read as pre-migration.

**Automatic rollback (e.g. migration half-wrote):**
- Load logic detects `migration.stateSplitStatus: "in-progress"` or `"failed"` and reads the backup file instead.
- A startup flag `STATE_SPLIT_MIGRATION_DISABLED=1` env var skips migration entirely and uses the backup — lets Ethan bypass on the command line if things go sideways.

**User-facing:** add an Import/Export "Restore pre-split backup" button in sidebar (reveals the backup file in Finder so the user can manually fall back).

### Byte-for-byte preservation

The migration is a relational split of maps — no lossy transforms. Write a round-trip test: `reconstructMonolithic(migrated) ≡ parseUserState(original)` modulo the `schemaVersion` and `updatedAt` fields.

### iCloud backup interaction

Current code backs up the monolithic file to iCloud. After migration:
- Back up the full tree: global + manifest + all per-track files (tar/zip, or iterate).
- Restore from iCloud has to understand both the old monolithic and the new tree. If restoring an old iCloud blob onto a post-migration client, run migration again (idempotent — no-ops if already completed).

### Test strategy

**Unit tests** (`apps/electron/src/state-service.test.ts` — new):
- Fixture: empty state → migrates to empty tracks/.
- Fixture: 1 track with every field populated → round-trips perfectly.
- Fixture: 100 tracks + sparse fields → round-trips.
- Fixture: 1000 tracks (stress) → completes in < 5s.
- Fixture: unknown future fields → preserved in the per-track file, not dropped.
- Fixture: malformed JSON → migration aborts, monolithic file untouched.
- Idempotency: running migration twice produces the same tree.
- Rollback: `STATE_SPLIT_MIGRATION_DISABLED=1` uses the backup.

**Failure-injection tests:**
- Crash after step 3 (backup written): next launch reads monolithic.
- Crash after step 4 (mid-transition global): next launch reads backup.
- Crash after step 6 (half the per-track files written): next launch reads backup.
- Crash after step 7 (manifest written but global file stale): next launch reads backup.
- Crash after step 8 (completed flag set): next launch reads per-track tree.

**E2E tests** (`apps/e2e/src/state-split-migration.spec.ts` — new):
- Launch app with pre-populated monolithic file → verify all checklist items, ratings, EQ snapshots survive.
- Launch app, open multiple tracks, verify no per-track data cross-contamination.
- Export user state → verify export contains both the monolithic-equivalent view and the per-track tree.

**Human validation:**
- Dogfood: copy Ethan's real monolithic state to a staging directory, run migration, diff the reconstructed monolithic vs the original (they should be semantically equivalent).

---

## Feature 3 — AI recommendation data storage

### Schema (per-track)

Located inside `tracks/<songId>.json` under the `aiRecommendations` key (see feature 2 schema).

Per-metric entry:

```ts
interface MetricRecommendation {
  recommended_value: number | string;   // typed to metric (string when e.g. "reduce 1.5 dB")
  unit: string;                          // "LUFS", "dBTP", "dB", "%" etc.
  reason: string;                        // 1-2 sentence rationale, shown in tooltip
  timestamp: string;                     // ISO
  model: string;                         // e.g. "claude-opus-4-6", "gpt-5.4"
  versionId: string;                     // opaque bump id — resets "ai_recommended"
}
```

Track-level flag:

```ts
interface TrackAiRecommendations {
  schemaVersion: number;
  aiRecommended: boolean;                // if false → auto-run fires on next Mastering Full Screen open
  lastGeneratedAt: string | null;
  lastClearedAt: string | null;
  versionId: string | null;
  metrics: Record<string, MetricRecommendation>;
  errors: Array<{ metricId?: string; timestamp: string; message: string }>;
}
```

`versionId` bumps when the recommendation schema or prompt materially changes — that invalidates existing recommendations and re-triggers auto-run the next time the track is opened.

### Re-run tool interface

**Natural-language shape (chat):**
> "Re-run mastering recommendations for this track"
> "Regenerate AI recommendations"
> "Refresh mastering AI"

**Button:** Small "Regenerate AI" secondary button in the Mastering Full Screen header row, next to the toggle.

**Parameters:**
- `trackId?: string` (defaults to current track)
- `confirm?: boolean` (skip the "this will overwrite" confirm — default `false`)

**Effect:**
1. Clear `metrics`, set `aiRecommended: false`, set `lastClearedAt: now`.
2. Fire the generation flow.
3. On success, populate `metrics`, set `aiRecommended: true`, `lastGeneratedAt: now`, bump `versionId` if schema changed.
4. On failure, push to `errors`, leave `aiRecommended: false`.

### Write semantics

- All writes go through the main process (`UserStateService.patchTrackState(trackId, patch)` — new method).
- In-flight requests are keyed by `{ trackId, versionId, requestId }` so late responses from a cancelled run do not overwrite a newer run's results.
- If the user switches tracks mid-generation, the response still writes to the originating `trackId` — it just doesn't render on the currently-visible track.

---

## Phased delivery

**Phase 1 — Feature 2 foundation (state split).** Ship the migration + split file layout + fallback reader. No UI changes, no new features exposed. Ship dark. Run for a week on dev machines before enabling any consumer of the new files. **Biggest risk is here — ship alone.**

**Phase 2 — Per-track API surface.** Expose `UserStateService.readTrackState(trackId)` and `patchTrackState(trackId, patch)` via IPC. Renderer migrates `persistAiEqForSong`, `persistEqLiveStateForSong`, `persistRatingForSong`, `persistChecklistForSong`, `persistDawOffsetForSong` off localStorage / monolithic file onto the per-track files. Backwards compatibility: keep monolithic field writes going for one release so downgrades don't lose data.

**Phase 3 — Feature 3 storage schema.** Add `aiRecommendations` to per-track files. Implement `ai_recommended` flag + versionId bump infrastructure. No UI yet — just storage + a debug command to inspect recommendations.

**Phase 4 — Feature 1 UI.** Add the "Show AI recommendations" toggle + the light-blue labels below every metric card. Wire up the auto-run trigger gated on all five guards listed above. Add chat-settings kill switch. Add manual "Regenerate" button.

**Phase 5 — Agent chat tool + polish.** Add `rerun_mastering_recommendations` chat-tool pattern match in the renderer. Error states, retry UI, telemetry/usage reporting (how often the auto-run actually fires vs is skipped). Mac App Store review pass.

---

## Top 5 risks with mitigations

1. **Partial migration corrupts state.** Crash between writing per-track files and flipping the completed flag leaves a half-migrated tree.
   - *Mitigation:* backup file written and verified before any per-track write; `migration.stateSplitStatus` transitions `pending → in-progress → completed`; load path reads backup if status is not `completed`. Every write is atomic temp + rename. Write all per-track files before flipping the completed flag (all or nothing).

2. **`songId` is not stable.** If the renderer's `songId` derivation changes (normalization rules, folder reassignment), per-track filenames become unreachable.
   - *Mitigation:* freeze the `songId` → trackId mapping in the manifest at migration time; all future lookups go through manifest, not re-derivation. Add a renderer-side warning if `songId` doesn't match the manifest entry.

3. **AI recommendation auto-run storms.** Opening multiple tracks quickly could fire N concurrent agent requests, hammering the CLI and making the user wait.
   - *Mitigation:* per-track in-flight set; global semaphore of 1 auto-run at a time (queue others or drop). Additionally, gate auto-run on "Mastering Full Screen has been visible for 1 second" debounce so rapid track-switching doesn't fire.

4. **Model/schema drift invalidates stored recommendations.** The agent model changes, bands change, platforms added — but users have old recommendations displayed that no longer match the metric set.
   - *Mitigation:* every metric entry stores `versionId` + `model`; renderer only displays recommendations where `versionId` matches the current `AI_REC_SCHEMA_VERSION`. Stale entries trigger "AI recommendation stale — re-run?" UI. Bumping the schema version force-resets the `aiRecommended` flag on next open.

5. **iCloud backup + restore across migration.** Old iCloud snapshot (monolithic) restored onto a post-migration client; new iCloud snapshot (per-track tree) restored onto a pre-migration client.
   - *Mitigation:* iCloud backup payload ships a `stateSplitStatus` field; restore replays the migration if target client is post-migration. Old clients (pre-feature) keep writing/reading the monolithic file — they are supported forever via the fallback read path.

---

## Codex opinion (verbatim)

The following is Codex's (`gpt-5.4`) full response to the design-review question posed on 2026-04-18. Reproduced verbatim.

> ### Prioritized Risks
>
> 1. **Partial / interrupted migration**
>    - Electron crashes, force-quits, or disk full mid-migration can leave state in a half-split form.
>    - Must be atomic at the user's perception level. Either fully migrated or fully legacy.
>    - Use write-then-rename for the global file and each track file, and never delete the legacy file until a post-migration sanity check passes.
>
> 2. **Loss of per-track data due to identity mismatch**
>    - Current per-track data is keyed by `songId` inside the monolithic file. New per-file scheme must preserve that identity.
>    - Audio filename is unstable (renames, duplicates, capitalization, path changes) and is not safe as the canonical key.
>    - Prefer: existing stable `songId` → generated `track_id` mapping stored in a manifest, optionally augmented with a content hash as a fallback.
>    - Files on disk should use the `track_id`, not the raw filename.
>
> 3. **Ambiguous identity when legacy keys overlap or are missing**
>    - Legacy data keyed by inconsistent ids (e.g. `songId` that used filename in some builds, UUID in others).
>    - Migration must tolerate and report collisions, never silently merge two tracks' state.
>    - When in doubt, keep conflicting entries separately under different generated track ids and log it in a migration report.
>
> 4. **Rollback coherence**
>    - "One-way migration with rollback support" is only safe if the legacy monolithic file is never touched.
>    - Rollback must be explicit: read from preserved legacy file, not a reconstructed one.
>    - Rebuilding a legacy file from per-track files is a different, lossier operation and must be labeled that way.
>
> 5. **Concurrent writes and stale caches**
>    - Renderer and main process may both be writing.
>    - In-memory caches must invalidate whenever per-track files change.
>    - Adding many small files means many small writes; autosave loops need to be batched and debounced to avoid fsync storms and temp-file explosions.
>
> 6. **AI recommendation race conditions**
>    - Track is opened → auto-run kicks off.
>    - Before results arrive, user switches tracks or triggers a manual re-run.
>    - Multiple writes targeting the same per-track file.
>    - Results arriving for a track that is no longer active may overwrite newer user-driven values.
>    - Must include: per-track request id, result association to that id, and a write policy that rejects stale or superseded writes.
>
> 7. **`ai_recommended: true` semantics**
>    - Flag cannot mean "never run again" without a version identifier.
>    - If the recommendation schema, model, or prompt evolves, old recommendations are no longer comparable.
>    - Suggest: `ai_recommended_version` or `ai_recommended_for_schema_version` to trigger re-runs on upgrade, not a pure boolean.
>
> 8. **Partial recommendation results**
>    - Some metrics may be produced, others may fail.
>    - Writing a half-finished block and flipping the flag to `true` would lock the user into a broken state.
>    - Persist recommendations atomically per-run, only flip `ai_recommended` when the run completes successfully.
>    - Keep a per-metric `status` field so UI can show "missing / failed / recommended" without requiring a global re-run.
>
> 9. **Global disable toggle vs in-flight auto-run**
>    - User disables auto-run mid-request.
>    - Recommended behavior: disable prevents new auto-runs; active auto-runs are cancelled when possible, otherwise ignored unless they were manual.
>
> 10. **UI toggle persistence confusion**
>    - `Show AI recommendations` controls visibility, not generation.
>    - Users may turn visibility off but still expect recommendations to exist later.
>    - Keep separate settings:
>      - `show_ai_recommendations`
>      - `enable_ai_auto_recommendations`
>      - per-track `auto_run_completed_by_version`
>
> 11. **Schema drift**
>    - Recommendations will evolve as metric names, spectral bands, platforms, or model prompts change.
>    - Every recommendation payload needs a schema version and prompt/model version.
>    - Do not overwrite old values without enough metadata to determine compatibility.
>
> 12. **Platform normalization entry stability**
>    - Platform names may change or duplicate: Spotify, Apple Music, YouTube, SoundCloud, etc.
>    - Use stable platform IDs, not display labels.
>    - Example: `spotify_loud`, `apple_music`, `youtube_music`.
>
> 13. **Malformed or user-edited JSON**
>    - Existing users may have corrupted or manually edited state files.
>    - Migration should validate, skip unrecoverable track entries into a quarantine report, and keep the original backup intact.
>
> 14. **Path privacy and portability**
>    - Per-track files named directly after audio filenames may leak private project names and break on invalid characters.
>    - Use hashed or slugged filenames with a manifest.
>
> 15. **Backup size and cleanup**
>    - Populated users may have large state files. Migration backups can multiply disk usage.
>    - Keep one timestamped backup and a migration report. Avoid repeated backups on every launch.
>
> ### Migration-Test Plan
>
> 1. **Golden fixture migration**
>    - Build fixtures for real legacy `producer-player-user-state.json` shapes:
>      - Empty state.
>      - One track.
>      - Hundreds/thousands of tracks.
>      - Missing optional fields.
>      - Unknown future fields.
>      - Mixed per-track and global fields.
>    - Assert byte-level or semantic equivalence after migrating and rehydrating.
>
> 2. **Round-trip tests**
>    - Legacy single-file state → per-track files + global file → reconstructed legacy-compatible object.
>    - Assert no dropped keys from:
>      - `songRatings`
>      - `songChecklists`
>      - `eqSnapshots`
>      - `eqLiveStates`
>      - `aiEqRecommendations`
>      - `perSongReferenceTracks`
>      - `songDawOffsets`
>      - any unknown `songId`-keyed maps.
>
> 3. **Failure injection tests**
>    - Simulate crash/failure after:
>      - Backup written.
>      - Manifest written.
>      - First track file written.
>      - Half the track files written.
>      - Global file written.
>      - Migration marker set to completed.
>    - On next launch, app must either resume safely or roll back to the original state.
>
> 4. **Atomic write tests**
>    - Force interrupted writes and confirm no truncated canonical JSON files are read.
>    - Verify temp files are ignored or cleaned up.
>
> 5. **Rollback tests**
>    - Validate rollback before completion restores the exact original legacy file.
>    - Validate rollback after completion is either blocked or performs a tested merge.
>    - Verify rollback preserves backup metadata and emits a clear migration report.
>
> 6. **Duplicate identity tests**
>    - Same filename in different folders.
>    - Same `songId` pointing to renamed file.
>    - Missing audio path.
>    - Two legacy IDs with the same basename.
>    - Assert no file overwrites and no merged track state unless explicitly intended.
>
> 7. **Corrupt input tests**
>    - Invalid JSON.
>    - Valid JSON with wrong types.
>    - Track map values that are `null`, arrays, strings, or unexpected objects.
>    - Migration should fail closed: preserve original, write error report, do not produce partial "completed" state.
>
> 8. **Version upgrade tests**
>    - Migration from schema v0 → v1.
>    - Re-running migration on already migrated state must be idempotent.
>    - Older app opening newer state should either refuse safely or use the backup path.
>
> 9. **Concurrent access tests**
>    - Migration while renderer requests track state.
>    - Agent result arrives during migration.
>    - Autosave fires during migration.
>    - Expected behavior: migration lock blocks writes, queues them, or fails cleanly.
>
> 10. **Realistic user acceptance fixture**
>    - Copy an anonymized populated user state.
>    - Run migration.
>    - Open several tracks and verify ratings, checklists, EQ state, references, DAW offsets, and AI data load exactly as before.
>
> ### Recommended Data Model
>
> Use a global file plus a track manifest plus one file per stable track ID.
>
> ```
> user-data/
>   producer-player-user-state.json
>   producer-player-user-state.backup.2026-04-18T120000Z.json
>   tracks/
>     manifest.json
>     trk_01HV8ZJ7Q9K8M3R6X2A4N5B6C7.json
>     trk_01HV8ZK2Y3P9S8D7F6G5H4J3K2.json
>   migrations/
>     2026-04-18T120000Z-state-v2-report.json
> ```
>
> Global file should hold only app-wide data. Manifest holds `track_id` → state-file mapping with audio metadata (original filename, last known path, optional content hash). Per-track file holds ratings, checklists, EQ, references, DAW offsets, and the AI recommendations block.
>
> Prefer this filename order:
> 1. Existing stable `songId`, if globally unique.
> 2. Generated stable `track_id` stored in manifest.
> 3. Optional content hash for deduplication, not as the only identity.
> 4. Avoid raw audio filename as the actual JSON filename.
>
> Rollback recommendation:
> - Before migration, copy the legacy file to a timestamped backup.
> - Write `migration.state = "in_progress"` before creating per-track files.
> - Write all per-track files using temp + rename.
> - Write manifest using temp + rename.
> - Write new global state last.
> - Mark migration `completed` only after validation.
> - Keep the legacy backup until the user/app explicitly prunes old backups.
> - On failed startup migration, prefer original legacy file over partially migrated output.
>
> ### Auto-Run + Toggle Concerns
>
> - `Show AI recommendations` should only control rendering. It should not start, stop, delete, or overwrite recommendations.
> - Global chat-settings toggle should control whether auto-run is allowed.
> - Manual re-run should remain available unless the global setting is meant to disable all AI usage, not just auto-run.
> - Opening Mastering Full Screen should check all of these before auto-running:
>   - Active track has a valid `track_id`.
>   - Global AI auto-run setting is enabled.
>   - Track has no completed auto-run for current `version_id`.
>   - No in-flight recommendation request exists for the same `track_id` and `version_id`.
>   - Required analysis data is available and current.
> - If the user changes track while a request is running, late results must be written only to the originating track file and displayed only if that track is still active.
> - If manual re-run starts while auto-run is in flight, cancel or supersede the auto-run using `request_id`.
> - If auto-run finishes after manual re-run, it must not overwrite manual results.
> - If the recommendation schema, model, prompt, or analysis pipeline changes, "once per track" should reset via a new `version_id`.
> - Store enough request metadata to debug: `request_id`, `source`, `started_at`, `completed_at`, `model`, `version_id`, `analysis_version`, `status`, `error`.
> - UI should distinguish: no recommendation yet, loading, hidden by toggle, auto-run disabled globally, failed, stale because model/schema/analysis version changed.
>
> The main design rule: treat migration as a transaction, track identity as stable app data rather than a filename, and treat AI recommendation writes as versioned, request-scoped updates rather than ordinary UI state.

---

## Open questions for Ethan (answer before build dispatch)

1. **Per-track filename convention.** Codex and I both recommend `tracks/<songId>.json` (not raw audio filename). You said "keyed by audio filename or track ID" — is songId fine? If not, what should we key by?
2. **Fallback behavior on corrupt per-track file.** If `tracks/foo.json` is corrupt post-migration, should the app (a) silently drop that track's state, (b) restore from backup file globally, or (c) show a dialog and let the user choose?
3. **Manual rollback UX.** Should "Restore pre-split backup" be in sidebar Settings, hidden behind a devtools-style power-user menu, or only supported via CLI (`STATE_SPLIT_MIGRATION_DISABLED=1`)?
4. **Re-run tool permission model.** Should the chat-initiated `rerun_mastering_recommendations` require a confirmation dialog, or just run? (Current AI EQ feature runs without confirmation.)
5. **Scope of "all panels."** Do you want recommendations on _every_ panel listed in `MASTERING_PANEL_ASK_AI_META` (18 panels), or just the ones with numeric metric cards (Loudness & Peaks, Platform Normalization, Tonal Balance, Spectrum bands, Crest Factor)? The design doc assumes the latter — the other panels get a single "panel-level" recommendation in the header.
6. **Color token.** Is `#8ecbff` light blue OK, or do you want a specific token? (Existing AI EQ uses cyan `#00e5ff`-ish — these should be distinct.)
7. **Auto-run cost budget.** How concerned are you about agent spend? Each auto-run is one full-track prompt with analysis context. Do we want telemetry or a daily cap?
8. **Spectrum Analyzer relationship.** Confirmed out of scope: the existing "AI EQ" cyan dashed curve + "AI EQ" button stays unchanged, and the new per-band spectral balance recommendations are **separate** text labels on the `tonal-balance` panel (not overlaid on the Spectrum Analyzer graph). Good?

---

## Summary verdict

The migration is the hard part. Both Codex and I agree on the critical design decisions: key by stable `songId` (not filename), never delete the monolithic backup, atomic temp+rename for every write, `migration.stateSplitStatus` gating the read path, and rollback via the preserved backup. Ship phase 1 (migration + fallback reader) alone, dogfood for a week, then layer features 3 and 1 on top. The AI recommendations layer is architecturally straightforward once per-track storage exists — the main novelty is version-gated staleness + request-scoped write semantics.
