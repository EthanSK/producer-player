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
}

export interface ReferenceTrackSelection {
  filePath: string;
  fileName: string;
  playbackSource: PlaybackSourceInfo;
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

export interface ProducerPlayerEnvironment {
  isMacAppStoreSandboxed: boolean;
  canLinkFolderByPath: boolean;
  canRequestSecurityScopedBookmarks: boolean;
  isTestMode: boolean;
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
  OPEN_IN_FINDER: 'producer-player:open-in-finder',
  OPEN_FOLDER: 'producer-player:open-folder',
  OPEN_EXTERNAL_URL: 'producer-player:open-external-url',
  TO_FILE_URL: 'producer-player:to-file-url',
  RESOLVE_PLAYBACK_SOURCE: 'producer-player:resolve-playback-source',
  ANALYZE_AUDIO_FILE: 'producer-player:analyze-audio-file',
  PICK_REFERENCE_TRACK: 'producer-player:pick-reference-track',
  SNAPSHOT_UPDATED: 'producer-player:snapshot-updated',
  TRANSPORT_COMMAND: 'producer-player:transport-command',
} as const;

export type SnapshotListener = (snapshot: LibrarySnapshot) => void;
export type TransportCommand = 'play-pause' | 'next-track' | 'previous-track';
export type TransportCommandListener = (command: TransportCommand) => void;

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
  revealFile(filePath: string): Promise<void>;
  openFolder(folderPath: string): Promise<void>;
  openExternalUrl(url: string): Promise<void>;
  toFileUrl(filePath: string): Promise<string>;
  resolvePlaybackSource(filePath: string): Promise<PlaybackSourceInfo>;
  analyzeAudioFile(filePath: string): Promise<AudioFileAnalysis>;
  pickReferenceTrack(): Promise<ReferenceTrackSelection | null>;
  onSnapshotUpdated(listener: SnapshotListener): () => void;
  onTransportCommand(listener: TransportCommandListener): () => void;
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
