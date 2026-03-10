import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, protocol, shell } from 'electron';
import type { OpenDialogOptions } from 'electron';
import { createReadStream, existsSync, promises as fs } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import type {
  AudioFileAnalysis,
  LibrarySnapshot,
  PlaylistOrderExportV1,
  PlaybackSourceInfo,
  ProducerPlayerEnvironment,
  ReferenceTrackSelection,
  TransportCommand,
} from '@producer-player/contracts';
import { AUDIO_EXTENSIONS, IPC_CHANNELS, parsePlaylistOrderExport } from '@producer-player/contracts';
import { FileLibraryService } from '@producer-player/domain';

const DEFAULT_RENDERER_DEV_URL =
  process.env.RENDERER_DEV_URL ?? 'http://127.0.0.1:4207';
const STATE_FILE_NAME = 'producer-player-electron-state.json';
const STATE_DIRECTORY_NAME = 'Producer Player';
const ORDER_SIDECAR_DIRECTORY = '.producer-player';
const ORDER_SIDECAR_FILE = 'order-state.json';
const PLAYBACK_PROTOCOL = 'producer-media';
const PLAYBACK_PROTOCOL_HOST = 'file';
const PLAYBACK_CACHE_DIRECTORY = 'playback-cache';
const FFMPEG_BINARY_DIRECTORY = 'bin';
const AIFF_LIKE_EXTENSIONS = new Set(['aiff', 'aif', 'aifc']);
const IS_MAC_APP_STORE_SANDBOX = process.mas === true;

const IS_TEST_MODE =
  process.env.APP_TEST_MODE === 'true' ||
  Boolean(process.env.PRODUCER_PLAYER_TEST_ID);

const TEST_PLAYLIST_EXPORT_PATH = process.env.PRODUCER_PLAYER_E2E_PLAYLIST_EXPORT_PATH ?? null;
const TEST_PLAYLIST_IMPORT_PATH = process.env.PRODUCER_PLAYER_E2E_PLAYLIST_IMPORT_PATH ?? null;
const TEST_REFERENCE_IMPORT_PATH =
  process.env.PRODUCER_PLAYER_E2E_REFERENCE_IMPORT_PATH ?? null;
const ANALYSIS_DELAY_MS = Number(process.env.PRODUCER_PLAYER_ANALYSIS_DELAY_MS ?? '0');

const PLAYBACK_MIME_BY_EXTENSION: Record<string, string> = {
  wav: 'audio/wav',
  aiff: 'audio/aiff',
  aif: 'audio/aiff',
  aifc: 'audio/aiff',
  flac: 'audio/flac',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  opus: 'audio/ogg; codecs=opus',
  webm: 'audio/webm',
  mp4: 'audio/mp4',
};

protocol.registerSchemesAsPrivileged([
  {
    scheme: PLAYBACK_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

const customUserDataDirectory = process.env.PRODUCER_PLAYER_USER_DATA_DIR;
if (customUserDataDirectory) {
  app.setPath('userData', customUserDataDirectory);
}

app.setName('Producer Player');

let mainWindow: BrowserWindow | null = null;
let libraryService: FileLibraryService | null = null;
let shouldAttemptSidecarOrderRestore = false;
let playbackProtocolRegistered = false;
const playbackTranscodeJobs = new Map<string, Promise<string>>();
const linkedFolderSecurityBookmarks = new Map<string, string>();
const linkedFolderSecurityAccessStops = new Map<string, () => void>();

function emitTransportCommand(command: TransportCommand): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send(IPC_CHANNELS.TRANSPORT_COMMAND, command);
}

function registerGlobalMediaShortcuts(): void {
  const bindings: Array<[string, TransportCommand]> = [
    ['MediaPlayPause', 'play-pause'],
    ['MediaNextTrack', 'next-track'],
    ['MediaPreviousTrack', 'previous-track'],
  ];

  for (const [accelerator, command] of bindings) {
    try {
      const registered = globalShortcut.register(accelerator, () => {
        emitTransportCommand(command);
      });

      if (!registered) {
        console.warn(`[producer-player:transport] accelerator not available: ${accelerator}`);
      }
    } catch (error: unknown) {
      console.warn(`[producer-player:transport] failed to register ${accelerator}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function isDevelopment(): boolean {
  return process.env.ELECTRON_DEV === 'true';
}

function getStateDirectoryPath(): string {
  if (customUserDataDirectory) {
    return customUserDataDirectory;
  }

  return join(app.getPath('appData'), STATE_DIRECTORY_NAME);
}

function getStateFilePath(): string {
  return join(getStateDirectoryPath(), STATE_FILE_NAME);
}

function getLegacyStateFilePath(): string {
  return join(app.getPath('userData'), STATE_FILE_NAME);
}

function getFolderOrderSidecarPath(folderPath: string): string {
  return join(folderPath, ORDER_SIDECAR_DIRECTORY, ORDER_SIDECAR_FILE);
}

interface PersistedState {
  version: number;
  linkedFolderPaths: string[];
  linkedFolderBookmarks: Record<string, string>;
  autoMoveOld: boolean;
  songOrder: string[];
  updatedAt: string;
}

interface PersistedStateLoadResult {
  state: PersistedState;
  shouldAttemptSidecarOrderRestore: boolean;
}

interface FolderOrderSidecar {
  version: number;
  folderPath: string;
  songOrder: string[];
  normalizedTitleOrder: string[];
  updatedAt: string;
}

function createFallbackState(): PersistedState {
  return {
    version: 3,
    linkedFolderPaths: [],
    linkedFolderBookmarks: {},
    autoMoveOld: true,
    songOrder: [],
    updatedAt: new Date(0).toISOString(),
  };
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === 'string');
}

function parseStringRecord(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }

  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[0] === 'string' && typeof entry[1] === 'string'
  );

  return Object.fromEntries(entries);
}

function dedupeStrings(values: string[]): string[] {
  const deduped: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }

    seen.add(value);
    deduped.push(value);
  }

  return deduped;
}

async function writeJsonAtomic(filePath: string, payload: unknown): Promise<void> {
  await fs.mkdir(dirname(filePath), { recursive: true });

  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;

  await fs.writeFile(tempPath, serialized, 'utf8');

  try {
    await fs.rename(tempPath, filePath);
  } catch (error: unknown) {
    const code =
      typeof error === 'object' && error && 'code' in error
        ? String((error as { code?: unknown }).code)
        : null;

    if (code !== 'EEXIST' && code !== 'EPERM') {
      throw error;
    }

    await fs.rm(filePath, { force: true });
    await fs.rename(tempPath, filePath);
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
  }
}

function parsePersistedState(raw: string): PersistedState {
  const fallback = createFallbackState();
  const parsed = JSON.parse(raw) as Partial<PersistedState>;

  const linkedFolderPaths = dedupeStrings(
    parseStringArray(parsed.linkedFolderPaths).map((folderPath) => resolve(folderPath))
  );

  const parsedBookmarks = parseStringRecord(parsed.linkedFolderBookmarks);
  const linkedFolderBookmarks: Record<string, string> = {};

  for (const folderPath of linkedFolderPaths) {
    const bookmark = parsedBookmarks[folderPath] ?? parsedBookmarks[resolve(folderPath)];
    if (typeof bookmark !== 'string' || bookmark.length === 0) {
      continue;
    }

    linkedFolderBookmarks[folderPath] = bookmark;
  }

  return {
    version: typeof parsed.version === 'number' ? parsed.version : fallback.version,
    linkedFolderPaths,
    linkedFolderBookmarks,
    autoMoveOld:
      typeof parsed.autoMoveOld === 'boolean' ? parsed.autoMoveOld : fallback.autoMoveOld,
    songOrder: dedupeStrings(parseStringArray(parsed.songOrder)),
    updatedAt:
      typeof parsed.updatedAt === 'string' && parsed.updatedAt.length > 0
        ? parsed.updatedAt
        : fallback.updatedAt,
  };
}

async function readPersistedState(): Promise<PersistedStateLoadResult> {
  const fallback = createFallbackState();
  const primaryStatePath = getStateFilePath();
  const candidatePaths = dedupeStrings([
    primaryStatePath,
    customUserDataDirectory ? '' : getLegacyStateFilePath(),
  ]);

  for (const candidatePath of candidatePaths) {
    if (!candidatePath) {
      continue;
    }

    try {
      const raw = await fs.readFile(candidatePath, 'utf8');
      const parsed = parsePersistedState(raw);

      if (candidatePath !== primaryStatePath) {
        await writeJsonAtomic(primaryStatePath, {
          ...parsed,
          version: 3,
          updatedAt: new Date().toISOString(),
        }).catch(() => undefined);
      }

      return {
        state: parsed,
        shouldAttemptSidecarOrderRestore: parsed.songOrder.length === 0,
      };
    } catch {
      // Try next candidate.
    }
  }

  return {
    state: fallback,
    shouldAttemptSidecarOrderRestore: true,
  };
}

function cachePersistedFolderBookmarks(bookmarks: Record<string, string>): void {
  linkedFolderSecurityBookmarks.clear();

  for (const [folderPath, bookmark] of Object.entries(bookmarks)) {
    if (typeof bookmark !== 'string' || bookmark.length === 0) {
      continue;
    }

    linkedFolderSecurityBookmarks.set(resolve(folderPath), bookmark);
  }
}

function rememberFolderBookmark(folderPath: string, bookmark: string | null | undefined): void {
  if (typeof bookmark !== 'string' || bookmark.length === 0) {
    return;
  }

  linkedFolderSecurityBookmarks.set(resolve(folderPath), bookmark);
}

function forgetFolderBookmark(folderPath: string): void {
  linkedFolderSecurityBookmarks.delete(resolve(folderPath));
}

function releaseFolderSecurityScope(folderPath: string): void {
  const resolvedPath = resolve(folderPath);
  const stopAccess = linkedFolderSecurityAccessStops.get(resolvedPath);
  if (!stopAccess) {
    return;
  }

  try {
    stopAccess();
  } catch {
    // Ignore security-scope cleanup failures on shutdown/unlink.
  }

  linkedFolderSecurityAccessStops.delete(resolvedPath);
}

function releaseAllFolderSecurityScopes(): void {
  for (const stopAccess of linkedFolderSecurityAccessStops.values()) {
    try {
      stopAccess();
    } catch {
      // Ignore security-scope cleanup failures on shutdown.
    }
  }

  linkedFolderSecurityAccessStops.clear();
}

function beginFolderSecurityScope(folderPath: string): void {
  if (!IS_MAC_APP_STORE_SANDBOX) {
    return;
  }

  const resolvedPath = resolve(folderPath);
  const bookmark = linkedFolderSecurityBookmarks.get(resolvedPath);
  if (!bookmark) {
    return;
  }

  releaseFolderSecurityScope(resolvedPath);

  try {
    const stopAccess = app.startAccessingSecurityScopedResource(bookmark);
    if (typeof stopAccess === 'function') {
      linkedFolderSecurityAccessStops.set(resolvedPath, stopAccess as () => void);
    }
  } catch (error: unknown) {
    console.warn('[producer-player:sandbox] Failed to start security-scoped access', {
      folderPath: resolvedPath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function buildPersistedBookmarksForSnapshot(snapshot: LibrarySnapshot): Record<string, string> {
  const nextBookmarks: Record<string, string> = {};

  for (const folder of snapshot.linkedFolders) {
    const bookmark = linkedFolderSecurityBookmarks.get(resolve(folder.path));
    if (!bookmark) {
      continue;
    }

    nextBookmarks[resolve(folder.path)] = bookmark;
  }

  return nextBookmarks;
}

function buildFolderOrderSidecar(
  snapshot: LibrarySnapshot,
  folderId: string,
  folderPath: string
): FolderOrderSidecar {
  const songs = snapshot.songs.filter((song) => song.folderId === folderId);

  return {
    version: 1,
    folderPath,
    songOrder: songs.map((song) => song.id),
    normalizedTitleOrder: songs.map((song) => song.normalizedTitle),
    updatedAt: new Date().toISOString(),
  };
}

async function writeFolderOrderSidecars(snapshot: LibrarySnapshot): Promise<void> {
  await Promise.all(
    snapshot.linkedFolders.map(async (folder) => {
      const sidecarPath = getFolderOrderSidecarPath(folder.path);
      const payload = buildFolderOrderSidecar(snapshot, folder.id, folder.path);

      await writeJsonAtomic(sidecarPath, payload).catch(() => undefined);
    })
  );
}

async function readFolderOrderSidecar(folderPath: string): Promise<FolderOrderSidecar | null> {
  const sidecarPath = getFolderOrderSidecarPath(folderPath);

  try {
    const raw = await fs.readFile(sidecarPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<FolderOrderSidecar>;

    const normalizedTitleOrder = dedupeStrings(parseStringArray(parsed.normalizedTitleOrder));
    const songOrder = dedupeStrings(parseStringArray(parsed.songOrder));

    if (normalizedTitleOrder.length === 0 && songOrder.length === 0) {
      return null;
    }

    return {
      version: typeof parsed.version === 'number' ? parsed.version : 1,
      folderPath,
      normalizedTitleOrder,
      songOrder,
      updatedAt:
        typeof parsed.updatedAt === 'string' && parsed.updatedAt.length > 0
          ? parsed.updatedAt
          : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

function arraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

async function restoreSongOrderFromSidecars(
  service: FileLibraryService,
  folderPaths?: string[]
): Promise<LibrarySnapshot> {
  const targetFolderPathSet = folderPaths ? new Set(folderPaths.map((value) => resolve(value))) : null;

  let snapshot = service.getSnapshot();
  let nextOrder = snapshot.songs.map((song) => song.id);

  for (const folder of snapshot.linkedFolders) {
    if (targetFolderPathSet && !targetFolderPathSet.has(resolve(folder.path))) {
      continue;
    }

    const folderSongs = snapshot.songs.filter((song) => song.folderId === folder.id);
    if (folderSongs.length === 0) {
      continue;
    }

    const sidecar = await readFolderOrderSidecar(folder.path);
    if (!sidecar) {
      continue;
    }

    const titleToSongId = new Map(folderSongs.map((song) => [song.normalizedTitle, song.id]));
    const folderSongIdSet = new Set(folderSongs.map((song) => song.id));

    const preferredFolderOrder = dedupeStrings([
      ...sidecar.normalizedTitleOrder
        .map((title) => titleToSongId.get(title))
        .filter((songId): songId is string => typeof songId === 'string'),
      ...sidecar.songOrder.filter((songId) => folderSongIdSet.has(songId)),
    ]);

    if (preferredFolderOrder.length === 0) {
      continue;
    }

    for (const songId of folderSongs.map((song) => song.id)) {
      if (!preferredFolderOrder.includes(songId)) {
        preferredFolderOrder.push(songId);
      }
    }

    const iterator = [...preferredFolderOrder];
    const folderSet = new Set(folderSongs.map((song) => song.id));

    nextOrder = nextOrder.map((songId) => {
      if (!folderSet.has(songId)) {
        return songId;
      }

      return iterator.shift() ?? songId;
    });
  }

  if (arraysEqual(nextOrder, snapshot.songs.map((song) => song.id))) {
    return snapshot;
  }

  snapshot = await service.reorderSongs(nextOrder);
  return snapshot;
}

async function writePersistedState(snapshot: LibrarySnapshot): Promise<void> {
  const payload: PersistedState = {
    version: 3,
    linkedFolderPaths: snapshot.linkedFolders.map((folder) => resolve(folder.path)),
    linkedFolderBookmarks: buildPersistedBookmarksForSnapshot(snapshot),
    autoMoveOld: snapshot.matcherSettings.autoMoveOld,
    songOrder: snapshot.songs.map((song) => song.id),
    updatedAt: new Date().toISOString(),
  };

  await writeJsonAtomic(getStateFilePath(), payload);
  await writeFolderOrderSidecars(snapshot);
}

function getPlaybackCacheDirectoryPath(): string {
  return join(getStateDirectoryPath(), PLAYBACK_CACHE_DIRECTORY);
}

function getBundledFfmpegPath(): string {
  if (typeof process.env.PRODUCER_PLAYER_FFMPEG_PATH === 'string') {
    return process.env.PRODUCER_PLAYER_FFMPEG_PATH;
  }

  const binaryName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';

  if (app.isPackaged) {
    return join(
      process.resourcesPath,
      'app.asar.unpacked',
      'apps/electron/dist',
      FFMPEG_BINARY_DIRECTORY,
      binaryName
    );
  }

  return join(__dirname, FFMPEG_BINARY_DIRECTORY, binaryName);
}

function getBinaryCommandPath(binaryName: 'ffmpeg' | 'ffprobe'): string {
  const envKey = binaryName === 'ffmpeg' ? 'PRODUCER_PLAYER_FFMPEG_PATH' : 'PRODUCER_PLAYER_FFPROBE_PATH';
  const configuredPath = process.env[envKey];

  if (typeof configuredPath === 'string' && configuredPath.length > 0) {
    return configuredPath;
  }

  if (binaryName === 'ffmpeg') {
    const bundledFfmpegPath = getBundledFfmpegPath();
    if (existsSync(bundledFfmpegPath)) {
      return bundledFfmpegPath;
    }
  }

  return binaryName;
}

function parseMeasuredLevel(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  if (normalized.length === 0 || normalized.toLowerCase() === 'nan') {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, milliseconds);
  });
}

async function runProcessCapture(
  command: string,
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      rejectPromise(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr });
        return;
      }

      rejectPromise(
        new Error(
          `${command} exited with ${code}. ${stderr.trim() || stdout.trim() || 'No diagnostic output.'}`
        )
      );
    });
  });
}

async function analyzeAudioFile(filePath: string): Promise<AudioFileAnalysis> {
  const resolvedPath = resolve(filePath);
  const stats = await fs.stat(resolvedPath);

  if (!stats.isFile()) {
    throw new Error(`Cannot analyse a non-file path: ${resolvedPath}`);
  }

  if (ANALYSIS_DELAY_MS > 0) {
    await delay(ANALYSIS_DELAY_MS);
  }

  const ffmpegCommand = getBinaryCommandPath('ffmpeg');
  const ebur128Result = await runProcessCapture(ffmpegCommand, [
    '-hide_banner',
    '-loglevel',
    'verbose',
    '-nostats',
    '-i',
    resolvedPath,
    '-filter_complex',
    'ebur128=peak=true:framelog=verbose',
    '-f',
    'null',
    '-',
  ]);

  const volumedetectResult = await runProcessCapture(ffmpegCommand, [
    '-hide_banner',
    '-nostats',
    '-i',
    resolvedPath,
    '-af',
    'volumedetect',
    '-f',
    'null',
    '-',
  ]);

  const integratedMatch = ebur128Result.stderr.match(/\bI:\s*(-?\d+(?:\.\d+)?)\s+LUFS/);
  const lraMatch = ebur128Result.stderr.match(/\bLRA:\s*(-?\d+(?:\.\d+)?)\s+LU/);
  const truePeakMatch = ebur128Result.stderr.match(/True peak:[\s\S]*?Peak:\s*(-?\d+(?:\.\d+)?)\s+dBFS/);

  const momentaryMatches = Array.from(
    ebur128Result.stderr.matchAll(/\bM:\s*(-?\d+(?:\.\d+)?|-?inf)/g)
  )
    .map((match) => parseMeasuredLevel(match[1]))
    .filter((value): value is number => value !== null && value > -100);

  const shortTermMatches = Array.from(
    ebur128Result.stderr.matchAll(/\bS:\s*(-?\d+(?:\.\d+)?|-?inf)/g)
  )
    .map((match) => parseMeasuredLevel(match[1]))
    .filter((value): value is number => value !== null && value > -100);

  const meanVolumeMatch = volumedetectResult.stderr.match(/mean_volume:\s*(-?\d+(?:\.\d+)?)\s+dB/);
  const samplePeakMatch = volumedetectResult.stderr.match(/max_volume:\s*(-?\d+(?:\.\d+)?)\s+dB/);

  return {
    filePath: resolvedPath,
    measuredWith: 'ffmpeg-ebur128-volumedetect',
    integratedLufs: parseMeasuredLevel(integratedMatch?.[1]),
    loudnessRangeLufs: parseMeasuredLevel(lraMatch?.[1]),
    truePeakDbfs: parseMeasuredLevel(truePeakMatch?.[1]),
    samplePeakDbfs: parseMeasuredLevel(samplePeakMatch?.[1]),
    meanVolumeDbfs: parseMeasuredLevel(meanVolumeMatch?.[1]),
    maxMomentaryLufs:
      momentaryMatches.length > 0 ? Math.max(...momentaryMatches) : null,
    maxShortTermLufs:
      shortTermMatches.length > 0 ? Math.max(...shortTermMatches) : null,
  };
}

async function pickReferenceTrack(): Promise<ReferenceTrackSelection | null> {
  const testSelectionPath = TEST_REFERENCE_IMPORT_PATH;

  let selectedPath: string | undefined;

  if (testSelectionPath) {
    selectedPath = resolve(testSelectionPath);
  } else {
    const dialogOptions: OpenDialogOptions = {
      title: 'Choose reference track',
      properties: ['openFile'],
      filters: [
        {
          name: 'Audio files',
          extensions: [...AUDIO_EXTENSIONS],
        },
      ],
    };

    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);

    selectedPath = result.filePaths[0];
  }

  if (!selectedPath) {
    return null;
  }

  const playbackSource = await resolvePlaybackSource(selectedPath);
  return {
    filePath: selectedPath,
    fileName: extname(selectedPath).length > 0 ? selectedPath.split(/[/\\]/).pop() ?? selectedPath : selectedPath,
    playbackSource,
  };
}

function createPlaybackCacheKey(
  filePath: string,
  stats: { size: number; mtimeMs: number }
): string {
  return createHash('sha1')
    .update(`${filePath}::${stats.size}::${stats.mtimeMs}`)
    .digest('hex');
}

function shouldTranscodeForPlayback(extension: string): boolean {
  if (IS_MAC_APP_STORE_SANDBOX) {
    return false;
  }

  return AIFF_LIKE_EXTENSIONS.has(extension.toLowerCase());
}

async function transcodeAudioForPlayback(
  sourcePath: string,
  outputPath: string
): Promise<void> {
  const ffmpegPath = getBundledFfmpegPath();

  if (!existsSync(ffmpegPath)) {
    throw new Error(`Bundled ffmpeg binary is missing: ${ffmpegPath}`);
  }

  await fs.mkdir(dirname(outputPath), { recursive: true });

  const temporaryOutputPath = `${outputPath}.tmp-${process.pid}-${Date.now()}.wav`;

  try {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const ffmpeg = spawn(
        ffmpegPath,
        ['-v', 'error', '-y', '-i', sourcePath, '-vn', '-c:a', 'pcm_s16le', temporaryOutputPath],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );

      let stderr = '';
      ffmpeg.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      ffmpeg.on('error', (error) => {
        rejectPromise(error);
      });

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolvePromise();
          return;
        }

        rejectPromise(
          new Error(
            `ffmpeg failed while preparing playback for ${sourcePath} (exit ${code}): ${stderr.trim()}`
          )
        );
      });
    });

    try {
      await fs.rename(temporaryOutputPath, outputPath);
    } catch (error: unknown) {
      const code =
        typeof error === 'object' && error && 'code' in error
          ? String((error as { code?: unknown }).code)
          : null;

      if (code !== 'EEXIST' && code !== 'EPERM') {
        throw error;
      }

      await fs.rm(outputPath, { force: true });
      await fs.rename(temporaryOutputPath, outputPath);
    }
  } finally {
    await fs.rm(temporaryOutputPath, { force: true }).catch(() => undefined);
  }
}

async function ensureTranscodedPlaybackFile(
  sourcePath: string,
  stats: { size: number; mtimeMs: number }
): Promise<string> {
  const cacheKey = createPlaybackCacheKey(sourcePath, stats);
  const outputPath = join(getPlaybackCacheDirectoryPath(), `${cacheKey}.wav`);

  if (existsSync(outputPath)) {
    return outputPath;
  }

  const existingJob = playbackTranscodeJobs.get(outputPath);
  if (existingJob) {
    return existingJob;
  }

  const job = (async () => {
    try {
      await transcodeAudioForPlayback(sourcePath, outputPath);
      return outputPath;
    } finally {
      playbackTranscodeJobs.delete(outputPath);
    }
  })();

  playbackTranscodeJobs.set(outputPath, job);
  return job;
}

function buildDirectPlaybackSourceInfo(
  filePath: string,
  exists: boolean
): PlaybackSourceInfo {
  return {
    filePath,
    url: buildPlaybackUrl(filePath),
    mimeType: getPlaybackMimeType(filePath),
    extension: extname(filePath).replace('.', '').toLowerCase(),
    exists,
    sourceStrategy: 'direct-file',
    originalFilePath: null,
  };
}

function getPlaybackMimeType(filePath: string): string {
  const extension = extname(filePath).replace('.', '').toLowerCase();
  return PLAYBACK_MIME_BY_EXTENSION[extension] ?? 'application/octet-stream';
}

function buildPlaybackUrl(filePath: string): string {
  const encodedPath = Buffer.from(filePath, 'utf8').toString('base64url');
  return `${PLAYBACK_PROTOCOL}://${PLAYBACK_PROTOCOL_HOST}/${encodedPath}`;
}

function parseByteRange(
  rangeHeader: string,
  totalSize: number
): { start: number; end: number } | null {
  const matched = rangeHeader.match(/^bytes=(\d*)-(\d*)$/i);
  if (!matched) {
    return null;
  }

  const [, startRaw, endRaw] = matched;

  if (startRaw.length === 0 && endRaw.length === 0) {
    return null;
  }

  let start: number;
  let end: number;

  if (startRaw.length === 0) {
    const suffixLength = Number(endRaw);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return null;
    }

    start = Math.max(totalSize - suffixLength, 0);
    end = totalSize - 1;
  } else {
    start = Number(startRaw);
    end = endRaw.length > 0 ? Number(endRaw) : totalSize - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }

  start = Math.trunc(start);
  end = Math.trunc(end);

  if (start < 0 || end < 0 || start > end || start >= totalSize) {
    return null;
  }

  end = Math.min(end, totalSize - 1);

  return { start, end };
}

async function resolvePlaybackSource(filePath: string): Promise<PlaybackSourceInfo> {
  const resolvedPath = resolve(filePath);

  let stats;
  try {
    stats = await fs.stat(resolvedPath);
  } catch {
    return buildDirectPlaybackSourceInfo(resolvedPath, false);
  }

  if (!stats.isFile()) {
    return buildDirectPlaybackSourceInfo(resolvedPath, false);
  }

  const extension = extname(resolvedPath).replace('.', '').toLowerCase();

  if (!shouldTranscodeForPlayback(extension)) {
    return buildDirectPlaybackSourceInfo(resolvedPath, true);
  }

  try {
    const transcodedPath = await ensureTranscodedPlaybackFile(resolvedPath, {
      size: stats.size,
      mtimeMs: stats.mtimeMs,
    });

    return {
      filePath: transcodedPath,
      url: buildPlaybackUrl(transcodedPath),
      mimeType: 'audio/wav',
      extension: 'wav',
      exists: true,
      sourceStrategy: 'transcoded-cache',
      originalFilePath: resolvedPath,
    };
  } catch (error) {
    console.warn(
      `[producer-player:playback] failed to prepare AIFF source, falling back to direct file: ${resolvedPath}`,
      error
    );

    return buildDirectPlaybackSourceInfo(resolvedPath, true);
  }
}

async function registerPlaybackProtocol(): Promise<void> {
  if (playbackProtocolRegistered) {
    return;
  }

  protocol.handle(PLAYBACK_PROTOCOL, async (request) => {
    const requestUrl = new URL(request.url);
    if (requestUrl.hostname !== PLAYBACK_PROTOCOL_HOST) {
      return new Response('Not Found', { status: 404 });
    }

    const encodedPath = requestUrl.pathname.replace(/^\/+/, '');

    let decodedPath: string;
    try {
      decodedPath = Buffer.from(encodedPath, 'base64url').toString('utf8');
    } catch {
      return new Response('Invalid media path', { status: 400 });
    }

    const resolvedPath = resolve(decodedPath);

    let stats;
    try {
      stats = await fs.stat(resolvedPath);
    } catch {
      return new Response('Media file not found', { status: 404 });
    }

    if (!stats.isFile()) {
      return new Response('Media file not found', { status: 404 });
    }

    const mimeType = getPlaybackMimeType(resolvedPath);
    const rangeHeader = request.headers.get('range');

    if (rangeHeader) {
      const byteRange = parseByteRange(rangeHeader, stats.size);
      if (!byteRange) {
        return new Response('Range Not Satisfiable', {
          status: 416,
          headers: {
            'Content-Range': `bytes */${stats.size}`,
            'Accept-Ranges': 'bytes',
          },
        });
      }

      const stream = createReadStream(resolvedPath, {
        start: byteRange.start,
        end: byteRange.end,
      });

      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 206,
        headers: {
          'Content-Type': mimeType,
          'Content-Length': String(byteRange.end - byteRange.start + 1),
          'Content-Range': `bytes ${byteRange.start}-${byteRange.end}/${stats.size}`,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-store',
        },
      });
    }

    const stream = createReadStream(resolvedPath);

    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Length': String(stats.size),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
      },
    });
  });

  playbackProtocolRegistered = true;
}

function findProductionIndexPath(): string | null {
  const candidates = [
    join(__dirname, '../../renderer/dist/index.html'),
    join(process.cwd(), 'apps/renderer/dist/index.html'),
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function validateRendererDevUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`RENDERER_DEV_URL is invalid: ${url}`);
  }

  const allowedHost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  const allowedProtocol = parsed.protocol === 'http:' || parsed.protocol === 'https:';

  if (!allowedHost || !allowedProtocol) {
    throw new Error(
      `RENDERER_DEV_URL must be http(s)://localhost or http(s)://127.0.0.1. Received: ${url}`
    );
  }
}

function buildEnvironmentInfo(): ProducerPlayerEnvironment {
  return {
    isMacAppStoreSandboxed: IS_MAC_APP_STORE_SANDBOX,
    canLinkFolderByPath: !IS_MAC_APP_STORE_SANDBOX,
    canRequestSecurityScopedBookmarks: IS_MAC_APP_STORE_SANDBOX,
    isTestMode: IS_TEST_MODE,
  };
}

async function createMainWindow(): Promise<void> {
  const productionIndexPath = findProductionIndexPath();
  const developmentMode = isDevelopment();

  let allowedOrigin: string | null = null;
  let allowFileProtocol = false;

  if (developmentMode) {
    validateRendererDevUrl(DEFAULT_RENDERER_DEV_URL);
    allowedOrigin = new URL(DEFAULT_RENDERER_DEV_URL).origin;
  } else if (productionIndexPath) {
    allowFileProtocol = true;
  }

  mainWindow = new BrowserWindow({
    title: 'Producer Player',
    width: 1380,
    height: 940,
    minWidth: 1100,
    minHeight: 780,
    center: true,
    backgroundColor: '#0a0f14',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
    show: IS_TEST_MODE,
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  mainWindow.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });

  mainWindow.webContents.session.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false)
  );

  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    let allowed = false;

    try {
      const parsed = new URL(targetUrl);
      if (allowFileProtocol && parsed.protocol === 'file:') {
        allowed = true;
      } else if (allowedOrigin !== null && parsed.origin === allowedOrigin) {
        allowed = true;
      }
    } catch {
      // Invalid target URL, keep blocked.
    }

    if (!allowed) {
      event.preventDefault();
    }
  });

  if (!IS_TEST_MODE) {
    mainWindow.once('ready-to-show', () => {
      mainWindow?.show();
    });
  }

  if (developmentMode) {
    await mainWindow.loadURL(DEFAULT_RENDERER_DEV_URL);
    if (process.env.ELECTRON_OPEN_DEVTOOLS === 'true') {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
    return;
  }

  if (productionIndexPath) {
    await mainWindow.loadFile(productionIndexPath);
    return;
  }

  throw new Error(
    'Could not find renderer index.html. Build renderer first or run with ELECTRON_DEV=true.'
  );
}

async function ensureLibraryService(): Promise<FileLibraryService> {
  if (libraryService) {
    return libraryService;
  }

  const persistedState = await readPersistedState();
  shouldAttemptSidecarOrderRestore = persistedState.shouldAttemptSidecarOrderRestore;
  cachePersistedFolderBookmarks(persistedState.state.linkedFolderBookmarks);

  const service = new FileLibraryService({
    autoMoveOld: persistedState.state.autoMoveOld,
    songOrder: persistedState.state.songOrder,
  });

  for (const folderPath of persistedState.state.linkedFolderPaths) {
    const resolvedPath = resolve(folderPath);
    beginFolderSecurityScope(resolvedPath);

    try {
      await service.linkFolder(resolvedPath);
    } catch {
      releaseFolderSecurityScope(resolvedPath);
      // Keep going so one bad folder does not block startup.
    }
  }

  if (shouldAttemptSidecarOrderRestore) {
    await restoreSongOrderFromSidecars(service);
  }

  service.subscribe((snapshot) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.SNAPSHOT_UPDATED, snapshot);
    }

    void writePersistedState(snapshot);
  });

  libraryService = service;
  return service;
}

function registerIpcHandlers(service: FileLibraryService): void {
  ipcMain.handle(IPC_CHANNELS.GET_LIBRARY_SNAPSHOT, async () => service.getSnapshot());
  ipcMain.handle(IPC_CHANNELS.GET_ENVIRONMENT, async () => buildEnvironmentInfo());

  ipcMain.handle(IPC_CHANNELS.LINK_FOLDER_DIALOG, async () => {
    const dialogOptions: OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Link Producer Folder',
      message: 'Choose a folder to watch for exports.',
      securityScopedBookmarks: IS_MAC_APP_STORE_SANDBOX,
    };

    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);

    if (result.canceled || result.filePaths.length === 0) {
      return service.getSnapshot();
    }

    let snapshot = service.getSnapshot();
    for (const [index, selectedPath] of result.filePaths.entries()) {
      const resolvedPath = resolve(selectedPath);
      const bookmark = result.bookmarks?.[index];

      if (IS_MAC_APP_STORE_SANDBOX && (!bookmark || bookmark.length === 0)) {
        throw new Error(
          `macOS App Store sandbox did not return a security-scoped bookmark for: ${resolvedPath}`
        );
      }

      rememberFolderBookmark(resolvedPath, bookmark);
      beginFolderSecurityScope(resolvedPath);

      try {
        snapshot = await service.linkFolder(resolvedPath);
      } catch (error) {
        releaseFolderSecurityScope(resolvedPath);
        forgetFolderBookmark(resolvedPath);
        throw error;
      }

      if (shouldAttemptSidecarOrderRestore) {
        snapshot = await restoreSongOrderFromSidecars(service, [resolvedPath]);
      }
    }

    return snapshot;
  });

  ipcMain.handle(IPC_CHANNELS.LINK_FOLDER_PATH, async (_event, folderPath: string) => {
    if (IS_MAC_APP_STORE_SANDBOX) {
      throw new Error(
        'Manual path linking is disabled in the Mac App Store sandbox build. Use Add Folder… so the app can request folder access.'
      );
    }

    const resolvedPath = resolve(folderPath);
    let snapshot = await service.linkFolder(resolvedPath);
    if (shouldAttemptSidecarOrderRestore) {
      snapshot = await restoreSongOrderFromSidecars(service, [resolvedPath]);
    }

    return snapshot;
  });

  ipcMain.handle(IPC_CHANNELS.UNLINK_FOLDER, async (_event, folderId: string) => {
    const folder = service.getSnapshot().linkedFolders.find((entry) => entry.id === folderId);
    const snapshot = await service.unlinkFolder(folderId);

    if (folder) {
      releaseFolderSecurityScope(folder.path);
      forgetFolderBookmark(folder.path);
    }

    return snapshot;
  });

  ipcMain.handle(IPC_CHANNELS.RESCAN_LIBRARY, async () => service.rescanLibrary());

  ipcMain.handle(IPC_CHANNELS.ORGANIZE_OLD_VERSIONS, async () => {
    return service.organizeOldVersions();
  });

  ipcMain.handle(IPC_CHANNELS.SET_AUTO_MOVE_OLD, async (_event, enabled: boolean) => {
    return service.setAutoMoveOld(Boolean(enabled));
  });

  ipcMain.handle(IPC_CHANNELS.REORDER_SONGS, async (_event, songIds: string[]) => {
    return service.reorderSongs(Array.isArray(songIds) ? songIds : []);
  });

  ipcMain.handle(
    IPC_CHANNELS.EXPORT_PLAYLIST_ORDER,
    async (_event, payload: PlaylistOrderExportV1) => {
      const validated = parsePlaylistOrderExport(payload);
      const raw = `${JSON.stringify(validated, null, 2)}\n`;

      if (IS_TEST_MODE && TEST_PLAYLIST_EXPORT_PATH) {
        const resolvedPath = resolve(TEST_PLAYLIST_EXPORT_PATH);
        await fs.mkdir(dirname(resolvedPath), { recursive: true });
        await fs.writeFile(resolvedPath, raw, 'utf8');
        return { filePath: resolvedPath };
      }

      const folderSlug = validated.selection.selectedFolderName
        ? validated.selection.selectedFolderName.replace(/[^a-z0-9-_]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
        : 'playlist';

      const defaultPath = `producer-player-${folderSlug}-order.json`;

      const result = mainWindow
        ? await dialog.showSaveDialog(mainWindow, {
            title: 'Export playlist ordering',
            defaultPath,
            filters: [{ name: 'JSON', extensions: ['json'] }],
          })
        : await dialog.showSaveDialog({
            title: 'Export playlist ordering',
            defaultPath,
            filters: [{ name: 'JSON', extensions: ['json'] }],
          });

      if (result.canceled || !result.filePath) {
        return { filePath: null };
      }

      await fs.writeFile(result.filePath, raw, 'utf8');
      return { filePath: result.filePath };
    }
  );

  ipcMain.handle(IPC_CHANNELS.IMPORT_PLAYLIST_ORDER, async () => {
    if (IS_TEST_MODE && TEST_PLAYLIST_IMPORT_PATH) {
      const resolvedPath = resolve(TEST_PLAYLIST_IMPORT_PATH);
      const raw = await fs.readFile(resolvedPath, 'utf8');
      return parsePlaylistOrderExport(JSON.parse(raw));
    }

    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, {
          title: 'Import playlist ordering',
          properties: ['openFile'],
          filters: [{ name: 'JSON', extensions: ['json'] }],
        })
      : await dialog.showOpenDialog({
          title: 'Import playlist ordering',
          properties: ['openFile'],
          filters: [{ name: 'JSON', extensions: ['json'] }],
        });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const filePath = result.filePaths[0];
    if (!filePath) {
      return null;
    }

    const raw = await fs.readFile(filePath, 'utf8');
    return parsePlaylistOrderExport(JSON.parse(raw));
  });

  ipcMain.handle(IPC_CHANNELS.OPEN_IN_FINDER, async (_event, filePath: string) => {
    shell.showItemInFolder(resolve(filePath));
  });

  ipcMain.handle(IPC_CHANNELS.OPEN_FOLDER, async (_event, folderPath: string) => {
    const resolvedPath = resolve(folderPath);

    let stats;
    try {
      stats = await fs.stat(resolvedPath);
    } catch {
      throw new Error(`Folder not accessible: ${resolvedPath}`);
    }

    if (!stats.isDirectory()) {
      throw new Error(`Path is not a folder: ${resolvedPath}`);
    }

    const error = await shell.openPath(resolvedPath);
    if (error) {
      throw new Error(error);
    }
  });

  ipcMain.handle(IPC_CHANNELS.TO_FILE_URL, async (_event, filePath: string) => {
    return buildPlaybackUrl(resolve(filePath));
  });

  ipcMain.handle(IPC_CHANNELS.RESOLVE_PLAYBACK_SOURCE, async (_event, filePath: string) => {
    return resolvePlaybackSource(filePath);
  });

  ipcMain.handle(IPC_CHANNELS.ANALYZE_AUDIO_FILE, async (_event, filePath: string) => {
    return analyzeAudioFile(filePath);
  });

  ipcMain.handle(IPC_CHANNELS.PICK_REFERENCE_TRACK, async () => {
    return pickReferenceTrack();
  });
}

app.whenReady().then(async () => {
  await registerPlaybackProtocol();

  const service = await ensureLibraryService();
  registerIpcHandlers(service);
  await createMainWindow();
  registerGlobalMediaShortcuts();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
});

app.on('before-quit', () => {
  globalShortcut.unregisterAll();
  releaseAllFolderSecurityScopes();

  if (libraryService) {
    void libraryService.dispose();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
