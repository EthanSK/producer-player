import { createHash } from 'node:crypto';
import { promises as fs, type Dirent } from 'node:fs';
import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import type {
  LibrarySnapshot,
  LinkedFolder,
  MatcherSettings,
  SongWithVersions,
} from '@producer-player/contracts';
import { buildSongsFromFiles, isSupportedAudioFile, type ScannedAudioFile } from './song-model';

const DEFAULT_MATCHER_SETTINGS: MatcherSettings = {
  autoMoveOld: true,
};

type SnapshotSubscriber = (snapshot: LibrarySnapshot) => void;

interface FileLibraryServiceOptions {
  autoMoveOld?: boolean;
  songOrder?: string[];
}

function stableId(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 16);
}

function cloneSnapshot(snapshot: LibrarySnapshot): LibrarySnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as LibrarySnapshot;
}

function dedupeIds(ids: string[]): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();

  for (const id of ids) {
    if (seen.has(id)) {
      continue;
    }

    seen.add(id);
    unique.push(id);
  }

  return unique;
}

async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function collectAudioFilesInDirectory(
  directoryPath: string,
  folderId: string
): Promise<ScannedAudioFile[]> {
  const files: ScannedAudioFile[] = [];

  let entries: Dirent[];
  try {
    entries = await fs.readdir(directoryPath, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    const absolutePath = path.join(directoryPath, entry.name);

    if (!entry.isFile() || !isSupportedAudioFile(absolutePath)) {
      continue;
    }

    try {
      const stats = await fs.stat(absolutePath);
      files.push({
        folderId,
        filePath: absolutePath,
        sizeBytes: stats.size,
        modifiedAt: stats.mtime,
      });
    } catch {
      // Ignore transient stat errors while files are still being written.
    }
  }

  return files;
}

async function collectAudioFiles(
  folderPath: string,
  folderId: string
): Promise<ScannedAudioFile[]> {
  const files: ScannedAudioFile[] = [];

  // Track top-level exports only.
  files.push(...(await collectAudioFilesInDirectory(folderPath, folderId)));

  // Track archived versions from the reserved old/ folder only.
  const archivedDirectory = path.join(folderPath, 'old');
  files.push(...(await collectAudioFilesInDirectory(archivedDirectory, folderId)));

  return files;
}

function isInsideOldDirectory(filePath: string, folderPath: string): boolean {
  const relativePath = path.relative(folderPath, filePath);

  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return false;
  }

  const firstSegment = relativePath.split(path.sep)[0]?.toLowerCase();
  return firstSegment === 'old';
}

async function moveFile(sourcePath: string, targetPath: string): Promise<void> {
  try {
    await fs.rename(sourcePath, targetPath);
    return;
  } catch (error: unknown) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'EXDEV') {
      throw error;
    }
  }

  await fs.copyFile(sourcePath, targetPath);
  await fs.unlink(sourcePath);
}

export class FileLibraryService {
  private readonly linkedFolders = new Map<string, LinkedFolder>();
  private readonly folderFiles = new Map<string, ScannedAudioFile[]>();
  private readonly folderWatchers = new Map<string, FSWatcher>();
  private readonly folderScanTimers = new Map<string, NodeJS.Timeout>();
  private readonly subscribers = new Set<SnapshotSubscriber>();
  private matcherSettings: MatcherSettings;
  private songOrder: string[];

  private snapshot: LibrarySnapshot = {
    linkedFolders: [],
    songs: [],
    versions: [],
    status: 'idle',
    statusMessage: 'No folders linked yet.',
    scannedAt: null,
    matcherSettings: DEFAULT_MATCHER_SETTINGS,
  };

  constructor(options: FileLibraryServiceOptions = {}) {
    this.matcherSettings = {
      ...DEFAULT_MATCHER_SETTINGS,
      ...(typeof options.autoMoveOld === 'boolean'
        ? { autoMoveOld: options.autoMoveOld }
        : {}),
    };

    this.songOrder = dedupeIds(options.songOrder ?? []);

    this.snapshot = {
      ...this.snapshot,
      matcherSettings: this.matcherSettings,
    };
  }

  subscribe(listener: SnapshotSubscriber): () => void {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  }

  getSnapshot(): LibrarySnapshot {
    return cloneSnapshot(this.snapshot);
  }

  getLinkedFolderPaths(): string[] {
    return Array.from(this.linkedFolders.values()).map((folder) => folder.path);
  }

  async hydrateLinkedFolders(folderPaths: string[]): Promise<LibrarySnapshot> {
    for (const folderPath of folderPaths) {
      try {
        await this.linkFolder(folderPath);
      } catch {
        // Keep going so one bad folder doesn't block others.
      }
    }

    return this.getSnapshot();
  }

  async linkFolder(folderPath: string): Promise<LibrarySnapshot> {
    const resolvedPath = path.resolve(folderPath);

    const duplicate = Array.from(this.linkedFolders.values()).find(
      (folder) => folder.path === resolvedPath
    );

    if (duplicate) {
      return this.getSnapshot();
    }

    let stats;
    try {
      stats = await fs.stat(resolvedPath);
    } catch {
      this.setStatus('error', `Could not access folder: ${resolvedPath}`);
      throw new Error(`Folder not accessible: ${resolvedPath}`);
    }

    if (!stats.isDirectory()) {
      this.setStatus('error', `Path is not a folder: ${resolvedPath}`);
      throw new Error(`Path is not a folder: ${resolvedPath}`);
    }

    const folder: LinkedFolder = {
      id: stableId(resolvedPath),
      name: path.basename(resolvedPath) || resolvedPath,
      path: resolvedPath,
      linkedAt: new Date().toISOString(),
      fileCount: 0,
    };

    this.linkedFolders.set(folder.id, folder);

    this.setStatus('scanning', `Linking ${folder.name}…`);
    await this.scanFolder(folder.id);

    const movedCount = await this.maybeAutoOrganizeOldVersions();

    this.attachWatcher(folder);

    const statusMessage =
      movedCount > 0
        ? `Watching ${this.linkedFolders.size} folder(s). Organized ${movedCount} old version(s).`
        : `Watching ${this.linkedFolders.size} folder(s).`;

    this.rebuildSnapshot('watching', statusMessage);
    return this.getSnapshot();
  }

  async unlinkFolder(folderId: string): Promise<LibrarySnapshot> {
    this.linkedFolders.delete(folderId);
    this.folderFiles.delete(folderId);

    const watcher = this.folderWatchers.get(folderId);
    if (watcher) {
      await watcher.close();
      this.folderWatchers.delete(folderId);
    }

    const timer = this.folderScanTimers.get(folderId);
    if (timer) {
      clearTimeout(timer);
      this.folderScanTimers.delete(folderId);
    }

    if (this.linkedFolders.size === 0) {
      this.songOrder = [];
      this.rebuildSnapshot('idle', 'No folders linked yet.');
      return this.getSnapshot();
    }

    this.rebuildSnapshot('watching', `Watching ${this.linkedFolders.size} folder(s).`);
    return this.getSnapshot();
  }

  async rescanLibrary(): Promise<LibrarySnapshot> {
    if (this.linkedFolders.size === 0) {
      this.rebuildSnapshot('idle', 'No folders linked yet.');
      return this.getSnapshot();
    }

    this.setStatus('scanning', 'Scanning linked folders…');

    for (const folderId of this.linkedFolders.keys()) {
      await this.scanFolder(folderId);
    }

    const movedCount = await this.maybeAutoOrganizeOldVersions();

    const statusMessage =
      movedCount > 0
        ? `Watching ${this.linkedFolders.size} folder(s). Organized ${movedCount} old version(s).`
        : `Watching ${this.linkedFolders.size} folder(s).`;

    this.rebuildSnapshot('watching', statusMessage);
    return this.getSnapshot();
  }

  async organizeOldVersions(): Promise<LibrarySnapshot> {
    if (this.linkedFolders.size === 0) {
      this.rebuildSnapshot('idle', 'No folders linked yet.');
      return this.getSnapshot();
    }

    this.setStatus('scanning', 'Organizing old versions…');

    for (const folderId of this.linkedFolders.keys()) {
      await this.scanFolder(folderId);
    }

    const movedCount = await this.organizeOldVersionsInternal();

    const statusMessage =
      movedCount > 0
        ? `Watching ${this.linkedFolders.size} folder(s). Organized ${movedCount} old version(s).`
        : `Watching ${this.linkedFolders.size} folder(s). No older versions needed organizing.`;

    this.rebuildSnapshot('watching', statusMessage);
    return this.getSnapshot();
  }

  async setAutoMoveOld(autoMoveOld: boolean): Promise<LibrarySnapshot> {
    this.matcherSettings = {
      ...this.matcherSettings,
      autoMoveOld,
    };

    if (!autoMoveOld) {
      this.snapshot = {
        ...this.snapshot,
        matcherSettings: this.matcherSettings,
        statusMessage:
          this.linkedFolders.size > 0
            ? `Watching ${this.linkedFolders.size} folder(s). Auto-organize is OFF.`
            : 'No folders linked yet.',
      };

      this.emitSnapshot();
      return this.getSnapshot();
    }

    if (this.linkedFolders.size === 0) {
      this.snapshot = {
        ...this.snapshot,
        matcherSettings: this.matcherSettings,
      };
      this.emitSnapshot();
      return this.getSnapshot();
    }

    this.setStatus('scanning', 'Auto-organize enabled. Organizing old versions…');

    for (const folderId of this.linkedFolders.keys()) {
      await this.scanFolder(folderId);
    }

    const movedCount = await this.organizeOldVersionsInternal();

    const statusMessage =
      movedCount > 0
        ? `Watching ${this.linkedFolders.size} folder(s). Organized ${movedCount} old version(s).`
        : `Watching ${this.linkedFolders.size} folder(s). Auto-organize is ON.`;

    this.rebuildSnapshot('watching', statusMessage);
    return this.getSnapshot();
  }

  async reorderSongs(orderedSongIds: string[]): Promise<LibrarySnapshot> {
    const existingSongIds = this.snapshot.songs.map((song) => song.id);
    if (existingSongIds.length === 0) {
      return this.getSnapshot();
    }

    const existingSongIdSet = new Set(existingSongIds);

    const nextOrder: string[] = [];
    for (const songId of dedupeIds(orderedSongIds)) {
      if (!existingSongIdSet.has(songId)) {
        continue;
      }
      nextOrder.push(songId);
    }

    for (const songId of existingSongIds) {
      if (nextOrder.includes(songId)) {
        continue;
      }
      nextOrder.push(songId);
    }

    this.songOrder = nextOrder;

    const nextStatus = this.snapshot.status === 'idle' ? 'idle' : 'watching';
    this.rebuildSnapshot(nextStatus, 'Updated track order.');
    return this.getSnapshot();
  }

  async dispose(): Promise<void> {
    for (const timer of this.folderScanTimers.values()) {
      clearTimeout(timer);
    }
    this.folderScanTimers.clear();

    await Promise.all(
      Array.from(this.folderWatchers.values()).map((watcher) => watcher.close())
    );

    this.folderWatchers.clear();
    this.linkedFolders.clear();
    this.folderFiles.clear();
    this.subscribers.clear();
  }

  private emitSnapshot(): void {
    const snapshot = this.getSnapshot();
    for (const subscriber of this.subscribers) {
      subscriber(snapshot);
    }
  }

  private setStatus(status: LibrarySnapshot['status'], statusMessage: string): void {
    this.snapshot = {
      ...this.snapshot,
      status,
      statusMessage,
      matcherSettings: this.matcherSettings,
    };

    this.emitSnapshot();
  }

  private async scanFolder(folderId: string): Promise<void> {
    const folder = this.linkedFolders.get(folderId);
    if (!folder) {
      return;
    }

    const files = await collectAudioFiles(folder.path, folderId);

    // Guard against unlink races where an in-flight scan completes after folder removal.
    if (!this.linkedFolders.has(folderId)) {
      return;
    }

    this.folderFiles.set(folderId, files);
  }

  private collectTrackedFiles(): ScannedAudioFile[] {
    const linkedFolderIds = new Set(this.linkedFolders.keys());
    const files: ScannedAudioFile[] = [];

    for (const [folderId, folderFiles] of this.folderFiles.entries()) {
      if (!linkedFolderIds.has(folderId)) {
        continue;
      }

      files.push(...folderFiles);
    }

    return files;
  }

  private attachWatcher(folder: LinkedFolder): void {
    if (this.folderWatchers.has(folder.id)) {
      return;
    }

    const watcher = chokidar.watch(folder.path, {
      ignoreInitial: true,
      depth: 1,
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 60,
      },
      ignored: (watchPath) => watchPath.endsWith('.DS_Store'),
    });

    watcher.on('all', (eventName, changedPath) => {
      if (
        eventName !== 'add' &&
        eventName !== 'change' &&
        eventName !== 'unlink' &&
        eventName !== 'addDir' &&
        eventName !== 'unlinkDir'
      ) {
        return;
      }

      if (
        eventName !== 'addDir' &&
        eventName !== 'unlinkDir' &&
        !isSupportedAudioFile(changedPath)
      ) {
        return;
      }

      this.queueFolderScan(folder.id);
    });

    watcher.on('error', () => {
      this.setStatus('error', `Watcher error in ${folder.name}`);
    });

    this.folderWatchers.set(folder.id, watcher);
  }

  private queueFolderScan(folderId: string): void {
    const existingTimer = this.folderScanTimers.get(folderId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      void this.refreshFolder(folderId);
    }, 350);

    this.folderScanTimers.set(folderId, timer);
  }

  private async refreshFolder(folderId: string): Promise<void> {
    if (!this.linkedFolders.has(folderId)) {
      return;
    }

    this.setStatus('scanning', 'Detected changes. Refreshing library…');
    await this.scanFolder(folderId);

    const movedCount = await this.maybeAutoOrganizeOldVersions();

    const statusMessage =
      movedCount > 0
        ? `Watching ${this.linkedFolders.size} folder(s). Organized ${movedCount} old version(s).`
        : `Watching ${this.linkedFolders.size} folder(s).`;

    this.rebuildSnapshot('watching', statusMessage);
  }

  private async maybeAutoOrganizeOldVersions(): Promise<number> {
    if (!this.matcherSettings.autoMoveOld) {
      return 0;
    }

    return this.organizeOldVersionsInternal();
  }

  private async organizeOldVersionsInternal(): Promise<number> {
    const files = this.collectTrackedFiles();
    const songs = buildSongsFromFiles(files);

    const affectedFolderIds = new Set<string>();
    let movedCount = 0;

    for (const song of songs) {
      const nonArchivedVersions = [...song.versions]
        .filter((version) => {
          const folder = this.linkedFolders.get(version.folderId);
          if (!folder) {
            return false;
          }

          return !isInsideOldDirectory(version.filePath, folder.path);
        })
        .sort((left, right) => {
          const modifiedAtDelta =
            new Date(right.modifiedAt).getTime() - new Date(left.modifiedAt).getTime();

          if (modifiedAtDelta !== 0) {
            return modifiedAtDelta;
          }

          return left.filePath.localeCompare(right.filePath);
        });

      // Keep the newest non-archived version in place, move the rest into old/.
      for (const version of nonArchivedVersions.slice(1)) {
        const folder = this.linkedFolders.get(version.folderId);
        if (!folder) {
          continue;
        }

        if (!(await pathExists(version.filePath))) {
          continue;
        }

        const archiveDirectory = path.join(folder.path, 'old');
        await fs.mkdir(archiveDirectory, { recursive: true });

        const archivePath = await this.resolveArchivePath(
          archiveDirectory,
          path.basename(version.filePath)
        );

        await moveFile(version.filePath, archivePath);

        movedCount += 1;
        affectedFolderIds.add(version.folderId);
      }
    }

    if (movedCount === 0) {
      return 0;
    }

    for (const folderId of affectedFolderIds) {
      await this.scanFolder(folderId);
    }

    return movedCount;
  }

  private async resolveArchivePath(
    archiveDirectory: string,
    fileName: string
  ): Promise<string> {
    const parsed = path.parse(fileName);
    let candidatePath = path.join(archiveDirectory, fileName);

    if (!(await pathExists(candidatePath))) {
      return candidatePath;
    }

    let counter = 1;

    while (await pathExists(candidatePath)) {
      candidatePath = path.join(
        archiveDirectory,
        `${parsed.name}-archived-${counter}${parsed.ext}`
      );
      counter += 1;
    }

    return candidatePath;
  }

  private applySongOrder(songs: SongWithVersions[]): SongWithVersions[] {
    const currentSongIds = songs.map((song) => song.id);
    const currentSongIdSet = new Set(currentSongIds);

    const retainedOrder = dedupeIds(this.songOrder).filter((songId) =>
      currentSongIdSet.has(songId)
    );

    for (const songId of currentSongIds) {
      if (!retainedOrder.includes(songId)) {
        retainedOrder.push(songId);
      }
    }

    this.songOrder = retainedOrder;

    const songOrderIndex = new Map<string, number>();
    for (let index = 0; index < retainedOrder.length; index += 1) {
      songOrderIndex.set(retainedOrder[index], index);
    }

    return [...songs].sort((left, right) => {
      const leftIndex = songOrderIndex.get(left.id) ?? Number.MAX_SAFE_INTEGER;
      const rightIndex = songOrderIndex.get(right.id) ?? Number.MAX_SAFE_INTEGER;
      return leftIndex - rightIndex;
    });
  }

  private rebuildSnapshot(status: LibrarySnapshot['status'], statusMessage: string): void {
    const folderList = Array.from(this.linkedFolders.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    const files = this.collectTrackedFiles();
    const unorderedSongs = buildSongsFromFiles(files);
    const songs = this.applySongOrder(unorderedSongs);
    const versions = songs.flatMap((song) => song.versions);

    const fileCountByFolder = new Map<string, number>();
    for (const version of versions) {
      fileCountByFolder.set(
        version.folderId,
        (fileCountByFolder.get(version.folderId) ?? 0) + 1
      );
    }

    const linkedFolders = folderList.map((folder) => ({
      ...folder,
      fileCount: fileCountByFolder.get(folder.id) ?? 0,
    }));

    this.snapshot = {
      linkedFolders,
      songs,
      versions,
      status,
      statusMessage,
      scannedAt: new Date().toISOString(),
      matcherSettings: this.matcherSettings,
    };

    this.emitSnapshot();
  }
}
