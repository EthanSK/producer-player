import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
} from 'react';
import type {
  AudioFileAnalysis,
  LibrarySnapshot,
  PlaylistOrderExportV1,
  PlaybackSourceInfo,
  ProducerPlayerEnvironment,
  ReferenceTrackSelection,
  SongVersion,
  SongWithVersions,
  TransportCommand,
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
import producerPlayerIconUrl from '../../../assets/icon/source/producer-player-icon.svg';

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

interface SongChecklistItem {
  id: string;
  text: string;
  completed: boolean;
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
const PUBLIC_REPOSITORY_URL = 'https://github.com/EthanSK/producer-player';
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
  return `Try exporting it again as WAV, MP3, or AAC (.m4a), then rescan the folder. ${extension} may not be ready for playback yet.`;
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

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const entries = Object.entries(parsed).filter(
      ([songId, rating]) =>
        songId.length > 0 &&
        typeof rating === 'number' &&
        Number.isFinite(rating) &&
        rating >= 1 &&
        rating <= 10
    );

    return Object.fromEntries(entries) as Record<string, number>;
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

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    const checklistEntries = Object.entries(parsed).flatMap(([songId, items]) => {
      if (songId.length === 0 || !Array.isArray(items)) {
        return [];
      }

      const sanitizedItems: SongChecklistItem[] = items.flatMap((item) => {
        if (!item || typeof item !== 'object') {
          return [];
        }

        const candidate = item as {
          id?: unknown;
          text?: unknown;
          completed?: unknown;
        };

        if (typeof candidate.id !== 'string' || candidate.id.trim().length === 0) {
          return [];
        }

        if (typeof candidate.text !== 'string') {
          return [];
        }

        if (typeof candidate.completed !== 'boolean') {
          return [];
        }

        return [
          {
            id: candidate.id,
            text: candidate.text,
            completed: candidate.completed,
          },
        ];
      });

      return [[songId, sanitizedItems] as const];
    });

    return Object.fromEntries(checklistEntries) as Record<string, SongChecklistItem[]>;
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
  const [folderPathInput, setFolderPathInput] = useState('');
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
  const [checklistModalSongId, setChecklistModalSongId] = useState<string | null>(null);
  const [checklistDraftText, setChecklistDraftText] = useState('');
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
  const [referenceTrack, setReferenceTrack] = useState<LoadedReferenceTrack | null>(null);
  const [referenceStatus, setReferenceStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle'
  );
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const [selectedNormalizationPlatformId, setSelectedNormalizationPlatformId] =
    useState<NormalizationPlatformId>('spotify');
  const [normalizationPreviewEnabled, setNormalizationPreviewEnabled] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playOnNextLoadRef = useRef(false);
  const repeatModeRef = useRef<RepeatMode>('off');
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
  const playbackAudioContextRef = useRef<AudioContext | null>(null);
  const playbackGainNodeRef = useRef<GainNode | null>(null);

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

  useEffect(() => {
    persistSongRatings(songRatings);
  }, [songRatings]);

  useEffect(() => {
    persistSongChecklists(songChecklists);
  }, [songChecklists]);

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
  }, [checklistModalSongId, snapshot.songs]);

  useEffect(() => {
    if (!checklistModalSongId) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
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
          ? `${extensionText} is not ready for playback in Producer Player yet.`
          : 'Producer Player could not get the track ready to play in time.';

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

        playbackSourceNode.connect(playbackGainNode);
        playbackGainNode.connect(playbackAudioContext.destination);
        playbackGainNode.gain.value = DEFAULT_PLAYBACK_VOLUME;

        playbackAudioContextRef.current = playbackAudioContext;
        playbackGainNodeRef.current = playbackGainNode;
      } catch {
        playbackAudioContextRef.current = null;
        playbackGainNodeRef.current = null;
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
            setPlaybackError(`Repeat-one playback restart failed: ${message}.`);
            logPlaybackEvent('repeat-one-restart-failed', {
              message,
            });
          });
        return;
      }

      const advanced = moveInQueueRef.current(1, {
        wrap: mode === 'all',
        autoplay: true,
      });

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
          ? `${source?.extension ? `.${source.extension}` : 'This format'} is not supported for playback yet.`
          : 'Producer Player could not decode the selected file.';

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

    if (
      selectedPlaybackVersionId &&
      availableVersionIds.has(selectedPlaybackVersionId)
    ) {
      return;
    }

    setSelectedPlaybackVersionId(getPreferredPlaybackVersionId(selectedSong));
  }, [selectedPlaybackVersionId, selectedSong]);

  const selectedPlaybackVersion =
    snapshot.versions.find((version) => version.id === selectedPlaybackVersionId) ?? null;
  const selectedPlaybackFilePath = selectedPlaybackVersion?.filePath ?? null;
  const selectedPlaybackSongId = selectedPlaybackVersion?.songId ?? null;
  const activeMixPlaybackSource =
    selectedPlaybackFilePath &&
    mixPlaybackSourceSelectedFilePath === selectedPlaybackFilePath
      ? mixPlaybackSource
      : null;
  const referencePlaybackKey = getReferencePlaybackKey(referenceTrack);
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
  const appliedNormalizationGainDb =
    normalizationPreviewEnabled &&
    normalizationPreview !== null &&
    normalizationPreview.appliedGainDb !== null
      ? normalizationPreview.appliedGainDb
      : 0;
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
  const emptyStateText = isSearching
    ? 'No matching tracks or versions.'
    : loading
      ? 'Loading…'
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
      if (event.repeat || event.code !== 'Space') {
        return;
      }

      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      if (
        target.isContentEditable ||
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT'
      ) {
        return;
      }

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

  function handleLinkFolderPath(): void {
    const folderPath = folderPathInput.trim();
    if (!folderPath) {
      return;
    }

    void runSnapshotTask(() => window.producerPlayer.linkFolder(folderPath));
    setFolderPathInput('');
  }

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
    const shouldKeepPlaying = shouldAutoplayOnTransport();

    if (songId !== selectedSongId) {
      rememberCurrentSongPlayhead();
    }

    setSelectedSongId(songId);

    if (shouldKeepPlaying) {
      playOnNextLoadRef.current = true;
      schedulePlaybackLoadTimeout('song-switch-autoplay');
    }
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
            `This format is not supported for playback yet. ${buildPlaybackFallbackGuidance(
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

  function handlePreviousTrack(): void {
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

  function handleNextTrack(): void {
    void moveInQueueRef.current(1, {
      wrap: repeatMode === 'all',
      autoplay: shouldAutoplayOnTransport(),
    });
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

  function handleClearReferenceTrack(): void {
    setReferenceTrack(null);
    setReferenceStatus('idle');
    setReferenceError(null);
  }

  function handleReferencePreviewModeChange(nextMode: 'mix' | 'reference'): void {
    if (nextMode === 'reference' && !referenceTrack) {
      return;
    }

    setPlaybackPreviewMode(nextMode);
  }

  function handleOpenSupportLink(url: string): void {
    void runVoidTask(() => window.producerPlayer.openExternalUrl(url));
  }

  function handleSongRatingChange(songId: string, nextRatingValue: number): void {
    const nextRating = getNormalizedSliderRating(nextRatingValue);

    setSongRatings((current) => ({
      ...current,
      [songId]: nextRating,
    }));
  }

  function updateSongChecklistItems(
    songId: string,
    updater: (items: SongChecklistItem[]) => SongChecklistItem[]
  ): void {
    setSongChecklists((current) => {
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
    });
  }

  function handleOpenSongChecklist(songId: string): void {
    setChecklistModalSongId(songId);
    setChecklistDraftText('');
  }

  function handleCloseSongChecklist(): void {
    setChecklistModalSongId(null);
    setChecklistDraftText('');
  }

  function handleAddChecklistItem(): void {
    const songId = checklistModalSongId;
    const itemText = checklistDraftText.trim();

    if (!songId || itemText.length === 0) {
      return;
    }

    updateSongChecklistItems(songId, (items) => [
      ...items,
      {
        id: createChecklistItemId(),
        text: itemText,
        completed: false,
      },
    ]);

    setChecklistDraftText('');
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
    updateSongChecklistItems(songId, (items) =>
      items.map((item) => (item.id === itemId ? { ...item, text: nextText } : item))
    );
  }

  function handleRemoveChecklistItem(songId: string, itemId: string): void {
    updateSongChecklistItems(songId, (items) => items.filter((item) => item.id !== itemId));
  }

  function handleClearCompletedChecklistItems(songId: string): void {
    updateSongChecklistItems(songId, (items) => items.filter((item) => !item.completed));
  }

  const checklistModalSong = checklistModalSongId
    ? snapshot.songs.find((song) => song.id === checklistModalSongId) ?? null
    : null;
  const checklistModalItems = checklistModalSongId
    ? songChecklists[checklistModalSongId] ?? []
    : [];
  const checklistCompletedCount = checklistModalItems.filter((item) => item.completed).length;

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
    formatMeasuredStat(measuredAnalysis?.truePeakDbfs, 'dBFS'),
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
  const tonalBalanceAvailable = analysisStatus === 'ready' && analysis !== null;
  const referenceIntegratedText =
    referenceStatus === 'ready' && referenceTrack
      ? formatMeasuredStat(referenceTrack.measuredAnalysis.integratedLufs, 'LUFS')
      : buildAnalysisValue(referenceStatus, '—', {
          loading: 'Loading…',
          error: 'Error',
        });
  const referenceTruePeakText =
    referenceStatus === 'ready' && referenceTrack
      ? formatMeasuredStat(referenceTrack.measuredAnalysis.truePeakDbfs, 'dBFS')
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
        ? 'No peak cap data'
        : `${normalizationPreview.headroomCapDb >= 0 ? '+' : ''}${normalizationPreview.headroomCapDb.toFixed(1)} dB before ${selectedNormalizationPlatform.truePeakCeilingDbtp.toFixed(0)} dBTP`
      : buildAnalysisValue(analysisStatus, '—', {
          loading: 'Loading…',
          error: 'Error',
          empty: '—',
        });
  const normalizationSummaryText =
    analysisStatus === 'loading'
      ? 'Loading platform normalization preview…'
      : analysisStatus === 'error'
        ? 'Platform normalization preview unavailable.'
        : normalizationPreview
          ? `${selectedNormalizationPlatform.label} selected · ${
              normalizationPreviewEnabled ? 'preview on' : 'preview off'
            } · ${normalizationPreview.explanation}`
          : 'Select a track to estimate platform normalization.';

  transportActionRef.current = {
    toggle: () => {
      void handleTogglePlayback();
    },
    next: handleNextTrack,
    previous: handlePreviousTrack,
  };

  return (
    <div className="app-shell" data-testid="app-shell">
      <aside className="panel panel-left">
        <section className="sidebar-branding" data-testid="producer-player-branding">
          <img
            src={producerPlayerIconUrl}
            alt="Producer Player logo"
            className="sidebar-branding-logo"
            data-testid="producer-player-branding-logo"
          />
          <div className="sidebar-branding-copy">
            <strong>Producer Player</strong>
            <p className="muted">Desktop playback + version tracking for producers</p>
          </div>
        </section>

        <section className="folder-tools-card" data-testid="folder-tools-card">
          <section className="folder-add-cta">
            <button
              type="button"
              className="add-folder-primary"
              onClick={() => {
                void handleOpenFolderDialog();
              }}
              data-testid="link-folder-dialog-button"
              title="Choose a folder to watch for exported audio files."
            >
              Add Folder…
            </button>
            {environment.isMacAppStoreSandboxed ? (
              <p
                className="muted"
                data-testid="path-linker-disabled-message"
                title="In Mac App Store sandbox builds, folder access must come from Add Folder so the app can request a security-scoped bookmark."
              >
                Mac App Store build: use Add Folder… so Producer Player can retain sandbox access.
              </p>
            ) : null}
          </section>

          {environment.isTestMode && environment.canLinkFolderByPath ? (
            <div className="path-linker">
              <input
                data-testid="link-folder-path-input"
                value={folderPathInput}
                onChange={(event) => setFolderPathInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    handleLinkFolderPath();
                  }
                }}
                placeholder="Paste folder path"
                title="Paste a local folder path and press Enter or Link Path."
              />
              <button
                type="button"
                onClick={handleLinkFolderPath}
                data-testid="link-folder-path-button"
                title="Link the folder path typed in the input field."
              >
                Link Path
              </button>
            </div>
          ) : null}

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
          <h3>Status</h3>
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
                <p className="muted">{folder.path}</p>
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

        <section className="analysis-panel" data-testid="analysis-panel">
          <div className="analysis-panel-header">
            <div>
              <h3>Mastering + Reference</h3>
              <p className="muted">LUFS · peaks · tone · refs · normalization</p>
            </div>
            <button
              type="button"
              className="ghost analysis-expand-trigger"
              onClick={() => setAnalysisExpanded(true)}
              data-testid="analysis-expand-button"
              title="Open the expanded mastering and reference workspace."
              disabled={!selectedPlaybackVersion}
            >
              Expanded View <span aria-hidden="true">⤢</span>
            </button>
          </div>

          {selectedPlaybackVersion ? (
            <>
              <div className="analysis-track-summary">
                <strong data-testid="analysis-track-label">{selectedPlaybackVersion.fileName}</strong>
                <p className="muted">{selectedSong ? selectedSong.title : 'Unknown track'}</p>
              </div>

              <p className="muted analysis-loading-line" data-testid="analysis-status">
                {analysisStatus === 'loading'
                  ? 'Loading mastering analysis…'
                  : analysisStatus === 'error'
                    ? 'Analysis failed.'
                    : 'Ready.'}
              </p>

              {analysisStatus === 'error' ? (
                <p className="error" data-testid="analysis-error">
                  {analysisError ?? 'Could not analyse this track preview.'}
                </p>
              ) : null}

              <div className="analysis-stat-grid compact">
                <div className="analysis-stat-card" data-testid="analysis-integrated-stat">
                  <span className="analysis-stat-label">Integrated LUFS</span>
                  <strong>{measuredIntegratedText}</strong>
                </div>
                <div className="analysis-stat-card" data-testid="analysis-lra-stat">
                  <span className="analysis-stat-label">Dynamics range</span>
                  <strong>{measuredLraText}</strong>
                </div>
                <div className="analysis-stat-card" data-testid="analysis-true-peak-stat">
                  <span className="analysis-stat-label">True Peak</span>
                  <strong>{measuredTruePeakText}</strong>
                </div>
                <div className="analysis-stat-card" data-testid="analysis-max-short-term-stat">
                  <span className="analysis-stat-label">Peak short-term</span>
                  <strong>{measuredMaxShortTermText}</strong>
                </div>
                <div className="analysis-stat-card" data-testid="analysis-max-momentary-stat">
                  <span className="analysis-stat-label">Peak momentary</span>
                  <strong>{measuredMaxMomentaryText}</strong>
                </div>
                <div className="analysis-stat-card" data-testid="analysis-short-term-stat">
                  <span className="analysis-stat-label">Current loudness</span>
                  <strong>{shortTermEstimateText}</strong>
                </div>
              </div>

              <div className="analysis-reference-toolbar producer-reference-toolbar">
                <div>
                  <strong>Reference</strong>
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
                  >
                    Choose File…
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void handleUseCurrentTrackAsReference();
                    }}
                    data-testid="analysis-use-current-reference"
                    disabled={analysisStatus !== 'ready' || !selectedPlaybackVersion}
                    title="Use the current track as the reference."
                  >
                    Use Current
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
                <div className="analysis-ab-actions" role="group" aria-label="Quick A/B audition">
                  <button
                    type="button"
                    className={playbackPreviewMode === 'mix' ? '' : 'ghost'}
                    onClick={() => handleReferencePreviewModeChange('mix')}
                    data-testid="analysis-ab-mix"
                  >
                    Mix
                  </button>
                  <button
                    type="button"
                    className={playbackPreviewMode === 'reference' ? '' : 'ghost'}
                    onClick={() => handleReferencePreviewModeChange('reference')}
                    data-testid="analysis-ab-reference"
                    disabled={!referenceTrack}
                  >
                    Reference
                  </button>
                </div>
                <p className="muted">
                  {referenceTrack
                    ? playbackPreviewMode === 'reference'
                      ? `Auditioning ${referenceTrack.fileName}`
                      : `Ready to switch to ${referenceTrack.fileName}`
                    : 'Load a reference to audition the mix and reference from the same panel.'}
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
                      Choose a reference file or set the current track.
                    </span>
                  </div>
                )}
              </div>

              <section
                className="analysis-normalization-panel"
                data-testid="analysis-normalization-panel"
              >
                <div className="analysis-normalization-header">
                  <div>
                    <strong>Platform normalization preview</strong>
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
                    title="Toggle the selected platform loudness preview on the current playback."
                  >
                    Preview {normalizationPreviewEnabled ? 'On' : 'Off'}
                  </button>
                </div>

                <div className="analysis-platform-grid" role="group" aria-label="Platform normalization presets">
                  {NORMALIZATION_PLATFORM_PROFILES.map((platform) => (
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
                      <span
                        className="analysis-platform-icon"
                        style={{ '--platform-accent': platform.accentColor } as CSSProperties}
                      >
                        <PlatformIcon platformId={platform.id} />
                      </span>
                      <span className="analysis-platform-copy">
                        <strong>{platform.shortLabel}</strong>
                        <span className="muted">{platform.targetLufs.toFixed(0)} LUFS</span>
                      </span>
                    </button>
                  ))}
                </div>

                <div className="analysis-reference-inline analysis-normalization-inline">
                  <div className="analysis-stat-card compact" data-testid="analysis-normalization-change">
                    <span className="analysis-stat-label">Applied change</span>
                    <strong>{normalizationChangeText}</strong>
                    <span className="muted">
                      {normalizationPreviewEnabled
                        ? 'Active on current playback'
                        : 'Bypassed until Preview On'}
                    </span>
                  </div>
                  <div className="analysis-stat-card compact" data-testid="analysis-normalization-projected">
                    <span className="analysis-stat-label">Projected loudness</span>
                    <strong>{normalizationProjectedText}</strong>
                    <span className="muted">Track-normalized estimate</span>
                  </div>
                  <div className="analysis-stat-card compact" data-testid="analysis-normalization-cap">
                    <span className="analysis-stat-label">Peak / boost cap</span>
                    <strong>{normalizationCapText}</strong>
                    <span className="muted">
                      {normalizationPreview?.limitedByHeadroom
                        ? 'Boost limited by true peak headroom'
                        : selectedNormalizationPlatform.policy === 'down-only'
                          ? 'Down-only preview for this platform'
                          : 'Headroom-aware preview'}
                    </span>
                  </div>
                </div>
              </section>

              <div className="analysis-tonal-balance" data-testid="analysis-tonal-balance">
                {(
                  [
                    ['Low', tonalBalanceAvailable ? analysis?.tonalBalance.low ?? 0 : 0],
                    ['Mid', tonalBalanceAvailable ? analysis?.tonalBalance.mid ?? 0 : 0],
                    ['High', tonalBalanceAvailable ? analysis?.tonalBalance.high ?? 0 : 0],
                  ] as Array<[string, number]>
                ).map(([label, value]) => (
                  <div key={label} className="analysis-band-row" data-testid={`analysis-band-${label.toLowerCase()}`}>
                    <span>{label}</span>
                    <div className="analysis-band-meter" aria-hidden="true">
                      <span style={{ width: `${Math.max(8, Math.round(value * 100))}%` }} />
                    </div>
                    <strong>
                      {analysisStatus === 'ready' && analysis ? formatPercent(value) : 'Loading…'}
                    </strong>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="muted" data-testid="analysis-empty-state">
              Select a track to see analysis + A/B.
            </p>
          )}
        </section>
      </aside>

      <main className="panel panel-main">
        <header className="panel-header">
          <div className="panel-title">
            <h2>Album</h2>
            <p className="muted">{formatTrackCount(songs.length)}</p>
            <p className="muted album-duration-label" data-testid="album-duration-label">
              {formatAlbumDuration(albumDurationSeconds)}
            </p>
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
                  : 'Link a folder and load tracks before exporting latest versions in order.'
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
                  : 'Link a folder and load tracks before exporting a playlist JSON.'
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
                  : 'Link the target album folder before importing a playlist JSON.'
              }
              disabled={!canImportPlaylistOrder}
            >
              <span aria-hidden="true">⤒</span>
            </button>
          </div>
        </header>

        <div className="filter-row">
          <input
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Search tracks or versions"
            data-testid="search-input"
            title="Search by track title, version name, extension, or archived old/ paths."
          />
        </div>

        <p
          className="list-hint"
          data-testid="track-order-hint"
          title="Drag and drop tracks to reorder them. Producer Player keeps this order between sessions."
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
              ? `Matched versions: ${matchedVersionNames.slice(0, 2).join(', ')}${
                  matchedVersionNames.length > 2
                    ? ` (+${matchedVersionNames.length - 2} more)`
                    : ''
                }`
              : `${song.versions.length} version(s)`;
            const songRowTitle = getSongDisplayTitle(song);
            const songRowMetadataLabel = getSongRowMetadataLabel(song);
            const songRatingValue = songRatings[song.id] ?? DEFAULT_SONG_RATING;
            const songChecklistCount = songChecklists[song.id]?.length ?? 0;

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
                <button
                  type="button"
                  className={`${song.id === selectedSongId ? 'selected' : ''} ${
                    dragSongId === song.id ? 'drag-source' : ''
                  }`}
                  onClick={() => handleSongRowSelect(song.id)}
                  onDoubleClick={() => {
                    void handleSongRowPlay(song.id);
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
                      ? 'Select track. Drag rows to reorder track order.'
                      : 'Select track. Clear search to enable drag-and-drop ordering.'
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
                    <span className="muted">{formatDate(song.latestExportAt)}</span>
                  </div>
                </button>
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
                >
                  Checklist
                </button>
              </li>
            );
          })}
          {songs.length === 0 && <li className="empty-state">{emptyStateText}</li>}
        </ul>

        {selectedPlaybackVersion && (
          <section className="player-dock" data-testid="player-dock">
            <div className="player-dock-top">
              <div>
                <strong data-testid="player-track-name">{activePlaybackLabel.fileName}</strong>
                <p className="muted">{activePlaybackLabel.subtitle}</p>
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
              <button
                type="button"
                data-testid="player-prev"
                onClick={handlePreviousTrack}
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
                onClick={handleNextTrack}
                title="Jump to next track in the current queue."
              >
                ▶▶
              </button>
              <button
                type="button"
                data-testid="player-repeat"
                onClick={handleCycleRepeatMode}
                title="Toggle repeat mode: Off, One, or All."
              >
                Repeat: {REPEAT_MODE_LABEL[repeatMode]}
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

        <div className="panel-right-scroll" data-testid="inspector-scroll-region">
          {selectedSong ? (
            <section className="inspector-card">
              <h3 data-testid="inspector-song-title">{getSongDisplayFileName(selectedSong)}</h3>
              <p className="muted">Latest export: {formatDate(selectedSong.latestExportAt)}</p>
            </section>
          ) : (
            <section className="inspector-card empty-state">
              Select a track to inspect versions.
            </section>
          )}

          <section className="inspector-card">
            <h3>Version History</h3>
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
              >
                Report a Bug
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => handleOpenSupportLink(FEATURE_REQUEST_URL)}
                data-testid="support-feedback-feature"
              >
                Request a Feature
              </button>
            </div>
          </section>
        </div>
      </aside>

      {analysisExpanded ? (
        <div
          className="analysis-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Mastering analysis"
          data-testid="analysis-modal"
        >
          <div className="analysis-overlay-card">
            <div className="analysis-overlay-header">
              <div>
                <h2>Mastering Analysis</h2>
                <p className="muted">LUFS · peaks · tone · refs · normalization</p>
              </div>
              <button
                type="button"
                className="ghost"
                onClick={() => setAnalysisExpanded(false)}
                data-testid="analysis-close-button"
              >
                Close
              </button>
            </div>

            {selectedPlaybackVersion ? (
              <div className="analysis-overlay-grid">
                <section className="analysis-overlay-section">
                  <h3>Current track + analysis status</h3>
                  <p>
                    <strong>{selectedPlaybackVersion.fileName}</strong>
                  </p>
                  <p className="muted">{selectedSong ? selectedSong.title : 'Unknown track'}</p>
                  <p className="muted analysis-loading-line" data-testid="analysis-overlay-status">
                    {analysisStatus === 'loading'
                      ? 'Loading mastering analysis…'
                      : analysisStatus === 'error'
                        ? 'Analysis failed.'
                        : 'Ready.'}
                  </p>
                  {analysisStatus === 'error' ? (
                    <p className="error" data-testid="analysis-overlay-error">
                      {analysisError ?? 'Could not analyse this track preview.'}
                    </p>
                  ) : null}
                  <p className="muted" data-testid="analysis-overlay-preview-mode">
                    {referenceTrack
                      ? playbackPreviewMode === 'reference'
                        ? `Auditioning reference: ${referenceTrack.fileName}`
                        : `Mix loaded · reference ready: ${referenceTrack.fileName}`
                      : 'Auditioning mix export'}
                  </p>
                </section>

                <section className="analysis-overlay-section">
                  <h3>Measured loudness + peaks</h3>
                  <div className="analysis-detail-grid analysis-detail-grid-wide">
                    <div className="analysis-stat-card">
                      <span className="analysis-stat-label">Integrated LUFS</span>
                      <strong>{measuredIntegratedText}</strong>
                    </div>
                    <div className="analysis-stat-card">
                      <span className="analysis-stat-label">Dynamics range</span>
                      <strong>{measuredLraText}</strong>
                    </div>
                    <div className="analysis-stat-card">
                      <span className="analysis-stat-label">True Peak</span>
                      <strong>{measuredTruePeakText}</strong>
                    </div>
                    <div className="analysis-stat-card">
                      <span className="analysis-stat-label">Sample peak</span>
                      <strong>{measuredSamplePeakText}</strong>
                    </div>
                    <div className="analysis-stat-card">
                      <span className="analysis-stat-label">Peak short-term</span>
                      <strong>{measuredMaxShortTermText}</strong>
                    </div>
                    <div className="analysis-stat-card">
                      <span className="analysis-stat-label">Peak momentary</span>
                      <strong>{measuredMaxMomentaryText}</strong>
                    </div>
                    <div className="analysis-stat-card">
                      <span className="analysis-stat-label">Mean volume</span>
                      <strong>{measuredMeanVolumeText}</strong>
                    </div>
                    <div className="analysis-stat-card">
                      <span className="analysis-stat-label">Current loudness</span>
                      <strong>{shortTermEstimateText}</strong>
                    </div>
                  </div>
                </section>

                <section className="analysis-overlay-section">
                  <h3>Estimated tonal balance</h3>
                  <div className="analysis-tonal-balance detailed">
                    {(
                      [
                        ['Low', analysis?.tonalBalance.low ?? 0],
                        ['Mid', analysis?.tonalBalance.mid ?? 0],
                        ['High', analysis?.tonalBalance.high ?? 0],
                      ] as Array<[string, number]>
                    ).map(([label, value]) => (
                      <div key={label} className="analysis-band-row">
                        <span>{label}</span>
                        <div className="analysis-band-meter" aria-hidden="true">
                          <span style={{ width: `${Math.max(8, Math.round(value * 100))}%` }} />
                        </div>
                        <strong>
                          {analysisStatus === 'ready' && analysis ? formatPercent(value) : 'Loading…'}
                        </strong>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="analysis-overlay-section">
                  <h3>Reference track workflow</h3>
                  <p className="muted">
                    Load a reference file or set the current track as the reference, then audition
                    the mix and reference from the same panel.
                  </p>
                  <div className="analysis-reference-actions">
                    <button
                      type="button"
                      onClick={() => {
                        void handleChooseReferenceTrack();
                      }}
                      data-testid="analysis-choose-reference-overlay"
                    >
                      Choose Reference File…
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void handleUseCurrentTrackAsReference();
                      }}
                      disabled={analysisStatus !== 'ready' || !selectedPlaybackVersion}
                    >
                      Set Current Track as Reference
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={handleClearReferenceTrack}
                      disabled={!referenceTrack && referenceStatus !== 'error'}
                    >
                      Clear Reference
                    </button>
                  </div>

                  <div className="analysis-ab-toggle">
                    <span className="analysis-ab-label">Quick A/B</span>
                    <div className="analysis-ab-actions" role="group" aria-label="Quick A/B audition">
                      <button
                        type="button"
                        className={playbackPreviewMode === 'mix' ? '' : 'ghost'}
                        onClick={() => handleReferencePreviewModeChange('mix')}
                      >
                        Mix
                      </button>
                      <button
                        type="button"
                        className={playbackPreviewMode === 'reference' ? '' : 'ghost'}
                        onClick={() => handleReferencePreviewModeChange('reference')}
                        disabled={!referenceTrack}
                      >
                        Reference
                      </button>
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
                </section>

                <section
                  className="analysis-overlay-section"
                  data-testid="analysis-overlay-normalization-panel"
                >
                  <h3>Platform normalization preview</h3>
                  <div className="analysis-normalization-header">
                    <div>
                      <strong>Streaming target emulation</strong>
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
                      title="Toggle the selected platform loudness preview on the current playback."
                    >
                      Preview {normalizationPreviewEnabled ? 'On' : 'Off'}
                    </button>
                  </div>

                  <div
                    className="analysis-platform-grid analysis-platform-grid-overlay"
                    role="group"
                    aria-label="Platform normalization presets"
                  >
                    {NORMALIZATION_PLATFORM_PROFILES.map((platform) => (
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
                        <span
                          className="analysis-platform-icon"
                          style={{ '--platform-accent': platform.accentColor } as CSSProperties}
                        >
                          <PlatformIcon platformId={platform.id} />
                        </span>
                        <span className="analysis-platform-copy">
                          <strong>{platform.shortLabel}</strong>
                          <span className="muted">{platform.targetLufs.toFixed(0)} LUFS</span>
                        </span>
                      </button>
                    ))}
                  </div>

                  <div className="analysis-detail-grid analysis-detail-grid-wide">
                    <div className="analysis-stat-card" data-testid="analysis-overlay-normalization-change">
                      <span className="analysis-stat-label">Applied change</span>
                      <strong>{normalizationChangeText}</strong>
                      <span className="muted">
                        {normalizationPreviewEnabled
                          ? 'Active on current playback'
                          : 'Bypassed until Preview On'}
                      </span>
                    </div>
                    <div className="analysis-stat-card" data-testid="analysis-overlay-normalization-projected">
                      <span className="analysis-stat-label">Projected loudness</span>
                      <strong>{normalizationProjectedText}</strong>
                      <span className="muted">Track-normalized estimate</span>
                    </div>
                    <div className="analysis-stat-card" data-testid="analysis-overlay-normalization-cap">
                      <span className="analysis-stat-label">Peak / boost cap</span>
                      <strong>{normalizationCapText}</strong>
                      <span className="muted">
                        {normalizationPreview?.limitedByHeadroom
                          ? 'Boost limited by true peak headroom'
                          : selectedNormalizationPlatform.policy === 'down-only'
                            ? 'Down-only preview for this platform'
                            : 'Headroom-aware preview'}
                      </span>
                    </div>
                    <div className="analysis-stat-card" data-testid="analysis-overlay-normalization-target">
                      <span className="analysis-stat-label">Target + true-peak ceiling</span>
                      <strong>
                        {selectedNormalizationPlatform.targetLufs.toFixed(0)} LUFS ·{' '}
                        {selectedNormalizationPlatform.truePeakCeilingDbtp.toFixed(0)} dBTP
                      </strong>
                      <span className="muted">Platform default profile</span>
                    </div>
                    <div className="analysis-stat-card" data-testid="analysis-overlay-normalization-policy">
                      <span className="analysis-stat-label">Gain policy</span>
                      <strong>
                        {selectedNormalizationPlatform.policy === 'down-only'
                          ? 'Down-only attenuation'
                          : 'Up/down normalization'}
                      </strong>
                      <span className="muted">{selectedNormalizationPlatform.description}</span>
                    </div>
                  </div>
                </section>

                <section className="analysis-overlay-section analysis-comparison-panel">
                  <h3>Current export vs reference track</h3>
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
                      Load a reference to see deltas.
                    </p>
                  )}
                </section>
              </div>
            ) : (
              <p className="muted">Select a track and wait for analysis to finish.</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
