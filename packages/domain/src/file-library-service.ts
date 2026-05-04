import { createHash } from 'node:crypto';
import { createReadStream, promises as fs, type Dirent, type Stats } from 'node:fs';
import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import type {
  LibrarySnapshot,
  LinkedFolder,
  MatcherSettings,
  SongWithVersions,
} from '@producer-player/contracts';
import {
  buildSongsFromFiles,
  getVersionNumberFromStem,
  hasSupportedVersionSuffix,
  isSupportedAudioFile,
  normalizeSongStem,
  type ScannedAudioFile,
} from './song-model';

const DEFAULT_MATCHER_SETTINGS: MatcherSettings = {
  autoMoveOld: true,
};

// Keep per-directory metadata reads parallel enough to make startup/rescan feel
// snappy on albums with lots of bounces, but bounded so a huge folder cannot
// flood the OS with hundreds of simultaneous `stat` calls.
const FILE_METADATA_CONCURRENCY = 32;

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

function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function buildWatchingMessage(folderCount: number, detail?: string): string {
  return detail
    ? `Watching ${formatCount(folderCount, 'folder')}. ${detail}`
    : `Watching ${formatCount(folderCount, 'folder')}.`;
}

function buildOrganizedVersionsMessage(movedCount: number): string {
  return `Organized ${formatCount(movedCount, 'old version')}.`;
}

async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const workerCount = Math.max(1, Math.min(Math.floor(concurrency), items.length));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;

        if (index >= items.length) {
          return;
        }

        results[index] = await mapper(items[index], index);
      }
    })
  );

  return results;
}

function getFileCreatedAt(stats: Stats): Date {
  if (Number.isFinite(stats.birthtimeMs) && stats.birthtimeMs > 0) {
    return stats.birthtime;
  }

  if (Number.isFinite(stats.ctimeMs) && stats.ctimeMs > 0) {
    return stats.ctime;
  }

  return stats.mtime;
}

function getDateMs(date: Date): number {
  const value = date.getTime();
  return Number.isFinite(value) ? value : 0;
}

function isNewerExportCandidate(candidate: ScannedAudioFile, latestKnown: ScannedAudioFile): boolean {
  return getDateMs(candidate.createdAt) > getDateMs(latestKnown.createdAt);
}

function compareScannedFileAge(left: ScannedAudioFile, right: ScannedAudioFile): number {
  const leftTime = Math.max(getDateMs(left.createdAt), getDateMs(left.modifiedAt));
  const rightTime = Math.max(getDateMs(right.createdAt), getDateMs(right.modifiedAt));

  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  return left.filePath.localeCompare(right.filePath);
}

function getFileStem(filePath: string): string {
  return path.basename(filePath, path.extname(filePath));
}

async function calculateFileHash(filePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);

    stream.on('data', (chunk) => {
      hash.update(chunk);
    });

    stream.on('error', () => {
      resolve(null);
    });

    stream.on('end', () => {
      resolve(hash.digest('hex'));
    });
  });
}

async function hasDifferentFileContents(
  candidate: ScannedAudioFile,
  latestKnown: ScannedAudioFile
): Promise<boolean> {
  if (candidate.sizeBytes !== latestKnown.sizeBytes) {
    return true;
  }

  const [candidateHash, latestKnownHash] = await Promise.all([
    calculateFileHash(candidate.filePath),
    calculateFileHash(latestKnown.filePath),
  ]);

  if (!candidateHash || !latestKnownHash) {
    return false;
  }

  return candidateHash !== latestKnownHash;
}

async function collectAudioFilesInDirectory(
  directoryPath: string,
  folderId: string
): Promise<ScannedAudioFile[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(directoryPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const audioFilePaths = entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(directoryPath, entry.name))
    .filter((absolutePath) => isSupportedAudioFile(absolutePath));

  const files = await mapWithConcurrency(
    audioFilePaths,
    FILE_METADATA_CONCURRENCY,
    async (absolutePath): Promise<ScannedAudioFile | null> => {
      try {
        const stats = await fs.stat(absolutePath);
        return {
          folderId,
          filePath: absolutePath,
          sizeBytes: stats.size,
          createdAt: getFileCreatedAt(stats),
          modifiedAt: stats.mtime,
        };
      } catch {
        // Ignore transient stat errors while files are still being written.
        return null;
      }
    }
  );

  return files.filter((file): file is ScannedAudioFile => file !== null);
}

async function collectAudioFiles(
  folderPath: string,
  folderId: string
): Promise<ScannedAudioFile[]> {
  const archivedDirectory = path.join(folderPath, 'old');

  const [topLevelFiles, archivedFiles] = await Promise.all([
    // Track top-level exports only.
    collectAudioFilesInDirectory(folderPath, folderId),
    // Track archived versions from the reserved old/ folder only.
    collectAudioFilesInDirectory(archivedDirectory, folderId),
  ]);

  return [...topLevelFiles, ...archivedFiles];
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

    // Reject root-level and top-level system directories to prevent the chokidar watcher
    // from scanning and watching enormous directory trees, which causes an effective hang.
    const pathDepth = resolvedPath.split(path.sep).filter(Boolean).length;
    if (pathDepth < 2) {
      this.setStatus('error', `Cannot link a root or top-level system folder: ${resolvedPath}`);
      throw new Error(
        `Cannot link a root or top-level system folder. Please choose a folder at least two levels deep, such as ~/Music/MyAlbum.`
      );
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
        ? buildWatchingMessage(
            this.linkedFolders.size,
            buildOrganizedVersionsMessage(movedCount)
          )
        : buildWatchingMessage(this.linkedFolders.size);

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

    this.rebuildSnapshot('watching', buildWatchingMessage(this.linkedFolders.size));
    return this.getSnapshot();
  }

  async rescanLibrary(): Promise<LibrarySnapshot> {
    if (this.linkedFolders.size === 0) {
      this.rebuildSnapshot('idle', 'No folders linked yet.');
      return this.getSnapshot();
    }

    this.setStatus('scanning', 'Scanning linked folders…');

    await Promise.all(
      Array.from(this.linkedFolders.keys()).map((folderId) => this.scanFolder(folderId))
    );

    const movedCount = await this.maybeAutoOrganizeOldVersions();

    const statusMessage =
      movedCount > 0
        ? buildWatchingMessage(
            this.linkedFolders.size,
            buildOrganizedVersionsMessage(movedCount)
          )
        : buildWatchingMessage(this.linkedFolders.size);

    this.rebuildSnapshot('watching', statusMessage);
    return this.getSnapshot();
  }

  async organizeOldVersions(): Promise<LibrarySnapshot> {
    if (this.linkedFolders.size === 0) {
      this.rebuildSnapshot('idle', 'No folders linked yet.');
      return this.getSnapshot();
    }

    this.setStatus('scanning', 'Organizing old versions…');

    await Promise.all(
      Array.from(this.linkedFolders.keys()).map((folderId) => this.scanFolder(folderId))
    );

    const movedCount = await this.organizeOldVersionsInternal();

    const statusMessage =
      movedCount > 0
        ? buildWatchingMessage(
            this.linkedFolders.size,
            buildOrganizedVersionsMessage(movedCount)
          )
        : buildWatchingMessage(this.linkedFolders.size, 'No older versions needed organizing.');

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
            ? buildWatchingMessage(this.linkedFolders.size, 'Auto-organize is off.')
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

    await Promise.all(
      Array.from(this.linkedFolders.keys()).map((folderId) => this.scanFolder(folderId))
    );

    const movedCount = await this.organizeOldVersionsInternal();

    const statusMessage =
      movedCount > 0
        ? buildWatchingMessage(
            this.linkedFolders.size,
            buildOrganizedVersionsMessage(movedCount)
          )
        : buildWatchingMessage(this.linkedFolders.size, 'Auto-organize is on.');

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

    let files = await collectAudioFiles(folder.path, folderId);
    const renamedUnversionedExports = await this.autoVersionUnversionedExports(folder, files);

    if (renamedUnversionedExports > 0) {
      files = await collectAudioFiles(folder.path, folderId);
    }

    // Guard against unlink races where an in-flight scan completes after folder removal.
    if (!this.linkedFolders.has(folderId)) {
      return;
    }

    this.folderFiles.set(folderId, files);
  }

  private async autoVersionUnversionedExports(
    folder: LinkedFolder,
    files: ScannedAudioFile[]
  ): Promise<number> {
    const filesByPath = new Map(files.map((file) => [file.filePath, file]));
    const versionedSongs = buildSongsFromFiles(files);
    const latestByNormalizedTitle = new Map<string, ScannedAudioFile>();
    const nextVersionByNormalizedTitle = new Map<string, number>();

    for (const song of versionedSongs) {
      const versionFiles = song.versions
        .map((version) => filesByPath.get(version.filePath))
        .filter((file): file is ScannedAudioFile => Boolean(file));

      if (versionFiles.length === 0) {
        continue;
      }

      let latestKnown: ScannedAudioFile | null = null;
      const maxVersionNumber = versionFiles.reduce((max, file) => {
        const versionNumber = getVersionNumberFromStem(getFileStem(file.filePath));
        if (versionNumber === null) {
          return max;
        }

        if (
          versionNumber > max ||
          (versionNumber === max &&
            latestKnown &&
            compareScannedFileAge(file, latestKnown) > 0)
        ) {
          latestKnown = file;
        }

        return Math.max(max, versionNumber);
      }, 0);

      if (!latestKnown || maxVersionNumber < 1) {
        continue;
      }

      latestByNormalizedTitle.set(song.normalizedTitle, latestKnown);
      nextVersionByNormalizedTitle.set(song.normalizedTitle, maxVersionNumber + 1);
    }

    const candidates = files
      .filter((file) => {
        if (isInsideOldDirectory(file.filePath, folder.path)) {
          return false;
        }

        return !hasSupportedVersionSuffix(getFileStem(file.filePath));
      })
      .sort(compareScannedFileAge);

    let renamedCount = 0;

    for (const candidate of candidates) {
      const normalizedTitle = normalizeSongStem(getFileStem(candidate.filePath));
      if (normalizedTitle.length === 0) {
        continue;
      }

      const latestKnown = latestByNormalizedTitle.get(normalizedTitle);
      if (!latestKnown || !isNewerExportCandidate(candidate, latestKnown)) {
        continue;
      }

      if (!(await hasDifferentFileContents(candidate, latestKnown))) {
        continue;
      }

      const requestedVersion = nextVersionByNormalizedTitle.get(normalizedTitle) ?? 1;
      const versionedPath = await this.resolveVersionedExportPath(
        path.dirname(candidate.filePath),
        getFileStem(candidate.filePath),
        path.extname(candidate.filePath),
        requestedVersion
      );

      await moveFile(candidate.filePath, versionedPath.filePath);

      const renamedFile: ScannedAudioFile = {
        ...candidate,
        filePath: versionedPath.filePath,
      };

      latestByNormalizedTitle.set(normalizedTitle, renamedFile);
      nextVersionByNormalizedTitle.set(normalizedTitle, versionedPath.versionNumber + 1);
      renamedCount += 1;
    }

    return renamedCount;
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
        ? buildWatchingMessage(
            this.linkedFolders.size,
            buildOrganizedVersionsMessage(movedCount)
          )
        : buildWatchingMessage(this.linkedFolders.size);

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
      const newestVersion = song.versions[0];
      if (!newestVersion) {
        continue;
      }

      const newestFolder = this.linkedFolders.get(newestVersion.folderId);
      if (!newestFolder) {
        continue;
      }

      // Keep the newest version overall as the current top-level export, even if
      // it was mistakenly dropped into old/. Everything else belongs in old/.
      for (const version of song.versions) {
        if (version.id === newestVersion.id) {
          continue;
        }

        const folder = this.linkedFolders.get(version.folderId);
        if (!folder || isInsideOldDirectory(version.filePath, folder.path)) {
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

      if (!isInsideOldDirectory(newestVersion.filePath, newestFolder.path)) {
        continue;
      }

      if (!(await pathExists(newestVersion.filePath))) {
        continue;
      }

      const promotedPath = path.join(newestFolder.path, path.basename(newestVersion.filePath));
      const archiveDirectory = path.join(newestFolder.path, 'old');
      await fs.mkdir(archiveDirectory, { recursive: true });

      if (await pathExists(promotedPath)) {
        const archivePath = await this.resolveArchivePath(
          archiveDirectory,
          path.basename(promotedPath)
        );
        await moveFile(promotedPath, archivePath);
        movedCount += 1;
      }

      await moveFile(newestVersion.filePath, promotedPath);
      movedCount += 1;
      affectedFolderIds.add(newestVersion.folderId);
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

  private async resolveVersionedExportPath(
    directoryPath: string,
    stem: string,
    extension: string,
    startingVersion: number
  ): Promise<{ filePath: string; versionNumber: number }> {
    let versionNumber = Math.max(1, Math.trunc(startingVersion));

    while (true) {
      const filePath = path.join(directoryPath, `${stem} v${versionNumber}${extension}`);
      if (!(await pathExists(filePath))) {
        return { filePath, versionNumber };
      }

      versionNumber += 1;
    }
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
