import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, nativeImage, protocol, safeStorage, shell } from 'electron';
import type { OpenDialogOptions } from 'electron';
import { createReadStream, existsSync, promises as fs } from 'node:fs';
import { basename, dirname, extname, join, parse, resolve } from 'node:path';
import { Readable } from 'node:stream';
import type {
  AgentContext,
  AgentProviderId,
  AgentStartSessionPayload,
  AgentSendTurnPayload,
  AgentRespondApprovalPayload,
  AudioFileAnalysis,
  ICloudAvailabilityResult,
  ICloudBackupData,
  ICloudLoadResult,
  ICloudSyncResult,
  LibrarySnapshot,
  SharedUserState,
  SongChecklistItem,
  PlaylistOrderExportV1,
  PlaybackSourceInfo,
  ProducerPlayerEnvironment,
  ProjectFileSelection,
  ReferenceTrackSelection,
  SongVersion,
  UpdateCheckResult,
  SongWithVersions,
  TransportCommand,
} from '@producer-player/contracts';
import {
  AUDIO_EXTENSIONS,
  ENABLE_AGENT_FEATURES,
  IPC_CHANNELS,
  parsePlaylistOrderExport,
} from '@producer-player/contracts';
import { FileLibraryService } from '@producer-player/domain';
import * as agentService from './agent-service';

const DEFAULT_RENDERER_DEV_URL =
  process.env.RENDERER_DEV_URL ?? 'http://127.0.0.1:4207';
const STATE_FILE_NAME = 'producer-player-electron-state.json';
const SHARED_USER_STATE_FILE_NAME = 'producer-player-shared-user-state.json';
const STATE_DIRECTORY_NAME = 'Producer Player';
const ORDER_SIDECAR_DIRECTORY = '.producer-player';
const ORDER_SIDECAR_FILE = 'order-state.json';
const STATE_DIRECTORY_SYMLINK_NAME = 'state';
const PLAYBACK_PROTOCOL = 'producer-media';
const PLAYBACK_PROTOCOL_HOST = 'file';
const PLAYBACK_CACHE_DIRECTORY = 'playback-cache';
const FFMPEG_BINARY_DIRECTORY = 'bin';
const AIFF_LIKE_EXTENSIONS = new Set(['aiff', 'aif', 'aifc']);
const IS_MAC_APP_STORE_SANDBOX = process.mas === true;

const ICLOUD_DRIVE_DIRECTORY_NAME = 'Producer Player';
const ICLOUD_CHECKLISTS_FILE = 'checklists.json';
const ICLOUD_RATINGS_FILE = 'ratings.json';
const ICLOUD_PROJECT_FILE_PATHS_FILE = 'project-file-paths.json';
const ICLOUD_STATE_FILE = 'state.json';

const IS_TEST_MODE =
  process.env.APP_TEST_MODE === 'true' ||
  Boolean(process.env.PRODUCER_PLAYER_TEST_ID);
const TEST_WINDOW_MODE = process.env.PRODUCER_PLAYER_E2E_WINDOW_MODE ?? 'foreground';
const SHOULD_SHOW_TEST_WINDOW_INACTIVE = IS_TEST_MODE && TEST_WINDOW_MODE === 'background';
const SHOULD_KEEP_TEST_WINDOW_HIDDEN = IS_TEST_MODE && TEST_WINDOW_MODE === 'hidden';

const TEST_PLAYLIST_EXPORT_PATH = process.env.PRODUCER_PLAYER_E2E_PLAYLIST_EXPORT_PATH ?? null;
const TEST_PLAYLIST_IMPORT_PATH = process.env.PRODUCER_PLAYER_E2E_PLAYLIST_IMPORT_PATH ?? null;
const TEST_LATEST_ORDERED_EXPORT_DIRECTORY =
  process.env.PRODUCER_PLAYER_E2E_LATEST_ORDERED_EXPORT_DIRECTORY ?? null;
const TEST_REFERENCE_IMPORT_PATH =
  process.env.PRODUCER_PLAYER_E2E_REFERENCE_IMPORT_PATH ?? null;
const TEST_PROJECT_FILE_PICK_PATH =
  process.env.PRODUCER_PLAYER_E2E_PROJECT_FILE_PICK_PATH ?? null;
const ANALYSIS_DELAY_MS = Number(process.env.PRODUCER_PLAYER_ANALYSIS_DELAY_MS ?? '0');
const PUBLIC_REPOSITORY_ORIGIN = 'https://github.com';
const PUBLIC_REPOSITORY_PATH = '/EthanSK/producer-player';
const PUBLIC_RELEASES_URL = `${PUBLIC_REPOSITORY_ORIGIN}${PUBLIC_REPOSITORY_PATH}/releases`;
const PUBLIC_RELEASES_LATEST_DOWNLOAD_BASE_URL =
  `${PUBLIC_REPOSITORY_ORIGIN}${PUBLIC_REPOSITORY_PATH}/releases/latest/download`;
const GITHUB_RELEASES_LATEST_API_URL = 'https://api.github.com/repos/EthanSK/producer-player/releases/latest';
const UPDATE_CHECK_TIMEOUT_MS = 12_000;
const AUTO_UPDATE_CHECK_DELAY_MS = 9_000;
const AUTO_UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const AGENT_FEATURES_DISABLED_MESSAGE = 'Agent features are disabled by feature flag.';

/**
 * Trusted external URLs that may be opened from the renderer.
 * Each entry is an { origin, pathPrefix? } pair.
 *   • origin   – must match exactly (scheme + host + port).
 *   • pathPrefix – when provided the URL pathname must equal it or start
 *                  with it followed by '/'. Omit to allow any path under
 *                  the origin.
 *
 * To allow a new external link, just add another entry here.
 */
const TRUSTED_EXTERNAL_URLS: { origin: string; pathPrefix?: string }[] = [
  // GitHub repository (existing)
  { origin: 'https://github.com', pathPrefix: '/EthanSK/producer-player' },
  // GitHub Pages site (title branding link)
  { origin: 'https://ethansk.github.io', pathPrefix: '/producer-player' },
  // Linkfire "by 3000 AD" link
  { origin: 'https://lnkfi.re', pathPrefix: '/3000AD' },
  // YouTube video tutorials linked from help tooltips
  { origin: 'https://www.youtube.com', pathPrefix: '/watch' },
  { origin: 'https://youtube.com', pathPrefix: '/watch' },
  { origin: 'https://youtu.be' },
];
const DEVELOPMENT_WINDOW_ICON_PATH = resolve(__dirname, '../../../assets/icon/png/icon-512.png');

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

interface GithubReleaseAsset {
  name: string;
  browserDownloadUrl: string;
}

interface GithubLatestReleasePayload {
  tagName: string;
  htmlUrl: string;
  name: string | null;
  body: string | null;
  publishedAt: string | null;
  assets: GithubReleaseAsset[];
}

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: Array<number | string>;
}

const UPDATE_CHECK_CACHE_MS = 60_000;

let updateCheckInFlight: Promise<UpdateCheckResult> | null = null;
let latestCachedUpdateCheck: { result: UpdateCheckResult; checkedAtMs: number } | null = null;
let autoUpdateCheckStartupTimeout: NodeJS.Timeout | null = null;
let autoUpdateCheckInterval: NodeJS.Timeout | null = null;
let autoUpdatePromptInFlight = false;
let autoUpdatePromptedTag: string | null = null;

function parseSemverToken(token: string): number | string {
  if (/^\d+$/.test(token)) {
    return Number(token);
  }

  return token;
}

function parseSemver(value: string): ParsedSemver | null {
  const normalized = value.trim().replace(/^v/i, '');
  const matched = normalized.match(
    /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/
  );

  if (!matched) {
    return null;
  }

  const major = Number(matched[1]);
  const minor = Number(matched[2]);
  const patch = Number(matched[3]);

  if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) {
    return null;
  }

  const prerelease =
    matched[4]?.split('.').filter((token) => token.length > 0).map(parseSemverToken) ?? [];

  return {
    major,
    minor,
    patch,
    prerelease,
  };
}

function comparePrereleaseIdentifier(left: number | string, right: number | string): number {
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }

  if (typeof left === 'number') {
    return -1;
  }

  if (typeof right === 'number') {
    return 1;
  }

  if (left === right) {
    return 0;
  }

  return left > right ? 1 : -1;
}

function compareSemver(left: ParsedSemver, right: ParsedSemver): number {
  if (left.major !== right.major) {
    return left.major - right.major;
  }

  if (left.minor !== right.minor) {
    return left.minor - right.minor;
  }

  if (left.patch !== right.patch) {
    return left.patch - right.patch;
  }

  const leftHasPrerelease = left.prerelease.length > 0;
  const rightHasPrerelease = right.prerelease.length > 0;

  if (!leftHasPrerelease && !rightHasPrerelease) {
    return 0;
  }

  if (!leftHasPrerelease) {
    return 1;
  }

  if (!rightHasPrerelease) {
    return -1;
  }

  const maxLength = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftToken = left.prerelease[index];
    const rightToken = right.prerelease[index];

    if (leftToken === undefined) {
      return -1;
    }

    if (rightToken === undefined) {
      return 1;
    }

    const tokenDelta = comparePrereleaseIdentifier(leftToken, rightToken);
    if (tokenDelta !== 0) {
      return tokenDelta;
    }
  }

  return 0;
}

function toComparableVersion(value: string): ParsedSemver | null {
  return parseSemver(value);
}

function getStableDownloadAssetName(
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture
): string | null {
  if (platform === 'darwin') {
    return 'Producer-Player-latest-mac-universal.zip';
  }

  if (platform === 'linux' && arch === 'x64') {
    return 'Producer-Player-latest-linux-x64.zip';
  }

  if (platform === 'win32' && arch === 'x64') {
    return 'Producer-Player-latest-win-x64.zip';
  }

  return null;
}

function getStableDownloadUrlForCurrentPlatform(): string | null {
  const assetName = getStableDownloadAssetName(process.platform, process.arch);
  if (!assetName) {
    return null;
  }

  return `${PUBLIC_RELEASES_LATEST_DOWNLOAD_BASE_URL}/${assetName}`;
}

function getReleaseAssetNameCandidatesForCurrentPlatform(): string[] {
  const stableAssetName = getStableDownloadAssetName(process.platform, process.arch);
  const candidates = stableAssetName ? [stableAssetName] : [];

  if (process.platform === 'darwin') {
    candidates.push(
      'Producer-Player-latest-mac-arm64.zip',
      'Producer-Player-latest-mac-x64.zip'
    );
    return candidates;
  }

  if (process.platform === 'linux' && process.arch === 'x64') {
    return candidates;
  }

  if (process.platform === 'win32' && process.arch === 'x64') {
    return candidates;
  }

  return candidates;
}

function parseGithubLatestReleasePayload(payload: unknown): GithubLatestReleasePayload {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('GitHub release payload is not an object.');
  }

  const candidate = payload as {
    tag_name?: unknown;
    html_url?: unknown;
    name?: unknown;
    body?: unknown;
    published_at?: unknown;
    assets?: unknown;
  };

  if (typeof candidate.tag_name !== 'string' || candidate.tag_name.trim().length === 0) {
    throw new Error('GitHub release payload is missing tag_name.');
  }

  if (typeof candidate.html_url !== 'string' || candidate.html_url.trim().length === 0) {
    throw new Error('GitHub release payload is missing html_url.');
  }

  const assetsRaw = Array.isArray(candidate.assets) ? candidate.assets : [];
  const assets: GithubReleaseAsset[] = assetsRaw.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return [];
    }

    const asset = entry as { name?: unknown; browser_download_url?: unknown };
    if (
      typeof asset.name !== 'string' ||
      asset.name.length === 0 ||
      typeof asset.browser_download_url !== 'string' ||
      asset.browser_download_url.length === 0
    ) {
      return [];
    }

    return [
      {
        name: asset.name,
        browserDownloadUrl: asset.browser_download_url,
      },
    ];
  });

  return {
    tagName: candidate.tag_name,
    htmlUrl: candidate.html_url,
    name: typeof candidate.name === 'string' ? candidate.name : null,
    body: typeof candidate.body === 'string' ? candidate.body : null,
    publishedAt: typeof candidate.published_at === 'string' ? candidate.published_at : null,
    assets,
  };
}

async function fetchLatestGithubRelease(): Promise<GithubLatestReleasePayload> {
  const response = await fetch(GITHUB_RELEASES_LATEST_API_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Producer-Player-Update-Checker',
    },
    signal: AbortSignal.timeout(UPDATE_CHECK_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`GitHub API request failed (${response.status} ${response.statusText}).`);
  }

  const payload = (await response.json()) as unknown;
  return parseGithubLatestReleasePayload(payload);
}

function resolveReleaseDownloadUrl(release: GithubLatestReleasePayload): string | null {
  const candidateAssetNames = getReleaseAssetNameCandidatesForCurrentPlatform();

  for (const assetName of candidateAssetNames) {
    const matchedAsset = release.assets.find((asset) => asset.name === assetName);
    if (matchedAsset) {
      return matchedAsset.browserDownloadUrl;
    }
  }

  if (process.platform === 'darwin') {
    const macVersionedAsset = release.assets.find((asset) =>
      /Producer-Player-.*-mac-(?:universal|arm64|x64)\.zip$/i.test(asset.name)
    );

    if (macVersionedAsset) {
      return macVersionedAsset.browserDownloadUrl;
    }
  }

  if (process.platform === 'linux' && process.arch === 'x64') {
    const linuxVersionedAsset = release.assets.find((asset) =>
      /Producer-Player-.*-linux-x64\.zip$/i.test(asset.name)
    );

    if (linuxVersionedAsset) {
      return linuxVersionedAsset.browserDownloadUrl;
    }
  }

  if (process.platform === 'win32' && process.arch === 'x64') {
    const windowsVersionedAsset = release.assets.find((asset) =>
      /Producer-Player-.*-win-x64\.zip$/i.test(asset.name)
    );

    if (windowsVersionedAsset) {
      return windowsVersionedAsset.browserDownloadUrl;
    }
  }

  return getStableDownloadUrlForCurrentPlatform();
}

function buildUpdateResultMessage(result: {
  status: UpdateCheckResult['status'];
  currentVersion: string;
  latestVersion: string | null;
  downloadUrl: string | null;
}): string {
  if (result.status === 'error') {
    return 'Could not check for updates right now.';
  }

  if (result.status === 'up-to-date') {
    return `You’re already on the latest version (${result.currentVersion}).`;
  }

  if (result.downloadUrl) {
    return `Version ${result.latestVersion ?? 'latest'} is available.`;
  }

  return `Version ${result.latestVersion ?? 'latest'} is available, but no direct download was resolved for this platform.`;
}

async function checkForUpdates(options: { force?: boolean } = {}): Promise<UpdateCheckResult> {
  const force = options.force === true;
  const now = Date.now();

  if (!force && latestCachedUpdateCheck && now - latestCachedUpdateCheck.checkedAtMs < UPDATE_CHECK_CACHE_MS) {
    return latestCachedUpdateCheck.result;
  }

  if (!force && updateCheckInFlight) {
    return updateCheckInFlight;
  }

  const currentVersion = app.getVersion();

  const runCheck = async (): Promise<UpdateCheckResult> => {
    try {
      const release = await fetchLatestGithubRelease();
      const latestVersion = release.tagName.replace(/^v/i, '').trim();

      const currentComparable = toComparableVersion(currentVersion);
      const latestComparable = toComparableVersion(latestVersion);

      if (!currentComparable || !latestComparable) {
        throw new Error(
          `Version comparison failed (current="${currentVersion}", latest="${latestVersion}").`
        );
      }

      const versionDelta = compareSemver(latestComparable, currentComparable);
      const status: UpdateCheckResult['status'] =
        versionDelta > 0 ? 'update-available' : 'up-to-date';
      const downloadUrl = resolveReleaseDownloadUrl(release);

      const result: UpdateCheckResult = {
        status,
        currentVersion,
        latestVersion,
        latestTag: release.tagName,
        releaseUrl: release.htmlUrl,
        downloadUrl,
        releaseName: release.name,
        publishedAt: release.publishedAt,
        notes: release.body,
        message: buildUpdateResultMessage({
          status,
          currentVersion,
          latestVersion,
          downloadUrl,
        }),
      };

      latestCachedUpdateCheck = {
        result,
        checkedAtMs: Date.now(),
      };

      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const result: UpdateCheckResult = {
        status: 'error',
        currentVersion,
        latestVersion: null,
        latestTag: null,
        releaseUrl: PUBLIC_RELEASES_URL,
        downloadUrl: getStableDownloadUrlForCurrentPlatform(),
        releaseName: null,
        publishedAt: null,
        notes: null,
        message,
      };

      latestCachedUpdateCheck = {
        result,
        checkedAtMs: Date.now(),
      };

      return result;
    }
  };

  if (force) {
    return runCheck();
  }

  updateCheckInFlight = runCheck().finally(() => {
    updateCheckInFlight = null;
  });

  return updateCheckInFlight;
}

async function openUpdateDownloadUrl(url: string | null | undefined): Promise<void> {
  const candidate =
    typeof url === 'string' && url.trim().length > 0
      ? url.trim()
      : getStableDownloadUrlForCurrentPlatform() ?? PUBLIC_RELEASES_URL;

  const trustedUrl = parseTrustedExternalUrl(candidate);
  await shell.openExternal(trustedUrl.toString());
}

async function maybePromptForAvailableUpdate(): Promise<void> {
  if (!app.isPackaged || IS_TEST_MODE) {
    return;
  }

  if (autoUpdatePromptInFlight) {
    return;
  }

  autoUpdatePromptInFlight = true;

  try {
    const result = await checkForUpdates();
    if (result.status !== 'update-available') {
      return;
    }

    const updateIdentity = result.latestTag ?? result.latestVersion;
    if (!updateIdentity) {
      return;
    }

    if (autoUpdatePromptedTag === updateIdentity) {
      return;
    }

    autoUpdatePromptedTag = updateIdentity;

    const messageBoxOptions = {
      type: 'info' as const,
      title: 'Update available',
      message: `Producer Player ${result.latestVersion ?? 'latest'} is available.`,
      detail: `Current version: ${result.currentVersion}\n\nDownload the update to install it manually.`,
      buttons: [result.downloadUrl ? 'Download update' : 'View release', 'Later'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    };

    const response =
      mainWindow && !mainWindow.isDestroyed()
        ? await dialog.showMessageBox(mainWindow, messageBoxOptions)
        : await dialog.showMessageBox(messageBoxOptions);

    if (response.response === 0) {
      await openUpdateDownloadUrl(result.downloadUrl ?? result.releaseUrl);
    }
  } catch (error: unknown) {
    console.warn('[producer-player:update] automatic update check failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    autoUpdatePromptInFlight = false;
  }
}

function clearAutomaticUpdateChecks(): void {
  if (autoUpdateCheckStartupTimeout) {
    clearTimeout(autoUpdateCheckStartupTimeout);
    autoUpdateCheckStartupTimeout = null;
  }

  if (autoUpdateCheckInterval) {
    clearInterval(autoUpdateCheckInterval);
    autoUpdateCheckInterval = null;
  }
}

function scheduleAutomaticUpdateChecks(): void {
  if (!app.isPackaged || IS_TEST_MODE) {
    return;
  }

  clearAutomaticUpdateChecks();

  autoUpdateCheckStartupTimeout = setTimeout(() => {
    void maybePromptForAvailableUpdate();

    autoUpdateCheckInterval = setInterval(() => {
      void maybePromptForAvailableUpdate();
    }, AUTO_UPDATE_CHECK_INTERVAL_MS);
  }, AUTO_UPDATE_CHECK_DELAY_MS);
}

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

function getSharedUserStateFilePath(): string {
  return join(getStateDirectoryPath(), SHARED_USER_STATE_FILE_NAME);
}

function getFolderOrderSidecarPath(folderPath: string): string {
  return join(folderPath, ORDER_SIDECAR_DIRECTORY, ORDER_SIDECAR_FILE);
}

function getFolderStateDirectorySymlinkPath(folderPath: string): string {
  return join(folderPath, ORDER_SIDECAR_DIRECTORY, STATE_DIRECTORY_SYMLINK_NAME);
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

interface PersistedSharedUserState {
  version: number;
  ratings: Record<string, number>;
  checklists: Record<string, SongChecklistItem[]>;
  projectFilePaths: Record<string, string>;
  updatedAt: string;
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

function createFallbackSharedUserState(): PersistedSharedUserState {
  return {
    version: 1,
    ratings: {},
    checklists: {},
    projectFilePaths: {},
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

function parseSongRatings(value: unknown): Record<string, number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }

  const entries = Object.entries(value).flatMap(([songId, rating]) => {
    if (
      songId.length === 0 ||
      typeof rating !== 'number' ||
      !Number.isFinite(rating) ||
      rating < 1 ||
      rating > 10
    ) {
      return [];
    }

    return [[songId, rating] as const];
  });

  return Object.fromEntries(entries);
}

function parseSongChecklistItems(value: unknown): SongChecklistItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return [];
    }

    const candidate = entry as Partial<SongChecklistItem>;
    if (
      typeof candidate.id !== 'string' ||
      candidate.id.trim().length === 0 ||
      typeof candidate.text !== 'string' ||
      typeof candidate.completed !== 'boolean'
    ) {
      return [];
    }

    const timestampSeconds =
      typeof candidate.timestampSeconds === 'number' &&
      Number.isFinite(candidate.timestampSeconds) &&
      candidate.timestampSeconds >= 0
        ? candidate.timestampSeconds
        : null;
    const versionNumber =
      typeof candidate.versionNumber === 'number' &&
      Number.isFinite(candidate.versionNumber) &&
      candidate.versionNumber >= 1
        ? Math.trunc(candidate.versionNumber)
        : null;

    return [
      {
        id: candidate.id,
        text: candidate.text,
        completed: candidate.completed,
        timestampSeconds,
        versionNumber,
      },
    ];
  });
}

function parseSongChecklists(value: unknown): Record<string, SongChecklistItem[]> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }

  const entries = Object.entries(value).flatMap(([songId, items]) => {
    if (songId.length === 0) {
      return [];
    }

    return [[songId, parseSongChecklistItems(items)] as const];
  });

  return Object.fromEntries(entries);
}

function parseSongProjectFilePaths(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }

  const entries = Object.entries(value).flatMap(([songId, projectFilePath]) => {
    const normalizedPath =
      typeof projectFilePath === 'string' ? projectFilePath.trim() : '';

    if (songId.length === 0 || normalizedPath.length === 0) {
      return [];
    }

    return [[songId, normalizedPath] as const];
  });

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

const TRACK_ORDER_PREFIX_PATTERN = /^\s*\d{1,4}\s*(?:[-_.):\]]\s*)+/;

interface LatestOrderedExportEntry {
  sourcePath: string;
  outputFileName: string;
  songTitle: string;
}

function slugifyFileSegment(value: string): string {
  const slug = value
    .replace(/[^a-z0-9-_]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();

  return slug.length > 0 ? slug : 'playlist';
}

function formatFileSystemTimestamp(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function sortSongVersionsByRecency(versions: SongVersion[]): SongVersion[] {
  return [...versions].sort((left, right) => {
    const modifiedAtDelta =
      new Date(right.modifiedAt).getTime() - new Date(left.modifiedAt).getTime();

    if (modifiedAtDelta !== 0) {
      return modifiedAtDelta;
    }

    return left.filePath.localeCompare(right.filePath);
  });
}

function getNewestRelevantSongVersion(song: SongWithVersions): SongVersion | null {
  if (song.activeVersionId) {
    const activeVersion = song.versions.find((version) => version.id === song.activeVersionId);
    if (activeVersion) {
      return activeVersion;
    }
  }

  return sortSongVersionsByRecency(song.versions)[0] ?? null;
}

function stripLeadingTrackOrderPrefix(stem: string): string {
  const stripped = stem.replace(TRACK_ORDER_PREFIX_PATTERN, '');
  return stripped.length > 0 ? stripped : stem;
}

function buildOrderedTrackExportFileName(
  originalFileName: string,
  trackNumber: number,
  totalTrackCount: number
): string {
  const parsed = parse(originalFileName);
  const stemWithoutPrefix = stripLeadingTrackOrderPrefix(parsed.name);
  const safeStem = stemWithoutPrefix.length > 0 ? stemWithoutPrefix : parsed.name || 'Track';
  const prefixWidth = Math.max(2, String(totalTrackCount).length);
  const trackPrefix = String(trackNumber).padStart(prefixWidth, '0');

  return `${trackPrefix} - ${safeStem}${parsed.ext}`;
}

function buildLatestOrderedExportFolderName(
  selectedFolderName: string | null | undefined
): string {
  const folderSlug = selectedFolderName ? slugifyFileSegment(selectedFolderName) : 'playlist';
  const timestamp = formatFileSystemTimestamp(new Date());

  return `producer-player-${folderSlug}-latest-ordered-${timestamp}`;
}

function buildLatestOrderedExportEntries(
  payload: PlaylistOrderExportV1
): LatestOrderedExportEntry[] {
  const songsById = new Map(payload.songs.map((song) => [song.id, song]));

  const orderedSongs = dedupeStrings(payload.ordering.songIds)
    .map((songId) => songsById.get(songId) ?? null)
    .filter((song): song is SongWithVersions => Boolean(song));

  if (orderedSongs.length === 0) {
    throw new Error('Nothing to export yet (no tracks in the current album view).');
  }

  return orderedSongs.map((song, index) => {
    const latestVersion = getNewestRelevantSongVersion(song);
    if (!latestVersion) {
      throw new Error(`Could not resolve a latest version for "${song.title}".`);
    }

    return {
      sourcePath: resolve(latestVersion.filePath),
      outputFileName: buildOrderedTrackExportFileName(
        latestVersion.fileName,
        index + 1,
        orderedSongs.length
      ),
      songTitle: song.title,
    };
  });
}

async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveUniqueDirectoryPath(baseDirectoryPath: string): Promise<string> {
  if (!(await pathExists(baseDirectoryPath))) {
    return baseDirectoryPath;
  }

  let counter = 2;
  let candidate = `${baseDirectoryPath}-${counter}`;

  while (await pathExists(candidate)) {
    counter += 1;
    candidate = `${baseDirectoryPath}-${counter}`;
  }

  return candidate;
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

function parsePersistedSharedUserState(raw: string): PersistedSharedUserState {
  const fallback = createFallbackSharedUserState();
  const parsed = JSON.parse(raw) as Partial<PersistedSharedUserState>;

  return {
    version: typeof parsed.version === 'number' ? parsed.version : fallback.version,
    ratings: parseSongRatings(parsed.ratings),
    checklists: parseSongChecklists(parsed.checklists),
    projectFilePaths: parseSongProjectFilePaths(parsed.projectFilePaths),
    updatedAt:
      typeof parsed.updatedAt === 'string' && parsed.updatedAt.length > 0
        ? parsed.updatedAt
        : fallback.updatedAt,
  };
}

async function readPersistedSharedUserState(): Promise<PersistedSharedUserState> {
  const sharedUserStatePath = getSharedUserStateFilePath();

  try {
    const raw = await fs.readFile(sharedUserStatePath, 'utf8');
    return parsePersistedSharedUserState(raw);
  } catch {
    return createFallbackSharedUserState();
  }
}

async function writePersistedSharedUserState(
  payload: Omit<SharedUserState, 'updatedAt'>
): Promise<PersistedSharedUserState> {
  const nextState: PersistedSharedUserState = {
    version: 1,
    ratings: parseSongRatings(payload.ratings),
    checklists: parseSongChecklists(payload.checklists),
    projectFilePaths: parseSongProjectFilePaths(payload.projectFilePaths),
    updatedAt: new Date().toISOString(),
  };

  await writeJsonAtomic(getSharedUserStateFilePath(), nextState);
  return nextState;
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

async function ensureFolderStateDirectorySymlink(folderPath: string): Promise<void> {
  const symlinkPath = getFolderStateDirectorySymlinkPath(folderPath);
  const targetPath = resolve(getStateDirectoryPath());

  try {
    await fs.mkdir(dirname(symlinkPath), { recursive: true });

    try {
      const existing = await fs.lstat(symlinkPath);

      if (!existing.isSymbolicLink()) {
        return;
      }

      const existingTarget = await fs.readlink(symlinkPath);
      const resolvedExistingTarget = resolve(dirname(symlinkPath), existingTarget);

      if (resolvedExistingTarget === targetPath) {
        return;
      }

      await fs.rm(symlinkPath, { force: true });
    } catch (error: unknown) {
      const code =
        typeof error === 'object' && error && 'code' in error
          ? String((error as { code?: unknown }).code)
          : null;

      if (code !== 'ENOENT') {
        throw error;
      }
    }

    await fs.symlink(targetPath, symlinkPath, process.platform === 'win32' ? 'junction' : 'dir');
  } catch {
    // Keep canonical storage untouched even if sidecar symlink creation fails.
  }
}

async function writeFolderOrderSidecars(snapshot: LibrarySnapshot): Promise<void> {
  await Promise.all(
    snapshot.linkedFolders.map(async (folder) => {
      const sidecarPath = getFolderOrderSidecarPath(folder.path);
      const payload = buildFolderOrderSidecar(snapshot, folder.id, folder.path);

      await Promise.all([
        writeJsonAtomic(sidecarPath, payload).catch(() => undefined),
        ensureFolderStateDirectorySymlink(folder.path),
      ]);
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
  const ffprobeCommand = getBinaryCommandPath('ffprobe');

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

  const [volumedetectResult, probedSampleRateHz] = await Promise.all([
    runProcessCapture(ffmpegCommand, [
      '-hide_banner',
      '-nostats',
      '-i',
      resolvedPath,
      '-af',
      'volumedetect',
      '-f',
      'null',
      '-',
    ]),
    (async () => {
      try {
        const probeResult = await runProcessCapture(ffprobeCommand, [
          '-v',
          'error',
          '-select_streams',
          'a:0',
          '-show_entries',
          'stream=sample_rate',
          '-of',
          'default=noprint_wrappers=1:nokey=1',
          resolvedPath,
        ]);

        return parseInteger(probeResult.stdout.trim());
      } catch {
        return null;
      }
    })(),
  ]);

  const sampleRateHz =
    probedSampleRateHz ??
    parseSampleRateHzFromDiagnostics(ebur128Result.stderr) ??
    parseSampleRateHzFromDiagnostics(volumedetectResult.stderr);

  const integratedMatches = Array.from(
    ebur128Result.stderr.matchAll(/\bI:\s*(-?\d+(?:\.\d+)?|-?inf)\s+LUFS/gi)
  );
  const lraMatches = Array.from(
    ebur128Result.stderr.matchAll(/\bLRA:\s*(-?\d+(?:\.\d+)?|-?inf)\s+LU/gi)
  );
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
    integratedLufs: parseMeasuredLevel(
      integratedMatches.length > 0 ? integratedMatches[integratedMatches.length - 1][1] : undefined
    ),
    loudnessRangeLufs: parseMeasuredLevel(
      lraMatches.length > 0 ? lraMatches[lraMatches.length - 1][1] : undefined
    ),
    truePeakDbfs: parseMeasuredLevel(truePeakMatch?.[1]),
    samplePeakDbfs: parseMeasuredLevel(samplePeakMatch?.[1]),
    meanVolumeDbfs: parseMeasuredLevel(meanVolumeMatch?.[1]),
    maxMomentaryLufs:
      momentaryMatches.length > 0 ? Math.max(...momentaryMatches) : null,
    maxShortTermLufs:
      shortTermMatches.length > 0 ? Math.max(...shortTermMatches) : null,
    sampleRateHz,
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

async function pickProjectFile(initialPath?: string | null): Promise<ProjectFileSelection | null> {
  const testSelectionPath = TEST_PROJECT_FILE_PICK_PATH;

  let selectedPath: string | undefined;

  if (testSelectionPath) {
    selectedPath = resolve(testSelectionPath);
  } else {
    const dialogOptions: OpenDialogOptions = {
      title: 'Choose project file',
      properties: ['openFile'],
    };

    if (typeof initialPath === 'string' && initialPath.trim().length > 0) {
      dialogOptions.defaultPath = resolve(initialPath);
    }

    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);

    selectedPath = result.filePaths[0];
  }

  if (!selectedPath) {
    return null;
  }

  return {
    filePath: selectedPath,
    fileName: basename(selectedPath),
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

type PlaybackTranscodeCodec =
  | 'pcm_s16le'
  | 'pcm_s24le'
  | 'pcm_s32le'
  | 'pcm_f32le'
  | 'pcm_f64le';

interface PlaybackProbeStream {
  codec_name?: unknown;
  sample_fmt?: unknown;
  bits_per_raw_sample?: unknown;
  bits_per_sample?: unknown;
}

function parseInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }

  return null;
}

function parseSampleRateHzFromDiagnostics(diagnostics: string): number | null {
  if (diagnostics.trim().length === 0) {
    return null;
  }

  const streamMatches = Array.from(
    diagnostics.matchAll(
      /Stream #\d+:\d+(?:\[[^\]]+\])?(?:\([^\)]*\))?: Audio:[^\n]*?(\d{4,6})\s*Hz/gi
    )
  );

  if (streamMatches.length > 0) {
    const parsed = parseInteger(streamMatches[0]?.[1]);
    if (parsed !== null) {
      return parsed;
    }
  }

  const genericMatches = Array.from(diagnostics.matchAll(/\b(\d{4,6})\s*Hz\b/gi));
  if (genericMatches.length > 0) {
    const parsed = parseInteger(genericMatches[0]?.[1]);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

function choosePlaybackTranscodeCodec(input: {
  codecName: string | null;
  sampleFormat: string | null;
  bitDepth: number | null;
}): PlaybackTranscodeCodec {
  const codecName = input.codecName?.toLowerCase() ?? '';
  const sampleFormat = input.sampleFormat?.toLowerCase().replace(/p$/, '') ?? '';

  if (sampleFormat === 'dbl') {
    return 'pcm_f64le';
  }

  if (sampleFormat === 'flt') {
    return 'pcm_f32le';
  }

  if (sampleFormat === 's16') {
    return 'pcm_s16le';
  }

  if (sampleFormat === 's32') {
    if (input.bitDepth !== null && input.bitDepth <= 24) {
      return input.bitDepth <= 16 ? 'pcm_s16le' : 'pcm_s24le';
    }

    return 'pcm_s32le';
  }

  if (sampleFormat === 'u8' || sampleFormat === 's8') {
    return 'pcm_s16le';
  }

  if (codecName.includes('pcm_f64')) {
    return 'pcm_f64le';
  }

  if (codecName.includes('pcm_f32')) {
    return 'pcm_f32le';
  }

  if (codecName.includes('pcm_s16') || codecName.includes('pcm_u8') || codecName.includes('pcm_s8')) {
    return 'pcm_s16le';
  }

  if (codecName.includes('pcm_s24')) {
    return 'pcm_s24le';
  }

  if (codecName.includes('pcm_s32')) {
    if (input.bitDepth !== null && input.bitDepth <= 24) {
      return input.bitDepth <= 16 ? 'pcm_s16le' : 'pcm_s24le';
    }

    return 'pcm_s32le';
  }

  if (input.bitDepth !== null) {
    if (input.bitDepth <= 16) {
      return 'pcm_s16le';
    }

    if (input.bitDepth <= 24) {
      return 'pcm_s24le';
    }

    return 'pcm_s32le';
  }

  return 'pcm_s24le';
}

async function resolvePlaybackTranscodeCodec(sourcePath: string): Promise<PlaybackTranscodeCodec> {
  const ffprobeCommand = getBinaryCommandPath('ffprobe');

  try {
    const probeResult = await runProcessCapture(ffprobeCommand, [
      '-v',
      'error',
      '-select_streams',
      'a:0',
      '-show_entries',
      'stream=codec_name,sample_fmt,bits_per_raw_sample,bits_per_sample',
      '-of',
      'json',
      sourcePath,
    ]);

    const parsed = JSON.parse(probeResult.stdout) as { streams?: PlaybackProbeStream[] };
    const stream = Array.isArray(parsed.streams) ? parsed.streams[0] : undefined;

    if (!stream) {
      return 'pcm_s24le';
    }

    const codecName = typeof stream.codec_name === 'string' ? stream.codec_name : null;
    const sampleFormat = typeof stream.sample_fmt === 'string' ? stream.sample_fmt : null;
    const bitDepth =
      parseInteger(stream.bits_per_raw_sample) ?? parseInteger(stream.bits_per_sample);

    return choosePlaybackTranscodeCodec({
      codecName,
      sampleFormat,
      bitDepth,
    });
  } catch (error: unknown) {
    console.warn('[producer-player:playback] could not probe AIFF format; defaulting to pcm_s24le', {
      sourcePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return 'pcm_s24le';
  }
}

async function transcodeAudioForPlayback(
  sourcePath: string,
  outputPath: string
): Promise<void> {
  const ffmpegPath = getBundledFfmpegPath();

  if (!existsSync(ffmpegPath)) {
    throw new Error(`Bundled ffmpeg binary is missing: ${ffmpegPath}`);
  }

  const targetCodec = await resolvePlaybackTranscodeCodec(sourcePath);

  await fs.mkdir(dirname(outputPath), { recursive: true });

  const temporaryOutputPath = `${outputPath}.tmp-${process.pid}-${Date.now()}.wav`;

  try {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const ffmpeg = spawn(
        ffmpegPath,
        [
          '-v',
          'error',
          '-y',
          '-i',
          sourcePath,
          '-vn',
          '-map',
          '0:a:0',
          '-c:a',
          targetCodec,
          temporaryOutputPath,
        ],
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
            `ffmpeg failed while preparing playback for ${sourcePath} (codec ${targetCodec}, exit ${code}): ${stderr.trim()}`
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

/**
 * Validate that a URL matches one of the entries in TRUSTED_EXTERNAL_URLS.
 * Throws if the URL is not in the allowlist — keeps the app secure by
 * requiring every external link to be explicitly approved.
 */
function parseTrustedExternalUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  const isTrusted = TRUSTED_EXTERNAL_URLS.some(({ origin, pathPrefix }) => {
    if (parsed.origin !== origin) return false;
    if (pathPrefix === undefined) return true;
    return (
      parsed.pathname === pathPrefix ||
      parsed.pathname.startsWith(`${pathPrefix}/`)
    );
  });

  if (!isTrusted) {
    throw new Error(
      'This external URL is not in the trusted allowlist. ' +
        'Add it to TRUSTED_EXTERNAL_URLS in main.ts to allow it.'
    );
  }

  return parsed;
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

  const windowIconPath = developmentMode && existsSync(DEVELOPMENT_WINDOW_ICON_PATH)
    ? DEVELOPMENT_WINDOW_ICON_PATH
    : undefined;

  if (process.platform === 'darwin' && windowIconPath && app.dock) {
    app.dock.setIcon(nativeImage.createFromPath(windowIconPath));
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
    ...(IS_TEST_MODE ? { enableLargerThanScreen: true } : {}),
    ...(windowIconPath ? { icon: windowIconPath } : {}),
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      backgroundThrottling: IS_TEST_MODE ? false : true,
    },
    show: IS_TEST_MODE && !SHOULD_SHOW_TEST_WINDOW_INACTIVE && !SHOULD_KEEP_TEST_WINDOW_HIDDEN,
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  mainWindow.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });

  mainWindow.webContents.session.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false)
  );

  // Inject a Content-Security-Policy that allows YouTube thumbnail images to
  // load.  Without this Electron's default restrictive CSP (applied when the
  // renderer is loaded from a file:// or custom-scheme origin) blocks the
  // external <img> requests to img.youtube.com.
  mainWindow.webContents.session.webRequest.onHeadersReceived(
    (details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: file: producer-media:; " +
            "img-src 'self' data: blob: file: producer-media: https://img.youtube.com; " +
            "media-src 'self' data: blob: file: mediastream: producer-media:; " +
            "connect-src 'self' ws: wss: http: https: producer-media:;",
          ],
        },
      });
    },
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
  } else if (SHOULD_SHOW_TEST_WINDOW_INACTIVE) {
    mainWindow.once('ready-to-show', () => {
      mainWindow?.showInactive();
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

  await Promise.all(
    service
      .getSnapshot()
      .linkedFolders
      .map((folder) => ensureFolderStateDirectorySymlink(folder.path))
  );

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

function getICloudDriveBasePath(): string {
  return join(
    app.getPath('home'),
    'Library',
    'Mobile Documents',
    'com~apple~CloudDocs'
  );
}

function getICloudBackupDirectoryPath(): string {
  return join(getICloudDriveBasePath(), ICLOUD_DRIVE_DIRECTORY_NAME);
}

async function checkICloudAvailability(): Promise<ICloudAvailabilityResult> {
  if (process.platform !== 'darwin') {
    return {
      available: false,
      path: null,
      reason: 'iCloud Drive backup is only available on macOS.',
    };
  }

  const iCloudBasePath = getICloudDriveBasePath();

  try {
    const stats = await fs.stat(iCloudBasePath);
    if (!stats.isDirectory()) {
      return {
        available: false,
        path: null,
        reason: 'iCloud Drive path exists but is not a directory.',
      };
    }

    return {
      available: true,
      path: getICloudBackupDirectoryPath(),
    };
  } catch {
    return {
      available: false,
      path: null,
      reason: 'iCloud Drive is not set up on this Mac. Enable it in System Settings \u2192 Apple ID \u2192 iCloud \u2192 iCloud Drive.',
    };
  }
}

async function syncDataToICloud(data: ICloudBackupData): Promise<ICloudSyncResult> {
  const availability = await checkICloudAvailability();
  if (!availability.available || !availability.path) {
    return {
      success: false,
      error: availability.reason ?? 'iCloud Drive is not available.',
    };
  }

  const backupDirectory = availability.path;

  try {
    await fs.mkdir(backupDirectory, { recursive: true });

    await Promise.all([
      writeJsonAtomic(
        join(backupDirectory, ICLOUD_CHECKLISTS_FILE),
        data.checklists
      ),
      writeJsonAtomic(
        join(backupDirectory, ICLOUD_RATINGS_FILE),
        data.ratings
      ),
      writeJsonAtomic(
        join(backupDirectory, ICLOUD_PROJECT_FILE_PATHS_FILE),
        data.projectFilePaths
      ),
      writeJsonAtomic(
        join(backupDirectory, ICLOUD_STATE_FILE),
        data.state
      ),
    ]);

    return { success: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Failed to write iCloud backup: ${message}`,
    };
  }
}

async function loadDataFromICloud(): Promise<ICloudLoadResult> {
  const availability = await checkICloudAvailability();
  if (!availability.available || !availability.path) {
    return {
      available: false,
      data: null,
      error: availability.reason,
    };
  }

  const backupDirectory = availability.path;

  try {
    await fs.access(backupDirectory);
  } catch {
    return {
      available: true,
      data: null,
    };
  }

  try {
    const filePaths = {
      checklists: join(backupDirectory, ICLOUD_CHECKLISTS_FILE),
      ratings: join(backupDirectory, ICLOUD_RATINGS_FILE),
      projectFilePaths: join(backupDirectory, ICLOUD_PROJECT_FILE_PATHS_FILE),
      state: join(backupDirectory, ICLOUD_STATE_FILE),
    };

    let latestModifiedAt: Date | null = null;
    for (const filePath of Object.values(filePaths)) {
      try {
        const stats = await fs.stat(filePath);
        if (!latestModifiedAt || stats.mtime > latestModifiedAt) {
          latestModifiedAt = stats.mtime;
        }
      } catch {
        // File may not exist yet.
      }
    }

    const readJsonSafe = async <T>(filePath: string, fallback: T): Promise<T> => {
      try {
        const raw = await fs.readFile(filePath, 'utf8');
        return JSON.parse(raw) as T;
      } catch {
        return fallback;
      }
    };

    const [checklists, ratings, projectFilePaths, state] = await Promise.all([
      readJsonSafe<Record<string, SongChecklistItem[]>>(filePaths.checklists, {}),
      readJsonSafe<Record<string, number>>(filePaths.ratings, {}),
      readJsonSafe<Record<string, string>>(filePaths.projectFilePaths, {}),
      readJsonSafe<ICloudBackupData['state']>(filePaths.state, {
        iCloudEnabled: true,
        updatedAt: new Date(0).toISOString(),
      }),
    ]);

    return {
      available: true,
      data: {
        checklists: parseSongChecklists(checklists),
        ratings: parseSongRatings(ratings),
        projectFilePaths: parseSongProjectFilePaths(projectFilePaths),
        state,
      },
      iCloudNewerThan: latestModifiedAt ? latestModifiedAt.toISOString() : undefined,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      available: true,
      data: null,
      error: `Failed to read iCloud backup: ${message}`,
    };
  }
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

  ipcMain.handle(
    IPC_CHANNELS.EXPORT_LATEST_VERSIONS_IN_ORDER,
    async (_event, payload: PlaylistOrderExportV1) => {
      const validated = parsePlaylistOrderExport(payload);
      const exportEntries = buildLatestOrderedExportEntries(validated);

      let outputDirectoryPath: string | null = null;

      if (IS_TEST_MODE && TEST_LATEST_ORDERED_EXPORT_DIRECTORY) {
        outputDirectoryPath = resolve(TEST_LATEST_ORDERED_EXPORT_DIRECTORY);
        await fs.rm(outputDirectoryPath, { recursive: true, force: true });
        await fs.mkdir(outputDirectoryPath, { recursive: true });
      } else {
        const dialogOptions: OpenDialogOptions = {
          title: 'Choose export destination folder',
          message:
            'Producer Player will create a new folder with each track\'s latest version in album order.',
          buttonLabel: 'Create latest-version export folder',
          defaultPath: validated.selection.selectedFolderPath
            ? resolve(validated.selection.selectedFolderPath)
            : app.getPath('documents'),
          properties: ['openDirectory', 'createDirectory'],
          securityScopedBookmarks: IS_MAC_APP_STORE_SANDBOX,
        };

        const result = mainWindow
          ? await dialog.showOpenDialog(mainWindow, dialogOptions)
          : await dialog.showOpenDialog(dialogOptions);

        if (result.canceled || result.filePaths.length === 0) {
          return { folderPath: null, exportedCount: 0 };
        }

        const selectedParentDirectory = result.filePaths[0];
        if (!selectedParentDirectory) {
          return { folderPath: null, exportedCount: 0 };
        }

        const resolvedParentDirectory = resolve(selectedParentDirectory);
        const parentStats = await fs.stat(resolvedParentDirectory);
        if (!parentStats.isDirectory()) {
          throw new Error(`Export destination is not a folder: ${resolvedParentDirectory}`);
        }

        const exportFolderName = buildLatestOrderedExportFolderName(
          validated.selection.selectedFolderName
        );

        outputDirectoryPath = await resolveUniqueDirectoryPath(
          join(resolvedParentDirectory, exportFolderName)
        );

        await fs.mkdir(outputDirectoryPath, { recursive: true });
      }

      if (!outputDirectoryPath) {
        throw new Error('Could not determine an export destination.');
      }

      let exportedCount = 0;
      for (const entry of exportEntries) {
        if (!(await pathExists(entry.sourcePath))) {
          throw new Error(
            `Latest version file is missing for "${entry.songTitle}": ${entry.sourcePath}`
          );
        }

        const targetPath = join(outputDirectoryPath, entry.outputFileName);
        await fs.copyFile(entry.sourcePath, targetPath);
        exportedCount += 1;
      }

      const orderingJsonPath = join(outputDirectoryPath, 'producer-player-order.json');
      const orderingPayload = `${JSON.stringify(validated, null, 2)}\n`;
      await fs.writeFile(orderingJsonPath, orderingPayload, 'utf8');

      return { folderPath: outputDirectoryPath, exportedCount };
    }
  );

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

  ipcMain.handle(IPC_CHANNELS.OPEN_FILE, async (_event, filePath: string) => {
    const resolvedPath = resolve(filePath);

    let stats;
    try {
      stats = await fs.stat(resolvedPath);
    } catch {
      throw new Error(`File not accessible: ${resolvedPath}`);
    }

    if (!stats.isFile()) {
      throw new Error(`Path is not a file: ${resolvedPath}`);
    }

    const error = await shell.openPath(resolvedPath);
    if (error) {
      throw new Error(error);
    }
  });

  ipcMain.handle(IPC_CHANNELS.OPEN_EXTERNAL_URL, async (_event, url: string) => {
    const trustedUrl = parseTrustedExternalUrl(url);
    await shell.openExternal(trustedUrl.toString());
  });

  ipcMain.handle(IPC_CHANNELS.COPY_TEXT_TO_CLIPBOARD, async (_event, text: string) => {
    clipboard.writeText(text);
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

  ipcMain.handle(IPC_CHANNELS.PICK_PROJECT_FILE, async (_event, initialPath?: string | null) => {
    return pickProjectFile(initialPath ?? null);
  });

  ipcMain.handle(IPC_CHANNELS.GET_SHARED_USER_STATE, async () => {
    return readPersistedSharedUserState();
  });

  ipcMain.handle(
    IPC_CHANNELS.SET_SHARED_USER_STATE,
    async (_event, state: Omit<SharedUserState, 'updatedAt'>) => {
      return writePersistedSharedUserState(state);
    }
  );

  ipcMain.handle(IPC_CHANNELS.CHECK_ICLOUD_AVAILABLE, async () => {
    return checkICloudAvailability();
  });

  ipcMain.handle(IPC_CHANNELS.SYNC_TO_ICLOUD, async (_event, data: ICloudBackupData) => {
    return syncDataToICloud(data);
  });

  ipcMain.handle(IPC_CHANNELS.LOAD_FROM_ICLOUD, async () => {
    return loadDataFromICloud();
  });

  ipcMain.handle(IPC_CHANNELS.CHECK_FOR_UPDATES, async () => {
    return checkForUpdates({ force: true });
  });

  ipcMain.handle(IPC_CHANNELS.OPEN_UPDATE_DOWNLOAD, async (_event, url?: string | null) => {
    await openUpdateDownloadUrl(url);
  });

  // --- Agent IPC handlers ---

  if (!ENABLE_AGENT_FEATURES) {
    ipcMain.handle(IPC_CHANNELS.AGENT_START_SESSION, async () => {
      throw new Error(AGENT_FEATURES_DISABLED_MESSAGE);
    });

    ipcMain.handle(IPC_CHANNELS.AGENT_SEND_TURN, async () => {
      throw new Error(AGENT_FEATURES_DISABLED_MESSAGE);
    });

    ipcMain.handle(IPC_CHANNELS.AGENT_INTERRUPT, async () => {
      // No-op while the feature is disabled.
    });

    ipcMain.handle(IPC_CHANNELS.AGENT_RESPOND_APPROVAL, async () => {
      throw new Error(AGENT_FEATURES_DISABLED_MESSAGE);
    });

    ipcMain.handle(IPC_CHANNELS.AGENT_DESTROY_SESSION, async () => {
      // No-op while the feature is disabled.
    });

    ipcMain.handle(IPC_CHANNELS.AGENT_CHECK_PROVIDER, async () => {
      return false;
    });

    ipcMain.handle(IPC_CHANNELS.AGENT_STORE_DEEPGRAM_KEY, async () => {
      throw new Error(AGENT_FEATURES_DISABLED_MESSAGE);
    });

    ipcMain.handle(IPC_CHANNELS.AGENT_GET_DEEPGRAM_KEY, async () => {
      return null;
    });

    ipcMain.handle(IPC_CHANNELS.AGENT_CLEAR_DEEPGRAM_KEY, async () => {
      // No-op while the feature is disabled.
    });

    return;
  }

  agentService.setEventCallback((event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.AGENT_EVENT, event);
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.AGENT_START_SESSION,
    async (_event, payload: AgentStartSessionPayload) => {
      agentService.startSession(
        payload.provider,
        payload.mode,
        payload.systemPrompt,
        payload.model,
        payload.thinking,
        payload.history,
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.AGENT_SEND_TURN,
    async (_event, payload: AgentSendTurnPayload) => {
      agentService.sendTurn(payload.message, payload.context, payload.uiContext);
    }
  );

  ipcMain.handle(IPC_CHANNELS.AGENT_INTERRUPT, async () => {
    agentService.interrupt();
  });

  ipcMain.handle(
    IPC_CHANNELS.AGENT_RESPOND_APPROVAL,
    async (_event, payload: AgentRespondApprovalPayload) => {
      agentService.respondToApproval(payload.approvalId, payload.decision);
    }
  );

  ipcMain.handle(IPC_CHANNELS.AGENT_DESTROY_SESSION, async () => {
    agentService.destroySession();
  });

  ipcMain.handle(
    IPC_CHANNELS.AGENT_CHECK_PROVIDER,
    async (_event, provider: AgentProviderId) => {
      return agentService.isProviderAvailable(provider);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.AGENT_STORE_DEEPGRAM_KEY,
    async (_event, key: string) => {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('Encryption is not available on this system.');
      }
      const encrypted = safeStorage.encryptString(key);
      const statePath = join(app.getPath('userData'), 'deepgram-key.enc');
      await fs.writeFile(statePath, encrypted);
    }
  );

  ipcMain.handle(IPC_CHANNELS.AGENT_GET_DEEPGRAM_KEY, async () => {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const statePath = join(app.getPath('userData'), 'deepgram-key.enc');
    try {
      const encrypted = await fs.readFile(statePath);
      return safeStorage.decryptString(encrypted);
    } catch {
      return null;
    }
  });

  ipcMain.handle(IPC_CHANNELS.AGENT_CLEAR_DEEPGRAM_KEY, async () => {
    const statePath = join(app.getPath('userData'), 'deepgram-key.enc');
    try {
      await fs.unlink(statePath);
    } catch {
      // ignore if doesn't exist
    }
  });
}

app.whenReady().then(async () => {
  await registerPlaybackProtocol();

  const service = await ensureLibraryService();
  registerIpcHandlers(service);
  await createMainWindow();
  registerGlobalMediaShortcuts();
  scheduleAutomaticUpdateChecks();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
});

app.on('before-quit', () => {
  globalShortcut.unregisterAll();
  clearAutomaticUpdateChecks();
  releaseAllFolderSecurityScopes();
  agentService.destroySession();

  if (libraryService) {
    void libraryService.dispose();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
