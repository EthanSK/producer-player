export const AUDIO_EXTENSIONS = [
  'wav',
  'aiff',
  'aif',
  'aifc',
  'flac',
  'mp3',
  'm4a',
  'aac',
  'ogg',
  'opus',
  'webm',
  'mp4',
] as const;
export type AudioExtension = (typeof AUDIO_EXTENSIONS)[number];

export type LibraryStatus = 'idle' | 'scanning' | 'watching' | 'error';
export type DisplayMode = 'logicalSongs' | 'versions';

export interface LinkedFolder {
  id: string;
  name: string;
  path: string;
  linkedAt: string;
  fileCount: number;
}

export interface SongVersion {
  id: string;
  songId: string;
  folderId: string;
  filePath: string;
  fileName: string;
  extension: AudioExtension;
  modifiedAt: string;
  sizeBytes: number;
  durationMs: number | null;
  isActive: boolean;
}

export interface PlaybackSourceInfo {
  filePath: string;
  url: string;
  mimeType: string;
  extension: string;
  exists: boolean;
  sourceStrategy: 'direct-file' | 'transcoded-cache';
  originalFilePath: string | null;
}

export interface AudioFileAnalysis {
  filePath: string;
  measuredWith: 'ffmpeg-ebur128-volumedetect';
  integratedLufs: number | null;
  loudnessRangeLufs: number | null;
  truePeakDbfs: number | null;
  samplePeakDbfs: number | null;
  meanVolumeDbfs: number | null;
  maxMomentaryLufs: number | null;
  maxShortTermLufs: number | null;
  sampleRateHz: number | null;
}

export interface ReferenceTrackSelection {
  filePath: string;
  fileName: string;
  playbackSource: PlaybackSourceInfo;
}

export interface ProjectFileSelection {
  filePath: string;
  fileName: string;
}

export interface LogicalSong {
  id: string;
  folderId: string;
  title: string;
  normalizedTitle: string;
  activeVersionId: string | null;
  latestExportAt: string | null;
}

export interface SongWithVersions extends LogicalSong {
  versions: SongVersion[];
}

export interface MatcherSettings {
  autoMoveOld: boolean;
}

export interface LibrarySnapshot {
  linkedFolders: LinkedFolder[];
  songs: SongWithVersions[];
  versions: SongVersion[];
  status: LibraryStatus;
  statusMessage: string;
  scannedAt: string | null;
  matcherSettings: MatcherSettings;
}

export interface ProducerPlayerAppVersion {
  semanticVersion: string;
  buildNumber: number | null;
  commitShortSha: string | null;
  /**
   * Clean user-facing version string (e.g., "2.17").
   * Must NEVER include build metadata like "+build.NNN" — users see this in the sidebar.
   */
  displayVersion: string;
}

export interface ProducerPlayerEnvironment {
  isMacAppStoreSandboxed: boolean;
  canLinkFolderByPath: boolean;
  canRequestSecurityScopedBookmarks: boolean;
  isTestMode: boolean;
  platform: 'darwin' | 'win32' | 'linux' | string;
  appVersion: ProducerPlayerAppVersion;
}

export const UI_ZOOM_FACTOR_OPTIONS = [0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15] as const;

export type UiZoomSource = 'auto' | 'user';

export interface UiZoomState {
  /** Effective Electron webContents zoom factor currently applied. */
  factor: number;
  /** Persisted user preference. null means the app should choose automatically. */
  preference: number | null;
  source: UiZoomSource;
  /** Short diagnostic reason for the automatic choice, useful in the UI/logs. */
  reason: string;
  options: number[];
}

export interface PlaylistOrderExportSelection {
  selectedFolderId: string | null;
  selectedFolderPath: string | null;
  selectedFolderName: string | null;
  selectedSongId: string | null;
  selectedSongTitle: string | null;
  selectedSongNormalizedTitle: string | null;
  selectedPlaybackVersionId: string | null;
  selectedPlaybackFilePath: string | null;
  selectedPlaybackFileName: string | null;
}

export interface PlaylistOrderExportOrdering {
  songIds: string[];
  normalizedTitles: string[];
}

export interface PlaylistOrderExportV1 {
  schema: 'producer-player.playlist-order';
  version: 1;
  exportedAt: string;
  selection: PlaylistOrderExportSelection;
  ordering: PlaylistOrderExportOrdering;
  folders: LinkedFolder[];
  songs: SongWithVersions[];
}

/**
 * Enables the experimental agent assistant surfaces in Producer Player,
 * including the renderer chat panel and Electron-backed agent IPC hooks.
 *
 * Enabled again by default while the agent integration is being actively tested.
 */
export const ENABLE_AGENT_FEATURES = true;

export const IPC_CHANNELS = {
  GET_LIBRARY_SNAPSHOT: 'producer-player:get-library-snapshot',
  GET_ENVIRONMENT: 'producer-player:get-environment',
  GET_UI_ZOOM_STATE: 'producer-player:get-ui-zoom-state',
  SET_UI_ZOOM_FACTOR: 'producer-player:set-ui-zoom-factor',
  LINK_FOLDER_DIALOG: 'producer-player:link-folder-dialog',
  LINK_FOLDER_PATH: 'producer-player:link-folder-path',
  UNLINK_FOLDER: 'producer-player:unlink-folder',
  RESCAN_LIBRARY: 'producer-player:rescan-library',
  ORGANIZE_OLD_VERSIONS: 'producer-player:organize-old-versions',
  SET_AUTO_MOVE_OLD: 'producer-player:set-auto-move-old',
  REORDER_SONGS: 'producer-player:reorder-songs',
  EXPORT_PLAYLIST_ORDER: 'producer-player:export-playlist-order',
  IMPORT_PLAYLIST_ORDER: 'producer-player:import-playlist-order',
  EXPORT_LATEST_VERSIONS_IN_ORDER:
    'producer-player:export-latest-versions-in-order',
  OPEN_IN_FINDER: 'producer-player:open-in-finder',
  OPEN_FOLDER: 'producer-player:open-folder',
  OPEN_FILE: 'producer-player:open-file',
  OPEN_EXTERNAL_URL: 'producer-player:open-external-url',
  COPY_TEXT_TO_CLIPBOARD: 'producer-player:copy-text-to-clipboard',
  TO_FILE_URL: 'producer-player:to-file-url',
  RESOLVE_PLAYBACK_SOURCE: 'producer-player:resolve-playback-source',
  ANALYZE_AUDIO_FILE: 'producer-player:analyze-audio-file',
  GET_MASTERING_ANALYSIS_CACHE: 'producer-player:get-mastering-analysis-cache',
  WRITE_MASTERING_ANALYSIS_CACHE: 'producer-player:write-mastering-analysis-cache',
  PICK_REFERENCE_TRACK: 'producer-player:pick-reference-track',
  PICK_PROJECT_FILE: 'producer-player:pick-project-file',
  SNAPSHOT_UPDATED: 'producer-player:snapshot-updated',
  TRANSPORT_COMMAND: 'producer-player:transport-command',
  GET_SHARED_USER_STATE: 'producer-player:get-shared-user-state',
  SET_SHARED_USER_STATE: 'producer-player:set-shared-user-state',
  SYNC_TO_ICLOUD: 'producer-player:sync-to-icloud',
  LOAD_FROM_ICLOUD: 'producer-player:load-from-icloud',
  CHECK_ICLOUD_AVAILABLE: 'producer-player:check-icloud-available',
  CHECK_FOR_UPDATES: 'producer-player:check-for-updates',
  OPEN_UPDATE_DOWNLOAD: 'producer-player:open-update-download',
  AUTO_UPDATE_CHECK: 'producer-player:auto-update-check',
  AUTO_UPDATE_DOWNLOAD: 'producer-player:auto-update-download',
  AUTO_UPDATE_RECHECK: 'producer-player:auto-update-recheck',
  AUTO_UPDATE_INSTALL: 'producer-player:auto-update-install',
  AUTO_UPDATE_SET_ENABLED: 'producer-player:auto-update-set-enabled',
  AUTO_UPDATE_STATE_CHANGED: 'producer-player:auto-update-state-changed',
  AGENT_START_SESSION: 'producer-player:agent-start-session',
  AGENT_SEND_TURN: 'producer-player:agent-send-turn',
  AGENT_SAVE_ATTACHMENT: 'producer-player:agent-save-attachment',
  AGENT_CLEAR_ATTACHMENTS: 'producer-player:agent-clear-attachments',
  AGENT_INTERRUPT: 'producer-player:agent-interrupt',
  AGENT_RESPOND_APPROVAL: 'producer-player:agent-respond-approval',
  AGENT_DESTROY_SESSION: 'producer-player:agent-destroy-session',
  AGENT_EVENT: 'producer-player:agent-event',
  AGENT_CHECK_PROVIDER: 'producer-player:agent-check-provider',
  AGENT_STORE_DEEPGRAM_KEY: 'producer-player:agent-store-deepgram-key',
  AGENT_GET_DEEPGRAM_KEY: 'producer-player:agent-get-deepgram-key',
  AGENT_CLEAR_DEEPGRAM_KEY: 'producer-player:agent-clear-deepgram-key',
  AGENT_STORE_ASSEMBLYAI_KEY: 'producer-player:agent-store-assemblyai-key',
  AGENT_GET_ASSEMBLYAI_KEY: 'producer-player:agent-get-assemblyai-key',
  AGENT_CLEAR_ASSEMBLYAI_KEY: 'producer-player:agent-clear-assemblyai-key',
  OPEN_LOG_FOLDER: 'producer-player:open-log-folder',
  GET_LOG_PATH: 'producer-player:get-log-path',
  LOG_READ_SLICE: 'producer-player:log-read-slice',
  RENDERER_LOG: 'producer-player:renderer-log',
  GET_USER_STATE: 'producer-player:get-user-state',
  SET_USER_STATE: 'producer-player:set-user-state',
  EXPORT_USER_STATE: 'producer-player:export-user-state',
  IMPORT_USER_STATE: 'producer-player:import-user-state',
  USER_STATE_CHANGED: 'producer-player:user-state-changed',
  // v3.30 — AI mastering recommendations (storage layer only; UI in v3.31+)
  AI_RECOMMENDATIONS_GET: 'producer-player:ai-recommendations-get',
  AI_RECOMMENDATIONS_SET: 'producer-player:ai-recommendations-set',
  AI_RECOMMENDATIONS_CLEAR: 'producer-player:ai-recommendations-clear',
  AI_RECOMMENDATIONS_MARK_STALE: 'producer-player:ai-recommendations-mark-stale',
  // v3.39 — Plugin hosting Phase 1a (data model + JUCE sidecar scaffold).
  // UI lands in Phase 1b.
  PLUGIN_SCAN_LIBRARY: 'producer-player:plugin-scan-library',
  PLUGIN_GET_LIBRARY: 'producer-player:plugin-get-library',
  PLUGIN_GET_TRACK_CHAIN: 'producer-player:plugin-get-track-chain',
  PLUGIN_SET_TRACK_CHAIN: 'producer-player:plugin-set-track-chain',
  PLUGIN_ADD_TO_CHAIN: 'producer-player:plugin-add-to-chain',
  PLUGIN_REMOVE_FROM_CHAIN: 'producer-player:plugin-remove-from-chain',
  PLUGIN_REORDER_CHAIN: 'producer-player:plugin-reorder-chain',
  PLUGIN_TOGGLE_ENABLED: 'producer-player:plugin-toggle-enabled',
  PLUGIN_SET_STATE: 'producer-player:plugin-set-state',
  // v3.43 Phase 4 — Plugin preset save/recall.
  PLUGIN_PRESET_SAVE: 'producer-player:plugin-preset-save',
  PLUGIN_PRESET_RECALL: 'producer-player:plugin-preset-recall',
  PLUGIN_PRESET_LIST: 'producer-player:plugin-preset-list',
  PLUGIN_PRESET_DELETE: 'producer-player:plugin-preset-delete',
  // v3.42 — Plugin hosting Phase 3 (native editor windows).
  PLUGIN_EDITOR_OPEN: 'producer-player:plugin-editor-open',
  PLUGIN_EDITOR_CLOSE: 'producer-player:plugin-editor-close',
  // Unsolicited event the main process pushes to the renderer when the
  // sidecar reports an editor window was closed by the user (OS close
  // button) rather than by an explicit close_editor IPC call.
  PLUGIN_EDITOR_CLOSED_EVENT: 'producer-player:plugin-editor-closed-event',
  PLUGIN_INSTANCE_LOADED_EVENT: 'producer-player:plugin-instance-loaded-event',
  PLUGIN_SIDECAR_EXITED_EVENT: 'producer-player:plugin-sidecar-exited-event',
} as const;

export type SnapshotListener = (snapshot: LibrarySnapshot) => void;
export type TransportCommand = 'play-pause' | 'next-track' | 'previous-track' | 'seek-forward' | 'seek-backward';
export type TransportCommandListener = (command: TransportCommand) => void;
export type PluginInstanceLoadedListener = (payload: {
  instanceId: string;
  reportedLatencySamples: number;
}) => void;
export type PluginSidecarExitedListener = (info: {
  code: number | null;
  signal: string | null;
  expected: boolean;
}) => void;

export interface SongChecklistItem {
  id: string;
  text: string;
  completed: boolean;
  timestampSeconds: number | null;
  versionNumber: number | null;
  /**
   * Optional reference to a ListeningDevice by id. When present, the
   * checklist item was captured while the user was listening on that device
   * (e.g. "AirPods Pro", "Kali LP-6"). The device name/color are looked up
   * from `ProducerPlayerUserState.listeningDevices` at render time, so
   * renaming or deleting a device does not mutate historic items.
   */
  listeningDeviceId: string | null;
  /**
   * v3.26.0 — true when the item was promoted from a Mastering Checklist
   * row (LUFS / True Peak / DC Offset / Clipping) via the "+ Add to
   * checklist" button. Used to render the subtle "FROM MASTERING"
   * eyebrow badge in the song-checklist modal and to preserve provenance
   * across state save/load. Defaults to undefined/false for all
   * historical items; the state-service parser coerces unknown values
   * back to false so existing stored checklists load unchanged.
   */
  fromMastering?: boolean;
}

/**
 * Persistent tag for a physical listening device (headphones, monitors, car
 * stereo, etc.) that the user can attach to individual checklist items so
 * they can remember what they were listening on when they jotted the note.
 *
 * The chip color is DERIVED from the id via a deterministic hash — it is not
 * stored here. See `getListeningDeviceColor` in the renderer.
 */
export interface ListeningDevice {
  id: string;
  name: string;
}

export interface AlbumChecklistItem {
  id: string;
  text: string;
  completed: boolean;
}

export interface SavedReferenceTrack {
  filePath: string;
  fileName: string;
  dateLastUsed: string;
  integratedLufs: number | null;
}

export interface EqSnapshot {
  id: string;
  gains: number[];
  timestamp: number;
}

export interface PersistedEqLiveState {
  gains: number[];
  eqEnabled: boolean;
  showAiEqCurve: boolean;
  showRefDiffCurve: boolean;
  showEqTonalBalance: boolean;
}

// ---------------------------------------------------------------------------
// Plugin hosting (v3.39, Phase 1a — data model + JUCE sidecar scaffold)
//
// Effects-only, per-song insert chain. macOS-first (VST3 + AU + CLAP).
// UI lands in Phase 1b; audio path + real plugin loading land in later phases.
// ---------------------------------------------------------------------------

export type PluginFormat = 'vst3' | 'au' | 'clap';

/**
 * Metadata for one installed plugin as reported by the native sidecar scan.
 * Cached in user state so the plugin browser can render offline and survive
 * sidecar restarts without a re-scan round-trip.
 */
export interface PluginInfo {
  /** Stable cross-session id: `<format>:<uid-or-path-hash>`. */
  id: string;
  name: string;
  vendor: string;
  format: PluginFormat;
  version: string;
  /** Filesystem path to the .vst3 bundle / .component / .clap file. */
  path: string;
  /** Vendor-provided category list (may be empty). */
  categories: string[];
  /** False when the plugin failed to scan — `failureReason` has the detail. */
  isSupported: boolean;
  failureReason: string | null;
}

/**
 * One slot in a track's insert chain. `instanceId` is a stable UUID that
 * survives reorders and enable/disable flips; `pluginId` references an entry
 * in `ScannedPluginLibrary.plugins`.
 *
 * `state` is an opaque base64 blob of plugin-serialized state. When absent
 * (fresh insert, plugin not yet opened) consumers should use plugin defaults.
 */
export interface PluginChainItem {
  instanceId: string;
  pluginId: string;
  enabled: boolean;
  /** 0-based position in the chain. Reorder rewrites the whole array. */
  order: number;
  state?: string;
  presetName?: string;
}

/**
 * Ordered effects chain for one track (song). When the array is empty the
 * chain is a no-op and the original audio passes through unchanged — required
 * by Ethan's constraint "If no plugins, no effect on audio."
 */
export interface TrackPluginChain {
  songId: string;
  items: PluginChainItem[];
}

/**
 * Output of a full plugin-folder scan. Persisted as part of
 * `ProducerPlayerUserState.pluginLibrary` so the plugin browser can render
 * without hitting the sidecar every launch.
 */
export interface ScannedPluginLibrary {
  plugins: PluginInfo[];
  scannedAt: string;
  /** Bumped whenever the scan schema/layout changes. */
  scanVersion: number;
}

/**
 * v3.43 Phase 4 — saved opaque state blobs, scoped per stable plugin id.
 * Names are unique within a pluginIdentifier; the blob is sidecar-owned.
 */
export interface PluginPresetEntry {
  pluginIdentifier: string;
  name: string;
  stateBase64: string;
  savedAt: string;
}

export interface PluginPresetLibrary {
  version: 1;
  presets: PluginPresetEntry[];
}

// ---------------------------------------------------------------------------
// AI mastering recommendations (v3.30, Phase 2 — storage schema only)
// ---------------------------------------------------------------------------

/**
 * Lifecycle status of a single AI recommendation entry.
 *
 * - `fresh`   — analysisVersion at generation time matches the track's
 *               current analysis fingerprint. Safe to display normally.
 * - `stale`   — analysis changed since generation; the rec may no longer
 *               reflect the current mix. Rendered with a muted treatment so
 *               the user can still read it and decide whether to re-run.
 * - `loading` — generation in flight. UI renders a placeholder.
 * - `failed`  — the agent request failed. UI renders a retry affordance.
 */
export type AiRecommendationStatus = 'fresh' | 'stale' | 'loading' | 'failed';

/**
 * One AI-recommended value for a single metric on a single track/version.
 *
 * Metric IDs are the same IDs used by `masteringChecklistRules.ts` and the
 * spectrum analyzer panels (e.g. `integrated_lufs`, `true_peak`,
 * `spectral_balance__sub`, `platform__spotify`). Storing raw + formatted
 * value separately lets the UI render without reparsing `recommendedValue`.
 */
export interface AiRecommendation {
  /** Formatted for display, e.g. `"-12.5 LUFS"`, `"reduce 1.5 dB on sub"`. */
  recommendedValue: string;
  /** Optional machine-parseable form when the rec is a single number. */
  recommendedRawValue?: number;
  /** Short human-readable justification; surfaced in tooltip + optional detail row. */
  reason: string;
  /** Model identifier (e.g. `"claude-opus-4-6"`, `"gpt-5.4"`). */
  model: string;
  /** Unique per-request id, for correlation + stale-write rejection. */
  requestId: string;
  /**
   * Opaque fingerprint of the analysis that backed this rec at generation
   * time. When the current analysis fingerprint diverges, the rec is flipped
   * to `'stale'` by `markAiRecommendationsStale`.
   */
  analysisVersion: string;
  /** Unix milliseconds. */
  generatedAt: number;
  /** Lifecycle status — see `AiRecommendationStatus`. */
  status: AiRecommendationStatus;
}

/**
 * A map of recommendations for a single track/version, keyed by metric ID.
 *
 * The keys are arbitrary metric IDs (including unicode) so consumers should
 * not assume a closed enum — the set of metrics grows as new mastering
 * panels are added, and v3.30 stores whatever ids the caller provides.
 */
export type AiRecommendationSet = Record<string, AiRecommendation>;

/**
 * Recommendations scoped to one (songId, versionNumber) pair.
 *
 * - `recommendations`   — per-metric map.
 * - `aiRecommendedFlag` — true when at least one metric in the set has a
 *                         `'fresh'` rec. Used by the auto-run trigger gate
 *                         (v3.31+) to skip already-done tracks.
 * - `lastRunAt`         — unix ms of the most recent generation run end
 *                         (success or failure), or `null` if none.
 */
export interface PerVersionAiRecommendations {
  recommendations: AiRecommendationSet;
  aiRecommendedFlag: boolean;
  lastRunAt: number | null;
}

/**
 * Unified user state — a single file that holds ALL user-authored data.
 * Layout/UI preferences (panel order, expanded states) stay in localStorage.
 */
export interface ProducerPlayerUserState {
  schemaVersion: number; // Start at 1
  updatedAt: string; // ISO timestamp

  // Folder & ordering
  linkedFolders: { path: string; bookmarkData?: string }[];
  songOrder: string[];
  autoMoveOld: boolean;

  // User-authored data
  songRatings: Record<string, number>;
  songChecklists: Record<string, SongChecklistItem[]>;
  songProjectFilePaths: Record<string, string>;

  // Album
  albumTitle: string;
  albumArtDataUrl: string; // data URL (kept small via resize)
  albumChecklists: Record<string, AlbumChecklistItem[]>;

  // Reference tracks
  savedReferenceTracks: SavedReferenceTrack[];
  perSongReferenceTracks: Record<string, string>; // songId -> filePath
  // Per-song opt-in for auto-restoring the saved reference when a track is
  // opened/switched to. Default OFF (v3.16.0): the saved reference still
  // PERSISTS on pick, but is only auto-loaded on track switch when this
  // toggle is ON for that song. When OFF, the currently-loaded global
  // reference is preserved across song switches instead of being replaced.
  perSongRestoreReferenceEnabled: Record<string, boolean>; // songId -> enabled
  // v3.22.0: the "last globally-picked reference" — file path of the most
  // recent reference the user picked via a MANUAL action (choose file,
  // use current as reference, click a saved-reference card). Used as the
  // fallback when switching to a song whose per-song restore toggle is
  // OFF, so the UI returns to the user's last explicit global pick
  // instead of stickily keeping whatever an earlier restore=ON track
  // auto-loaded. Empty string means "no global pick has been made / the
  // user explicitly cleared the reference".
  globalReferenceFilePath: string;

  // EQ snapshots (per-song)
  eqSnapshots: Record<string, EqSnapshot[]>;

  // EQ live state (per-song) — slider positions, enabled state, curve toggles
  eqLiveStates: Record<string, PersistedEqLiveState>;

  // AI EQ recommendations (per-song) — gain arrays suggested by AI
  aiEqRecommendations: Record<string, number[]>;

  // v3.30: AI mastering recommendations (Phase 2 — storage only; no UI yet).
  //
  // Scoped by (songId, versionNumber, analysisVersion):
  //   perTrackAiRecommendations[songId][versionNumber] = PerVersionAiRecommendations
  //
  // Each `PerVersionAiRecommendations` holds a map of metric recommendations
  // keyed by the same metric IDs used by the mastering checklist rules and
  // spectrum analyzer panels. When the analysis fingerprint changes for a
  // (songId, versionNumber) pair, call
  // `markAiRecommendationsStale(songId, versionNumber, newAnalysisVersion)` to
  // flip the still-valid recs to `'stale'` (they are kept — users may still
  // find the old rec useful — but the UI renders them differently).
  //
  // versionNumber is stored as the stringified integer key because JSON
  // objects only support string keys. The state-service parser coerces it
  // back to an integer-like shape on read.
  //
  // UI, auto-run, and agent tool surfaces land in v3.31+.
  perTrackAiRecommendations: Record<string, Record<string, PerVersionAiRecommendations>>;

  // Agent settings
  agentProvider: string;
  agentModels: Record<string, string>;
  agentThinking: Record<string, string>;
  agentSystemPrompt: string;
  agentSttProvider: string;

  // Listening devices — per-checklist-item "what was I hearing it on" tags.
  // The list is the user's saved tag palette; activeListeningDeviceId is the
  // tag that new checklist items will be auto-stamped with until cleared.
  listeningDevices: ListeningDevice[];
  activeListeningDeviceId: string | null;

  // Preferences
  referenceLevelMatchEnabled: boolean;
  iCloudBackupEnabled: boolean;
  autoUpdateEnabled: boolean;

  // App UI zoom. null means automatic; otherwise one of
  // UI_ZOOM_FACTOR_OPTIONS. Applied in Electron via webContents.setZoomFactor
  // so the preference persists across launches without relying on transient
  // Chromium menu-role zoom state.
  uiZoomFactor: number | null;

  // v3.31 — fullscreen Mastering: show per-metric AI recommendation text.
  // Default ON (auto-run preference). When OFF, the UI hides rendered AI
  // recommendation text across the fullscreen panels but the underlying
  // stored state is untouched so the user can flip back without re-running.
  showAiRecommendationsFullscreen: boolean;

  // v3.33 (Phase 4) — gate for the auto-run that fires the agent whenever a
  // new (songId, versionNumber) is opened in fullscreen mastering while the
  // "Show AI recommendations" toggle is ON and analysis is ready. Default ON.
  // When OFF, neither a fresh track-open nor a stale analysis refresh will
  // kick the agent; the manual "Regenerate AI recommendations" button still
  // works. Surfaced in AgentSettings as a checkbox so the user can opt out
  // of any automatic LLM spend.
  agentAutoRecommendEnabled: boolean;

  // Checklist DAW offset — when enabled, checklist timestamps are rendered
  // with a per-song offset added to their raw stored value so the
  // displayed time lines up with the user's digital audio workstation
  // arrangement (useful when the exported song starts past 0:00 in the DAW).
  // NOTE: the seek target stays the raw stored timestamp — this is a pure
  // display transform, not a remap of the underlying audio position.
  //
  // Storage model (refactored from app-global to per-song in v3.9+):
  // - `songDawOffsets` holds the authoritative per-song offset/toggle values,
  //   keyed by songId. Different DAW projects have different arrangement
  //   starts, so each song remembers its own offset.
  // - `checklistDawOffsetDefaultSeconds` / `checklistDawOffsetDefaultEnabled`
  //   track the last-used values across the app. When a song has no saved
  //   offset yet, the UI seeds from these defaults instead of starting at
  //   0:00/disabled — saves retyping 0:42 for every track from the same DAW
  //   project.
  // - Migration: on load, if only the legacy `checklistDawOffsetSeconds` /
  //   `checklistDawOffsetEnabled` fields exist (from v3.8.0 or earlier),
  //   their values are copied into the new "default" fields so prior user
  //   settings aren't dropped.
  songDawOffsets: Record<string, { seconds: number; enabled: boolean }>;
  checklistDawOffsetDefaultSeconds: number;
  checklistDawOffsetDefaultEnabled: boolean;

  // File dialog
  lastFileDialogDirectory: string; // Remembers last-used directory across all file pickers

  // v3.39 — Plugin hosting (Phase 1a, storage only; UI lands Phase 1b).
  //
  // `pluginLibrary` is the cached result of the most recent native sidecar
  // scan. Optional so pre-v3.39 state files load cleanly; `parseUserState`
  // substitutes `undefined` when the field is missing or malformed.
  //
  // `perTrackPluginChains` is keyed by songId and MUST be listed in
  // PER_TRACK_KEYS so the v3.29 split-to-disk pipeline hoists it into
  // per-track files automatically. When a song has no chain entry, the chain
  // is a no-op pass-through (Ethan's "no plugins → no effect" constraint).
  pluginLibrary?: ScannedPluginLibrary;
  perTrackPluginChains?: Record<string, TrackPluginChain>;

  // Main window bounds — persisted across relaunches so the app reopens where
  // it was last positioned. `null` on first launch or when no valid bounds are
  // known yet; the main-process loader validates against currently-connected
  // displays before applying so disconnected-monitor positions fall back to a
  // centered window.
  windowBounds: WindowBounds | null;
}

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  isMaximized: boolean;
}

export interface UserStateImportResult {
  success: boolean;
  error?: string;
}

export interface UserStateExportResult {
  success: boolean;
  folderPath?: string;
  error?: string;
}

export interface SharedUserState {
  ratings: Record<string, number>;
  checklists: Record<string, SongChecklistItem[]>;
  projectFilePaths: Record<string, string>;
  updatedAt: string;
}

export interface ICloudBackupData {
  checklists: Record<string, SongChecklistItem[]>;
  ratings: Record<string, number>;
  projectFilePaths: Record<string, string>;
  state: {
    iCloudEnabled: boolean;
    updatedAt: string;
    [key: string]: unknown;
  };
}

export interface ICloudSyncResult {
  success: boolean;
  error?: string;
}

export interface ICloudLoadResult {
  available: boolean;
  data: ICloudBackupData | null;
  iCloudNewerThan?: string;
  error?: string;
}

export interface ICloudAvailabilityResult {
  available: boolean;
  path: string | null;
  reason?: string;
}

export type UpdateCheckStatus = 'up-to-date' | 'update-available' | 'error';

export interface UpdateCheckResult {
  status: UpdateCheckStatus;
  currentVersion: string;
  latestVersion: string | null;
  latestTag: string | null;
  releaseUrl: string;
  downloadUrl: string | null;
  releaseName: string | null;
  publishedAt: string | null;
  notes: string | null;
  message: string;
}

export type AutoUpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error';

export interface AutoUpdateProgress {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

export interface AutoUpdateState {
  status: AutoUpdateStatus;
  version: string | null;
  progress: AutoUpdateProgress | null;
  error: string | null;
  /**
   * ISO timestamp of the most recent completed check (success or error).
   * null before the first check has run.
   */
  lastCheckedAt?: string | null;
  /**
   * Latest version known from the most recent successful check, even if the
   * current `status` transitioned back to 'idle' (the user closed a banner,
   * for example). Used by the Settings footer line "Installed vX · Latest
   * vY · Last checked HH:MM:SS".
   */
  lastKnownLatestVersion?: string | null;
  /**
   * When `status === 'error'`, the next scheduled retry in ms from now.
   * null when no retry is pending. Used to render "retrying in Ns" hints.
   */
  nextRetryInMs?: number | null;
  /**
   * True while an auto-update prerequisite ruled out any check (not
   * packaged, sandboxed Mac App Store, test mode). When true the UI should
   * render a dim "Updates managed by the Mac App Store" / "Dev build —
   * updates disabled" note so silent no-ops are visible.
   */
  disabledReason?: 'not-packaged' | 'mac-app-store' | 'test-mode' | null;
}

export type AutoUpdateRecheckResult =
  | { status: 'newer-downloading'; version: string | null }
  | { status: 'same-version'; version: string | null }
  | { status: 'no-update'; version: string | null }
  | { status: 'error'; message: string };

export type AutoUpdateStateListener = (state: AutoUpdateState) => void;

export type AgentProviderId = 'claude' | 'codex';
export type AgentMode = 'analysis' | 'ui-interaction';

export interface AgentModelDefinition {
  id: string;
  label: string;
}

export const AGENT_MODEL_OPTIONS_BY_PROVIDER = {
  codex: [
    { id: 'gpt-5.5', label: 'GPT-5.5' },
    { id: 'gpt-5.4', label: 'GPT-5.4' },
    { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
    { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
    { id: 'gpt-5.3-codex-spark', label: 'GPT-5.3 Codex Spark' },
    { id: 'gpt-5.2-codex', label: 'GPT-5.2 Codex' },
    { id: 'gpt-5.2', label: 'GPT-5.2' },
  ],
  claude: [
    { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  ],
} as const satisfies Record<AgentProviderId, readonly AgentModelDefinition[]>;

export type AgentModelId =
  | (typeof AGENT_MODEL_OPTIONS_BY_PROVIDER)[AgentProviderId][number]['id']
  | (string & {});

export const DEFAULT_AGENT_MODEL_BY_PROVIDER: Record<AgentProviderId, AgentModelId> = {
  codex: 'gpt-5.4',
  claude: 'claude-sonnet-4-6',
};

export const AGENT_PROVIDER_LABELS: Record<AgentProviderId, string> = {
  codex: 'Codex',
  claude: 'Claude',
};

export type AgentThinkingEffort = 'low' | 'medium' | 'high';

export interface AgentThinkingOption {
  id: AgentThinkingEffort;
  label: string;
}

export const AGENT_THINKING_OPTIONS: readonly AgentThinkingOption[] = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
];

export const DEFAULT_AGENT_THINKING_BY_PROVIDER: Record<AgentProviderId, AgentThinkingEffort> = {
  codex: 'high',
  claude: 'high',
};

export interface AgentConversationHistoryEntry {
  role: 'user' | 'assistant';
  content: string;
}

export interface AgentStartSessionPayload {
  provider: AgentProviderId;
  mode: AgentMode;
  systemPrompt?: string;
  model?: AgentModelId;
  thinking?: AgentThinkingEffort;
  history?: AgentConversationHistoryEntry[];
}

export interface AgentUiContext {
  documentTitle: string | null;
  locationHref: string | null;
  domSnapshot: string | null;
}

export interface AgentAttachment {
  /** Absolute path to the file on disk that the agent backend can read. */
  path: string;
  /** Original filename as shown to the user (for display in prompts/chips). */
  name: string;
  /** Size in bytes (for display). */
  sizeBytes: number;
  /** Best-effort MIME type. May be an empty string if unknown. */
  mimeType: string;
}

export interface AgentSaveAttachmentPayload {
  name: string;
  /** Raw file contents as a Uint8Array / ArrayBuffer transferred over IPC. */
  data: Uint8Array | ArrayBuffer;
  mimeType?: string;
}

export interface AgentSendTurnPayload {
  message: string;
  context?: AgentContext | null;
  uiContext?: AgentUiContext | null;
  attachments?: AgentAttachment[];
}

export interface AgentRespondApprovalPayload {
  approvalId: string;
  decision: 'allow' | 'deny';
}

export interface AgentTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
}

export type AgentEvent =
  | { type: 'text-delta'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'tool-use-start'; toolName: string; toolId: string; input: unknown }
  | { type: 'tool-use-result'; toolId: string; output: unknown }
  | { type: 'approval-request'; approvalId: string; toolName: string; description: string }
  | { type: 'turn-complete'; usage?: AgentTokenUsage }
  | { type: 'error'; code: string; message: string }
  | { type: 'session-ended'; reason: string };

export interface AgentTrackInfo {
  name: string;
  fileName: string;
  filePath: string;
  format: string;
  durationSeconds: number;
  sampleRateHz: number | null;
  albumName: string | null;
  albumTrackCount: number;
  referenceTrack: { fileName: string; filePath: string } | null;
}

export interface AgentStaticAnalysis {
  integratedLufs: number | null;
  loudnessRangeLufs: number | null;
  truePeakDbfs: number | null;
  samplePeakDbfs: number | null;
  meanVolumeDbfs: number | null;
  maxMomentaryLufs: number | null;
  maxShortTermLufs: number | null;
  sampleRateHz: number | null;
}

export interface AgentWebAudioAnalysis {
  peakDbfs: number;
  integratedLufsEstimate: number;
  rmsDbfs: number;
  crestFactorDb: number;
  dcOffset: number;
  clipCount: number;
  durationSeconds: number;
  tonalBalance: {
    low: number;
    mid: number;
    high: number;
  };
  frameLoudnessDbfs: number[];
  frameDurationSeconds: number;
}

export interface AgentPlatformNormalizationEntry {
  platformId: string;
  platformLabel: string;
  targetLufs: number;
  truePeakCeilingDbtp: number;
  policy: string;
  rawGainDb: number | null;
  appliedGainDb: number | null;
  projectedIntegratedLufs: number | null;
  headroomCapDb: number | null;
  limitedByHeadroom: boolean;
  explanation: string;
}

export interface AgentPlatformNormalization {
  platforms: AgentPlatformNormalizationEntry[];
}

export interface AgentReferenceAnalysis {
  static: AgentStaticAnalysis | null;
  webAudio: AgentWebAudioAnalysis | null;
  deltas: {
    integratedLufsDelta: number | null;
    truePeakDelta: number | null;
    crestFactorDelta: number | null;
    tonalBalanceDelta: {
      low: number;
      mid: number;
      high: number;
    } | null;
    loudnessRangeDelta: number | null;
  } | null;
}

export interface AgentChecklistStatus {
  items: Array<{
    id: string;
    text: string;
    completed: boolean;
    timestampSeconds: number | null;
    versionNumber: number | null;
  }>;
  completedCount: number;
  totalCount: number;
}

export interface MasteringCacheEntry {
  schemaVersion: number;
  cacheKey: string;
  source: 'selected-track' | 'background-preload' | 'manual-request';
  analyzedAt: string;
  songId: string;
  songTitle: string;
  folderId: string;
  versionId: string;
  filePath: string;
  fileName: string;
  extension: string;
  durationSeconds: number | null;
  fileSizeBytes: number;
  fileModifiedAtMs: number;
  measuredAnalysis: AudioFileAnalysis;
  staticAnalysis: AgentStaticAnalysis;
  platformNormalization: AgentPlatformNormalization;
}

export interface MasteringAnalysisCachePayload {
  schemaVersion: number;
  updatedAt: string;
  entries: MasteringCacheEntry[];
}

export interface MasteringAnalysisCacheState {
  cacheDirectoryPath: string;
  cacheFilePath: string;
  payload: MasteringAnalysisCachePayload;
}

export interface AgentMasteringCacheTrackSummary {
  songId: string;
  songTitle: string;
  versionId: string;
  fileName: string;
  filePath: string;
  cacheStatus: 'fresh' | 'stale' | 'missing' | 'pending' | 'error';
  analyzedAt: string | null;
  staticAnalysis: AgentStaticAnalysis | null;
  platformNormalization: AgentPlatformNormalization | null;
}

export interface AgentMasteringCache {
  schemaVersion: number;
  cacheDirectoryPath: string | null;
  cacheFilePath: string | null;
  updatedAt: string | null;
  trackCount: number;
  cachedTrackCount: number;
  pendingTrackCount: number;
  tracks: AgentMasteringCacheTrackSummary[];
  cacheEntryFormat: string;
  cacheInvalidationStrategy: string;
  disclosureReminder: string;
}

export interface AgentContext {
  track: AgentTrackInfo | null;
  staticAnalysis: AgentStaticAnalysis | null;
  webAudioAnalysis: AgentWebAudioAnalysis | null;
  platformNormalization: AgentPlatformNormalization | null;
  reference: AgentReferenceAnalysis | null;
  checklist: AgentChecklistStatus | null;
  masteringCache: AgentMasteringCache | null;
  activePlatformId: string | null;
  isPlaying: boolean;
  currentTimeSeconds: number;
}

export type AgentEventListener = (event: AgentEvent) => void;

export interface LogReadSliceArgs {
  file: string;
  startLine: number;
  endLine: number;
}

export interface LogReadSliceResult {
  file: string;
  startLine: number;
  endLine: number;
  lines: string[];
}

export interface ProducerPlayerBridge {
  getLibrarySnapshot(): Promise<LibrarySnapshot>;
  getEnvironment(): Promise<ProducerPlayerEnvironment>;
  linkFolderWithDialog(): Promise<LibrarySnapshot>;
  linkFolder(folderPath: string): Promise<LibrarySnapshot>;
  unlinkFolder(folderId: string): Promise<LibrarySnapshot>;
  rescanLibrary(): Promise<LibrarySnapshot>;
  organizeOldVersions(): Promise<LibrarySnapshot>;
  setAutoMoveOld(enabled: boolean): Promise<LibrarySnapshot>;
  reorderSongs(songIds: string[]): Promise<LibrarySnapshot>;
  exportPlaylistOrder(payload: PlaylistOrderExportV1): Promise<{ filePath: string | null }>;
  importPlaylistOrder(): Promise<PlaylistOrderExportV1 | null>;
  exportLatestVersionsInOrder(
    payload: PlaylistOrderExportV1
  ): Promise<{ folderPath: string | null; exportedCount: number }>;
  revealFile(filePath: string): Promise<void>;
  openFolder(folderPath: string): Promise<void>;
  openFile(filePath: string): Promise<void>;
  openExternalUrl(url: string): Promise<void>;
  copyTextToClipboard(text: string): Promise<void>;
  toFileUrl(filePath: string): Promise<string>;
  resolvePlaybackSource(filePath: string): Promise<PlaybackSourceInfo>;
  analyzeAudioFile(filePath: string): Promise<AudioFileAnalysis>;
  getMasteringAnalysisCache(): Promise<MasteringAnalysisCacheState>;
  writeMasteringAnalysisCache(
    payload: MasteringAnalysisCachePayload
  ): Promise<MasteringAnalysisCacheState>;
  pickReferenceTrack(): Promise<ReferenceTrackSelection | null>;
  pickProjectFile(initialPath?: string | null): Promise<ProjectFileSelection | null>;
  getSharedUserState(): Promise<SharedUserState>;
  setSharedUserState(state: Omit<SharedUserState, 'updatedAt'>): Promise<SharedUserState>;
  syncToICloud(data: ICloudBackupData): Promise<ICloudSyncResult>;
  loadFromICloud(): Promise<ICloudLoadResult>;
  checkICloudAvailable(): Promise<ICloudAvailabilityResult>;
  checkForUpdates(): Promise<UpdateCheckResult>;
  openUpdateDownload(url?: string | null): Promise<void>;
  autoUpdateCheck(): Promise<void>;
  autoUpdateDownload(): Promise<void>;
  autoUpdateRecheck(): Promise<AutoUpdateRecheckResult>;
  autoUpdateInstall(): Promise<void>;
  setAutoUpdateEnabled(enabled: boolean): Promise<void>;
  getUiZoomState(): Promise<UiZoomState>;
  setUiZoomFactor(factor: number | null): Promise<UiZoomState>;
  onAutoUpdateStateChanged(listener: AutoUpdateStateListener): () => void;
  onSnapshotUpdated(listener: SnapshotListener): () => void;
  onTransportCommand(listener: TransportCommandListener): () => void;
  agentStartSession(payload: AgentStartSessionPayload): Promise<void>;
  agentSendTurn(payload: AgentSendTurnPayload): Promise<void>;
  agentSaveAttachment(payload: AgentSaveAttachmentPayload): Promise<AgentAttachment>;
  agentClearAttachments(paths: string[]): Promise<void>;
  agentInterrupt(): Promise<void>;
  agentRespondApproval(payload: AgentRespondApprovalPayload): Promise<void>;
  agentDestroySession(): Promise<void>;
  agentCheckProvider(provider: AgentProviderId): Promise<boolean>;
  agentStoreDeepgramKey(key: string): Promise<void>;
  agentGetDeepgramKey(): Promise<string | null>;
  agentClearDeepgramKey(): Promise<void>;
  agentStoreAssemblyAiKey(key: string): Promise<void>;
  agentGetAssemblyAiKey(): Promise<string | null>;
  agentClearAssemblyAiKey(): Promise<void>;
  onAgentEvent(listener: AgentEventListener): () => void;
  openLogFolder(): Promise<void>;
  getLogPath(): Promise<string>;
  logReadSlice(args: LogReadSliceArgs): Promise<LogReadSliceResult>;
  rendererLog(level: 'error' | 'warn' | 'info', message: string, meta?: Record<string, unknown>): Promise<void>;
  getUserState(): Promise<ProducerPlayerUserState>;
  setUserState(state: ProducerPlayerUserState): Promise<ProducerPlayerUserState>;
  exportUserState(): Promise<UserStateExportResult>;
  importUserState(): Promise<UserStateImportResult>;
  onUserStateChanged(listener: (state: ProducerPlayerUserState) => void): () => void;

  // v3.30 — AI mastering recommendations (Phase 2 storage surface, no UI yet).
  // Renderer consumers land in v3.31+.
  getAiRecommendations(
    songId: string,
    versionNumber: number,
  ): Promise<AiRecommendationSet | null>;
  setAiRecommendation(
    songId: string,
    versionNumber: number,
    metricId: string,
    recommendation: AiRecommendation,
  ): Promise<void>;
  clearAiRecommendations(songId: string, versionNumber?: number): Promise<void>;
  markAiRecommendationsStale(
    songId: string,
    versionNumber: number,
    newAnalysisVersion: string,
  ): Promise<void>;

  // v3.39 — Plugin hosting (Phase 1a storage + sidecar wiring; UI lands 1b).
  // Renderer consumers arrive in Phase 1b.
  scanPluginLibrary(): Promise<ScannedPluginLibrary>;
  getPluginLibrary(): Promise<ScannedPluginLibrary | null>;
  getTrackPluginChain(songId: string): Promise<TrackPluginChain>;
  setTrackPluginChain(songId: string, chain: TrackPluginChain): Promise<TrackPluginChain>;
  addPluginToChain(songId: string, pluginId: string): Promise<TrackPluginChain>;
  removePluginFromChain(songId: string, instanceId: string): Promise<TrackPluginChain>;
  reorderPluginChain(songId: string, orderedInstanceIds: string[]): Promise<TrackPluginChain>;
  togglePluginEnabled(songId: string, instanceId: string, enabled: boolean): Promise<TrackPluginChain>;
  setPluginState(songId: string, instanceId: string, state: string): Promise<TrackPluginChain>;
  savePluginPreset(songId: string, instanceId: string, name: string): Promise<PluginPresetEntry>;
  recallPluginPreset(songId: string, instanceId: string, name: string): Promise<TrackPluginChain>;
  listPluginPresets(pluginIdentifier: string): Promise<PluginPresetEntry[]>;
  deletePluginPreset(pluginIdentifier: string, name: string): Promise<void>;

  // v3.42 — Plugin hosting Phase 3. Native plugin-editor windows. The
  // sidecar owns the JUCE DocumentWindow; these bridge methods just ask
  // it to open/close by instanceId. `onPluginEditorClosed` fires when the
  // user closes an editor via the OS close button so the renderer can
  // clear its per-slot "open" indicator.
  openPluginEditor(instanceId: string): Promise<{ alreadyOpen: boolean }>;
  closePluginEditor(instanceId: string): Promise<void>;
  onPluginEditorClosed(listener: (instanceId: string) => void): () => void;
  onPluginInstanceLoaded(listener: PluginInstanceLoadedListener): () => void;
  onPluginSidecarExited(listener: PluginSidecarExitedListener): () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseString(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }
  return null;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

function parseNullableString(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  return parseString(value);
}

function parseLinkedFolder(value: unknown): LinkedFolder | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = parseString(value.id);
  const name = parseString(value.name);
  const folderPath = parseString(value.path);
  const linkedAt = parseString(value.linkedAt);
  const fileCountRaw =
    typeof value.fileCount === 'number' && Number.isFinite(value.fileCount)
      ? value.fileCount
      : 0;
  const fileCount = fileCountRaw >= 0 ? fileCountRaw : 0;

  if (!id || !name || !folderPath || !linkedAt) {
    return null;
  }

  return {
    id,
    name,
    path: folderPath,
    linkedAt,
    fileCount,
  };
}

function parseSongVersion(value: unknown): SongVersion | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = parseString(value.id);
  const songId = parseString(value.songId);
  const folderId = parseString(value.folderId);
  const filePath = parseString(value.filePath);
  const fileName = parseString(value.fileName);
  const extension = parseString(value.extension);
  const modifiedAt = parseString(value.modifiedAt);
  const sizeBytes = typeof value.sizeBytes === 'number' && Number.isFinite(value.sizeBytes) ? value.sizeBytes : null;
  const durationMs =
    value.durationMs === null
      ? null
      : typeof value.durationMs === 'number' && Number.isFinite(value.durationMs)
        ? value.durationMs
        : undefined;
  const isActive = typeof value.isActive === 'boolean' ? value.isActive : null;

  const supportedExtension =
    typeof extension === 'string' ? (AUDIO_EXTENSIONS as readonly string[]).includes(extension) : false;

  if (
    !id ||
    !songId ||
    !folderId ||
    !filePath ||
    !fileName ||
    !extension ||
    !supportedExtension ||
    !modifiedAt ||
    sizeBytes === null ||
    durationMs === undefined ||
    isActive === null
  ) {
    return null;
  }

  return {
    id,
    songId,
    folderId,
    filePath,
    fileName,
    extension: extension as AudioExtension,
    modifiedAt,
    sizeBytes,
    durationMs,
    isActive,
  };
}

function parseSongWithVersions(value: unknown): SongWithVersions | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = parseString(value.id);
  const folderId = parseString(value.folderId);
  const title = parseString(value.title);
  const normalizedTitle = parseString(value.normalizedTitle);
  const activeVersionId = parseNullableString(value.activeVersionId);
  const latestExportAt = parseNullableString(value.latestExportAt);

  const versionsRaw = Array.isArray(value.versions) ? value.versions : [];
  const versions = versionsRaw
    .map((entry) => parseSongVersion(entry))
    .filter((entry): entry is SongVersion => Boolean(entry));

  if (!id || !folderId || !title || !normalizedTitle || versions.length === 0) {
    return null;
  }

  return {
    id,
    folderId,
    title,
    normalizedTitle,
    activeVersionId: activeVersionId ?? null,
    latestExportAt: latestExportAt ?? null,
    versions,
  };
}

function parseSelection(value: unknown): PlaylistOrderExportSelection | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    selectedFolderId: parseNullableString(value.selectedFolderId) ?? null,
    selectedFolderPath: parseNullableString(value.selectedFolderPath) ?? null,
    selectedFolderName: parseNullableString(value.selectedFolderName) ?? null,
    selectedSongId: parseNullableString(value.selectedSongId) ?? null,
    selectedSongTitle: parseNullableString(value.selectedSongTitle) ?? null,
    selectedSongNormalizedTitle:
      parseNullableString(value.selectedSongNormalizedTitle) ?? null,
    selectedPlaybackVersionId: parseNullableString(value.selectedPlaybackVersionId) ?? null,
    selectedPlaybackFilePath: parseNullableString(value.selectedPlaybackFilePath) ?? null,
    selectedPlaybackFileName: parseNullableString(value.selectedPlaybackFileName) ?? null,
  };
}

function parseOrdering(value: unknown): PlaylistOrderExportOrdering | null {
  if (!isRecord(value)) {
    return null;
  }

  const songIds = parseStringArray(value.songIds);
  const normalizedTitles = parseStringArray(value.normalizedTitles);

  if (songIds.length === 0 || normalizedTitles.length === 0) {
    return null;
  }

  if (songIds.length !== normalizedTitles.length) {
    return null;
  }

  return {
    songIds,
    normalizedTitles,
  };
}

export function parsePlaylistOrderExport(payload: unknown): PlaylistOrderExportV1 {
  if (!isRecord(payload)) {
    throw new Error('Playlist export must be a JSON object.');
  }

  if (payload.schema !== 'producer-player.playlist-order') {
    throw new Error('Playlist export schema mismatch.');
  }

  if (payload.version !== 1) {
    throw new Error('Unsupported playlist export version.');
  }

  const exportedAt = parseString(payload.exportedAt);
  if (!exportedAt) {
    throw new Error('Playlist export missing exportedAt timestamp.');
  }

  const selection = parseSelection(payload.selection);
  if (!selection) {
    throw new Error('Playlist export selection is invalid.');
  }

  const ordering = parseOrdering(payload.ordering);
  if (!ordering) {
    throw new Error('Playlist export ordering is invalid.');
  }

  const folders = (Array.isArray(payload.folders) ? payload.folders : [])
    .map((entry) => parseLinkedFolder(entry))
    .filter((entry): entry is LinkedFolder => Boolean(entry));

  const songs = (Array.isArray(payload.songs) ? payload.songs : [])
    .map((entry) => parseSongWithVersions(entry))
    .filter((entry): entry is SongWithVersions => Boolean(entry));

  if (songs.length === 0) {
    throw new Error('Playlist export contains no songs.');
  }

  const orderingSongIdSet = new Set(ordering.songIds);
  const exportedSongIdSet = new Set(songs.map((song) => song.id));
  const missingFromPayload = Array.from(orderingSongIdSet).filter((songId) => !exportedSongIdSet.has(songId));

  if (missingFromPayload.length > 0) {
    throw new Error('Playlist export ordering references songs missing from payload.');
  }

  return {
    schema: 'producer-player.playlist-order',
    version: 1,
    exportedAt,
    selection,
    ordering,
    folders,
    songs,
  };
}
