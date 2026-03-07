export const AUDIO_EXTENSIONS = ['wav', 'aiff', 'flac', 'mp3', 'm4a'] as const;
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

export const IPC_CHANNELS = {
  GET_LIBRARY_SNAPSHOT: 'producer-player:get-library-snapshot',
  LINK_FOLDER_DIALOG: 'producer-player:link-folder-dialog',
  LINK_FOLDER_PATH: 'producer-player:link-folder-path',
  UNLINK_FOLDER: 'producer-player:unlink-folder',
  RESCAN_LIBRARY: 'producer-player:rescan-library',
  ORGANIZE_OLD_VERSIONS: 'producer-player:organize-old-versions',
  SET_AUTO_MOVE_OLD: 'producer-player:set-auto-move-old',
  REORDER_SONGS: 'producer-player:reorder-songs',
  OPEN_IN_FINDER: 'producer-player:open-in-finder',
  OPEN_FOLDER: 'producer-player:open-folder',
  TO_FILE_URL: 'producer-player:to-file-url',
  SNAPSHOT_UPDATED: 'producer-player:snapshot-updated',
} as const;

export type SnapshotListener = (snapshot: LibrarySnapshot) => void;

export interface ProducerPlayerBridge {
  getLibrarySnapshot(): Promise<LibrarySnapshot>;
  linkFolderWithDialog(): Promise<LibrarySnapshot>;
  linkFolder(folderPath: string): Promise<LibrarySnapshot>;
  unlinkFolder(folderId: string): Promise<LibrarySnapshot>;
  rescanLibrary(): Promise<LibrarySnapshot>;
  organizeOldVersions(): Promise<LibrarySnapshot>;
  setAutoMoveOld(enabled: boolean): Promise<LibrarySnapshot>;
  reorderSongs(songIds: string[]): Promise<LibrarySnapshot>;
  revealFile(filePath: string): Promise<void>;
  openFolder(folderPath: string): Promise<void>;
  toFileUrl(filePath: string): Promise<string>;
  onSnapshotUpdated(listener: SnapshotListener): () => void;
}
