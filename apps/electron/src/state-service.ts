/**
 * Unified user state service.
 *
 * Reads/writes `producer-player-user-state.json` as the single source of truth
 * for all user-authored data. Provides migration from the old split format
 * (electron-state.json + shared-user-state.json + renderer localStorage keys).
 */
import { existsSync, promises as fs } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import log from 'electron-log/main';
import type {
  AlbumChecklistItem,
  EqSnapshot,
  ListeningDevice,
  PersistedEqLiveState,
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
// Atomic write helper
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

// ---------------------------------------------------------------------------
// State Service
// ---------------------------------------------------------------------------

export class UserStateService {
  private stateDirectoryPath: string;
  private cachedState: ProducerPlayerUserState | null = null;

  constructor(stateDirectoryPath: string) {
    this.stateDirectoryPath = stateDirectoryPath;
  }

  getFilePath(): string {
    return join(this.stateDirectoryPath, UNIFIED_STATE_FILE_NAME);
  }

  /** Read the unified state from disk (cached after first read). */
  async readUserState(): Promise<ProducerPlayerUserState> {
    if (this.cachedState) return this.cachedState;

    const filePath = this.getFilePath();
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      this.cachedState = parseUserState(JSON.parse(raw));
    } catch {
      this.cachedState = createDefaultUserState();
    }

    return this.cachedState;
  }

  /** Write the unified state atomically and update cache. */
  async writeUserState(state: ProducerPlayerUserState): Promise<ProducerPlayerUserState> {
    const validated = parseUserState(state);
    validated.updatedAt = new Date().toISOString();
    await writeJsonAtomic(this.getFilePath(), validated);
    this.cachedState = validated;
    return validated;
  }

  /** Apply a partial update (merge into current state, write). */
  async patchUserState(patch: Partial<ProducerPlayerUserState>): Promise<ProducerPlayerUserState> {
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
    return existsSync(this.getFilePath());
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
