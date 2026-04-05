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
  AUTO_UPDATE_INSTALL: 'producer-player:auto-update-install',
  AUTO_UPDATE_SET_ENABLED: 'producer-player:auto-update-set-enabled',
  AUTO_UPDATE_STATE_CHANGED: 'producer-player:auto-update-state-changed',
  AGENT_START_SESSION: 'producer-player:agent-start-session',
  AGENT_SEND_TURN: 'producer-player:agent-send-turn',
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
  RENDERER_LOG: 'producer-player:renderer-log',
} as const;

export type SnapshotListener = (snapshot: LibrarySnapshot) => void;
export type TransportCommand = 'play-pause' | 'next-track' | 'previous-track';
export type TransportCommandListener = (command: TransportCommand) => void;

export interface SongChecklistItem {
  id: string;
  text: string;
  completed: boolean;
  timestampSeconds: number | null;
  versionNumber: number | null;
}

export interface AlbumChecklistItem {
  id: string;
  text: string;
  completed: boolean;
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
}

export type AutoUpdateStateListener = (state: AutoUpdateState) => void;

export type AgentProviderId = 'claude' | 'codex';
export type AgentMode = 'analysis' | 'ui-interaction';

export interface AgentModelDefinition {
  id: string;
  label: string;
}

export const AGENT_MODEL_OPTIONS_BY_PROVIDER = {
  codex: [
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

export interface AgentSendTurnPayload {
  message: string;
  context?: AgentContext | null;
  uiContext?: AgentUiContext | null;
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
  autoUpdateInstall(): Promise<void>;
  setAutoUpdateEnabled(enabled: boolean): Promise<void>;
  onAutoUpdateStateChanged(listener: AutoUpdateStateListener): () => void;
  onSnapshotUpdated(listener: SnapshotListener): () => void;
  onTransportCommand(listener: TransportCommandListener): () => void;
  agentStartSession(payload: AgentStartSessionPayload): Promise<void>;
  agentSendTurn(payload: AgentSendTurnPayload): Promise<void>;
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
  rendererLog(level: 'error' | 'warn' | 'info', message: string, meta?: Record<string, unknown>): Promise<void>;
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
