import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Menu, nativeImage, protocol, safeStorage, screen, shell } from 'electron';

// ---------------------------------------------------------------------------
// Obfuscated file storage helpers (replaces safeStorage/keychain for API keys)
// ---------------------------------------------------------------------------
const OBFUSCATION_KEY = 'ProducerPlayerObfuscationKey2026';

function obfuscate(plaintext: string): string {
  const xored = Buffer.from(plaintext).map(
    (byte, i) => byte ^ OBFUSCATION_KEY.charCodeAt(i % OBFUSCATION_KEY.length)
  );
  return Buffer.from(xored).toString('base64');
}

function deobfuscate(encoded: string): string {
  const decoded = Buffer.from(encoded, 'base64');
  const xored = decoded.map(
    (byte, i) => byte ^ OBFUSCATION_KEY.charCodeAt(i % OBFUSCATION_KEY.length)
  );
  return Buffer.from(xored).toString('utf8');
}

/**
 * Migrate a key from the old safeStorage `.enc` format to the new obfuscated
 * `.key` format. Returns silently if the old file doesn't exist or can't be
 * read/decrypted — the user will just need to re-enter the key.
 */
async function migrateEncToKey(baseName: string): Promise<void> {
  const userDataDir = app.getPath('userData');
  const oldPath = join(userDataDir, `${baseName}.enc`);
  const newPath = join(userDataDir, `${baseName}.key`);

  // Only migrate if old file exists and new file doesn't
  if (!existsSync(oldPath) || existsSync(newPath)) return;

  try {
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = await fs.readFile(oldPath);
      const plaintext = safeStorage.decryptString(encrypted);
      if (plaintext) {
        await fs.writeFile(newPath, obfuscate(plaintext), 'utf8');
      }
    }
  } catch {
    // Can't decrypt — that's fine, user re-enters key
  }

  // Clean up old file regardless of success
  try {
    await fs.unlink(oldPath);
  } catch {
    // ignore
  }
}
import type { OpenDialogOptions } from 'electron';
import { createReadStream, existsSync, statSync, promises as fs, readFileSync } from 'node:fs';
import { basename, dirname, extname, join, parse, relative, resolve } from 'node:path';
import { Readable } from 'node:stream';
import log from 'electron-log/main';
import { autoUpdater } from 'electron-updater';
import type {
  AgentAttachment,
  AgentContext,
  AgentProviderId,
  AgentSaveAttachmentPayload,
  AgentStartSessionPayload,
  AgentSendTurnPayload,
  AgentRespondApprovalPayload,
  AiRecommendation,
  AudioFileAnalysis,
  AutoUpdateState,
  MasteringAnalysisCachePayload,
  ICloudAvailabilityResult,
  ICloudBackupData,
  ICloudLoadResult,
  ICloudSyncResult,
  LibrarySnapshot,
  ProducerPlayerUserState,
  SharedUserState,
  SongChecklistItem,
  PlaylistOrderExportV1,
  PlaybackSourceInfo,
  ProducerPlayerAppVersion,
  ProducerPlayerEnvironment,
  ProjectFileSelection,
  ReferenceTrackSelection,
  SongVersion,
  UpdateCheckResult,
  SongWithVersions,
  TrackPluginChain,
  TransportCommand,
  WindowBounds,
} from '@producer-player/contracts';
import {
  AUDIO_EXTENSIONS,
  ENABLE_AGENT_FEATURES,
  IPC_CHANNELS,
  parsePlaylistOrderExport,
} from '@producer-player/contracts';
import { FileLibraryService } from '@producer-player/domain';
import * as agentService from './agent-service';
import {
  UserStateService,
  parseUserState,
  createDefaultUserState,
  UNIFIED_STATE_FILE_NAME,
  migrateStateIfNeeded,
} from './state-service';
import { PluginHostService } from './plugin-host-service';
import { PluginPresetLibraryStore } from './plugin-preset-library';

declare const __PRODUCER_PLAYER_APP_VERSION__: string;
declare const __PRODUCER_PLAYER_BUILD_NUMBER__: string;
declare const __PRODUCER_PLAYER_COMMIT_SHA__: string;

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
const MASTERING_CACHE_DIRECTORY = 'mastering-cache';
const MASTERING_CACHE_FILE_NAME = 'mastering-analysis-cache.v1.json';
const MASTERING_CACHE_SCHEMA_VERSION = 1;
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
// Delay the first update check ~3s after window create so the UI is visible
// before any banner can appear. (Prior 9s was chosen to debounce renderer
// state churn; the debounce is now handled by a latch — see
// `autoUpdateInitialCheckArmed` — so the user-facing delay can shrink.)
const AUTO_UPDATE_CHECK_DELAY_MS = 3_000;
// Re-check every 30 minutes while the app is open. Previously 6h which
// meant a long-running session would only check twice a day; users who
// quit+relaunch rarely (e.g. via Dock) could miss updates for days.
const AUTO_UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;
// Exponential backoff schedule for transient `checkForUpdates` failures.
// Each entry is delay-ms for the NEXT attempt (attempt 1 fires immediately,
// then if it fails we schedule attempt 2 after the first delay, etc.).
const AUTO_UPDATE_RETRY_DELAYS_MS = [10_000, 30_000, 60_000] as const;
const AGENT_FEATURES_DISABLED_MESSAGE = 'Agent features are disabled by feature flag.';

/**
 * Subdirectory inside the OS temp dir used to stage agent-chat file attachments.
 * Dropped files (images, audio, project files, etc.) are copied here so the
 * Claude / Codex CLI subprocess can read them by absolute path.
 *
 * Housekeeping:
 *   - Files are deleted best-effort after the turn they were attached to
 *     completes.
 *   - On each app launch, entries older than ATTACHMENT_MAX_AGE_MS are swept.
 */
const AGENT_ATTACHMENT_DIR_NAME = 'producer-player-agent-attachments';
const AGENT_ATTACHMENT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const AGENT_ATTACHMENT_MAX_BYTES = 200 * 1024 * 1024; // 200 MB per file — generous; keep UI honest

function getAgentAttachmentDir(): string {
  return join(app.getPath('temp'), AGENT_ATTACHMENT_DIR_NAME);
}

function sanitizeAttachmentName(name: string): string {
  const trimmed = (name ?? '').trim();
  const basenameOnly = basename(trimmed || 'attachment');
  // Strip characters that cause filesystem / shell trouble but keep the
  // original extension so agents can infer file type.
  return basenameOnly.replace(/[^A-Za-z0-9._\-]/g, '_').slice(0, 128) || 'attachment';
}

async function ensureAgentAttachmentDir(): Promise<string> {
  const dir = getAgentAttachmentDir();
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function saveAgentAttachment(
  payload: AgentSaveAttachmentPayload,
): Promise<AgentAttachment> {
  const dir = await ensureAgentAttachmentDir();
  const buffer = payload.data instanceof ArrayBuffer
    ? Buffer.from(new Uint8Array(payload.data))
    : Buffer.from(payload.data);

  if (buffer.byteLength > AGENT_ATTACHMENT_MAX_BYTES) {
    throw new Error(
      `Attachment "${payload.name}" exceeds the ${Math.round(AGENT_ATTACHMENT_MAX_BYTES / (1024 * 1024))} MB limit.`,
    );
  }

  const safeName = sanitizeAttachmentName(payload.name);
  const uniquePrefix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const fileName = `${uniquePrefix}-${safeName}`;
  const filePath = join(dir, fileName);

  await fs.writeFile(filePath, buffer);

  return {
    path: filePath,
    name: safeName,
    sizeBytes: buffer.byteLength,
    mimeType: typeof payload.mimeType === 'string' ? payload.mimeType : '',
  };
}

async function clearAgentAttachments(paths: string[]): Promise<void> {
  if (!Array.isArray(paths) || paths.length === 0) return;
  const dir = resolve(getAgentAttachmentDir());
  await Promise.all(
    paths.map(async (candidate) => {
      if (typeof candidate !== 'string' || candidate.length === 0) return;
      // BUG FIX (2026-04-16, 6ae527b): startsWith(dir) could be fooled by a same-prefix directory.
      // Now uses resolve()+relative() for true containment.
      // Found by GPT-5.4 full-codebase audit, 2026-04-16.
      const resolved = resolve(candidate);
      const rel = relative(dir, resolved);
      if (!rel || rel.startsWith('..') || resolve(dir, rel) !== resolved) return;
      try {
        await fs.unlink(resolved);
      } catch {
        // already gone — fine
      }
    }),
  );
}

async function sweepStaleAgentAttachments(): Promise<void> {
  const dir = getAgentAttachmentDir();
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return;
  }
  const cutoff = Date.now() - AGENT_ATTACHMENT_MAX_AGE_MS;
  await Promise.all(
    entries.map(async (entry) => {
      const full = join(dir, entry);
      try {
        const stat = await fs.stat(full);
        if (stat.mtimeMs < cutoff) {
          await fs.unlink(full);
        }
      } catch {
        // ignore
      }
    }),
  );
}

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

// ---------------------------------------------------------------------------
// Logging – electron-log writes to ~/Library/Logs/Producer Player/ on macOS,
// %USERPROFILE%\AppData\Roaming\Producer Player\logs\ on Windows, and
// ~/.config/Producer Player/logs/ on Linux.
// ---------------------------------------------------------------------------
log.transports.file.maxSize = 5 * 1024 * 1024; // 5 MB per file
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}]{scope} {text}';
log.transports.console.format = '[{h}:{i}:{s}.{ms}] [{level}]{scope} {text}';
log.errorHandler.startCatching({
  showDialog: false,
  onError({ error, errorName }) {
    log.error(`[${errorName}]`, error);
  },
});

/** Resolve the directory that contains the log file(s). */
function getLogDirectoryPath(): string {
  const logFilePath = log.transports.file.getFile().path;
  return dirname(logFilePath);
}

/**
 * Log the developer-id / hardened-runtime signature of the installed .app.
 * electron-updater rejects an incoming update whose signing identity differs
 * from the installed copy; this line lets us diagnose that without needing
 * to run codesign manually.
 *
 * Best-effort — if `codesign` is unavailable (Linux runners, MAS sandbox)
 * or the app path can't be resolved, we log what we know and move on.
 */
async function logMacCodeSigningIdentity(): Promise<void> {
  try {
    // `app.getPath('exe')` is .../Contents/MacOS/Producer Player. We want
    // the .app bundle path so `codesign -dv` reports the bundle signature.
    const exePath = app.getPath('exe');
    const appBundle = exePath.replace(/\/Contents\/MacOS\/[^/]+$/, '');
    const output = await new Promise<string>((resolve) => {
      const proc = spawn('codesign', ['-dv', '--verbose=2', appBundle], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let combined = '';
      proc.stdout.on('data', (chunk) => {
        combined += String(chunk);
      });
      proc.stderr.on('data', (chunk) => {
        combined += String(chunk);
      });
      proc.on('error', () => resolve(''));
      proc.on('close', () => resolve(combined));
    });
    if (!output) {
      log.info('[producer-player:auto-update] codesign output empty (not signed or tool missing)');
      return;
    }
    const authorityMatch = output.match(/Authority=([^\n]+)/);
    const teamMatch = output.match(/TeamIdentifier=([^\n]+)/);
    const identifierMatch = output.match(/Identifier=([^\n]+)/);
    log.info('[producer-player:auto-update] code-signing identity', {
      authority: authorityMatch ? authorityMatch[1].trim() : null,
      teamIdentifier: teamMatch ? teamMatch[1].trim() : null,
      identifier: identifierMatch ? identifierMatch[1].trim() : null,
    });
  } catch (error) {
    log.info('[producer-player:auto-update] codesign probe failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

let mainWindow: BrowserWindow | null = null;
let libraryService: FileLibraryService | null = null;
let userStateService: UserStateService | null = null;
// v3.39 Phase 1a — plugin-host sidecar. Lazy: `.start()` is only called the
// first time the renderer asks for a plugin scan, so sessions that never
// touch plugin UI don't pay the spawn cost.
let pluginHostService: PluginHostService | null = null;
let pluginPresetLibrary: PluginPresetLibraryStore | null = null;
let shouldAttemptSidecarOrderRestore = false;
/** Remembers the last directory the user navigated to in any file/folder picker. */
let lastFileDialogDirectory = '';
let playbackProtocolRegistered = false;
/** Paths that buildPlaybackUrl has issued URLs for; the protocol handler
 *  rejects any path not in this set. (GPT-5 audit F4) */
const playbackAllowedPaths = new Set<string>();
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

interface ParsedReleaseVersion {
  semanticVersion: string;
  buildNumber: number | null;
}

function normalizeSemanticVersion(value: string | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().replace(/^v/i, '');
  // Accept both two-part (x.y) and three-part (x.y.z) versions, with optional
  // pre-release and build-metadata suffixes.
  const match = normalized.match(
    /^(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/
  );

  if (!match) {
    return null;
  }

  // Normalize two-part versions to three-part (e.g. "2.38" → "2.38.0").
  const major = match[1];
  const minor = match[2];
  const patch = match[3] ?? '0';
  let result = `${major}.${minor}.${patch}`;
  if (match[4]) {
    result += `-${match[4]}`;
  }
  if (match[5]) {
    result += `+${match[5]}`;
  }
  return result;
}

function readPackageManifestSemanticVersion(): string | null {
  try {
    const packageManifestPath = resolve(__dirname, '../../../package.json');
    const parsed = JSON.parse(readFileSync(packageManifestPath, 'utf8')) as {
      version?: unknown;
    };

    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

function normalizeBuildNumber(value: string | undefined): number | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    return null;
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return Math.trunc(parsed);
}

function normalizeCommitShortSha(value: string | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  if (!/^[0-9a-f]{7,40}$/i.test(normalized)) {
    return null;
  }

  return normalized.slice(0, 12).toLowerCase();
}

function parseReleaseVersion(value: string): ParsedReleaseVersion {
  const normalized = value.trim().replace(/^v/i, '');
  const buildMatch = normalized.match(/^(.*)-build\.(\d+)$/i);

  if (!buildMatch) {
    return {
      semanticVersion: normalized,
      buildNumber: null,
    };
  }

  return {
    semanticVersion: (buildMatch[1] ?? normalized).trim(),
    buildNumber: normalizeBuildNumber(buildMatch[2]),
  };
}

/**
 * Strip trailing `.0` patch from a semver string for user-facing display.
 * e.g. "2.16.0" → "2.16", but "2.16.1" stays as-is.
 */
function toDisplayVersion(semver: string): string {
  const match = semver.match(/^(\d+\.\d+)\.0$/);
  return match ? match[1] : semver;
}

function resolveAppVersionInfo(): ProducerPlayerAppVersion {
  const semanticVersion =
    normalizeSemanticVersion(__PRODUCER_PLAYER_APP_VERSION__) ??
    normalizeSemanticVersion(readPackageManifestSemanticVersion() ?? undefined) ??
    normalizeSemanticVersion(app.getVersion()) ??
    '0.0.0';

  const buildNumber = normalizeBuildNumber(
    (__PRODUCER_PLAYER_BUILD_NUMBER__ ||
      process.env.PRODUCER_PLAYER_BUILD_NUMBER ||
      process.env.GITHUB_RUN_NUMBER) ?? ''
  );

  const commitShortSha = normalizeCommitShortSha(
    (__PRODUCER_PLAYER_COMMIT_SHA__ ||
      process.env.PRODUCER_PLAYER_COMMIT_SHA ||
      process.env.GITHUB_SHA) ?? ''
  );

  // IMPORTANT: displayVersion must be a clean two-part version (e.g., "2.17")
  // with NO build metadata suffix (+build.NNN). Users see this in the sidebar.
  // The build number is only for internal tracking and release artifacts.
  // Build metadata is available separately via buildNumber and commitShortSha.
  const displayVersion = toDisplayVersion(semanticVersion);

  return {
    semanticVersion,
    buildNumber,
    commitShortSha,
    displayVersion,
  };
}

const APP_VERSION_INFO = resolveAppVersionInfo();
const UPDATE_CHECK_CACHE_MS = 60_000;

let updateCheckInFlight: Promise<UpdateCheckResult> | null = null;
let latestCachedUpdateCheck: { result: UpdateCheckResult; checkedAtMs: number } | null = null;
let autoUpdateCheckStartupTimeout: NodeJS.Timeout | null = null;
let autoUpdateCheckInterval: NodeJS.Timeout | null = null;

function parseSemverToken(token: string): number | string {
  if (/^\d+$/.test(token)) {
    return Number(token);
  }

  return token;
}

function parseSemver(value: string): ParsedSemver | null {
  const normalized = value.trim().replace(/^v/i, '');
  const matched = normalized.match(
    /^(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/
  );

  if (!matched) {
    return null;
  }

  const major = Number(matched[1]);
  const minor = Number(matched[2]);
  const patch = matched[3] !== undefined ? Number(matched[3]) : 0;

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

  const currentVersion = APP_VERSION_INFO.displayVersion;
  const currentSemanticVersion = APP_VERSION_INFO.semanticVersion;
  const currentBuildNumber = APP_VERSION_INFO.buildNumber;

  const runCheck = async (): Promise<UpdateCheckResult> => {
    try {
      const release = await fetchLatestGithubRelease();
      const latestVersion = release.tagName.replace(/^v/i, '').trim();
      const latestParsedVersion = parseReleaseVersion(release.tagName);

      const currentComparable = toComparableVersion(currentSemanticVersion);
      const latestComparable = toComparableVersion(latestParsedVersion.semanticVersion);

      if (!currentComparable || !latestComparable) {
        throw new Error(
          `Version comparison failed (current="${currentVersion}", latest="${latestVersion}").`
        );
      }

      const versionDelta = compareSemver(latestComparable, currentComparable);
      let status: UpdateCheckResult['status'];

      if (versionDelta > 0) {
        status = 'update-available';
      } else if (versionDelta < 0) {
        status = 'up-to-date';
      } else {
        const latestBuildNumber = latestParsedVersion.buildNumber;
        const buildDelta =
          latestBuildNumber === null
            ? 0
            : currentBuildNumber === null
              ? latestBuildNumber
              : latestBuildNumber - currentBuildNumber;
        status = buildDelta > 0 ? 'update-available' : 'up-to-date';
      }

      const downloadUrl = resolveReleaseDownloadUrl(release);

      // IMPORTANT: Always use toDisplayVersion() when showing versions to users
      const latestDisplayVersion = toDisplayVersion(latestVersion);

      const result: UpdateCheckResult = {
        status,
        currentVersion,
        latestVersion: latestDisplayVersion,
        latestTag: release.tagName,
        releaseUrl: release.htmlUrl,
        downloadUrl,
        releaseName: release.name,
        publishedAt: release.publishedAt,
        notes: release.body,
        message: buildUpdateResultMessage({
          status,
          currentVersion,
          latestVersion: latestDisplayVersion,
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

// ---------------------------------------------------------------------------
// electron-updater auto-update integration
// ---------------------------------------------------------------------------

let currentAutoUpdateState: AutoUpdateState = {
  status: 'idle',
  version: null,
  progress: null,
  error: null,
  lastCheckedAt: null,
  lastKnownLatestVersion: null,
  nextRetryInMs: null,
  disabledReason: null,
};

// Outstanding retry timer so we don't stack multiple retries. Cleared on any
// successful check, on disable, on manual-check, and on app quit.
let autoUpdateRetryTimeout: ReturnType<typeof setTimeout> | null = null;
let autoUpdateRetryAttempt = 0;

function clearAutoUpdateRetry(): void {
  if (autoUpdateRetryTimeout) {
    clearTimeout(autoUpdateRetryTimeout);
    autoUpdateRetryTimeout = null;
  }
  autoUpdateRetryAttempt = 0;
}

/**
 * Reason the auto-updater can't run in this environment. Surfaced in the
 * persistent Settings footer so silent "no update ever" states are visible.
 */
function getAutoUpdateDisabledReason(): AutoUpdateState['disabledReason'] {
  if (IS_MAC_APP_STORE_SANDBOX) return 'mac-app-store';
  if (IS_TEST_MODE) return 'test-mode';
  if (!app.isPackaged) return 'not-packaged';
  return null;
}

// When true, the next `update-available` event should immediately trigger a
// download. ONLY the background scheduler flips this on — renderer-initiated
// "Check for Updates" clicks leave it false so the check surfaces status
// without downloading anything. The user explicitly kicks off the download
// via the "Download and Install" button.
let shouldAutoDownloadOnNextAvailable = false;

// When true, a successful `update-downloaded` event should immediately call
// `quitAndInstall`. This is flipped on by the renderer-initiated
// `AUTO_UPDATE_DOWNLOAD` IPC so the "Download and Install" button performs
// both actions from a single click.
let installAfterDownload = false;

// BUG FIX (2026-04-16, a992797): configureAutoUpdater() stacked duplicate listeners on every toggle.
// After a few enable/disable cycles, racing `update-downloaded` handlers regressed the state machine.
// Found by GPT-5.4 shadow audit, 2026-04-16.
let autoUpdaterConfigured = false;

// BUG FIX (2026-04-16, 8880480): raw HttpError stack traces were shown to users in the update
// dialog. Now mapped to human-readable strings.
/**
 * Map raw electron-updater errors into short, friendly strings for the UI.
 *
 * electron-updater surfaces low-level HTTP/socket errors (including full
 * stack traces + HTTP header dumps for 404s on `latest-mac.yml`). Those are
 * useless to end users and look scary. We log the raw error elsewhere for
 * debugging; this function only produces the user-facing sentence.
 */
function friendlyUpdateErrorMessage(error: unknown): string {
  const raw =
    error instanceof Error
      ? `${error.message ?? ''}`
      : typeof error === 'string'
        ? error
        : '';
  const text = raw.toLowerCase();

  // 404 / missing release asset. Happens when a release tag exists but the
  // mac build hasn't been uploaded yet (e.g. notarization in progress or a
  // partial publish). Also covers electron-updater's "Cannot find
  // latest-mac.yml in the latest release artifacts" wording.
  if (
    text.includes('cannot find latest') ||
    text.includes('latest-mac.yml') ||
    text.includes('latest.yml') ||
    text.includes('404') ||
    text.includes('not found') ||
    text.includes('notfound')
  ) {
    return 'A new version is being published. Please try again in a few minutes.';
  }

  // Rate limiting / auth-ish responses.
  if (
    text.includes('429') ||
    text.includes('rate limit') ||
    text.includes('rate-limit') ||
    text.includes('403')
  ) {
    return 'Update check is rate-limited. Please try again in a few minutes.';
  }

  // Network connectivity issues.
  if (
    text.includes('enotfound') ||
    text.includes('eai_again') ||
    text.includes('etimedout') ||
    text.includes('econnrefused') ||
    text.includes('econnreset') ||
    text.includes('network') ||
    text.includes('getaddrinfo') ||
    text.includes('offline')
  ) {
    return "Couldn't check for updates. Check your internet connection and try again.";
  }

  return "Couldn't check for updates right now. Please try again later.";
}

function emitAutoUpdateState(state: AutoUpdateState): void {
  // Merge "sticky" fields so transient 'checking' / 'idle' transitions don't
  // wipe the persistent footer line ("Installed vX · Latest vY · Last
  // checked HH:MM:SS"). Callers that want to update these pass them
  // explicitly; everyone else inherits the previous value.
  const merged: AutoUpdateState = {
    ...state,
    lastCheckedAt: state.lastCheckedAt ?? currentAutoUpdateState.lastCheckedAt ?? null,
    lastKnownLatestVersion:
      state.lastKnownLatestVersion ?? currentAutoUpdateState.lastKnownLatestVersion ?? null,
    nextRetryInMs: state.nextRetryInMs ?? null,
    disabledReason: state.disabledReason ?? getAutoUpdateDisabledReason(),
  };
  currentAutoUpdateState = merged;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC_CHANNELS.AUTO_UPDATE_STATE_CHANGED, merged);
  }
}

function configureAutoUpdater(): void {
  // Listener wiring is a one-shot. Every call after the first only re-asserts
  // the simple scalar config (autoDownload/autoInstallOnAppQuit/etc.). We
  // intentionally do NOT re-attach `autoUpdater.on(...)` listeners because
  // electron-updater's EventEmitter keeps old listeners forever; stacking
  // them causes duplicate state transitions and exceeds the default max.
  autoUpdater.logger = log;
  // The background scheduler flips `shouldAutoDownloadOnNextAvailable` before
  // its check, so `update-available` kicks off `downloadUpdate()` itself in
  // that path. Renderer "Check for Updates" clicks never flip the flag — they
  // just report status. We leave the built-in `autoDownload` off so stray
  // checks don't silently start a download without us deciding to.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;

  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'EthanSK',
    repo: 'producer-player',
  });

  if (autoUpdaterConfigured) {
    return;
  }
  autoUpdaterConfigured = true;

  autoUpdater.on('checking-for-update', () => {
    log.info('[producer-player:auto-update] checking for update');
    emitAutoUpdateState({
      status: 'checking',
      version: null,
      progress: null,
      error: null,
    });
  });

  autoUpdater.on('update-available', (info) => {
    log.info('[producer-player:auto-update] update available', { version: info.version });
    // Successful check — cancel any pending retry and reset attempt counter.
    clearAutoUpdateRetry();
    const displayVersion = info.version ? toDisplayVersion(info.version) : null;
    // IMPORTANT: Always use toDisplayVersion() when showing versions to users
    emitAutoUpdateState({
      status: 'available',
      version: displayVersion,
      progress: null,
      error: null,
      lastCheckedAt: new Date().toISOString(),
      lastKnownLatestVersion: displayVersion,
    });

    // The background scheduler flips `shouldAutoDownloadOnNextAvailable`
    // before its check so a found update kicks off `downloadUpdate()` here
    // without user involvement. Renderer "Check for Updates" clicks never
    // flip this flag, so they just surface status to the UI.
    if (shouldAutoDownloadOnNextAvailable) {
      shouldAutoDownloadOnNextAvailable = false;
      void autoUpdater.downloadUpdate().catch((error: unknown) => {
        log.warn('[producer-player:auto-update] background download failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  });

  autoUpdater.on('update-not-available', (info) => {
    log.info('[producer-player:auto-update] no update available', { version: info.version });
    shouldAutoDownloadOnNextAvailable = false;
    // Successful check — cancel any pending retry and reset attempt counter.
    clearAutoUpdateRetry();
    const displayVersion = info.version ? toDisplayVersion(info.version) : null;
    // IMPORTANT: Always use toDisplayVersion() when showing versions to users
    emitAutoUpdateState({
      status: 'not-available',
      version: displayVersion,
      progress: null,
      error: null,
      lastCheckedAt: new Date().toISOString(),
      lastKnownLatestVersion: displayVersion,
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    log.info('[producer-player:auto-update] download progress', {
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total,
    });
    emitAutoUpdateState({
      status: 'downloading',
      version: currentAutoUpdateState.version,
      progress: {
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
      },
      error: null,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    log.info('[producer-player:auto-update] update downloaded', { version: info.version });
    // IMPORTANT: Always use toDisplayVersion() when showing versions to users
    const displayVersion = info.version ? toDisplayVersion(info.version) : null;

    // If the renderer kicked off the download via "Download and Install",
    // quitAndInstall runs automatically so the user doesn't have to click a
    // second button. In that path we skip the 'downloaded' state and go
    // straight to 'installing' to avoid flashing a "download ready" banner
    // right before the app restarts.
    // Background-scheduler downloads leave this flag false — they emit
    // 'downloaded' and rely on `autoInstallOnAppQuit` for the existing
    // "install on next normal quit" behavior.
    if (installAfterDownload) {
      installAfterDownload = false;
      log.info('[producer-player:auto-update] auto-installing downloaded update');
      emitAutoUpdateState({
        status: 'installing',
        version: displayVersion,
        progress: null,
        error: null,
      });
      try {
        autoUpdater.quitAndInstall(false, true);
      } catch (error: unknown) {
        log.warn('[producer-player:auto-update] quitAndInstall failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        emitAutoUpdateState({
          status: 'error',
          version: displayVersion,
          progress: null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    emitAutoUpdateState({
      status: 'downloaded',
      version: displayVersion,
      progress: null,
      error: null,
    });
  });

  autoUpdater.on('error', (error) => {
    // Log the full raw error (stack + message + errno/code if present) so we
    // can still debug from the log file — but never surface this verbatim
    // in the UI.
    const errorRecord = error as Error & { code?: string; errno?: number };
    log.error('[producer-player:auto-update] error', {
      message: errorRecord?.message,
      code: errorRecord?.code ?? null,
      errno: errorRecord?.errno ?? null,
      stack: errorRecord?.stack,
    });
    shouldAutoDownloadOnNextAvailable = false;
    installAfterDownload = false;

    // Schedule a retry with exponential backoff (10s / 30s / 60s). After
    // three failures we stop retrying automatically — the user can still
    // hit "Check for Updates" manually, which resets the attempt counter.
    const nextRetryInMs = scheduleAutoUpdateRetry();

    emitAutoUpdateState({
      status: 'error',
      version: currentAutoUpdateState.version,
      progress: null,
      error: friendlyUpdateErrorMessage(error),
      lastCheckedAt: new Date().toISOString(),
      nextRetryInMs,
    });
  });
}

/**
 * Schedule a retry of `autoUpdater.checkForUpdates()` using the exponential
 * backoff table. Returns the delay until the next attempt in ms, or null if
 * we've exhausted retries for this cycle.
 *
 * The retry counter is reset by (a) any successful check and (b) any
 * manual/IPC "Check for Updates" action, so users can always recover from
 * a transient network burp.
 */
function scheduleAutoUpdateRetry(): number | null {
  if (!app.isPackaged || IS_TEST_MODE || IS_MAC_APP_STORE_SANDBOX) {
    return null;
  }
  if (autoUpdateRetryAttempt >= AUTO_UPDATE_RETRY_DELAYS_MS.length) {
    log.warn(
      '[producer-player:auto-update] retry budget exhausted — giving up until next scheduled check',
    );
    clearAutoUpdateRetry();
    return null;
  }
  const delayMs = AUTO_UPDATE_RETRY_DELAYS_MS[autoUpdateRetryAttempt];
  autoUpdateRetryAttempt += 1;
  if (autoUpdateRetryTimeout) {
    clearTimeout(autoUpdateRetryTimeout);
  }
  log.info('[producer-player:auto-update] scheduling retry', {
    attempt: autoUpdateRetryAttempt,
    delayMs,
  });
  autoUpdateRetryTimeout = setTimeout(() => {
    autoUpdateRetryTimeout = null;
    log.info('[producer-player:auto-update] retry fired', {
      attempt: autoUpdateRetryAttempt,
    });
    void autoUpdater.checkForUpdates().catch((retryError: unknown) => {
      log.warn('[producer-player:auto-update] retry threw', {
        error: retryError instanceof Error ? retryError.message : String(retryError),
      });
      // electron-updater fires the 'error' event for most failures, but a
      // synchronous throw from checkForUpdates itself wouldn't — make
      // sure we still schedule the next retry in that case.
      scheduleAutoUpdateRetry();
    });
  }, delayMs);
  return delayMs;
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

  // BUG FIX (2026-04-16, a992797): disabling auto-updates only cleared timers, not the in-flight
  // download flag — an already-dispatched check would still trigger downloadUpdate().
  // Found by GPT-5.4 shadow audit, 2026-04-16.
  shouldAutoDownloadOnNextAvailable = false;
  clearAutoUpdateRetry();
  // Disabling fully resets the latch so a later re-enable within the same
  // session gets a fresh initial check (rather than having to wait for the
  // first 30-minute periodic tick).
  autoUpdateInitialCheckArmed = false;
}

// Guards the "on launch" check from being reset by renderer-state churn.
// Without this latch, the renderer's debounced state sync could fire
// `AUTO_UPDATE_SET_ENABLED(true)` multiple times within a few seconds of
// launch, and each call re-scheduled the startup timer — pushing the real
// first check past the window where the user inspects the app. With the
// latch, the first scheduled check fires exactly once per launch.
// BUG FIX (2026-04-18): diagnosed from production logs that showed dozens
// of `[producer-player:auto-update] set enabled` lines but ZERO `checking
// for update` lines between app launch and quit, because the startup
// timer was being cleared and re-armed faster than it could fire.
let autoUpdateInitialCheckArmed = false;

function scheduleAutomaticUpdateChecks(): void {
  const disabledReason = getAutoUpdateDisabledReason();
  if (disabledReason) {
    // Loud diagnostic so "why isn't my app updating?" isn't silent. Shows
    // up in ~/Library/Logs/Producer Player/main.log so `tail -f` pinpoints
    // the gate instantly.
    log.info(
      '[producer-player:auto-update] schedule skipped — auto-updater disabled in this environment',
      {
        disabledReason,
        isPackaged: app.isPackaged,
        isTestMode: IS_TEST_MODE,
        isMacAppStoreSandbox: IS_MAC_APP_STORE_SANDBOX,
      },
    );
    // Surface it to the renderer too, so the Settings footer says something
    // honest instead of looking like a silent "everything's fine" state.
    emitAutoUpdateState({
      status: 'idle',
      version: null,
      progress: null,
      error: null,
      disabledReason,
    });
    return;
  }

  configureAutoUpdater();

  // Initial-check latch: only arm the startup timer once per launch. Later
  // calls to this function (e.g. from the renderer's `setAutoUpdateEnabled`
  // IPC re-firing as userState hydrates) fall through to the interval
  // setup without resetting the startup timer.
  if (!autoUpdateCheckStartupTimeout && !autoUpdateInitialCheckArmed) {
    autoUpdateInitialCheckArmed = true;
    log.info('[producer-player:auto-update] scheduling initial check', {
      delayMs: AUTO_UPDATE_CHECK_DELAY_MS,
    });
    autoUpdateCheckStartupTimeout = setTimeout(() => {
      autoUpdateCheckStartupTimeout = null;
      log.info('[producer-player:auto-update] running initial scheduled check');
      shouldAutoDownloadOnNextAvailable = true;
      void autoUpdater.checkForUpdates().catch((error: unknown) => {
        shouldAutoDownloadOnNextAvailable = false;
        log.warn('[producer-player:auto-update] scheduled check threw', {
          error: error instanceof Error ? error.message : String(error),
        });
        // Throws here don't always fire the 'error' event (e.g. synchronous
        // config validation failures) — schedule a retry explicitly.
        scheduleAutoUpdateRetry();
      });
    }, AUTO_UPDATE_CHECK_DELAY_MS);
  }

  // Ensure exactly one interval is running.
  if (!autoUpdateCheckInterval) {
    log.info('[producer-player:auto-update] arming periodic checks', {
      intervalMs: AUTO_UPDATE_CHECK_INTERVAL_MS,
    });
    autoUpdateCheckInterval = setInterval(() => {
      log.info('[producer-player:auto-update] running periodic scheduled check');
      shouldAutoDownloadOnNextAvailable = true;
      void autoUpdater.checkForUpdates().catch((error: unknown) => {
        shouldAutoDownloadOnNextAvailable = false;
        log.warn('[producer-player:auto-update] periodic check threw', {
          error: error instanceof Error ? error.message : String(error),
        });
        scheduleAutoUpdateRetry();
      });
    }, AUTO_UPDATE_CHECK_INTERVAL_MS);
  }
}

// ---------------------------------------------------------------------------
// Interactive (user-initiated) update check via native dialog
// ---------------------------------------------------------------------------

/**
 * User-initiated "Check for Updates" flow. Uses native dialog.showMessageBox
 * for a standard macOS-style update experience.
 */
async function checkForUpdatesInteractive(): Promise<void> {
  const disabledReason = getAutoUpdateDisabledReason();
  if (disabledReason) {
    log.info('[producer-player:auto-update] interactive check skipped', { disabledReason });
    if (mainWindow && !mainWindow.isDestroyed()) {
      await dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Updates Unavailable',
        message:
          disabledReason === 'mac-app-store'
            ? 'Producer Player was installed from the Mac App Store — updates come through the App Store app.'
            : disabledReason === 'not-packaged'
              ? 'Updates require a packaged build. This copy is a development/dev-unpacked run.'
              : 'Updates are not available in test mode.',
        buttons: ['OK'],
      });
    }
    return;
  }

  // Reset retry budget — the user explicitly asked for a check.
  clearAutoUpdateRetry();

  // Show a "checking" dialog isn't needed — the check is fast. Just run it.
  try {
    const result = await autoUpdater.checkForUpdates();
    if (!result || !result.updateInfo) {
      // No update info means we're up to date
      if (mainWindow && !mainWindow.isDestroyed()) {
        await dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'No Updates Available',
          message: "You're up to date!",
          detail: `Producer Player ${APP_VERSION_INFO.displayVersion} is the latest version.`,
          buttons: ['OK'],
        });
      }
      return;
    }

    const updateVersion = result.updateInfo.version
      ? toDisplayVersion(result.updateInfo.version)
      : 'latest';

    // Compare versions to determine if there's actually a newer version
    const currentComparable = toComparableVersion(APP_VERSION_INFO.semanticVersion);
    const latestParsed = parseReleaseVersion(`v${result.updateInfo.version}`);
    const latestComparable = toComparableVersion(latestParsed.semanticVersion);

    if (currentComparable && latestComparable) {
      const delta = compareSemver(latestComparable, currentComparable);
      if (delta <= 0) {
        // Also check build number for same semantic version
        const latestBuildNumber = latestParsed.buildNumber;
        const currentBuildNumber = APP_VERSION_INFO.buildNumber;
        const buildDelta =
          latestBuildNumber === null
            ? 0
            : currentBuildNumber === null
              ? latestBuildNumber
              : latestBuildNumber - currentBuildNumber;

        if (buildDelta <= 0) {
          if (mainWindow && !mainWindow.isDestroyed()) {
            await dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'No Updates Available',
              message: "You're up to date!",
              detail: `Producer Player ${APP_VERSION_INFO.displayVersion} is the latest version.`,
              buttons: ['OK'],
            });
          }
          return;
        }
      }
    }

    // Update available — show the dialog
    if (!mainWindow || mainWindow.isDestroyed()) return;

    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Available',
      message: `Producer Player ${updateVersion} is available`,
      detail: `You are currently on v${APP_VERSION_INFO.displayVersion}. Would you like to download and install the update?`,
      buttons: ['Download and Install', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });

    if (response === 0) {
      // User clicked "Download and Install"
      log.info('[producer-player:auto-update] user accepted interactive update');
      installAfterDownload = true;

      // Show a progress notification
      if (mainWindow && !mainWindow.isDestroyed()) {
        emitAutoUpdateState({
          status: 'downloading',
          version: updateVersion,
          progress: null,
          error: null,
        });
      }

      try {
        await autoUpdater.downloadUpdate();
        // The `update-downloaded` handler will see `installAfterDownload` and
        // automatically call `quitAndInstall`.
      } catch (error: unknown) {
        installAfterDownload = false;
        const rawMessage = error instanceof Error ? error.message : String(error);
        log.warn('[producer-player:auto-update] interactive download failed', {
          error: rawMessage,
          stack: error instanceof Error ? error.stack : undefined,
        });
        if (mainWindow && !mainWindow.isDestroyed()) {
          await dialog.showMessageBox(mainWindow, {
            type: 'error',
            title: 'Update Failed',
            message: friendlyUpdateErrorMessage(error),
            buttons: ['OK'],
          });
        }
      }
    } else {
      log.info('[producer-player:auto-update] user deferred interactive update');
    }
  } catch (error: unknown) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    log.warn('[producer-player:auto-update] interactive check failed', {
      error: rawMessage,
      stack: error instanceof Error ? error.stack : undefined,
    });
    if (mainWindow && !mainWindow.isDestroyed()) {
      await dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'Update Check Failed',
        message: friendlyUpdateErrorMessage(error),
        buttons: ['OK'],
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Application menu with "Check for Updates" item
// ---------------------------------------------------------------------------

function buildApplicationMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name || 'Producer Player',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Check for Updates\u2026',
          click: () => {
            void checkForUpdatesInteractive();
          },
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        // Cmd+R / Cmd+Shift+R reload accelerators are intentionally
        // omitted. Cmd+R is reserved in the renderer as the
        // Mix/Reference A/B toggle (customizable global shortcut —
        // see handleReferenceShortcut in App.tsx). A full page reload
        // would blow away playback, analysis, and unsaved UI state,
        // which was the 2026-04-18 bug report. DevTools (Cmd+Alt+I)
        // still works for developer refreshes, and the main process
        // auto-reloads on dev-mode rebuilds.
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
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
    ['MediaFastForward', 'seek-forward'],
    ['MediaRewind', 'seek-backward'],
  ];

  for (const [accelerator, command] of bindings) {
    try {
      const registered = globalShortcut.register(accelerator, () => {
        emitTransportCommand(command);
      });

      if (!registered) {
        log.warn(`[producer-player:transport] accelerator not available: ${accelerator}`);
      }
    } catch (error: unknown) {
      log.warn(`[producer-player:transport] failed to register ${accelerator}`, {
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
    const listeningDeviceId =
      typeof candidate.listeningDeviceId === 'string' &&
      candidate.listeningDeviceId.trim().length > 0
        ? candidate.listeningDeviceId
        : null;

    return [
      {
        id: candidate.id,
        text: candidate.text,
        completed: candidate.completed,
        timestampSeconds,
        versionNumber,
        listeningDeviceId,
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
    log.warn('[producer-player:sandbox] Failed to start security-scoped access', {
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

  // Also update the unified state with library-managed fields
  if (userStateService) {
    const bookmarks = buildPersistedBookmarksForSnapshot(snapshot);
    void userStateService.patchUserState({
      linkedFolders: snapshot.linkedFolders.map((folder) => ({
        path: resolve(folder.path),
        bookmarkData: bookmarks[resolve(folder.path)] || undefined,
      })),
      songOrder: snapshot.songs.map((song) => song.id),
      autoMoveOld: snapshot.matcherSettings.autoMoveOld,
    }).catch((error: unknown) => {
      log.warn('[producer-player] Failed to sync unified state after snapshot change', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}

function getPlaybackCacheDirectoryPath(): string {
  return join(getStateDirectoryPath(), PLAYBACK_CACHE_DIRECTORY);
}

function getMasteringCacheDirectoryPath(): string {
  return join(getStateDirectoryPath(), MASTERING_CACHE_DIRECTORY);
}

function getMasteringCacheFilePath(): string {
  return join(getMasteringCacheDirectoryPath(), MASTERING_CACHE_FILE_NAME);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseMasteringAnalysisCachePayload(raw: unknown): MasteringAnalysisCachePayload {
  const fallback: MasteringAnalysisCachePayload = {
    schemaVersion: MASTERING_CACHE_SCHEMA_VERSION,
    updatedAt: new Date(0).toISOString(),
    entries: [],
  };

  if (!isRecord(raw)) {
    return fallback;
  }

  const schemaVersion =
    typeof raw.schemaVersion === 'number' && Number.isFinite(raw.schemaVersion)
      ? Math.trunc(raw.schemaVersion)
      : MASTERING_CACHE_SCHEMA_VERSION;

  const updatedAt =
    typeof raw.updatedAt === 'string' && raw.updatedAt.trim().length > 0
      ? raw.updatedAt
      : fallback.updatedAt;

  const entries = Array.isArray(raw.entries) ? raw.entries.filter(isRecord) : [];

  return {
    schemaVersion,
    updatedAt,
    entries: entries as unknown as MasteringAnalysisCachePayload['entries'],
  };
}

async function readMasteringAnalysisCacheState(): Promise<{
  cacheDirectoryPath: string;
  cacheFilePath: string;
  payload: MasteringAnalysisCachePayload;
}> {
  const cacheDirectoryPath = getMasteringCacheDirectoryPath();
  const cacheFilePath = getMasteringCacheFilePath();

  try {
    const raw = await fs.readFile(cacheFilePath, 'utf8');
    const parsed = parseMasteringAnalysisCachePayload(JSON.parse(raw));

    return {
      cacheDirectoryPath,
      cacheFilePath,
      payload:
        parsed.schemaVersion === MASTERING_CACHE_SCHEMA_VERSION
          ? parsed
          : {
              schemaVersion: MASTERING_CACHE_SCHEMA_VERSION,
              updatedAt: parsed.updatedAt,
              entries: [],
            },
    };
  } catch {
    return {
      cacheDirectoryPath,
      cacheFilePath,
      payload: {
        schemaVersion: MASTERING_CACHE_SCHEMA_VERSION,
        updatedAt: new Date(0).toISOString(),
        entries: [],
      },
    };
  }
}

async function writeMasteringAnalysisCacheState(
  payload: MasteringAnalysisCachePayload
): Promise<{
  cacheDirectoryPath: string;
  cacheFilePath: string;
  payload: MasteringAnalysisCachePayload;
}> {
  const cacheDirectoryPath = getMasteringCacheDirectoryPath();
  const cacheFilePath = getMasteringCacheFilePath();
  const normalized: MasteringAnalysisCachePayload = {
    schemaVersion: MASTERING_CACHE_SCHEMA_VERSION,
    updatedAt: payload.updatedAt,
    entries: Array.isArray(payload.entries) ? payload.entries : [],
  };

  await fs.mkdir(cacheDirectoryPath, { recursive: true });
  await writeJsonAtomic(cacheFilePath, normalized);

  return {
    cacheDirectoryPath,
    cacheFilePath,
    payload: normalized,
  };
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

/**
 * Update the in-memory last-used dialog directory and persist it to user state.
 * Accepts a file path or directory path — if a file, its parent directory is used.
 */
function rememberDialogDirectory(selectedPath: string): void {
  try {
    const info = statSync(selectedPath);
    lastFileDialogDirectory = info.isDirectory() ? selectedPath : dirname(selectedPath);
  } catch {
    lastFileDialogDirectory = dirname(selectedPath);
  }
  if (userStateService) {
    void userStateService.patchUserState({ lastFileDialogDirectory });
  }
}

/**
 * Return a `defaultPath` value for a dialog, preferring an explicit path,
 * then falling back to the remembered directory.
 */
function resolveDialogDefaultPath(explicit?: string | null): string | undefined {
  if (typeof explicit === 'string' && explicit.trim().length > 0) {
    return resolve(explicit);
  }
  return lastFileDialogDirectory.length > 0 ? lastFileDialogDirectory : undefined;
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

    const defaultPath = resolveDialogDefaultPath();
    if (defaultPath) dialogOptions.defaultPath = defaultPath;

    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);

    selectedPath = result.filePaths[0];
  }

  if (!selectedPath) {
    return null;
  }

  rememberDialogDirectory(selectedPath);

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

    const defaultPath = resolveDialogDefaultPath(initialPath);
    if (defaultPath) dialogOptions.defaultPath = defaultPath;

    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);

    selectedPath = result.filePaths[0];
  }

  if (!selectedPath) {
    return null;
  }

  rememberDialogDirectory(selectedPath);

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
    log.warn('[producer-player:playback] could not probe AIFF format; defaulting to pcm_s24le', {
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
  const resolved = resolve(filePath);
  playbackAllowedPaths.add(resolved);
  const encodedPath = Buffer.from(resolved, 'utf8').toString('base64url');
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
    log.warn(
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

    // BUG FIX (2026-04-16, 6ae527b): producer-media:// served any base64-encoded path with no
    // validation — arbitrary local file read. Now restricted to paths issued by buildPlaybackUrl.
    // Found by GPT-5.4 full-codebase audit, 2026-04-16.
    if (!playbackAllowedPaths.has(resolvedPath)) {
      return new Response('Forbidden', { status: 403 });
    }

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
    platform: process.platform,
    appVersion: APP_VERSION_INFO,
  };
}

// ---------------------------------------------------------------------------
// Main window bounds persistence
// ---------------------------------------------------------------------------

const DEFAULT_MAIN_WINDOW_WIDTH = 1380;
const DEFAULT_MAIN_WINDOW_HEIGHT = 940;
// Lowered from 1100 → 720 in v3.20 so the app fits onto narrower laptop panes
// and side-by-side layouts. The right-hand inspector collapses into a
// slide-out drawer below the INSPECTOR_DRAWER_BREAKPOINT_PX threshold
// (see apps/renderer/src/styles.css).
const MIN_MAIN_WINDOW_WIDTH = 720;
const MIN_MAIN_WINDOW_HEIGHT = 780;
const WINDOW_BOUNDS_SAVE_DEBOUNCE_MS = 400;
// An on-screen region must be at least this many pixels wide/tall for the
// saved bounds to be considered "still visible" on the given display — stops
// windows that are barely peeking over a display edge from being restored in
// an unreachable position.
const MIN_VISIBLE_AREA_PX = 100;

let windowBoundsSaveTimer: NodeJS.Timeout | null = null;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function rectsIntersectArea(a: Rect, b: Rect): number {
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= left || bottom <= top) return 0;
  return (right - left) * (bottom - top);
}

/**
 * Validate saved window bounds against currently-connected displays.
 *
 * Returns a rect to apply if the bounds still intersect a display by at least
 * `MIN_VISIBLE_AREA_PX` on both axes (clamping the result into that display's
 * workArea so windows dragged partially off-screen come back fully visible),
 * or `null` if the monitor they lived on is no longer connected.
 */
function validateWindowBoundsForCurrentDisplays(bounds: WindowBounds): Rect | null {
  const displays = screen.getAllDisplays();
  if (displays.length === 0) return null;

  const savedRect: Rect = {
    x: bounds.x,
    y: bounds.y,
    width: Math.max(bounds.width, MIN_MAIN_WINDOW_WIDTH),
    height: Math.max(bounds.height, MIN_MAIN_WINDOW_HEIGHT),
  };

  let bestDisplay: Electron.Display | null = null;
  let bestArea = 0;
  for (const display of displays) {
    const area = rectsIntersectArea(savedRect, display.workArea);
    if (area > bestArea) {
      bestArea = area;
      bestDisplay = display;
    }
  }

  if (!bestDisplay) return null;

  // Require a meaningful visible region on at least one display. If the saved
  // window is entirely off-screen (e.g. the second monitor was disconnected),
  // fall back to the centered default.
  const intersectLeft = Math.max(savedRect.x, bestDisplay.workArea.x);
  const intersectRight = Math.min(
    savedRect.x + savedRect.width,
    bestDisplay.workArea.x + bestDisplay.workArea.width,
  );
  const intersectTop = Math.max(savedRect.y, bestDisplay.workArea.y);
  const intersectBottom = Math.min(
    savedRect.y + savedRect.height,
    bestDisplay.workArea.y + bestDisplay.workArea.height,
  );
  const visibleWidth = intersectRight - intersectLeft;
  const visibleHeight = intersectBottom - intersectTop;
  if (visibleWidth < MIN_VISIBLE_AREA_PX || visibleHeight < MIN_VISIBLE_AREA_PX) {
    return null;
  }

  // Clamp into the chosen display's workArea so the window opens fully
  // on-screen, even if the user had dragged it slightly off an edge.
  const workArea = bestDisplay.workArea;
  const clampedWidth = Math.min(savedRect.width, workArea.width);
  const clampedHeight = Math.min(savedRect.height, workArea.height);
  const clampedX = Math.min(
    Math.max(savedRect.x, workArea.x),
    workArea.x + workArea.width - clampedWidth,
  );
  const clampedY = Math.min(
    Math.max(savedRect.y, workArea.y),
    workArea.y + workArea.height - clampedHeight,
  );

  return {
    x: Math.round(clampedX),
    y: Math.round(clampedY),
    width: Math.round(clampedWidth),
    height: Math.round(clampedHeight),
  };
}

function captureWindowBounds(window: BrowserWindow): WindowBounds | null {
  try {
    // `getNormalBounds()` returns the non-maximized bounds so we can restore
    // the correct unmaximized size after the user unmaximizes.
    const normalBounds = window.getNormalBounds();
    return {
      x: Math.round(normalBounds.x),
      y: Math.round(normalBounds.y),
      width: Math.round(normalBounds.width),
      height: Math.round(normalBounds.height),
      isMaximized: window.isMaximized(),
    };
  } catch {
    return null;
  }
}

function scheduleWindowBoundsSave(window: BrowserWindow): void {
  if (!userStateService) return;
  if (IS_TEST_MODE) return;
  if (window.isDestroyed()) return;

  if (windowBoundsSaveTimer) {
    clearTimeout(windowBoundsSaveTimer);
  }
  windowBoundsSaveTimer = setTimeout(() => {
    windowBoundsSaveTimer = null;
    if (window.isDestroyed()) return;
    const bounds = captureWindowBounds(window);
    if (!bounds || !userStateService) return;
    void userStateService.patchUserState({ windowBounds: bounds }).catch((error: unknown) => {
      log.warn('[producer-player] Failed to persist window bounds', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, WINDOW_BOUNDS_SAVE_DEBOUNCE_MS);
}

function saveWindowBoundsImmediately(window: BrowserWindow): void {
  if (!userStateService) return;
  if (IS_TEST_MODE) return;
  if (window.isDestroyed()) return;

  if (windowBoundsSaveTimer) {
    clearTimeout(windowBoundsSaveTimer);
    windowBoundsSaveTimer = null;
  }
  const bounds = captureWindowBounds(window);
  if (!bounds) return;
  void userStateService.patchUserState({ windowBounds: bounds }).catch((error: unknown) => {
    log.warn('[producer-player] Failed to persist window bounds on close', {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

async function loadRestoredWindowBounds(): Promise<{
  bounds: Rect | null;
  shouldMaximize: boolean;
}> {
  if (!userStateService) return { bounds: null, shouldMaximize: false };
  if (IS_TEST_MODE) return { bounds: null, shouldMaximize: false };

  try {
    const state = await userStateService.readUserState();
    const saved = state.windowBounds;
    if (!saved) return { bounds: null, shouldMaximize: false };

    const validated = validateWindowBoundsForCurrentDisplays(saved);
    if (!validated) {
      log.info('[producer-player] Saved window bounds did not intersect any display; using default');
      return { bounds: null, shouldMaximize: saved.isMaximized };
    }

    return { bounds: validated, shouldMaximize: saved.isMaximized };
  } catch (error) {
    log.warn('[producer-player] Failed to load persisted window bounds', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { bounds: null, shouldMaximize: false };
  }
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

  const restored = await loadRestoredWindowBounds();
  const restoredBounds = restored.bounds;
  const shouldRestoreMaximized = restored.shouldMaximize;

  mainWindow = new BrowserWindow({
    title: 'Producer Player',
    width: restoredBounds?.width ?? DEFAULT_MAIN_WINDOW_WIDTH,
    height: restoredBounds?.height ?? DEFAULT_MAIN_WINDOW_HEIGHT,
    ...(restoredBounds ? { x: restoredBounds.x, y: restoredBounds.y } : { center: true }),
    minWidth: MIN_MAIN_WINDOW_WIDTH,
    minHeight: MIN_MAIN_WINDOW_HEIGHT,
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

  // Persist window bounds whenever the user moves, resizes, or toggles
  // maximize state, plus one last synchronous save right before close so the
  // most recent bounds always win the race with app quit.
  if (!IS_TEST_MODE) {
    const persistingWindow = mainWindow;
    const onBoundsChanged = (): void => scheduleWindowBoundsSave(persistingWindow);
    persistingWindow.on('move', onBoundsChanged);
    persistingWindow.on('resize', onBoundsChanged);
    persistingWindow.on('maximize', onBoundsChanged);
    persistingWindow.on('unmaximize', onBoundsChanged);
    persistingWindow.on('close', () => {
      saveWindowBoundsImmediately(persistingWindow);
    });
  }

  if (shouldRestoreMaximized && !IS_TEST_MODE) {
    // Maximize AFTER construction so BrowserWindow has already stored the
    // normal (unmaximized) bounds we passed in above — that way toggling back
    // out of maximize restores to the user's previously-saved size.
    const windowToMaximize = mainWindow;
    windowToMaximize.once('ready-to-show', () => {
      if (!windowToMaximize.isDestroyed()) {
        windowToMaximize.maximize();
      }
    });
  }

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  mainWindow.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });

  mainWindow.webContents.session.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      if (webContents !== mainWindow?.webContents) {
        callback(false);
        return;
      }

      if (permission === 'media') {
        const mediaTypes =
          'mediaTypes' in details && Array.isArray(details.mediaTypes)
            ? details.mediaTypes
            : [];
        const requestsAudio = mediaTypes.includes('audio');
        const requestsVideo = mediaTypes.includes('video');
        callback(requestsAudio && !requestsVideo);
        return;
      }

      callback(false);
    }
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

    const writePromises = [
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
    ];

    // Also back up the unified state file if available
    if (userStateService) {
      try {
        const unifiedState = await userStateService.readUserState();
        writePromises.push(
          writeJsonAtomic(
            join(backupDirectory, UNIFIED_STATE_FILE_NAME),
            unifiedState
          )
        );
      } catch {
        // Non-fatal: the legacy files are still being written
      }
    }

    await Promise.all(writePromises);

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

    // Also attempt to restore the unified state file from iCloud if available
    if (userStateService) {
      const iCloudUnifiedPath = join(backupDirectory, UNIFIED_STATE_FILE_NAME);
      try {
        const iCloudUnifiedRaw = await fs.readFile(iCloudUnifiedPath, 'utf8');
        const iCloudUnifiedParsed = parseUserState(JSON.parse(iCloudUnifiedRaw));
        const localState = await userStateService.readUserState();

        // Only restore if iCloud version is newer
        const iCloudTime = new Date(iCloudUnifiedParsed.updatedAt).getTime();
        const localTime = new Date(localState.updatedAt).getTime();
        if (iCloudTime > localTime) {
          // Window bounds are per-machine — never let an iCloud restore from
          // a different Mac move this machine's window position.
          const preservedBounds: ProducerPlayerUserState = {
            ...iCloudUnifiedParsed,
            windowBounds: localState.windowBounds,
          };
          await userStateService.writeUserState(preservedBounds);
          log.info('[producer-player:icloud] Restored newer unified state from iCloud');

          // Notify renderer of updated state
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(IPC_CHANNELS.USER_STATE_CHANGED, iCloudUnifiedParsed);
          }
        }
      } catch {
        // Unified state not in iCloud yet — that's fine
      }
    }

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

    const defaultPath = resolveDialogDefaultPath();
    if (defaultPath) dialogOptions.defaultPath = defaultPath;

    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);

    if (result.canceled || result.filePaths.length === 0) {
      return service.getSnapshot();
    }

    rememberDialogDirectory(result.filePaths[0]);

    let snapshot = service.getSnapshot();
    for (const [index, selectedPath] of result.filePaths.entries()) {
      const resolvedPath = resolve(selectedPath);
      log.info('Linking folder via dialog', { path: resolvedPath });
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
        log.error('Failed to link folder', { path: resolvedPath, error: error instanceof Error ? error.message : String(error) });
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
    log.info('Unlinking folder', { folderId, path: folder?.path ?? '(unknown)' });
    const snapshot = await service.unlinkFolder(folderId);

    if (folder) {
      releaseFolderSecurityScope(folder.path);
      forgetFolderBookmark(folder.path);
    }

    return snapshot;
  });

  ipcMain.handle(IPC_CHANNELS.RESCAN_LIBRARY, async () => {
    log.info('Rescanning library');
    return service.rescanLibrary();
  });

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

      const saveFileName = `producer-player-${folderSlug}-order.json`;
      const saveDefaultPath = lastFileDialogDirectory.length > 0
        ? join(lastFileDialogDirectory, saveFileName)
        : saveFileName;

      const result = mainWindow
        ? await dialog.showSaveDialog(mainWindow, {
            title: 'Export playlist ordering',
            defaultPath: saveDefaultPath,
            filters: [{ name: 'JSON', extensions: ['json'] }],
          })
        : await dialog.showSaveDialog({
            title: 'Export playlist ordering',
            defaultPath: saveDefaultPath,
            filters: [{ name: 'JSON', extensions: ['json'] }],
          });

      if (result.canceled || !result.filePath) {
        return { filePath: null };
      }

      rememberDialogDirectory(result.filePath);

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

    const importDialogOptions: OpenDialogOptions = {
      title: 'Import playlist ordering',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    };

    const importDefaultPath = resolveDialogDefaultPath();
    if (importDefaultPath) importDialogOptions.defaultPath = importDefaultPath;

    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, importDialogOptions)
      : await dialog.showOpenDialog(importDialogOptions);

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const filePath = result.filePaths[0];
    if (!filePath) {
      return null;
    }

    rememberDialogDirectory(filePath);

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
        const exportDefaultPath = validated.selection.selectedFolderPath
          ? resolve(validated.selection.selectedFolderPath)
          : resolveDialogDefaultPath() ?? app.getPath('documents');

        const dialogOptions: OpenDialogOptions = {
          title: 'Choose export destination folder',
          message:
            'Producer Player will create a new folder with each track\'s latest version in album order.',
          buttonLabel: 'Create latest-version export folder',
          defaultPath: exportDefaultPath,
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

        rememberDialogDirectory(selectedParentDirectory);

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

  ipcMain.handle(IPC_CHANNELS.GET_MASTERING_ANALYSIS_CACHE, async () => {
    return readMasteringAnalysisCacheState();
  });

  ipcMain.handle(
    IPC_CHANNELS.WRITE_MASTERING_ANALYSIS_CACHE,
    async (_event, payload: MasteringAnalysisCachePayload) => {
      return writeMasteringAnalysisCacheState(payload);
    }
  );

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

  // BUG FIX (2026-04-16, 7296920): bc41257 changed these handlers to `void` fire-and-forget,
  // so renderer `await` resolved immediately with undefined — UI never showed update states.
  // Restored direct return so the renderer can drive the in-app update flow.
  ipcMain.handle(IPC_CHANNELS.AUTO_UPDATE_CHECK, async () => {
    const disabledReason = getAutoUpdateDisabledReason();
    if (disabledReason) {
      log.info('[producer-player:auto-update] skipping IPC check', { disabledReason });
      emitAutoUpdateState({
        status: 'idle',
        version: null,
        progress: null,
        error: null,
        disabledReason,
      });
      return;
    }
    // Reset the retry budget so a manual check after three automatic
    // failures gets a fresh 3 attempts at exponential backoff.
    clearAutoUpdateRetry();
    // Ensure the event listeners are wired before firing the check — if
    // this IPC is the first thing to touch the updater (e.g. auto-updates
    // are disabled but the user clicks "Check Now"), `configureAutoUpdater`
    // wouldn't otherwise have run.
    configureAutoUpdater();
    log.info('[producer-player:auto-update] running manual check (IPC)');
    // Renderer-initiated checks do NOT auto-download. They only report status
    // via the AUTO_UPDATE_STATE_CHANGED events so the UI can surface "Update
    // available" and enable the "Download and Install" button. The user then
    // explicitly triggers the download via AUTO_UPDATE_DOWNLOAD.
    await autoUpdater.checkForUpdates();
  });

  ipcMain.handle(IPC_CHANNELS.AUTO_UPDATE_DOWNLOAD, async () => {
    if (!app.isPackaged || IS_TEST_MODE) {
      log.info('[producer-player:auto-update] skipping download (not packaged or test mode)');
      return;
    }
    log.info('[producer-player:auto-update] download requested by renderer');
    // Arm the post-download auto-install. The `update-downloaded` handler
    // sees this and calls `quitAndInstall` automatically so "Download and
    // Install" is a single click from the user's POV.
    installAfterDownload = true;

    // BUG FIX: emit 'downloading' immediately so the renderer hides the
    // "Download and Install" button and shows progress feedback before the
    // first `download-progress` event arrives. Without this the button
    // stayed visible/clickable during the initial download handshake.
    // Found by GPT-5.4 Codex review, 2026-04-16.
    emitAutoUpdateState({
      status: 'downloading',
      version: currentAutoUpdateState.version,
      progress: null,
      error: null,
    });

    try {
      await autoUpdater.downloadUpdate();
    } catch (error: unknown) {
      installAfterDownload = false;
      log.warn('[producer-player:auto-update] renderer download failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  });

  ipcMain.handle(IPC_CHANNELS.AUTO_UPDATE_INSTALL, async () => {
    log.info('[producer-player:auto-update] quit and install requested');
    // BUG FIX: emit 'installing' before quitAndInstall so the renderer
    // reflects the transition instantly (the direct IPC path skipped this,
    // unlike the installAfterDownload path in `update-downloaded`).
    // Found by GPT-5.4 Codex review, 2026-04-16.
    emitAutoUpdateState({
      status: 'installing',
      version: currentAutoUpdateState.version,
      progress: null,
      error: null,
    });
    autoUpdater.quitAndInstall(false, true);
  });

  ipcMain.handle(IPC_CHANNELS.AUTO_UPDATE_SET_ENABLED, async (_event, enabled: boolean) => {
    log.info('[producer-player:auto-update] set enabled', { enabled });
    if (enabled) {
      scheduleAutomaticUpdateChecks();
    } else {
      clearAutomaticUpdateChecks();
    }
  });

  // --- Unified User State IPC handlers ---

  ipcMain.handle(IPC_CHANNELS.GET_USER_STATE, async () => {
    if (!userStateService) throw new Error('User state service not initialized');
    return userStateService.readUserState();
  });

  // BUG FIX (2026-04-16, 6ae527b): renderer's debounced sync sent placeholder values for
  // linkedFolders/songOrder/autoMoveOld — only windowBounds was preserved, wiping library config.
  // Found by GPT-5.4 full-codebase audit, 2026-04-16.
  ipcMain.handle(IPC_CHANNELS.SET_USER_STATE, async (_event, state: ProducerPlayerUserState) => {
    if (!userStateService) throw new Error('User state service not initialized');
    // Several fields are authoritatively owned by the main process and must
    // not be overwritten by the renderer's debounced sync (the renderer sends
    // placeholder values for these). Preserve whatever is already on disk.
    //
    // v3.30 codex-found race (round 2): AI recommendations must be merged
    // under the same write queue as `setAiRecommendation` so a full-state
    // sync landing between a concurrent rec write's read and write phases
    // can't publish a stale slice. The service method below takes care of
    // that — read the comment on `writeUserStatePreservingAiRecommendations`.
    const existing = await userStateService.readUserState();
    const merged: ProducerPlayerUserState = {
      ...state,
      windowBounds: existing.windowBounds,
      linkedFolders: existing.linkedFolders,
      songOrder: existing.songOrder,
      autoMoveOld: existing.autoMoveOld,
      lastFileDialogDirectory: existing.lastFileDialogDirectory,
      // Placeholder — `writeUserStatePreservingAiRecommendations` overwrites
      // this with the latest on-disk value under the AI-rec write lock.
      perTrackAiRecommendations: existing.perTrackAiRecommendations,
    };
    const updated = await userStateService.writeUserStatePreservingAiRecommendations(merged);

    // Also sync the linked folders and song order into the library service
    // so old-format persistence continues to work during the transition.
    if (libraryService) {
      void writePersistedState(libraryService.getSnapshot());
    }

    // Also sync the shared user state file for backward compatibility
    void writePersistedSharedUserState({
      ratings: updated.songRatings,
      checklists: updated.songChecklists,
      projectFilePaths: updated.songProjectFilePaths,
    });

    return updated;
  });

  ipcMain.handle(IPC_CHANNELS.EXPORT_USER_STATE, async () => {
    if (!userStateService) throw new Error('User state service not initialized');
    const state = await userStateService.readUserState();

    const dialogOptions: OpenDialogOptions = {
      title: 'Choose Export Location',
      properties: ['openDirectory', 'createDirectory'],
    };

    const exportDefaultPath = resolveDialogDefaultPath();
    if (exportDefaultPath) dialogOptions.defaultPath = exportDefaultPath;

    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, error: 'Export cancelled.' };
    }

    rememberDialogDirectory(result.filePaths[0]);

    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const exportFolder = join(result.filePaths[0], `producer-player-export-${timestamp}`);
      await fs.mkdir(exportFolder, { recursive: true });

      // Write user state
      const stateSerialized = `${JSON.stringify(state, null, 2)}\n`;
      await fs.writeFile(join(exportFolder, 'user-state.json'), stateSerialized, 'utf8');

      // Dump localStorage from renderer
      let localStorageData: Record<string, string> = {};
      if (mainWindow && !mainWindow.isDestroyed()) {
        try {
          localStorageData = await mainWindow.webContents.executeJavaScript(`
            (() => {
              const dump = {};
              for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key !== null) dump[key] = localStorage.getItem(key) ?? '';
              }
              return dump;
            })()
          `) as Record<string, string>;
        } catch (lsError: unknown) {
          log.warn('[producer-player] Failed to dump localStorage during export:', lsError);
        }
      }
      const lsSerialized = `${JSON.stringify(localStorageData, null, 2)}\n`;
      await fs.writeFile(join(exportFolder, 'local-storage.json'), lsSerialized, 'utf8');

      return { success: true, folderPath: exportFolder };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Failed to export: ${message}` };
    }
  });

  ipcMain.handle(IPC_CHANNELS.IMPORT_USER_STATE, async () => {
    if (!userStateService) throw new Error('User state service not initialized');

    // Allow user to select a folder or any file inside the export folder
    const dialogOptions: OpenDialogOptions = {
      title: 'Import Producer Player State (select export folder or any file inside it)',
      properties: ['openFile', 'openDirectory'],
    };

    const importDefaultPath = resolveDialogDefaultPath();
    if (importDefaultPath) dialogOptions.defaultPath = importDefaultPath;

    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, error: 'Import cancelled.' };
    }

    rememberDialogDirectory(result.filePaths[0]);

    try {
      // Determine the export directory: if user selected a file, use its parent
      const selectedPath = result.filePaths[0];
      let importDir: string;
      try {
        const stat = await fs.stat(selectedPath);
        importDir = stat.isDirectory() ? selectedPath : dirname(selectedPath);
      } catch {
        return { success: false, error: `Cannot access selected path: ${selectedPath}` };
      }

      // --- Apply user-state.json ---
      const userStatePath = join(importDir, 'user-state.json');
      if (existsSync(userStatePath)) {
        const raw = await fs.readFile(userStatePath, 'utf8');
        const parsed = JSON.parse(raw);

        // BUG FIX: Check the RAW schemaVersion before parseUserState defaults
        // a missing value to the current version — otherwise the check below
        // never rejects corrupt / non-ProducerPlayer JSON files.
        if (
          typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) ||
          typeof parsed.schemaVersion !== 'number' || parsed.schemaVersion < 1
        ) {
          return { success: false, error: 'Invalid state file: missing or invalid schemaVersion.' };
        }

        const validated = parseUserState(parsed);

        // Preserve the current machine's window bounds across imports so a
        // state file from another Mac doesn't reposition this window.
        const currentState = await userStateService.readUserState();
        validated.windowBounds = currentState.windowBounds;

        await userStateService.writeUserState(validated);

        // Push updated state to renderer
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IPC_CHANNELS.USER_STATE_CHANGED, validated);
        }

        // Sync backward-compatible files
        void writePersistedSharedUserState({
          ratings: validated.songRatings,
          checklists: validated.songChecklists,
          projectFilePaths: validated.songProjectFilePaths,
        });

        // BUG FIX: Also sync the legacy electron-state file so that
        // linkedFolders and songOrder survive a restart. readPersistedState()
        // reads from the legacy file, not unified state, so an import that
        // only wrote unified state would lose library config on next launch.
        const legacyPayload: PersistedState = {
          version: 3,
          linkedFolderPaths: validated.linkedFolders.map((f) => resolve(f.path)),
          linkedFolderBookmarks: Object.fromEntries(
            validated.linkedFolders
              .filter((f) => f.bookmarkData)
              .map((f) => [resolve(f.path), f.bookmarkData!])
          ),
          autoMoveOld: validated.autoMoveOld,
          songOrder: validated.songOrder,
          updatedAt: new Date().toISOString(),
        };
        void writeJsonAtomic(getStateFilePath(), legacyPayload).catch((err: unknown) => {
          log.warn('[producer-player] Failed to sync legacy electron-state after import:', err);
        });
      } else {
        log.warn('[producer-player] user-state.json not found in import folder, skipping');
      }

      // --- Apply local-storage.json ---
      // BUG FIX: Filter out per-song localStorage keys that the unified state
      // already authoritatively owns. Without this filter the F2 stale-key
      // cleanup (in the renderer's onUserStateChanged handler) is undone by
      // blindly restoring every key from the export's local-storage.json, and
      // the next debounced sync scrapes the stale values back into unified
      // state. Only UI-layout / non-per-song keys should be restored here.
      const PER_SONG_LS_PREFIXES = [
        'producer-player.reference-track.',
        'producer-player-eq-snapshots-',
        'producer-player.eq-live-state.',
        'producer-player.ai-eq-recommendation.',
      ];
      // Keep migration sentinels that share a per-song prefix but aren't per-song data.
      const PER_SONG_LS_EXCEPTIONS = new Set([
        'producer-player-eq-snapshots-global-migrated',
      ]);
      const localStoragePath = join(importDir, 'local-storage.json');
      if (existsSync(localStoragePath) && mainWindow && !mainWindow.isDestroyed()) {
        try {
          const raw = await fs.readFile(localStoragePath, 'utf8');
          const lsData = JSON.parse(raw) as Record<string, string>;
          if (typeof lsData === 'object' && lsData !== null && !Array.isArray(lsData)) {
            // Strip per-song keys — unified state is the source of truth for
            // these after import; letting them through would resurrect stale data.
            const filtered: Record<string, string> = {};
            for (const [key, value] of Object.entries(lsData)) {
              if (PER_SONG_LS_EXCEPTIONS.has(key) || !PER_SONG_LS_PREFIXES.some((prefix) => key.startsWith(prefix))) {
                filtered[key] = value;
              }
            }
            const sanitized = JSON.stringify(filtered);
            await mainWindow.webContents.executeJavaScript(`
              (() => {
                try {
                  const data = ${sanitized};
                  for (const [key, value] of Object.entries(data)) {
                    try { localStorage.setItem(key, value); } catch {}
                  }
                } catch {}
              })()
            `);
          }
        } catch (lsError: unknown) {
          log.warn('[producer-player] Failed to restore localStorage during import:', lsError);
        }
      } else if (!existsSync(localStoragePath)) {
        log.warn('[producer-player] local-storage.json not found in import folder, skipping');
      }

      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Failed to import: ${message}` };
    }
  });

  // --- AI mastering recommendations IPC handlers (v3.30 storage layer) ---

  ipcMain.handle(
    IPC_CHANNELS.AI_RECOMMENDATIONS_GET,
    async (_event, songId: string, versionNumber: number) => {
      if (!userStateService) throw new Error('User state service not initialized');
      return userStateService.getAiRecommendations(songId, versionNumber);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.AI_RECOMMENDATIONS_SET,
    async (
      _event,
      songId: string,
      versionNumber: number,
      metricId: string,
      recommendation: AiRecommendation,
    ) => {
      if (!userStateService) throw new Error('User state service not initialized');
      await userStateService.setAiRecommendation(songId, versionNumber, metricId, recommendation);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.AI_RECOMMENDATIONS_CLEAR,
    async (_event, songId: string, versionNumber: number | null) => {
      if (!userStateService) throw new Error('User state service not initialized');
      if (versionNumber === null || versionNumber === undefined) {
        await userStateService.clearAiRecommendations(songId);
      } else {
        await userStateService.clearAiRecommendations(songId, versionNumber);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.AI_RECOMMENDATIONS_MARK_STALE,
    async (
      _event,
      songId: string,
      versionNumber: number,
      newAnalysisVersion: string,
    ) => {
      if (!userStateService) throw new Error('User state service not initialized');
      await userStateService.markAiRecommendationsStale(songId, versionNumber, newAnalysisVersion);
    },
  );

  // --- v3.39 Phase 1a: Plugin host IPC handlers -----------------------------
  //
  // Chain state lives in the unified user state (split-to-disk keeps each
  // song's chain in its own per-track file), so most of these are thin
  // wrappers that round-trip through UserStateService. The scan handler is
  // the one that talks to the sidecar: it lazily spawns `pp-audio-host`,
  // asks it to enumerate plugins, persists the result so future launches
  // can render the browser offline, and returns the fresh library.

  ipcMain.handle(IPC_CHANNELS.PLUGIN_SCAN_LIBRARY, async () => {
    if (!userStateService) throw new Error('User state service not initialized');
    if (!pluginHostService) pluginHostService = new PluginHostService();
    ensurePluginHostForwarders(pluginHostService);
    if (!pluginHostService.isAvailable()) {
      throw new Error(
        'pp-audio-host sidecar binary is not built yet. Run `bash native/pp-audio-host/scripts/build-sidecar.sh` once to bootstrap it, then retry the scan.',
      );
    }
    const library = await pluginHostService.scanPlugins();
    await userStateService.setPluginLibrary(library);
    // Phase 2 (v3.41): keep the service's cached library in sync so
    // subsequent `reconcileTrackChain` calls can resolve pluginId → path
    // without re-scanning. `scanPlugins` already calls `rememberLibrary`
    // internally, but we repeat it here for clarity.
    pluginHostService.rememberLibrary(library);
    return library;
  });

  ipcMain.handle(IPC_CHANNELS.PLUGIN_GET_LIBRARY, async () => {
    if (!userStateService) throw new Error('User state service not initialized');
    const library = await userStateService.getPluginLibrary();
    // Prime the sidecar service cache from persisted state on the first
    // renderer query after a cold start, so reconciliation doesn't have to
    // force a rescan on every launch.
    if (library && pluginHostService) {
      pluginHostService.rememberLibrary(library);
    }
    return library;
  });

  /**
   * Phase 2 (v3.41): chain-edit reconciliation helper.
   *
   * Fire-and-forget. Called after every chain mutation (add / remove /
   * setTrackChain). Chain state is the renderer's source of truth — it's
   * already persisted to disk by the time we get here — so we MUST NOT
   * block the IPC reply on sidecar latency. The sidecar may be slow to
   * load a plugin (JUCE `createPluginInstance` can take seconds), may not
   * be built yet, or may be unavailable entirely; none of that should
   * stall the UI's add/remove round-trip.
   *
   * Empty chains still go through reconcile so any previously-loaded
   * instances for this song get unloaded (the diff treats every loaded
   * id as unreferenced when `items` is empty). Ethan's "no plugins →
   * no effect" invariant is enforced separately in the renderer's
   * audio-routing fast-path (zero IPC for empty/all-disabled chains)
   * and in the sidecar's `handleProcessBlock` (memcpy passthrough).
   *
   * Errors are logged, never thrown.
   */
  const reconcileChainIfPossible = (chain: TrackPluginChain): void => {
    if (!pluginHostService) pluginHostService = new PluginHostService();
    ensurePluginHostForwarders(pluginHostService);
    if (!pluginHostService.isAvailable()) return; // sidecar not built yet
    const service = pluginHostService;
    // Detached promise on purpose — don't `await` the IPC reply, but still
    // attach a .catch so an unhandled-rejection never crashes the host.
    void Promise.resolve()
      .then(async () => {
        if (userStateService) {
          service.rememberLibrary(await userStateService.getPluginLibrary());
        }
        return service.reconcileTrackChain(chain);
      })
      .then((result) => {
        if (result.failed.length > 0) {
          log.warn(
            `[plugin-host] reconcile ${chain.songId}: ${result.failed.length} slot(s) failed`,
            result.failed,
          );
        }
      })
      .catch((err) => {
        log.warn(`[plugin-host] reconcile ${chain.songId} failed`, err);
      });
  };

  ipcMain.handle(IPC_CHANNELS.PLUGIN_GET_TRACK_CHAIN, async (_event, songId: string) => {
    if (!userStateService) throw new Error('User state service not initialized');
    return userStateService.getTrackPluginChain(songId);
  });

  ipcMain.handle(
    IPC_CHANNELS.PLUGIN_SET_TRACK_CHAIN,
    async (_event, songId: string, chain: Parameters<UserStateService['setTrackPluginChain']>[1]) => {
      if (!userStateService) throw new Error('User state service not initialized');
      const next = await userStateService.setTrackPluginChain(songId, chain);
      reconcileChainIfPossible(next);
      return next;
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.PLUGIN_ADD_TO_CHAIN,
    async (_event, songId: string, pluginId: string) => {
      if (!userStateService) throw new Error('User state service not initialized');
      const next = await userStateService.addPluginToChain(songId, pluginId);
      reconcileChainIfPossible(next);
      return next;
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.PLUGIN_REMOVE_FROM_CHAIN,
    async (_event, songId: string, instanceId: string) => {
      if (!userStateService) throw new Error('User state service not initialized');
      const next = await userStateService.removePluginFromChain(songId, instanceId);
      reconcileChainIfPossible(next);
      return next;
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.PLUGIN_REORDER_CHAIN,
    async (_event, songId: string, orderedInstanceIds: string[]) => {
      if (!userStateService) throw new Error('User state service not initialized');
      // Reorder doesn't change membership so no reconcile needed — the
      // sidecar is keyed by instanceId, and the next `processBlock` request
      // carries the fresh order in its `chain` array.
      return userStateService.reorderPluginChain(songId, orderedInstanceIds);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.PLUGIN_TOGGLE_ENABLED,
    async (_event, songId: string, instanceId: string, enabled: boolean) => {
      if (!userStateService) throw new Error('User state service not initialized');
      // Toggle is a pure runtime flag — the sidecar keeps the instance
      // loaded either way. Flipping it is instant; no reconcile needed.
      return userStateService.togglePluginEnabled(songId, instanceId, enabled);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.PLUGIN_SET_STATE,
    async (_event, songId: string, instanceId: string, stateBase64: string) => {
      if (!userStateService) throw new Error('User state service not initialized');
      return userStateService.setPluginState(songId, instanceId, stateBase64);
    },
  );

  // --- v3.42 Phase 3: Plugin editor window IPC -----------------------------
  //
  // open/close ask the sidecar to show/hide a native DocumentWindow for the
  // plugin's AudioProcessorEditor. The sidecar emits editor_closed events
  // when the user closes a window via the OS close button; we forward
  // those to the renderer over a dedicated IPC channel so React can clear
  // the per-slot "open" indicator without the user re-clicking Edit.
  //
  // Lazy-init guard: if the sidecar binary isn't built yet, open fails
  // with a clear error.

  let editorClosedForwarderRegistered = false;
  let instanceLoadedForwarderRegistered = false;
  let sidecarExitedForwarderRegistered = false;
  const ensureEditorClosedForwarder = (service: PluginHostService): void => {
    if (editorClosedForwarderRegistered) return;
    editorClosedForwarderRegistered = true;
    service.onEditorClosed((instanceId) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.PLUGIN_EDITOR_CLOSED_EVENT, instanceId);
      }
    });
  };
  const ensureInstanceLoadedForwarder = (service: PluginHostService): void => {
    if (instanceLoadedForwarderRegistered) return;
    instanceLoadedForwarderRegistered = true;
    service.onInstanceLoaded((payload) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.PLUGIN_INSTANCE_LOADED_EVENT, payload);
      }
    });
  };
  const ensureSidecarExitedForwarder = (service: PluginHostService): void => {
    if (sidecarExitedForwarderRegistered) return;
    sidecarExitedForwarderRegistered = true;
    service.onSidecarExited((info) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.PLUGIN_SIDECAR_EXITED_EVENT, info);
      }
    });
  };
  const ensurePluginHostForwarders = (service: PluginHostService): void => {
    ensureEditorClosedForwarder(service);
    ensureInstanceLoadedForwarder(service);
    ensureSidecarExitedForwarder(service);
  };

  const getOrCreatePluginHost = (): PluginHostService => {
    if (!pluginHostService) pluginHostService = new PluginHostService();
    ensurePluginHostForwarders(pluginHostService);
    return pluginHostService;
  };

  const getOrCreatePluginPresetLibrary = (): PluginPresetLibraryStore => {
    if (!pluginPresetLibrary) {
      pluginPresetLibrary = new PluginPresetLibraryStore(app.getPath('userData'));
    }
    return pluginPresetLibrary;
  };

  const getLoadedPluginSlot = async (songId: string, instanceId: string) => {
    if (!userStateService) throw new Error('User state service not initialized');
    const chain = await userStateService.getTrackPluginChain(songId);
    const item = chain.items.find((slot) => slot.instanceId === instanceId) ?? null;
    if (!item || !item.pluginId) {
      throw new Error('No plugin is loaded in this slot.');
    }
    return { chain, item };
  };

  const ensurePresetSidecarReady = (instanceId: string): PluginHostService => {
    const service = getOrCreatePluginHost();
    if (!service.isAvailable() || !service.getLoadedInstanceIds().includes(instanceId)) {
      throw new Error('Plugin is still loading — try again in a moment.');
    }
    return service;
  };

  // --- v3.43 Phase 4: Plugin preset save/recall IPC ------------------------

  ipcMain.handle(
    IPC_CHANNELS.PLUGIN_PRESET_SAVE,
    async (_event, args: { songId: string; instanceId: string; name: string }) => {
      const { item } = await getLoadedPluginSlot(args.songId, args.instanceId);
      const service = ensurePresetSidecarReady(args.instanceId);
      let stateBase64 = '';
      try {
        stateBase64 = await service.getPluginState(args.instanceId);
      } catch (err) {
        log.warn('[plugin-presets] getPluginState failed', err);
        throw new Error('Plugin is still loading — try again in a moment.');
      }
      return getOrCreatePluginPresetLibrary().savePreset(item.pluginId, args.name, stateBase64);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.PLUGIN_PRESET_RECALL,
    async (_event, args: { songId: string; instanceId: string; name: string }) => {
      const { item } = await getLoadedPluginSlot(args.songId, args.instanceId);
      const preset = await getOrCreatePluginPresetLibrary().getPreset(item.pluginId, args.name);
      if (!preset) {
        throw new Error('Preset not found.');
      }
      const service = ensurePresetSidecarReady(args.instanceId);
      try {
        await service.setPluginState(args.instanceId, preset.stateBase64);
      } catch (err) {
        log.warn('[plugin-presets] setPluginState failed', err);
        throw new Error('Plugin is still loading — try again in a moment.');
      }
      if (!userStateService) throw new Error('User state service not initialized');
      return userStateService.setPluginState(args.songId, args.instanceId, preset.stateBase64);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.PLUGIN_PRESET_LIST,
    async (_event, args: { pluginIdentifier: string }) => {
      return getOrCreatePluginPresetLibrary().listPresetsFor(args.pluginIdentifier);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.PLUGIN_PRESET_DELETE,
    async (_event, args: { pluginIdentifier: string; name: string }) => {
      await getOrCreatePluginPresetLibrary().deletePreset(args.pluginIdentifier, args.name);
    },
  );

  ipcMain.handle(IPC_CHANNELS.PLUGIN_EDITOR_OPEN, async (_event, instanceId: string) => {
    const service = getOrCreatePluginHost();
    if (!service.isAvailable()) {
      throw new Error(
        'pp-audio-host sidecar binary is not built yet. Native plugin editors require the sidecar.',
      );
    }
    return service.openPluginEditor(instanceId);
  });

  ipcMain.handle(IPC_CHANNELS.PLUGIN_EDITOR_CLOSE, async (_event, instanceId: string) => {
    const service = getOrCreatePluginHost();
    if (!service.isAvailable()) return; // nothing to close if we never started
    await service.closePluginEditor(instanceId);
  });

  // --- Agent IPC handlers ---

  if (!ENABLE_AGENT_FEATURES) {
    ipcMain.handle(IPC_CHANNELS.AGENT_START_SESSION, async () => {
      throw new Error(AGENT_FEATURES_DISABLED_MESSAGE);
    });

    ipcMain.handle(IPC_CHANNELS.AGENT_SEND_TURN, async () => {
      throw new Error(AGENT_FEATURES_DISABLED_MESSAGE);
    });

    ipcMain.handle(IPC_CHANNELS.AGENT_SAVE_ATTACHMENT, async () => {
      throw new Error(AGENT_FEATURES_DISABLED_MESSAGE);
    });

    ipcMain.handle(IPC_CHANNELS.AGENT_CLEAR_ATTACHMENTS, async () => {
      // No-op while the feature is disabled.
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
      agentService.sendTurn(
        payload.message,
        payload.context,
        payload.uiContext,
        payload.attachments,
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.AGENT_SAVE_ATTACHMENT,
    async (_event, payload: AgentSaveAttachmentPayload): Promise<AgentAttachment> => {
      return saveAgentAttachment(payload);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.AGENT_CLEAR_ATTACHMENTS,
    async (_event, paths: string[]) => {
      await clearAgentAttachments(paths);
    }
  );

  // Sweep stale agent attachment temp files in the background.
  void sweepStaleAgentAttachments();

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

  // Migrate old safeStorage keys on first access (fire-and-forget; get handlers
  // tolerate missing files gracefully so a race is harmless)
  migrateEncToKey('deepgram-key').catch(() => {});
  migrateEncToKey('assemblyai-key').catch(() => {});

  ipcMain.handle(
    IPC_CHANNELS.AGENT_STORE_DEEPGRAM_KEY,
    async (_event, key: string) => {
      const statePath = join(app.getPath('userData'), 'deepgram-key.key');
      await fs.writeFile(statePath, obfuscate(key), 'utf8');
    }
  );

  ipcMain.handle(IPC_CHANNELS.AGENT_GET_DEEPGRAM_KEY, async () => {
    const statePath = join(app.getPath('userData'), 'deepgram-key.key');
    try {
      const encoded = await fs.readFile(statePath, 'utf8');
      return deobfuscate(encoded);
    } catch {
      return null;
    }
  });

  ipcMain.handle(IPC_CHANNELS.AGENT_CLEAR_DEEPGRAM_KEY, async () => {
    const statePath = join(app.getPath('userData'), 'deepgram-key.key');
    try {
      await fs.unlink(statePath);
    } catch {
      // ignore if doesn't exist
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.AGENT_STORE_ASSEMBLYAI_KEY,
    async (_event, key: string) => {
      const statePath = join(app.getPath('userData'), 'assemblyai-key.key');
      await fs.writeFile(statePath, obfuscate(key), 'utf8');
    }
  );

  ipcMain.handle(IPC_CHANNELS.AGENT_GET_ASSEMBLYAI_KEY, async () => {
    const statePath = join(app.getPath('userData'), 'assemblyai-key.key');
    try {
      const encoded = await fs.readFile(statePath, 'utf8');
      return deobfuscate(encoded);
    } catch {
      return null;
    }
  });

  ipcMain.handle(IPC_CHANNELS.AGENT_CLEAR_ASSEMBLYAI_KEY, async () => {
    const statePath = join(app.getPath('userData'), 'assemblyai-key.key');
    try {
      await fs.unlink(statePath);
    } catch {
      // ignore if doesn't exist
    }
  });

  // ---- Logging IPC handlers ------------------------------------------------

  ipcMain.handle(IPC_CHANNELS.OPEN_LOG_FOLDER, async () => {
    const logDir = getLogDirectoryPath();
    await shell.openPath(logDir);
  });

  ipcMain.handle(IPC_CHANNELS.GET_LOG_PATH, async () => {
    return log.transports.file.getFile().path;
  });

  ipcMain.handle(
    IPC_CHANNELS.RENDERER_LOG,
    async (
      _event,
      level: 'error' | 'warn' | 'info',
      message: string,
      meta?: Record<string, unknown>
    ) => {
      const safeLevel = (['error', 'warn', 'info'] as const).includes(level) ? level : 'info';
      if (meta) {
        log[safeLevel](`[renderer] ${message}`, meta);
      } else {
        log[safeLevel](`[renderer] ${message}`);
      }
    }
  );
}

app.whenReady().then(async () => {
  log.info('App ready', {
    version: APP_VERSION_INFO.displayVersion,
    buildNumber: APP_VERSION_INFO.buildNumber,
    commitSha: APP_VERSION_INFO.commitShortSha,
    platform: process.platform,
    arch: process.arch,
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    sandboxed: IS_MAC_APP_STORE_SANDBOX,
    testMode: IS_TEST_MODE,
    // Auto-updater diagnostics — surfaced here so "why isn't my app
    // updating?" has an immediate answer from the log without having to
    // grep for later events.
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    autoUpdateDisabledReason: getAutoUpdateDisabledReason(),
    logPath: log.transports.file.getFile().path,
  });

  // Log the embedded code-signing metadata on macOS so an update-reject
  // "signing identity mismatch" can be diagnosed by comparing this line
  // across the INSTALLED app vs the incoming update. This is best-effort:
  // if codesign is missing (Linux/CI/dev) we silently skip.
  if (process.platform === 'darwin' && app.isPackaged) {
    void logMacCodeSigningIdentity();
  }

  await registerPlaybackProtocol();

  // Initialize the unified user state service
  userStateService = new UserStateService(getStateDirectoryPath());

  // Legacy migration first: if we have neither the monolithic file nor the
  // v3.29 split layout yet, but DO have the pre-2.45 split files
  // (electron-state + shared-user-state), produce a monolithic file so the
  // v3.29 split-migration below has something to split.
  const monolithicPath = join(getStateDirectoryPath(), UNIFIED_STATE_FILE_NAME);
  if (!existsSync(monolithicPath) && !userStateService.isSplitLayout()) {
    const oldElectronStatePath = getStateFilePath();
    const oldSharedStatePath = getSharedUserStateFilePath();
    const hasOldFiles = existsSync(oldElectronStatePath) || existsSync(oldSharedStatePath);

    if (hasOldFiles) {
      log.info('[producer-player] Unified state file not found — migrating from old format');
      // Migrate with empty renderer localStorage data (renderer will push its data
      // on first sync after startup).
      await userStateService.migrateFromOldFormat(
        oldElectronStatePath,
        oldSharedStatePath,
        {},
      );
    }
  }

  // v3.29 MVP: split the monolithic state into per-track + global files
  // on first launch after the upgrade. Runs before any readUserState() call
  // so the cached state is populated from the new layout. Idempotent —
  // a `state/.migrated` sentinel short-circuits re-entry.
  try {
    migrateStateIfNeeded(getStateDirectoryPath());
    // After the split flips the layout, the cached state (populated by the
    // legacy migration above via writeUserState → monolithic) no longer
    // matches what's on disk in the split files. Invalidate so the next
    // readUserState() re-parses from the split layout.
    userStateService.invalidateCache();
  } catch (error: unknown) {
    log.warn('[producer-player] v3.29 state split migration failed — continuing with monolithic layout', error);
  }

  // Restore last-used file dialog directory from persisted state
  try {
    const initialState = await userStateService.readUserState();
    if (initialState.lastFileDialogDirectory) {
      lastFileDialogDirectory = initialState.lastFileDialogDirectory;
    }
  } catch {
    // Non-critical — fall back to OS default
  }

  const service = await ensureLibraryService();
  registerIpcHandlers(service);
  buildApplicationMenu();
  await createMainWindow();
  registerGlobalMediaShortcuts();
  scheduleAutomaticUpdateChecks();

  log.info('App startup complete');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
});

app.on('before-quit', () => {
  log.info('App quitting');
  if (mainWindow && !mainWindow.isDestroyed()) {
    saveWindowBoundsImmediately(mainWindow);
  }
  globalShortcut.unregisterAll();
  clearAutomaticUpdateChecks();
  releaseAllFolderSecurityScopes();
  agentService.destroySession();

  if (libraryService) {
    void libraryService.dispose();
  }

  // Force-exit after 3 seconds if any cleanup hangs (e.g. watcher.close(),
  // agent CLI subprocess, or synchronous log writes). This prevents the app
  // from appearing frozen when quitting in dev mode.
  setTimeout(() => {
    log.warn('Force-exiting after quit timeout');
    app.exit(1);
  }, 3000).unref();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
