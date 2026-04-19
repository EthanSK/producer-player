/**
 * Unified user state service.
 *
 * Reads/writes `producer-player-user-state.json` as the single source of truth
 * for all user-authored data. Provides migration from the old split format
 * (electron-state.json + shared-user-state.json + renderer localStorage keys).
 *
 * v3.29 MVP split layout (behind a `.migrated` sentinel):
 *   state/global.json        — all non-per-track fields
 *   state/tracks/<songId>.json — one file per track
 *   state/.migrated          — sentinel (empty file) flagging "migration done"
 *
 * The original monolithic `producer-player-user-state.json` is preserved for
 * backwards compatibility, and a one-shot timestamped backup
 * (`*.bak-pre-split-<ts>`) is written next to it.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  copyFileSync,
  promises as fs,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import log from 'electron-log/main';
import type {
  AiRecommendation,
  AiRecommendationSet,
  AiRecommendationStatus,
  AlbumChecklistItem,
  EqSnapshot,
  ListeningDevice,
  PersistedEqLiveState,
  PerVersionAiRecommendations,
  ProducerPlayerUserState,
  SavedReferenceTrack,
  SongChecklistItem,
  WindowBounds,
} from '@producer-player/contracts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const UNIFIED_STATE_FILE_NAME = 'producer-player-user-state.json';
const CURRENT_SCHEMA_VERSION = 1;

// v3.29 split layout
export const STATE_SUBDIR = 'state';
export const TRACKS_SUBDIR = 'tracks';
export const GLOBAL_STATE_FILE = 'global.json';
export const MIGRATED_SENTINEL = '.migrated';

/**
 * Keys in `ProducerPlayerUserState` that are keyed by songId. These get
 * hoisted into per-track files under `state/tracks/<songId>.json`.
 *
 * Kept explicit (not inferred from the type) so adding a new top-level field
 * to `ProducerPlayerUserState` is a deliberate decision about whether it's
 * global or per-track — silent misclassification of a new field would be a
 * state-corruption bug.
 */
export const PER_TRACK_KEYS = [
  'songRatings',
  'songChecklists',
  'songProjectFilePaths',
  'perSongReferenceTracks',
  'perSongRestoreReferenceEnabled',
  'eqSnapshots',
  'eqLiveStates',
  'aiEqRecommendations',
  'songDawOffsets',
  // v3.30: AI mastering recommendations keyed by (songId → versionNumber → set).
  // The outer record is songId-keyed so the split-to-disk machinery in
  // `splitStateForDisk` hoists it into per-track files automatically; the
  // inner record remains a simple versionNumber-stringified map.
  'perTrackAiRecommendations',
] as const satisfies readonly (keyof ProducerPlayerUserState)[];

export type PerTrackKey = (typeof PER_TRACK_KEYS)[number];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSongRatings(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
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
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const c = entry as Partial<SongChecklistItem>;
    if (
      typeof c.id !== 'string' || c.id.trim().length === 0 ||
      typeof c.text !== 'string' ||
      typeof c.completed !== 'boolean'
    ) return [];
    const timestampSeconds =
      typeof c.timestampSeconds === 'number' && Number.isFinite(c.timestampSeconds) && c.timestampSeconds >= 0
        ? c.timestampSeconds
        : null;
    const versionNumber =
      typeof c.versionNumber === 'number' && Number.isFinite(c.versionNumber) && c.versionNumber >= 1
        ? Math.trunc(c.versionNumber)
        : null;
    const listeningDeviceId =
      typeof c.listeningDeviceId === 'string' && c.listeningDeviceId.trim().length > 0
        ? c.listeningDeviceId
        : null;
    // v3.26.0 — "from mastering" provenance flag. Only persist the
    // property when it is explicitly true so historical items round-trip
    // without acquiring a stray `fromMastering: false` key. Any unknown
    // value (missing, null, string, undefined) safely coerces to false
    // at render time because the renderer treats undefined as falsy.
    const fromMastering = c.fromMastering === true ? true : undefined;
    return [{
      id: c.id,
      text: c.text,
      completed: c.completed,
      timestampSeconds,
      versionNumber,
      listeningDeviceId,
      ...(fromMastering ? { fromMastering: true } : {}),
    }];
  });
}

function parseListeningDevices(value: unknown): ListeningDevice[] {
  if (!Array.isArray(value)) return [];
  const seenIds = new Set<string>();
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (id.length === 0 || name.length === 0 || seenIds.has(id)) return [];
    seenIds.add(id);
    return [{ id, name }];
  });
}

function parseSongChecklists(value: unknown): Record<string, SongChecklistItem[]> {
  if (!isRecord(value)) return {};
  const entries = Object.entries(value).flatMap(([songId, items]) => {
    if (songId.length === 0) return [];
    return [[songId, parseSongChecklistItems(items)] as const];
  });
  return Object.fromEntries(entries);
}

function parseSongProjectFilePaths(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const entries = Object.entries(value).flatMap(([songId, p]) => {
    const normalizedPath = typeof p === 'string' ? p.trim() : '';
    if (songId.length === 0 || normalizedPath.length === 0) return [];
    return [[songId, normalizedPath] as const];
  });
  return Object.fromEntries(entries);
}

function parseAlbumChecklists(value: unknown): Record<string, AlbumChecklistItem[]> {
  if (!isRecord(value)) return {};
  const result: Record<string, AlbumChecklistItem[]> = {};
  for (const [key, val] of Object.entries(value)) {
    if (Array.isArray(val)) {
      result[key] = val.flatMap((item: unknown) => {
        if (!isRecord(item)) return [];
        if (
          typeof item.id !== 'string' ||
          typeof item.text !== 'string' ||
          typeof item.completed !== 'boolean'
        ) return [];
        return [{ id: item.id, text: item.text, completed: item.completed }];
      });
    }
  }
  return result;
}

function parseSavedReferenceTracks(value: unknown): SavedReferenceTrack[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const c = entry as Partial<SavedReferenceTrack>;
    if (
      typeof c.filePath !== 'string' || c.filePath.length === 0 ||
      typeof c.fileName !== 'string' || c.fileName.length === 0 ||
      typeof c.dateLastUsed !== 'string'
    ) return [];
    const integratedLufs =
      typeof c.integratedLufs === 'number' && Number.isFinite(c.integratedLufs) ? c.integratedLufs : null;
    return [{ filePath: c.filePath, fileName: c.fileName, dateLastUsed: c.dateLastUsed, integratedLufs }];
  });
}

function parsePerSongReferenceTracks(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const entries = Object.entries(value).flatMap(([songId, filePath]) => {
    if (songId.length === 0 || typeof filePath !== 'string' || filePath.length === 0) return [];
    return [[songId, filePath] as const];
  });
  return Object.fromEntries(entries);
}

function parsePerSongRestoreReferenceEnabled(
  value: unknown,
): Record<string, boolean> {
  if (!isRecord(value)) return {};
  const entries = Object.entries(value).flatMap(([songId, enabled]) => {
    if (songId.length === 0 || typeof enabled !== 'boolean') return [];
    return [[songId, enabled] as const];
  });
  return Object.fromEntries(entries);
}

function parseEqSnapshots(value: unknown): Record<string, EqSnapshot[]> {
  if (!isRecord(value)) return {};
  const result: Record<string, EqSnapshot[]> = {};
  for (const [key, val] of Object.entries(value)) {
    if (Array.isArray(val)) {
      result[key] = val.flatMap((item: unknown) => {
        if (!isRecord(item)) return [];
        if (
          typeof item.id !== 'string' ||
          !Array.isArray(item.gains) ||
          typeof item.timestamp !== 'number'
        ) return [];
        return [{
          id: item.id,
          gains: item.gains as number[],
          timestamp: item.timestamp,
        }];
      });
    }
  }
  return result;
}

function parseEqLiveStates(value: unknown): Record<string, PersistedEqLiveState> {
  if (!isRecord(value)) return {};
  const result: Record<string, PersistedEqLiveState> = {};
  for (const [key, val] of Object.entries(value)) {
    if (
      isRecord(val) &&
      Array.isArray(val.gains) &&
      typeof val.eqEnabled === 'boolean'
    ) {
      result[key] = {
        gains: val.gains as number[],
        eqEnabled: val.eqEnabled,
        showAiEqCurve: typeof val.showAiEqCurve === 'boolean' ? val.showAiEqCurve : false,
        showRefDiffCurve: typeof val.showRefDiffCurve === 'boolean' ? val.showRefDiffCurve : false,
        showEqTonalBalance: typeof val.showEqTonalBalance === 'boolean' ? val.showEqTonalBalance : false,
      };
    }
  }
  return result;
}

function parseAiEqRecommendations(value: unknown): Record<string, number[]> {
  if (!isRecord(value)) return {};
  const result: Record<string, number[]> = {};
  for (const [key, val] of Object.entries(value)) {
    if (Array.isArray(val) && val.length >= 6 && val.every((v) => typeof v === 'number')) {
      result[key] = val as number[];
    }
  }
  return result;
}

function parseWindowBounds(value: unknown): WindowBounds | null {
  if (!isRecord(value)) return null;
  const { x, y, width, height, isMaximized } = value as Partial<WindowBounds>;
  if (
    typeof x !== 'number' || !Number.isFinite(x) ||
    typeof y !== 'number' || !Number.isFinite(y) ||
    typeof width !== 'number' || !Number.isFinite(width) || width <= 0 ||
    typeof height !== 'number' || !Number.isFinite(height) || height <= 0
  ) {
    return null;
  }
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
    isMaximized: typeof isMaximized === 'boolean' ? isMaximized : false,
  };
}

function parseStringMapRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const entries = Object.entries(value).flatMap(([k, v]) => {
    if (typeof v !== 'string') return [];
    return [[k, v] as const];
  });
  return Object.fromEntries(entries);
}

function parseSongDawOffsets(
  value: unknown,
): Record<string, { seconds: number; enabled: boolean }> {
  if (!isRecord(value)) return {};
  const result: Record<string, { seconds: number; enabled: boolean }> = {};
  for (const [songId, entry] of Object.entries(value)) {
    if (!songId || songId.length === 0) continue;
    if (!isRecord(entry)) continue;
    const secondsRaw = entry.seconds;
    const enabledRaw = entry.enabled;
    const seconds =
      typeof secondsRaw === 'number' &&
      Number.isFinite(secondsRaw) &&
      secondsRaw >= 0
        ? Math.floor(secondsRaw)
        : null;
    const enabled = typeof enabledRaw === 'boolean' ? enabledRaw : null;
    if (seconds === null || enabled === null) continue;
    result[songId] = { seconds, enabled };
  }
  return result;
}

// ---------------------------------------------------------------------------
// v3.30 — AI recommendation parsers
// ---------------------------------------------------------------------------

const AI_RECOMMENDATION_STATUSES: readonly AiRecommendationStatus[] = [
  'fresh',
  'stale',
  'loading',
  'failed',
];

function parseAiRecommendation(value: unknown): AiRecommendation | null {
  if (!isRecord(value)) return null;
  const recommendedValue = typeof value.recommendedValue === 'string' ? value.recommendedValue : null;
  const reason = typeof value.reason === 'string' ? value.reason : null;
  const model = typeof value.model === 'string' ? value.model : null;
  const requestId = typeof value.requestId === 'string' ? value.requestId : null;
  const analysisVersion = typeof value.analysisVersion === 'string' ? value.analysisVersion : null;
  const generatedAtRaw = value.generatedAt;
  const generatedAt =
    typeof generatedAtRaw === 'number' && Number.isFinite(generatedAtRaw) && generatedAtRaw >= 0
      ? generatedAtRaw
      : null;
  const statusRaw = value.status;
  const status =
    typeof statusRaw === 'string' && AI_RECOMMENDATION_STATUSES.includes(statusRaw as AiRecommendationStatus)
      ? (statusRaw as AiRecommendationStatus)
      : null;
  if (
    recommendedValue === null ||
    reason === null ||
    model === null ||
    requestId === null ||
    analysisVersion === null ||
    generatedAt === null ||
    status === null
  ) {
    return null;
  }
  const rec: AiRecommendation = {
    recommendedValue,
    reason,
    model,
    requestId,
    analysisVersion,
    generatedAt,
    status,
  };
  if (
    typeof value.recommendedRawValue === 'number' &&
    Number.isFinite(value.recommendedRawValue)
  ) {
    rec.recommendedRawValue = value.recommendedRawValue;
  }
  return rec;
}

function parseAiRecommendationSet(value: unknown): AiRecommendationSet {
  if (!isRecord(value)) return {};
  const result: AiRecommendationSet = {};
  for (const [metricId, rec] of Object.entries(value)) {
    if (!metricId) continue;
    const parsed = parseAiRecommendation(rec);
    if (parsed) result[metricId] = parsed;
  }
  return result;
}

function parsePerVersionAiRecommendations(value: unknown): PerVersionAiRecommendations | null {
  if (!isRecord(value)) return null;
  const recommendations = parseAiRecommendationSet(value.recommendations);
  const aiRecommendedFlag = typeof value.aiRecommendedFlag === 'boolean' ? value.aiRecommendedFlag : false;
  const lastRunAtRaw = value.lastRunAt;
  const lastRunAt =
    lastRunAtRaw === null || lastRunAtRaw === undefined
      ? null
      : typeof lastRunAtRaw === 'number' && Number.isFinite(lastRunAtRaw) && lastRunAtRaw >= 0
        ? lastRunAtRaw
        : null;
  return { recommendations, aiRecommendedFlag, lastRunAt };
}

/**
 * Parse the top-level `perTrackAiRecommendations` map. Shape is
 *   Record<songId, Record<versionNumberString, PerVersionAiRecommendations>>.
 *
 * JSON forces string keys on the inner record; we accept string-ish integers
 * (`"1"`, `"42"`) and drop anything that fails to coerce into a finite,
 * non-negative integer. That way a corrupt key never silently shifts a real
 * version's data under a garbage key.
 */
function parsePerTrackAiRecommendations(
  value: unknown,
): Record<string, Record<string, PerVersionAiRecommendations>> {
  if (!isRecord(value)) return {};
  const result: Record<string, Record<string, PerVersionAiRecommendations>> = {};
  for (const [songId, perVersionRaw] of Object.entries(value)) {
    if (!songId || songId.length === 0) continue;
    if (!isRecord(perVersionRaw)) continue;
    const perVersion: Record<string, PerVersionAiRecommendations> = {};
    for (const [versionKey, payload] of Object.entries(perVersionRaw)) {
      if (!versionKey) continue;
      const versionNum = Number(versionKey);
      if (!Number.isFinite(versionNum) || versionNum < 0 || !Number.isInteger(versionNum)) continue;
      const parsed = parsePerVersionAiRecommendations(payload);
      if (parsed) perVersion[String(versionNum)] = parsed;
    }
    if (Object.keys(perVersion).length > 0) {
      result[songId] = perVersion;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Default state
// ---------------------------------------------------------------------------

export function createDefaultUserState(): ProducerPlayerUserState {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    updatedAt: new Date(0).toISOString(),
    linkedFolders: [],
    songOrder: [],
    autoMoveOld: true,
    songRatings: {},
    songChecklists: {},
    songProjectFilePaths: {},
    albumTitle: 'Untitled Album',
    albumArtDataUrl: '',
    albumChecklists: {},
    savedReferenceTracks: [],
    perSongReferenceTracks: {},
    perSongRestoreReferenceEnabled: {},
    globalReferenceFilePath: '',
    eqSnapshots: {},
    eqLiveStates: {},
    aiEqRecommendations: {},
    perTrackAiRecommendations: {},
    agentProvider: '',
    agentModels: {},
    agentThinking: {},
    agentSystemPrompt: '',
    agentSttProvider: '',
    listeningDevices: [],
    activeListeningDeviceId: null,
    referenceLevelMatchEnabled: true,
    iCloudBackupEnabled: false,
    autoUpdateEnabled: true,
    showAiRecommendationsFullscreen: true,
    songDawOffsets: {},
    checklistDawOffsetDefaultSeconds: 0,
    checklistDawOffsetDefaultEnabled: false,
    lastFileDialogDirectory: '',
    windowBounds: null,
  };
}

// ---------------------------------------------------------------------------
// Parse / validate
// ---------------------------------------------------------------------------

export function parseUserState(raw: unknown): ProducerPlayerUserState {
  const fallback = createDefaultUserState();
  if (!isRecord(raw)) return fallback;

  return {
    schemaVersion: typeof raw.schemaVersion === 'number' ? raw.schemaVersion : CURRENT_SCHEMA_VERSION,
    updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt.length > 0 ? raw.updatedAt : fallback.updatedAt,
    linkedFolders: Array.isArray(raw.linkedFolders)
      ? raw.linkedFolders.flatMap((entry: unknown) => {
          if (!isRecord(entry) || typeof entry.path !== 'string' || entry.path.length === 0) return [];
          const bookmarkData = typeof entry.bookmarkData === 'string' && entry.bookmarkData.length > 0 ? entry.bookmarkData : undefined;
          return [{ path: resolve(entry.path), bookmarkData }];
        })
      : [],
    songOrder: Array.isArray(raw.songOrder)
      ? raw.songOrder.filter((v): v is string => typeof v === 'string' && v.length > 0)
      : [],
    autoMoveOld: typeof raw.autoMoveOld === 'boolean' ? raw.autoMoveOld : fallback.autoMoveOld,
    songRatings: parseSongRatings(raw.songRatings),
    songChecklists: parseSongChecklists(raw.songChecklists),
    songProjectFilePaths: parseSongProjectFilePaths(raw.songProjectFilePaths),
    albumTitle: typeof raw.albumTitle === 'string' && raw.albumTitle.length > 0 ? raw.albumTitle : fallback.albumTitle,
    albumArtDataUrl: typeof raw.albumArtDataUrl === 'string' ? raw.albumArtDataUrl : '',
    albumChecklists: parseAlbumChecklists(raw.albumChecklists),
    savedReferenceTracks: parseSavedReferenceTracks(raw.savedReferenceTracks),
    perSongReferenceTracks: parsePerSongReferenceTracks(raw.perSongReferenceTracks),
    perSongRestoreReferenceEnabled: parsePerSongRestoreReferenceEnabled(raw.perSongRestoreReferenceEnabled),
    // v3.22.0: last globally-picked reference. Fall back to empty string
    // if missing or not a string so the renderer's narrow `typeof ... === 'string'`
    // hydration check still works on old state files.
    globalReferenceFilePath:
      typeof raw.globalReferenceFilePath === 'string' ? raw.globalReferenceFilePath : '',
    eqSnapshots: parseEqSnapshots(raw.eqSnapshots),
    eqLiveStates: parseEqLiveStates(raw.eqLiveStates),
    aiEqRecommendations: parseAiEqRecommendations(raw.aiEqRecommendations),
    perTrackAiRecommendations: parsePerTrackAiRecommendations(raw.perTrackAiRecommendations),
    agentProvider: typeof raw.agentProvider === 'string' ? raw.agentProvider : '',
    agentModels: parseStringMapRecord(raw.agentModels),
    agentThinking: parseStringMapRecord(raw.agentThinking),
    agentSystemPrompt: typeof raw.agentSystemPrompt === 'string' ? raw.agentSystemPrompt : '',
    agentSttProvider: typeof raw.agentSttProvider === 'string' ? raw.agentSttProvider : '',
    listeningDevices: parseListeningDevices(raw.listeningDevices),
    activeListeningDeviceId:
      typeof raw.activeListeningDeviceId === 'string' && raw.activeListeningDeviceId.trim().length > 0
        ? raw.activeListeningDeviceId
        : null,
    referenceLevelMatchEnabled:
      typeof raw.referenceLevelMatchEnabled === 'boolean' ? raw.referenceLevelMatchEnabled : fallback.referenceLevelMatchEnabled,
    iCloudBackupEnabled:
      typeof raw.iCloudBackupEnabled === 'boolean' ? raw.iCloudBackupEnabled : fallback.iCloudBackupEnabled,
    autoUpdateEnabled:
      typeof raw.autoUpdateEnabled === 'boolean' ? raw.autoUpdateEnabled : fallback.autoUpdateEnabled,
    showAiRecommendationsFullscreen:
      typeof raw.showAiRecommendationsFullscreen === 'boolean'
        ? raw.showAiRecommendationsFullscreen
        : fallback.showAiRecommendationsFullscreen,
    songDawOffsets: parseSongDawOffsets(raw.songDawOffsets),
    // Migration: if the new "default" fields are missing but the legacy
    // app-global `checklistDawOffsetSeconds`/`checklistDawOffsetEnabled`
    // fields exist (v3.8.0 and earlier), copy them into the default so the
    // user's prior offset isn't dropped on upgrade.
    checklistDawOffsetDefaultSeconds: (() => {
      if (
        typeof raw.checklistDawOffsetDefaultSeconds === 'number' &&
        Number.isFinite(raw.checklistDawOffsetDefaultSeconds) &&
        raw.checklistDawOffsetDefaultSeconds >= 0
      ) {
        return Math.floor(raw.checklistDawOffsetDefaultSeconds);
      }
      if (
        typeof raw.checklistDawOffsetSeconds === 'number' &&
        Number.isFinite(raw.checklistDawOffsetSeconds) &&
        raw.checklistDawOffsetSeconds >= 0
      ) {
        return Math.floor(raw.checklistDawOffsetSeconds);
      }
      return fallback.checklistDawOffsetDefaultSeconds;
    })(),
    checklistDawOffsetDefaultEnabled: (() => {
      if (typeof raw.checklistDawOffsetDefaultEnabled === 'boolean') {
        return raw.checklistDawOffsetDefaultEnabled;
      }
      if (typeof raw.checklistDawOffsetEnabled === 'boolean') {
        return raw.checklistDawOffsetEnabled;
      }
      return fallback.checklistDawOffsetDefaultEnabled;
    })(),
    lastFileDialogDirectory:
      typeof raw.lastFileDialogDirectory === 'string' ? raw.lastFileDialogDirectory : '',
    windowBounds: parseWindowBounds(raw.windowBounds),
  };
}

// ---------------------------------------------------------------------------
// Atomic write helpers
// ---------------------------------------------------------------------------

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
    if (code !== 'EEXIST' && code !== 'EPERM') throw error;
    await fs.rm(filePath, { force: true });
    await fs.rename(tempPath, filePath);
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
  }
}

/**
 * Synchronous atomic JSON writer — used by the one-shot migration path
 * which MUST complete before the app finishes startup.
 */
function writeJsonAtomicSync(filePath: string, payload: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  writeFileSync(tempPath, serialized, 'utf8');
  try {
    renameSync(tempPath, filePath);
  } catch (error: unknown) {
    const code =
      typeof error === 'object' && error && 'code' in error
        ? String((error as { code?: unknown }).code)
        : null;
    if (code !== 'EEXIST' && code !== 'EPERM') throw error;
    try {
      unlinkSync(filePath);
    } catch { /* ignore */ }
    renameSync(tempPath, filePath);
  } finally {
    try {
      unlinkSync(tempPath);
    } catch { /* tmp already renamed/gone — fine */ }
  }
}

// ---------------------------------------------------------------------------
// v3.29 MVP split: monolithic → per-track files + global file
// ---------------------------------------------------------------------------

interface SplitLayoutPaths {
  stateDir: string;
  tracksDir: string;
  globalFile: string;
  sentinel: string;
  monolithic: string;
}

function getSplitLayoutPaths(userDataDir: string): SplitLayoutPaths {
  const stateDir = join(userDataDir, STATE_SUBDIR);
  return {
    stateDir,
    tracksDir: join(stateDir, TRACKS_SUBDIR),
    globalFile: join(stateDir, GLOBAL_STATE_FILE),
    sentinel: join(stateDir, MIGRATED_SENTINEL),
    monolithic: join(userDataDir, UNIFIED_STATE_FILE_NAME),
  };
}

/**
 * Split a parsed monolithic state into a (globalFields, trackBuckets) pair,
 * hoisting every songId-keyed sub-map under PER_TRACK_KEYS into its own
 * per-track bucket. Pure / synchronous — safe to unit test without disk I/O.
 */
export function splitStateForDisk(
  state: ProducerPlayerUserState,
): { globalFields: Record<string, unknown>; trackBuckets: Map<string, Record<string, unknown>> } {
  const globalFields: Record<string, unknown> = { ...(state as unknown as Record<string, unknown>) };
  const trackBuckets = new Map<string, Record<string, unknown>>();

  for (const key of PER_TRACK_KEYS) {
    const map = (state as unknown as Record<string, unknown>)[key];
    delete globalFields[key];
    if (!map || typeof map !== 'object' || Array.isArray(map)) continue;
    for (const [songId, val] of Object.entries(map as Record<string, unknown>)) {
      if (!songId) continue;
      let bucket = trackBuckets.get(songId);
      if (!bucket) {
        bucket = {};
        trackBuckets.set(songId, bucket);
      }
      bucket[key] = val;
    }
  }

  return { globalFields, trackBuckets };
}

/**
 * Reverse of `splitStateForDisk`: rebuild a single
 * Record<perTrackKey, Record<songId, val>> shape from
 * (global + per-track files), then re-run it through `parseUserState` so
 * any field drift is corrected.
 */
function reassembleSplitState(
  globalFields: Record<string, unknown>,
  trackFiles: { songId: string; data: Record<string, unknown> }[],
): ProducerPlayerUserState {
  const reconstructed: Record<string, unknown> = { ...globalFields };

  for (const key of PER_TRACK_KEYS) {
    // Seed with an empty object so `parseUserState` sees the key.
    if (!reconstructed[key] || typeof reconstructed[key] !== 'object' || Array.isArray(reconstructed[key])) {
      reconstructed[key] = {};
    }
  }

  for (const { songId, data } of trackFiles) {
    for (const key of PER_TRACK_KEYS) {
      if (!(key in data)) continue;
      const bucket = reconstructed[key] as Record<string, unknown>;
      bucket[songId] = data[key];
    }
  }

  return parseUserState(reconstructed);
}

/**
 * One-shot migration: if `state/.migrated` is absent, split the monolithic
 * `producer-player-user-state.json` into `state/global.json` +
 * `state/tracks/<songId>.json`. Safe to call unconditionally on every
 * startup — idempotent once the sentinel exists.
 *
 * Leaves the original monolithic file in place for backwards compatibility
 * and writes a permanent `*.bak-pre-split-<ts>` copy next to it before
 * touching anything.
 */
export function migrateStateIfNeeded(userDataDir: string): void {
  const paths = getSplitLayoutPaths(userDataDir);

  if (existsSync(paths.sentinel)) return; // already done

  if (!existsSync(paths.monolithic)) {
    // First-time install: initialize the new layout empty and mark migrated.
    mkdirSync(paths.tracksDir, { recursive: true });
    writeJsonAtomicSync(paths.globalFile, {});
    writeFileSync(paths.sentinel, '');
    log.info('[state-service] Fresh install — initialized empty split state layout');
    return;
  }

  log.info('[state-service] Migrating monolithic state → split layout (v3.29 MVP)');

  // 1. Permanent backup of the monolithic file.
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${paths.monolithic}.bak-pre-split-${ts}`;
  copyFileSync(paths.monolithic, backupPath);
  log.info(`[state-service] Wrote pre-split backup: ${backupPath}`);

  // 2. Parse monolithic through the validator so we split clean data.
  const raw = readFileSync(paths.monolithic, 'utf8');
  const parsed = parseUserState(JSON.parse(raw));

  // 3. Split.
  const { globalFields, trackBuckets } = splitStateForDisk(parsed);

  // 4. Write (atomic temp+rename per file).
  mkdirSync(paths.tracksDir, { recursive: true });
  for (const [songId, trackData] of trackBuckets) {
    writeJsonAtomicSync(join(paths.tracksDir, `${encodeSongIdForFilename(songId)}.json`), trackData);
  }
  writeJsonAtomicSync(paths.globalFile, globalFields);

  // 5. Sentinel last — so a crash mid-migration leaves the monolithic
  // readable and re-running the migration is safe.
  writeFileSync(paths.sentinel, '');
  log.info(
    `[state-service] Split migration complete: ${trackBuckets.size} per-track files + global.json`,
  );
}

/**
 * songIds come from the app's library scanner (and user-imported state) and
 * can contain arbitrary characters including slashes, `*`, `.`, and other
 * tokens that are unsafe as filenames on macOS/Linux/Windows. Encode every
 * id with base64url of its UTF-8 bytes so the mapping is injective (no
 * collisions) and the resulting filename is valid across all platforms.
 *
 * Codex 2026-04-18: base64url replaces an earlier percent-encoding scheme
 * that collided on ids like `.foo` vs `_.foo` and left `*` unescaped
 * (invalid on Windows).
 */
function encodeSongIdForFilename(songId: string): string {
  return Buffer.from(songId, 'utf8').toString('base64url');
}

function decodeSongIdFromFilename(baseName: string): string {
  try {
    return Buffer.from(baseName, 'base64url').toString('utf8');
  } catch {
    return baseName;
  }
}

// ---------------------------------------------------------------------------
// State Service
// ---------------------------------------------------------------------------

export class UserStateService {
  private stateDirectoryPath: string;
  private cachedState: ProducerPlayerUserState | null = null;
  /**
   * Serialization tail for every read-modify-write mutation on the user
   * state. All `patchUserState`, `setAiRecommendation`, `clearAiRecommendations`,
   * `markAiRecommendationsStale`, and `writeUserStatePreservingAiRecommendations`
   * calls enqueue their read+merge+write cycle here so concurrent callers
   * see a consistent view of disk.
   *
   * Codex-found (2026-04-18, 3 rounds of review):
   * - Round 1: `Promise.all` over per-metric writes raced on the AI-rec
   *   read-modify-write and lost sibling metrics.
   * - Round 2: `SET_USER_STATE` read the "preserve" slice before a concurrent
   *   AI-rec write landed, then wrote the stale slice back.
   * - Round 3: other `patchUserState` callers (window bounds, dialog
   *   directory, library service) could still stomp a just-written AI-rec
   *   slice via the same cached-then-stale window.
   *
   * Making this a shared mutation queue (rather than an AI-rec-only queue)
   * closes all three via a single mechanism and matches the reality that
   * every state write goes through the same disk/path.
   */
  private stateWriteTail: Promise<unknown> = Promise.resolve();

  constructor(stateDirectoryPath: string) {
    this.stateDirectoryPath = stateDirectoryPath;
  }

  /**
   * Queue a read-modify-write mutation so the entire cycle runs serially on
   * this service instance. Rejections are swallowed from the shared tail so
   * one failed mutation doesn't poison the chain for subsequent callers,
   * but the original promise returned to the caller still rejects normally.
   */
  private enqueueStateMutation<T>(task: () => Promise<T>): Promise<T> {
    const run = this.stateWriteTail.then(task, task);
    this.stateWriteTail = run.catch(() => undefined);
    return run;
  }

  /**
   * Write a full user state while preserving the latest on-disk
   * `perTrackAiRecommendations` value. Used by the renderer's debounced
   * full-state sync, which sends `{}` as a placeholder for AI recs.
   *
   * Codex-found (2026-04-18, round 2): without going through the AI-rec
   * write queue, a `SET_USER_STATE` invocation can race with a concurrent
   * `setAiRecommendation` — the full-state handler read `existing.perTrack...`
   * before the rec write flipped state, then writes that stale slice back.
   * Routing the preserve-and-write through the AI queue forces a happens-
   * after on any concurrent rec mutation.
   */
  async writeUserStatePreservingAiRecommendations(
    incoming: ProducerPlayerUserState,
  ): Promise<ProducerPlayerUserState> {
    return this.enqueueStateMutation(async () => {
      const current = await this.readUserState();
      const merged: ProducerPlayerUserState = {
        ...incoming,
        perTrackAiRecommendations: current.perTrackAiRecommendations,
      };
      return this.writeUserState(merged);
    });
  }

  getFilePath(): string {
    return join(this.stateDirectoryPath, UNIFIED_STATE_FILE_NAME);
  }

  private getSplitPaths(): SplitLayoutPaths {
    return getSplitLayoutPaths(this.stateDirectoryPath);
  }

  /** Whether the v3.29 split layout is active (sentinel present). */
  isSplitLayout(): boolean {
    return existsSync(this.getSplitPaths().sentinel);
  }

  /** Read the unified state from disk (cached after first read). */
  async readUserState(): Promise<ProducerPlayerUserState> {
    if (this.cachedState) return this.cachedState;

    if (this.isSplitLayout()) {
      this.cachedState = await this.readSplitState();
    } else {
      const filePath = this.getFilePath();
      try {
        const raw = await fs.readFile(filePath, 'utf8');
        this.cachedState = parseUserState(JSON.parse(raw));
      } catch {
        this.cachedState = createDefaultUserState();
      }
    }

    return this.cachedState;
  }

  /** Write the unified state atomically and update cache. */
  async writeUserState(state: ProducerPlayerUserState): Promise<ProducerPlayerUserState> {
    const validated = parseUserState(state);
    validated.updatedAt = new Date().toISOString();

    if (this.isSplitLayout()) {
      await this.writeSplitState(validated);
    } else {
      await writeJsonAtomic(this.getFilePath(), validated);
    }

    this.cachedState = validated;
    return validated;
  }

  /**
   * Apply a partial update (merge into current state, write). Serialized via
   * the shared state-mutation queue so concurrent patches and AI-rec writes
   * don't race on the read-modify-write cycle — see
   * `stateWriteTail` for the full history of this fix.
   */
  async patchUserState(patch: Partial<ProducerPlayerUserState>): Promise<ProducerPlayerUserState> {
    return this.enqueueStateMutation(() => this.patchUserStateUnlocked(patch));
  }

  /**
   * Internal: merge-and-write WITHOUT acquiring `stateWriteTail`. Callers
   * that already hold the lock (the AI-rec mutators,
   * `writeUserStatePreservingAiRecommendations`) use this to avoid
   * deadlocking against themselves.
   */
  private async patchUserStateUnlocked(
    patch: Partial<ProducerPlayerUserState>,
  ): Promise<ProducerPlayerUserState> {
    const current = await this.readUserState();
    const next: ProducerPlayerUserState = { ...current, ...patch };
    return this.writeUserState(next);
  }

  /** Force-refresh from disk. */
  invalidateCache(): void {
    this.cachedState = null;
  }

  /** Whether the unified state file exists on disk. */
  fileExists(): boolean {
    return existsSync(this.getFilePath()) || this.isSplitLayout();
  }

  // -----------------------------------------------------------------------
  // v3.30 — AI mastering recommendations (storage API; UI lands in v3.31+)
  //
  // Recommendations are nested under
  //   state.perTrackAiRecommendations[songId][String(versionNumber)]
  // which piggybacks on the v3.29 split-to-disk pipeline: because
  // `perTrackAiRecommendations` is listed in PER_TRACK_KEYS, writes go into
  // `state/tracks/<base64url(songId)>.json` automatically.
  // -----------------------------------------------------------------------

  /**
   * Read the recommendation set for one (songId, versionNumber) slot.
   * Returns `null` if nothing has been stored for that combination so
   * callers can distinguish "no run yet" from "run returned no metrics".
   */
  async getAiRecommendations(
    songId: string,
    versionNumber: number,
  ): Promise<AiRecommendationSet | null> {
    if (!songId || songId.length === 0) return null;
    if (!Number.isFinite(versionNumber) || !Number.isInteger(versionNumber) || versionNumber < 0) {
      return null;
    }
    const state = await this.readUserState();
    const perSong = state.perTrackAiRecommendations[songId];
    if (!perSong) return null;
    const slot = perSong[String(versionNumber)];
    return slot ? slot.recommendations : null;
  }

  /**
   * Set a single metric recommendation for (songId, versionNumber, metricId).
   * Creates the outer and inner containers on demand. Flips
   * `aiRecommendedFlag` to `true` iff the set now contains at least one
   * `'fresh'` rec. Updates `lastRunAt` to the rec's `generatedAt`.
   *
   * Serialized via `enqueueStateMutation` so concurrent callers
   * (e.g. `Promise.all` over a full recommendation set from one agent run)
   * don't stomp on each other's sibling metrics.
   */
  async setAiRecommendation(
    songId: string,
    versionNumber: number,
    metricId: string,
    recommendation: AiRecommendation,
  ): Promise<void> {
    if (!songId || songId.length === 0) return;
    if (!metricId || metricId.length === 0) return;
    if (!Number.isFinite(versionNumber) || !Number.isInteger(versionNumber) || versionNumber < 0) {
      return;
    }

    return this.enqueueStateMutation(async () => {
      const state = await this.readUserState();
      const perSong = { ...(state.perTrackAiRecommendations[songId] ?? {}) };
      const versionKey = String(versionNumber);
      const existingSlot = perSong[versionKey] ?? {
        recommendations: {},
        aiRecommendedFlag: false,
        lastRunAt: null,
      };
      const nextRecommendations: AiRecommendationSet = {
        ...existingSlot.recommendations,
        [metricId]: recommendation,
      };
      const hasFresh = Object.values(nextRecommendations).some((r) => r.status === 'fresh');
      perSong[versionKey] = {
        recommendations: nextRecommendations,
        aiRecommendedFlag: hasFresh,
        lastRunAt: recommendation.generatedAt,
      };

      await this.patchUserStateUnlocked({
        perTrackAiRecommendations: {
          ...state.perTrackAiRecommendations,
          [songId]: perSong,
        },
      });
    });
  }

  /**
   * Wipe recommendations for a song. When `versionNumber` is provided, only
   * that version's slot is cleared and other versions are preserved. When
   * `versionNumber` is omitted, every version for the song is removed.
   *
   * Serialized alongside `setAiRecommendation` so a clear cannot race with
   * a concurrent write.
   */
  async clearAiRecommendations(songId: string, versionNumber?: number): Promise<void> {
    if (!songId || songId.length === 0) return;
    return this.enqueueStateMutation(async () => {
      const state = await this.readUserState();
      const perSong = state.perTrackAiRecommendations[songId];
      if (!perSong) return;

      const nextPerTrack = { ...state.perTrackAiRecommendations };

      if (versionNumber === undefined) {
        delete nextPerTrack[songId];
      } else {
        if (
          !Number.isFinite(versionNumber) ||
          !Number.isInteger(versionNumber) ||
          versionNumber < 0
        ) {
          return;
        }
        const versionKey = String(versionNumber);
        if (!(versionKey in perSong)) return;
        const nextPerSong = { ...perSong };
        delete nextPerSong[versionKey];
        if (Object.keys(nextPerSong).length === 0) {
          delete nextPerTrack[songId];
        } else {
          nextPerTrack[songId] = nextPerSong;
        }
      }

      await this.patchUserStateUnlocked({ perTrackAiRecommendations: nextPerTrack });
    });
  }

  /**
   * When the analysis fingerprint for a (songId, versionNumber) changes,
   * flip every rec whose stored `analysisVersion` differs from
   * `newAnalysisVersion` to `status: 'stale'`. Recs whose analysisVersion
   * already matches (race: another code path re-ran against the new
   * analysis) are left untouched.
   *
   * Recs are KEPT, not deleted — users may still find them useful as a
   * historical baseline. The UI treats 'stale' as a muted / dimmed render.
   *
   * Also clears `aiRecommendedFlag` when no fresh recs remain.
   */
  async markAiRecommendationsStale(
    songId: string,
    versionNumber: number,
    newAnalysisVersion: string,
  ): Promise<void> {
    if (!songId || songId.length === 0) return;
    if (!Number.isFinite(versionNumber) || !Number.isInteger(versionNumber) || versionNumber < 0) {
      return;
    }
    if (typeof newAnalysisVersion !== 'string' || newAnalysisVersion.length === 0) return;

    return this.enqueueStateMutation(async () => {
      const state = await this.readUserState();
      const perSong = state.perTrackAiRecommendations[songId];
      if (!perSong) return;
      const versionKey = String(versionNumber);
      const slot = perSong[versionKey];
      if (!slot) return;

      const nextRecommendations: AiRecommendationSet = {};
      let touched = false;
      for (const [metricId, rec] of Object.entries(slot.recommendations)) {
        if (rec.analysisVersion !== newAnalysisVersion && rec.status !== 'stale') {
          nextRecommendations[metricId] = { ...rec, status: 'stale' };
          touched = true;
        } else {
          nextRecommendations[metricId] = rec;
        }
      }

      if (!touched) return;

      const hasFresh = Object.values(nextRecommendations).some((r) => r.status === 'fresh');
      const nextPerSong = {
        ...perSong,
        [versionKey]: {
          ...slot,
          recommendations: nextRecommendations,
          aiRecommendedFlag: hasFresh,
        },
      };

      await this.patchUserStateUnlocked({
        perTrackAiRecommendations: {
          ...state.perTrackAiRecommendations,
          [songId]: nextPerSong,
        },
      });
    });
  }

  // -----------------------------------------------------------------------
  // Split layout read / write (v3.29 MVP)
  // -----------------------------------------------------------------------

  private async readSplitState(): Promise<ProducerPlayerUserState> {
    const paths = this.getSplitPaths();

    let globalFields: Record<string, unknown> = {};
    try {
      const raw = await fs.readFile(paths.globalFile, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        globalFields = parsed as Record<string, unknown>;
      }
    } catch {
      // Missing/corrupt global.json — fall back to an empty global slice so
      // per-track data still loads. Phase 1.5 will add corrupt-recovery.
    }

    const trackFiles: { songId: string; data: Record<string, unknown> }[] = [];
    try {
      const entries = await fs.readdir(paths.tracksDir);
      await Promise.all(
        entries
          .filter((name) => name.endsWith('.json'))
          .map(async (name) => {
            try {
              const raw = await fs.readFile(join(paths.tracksDir, name), 'utf8');
              const parsed = JSON.parse(raw);
              if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                const songId = decodeSongIdFromFilename(name.slice(0, -'.json'.length));
                trackFiles.push({ songId, data: parsed as Record<string, unknown> });
              }
            } catch {
              // Skip corrupt/unreadable per-track file; Phase 1.5 adds recovery.
              log.warn(`[state-service] Skipped unreadable track file: ${name}`);
            }
          }),
      );
    } catch {
      // tracksDir missing — treat as no tracks.
    }

    return reassembleSplitState(globalFields, trackFiles);
  }

  private async writeSplitState(state: ProducerPlayerUserState): Promise<void> {
    const paths = this.getSplitPaths();
    const { globalFields, trackBuckets } = splitStateForDisk(state);

    await fs.mkdir(paths.tracksDir, { recursive: true });

    // Write global + per-track files. Use the existing async atomic helper
    // so each file flips from old→new in one rename.
    await writeJsonAtomic(paths.globalFile, globalFields);

    const wantedFilenames = new Set<string>();
    for (const [songId, trackData] of trackBuckets) {
      const filename = `${encodeSongIdForFilename(songId)}.json`;
      wantedFilenames.add(filename);
      await writeJsonAtomic(join(paths.tracksDir, filename), trackData);
    }

    // Prune per-track files for songs that are no longer present. We never
    // touch `.migrated` or anything that doesn't end in .json.
    try {
      const existing = await fs.readdir(paths.tracksDir);
      for (const name of existing) {
        if (!name.endsWith('.json')) continue;
        if (wantedFilenames.has(name)) continue;
        await fs.unlink(join(paths.tracksDir, name)).catch(() => undefined);
      }
    } catch {
      // tracksDir read error — non-fatal for this write.
    }

    // v3.29 MVP: also mirror the full state to the monolithic file. The
    // split layout is authoritative on read, but several surfaces (E2E
    // tests, ad-hoc inspection, iCloud backup) still read the monolithic
    // path directly. Phase 1.5 will decide whether to retire the mirror.
    await writeJsonAtomic(paths.monolithic, state);
  }

  // -----------------------------------------------------------------------
  // Migration from old format
  // -----------------------------------------------------------------------

  /**
   * Migrate from the old split-file format into the unified format.
   * Called on app startup if the unified file does not yet exist.
   *
   * @param electronStatePath   Path to the old `producer-player-electron-state.json`
   * @param sharedUserStatePath Path to the old `producer-player-shared-user-state.json`
   * @param rendererLocalStorageData  Keys extracted from renderer localStorage via IPC
   */
  async migrateFromOldFormat(
    electronStatePath: string,
    sharedUserStatePath: string,
    rendererLocalStorageData: Record<string, string>,
  ): Promise<ProducerPlayerUserState> {
    log.info('[state-service] Starting migration from old format to unified state');

    const state = createDefaultUserState();

    // --- Read old electron state ---
    try {
      const raw = JSON.parse(await fs.readFile(electronStatePath, 'utf8'));
      if (isRecord(raw)) {
        if (Array.isArray(raw.linkedFolderPaths)) {
          const bookmarks = isRecord(raw.linkedFolderBookmarks) ? raw.linkedFolderBookmarks : {};
          state.linkedFolders = raw.linkedFolderPaths
            .filter((v): v is string => typeof v === 'string' && v.length > 0)
            .map((p) => {
              const resolvedPath = resolve(p);
              const bookmarkData = typeof bookmarks[resolvedPath] === 'string' ? bookmarks[resolvedPath] as string : undefined;
              return { path: resolvedPath, bookmarkData };
            });
        }
        if (Array.isArray(raw.songOrder)) {
          state.songOrder = raw.songOrder.filter((v): v is string => typeof v === 'string' && v.length > 0);
        }
        if (typeof raw.autoMoveOld === 'boolean') {
          state.autoMoveOld = raw.autoMoveOld;
        }
      }
    } catch {
      log.info('[state-service] No old electron state file found, skipping');
    }

    // --- Read old shared user state ---
    try {
      const raw = JSON.parse(await fs.readFile(sharedUserStatePath, 'utf8'));
      if (isRecord(raw)) {
        state.songRatings = parseSongRatings(raw.ratings);
        state.songChecklists = parseSongChecklists(raw.checklists);
        state.songProjectFilePaths = parseSongProjectFilePaths(raw.projectFilePaths);
      }
    } catch {
      log.info('[state-service] No old shared user state file found, skipping');
    }

    // --- Read renderer localStorage data ---
    this.mergeRendererLocalStorage(state, rendererLocalStorageData);

    state.updatedAt = new Date().toISOString();
    await this.writeUserState(state);

    log.info('[state-service] Migration complete — unified state written');
    return state;
  }

  /** Merge data extracted from renderer localStorage into a state object. */
  mergeRendererLocalStorage(
    state: ProducerPlayerUserState,
    data: Record<string, string>,
  ): void {
    // Song ratings (merge, don't overwrite if shared state had them)
    try {
      const raw = data['producer-player.song-ratings.v1'];
      if (raw) {
        const parsed = parseSongRatings(JSON.parse(raw));
        for (const [id, rating] of Object.entries(parsed)) {
          if (!(id in state.songRatings)) state.songRatings[id] = rating;
        }
      }
    } catch { /* ignore */ }

    // Song checklists (merge)
    try {
      const raw = data['producer-player.song-checklists.v1'];
      if (raw) {
        const parsed = parseSongChecklists(JSON.parse(raw));
        for (const [id, items] of Object.entries(parsed)) {
          if (!(id in state.songChecklists) || state.songChecklists[id].length === 0) {
            state.songChecklists[id] = items;
          }
        }
      }
    } catch { /* ignore */ }

    // Song project file paths (merge)
    try {
      const raw = data['producer-player.song-project-file-paths.v1'];
      if (raw) {
        const parsed = parseSongProjectFilePaths(JSON.parse(raw));
        for (const [id, path] of Object.entries(parsed)) {
          if (!(id in state.songProjectFilePaths)) state.songProjectFilePaths[id] = path;
        }
      }
    } catch { /* ignore */ }

    // Album title
    const albumTitle = data['producer-player.album-title.v1'];
    if (albumTitle && albumTitle.length > 0) {
      state.albumTitle = albumTitle;
    }

    // Album art (data URL)
    const albumArt = data['producer-player.album-art.v1'];
    if (albumArt && albumArt.length > 0) {
      state.albumArtDataUrl = albumArt;
    }

    // Album checklists
    try {
      const raw = data['producer-player.album-checklist.v1'];
      if (raw) {
        state.albumChecklists = parseAlbumChecklists(JSON.parse(raw));
      }
    } catch { /* ignore */ }

    // Saved reference tracks
    try {
      const raw = data['producer-player.saved-reference-tracks.v1'];
      if (raw) {
        state.savedReferenceTracks = parseSavedReferenceTracks(JSON.parse(raw));
      }
    } catch { /* ignore */ }

    // Per-song reference tracks (dynamic keys).
    // v3.22.0: the new globally-picked reference lives at
    // `producer-player.reference-track-global.v1` — NOT a per-song entry.
    // Treat it specially and skip so the global pick doesn't get stored
    // under a fake "-global.v1" songId.
    const globalRefKey = 'producer-player.reference-track-global.v1';
    const refPrefix = 'producer-player.reference-track.';
    for (const [key, value] of Object.entries(data)) {
      if (key === globalRefKey) {
        if (value.length > 0) state.globalReferenceFilePath = value;
        continue;
      }
      if (key.startsWith(refPrefix) && value.length > 0) {
        const songId = key.slice(refPrefix.length);
        if (songId.length > 0) {
          state.perSongReferenceTracks[songId] = value;
        }
      }
    }

    // Per-song "restore reference on open" toggle (dynamic keys, v3.16.0+).
    // Stored as '1' / '0' strings. Absent = default OFF.
    const restorePrefix = 'producer-player.restore-reference.';
    for (const [key, value] of Object.entries(data)) {
      if (key.startsWith(restorePrefix) && value.length > 0) {
        const songId = key.slice(restorePrefix.length);
        if (songId.length > 0) {
          state.perSongRestoreReferenceEnabled[songId] = value === '1';
        }
      }
    }

    // Agent provider
    const agentProvider = data['producer-player.agent-provider'];
    if (agentProvider && agentProvider.length > 0) {
      state.agentProvider = agentProvider;
    }

    // Agent models (dynamic keys)
    const modelPrefix = 'producer-player.agent-model.';
    for (const [key, value] of Object.entries(data)) {
      if (key.startsWith(modelPrefix) && value.length > 0) {
        const provider = key.slice(modelPrefix.length);
        if (provider.length > 0) state.agentModels[provider] = value;
      }
    }

    // Agent thinking (dynamic keys)
    const thinkingPrefix = 'producer-player.agent-thinking.';
    for (const [key, value] of Object.entries(data)) {
      if (key.startsWith(thinkingPrefix) && value.length > 0) {
        const provider = key.slice(thinkingPrefix.length);
        if (provider.length > 0) state.agentThinking[provider] = value;
      }
    }

    // Agent system prompt
    const systemPrompt = data['producer-player.agent-system-prompt'];
    if (systemPrompt && systemPrompt.length > 0) {
      state.agentSystemPrompt = systemPrompt;
    }

    // Agent STT provider
    const sttProvider = data['producer-player.agent-stt-provider'];
    if (sttProvider && sttProvider.length > 0) {
      state.agentSttProvider = sttProvider;
    }

    // Reference level match
    const refLevelMatch = data['producer-player.reference-level-match.v1'];
    if (refLevelMatch !== undefined && refLevelMatch !== null) {
      state.referenceLevelMatchEnabled = refLevelMatch === 'true';
    }

    // iCloud backup enabled
    const iCloudEnabled = data['producer-player.icloud-backup-enabled.v1'];
    if (iCloudEnabled !== undefined && iCloudEnabled !== null) {
      state.iCloudBackupEnabled = iCloudEnabled === 'true';
    }

    // Auto-update enabled
    const autoUpdate = data['producer-player.auto-update-enabled.v1'];
    if (autoUpdate !== undefined && autoUpdate !== null) {
      state.autoUpdateEnabled = autoUpdate !== 'false'; // default true
    }
  }
}
