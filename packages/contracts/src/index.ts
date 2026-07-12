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
  // v3.269 — Bit depth + sample format (Ethan voice 7201, 2026-05-29).
  // Bit depth tells producers whether a master is 16-bit (CD quality),
  // 24-bit (typical studio master), 32-bit float (high-headroom master),
  // etc. Displayed alongside sample rate in the Inspector version-history
  // row. Optional/nullable because lossy formats (mp3, AAC) do not have a
  // meaningful PCM bit depth — we surface "—" for those. `sampleFormat` is
  // the ffprobe `sample_fmt` string (e.g. `s16`, `s32`, `flt`, `dbl`) so the
  // formatter can render "32-bit float" instead of just "32-bit".
  bitDepth?: number | null;
  sampleFormat?: string | null;
  // BPM comes from embedded audio metadata tags (`TBPM`, `BPM`, `tempo`, etc.)
  // or, for songs linked to Ableton, the `.als` global tempo. `undefined` means
  // an older cache entry was created before BPM probing existed; `null` means
  // the probe ran and no supported metadata/project source advertised a usable
  // tempo.
  bpm?: number | null;
}

export interface AudioMetadataProbeResult {
  filePath: string;
  probedWith: 'ffprobe-tags';
  // Null is a definitive "no supported BPM source found" result. Renderer code
  // uses that to avoid repeatedly probing the same unchanged file forever.
  bpm: number | null;
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

export interface CustomScriptConfig {
  /** Button label shown after the script is configured. */
  name: string;
  /** Absolute path to the bash script Producer Player should run. */
  filePath: string;
}

export interface CustomScriptRunContext {
  selectedFolderId: string | null;
  selectedFolderPath: string | null;
  selectedFolderName: string | null;
  selectedSongId: string | null;
  selectedSongTitle: string | null;
  selectedPlaybackVersionId: string | null;
  selectedPlaybackFilePath: string | null;
  selectedPlaybackFileName: string | null;
}

export interface CustomScriptRunRequest {
  config: CustomScriptConfig;
  context: CustomScriptRunContext;
}

export interface CustomScriptRunResult {
  ok: boolean;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  error: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

/**
 * v3.189.0 — Result of duplicating a song's linked project file with a
 * trailing version suffix. `ok=true` carries the absolute path of the
 * new copy plus the version number actually appended (after stripping
 * any pre-existing `vN` suffix from the source filename and bumping for
 * collisions, so the renderer can show "Saved copy: foo v48 (2).als" if
 * it had to fall back).
 */
export type SongProjectSaveCopyResult =
  | {
      ok: true;
      newPath: string;
      newFileName: string;
      targetVersion: number;
      /**
       * v3.204 — Size of the copied file in bytes (`fs.stat` of the new
       * path on disk). `null` if the post-copy stat fails — the file
       * is still on disk, we just couldn't read its size, so the
       * renderer should fall back to omitting the size from the
       * success toast.
       */
      sizeBytes: number | null;
    }
  | {
      ok: false;
      error: string;
    };

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

export type MicrophonePermissionStatus =
  | 'not-determined'
  | 'granted'
  | 'denied'
  | 'restricted'
  | 'unknown'
  | 'unsupported';

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
  GET_MICROPHONE_PERMISSION_STATUS:
    'producer-player:get-microphone-permission-status',
  OPEN_MICROPHONE_PRIVACY_SETTINGS:
    'producer-player:open-microphone-privacy-settings',
  COPY_TEXT_TO_CLIPBOARD: 'producer-player:copy-text-to-clipboard',
  TO_FILE_URL: 'producer-player:to-file-url',
  RESOLVE_PLAYBACK_SOURCE: 'producer-player:resolve-playback-source',
  ANALYZE_AUDIO_FILE: 'producer-player:analyze-audio-file',
  PROBE_AUDIO_METADATA: 'producer-player:probe-audio-metadata',
  // v3.195 — Cancel an in-flight ffmpeg analysis by request id. The
  // renderer-side AnalysisQueue's preemption pathway invokes this when a
  // USER-priority click arrives while a NEIGHBOR/BG analysis is mid-flight,
  // so the OS-level child process is SIGKILLed and the slot is freed
  // immediately. No-op if the request id is unknown (already settled).
  CANCEL_ANALYZE_AUDIO_FILE: 'producer-player:cancel-analyze-audio-file',
  GET_MASTERING_ANALYSIS_CACHE: 'producer-player:get-mastering-analysis-cache',
  WRITE_MASTERING_ANALYSIS_CACHE: 'producer-player:write-mastering-analysis-cache',
  PICK_REFERENCE_TRACK: 'producer-player:pick-reference-track',
  PICK_PROJECT_FILE: 'producer-player:pick-project-file',
  PICK_CUSTOM_SCRIPT: 'producer-player:pick-custom-script',
  RUN_CUSTOM_SCRIPT: 'producer-player:run-custom-script',
  // v3.189.0 — Save a copy of the song's linked project file with the next
  // version number appended (e.g. `barber smith.als` → `barber smith v48.als`).
  // Lets producers checkpoint their DAW project alongside each export.
  SONG_PROJECT_SAVE_COPY: 'producer-player:song-project-save-copy',
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
  AUTO_UPDATE_DOWNGRADE: 'producer-player:auto-update-downgrade',
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
  // v3.90 — Agent UI control surface for Producee Boy. Lets the agent eval
  // JS in the renderer, capture a screenshot, or pull a structured DOM
  // snapshot of visible interactive elements. All gated by ENABLE_AGENT_FEATURES.
  AGENT_RUN_JS: 'producer-player:agent-run-js',
  AGENT_SCREENSHOT: 'producer-player:agent-screenshot',
  AGENT_DOM_SNAPSHOT: 'producer-player:agent-dom-snapshot',
  OPEN_LOG_FOLDER: 'producer-player:open-log-folder',
  GET_LOG_PATH: 'producer-player:get-log-path',
  LOG_READ_SLICE: 'producer-player:log-read-slice',
  RENDERER_LOG: 'producer-player:renderer-log',
  // v3.200 — Structured action log. JSONL append-only stream of every
  // user interaction + error, rotating at ~100 MB, keeping last 5 files.
  // Renderer code calls `logAction(event, context)` / `logError(...)` which
  // posts a serialized ActionLogEntry over this channel; the main process
  // writes to `actions.jsonl` alongside the electron-log file.
  ACTION_LOG_APPEND: 'producer-player:action-log',
  ACTION_LOG_GET_PATH: 'producer-player:action-log-get-path',
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
  // v3.39+ — Plugin hosting (data model, UI, sidecar, and live audio bridge).
  PLUGIN_SCAN_LIBRARY: 'producer-player:plugin-scan-library',
  PLUGIN_GET_LIBRARY: 'producer-player:plugin-get-library',
  PLUGIN_GET_SCAN_SETTINGS: 'producer-player:plugin-get-scan-settings',
  PLUGIN_SET_SCAN_PATHS: 'producer-player:plugin-set-scan-paths',
  PLUGIN_PICK_SCAN_PATHS: 'producer-player:plugin-pick-scan-paths',
  PLUGIN_GET_TRACK_CHAIN: 'producer-player:plugin-get-track-chain',
  PLUGIN_SET_TRACK_CHAIN: 'producer-player:plugin-set-track-chain',
  PLUGIN_ADD_TO_CHAIN: 'producer-player:plugin-add-to-chain',
  PLUGIN_REMOVE_FROM_CHAIN: 'producer-player:plugin-remove-from-chain',
  PLUGIN_REORDER_CHAIN: 'producer-player:plugin-reorder-chain',
  PLUGIN_TOGGLE_ENABLED: 'producer-player:plugin-toggle-enabled',
  PLUGIN_SET_STATE: 'producer-player:plugin-set-state',
  PLUGIN_SET_SLOT_GAIN: 'producer-player:plugin-set-slot-gain',
  PLUGIN_PROCESS_BLOCK: 'producer-player:plugin-process-block',
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
  // v3.170 — per-plugin progress events streamed from the sidecar during a
  // long-running plugin scan. Used to keep the user oriented (toast
  // shows "Scanning plugins (k/n: name)…") and to keep the scan IPC
  // alive past its per-RPC timeout while real work is still happening.
  PLUGIN_SCAN_PROGRESS_EVENT: 'producer-player:plugin-scan-progress-event',
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
export interface PluginScanProgress {
  done: number;
  total: number;
  current: string;
}
export type PluginScanProgressListener = (event: PluginScanProgress) => void;

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
  /**
   * v3.183.0 — true when the item is a permanent note rather than a todo.
   * Notes render without a checkbox, with a distinct background tint, and
   * do NOT count toward the checklist's todo/done totals. Items can be
   * toggled freely between todo (isNote=false/undefined) and note
   * (isNote=true) via the row's toggle-mode button. Persisted alongside
   * the rest of the item so the mode survives reloads. Defaults to
   * undefined/false for historical items; the sanitizer coerces unknown
   * values back to false so existing stored checklists load unchanged.
   */
  isNote?: boolean;
  /**
   * v3.244.0 — Won't Fix alternative completion state. When true, the item
   * is considered DONE for completion math (e.g. "3 / 5 done") but is
   * rendered with a distinct muted "Won't Fix" appearance (horizontal-bar
   * icon instead of the blue tick). Mutually exclusive with `completed`:
   * setting wontFix=true clears completed; ticking the blue check on a
   * wontfix row clears wontFix. The Won't Fix button is hover-revealed
   * (same pattern as the to-note mode toggle). Only carried forward when
   * explicitly true so historical items round-trip unchanged.
   */
  wontFix?: boolean;
  /**
   * True when Ethan has explicitly marked the checklist item as high priority.
   *
   * This is a lightweight visual priority flag, not a completion state: it does
   * not change todo counts, timestamps, Won't Fix semantics, or sorting. The
   * renderer uses it to apply the purple-gradient high-priority treatment and
   * to keep the row's priority toggle active after reloads.
   */
  highPriority?: boolean;
  /**
   * v3.249.0 — Timestamp (Date.now() millis) when the item was marked done
   * (either via the blue tick or via Won't Fix). Kept as durable completion
   * history even though v3.255 moved the visible checklist time-sort workflow
   * onto outstanding items' song timestamps. Cleared when the item is reopened.
   * Only present on items whose completion was recorded after v3.249.
   */
  completedAt?: number;
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
  /**
   * v3.193 — optional association to the operating system's audio output
   * device that the user was using when they created / activated this
   * listening device. Captured from `navigator.mediaDevices.enumerateDevices`
   * (kind: `audiooutput`) at the time the listening device was created or
   * the first time it was manually selected after the association feature
   * landed. When the system default output later changes to a device whose
   * deviceId matches this value, the renderer auto-switches the active
   * listening device to this one. Optional + nullable so existing devices
   * round-trip cleanly. May refer to a deviceId that no longer exists on
   * the current machine — that's fine, the auto-switch just won't fire.
   */
  systemDeviceId?: string | null;
  /**
   * v3.193 — human-readable label of the system audio output device that was
   * associated when `systemDeviceId` was captured (e.g. "AirPods Pro",
   * "MacBook Pro Speakers"). Stored alongside the id so the renderer can
   * surface the original device name in toasts / hover hints even if the
   * device is no longer connected (and thus not in the live enumerate
   * result). Optional + nullable so existing devices round-trip cleanly.
   */
  systemDeviceLabel?: string | null;
}

export interface AlbumChecklistItem {
  id: string;
  text: string;
  completed: boolean;
  /**
   * v3.183.0 — true when the item is a permanent note rather than a todo.
   * Notes render without a checkbox, with a distinct background tint, and
   * do NOT count toward the checklist's todo/done totals. Defaults to
   * undefined/false for historical items.
   */
  isNote?: boolean;
  /**
   * v3.244.0 — Won't Fix alternative completion state. Same semantics as
   * `SongChecklistItem.wontFix`: counts as DONE for progress math but
   * renders with a muted "Won't Fix" style and the horizontal-bar icon.
   */
  wontFix?: boolean;
  /**
   * True when the album-level checklist item has been marked as high priority.
   *
   * Kept separate from `completed` / `wontFix` so project-level tasks can stay
   * visually urgent without changing progress math.
   */
  highPriority?: boolean;
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
// Plugin hosting (v3.39+ — data model + JUCE sidecar bridge)
//
// Effects-only, per-song insert chain. macOS-first (VST3 + AU + CLAP).
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
 *
 * v3.186 — per-plugin Ableton-style I/O gains. Each slot owns its own input
 * (pre-plugin) and output (post-plugin) linear gain. Missing/legacy entries
 * default to 1 (unity), keeping older saved chains a pure passthrough.
 */
export interface PluginChainItem {
  instanceId: string;
  pluginId: string;
  enabled: boolean;
  /** 0-based position in the chain. Reorder rewrites the whole array. */
  order: number;
  state?: string;
  presetName?: string;
  /**
   * Pre-plugin (input) linear gain multiplier. 1 = unity, 0 = silent,
   * 2 = +6 dB. Applied in the renderer before the audio is handed to the
   * plugin sidecar. Missing means 1.
   */
  inputGainLinear?: number;
  /**
   * Post-plugin (output) linear gain multiplier. 1 = unity, 0 = silent,
   * 2 = +6 dB. Applied in the renderer after the plugin sidecar processes
   * the block. Missing means 1.
   */
  outputGainLinear?: number;
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

export interface TrackPluginChainReadOptions {
  /** Skip native loading when the renderer only needs persisted chain data. */
  reconcilePlugins?: boolean;
  /** Resolve only after native instances/state are ready (used by idle prewarm). */
  waitForPlugins?: boolean;
}

export interface PluginProcessBlockItem {
  instanceId: string;
  enabled: boolean;
  /**
   * v3.186 — per-slot Ableton-style I/O gains. The sidecar applies
   * `inputGainLinear` to the buffer BEFORE the plugin's `processBlock` and
   * `outputGainLinear` AFTER. Missing/non-finite → 1 (unity / no-op).
   */
  inputGainLinear?: number;
  outputGainLinear?: number;
}

export interface PluginProcessBlockRequest {
  chain: PluginProcessBlockItem[];
  bufferBase64: string;
  frames: number;
  channels?: number;
  sampleRate?: number;
  blockSize?: number;
}

export interface PluginProcessBlockResult {
  frames: number;
  channels: number;
  bufferBase64: string;
  processedSlots: number;
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

export interface PluginScanRequest {
  /**
   * Optional explicit roots to scan. Empty/missing means “use the app's
   * standard DAW plugin folders” (macOS VST3 + AU defaults today).
   */
  paths?: string[];
}

export interface PluginScanSettings {
  /** User-saved custom roots. Empty means scan the standard folders. */
  customPaths: string[];
  /** The paths the next scan will actually use after applying defaults. */
  effectivePaths: string[];
  usingDefaultPaths: boolean;
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
 * Unified user state — a single file that holds ALL user-authored data and
 * the small set of UI preferences Ethan expects to survive full app restarts.
 * Most purely cosmetic layout choices can still live in localStorage, but
 * anything that changes the day-to-day workflow belongs here once it becomes a
 * user-facing promise.
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
  // Optional per-track display names. These do not rename files or affect
  // scanner grouping; they only override the title shown inside the app.
  songDisplayTitles: Record<string, string>;

  // Album
  albumTitle: string;
  albumArtDataUrl: string; // data URL (kept small via resize)
  albumChecklists: Record<string, AlbumChecklistItem[]>;
  // One user-configured project helper script, surfaced in the track-list
  // toolbar and through the in-app/MCP control surfaces. Null means the
  // toolbar shows the setup affordance instead of a runnable script.
  customScript: CustomScriptConfig | null;

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
  // The checklist listening-device strip is deliberately global UI state, not
  // per-song metadata: Ethan wants to choose "keep this section out of my way"
  // once and have that choice survive relaunches across every checklist.
  checklistListeningStripCollapsed: boolean;

  // Preferences
  playbackVolume: number;
  // Autoplay-next is a global playback preference, not a per-song field: it
  // decides whether a natural track-end should start the next queue item.
  // Default ON to preserve the app's historical end-of-track behavior, while
  // still letting the user opt out and keep that choice across restarts.
  autoplayNextEnabled: boolean;
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

  // v3.113 (Item #13) — opt-in toggle to pass dangerous-bypass flags to the
  // underlying agent CLI: `--dangerously-skip-permissions` for Claude Code
  // and `--dangerously-bypass-approvals-and-sandbox` for Codex. When ON the
  // agent runs without ANY permission/approval gating and gets full
  // file-system + shell access. Default OFF (safe). Persisted in unified
  // state so the choice survives relaunch. Surfaced in AgentSettings with
  // an explicit DANGEROUS warning. Pattern mirrors T3 Code's
  // `runtimeMode: 'full-access'` (apps/server ClaudeAdapter + Codex
  // app-server bridge), adapted to PP's direct-CLI-spawn architecture.
  agentDangerouslyBypassPermissions: boolean;

  // v3.120 (Item #14 follow-up) — kill-switch for the album/inspector
  // background analysis precompute. Default ON. When OFF, the bg-preload
  // effects in App.tsx do NOT enqueue any priority-2 (BACKGROUND) measured
  // analysis jobs; user-priority (selected-track) jobs still flow through
  // the queue normally. Surfaced as a pause/resume button next to the
  // BackgroundTasksIndicator in the status sidebar header. Persisted in
  // unified state so a paused state survives app relaunch (Ethan's
  // explicit ask: "if it stops, it should just stay stopped until they
  // turn it on, and it should persist throughout that pre-start").
  agentBackgroundPrecomputeEnabled: boolean;

  // Checklist DAW offset — when enabled, checklist timestamps are rendered
  // with a per-song offset added to their raw stored value so the
  // displayed time lines up with the user's digital audio workstation
  // arrangement (useful when the exported song starts past 0:00 in the DAW).
  // NOTE: the seek target stays the raw stored timestamp — this is a pure
  // display transform, not a remap of the underlying audio position.
  //
  // Storage model (refactored from app-global to per-song in v3.9+,
  // simplified again in v3.206):
  // - `songDawOffsets` holds the authoritative per-song offset/toggle values,
  //   keyed by songId. Different DAW projects have different arrangement
  //   starts, so each song remembers its own offset.
  // - v3.206 removed the `checklistDawOffsetDefault*` "last-used" seed pair
  //   (voice 2938). A brand-new song starts at 0:00/disabled until the user
  //   explicitly types a value or toggles. The legacy v3.8.0 app-global
  //   fields (`checklistDawOffsetSeconds`/`checklistDawOffsetEnabled`) and
  //   the v3.9–v3.205 default fields are silently ignored on read; we do
  //   NOT actively scrub them from disk, but the next state-write naturally
  //   drops them since they're no longer part of the parsed shape.
  songDawOffsets: Record<string, { seconds: number; enabled: boolean }>;

  // File dialog
  lastFileDialogDirectory: string; // Remembers last-used directory across all file pickers

  // v3.39 — Plugin hosting (Phase 1a, storage only; UI lands Phase 1b).
  //
  // `pluginLibrary` is the cached result of the most recent native sidecar
  // scan. Optional so pre-v3.39 state files load cleanly; `parseUserState`
  // substitutes `undefined` when the field is missing or malformed.
  //
  // `pluginScanPaths` is a user preference for explicit scan roots. Empty or
  // missing means scan the standard VST3/AU locations instead of forcing the
  // user through an unavoidable whole-machine scan path.
  //
  // `perTrackPluginChains` is keyed by songId and MUST be listed in
  // PER_TRACK_KEYS so the v3.29 split-to-disk pipeline hoists it into
  // per-track files automatically. When a song has no chain entry, the chain
  // is a no-op pass-through (Ethan's "no plugins → no effect" constraint).
  pluginLibrary?: ScannedPluginLibrary;
  pluginScanPaths?: string[];
  perTrackPluginChains?: Record<string, TrackPluginChain>;

  // v3.220 — per-song "auto-set listening device on checklist open" toggle
  // (voice 3129 / 3130). Default ON. When ON, opening the checklist modal for
  // this song re-reads the current OS audio-output device and force-switches
  // the active listening device to whichever saved device is linked to that
  // OS output (overriding whatever chip was last selected, even if the song
  // chip was already set). Toggle is per-song so users can silence the
  // auto-switch on tracks where it's annoying. Default ON is recorded by
  // ABSENCE — songs missing from this map are treated as enabled; only
  // explicit `false` entries opt out. This keeps the map sparse and means
  // existing on-disk state (no entries) automatically opts every song into
  // the new behavior post-upgrade.
  songAutoSetListeningDeviceOnOpen: Record<string, boolean>;

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
   * packaged, sandboxed Mac App Store, test mode, or a Linux package format
   * that cannot self-update). When true the UI should render a dim
   * "Updates managed by the Mac App Store" / "Dev build — updates disabled"
   * note so silent no-ops are visible.
   */
  disabledReason?: 'not-packaged' | 'mac-app-store' | 'test-mode' | 'linux-non-appimage' | null;
}

export type AutoUpdateRecheckResult =
  | { status: 'newer-downloading'; version: string | null }
  | { status: 'same-version'; version: string | null }
  | { status: 'no-update'; version: string | null }
  | { status: 'error'; message: string };

export type AutoUpdateDowngradeResult =
  | {
      status: 'downloading';
      currentVersion: string;
      previousVersion: string;
      previousTag: string;
      releaseUrl: string;
    }
  | {
      status: 'no-previous-version';
      currentVersion: string;
      message: string;
    }
  | { status: 'error'; message: string };

export type AutoUpdateInstallVersionResult =
  | {
      status: 'downloading';
      direction: 'upgrade' | 'downgrade';
      currentVersion: string;
      targetVersion: string;
      targetTag: string;
      releaseUrl: string;
    }
  | {
      status: 'no-target-version';
      requestedVersion: string;
      currentVersion: string;
      message: string;
    }
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
  /**
   * v3.110 — attachments that were present on this turn. Included so the
   * agent can recall files (especially images) that the user sent on
   * earlier turns. Only carried for `user` turns in practice; assistant
   * turns inherit visibility through the conversation context.
   */
  attachments?: AgentAttachment[];
}

export interface AgentStartSessionPayload {
  provider: AgentProviderId;
  mode: AgentMode;
  systemPrompt?: string;
  model?: AgentModelId;
  thinking?: AgentThinkingEffort;
  history?: AgentConversationHistoryEntry[];
  /**
   * Item #13 (v3.113) — when `true`, the spawned CLI is invoked with the
   * provider's "dangerously bypass all permission/approval gating" flag.
   * Default `false`. The renderer reads
   * `ProducerPlayerUserState.agentDangerouslyBypassPermissions` and forwards
   * it on every session start. Always-undefined is treated as `false` so
   * old clients / tests degrade safely.
   */
  dangerouslyBypassPermissions?: boolean;
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
  bpm: number | null;
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
  // v3.269 — Bit depth + sample format, mirrors AudioFileAnalysis. Same
  // optional/nullable rules apply (see AudioFileAnalysis). Surfaced to the
  // Inspector version-history row so producers can spot a 16-bit
  // sneak-through against 24-bit masters at a glance.
  bitDepth?: number | null;
  sampleFormat?: string | null;
  // See AudioFileAnalysis.bpm: undefined means legacy cache, null means probed
  // but no embedded / linked-project tempo source. This distinction lets the
  // renderer do one low-priority background metadata read without invalidating
  // LUFS display.
  bpm?: number | null;
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
  cacheDirectoryPath: string | null;
  cacheFilePath: string | null;
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
  /**
   * v3.108 — true when this version is the song's currently-active version
   * (the one shown in the player when this song is selected). Lets the AI
   * tell at a glance which version the user is currently auditioning vs the
   * other versions it can compare against. The assistant should still also
   * cross-check `analysis-context.track.fileName` for the "currently
   * selected song" but `isActiveVersion` covers the per-song selection.
   */
  isActiveVersion?: boolean;
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

// ---------------------------------------------------------------------------
// v3.90 — Agent UI control surface (pp_run_js / pp_screenshot / pp_dom_snapshot)
// ---------------------------------------------------------------------------
export interface AgentRunJsPayload {
  /** JS source string evaluated in the renderer. Use `(async () => { ... })()` to await inside. */
  code: string;
  /** Optional per-call timeout. Default 5000ms, max 30000ms. */
  timeoutMs?: number;
}

export type AgentRunJsResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

export interface AgentScreenshotPayload {
  /** 'window' (default) captures the full BrowserWindow client area. */
  region?: 'window' | 'visible';
}

export type AgentScreenshotResult =
  | { ok: true; dataUrl: string; width: number; height: number; byteLength: number }
  | { ok: false; error: string };

export interface AgentDomSnapshotPayload {
  /** Optional CSS selector for the root. Defaults to body. */
  rootSelector?: string;
  /** Soft cap on emitted nodes (default 500, hard max 2000). */
  maxNodes?: number;
}

export interface AgentDomNode {
  tag: string;
  testid: string | null;
  role: string | null;
  label: string | null;
  text: string | null;
  type: string | null;
  disabled: boolean;
  bounds: { x: number; y: number; w: number; h: number } | null;
  children: AgentDomNode[];
}

export type AgentDomSnapshotResult =
  | { ok: true; root: unknown; nodeCount: number; truncated: boolean }
  | { ok: false; error: string };

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

// ---------------------------------------------------------------------------
// v3.200 — Structured action log
//
// Every user interaction and error is appended (as JSON) to a dedicated
// rotating log file `actions.jsonl` alongside the existing electron-log
// output. The renderer never writes to disk directly — it ships entries
// over the `ACTION_LOG_APPEND` IPC channel and the main process owns
// serialization + rotation. See `apps/electron/src/actionLog.ts` and
// `apps/renderer/src/lib/actionLog.ts`.
// ---------------------------------------------------------------------------

export type ActionLogLevel = 'info' | 'warn' | 'error';

export type ActionLogSource = 'renderer' | 'main' | 'sidecar';

export interface ActionLogErrorPayload {
  /** `Error.name` (e.g. `TypeError`). Falls back to `'Error'` if absent. */
  name: string;
  /** Human-readable message. Truncated at 2000 chars on the main side. */
  message: string;
  /** Optional stack trace. Truncated at 4000 chars on the main side. */
  stack?: string;
}

export interface ActionLogEntry {
  /** ISO 8601 timestamp, set by the caller; the writer trusts it. */
  ts: string;
  level: ActionLogLevel;
  /** Short event name, e.g. `song.play`, `plugin.add`, `error.unhandled`. */
  event: string;
  source: ActionLogSource;
  /** Free-form structured context — IDs, names, durations, etc. */
  context?: Record<string, unknown>;
  /** Populated for `error.*` events. */
  error?: ActionLogErrorPayload;
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
  // v3.202 — Fire-and-forget (one-way IPC). Returns void, not a
  // Promise, so the renderer can NEVER `await` the launch and stall
  // its event loop while a slow DAW (Ableton) boots. See `openFile` in
  // `apps/electron/src/preload.ts` for full rationale.
  openFile(filePath: string): void;
  openExternalUrl(url: string): Promise<void>;
  getMicrophonePermissionStatus(): Promise<MicrophonePermissionStatus>;
  openMicrophonePrivacySettings(): Promise<void>;
  copyTextToClipboard(text: string): Promise<void>;
  toFileUrl(filePath: string): Promise<string>;
  resolvePlaybackSource(filePath: string): Promise<PlaybackSourceInfo>;
  analyzeAudioFile(
    filePath: string,
    requestId?: string,
    projectFilePath?: string | null
  ): Promise<AudioFileAnalysis>;
  probeAudioMetadata(
    filePath: string,
    requestId?: string,
    projectFilePath?: string | null
  ): Promise<AudioMetadataProbeResult>;
  /**
   * v3.195 — Cancel an in-flight `analyzeAudioFile` call by its requestId.
   * The main process SIGKILLs any ffmpeg/ffprobe child processes associated
   * with the request and the original promise rejects with an AbortError.
   * Idempotent — repeated calls and unknown ids are no-ops.
   */
  cancelAnalyzeAudioFile(requestId: string): Promise<void>;
  getMasteringAnalysisCache(): Promise<MasteringAnalysisCacheState>;
  writeMasteringAnalysisCache(
    payload: MasteringAnalysisCachePayload
  ): Promise<MasteringAnalysisCacheState>;
  pickReferenceTrack(): Promise<ReferenceTrackSelection | null>;
  pickProjectFile(initialPath?: string | null): Promise<ProjectFileSelection | null>;
  pickCustomScript(initialPath?: string | null): Promise<ProjectFileSelection | null>;
  runCustomScript(request: CustomScriptRunRequest): Promise<CustomScriptRunResult>;
  /**
   * v3.189.0 — Duplicates the song's linked project file next to the
   * original with `v<targetVersion>` appended (stripping any existing
   * version suffix first). The main process performs the copy and
   * resolves a collision-bumped final path so the renderer can show a
   * "Saved copy: <file>" toast.
   */
  saveSongProjectCopy(
    originalPath: string,
    targetVersion: number
  ): Promise<SongProjectSaveCopyResult>;
  getSharedUserState(): Promise<SharedUserState>;
  setSharedUserState(state: Omit<SharedUserState, 'updatedAt'>): Promise<SharedUserState>;
  syncToICloud(data: ICloudBackupData): Promise<ICloudSyncResult>;
  loadFromICloud(): Promise<ICloudLoadResult>;
  checkICloudAvailable(): Promise<ICloudAvailabilityResult>;
  checkForUpdates(): Promise<UpdateCheckResult>;
  openUpdateDownload(url?: string | null): Promise<void>;
  autoUpdateCheck(): Promise<void>;
  autoUpdateDownload(): Promise<void>;
  autoUpdateDowngrade(): Promise<AutoUpdateDowngradeResult>;
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
  // v3.90 — Producee Boy UI control primitives.
  agentRunJs(payload: AgentRunJsPayload): Promise<AgentRunJsResult>;
  agentScreenshot(payload?: AgentScreenshotPayload): Promise<AgentScreenshotResult>;
  agentDomSnapshot(payload?: AgentDomSnapshotPayload): Promise<AgentDomSnapshotResult>;
  onAgentEvent(listener: AgentEventListener): () => void;
  openLogFolder(): Promise<void>;
  getLogPath(): Promise<string>;
  logReadSlice(args: LogReadSliceArgs): Promise<LogReadSliceResult>;
  rendererLog(level: 'error' | 'warn' | 'info', message: string, meta?: Record<string, unknown>): Promise<void>;
  /**
   * v3.200 — Append a structured action log entry. Fire-and-forget from
   * the renderer's perspective (returns once the IPC message is queued;
   * write errors are swallowed on the main side and logged via
   * electron-log so user actions never block on disk I/O).
   */
  appendActionLog(entry: ActionLogEntry): Promise<void>;
  /** Returns the absolute path to the active `actions.jsonl` file. */
  getActionLogPath(): Promise<string>;
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

  // v3.39+ — Plugin hosting.
  scanPluginLibrary(options?: PluginScanRequest): Promise<ScannedPluginLibrary>;
  getPluginLibrary(): Promise<ScannedPluginLibrary | null>;
  getPluginScanSettings(): Promise<PluginScanSettings>;
  setPluginScanPaths(paths: string[]): Promise<PluginScanSettings>;
  pickPluginScanPaths(): Promise<string[] | null>;
  getTrackPluginChain(
    songId: string,
    options?: TrackPluginChainReadOptions,
  ): Promise<TrackPluginChain>;
  setTrackPluginChain(songId: string, chain: TrackPluginChain): Promise<TrackPluginChain>;
  addPluginToChain(songId: string, pluginId: string): Promise<TrackPluginChain>;
  removePluginFromChain(songId: string, instanceId: string): Promise<TrackPluginChain>;
  reorderPluginChain(songId: string, orderedInstanceIds: string[]): Promise<TrackPluginChain>;
  togglePluginEnabled(songId: string, instanceId: string, enabled: boolean): Promise<TrackPluginChain>;
  setPluginState(songId: string, instanceId: string, state: string): Promise<TrackPluginChain>;
  /**
   * v3.186 — write the per-slot Ableton-style I/O gain (linear multiplier
   * in [0..2]). Each field is optional so the renderer can patch one side
   * without round-tripping the other.
   */
  setPluginSlotGain(
    songId: string,
    instanceId: string,
    gains: { inputGainLinear?: number; outputGainLinear?: number },
  ): Promise<TrackPluginChain>;
  processPluginAudioBlock(request: PluginProcessBlockRequest): Promise<PluginProcessBlockResult>;
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
  /**
   * Fires for each plugin the sidecar finishes scanning. Driven by
   * `scan_progress` events emitted from the native sidecar's `--scan-one`
   * pool. Total/done lets the renderer show "Scanning plugins (k/n: …)".
   */
  onPluginScanProgress(listener: PluginScanProgressListener): () => void;
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
