import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type WheelEvent,
} from 'react';
import type {
  AudioFileAnalysis,
  ICloudAvailabilityResult,
  ICloudBackupData,
  LibrarySnapshot,
  PlaylistOrderExportV1,
  PlaybackSourceInfo,
  ProducerPlayerEnvironment,
  ReferenceTrackSelection,
  SongChecklistItem,
  SongVersion,
  SongWithVersions,
  TransportCommand,
  UpdateCheckResult,
} from '@producer-player/contracts';
import {
  analyzeTrackFromUrl,
  estimateShortTermLufs,
  type TrackAnalysisResult,
} from './audioAnalysis';
import {
  computePlatformNormalizationPreview,
  gainDbToLinear,
  getNormalizationPlatformProfile,
  NORMALIZATION_PLATFORM_PROFILES,
  type NormalizationPlatformId,
} from './platformNormalization';
import {
  mergeLegacyAndSharedUserState,
  sanitizeSongChecklists,
  sanitizeSongRatings,
} from './sharedUserState';
import {
  computeSongDateOpacitiesByAge,
  SONG_DATE_OPACITY_RANGE,
} from './songAgeOpacity';
import producerPlayerIconUrl from '../../../assets/icon/source/producer-player-icon.svg';
import packageMetadata from '../../../package.json';
import { ENABLE_AGENT_FEATURES, SHOW_3000AD_BRANDING } from './featureFlags';
import { SpectrumAnalyzer } from './SpectrumAnalyzer';
import { LevelMeter } from './LevelMeter';
import { LoudnessHistoryGraph } from './LoudnessHistoryGraph';
import { WaveformDisplay } from './WaveformDisplay';
import { StereoCorrelationMeter } from './StereoCorrelationMeter';
import { Vectorscope } from './Vectorscope';
import { CrestFactorGraph } from './CrestFactorGraph';
import { MidSideSpectrum } from './MidSideSpectrum';
import { LoudnessHistogram } from './LoudnessHistogram';
import { Spectrogram } from './Spectrogram';
import { FREQUENCY_BANDS, createBandSoloFilter } from './audioEngine';
import { HelpTooltip } from './HelpTooltip';
import { AgentChatPanel } from './AgentChatPanel';
import type { AgentContext } from '@producer-player/contracts';
import {
  LUFS_LINKS,
  TRUE_PEAK_LINKS,
  LRA_LINKS,
  STEREO_CORRELATION_LINKS,
  SPECTRUM_ANALYZER_LINKS,
  LEVEL_METER_LINKS,
  WAVEFORM_LINKS,
  VECTORSCOPE_LINKS,
  PLATFORM_NORMALIZATION_LINKS,
  REFERENCE_TRACK_LINKS,
  MID_SIDE_LINKS,
  K_METERING_LINKS,
  CREST_FACTOR_LINKS,
  DC_OFFSET_LINKS,
  DYNAMIC_RANGE_LINKS,
  TONAL_BALANCE_LINKS,
  LOUDNESS_HISTORY_LINKS,
  CLIP_COUNT_LINKS,
  MEAN_VOLUME_LINKS,
  MASTERING_CHECKLIST_LINKS,
  CREST_FACTOR_HISTORY_LINKS,
  MID_SIDE_SPECTRUM_LINKS,
  LOUDNESS_HISTOGRAM_LINKS,
  SPECTROGRAM_LINKS,
} from './helpTooltipLinks';

type RepeatMode = 'off' | 'one' | 'all';
type DragOverPosition = 'before' | 'after';

type ReferenceTrackSource = 'linked-track' | 'external-file';

interface LoadedReferenceTrack {
  sourceType: ReferenceTrackSource;
  filePath: string;
  fileName: string;
  subtitle: string;
  playbackSource: PlaybackSourceInfo;
  previewAnalysis: TrackAnalysisResult;
  measuredAnalysis: AudioFileAnalysis;
}

interface SavedReferenceTrackEntry {
  filePath: string;
  fileName: string;
  dateLastUsed: string;
  integratedLufs: number | null;
}

const EMPTY_SNAPSHOT: LibrarySnapshot = {
  linkedFolders: [],
  songs: [],
  versions: [],
  status: 'idle',
  statusMessage: 'No folders linked yet.',
  scannedAt: null,
  matcherSettings: {
    autoMoveOld: true,
  },
};

const EMPTY_ENVIRONMENT: ProducerPlayerEnvironment = {
  isMacAppStoreSandboxed: false,
  canLinkFolderByPath: true,
  canRequestSecurityScopedBookmarks: false,
  isTestMode: false,
};

const REPEAT_MODE_LABEL: Record<RepeatMode, string> = {
  off: 'Off',
  one: 'One',
  all: 'All',
};

const PLAYBACK_LOAD_TIMEOUT_MS = 4500;
const PLAYHEAD_END_RESET_MIN_THRESHOLD_SECONDS = 1;
const PLAYHEAD_END_RESET_MAX_THRESHOLD_SECONDS = 5;
const PLAYHEAD_END_RESET_DURATION_RATIO = 0.05;
const PREVIOUS_TRACK_RESTART_THRESHOLD_SECONDS = 2;
const DEFAULT_PLAYBACK_VOLUME = 1;
const DEFAULT_SONG_RATING = 5;
const SONG_RATINGS_STORAGE_KEY = 'producer-player.song-ratings.v1';
const SONG_CHECKLISTS_STORAGE_KEY = 'producer-player.song-checklists.v1';
const ICLOUD_BACKUP_ENABLED_KEY = 'producer-player.icloud-backup-enabled.v1';
const ICLOUD_LAST_SYNC_KEY = 'producer-player.icloud-last-sync.v1';
const SAVED_REFERENCE_TRACKS_KEY = 'producer-player.saved-reference-tracks.v1';
const REFERENCE_TRACK_PER_SONG_KEY_PREFIX = 'producer-player.reference-track.';
const RECENT_REFERENCE_TRACKS_KEY = 'producer-player.recent-reference-tracks.v1';
const MAX_RECENT_REFERENCE_TRACKS = 3;
const ALBUM_TITLE_STORAGE_KEY = 'producer-player.album-title.v1';
const ALBUM_ART_STORAGE_KEY = 'producer-player.album-art.v1';
const MORE_METRICS_EXPANDED_KEY = 'producer-player.more-metrics-expanded.v1';
const MAX_SAVED_REFERENCE_TRACKS = 20;
const PUBLIC_REPOSITORY_URL = 'https://github.com/EthanSK/producer-player';
const PUBLIC_REPOSITORY_ACTIONS_URL = `${PUBLIC_REPOSITORY_URL}/actions`;
const PUBLIC_PAGES_URL = 'https://ethansk.github.io/producer-player/';
const BUG_REPORT_URL = `${PUBLIC_REPOSITORY_URL}/issues/new?template=bug_report.yml`;
const FEATURE_REQUEST_URL = `${PUBLIC_REPOSITORY_URL}/issues/new?template=feature_request.yml`;

function PlatformIcon({ platformId }: { platformId: NormalizationPlatformId }): JSX.Element {
  switch (platformId) {
    case 'spotify':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M6.1 8.8c3.9-1.2 8.4-.8 11.8 1" />
          <path d="M7.1 12c3.1-.8 6.8-.5 9.4.8" />
          <path d="M8.2 15.1c2.3-.5 4.8-.3 6.7.6" />
        </svg>
      );
    case 'appleMusic':
      return <span aria-hidden="true">♫</span>;
    case 'youtube':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <rect x="3.2" y="6.4" width="17.6" height="11.2" rx="3.6" ry="3.6" />
          <path d="M10 9.2 15.4 12 10 14.8Z" className="platform-icon-fill" />
        </svg>
      );
    case 'tidal':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M12 4.2 8.2 8 12 11.8 15.8 8Z" className="platform-icon-fill" />
          <path d="M8 8.2 4.2 12 8 15.8 11.8 12Z" className="platform-icon-fill" />
          <path d="M16 8.2 12.2 12 16 15.8 19.8 12Z" className="platform-icon-fill" />
          <path d="M12 12.2 8.2 16 12 19.8 15.8 16Z" className="platform-icon-fill" />
        </svg>
      );
    case 'amazon':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M6 15c3 2 9 2 12 0" />
          <path d="M15.5 15.5 18 14" />
          <circle cx="12" cy="10" r="5" />
        </svg>
      );
    default:
      return <span aria-hidden="true">♪</span>;
  }
}

function reorderSongIds(
  songIds: string[],
  dragSongId: string,
  hoveredSongId: string,
  position: DragOverPosition
): string[] {
  if (dragSongId === hoveredSongId) {
    return songIds;
  }

  const sourceIndex = songIds.indexOf(dragSongId);
  const targetIndex = songIds.indexOf(hoveredSongId);

  if (sourceIndex === -1 || targetIndex === -1) {
    return songIds;
  }

  const withoutSource = [...songIds];
  withoutSource.splice(sourceIndex, 1);

  const insertionTargetIndex = withoutSource.indexOf(hoveredSongId);
  if (insertionTargetIndex === -1) {
    return songIds;
  }

  const insertionIndex =
    position === 'after' ? insertionTargetIndex + 1 : insertionTargetIndex;

  withoutSource.splice(insertionIndex, 0, dragSongId);
  return withoutSource;
}

function describeMediaErrorCode(code: number | undefined): string {
  switch (code) {
    case 1:
      return 'MEDIA_ERR_ABORTED';
    case 2:
      return 'MEDIA_ERR_NETWORK';
    case 3:
      return 'MEDIA_ERR_DECODE';
    case 4:
      return 'MEDIA_ERR_SRC_NOT_SUPPORTED';
    default:
      return 'UNKNOWN_MEDIA_ERROR';
  }
}

function buildPlaybackFallbackGuidance(source: PlaybackSourceInfo | null): string {
  const extension = source?.extension ? `.${source.extension}` : 'this file';
  return `Try re-exporting as WAV, MP3, or AAC (.m4a) and rescan.`;
}

function getPathTail(value: string | null | undefined): string {
  if (!value) {
    return 'this file';
  }

  const segments = value.split(/[/\\]/).filter(Boolean);
  return segments[segments.length - 1] ?? value;
}

function buildMissingFileMessage(filePath: string | null | undefined): string {
  return `Couldn’t find ${getPathTail(filePath)} on disk. Rescan or relink the folder.`;
}

function formatDate(value: string | null): string {
  if (!value) {
    return '—';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '—';
  }

  return parsed.toLocaleString();
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0:00';
  }

  const rounded = Math.floor(seconds);
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

function clampTimestampSeconds(
  seconds: number,
  durationSeconds?: number,
  offsetSeconds = 0
): number | null {
  if (!Number.isFinite(seconds)) {
    return null;
  }

  const maxDuration =
    typeof durationSeconds === 'number' && Number.isFinite(durationSeconds)
      ? Math.max(0, Math.floor(durationSeconds))
      : null;
  const withOffset = Math.floor(seconds - offsetSeconds);
  const clamped = Math.max(0, maxDuration === null ? withOffset : Math.min(withOffset, maxDuration));
  return Number.isFinite(clamped) ? clamped : null;
}

const CHECKLIST_CAPTURE_LOOKBACK_SECONDS = 3;
const CHECKLIST_TIMESTAMP_HIGHLIGHT_DURATION_MS = 1200;
const CHECKLIST_HISTORY_LIMIT = 100;
const PLAYER_DOCK_PREVIEW_VISUAL_WIDTH = 180;

function cloneSongChecklistsState(
  checklists: Record<string, SongChecklistItem[]>
): Record<string, SongChecklistItem[]> {
  return Object.fromEntries(
    Object.entries(checklists).map(([songId, items]) => [
      songId,
      items.map((item) => ({ ...item })),
    ])
  );
}

function isTextEntryElement(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  if (element.isContentEditable) {
    return true;
  }

  if (element.tagName === 'TEXTAREA') {
    return true;
  }

  if (element.tagName !== 'INPUT') {
    return false;
  }

  const inputType = (element as HTMLInputElement).type.toLowerCase();
  return (
    inputType === 'text' ||
    inputType === 'search' ||
    inputType === 'email' ||
    inputType === 'password' ||
    inputType === 'url' ||
    inputType === 'tel' ||
    inputType === 'number'
  );
}

function isUnmodifiedShiftTab(
  event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'metaKey' | 'ctrlKey' | 'altKey'>
): boolean {
  return (
    event.key === 'Tab' &&
    event.shiftKey &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey
  );
}

function canElementScroll(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  const canScrollY =
    (style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflowY === 'overlay') &&
    element.scrollHeight > element.clientHeight + 1;
  const canScrollX =
    (style.overflowX === 'auto' || style.overflowX === 'scroll' || style.overflowX === 'overlay') &&
    element.scrollWidth > element.clientWidth + 1;

  return canScrollY || canScrollX;
}

function isPointWithinElementBounds(element: HTMLElement, clientX: number, clientY: number): boolean {
  const rect = element.getBoundingClientRect();

  return (
    clientX >= rect.left &&
    clientX <= rect.right &&
    clientY >= rect.top &&
    clientY <= rect.bottom
  );
}

function findNearestScrollableElement(element: Element | null): HTMLElement | null {
  let currentElement = element instanceof HTMLElement ? element : null;

  while (currentElement) {
    if (canElementScroll(currentElement)) {
      return currentElement;
    }

    currentElement = currentElement.parentElement;
  }

  return document.scrollingElement instanceof HTMLElement
    ? document.scrollingElement
    : null;
}

function formatTrackCount(count: number): string {
  return `${count} track${count === 1 ? '' : 's'}`;
}

function formatLibraryStatusLabel(status: LibrarySnapshot['status']): string {
  switch (status) {
    case 'watching':
      return 'Ready';
    case 'scanning':
      return 'Updating';
    case 'error':
      return 'Needs attention';
    default:
      return 'Waiting for a folder';
  }
}

function sortVersions(versions: SongVersion[]): SongVersion[] {
  return [...versions].sort(
    (left, right) =>
      new Date(right.modifiedAt).getTime() - new Date(left.modifiedAt).getTime()
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatSignedLevel(level: number | null | undefined): string {
  if (level === null || level === undefined || !Number.isFinite(level)) {
    return '—';
  }

  return `${level >= 0 ? '+' : ''}${level.toFixed(1)} dB`;
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) {
    return '0%';
  }

  return `${Math.round(value * 100)}%`;
}

function formatMeasuredStat(level: number | null | undefined, unit: string): string {
  if (level === null || level === undefined || !Number.isFinite(level)) {
    return '—';
  }

  return `${level.toFixed(1)} ${unit}`;
}

function formatSampleRateHz(sampleRateHz: number | null | undefined): string {
  if (sampleRateHz === null || sampleRateHz === undefined || !Number.isFinite(sampleRateHz)) {
    return '—';
  }

  const kilohertz = sampleRateHz / 1_000;
  const roundedKilohertz = Math.round(kilohertz * 10) / 10;
  const formattedKilohertz = Number.isInteger(roundedKilohertz)
    ? roundedKilohertz.toFixed(0)
    : roundedKilohertz.toFixed(1);

  return `${formattedKilohertz} kHz`;
}

function buildAnalysisValue(
  status: 'idle' | 'loading' | 'ready' | 'error',
  value: string,
  options: { loading?: string; empty?: string; error?: string } = {}
): string {
  if (status === 'loading') {
    return options.loading ?? 'Loading…';
  }

  if (status === 'error') {
    return options.error ?? 'Unavailable';
  }

  if (status === 'idle') {
    return options.empty ?? '—';
  }

  return value;
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

function getActiveSongVersion(song: SongWithVersions): SongVersion | null {
  if (song.activeVersionId) {
    const matched = song.versions.find((version) => version.id === song.activeVersionId);
    if (matched) {
      return matched;
    }
  }

  return sortVersions(song.versions)[0] ?? null;
}

function getPreferredPlaybackVersionId(song: SongWithVersions): string | null {
  return getActiveSongVersion(song)?.id ?? null;
}

function getSongDisplayFileName(song: SongWithVersions): string {
  return getActiveSongVersion(song)?.fileName ?? song.title;
}

function getSongDisplayTitle(song: SongWithVersions): string {
  const activeVersion = getActiveSongVersion(song);
  if (!activeVersion) {
    return song.title;
  }

  const stem = activeVersion.fileName.replace(/\.[^.]+$/, '');
  const match = stem.match(/^(.*?)(?:[\s_-]?v\d+)(?:[\s_-]*archived[\s_-]*\d+)?$/i);
  const title = (match?.[1] ?? stem).trim();

  if (title.length > 0) {
    return title;
  }

  return stem.trim() || song.title;
}

function getVersionTagFromFileName(fileName: string): string | null {
  const stem = fileName.replace(/\.[^.]+$/, '');
  const match = stem.match(/(?:^|[\s_-])(v\d+)(?:[\s_-]*archived[\s_-]*\d+)?$/i);
  if (!match) {
    return null;
  }

  const versionTag = (match[1] ?? '').trim();
  return versionTag ? versionTag.toLowerCase() : null;
}

function getSongRowMetadataLabel(song: SongWithVersions): string {
  const activeVersion = getActiveSongVersion(song);
  if (!activeVersion) {
    return '—';
  }

  const versionTag = getVersionTagFromFileName(activeVersion.fileName);
  const formatTag = activeVersion.extension.toUpperCase();

  if (versionTag) {
    return `${versionTag} · ${formatTag}`;
  }

  return formatTag;
}

function readStoredSongRatings(): Record<string, number> {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(SONG_RATINGS_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    return sanitizeSongRatings(JSON.parse(raw));
  } catch {
    return {};
  }
}

function persistSongRatings(ratings: Record<string, number>): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(SONG_RATINGS_STORAGE_KEY, JSON.stringify(ratings));
}

function createChecklistItemId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `checklist-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
}

function readStoredSongChecklists(): Record<string, SongChecklistItem[]> {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(SONG_CHECKLISTS_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    return sanitizeSongChecklists(JSON.parse(raw));
  } catch {
    return {};
  }
}

function persistSongChecklists(checklists: Record<string, SongChecklistItem[]>): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(SONG_CHECKLISTS_STORAGE_KEY, JSON.stringify(checklists));
}

function readICloudBackupEnabled(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    return window.localStorage.getItem(ICLOUD_BACKUP_ENABLED_KEY) === 'true';
  } catch {
    return false;
  }
}

function persistICloudBackupEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(ICLOUD_BACKUP_ENABLED_KEY, enabled ? 'true' : 'false');
}

function readICloudLastSync(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage.getItem(ICLOUD_LAST_SYNC_KEY);
  } catch {
    return null;
  }
}

function persistICloudLastSync(timestamp: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(ICLOUD_LAST_SYNC_KEY, timestamp);
}

function readSavedReferenceTracks(): SavedReferenceTrackEntry[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(SAVED_REFERENCE_TRACKS_KEY);
    if (!raw) {
      return [];
    }

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((entry: unknown) => {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        return [];
      }

      const candidate = entry as Partial<SavedReferenceTrackEntry>;
      if (
        typeof candidate.filePath !== 'string' ||
        candidate.filePath.length === 0 ||
        typeof candidate.fileName !== 'string' ||
        candidate.fileName.length === 0 ||
        typeof candidate.dateLastUsed !== 'string'
      ) {
        return [];
      }

      return [
        {
          filePath: candidate.filePath,
          fileName: candidate.fileName,
          dateLastUsed: candidate.dateLastUsed,
          integratedLufs:
            typeof candidate.integratedLufs === 'number' && Number.isFinite(candidate.integratedLufs)
              ? candidate.integratedLufs
              : null,
        },
      ];
    });
  } catch {
    return [];
  }
}

function persistSavedReferenceTracks(tracks: SavedReferenceTrackEntry[]): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(SAVED_REFERENCE_TRACKS_KEY, JSON.stringify(tracks));
}

function addToSavedReferenceTracks(
  existing: SavedReferenceTrackEntry[],
  entry: SavedReferenceTrackEntry
): SavedReferenceTrackEntry[] {
  const filtered = existing.filter((track) => track.filePath !== entry.filePath);
  const updated = [entry, ...filtered];
  return updated.slice(0, MAX_SAVED_REFERENCE_TRACKS);
}

function formatSavedReferenceDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return 'Today';
    }

    if (diffDays === 1) {
      return 'Yesterday';
    }

    if (diffDays < 7) {
      return `${diffDays}d ago`;
    }

    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

/** Persist the reference track file path for a given song. */
function persistReferenceTrackForSong(songId: string, filePath: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(`${REFERENCE_TRACK_PER_SONG_KEY_PREFIX}${songId}`, filePath);
}

/** Read the persisted reference track file path for a song. */
function readReferenceTrackForSong(songId: string): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(`${REFERENCE_TRACK_PER_SONG_KEY_PREFIX}${songId}`) ?? null;
}

interface RecentReferenceEntry {
  filePath: string;
  fileName: string;
}

/** Read the recent reference tracks array from localStorage. */
function readRecentReferenceTracks(): RecentReferenceEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENT_REFERENCE_TRACKS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry: unknown) => {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return [];
      const c = entry as Partial<RecentReferenceEntry>;
      if (typeof c.filePath !== 'string' || !c.filePath || typeof c.fileName !== 'string' || !c.fileName) return [];
      return [{ filePath: c.filePath, fileName: c.fileName }];
    }).slice(0, MAX_RECENT_REFERENCE_TRACKS);
  } catch {
    return [];
  }
}

/** Add a reference to the recent list (newest first, max 3). */
function addToRecentReferenceTracks(entry: RecentReferenceEntry): RecentReferenceEntry[] {
  const current = readRecentReferenceTracks();
  const filtered = current.filter((r) => r.filePath !== entry.filePath);
  const updated = [entry, ...filtered].slice(0, MAX_RECENT_REFERENCE_TRACKS);
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(RECENT_REFERENCE_TRACKS_KEY, JSON.stringify(updated));
  }
  return updated;
}

function formatAlbumDuration(totalSeconds: number | null): string {
  if (totalSeconds === null || !Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return 'Album length unavailable';
  }

  const roundedSeconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(roundedSeconds / 60);
  const seconds = roundedSeconds % 60;
  return `Album length ${minutes}:${String(seconds).padStart(2, '0')}`;
}

function getDurationSecondsFromVersion(version: SongVersion, resolvedSeconds?: number): number | null {
  if (typeof resolvedSeconds === 'number' && Number.isFinite(resolvedSeconds) && resolvedSeconds > 0) {
    return resolvedSeconds;
  }

  if (typeof version.durationMs === 'number' && Number.isFinite(version.durationMs) && version.durationMs > 0) {
    return version.durationMs / 1000;
  }

  return null;
}

function getReferencePlaybackKey(referenceTrack: LoadedReferenceTrack | null): string | null {
  if (!referenceTrack) {
    return null;
  }

  return `reference:${referenceTrack.filePath}`;
}

function getNormalizedSliderRating(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_SONG_RATING;
  }

  return Math.max(1, Math.min(10, Math.round(value)));
}

function getPlayheadEndResetThresholdSeconds(durationSeconds: number | undefined): number {
  if (
    !Number.isFinite(durationSeconds) ||
    typeof durationSeconds !== 'number' ||
    durationSeconds <= 0
  ) {
    return PLAYHEAD_END_RESET_MIN_THRESHOLD_SECONDS;
  }

  return Math.min(
    PLAYHEAD_END_RESET_MAX_THRESHOLD_SECONDS,
    Math.max(
      PLAYHEAD_END_RESET_MIN_THRESHOLD_SECONDS,
      durationSeconds * PLAYHEAD_END_RESET_DURATION_RATIO
    )
  );
}

function isPlayheadAtOrNearEnd(
  seconds: number,
  durationSeconds: number | undefined
): boolean {
  if (
    !Number.isFinite(seconds) ||
    seconds < 0 ||
    !Number.isFinite(durationSeconds) ||
    typeof durationSeconds !== 'number' ||
    durationSeconds <= 0
  ) {
    return false;
  }

  const remainingSeconds = Math.max(durationSeconds - seconds, 0);
  return remainingSeconds <= getPlayheadEndResetThresholdSeconds(durationSeconds);
}

function normalizeRememberedPlayheadSeconds(
  seconds: number,
  durationSeconds: number | undefined
): number | null {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return null;
  }

  if (isPlayheadAtOrNearEnd(seconds, durationSeconds)) {
    return null;
  }

  const normalizedSeconds = Math.max(0, Math.min(seconds, durationSeconds ?? seconds));
  return normalizedSeconds <= 0.01 ? null : normalizedSeconds;
}

interface MigrationPreviewSong {
  songName: string;
  matchedSongId: string | null;
  matchedSongTitle: string | null;
  matchConfidence: 'exact' | 'fuzzy' | 'none';
  items: Array<{
    text: string;
    completed: boolean;
    timestampSeconds: number | null;
  }>;
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array.from({ length: n + 1 }, () => 0)
  );
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function lenientParseJson(input: string): unknown {
  let cleaned = input.trim();

  // Strip markdown code fences
  const fenceMatch = cleaned.match(/```(?:json|JSON)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  // Try parsing as-is first
  try {
    return JSON.parse(cleaned);
  } catch {
    // Continue with cleanup
  }

  // Remove trailing commas before } or ]
  let fixed = cleaned.replace(/,(\s*[}\]])/g, '$1');

  try {
    return JSON.parse(fixed);
  } catch {
    // Continue
  }

  // Quote unquoted keys: { key: or , key:
  fixed = fixed.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":');

  try {
    return JSON.parse(fixed);
  } catch {
    // Continue
  }

  // Replace single-quoted strings with double-quoted
  fixed = fixed.replace(/:\s*'([^']*)'/g, ': "$1"');
  fixed = fixed.replace(/\[\s*'([^']*)'/g, '["$1"');
  fixed = fixed.replace(/,\s*'([^']*)'/g, ', "$1"');

  try {
    return JSON.parse(fixed);
  } catch {
    // Continue
  }

  // Last resort: try extracting a JSON object from the text
  const jsonObjectMatch = cleaned.match(/(\{[\s\S]*\})/);
  if (jsonObjectMatch) {
    let extracted = jsonObjectMatch[1];
    extracted = extracted.replace(/,(\s*[}\]])/g, '$1');
    extracted = extracted.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":');
    extracted = extracted.replace(/:\s*'([^']*)'/g, ': "$1"');
    try {
      return JSON.parse(extracted);
    } catch {
      // Give up
    }
  }

  throw new Error(
    'Could not parse the JSON. Common issues: missing quotes, unmatched brackets, or invalid syntax. ' +
      'Try pasting the JSON into a validator first, or ask the LLM to regenerate it.'
  );
}

function fuzzyMatchSong(
  query: string,
  allSongs: SongWithVersions[]
): { songId: string; title: string; confidence: 'exact' | 'fuzzy' } | null {
  const normalized = query.toLowerCase().trim();
  if (normalized.length === 0) return null;

  // Exact match on normalizedTitle
  for (const song of allSongs) {
    if (song.normalizedTitle.toLowerCase() === normalized) {
      return { songId: song.id, title: song.title, confidence: 'exact' };
    }
  }

  // Exact match on title (case-insensitive)
  for (const song of allSongs) {
    if (song.title.toLowerCase() === normalized) {
      return { songId: song.id, title: song.title, confidence: 'exact' };
    }
  }

  // Contains match (bidirectional)
  for (const song of allSongs) {
    const songNorm = song.normalizedTitle.toLowerCase();
    if (songNorm.includes(normalized) || normalized.includes(songNorm)) {
      return { songId: song.id, title: song.title, confidence: 'fuzzy' };
    }
  }

  // Title contains match
  for (const song of allSongs) {
    const titleNorm = song.title.toLowerCase();
    if (titleNorm.includes(normalized) || normalized.includes(titleNorm)) {
      return { songId: song.id, title: song.title, confidence: 'fuzzy' };
    }
  }

  // Levenshtein distance match
  let bestMatch: { songId: string; title: string; distance: number } | null = null;
  for (const song of allSongs) {
    const songNorm = song.normalizedTitle.toLowerCase();
    const distance = levenshteinDistance(normalized, songNorm);
    const maxLen = Math.max(normalized.length, songNorm.length);
    const similarity = maxLen > 0 ? 1 - distance / maxLen : 0;

    if (similarity > 0.6 && (!bestMatch || distance < bestMatch.distance)) {
      bestMatch = { songId: song.id, title: song.title, distance };
    }
  }

  if (bestMatch) {
    return { songId: bestMatch.songId, title: bestMatch.title, confidence: 'fuzzy' };
  }

  return null;
}

function parseMigrationInput(
  raw: unknown,
  allSongs: SongWithVersions[]
): MigrationPreviewSong[] {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Expected a JSON object with a "songs" array.');
  }

  const payload = raw as Record<string, unknown>;
  const songsArray = payload.songs;

  if (!Array.isArray(songsArray)) {
    throw new Error(
      'Expected a "songs" array in the JSON. Got: ' + typeof songsArray
    );
  }

  const preview: MigrationPreviewSong[] = [];

  for (const entry of songsArray) {
    if (!entry || typeof entry !== 'object') continue;

    const songEntry = entry as Record<string, unknown>;
    const songName =
      typeof songEntry.songName === 'string' ? songEntry.songName.trim() : '';

    if (!songName) continue;

    const match = fuzzyMatchSong(songName, allSongs);

    const checklistItemsRaw = Array.isArray(songEntry.checklistItems)
      ? songEntry.checklistItems
      : [];
    const items = checklistItemsRaw.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const itemObj = item as Record<string, unknown>;
      const text = typeof itemObj.text === 'string' ? itemObj.text.trim() : '';
      if (!text) return [];
      const completed =
        typeof itemObj.completed === 'boolean' ? itemObj.completed : false;
      const timestampSeconds =
        typeof itemObj.timestampSeconds === 'number' &&
        Number.isFinite(itemObj.timestampSeconds) &&
        itemObj.timestampSeconds >= 0
          ? itemObj.timestampSeconds
          : null;
      return [{ text, completed, timestampSeconds }];
    });

    if (items.length === 0) continue;

    preview.push({
      songName,
      matchedSongId: match?.songId ?? null,
      matchedSongTitle: match?.title ?? null,
      matchConfidence: match?.confidence ?? 'none',
      items,
    });
  }

  return preview;
}

export function App(): JSX.Element {
  const [snapshot, setSnapshot] = useState<LibrarySnapshot>(EMPTY_SNAPSHOT);
  const [environment, setEnvironment] =
    useState<ProducerPlayerEnvironment>(EMPTY_ENVIRONMENT);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('off');
  const [searchText, setSearchText] = useState('');
  const [selectedSongId, setSelectedSongId] = useState<string | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedPlaybackVersionId, setSelectedPlaybackVersionId] = useState<string | null>(
    null
  );
  const [dragSongId, setDragSongId] = useState<string | null>(null);
  const [dragOverSongId, setDragOverSongId] = useState<string | null>(null);
  const [dragOverPosition, setDragOverPosition] = useState<DragOverPosition>('before');
  // folderPathInput removed — path-linker UI is no longer rendered in the app.
  // Tests link folders via page.evaluate(() => window.producerPlayer.linkFolder(path)).
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [playbackSource, setPlaybackSource] = useState<PlaybackSourceInfo | null>(null);
  const [mixPlaybackSource, setMixPlaybackSource] = useState<PlaybackSourceInfo | null>(null);
  const [mixPlaybackSourceSelectedFilePath, setMixPlaybackSourceSelectedFilePath] = useState<
    string | null
  >(null);
  const [playbackPreviewMode, setPlaybackPreviewMode] = useState<'mix' | 'reference'>('mix');
  const [playbackSourceSupport, setPlaybackSourceSupport] = useState<'unknown' | 'maybe' | 'probably' | 'no'>(
    'unknown'
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTimeSeconds, setCurrentTimeSeconds] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [playbackSourceReady, setPlaybackSourceReady] = useState(false);
  const [volume, setVolume] = useState(DEFAULT_PLAYBACK_VOLUME);
  const [songRatings, setSongRatings] = useState<Record<string, number>>(() =>
    readStoredSongRatings()
  );
  const [songChecklists, setSongChecklists] = useState<Record<string, SongChecklistItem[]>>(
    () => readStoredSongChecklists()
  );
  const [sharedUserStateReady, setSharedUserStateReady] = useState(false);
  const [iCloudBackupEnabled, setICloudBackupEnabled] = useState<boolean>(() =>
    readICloudBackupEnabled()
  );
  const [iCloudAvailability, setICloudAvailability] = useState<ICloudAvailabilityResult | null>(
    null
  );
  const [iCloudSyncStatus, setICloudSyncStatus] = useState<
    'idle' | 'syncing' | 'success' | 'error'
  >('idle');
  const [iCloudSyncError, setICloudSyncError] = useState<string | null>(null);
  const [iCloudInitialLoadDone, setICloudInitialLoadDone] = useState(false);
  const [updateCheckStatus, setUpdateCheckStatus] = useState<
    'idle' | 'checking' | 'up-to-date' | 'update-available' | 'error'
  >('idle');
  const [updateCheckResult, setUpdateCheckResult] = useState<UpdateCheckResult | null>(null);
  const [checklistModalSongId, setChecklistModalSongId] = useState<string | null>(null);
  const [checklistDraftText, setChecklistDraftText] = useState('');
  const [checklistCapturedTimestamp, setChecklistCapturedTimestamp] = useState<number | null>(null);
  const [checklistTimestampMode, setChecklistTimestampMode] = useState<'live' | 'frozen'>('live');
  const [activeChecklistTimestampIds, setActiveChecklistTimestampIds] = useState<string[]>([]);
  const [checklistUndoStack, setChecklistUndoStack] = useState<Record<string, SongChecklistItem[]>[]>([]);
  const [checklistRedoStack, setChecklistRedoStack] = useState<Record<string, SongChecklistItem[]>[]>([]);
  const [resolvedAlbumDurationSecondsByVersionId, setResolvedAlbumDurationSecondsByVersionId] = useState<
    Record<string, number>
  >({});
  const [analysis, setAnalysis] = useState<TrackAnalysisResult | null>(null);
  const [measuredAnalysis, setMeasuredAnalysis] = useState<AudioFileAnalysis | null>(null);
  const [analysisStatus, setAnalysisStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle'
  );
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisExpanded, setAnalysisExpanded] = useState(false);
  const [analysisCompactStatsExpanded, setAnalysisCompactStatsExpanded] = useState(() =>
    window.localStorage.getItem(MORE_METRICS_EXPANDED_KEY) === 'true'
  );
  const [savedReferenceTracks, setSavedReferenceTracks] = useState<SavedReferenceTrackEntry[]>(() =>
    readSavedReferenceTracks()
  );
  const [recentReferenceTracks, setRecentReferenceTracks] = useState<RecentReferenceEntry[]>(() =>
    readRecentReferenceTracks()
  );
  const [referenceTrack, setReferenceTrack] = useState<LoadedReferenceTrack | null>(null);
  const [referenceStatus, setReferenceStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle'
  );
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const [selectedNormalizationPlatformId, setSelectedNormalizationPlatformId] =
    useState<NormalizationPlatformId>('spotify');
  const [normalizationPreviewEnabled, setNormalizationPreviewEnabled] = useState(false);
  const [midSideMode, setMidSideMode] = useState<'stereo' | 'mid' | 'side'>('stereo');
  const [analyserNodeL, setAnalyserNodeL] = useState<AnalyserNode | null>(null);
  const [analyserNodeR, setAnalyserNodeR] = useState<AnalyserNode | null>(null);
  const [referenceLevelMatchEnabled, setReferenceLevelMatchEnabled] = useState(false);
  const midSideProcessorRef = useRef<ScriptProcessorNode | null>(null);

  const [migrationModalOpen, setMigrationModalOpen] = useState(false);
  const [migrationJsonInput, setMigrationJsonInput] = useState('');
  const [migrationParseError, setMigrationParseError] = useState<string | null>(null);
  const [migrationPreview, setMigrationPreview] = useState<MigrationPreviewSong[] | null>(null);
  const [migrationSchemaCopied, setMigrationSchemaCopied] = useState(false);
  const [migrationImportDone, setMigrationImportDone] = useState(false);

  const [albumTitle, setAlbumTitle] = useState<string>(() => {
    return window.localStorage.getItem(ALBUM_TITLE_STORAGE_KEY) ?? 'Untitled Album';
  });
  const [albumTitleEditing, setAlbumTitleEditing] = useState(false);
  const [albumTitleDraft, setAlbumTitleDraft] = useState('');
  const [albumArt, setAlbumArt] = useState<string | null>(() => {
    return window.localStorage.getItem(ALBUM_ART_STORAGE_KEY);
  });
  const albumArtInputRef = useRef<HTMLInputElement | null>(null);
  const albumTitleInputRef = useRef<HTMLInputElement | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playOnNextLoadRef = useRef(false);
  const repeatModeRef = useRef<RepeatMode>('off');
  const isPlayingRef = useRef(isPlaying);
  const currentTimeSecondsRef = useRef(currentTimeSeconds);
  const durationSecondsRef = useRef(durationSeconds);
  const checklistModalSongIdRef = useRef<string | null>(checklistModalSongId);
  const checklistDraftTextRef = useRef(checklistDraftText);
  const checklistInputFocusedRef = useRef(false);
  const checklistOverlayRef = useRef<HTMLDivElement | null>(null);
  const checklistModalCardRef = useRef<HTMLDivElement | null>(null);
  const checklistUnderlyingAnalysisPaneRef = useRef<HTMLElement | null>(null);
  const checklistUnderlyingSidePaneScrollRef = useRef<HTMLDivElement | null>(null);
  const checklistComposerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const checklistSkipBackTenButtonRef = useRef<HTMLButtonElement | null>(null);
  const checklistSkipBackFiveButtonRef = useRef<HTMLButtonElement | null>(null);
  const lastFocusedChecklistTransportRef = useRef<HTMLButtonElement | null>(null);
  const songChecklistsRef = useRef(songChecklists);
  const checklistUndoStackRef = useRef(checklistUndoStack);
  const checklistRedoStackRef = useRef(checklistRedoStack);
  const selectedPlaybackSongIdRef = useRef<string | null>(null);
  const queueMoveTargetSongIdRef = useRef<string | null>(null);
  const checklistHighlightTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );
  const previousChecklistPlaybackTimeRef = useRef(0);
  const playbackSourceRef = useRef<PlaybackSourceInfo | null>(null);
  const expectedSourceUrlRef = useRef<string | null>(null);
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sourceRequestIdRef = useRef(0);
  const playbackSourceSupportRef = useRef<'unknown' | 'maybe' | 'probably' | 'no'>('unknown');
  const playbackSourceReadyRef = useRef(false);
  const lastLoadedSongIdRef = useRef<string | null>(null);
  const playbackPositionBySongIdRef = useRef<Map<string, number>>(new Map());
  const pendingRestoreTimeRef = useRef<number | null>(null);
  const dragTargetRef = useRef<{ songId: string; position: DragOverPosition } | null>(null);
  const moveInQueueRef = useRef<(
    direction: 1 | -1,
    options: { wrap: boolean; autoplay: boolean }
  ) => boolean>(() => false);
  const transportActionRef = useRef<{
    toggle: () => void;
    next: () => void;
    previous: () => void;
  }>({
    toggle: () => undefined,
    next: () => undefined,
    previous: () => undefined,
  });
  const handleSkipSecondsRef = useRef<(offsetSeconds: number) => void>(() => undefined);
  const playbackAudioContextRef = useRef<AudioContext | null>(null);
  const playbackGainNodeRef = useRef<GainNode | null>(null);
  const playbackAnalyserNodeRef = useRef<AnalyserNode | null>(null);
  const bandSoloFiltersRef = useRef<BiquadFilterNode[]>([]);

  const iCloudSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sharedUserStateSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const iCloudBackupEnabledRef = useRef(iCloudBackupEnabled);

  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
  const [soloedBands, setSoloedBands] = useState<Set<number>>(new Set());
  const [spectrumFullWidth, setSpectrumFullWidth] = useState(860);
  const spectrumFullContainerRef = useRef<HTMLDivElement | null>(null);

  // Advanced mastering visualization refs + visibility state (IntersectionObserver)
  const crestFactorSectionRef = useRef<HTMLDivElement | null>(null);
  const midSideSpectrumSectionRef = useRef<HTMLDivElement | null>(null);
  const loudnessHistogramSectionRef = useRef<HTMLDivElement | null>(null);
  const spectrogramSectionRef = useRef<HTMLDivElement | null>(null);
  const [crestFactorVisible, setCrestFactorVisible] = useState(false);
  const [midSideSpectrumVisible, setMidSideSpectrumVisible] = useState(false);
  const [loudnessHistogramVisible, setLoudnessHistogramVisible] = useState(false);
  const [spectrogramVisible, setSpectrogramVisible] = useState(false);

  // IntersectionObserver to pause off-screen visualizations
  useEffect(() => {
    const entries: [React.RefObject<HTMLDivElement | null>, (v: boolean) => void][] = [
      [crestFactorSectionRef, setCrestFactorVisible],
      [midSideSpectrumSectionRef, setMidSideSpectrumVisible],
      [loudnessHistogramSectionRef, setLoudnessHistogramVisible],
      [spectrogramSectionRef, setSpectrogramVisible],
    ];

    const observer = new IntersectionObserver(
      (ioEntries) => {
        for (const ioEntry of ioEntries) {
          for (const [ref, setter] of entries) {
            if (ref.current === ioEntry.target) {
              setter(ioEntry.isIntersecting);
            }
          }
        }
      },
      { threshold: 0.05 }
    );

    for (const [ref] of entries) {
      if (ref.current) observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, [analysisExpanded]);

  const applyPlaybackGain = useCallback(
    (nextVolume: number, nextNormalizationGainDb: number) => {
      const audio = audioRef.current;
      const totalGainLinear = Math.max(
        0,
        nextVolume * gainDbToLinear(nextNormalizationGainDb)
      );
      const gainNode = playbackGainNodeRef.current;

      if (gainNode) {
        gainNode.gain.value = totalGainLinear;
        if (audio) {
          audio.volume = 1;
        }
        return;
      }

      if (audio) {
        audio.volume = Math.max(0, Math.min(totalGainLinear, 1));
      }
    },
    []
  );

  useEffect(() => {
    repeatModeRef.current = repeatMode;
  }, [repeatMode]);

  useEffect(() => {
    playbackSourceRef.current = playbackSource;
    expectedSourceUrlRef.current = playbackSource?.url ?? null;
  }, [playbackSource]);

  useEffect(() => {
    playbackSourceSupportRef.current = playbackSourceSupport;
  }, [playbackSourceSupport]);

  useEffect(() => {
    playbackSourceReadyRef.current = playbackSourceReady;
  }, [playbackSourceReady]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    currentTimeSecondsRef.current = currentTimeSeconds;
  }, [currentTimeSeconds]);

  useEffect(() => {
    durationSecondsRef.current = durationSeconds;
  }, [durationSeconds]);

  useEffect(() => {
    checklistModalSongIdRef.current = checklistModalSongId;
  }, [checklistModalSongId]);

  useEffect(() => {
    songChecklistsRef.current = songChecklists;
  }, [songChecklists]);

  useEffect(() => {
    checklistUndoStackRef.current = checklistUndoStack;
  }, [checklistUndoStack]);

  useEffect(() => {
    checklistRedoStackRef.current = checklistRedoStack;
  }, [checklistRedoStack]);

  useEffect(() => {
    checklistDraftTextRef.current = checklistDraftText;

    const composerNode = checklistComposerTextareaRef.current;
    if (composerNode) {
      autosizeChecklistTextarea(composerNode);
    }
  }, [checklistDraftText]);

  useEffect(() => {
    if (!checklistModalSongId) {
      previousChecklistPlaybackTimeRef.current = currentTimeSeconds;
      return;
    }

    if (checklistTimestampMode !== 'live') {
      return;
    }

    setChecklistCapturedTimestamp(captureCurrentPlaybackTimestamp());
  }, [checklistModalSongId, checklistTimestampMode, currentTimeSeconds, durationSeconds]);

  useEffect(() => {
    if (checklistModalSongId === null) {
      checklistInputFocusedRef.current = false;
      lastFocusedChecklistTransportRef.current = null;
      setActiveChecklistTimestampIds([]);
      for (const timeout of checklistHighlightTimeoutsRef.current.values()) {
        clearTimeout(timeout);
      }
      checklistHighlightTimeoutsRef.current.clear();
      previousChecklistPlaybackTimeRef.current = currentTimeSeconds;
    }
  }, [checklistModalSongId, currentTimeSeconds]);

  useEffect(() => {
    const selectedVersion =
      snapshot.versions.find((version) => version.id === selectedPlaybackVersionId) ?? null;
    const analysisFilePath = selectedVersion?.filePath ?? null;

    if (!selectedPlaybackVersionId || !mixPlaybackSource?.url || !analysisFilePath) {
      setAnalysis(null);
      setMeasuredAnalysis(null);
      setAnalysisStatus('idle');
      setAnalysisError(null);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    setAnalysis(null);
    setMeasuredAnalysis(null);
    setAnalysisStatus('loading');
    setAnalysisError(null);

    void Promise.all([
      analyzeTrackFromUrl(mixPlaybackSource.url, controller.signal),
      window.producerPlayer.analyzeAudioFile(analysisFilePath),
    ])
      .then(([previewResult, measuredResult]) => {
        if (cancelled) {
          return;
        }

        setAnalysis(previewResult);
        setMeasuredAnalysis(measuredResult);
        setAnalysisStatus('ready');
      })
      .catch((analysisIssue: unknown) => {
        if (
          analysisIssue instanceof DOMException &&
          analysisIssue.name === 'AbortError'
        ) {
          return;
        }

        if (cancelled) {
          return;
        }

        setAnalysis(null);
        setMeasuredAnalysis(null);
        setAnalysisStatus('error');
        setAnalysisError(
          analysisIssue instanceof Error
            ? analysisIssue.message
            : 'Could not analyse this track preview.'
        );
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [mixPlaybackSource?.url, selectedPlaybackVersionId, snapshot.versions]);

  useEffect(() => {
    setAnalysisCompactStatsExpanded(
      window.localStorage.getItem(MORE_METRICS_EXPANDED_KEY) === 'true'
    );
  }, [selectedPlaybackVersionId]);

  useEffect(() => {
    if (!analysisExpanded) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAnalysisExpanded(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [analysisExpanded]);

  // ResizeObserver for full-screen spectrum width
  useEffect(() => {
    if (!analysisExpanded) return;
    const container = spectrumFullContainerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.floor(entry.contentRect.width);
        if (w > 0) setSpectrumFullWidth(w);
      }
    });
    observer.observe(container);
    // Set initial width
    const initialWidth = Math.floor(container.clientWidth);
    if (initialWidth > 0) setSpectrumFullWidth(initialWidth);

    return () => observer.disconnect();
  }, [analysisExpanded]);

  useEffect(() => {
    let cancelled = false;

    window.producerPlayer
      .getSharedUserState()
      .then((sharedState) => {
        if (cancelled) {
          return;
        }

        const merged = mergeLegacyAndSharedUserState(
          {
            ratings: sanitizeSongRatings(sharedState?.ratings),
            checklists: sanitizeSongChecklists(sharedState?.checklists),
          },
          {
            ratings: readStoredSongRatings(),
            checklists: readStoredSongChecklists(),
          }
        );

        setSongRatings(merged.ratings);
        setSongChecklists(merged.checklists);
        songChecklistsRef.current = merged.checklists;
        setChecklistUndoStack([]);
        setChecklistRedoStack([]);
        checklistUndoStackRef.current = [];
        checklistRedoStackRef.current = [];
        persistSongRatings(merged.ratings);
        persistSongChecklists(merged.checklists);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) {
          setSharedUserStateReady(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    persistSongRatings(songRatings);
  }, [songRatings]);

  useEffect(() => {
    persistSongChecklists(songChecklists);
  }, [songChecklists]);

  useEffect(() => {
    if (!sharedUserStateReady) {
      return;
    }

    if (sharedUserStateSyncTimerRef.current) {
      clearTimeout(sharedUserStateSyncTimerRef.current);
    }

    sharedUserStateSyncTimerRef.current = setTimeout(() => {
      void window.producerPlayer
        .setSharedUserState({ ratings: songRatings, checklists: songChecklists })
        .catch(() => undefined);
    }, 250);

    return () => {
      if (sharedUserStateSyncTimerRef.current) {
        clearTimeout(sharedUserStateSyncTimerRef.current);
      }
    };
  }, [sharedUserStateReady, songRatings, songChecklists]);

  // Keep ref in sync
  useEffect(() => {
    iCloudBackupEnabledRef.current = iCloudBackupEnabled;
  }, [iCloudBackupEnabled]);

  // Check iCloud availability on mount
  useEffect(() => {
    let cancelled = false;

    window.producerPlayer.checkICloudAvailable().then((result) => {
      if (cancelled) return;
      setICloudAvailability(result);

      // If not available and toggle was somehow left on, turn it off
      if (!result.available && readICloudBackupEnabled()) {
        setICloudBackupEnabled(false);
        persistICloudBackupEnabled(false);
      }
    }).catch(() => {
      if (cancelled) return;
      setICloudAvailability({ available: false, path: null, reason: 'Could not check iCloud availability.' });
    });

    return () => { cancelled = true; };
  }, []);

  // Load from iCloud on startup if enabled
  useEffect(() => {
    if (!iCloudBackupEnabled || iCloudInitialLoadDone) return;
    if (iCloudAvailability === null) return; // Wait for availability check

    if (!iCloudAvailability.available) {
      setICloudInitialLoadDone(true);
      return;
    }

    let cancelled = false;

    window.producerPlayer.loadFromICloud().then((result) => {
      if (cancelled) return;
      setICloudInitialLoadDone(true);

      if (!result.data) return;

      // Compare timestamps: only load if iCloud is newer
      const localLastSync = readICloudLastSync();
      const iCloudUpdatedAt = result.data.state?.updatedAt;

      if (localLastSync && iCloudUpdatedAt) {
        const localTime = new Date(localLastSync).getTime();
        const iCloudTime = new Date(iCloudUpdatedAt).getTime();
        if (localTime >= iCloudTime) return; // Local is same or newer
      }

      // Load iCloud data into state
      if (result.data.checklists && typeof result.data.checklists === 'object') {
        const parsedChecklists = sanitizeSongChecklists(result.data.checklists);
        setSongChecklists(parsedChecklists);
        songChecklistsRef.current = parsedChecklists;
        setChecklistUndoStack([]);
        setChecklistRedoStack([]);
        checklistUndoStackRef.current = [];
        checklistRedoStackRef.current = [];
        persistSongChecklists(parsedChecklists);
      }

      if (result.data.ratings && typeof result.data.ratings === 'object') {
        const parsedRatings = sanitizeSongRatings(result.data.ratings);
        setSongRatings(parsedRatings);
        persistSongRatings(parsedRatings);
      }
    }).catch(() => {
      if (cancelled) return;
      setICloudInitialLoadDone(true);
    });

    return () => { cancelled = true; };
  }, [iCloudBackupEnabled, iCloudAvailability, iCloudInitialLoadDone]);

  // Sync to iCloud whenever ratings or checklists change (debounced)
  useEffect(() => {
    if (!iCloudBackupEnabledRef.current) return;
    if (!iCloudInitialLoadDone) return;

    if (iCloudSyncTimerRef.current) {
      clearTimeout(iCloudSyncTimerRef.current);
    }

    iCloudSyncTimerRef.current = setTimeout(() => {
      if (!iCloudBackupEnabledRef.current) return;

      const now = new Date().toISOString();
      const backupData: ICloudBackupData = {
        checklists: songChecklists,
        ratings: songRatings,
        state: {
          iCloudEnabled: true,
          updatedAt: now,
        },
      };

      setICloudSyncStatus('syncing');
      setICloudSyncError(null);

      window.producerPlayer.syncToICloud(backupData).then((result) => {
        if (result.success) {
          setICloudSyncStatus('success');
          persistICloudLastSync(now);
          // Reset status after a brief display
          setTimeout(() => setICloudSyncStatus('idle'), 2000);
        } else {
          setICloudSyncStatus('error');
          setICloudSyncError(result.error ?? 'Sync failed.');
        }
      }).catch(() => {
        setICloudSyncStatus('error');
        setICloudSyncError('Failed to sync to iCloud.');
      });
    }, 1500); // Debounce: wait 1.5s after last change

    return () => {
      if (iCloudSyncTimerRef.current) {
        clearTimeout(iCloudSyncTimerRef.current);
      }
    };
  }, [songRatings, songChecklists, iCloudInitialLoadDone]);

  useEffect(() => {
    if (!checklistModalSongId) {
      return;
    }

    const songStillExists = snapshot.songs.some((song) => song.id === checklistModalSongId);
    if (songStillExists) {
      return;
    }

    setChecklistModalSongId(null);
    setChecklistDraftText('');
    setChecklistCapturedTimestamp(null);
  }, [checklistModalSongId, snapshot.songs]);

  useEffect(() => {
    if (!checklistModalSongId) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        const active = document.activeElement;
        const isChecklistInputFocused =
          active instanceof HTMLElement &&
          (active.dataset.testid === 'song-checklist-input' ||
            active.dataset.testid === 'song-checklist-item-text');

        if (isChecklistInputFocused) {
          active.blur();
          event.stopPropagation();
          return;
        }

        setChecklistModalSongId(null);
        setChecklistDraftText('');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [checklistModalSongId]);

  useEffect(() => {
    if (!migrationModalOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleCloseMigrationModal();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [migrationModalOpen]);

  useEffect(() => {
    if (!referenceTrack && playbackPreviewMode === 'reference') {
      setPlaybackPreviewMode('mix');
    }
  }, [playbackPreviewMode, referenceTrack]);

  function rememberSongPlayhead(
    songId: string | null,
    seconds: number,
    options: { durationSeconds?: number } = {}
  ): void {
    if (!songId) {
      return;
    }

    const normalizedSeconds = normalizeRememberedPlayheadSeconds(
      seconds,
      options.durationSeconds
    );

    if (normalizedSeconds === null) {
      playbackPositionBySongIdRef.current.delete(songId);
      return;
    }

    playbackPositionBySongIdRef.current.set(songId, normalizedSeconds);
  }

  function rememberCurrentSongPlayhead(): void {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    rememberSongPlayhead(lastLoadedSongIdRef.current, audio.currentTime, {
      durationSeconds: Number.isFinite(audio.duration) ? audio.duration : undefined,
    });
  }

  function deriveDragOverPosition(event: DragEvent<HTMLElement>): DragOverPosition {
    const bounds = event.currentTarget.getBoundingClientRect();
    const offsetY = event.clientY - bounds.top;
    return offsetY >= bounds.height / 2 ? 'after' : 'before';
  }

  function restorePendingPlayhead(audio: HTMLAudioElement): void {
    const pendingRestoreTime = pendingRestoreTimeRef.current;

    if (pendingRestoreTime === null || !Number.isFinite(pendingRestoreTime) || pendingRestoreTime <= 0) {
      pendingRestoreTimeRef.current = null;
      return;
    }

    const duration = Number.isFinite(audio.duration) ? audio.duration : undefined;
    const normalizedRestoreTime = normalizeRememberedPlayheadSeconds(
      pendingRestoreTime,
      duration
    );

    if (normalizedRestoreTime === null) {
      rememberSongPlayhead(lastLoadedSongIdRef.current, pendingRestoreTime, {
        durationSeconds: duration,
      });
      pendingRestoreTimeRef.current = null;
      return;
    }

    try {
      audio.currentTime = normalizedRestoreTime;
      setCurrentTimeSeconds(normalizedRestoreTime);
      rememberSongPlayhead(lastLoadedSongIdRef.current, normalizedRestoreTime, {
        durationSeconds: duration,
      });

      logPlaybackEvent('playhead-restored', {
        restoredSeconds: normalizedRestoreTime,
      });
    } catch {
      // Ignore transient seek errors while metadata is still settling.
    }

    pendingRestoreTimeRef.current = null;
  }

  function logPlaybackEvent(
    event: string,
    details: Record<string, unknown> = {}
  ): void {
    const audio = audioRef.current;

    console.info('[producer-player:playback]', {
      event,
      timestamp: new Date().toISOString(),
      selectedVersionId: selectedPlaybackVersionId,
      selectedFilePath: playbackSourceRef.current?.filePath ?? null,
      selectedOriginalFilePath: playbackSourceRef.current?.originalFilePath ?? null,
      selectedSourceUrl: playbackSourceRef.current?.url ?? null,
      sourceStrategy: playbackSourceRef.current?.sourceStrategy ?? null,
      sourceSupport: playbackSourceSupportRef.current,
      readyState: audio?.readyState ?? null,
      networkState: audio?.networkState ?? null,
      currentSrc: audio?.currentSrc ?? null,
      ...details,
    });
  }

  function clearPlaybackLoadTimeout(): void {
    if (!loadTimeoutRef.current) {
      return;
    }

    clearTimeout(loadTimeoutRef.current);
    loadTimeoutRef.current = null;
  }

  function schedulePlaybackLoadTimeout(context: string): void {
    clearPlaybackLoadTimeout();

    loadTimeoutRef.current = setTimeout(() => {
      const source = playbackSourceRef.current;
      const activeAudio = audioRef.current;

      if (!playOnNextLoadRef.current) {
        return;
      }

      if (!activeAudio || playbackSourceReadyRef.current) {
        return;
      }

      playOnNextLoadRef.current = false;

      const extensionText = source?.extension ? `.${source.extension}` : 'This file';
      const supportText =
        playbackSourceSupportRef.current === 'no'
          ? `${extensionText} isn't supported for playback yet.`
          : 'The track took too long to load.';

      const message = `Playback couldn’t start. ${supportText} ${buildPlaybackFallbackGuidance(
        source
      )}`;

      setPlaybackError(message);
      setIsPlaying(false);
      logPlaybackEvent('load-timeout', {
        context,
        message,
      });
    }, PLAYBACK_LOAD_TIMEOUT_MS);
  }

  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.volume = 1;
    audioRef.current = audio;

    const AudioContextConstructor = window.AudioContext;
    if (AudioContextConstructor) {
      try {
        const playbackAudioContext = new AudioContextConstructor();
        const playbackGainNode = playbackAudioContext.createGain();
        const playbackSourceNode = playbackAudioContext.createMediaElementSource(audio);

        // Create analyser node for real-time FFT/level data
        const playbackAnalyserNode = playbackAudioContext.createAnalyser();
        playbackAnalyserNode.fftSize = 4096;
        playbackAnalyserNode.smoothingTimeConstant = 0.82;
        playbackAnalyserNode.minDecibels = -90;
        playbackAnalyserNode.maxDecibels = -10;

        // Create stereo channel splitter + per-channel analysers
        const channelSplitter = playbackAudioContext.createChannelSplitter(2);
        const analyserL = playbackAudioContext.createAnalyser();
        analyserL.fftSize = 2048;
        analyserL.smoothingTimeConstant = 0.8;
        const analyserR = playbackAudioContext.createAnalyser();
        analyserR.fftSize = 2048;
        analyserR.smoothingTimeConstant = 0.8;

        // Audio chain: source → analyser → gain → destination
        playbackSourceNode.connect(playbackAnalyserNode);
        playbackAnalyserNode.connect(playbackGainNode);
        playbackGainNode.connect(playbackAudioContext.destination);
        playbackGainNode.gain.value = DEFAULT_PLAYBACK_VOLUME;

        // Stereo split branch (tapped after analyser, before gain)
        playbackAnalyserNode.connect(channelSplitter);
        channelSplitter.connect(analyserL, 0);
        channelSplitter.connect(analyserR, 1);

        playbackAudioContextRef.current = playbackAudioContext;
        playbackGainNodeRef.current = playbackGainNode;
        playbackAnalyserNodeRef.current = playbackAnalyserNode;
        setAnalyserNode(playbackAnalyserNode);
        setAnalyserNodeL(analyserL);
        setAnalyserNodeR(analyserR);
      } catch {
        playbackAudioContextRef.current = null;
        playbackGainNodeRef.current = null;
        playbackAnalyserNodeRef.current = null;
        setAnalyserNode(null);
        setAnalyserNodeL(null);
        setAnalyserNodeR(null);
      }
    }

    applyPlaybackGain(DEFAULT_PLAYBACK_VOLUME, 0);

    const onTimeUpdate = () => {
      const currentTime = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
      setCurrentTimeSeconds(currentTime);

      rememberSongPlayhead(lastLoadedSongIdRef.current, currentTime, {
        durationSeconds: Number.isFinite(audio.duration) ? audio.duration : undefined,
      });
    };

    const onLoadedMetadata = () => {
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      setDurationSeconds(duration);
      restorePendingPlayhead(audio);

      logPlaybackEvent('loadedmetadata', {
        durationSeconds: duration || null,
      });
    };

    const onLoadStart = () => {
      setPlaybackSourceReady(false);
      logPlaybackEvent('loadstart');
    };

    const onCanPlay = () => {
      setPlaybackSourceReady(true);
      clearPlaybackLoadTimeout();
      restorePendingPlayhead(audio);
      logPlaybackEvent('canplay');

      if (!playOnNextLoadRef.current) {
        return;
      }

      playOnNextLoadRef.current = false;

      void resumePlaybackContextIfNeeded()
        .then(() => audio.play())
        .catch((cause: unknown) => {
          const message = cause instanceof Error ? cause.message : String(cause);
          setPlaybackError(
            `Playback couldn’t start: ${message}. ${buildPlaybackFallbackGuidance(
              playbackSourceRef.current
            )}`
          );
          logPlaybackEvent('play-rejected-after-canplay', {
            message,
          });
        });
    };

    const onPlay = () => {
      clearPlaybackLoadTimeout();
      setPlaybackError(null);
      setIsPlaying(true);
      logPlaybackEvent('play');
    };

    const onPause = () => {
      setIsPlaying(false);
      logPlaybackEvent('pause', {
        currentTimeSeconds: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
      });
    };

    const onEnded = () => {
      const mode = repeatModeRef.current;
      rememberCurrentSongPlayhead();

      logPlaybackEvent('ended', {
        repeatMode: mode,
      });

      if (mode === 'one') {
        audio.currentTime = 0;
        void resumePlaybackContextIfNeeded()
          .then(() => audio.play())
          .catch((cause: unknown) => {
            const message = cause instanceof Error ? cause.message : String(cause);
            setPlaybackError(`Couldn't restart the track on repeat: ${message}.`);
            logPlaybackEvent('repeat-one-restart-failed', {
              message,
            });
          });
        return;
      }

      const checklistTyping =
        checklistModalSongIdRef.current !== null &&
        checklistModalSongIdRef.current === selectedPlaybackSongIdRef.current &&
        checklistInputFocusedRef.current &&
        checklistDraftTextRef.current.trim().length > 0;

      if (checklistTyping) {
        const endedAt = Number.isFinite(audio.duration) ? audio.duration : currentTimeSecondsRef.current;
        setCurrentTimeSeconds(endedAt);
        setIsPlaying(false);
        logPlaybackEvent('ended-paused-for-checklist-typing', {
          currentTimeSeconds: endedAt,
        });
        return;
      }

      const advanced = moveInQueueRef.current(1, {
        wrap: mode === 'all',
        autoplay: true,
      });

      if (
        advanced &&
        checklistModalSongIdRef.current !== null &&
        checklistModalSongIdRef.current === selectedPlaybackSongIdRef.current &&
        queueMoveTargetSongIdRef.current
      ) {
        setChecklistModalSongId(queueMoveTargetSongIdRef.current);
        resetChecklistComposer(0);
      }

      if (!advanced) {
        setIsPlaying(false);
      }
    };

    const onError = () => {
      clearPlaybackLoadTimeout();

      const expectedUrl = expectedSourceUrlRef.current;
      if (expectedUrl && audio.currentSrc && audio.currentSrc !== expectedUrl) {
        logPlaybackEvent('error-ignored-stale-source', {
          expectedUrl,
        });
        return;
      }

      const source = playbackSourceRef.current;
      const mediaError = audio.error;
      const code = mediaError?.code;
      const codeLabel = describeMediaErrorCode(code);

      setPlaybackSourceReady(false);
      setIsPlaying(false);

      const detail = code ? `${codeLabel} (code ${code})` : codeLabel;
      const compatibilityHint =
        code === 4 || playbackSourceSupportRef.current === 'no'
          ? `${source?.extension ? `.${source.extension}` : 'This format'} isn't supported for playback yet.`
          : 'This file couldn\'t be decoded.';

      const message = `Playback failed. ${compatibilityHint} ${buildPlaybackFallbackGuidance(
        source
      )}`;

      setPlaybackError(message);
      logPlaybackEvent('error', {
        detail,
        message,
      });
    };

    const onStalled = () => {
      logPlaybackEvent('stalled');
    };

    const onWaiting = () => {
      logPlaybackEvent('waiting');
    };

    const onEmptied = () => {
      logPlaybackEvent('emptied');
    };

    const onAbort = () => {
      logPlaybackEvent('abort');
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('loadstart', onLoadStart);
    audio.addEventListener('canplay', onCanPlay);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    audio.addEventListener('stalled', onStalled);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('emptied', onEmptied);
    audio.addEventListener('abort', onAbort);

    return () => {
      clearPlaybackLoadTimeout();
      playOnNextLoadRef.current = false;

      audio.pause();
      audio.removeAttribute('src');
      audio.load();

      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('loadstart', onLoadStart);
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      audio.removeEventListener('stalled', onStalled);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('emptied', onEmptied);
      audio.removeEventListener('abort', onAbort);

      playbackAnalyserNodeRef.current?.disconnect();
      playbackAnalyserNodeRef.current = null;
      setAnalyserNode(null);

      for (const f of bandSoloFiltersRef.current) {
        try { f.disconnect(); } catch { /* ignore */ }
      }
      bandSoloFiltersRef.current = [];

      playbackGainNodeRef.current?.disconnect();
      playbackGainNodeRef.current = null;

      const playbackAudioContext = playbackAudioContextRef.current;
      playbackAudioContextRef.current = null;
      if (playbackAudioContext) {
        void playbackAudioContext.close().catch(() => undefined);
      }
    };
  }, [applyPlaybackGain]);

  useEffect(() => {
    let mounted = true;

    Promise.all([
      window.producerPlayer.getLibrarySnapshot(),
      window.producerPlayer.getEnvironment(),
    ])
      .then(([initialSnapshot, environmentInfo]) => {
        if (!mounted) {
          return;
        }

        setSnapshot(initialSnapshot);
        setEnvironment(environmentInfo);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (!mounted) {
          return;
        }

        setError(cause instanceof Error ? cause.message : String(cause));
        setLoading(false);
      });

    const unsubscribe = window.producerPlayer.onSnapshotUpdated((nextSnapshot) => {
      setSnapshot(nextSnapshot);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (snapshot.linkedFolders.length === 0) {
      setSelectedFolderId(null);
      return;
    }

    const selectedStillExists = snapshot.linkedFolders.some(
      (folder) => folder.id === selectedFolderId
    );

    if (!selectedStillExists) {
      setSelectedFolderId(snapshot.linkedFolders[0].id);
    }
  }, [snapshot.linkedFolders, selectedFolderId]);

  const { songs, matchedVersionNamesBySongId } = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    const matchedVersions = new Map<string, string[]>();
    const folderScopedSongs = selectedFolderId
      ? snapshot.songs.filter((song) => song.folderId === selectedFolderId)
      : snapshot.songs;

    if (query.length === 0) {
      return {
        songs: folderScopedSongs,
        matchedVersionNamesBySongId: matchedVersions,
      };
    }

    const filteredSongs = folderScopedSongs.filter((song) => {
      const matchingVersionNames = Array.from(
        new Set(
          song.versions
            .filter((version) => {
              const searchableFields = [
                version.fileName,
                version.filePath,
                version.extension,
              ];

              return searchableFields.some((field) =>
                field.toLowerCase().includes(query)
              );
            })
            .map((version) => version.fileName)
        )
      );

      const matchesSongText =
        song.title.toLowerCase().includes(query) ||
        song.normalizedTitle.toLowerCase().includes(query);

      if (matchingVersionNames.length > 0) {
        matchedVersions.set(song.id, matchingVersionNames);
      }

      return matchesSongText || matchingVersionNames.length > 0;
    });

    return {
      songs: filteredSongs,
      matchedVersionNamesBySongId: matchedVersions,
    };
  }, [searchText, selectedFolderId, snapshot.songs]);

  const songDateOpacityBySongId = useMemo(
    () =>
      computeSongDateOpacitiesByAge(
        songs.map((song) => ({
          id: song.id,
          latestExportAt: song.latestExportAt,
        }))
      ),
    [songs]
  );

  useEffect(() => {
    if (songs.length === 0) {
      setSelectedSongId(null);
      return;
    }

    if (!selectedSongId || songs.every((song) => song.id !== selectedSongId)) {
      setSelectedSongId(songs[0].id);
    }
  }, [songs, selectedSongId]);

  const selectedSong: SongWithVersions | undefined = songs.find(
    (song) => song.id === selectedSongId
  );

  const inspectorVersions = selectedSong ? sortVersions(selectedSong.versions) : [];

  useEffect(() => {
    if (!selectedSong) {
      setSelectedPlaybackVersionId(null);
      return;
    }

    const availableVersionIds = new Set(selectedSong.versions.map((version) => version.id));

    if (selectedPlaybackVersionId && availableVersionIds.has(selectedPlaybackVersionId)) {
      return;
    }

    const currentPlaybackSelectionStillExists =
      selectedPlaybackVersionId !== null &&
      snapshot.versions.some((version) => version.id === selectedPlaybackVersionId);

    if (currentPlaybackSelectionStillExists) {
      return;
    }

    setSelectedPlaybackVersionId(getPreferredPlaybackVersionId(selectedSong));
  }, [selectedPlaybackVersionId, selectedSong, snapshot.versions]);

  const selectedPlaybackVersion =
    snapshot.versions.find((version) => version.id === selectedPlaybackVersionId) ?? null;
  const selectedPlaybackFilePath = selectedPlaybackVersion?.filePath ?? null;
  const selectedPlaybackSongId = selectedPlaybackVersion?.songId ?? null;
  selectedPlaybackSongIdRef.current = selectedPlaybackSongId;
  const activeMixPlaybackSource =
    selectedPlaybackFilePath &&
    mixPlaybackSourceSelectedFilePath === selectedPlaybackFilePath
      ? mixPlaybackSource
      : null;
  const referencePlaybackKey = getReferencePlaybackKey(referenceTrack);
  const isRefMode = playbackPreviewMode === 'reference' && referenceTrack !== null;
  const refSuffix = isRefMode ? ' (Reference)' : '';
  const refTrackSuffix = isRefMode ? ' (Reference Track)' : '';
  const desiredPlaybackSource =
    playbackPreviewMode === 'reference'
      ? referenceTrack?.playbackSource ?? null
      : activeMixPlaybackSource;
  const desiredPlaybackKey =
    playbackPreviewMode === 'reference' ? referencePlaybackKey : selectedPlaybackSongId;
  const desiredPlaybackFilePath =
    playbackPreviewMode === 'reference' ? referenceTrack?.filePath ?? null : selectedPlaybackFilePath;
  const activePlaybackKey =
    playbackPreviewMode === 'reference' && referenceTrack && referencePlaybackKey
      ? referencePlaybackKey
      : selectedPlaybackSongId;
  const activePlaybackFilePath =
    playbackPreviewMode === 'reference' && referenceTrack
      ? referenceTrack.filePath
      : selectedPlaybackFilePath;
  const activePlaybackLabel =
    playbackPreviewMode === 'reference' && referenceTrack
      ? {
          fileName: referenceTrack.fileName,
          subtitle: `${referenceTrack.subtitle} · reference`,
        }
      : {
          fileName: selectedPlaybackVersion?.fileName ?? 'Selected track',
          subtitle: selectedSong?.title ?? 'Selected track',
        };
  const shortTermLufsEstimate = analysis
    ? estimateShortTermLufs(analysis, currentTimeSeconds)
    : null;
  const referenceShortTermEstimate = referenceTrack
    ? estimateShortTermLufs(referenceTrack.previewAnalysis, 0)
    : null;
  const selectedNormalizationPlatform = getNormalizationPlatformProfile(
    selectedNormalizationPlatformId
  );
  const normalizationPreview = computePlatformNormalizationPreview(
    measuredAnalysis,
    selectedNormalizationPlatform
  );
  const normalizationPreviewByPlatformId = useMemo(() => {
    const map = new Map<NormalizationPlatformId, ReturnType<typeof computePlatformNormalizationPreview>>();
    for (const platform of NORMALIZATION_PLATFORM_PROFILES) {
      map.set(platform.id, computePlatformNormalizationPreview(measuredAnalysis, platform));
    }
    return map;
  }, [measuredAnalysis]);
  const referenceLevelMatchGainDb = (() => {
    if (
      !referenceLevelMatchEnabled ||
      playbackPreviewMode !== 'reference' ||
      !analysis ||
      !referenceTrack
    ) {
      return 0;
    }
    const mixLufs = analysis.integratedLufsEstimate;
    const refLufs = referenceTrack.previewAnalysis.integratedLufsEstimate;
    if (!Number.isFinite(mixLufs) || !Number.isFinite(refLufs)) return 0;
    return mixLufs - refLufs;
  })();

  const appliedNormalizationGainDb =
    (normalizationPreviewEnabled &&
    normalizationPreview !== null &&
    normalizationPreview.appliedGainDb !== null
      ? normalizationPreview.appliedGainDb
      : 0) + referenceLevelMatchGainDb;
  const activeReferenceComparison =
    analysis && measuredAnalysis && referenceTrack
      ? {
          shortTermDeltaDb:
            shortTermLufsEstimate !== null && referenceShortTermEstimate !== null
              ? shortTermLufsEstimate - referenceShortTermEstimate
              : null,
          integratedDeltaDb:
            measuredAnalysis.integratedLufs !== null &&
            referenceTrack.measuredAnalysis.integratedLufs !== null
              ? measuredAnalysis.integratedLufs - referenceTrack.measuredAnalysis.integratedLufs
              : null,
          truePeakDeltaDb:
            measuredAnalysis.truePeakDbfs !== null &&
            referenceTrack.measuredAnalysis.truePeakDbfs !== null
              ? measuredAnalysis.truePeakDbfs - referenceTrack.measuredAnalysis.truePeakDbfs
              : null,
          tonalDelta: {
            low: analysis.tonalBalance.low - referenceTrack.previewAnalysis.tonalBalance.low,
            mid: analysis.tonalBalance.mid - referenceTrack.previewAnalysis.tonalBalance.mid,
            high: analysis.tonalBalance.high - referenceTrack.previewAnalysis.tonalBalance.high,
          },
        }
      : null;

  useEffect(() => {
    applyPlaybackGain(volume, appliedNormalizationGainDb);
  }, [appliedNormalizationGainDb, applyPlaybackGain, volume]);

  // Mid/Side monitoring processor
  useEffect(() => {
    const audioContext = playbackAudioContextRef.current;
    const gainNode = playbackGainNodeRef.current;
    if (!audioContext || !gainNode) return;

    // Clean up previous processor
    if (midSideProcessorRef.current) {
      try { midSideProcessorRef.current.disconnect(); } catch { /* ignore */ }
      midSideProcessorRef.current = null;
    }

    if (midSideMode === 'stereo') {
      // Reconnect gain directly to destination
      try { gainNode.disconnect(); } catch { /* ignore */ }
      gainNode.connect(audioContext.destination);
      return;
    }

    // Create ScriptProcessorNode for mid or side
    const bufferSize = 4096;
    const processor = audioContext.createScriptProcessor(bufferSize, 2, 2);
    processor.onaudioprocess = (event) => {
      const inputL = event.inputBuffer.getChannelData(0);
      const inputR = event.inputBuffer.getChannelData(1);
      const outputL = event.outputBuffer.getChannelData(0);
      const outputR = event.outputBuffer.getChannelData(1);

      for (let i = 0; i < bufferSize; i++) {
        if (midSideMode === 'mid') {
          const mid = (inputL[i] + inputR[i]) / 2;
          outputL[i] = mid;
          outputR[i] = mid;
        } else {
          // side
          const side = (inputL[i] - inputR[i]) / 2;
          outputL[i] = side;
          outputR[i] = side;
        }
      }
    };

    try { gainNode.disconnect(); } catch { /* ignore */ }
    gainNode.connect(processor);
    processor.connect(audioContext.destination);
    midSideProcessorRef.current = processor;

    return () => {
      try { processor.disconnect(); } catch { /* ignore */ }
      try {
        gainNode.disconnect();
        gainNode.connect(audioContext.destination);
      } catch { /* ignore */ }
    };
  }, [midSideMode]);

  async function resumePlaybackContextIfNeeded(): Promise<void> {
    const playbackAudioContext = playbackAudioContextRef.current;
    if (!playbackAudioContext || playbackAudioContext.state === 'running') {
      return;
    }

    try {
      await playbackAudioContext.resume();
    } catch {
      // Ignore context resume failures and fall back to direct element playback.
    }
  }

  useEffect(() => {
    if (!selectedPlaybackVersionId || !selectedPlaybackFilePath) {
      setMixPlaybackSource(null);
      setMixPlaybackSourceSelectedFilePath(null);
      return;
    }

    let cancelled = false;
    const requestId = sourceRequestIdRef.current + 1;
    sourceRequestIdRef.current = requestId;

    const requestedFilePath = selectedPlaybackFilePath;
    setMixPlaybackSource(null);
    setMixPlaybackSourceSelectedFilePath(requestedFilePath);

    window.producerPlayer
      .resolvePlaybackSource(requestedFilePath)
      .then((source) => {
        if (cancelled || requestId !== sourceRequestIdRef.current) {
          return;
        }

        setMixPlaybackSource(source);
        setMixPlaybackSourceSelectedFilePath(requestedFilePath);
      })
      .catch((cause: unknown) => {
        if (cancelled || requestId !== sourceRequestIdRef.current) {
          return;
        }

        const message = cause instanceof Error ? cause.message : String(cause);
        setPlaybackError(message);
        setMixPlaybackSource(null);
        setMixPlaybackSourceSelectedFilePath(requestedFilePath);
        logPlaybackEvent('source-resolve-failed', {
          requestId,
          message,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [selectedPlaybackFilePath, selectedPlaybackVersionId]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    rememberSongPlayhead(lastLoadedSongIdRef.current, audio.currentTime, {
      durationSeconds: Number.isFinite(audio.duration) ? audio.duration : undefined,
    });

    const activeSource = desiredPlaybackSource;
    const activeSourceKey = desiredPlaybackKey;
    const activePlaybackFilePath = desiredPlaybackFilePath;
    const clearReason =
      playbackPreviewMode === 'reference' ? 'no-reference-preview' : 'no-selected-version';

    clearPlaybackLoadTimeout();
    setPlaybackError(null);

    if (!activeSourceKey || !activePlaybackFilePath) {
      pendingRestoreTimeRef.current = null;
      lastLoadedSongIdRef.current = null;
      playOnNextLoadRef.current = false;
      setPlaybackSource(null);
      setCurrentTimeSeconds(0);
      setDurationSeconds(0);
      setPlaybackSourceReady(false);
      setPlaybackSourceSupport('unknown');
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      logPlaybackEvent('source-cleared', {
        reason: clearReason,
      });
      return;
    }

    if (!activeSource) {
      pendingRestoreTimeRef.current = null;
      lastLoadedSongIdRef.current = null;
      setPlaybackSource(null);
      setCurrentTimeSeconds(0);
      setDurationSeconds(0);
      setPlaybackSourceReady(false);
      setPlaybackSourceSupport('unknown');
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      logPlaybackEvent('source-cleared', {
        reason: clearReason,
      });
      return;
    }

    const alreadyLoaded =
      lastLoadedSongIdRef.current === activeSourceKey &&
      playbackSourceRef.current?.url === activeSource.url &&
      playbackSourceRef.current?.filePath === activeSource.filePath;

    if (alreadyLoaded) {
      return;
    }

    setCurrentTimeSeconds(0);
    setDurationSeconds(0);
    setPlaybackSourceReady(false);
    setPlaybackSourceSupport('unknown');

    const rememberedPosition = playbackPositionBySongIdRef.current.get(activeSourceKey) ?? null;
    pendingRestoreTimeRef.current =
      rememberedPosition !== null && Number.isFinite(rememberedPosition) && rememberedPosition > 0
        ? rememberedPosition
        : null;

    setPlaybackSource(activeSource);

    if (!activeSource.exists) {
      const message = buildMissingFileMessage(activeSource.filePath);
      setPlaybackError(message);
      logPlaybackEvent('source-missing', {
        message,
      });
      return;
    }

    if (!audio.paused) {
      playOnNextLoadRef.current = true;
    }

    audio.pause();
    lastLoadedSongIdRef.current = activeSourceKey;
    audio.removeAttribute('src');
    audio.src = activeSource.url;

    const supportHintRaw = activeSource.mimeType ? audio.canPlayType(activeSource.mimeType) : '';
    const supportHint =
      supportHintRaw === 'probably' || supportHintRaw === 'maybe' ? supportHintRaw : 'no';

    setPlaybackSourceSupport(supportHint);

    logPlaybackEvent('source-selected', {
      mode: playbackPreviewMode,
      filePath: activeSource.filePath,
      url: activeSource.url,
      mimeType: activeSource.mimeType,
      supportHint,
      pendingRestoreTimeSeconds: pendingRestoreTimeRef.current,
    });

    audio.load();
  }, [
    desiredPlaybackFilePath,
    desiredPlaybackKey,
    desiredPlaybackSource,
    playbackPreviewMode,
  ]);

  const isSearching = searchText.trim().length > 0;
  const canReorderSongs = !isSearching;
  const canExportPlaylistOrder = songs.length > 0;
  const canExportLatestVersionsInOrder = songs.length > 0;
  const canImportPlaylistOrder = snapshot.linkedFolders.length > 0;
  const listHintText = isSearching
    ? 'Search is filtering the list — clear it to reorder tracks.'
    : 'Drag tracks to reorder — track positions are preserved.';
  const showEmptyStateAddFolder = songs.length === 0 && !isSearching && !loading;
  const emptyStateText = isSearching
    ? 'No matching tracks or versions.'
    : loading
      ? 'Loading…'
      : snapshot.linkedFolders.length === 0
        ? 'No folder linked yet.'
        : 'No tracks found in linked folders.';

  const playbackQueue = useMemo(() => {
    const queue: SongVersion[] = [];

    for (const song of songs) {
      const activeVersion = getActiveSongVersion(song);
      if (activeVersion) {
        queue.push(activeVersion);
      }
    }

    return queue;
  }, [songs]);

  useEffect(() => {
    const versionsNeedingDuration = playbackQueue.filter(
      (version) => getDurationSecondsFromVersion(version, resolvedAlbumDurationSecondsByVersionId[version.id]) === null
    );

    if (versionsNeedingDuration.length === 0) {
      return;
    }

    let cancelled = false;

    const probeDurationFromUrl = (url: string): Promise<number | null> => {
      return new Promise((resolve) => {
        const probe = new Audio();
        probe.preload = 'metadata';

        const cleanup = () => {
          probe.pause();
          probe.removeAttribute('src');
          probe.load();
        };

        probe.addEventListener(
          'loadedmetadata',
          () => {
            const nextDuration = Number.isFinite(probe.duration) && probe.duration > 0 ? probe.duration : null;
            cleanup();
            resolve(nextDuration);
          },
          { once: true }
        );

        probe.addEventListener(
          'error',
          () => {
            cleanup();
            resolve(null);
          },
          { once: true }
        );

        probe.src = url;
        probe.load();
      });
    };

    void (async () => {
      const resolvedEntries: Array<[string, number]> = [];

      for (const version of versionsNeedingDuration) {
        try {
          const source = await window.producerPlayer.resolvePlaybackSource(version.filePath);
          const resolvedSeconds = await probeDurationFromUrl(source.url);

          if (cancelled || resolvedSeconds === null) {
            continue;
          }

          resolvedEntries.push([version.id, resolvedSeconds]);
        } catch {
          continue;
        }
      }

      if (cancelled || resolvedEntries.length === 0) {
        return;
      }

      setResolvedAlbumDurationSecondsByVersionId((current) => {
        const next = { ...current };
        for (const [versionId, seconds] of resolvedEntries) {
          next[versionId] = seconds;
        }
        return next;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [playbackQueue, resolvedAlbumDurationSecondsByVersionId]);

  const albumDurationSeconds = useMemo(() => {
    let totalSeconds = 0;
    let resolvedCount = 0;

    for (const version of playbackQueue) {
      const durationSeconds = getDurationSecondsFromVersion(
        version,
        resolvedAlbumDurationSecondsByVersionId[version.id]
      );

      if (durationSeconds === null) {
        continue;
      }

      totalSeconds += durationSeconds;
      resolvedCount += 1;
    }

    if (playbackQueue.length === 0 || resolvedCount === 0) {
      return null;
    }

    return totalSeconds;
  }, [playbackQueue, resolvedAlbumDurationSecondsByVersionId]);

  const currentQueueIndex = useMemo(() => {
    if (!selectedPlaybackVersionId) {
      return -1;
    }

    return playbackQueue.findIndex((version) => version.id === selectedPlaybackVersionId);
  }, [playbackQueue, selectedPlaybackVersionId]);

  useEffect(() => {
    moveInQueueRef.current = (direction, { wrap, autoplay }) => {
      queueMoveTargetSongIdRef.current = null;

      if (playbackQueue.length === 0) {
        return false;
      }

      const currentIndex = currentQueueIndex;
      let nextIndex =
        currentIndex === -1
          ? direction > 0
            ? 0
            : playbackQueue.length - 1
          : currentIndex + direction;

      if (nextIndex < 0 || nextIndex >= playbackQueue.length) {
        if (!wrap) {
          return false;
        }

        nextIndex = (nextIndex + playbackQueue.length) % playbackQueue.length;
      }

      const nextVersion = playbackQueue[nextIndex];
      if (!nextVersion) {
        return false;
      }

      queueMoveTargetSongIdRef.current = nextVersion.songId;
      playOnNextLoadRef.current = autoplay;
      rememberCurrentSongPlayhead();
      setSelectedSongId(nextVersion.songId);
      setSelectedPlaybackVersionId(nextVersion.id);
      return true;
    };
  }, [currentQueueIndex, playbackQueue]);

  useEffect(() => {
    return window.producerPlayer.onTransportCommand((command: TransportCommand) => {
      if (command === 'play-pause') {
        transportActionRef.current.toggle();
        return;
      }

      if (command === 'next-track') {
        transportActionRef.current.next();
        return;
      }

      transportActionRef.current.previous();
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const active = document.activeElement;
      const textEntryFocused = isTextEntryElement(active);
      const hasUndoModifier = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      if (
        checklistModalSongIdRef.current &&
        !textEntryFocused &&
        hasUndoModifier &&
        !event.altKey
      ) {
        const wantsUndo = key === 'z' && !event.shiftKey;
        const wantsRedo = key === 'y' || (key === 'z' && event.shiftKey);

        if (wantsUndo || wantsRedo) {
          const applied = wantsRedo
            ? handleRedoChecklistChange()
            : handleUndoChecklistChange();

          if (applied) {
            event.preventDefault();
          }

          return;
        }
      }

      // Left/Right arrow keys: seek backward/forward by 5 seconds
      // (industry standard for media players — matches YouTube, HTML5 players, etc.)
      if (
        !textEntryFocused &&
        !hasUndoModifier &&
        (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
      ) {
        event.preventDefault();
        const seekOffset = event.key === 'ArrowLeft' ? -5 : 5;
        handleSkipSecondsRef.current(seekOffset);
        return;
      }

      if (event.repeat || event.code !== 'Space') {
        return;
      }

      if (active instanceof HTMLButtonElement || textEntryFocused) {
        return;
      }

      // For everything else — range sliders, buttons, divs, timeline,
      // the body, or any non-text-entry element — always toggle play/pause.
      event.preventDefault();
      transportActionRef.current.toggle();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!canReorderSongs) {
      clearDragState();
    }
  }, [canReorderSongs]);

  async function runSnapshotTask(task: () => Promise<LibrarySnapshot>): Promise<void> {
    setError(null);
    try {
      const nextSnapshot = await task();
      setSnapshot(nextSnapshot);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function runVoidTask(task: () => Promise<void>): Promise<void> {
    setError(null);
    try {
      await task();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  // handleLinkFolderPath removed — path-linker UI is no longer rendered.
  // Tests use page.evaluate(() => window.producerPlayer.linkFolder(path)) directly.

  async function handleOpenFolderDialog(): Promise<void> {
    await runSnapshotTask(() => window.producerPlayer.linkFolderWithDialog());
  }

  async function handleUnlinkFolder(folderId: string, folderName: string): Promise<void> {
    const confirmed = window.confirm(
      `Unlink "${folderName}"?\n\nThis removes the folder from Producer Player and resets saved ordering/history for that linked folder in the app state.\n\nAudio files on disk are not deleted.`
    );

    if (!confirmed) {
      return;
    }

    await runSnapshotTask(() => window.producerPlayer.unlinkFolder(folderId));
  }

  function handleAlbumTitleStartEdit(): void {
    setAlbumTitleDraft(albumTitle);
    setAlbumTitleEditing(true);
    requestAnimationFrame(() => {
      albumTitleInputRef.current?.focus();
      albumTitleInputRef.current?.select();
    });
  }

  function handleAlbumTitleSave(): void {
    const trimmed = albumTitleDraft.trim();
    const newTitle = trimmed || 'Untitled Album';
    setAlbumTitle(newTitle);
    window.localStorage.setItem(ALBUM_TITLE_STORAGE_KEY, newTitle);
    setAlbumTitleEditing(false);
  }

  function handleAlbumTitleCancel(): void {
    setAlbumTitleEditing(false);
  }

  function handleAlbumArtClick(): void {
    albumArtInputRef.current?.click();
  }

  function processAlbumArtDataUrl(dataUrl: string): void {
    const MAX_ALBUM_ART_DIM = 256;
    const img = new Image();
    img.onload = () => {
      let finalDataUrl = dataUrl;
      if (img.width > MAX_ALBUM_ART_DIM || img.height > MAX_ALBUM_ART_DIM) {
        const canvas = document.createElement('canvas');
        const scale = Math.min(MAX_ALBUM_ART_DIM / img.width, MAX_ALBUM_ART_DIM / img.height);
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          finalDataUrl = canvas.toDataURL('image/png');
        }
      }
      setAlbumArt(finalDataUrl);
      try {
        window.localStorage.setItem(ALBUM_ART_STORAGE_KEY, finalDataUrl);
      } catch {
        // localStorage may be full for very large images — ignore silently
      }
    };
    img.src = dataUrl;
  }

  function handleAlbumArtChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (!file) return;

    const isPsd = file.name.toLowerCase().endsWith('.psd');

    if (isPsd) {
      // Parse PSD file using @webtoon/psd and render the composite image
      file.arrayBuffer().then(async (buffer) => {
        const PsdModule = await import('@webtoon/psd');
        const Psd = PsdModule.default;
        const psd = Psd.parse(buffer);
        const compositeData = await psd.composite();
        const canvas = document.createElement('canvas');
        canvas.width = psd.width;
        canvas.height = psd.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const imageData = ctx.createImageData(psd.width, psd.height);
        imageData.data.set(compositeData);
        ctx.putImageData(imageData, 0, 0);
        const dataUrl = canvas.toDataURL('image/png');
        processAlbumArtDataUrl(dataUrl);
      }).catch(() => {
        // PSD parsing failed — ignore silently
      });
    } else {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        processAlbumArtDataUrl(dataUrl);
      };
      reader.readAsDataURL(file);
    }
    // Reset input so re-selecting the same file triggers onChange
    e.target.value = '';
  }

  async function handleRescan(): Promise<void> {
    await runSnapshotTask(() => window.producerPlayer.rescanLibrary());
  }

  async function handleOrganize(): Promise<void> {
    await runSnapshotTask(() => window.producerPlayer.organizeOldVersions());
  }

  function buildPlaylistOrderExportPayload(): PlaylistOrderExportV1 {
    const selectedFolder =
      snapshot.linkedFolders.find((folder) => folder.id === selectedFolderId) ?? null;

    const selectedSong = selectedSongId
      ? songs.find((song) => song.id === selectedSongId) ?? null
      : null;

    return {
      schema: 'producer-player.playlist-order',
      version: 1,
      exportedAt: new Date().toISOString(),
      selection: {
        selectedFolderId: selectedFolder?.id ?? null,
        selectedFolderPath: selectedFolder?.path ?? null,
        selectedFolderName: selectedFolder?.name ?? null,
        selectedSongId: selectedSong?.id ?? null,
        selectedSongTitle: selectedSong?.title ?? null,
        selectedSongNormalizedTitle: selectedSong?.normalizedTitle ?? null,
        selectedPlaybackVersionId: selectedPlaybackVersionId ?? null,
        selectedPlaybackFilePath: selectedPlaybackVersion?.filePath ?? null,
        selectedPlaybackFileName: selectedPlaybackVersion?.fileName ?? null,
      },
      ordering: {
        songIds: songs.map((song) => song.id),
        normalizedTitles: songs.map((song) => song.normalizedTitle),
      },
      folders: snapshot.linkedFolders,
      songs,
    };
  }

  async function handleExportPlaylistOrder(): Promise<void> {
    await runVoidTask(async () => {
      const payload = buildPlaylistOrderExportPayload();

      if (payload.songs.length === 0) {
        throw new Error('Nothing to export yet (no tracks in the current album view).');
      }

      await window.producerPlayer.exportPlaylistOrder(payload);
    });
  }

  async function handleExportLatestVersionsInOrder(): Promise<void> {
    await runVoidTask(async () => {
      const payload = buildPlaylistOrderExportPayload();

      if (payload.songs.length === 0) {
        throw new Error('Nothing to export yet (no tracks in the current album view).');
      }

      await window.producerPlayer.exportLatestVersionsInOrder(payload);
    });
  }

  async function handleImportPlaylistOrder(): Promise<void> {
    await runSnapshotTask(async () => {
      const payload = await window.producerPlayer.importPlaylistOrder();
      if (!payload) {
        return snapshot;
      }

      const folderPath = payload.selection.selectedFolderPath;
      const folderId = payload.selection.selectedFolderId;

      const folder =
        (folderPath && folderPath.length > 0
          ? snapshot.linkedFolders.find((entry) => entry.path === folderPath) ?? null
          : null) ??
        (folderId
          ? snapshot.linkedFolders.find((entry) => entry.id === folderId) ?? null
          : null);

      if ((folderPath || folderId) && !folder) {
        throw new Error(
          `Import references a folder that is not linked: ${folderPath ?? folderId}\n\nLink that folder first, then import again.`
        );
      }

      if (folder) {
        setSelectedFolderId(folder.id);
      }

      const folderSongs = folder ? snapshot.songs.filter((song) => song.folderId === folder.id) : snapshot.songs;
      const byNormalizedTitle = new Map(folderSongs.map((song) => [song.normalizedTitle, song.id]));
      const existingSongIdSet = new Set(folderSongs.map((song) => song.id));

      const resolvedOrder: string[] = [];
      const seen = new Set<string>();

      for (let index = 0; index < payload.ordering.songIds.length; index += 1) {
        const songIdCandidate = payload.ordering.songIds[index];
        const normalizedTitleCandidate = payload.ordering.normalizedTitles[index];

        let resolvedSongId: string | null = null;

        if (existingSongIdSet.has(songIdCandidate)) {
          resolvedSongId = songIdCandidate;
        } else if (normalizedTitleCandidate && byNormalizedTitle.has(normalizedTitleCandidate)) {
          resolvedSongId = byNormalizedTitle.get(normalizedTitleCandidate) ?? null;
        }

        if (!resolvedSongId || seen.has(resolvedSongId)) {
          continue;
        }

        seen.add(resolvedSongId);
        resolvedOrder.push(resolvedSongId);
      }

      if (resolvedOrder.length === 0) {
        throw new Error('Import did not match any songs in the currently linked library.');
      }

      const nextSnapshot = await window.producerPlayer.reorderSongs(resolvedOrder);

      const nextFolderSongs = folder
        ? nextSnapshot.songs.filter((song) => song.folderId === folder.id)
        : nextSnapshot.songs;

      const selectionSongId =
        (payload.selection.selectedSongId &&
          nextFolderSongs.some((song) => song.id === payload.selection.selectedSongId)
          ? payload.selection.selectedSongId
          : null) ??
        (payload.selection.selectedSongNormalizedTitle
          ? nextFolderSongs.find(
              (song) => song.normalizedTitle === payload.selection.selectedSongNormalizedTitle
            )?.id ?? null
          : null) ??
        (payload.selection.selectedSongTitle
          ? nextFolderSongs.find((song) => song.title === payload.selection.selectedSongTitle)
              ?.id ?? null
          : null);

      if (selectionSongId) {
        setSelectedSongId(selectionSongId);

        const selectedSong =
          nextFolderSongs.find((song) => song.id === selectionSongId) ?? null;
        const selectedVersion =
          (payload.selection.selectedPlaybackVersionId
            ? selectedSong?.versions.find(
                (version) => version.id === payload.selection.selectedPlaybackVersionId
              ) ?? null
            : null) ??
          (payload.selection.selectedPlaybackFilePath
            ? selectedSong?.versions.find(
                (version) => version.filePath === payload.selection.selectedPlaybackFilePath
              ) ?? null
            : null) ??
          (payload.selection.selectedPlaybackFileName
            ? selectedSong?.versions.find(
                (version) => version.fileName === payload.selection.selectedPlaybackFileName
              ) ?? null
            : null);

        if (selectedVersion) {
          setSelectedPlaybackVersionId(selectedVersion.id);
        }
      }

      return nextSnapshot;
    });
  }

  async function handleSetAutoMoveOld(enabled: boolean): Promise<void> {
    await runSnapshotTask(() => window.producerPlayer.setAutoMoveOld(enabled));
  }

  async function handleToggleICloudBackup(enabled: boolean): Promise<void> {
    if (enabled) {
      const availability = await window.producerPlayer.checkICloudAvailable();
      setICloudAvailability(availability);

      if (!availability.available) {
        setICloudSyncError(availability.reason ?? 'iCloud Drive is not available.');
        return;
      }

      setICloudBackupEnabled(true);
      persistICloudBackupEnabled(true);
      setICloudSyncError(null);

      const now = new Date().toISOString();
      const backupData: ICloudBackupData = {
        checklists: songChecklists,
        ratings: songRatings,
        state: {
          iCloudEnabled: true,
          updatedAt: now,
        },
      };

      setICloudSyncStatus('syncing');
      try {
        const result = await window.producerPlayer.syncToICloud(backupData);
        if (result.success) {
          setICloudSyncStatus('success');
          persistICloudLastSync(now);
          setTimeout(() => setICloudSyncStatus('idle'), 2000);
        } else {
          setICloudSyncStatus('error');
          setICloudSyncError(result.error ?? 'Initial sync failed.');
        }
      } catch {
        setICloudSyncStatus('error');
        setICloudSyncError('Failed to sync to iCloud.');
      }
    } else {
      setICloudBackupEnabled(false);
      persistICloudBackupEnabled(false);
      setICloudSyncStatus('idle');
      setICloudSyncError(null);
    }
  }

  function buildSongOrderAfterDrop(
    draggedSongId: string,
    targetSongId: string,
    position: DragOverPosition
  ): string[] {
    const currentOrder = songs.map((song) => song.id);
    return reorderSongIds(currentOrder, draggedSongId, targetSongId, position);
  }

  async function handleReorderSongs(nextOrder: string[]): Promise<void> {
    const currentOrder = snapshot.songs.map((song) => song.id);
    if (arraysEqual(currentOrder, nextOrder)) {
      return;
    }

    await runSnapshotTask(() => window.producerPlayer.reorderSongs(nextOrder));
  }

  function clearDragState(): void {
    dragTargetRef.current = null;
    setDragSongId(null);
    setDragOverSongId(null);
    setDragOverPosition('before');
  }

  function shouldAutoplayOnTransport(): boolean {
    const audio = audioRef.current;
    if (!audio) {
      return isPlaying;
    }

    return playOnNextLoadRef.current || !audio.paused;
  }

  function handleSongRowSelect(songId: string): void {
    if (songId !== selectedSongId && songId === selectedPlaybackSongId) {
      rememberCurrentSongPlayhead();
    }

    setSelectedSongId(songId);
  }

  async function handleSongRowPlay(songId: string): Promise<void> {
    const song = songs.find((candidate) => candidate.id === songId);
    if (!song) {
      handleSongRowSelect(songId);
      return;
    }

    const nextPlaybackVersionId = getPreferredPlaybackVersionId(song);

    if (songId !== selectedSongId) {
      rememberCurrentSongPlayhead();
    }

    setPlaybackError(null);
    setSelectedSongId(songId);

    if (!nextPlaybackVersionId) {
      return;
    }

    setSelectedPlaybackVersionId(nextPlaybackVersionId);

    const audio = audioRef.current;
    const canResumeCurrentSelection =
      songId === selectedSongId &&
      nextPlaybackVersionId === selectedPlaybackVersionId &&
      lastLoadedSongIdRef.current === songId &&
      playbackSourceReadyRef.current;

    if (audio && canResumeCurrentSelection) {
      if (audio.paused) {
        try {
          await resumePlaybackContextIfNeeded();
          await audio.play();
          logPlaybackEvent('song-row-double-click-played-current-selection');
        } catch (cause: unknown) {
          const message = cause instanceof Error ? cause.message : String(cause);
          setPlaybackError(
            `Playback couldn’t start: ${message}. ${buildPlaybackFallbackGuidance(
              playbackSourceRef.current
            )}`
          );
          logPlaybackEvent('song-row-double-click-play-failed', {
            message,
          });
        }
      }
      return;
    }

    playOnNextLoadRef.current = true;
    schedulePlaybackLoadTimeout('song-row-double-click');
  }

  function updateDragOverPosition(
    event: DragEvent<HTMLElement>,
    hoveredSongId: string
  ): void {
    if (!canReorderSongs || !dragSongId || dragSongId === hoveredSongId) {
      dragTargetRef.current = null;
      setDragOverSongId(null);
      return;
    }

    event.preventDefault();

    const nextPosition = deriveDragOverPosition(event);

    if (dragOverSongId !== hoveredSongId) {
      setDragOverSongId(hoveredSongId);
    }

    if (dragOverPosition !== nextPosition) {
      setDragOverPosition(nextPosition);
    }

    dragTargetRef.current = {
      songId: hoveredSongId,
      position: nextPosition,
    };

    event.dataTransfer.dropEffect = 'move';
  }

  async function handleDropOnSongRow(
    event: DragEvent<HTMLElement>,
    hoveredSongId: string
  ): Promise<void> {
    event.preventDefault();

    if (!canReorderSongs) {
      clearDragState();
      return;
    }

    const draggedSongId = dragSongId;
    if (!draggedSongId) {
      clearDragState();
      return;
    }

    let dropTarget = dragTargetRef.current;

    if (!dropTarget || dropTarget.songId !== hoveredSongId) {
      dropTarget = {
        songId: hoveredSongId,
        position: deriveDragOverPosition(event),
      };
    }

    const nextOrder = buildSongOrderAfterDrop(
      draggedSongId,
      dropTarget.songId,
      dropTarget.position
    );

    await handleReorderSongs(nextOrder);
    clearDragState();
  }

  async function handleDropOnMainList(event: DragEvent<HTMLUListElement>): Promise<void> {
    if (event.defaultPrevented) {
      return;
    }

    event.preventDefault();

    if (!canReorderSongs) {
      clearDragState();
      return;
    }

    const draggedSongId = dragSongId;
    const dropTarget = dragTargetRef.current;

    if (!draggedSongId || !dropTarget) {
      clearDragState();
      return;
    }

    const nextOrder = buildSongOrderAfterDrop(
      draggedSongId,
      dropTarget.songId,
      dropTarget.position
    );

    await handleReorderSongs(nextOrder);
    clearDragState();
  }

  async function handleTogglePlayback(): Promise<void> {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    setPlaybackError(null);

    if (!selectedPlaybackVersion && playbackQueue.length > 0) {
      const firstVersion = playbackQueue[0];
      playOnNextLoadRef.current = true;
      setSelectedSongId(firstVersion.songId);
      setSelectedPlaybackVersionId(firstVersion.id);
      schedulePlaybackLoadTimeout('queue-prime');
      return;
    }

    if (!selectedPlaybackVersion) {
      return;
    }

    const shouldSwitchToSelectedSong =
      !!selectedSong && selectedSong.id !== selectedPlaybackSongId && audio.paused;

    if (shouldSwitchToSelectedSong) {
      const nextPlaybackVersionId = getPreferredPlaybackVersionId(selectedSong);

      if (!nextPlaybackVersionId) {
        return;
      }

      rememberCurrentSongPlayhead();
      playOnNextLoadRef.current = true;
      setSelectedPlaybackVersionId(nextPlaybackVersionId);
      schedulePlaybackLoadTimeout('selected-song-play-request');
      return;
    }

    const source = playbackSourceRef.current;
    if (source && !source.exists) {
      setPlaybackError(buildMissingFileMessage(source.filePath));
      logPlaybackEvent('play-blocked-missing-source', {
        filePath: source.filePath,
      });
      return;
    }

    if (audio.paused) {
      const hasSource = audio.currentSrc.length > 0 || audio.src.length > 0;

      if (!hasSource || !playbackSourceReadyRef.current) {
        playOnNextLoadRef.current = true;
        schedulePlaybackLoadTimeout('awaiting-canplay');

        if (hasSource) {
          audio.load();
          logPlaybackEvent('play-requested-reload-source', {
            reason: 'source-not-ready',
          });
        }

        if (playbackSourceSupportRef.current === 'no') {
          setPlaybackError(
            `This format isn't supported for playback yet. ${buildPlaybackFallbackGuidance(
              source
            )}`
          );
        }

        return;
      }

      try {
        await resumePlaybackContextIfNeeded();
        await audio.play();
        logPlaybackEvent('play-requested-direct');
      } catch (cause: unknown) {
        const message = cause instanceof Error ? cause.message : String(cause);
        setPlaybackError(`Playback couldn’t start: ${message}. ${buildPlaybackFallbackGuidance(source)}`);
        logPlaybackEvent('play-rejected', {
          message,
        });
      }
      return;
    }

    playOnNextLoadRef.current = false;
    clearPlaybackLoadTimeout();
    rememberCurrentSongPlayhead();
    audio.pause();
  }

  function handleSeek(nextTimeSeconds: number): void {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(nextTimeSeconds)) {
      return;
    }

    audio.currentTime = nextTimeSeconds;
    setCurrentTimeSeconds(nextTimeSeconds);

    rememberSongPlayhead(lastLoadedSongIdRef.current, nextTimeSeconds, {
      durationSeconds: Number.isFinite(audio.duration) ? audio.duration : undefined,
    });
  }

  function handleSkipSeconds(offsetSeconds: number): void {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.currentTime)) {
      return;
    }

    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    const nextTime = Math.max(0, Math.min(audio.currentTime + offsetSeconds, duration));
    handleSeek(nextTime);
    logPlaybackEvent('skip-seconds', {
      offsetSeconds,
      fromSeconds: audio.currentTime,
      toSeconds: nextTime,
    });
  }

  function syncChecklistModalToQueueMoveTarget(): void {
    const nextSongId = queueMoveTargetSongIdRef.current;

    if (!nextSongId || !checklistModalSongIdRef.current) {
      return;
    }

    setChecklistModalSongId(nextSongId);
    resetChecklistComposer(0);
  }

  function handlePreviousTrack(options?: { syncChecklistModal?: boolean }): void {
    const audio = audioRef.current;
    const currentTime = audio && Number.isFinite(audio.currentTime) ? audio.currentTime : 0;

    if (currentTime > PREVIOUS_TRACK_RESTART_THRESHOLD_SECONDS) {
      handleSeek(0);
      logPlaybackEvent('transport-previous-restart-current-track', {
        currentTimeSeconds: currentTime,
      });
      return;
    }

    const movedToPrevious = moveInQueueRef.current(-1, {
      wrap: repeatMode === 'all',
      autoplay: shouldAutoplayOnTransport(),
    });

    if (movedToPrevious) {
      if (options?.syncChecklistModal) {
        syncChecklistModalToQueueMoveTarget();
      }

      logPlaybackEvent('transport-previous-move-queue', {
        currentTimeSeconds: currentTime,
      });
      return;
    }

    if (audio && currentTime > 0.01) {
      handleSeek(0);
      logPlaybackEvent('transport-previous-restart-fallback', {
        currentTimeSeconds: currentTime,
      });
    }
  }

  function handleNextTrack(options?: { syncChecklistModal?: boolean }): void {
    const movedToNext = moveInQueueRef.current(1, {
      wrap: repeatMode === 'all',
      autoplay: shouldAutoplayOnTransport(),
    });

    if (movedToNext && options?.syncChecklistModal) {
      syncChecklistModalToQueueMoveTarget();
    }
  }

  function handleCycleRepeatMode(): void {
    setRepeatMode((current) => {
      if (current === 'off') {
        return 'one';
      }

      if (current === 'one') {
        return 'all';
      }

      return 'off';
    });
  }

  function handleVolumeChange(nextVolume: number): void {
    const clampedVolume = Math.max(0, Math.min(nextVolume, 1));
    setVolume(clampedVolume);
    applyPlaybackGain(clampedVolume, appliedNormalizationGainDb);
  }

  function rebuildBandSoloFilters(nextBands: Set<number>): void {
    const audioContext = playbackAudioContextRef.current;
    const gainNode = playbackGainNodeRef.current;
    if (!audioContext || !gainNode) return;

    // Tear down existing filter chain
    for (const f of bandSoloFiltersRef.current) {
      try { gainNode.disconnect(f); } catch { /* ignore */ }
      try { f.disconnect(); } catch { /* ignore */ }
    }
    bandSoloFiltersRef.current = [];

    if (nextBands.size === 0) {
      // No solo — connect gain directly to destination
      try { gainNode.connect(audioContext.destination); } catch { /* already connected */ }
      return;
    }

    // Disconnect direct path
    try { gainNode.disconnect(audioContext.destination); } catch { /* may not be connected */ }

    // Create a merger node so multiple band filters can feed into destination
    // Each bandpass filter runs in parallel: gain → filter → destination
    for (const bandIndex of nextBands) {
      const band = FREQUENCY_BANDS[bandIndex];
      if (!band) continue;
      const filter = createBandSoloFilter(audioContext, band);
      gainNode.connect(filter);
      filter.connect(audioContext.destination);
      bandSoloFiltersRef.current.push(filter);
    }
  }

  function handleBandToggle(bandIndex: number, shiftKey: boolean = false): void {
    setSoloedBands((prev) => {
      let next: Set<number>;
      if (shiftKey) {
        // Shift+click: select all bands EXCEPT the clicked one (exclude mode)
        next = new Set(FREQUENCY_BANDS.map((_, i) => i));
        next.delete(bandIndex);
        // If the result is the same as current selection, clear all (toggle off)
        if (next.size === prev.size && Array.from(next).every((i) => prev.has(i))) {
          next = new Set<number>();
        }
      } else {
        next = new Set(prev);
        if (next.has(bandIndex)) {
          next.delete(bandIndex);
        } else {
          next.add(bandIndex);
        }
      }
      rebuildBandSoloFilters(next);
      return next;
    });
  }

  function handleClearSoloedBands(): void {
    const empty = new Set<number>();
    rebuildBandSoloFilters(empty);
    setSoloedBands(empty);
  }

  async function loadReferenceTrack(
    sourceType: ReferenceTrackSource,
    selection: Pick<LoadedReferenceTrack, 'filePath' | 'fileName' | 'subtitle' | 'playbackSource'>,
    options: {
      previewAnalysis?: TrackAnalysisResult;
      measuredAnalysis?: AudioFileAnalysis;
    } = {}
  ): Promise<void> {
    setReferenceStatus('loading');
    setReferenceError(null);

    try {
      const previewAnalysis =
        options.previewAnalysis ??
        (await analyzeTrackFromUrl(selection.playbackSource.url));
      const nextMeasuredAnalysis =
        options.measuredAnalysis ??
        (await window.producerPlayer.analyzeAudioFile(selection.filePath));

      setReferenceTrack({
        sourceType,
        filePath: selection.filePath,
        fileName: selection.fileName,
        subtitle: selection.subtitle,
        playbackSource: selection.playbackSource,
        previewAnalysis,
        measuredAnalysis: nextMeasuredAnalysis,
      });

      setSavedReferenceTracks((current) => {
        const next = addToSavedReferenceTracks(current, {
          filePath: selection.filePath,
          fileName: selection.fileName,
          dateLastUsed: new Date().toISOString(),
          integratedLufs:
            typeof nextMeasuredAnalysis.integratedLufs === 'number' &&
            Number.isFinite(nextMeasuredAnalysis.integratedLufs)
              ? nextMeasuredAnalysis.integratedLufs
              : null,
        });

        persistSavedReferenceTracks(next);
        return next;
      });

      // Task 41: Persist reference track per song
      if (selectedSongId) {
        persistReferenceTrackForSong(selectedSongId, selection.filePath);
      }

      // Task 42: Add to recent reference tracks list
      setRecentReferenceTracks(
        addToRecentReferenceTracks({ filePath: selection.filePath, fileName: selection.fileName })
      );

      setReferenceStatus('ready');
    } catch (cause: unknown) {
      setReferenceStatus('error');
      setReferenceError(
        cause instanceof Error ? cause.message : 'Could not load the reference track.'
      );
    }
  }

  async function handleUseCurrentTrackAsReference(): Promise<void> {
    if (!analysis || !measuredAnalysis || !selectedPlaybackVersion) {
      return;
    }

    const currentTrackPlaybackSource =
      mixPlaybackSource && mixPlaybackSource.filePath === selectedPlaybackVersion.filePath
        ? mixPlaybackSource
        : await window.producerPlayer.resolvePlaybackSource(selectedPlaybackVersion.filePath);

    await loadReferenceTrack(
      'linked-track',
      {
        filePath: selectedPlaybackVersion.filePath,
        fileName: selectedPlaybackVersion.fileName,
        subtitle: selectedSong ? selectedSong.title : 'Linked track',
        playbackSource: currentTrackPlaybackSource,
      },
      {
        previewAnalysis: analysis,
        measuredAnalysis,
      }
    );
  }

  async function handleChooseReferenceTrack(): Promise<void> {
    setReferenceError(null);

    const pickedReference: ReferenceTrackSelection | null =
      await window.producerPlayer.pickReferenceTrack();
    if (!pickedReference) {
      return;
    }

    await loadReferenceTrack('external-file', {
      filePath: pickedReference.filePath,
      fileName: pickedReference.fileName,
      subtitle: 'External reference file',
      playbackSource: pickedReference.playbackSource,
    });
  }

  async function handleLoadSavedReferenceTrack(
    savedReference: SavedReferenceTrackEntry
  ): Promise<void> {
    setReferenceError(null);

    const resolvedPlaybackSource = await window.producerPlayer.resolvePlaybackSource(
      savedReference.filePath
    );

    await loadReferenceTrack('external-file', {
      filePath: savedReference.filePath,
      fileName: savedReference.fileName,
      subtitle: 'Saved reference file',
      playbackSource: resolvedPlaybackSource,
    });
  }

  function handleRemoveSavedReferenceTrack(filePath: string): void {
    setSavedReferenceTracks((current) => {
      const next = current.filter((savedReference) => savedReference.filePath !== filePath);
      persistSavedReferenceTracks(next);
      return next;
    });
  }

  function handleClearReferenceTrack(): void {
    setReferenceTrack(null);
    setReferenceStatus('idle');
    setReferenceError(null);
  }

  /** Load a reference track by file path (looks it up in saved references). */
  async function handleLoadReferenceByFilePath(filePath: string): Promise<void> {
    const saved = savedReferenceTracks.find((r) => r.filePath === filePath);
    if (saved) {
      await handleLoadSavedReferenceTrack(saved);
      return;
    }
    // Fallback: resolve and load directly
    try {
      const resolvedPlaybackSource = await window.producerPlayer.resolvePlaybackSource(filePath);
      const fileName = filePath.split('/').pop() ?? filePath;
      await loadReferenceTrack('external-file', {
        filePath,
        fileName,
        subtitle: 'Auto-loaded reference',
        playbackSource: resolvedPlaybackSource,
      });
    } catch {
      // Silently ignore — the file may no longer exist
    }
  }

  // Task 41: Auto-load persisted reference track when song changes
  const autoLoadRefSongIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedSongId || selectedSongId === autoLoadRefSongIdRef.current) return;
    autoLoadRefSongIdRef.current = selectedSongId;

    // Only auto-load if no reference is currently loaded
    if (referenceTrack) return;

    const persistedPath = readReferenceTrackForSong(selectedSongId);
    if (persistedPath) {
      void handleLoadReferenceByFilePath(persistedPath);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSongId]);

  function handleReferencePreviewModeChange(nextMode: 'mix' | 'reference'): void {
    if (nextMode === 'reference' && !referenceTrack) {
      return;
    }

    setPlaybackPreviewMode(nextMode);
  }

  function handleOpenSupportLink(url: string): void {
    void runVoidTask(() => window.producerPlayer.openExternalUrl(url));
  }

  async function handleCheckForUpdates(): Promise<void> {
    setUpdateCheckStatus('checking');
    setUpdateCheckResult(null);

    try {
      const result = await window.producerPlayer.checkForUpdates();
      setUpdateCheckResult(result);
      setUpdateCheckStatus(result.status === 'error' ? 'error' : result.status);
    } catch (cause: unknown) {
      setUpdateCheckStatus('error');
      setUpdateCheckResult({
        status: 'error',
        currentVersion: 'Unknown',
        latestVersion: null,
        latestTag: null,
        releaseUrl: `${PUBLIC_REPOSITORY_URL}/releases`,
        downloadUrl: null,
        releaseName: null,
        publishedAt: null,
        notes: null,
        message: cause instanceof Error ? cause.message : 'Could not check for updates.',
      });
    }
  }

  async function handleDownloadUpdate(): Promise<void> {
    await runVoidTask(async () => {
      await window.producerPlayer.openUpdateDownload(
        updateCheckResult?.downloadUrl ?? updateCheckResult?.releaseUrl ?? null
      );
    });
  }

  function handleSongRatingChange(songId: string, nextRatingValue: number): void {
    const nextRating = getNormalizedSliderRating(nextRatingValue);

    setSongRatings((current) => ({
      ...current,
      [songId]: nextRating,
    }));
  }

  function updateSongChecklists(
    updater: (current: Record<string, SongChecklistItem[]>) => Record<string, SongChecklistItem[]>,
    options?: { recordHistory?: boolean }
  ): void {
    const shouldRecordHistory = options?.recordHistory ?? true;

    setSongChecklists((current) => {
      const next = updater(current);

      if (next === current) {
        return current;
      }

      if (shouldRecordHistory) {
        setChecklistUndoStack((history) => {
          const snapshot = cloneSongChecklistsState(current);
          const nextHistory =
            history.length >= CHECKLIST_HISTORY_LIMIT
              ? [...history.slice(history.length - CHECKLIST_HISTORY_LIMIT + 1), snapshot]
              : [...history, snapshot];

          checklistUndoStackRef.current = nextHistory;
          return nextHistory;
        });

        setChecklistRedoStack(() => {
          checklistRedoStackRef.current = [];
          return [];
        });
      }

      songChecklistsRef.current = next;
      return next;
    });
  }

  function updateSongChecklistItems(
    songId: string,
    updater: (items: SongChecklistItem[]) => SongChecklistItem[],
    options?: { recordHistory?: boolean }
  ): void {
    updateSongChecklists((current) => {
      const currentItems = current[songId] ?? [];
      const nextItems = updater(currentItems);

      if (nextItems.length === 0) {
        if (!(songId in current)) {
          return current;
        }

        const { [songId]: _removed, ...rest } = current;
        return rest;
      }

      return {
        ...current,
        [songId]: nextItems,
      };
    }, options);
  }

  function handleUndoChecklistChange(): boolean {
    const history = checklistUndoStackRef.current;
    const previousSnapshot = history[history.length - 1];

    if (!previousSnapshot) {
      return false;
    }

    const currentSnapshot = cloneSongChecklistsState(songChecklistsRef.current);
    const nextUndoHistory = history.slice(0, -1);
    const nextRedoHistory = [currentSnapshot, ...checklistRedoStackRef.current].slice(
      0,
      CHECKLIST_HISTORY_LIMIT
    );
    const restoredState = cloneSongChecklistsState(previousSnapshot);

    checklistUndoStackRef.current = nextUndoHistory;
    checklistRedoStackRef.current = nextRedoHistory;
    songChecklistsRef.current = restoredState;

    setChecklistUndoStack(nextUndoHistory);
    setChecklistRedoStack(nextRedoHistory);
    setSongChecklists(restoredState);

    return true;
  }

  function handleRedoChecklistChange(): boolean {
    const history = checklistRedoStackRef.current;
    const nextSnapshot = history[0];

    if (!nextSnapshot) {
      return false;
    }

    const currentSnapshot = cloneSongChecklistsState(songChecklistsRef.current);
    const nextRedoHistory = history.slice(1);
    const nextUndoHistory = [
      ...checklistUndoStackRef.current,
      currentSnapshot,
    ].slice(-CHECKLIST_HISTORY_LIMIT);
    const restoredState = cloneSongChecklistsState(nextSnapshot);

    checklistUndoStackRef.current = nextUndoHistory;
    checklistRedoStackRef.current = nextRedoHistory;
    songChecklistsRef.current = restoredState;

    setChecklistUndoStack(nextUndoHistory);
    setChecklistRedoStack(nextRedoHistory);
    setSongChecklists(restoredState);

    return true;
  }

  function captureCurrentPlaybackTimestamp(
    offsetSeconds = 0,
    fallbackSeconds = currentTimeSecondsRef.current
  ): number | null {
    const audio = audioRef.current;
    const duration =
      audio && Number.isFinite(audio.duration) && audio.duration > 0
        ? audio.duration
        : durationSecondsRef.current > 0
          ? durationSecondsRef.current
          : undefined;
    if (duration === undefined) {
      return null;
    }

    const time =
      audio && Number.isFinite(audio.currentTime) ? audio.currentTime : fallbackSeconds;

    return clampTimestampSeconds(time, duration, offsetSeconds);
  }

  function clearChecklistTimestampHighlights(): void {
    for (const timeout of checklistHighlightTimeoutsRef.current.values()) {
      clearTimeout(timeout);
    }
    checklistHighlightTimeoutsRef.current.clear();
    setActiveChecklistTimestampIds([]);
  }

  function resetChecklistComposer(nextTimestamp: number | null = 0): void {
    setChecklistDraftText('');
    setChecklistTimestampMode('live');
    setChecklistCapturedTimestamp(nextTimestamp);
    clearChecklistTimestampHighlights();
  }

  function freezeChecklistTimestampAtCurrentPlayback(): void {
    const timestamp = captureCurrentPlaybackTimestamp(CHECKLIST_CAPTURE_LOOKBACK_SECONDS);
    if (timestamp === null) {
      return;
    }

    setChecklistTimestampMode('frozen');
    setChecklistCapturedTimestamp(timestamp);
  }

  function handleOpenSongChecklist(songId: string): void {
    lastFocusedChecklistTransportRef.current = null;
    setChecklistModalSongId(songId);
    resetChecklistComposer(captureCurrentPlaybackTimestamp());
  }

  function handleCloseSongChecklist(): void {
    lastFocusedChecklistTransportRef.current = null;
    setChecklistModalSongId(null);
    setChecklistDraftText('');
    setChecklistCapturedTimestamp(null);
    setChecklistTimestampMode('live');
    clearChecklistTimestampHighlights();
  }

  function handleOpenMasteringFromChecklist(): void {
    const modalSongId = checklistModalSongIdRef.current;
    if (modalSongId) {
      const modalSong = snapshot.songs.find((song) => song.id === modalSongId) ?? null;
      if (modalSong) {
        const nextPlaybackVersionId = getPreferredPlaybackVersionId(modalSong);
        setSelectedSongId(modalSong.id);
        if (nextPlaybackVersionId) {
          setSelectedPlaybackVersionId(nextPlaybackVersionId);
        }
      }
    }

    handleCloseSongChecklist();
    setAnalysisExpanded(true);
  }

  function handleOpenChecklistFromMastering(): void {
    if (!selectedPlaybackSongId) {
      return;
    }

    setAnalysisExpanded(false);
    handleOpenSongChecklist(selectedPlaybackSongId);
  }

  function handleChecklistOverlayWheel(event: WheelEvent<HTMLDivElement>): void {
    const checklistModalCardNode = checklistModalCardRef.current;
    const eventTarget = event.target instanceof Node ? event.target : null;

    if (checklistModalCardNode && eventTarget && checklistModalCardNode.contains(eventTarget)) {
      return;
    }

    const preferredScrollTarget = [
      checklistUnderlyingAnalysisPaneRef.current,
      checklistUnderlyingSidePaneScrollRef.current,
    ].find((candidate): candidate is HTMLElement => {
      if (!candidate || !canElementScroll(candidate)) {
        return false;
      }

      return isPointWithinElementBounds(candidate, event.clientX, event.clientY);
    });

    let scrollTarget = preferredScrollTarget ?? null;

    if (!scrollTarget) {
      const checklistOverlayNode = checklistOverlayRef.current;
      if (!checklistOverlayNode) {
        return;
      }

      const previousPointerEvents = checklistOverlayNode.style.pointerEvents;
      let underlyingElement: Element | null = null;

      try {
        checklistOverlayNode.style.pointerEvents = 'none';
        underlyingElement = document.elementFromPoint(event.clientX, event.clientY);
      } finally {
        checklistOverlayNode.style.pointerEvents = previousPointerEvents;
      }

      scrollTarget = findNearestScrollableElement(underlyingElement);
    }

    if (!scrollTarget) {
      return;
    }

    const previousScrollTop = scrollTarget.scrollTop;
    const previousScrollLeft = scrollTarget.scrollLeft;

    scrollTarget.scrollBy({
      top: event.deltaY,
      left: event.deltaX,
      behavior: 'auto',
    });

    if (
      scrollTarget.scrollTop !== previousScrollTop ||
      scrollTarget.scrollLeft !== previousScrollLeft
    ) {
      event.preventDefault();
    }
  }

  function handleChecklistTimestampClick(seconds: number): void {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    handleSeek(seconds);

    if (audio.paused) {
      void resumePlaybackContextIfNeeded()
        .then(() => audio.play())
        .catch(() => undefined);
    }
  }

  function handleChecklistInputFocus(): void {
    checklistInputFocusedRef.current = true;
  }

  function handleChecklistInputBlur(): void {
    checklistInputFocusedRef.current = false;
  }

  function autosizeChecklistTextarea(target: HTMLTextAreaElement): void {
    target.style.height = 'auto';
    target.style.height = `${target.scrollHeight}px`;
  }

  function handleChecklistDraftTextChange(nextText: string): void {
    const wasEmpty = checklistDraftTextRef.current.trim().length === 0;
    setChecklistDraftText(nextText);

    if (nextText.trim().length === 0) {
      setChecklistTimestampMode('live');
      setChecklistCapturedTimestamp(captureCurrentPlaybackTimestamp());
      return;
    }

    if (wasEmpty && checklistTimestampMode === 'live') {
      freezeChecklistTimestampAtCurrentPlayback();
    }
  }

  function handleChecklistSetNow(): void {
    freezeChecklistTimestampAtCurrentPlayback();
  }

  function highlightChecklistTimestamp(itemId: string): void {
    setActiveChecklistTimestampIds((current) =>
      current.includes(itemId) ? current : [...current, itemId]
    );

    const existingTimeout = checklistHighlightTimeoutsRef.current.get(itemId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    const timeout = setTimeout(() => {
      setActiveChecklistTimestampIds((current) => current.filter((id) => id !== itemId));
      checklistHighlightTimeoutsRef.current.delete(itemId);
    }, CHECKLIST_TIMESTAMP_HIGHLIGHT_DURATION_MS);

    checklistHighlightTimeoutsRef.current.set(itemId, timeout);
  }

  function handleAddChecklistItem(): void {
    const songId = checklistModalSongId;
    const itemText = checklistDraftText.trim();

    if (!songId || itemText.length === 0) {
      return;
    }

    updateSongChecklistItems(songId, (items) => [
      {
        id: createChecklistItemId(),
        text: itemText,
        completed: false,
        timestampSeconds: checklistCapturedTimestamp,
      },
      ...items,
    ]);

    resetChecklistComposer(captureCurrentPlaybackTimestamp());
  }

  function handleToggleChecklistItem(songId: string, itemId: string, completed: boolean): void {
    updateSongChecklistItems(songId, (items) =>
      items.map((item) => (item.id === itemId ? { ...item, completed } : item))
    );
  }

  function handleChecklistItemTextChange(
    songId: string,
    itemId: string,
    nextText: string
  ): void {
    updateSongChecklistItems(
      songId,
      (items) => items.map((item) => (item.id === itemId ? { ...item, text: nextText } : item)),
      { recordHistory: false }
    );
  }

  function handleRemoveChecklistItem(songId: string, itemId: string): void {
    updateSongChecklistItems(songId, (items) => items.filter((item) => item.id !== itemId));
  }

  function handleClearCompletedChecklistItems(songId: string): void {
    const completedCount = (songChecklists[songId] ?? []).filter((item) => item.completed).length;

    if (completedCount === 0) {
      return;
    }

    const confirmed = window.confirm(
      `Clear ${completedCount} completed checklist item${completedCount === 1 ? '' : 's'}?\n\nThis only removes completed items from this song's checklist.`
    );

    if (!confirmed) {
      return;
    }

    updateSongChecklistItems(songId, (items) => items.filter((item) => !item.completed));
  }

  function handleOpenMigrationModal(): void {
    setMigrationModalOpen(true);
    setMigrationJsonInput('');
    setMigrationParseError(null);
    setMigrationPreview(null);
    setMigrationSchemaCopied(false);
    setMigrationImportDone(false);
  }

  function handleCloseMigrationModal(): void {
    setMigrationModalOpen(false);
    setMigrationJsonInput('');
    setMigrationParseError(null);
    setMigrationPreview(null);
    setMigrationSchemaCopied(false);
    setMigrationImportDone(false);
  }

  function handleCopyMigrationSchema(): void {
    const songList = snapshot.songs.map((song) => song.title);

    const schema = {
      description:
        'Parse the user\'s old notes about their songs and return structured JSON matching the schema below. ' +
        'Match each note to the correct song by name. If you cannot determine a playback timestamp, omit timestampSeconds or set it to null. ' +
        'Set completed to false for all items unless the notes clearly indicate something is done.',
      schema: {
        songs: [
          {
            songName: 'string — must match one of the song names listed below',
            checklistItems: [
              {
                text: 'string — the checklist/note item text, preserved as-is from the original notes',
                completed: 'boolean — default false',
                timestampSeconds:
                  'number | null — playback timestamp in seconds if known, otherwise null',
              },
            ],
          },
        ],
      },
      currentSongs: songList,
      example: {
        input:
          'Leaky: at 1:23 needs more bass, check high end. Midnight Drive: vocal too loud at verse 2, at 2:45 add reverb to bridge, 0:30 snare hits too hard.',
        output: {
          songs: [
            {
              songName: 'Leaky',
              checklistItems: [
                {
                  text: 'needs more bass',
                  completed: false,
                  timestampSeconds: 83,
                },
                {
                  text: 'check high end',
                  completed: false,
                  timestampSeconds: null,
                },
              ],
            },
            {
              songName: 'Midnight Drive',
              checklistItems: [
                {
                  text: 'vocal too loud at verse 2',
                  completed: false,
                  timestampSeconds: null,
                },
                {
                  text: 'add reverb to bridge',
                  completed: false,
                  timestampSeconds: 165,
                },
                {
                  text: 'snare hits too hard',
                  completed: false,
                  timestampSeconds: 30,
                },
              ],
            },
          ],
        },
        timestampNote:
          'When the note text contains a playback timestamp like "1:23", "at 2:45", or "0:30", convert it to total seconds for timestampSeconds (e.g. 1:23 = 83, 2:45 = 165, 0:30 = 30). Remove the timestamp prefix from the text. If no timestamp is present, set timestampSeconds to null.',
      },
    };

    const schemaText = JSON.stringify(schema, null, 2);

    setMigrationParseError(null);
    void window.producerPlayer
      .copyTextToClipboard(schemaText)
      .then(() => {
        setMigrationSchemaCopied(true);
        setTimeout(() => setMigrationSchemaCopied(false), 3000);
      })
      .catch(() => {
        setMigrationSchemaCopied(false);
        setMigrationParseError('Couldn’t copy the schema. Try again.');
      });
  }

  function handleParseMigrationJson(): void {
    setMigrationParseError(null);
    setMigrationPreview(null);
    setMigrationImportDone(false);

    const input = migrationJsonInput.trim();
    if (input.length === 0) {
      setMigrationParseError('Paste the LLM\'s JSON response above.');
      return;
    }

    try {
      const parsed = lenientParseJson(input);
      const preview = parseMigrationInput(parsed, snapshot.songs);

      if (preview.length === 0) {
        setMigrationParseError(
          'No matching songs found in the JSON. Make sure the song names in the JSON match your current songs.'
        );
        return;
      }

      setMigrationPreview(preview);
    } catch (err) {
      setMigrationParseError(
        err instanceof Error ? err.message : 'Failed to parse the JSON input.'
      );
    }
  }

  function handleConfirmMigrationImport(): void {
    if (!migrationPreview) return;

    updateSongChecklists((current) => {
      const next = { ...current };

      for (const entry of migrationPreview) {
        if (!entry.matchedSongId) continue;

        const existingItems = next[entry.matchedSongId] ?? [];
        const newItems: SongChecklistItem[] = entry.items.map((item) => ({
          id: createChecklistItemId(),
          text: item.text,
          completed: item.completed,
          timestampSeconds: item.timestampSeconds,
        }));

        next[entry.matchedSongId] = [...newItems, ...existingItems];
      }

      return next;
    });

    setMigrationImportDone(true);
    setMigrationPreview(null);
  }

  const checklistModalSong = checklistModalSongId
    ? snapshot.songs.find((song) => song.id === checklistModalSongId) ?? null
    : null;
  const checklistModalItems = checklistModalSongId
    ? songChecklists[checklistModalSongId] ?? []
    : [];
  const checklistModalItemsChronological = useMemo(
    () => [...checklistModalItems].reverse(),
    [checklistModalItems]
  );
  const checklistCompletedCount = checklistModalItems.filter((item) => item.completed).length;
  const checklistModalCanOpenMastering = checklistModalSong
    ? getPreferredPlaybackVersionId(checklistModalSong) !== null
    : false;

  useEffect(() => {
    if (
      checklistModalSongId !== selectedPlaybackSongId ||
      checklistModalItems.length === 0 ||
      !isPlaying
    ) {
      previousChecklistPlaybackTimeRef.current = currentTimeSeconds;
      return;
    }

    const previousTime = previousChecklistPlaybackTimeRef.current;
    if (currentTimeSeconds < previousTime) {
      previousChecklistPlaybackTimeRef.current = currentTimeSeconds;
      return;
    }

    for (const item of checklistModalItems) {
      if (item.timestampSeconds === null) {
        continue;
      }

      if (item.timestampSeconds > previousTime && item.timestampSeconds <= currentTimeSeconds) {
        highlightChecklistTimestamp(item.id);
      }
    }

    previousChecklistPlaybackTimeRef.current = currentTimeSeconds;
  }, [
    checklistModalItems,
    checklistModalSongId,
    currentTimeSeconds,
    isPlaying,
    selectedPlaybackSongId,
  ]);

  const measuredIntegratedText = buildAnalysisValue(
    analysisStatus,
    formatMeasuredStat(measuredAnalysis?.integratedLufs, 'LUFS'),
    {
      loading: 'Loading…',
      error: 'Error',
    }
  );
  const measuredLraText = buildAnalysisValue(
    analysisStatus,
    formatMeasuredStat(measuredAnalysis?.loudnessRangeLufs, 'LU'),
    {
      loading: 'Loading…',
      error: 'Error',
    }
  );
  const measuredTruePeakText = buildAnalysisValue(
    analysisStatus,
    formatMeasuredStat(measuredAnalysis?.truePeakDbfs, 'dBTP'),
    {
      loading: 'Loading…',
      error: 'Error',
    }
  );
  const measuredMaxShortTermText = buildAnalysisValue(
    analysisStatus,
    formatMeasuredStat(measuredAnalysis?.maxShortTermLufs, 'LUFS'),
    {
      loading: 'Loading…',
      error: 'Error',
    }
  );
  const measuredMaxMomentaryText = buildAnalysisValue(
    analysisStatus,
    formatMeasuredStat(measuredAnalysis?.maxMomentaryLufs, 'LUFS'),
    {
      loading: 'Loading…',
      error: 'Error',
    }
  );
  const measuredSamplePeakText = buildAnalysisValue(
    analysisStatus,
    formatMeasuredStat(measuredAnalysis?.samplePeakDbfs, 'dBFS'),
    {
      loading: 'Loading…',
      error: 'Error',
    }
  );
  const measuredMeanVolumeText = buildAnalysisValue(
    analysisStatus,
    formatMeasuredStat(measuredAnalysis?.meanVolumeDbfs, 'dBFS'),
    {
      loading: 'Loading…',
      error: 'Error',
    }
  );
  const shortTermEstimateText = buildAnalysisValue(
    analysisStatus,
    formatMeasuredStat(shortTermLufsEstimate, 'LUFS est.'),
    {
      loading: 'Loading…',
      error: 'Error',
    }
  );
  const activeTonalBalance = isRefMode
    ? referenceTrack?.previewAnalysis.tonalBalance ?? null
    : analysis?.tonalBalance ?? null;
  const tonalBalanceStatus = isRefMode ? referenceStatus : analysisStatus;
  const tonalBalanceReady = tonalBalanceStatus === 'ready' && activeTonalBalance !== null;
  const referenceIntegratedText =
    referenceStatus === 'ready' && referenceTrack
      ? formatMeasuredStat(referenceTrack.measuredAnalysis.integratedLufs, 'LUFS')
      : buildAnalysisValue(referenceStatus, '—', {
          loading: 'Loading…',
          error: 'Error',
        });
  const referenceTruePeakText =
    referenceStatus === 'ready' && referenceTrack
      ? formatMeasuredStat(referenceTrack.measuredAnalysis.truePeakDbfs, 'dBTP')
      : buildAnalysisValue(referenceStatus, '—', {
          loading: 'Loading…',
          error: 'Error',
        });
  const normalizationChangeText = buildAnalysisValue(
    analysisStatus,
    formatSignedLevel(normalizationPreview?.appliedGainDb),
    {
      loading: 'Loading…',
      error: 'Error',
      empty: '—',
    }
  );
  const normalizationProjectedText = buildAnalysisValue(
    analysisStatus,
    formatMeasuredStat(normalizationPreview?.projectedIntegratedLufs, 'LUFS'),
    {
      loading: 'Loading…',
      error: 'Error',
      empty: '—',
    }
  );
  const normalizationCapText =
    analysisStatus === 'ready' && normalizationPreview
      ? normalizationPreview.headroomCapDb === null
        ? 'No true peak data available'
        : `${normalizationPreview.headroomCapDb >= 0 ? '+' : ''}${normalizationPreview.headroomCapDb.toFixed(1)} dB before ${selectedNormalizationPlatform.truePeakCeilingDbtp.toFixed(0)} dBTP`
      : buildAnalysisValue(analysisStatus, '—', {
          loading: 'Loading…',
          error: 'Error',
          empty: '—',
        });
  const normalizationSummaryText =
    analysisStatus === 'loading'
      ? 'Analysing…'
      : analysisStatus === 'error'
        ? 'Could not analyse this track.'
        : normalizationPreview
          ? `${selectedNormalizationPlatform.label} · ${
              normalizationPreviewEnabled ? 'preview on' : 'preview off'
            } · ${normalizationPreview.explanation}`
          : 'Select a track to preview platform loudness.';
  const selectedPlaybackSampleRateText = buildAnalysisValue(
    analysisStatus,
    formatSampleRateHz(measuredAnalysis?.sampleRateHz),
    {
      loading: 'Loading…',
      error: 'Error',
      empty: '—',
    }
  );
  const checklistDraftIsEmpty = checklistDraftText.trim().length === 0;
  const updateStatusText =
    updateCheckStatus === 'checking'
      ? 'Checking for updates…'
      : updateCheckResult?.message ?? null;
  const canDownloadUpdate =
    updateCheckResult?.status === 'update-available' &&
    Boolean(updateCheckResult.downloadUrl || updateCheckResult.releaseUrl);

  transportActionRef.current = {
    toggle: () => {
      void handleTogglePlayback();
    },
    next: handleNextTrack,
    previous: handlePreviousTrack,
  };
  handleSkipSecondsRef.current = handleSkipSeconds;

  const getAnalysisContext = useCallback((): AgentContext | null => {
    const trackInfo = selectedPlaybackVersion
      ? {
          name: selectedSong?.title ?? selectedPlaybackVersion.fileName,
          fileName: selectedPlaybackVersion.fileName,
          filePath: selectedPlaybackVersion.filePath,
          format: selectedPlaybackVersion.extension,
          durationSeconds: (selectedPlaybackVersion.durationMs ?? 0) / 1000,
          sampleRateHz: measuredAnalysis?.sampleRateHz ?? null,
          albumName:
            snapshot.linkedFolders.find((f) => f.id === selectedFolderId)?.name ?? null,
          albumTrackCount: songs.length,
          referenceTrack: referenceTrack
            ? { fileName: referenceTrack.fileName, filePath: referenceTrack.filePath }
            : null,
        }
      : null;

    const staticAnalysisData = measuredAnalysis
      ? {
          integratedLufs: measuredAnalysis.integratedLufs,
          loudnessRangeLufs: measuredAnalysis.loudnessRangeLufs,
          truePeakDbfs: measuredAnalysis.truePeakDbfs,
          samplePeakDbfs: measuredAnalysis.samplePeakDbfs,
          meanVolumeDbfs: measuredAnalysis.meanVolumeDbfs,
          maxMomentaryLufs: measuredAnalysis.maxMomentaryLufs,
          maxShortTermLufs: measuredAnalysis.maxShortTermLufs,
          sampleRateHz: measuredAnalysis.sampleRateHz,
        }
      : null;

    const webAudioData = analysis
      ? {
          peakDbfs: analysis.peakDbfs,
          integratedLufsEstimate: analysis.integratedLufsEstimate,
          rmsDbfs: analysis.rmsDbfs,
          crestFactorDb: analysis.crestFactorDb,
          dcOffset: analysis.dcOffset,
          clipCount: analysis.clipCount,
          durationSeconds: analysis.durationSeconds,
          tonalBalance: {
            low: analysis.tonalBalance.low,
            mid: analysis.tonalBalance.mid,
            high: analysis.tonalBalance.high,
          },
          frameLoudnessDbfs: analysis.frameLoudnessDbfs,
          frameDurationSeconds: analysis.frameDurationSeconds,
        }
      : null;

    const platformNormData = measuredAnalysis
      ? {
          platforms: NORMALIZATION_PLATFORM_PROFILES.map((platform) => {
            const preview = normalizationPreviewByPlatformId.get(platform.id);
            return {
              platformId: platform.id,
              platformLabel: platform.label,
              targetLufs: platform.targetLufs,
              truePeakCeilingDbtp: platform.truePeakCeilingDbtp,
              policy: platform.policy,
              rawGainDb: preview?.rawGainDb ?? null,
              appliedGainDb: preview?.appliedGainDb ?? null,
              projectedIntegratedLufs: preview?.projectedIntegratedLufs ?? null,
              headroomCapDb: preview?.headroomCapDb ?? null,
              limitedByHeadroom: preview?.limitedByHeadroom ?? false,
              explanation: preview?.explanation ?? '',
            };
          }),
        }
      : null;

    const refData = referenceTrack
      ? {
          static: referenceTrack.measuredAnalysis
            ? {
                integratedLufs: referenceTrack.measuredAnalysis.integratedLufs,
                loudnessRangeLufs: referenceTrack.measuredAnalysis.loudnessRangeLufs,
                truePeakDbfs: referenceTrack.measuredAnalysis.truePeakDbfs,
                samplePeakDbfs: referenceTrack.measuredAnalysis.samplePeakDbfs,
                meanVolumeDbfs: referenceTrack.measuredAnalysis.meanVolumeDbfs,
                maxMomentaryLufs: referenceTrack.measuredAnalysis.maxMomentaryLufs,
                maxShortTermLufs: referenceTrack.measuredAnalysis.maxShortTermLufs,
                sampleRateHz: referenceTrack.measuredAnalysis.sampleRateHz,
              }
            : null,
          webAudio: referenceTrack.previewAnalysis
            ? {
                peakDbfs: referenceTrack.previewAnalysis.peakDbfs,
                integratedLufsEstimate: referenceTrack.previewAnalysis.integratedLufsEstimate,
                rmsDbfs: referenceTrack.previewAnalysis.rmsDbfs,
                crestFactorDb: referenceTrack.previewAnalysis.crestFactorDb,
                dcOffset: referenceTrack.previewAnalysis.dcOffset,
                clipCount: referenceTrack.previewAnalysis.clipCount,
                durationSeconds: referenceTrack.previewAnalysis.durationSeconds,
                tonalBalance: {
                  low: referenceTrack.previewAnalysis.tonalBalance.low,
                  mid: referenceTrack.previewAnalysis.tonalBalance.mid,
                  high: referenceTrack.previewAnalysis.tonalBalance.high,
                },
                frameLoudnessDbfs: referenceTrack.previewAnalysis.frameLoudnessDbfs,
                frameDurationSeconds: referenceTrack.previewAnalysis.frameDurationSeconds,
              }
            : null,
          deltas:
            analysis && referenceTrack.previewAnalysis
              ? {
                  integratedLufsDelta:
                    measuredAnalysis?.integratedLufs != null &&
                    referenceTrack.measuredAnalysis.integratedLufs != null
                      ? measuredAnalysis.integratedLufs -
                        referenceTrack.measuredAnalysis.integratedLufs
                      : null,
                  truePeakDelta:
                    measuredAnalysis?.truePeakDbfs != null &&
                    referenceTrack.measuredAnalysis.truePeakDbfs != null
                      ? measuredAnalysis.truePeakDbfs -
                        referenceTrack.measuredAnalysis.truePeakDbfs
                      : null,
                  crestFactorDelta:
                    analysis.crestFactorDb - referenceTrack.previewAnalysis.crestFactorDb,
                  tonalBalanceDelta: {
                    low:
                      analysis.tonalBalance.low -
                      referenceTrack.previewAnalysis.tonalBalance.low,
                    mid:
                      analysis.tonalBalance.mid -
                      referenceTrack.previewAnalysis.tonalBalance.mid,
                    high:
                      analysis.tonalBalance.high -
                      referenceTrack.previewAnalysis.tonalBalance.high,
                  },
                  loudnessRangeDelta:
                    measuredAnalysis?.loudnessRangeLufs != null &&
                    referenceTrack.measuredAnalysis.loudnessRangeLufs != null
                      ? measuredAnalysis.loudnessRangeLufs -
                        referenceTrack.measuredAnalysis.loudnessRangeLufs
                      : null,
                }
              : null,
        }
      : null;

    const checklistSongId = selectedSong?.id;
    const checklistItems = checklistSongId ? songChecklists[checklistSongId] ?? [] : [];
    const checklistData = checklistSongId
      ? {
          items: checklistItems.map((item) => ({
            id: item.id,
            text: item.text,
            completed: item.completed,
            timestampSeconds: item.timestampSeconds,
          })),
          completedCount: checklistItems.filter((i) => i.completed).length,
          totalCount: checklistItems.length,
        }
      : null;

    return {
      track: trackInfo,
      staticAnalysis: staticAnalysisData,
      webAudioAnalysis: webAudioData,
      platformNormalization: platformNormData,
      reference: refData,
      checklist: checklistData,
      activePlatformId: selectedNormalizationPlatformId,
      isPlaying,
      currentTimeSeconds,
    };
  }, [
    selectedPlaybackVersion,
    selectedSong,
    selectedFolderId,
    snapshot.linkedFolders,
    songs,
    measuredAnalysis,
    analysis,
    referenceTrack,
    normalizationPreviewByPlatformId,
    songChecklists,
    selectedNormalizationPlatformId,
    isPlaying,
    currentTimeSeconds,
  ]);

  const statusCardHelpText = useMemo(() => {
    const linkedFolderPathLines =
      snapshot.linkedFolders.length > 0
        ? snapshot.linkedFolders
            .map((folder) => `• ${folder.name}: ${folder.path}`)
            .join('\n')
        : '• No linked folders yet. Use Add Folder… above to start tracking exports.';

    const autoOrganizeArchiveLines =
      snapshot.linkedFolders.length > 0
        ? snapshot.linkedFolders
            .map((folder) => `• ${folder.path}/old`)
            .join('\n')
        : '• Archive paths appear after you link at least one folder.';

    const iCloudPathLine = iCloudAvailability?.path
      ? `• iCloud backup folder: ${iCloudAvailability.path}`
      : iCloudAvailability !== null && !iCloudAvailability.available
        ? `• iCloud backup folder: unavailable (${iCloudAvailability.reason ?? 'iCloud Drive is not available on this machine.'})`
        : '• iCloud backup folder: shown here once iCloud Drive is available.';

    return `What this card controls: library scan status plus file-management and backup toggles.

Auto-organize old versions:
• ON: older non-archived versions are moved into each linked folder's old/ subfolder while the newest version stays where it is.
• OFF: no automatic moves; versions stay where exported.

Watched folder paths:
${linkedFolderPathLines}

Auto-organize archive paths:
${autoOrganizeArchiveLines}

iCloud backup:
${iCloudPathLine}
• \"Back up to iCloud\" syncs checklists, ratings, and app preferences only (not audio files).
• Use the Show button beside iCloud backup to open the exact folder in Finder.`;
  }, [iCloudAvailability, snapshot.linkedFolders]);

  return (
    <div className="app-shell" data-testid="app-shell">
      <aside className="panel panel-left">
        <button
          type="button"
          className="sidebar-branding sidebar-branding-button"
          data-testid="producer-player-branding"
          onClick={() => handleOpenSupportLink(PUBLIC_PAGES_URL)}
          title="Open Producer Player website."
        >
          <img
            src={producerPlayerIconUrl}
            alt="Producer Player logo"
            className="sidebar-branding-logo"
            data-testid="producer-player-branding-logo"
          />
          <div className="sidebar-branding-copy">
            <div className="sidebar-branding-title-row">
              <strong>Producer Player</strong>
              <span
                className="sidebar-branding-version"
                data-testid="producer-player-branding-version"
                title={`Current app version ${packageMetadata.version}`}
              >
                {packageMetadata.version}
              </span>
            </div>
            {SHOW_3000AD_BRANDING && (
              <a
                className="sidebar-by-line"
                href="https://lnkfi.re/3000AD"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void window.producerPlayer.openExternalUrl('https://lnkfi.re/3000AD');
                }}
                title="by 3000 AD"
                data-testid="sidebar-by-3000ad"
              >
                by 3000 AD
              </a>
            )}
          </div>
        </button>

        <section className="folder-tools-card" data-testid="folder-tools-card">
          <section className="folder-add-cta">
            <div className="folder-add-row">
              <button
                type="button"
                className="add-folder-primary"
                onClick={() => {
                  void handleOpenFolderDialog();
                }}
                data-testid="link-folder-dialog-button"
                title="Choose a folder containing your exported audio files."
              >
                Add Folder…
              </button>
              <HelpTooltip text={"What this is: Folder linking connects Producer Player to a folder on your disk where your exported audio files live (WAV, MP3, AAC/M4A). The app watches this folder and automatically picks up new or updated files.\n\nHow to use it: Click 'Add Folder…' and select the folder where you export your mixes from your DAW. You can link multiple folders (e.g. one per album). Click a folder name to filter the song list. Use the unlink button (×) to remove a folder.\n\nWhy you'd want to: Keep the app in sync with your DAW exports — every time you bounce a new version, it appears automatically.\n\nTip: Name your exported files with version suffixes (e.g. 'Track Name v2.wav') so the app can group versions together under one song."} />
            </div>
            {environment.isMacAppStoreSandboxed ? (
              <p
                className="muted"
                data-testid="path-linker-disabled-message"
                title="Mac App Store builds require Add Folder for persistent access."
              >
                Mac App Store build — use Add Folder… to keep access between sessions.
              </p>
            ) : null}
          </section>

          {/* Path-linker removed from production UI. Tests link folders via
              page.evaluate(() => window.producerPlayer.linkFolder(path)). */}

          <section
            className="naming-guide"
            data-testid="naming-guide"
            title="File names must end with v1, v2, v3. Example: Leaky v2.wav or Leakyv2.wav."
          >
            <p className="naming-guide-copy">
              <span className="naming-guide-icon" aria-hidden="true">
                💡
              </span>
              <span>
                File names must end with v1, v2, v3 — for example Leaky v2.wav or Leakyv2.wav.
              </span>
            </p>
          </section>
        </section>

        <div className="sidebar-section-divider" aria-hidden="true" />

        <section className="sidebar-status" data-testid="status-card">
          <div className="sidebar-status-header">
            <h3>Status</h3>
            <HelpTooltip text={statusCardHelpText} />
          </div>
          <p>
            <strong>{formatLibraryStatusLabel(snapshot.status)}</strong> — {snapshot.statusMessage}
          </p>
          <p className="muted">Last scan: {formatDate(snapshot.scannedAt)}</p>

          <label
            className="checkbox-row"
            title="Automatically move older non-archived versions into old/ while keeping the newest version in place."
          >
            <input
              type="checkbox"
              checked={snapshot.matcherSettings.autoMoveOld}
              onChange={(event) => {
                void handleSetAutoMoveOld(event.target.checked);
              }}
              data-testid="auto-organize-checkbox"
              title="Toggle automatic organize behavior for old versions."
            />
            Auto-organize old versions
          </label>

          {iCloudAvailability === null || iCloudAvailability.available ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <label
                className="checkbox-row"
                title="Back up checklists, ratings, and preferences to iCloud Drive so they sync across your Macs."
                style={{ flex: 1, minWidth: 0 }}
              >
                <input
                  type="checkbox"
                  checked={iCloudBackupEnabled}
                  onChange={(event) => {
                    void handleToggleICloudBackup(event.target.checked);
                  }}
                  data-testid="icloud-backup-checkbox"
                  title="Toggle iCloud Drive backup."
                  disabled={iCloudAvailability !== null && !iCloudAvailability.available}
                />
                Back up to iCloud
                {iCloudSyncStatus === 'syncing' && (
                  <span className="muted" style={{ marginLeft: '0.4em', fontSize: '0.85em' }}>
                    Syncing…
                  </span>
                )}
                {iCloudSyncStatus === 'success' && (
                  <span className="muted" style={{ marginLeft: '0.4em', fontSize: '0.85em', color: '#4ade80' }}>
                    ✓ Saved
                  </span>
                )}
              </label>
              {iCloudAvailability?.path && (
                <button
                  type="button"
                  className="icloud-show-folder-btn"
                  title="Show iCloud folder in Finder"
                  data-testid="icloud-show-folder-btn"
                  onClick={() => {
                    void window.producerPlayer.openFolder(iCloudAvailability.path!);
                  }}
                >
                  Show
                </button>
              )}
            </div>
          ) : (
            <p
              className="muted"
              style={{ fontSize: '0.85em', marginTop: '0.4em' }}
              title={iCloudAvailability.reason ?? 'iCloud Drive not available.'}
              data-testid="icloud-unavailable-hint"
            >
              ☁️ iCloud backup: macOS only
            </p>
          )}

          {iCloudSyncError && (
            <p className="error" style={{ fontSize: '0.85em', marginTop: '0.3em' }} data-testid="icloud-sync-error">
              {iCloudSyncError}
            </p>
          )}

          {loading && <p className="muted">Loading snapshot…</p>}
          {error && <p className="error">{error}</p>}
        </section>

        <ul className="folder-list">
          {snapshot.linkedFolders.map((folder) => (
            <li
              key={folder.id}
              className={`folder-row ${folder.id === selectedFolderId ? 'selected' : ''}`}
              data-testid="linked-folder-item"
              onClick={() => setSelectedFolderId(folder.id)}
            >
              <div className="folder-row-content">
                <strong>{folder.name}</strong>
                <p className="muted folder-row-path" title={folder.path}>{folder.path}</p>
                <p className="muted">{folder.fileCount} tracked files</p>
              </div>
              <div className="folder-row-actions">
                {folder.path ? (
                  <button
                    type="button"
                    className="ghost"
                    onClick={(event) => {
                      event.stopPropagation();
                      void runVoidTask(() => window.producerPlayer.openFolder(folder.path));
                    }}
                    title="Open this watched folder in Finder."
                  >
                    Open in Finder
                  </button>
                ) : null}
                <button
                  type="button"
                  className="ghost"
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleUnlinkFolder(folder.id, folder.name);
                  }}
                  title="Unlink this folder from the app. Files on disk are not deleted."
                >
                  Unlink
                </button>
              </div>
            </li>
          ))}
          {snapshot.linkedFolders.length === 0 && (
            <li className="empty-state">No folders linked yet.</li>
          )}
        </ul>

        <section
          ref={checklistUnderlyingAnalysisPaneRef}
          className="analysis-panel"
          data-testid="analysis-panel"
        >
          <div className="analysis-panel-header">
            <div>
              <h3>
                Mastering
                {normalizationPreviewEnabled && (
                  <button
                    type="button"
                    className="normalization-preview-header-badge"
                    onClick={() => setNormalizationPreviewEnabled(false)}
                    title={`${selectedNormalizationPlatform.label} normalization preview active — click to disable`}
                    aria-label={`Platform normalization preview active: ${selectedNormalizationPlatform.label}. Click to disable.`}
                  >
                    <span className="normalization-preview-header-icon analysis-platform-icon" style={{ '--platform-accent': selectedNormalizationPlatform.accentColor } as React.CSSProperties}>
                      <PlatformIcon platformId={selectedNormalizationPlatformId} />
                    </span>
                  </button>
                )}
              </h3>
            </div>
            <button
              type="button"
              className="ghost analysis-expand-trigger"
              onClick={() => setAnalysisExpanded(true)}
              data-testid="analysis-expand-button"
              title="Open the full-screen mastering and reference workspace."
              disabled={!selectedPlaybackVersion}
            >
              Full Screen <span aria-hidden="true">⤢</span>
            </button>
          </div>

          {selectedPlaybackVersion ? (
            <>
              <div className="analysis-track-summary">
                <strong className="analysis-track-label" data-testid="analysis-track-label">
                  {selectedPlaybackVersion.fileName}
                </strong>
              </div>

              {analysisStatus !== 'ready' ? (
                <p className="muted analysis-loading-line" data-testid="analysis-status">
                  {analysisStatus === 'loading'
                    ? 'Loading mastering analysis…'
                    : analysisStatus === 'error'
                      ? 'Analysis failed.'
                      : 'Preparing mastering analysis…'}
                </p>
              ) : null}

              {analysisStatus === 'error' ? (
                <p className="error" data-testid="analysis-error">
                  {analysisError ?? 'Could not analyse this track preview.'}
                </p>
              ) : null}

              <div className="analysis-stat-grid compact">
                <div
                  className="analysis-stat-card"
                  data-testid="analysis-integrated-stat"
                  title="Overall loudness of the entire track (EBU R128). A single value measured across the whole file."
                >
                  <span className="analysis-stat-label">Integrated LUFS{refSuffix} <HelpTooltip text={"What this measures: The overall perceived loudness of your entire track from start to finish, based on the EBU R128 / ITU-R BS.1770 standard. It averages loudness over the full duration using K-weighting that emphasizes frequencies the ear is most sensitive to. This is the single number streaming platforms use to decide whether to turn your track up or down.\n\nGood values: -14 LUFS for Spotify, YouTube, Tidal, and Amazon. -16 LUFS for Apple Music. Pop and EDM masters typically land between -6 and -14 LUFS. Quieter genres (jazz, classical, acoustic) often sit around -14 to -20 LUFS.\n\nIf it's wrong: Too loud (above -8 LUFS) means platforms will turn you down and you just lose dynamics for nothing. Too quiet (below -16 LUFS) means Spotify may boost you but caps the boost at true peak headroom, and YouTube/Tidal won't boost at all so your track plays quieter than others. Adjust your limiter ceiling or overall gain in mastering."} links={LUFS_LINKS} /></span>
                  <strong>{measuredIntegratedText}</strong>
                </div>
                <div
                  className="analysis-stat-card"
                  data-testid="analysis-short-term-stat"
                  title="Estimated loudness at the current playback position (3-second window). Updates in real-time during playback."
                >
                  <span className="analysis-stat-label">Current loudness{refSuffix} <HelpTooltip text={"What this measures: A rolling loudness estimate for what you're hearing right now, based on roughly the last 3 seconds of playback. Unlike Integrated LUFS, this is a live guide — useful for spotting louder and quieter sections, not for final delivery specs.\n\nGood values: It should move as the song moves. Verses often sit 2-4 LU below choruses. In a polished pop master, the loudest sections might hover around -8 to -12 LUFS, while quieter sections may dip to around -16 LUFS or lower.\n\nIf it's wrong: If it barely changes from start to finish, your mix may be over-compressed. If it swings by more than about 10 LU, some sections may feel too quiet compared with the loudest parts. Automation, arrangement tweaks, or gentle bus compression can help smooth the ride without flattening the song."} links={LUFS_LINKS} /></span>
                  <strong>{shortTermEstimateText}</strong>
                </div>
              </div>

              <button
                type="button"
                className={`ghost analysis-stats-expander${
                  analysisCompactStatsExpanded ? ' expanded' : ''
                }`}
                onClick={() => setAnalysisCompactStatsExpanded((current) => {
                  const next = !current;
                  window.localStorage.setItem(MORE_METRICS_EXPANDED_KEY, String(next));
                  return next;
                })}
                aria-expanded={analysisCompactStatsExpanded}
                aria-controls="analysis-side-extra-stats"
                data-testid="analysis-stats-expander"
                title="Show or hide additional loudness metrics."
              >
                <span className="analysis-stats-expander-caret" aria-hidden="true">
                  {analysisCompactStatsExpanded ? '▾' : '▸'}
                </span>
                <span>
                  {analysisCompactStatsExpanded ? 'Hide extra metrics' : 'More metrics'}
                </span>
              </button>

              <div
                id="analysis-side-extra-stats"
                className="analysis-stat-grid compact analysis-stat-grid-extra"
                data-testid="analysis-extra-stat-grid"
                hidden={!analysisCompactStatsExpanded}
              >
                <div
                  className="analysis-stat-card"
                  data-testid="analysis-lra-stat"
                  title="Loudness Range (LRA) — the difference between the quietest and loudest parts of the track, in Loudness Units."
                >
                  <span className="analysis-stat-label">Loudness range{refSuffix} <HelpTooltip text={"What this measures: How much the loudness varies between the quietest and loudest passages of your track, measured in LU (Loudness Units). It is derived from the EBU R128 standard by analyzing the statistical distribution of short-term loudness values, excluding the top 5% and bottom 10% to ignore brief outliers. A higher LRA means more dynamic contrast.\n\nGood values: Pop/EDM: 5-8 LU. Rock: 6-10 LU. Jazz/folk: 8-14 LU. Classical/film scores: 10-20+ LU. A heavily limited master might show 3-4 LU. An unmastered live recording could be 15+ LU.\n\nIf it's wrong: Too low (under 4 LU) usually means over-compression or over-limiting — the track will sound flat and fatiguing. Too high (above 12 LU for pop) means the quiet sections may get lost on earbuds or in noisy environments. Use compression, limiting, or volume automation to bring it into range for your genre."} links={LRA_LINKS} /></span>
                  <strong>{measuredLraText}</strong>
                </div>
                <div
                  className="analysis-stat-card"
                  data-testid="analysis-true-peak-stat"
                  title="True Peak — the highest inter-sample peak level in the track, measured via oversampling."
                >
                  <span className="analysis-stat-label">True Peak{refSuffix} <HelpTooltip text={"What this measures: The absolute highest signal peak including inter-sample peaks — peaks that occur between digital samples when the signal is reconstructed during D/A conversion. Measured via oversampling (typically 4x), this catches peaks that sample-level measurement misses. Reported in dBTP (decibels True Peak). This is the value streaming platforms check against their ceiling.\n\nGood values: Below -1.0 dBTP for Spotify, Apple Music, YouTube, and Tidal. Below -2.0 dBTP for Amazon Music (their stricter requirement). Many mastering engineers target -1.0 dBTP as their limiter ceiling. For vinyl or broadcast, -3 dBTP or lower is sometimes used.\n\nIf it's wrong: Above -1 dBTP means your track may clip on playback — DACs and lossy codecs (MP3, AAC, Ogg) can push inter-sample peaks into distortion. Lower your limiter output ceiling or reduce gain into the limiter. A true peak limiter (like FabFilter Pro-L 2 in ISP mode) is essential."} links={TRUE_PEAK_LINKS} /></span>
                  <strong>{measuredTruePeakText}</strong>
                </div>
                <div
                  className="analysis-stat-card"
                  data-testid="analysis-max-short-term-stat"
                  title="Highest 3-second loudness window in the track. A single static value from the file analysis — not real-time."
                >
                  <span className="analysis-stat-label">Peak short-term{refSuffix} <HelpTooltip text={"What this measures: The single loudest 3-second window across the entire track (EBU R128 short-term loudness). This is a static value from the file analysis — it tells you the peak loudness of your loudest section, not a real-time reading. The 3-second window smooths out brief transients to show sustained loudness.\n\nGood values: Typically 2-6 LU above your integrated LUFS. For a track at -14 LUFS integrated, the peak short-term might be around -10 to -8 LUFS. If it equals your integrated LUFS, the track has almost no dynamic variation.\n\nIf it's wrong: If the gap between peak short-term and integrated LUFS is very small (under 2 LU), the track is heavily compressed. If the gap is very large (over 8 LU), one section is dramatically louder than the rest — check for a sudden volume spike or an uncontrolled chorus. Use compression or automation to manage the difference."} links={LUFS_LINKS} /></span>
                  <strong>{measuredMaxShortTermText}</strong>
                </div>
                <div
                  className="analysis-stat-card"
                  data-testid="analysis-max-momentary-stat"
                  title="Highest 400ms loudness window in the track. A single static value from the file analysis — not real-time."
                >
                  <span className="analysis-stat-label">Peak momentary{refSuffix} <HelpTooltip text={"What this measures: The single loudest 400ms window across the entire track (EBU R128 momentary loudness). This catches the most extreme short bursts — a snare hit, a vocal shout, a bass drop. It is always equal to or louder than peak short-term since it uses a shorter measurement window.\n\nGood values: Usually 3-8 LU above your integrated LUFS. For a -14 LUFS track, peak momentary might be around -8 to -6 LUFS. EDM drops and heavy rock hits can push higher.\n\nIf it's wrong: A peak momentary that is far above peak short-term (more than 4 LU gap) means you have a very brief spike — possibly a stray transient, click, or uncompressed hit. Consider taming it with a transient shaper, clipper, or short-attack limiter. If peak momentary is very close to integrated, the track may be over-limited."} links={LUFS_LINKS} /></span>
                  <strong>{measuredMaxMomentaryText}</strong>
                </div>
              </div>

              <section
                className="analysis-normalization-panel"
                data-testid="analysis-normalization-panel"
              >
                <div className="analysis-normalization-header">
                  <div>
                    <strong>Platform normalization preview <HelpTooltip text={"Streaming platforms adjust your track's volume so every song plays at a similar loudness. Each platform has a target LUFS and a true peak ceiling.\n\n'Applied change' = the gain (in dB) the platform will add or remove. 'Projected loudness' = your track's LUFS after that adjustment. 'Headroom cap' = the maximum boost allowed before true peaks would clip.\n\nSpotify (-14 LUFS, -1 dBTP): Turns loud tracks down AND boosts quiet tracks up, but caps the boost so peaks stay under -1 dBTP. Apple Music (-16 LUFS, -1 dBTP): Same up-and-down approach but targets -16 LUFS, preserving more dynamics. YouTube (-14 LUFS, -1 dBTP): Only turns loud tracks down. If your track is quieter than -14, YouTube leaves it alone. Tidal (-14 LUFS, -1 dBTP): Same as YouTube, turns down only. Amazon Music (-14 LUFS, -2 dBTP): Turns down only, with a stricter -2 dBTP peak ceiling.\n\nToggle 'Preview' to hear exactly how your track will sound on the selected platform."} links={PLATFORM_NORMALIZATION_LINKS} /></strong>
                    <p className="muted" data-testid="analysis-normalization-summary">
                      {normalizationSummaryText}
                    </p>
                  </div>
                  <button
                    type="button"
                    className={normalizationPreviewEnabled ? '' : 'ghost'}
                    onClick={() => setNormalizationPreviewEnabled((current) => !current)}
                    data-testid="analysis-normalization-toggle"
                    disabled={analysisStatus !== 'ready' || !normalizationPreview}
                    title="Apply this platform's loudness adjustment to your playback."
                  >
                    Preview {normalizationPreviewEnabled ? 'On' : 'Off'}
                  </button>
                </div>

                <div className="analysis-platform-grid" role="group" aria-label="Platform normalization presets">
                  {NORMALIZATION_PLATFORM_PROFILES.map((platform) => {
                    const platformPreview = normalizationPreviewByPlatformId.get(platform.id) ?? null;
                    const platformChangeText =
                      analysisStatus === 'ready' && platformPreview
                        ? formatSignedLevel(platformPreview.appliedGainDb)
                        : '—';

                    return (
                      <button
                        key={platform.id}
                        type="button"
                        className={`analysis-platform-button${
                          selectedNormalizationPlatformId === platform.id ? ' selected' : ''
                        }`}
                        onClick={() => setSelectedNormalizationPlatformId(platform.id)}
                        data-testid={`analysis-platform-${platform.id}`}
                        title={platform.description}
                        aria-pressed={selectedNormalizationPlatformId === platform.id}
                      >
                        <span className="analysis-platform-header-row">
                          <span
                            className="analysis-platform-icon"
                            style={{ '--platform-accent': platform.accentColor } as CSSProperties}
                          >
                            <PlatformIcon platformId={platform.id} />
                          </span>
                          <span className="analysis-platform-title">{platform.label}</span>
                        </span>
                        <span className="analysis-platform-copy">
                          <span className="analysis-platform-target">
                            {platform.targetLufs.toFixed(0)} LUFS target
                          </span>
                          <span className="analysis-platform-change">
                            Applied {platformChangeText}
                          </span>
                          <span className="muted">
                            {platform.truePeakCeilingDbtp.toFixed(0)} dBTP ceiling
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="analysis-reference-inline analysis-normalization-inline">
                  <div className="analysis-stat-card compact" data-testid="analysis-normalization-change">
                    <span className="analysis-stat-label">Applied change</span>
                    <strong>{normalizationChangeText}</strong>
                    <span className="muted">
                      {normalizationPreviewEnabled
                        ? 'Previewing now'
                        : 'Off — tap Preview On to hear it'}
                    </span>
                  </div>
                  <div className="analysis-stat-card compact" data-testid="analysis-normalization-projected">
                    <span className="analysis-stat-label">Projected loudness</span>
                    <strong>{normalizationProjectedText}</strong>
                    <span className="muted">After normalization</span>
                  </div>
                  <div className="analysis-stat-card compact" data-testid="analysis-normalization-cap">
                    <span className="analysis-stat-label">Headroom cap</span>
                    <strong>{normalizationCapText}</strong>
                    <span className="muted">
                      {normalizationPreview?.limitedByHeadroom
                        ? 'Boost limited by true peak'
                        : selectedNormalizationPlatform.policy === 'down-only'
                          ? 'This platform only turns down'
                          : 'Within headroom'}
                    </span>
                  </div>
                  <div className="analysis-stat-card compact" data-testid="analysis-normalization-target">
                    <span className="analysis-stat-label">Target &amp; peak ceiling</span>
                    <strong>
                      {selectedNormalizationPlatform.targetLufs.toFixed(0)} LUFS ·{' '}
                      {selectedNormalizationPlatform.truePeakCeilingDbtp.toFixed(0)} dBTP
                    </strong>
                    <span className="muted">Platform target</span>
                  </div>
                  <div className="analysis-stat-card compact" data-testid="analysis-normalization-policy">
                    <span className="analysis-stat-label">Gain policy</span>
                    <strong>
                      {selectedNormalizationPlatform.policy === 'down-only'
                        ? 'Turn down only'
                        : 'Turn up & down'}
                    </strong>
                    <span className="muted">{selectedNormalizationPlatform.description}</span>
                  </div>
                </div>
              </section>

              <div className="analysis-tonal-balance-wrapper">
                <p className="analysis-tonal-balance-heading" data-testid="analysis-tonal-balance-heading">
                  Tonal balance{refTrackSuffix}
                </p>
                <div
                  className="analysis-tonal-balance"
                  data-testid="analysis-tonal-balance"
                  data-source={isRefMode ? "reference-track" : "mix-track"}
                >
                  {(
                    [
                      ['Low', activeTonalBalance?.low ?? 0],
                      ['Mid', activeTonalBalance?.mid ?? 0],
                      ['High', activeTonalBalance?.high ?? 0],
                    ] as Array<[string, number]>
                  ).map(([label, value]) => (
                    <div key={label} className="analysis-band-row" data-testid={`analysis-band-${label.toLowerCase()}`}>
                      <span>{label}</span>
                      <div className="analysis-band-meter" aria-hidden="true">
                        <span style={{ width: `${Math.max(8, Math.round(value * 100))}%` }} />
                      </div>
                      <strong>
                        {tonalBalanceReady
                          ? formatPercent(value)
                          : tonalBalanceStatus === 'error'
                            ? 'Error'
                            : 'Loading…'}
                      </strong>
                    </div>
                  ))}
                </div>
              </div>

              <div className="analysis-reference-toolbar producer-reference-toolbar">
                <div>
                  <strong>Reference <HelpTooltip text="Load a professional track you want your mix to sound like, then click A/B to instantly switch between your mix and the reference. This lets you compare EQ balance, dynamics, and overall vibe. When you switch to the reference, the app swaps the entire audio chain to play the reference file instead of your mix. All the analysis meters update to show the reference track's stats so you can compare numbers side by side." links={REFERENCE_TRACK_LINKS} /></strong>
                  <p className="muted" data-testid="analysis-reference-summary">
                    {referenceTrack
                      ? `${referenceTrack.fileName} · ${
                          referenceTrack.sourceType === 'external-file' ? 'external' : 'linked'
                        }`
                      : referenceStatus === 'loading'
                        ? 'Loading…'
                        : 'No reference'}
                  </p>
                </div>
                <div className="analysis-reference-actions">
                  <button
                    type="button"
                    onClick={() => {
                      void handleChooseReferenceTrack();
                    }}
                    data-testid="analysis-choose-reference"
                    title="Choose an external reference file."
                    disabled={referenceStatus === 'loading'}
                  >
                    {referenceStatus === 'loading' ? 'Loading…' : 'Choose File…'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void handleUseCurrentTrackAsReference();
                    }}
                    data-testid="analysis-use-current-reference"
                    disabled={analysisStatus !== 'ready' || !selectedPlaybackVersion || referenceStatus === 'loading'}
                    title="Use the current track as the reference."
                  >
                    {referenceStatus === 'loading' ? 'Loading…' : 'Use Current'}
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={handleClearReferenceTrack}
                    data-testid="analysis-clear-reference"
                    disabled={!referenceTrack && referenceStatus !== 'error'}
                    title="Clear the reference."
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div className="analysis-ab-toggle" data-testid="analysis-ab-toggle">
                <span className="analysis-ab-label">Quick A/B</span>
                <div className="analysis-ab-actions" role="group" aria-label="A/B toggle">
                  <button
                    type="button"
                    className={playbackPreviewMode === 'mix' ? 'active' : 'ghost'}
                    onClick={() => handleReferencePreviewModeChange('mix')}
                    data-testid="analysis-ab-mix"
                    title="Listen to your mix."
                  >
                    Mix
                  </button>
                  <button
                    type="button"
                    className={playbackPreviewMode === 'reference' ? 'active' : 'ghost'}
                    onClick={() => handleReferencePreviewModeChange('reference')}
                    data-testid="analysis-ab-reference"
                    disabled={!referenceTrack || referenceStatus === 'loading'}
                    title="Listen to the reference track."
                  >
                    Reference
                  </button>
                </div>
                <p className="muted">
                  {referenceStatus === 'loading'
                    ? 'Loading reference…'
                    : referenceTrack
                      ? playbackPreviewMode === 'reference'
                        ? `Playing reference: ${referenceTrack.fileName}`
                        : `Tap Reference to A/B against ${referenceTrack.fileName}`
                      : 'Load a reference track to A/B from here.'}
                </p>
              </div>

              {referenceError ? (
                <p className="error" data-testid="analysis-reference-error">
                  {referenceError}
                </p>
              ) : null}

              <div className="analysis-reference-inline" data-testid="analysis-active-reference-inline">
                {referenceTrack && activeReferenceComparison ? (
                  <>
                    <div className="analysis-stat-card compact">
                      <span className="analysis-stat-label">Reference loudness</span>
                      <strong>{referenceIntegratedText}</strong>
                    </div>
                    <div className="analysis-stat-card compact">
                      <span className="analysis-stat-label">Reference true peak</span>
                      <strong>{referenceTruePeakText}</strong>
                    </div>
                    <div className="analysis-stat-card compact">
                      <span className="analysis-stat-label">Loudness difference</span>
                      <strong>{formatSignedLevel(activeReferenceComparison.integratedDeltaDb)}</strong>
                    </div>
                  </>
                ) : (
                  <div className="analysis-stat-card compact analysis-empty-card">
                    <span className="analysis-stat-label">Reference comparison</span>
                    <strong>No reference loaded</strong>
                    <span className="muted">
                      Load a reference to compare against.
                    </span>
                  </div>
                )}
              </div>

              {recentReferenceTracks.length > 0 ? (
                <div className="recent-reference-tracks" data-testid="recent-reference-tracks">
                  <span className="analysis-stat-label">Recent references</span>
                  <div className="recent-reference-tracks-list">
                    {recentReferenceTracks.map((recent) => (
                      <button
                        key={recent.filePath}
                        type="button"
                        className={
                          'recent-reference-track-btn ghost' +
                          (referenceTrack?.filePath === recent.filePath ? ' active' : '')
                        }
                        onClick={() => void handleLoadReferenceByFilePath(recent.filePath)}
                        disabled={referenceStatus === 'loading'}
                        title={recent.filePath}
                      >
                        {recent.fileName}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <p className="muted" data-testid="analysis-empty-state">
              Pick a track to see loudness analysis and A/B.
            </p>
          )}
        </section>
      </aside>

      <main className="panel panel-main">
        <header className="panel-header panel-main-header">
          <div className="album-header-row">
            <button
              type="button"
              className="album-art-trigger"
              onClick={handleAlbumArtClick}
              title="Click to upload album art"
              data-testid="album-art-trigger"
            >
              {albumArt ? (
                <img src={albumArt} alt="Album art" className="album-art-img" />
              ) : (
                <span className="album-art-placeholder" aria-hidden="true">🎵</span>
              )}
            </button>
            <input
              ref={albumArtInputRef}
              type="file"
              accept="image/*,.jpg,.jpeg,.png,.webp,.gif,.svg,.bmp,.psd"
              className="album-art-file-input"
              onChange={handleAlbumArtChange}
              data-testid="album-art-file-input"
            />
            <div className="panel-title">
              {albumTitleEditing ? (
                <input
                  ref={albumTitleInputRef}
                  type="text"
                  className="album-title-input"
                  value={albumTitleDraft}
                  onChange={(e) => setAlbumTitleDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAlbumTitleSave();
                    if (e.key === 'Escape') handleAlbumTitleCancel();
                  }}
                  onBlur={handleAlbumTitleSave}
                  data-testid="album-title-input"
                />
              ) : (
                <h2
                  className="album-title-text"
                  onClick={handleAlbumTitleStartEdit}
                  title="Click to edit album title"
                  data-testid="album-title-text"
                >
                  {albumTitle}
                </h2>
              )}
              <div className="panel-title-metadata-row">
                <div className="panel-title-metadata-left">
                  <p className="muted">{formatTrackCount(songs.length)}</p>
                  <p className="muted album-duration-label" data-testid="album-duration-label">
                    {formatAlbumDuration(albumDurationSeconds)}
                  </p>
                </div>
                <HelpTooltip text={"What this is: Your song list — all the tracks in the currently linked folder, organized as an album. Songs are auto-grouped by name, with versions nested under each title.\n\nHow to use it: Click a song to select it. Double-click to start playback. Drag songs up or down to reorder the tracklist. Use the search bar to filter by name.\n\nWhy you'd want to: Arrange your album's running order and keep all your mixes organized in one place.\n\nTip: The order you set here is preserved across sessions and used when you export — so arrange it like your final tracklist."} />
              </div>
            </div>
          </div>
          <div className="actions">
            <button
              type="button"
              className="action-button"
              onClick={() => {
                void handleRescan();
              }}
              data-testid="rescan-button"
              title="Rescan watched folders now. Saved ordering data is retained."
            >
              Rescan
            </button>
            <button
              type="button"
              className="action-button secondary"
              onClick={() => {
                void handleOrganize();
              }}
              data-testid="organize-button"
              title="Move older non-archived versions into old/ and keep the newest version in place."
            >
              Organize
            </button>
            <button
              type="button"
              className="action-button secondary"
              onClick={() => {
                void handleExportLatestVersionsInOrder();
              }}
              data-testid="export-latest-ordered-button"
              title={
                canExportLatestVersionsInOrder
                  ? 'Create a new folder containing only the latest version of each track, renamed with ordered numeric prefixes.'
                  : 'Link a folder first to export latest versions.'
              }
              disabled={!canExportLatestVersionsInOrder}
            >
              Export Latest
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={() => {
                void handleExportPlaylistOrder();
              }}
              data-testid="export-playlist-order-button"
              aria-label="Export playlist ordering"
              title={
                canExportPlaylistOrder
                  ? 'Export the current album selection + ordering (with metadata) as JSON.'
                  : 'Link a folder first to export track order.'
              }
              disabled={!canExportPlaylistOrder}
            >
              <span aria-hidden="true">⤓</span>
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={() => {
                void handleImportPlaylistOrder();
              }}
              data-testid="import-playlist-order-button"
              aria-label="Import playlist ordering"
              title={
                canImportPlaylistOrder
                  ? 'Import a previously exported playlist/order JSON and apply it to the current library.'
                  : 'Link the album folder first to import track order.'
              }
              disabled={!canImportPlaylistOrder}
            >
              <span aria-hidden="true">⤒</span>
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={handleOpenMigrationModal}
              data-testid="migration-modal-button"
              aria-label="Migrate notes from other apps via LLM"
              title="Migrate notes from other apps (Apple Notes, etc.) into checklists using an LLM to parse your notes."
            >
              <span aria-hidden="true">🚶</span>
            </button>
            <div className="actions-help-group">
              <HelpTooltip text={"Header buttons overview:\n\n• Rescan — Re-scans your watched folders for new or changed files. Your saved track ordering is preserved.\n\n• Organize — Moves older, non-archived versions of each song into an 'old/' subfolder, keeping only the newest version in place.\n\n• Export Latest — Creates a new folder containing just the latest version of each track, renamed with ordered numeric prefixes (01, 02, …) matching your tracklist order.\n\n• ⤓ (Export Order) — Saves your current playlist ordering and metadata as a JSON file for backup or transfer.\n\n• ⤒ (Import Order) — Imports a previously exported JSON file to restore track ordering.\n\n• 🚶 (Migrate) — Migrates notes from other apps (Apple Notes, etc.) into per-song checklists using an LLM to parse your notes."} />
            </div>
          </div>
        </header>

        <p
          className="list-hint"
          data-testid="track-order-hint"
          title="Drag tracks to reorder. Order is saved automatically."
        >
          {listHintText}
        </p>

        <ul
          className={`main-list ${dragSongId ? 'drag-active' : ''}`}
          data-testid="main-list"
          onDragOver={(event) => {
            if (!canReorderSongs || !dragSongId) {
              return;
            }

            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
          }}
          onDrop={(event) => {
            void handleDropOnMainList(event);
          }}
        >
          {songs.map((song, index) => {
            const showDropBefore =
              dragSongId !== null &&
              dragOverSongId === song.id &&
              dragOverPosition === 'before' &&
              dragSongId !== song.id;

            const showDropAfter =
              dragSongId !== null &&
              dragOverSongId === song.id &&
              dragOverPosition === 'after' &&
              dragSongId !== song.id;

            const matchedVersionNames = matchedVersionNamesBySongId.get(song.id) ?? [];
            const showMatchedVersions =
              searchText.trim().length > 0 && matchedVersionNames.length > 0;

            const secondaryRowText = showMatchedVersions
              ? `Matched versions: ${matchedVersionNames.join(', ')}`
              : `${song.versions.length} version(s)`;
            const songRowTitle = getSongDisplayTitle(song);
            const songRowMetadataLabel = getSongRowMetadataLabel(song);
            const songRatingValue = songRatings[song.id] ?? DEFAULT_SONG_RATING;
            const songChecklistCount = songChecklists[song.id]?.length ?? 0;
            const songDateOpacity =
              songDateOpacityBySongId.get(song.id) ?? SONG_DATE_OPACITY_RANGE.unknown;

            return (
              <li
                key={song.id}
                className={`main-list-item ${showDropBefore ? 'drop-preview-before' : ''} ${
                  showDropAfter ? 'drop-preview-after' : ''
                }`}
                onDragEnter={(event) => {
                  updateDragOverPosition(event, song.id);
                }}
                onDragOver={(event) => {
                  updateDragOverPosition(event, song.id);
                }}
                onDrop={(event) => {
                  event.stopPropagation();
                  void handleDropOnSongRow(event, song.id);
                }}
              >
                <span className="track-number" aria-label={`Track ${index + 1}`}>
                  {index + 1}
                </span>
                <div
                  role="button"
                  tabIndex={0}
                  className={`main-list-row ${song.id === selectedSongId ? 'selected' : ''} ${
                    dragSongId === song.id ? 'drag-source' : ''
                  }`}
                  onClick={() => handleSongRowSelect(song.id)}
                  onDoubleClick={() => {
                    void handleSongRowPlay(song.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      handleSongRowSelect(song.id);
                    }
                  }}
                  data-testid="main-list-row"
                  data-song-id={song.id}
                  draggable={canReorderSongs}
                  onDragStart={(event) => {
                    if (!canReorderSongs) {
                      return;
                    }

                    event.currentTarget.blur();
                    setDragSongId(song.id);
                    dragTargetRef.current = null;
                    setDragOverSongId(null);
                    setDragOverPosition('before');
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', song.id);
                  }}
                  onDragEnd={() => {
                    clearDragState();
                  }}
                  title={
                    canReorderSongs
                      ? 'Click to select, drag to reorder.'
                      : 'Click to select. Clear search to reorder.'
                  }
                >
                  <div className="main-list-row-primary">
                    <strong className="main-list-row-title" data-testid="main-list-row-title">
                      {songRowTitle}
                    </strong>
                    <p className="muted">{secondaryRowText}</p>
                  </div>
                  <div className="main-list-row-meta-group">
                    <span className="main-list-row-metadata" data-testid="main-list-row-metadata">
                      {songRowMetadataLabel}
                    </span>
                    <div className="main-list-row-meta-footer">
                      <button
                        type="button"
                        className={`song-checklist-button${songChecklistCount > 0 ? ' has-items' : ''}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          handleOpenSongChecklist(song.id);
                        }}
                        data-testid="song-checklist-button"
                        title={
                          songChecklistCount > 0
                            ? `${songChecklistCount} checklist item(s) saved`
                            : 'Open checklist for this song.'
                        }
                        aria-label={`${songRowTitle} checklist`}
                      >
                        <span>Checklist</span>
                        {songChecklistCount > 0 ? (
                          <span className="song-checklist-count">{songChecklistCount}</span>
                        ) : null}
                      </button>
                      <span className="muted" style={{ opacity: songDateOpacity }}>
                        {formatDate(song.latestExportAt)}
                      </span>
                    </div>
                  </div>
                </div>
                <label className="song-rating-control" data-testid="song-rating-control">
                  <span className="song-rating-value">{songRatingValue}/10</span>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    step={1}
                    value={songRatingValue}
                    onClick={(event) => {
                      event.stopPropagation();
                    }}
                    onInput={(event) => {
                      handleSongRatingChange(song.id, Number(event.currentTarget.value));
                    }}
                    onChange={(event) => {
                      handleSongRatingChange(song.id, Number(event.currentTarget.value));
                    }}
                    data-testid="song-rating-slider"
                    aria-label={`${songRowTitle} rating`}
                  />
                </label>
              </li>
            );
          })}
          {songs.length === 0 && (
            <li className={`empty-state${showEmptyStateAddFolder ? ' empty-state-cta' : ''}`}>
              <p>{emptyStateText}</p>
              {showEmptyStateAddFolder ? (
                <button
                  type="button"
                  className="add-folder-primary empty-state-add-folder"
                  onClick={() => {
                    void handleOpenFolderDialog();
                  }}
                  data-testid="main-list-empty-add-folder"
                  title="Choose a folder containing your exported audio files."
                >
                  Add Folder…
                </button>
              ) : null}
            </li>
          )}
        </ul>

        {selectedPlaybackVersion && (
          <section className="player-dock" data-testid="player-dock">
            <div className="player-dock-top">
              <div className="player-track-details">
                <strong data-testid="player-track-name">{activePlaybackLabel.fileName}</strong>
                <p className="muted">{activePlaybackLabel.subtitle}</p>
                <div className="player-track-badges">
                  <span className="sample-rate-pill" data-testid="player-track-sample-rate">
                    {selectedPlaybackSampleRateText}
                  </span>
                </div>
              </div>
              <div className="player-dock-visualizations">
                <SpectrumAnalyzer
                  analyserNode={analyserNode}
                  width={PLAYER_DOCK_PREVIEW_VISUAL_WIDTH}
                  height={48}
                  activeBands={soloedBands}
                  onBandToggle={handleBandToggle}
                  isPlaying={isPlaying}
                />
                <LevelMeter
                  analyserNode={analyserNode}
                  orientation="horizontal"
                  width={PLAYER_DOCK_PREVIEW_VISUAL_WIDTH}
                  height={20}
                  isPlaying={isPlaying}
                />
              </div>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  if (activePlaybackFilePath) {
                    void window.producerPlayer.revealFile(activePlaybackFilePath);
                  }
                }}
                title="Open this version in Finder."
              >
                Open in Finder
              </button>
            </div>

            <div className="player-transport">
              <HelpTooltip text={"What this is: The main playback controls — play/pause, skip forward/back, previous/next track, repeat mode, and volume.\n\nHow to use it: Press the play button or hit Space anywhere in the app to toggle playback. Use the skip buttons (±1s, ±10s) for fine seeking. Click ◀◀ / ▶▶ to move between tracks. Drag the scrubber to jump to any position. Adjust volume with the slider.\n\nWhy you'd want to: Quickly navigate through your songs and compare sections without leaving the app.\n\nTip: Space bar toggles play/pause globally (unless you're typing in a text field). The previous-track button restarts the current song if past 2 seconds, or goes to the previous track if near the start."} />
              <div className="transport-nav-group">
                <div className="transport-skip-row">
                  <button
                    type="button"
                    className="skip-button"
                    data-testid="player-skip-back-10"
                    onClick={() => handleSkipSeconds(-10)}
                    title="Skip back 10 seconds."
                  >
                    −10s
                  </button>
                  <button
                    type="button"
                    className="skip-button"
                    data-testid="player-skip-forward-10"
                    onClick={() => handleSkipSeconds(10)}
                    title="Skip forward 10 seconds."
                  >
                    +10s
                  </button>
                </div>
                <div className="transport-main-row">
                  <button
                    type="button"
                    className="skip-button skip-button-small"
                    data-testid="player-skip-back-1"
                    onClick={() => handleSkipSeconds(-1)}
                    title="Skip back 1 second."
                  >
                    −1s
                  </button>
                  <button
                    type="button"
                    data-testid="player-prev"
                    onClick={() => handlePreviousTrack()}
                    title="Restart current track when past 0:02; otherwise go to previous track."
                  >
                    ◀◀
                  </button>
                  <button
                    type="button"
                    className="play-toggle"
                    data-testid="player-play-toggle"
                    aria-label={isPlaying ? 'Pause' : 'Play'}
                    data-playing={isPlaying ? 'true' : 'false'}
                    onClick={() => {
                      void handleTogglePlayback();
                    }}
                    title="Play or pause the selected track."
                  >
                    <span aria-hidden="true">{isPlaying ? '⏸' : '▶︎'}</span>
                  </button>
                  <button
                    type="button"
                    data-testid="player-next"
                    onClick={() => handleNextTrack()}
                    title="Jump to next track in the current queue."
                  >
                    ▶▶
                  </button>
                  <button
                    type="button"
                    className="skip-button skip-button-small"
                    data-testid="player-skip-forward-1"
                    onClick={() => handleSkipSeconds(1)}
                    title="Skip forward 1 second."
                  >
                    +1s
                  </button>
                </div>
              </div>
              {selectedPlaybackSongId ? (
                <button
                  type="button"
                  className={`transport-checklist-button${(songChecklists[selectedPlaybackSongId]?.length ?? 0) > 0 ? ' has-items' : ''}`}
                  data-testid="transport-checklist-button"
                  onClick={() => handleOpenSongChecklist(selectedPlaybackSongId)}
                  title="Open checklist for this song."
                  aria-label="Song checklist"
                >
                  <svg className="transport-checklist-icon" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M2 3.5h2v2H2zM6 3.5h8M2 7h2v2H2zM6 7h8M2 10.5h2v2H2zM6 10.5h8" />
                  </svg>
                  <span>Checklist</span>
                  {(songChecklists[selectedPlaybackSongId]?.length ?? 0) > 0 ? (
                    <span className="transport-checklist-count">
                      {songChecklists[selectedPlaybackSongId]?.length}
                    </span>
                  ) : null}
                </button>
              ) : null}
              <button
                type="button"
                className={`transport-repeat-button${repeatMode !== 'off' ? ' active' : ''}`}
                data-testid="player-repeat"
                onClick={handleCycleRepeatMode}
                title={`Repeat: ${REPEAT_MODE_LABEL[repeatMode]}. Click to cycle.`}
                aria-label={`Repeat ${REPEAT_MODE_LABEL[repeatMode]}`}
              >
                <svg className="transport-repeat-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M17 2l4 4-4 4" />
                  <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                  <path d="M7 22l-4-4 4-4" />
                  <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                </svg>
                {repeatMode === 'one' && <span className="transport-repeat-badge">1</span>}
              </button>
              <label
                className="player-volume-control"
                data-testid="player-volume-control"
                title="Adjust playback volume for this app session."
              >
                <span className="muted">Vol {Math.round(volume * 100)}%</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round(volume * 100)}
                  onInput={(event) => handleVolumeChange(Number(event.currentTarget.value) / 100)}
                  onChange={(event) => handleVolumeChange(Number(event.currentTarget.value) / 100)}
                  data-testid="player-volume-slider"
                  aria-label="Playback volume"
                />
              </label>
            </div>

            <div className="player-scrubber-row">
              <span className="muted">{formatTime(currentTimeSeconds)}</span>
              <input
                type="range"
                min={0}
                max={durationSeconds > 0 ? durationSeconds : 0}
                step={0.1}
                value={Math.min(currentTimeSeconds, durationSeconds > 0 ? durationSeconds : 0)}
                disabled={durationSeconds <= 0}
                onChange={(event) => handleSeek(Number(event.target.value))}
                data-testid="player-scrubber"
                title="Scrub through the selected track."
              />
              <span className="muted">{formatTime(durationSeconds)}</span>
            </div>

            {playbackError ? (
              <p className="error" data-testid="playback-error">
                {playbackError}
              </p>
            ) : null}
          </section>
        )}
      </main>

      <aside className="panel panel-right">
        <header className="panel-header">
          <h2>Inspector</h2>
        </header>

        <div
          ref={checklistUnderlyingSidePaneScrollRef}
          className="panel-right-scroll"
          data-testid="inspector-scroll-region"
        >
          {selectedSong ? (
            <section className="inspector-card">
              <h3 data-testid="inspector-song-title">{getSongDisplayFileName(selectedSong)}</h3>
              <p className="muted">Latest export: {formatDate(selectedSong.latestExportAt)}</p>
              <p className="muted" data-testid="inspector-song-sample-rate">
                Sample rate: {selectedPlaybackSampleRateText}
              </p>
            </section>
          ) : (
            <section className="inspector-card empty-state">
              Pick a track to see its version history.
            </section>
          )}

          <section className="inspector-card">
            <h3>Version History <HelpTooltip text={"What this is: A timeline of every exported version of this song — each time you bounce/export from your DAW with a version number (e.g. v1, v2, v3), it shows up here.\n\nHow to use it: Click 'Cue' on any version to load it into the player. Click 'Open in Finder' to locate the file on disk. The newest version is selected by default.\n\nWhy you'd want to: Quickly A/B your latest mix against an older version to hear if your changes actually improved the track.\n\nTip: Name your exports with version suffixes (e.g. 'My Song v3.wav') — Producer Player groups them automatically."} /></h3>
            <ul className="version-list">
              {inspectorVersions.map((version) => (
                <li
                  key={version.id}
                  className="version-row"
                  data-testid="inspector-version-row"
                >
                  <div>
                    <strong>{version.fileName}</strong>
                    <p className="muted">{formatDate(version.modifiedAt)}</p>
                    <p className="muted">{formatFileSize(version.sizeBytes)}</p>
                  </div>
                  <div className="version-actions">
                    <button
                      type="button"
                      onClick={() => {
                        if (shouldAutoplayOnTransport()) {
                          playOnNextLoadRef.current = true;
                          schedulePlaybackLoadTimeout('version-cue-autoplay');
                        }

                        setSelectedPlaybackVersionId(version.id);
                      }}
                      title="Cue this version into the player."
                    >
                      Cue
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void window.producerPlayer.revealFile(version.filePath);
                      }}
                      title="Open this version in Finder."
                    >
                      Open in Finder
                    </button>
                  </div>
                </li>
              ))}
              {inspectorVersions.length === 0 && (
                <li className="empty-state">No versions available.</li>
              )}
            </ul>
          </section>

          <section className="inspector-card support-feedback-card" data-testid="support-feedback-card">
            <h3>Support &amp; Feedback</h3>
            <p className="muted">
              Send bugs and workflow requests straight into the GitHub issue queue.
            </p>
            <div className="support-feedback-links">
              <button
                type="button"
                className="ghost"
                onClick={() => handleOpenSupportLink(BUG_REPORT_URL)}
                data-testid="support-feedback-bug"
                title="Open the bug report page."
              >
                Report a Bug
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => handleOpenSupportLink(FEATURE_REQUEST_URL)}
                data-testid="support-feedback-feature"
                title="Open the feature request page."
              >
                Request a Feature
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  void handleCheckForUpdates();
                }}
                data-testid="support-feedback-check-updates"
                disabled={updateCheckStatus === 'checking'}
                title="Check if a newer version is available."
              >
                {updateCheckStatus === 'checking' ? 'Checking…' : 'Check for Updates'}
              </button>
              {canDownloadUpdate ? (
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    void handleDownloadUpdate();
                  }}
                  data-testid="support-feedback-download-update"
                  title="Download the latest update."
                >
                  Download Update
                </button>
              ) : null}
            </div>
            {updateStatusText ? (
              <p
                className={updateCheckResult?.status === 'error' ? 'error' : 'muted'}
                data-testid="support-feedback-update-status"
              >
                {updateStatusText}
              </p>
            ) : null}
          </section>
        </div>
      </aside>

      {checklistModalSong ? (
        <div
          ref={checklistOverlayRef}
          className="checklist-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Song checklist"
          data-testid="song-checklist-modal"
          onWheel={handleChecklistOverlayWheel}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              handleCloseSongChecklist();
            }
          }}
        >
          <div ref={checklistModalCardRef} className="checklist-modal-card">
            <div className="checklist-modal-header">
              <div>
                <h2>{getSongDisplayTitle(checklistModalSong)} Checklist <HelpTooltip text={"What this is: A per-song to-do list for tracking mixing and mastering tasks — notes, fixes, and revisions you need to make for this track.\n\nHow to use it: Type a note in the input field and press Enter to add it. Click the checkbox to mark items done. Click the × to delete an item. You can optionally capture a playback timestamp so each note links to a specific moment in the song.\n\nWhy you'd want to: Keep a structured record of what needs fixing in each song so nothing slips through the cracks between sessions.\n\nTip: Use Cmd/Ctrl+Z to undo and Cmd/Ctrl+Shift+Z (or Cmd/Ctrl+Y) to redo checklist changes. Shift+Tab from the text input jumps to the time-jump controls, and Shift+Tab on those controls moves backward naturally."} /></h2>
                <p className="muted">
                  {checklistCompletedCount}/{checklistModalItems.length} completed
                </p>
              </div>
            </div>

            <div
              className="checklist-item-scroll-region"
              data-testid="song-checklist-scroll-region"
            >
              {checklistModalItemsChronological.length > 0 ? (
                <ul className="checklist-item-list" data-testid="song-checklist-items">
                  {checklistModalItemsChronological.map((item) => (
                    <li
                      key={item.id}
                      className={`checklist-item-row${
                        item.timestampSeconds !== null ? ' has-timestamp' : ''
                      }${activeChecklistTimestampIds.includes(item.id) ? ' is-active' : ''}`}
                    >
                      <label className="checklist-item-toggle">
                        <input
                          type="checkbox"
                          checked={item.completed}
                          onChange={(event) => {
                            handleToggleChecklistItem(
                              checklistModalSong.id,
                              item.id,
                              event.currentTarget.checked
                            );
                          }}
                        />
                      </label>
                      {item.timestampSeconds !== null ? (
                        <button
                          type="button"
                          className="checklist-timestamp-badge"
                          onClick={() => handleChecklistTimestampClick(item.timestampSeconds!)}
                          data-testid="song-checklist-item-timestamp"
                          title={`Jump to ${formatTime(item.timestampSeconds)}`}
                          aria-label={`Seek to ${formatTime(item.timestampSeconds)}`}
                        >
                          {formatTime(item.timestampSeconds)}
                        </button>
                      ) : null}
                      <textarea
                        className={`checklist-item-text${item.completed ? ' completed' : ''}`}
                        value={item.text}
                        rows={1}
                        onChange={(event) => {
                          autosizeChecklistTextarea(event.currentTarget);
                          handleChecklistItemTextChange(
                            checklistModalSong.id,
                            item.id,
                            event.currentTarget.value
                          );
                        }}
                        onInput={(event) => {
                          autosizeChecklistTextarea(event.currentTarget);
                        }}
                        onKeyDown={(event) => {
                          if (
                            event.key === 'Enter' &&
                            !event.shiftKey &&
                            !event.metaKey &&
                            !event.ctrlKey &&
                            !event.altKey
                          ) {
                            event.preventDefault();
                            event.currentTarget.blur();
                          }
                        }}
                        ref={(node) => {
                          if (node) {
                            autosizeChecklistTextarea(node);
                          }
                        }}
                        data-testid="song-checklist-item-text"
                      />
                      <button
                        type="button"
                        className="ghost checklist-remove-button"
                        onClick={() => handleRemoveChecklistItem(checklistModalSong.id, item.id)}
                        aria-label={`Remove ${item.text}`}
                        title="Remove checklist item"
                      >
                        <span style={{ color: '#e74c3c', fontSize: '1.1em', fontWeight: 700, lineHeight: 1 }}>✕</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted checklist-empty-state" data-testid="song-checklist-empty">
                  No checklist items yet.
                </p>
              )}
            </div>

            <div
              className={`checklist-input-row${checklistCapturedTimestamp !== null ? ' has-timestamp-preview' : ''}`}
              data-testid="song-checklist-input-row"
            >
              <textarea
                ref={checklistComposerTextareaRef}
                className="checklist-composer-text"
                value={checklistDraftText}
                rows={1}
                onChange={(event) => {
                  autosizeChecklistTextarea(event.currentTarget);
                  handleChecklistDraftTextChange(event.currentTarget.value);
                }}
                onInput={(event) => {
                  autosizeChecklistTextarea(event.currentTarget);
                }}
                onFocus={handleChecklistInputFocus}
                onBlur={handleChecklistInputBlur}
                onKeyDown={(event) => {
                  if (isUnmodifiedShiftTab(event)) {
                    event.preventDefault();

                    const lastFocusedTransport = lastFocusedChecklistTransportRef.current;
                    const hasUsableLastFocusedTransport =
                      lastFocusedTransport &&
                      lastFocusedTransport.isConnected &&
                      checklistModalCardRef.current?.contains(lastFocusedTransport);

                    const fallbackTransportButton =
                      checklistSkipBackTenButtonRef.current ??
                      checklistSkipBackFiveButtonRef.current;
                    const targetTransportButton = hasUsableLastFocusedTransport
                      ? lastFocusedTransport
                      : fallbackTransportButton;

                    targetTransportButton?.focus();
                    if (targetTransportButton) {
                      lastFocusedChecklistTransportRef.current = targetTransportButton;
                    }
                    return;
                  }

                  if (
                    event.key === 'Enter' &&
                    !event.shiftKey &&
                    !event.metaKey &&
                    !event.ctrlKey &&
                    !event.altKey
                  ) {
                    event.preventDefault();
                    handleAddChecklistItem();
                  }
                }}
                placeholder="Add a checklist item"
                data-testid="song-checklist-input"
              />
              {checklistCapturedTimestamp !== null ? (
                <div className="checklist-timestamp-preview-group">
                  <button
                    type="button"
                    className="checklist-set-now-button"
                    data-testid="song-checklist-set-now"
                    onClick={handleChecklistSetNow}
                    title="Capture the moment just before what you heard"
                    aria-label="Set timestamp to current playback position"
                  >
                    <svg className="checklist-set-now-icon" viewBox="0 0 16 16" aria-hidden="true">
                      <circle cx="8" cy="8" r="6.5" />
                      <path d="M8 4v4.5l3 1.5" />
                    </svg>
                    <span>Set now</span>
                  </button>
                  <button
                    type="button"
                    className="checklist-timestamp-badge checklist-input-timestamp-preview"
                    title={`Seek to ${formatTime(checklistCapturedTimestamp)}`}
                    data-testid="song-checklist-input-timestamp-preview"
                    onClick={() => handleChecklistTimestampClick(checklistCapturedTimestamp)}
                  >
                    {formatTime(checklistCapturedTimestamp)}
                  </button>
                </div>
              ) : null}
              <button
                type="button"
                onClick={handleAddChecklistItem}
                disabled={checklistDraftIsEmpty}
                data-testid="song-checklist-add"
                title="Add this checklist item."
              >
                Add
              </button>
            </div>

            {selectedPlaybackVersion ? (
              <div className="checklist-mini-player" data-testid="song-checklist-mini-player">
                <div className="checklist-mini-player-scrubber-row">
                  <span className="muted">{formatTime(currentTimeSeconds)}</span>
                  <input
                    type="range"
                    min={0}
                    max={durationSeconds > 0 ? durationSeconds : 0}
                    step={0.1}
                    value={Math.min(currentTimeSeconds, durationSeconds > 0 ? durationSeconds : 0)}
                    disabled={durationSeconds <= 0}
                    onChange={(event) => handleSeek(Number(event.target.value))}
                    data-testid="song-checklist-mini-player-scrubber"
                    title="Scrub through the selected track while the checklist is open."
                  />
                  <span className="muted">{formatTime(durationSeconds)}</span>
                </div>
                <div className="checklist-mini-player-transport">
                  <button
                    type="button"
                    className="checklist-mini-player-button"
                    data-testid="song-checklist-mini-player-prev"
                    onClick={() => handlePreviousTrack({ syncChecklistModal: true })}
                    title="Previous track"
                    aria-label="Previous track"
                  >
                    ◀◀
                  </button>

                  <div className="checklist-transport-group">
                    <button
                      ref={checklistSkipBackTenButtonRef}
                      type="button"
                      className="checklist-skip-button"
                      data-testid="song-checklist-skip-back-10"
                      onClick={() => handleSkipSeconds(-10)}
                      onFocus={(event) => { lastFocusedChecklistTransportRef.current = event.currentTarget; }}
                      onKeyDown={(event) => {
                        if (event.key === ' ') {
                          event.preventDefault();
                          void handleTogglePlayback();
                          return;
                        }

                        if (isUnmodifiedShiftTab(event)) {
                          event.preventDefault();
                          checklistComposerTextareaRef.current?.focus();
                        }
                      }}
                      title="Skip back 10 seconds"
                      aria-label="Skip back 10 seconds"
                    >
                      −10s
                    </button>
                    <button
                      ref={checklistSkipBackFiveButtonRef}
                      type="button"
                      className="checklist-skip-button checklist-skip-button-small"
                      data-testid="song-checklist-skip-back-5"
                      onClick={() => handleSkipSeconds(-5)}
                      onFocus={(event) => { lastFocusedChecklistTransportRef.current = event.currentTarget; }}
                      onKeyDown={(event) => {
                        if (event.key === ' ') {
                          event.preventDefault();
                          void handleTogglePlayback();
                        }
                      }}
                      title="Skip back 5 seconds"
                      aria-label="Skip back 5 seconds"
                    >
                      −5s
                    </button>
                    <button
                      type="button"
                      className="checklist-skip-button checklist-skip-button-small"
                      data-testid="song-checklist-skip-back-2"
                      onClick={() => handleSkipSeconds(-2)}
                      onFocus={(event) => { lastFocusedChecklistTransportRef.current = event.currentTarget; }}
                      onKeyDown={(event) => {
                        if (event.key === ' ') {
                          event.preventDefault();
                          void handleTogglePlayback();
                        }
                      }}
                      title="Skip back 2 seconds"
                      aria-label="Skip back 2 seconds"
                    >
                      −2s
                    </button>
                    <button
                      type="button"
                      className="checklist-play-toggle"
                      data-playing={isPlaying ? 'true' : 'false'}
                      aria-label={isPlaying ? 'Pause' : 'Play'}
                      title={isPlaying ? 'Pause playback' : 'Resume playback'}
                      data-testid="song-checklist-play-toggle"
                      onClick={() => {
                        void handleTogglePlayback();
                      }}
                      onFocus={(event) => { lastFocusedChecklistTransportRef.current = event.currentTarget; }}
                      onKeyDown={(event) => {
                        if (event.key === ' ') {
                          event.preventDefault();
                          void handleTogglePlayback();
                        }
                      }}
                    >
                      <span aria-hidden="true">{isPlaying ? '⏸' : '▶︎'}</span>
                    </button>
                    <button
                      type="button"
                      className="checklist-skip-button checklist-skip-button-small"
                      data-testid="song-checklist-skip-forward-2"
                      onClick={() => handleSkipSeconds(2)}
                      onFocus={(event) => { lastFocusedChecklistTransportRef.current = event.currentTarget; }}
                      onKeyDown={(event) => {
                        if (event.key === ' ') {
                          event.preventDefault();
                          void handleTogglePlayback();
                        }
                      }}
                      title="Skip forward 2 seconds"
                      aria-label="Skip forward 2 seconds"
                    >
                      +2s
                    </button>
                    <button
                      type="button"
                      className="checklist-skip-button checklist-skip-button-small"
                      data-testid="song-checklist-skip-forward-5"
                      onClick={() => handleSkipSeconds(5)}
                      onFocus={(event) => { lastFocusedChecklistTransportRef.current = event.currentTarget; }}
                      onKeyDown={(event) => {
                        if (event.key === ' ') {
                          event.preventDefault();
                          void handleTogglePlayback();
                        }
                      }}
                      title="Skip forward 5 seconds"
                      aria-label="Skip forward 5 seconds"
                    >
                      +5s
                    </button>
                    <button
                      type="button"
                      className="checklist-skip-button"
                      data-testid="song-checklist-skip-forward-10"
                      onClick={() => handleSkipSeconds(10)}
                      onFocus={(event) => { lastFocusedChecklistTransportRef.current = event.currentTarget; }}
                      onKeyDown={(event) => {
                        if (event.key === ' ') {
                          event.preventDefault();
                          void handleTogglePlayback();
                        }
                      }}
                      title="Skip forward 10 seconds"
                      aria-label="Skip forward 10 seconds"
                    >
                      +10s
                    </button>
                  </div>

                  <button
                    type="button"
                    className="checklist-mini-player-button"
                    data-testid="song-checklist-mini-player-next"
                    onClick={() => handleNextTrack({ syncChecklistModal: true })}
                    title="Next track"
                    aria-label="Next track"
                  >
                    ▶▶
                  </button>
                </div>
              </div>
            ) : null}

            <div className="checklist-modal-actions">
              <button
                type="button"
                className="ghost danger"
                onClick={(e) => {
                  if (e.shiftKey) {
                    const confirmed = window.confirm(
                      'DEVELOPER MODE: Delete ALL checklist items across ALL songs? This cannot be undone.'
                    );
                    if (!confirmed) return;
                    updateSongChecklists(() => ({}));
                  } else {
                    const confirmed = window.confirm(
                      'Are you sure you want to delete all checklist items for this song?'
                    );
                    if (!confirmed) return;
                    updateSongChecklists((current) => {
                      const next = { ...current };
                      delete next[checklistModalSong.id];
                      return next;
                    });
                  }
                }}
                disabled={checklistModalItems.length === 0}
                data-testid="song-checklist-delete-all"
                title="Delete all checklist items for this song."
              >
                Delete All
              </button>
              <button
                type="button"
                className="ghost"
                onClick={handleOpenMasteringFromChecklist}
                disabled={!checklistModalCanOpenMastering}
                data-testid="song-checklist-open-mastering"
                title="Open this song in full-screen mastering."
              >
                Mastering <span aria-hidden="true">⤢</span>
              </button>
              <span className="checklist-transport-hint">Shift+Tab from the text input jumps to time-jump controls</span>
              <button
                type="button"
                className="ghost"
                onClick={() => handleClearCompletedChecklistItems(checklistModalSong.id)}
                disabled={checklistCompletedCount === 0}
                data-testid="song-checklist-clear-completed"
                title="Remove all completed checklist items."
              >
                Clear Completed
              </button>
              <button type="button" onClick={handleCloseSongChecklist} title="Close checklist.">
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {analysisExpanded ? (
        <div
          className="analysis-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Mastering analysis"
          data-testid="analysis-modal"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setAnalysisExpanded(false);
            }
          }}
        >
          <div
            className="analysis-overlay-card"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <div className="analysis-overlay-header">
              <div>
                <h2>
                  Mastering{selectedPlaybackVersion ? ` — ${selectedPlaybackVersion.fileName}` : ''}
                  {normalizationPreviewEnabled && (
                    <button
                      type="button"
                      className="normalization-preview-header-badge"
                      onClick={() => setNormalizationPreviewEnabled(false)}
                      title={`${selectedNormalizationPlatform.label} normalization preview active — click to disable`}
                      aria-label={`Platform normalization preview active: ${selectedNormalizationPlatform.label}. Click to disable.`}
                    >
                      <span className="normalization-preview-header-icon analysis-platform-icon" style={{ '--platform-accent': selectedNormalizationPlatform.accentColor } as React.CSSProperties}>
                        <PlatformIcon platformId={selectedNormalizationPlatformId} />
                      </span>
                    </button>
                  )}
                </h2>
                {playbackPreviewMode === 'reference' && referenceTrack ? (
                  <p className="muted">Playing Reference: {referenceTrack.fileName}</p>
                ) : (
                  <p className="muted">LUFS · peaks · tone · refs · normalization</p>
                )}
              </div>
              {selectedPlaybackVersion ? (
                <div className="analysis-overlay-transport" data-testid="analysis-overlay-transport">
                  <button
                    type="button"
                    className="analysis-overlay-transport-button analysis-overlay-skip-button"
                    data-testid="analysis-overlay-skip-back-10"
                    onClick={() => handleSkipSeconds(-10)}
                    title="Skip back 10 seconds"
                    aria-label="Skip back 10 seconds"
                  >
                    −10s
                  </button>
                  <button
                    type="button"
                    className="analysis-overlay-transport-button analysis-overlay-skip-button analysis-overlay-skip-button-small"
                    data-testid="analysis-overlay-skip-back-5"
                    onClick={() => handleSkipSeconds(-5)}
                    title="Skip back 5 seconds"
                    aria-label="Skip back 5 seconds"
                  >
                    −5s
                  </button>
                  <button
                    type="button"
                    className="analysis-overlay-transport-button analysis-overlay-skip-button analysis-overlay-skip-button-small"
                    data-testid="analysis-overlay-skip-back-1"
                    onClick={() => handleSkipSeconds(-1)}
                    title="Skip back 1 second"
                    aria-label="Skip back 1 second"
                  >
                    −1s
                  </button>
                  <button
                    type="button"
                    className="analysis-overlay-transport-button"
                    data-testid="analysis-overlay-prev"
                    onClick={() => handlePreviousTrack()}
                    title="Previous track"
                    aria-label="Previous track"
                  >
                    ◀◀
                  </button>
                  <button
                    type="button"
                    className="analysis-overlay-transport-button analysis-overlay-play-toggle"
                    data-testid="analysis-overlay-play-toggle"
                    data-playing={isPlaying ? 'true' : 'false'}
                    aria-label={isPlaying ? 'Pause' : 'Play'}
                    title={isPlaying ? 'Pause playback' : 'Resume playback'}
                    onClick={() => {
                      void handleTogglePlayback();
                    }}
                  >
                    <span aria-hidden="true">{isPlaying ? '⏸' : '▶︎'}</span>
                  </button>
                  <button
                    type="button"
                    className="analysis-overlay-transport-button"
                    data-testid="analysis-overlay-next"
                    onClick={() => handleNextTrack()}
                    title="Next track"
                    aria-label="Next track"
                  >
                    ▶▶
                  </button>
                  <button
                    type="button"
                    className="analysis-overlay-transport-button analysis-overlay-skip-button analysis-overlay-skip-button-small"
                    data-testid="analysis-overlay-skip-forward-1"
                    onClick={() => handleSkipSeconds(1)}
                    title="Skip forward 1 second"
                    aria-label="Skip forward 1 second"
                  >
                    +1s
                  </button>
                  <button
                    type="button"
                    className="analysis-overlay-transport-button analysis-overlay-skip-button analysis-overlay-skip-button-small"
                    data-testid="analysis-overlay-skip-forward-5"
                    onClick={() => handleSkipSeconds(5)}
                    title="Skip forward 5 seconds"
                    aria-label="Skip forward 5 seconds"
                  >
                    +5s
                  </button>
                  <button
                    type="button"
                    className="analysis-overlay-transport-button analysis-overlay-skip-button"
                    data-testid="analysis-overlay-skip-forward-10"
                    onClick={() => handleSkipSeconds(10)}
                    title="Skip forward 10 seconds"
                    aria-label="Skip forward 10 seconds"
                  >
                    +10s
                  </button>
                  <span className="analysis-overlay-transport-time muted" data-testid="analysis-overlay-time">
                    {formatTime(currentTimeSeconds)} / {formatTime(durationSeconds)}
                  </span>
                  <input
                    type="range"
                    className="analysis-overlay-transport-scrubber"
                    min={0}
                    max={durationSeconds > 0 ? durationSeconds : 0}
                    step={0.1}
                    value={Math.min(currentTimeSeconds, durationSeconds > 0 ? durationSeconds : 0)}
                    disabled={durationSeconds <= 0}
                    onChange={(event) => handleSeek(Number(event.target.value))}
                    data-testid="analysis-overlay-scrubber"
                    title="Scrub through the track"
                  />
                </div>
              ) : null}
              <button
                type="button"
                className="ghost"
                onClick={handleOpenChecklistFromMastering}
                disabled={!selectedPlaybackSongId}
                data-testid="analysis-open-checklist-button"
                title="Open this track's checklist."
              >
                Checklist
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => setAnalysisExpanded(false)}
                data-testid="analysis-close-button"
                title="Close the full-screen mastering view."
              >
                Close
              </button>
            </div>

            {selectedPlaybackVersion ? (
              <div className="analysis-overlay-grid">
                <section className="analysis-overlay-section analysis-overlay-visualizations" data-testid="analysis-overlay-visualizations">
                  <div className="analysis-overlay-viz-row">
                    <div className="analysis-overlay-viz-spectrum" ref={spectrumFullContainerRef}>
                      <div className="analysis-section-header">
                        <h4 data-testid="analysis-overlay-spectrum-heading">Spectrum Analyzer{refTrackSuffix} <HelpTooltip text={"What you're seeing: The Spectrum Analyzer shows a smooth curve of your audio's frequency content from 20 Hz (deep bass, left) to 20 kHz (treble, right) on a logarithmic scale, with amplitude in dB on the vertical axis. It's color-coded from blue (low) to green (high).\n\nWhat to look for: Many balanced mixes show a gentle downward tilt from lows to highs, but the exact shape depends on the genre and arrangement. A big hump in the lows can mean excess bass; an exaggerated rise in the highs can mean the mix is too bright or harsh.\n\nInteractions: In the expanded view, click any frequency band (Sub, Low, Low-Mid, Mid, High-Mid, High) to solo it — you'll hear only that range, useful for isolating problems.\n\nTip: A/B your spectrum shape against a reference track. If your curve looks very different from a professional mix in the same genre, that's a clue about your tonal balance."} links={SPECTRUM_ANALYZER_LINKS} /></h4>
                        <p className="analysis-section-subtitle">Real-time frequency content — click bands to solo frequency ranges</p>
                      </div>
                      <SpectrumAnalyzer
                        analyserNode={analyserNode}
                        width={spectrumFullWidth}
                        height={260}
                        isFullScreen
                        activeBands={soloedBands}
                        onBandToggle={handleBandToggle}
                        isPlaying={isPlaying}
                      />
                    </div>
                    <div className="analysis-overlay-viz-meters">
                      <div className="analysis-section-header">
                        <h4>Level Meter <HelpTooltip text={"What you're seeing: The Level Meter shows average level with a gradient from green (plenty of headroom) through yellow to red (running hot). The thin line is the peak hold — the loudest recent hit — and it hangs for a moment before falling.\n\nWhat to look for: Living mostly in the green/yellow zone is usually comfortable. If the peak hold spends a lot of time near the red end, you're low on headroom and should double-check your true peak and sample peak readings.\n\nTip: Watch it during the loudest section of the song. If it keeps pinning the top, back off your master output or limiter ceiling a touch."} links={LEVEL_METER_LINKS} /></h4>
                      </div>
                      <LevelMeter
                        analyserNode={analyserNode}
                        orientation="vertical"
                        width={48}
                        height={260}
                        isPlaying={isPlaying}
                      />
                    </div>
                  </div>
                  {soloedBands.size > 0 && (
                    <div className="spectrum-solo-summary">
                      <p className="spectrum-solo-label" data-testid="spectrum-solo-label">
                        Soloing: <strong>{Array.from(soloedBands).sort().map(i => FREQUENCY_BANDS[i].label).join(' + ')}</strong>
                      </p>
                      <button
                        type="button"
                        className="ghost spectrum-clear-solo-button"
                        data-testid="analysis-clear-solo-bands"
                        onClick={handleClearSoloedBands}
                        title="Stop soloing and return to full-spectrum playback."
                      >
                        Clear selected ranges
                      </button>
                    </div>
                  )}
                </section>

                <section className="analysis-overlay-section" data-testid="analysis-overlay-reference-panel">
                  <div className="analysis-section-header">
                    <h4>Reference Track <HelpTooltip text="Load a professional track you want your mix to sound like, then use the A/B toggle to flip between your mix and the reference. When you click 'Reference', the player switches to the reference file and all meters update to show its analysis. Click 'Mix' to switch back. This makes it easy to spot differences in loudness, EQ, and dynamics without losing your place." links={REFERENCE_TRACK_LINKS} /></h4>
                    <p className="analysis-section-subtitle">Load a reference track to A/B against your mix</p>
                  </div>
                  <div className="reference-panel-layout">
                  <div className="reference-panel-controls">
                  <p className="muted">
                    Load a reference track to A/B against your mix.
                  </p>
                  <div className="analysis-reference-actions">
                    <button
                      type="button"
                      onClick={() => {
                        void handleChooseReferenceTrack();
                      }}
                      data-testid="analysis-choose-reference-overlay"
                      disabled={referenceStatus === 'loading'}
                      title="Choose an external reference file."
                    >
                      {referenceStatus === 'loading' ? 'Loading reference…' : 'Choose Reference File…'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void handleUseCurrentTrackAsReference();
                      }}
                      data-testid="analysis-overlay-set-current-reference"
                      disabled={analysisStatus !== 'ready' || !selectedPlaybackVersion || referenceStatus === 'loading'}
                      title="Use the current track as the reference."
                    >
                      {referenceStatus === 'loading' ? 'Loading reference…' : 'Set Current Track as Reference'}
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={handleClearReferenceTrack}
                      disabled={!referenceTrack && referenceStatus !== 'error'}
                      title="Clear the reference."
                    >
                      Clear Reference
                    </button>
                  </div>

                  <div className="analysis-ab-row">
                  <div className="analysis-ab-toggle">
                    <span className="analysis-ab-label">Quick A/B</span>
                    <div className="analysis-ab-actions" role="group" aria-label="A/B toggle">
                      <button
                        type="button"
                        className={playbackPreviewMode === 'mix' ? 'active' : 'ghost'}
                        onClick={() => handleReferencePreviewModeChange('mix')}
                        data-testid="analysis-overlay-ab-mix"
                        title="Listen to your mix."
                      >
                        Mix
                      </button>
                      <button
                        type="button"
                        className={playbackPreviewMode === 'reference' ? 'active' : 'ghost'}
                        onClick={() => handleReferencePreviewModeChange('reference')}
                        data-testid="analysis-overlay-ab-reference"
                        disabled={!referenceTrack || referenceStatus === 'loading'}
                        title="Listen to the reference track."
                      >
                        Reference
                      </button>
                    </div>
                  </div>

                  <div className="analysis-ab-toggle">
                    <span className="analysis-ab-label">Level Match <HelpTooltip text="Without level matching, the louder track almost always sounds better to your ears — it's a psychoacoustic trick, not a quality difference. Level Match evens the playing field by calculating the loudness gap between your mix and the reference (mix LUFS minus reference LUFS) and applying that gain offset to the reference during playback. Now both tracks play at roughly the same perceived volume, so you can compare actual quality — EQ, dynamics, stereo image — not just who's louder." links={REFERENCE_TRACK_LINKS} /></span>
                    <div className="analysis-ab-actions" role="group" aria-label="Level match toggle">
                      <button
                        type="button"
                        className={referenceLevelMatchEnabled ? 'active' : 'ghost'}
                        onClick={() => setReferenceLevelMatchEnabled((v) => !v)}
                        disabled={!referenceTrack}
                        title="Automatically adjust reference playback gain to match your mix's integrated LUFS"
                        data-testid="analysis-level-match-toggle"
                      >
                        {referenceLevelMatchEnabled ? 'Level Match On' : 'Level Match Off'}
                      </button>
                      {referenceLevelMatchEnabled && referenceLevelMatchGainDb !== 0 ? (
                        <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
                          {referenceLevelMatchGainDb > 0 ? '+' : ''}{referenceLevelMatchGainDb.toFixed(1)} dB
                        </span>
                      ) : null}
                    </div>
                  </div>
                  </div>

                  <div className="analysis-reference-slot active" data-testid="analysis-reference-slot-a">
                    {referenceTrack ? (
                      <>
                        <div className="analysis-reference-slot-header">
                          <strong>Active reference track</strong>
                          <span className="muted">
                            {referenceTrack.sourceType === 'external-file'
                              ? 'External file'
                              : 'Linked track'}
                          </span>
                        </div>
                        <p>
                          <strong>{referenceTrack.fileName}</strong>
                        </p>
                        <p className="muted">{referenceTrack.subtitle}</p>
                        <div className="analysis-reference-metrics">
                          <span>Loudness: {referenceIntegratedText}</span>
                          <span>True peak: {referenceTruePeakText}</span>
                          <span>
                            Current loudness: {formatMeasuredStat(referenceShortTermEstimate, 'LUFS est.')}
                          </span>
                        </div>
                      </>
                    ) : (
                      <p className="muted">
                        No reference loaded.
                      </p>
                    )}
                  </div>

                  {referenceError ? <p className="error">{referenceError}</p> : null}
                  </div>
                  {savedReferenceTracks.length > 0 ? (
                    <div className="saved-reference-tracks">
                      <h4>Saved References <HelpTooltip text="Your reference tracks are saved automatically so you don't have to re-load them every session. Each entry stores the file path, measured LUFS, and the date you last used it. Click any saved track to load it instantly as your active reference. Up to 20 references are kept, with the most recently used at the top." links={REFERENCE_TRACK_LINKS} /></h4>
                      <div className="saved-reference-tracks-list">
                        {savedReferenceTracks.map((saved) => (
                          <div
                            key={saved.filePath}
                            className={
                              'saved-reference-track-row' +
                              (referenceTrack?.filePath === saved.filePath ? ' active' : '')
                            }
                          >
                            <button
                              type="button"
                              className="saved-reference-track-load"
                              onClick={() => {
                                void handleLoadSavedReferenceTrack(saved);
                              }}
                              disabled={referenceStatus === 'loading'}
                              title={saved.filePath}
                            >
                              <span className="saved-reference-track-name">{saved.fileName}</span>
                              <span className="saved-reference-track-meta">
                                {saved.integratedLufs !== null
                                  ? saved.integratedLufs.toFixed(1) + ' LUFS'
                                  : ''}
                                {saved.integratedLufs !== null ? ' · ' : ''}
                                {formatSavedReferenceDate(saved.dateLastUsed)}
                              </span>
                            </button>
                            <button
                              type="button"
                              className="saved-reference-track-remove ghost"
                              onClick={() => handleRemoveSavedReferenceTrack(saved.filePath)}
                              title="Remove from saved references"
                              aria-label={"Remove " + saved.fileName}
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  </div>
                </section>

                {/* Loudness History Graph */}
                <section className="analysis-overlay-section" data-testid="analysis-loudness-history">
                  <h3>Loudness History{isRefMode ? " (Reference)" : ""} <HelpTooltip text={"What you're seeing: A blue curve showing your track's rolling loudness over time. The dashed line marks the overall loudness estimate for the loaded track, and the white vertical line shows the current playback position. The shaded area makes it easier to see where sections feel denser or lighter.\n\nWhat to look for: A relatively consistent curve usually means controlled loudness. Big dips may point to sections that feel too small; sharp jumps may point to sections that hit harder than intended. Use it to compare sections against each other, then confirm the final number with the Integrated LUFS stat.\n\nTip: Compare the shape against a reference track in the same genre. If your curve is almost flat all the way through, the song may be over-compressed."} links={LOUDNESS_HISTORY_LINKS} /></h3>
                  <LoudnessHistoryGraph
                    analysis={analysis}
                    currentTimeSeconds={currentTimeSeconds}
                    isPlaying={isPlaying}
                    width={Math.max(400, spectrumFullWidth)}
                    height={140}
                    onSeek={handleSeek}
                  />
                </section>

                {/* Waveform Display */}
                <section className="analysis-overlay-section" data-testid="analysis-waveform">
                  <h3>Waveform{isRefMode ? " (Reference)" : ""} <HelpTooltip text={"What you're seeing: Symmetrical bars showing the peak amplitude of your audio at each moment in time. Taller bars = louder moments, shorter bars = quieter. Bars to the left of the white playback cursor are bright blue (already played), bars to the right are dimmer (upcoming). The Y-axis goes from -1.0 to +1.0 (full digital scale).\n\nWhat to look for: A healthy waveform has visible variation — loud choruses and quieter verses. If the bars are all maxed out at 1.0 with no variation, your track is likely over-compressed or clipping. Gaps (no bars) indicate silence.\n\nTip: Compare the height of your loudest and quietest sections. If there's barely any difference, consider backing off your limiter to restore dynamics."} links={WAVEFORM_LINKS} /></h3>
                  <WaveformDisplay
                    waveformPeaks={analysis?.waveformPeaks ?? null}
                    analysis={analysis}
                    currentTimeSeconds={currentTimeSeconds}
                    durationSeconds={durationSeconds}
                    isPlaying={isPlaying}
                    width={Math.max(400, spectrumFullWidth)}
                    height={100}
                    onSeek={handleSeek}
                  />
                </section>

                {/* Stereo Correlation Meter */}
                <section className="analysis-overlay-section" data-testid="analysis-stereo-correlation">
                  <div className="analysis-section-header">
                    <h4>Stereo Correlation{isRefMode ? " (Reference)" : ""} <HelpTooltip text={"What you're seeing: A horizontal meter with a glowing indicator that moves between -1 (left) and +1 (right). The background fades from red on the left, through yellow in the center, to green on the right. The numeric value is shown in the top-right corner, colored to match the zone.\n\nWhat to look for: Green zone (+0.5 to +1) = great mono compatibility — your track sounds solid on phone speakers and mono systems. Yellow zone (0 to +0.5) = some stereo content, generally fine. Red zone (below 0) = phase issues — left and right channels are canceling each other, which sounds thin or hollow in mono.\n\nTip: If the indicator dips into the red during certain parts, check for over-widened stereo effects, poorly set up chorus/phaser plugins, or samples that were accidentally phase-inverted."} links={STEREO_CORRELATION_LINKS} /></h4>
                    <p className="analysis-section-subtitle">Phase relationship between L/R channels (+1 = mono compatible, -1 = out of phase)</p>
                  </div>
                  <StereoCorrelationMeter
                    analyserNodeL={analyserNodeL}
                    analyserNodeR={analyserNodeR}
                    width={Math.max(400, spectrumFullWidth)}
                    height={44}
                    isPlaying={isPlaying}
                  />
                </section>

                {analysisStatus !== 'ready' ? (
                  <p className="muted analysis-loading-line" data-testid="analysis-overlay-status">
                    {analysisStatus === 'loading'
                      ? 'Loading mastering analysis…'
                      : analysisStatus === 'error'
                        ? 'Analysis failed.'
                        : 'Preparing mastering analysis…'}
                  </p>
                ) : null}
                {analysisStatus === 'error' ? (
                  <p className="error" data-testid="analysis-overlay-error">
                    {analysisError ?? 'Could not analyse this track preview.'}
                  </p>
                ) : null}

                <div className="analysis-overlay-side-by-side">

                  <section className="analysis-overlay-section">
                    <div className="analysis-section-header">
                      <h4 data-testid="analysis-overlay-tonal-balance-heading">Tonal Balance{refTrackSuffix} <HelpTooltip text="Shows how your audio energy is distributed across three broad frequency bands. Low (20-250 Hz) covers sub and bass. Mid (250-4000 Hz) covers vocals, guitars, synths, and most musical detail. High (4000-20000 Hz) covers presence, air, and brightness. Each band is shown as a percentage of total energy. Use the numbers as a rough guide, not a rulebook: many balanced masters fall somewhere around 30-40% Low, 40-50% Mid, and 15-25% High, but genre and arrangement matter." links={TONAL_BALANCE_LINKS} /></h4>
                      <p className="analysis-section-subtitle">Low/mid/high energy distribution</p>
                    </div>
                    <div
                      className="analysis-tonal-balance detailed"
                      data-testid="analysis-overlay-tonal-balance"
                      data-source={isRefMode ? "reference-track" : "mix-track"}
                    >
                      {(
                        [
                          ['Low', activeTonalBalance?.low ?? 0],
                          ['Mid', activeTonalBalance?.mid ?? 0],
                          ['High', activeTonalBalance?.high ?? 0],
                        ] as Array<[string, number]>
                      ).map(([label, value]) => (
                        <div key={label} className="analysis-band-row" data-testid={`analysis-overlay-band-${label.toLowerCase()}`}>
                          <span>{label}</span>
                          <div className="analysis-band-meter" aria-hidden="true">
                            <span style={{ width: `${Math.max(8, Math.round(value * 100))}%` }} />
                          </div>
                          <strong>
                            {tonalBalanceReady
                              ? formatPercent(value)
                              : tonalBalanceStatus === 'error'
                                ? 'Error'
                                : 'Loading…'}
                          </strong>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>

                <section className="analysis-overlay-section">
                  <h3>Loudness &amp; peaks{isRefMode ? " (Reference)" : ""}</h3>
                  <div className="analysis-detail-grid analysis-detail-grid-wide">
                    <div className="analysis-stat-card" title="Overall loudness of the entire track (EBU R128). A single value measured across the whole file.">
                      <span className="analysis-stat-label">Integrated LUFS{refSuffix} <HelpTooltip text={"What this measures: The overall perceived loudness of your entire track from start to finish, based on the EBU R128 / ITU-R BS.1770 standard. It averages loudness over the full duration using K-weighting that emphasizes frequencies the ear is most sensitive to. This is the single number streaming platforms use to decide whether to turn your track up or down.\n\nGood values: -14 LUFS for Spotify, YouTube, Tidal, and Amazon. -16 LUFS for Apple Music. Pop and EDM masters typically land between -6 and -14 LUFS. Quieter genres (jazz, classical, acoustic) often sit around -14 to -20 LUFS.\n\nIf it's wrong: Too loud (above -8 LUFS) means platforms will turn you down and you just lose dynamics for nothing. Too quiet (below -16 LUFS) means Spotify may boost you but caps the boost at true peak headroom, and YouTube/Tidal won't boost at all so your track plays quieter than others. Adjust your limiter ceiling or overall gain in mastering."} links={LUFS_LINKS} /></span>
                      <strong>{measuredIntegratedText}</strong>
                    </div>
                    <div className="analysis-stat-card" title="Estimated loudness at the current playback position (3-second window). Updates in real-time during playback.">
                      <span className="analysis-stat-label">Current loudness{refSuffix} <HelpTooltip text={"What this measures: A rolling loudness estimate for what you're hearing right now, based on roughly the last 3 seconds of playback. Unlike Integrated LUFS, this is a live guide — useful for spotting louder and quieter sections, not for final delivery specs.\n\nGood values: It should move as the song moves. Verses often sit 2-4 LU below choruses. In a polished pop master, the loudest sections might hover around -8 to -12 LUFS, while quieter sections may dip to around -16 LUFS or lower.\n\nIf it's wrong: If it barely changes from start to finish, your mix may be over-compressed. If it swings by more than about 10 LU, some sections may feel too quiet compared with the loudest parts. Automation, arrangement tweaks, or gentle bus compression can help smooth the ride without flattening the song."} links={LUFS_LINKS} /></span>
                      <strong>{shortTermEstimateText}</strong>
                    </div>
                    <div className="analysis-stat-card" title="Loudness Range (LRA) — the difference between the quietest and loudest parts of the track, in Loudness Units.">
                      <span className="analysis-stat-label">Loudness range{refSuffix} <HelpTooltip text={"What this measures: How much the loudness varies between the quietest and loudest passages of your track, measured in LU (Loudness Units). It is derived from the EBU R128 standard by analyzing the statistical distribution of short-term loudness values, excluding the top 5% and bottom 10% to ignore brief outliers. A higher LRA means more dynamic contrast.\n\nGood values: Pop/EDM: 5-8 LU. Rock: 6-10 LU. Jazz/folk: 8-14 LU. Classical/film scores: 10-20+ LU. A heavily limited master might show 3-4 LU. An unmastered live recording could be 15+ LU.\n\nIf it's wrong: Too low (under 4 LU) usually means over-compression or over-limiting — the track will sound flat and fatiguing. Too high (above 12 LU for pop) means the quiet sections may get lost on earbuds or in noisy environments. Use compression, limiting, or volume automation to bring it into range for your genre."} links={LRA_LINKS} /></span>
                      <strong>{measuredLraText}</strong>
                    </div>
                    <div className="analysis-stat-card" title="True Peak — the highest inter-sample peak level in the track, measured via oversampling.">
                      <span className="analysis-stat-label">True Peak{refSuffix} <HelpTooltip text={"What this measures: The absolute highest signal peak including inter-sample peaks — peaks that occur between digital samples when the signal is reconstructed during D/A conversion. Measured via oversampling (typically 4x), this catches peaks that sample-level measurement misses. Reported in dBTP (decibels True Peak). This is the value streaming platforms check against their ceiling.\n\nGood values: Below -1.0 dBTP for Spotify, Apple Music, YouTube, and Tidal. Below -2.0 dBTP for Amazon Music (their stricter requirement). Many mastering engineers target -1.0 dBTP as their limiter ceiling. For vinyl or broadcast, -3 dBTP or lower is sometimes used.\n\nIf it's wrong: Above -1 dBTP means your track may clip on playback — DACs and lossy codecs (MP3, AAC, Ogg) can push inter-sample peaks into distortion. Lower your limiter output ceiling or reduce gain into the limiter. A true peak limiter (like FabFilter Pro-L 2 in ISP mode) is essential."} links={TRUE_PEAK_LINKS} /></span>
                      <strong>{measuredTruePeakText}</strong>
                    </div>
                    <div className="analysis-stat-card" title="Sample Peak — the highest digital sample value in the track, without oversampling.">
                      <span className="analysis-stat-label">Sample peak{refSuffix} <HelpTooltip text={"What this measures: The highest absolute sample value found in the audio file, measured directly from the digital samples without oversampling. This is what your DAW's standard peak meter shows. It will always be equal to or lower than True Peak because it cannot detect peaks that form between samples during reconstruction.\n\nGood values: Below 0 dBFS. If sample peak is at 0 dBFS, the signal is hitting the digital ceiling. For a properly mastered track, sample peak should be below -0.3 dBFS at minimum, but True Peak is the more important number to watch.\n\nIf it's wrong: If sample peak is at 0 dBFS, you are almost certainly clipping on playback (True Peak will be even higher). Use a true peak limiter with the ceiling set to -1 dBTP. Sample peak matters most when working in contexts where true peak metering is unavailable, or when checking raw recordings before mastering."} links={TRUE_PEAK_LINKS} /></span>
                      <strong>{measuredSamplePeakText}</strong>
                    </div>
                    <div className="analysis-stat-card" title="Highest 3-second loudness window in the track. A single static value from the file analysis — not real-time.">
                      <span className="analysis-stat-label">Peak short-term{refSuffix} <HelpTooltip text={"What this measures: The single loudest 3-second window across the entire track (EBU R128 short-term loudness). This is a static value from the file analysis — it tells you the peak loudness of your loudest section, not a real-time reading. The 3-second window smooths out brief transients to show sustained loudness.\n\nGood values: Typically 2-6 LU above your integrated LUFS. For a track at -14 LUFS integrated, the peak short-term might be around -10 to -8 LUFS. If it equals your integrated LUFS, the track has almost no dynamic variation.\n\nIf it's wrong: If the gap between peak short-term and integrated LUFS is very small (under 2 LU), the track is heavily compressed. If the gap is very large (over 8 LU), one section is dramatically louder than the rest — check for a sudden volume spike or an uncontrolled chorus. Use compression or automation to manage the difference."} links={LUFS_LINKS} /></span>
                      <strong>{measuredMaxShortTermText}</strong>
                    </div>
                    <div className="analysis-stat-card" title="Highest 400ms loudness window in the track. A single static value from the file analysis — not real-time.">
                      <span className="analysis-stat-label">Peak momentary{refSuffix} <HelpTooltip text={"What this measures: The single loudest 400ms window across the entire track (EBU R128 momentary loudness). This catches the most extreme short bursts — a snare hit, a vocal shout, a bass drop. It is always equal to or louder than peak short-term since it uses a shorter measurement window.\n\nGood values: Usually 3-8 LU above your integrated LUFS. For a -14 LUFS track, peak momentary might be around -8 to -6 LUFS. EDM drops and heavy rock hits can push higher.\n\nIf it's wrong: A peak momentary that is far above peak short-term (more than 4 LU gap) means you have a very brief spike — possibly a stray transient, click, or uncompressed hit. Consider taming it with a transient shaper, clipper, or short-attack limiter. If peak momentary is very close to integrated, the track may be over-limited."} links={LUFS_LINKS} /></span>
                      <strong>{measuredMaxMomentaryText}</strong>
                    </div>
                    <div className="analysis-stat-card" title="Average volume level across the entire track (RMS-based), in dBFS.">
                      <span className="analysis-stat-label">Mean volume{refSuffix} <HelpTooltip text={"What this measures: The average (RMS) level of your entire track expressed in dBFS. RMS stands for Root Mean Square — it squares every sample, averages them, then takes the square root, giving a value that correlates closely with perceived loudness. Unlike LUFS, it does not apply perceptual weighting, so it is a purely mathematical average of signal energy.\n\nGood values: For a mastered pop/rock track, typically -10 to -16 dBFS. Unmastered mixes are usually -18 to -24 dBFS. A heavily limited master might read -8 to -6 dBFS. Classical and acoustic music: -20 to -30 dBFS.\n\nIf it's wrong: Mean volume that is very close to the peak level means the track is heavily limited (low crest factor). If it is very far from the peak (more than 18 dB), the track has large untamed transients. Compare with the crest factor reading to assess your dynamic balance."} links={MEAN_VOLUME_LINKS} /></span>
                      <strong>{measuredMeanVolumeText}</strong>
                    </div>
                    <div className="analysis-stat-card" title="Crest Factor — difference between peak and RMS levels. Higher values indicate more dynamic range.">
                      <span className="analysis-stat-label">Crest Factor{refSuffix} <HelpTooltip text={"What this measures: The difference between the sample peak level and the RMS (average) level, in dB. Formula: Crest Factor = Peak dBFS minus RMS dBFS. A higher crest factor means your transients stick out further above the average level — the music has more punch and snap. A lower value means the waveform is more like a brick wall.\n\nGood values: Unmastered/raw mixes: 12-18 dB. Well-mastered pop/rock: 8-12 dB. Heavily limited EDM/hip-hop: 4-8 dB. Extremely squashed masters: under 4 dB. Classical and jazz: 15-20+ dB.\n\nIf it's wrong: Below 6 dB usually means aggressive limiting has crushed your transients — the track will sound loud but lifeless and fatiguing. Above 18 dB could mean uncontrolled peaks that waste headroom. Use a limiter to tame peaks or back off limiting to restore dynamics, depending on which direction you need to go."} links={CREST_FACTOR_LINKS} /></span>
                      <strong>
                        {analysisStatus === 'ready' && analysis
                          ? `${analysis.crestFactorDb.toFixed(1)} dB`
                          : 'Loading…'}
                      </strong>
                    </div>
                    <div className="analysis-stat-card" title="Number of samples at or above 0 dBFS (digital clipping).">
                      <span className="analysis-stat-label">Clip Count{refSuffix} <HelpTooltip text={"What this measures: The number of individual samples in the file whose absolute value reaches or exceeds 1.0 (0 dBFS) — the digital ceiling. Each clipped sample represents a moment where the signal was too loud to be represented digitally and was hard-clipped, causing distortion.\n\nGood values: Zero. Any non-zero clip count means digital distortion is present in the file. Even a single clipped sample is technically distortion, though a handful may not be audible. Hundreds or thousands of clips will be clearly audible as harsh, crunchy distortion.\n\nIf it's wrong: Reduce gain before your limiter, or lower the limiter output ceiling. If clips are coming from the mix bus, pull down your fader or gain-stage your plugins. Note: some producers intentionally use hard clipping as a creative effect (e.g., clip-to-zero mastering in hip-hop), but the clips should be intentional and controlled, not accidental."} links={CLIP_COUNT_LINKS} /></span>
                      <strong>
                        {analysisStatus === 'ready' && analysis
                          ? analysis.clipCount > 0
                            ? `${analysis.clipCount} sample${analysis.clipCount === 1 ? '' : 's'}`
                            : 'None'
                          : 'Loading…'}
                      </strong>
                    </div>
                    <div className="analysis-stat-card" title="DC Offset — mean sample value. Non-zero DC offset wastes headroom.">
                      <span className="analysis-stat-label">DC Offset{refSuffix} <HelpTooltip text={"What this measures: The mean (average) of all sample values in the file. A perfectly centered waveform has a DC offset of 0. A non-zero value means the entire waveform is shifted above or below the center line. The threshold for a warning here is 0.1% (mean sample value > 0.001).\n\nGood values: As close to 0% as possible. Anything under 0.1% is considered clean. Above 0.1% triggers a warning because it wastes headroom — if your waveform is shifted up by 0.5%, you lose 0.5% of your available peak range.\n\nIf it's wrong: DC offset is usually caused by faulty hardware (cheap audio interfaces, phantom power leakage), certain analog-modeled plugins, or recording with a bad cable. Fix it by applying a high-pass filter at a very low frequency (10-20 Hz) or use your DAW's DC offset removal tool (most have one in the audio editor). Always fix DC offset before mastering."} links={DC_OFFSET_LINKS} /></span>
                      <strong>
                        {analysisStatus === 'ready' && analysis
                          ? Math.abs(analysis.dcOffset) > 0.001
                            ? `${(analysis.dcOffset * 100).toFixed(3)}% ⚠`
                            : 'Clean'
                          : 'Loading…'}
                      </strong>
                    </div>
                  </div>
                </section>


                <section
                  className="analysis-overlay-section"
                  data-testid="analysis-overlay-normalization-panel"
                >
                  <h3>Platform normalization preview <HelpTooltip text={"Streaming platforms adjust your track's volume so every song plays at a similar loudness. Each platform has a target LUFS and a true peak ceiling.\n\n'Applied change' = the gain (in dB) the platform will add or remove. 'Projected loudness' = your track's LUFS after that adjustment. 'Headroom cap' = the maximum boost allowed before true peaks would clip.\n\nSpotify (-14 LUFS, -1 dBTP): Turns loud tracks down AND boosts quiet tracks up, but caps the boost so peaks stay under -1 dBTP. Apple Music (-16 LUFS, -1 dBTP): Same up-and-down approach but targets -16 LUFS, preserving more dynamics. YouTube (-14 LUFS, -1 dBTP): Only turns loud tracks down. If your track is quieter than -14, YouTube leaves it alone. Tidal (-14 LUFS, -1 dBTP): Same as YouTube, turns down only. Amazon Music (-14 LUFS, -2 dBTP): Turns down only, with a stricter -2 dBTP peak ceiling.\n\nToggle 'Preview' to hear exactly how your track will sound on the selected platform."} links={PLATFORM_NORMALIZATION_LINKS} /></h3>
                  <div className="analysis-normalization-header">
                    <div>
                      <strong>Streaming loudness preview</strong>
                      <p
                        className="muted"
                        data-testid="analysis-overlay-normalization-summary"
                      >
                        {normalizationSummaryText}
                      </p>
                    </div>
                    <button
                      type="button"
                      className={normalizationPreviewEnabled ? '' : 'ghost'}
                      onClick={() => setNormalizationPreviewEnabled((current) => !current)}
                      data-testid="analysis-overlay-normalization-toggle"
                      disabled={analysisStatus !== 'ready' || !normalizationPreview}
                      title="Apply this platform's loudness adjustment to your playback."
                    >
                      Preview {normalizationPreviewEnabled ? 'On' : 'Off'}
                    </button>
                  </div>

                  <div
                    className="analysis-platform-grid analysis-platform-grid-overlay"
                    role="group"
                    aria-label="Platform normalization presets"
                  >
                    {NORMALIZATION_PLATFORM_PROFILES.map((platform) => {
                      const platformPreview = normalizationPreviewByPlatformId.get(platform.id) ?? null;
                      const platformChangeText =
                        analysisStatus === 'ready' && platformPreview
                          ? formatSignedLevel(platformPreview.appliedGainDb)
                          : '—';

                      return (
                        <button
                          key={`overlay-${platform.id}`}
                          type="button"
                          className={`analysis-platform-button${
                            selectedNormalizationPlatformId === platform.id ? ' selected' : ''
                          }`}
                          onClick={() => setSelectedNormalizationPlatformId(platform.id)}
                          data-testid={`analysis-overlay-platform-${platform.id}`}
                          title={platform.description}
                          aria-pressed={selectedNormalizationPlatformId === platform.id}
                        >
                          <span className="analysis-platform-header-row">
                            <span
                              className="analysis-platform-icon"
                              style={{ '--platform-accent': platform.accentColor } as CSSProperties}
                            >
                              <PlatformIcon platformId={platform.id} />
                            </span>
                            <span className="analysis-platform-title">{platform.label}</span>
                          </span>
                          <span className="analysis-platform-copy">
                            <span className="analysis-platform-target">
                              {platform.targetLufs.toFixed(0)} LUFS target
                            </span>
                            <span className="analysis-platform-change">
                              Applied {platformChangeText}
                            </span>
                            <span className="muted">
                              {platform.truePeakCeilingDbtp.toFixed(0)} dBTP ceiling
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="analysis-normalization-metrics-grid">
                    <div className="analysis-stat-card" data-testid="analysis-overlay-normalization-change">
                      <span className="analysis-stat-label">Applied change</span>
                      <strong>{normalizationChangeText}</strong>
                      <span className="muted">
                        {normalizationPreviewEnabled
                          ? 'Previewing now'
                          : 'Off — tap Preview On to hear it'}
                      </span>
                    </div>
                    <div className="analysis-stat-card" data-testid="analysis-overlay-normalization-projected">
                      <span className="analysis-stat-label">Projected loudness</span>
                      <strong>{normalizationProjectedText}</strong>
                      <span className="muted">After normalization</span>
                    </div>
                    <div className="analysis-stat-card" data-testid="analysis-overlay-normalization-cap">
                      <span className="analysis-stat-label">Headroom cap</span>
                      <strong>{normalizationCapText}</strong>
                      <span className="muted">
                        {normalizationPreview?.limitedByHeadroom
                          ? 'Boost limited by true peak'
                          : selectedNormalizationPlatform.policy === 'down-only'
                            ? 'This platform only turns down'
                            : 'Within headroom'}
                      </span>
                    </div>
                    <div className="analysis-stat-card" data-testid="analysis-overlay-normalization-target">
                      <span className="analysis-stat-label">Target &amp; peak ceiling</span>
                      <strong>
                        {selectedNormalizationPlatform.targetLufs.toFixed(0)} LUFS ·{' '}
                        {selectedNormalizationPlatform.truePeakCeilingDbtp.toFixed(0)} dBTP
                      </strong>
                      <span className="muted">Platform target</span>
                    </div>
                    <div className="analysis-stat-card" data-testid="analysis-overlay-normalization-policy">
                      <span className="analysis-stat-label">Gain policy</span>
                      <strong>
                        {selectedNormalizationPlatform.policy === 'down-only'
                          ? 'Turn down only'
                          : 'Turn up & down'}
                      </strong>
                      <span className="muted">{selectedNormalizationPlatform.description}</span>
                    </div>
                  </div>
                </section>

                <section className="analysis-overlay-section analysis-comparison-panel">
                  <div className="analysis-section-header">
                    <h4>Your Mix vs Reference <HelpTooltip text="Side-by-side comparison of your mix and the loaded reference track. Shows the difference in loudness (LUFS), true peak, and tonal balance. Positive numbers mean your mix is louder/higher; negative means the reference is. Use this to see exactly how your mix stacks up against a professional master." links={REFERENCE_TRACK_LINKS} /></h4>
                    <p className="analysis-section-subtitle">Compare loudness and tonal balance against your reference track</p>
                  </div>
                  {referenceTrack && activeReferenceComparison ? (
                    <div data-testid="analysis-active-reference">
                      <p>
                        <strong>{referenceTrack.fileName}</strong>
                      </p>
                      <div className="analysis-detail-grid analysis-detail-grid-wide">
                        <div className="analysis-stat-card">
                          <span className="analysis-stat-label">Loudness difference</span>
                          <strong>{formatSignedLevel(activeReferenceComparison.integratedDeltaDb)}</strong>
                        </div>
                        <div className="analysis-stat-card">
                          <span className="analysis-stat-label">True peak delta</span>
                          <strong>{formatSignedLevel(activeReferenceComparison.truePeakDeltaDb)}</strong>
                        </div>
                        <div className="analysis-stat-card">
                          <span className="analysis-stat-label">Current loudness difference</span>
                          <strong>{formatSignedLevel(activeReferenceComparison.shortTermDeltaDb)}</strong>
                        </div>
                        <div className="analysis-stat-card">
                          <span className="analysis-stat-label">Low tilt delta</span>
                          <strong>{formatSignedLevel(activeReferenceComparison.tonalDelta.low * 100)}</strong>
                        </div>
                        <div className="analysis-stat-card">
                          <span className="analysis-stat-label">Mid tilt delta</span>
                          <strong>{formatSignedLevel(activeReferenceComparison.tonalDelta.mid * 100)}</strong>
                        </div>
                        <div className="analysis-stat-card">
                          <span className="analysis-stat-label">High tilt delta</span>
                          <strong>{formatSignedLevel(activeReferenceComparison.tonalDelta.high * 100)}</strong>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="muted" data-testid="analysis-active-reference">
                      Load a reference track to compare.
                    </p>
                  )}
                </section>

                {/* Vectorscope & Mid/Side Monitoring */}
                <div className="analysis-overlay-side-by-side">
                  <section className="analysis-overlay-section" data-testid="analysis-vectorscope">
                    <div className="analysis-section-header">
                      <h4>Vectorscope{isRefMode ? " (Reference)" : ""} <HelpTooltip text={"What you're seeing: A circular display where blue dots trace your stereo signal in real-time, with a fading trail so you can see the shape over time. The vertical axis (M) is the Mid/mono signal (L+R), and the horizontal axis (S) is the Side signal (L-R). L and R labels mark the diagonal directions for pure left and pure right.\n\nWhat to look for: A tall, narrow vertical shape = mostly mono content (centered vocals, bass). A wider spread = more stereo width. A roughly even shape = balanced stereo image. If it leans consistently toward L or R, your mix is off-center. A thin horizontal line means the signal is pure side information with no center — usually a problem.\n\nTip: Bass and kick should appear mostly vertical (centered). If your low end spreads wide on the vectorscope, consider narrowing it with a mid/side EQ. A natural, full mix typically looks like a fuzzy vertical oval."} links={VECTORSCOPE_LINKS} /></h4>
                      <p className="analysis-section-subtitle">Stereo image — wider spread = wider stereo field, vertical = mono</p>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                      <Vectorscope
                        analyserNodeL={analyserNodeL}
                        analyserNodeR={analyserNodeR}
                        size={200}
                        isPlaying={isPlaying}
                      />
                    </div>
                  </section>

                  <section className="analysis-overlay-section" data-testid="analysis-midside">
                    <div className="analysis-section-header">
                      <h4>Mid/Side Monitoring <HelpTooltip text="Listen to just the center (Mid) or sides (Side) of your stereo mix separately. Mid = vocals, bass, kick. Side = reverb, width, panning. Useful for checking stereo balance." links={MID_SIDE_LINKS} /></h4>
                      <p className="analysis-section-subtitle">Listen to Mid (center) or Side (stereo width) in isolation</p>
                    </div>
                    <div className="analysis-ab-actions" role="group" aria-label="Mid/Side toggle" style={{ display: 'flex', gap: 6 }}>
                      <button
                        type="button"
                        className={midSideMode === 'stereo' ? '' : 'ghost'}
                        onClick={() => setMidSideMode('stereo')}
                        title="Normal stereo playback."
                      >
                        Stereo
                      </button>
                      <button
                        type="button"
                        className={midSideMode === 'mid' ? '' : 'ghost'}
                        onClick={() => setMidSideMode('mid')}
                        title="Listen to just the center (mid) channel."
                      >
                        Mid
                      </button>
                      <button
                        type="button"
                        className={midSideMode === 'side' ? '' : 'ghost'}
                        onClick={() => setMidSideMode('side')}
                        title="Listen to just the side (stereo width) channel."
                      >
                        Side
                      </button>
                    </div>
                    {midSideMode !== 'stereo' ? (
                      <p className="muted" style={{ fontSize: 12 }}>
                        Listening in <strong>{midSideMode === 'mid' ? 'Mid (L+R)/2' : 'Side (L-R)/2'}</strong> mode
                      </p>
                    ) : null}
                  </section>
                </div>

                {/* K-Metering */}
                <section className="analysis-overlay-section" data-testid="analysis-k-metering">
                  <div className="analysis-section-header">
                    <h4>K-Metering <HelpTooltip text={"What this measures: Bob Katz's K-System metering, which shifts the meter scale so 0 dB represents a calibrated reference level instead of the digital ceiling. K-14 sets 0 dB = -14 dBFS (designed for pop, rock, and electronic music). K-20 sets 0 dB = -20 dBFS (designed for film, classical, and broadcast). The value shown is your track's RMS level on that K-scale.\n\nGood values: On K-14, your average level should hover around 0 dB (meaning your RMS is around -14 dBFS). Peaks above +4 dB on K-14 are loud. On K-20, average around 0 dB means your RMS is around -20 dBFS — typical for dynamic content like film and orchestral music.\n\nIf it's wrong: If your K-14 reading is consistently above +4 dB, you are mastering very loud with limited dynamics. If it reads well below -6 dB on K-14, your track is unusually quiet for commercial music. Use K-14 for most music production and K-20 when working on film, classical, or anything requiring wide dynamic range."} links={K_METERING_LINKS} /></h4>
                    <p className="analysis-section-subtitle">K-weighted meter scales calibrated for different content types — 0 dB on the K-scale represents the reference listening level</p>
                  </div>
                  <div className="analysis-detail-grid analysis-detail-grid-wide">
                    <div className="analysis-stat-card" title="K-14: 0 dB on meter = -14 dBFS. Best for most music.">
                      <span className="analysis-stat-label">K-14 Metering{refSuffix}</span>
                      <strong>
                        {analysisStatus === 'ready' && analysis
                          ? `${(analysis.rmsDbfs + 14).toFixed(1)} dB`
                          : 'Loading…'}
                      </strong>
                      <span className="muted">Reference: 0 dB = -14 dBFS (pop/rock/electronic)</span>
                    </div>
                    <div className="analysis-stat-card" title="K-20: 0 dB on meter = -20 dBFS. Best for film/classical.">
                      <span className="analysis-stat-label">K-20 Metering{refSuffix}</span>
                      <strong>
                        {analysisStatus === 'ready' && analysis
                          ? `${(analysis.rmsDbfs + 20).toFixed(1)} dB`
                          : 'Loading…'}
                      </strong>
                      <span className="muted">Reference: 0 dB = -20 dBFS (film/classical/broadcast)</span>
                    </div>
                  </div>
                </section>

                {/* Pro Indicators: Dynamic Range */}
                {analysisStatus === 'ready' && analysis ? (
                  <section className="analysis-overlay-section" data-testid="analysis-pro-indicators">
                    <div className="analysis-section-header">
                      <h4>Quick Diagnostics <HelpTooltip text={"What this measures: A quick classification of your track's dynamic character based on the crest factor (peak-to-RMS difference). High DR means crest factor above 10 dB — your transients and dynamics are well-preserved. Medium DR is 6-10 dB — typical for commercial masters. Low DR means below 6 dB — the track is heavily compressed or limited.\n\nGood values: Depends on genre and intent. Pop/rock: Medium DR (6-10 dB) is normal. EDM/hip-hop: Medium to Low DR is common. Acoustic/jazz/classical: High DR (above 10 dB) is expected. There is no single right answer — it depends on what the music needs.\n\nIf it's wrong: Low DR with a track that should breathe (acoustic, jazz) means you have over-limited. Try reducing limiter gain reduction or using less bus compression. High DR on a track meant to compete on playlists may need more limiting. The goal is to match the dynamic feel that serves the song, not chase a number."} links={DYNAMIC_RANGE_LINKS} /></h4>
                      <p className="analysis-section-subtitle">At-a-glance health checks for your master</p>
                    </div>
                    <div className="analysis-pro-indicators">
                      <div className={`analysis-pro-indicator ${
                        (analysis.crestFactorDb) > 10 ? 'pass' : (analysis.crestFactorDb) >= 6 ? 'warn' : 'fail'
                      }`} data-testid="analysis-dynamic-range-indicator">
                        <span className="indicator-icon">{(analysis.crestFactorDb) > 10 ? '\u2728' : (analysis.crestFactorDb) >= 6 ? '\u26a0\ufe0f' : '\u26d4'}</span>
                        <div className="indicator-content">
                          <span className="indicator-label">Dynamic Range</span>
                          <span className="indicator-value">
                            {(analysis.crestFactorDb) > 10
                              ? `High DR (${analysis.crestFactorDb.toFixed(1)} dB)`
                              : (analysis.crestFactorDb) >= 6
                                ? `Medium DR (${analysis.crestFactorDb.toFixed(1)} dB)`
                                : `Low DR (${analysis.crestFactorDb.toFixed(1)} dB)`}
                          </span>
                        </div>
                      </div>
                    </div>
                  </section>
                ) : null}

                {/* Mastering Checklist Summary */}
                {analysisStatus === 'ready' && analysis && measuredAnalysis ? (
                  <section className="analysis-overlay-section" data-testid="analysis-mastering-checklist">
                    <div className="analysis-section-header">
                      <h4>Mastering Checklist <HelpTooltip text={"What this measures: An automated technical health check of your master across four critical areas. (1) LUFS: passes if integrated loudness is between -16 and -6 LUFS (the typical streaming range), warns otherwise. (2) True Peak: passes if below -1 dBTP, warns if between -1 and 0 dBTP, fails if at or above 0 dBTP. (3) DC Offset: passes if the mean sample value is 0.001 or less (0.1%), warns if higher. (4) Clipping: passes if zero clipped samples, fails if any samples hit the digital ceiling.\n\nGood values: All four checks showing a pass (checkmark). This means your master is technically clean and ready for distribution.\n\nIf it's wrong: LUFS warning — adjust your overall loudness to match platform targets. True Peak warning — lower your limiter ceiling to -1 dBTP or use a true peak limiter. DC Offset warning — apply a high-pass filter at 10-20 Hz or use DC offset removal. Clipping failure — reduce gain into your final limiter or lower the output ceiling."} links={MASTERING_CHECKLIST_LINKS} /></h4>
                      <p className="analysis-section-subtitle">Auto-generated summary of your master&apos;s technical health</p>
                    </div>
                    <div className="mastering-checklist-summary">
                      <div className={`mastering-checklist-row ${
                        measuredAnalysis.integratedLufs !== null && measuredAnalysis.integratedLufs >= -16 && measuredAnalysis.integratedLufs <= -6 ? 'pass' : 'warn'
                      }`}>
                        <span className="checklist-icon">{measuredAnalysis.integratedLufs !== null && measuredAnalysis.integratedLufs >= -16 && measuredAnalysis.integratedLufs <= -6 ? '\u2713' : '\u26a0'}</span>
                        <span className="checklist-label">LUFS</span>
                        <span className="checklist-value">
                          {measuredAnalysis.integratedLufs !== null
                            ? `${measuredAnalysis.integratedLufs.toFixed(1)} LUFS${measuredAnalysis.integratedLufs >= -16 && measuredAnalysis.integratedLufs <= -6 ? ' \u2014 within streaming range' : ' \u2014 outside typical range (-16 to -6)'}`
                            : 'Not measured'}
                        </span>
                      </div>
                      <div className={`mastering-checklist-row ${
                        measuredAnalysis.truePeakDbfs !== null && measuredAnalysis.truePeakDbfs < -1 ? 'pass' : measuredAnalysis.truePeakDbfs !== null && measuredAnalysis.truePeakDbfs < 0 ? 'warn' : 'fail'
                      }`}>
                        <span className="checklist-icon">{measuredAnalysis.truePeakDbfs !== null && measuredAnalysis.truePeakDbfs < -1 ? '\u2713' : '\u26a0'}</span>
                        <span className="checklist-label">True Peak</span>
                        <span className="checklist-value">
                          {measuredAnalysis.truePeakDbfs !== null
                            ? `${measuredAnalysis.truePeakDbfs.toFixed(1)} dBTP${measuredAnalysis.truePeakDbfs < -1 ? ' \u2014 below -1 dBTP ceiling' : ' \u2014 above -1 dBTP, may clip on playback'}`
                            : 'Not measured'}
                        </span>
                      </div>
                      <div className={`mastering-checklist-row ${
                        Math.abs(analysis.dcOffset) <= 0.001 ? 'pass' : 'warn'
                      }`}>
                        <span className="checklist-icon">{Math.abs(analysis.dcOffset) <= 0.001 ? '\u2713' : '\u26a0'}</span>
                        <span className="checklist-label">DC Offset</span>
                        <span className="checklist-value">
                          {Math.abs(analysis.dcOffset) <= 0.001
                            ? 'None detected'
                            : `${(analysis.dcOffset * 100).toFixed(3)}% \u2014 wastes headroom, consider removing`}
                        </span>
                      </div>
                      <div className={`mastering-checklist-row ${
                        analysis.clipCount === 0 ? 'pass' : 'fail'
                      }`}>
                        <span className="checklist-icon">{analysis.clipCount === 0 ? '\u2713' : '\u26a0'}</span>
                        <span className="checklist-label">Clipping</span>
                        <span className="checklist-value">
                          {analysis.clipCount === 0
                            ? 'No clipped samples detected'
                            : `${analysis.clipCount} clipped sample${analysis.clipCount === 1 ? '' : 's'} \u2014 reduce gain to avoid distortion`}
                        </span>
                      </div>
                    </div>
                  </section>
                ) : null}

                {/* Dynamic Range / Crest Factor Meter */}
                <section
                  className="analysis-overlay-section"
                  data-testid="analysis-crest-factor-history"
                  ref={crestFactorSectionRef}
                >
                  <div className="analysis-section-header">
                    <h4>Dynamic Range / Crest Factor <HelpTooltip text={"What you're seeing: A real-time line graph plotting the crest factor (peak-to-RMS difference) over the last 30 seconds. The crest factor measures how much transient headroom your audio has — the gap between the loudest peak and the average (RMS) level.\n\nColor coding: Green (above 8 dB) means healthy dynamics with well-preserved transients. Yellow (6-8 dB) indicates moderate compression typical of commercial masters. Red (below 6 dB) signals heavily compressed or limited audio — the dynamics are being crushed.\n\nWhat to look for: Watch how the line moves during different sections. Verses might show higher crest factor while choruses drop lower as limiting kicks in. If the line stays consistently in the red zone, you may be over-limiting.\n\nTip: Compare this graph during your loudest chorus vs. your quietest verse. If both sections show similar crest factor, your master might lack dynamic contrast."} links={CREST_FACTOR_HISTORY_LINKS} /></h4>
                    <p className="analysis-section-subtitle">Real-time peak-to-RMS difference — green = healthy dynamics, red = crushed</p>
                  </div>
                  <CrestFactorGraph
                    analyserNode={analyserNode}
                    width={spectrumFullWidth}
                    height={200}
                    isPlaying={isPlaying}
                    isVisible={crestFactorVisible}
                  />
                </section>

                {/* Mid/Side Spectrum */}
                <section
                  className="analysis-overlay-section"
                  data-testid="analysis-mid-side-spectrum"
                  ref={midSideSpectrumSectionRef}
                >
                  <div className="analysis-section-header">
                    <h4>Mid/Side Spectrum <HelpTooltip text={"What you're seeing: Two overlaid spectrum curves — blue for Mid (L+R summed) and orange for Side (L-R). Both share the same frequency axis as the main spectrum analyzer.\n\nWhat to look for: Bass frequencies (below ~200 Hz) should be predominantly Mid (blue) with minimal Side (orange) — this ensures mono-compatible low end. If orange is dominant in the lows, your bass is too wide and may collapse on mono playback. In the highs, Side content is normal (reverb, panned elements).\n\nTip: Use this alongside the Mid/Side Monitoring controls to listen and compare."} links={MID_SIDE_SPECTRUM_LINKS} /></h4>
                    <p className="analysis-section-subtitle">Frequency content split into Mid (center) and Side (stereo width)</p>
                  </div>
                  <MidSideSpectrum
                    analyserNodeL={analyserNodeL}
                    analyserNodeR={analyserNodeR}
                    width={spectrumFullWidth}
                    height={240}
                    isPlaying={isPlaying}
                    isVisible={midSideSpectrumVisible}
                  />
                </section>

                {/* Loudness Histogram / Distribution */}
                <section
                  className="analysis-overlay-section"
                  data-testid="analysis-loudness-histogram"
                  ref={loudnessHistogramSectionRef}
                >
                  <div className="analysis-section-header">
                    <h4>Loudness Distribution <HelpTooltip text={"What you're seeing: A histogram showing how often your audio sits at each loudness level (approximate LUFS). The X-axis shows loudness bins, Y-axis shows frequency of occurrence. Green dashed lines mark the streaming target range (-16 to -6 LUFS).\n\nWhat to look for: A narrow spike means consistent loudness (heavily limited). A wider distribution means more dynamic variation. The shape reveals dynamic character that a single LRA number cannot.\n\nTip: Play the full track to accumulate a complete picture. The histogram resets when you switch tracks."} links={LOUDNESS_HISTOGRAM_LINKS} /></h4>
                    <p className="analysis-section-subtitle">Statistical distribution of loudness levels — play the full track for best results</p>
                  </div>
                  <LoudnessHistogram
                    analyserNode={analyserNode}
                    width={spectrumFullWidth}
                    height={200}
                    isPlaying={isPlaying}
                    isVisible={loudnessHistogramVisible}
                  />
                </section>

                {/* Spectrogram (Scrolling) */}
                <section
                  className="analysis-overlay-section"
                  data-testid="analysis-spectrogram"
                  ref={spectrogramSectionRef}
                >
                  <div className="analysis-section-header">
                    <h4>Spectrogram <HelpTooltip text={"What you're seeing: A scrolling 2D heatmap — X is time, Y is frequency (20 Hz to 20 kHz, logarithmic), color intensity is amplitude. Dark blue = quiet, green = moderate, yellow = loud, red = very loud.\n\nWhat to look for: A persistent bright horizontal band indicates a resonant frequency that may need EQ. Vertical bright lines are transients (drums, clicks). Gradual color shifts show arrangement dynamics between sections.\n\nTip: Especially useful for spotting issues a real-time spectrum misses — like a rogue frequency that appears briefly, or gradual tonal drift across sections."} links={SPECTROGRAM_LINKS} /></h4>
                    <p className="analysis-section-subtitle">Scrolling frequency heatmap — time vs. frequency vs. amplitude</p>
                  </div>
                  <Spectrogram
                    analyserNode={analyserNode}
                    width={spectrumFullWidth}
                    height={260}
                    isPlaying={isPlaying}
                    isVisible={spectrogramVisible}
                  />
                </section>
              </div>
            ) : (
              <p className="muted">Pick a track to see mastering analysis.</p>
            )}
          </div>
        </div>
      ) : null}

      {migrationModalOpen ? (
        <div
          className="migration-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Migrate notes via LLM"
          data-testid="migration-modal"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              handleCloseMigrationModal();
            }
          }}
        >
          <div className="migration-modal-card">
            <div className="migration-modal-header">
              <div>
                <h2>Migrate Notes via LLM <HelpTooltip text={"What this is: A migration tool that uses an LLM (like ChatGPT or Claude) to convert notes from other apps (Apple Notes, Google Docs, etc.) into structured checklist items for each song.\n\nHow to use it: 1) Click 'Copy Schema to Clipboard' to get a JSON template with your song names. 2) Paste it into an LLM along with your existing notes. 3) Ask the LLM to fill in the checklist items. 4) Paste the LLM's JSON output back here. 5) Preview and confirm the import.\n\nWhy you'd want to: If you have mixing/mastering notes scattered in other apps, this lets you bring them all into Producer Player without manually re-typing everything.\n\nTip: The more specific your prompt to the LLM, the better the results. Include context like 'these are mixing notes for songs in my album' so it maps notes to the right tracks."} /></h2>
                <p className="muted">
                  Import checklist items from other note apps using an LLM to parse your notes.
                </p>
              </div>
              <button type="button" className="ghost" onClick={handleCloseMigrationModal} title="Close the migration dialog.">
                Close
              </button>
            </div>

            <div className="migration-workflow-steps">
              <div className="migration-step">
                <span className="migration-step-number">1</span>
                <div>
                  <strong>Copy the schema &amp; song list</strong>
                  <p className="muted">
                    This copies a JSON schema plus your current song names to the clipboard.
                  </p>
                  <button
                    type="button"
                    onClick={handleCopyMigrationSchema}
                    data-testid="migration-copy-schema"
                    className={migrationSchemaCopied ? 'migration-copied-button' : ''}
                    title="Copy the JSON schema and song list to clipboard for pasting into an LLM."
                  >
                    {migrationSchemaCopied ? '✓ Copied to Clipboard' : 'Copy Schema to Clipboard'}
                  </button>
                </div>
              </div>

              <div className="migration-step">
                <span className="migration-step-number">2</span>
                <div>
                  <strong>Paste into an LLM</strong>
                  <p className="muted">
                    Open ChatGPT, Claude, or any LLM. Paste the schema, then paste your old notes
                    and ask it to return structured JSON matching the schema.
                  </p>
                </div>
              </div>

              <div className="migration-step">
                <span className="migration-step-number">3</span>
                <div>
                  <strong>Paste the LLM&apos;s response below</strong>
                  <p className="muted">
                    Copy the JSON output from the LLM and paste it here. Don&apos;t worry about
                    formatting — we handle code fences, trailing commas, and other quirks.
                  </p>
                </div>
              </div>
            </div>

            <div className="migration-input-area">
              <textarea
                className="migration-json-textarea"
                value={migrationJsonInput}
                onChange={(event) => {
                  setMigrationJsonInput(event.currentTarget.value);
                  setMigrationParseError(null);
                  setMigrationPreview(null);
                  setMigrationImportDone(false);
                }}
                placeholder={'Paste the LLM\'s JSON response here…'}
                rows={10}
                data-testid="migration-json-input"
              />
              <button
                type="button"
                onClick={handleParseMigrationJson}
                disabled={migrationJsonInput.trim().length === 0}
                data-testid="migration-parse-button"
                title="Parse the pasted JSON and show a preview of what will be imported."
              >
                Parse &amp; Preview
              </button>
            </div>

            {migrationParseError ? (
              <p className="error migration-error" data-testid="migration-parse-error">
                {migrationParseError}
              </p>
            ) : null}

            {migrationImportDone ? (
              <div className="migration-success" data-testid="migration-success">
                <p>
                  <strong>✓ Import complete!</strong> Checklist items have been added to the matched
                  songs. You can close this dialog now or import more.
                </p>
              </div>
            ) : null}

            {migrationPreview && migrationPreview.length > 0 ? (
              <div className="migration-preview" data-testid="migration-preview">
                <h3>
                  Preview —{' '}
                  {migrationPreview.reduce((sum, s) => sum + s.items.length, 0)} items across{' '}
                  {migrationPreview.filter((s) => s.matchedSongId).length} matched song(s)
                </h3>
                {migrationPreview.some((s) => !s.matchedSongId) ? (
                  <p className="migration-warning">
                    ⚠ Some songs could not be matched and will be skipped.
                  </p>
                ) : null}
                <ul className="migration-preview-list">
                  {migrationPreview.map((entry, index) => (
                    <li
                      key={`${entry.songName}-${index}`}
                      className={`migration-preview-song${!entry.matchedSongId ? ' unmatched' : ''}`}
                    >
                      <div className="migration-preview-song-header">
                        <strong>{entry.songName}</strong>
                        {entry.matchedSongId ? (
                          <span
                            className={`migration-match-badge ${entry.matchConfidence}`}
                            title={
                              entry.matchConfidence === 'exact'
                                ? 'Exact match'
                                : `Fuzzy match → ${entry.matchedSongTitle}`
                            }
                          >
                            {entry.matchConfidence === 'exact' ? '✓ exact' : `≈ ${entry.matchedSongTitle}`}
                          </span>
                        ) : (
                          <span className="migration-match-badge none" title="No matching song found">
                            ✗ no match — will be skipped
                          </span>
                        )}
                      </div>
                      <ul className="migration-preview-items">
                        {entry.items.map((item, itemIndex) => (
                          <li key={itemIndex}>
                            <span className="migration-preview-item-text">{item.text}</span>
                            {item.timestampSeconds !== null && (
                              <span className="migration-preview-item-timestamp" title={`Timestamp: ${formatTime(item.timestampSeconds)}`}>
                                {formatTime(item.timestampSeconds)}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
                <div className="migration-preview-actions">
                  <button
                    type="button"
                    onClick={handleConfirmMigrationImport}
                    data-testid="migration-confirm-import"
                  >
                    Import {migrationPreview.filter((s) => s.matchedSongId).length} Song(s)
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      setMigrationPreview(null);
                      setMigrationParseError(null);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {ENABLE_AGENT_FEATURES ? (
        <AgentChatPanel getAnalysisContext={getAnalysisContext} />
      ) : null}
    </div>
  );
}
