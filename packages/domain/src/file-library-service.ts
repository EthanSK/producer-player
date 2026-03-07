import { createHash } from 'node:crypto';
import { promises as fs, type Dirent } from 'node:fs';
import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import type {
  LibrarySnapshot,
  LinkedFolder,
  MatcherSettings,
} from '@producer-player/contracts';
import { buildSongsFromFiles, isSupportedAudioFile, type ScannedAudioFile } from './song-model';

const DEFAULT_MATCHER_SETTINGS: MatcherSettings = {
  fuzzyThreshold: 0.72,
  autoMoveOld: true,
};

type SnapshotSubscriber = (snapshot: LibrarySnapshot) => void;

function stableId(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 16);
}

function cloneSnapshot(snapshot: LibrarySnapshot): LibrarySnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as LibrarySnapshot;
}

async function collectAudioFiles(
  folderPath: string,
  folderId: string
): Promise<ScannedAudioFile[]> {
  const files: ScannedAudioFile[] = [];
  const pendingDirectories = [folderPath];

  while (pendingDirectories.length > 0) {
    const current = pendingDirectories.pop();
    if (!current) {
      continue;
    }

    let entries: Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) {
          continue;
        }
        pendingDirectories.push(absolutePath);
        continue;
      }

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
  }

  return files;
}

export class FileLibraryService {
  private readonly linkedFolders = new Map<string, LinkedFolder>();
  private readonly folderFiles = new Map<string, ScannedAudioFile[]>();
  private readonly folderWatchers = new Map<string, FSWatcher>();
  private readonly folderScanTimers = new Map<string, NodeJS.Timeout>();
  private readonly subscribers = new Set<SnapshotSubscriber>();
  private matcherSettings: MatcherSettings;

  private snapshot: LibrarySnapshot = {
    linkedFolders: [],
    songs: [],
    versions: [],
    status: 'idle',
    statusMessage: 'No folders linked yet.',
    scannedAt: null,
    matcherSettings: DEFAULT_MATCHER_SETTINGS,
  };

  constructor(settings?: Partial<MatcherSettings>) {
    this.matcherSettings = {
      ...DEFAULT_MATCHER_SETTINGS,
      ...settings,
    };

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
    this.attachWatcher(folder);

    this.rebuildSnapshot('watching', `Watching ${this.linkedFolders.size} folder(s).`);
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

    this.rebuildSnapshot('watching', `Watching ${this.linkedFolders.size} folder(s).`);
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
    };

    this.emitSnapshot();
  }

  private async scanFolder(folderId: string): Promise<void> {
    const folder = this.linkedFolders.get(folderId);
    if (!folder) {
      return;
    }

    const files = await collectAudioFiles(folder.path, folderId);
    this.folderFiles.set(folderId, files);
  }

  private attachWatcher(folder: LinkedFolder): void {
    if (this.folderWatchers.has(folder.id)) {
      return;
    }

    const watcher = chokidar.watch(folder.path, {
      ignoreInitial: true,
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

      if (eventName !== 'addDir' && eventName !== 'unlinkDir' && !isSupportedAudioFile(changedPath)) {
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
    this.rebuildSnapshot('watching', `Watching ${this.linkedFolders.size} folder(s).`);
  }

  private rebuildSnapshot(status: LibrarySnapshot['status'], statusMessage: string): void {
    const folderList = Array.from(this.linkedFolders.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    const files = Array.from(this.folderFiles.values()).flat();
    const songs = buildSongsFromFiles(files);
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
